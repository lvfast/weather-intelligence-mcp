import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  alertsResponseSchema,
  currentResponseSchema,
  forecastResponseSchema,
  searchResponseSchema,
} from './weatherapi.schemas.js';
import { mapAlerts, mapCurrent, mapForecast, mapSearch } from './weatherapi.mapper.js';

const searchFixture = searchResponseSchema.parse(
  JSON.parse(
    readFileSync(new URL('../../../test/fixtures/weatherapi/search.json', import.meta.url), 'utf8'),
  ),
);
const currentFixture = currentResponseSchema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../test/fixtures/weatherapi/current.json', import.meta.url),
      'utf8',
    ),
  ),
);
const forecastFixture = forecastResponseSchema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../test/fixtures/weatherapi/forecast.json', import.meta.url),
      'utf8',
    ),
  ),
);
const alertsFixture = alertsResponseSchema.parse(
  JSON.parse(
    readFileSync(new URL('../../../test/fixtures/weatherapi/alerts.json', import.meta.url), 'utf8'),
  ),
);

type AlertsPayload = Parameters<typeof mapAlerts>[0];

describe('weatherapi schemas', () => {
  it('rejects invalid numeric and shape values', () => {
    expect(() =>
      currentResponseSchema.parse({ location: {}, current: { temp_c: 'hot' } }),
    ).toThrow();
    expect(() =>
      currentResponseSchema.parse({
        location: {
          name: 'X',
          region: '',
          country: 'Y',
          lat: 1,
          lon: 2,
          tz_id: 'UTC',
          localtime_epoch: 0,
          localtime: 'x',
        },
        current: { temp_c: 10, humidity: 150 },
      }),
    ).toThrow();
    expect(() =>
      currentResponseSchema.parse({
        location: {
          name: 'X',
          region: '',
          country: 'Y',
          lat: 99,
          lon: 2,
          tz_id: 'UTC',
          localtime_epoch: 0,
          localtime: 'x',
        },
        current: { temp_c: 10, humidity: 50 },
      }),
    ).toThrow();
  });
});

describe('mapSearch', () => {
  it('maps provider search rows to normalized candidates', () => {
    const candidates = mapSearch(searchFixture);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      locationId: expect.any(String),
      name: expect.any(String),
      latitude: expect.any(Number),
    });
    expect(candidates[0]).toMatchObject({
      locationId: '2807',
      name: 'Paris',
      region: 'Ile-de-France',
      country: 'France',
      latitude: 48.86,
      longitude: 2.35,
      timeZone: null,
    });
  });

  it('normalizes empty regions to null', () => {
    const rows = [{ id: 1, name: 'Lonely', region: '', country: 'X', lat: 1, lon: 2, url: 'u' }];
    expect(mapSearch(rows)[0]?.region).toBeNull();
  });
});

describe('mapCurrent', () => {
  it('maps provider current conditions to the normalized model', () => {
    const current = mapCurrent(currentFixture);
    expect(current.interval.condition).toMatchObject({ category: 'rain', intensity: 'light' });
    expect(current.location).toMatchObject({
      name: 'Paris',
      country: 'France',
      timeZone: 'Europe/Paris',
    });
    expect(current.interval).toMatchObject({
      temperatureC: 21.0,
      feelsLikeC: 21.3,
      precipitationMm: 0.1,
      humidityPercent: 64,
      cloudCoverPercent: 75,
      windKph: 19.1,
      gustKph: 24.6,
      visibilityKm: 10.0,
      uvIndex: 5.0,
    });
  });

  it('emits ISO timestamps with the location offset', () => {
    const current = mapCurrent(currentFixture);
    expect(current.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+02:00$/);
    expect(current.interval.time).toBe(current.observedAt);
  });

  it('preserves provider condition text for display', () => {
    expect(mapCurrent(currentFixture).interval.condition.text).toBe('Light rain');
  });
});

describe('mapForecast', () => {
  it('maps every forecast day', () => {
    const forecast = mapForecast(forecastFixture);
    expect(forecast.days).toHaveLength(3);
    expect(forecast.days[0]).toMatchObject({
      date: '2026-09-23',
      summary: {
        maxTempC: 23.0,
        minTempC: 14.2,
        avgTempC: 18.6,
        totalPrecipitationMm: 1.2,
        maxWindKph: 24.1,
        precipitationChancePercent: 42,
        uvIndexMax: 5.0,
      },
    });
  });

  it('emits hourly intervals with localized ISO timestamps', () => {
    const forecast = mapForecast(forecastFixture);
    const hours = forecast.days[0]?.hours ?? [];
    expect(hours).toHaveLength(3);
    expect(hours[0]?.time).toMatch(/\+02:00$/);
    expect(hours[0]).toMatchObject({
      temperatureC: 15.4,
      precipitationChancePercent: 0,
      humidityPercent: 77,
      gustKph: 15.1,
    });
  });

  it('keeps the local calendar date verbatim', () => {
    const forecast = mapForecast(forecastFixture);
    expect(forecast.days.map((day) => day.date)).toEqual([
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
    ]);
  });
});

describe('mapAlerts', () => {
  it('maps provider alerts to normalized alerts', () => {
    const alerts = mapAlerts(alertsFixture);
    expect(alerts[0]).toMatchObject({ severity: 'Moderate' });
    expect(alerts[0]).toMatchObject({
      headline: 'Localized rainfall warning',
      event: 'Rain',
      areas: ['Paris', 'Versailles'],
      description: 'Moderate rainfall may affect the area.',
      instruction: 'Be careful on the roads.',
    });
  });

  it('normalizes unknown severities', () => {
    const payload = {
      location: {},
      alerts: {
        alert: [
          {
            headline: 'h',
            severity: 'Weird',
            event: 'e',
            effective: '2026-09-23T08:00:00+00:00',
            expires: '2026-09-23T20:00:00+00:00',
            desc: '',
            instruction: '',
            areas: '',
          },
        ],
      },
    } as AlertsPayload;
    expect(mapAlerts(payload)[0]?.severity).toBe('Unknown');
  });

  it('splits the areas string on semicolons', () => {
    const payload = {
      location: {},
      alerts: {
        alert: [
          {
            headline: 'h',
            severity: 'Minor',
            event: 'e',
            effective: '2026-09-23T08:00:00+00:00',
            expires: '2026-09-23T20:00:00+00:00',
            desc: '',
            instruction: '',
            areas: 'A;B;C',
          },
        ],
      },
    } as AlertsPayload;
    expect(mapAlerts(payload)[0]?.areas).toEqual(['A', 'B', 'C']);
  });
});
