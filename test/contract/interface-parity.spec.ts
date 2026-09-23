import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { AppError } from '../../src/domain/errors.js';
import { createHttpTestApp, type HttpTestApp } from '../helpers/http-app.js';
import {
  makeCache,
  makeCandidate,
  makeClock,
  makeCurrent,
  makeForecast,
  makeForecastDay,
  makeInterval,
  makeLocation,
} from '../helpers/fakes.js';

type Json = Record<string, unknown>;

function removePaths(value: unknown, paths: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => removePaths(entry, paths));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const result: Json = {};
  for (const [key, child] of Object.entries(value as Json)) {
    result[key] = removePaths(child, paths);
  }
  for (const path of paths) {
    const segments = path.split('.');
    let cursor: unknown = result;
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (cursor === null || typeof cursor !== 'object') {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Json)[segments[index] as string];
    }
    const leaf = segments[segments.length - 1] as string;
    if (cursor !== null && typeof cursor === 'object') {
      delete (cursor as Json)[leaf];
    }
  }
  return result;
}

function deepSort(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepSort);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const entries = Object.entries(value as Json).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, child]) => [key, deepSort(child)]));
}

export function canonicalize(value: unknown): unknown {
  return deepSort(removePaths(value, ['meta.requestId', 'error.requestId', 'content', 'isError']));
}

const LOCATION = makeLocation({ timeZone: 'Europe/Paris' });

function deterministicForecast() {
  const hours = [
    '2026-09-23T11:00:00.000Z',
    '2026-09-23T12:00:00.000Z',
    '2026-09-23T13:00:00.000Z',
  ].map((time) => makeInterval({ time }));
  return makeForecast({
    location: LOCATION,
    generatedAt: '2026-09-23T09:30:00.000Z',
    days: [
      makeForecastDay({ date: '2026-09-23', hours }),
      makeForecastDay({ date: '2026-09-24', hours: [] }),
      makeForecastDay({ date: '2026-09-25', hours: [] }),
    ],
  });
}

let harness: HttpTestApp;
let app: INestApplication;
let mcp: Client;
let baseUrl: string;

function restGet(path: string, query: Json) {
  return request(app.getHttpServer()).get(path).query(query);
}

function restPost(path: string, body: Json) {
  return request(app.getHttpServer()).post(path).send(body);
}

async function callTool(name: string, args: Json) {
  return mcp.callTool({ name, arguments: args });
}

function expectCanonicalEqual(left: unknown, right: unknown, label: string): void {
  expect(canonicalize(right), label).toEqual(canonicalize(left));
}

function cacheEntries(): Map<string, unknown> {
  return harness.cache?.entries as Map<string, unknown>;
}

beforeAll(async () => {
  const clock = makeClock();
  const cache = makeCache(clock);
  harness = await createHttpTestApp({ overrides: { clock, cache } });
  app = harness.app;
  harness.provider.searchLocations.mockResolvedValue([
    makeCandidate({ locationId: '2807', timeZone: 'Europe/Paris' }),
  ]);
  harness.provider.getCurrent.mockResolvedValue(makeCurrent({ location: LOCATION }));
  harness.provider.getForecast.mockResolvedValue(deterministicForecast());
  harness.provider.getAlerts.mockResolvedValue([]);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  mcp = new Client({ name: 'parity-e2e', version: '1.0.0' });
  await mcp.connect(transport);
});

afterAll(async () => {
  await mcp.close();
  await app.close();
});

const INPUT_FORMS: Array<{ label: string; restQuery: Json; mcpArgs: Json }> = [
  { label: 'query', restQuery: { q: 'Paris' }, mcpArgs: { query: 'Paris' } },
  { label: 'locationId', restQuery: { locationId: '2807' }, mcpArgs: { locationId: '2807' } },
  {
    label: 'coordinates',
    restQuery: { lat: 48.8566, lon: 2.3522 },
    mcpArgs: { coordinates: { lat: 48.8566, lon: 2.3522 } },
  },
];

