import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { z } from 'zod';
import {
  currentWeatherSchema,
  errorEnvelopeSchema,
  forecastSchema,
  locationResolutionRequiredSchema,
  locationResolutionSchema,
  resultMetaSchema,
  serviceResultSchema,
  weatherAlertsResultSchema,
  weatherAssessmentSchema,
} from '../../src/interfaces/common/schemas.js';
import { createHttpTestApp, type HttpTestApp } from '../helpers/http-app.js';
import {
  makeCache,
  makeCandidate,
  makeClock,
  makeForecast,
  makeForecastDay,
  makeInterval,
} from '../helpers/fakes.js';

let harness: HttpTestApp;
let app: INestApplication;

beforeAll(async () => {
  const clock = makeClock();
  const cache = makeCache(clock);
  harness = await createHttpTestApp({ overrides: { clock, cache } });
  app = harness.app;
  harness.provider.searchLocations.mockResolvedValue([
    makeCandidate({ locationId: '2807', timeZone: 'Europe/Paris' }),
  ]);
  harness.provider.getForecast.mockResolvedValue(
    makeForecast({
      days: [
        makeForecastDay({
          date: '2026-09-23',
          hours: [makeInterval({ time: '2026-09-23T11:00:00.000Z' })],
        }),
      ],
    }),
  );
  harness.provider.getAlerts.mockResolvedValue([]);
});

afterAll(async () => {
  await app.close();
});

describe('shared output schemas', () => {
  it('validates resolve_location payloads for all three statuses', () => {
    expect(
      locationResolutionSchema.safeParse({ status: 'not_found', candidates: [] }).success,
    ).toBe(true);
    expect(
      locationResolutionSchema.safeParse({ status: 'ambiguous', candidates: [makeCandidate()] })
        .success,
    ).toBe(true);
  });

  it('rejects drifted resolution payloads', () => {
    expect(locationResolutionSchema.safeParse({ status: 'resolved' }).success).toBe(false);
    expect(
      locationResolutionSchema.safeParse({ status: 'not_found', candidates: [makeCandidate()] })
        .success,
    ).toBe(false);
  });

  it('accepts both success envelopes and workflow results as tool outputs', () => {
    const toolOutput = z.union([
      serviceResultSchema(currentWeatherSchema),
      locationResolutionRequiredSchema,
    ]);
    expect(
      toolOutput.safeParse({
        status: 'location_resolution_required',
        candidates: [makeCandidate()],
      }).success,
    ).toBe(true);
  });

  it('requires provider and cache provenance on every meta envelope', () => {
    const parsed = resultMetaSchema.safeParse({
      requestId: 'r',
      provider: 'weatherapi',
      fetchedAt: '2026-09-23T10:00:00.000Z',
      cached: false,
      stale: false,
      warnings: [],
    });
    expect(parsed.success).toBe(true);
    expect(resultMetaSchema.safeParse({ requestId: 'r' }).success).toBe(false);
  });
});

describe('REST responses validate against the shared output schemas', () => {
  it('validates the resolve response', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/locations/resolve')
      .query({ q: 'Paris' })
      .expect(200);
    expect(locationResolutionSchema.safeParse(response.body.data).success).toBe(true);
  });

  it('validates the current-weather response', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/weather/current')
      .query({ q: 'Paris' })
      .expect(200);
    expect(serviceResultSchema(currentWeatherSchema).safeParse(response.body).success).toBe(true);
  });

  it('validates the forecast response with and without hourly data', async () => {
    for (const includeHourly of [false, true]) {
      harness.cache?.entries.clear();
      const response = await request(app.getHttpServer())
        .get('/api/v1/weather/forecast')
        .query({ q: 'Paris', days: 3, includeHourly })
        .expect(200);
      expect(serviceResultSchema(forecastSchema).safeParse(response.body).success).toBe(true);
    }
  });

  it('validates the alerts response with limited coverage', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/weather/alerts')
      .query({ q: 'Paris' })
      .expect(200);
    expect(serviceResultSchema(weatherAlertsResultSchema).safeParse(response.body).success).toBe(
      true,
    );
    expect(response.body.data.coverage).toBe('limited');
  });

  it('validates the assessment response', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/weather/assessments')
      .send({ location: { query: 'Paris' }, activity: 'running' })
      .expect(201);
    expect(serviceResultSchema(weatherAssessmentSchema).safeParse(response.body).success).toBe(
      true,
    );
  });

  it('validates the error envelope shape', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/weather/current')
      .query({ q: 'Paris', locationId: '1' })
      .expect(400);
    expect(errorEnvelopeSchema.safeParse(response.body).success).toBe(true);
  });
});
