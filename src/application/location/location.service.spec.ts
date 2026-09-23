import { describe, expect, it } from 'vitest';
import { AppError } from '../../domain/errors.js';
import {
  asCacheStore,
  asResolvedLocationLookup,
  asWeatherProvider,
  makeCache,
  makeCandidate,
  makeClock,
  makeLocation,
  makeLookup,
  makeProvider,
} from '../../../test/helpers/fakes.js';
import { LocationService } from './location.service.js';

function buildService(
  overrides: {
    provider?: ReturnType<typeof makeProvider>;
    lookup?: ReturnType<typeof makeLookup>;
  } = {},
) {
  const clock = makeClock();
  const provider = overrides.provider ?? makeProvider();
  const cache = makeCache(clock);
  const lookup = overrides.lookup ?? makeLookup();
  const service = new LocationService(
    asWeatherProvider(provider),
    asCacheStore(cache),
    clock,
    asResolvedLocationLookup(lookup),
  );
  return { service, provider, cache, clock, lookup };
}

describe('LocationService.resolve', () => {
  it('resolves a unique query', async () => {
    const { service, provider } = buildService();
    provider.searchLocations.mockResolvedValue([makeCandidate({ name: 'Paris' })]);
    await expect(service.resolve({ query: 'Paris' })).resolves.toMatchObject({
      status: 'resolved',
    });
  });

  it('returns ambiguity for multiple matches without auto-selecting', async () => {
    const { service, provider } = buildService();
    provider.searchLocations.mockResolvedValue([
      makeCandidate({ locationId: '1', name: 'Springfield' }),
      makeCandidate({ locationId: '2', name: 'Springfield' }),
    ]);
    await expect(service.resolve({ query: 'Springfield' })).resolves.toMatchObject({
      status: 'ambiguous',
      candidates: expect.any(Array),
    });
  });

  it('returns not_found for zero matches', async () => {
    const { service, provider } = buildService();
    provider.searchLocations.mockResolvedValue([]);
    await expect(service.resolve({ query: 'missing' })).resolves.toEqual({
      status: 'not_found',
      candidates: [],
    });
  });

  it('resolves by opaque location id through the lookup port', async () => {
    const lookup = makeLookup();
    lookup.lookup.mockResolvedValue(makeLocation({ locationId: '10,106', name: 'Saigon' }));
    const { service, provider } = buildService({ lookup });
    await expect(service.resolve({ locationId: 'opaque-1' })).resolves.toMatchObject({
      status: 'resolved',
    });
    expect(lookup.lookup).toHaveBeenCalledWith({ locationId: 'opaque-1' }, undefined);
    expect(provider.searchLocations).not.toHaveBeenCalled();
  });

  it('resolves coordinates through the lookup port', async () => {
    const { service, provider } = buildService();
    await expect(
      service.resolve({ coordinates: { lat: 10.7769, lon: 106.7009 } }),
    ).resolves.toMatchObject({ status: 'resolved' });
    expect(provider.searchLocations).not.toHaveBeenCalled();
  });

  it('enriches a timezone-less unique candidate through the lookup port', async () => {
    const { service, provider, lookup } = buildService();
    provider.searchLocations.mockResolvedValue([makeCandidate({ timeZone: null })]);
    lookup.lookup.mockResolvedValue(makeLocation({ timeZone: 'Europe/Paris' }));
    const result = await service.resolve({ query: 'Paris' });
    expect(result).toMatchObject({ status: 'resolved' });
    if (result.status === 'resolved') {
      expect(result.location.timeZone).toBe('Europe/Paris');
    }
    expect(lookup.lookup).toHaveBeenCalledTimes(1);
  });

  it('does not enrich when the candidate already carries a timezone', async () => {
    const { service, provider, lookup } = buildService();
    provider.searchLocations.mockResolvedValue([makeCandidate({ timeZone: 'Europe/Paris' })]);
    await service.resolve({ query: 'Paris' });
    expect(lookup.lookup).not.toHaveBeenCalled();
  });

  it('does not call the provider again for an identical normalized query', async () => {
    const { service, provider } = buildService();
    provider.searchLocations.mockResolvedValue([makeCandidate({ name: 'Hanoi' })]);
    await service.resolve({ query: '  HÀ   NỘI ' });
    await service.resolve({ query: 'hà nội' });
    expect(provider.searchLocations).toHaveBeenCalledTimes(1);
  });

  it('coalesces twenty concurrent resolutions into one provider call', async () => {
    const { service, provider } = buildService();
    provider.searchLocations.mockResolvedValue([makeCandidate({ name: 'Paris' })]);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => service.resolve({ query: 'Paris' })),
    );
    expect(provider.searchLocations).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.status === 'resolved')).toBe(true);
  });

  it('defaults the candidate limit to five and bounds it from one through ten', async () => {
    const { service, provider } = buildService();
    provider.searchLocations.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => makeCandidate({ locationId: String(index) })),
    );
    const resolution = await service.resolve({ query: 'Springfield' });
    expect(resolution.status).toBe('ambiguous');
    if (resolution.status === 'ambiguous') {
      expect(resolution.candidates).toHaveLength(5);
    }
    await expect(service.resolve({ query: 'X' }, { limit: 0 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(service.resolve({ query: 'X' }, { limit: 11 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('caches positive results for 24 fresh hours and 7 stale days', async () => {
    const { service, provider, clock } = buildService();
    provider.searchLocations.mockResolvedValue([makeCandidate({ name: 'Paris' })]);
    await service.resolve({ query: 'Paris' });
    clock.advanceHours(23);
    await service.resolve({ query: 'Paris' });
    expect(provider.searchLocations).toHaveBeenCalledTimes(1);

    clock.advanceHours(2);
    provider.searchLocations.mockRejectedValue(new AppError('UPSTREAM_UNAVAILABLE', 'down'));
    await expect(service.resolve({ query: 'Paris' })).resolves.toMatchObject({
      status: 'resolved',
    });

    clock.advanceHours(24 * 7);
    await expect(service.resolve({ query: 'Paris' })).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('caches negative results for five minutes with no stale window', async () => {
    const { service, provider, clock } = buildService();
    provider.searchLocations.mockResolvedValue([]);
    await service.resolve({ query: 'missing' });
    clock.advanceMinutes(4);
    await service.resolve({ query: 'missing' });
    expect(provider.searchLocations).toHaveBeenCalledTimes(1);
    clock.advanceMinutes(2);
    await service.resolve({ query: 'missing' });
    expect(provider.searchLocations).toHaveBeenCalledTimes(2);
  });

  it('sends the normalized-but-case-preserving query upstream', async () => {
    const { service, provider } = buildService();
    provider.searchLocations.mockResolvedValue([makeCandidate({ timeZone: 'Asia/Ho_Chi_Minh' })]);
    await service.resolve({ query: '  Hà   Nội ' });
    expect(provider.searchLocations).toHaveBeenCalledWith('Hà Nội', undefined);
  });
});

describe('LocationService.requireResolved', () => {
  it('returns the sole resolved location', async () => {
    const { service, provider } = buildService();
    provider.searchLocations.mockResolvedValue([
      makeCandidate({ name: 'Paris', timeZone: 'Europe/Paris' }),
    ]);
    const location = await service.requireResolved({ query: 'Paris' });
    expect(location.name).toBe('Paris');
  });

  it('throws LOCATION_AMBIGUOUS with safe candidates', async () => {
    const { service, provider } = buildService();
    provider.searchLocations.mockResolvedValue([
      makeCandidate({ locationId: '1' }),
      makeCandidate({ locationId: '2' }),
    ]);
    const error = await service.requireResolved({ query: 'X' }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'LOCATION_AMBIGUOUS' });
    if (error instanceof AppError) {
      const details = error.details as { candidates?: unknown[] } | undefined;
      expect(details?.candidates).toHaveLength(2);
    }
  });

  it('throws LOCATION_NOT_FOUND for zero matches', async () => {
    const { service, provider } = buildService();
    provider.searchLocations.mockResolvedValue([]);
    await expect(service.requireResolved({ query: 'missing' })).rejects.toMatchObject({
      code: 'LOCATION_NOT_FOUND',
    });
  });
});