describe('REST and MCP happy-path parity', () => {
  it('resolves the same query identically', async () => {
    const rest = await restGet('/api/v1/locations/resolve', { q: 'Paris' }).expect(200);
    const mcpResult = await callTool('resolve_location', { query: 'Paris' });
    expectCanonicalEqual(rest.body.data, mcpResult.structuredContent, 'resolve');
  });

  it.each(INPUT_FORMS)('returns identical current weather for $label input', async (form) => {
    cacheEntries().clear();
    const rest = await restGet('/api/v1/weather/current', form.restQuery).expect(200);
    cacheEntries().clear();
    const mcpResult = await callTool('get_current_weather', form.mcpArgs);
    expectCanonicalEqual(rest.body, mcpResult.structuredContent, `current:${form.label}`);
  });

  it.each(INPUT_FORMS)('returns identical daily forecasts for $label input', async (form) => {
    cacheEntries().clear();
    const rest = await restGet('/api/v1/weather/forecast', {
      ...form.restQuery,
      days: 3,
      includeHourly: false,
    }).expect(200);
    cacheEntries().clear();
    const mcpResult = await callTool('get_weather_forecast', {
      ...form.mcpArgs,
      days: 3,
      includeHourly: false,
    });
    expectCanonicalEqual(rest.body, mcpResult.structuredContent, `forecast-daily:${form.label}`);
    const restDay = (rest.body.data as { days: Array<Record<string, unknown>> }).days[0];
    expect(restDay).not.toHaveProperty('hours');
  });

  it.each(INPUT_FORMS)('returns identical hourly forecasts for $label input', async (form) => {
    cacheEntries().clear();
    const rest = await restGet('/api/v1/weather/forecast', {
      ...form.restQuery,
      days: 3,
      includeHourly: true,
    }).expect(200);
    cacheEntries().clear();
    const mcpResult = await callTool('get_weather_forecast', {
      ...form.mcpArgs,
      days: 3,
      includeHourly: true,
    });
    expectCanonicalEqual(rest.body, mcpResult.structuredContent, `forecast-hourly:${form.label}`);
  });

  it.each(INPUT_FORMS)('returns identical alerts for $label input', async (form) => {
    cacheEntries().clear();
    const rest = await restGet('/api/v1/weather/alerts', form.restQuery).expect(200);
    cacheEntries().clear();
    const mcpResult = await callTool('get_weather_alerts', form.mcpArgs);
    expectCanonicalEqual(rest.body, mcpResult.structuredContent, `alerts:${form.label}`);
  });

  it.each(['commute', 'running', 'travel', 'outdoor_event'] as const)(
    'returns identical %s assessments',
    async (activity) => {
      cacheEntries().clear();
      const rest = await restPost('/api/v1/weather/assessments', {
        location: { query: 'Paris' },
        activity,
      }).expect(201);
      cacheEntries().clear();
      const mcpResult = await callTool('assess_weather_conditions', {
        location: { query: 'Paris' },
        activity,
      });
      expectCanonicalEqual(rest.body, mcpResult.structuredContent, `assessment:${activity}`);
    },
  );
});

