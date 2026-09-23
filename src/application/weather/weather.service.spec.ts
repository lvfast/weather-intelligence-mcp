import { describe, expect, it, vi } from 'vitest';
import type { Location, LocationInput } from '../../domain/location.js';
import { AppError } from '../../domain/errors.js';
import {
  asCacheStore,
  asWeatherProvider,
  makeCache,
  makeClock,
  makeForecast,
  makeForecastDay,
  makeInterval,
  makeLocation,
  makeProvider,
} from '../../../test/helpers/fakes.js';
import { CachedLocationLookup } from '../location/location-lookup.js';
import type { LocationResolver } from './weather.service.js';
import { WeatherService } from './weather.service.js';

interface FakeLocationResolver {
  requireResolved: ReturnType<typeof vi.fn>;
}

function makeResolver(location: Location = makeLocation()): FakeLocationResolver {
  return {
    requireResolved: vi
      .fn<(input: LocationInput, signal?: AbortSignal) => Promise<Location>>()
      .mockResolvedValue(location),
  };
}

function buildService(
  overrides: { provider?: ReturnType<typeof makeProvider>; resolver?: FakeLocationResolver } = {},
) {
  const clock = makeClock();
  const provider = overrides.provider ?? makeProvider();
  const cache = makeCache(clock);
  const resolver = overrides.resolver ?? makeResolver();
  const lookup = new CachedLocationLookup(asWeatherProvider(provider), asCacheStore(cache), clock);
  const service = new WeatherService(
    resolver as unknown as LocationResolver,
    lookup,
    asWeatherProvider(provider),
    asCacheStore(cache),
    clock,
  );
  return { service, provider, cache, clock, resolver };
}

const INPUT: LocationInput = { query: 'Paris' };

describe('WeatherService.getCurrent', () => {
  it('returns fresh data with cache provenance on a miss', async () => {
    const { service, provider } = buildService();
    const result = await service.getCurrent(INPUT);
    expect(result.data.location.name).toBe('Paris');
    expect(result.meta).toMatchObject({ cached: false, stale: false, warnings: [] });
    expect(provider.getCurrent).toHaveBeenCalledTimes(1);
    expect(provider.getCurrent).toHaveBeenCalledWith(
      { coordinates: { lat: 48.8566, lon: 2.3522 } },
      undefined,
    );
  });

  it('serves a fresh cache hit for ten minutes without calling the provider', async () => {
    const { service, provider, clock } = buildService();
    await service.getCurrent(INPUT);
    clock.advanceMinutes(9);
    const result = await service.getCurrent(INPUT);
    expect(result.meta).toMatchObject({ cached: true, stale: false });
    expect(provider.getCurrent).toHaveBeenCalledTimes(1);
  });

  it('falls back to stale data up to thirty minutes only after a retryable failure', async () => {
    const { service, provider, clock } = buildService();
    await service.getCurrent(INPUT);
    clock.advanceMinutes(11);
    provider.getCurrent.mockRejectedValue(new AppError('UPSTREAM_UNAVAILABLE', 'down'));
    const result = await service.getCurrent(INPUT);
    expect(result.meta).toMatchObject({ cached: true, stale: true, warnings: ['STALE_DATA'] });
    expect(result.data.location.name).toBe('Paris');
  });

  it('rejects stale data after thirty minutes', async () => {
    const { service, provider, clock } = buildService();
    await service.getCurrent(INPUT);
    clock.advanceMinutes(31);
    provider.getCurrent.mockRejectedValue(new AppError('UPSTREAM_UNAVAILABLE', 'down'));
    await expect(service.getCurrent(INPUT)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });

  it('never falls back to stale data after a non-retryable failure', async () => {
    const { service, provider, clock } = buildService();
    await service.getCurrent(INPUT);
    clock.advanceMinutes(11);
    provider.getCurrent.mockRejectedValue(new AppError('UPSTREAM_UNAUTHORIZED', 'bad key'));
    await expect(service.getCurrent(INPUT)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAUTHORIZED',
    });
  });

  it('propagates location resolution errors without calling the provider', async () => {
    const resolver = makeResolver();
    resolver.requireResolved.mockRejectedValue(new AppError('LOCATION_AMBIGUOUS', 'multiple'));
    const { service, provider } = buildService({ resolver });
    await expect(service.getCurrent(INPUT)).rejects.toMatchObject({ code: 'LOCATION_AMBIGUOUS' });
    expect(provider.getCurrent).not.toHaveBeenCalled();
  });

  it('bypasses a failed cache read but honors the provider coordination result', async () => {
    const { service, provider, cache } = buildService();
    cache.get.mockRejectedValue(new AppError('CACHE_UNAVAILABLE', 'redis down'));
    const result = await service.getCurrent(INPUT);
    expect(result.meta).toMatchObject({ cached: false, stale: false });
    expect(provider.getCurrent).toHaveBeenCalledTimes(1);
  });

  it('propagates PROVIDER_BUDGET_UNAVAILABLE when coordination denies after a cache outage', async () => {
    const { service, provider, cache } = buildService();
    cache.get.mockRejectedValue(new AppError('CACHE_UNAVAILABLE', 'redis down'));
    provider.getCurrent.mockRejectedValue(
      new AppError('PROVIDER_BUDGET_UNAVAILABLE', 'emergency exhausted'),
    );
    await expect(service.getCurrent(INPUT)).rejects.toMatchObject({
      code: 'PROVIDER_BUDGET_UNAVAILABLE',
    });
    expect(provider.getCurrent).toHaveBeenCalledTimes(1);
  });
});

