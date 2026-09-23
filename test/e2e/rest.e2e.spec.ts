import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AppError } from '../../src/domain/errors.js';
import { createHttpTestApp } from '../helpers/http-app.js';
import {
  makeAssessmentService,
  makeLocationService,
  makeWeatherService,
} from '../helpers/fakes.js';

let app: INestApplication;
let locationService: ReturnType<typeof makeLocationService>;
let weatherService: ReturnType<typeof makeWeatherService>;
let assessmentService: ReturnType<typeof makeAssessmentService>;

beforeAll(async () => {
  locationService = makeLocationService();
  weatherService = makeWeatherService();
  assessmentService = makeAssessmentService();
  const created = await createHttpTestApp({
    overrides: { locationService, weatherService, assessmentService },
  });
  app = created.app;
});

afterAll(async () => {
  await app.close();
});

describe('REST happy paths', () => {
  it('resolves a location through GET /api/v1/locations/resolve', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/locations/resolve')
      .query({ q: 'Paris' })
      .expect(200);
    expect(response.body.data).toMatchObject({ status: 'resolved' });
    expect(response.body.meta).toMatchObject({ provider: 'weatherapi', cached: false });
    expect(response.body.meta.requestId).toBeTruthy();
    expect(response.headers['x-request-id']).toBe(response.body.meta.requestId);
    expect(locationService.resolve).toHaveBeenCalledWith(
      { query: 'Paris' },
      { limit: 5 },
      expect.anything(),
    );
  });

  it('returns current weather through GET /api/v1/weather/current', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/weather/current')
      .query({ locationId: 'opaque-1' })
      .expect(200);
    expect(weatherService.getCurrent).toHaveBeenCalledWith(
      { locationId: 'opaque-1' },
      expect.anything(),
    );
  });

  it('returns a forecast through GET /api/v1/weather/forecast', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/weather/forecast')
      .query({ lat: 10.7, lon: 106.7, days: 3, includeHourly: true })
      .expect(200);
    expect(weatherService.getForecast).toHaveBeenCalledWith(
      { coordinates: { lat: 10.7, lon: 106.7 } },
      { days: 3, includeHourly: true },
      expect.anything(),
    );
  });

  it('returns alerts through GET /api/v1/weather/alerts', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/weather/alerts')
      .query({ q: 'Paris' })
      .expect(200);
    expect(response.body.data).toMatchObject({ coverage: 'limited' });
  });

  it('assesses conditions through POST /api/v1/weather/assessments', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/weather/assessments')
      .send({
        location: { query: 'Paris' },
        activity: 'running',
        startTime: '2026-09-24T06:00:00+02:00',
        endTime: '2026-09-24T08:00:00+02:00',
      })
      .expect(201);
    expect(response.body.data).toMatchObject({ activity: 'running' });
    expect(assessmentService.assess).toHaveBeenCalledTimes(1);
  });

  it('does not reimplement application calculations in controllers', async () => {
    await request(app.getHttpServer()).get('/api/v1/weather/current').query({ q: 'Paris' });
    await request(app.getHttpServer()).get('/api/v1/weather/current').query({ q: 'Paris' });
    expect(weatherService.getCurrent).toHaveBeenCalledTimes(2);
  });
});

describe('REST validation', () => {
  it('rejects unknown query fields', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/locations/resolve')
      .query({ q: 'Paris', extra: 'nope' })
      .expect(400);
  });

  it('rejects missing or multiple location forms', async () => {
    await request(app.getHttpServer()).get('/api/v1/weather/current').expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/weather/current')
      .query({ q: 'Paris', locationId: '1' })
      .expect(400);
  });

  it('rejects partial coordinates', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/weather/current')
      .query({ lat: 10.7 })
      .expect(400);
  });

  it('rejects invalid limit, days, and activity values', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/locations/resolve')
      .query({ q: 'Paris', limit: 0 })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/weather/forecast')
      .query({ q: 'Paris', days: 4 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/weather/assessments')
      .send({ location: { query: 'Paris' }, activity: 'swimming' })
      .expect(400);
  });

  it('rejects assessment bodies with unknown fields', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/weather/assessments')
      .send({ location: { query: 'Paris' }, activity: 'running', secret: true })
      .expect(400);
  });

  it('rejects bodies larger than 64 KiB', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/weather/assessments')
      .send({ location: { query: 'Paris' }, activity: 'running', pad: 'x'.repeat(70_000) })
      .expect(413);
  });
});