describe('REST and MCP failure/workflow parity', () => {
  it('preserves LOCATION_AMBIGUOUS candidates across interfaces', async () => {
    harness.provider.searchLocations.mockResolvedValue([
      makeCandidate({ locationId: 'a', name: 'Springfield' }),
      makeCandidate({ locationId: 'b', name: 'Springfield' }),
    ]);
    cacheEntries().clear();
    const rest = await restGet('/api/v1/weather/current', { q: 'Springfield' }).expect(409);
    expect(rest.body.error.code).toBe('LOCATION_AMBIGUOUS');
    cacheEntries().clear();
    const mcpResult = await callTool('get_current_weather', { query: 'Springfield' });
    expect(mcpResult.isError).toBeFalsy();
    expect(mcpResult.structuredContent).toMatchObject({
      status: 'location_resolution_required',
    });
    expectCanonicalEqual(
      rest.body.error.details.candidates,
      (mcpResult.structuredContent as Json).candidates,
      'ambiguous candidates',
    );
    harness.provider.searchLocations.mockResolvedValue([
      makeCandidate({ locationId: '2807', timeZone: 'Europe/Paris' }),
    ]);
  });

  it('preserves STALE_DATA semantics across interfaces', async () => {
    cacheEntries().clear();
    harness.provider.getCurrent.mockResolvedValue(makeCurrent({ location: LOCATION }));
    await restGet('/api/v1/weather/current', { q: 'Paris' }).expect(200);
    harness.clock.advanceMinutes(11);
    harness.provider.getCurrent.mockRejectedValue(new AppError('UPSTREAM_UNAVAILABLE', 'down'));
    const mcpResult = await callTool('get_current_weather', { query: 'Paris' });
    const rest = await restGet('/api/v1/weather/current', { q: 'Paris' }).expect(200);
    expectCanonicalEqual(rest.body, mcpResult.structuredContent, 'stale');
    expect((rest.body.meta as Json).stale).toBe(true);
    expect((rest.body.meta as Json).warnings).toContain('STALE_DATA');
    harness.provider.getCurrent.mockResolvedValue(makeCurrent({ location: LOCATION }));
    harness.clock.set('2026-09-23T10:00:00.000Z');
    cacheEntries().clear();
  });

  it.each([
    ['PROVIDER_BUDGET_EXHAUSTED', 503],
    ['UPSTREAM_UNAVAILABLE', 503],
    ['UPSTREAM_TIMEOUT', 504],
  ])('preserves %s error semantics across interfaces', async (code, status) => {
    cacheEntries().clear();
    harness.provider.getCurrent.mockRejectedValue(new AppError(code as never, 'safe message'));
    const rest = await restGet('/api/v1/weather/current', { q: 'Paris' }).expect(status);
    expect(rest.body.error.code).toBe(code);
    const mcpResult = await callTool('get_current_weather', { query: 'Paris' });
    expect(mcpResult.isError).toBe(true);
    expect((mcpResult.structuredContent as Json).error).toMatchObject({ code });
    harness.provider.getCurrent.mockResolvedValue(makeCurrent({ location: LOCATION }));
  });

  it('preserves LOCATION_NOT_FOUND semantics across interfaces', async () => {
    harness.provider.searchLocations.mockResolvedValue([]);
    cacheEntries().clear();
    const rest = await restGet('/api/v1/weather/current', { q: 'missing' }).expect(404);
    expect(rest.body.error.code).toBe('LOCATION_NOT_FOUND');
    cacheEntries().clear();
    const mcpResult = await callTool('get_current_weather', { query: 'missing' });
    expect(mcpResult.isError).toBe(true);
    expect((mcpResult.structuredContent as Json).error).toMatchObject({
      code: 'LOCATION_NOT_FOUND',
    });
    harness.provider.searchLocations.mockResolvedValue([
      makeCandidate({ locationId: '2807', timeZone: 'Europe/Paris' }),
    ]);
  });

  it('preserves VALIDATION_ERROR semantics across interfaces', async () => {
    cacheEntries().clear();
    const rest = await restPost('/api/v1/weather/assessments', {
      location: { query: 'Paris' },
      activity: 'running',
      startTime: '2026-09-23T10:00:00',
      endTime: '2026-09-23T12:00:00',
    }).expect(400);
    expect(rest.body.error.code).toBe('VALIDATION_ERROR');
    const mcpResult = await callTool('assess_weather_conditions', {
      location: { query: 'Paris' },
      activity: 'running',
      startTime: '2026-09-23T10:00:00',
      endTime: '2026-09-23T12:00:00',
    });
    expect(mcpResult.isError).toBe(true);
    expect((mcpResult.structuredContent as Json).error).toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
