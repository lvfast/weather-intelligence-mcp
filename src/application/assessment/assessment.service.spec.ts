import { describe, expect, it, vi } from 'vitest';
import type { Location, LocationInput } from '../../domain/location.js';
import type { AssessWeatherInput } from '../../domain/assessment.js';
import { AppError } from '../../domain/errors.js';
import type { ServiceResult } from '../../domain/ports.js';
import type { WeatherForecast } from '../../domain/weather.js';
import {
  makeAlertsResult,
  makeClock,
  makeCurrent,
  makeForecast,
  makeForecastDay,
  makeInterval,
  makeLocation,
} from '../../../test/helpers/fakes.js';
import { AssessmentService } from './assessment.service.js';

const NOW_ISO = '2026-09-23T10:00:00.000Z';
const LOCATION = makeLocation({ timeZone: 'UTC', latitude: 10, longitude: 20 });

interface FakeWeatherPort {
  getCurrent: ReturnType<typeof vi.fn>;
  getForecast: ReturnType<typeof vi.fn>;
  getAlerts: ReturnType<typeof vi.fn>;
}

function weatherResult<T>(
  data: T,
  overrides: Partial<ServiceResult<T>['meta']> = {},
): ServiceResult<T> {
  return {
    data,
    meta: {
      requestId: 'req-1',
      provider: 'weatherapi',
      fetchedAt: '2026-09-23T10:00:00.000Z',
      cached: false,
      stale: false,
      warnings: [],
      ...overrides,
    },
  };
}

function forecastWithHours(
  hours: string[],
  generatedAt = '2026-09-23T09:00:00.000Z',
): WeatherForecast {
  return makeForecast({
    location: LOCATION,
    generatedAt,
    days: hours.map((iso, index) =>
      makeForecastDay({
        date: `2026-09-${23 + index}`,
        hours: [makeInterval({ time: iso })],
      }),
    ),
  });
}

function makeWeather(overrides: Partial<FakeWeatherPort> = {}): FakeWeatherPort {
  return {
    getCurrent: vi.fn().mockResolvedValue(weatherResult(makeCurrent())),
    getForecast: vi
      .fn()
      .mockResolvedValue(weatherResult(forecastWithHours(['2026-09-23T11:00:00.000Z']))),
    getAlerts: vi.fn().mockResolvedValue(weatherResult(makeAlertsResult())),
    ...overrides,
  };
}

function makeResolver(location: Location = LOCATION): {
  requireResolved: ReturnType<typeof vi.fn>;
} {
  return {
    requireResolved: vi
      .fn<(input: LocationInput, signal?: AbortSignal) => Promise<Location>>()
      .mockResolvedValue(location),
  };
}

function buildService(
  overrides: { weather?: FakeWeatherPort; resolver?: ReturnType<typeof makeResolver> } = {},
) {
  const clock = makeClock(NOW_ISO);
  const weather = overrides.weather ?? makeWeather();
  const resolver = overrides.resolver ?? makeResolver();
  const service = new AssessmentService(resolver as never, weather as never, clock);
  return { service, weather, clock, resolver };
}

const INPUT: AssessWeatherInput = { location: { query: 'Paris' }, activity: 'running' };

