import { Inject } from '@nestjs/common';
import { AppError } from '../../domain/errors.js';
import type {
  Location,
  LocationInput,
  LocationResolution,
  ResolvedLocationRef,
} from '../../domain/location.js';
import {
  CACHE_STORE,
  CLOCK,
  RESOLVED_LOCATION_LOOKUP,
  WEATHER_PROVIDER,
  type CacheStore,
  type Clock,
  type ResolvedLocationLookup,
  type WeatherProvider,
} from '../../domain/ports.js';
import { SingleFlight } from '../../infrastructure/cache/single-flight.js';
import {
  buildLocationSearchKey,
  normalizeQueryPreservingCase,
} from '../../infrastructure/cache/cache-keys.js';
import { loadCached } from '../cache-aside.js';

const DEFAULT_LIMIT = 5;
const MIN_LIMIT = 1;
const MAX_LIMIT = 10;
const POSITIVE_FRESH_TTL_SECONDS = 24 * 60 * 60;
const POSITIVE_STALE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const NEGATIVE_FRESH_TTL_SECONDS = 5 * 60;

export class LocationService {
  private readonly flight = new SingleFlight();

  constructor(
    @Inject(WEATHER_PROVIDER) private readonly provider: WeatherProvider,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RESOLVED_LOCATION_LOOKUP) private readonly lookup: ResolvedLocationLookup,
  ) {}

  async resolve(
    input: LocationInput,
    options?: { limit?: number },
    signal?: AbortSignal,
  ): Promise<LocationResolution> {
    if ('query' in input) {
      return this.resolveByQuery(input.query, options?.limit, signal);
    }
    if ('locationId' in input) {
      return this.resolveByRef({ locationId: input.locationId }, signal);
    }
    return this.resolveByRef({ coordinates: input.coordinates }, signal);
  }

  async requireResolved(input: LocationInput, signal?: AbortSignal): Promise<Location> {
    const resolution = await this.resolve(input, undefined, signal);
    if (resolution.status === 'resolved') {
      return resolution.location;
    }
    if (resolution.status === 'ambiguous') {
      throw new AppError('LOCATION_AMBIGUOUS', 'Multiple locations match the query.', {
        details: { candidates: resolution.candidates },
      });
    }
    throw new AppError('LOCATION_NOT_FOUND', 'No matching location found.');
  }

  private async resolveByRef(
    ref: ResolvedLocationRef,
    signal?: AbortSignal,
  ): Promise<LocationResolution> {
    const location = await this.lookup.lookup(ref, signal);
    return { status: 'resolved', location };
  }

  private async resolveByQuery(
    query: string,
    limit: number | undefined,
    signal?: AbortSignal,
  ): Promise<LocationResolution> {
    const candidateLimit = limit ?? DEFAULT_LIMIT;
    if (
      !Number.isInteger(candidateLimit) ||
      candidateLimit < MIN_LIMIT ||
      candidateLimit > MAX_LIMIT
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        `limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}.`,
      );
    }

    const key = buildLocationSearchKey(query, candidateLimit);
    const result = await loadCached<LocationResolution>({
      key,
      freshTtlSeconds: POSITIVE_FRESH_TTL_SECONDS,
      staleMaxAgeSeconds: POSITIVE_STALE_MAX_AGE_SECONDS,
      allowStale: true,
      cache: this.cache,
      clock: this.clock,
      flight: this.flight,
      signal,
      ttlFor: (resolution) =>
        resolution.status === 'not_found'
          ? { freshTtlSeconds: NEGATIVE_FRESH_TTL_SECONDS, staleMaxAgeSeconds: null }
          : {
              freshTtlSeconds: POSITIVE_FRESH_TTL_SECONDS,
              staleMaxAgeSeconds: POSITIVE_STALE_MAX_AGE_SECONDS,
            },
      loader: async (loaderSignal) => {
        const normalizedQuery = normalizeQueryPreservingCase(query);
        const matches = await this.provider.searchLocations(normalizedQuery, loaderSignal);
        const candidates = matches.slice(0, candidateLimit);
        if (candidates.length === 0) {
          return { status: 'not_found', candidates: [] };
        }
        if (candidates.length === 1) {
          const candidate = candidates[0];
          if (candidate === undefined) {
            return { status: 'not_found', candidates: [] };
          }
          if (candidate.timeZone !== null) {
            const location: Location = {
              locationId: candidate.locationId,
              name: candidate.name,
              region: candidate.region,
              country: candidate.country,
              latitude: candidate.latitude,
              longitude: candidate.longitude,
              timeZone: candidate.timeZone,
            };
            return { status: 'resolved', location };
          }
          const enriched = await this.lookup.lookup(
            { locationId: candidate.locationId },
            loaderSignal,
          );
          return { status: 'resolved', location: enriched };
        }
        return { status: 'ambiguous', candidates };
      },
    });
    return result.data;
  }
}
