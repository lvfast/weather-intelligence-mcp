import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AppError } from '../../src/domain/errors.js';
import { bootstrapHttp } from '../../src/entrypoints/http.js';
import { createHttpTestApp } from '../helpers/http-app.js';
import { makeProvider, makeWeatherService } from '../helpers/fakes.js';

let app: INestApplication;

beforeAll(async () => {
  const created = await createHttpTestApp();
  app = created.app;
  app
    .getHttpAdapter()
    .get('/mcp', (_request: unknown, response: { json: (v: unknown) => void }) => {
      response.json({ probe: true });
    });
});

afterAll(async () => {
  await app.close();
});

describe('host and origin safeguards', () => {
  it('rejects non-local hosts in local mode', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/weather/current')
      .query({ q: 'Paris' })
      .set('Host', 'evil.example.com')
      .expect(403);
  });

  it('rejects disallowed hosts on the MCP probe route as well', async () => {
    await request(app.getHttpServer()).get('/mcp').set('Host', 'evil.example.com').expect(403);
  });

  it('rejects present-but-disallowed origins', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/weather/current')
      .query({ q: 'Paris' })
      .set('Origin', 'https://evil.example.com')
      .expect(403);
  });

  it('allows requests without an Origin header when the host is allowed', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/weather/current')
      .query({ q: 'Paris' })
      .expect(200);
  });
});

describe('rate limiting', () => {
  it('rejects requests beyond the configured rolling limit', async () => {
    const limited = await createHttpTestApp({ env: { RATE_LIMIT_PER_MINUTE: '3' } });
    try {
      for (let index = 0; index < 3; index += 1) {
        await request(limited.app.getHttpServer())
          .get('/api/v1/weather/alerts')
          .query({ q: 'Paris' })
          .expect(200);
      }
      const rejected = await request(limited.app.getHttpServer())
        .get('/api/v1/weather/alerts')
        .query({ q: 'Paris' })
        .expect(429);
      expect(rejected.body.error).toMatchObject({ code: 'RATE_LIMITED' });
    } finally {
      delete process.env.RATE_LIMIT_PER_MINUTE;
      await limited.app.close();
    }
  });

  it('exempts health endpoints from the rate limit', async () => {
    const limited = await createHttpTestApp({ env: { RATE_LIMIT_PER_MINUTE: '1' } });
    try {
      await request(limited.app.getHttpServer())
        .get('/api/v1/weather/alerts')
        .query({ q: 'Paris' })
        .expect(200);
      await request(limited.app.getHttpServer()).get('/health/live').expect(200);
      await request(limited.app.getHttpServer()).get('/health/ready').expect(200);
    } finally {
      delete process.env.RATE_LIMIT_PER_MINUTE;
      await limited.app.close();
    }
  });
});

describe('request deadline', () => {
  it('aborts slow requests and surfaces 499', async () => {
    const slowWeather = makeWeatherService();
    slowWeather.getCurrent.mockImplementation(
      (_input: unknown, signal: AbortSignal | undefined) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new AppError('REQUEST_CANCELLED', 'deadline exceeded')),
            { once: true },
          );
        }),
    );
    const { app: slowApp } = await createHttpTestApp({
      env: { REQUEST_DEADLINE_MS: '100' },
      overrides: { weatherService: slowWeather },
    });
    try {
      await request(slowApp.getHttpServer())
        .get('/api/v1/weather/current')
        .query({ q: 'Paris' })
        .expect(499);
    } finally {
      delete process.env.REQUEST_DEADLINE_MS;
      await slowApp.close();
    }
  });
});

describe('public mode and Redis degradation', () => {
  it('refuses to bootstrap in public mode without Redis', async () => {
    await expect(
      bootstrapHttp({
        WEATHERAPI_KEY: 'secret',
        EXPOSURE_MODE: 'public',
        CACHE_BACKEND: 'memory',
        HOST: '0.0.0.0',
        HOST_ALLOWLIST: 'demo.example.com',
      }),
    ).rejects.toThrow(/public.*Redis/i);
  });

  it('reports readiness 503 when the configured Redis backend is down', async () => {
    const { app: redisApp } = await createHttpTestApp({
      env: {
        CACHE_BACKEND: 'redis',
        REDIS_URL: 'redis://127.0.0.1:6399',
      },
      overrides: { provider: makeProvider() },
    });
    try {
      await request(redisApp.getHttpServer()).get('/health/live').expect(200);
      await request(redisApp.getHttpServer()).get('/health/ready').expect(503);
    } finally {
      delete process.env.CACHE_BACKEND;
      delete process.env.REDIS_URL;
      await redisApp.close();
    }
  });

  it('keeps health checks free of any provider traffic', async () => {
    const provider = makeProvider();
    const { app: quietApp } = await createHttpTestApp({ overrides: { provider } });
    try {
      await request(quietApp.getHttpServer()).get('/health/live').expect(200);
      await request(quietApp.getHttpServer()).get('/health/ready').expect(200);
      expect(provider.searchLocations).not.toHaveBeenCalled();
      expect(provider.getCurrent).not.toHaveBeenCalled();
      expect(provider.getForecast).not.toHaveBeenCalled();
      expect(provider.getAlerts).not.toHaveBeenCalled();
    } finally {
      await quietApp.close();
    }
  });
});