describe('AssessmentService.assess', () => {
  it('resolves once and stops on ambiguity before any weather call', async () => {
    const resolver = makeResolver();
    resolver.requireResolved.mockRejectedValue(new AppError('LOCATION_AMBIGUOUS', 'multiple'));
    const weather = makeWeather();
    const { service } = buildService({ weather, resolver });
    await expect(service.assess(INPUT)).rejects.toMatchObject({ code: 'LOCATION_AMBIGUOUS' });
    expect(weather.getCurrent).not.toHaveBeenCalled();
    expect(weather.getForecast).not.toHaveBeenCalled();
    expect(weather.getAlerts).not.toHaveBeenCalled();
  });

  it('uses current plus forecast hours for the implicit window and always requests alerts', async () => {
    const weather = makeWeather();
    weather.getCurrent.mockResolvedValue(
      weatherResult(makeCurrent({ observedAt: '2026-09-23T10:05:00.000Z', location: LOCATION })),
    );
    weather.getForecast.mockResolvedValue(
      weatherResult(forecastWithHours(['2026-09-23T11:00:00.000Z'], '2026-09-23T09:00:00.000Z')),
    );
    const { service } = buildService({ weather });
    const result = await service.assess(INPUT);
    expect(weather.getCurrent).toHaveBeenCalledTimes(1);
    expect(weather.getForecast).toHaveBeenCalledWith(
      INPUT.location,
      { days: 1, includeHourly: true },
      undefined,
    );
    expect(weather.getAlerts).toHaveBeenCalledTimes(1);
    expect(result.data.evidence.map((entry) => entry.source)).toEqual(['current', 'forecast']);
    expect(result.data.window).toEqual({
      startTime: '2026-09-23T10:00:00.000Z',
      endTime: '2026-09-23T12:00:00.000Z',
      timeZone: 'UTC',
    });
    expect(result.data.source.coverage).toBe('forecast-and-limited-alerts');
  });

  it('uses forecast hours only for an explicit future window', async () => {
    const weather = makeWeather();
    weather.getForecast.mockResolvedValue(
      weatherResult(forecastWithHours(['2026-09-23T11:00:00.000Z', '2026-09-23T12:00:00.000Z'])),
    );
    const { service } = buildService({ weather });
    const result = await service.assess({
      ...INPUT,
      startTime: '2026-09-23T11:00:00Z',
      endTime: '2026-09-23T13:00:00Z',
    });
    expect(weather.getCurrent).not.toHaveBeenCalled();
    expect(result.data.evidence).toHaveLength(2);
    expect(result.data.evidence.every((entry) => entry.source === 'forecast')).toBe(true);
  });

  it('requests only the forecast days needed by location-local dates', async () => {
    const weather = makeWeather();
    weather.getForecast.mockResolvedValue(
      weatherResult(
        makeForecast({
          location: LOCATION,
          days: [
            makeForecastDay({
              date: '2026-09-24',
              hours: [makeInterval({ time: '2026-09-24T10:00:00.000Z' })],
            }),
          ],
        }),
      ),
    );
    const { service } = buildService({ weather });
    await service.assess({
      ...INPUT,
      startTime: '2026-09-24T10:00:00Z',
      endTime: '2026-09-24T11:00:00Z',
    });
    expect(weather.getForecast).toHaveBeenCalledWith(
      INPUT.location,
      { days: 2, includeHourly: true },
      undefined,
    );
  });

  it('carries limited-alert coverage into source', async () => {
    const weather = makeWeather();
    weather.getAlerts.mockResolvedValue(weatherResult(makeAlertsResult({ alerts: [] })));
    const { service } = buildService({ weather });
    const result = await service.assess(INPUT);
    expect(result.data.source.coverage).toBe('forecast-and-limited-alerts');
    expect(result.data.source.cached).toBe(false);
    expect(result.data.source.stale).toBe(false);
  });

  it('chooses the newest used data timestamp for observedAt', async () => {
    const weather = makeWeather();
    weather.getCurrent.mockResolvedValue(
      weatherResult(makeCurrent({ observedAt: '2026-09-23T10:05:00.000Z', location: LOCATION })),
    );
    weather.getForecast.mockResolvedValue(
      weatherResult(forecastWithHours(['2026-09-23T11:00:00.000Z'], '2026-09-23T09:00:00.000Z')),
    );
    const { service } = buildService({ weather });
    const result = await service.assess(INPUT);
    expect(result.data.observedAt).toBe('2026-09-23T10:05:00.000Z');
  });

  it('floors stale-input results to moderate with degraded data quality', async () => {
    const weather = makeWeather();
    weather.getCurrent.mockResolvedValue(
      weatherResult(makeCurrent({ location: LOCATION }), { stale: true }),
    );
    const { service } = buildService({ weather });
    const result = await service.assess(INPUT);
    expect(result.data.dataQuality).toBe('degraded');
    expect(result.data.riskScore).toBeGreaterThanOrEqual(20);
    expect(result.data.recommendation).not.toBe('go');
    expect(result.meta.warnings).toContain('STALE_DATA');
  });

  it('produces the required assessment contract', async () => {
    const { service } = buildService();
    const result = await service.assess(INPUT);
    expect(result.data).toMatchObject({
      activity: 'running',
      location: expect.objectContaining({ name: 'Paris' }),
      riskLevel: expect.any(String),
      recommendation: expect.any(String),
      ruleVersion: 'weather-activity-rules/1.0.0',
      source: { provider: 'weatherapi', coverage: 'forecast-and-limited-alerts' },
      dataQuality: 'normal',
    });
    expect(result.data.triggeredRules).toBeInstanceOf(Array);
    expect(result.data.mitigations).toBeInstanceOf(Array);
    expect(typeof result.data.summary).toBe('string');
    expect(typeof result.data.observedAt).toBe('string');
  });

  it('rejects windows that cannot be fully covered by returned hourly data', async () => {
    const weather = makeWeather();
    weather.getForecast.mockResolvedValue(
      weatherResult(forecastWithHours(['2026-09-23T12:00:00.000Z'])),
    );
    const { service } = buildService({ weather });
    await expect(
      service.assess({
        ...INPUT,
        startTime: '2026-09-23T10:00:00Z',
        endTime: '2026-09-23T13:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'FORECAST_WINDOW_UNAVAILABLE' });
  });

  it('rejects windows entirely in the past', async () => {
    const { service } = buildService();
    await expect(
      service.assess({
        ...INPUT,
        startTime: '2026-09-23T08:00:00Z',
        endTime: '2026-09-23T09:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'FORECAST_WINDOW_UNAVAILABLE' });
  });

  it('rejects windows beyond the three-day forecast horizon', async () => {
    const { service } = buildService();
    await expect(
      service.assess({
        ...INPUT,
        startTime: '2026-09-26T10:00:00Z',
        endTime: '2026-09-26T12:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'FORECAST_WINDOW_UNAVAILABLE' });
  });

  it('rejects offset-less, unpaired, inverted, and over-long windows', async () => {
    const { service } = buildService();
    await expect(
      service.assess({
        ...INPUT,
        startTime: '2026-09-23T10:00:00',
        endTime: '2026-09-23T12:00:00',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.assess({ ...INPUT, startTime: '2026-09-23T10:00:00Z' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.assess({
        ...INPUT,
        startTime: '2026-09-23T12:00:00Z',
        endTime: '2026-09-23T10:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.assess({
        ...INPUT,
        startTime: '2026-09-23T10:00:00Z',
        endTime: '2026-09-26T11:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects unknown activities', async () => {
    const { service } = buildService();
    await expect(service.assess({ ...INPUT, activity: 'skiing' as never })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
