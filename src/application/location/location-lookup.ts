import type {
  CacheStore,
  Clock,
  CurrentWeatherByRef,
  ResolvedLocationLookup,
  ServiceResult,
  WeatherProvider,
} from '../../domain/ports.js';
import type { CurrentWeather } from '../../domain/weather.js';
import type { Location, ResolvedLocationRef } from '../../domain/location.js';
import { SingleFlight } from '../../infrastructure/cache/single-flight.js';
import {
  buildCurrentWeatherByIdKey,
  buildCurrentWeatherKey,
} from '../../infrastructure/cache/cache-keys.js';
import { loadCached } from '../cache-aside.js';

export const CURRENT_FRESH_TTL_SECONDS = 10 * 60;
export const CURRENT_STALE_MAX_AGE_SECONDS = 30 * 60;

export class CachedLocationLookup implements ResolvedLocationLookup, CurrentWeatherByRef {
  private readonly flight = new SingleFlight();

  constructor(
    private readonly provider: WeatherProvider,
    private readonly cache: CacheStore,
    private readonly clock: Clock,
  ) {}

  async lookup(ref: ResolvedLocationRef, signal?: AbortSignal): Promise<Location> {
    const current = await this.getCurrentByRef(ref, signal);
    return current.data.location;
  }

  async getCurrentByRef(
    ref: ResolvedLocationRef,
    signal?: AbortSignal,
  ): Promise<ServiceResult<CurrentWeather>> {
    const key =
      'locationId' in ref
        ? buildCurrentWeatherByIdKey(ref.locationId)
        : buildCurrentWeatherKey(ref.coordinates.lat, ref.coordinates.lon);
    return loadCached<CurrentWeather>({
      key,
      freshTtlSeconds: CURRENT_FRESH_TTL_SECONDS,
      staleMaxAgeSeconds: CURRENT_STALE_MAX_AGE_SECONDS,
      allowStale: true,
      cache: this.cache,
      clock: this.clock,
      flight: this.flight,
      signal,
      loader: (loaderSignal) => this.provider.getCurrent(ref, loaderSignal),
    });
  }
}