describe('REST error mapping', () => {
  it.each([
    ['VALIDATION_ERROR', 400],
    ['LOCATION_NOT_FOUND', 404],
    ['FORECAST_WINDOW_UNAVAILABLE', 422],
    ['RATE_LIMITED', 429],
    ['UPSTREAM_UNAUTHORIZED', 502],
    ['UPSTREAM_QUOTA_EXCEEDED', 503],
    ['UPSTREAM_PLAN_RESTRICTED', 502],
    ['UPSTREAM_TIMEOUT', 504],
    ['UPSTREAM_UNAVAILABLE', 503],
    ['PROVIDER_BUDGET_EXHAUSTED', 503],
    ['PROVIDER_BUDGET_UNAVAILABLE', 503],
    ['CACHE_UNAVAILABLE', 503],
    ['INTERNAL_ERROR', 500],
  ])('maps %s to HTTP %s', async (code, status) => {
    const failingWeather = makeWeatherService();
    failingWeather.getCurrent.mockRejectedValue(new AppError(code as never, 'safe message'));
    const { app: failingApp } = await createHttpTestApp({
      overrides: { weatherService: failingWeather },
    });
    try {
      const response = await request(failingApp.getHttpServer())
        .get('/api/v1/weather/current')
        .query({ q: 'Paris' })
        .expect(status);
      expect(response.body.error).toMatchObject({ code, message: 'safe message' });
    } finally {
      await failingApp.close();
    }
  });

  it('maps ambiguity to 409 with safe candidates', async () => {
    const failingWeather = makeWeatherService();
    failingWeather.getCurrent.mockRejectedValue(
      new AppError('LOCATION_AMBIGUOUS', 'Multiple locations match the query.', {
        details: { candidates: [{ locationId: '1' }, { locationId: '2' }] },
      }),
    );
    const { app: failingApp } = await createHttpTestApp({
      overrides: { weatherService: failingWeather },
    });
    try {
      const response = await request(failingApp.getHttpServer())
        .get('/api/v1/weather/current')
        .query({ q: 'Springfield' })
        .expect(409);
      expect(response.body.error.details.candidates).toHaveLength(2);
    } finally {
      await failingApp.close();
    }
  });

  it('maps cancellation to 499', async () => {
    const failingWeather = makeWeatherService();
    failingWeather.getCurrent.mockRejectedValue(new AppError('REQUEST_CANCELLED', 'cancelled'));
    const { app: failingApp } = await createHttpTestApp({
      overrides: { weatherService: failingWeather },
    });
    try {
      await request(failingApp.getHttpServer())
        .get('/api/v1/weather/current')
        .query({ q: 'Paris' })
        .expect(499);
    } finally {
      await failingApp.close();
    }
  });

  it('never exposes secrets, upstream payloads, or internal causes', async () => {
    const failingWeather = makeWeatherService();
    failingWeather.getCurrent.mockRejectedValue(
      new AppError('UPSTREAM_UNAVAILABLE', 'safe upstream message', {
        details: { raw: 'weather-api-secret-123', query: 'key=weather-api-secret-123' },
        cause: new Error('INTERNAL_STACK_MARKER'),
      }),
    );
    const { app: failingApp } = await createHttpTestApp({
      overrides: { weatherService: failingWeather },
    });
    try {
      const response = await request(failingApp.getHttpServer())
        .get('/api/v1/weather/current')
        .query({ q: 'Paris' })
        .expect(503);
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('weather-api-secret');
      expect(body).not.toContain('INTERNAL_STACK_MARKER');
    } finally {
      await failingApp.close();
    }
  });

  it('replaces unexpected errors with a generic INTERNAL_ERROR', async () => {
    const failingWeather = makeWeatherService();
    failingWeather.getCurrent.mockRejectedValue(new Error('CLASS_NAME_AND_STACK'));
    const { app: failingApp } = await createHttpTestApp({
      overrides: { weatherService: failingWeather },
    });
    try {
      const response = await request(failingApp.getHttpServer())
        .get('/api/v1/weather/current')
        .query({ q: 'Paris' })
        .expect(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(response.body)).not.toContain('CLASS_NAME_AND_STACK');
    } finally {
      await failingApp.close();
    }
  });
});