describe('WeatherService.getForecast', () => {
  it('rejects invalid day counts as validation errors', async () => {
    const { service } = buildService();
    await expect(
      service.getForecast(INPUT, { days: 0 as never, includeHourly: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.getForecast(INPUT, { days: 4 as never, includeHourly: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.getForecast(INPUT, { days: 2.5 as never, includeHourly: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('strips hourly intervals when includeHourly is false', async () => {
    const { service, provider } = buildService();
    provider.getForecast.mockResolvedValue(
      makeForecast({
        days: [makeForecastDay({ hours: Array.from({ length: 24 }, () => makeInterval()) })],
      }),
    );
    const result = await service.getForecast(INPUT, { days: 3, includeHourly: false });
    expect(result.data.days[0]).not.toHaveProperty('hours');
    expect(provider.getForecast).toHaveBeenCalledWith(
      { coordinates: { lat: 48.8566, lon: 2.3522 } },
      3,
      undefined,
    );
  });

  it('keeps twenty-four hourly intervals when includeHourly is true', async () => {
    const { service, provider } = buildService();
    provider.getForecast.mockResolvedValue(
      makeForecast({
        days: [makeForecastDay({ hours: Array.from({ length: 24 }, () => makeInterval()) })],
      }),
    );
    const result = await service.getForecast(INPUT, { days: 3, includeHourly: true });
    expect(result.data.days[0].hours).toHaveLength(24);
  });

  it('caches for sixty fresh minutes with a six-hour stale window', async () => {
    const { service, provider, clock } = buildService();
    await service.getForecast(INPUT, { days: 3, includeHourly: false });
    clock.advanceMinutes(59);
    await service.getForecast(INPUT, { days: 3, includeHourly: false });
    expect(provider.getForecast).toHaveBeenCalledTimes(1);
    clock.advanceMinutes(2);
    provider.getForecast.mockRejectedValue(new AppError('UPSTREAM_UNAVAILABLE', 'down'));
    const stale = await service.getForecast(INPUT, { days: 3, includeHourly: false });
    expect(stale.meta).toMatchObject({ cached: true, stale: true });
    clock.advanceHours(6);
    await expect(
      service.getForecast(INPUT, { days: 3, includeHourly: false }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });

  it('caches hourly and daily forecasts under distinct keys', async () => {
    const { service, provider } = buildService();
    await service.getForecast(INPUT, { days: 3, includeHourly: false });
    await service.getForecast(INPUT, { days: 3, includeHourly: true });
    expect(provider.getForecast).toHaveBeenCalledTimes(2);
  });
});

describe('WeatherService.getAlerts', () => {
  it('declares limited coverage even for an empty alert list', async () => {
    const { service, provider } = buildService();
    provider.getAlerts.mockResolvedValue([]);
    const result = await service.getAlerts(INPUT);
    expect(result.data).toMatchObject({ coverage: 'limited', alerts: [] });
    expect(result.meta).toMatchObject({ cached: false, stale: false });
  });

  it('caches alerts for five fresh minutes with no stale window', async () => {
    const { service, provider, clock } = buildService();
    await service.getAlerts(INPUT);
    clock.advanceMinutes(4);
    const cached = await service.getAlerts(INPUT);
    expect(cached.meta).toMatchObject({ cached: true, stale: false });
    expect(provider.getAlerts).toHaveBeenCalledTimes(1);
    clock.advanceMinutes(2);
    provider.getAlerts.mockRejectedValue(new AppError('UPSTREAM_UNAVAILABLE', 'down'));
    await expect(service.getAlerts(INPUT)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
