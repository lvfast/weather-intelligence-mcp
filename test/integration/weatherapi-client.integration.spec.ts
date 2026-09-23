import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/domain/errors.js';
import type { EmergencyLimiter, ProviderQuota, QuotaReservation } from '../../src/domain/ports.js';
import { WeatherApiClient } from '../../src/infrastructure/weatherapi/weatherapi.client.js';

const currentBody = JSON.parse(
  readFileSync(new URL('../fixtures/weatherapi/current.json', import.meta.url), 'utf8'),
) as object;

interface StubSpec {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  respond?: boolean;
  destroy?: boolean;
}

interface StubContext {
  url: string;
  requests: string[];
  close(): Promise<void>;
}

async function withStub(
  handler: (index: number) => StubSpec,
  run: (context: StubContext) => Promise<void>,
): Promise<void> {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url ?? '');
    const spec = handler(requests.length - 1);
    if (spec.destroy === true) {
      request.socket.destroy();
      return;
    }
    if (spec.respond === false) {
      return;
    }
    response.writeHead(spec.status ?? 200, spec.headers ?? { 'content-type': 'application/json' });
    response.end(spec.body ?? '{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    await run({
      url: `http://127.0.0.1:${address.port}/v1`,
      requests,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function reservation(overrides: Partial<QuotaReservation> = {}): QuotaReservation {
  return {
    granted: true,
    used: 1,
    limit: 90_000,
    resetsAt: '2026-10-01T00:00:00.000Z',
    mode: 'process',
    ...overrides,
  };
}

function makeQuota(): ProviderQuota & { reserve: ReturnType<typeof vi.fn> } {
  const quota = { reserve: vi.fn<(attempts: number) => Promise<QuotaReservation>>() };
  quota.reserve.mockResolvedValue(reservation());
  return quota;
}

function makeEmergency(): EmergencyLimiter & { reserve: ReturnType<typeof vi.fn> } {
  const emergency = { reserve: vi.fn<(attempts: number) => Promise<QuotaReservation>>() };
  emergency.reserve.mockResolvedValue(reservation({ mode: 'emergency' }));
  return emergency;
}

const apiError = (code: number, message: string): string =>
  JSON.stringify({ error: { code, message } });

async function waitUntil(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 5000) {
      throw new Error('waitUntil timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('WeatherApiClient', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries two 500 responses, succeeds on the third, and reserves three calls', async () => {
    const quota = makeQuota();
    const emergency = makeEmergency();
    await withStub(
      (index) =>
        index < 2
          ? { status: 500, body: '{"error":{"code":9999,"message":"boom"}}' }
          : { status: 200, body: JSON.stringify(currentBody) },
      async ({ url, requests }) => {
        const client = new WeatherApiClient('secret-key', quota, emergency, {
          baseUrl: url,
          jitter: 0.5,
        });
        const result = await client.getCurrent({ locationId: '2807' });
        expect(result.location.name).toBe('Paris');
        expect(result.interval.temperatureC).toBe(21.0);
        expect(quota.reserve).toHaveBeenCalledTimes(3);
        expect(emergency.reserve).not.toHaveBeenCalled();
        expect(requests).toHaveLength(3);
      },
    );
  });

  it('does not retry WeatherAPI error 1006 location not found', async () => {
    const quota = makeQuota();
    await withStub(
      () => ({ status: 400, body: apiError(1006, 'No matching location found.') }),
      async ({ url, requests: _requests }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
        });
        await expect(client.getCurrent({ locationId: '2807' })).rejects.toMatchObject({
          code: 'LOCATION_NOT_FOUND',
        });
        expect(_requests).toHaveLength(1);
      },
    );
  });

  it('maps 2006 to UPSTREAM_UNAUTHORIZED and 2007 to UPSTREAM_QUOTA_EXCEEDED', async () => {
    const quota = makeQuota();
    await withStub(
      () => ({ status: 400, body: apiError(2006, 'API key is invalid.') }),
      async ({ url }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
        });
        await expect(client.getCurrent({ locationId: '2807' })).rejects.toMatchObject({
          code: 'UPSTREAM_UNAUTHORIZED',
        });
      },
    );
    await withStub(
      () => ({ status: 400, body: apiError(2007, 'API key has exceeded calls per month quota.') }),
      async ({ url }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
        });
        await expect(client.getCurrent({ locationId: '2807' })).rejects.toMatchObject({
          code: 'UPSTREAM_QUOTA_EXCEEDED',
        });
      },
    );
  });

  it('maps 2009 to UPSTREAM_PLAN_RESTRICTED without exposing the raw body', async () => {
    const quota = makeQuota();
    await withStub(
      () => ({
        status: 400,
        body: apiError(2009, 'PLAN_MARKER_SECRET please check the pricing page PLAN_MARKER_SECRET'),
      }),
      async ({ url }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
        });
        const error = await client
          .getCurrent({ locationId: '2807' })
          .catch((caught: unknown) => caught);
        expect(error).toMatchObject({ code: 'UPSTREAM_PLAN_RESTRICTED' });
        expect(JSON.stringify(error)).not.toContain('PLAN_MARKER_SECRET');
        expect(JSON.stringify(error)).not.toContain('pricing page');
      },
    );
  });

  it('times out one attempt at three seconds and the whole operation by eight seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const quota = makeQuota();
    await withStub(
      () => ({ respond: false }),
      async ({ url }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
        });
        const promise = client.getCurrent({ locationId: '2807' });
        const expectation = expect(promise).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(3000);
        expect(quota.reserve).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(200);
        expect(quota.reserve).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(5000);
        await expectation;
        expect(quota.reserve).toHaveBeenCalledTimes(3);
      },
    );
  });

  it('does not start the next retry when the caller aborts during backoff', async () => {
    const quota = makeQuota();
    await withStub(
      () => ({ status: 500, body: '{}' }),
      async ({ url, requests }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
          backoffBaseMs: 2000,
        });
        const controller = new AbortController();
        const promise = client.getCurrent({ locationId: '2807' }, controller.signal);
        await waitUntil(() => requests.length === 1);
        controller.abort();
        await expect(promise).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
        await new Promise((resolve) => setTimeout(resolve, 2500));
        expect(requests).toHaveLength(1);
        expect(quota.reserve).toHaveBeenCalledTimes(1);
      },
    );
  });

  it('does not reserve quota for a retry that cancellation prevents', async () => {
    const quota = makeQuota();
    await withStub(
      () => ({ status: 500, body: '{}' }),
      async ({ url }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
          backoffBaseMs: 2000,
        });
        const controller = new AbortController();
        const promise = client.getCurrent({ locationId: '2807' }, controller.signal);
        await waitUntil(() => quota.reserve.mock.calls.length === 1);
        controller.abort();
        await expect(promise).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
        expect(quota.reserve).toHaveBeenCalledTimes(1);
      },
    );
  });

  it('does not issue HTTP when provider budget reservation is denied', async () => {
    const quota = makeQuota();
    quota.reserve.mockRejectedValue(new AppError('PROVIDER_BUDGET_EXHAUSTED', 'budget exhausted'));
    await withStub(
      () => ({ status: 200, body: JSON.stringify(currentBody) }),
      async ({ url, requests }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
        });
        await expect(client.getCurrent({ locationId: '2807' })).rejects.toMatchObject({
          code: 'PROVIDER_BUDGET_EXHAUSTED',
        });
        expect(requests).toHaveLength(0);
      },
    );
  });

  it('falls back to the emergency limiter when the shared quota is unavailable', async () => {
    const quota = makeQuota();
    const emergency = makeEmergency();
    quota.reserve.mockRejectedValue(new AppError('PROVIDER_BUDGET_UNAVAILABLE', 'redis down'));
    await withStub(
      () => ({ status: 200, body: JSON.stringify(currentBody) }),
      async ({ url, requests }) => {
        const client = new WeatherApiClient('secret-key', quota, emergency, {
          baseUrl: url,
          jitter: 0.5,
        });
        await expect(client.getCurrent({ locationId: '2807' })).resolves.toMatchObject({
          location: { name: 'Paris' },
        });
        expect(emergency.reserve).toHaveBeenCalledTimes(1);
        expect(requests).toHaveLength(1);
      },
    );
  });

  it('issues no HTTP when both quota sources are unavailable', async () => {
    const quota = makeQuota();
    const emergency = makeEmergency();
    quota.reserve.mockRejectedValue(new AppError('PROVIDER_BUDGET_UNAVAILABLE', 'redis down'));
    emergency.reserve.mockRejectedValue(
      new AppError('PROVIDER_BUDGET_UNAVAILABLE', 'emergency exhausted'),
    );
    await withStub(
      () => ({ status: 200, body: JSON.stringify(currentBody) }),
      async ({ url, requests }) => {
        const client = new WeatherApiClient('secret-key', quota, emergency, {
          baseUrl: url,
          jitter: 0.5,
        });
        await expect(client.getCurrent({ locationId: '2807' })).rejects.toMatchObject({
          code: 'PROVIDER_BUDGET_UNAVAILABLE',
        });
        expect(requests).toHaveLength(0);
      },
    );
  });

  it('honors a usable Retry-After inside the deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const quota = makeQuota();
    await withStub(
      (index) =>
        index === 0
          ? { status: 429, body: '{}', headers: { 'retry-after': '1' } }
          : { status: 200, body: JSON.stringify(currentBody) },
      async ({ url, requests }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
        });
        const promise = client.getCurrent({ locationId: '2807' });
        const expectation = expect(promise).resolves.toMatchObject({ location: { name: 'Paris' } });
        while (requests.length < 1) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        await vi.advanceTimersByTimeAsync(1000);
        await expectation;
        expect(requests).toHaveLength(2);
      },
    );
  });

  it('does not wait for a Retry-After beyond the overall deadline', async () => {
    const quota = makeQuota();
    await withStub(
      () => ({ status: 429, body: '{}', headers: { 'retry-after': '120' } }),
      async ({ url, requests }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
        });
        await expect(client.getCurrent({ locationId: '2807' })).rejects.toMatchObject({
          code: 'UPSTREAM_UNAVAILABLE',
        });
        expect(requests).toHaveLength(1);
      },
    );
  });

  it('retries on network failure', async () => {
    const quota = makeQuota();
    await withStub(
      (index) =>
        index === 0 ? { destroy: true } : { status: 200, body: JSON.stringify(currentBody) },
      async ({ url, requests }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
        });
        await expect(client.getCurrent({ locationId: '2807' })).resolves.toMatchObject({
          location: { name: 'Paris' },
        });
        expect(requests).toHaveLength(2);
      },
    );
  });

  it('treats a malformed success payload as UPSTREAM_UNAVAILABLE without retrying', async () => {
    const quota = makeQuota();
    await withStub(
      () => ({ status: 200, body: '{"location":{},"current":{"temp_c":"hot"}}' }),
      async ({ url, requests }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
        });
        await expect(client.getCurrent({ locationId: '2807' })).rejects.toMatchObject({
          code: 'UPSTREAM_UNAVAILABLE',
        });
        expect(requests).toHaveLength(1);
      },
    );
  });

  it('logs attempt metadata without the key, URL, or raw body', async () => {
    const quota = makeQuota();
    const logger = { info: vi.fn(), warn: vi.fn() };
    await withStub(
      () => ({ status: 500, body: '{"error":{"code":9999,"message":"REDACT_MARKER"}}' }),
      async ({ url }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
          logger,
        });
        await client.getCurrent({ locationId: '2807' }).catch(() => undefined);
        const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
        expect(logged).not.toContain('secret-key');
        expect(logged).not.toContain('REDACT_MARKER');
        expect(logged).not.toContain(url);
        expect(logged).toContain('current.json');
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'current.json',
            upstreamStatus: 500,
            attempt: expect.any(Number),
            durationMs: expect.any(Number),
          }),
          expect.any(String),
        );
      },
    );
  });

  it('sends the key only as the required query parameter', async () => {
    const quota = makeQuota();
    const searchBody =
      '[{"id":2807,"name":"Paris","region":"Ile-de-France","country":"France","lat":48.86,"lon":2.35,"url":"paris"}]';
    await withStub(
      () => ({ status: 200, body: searchBody }),
      async ({ url, requests }) => {
        const client = new WeatherApiClient('secret-key', quota, makeEmergency(), {
          baseUrl: url,
          jitter: 0.5,
        });
        await client.searchLocations('Paris');
        const requestUrl = requests[0] ?? '';
        expect(requestUrl).toContain('key=secret-key');
        expect(requestUrl).toContain('q=Paris');
        expect(requestUrl).not.toContain('secret-key=');
      },
    );
  });
});
