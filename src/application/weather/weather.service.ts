import { Inject } from '@nestjs/common';
import { AppError } from '../../domain/errors.js';
import type { Location, LocationInput } from '../../domain/location.js';
import type {
  CurrentWeather,
  WeatherAlert,
  WeatherAlertsResult,
  WeatherForecast,
} from '../../domain/weather.js';
import {
  CACHE_STORE,
  CLOCK,
  CURRENT_WEATHER_BY_REF,
  LOCATION_SERVICE,
  WEATHER_PROVIDER,
  type CacheStore,
  type Clock,
  type CurrentWeatherByRef,
  type ServiceResult,
  type WeatherProvider,
} from '../../domain/ports.js';
import { SingleFlight } from '../../infrastructure/cache/single-flight.js';
import { buildAlertsKey, buildForecastKey } from '../../infrastructure/cache/cache-keys.js';
import { loadCached } from '../cache-aside.js';

export interface LocationResolver {
  requireResolved(input: LocationInput, signal?: AbortSignal): Promise<Location>;
}

export interface ForecastOptions {
  days: 1 | 2 | 3;
  includeHourly: boolean;
}

const FORECAST_FRESH_TTL_SECONDS = 60 * 60;
const FORECAST_STALE_MAX_AGE_SECONDS = 6 * 60 * 60;
const ALERTS_FRESH_TTL_SECONDS = 5 * 60;

export class WeatherService {
  private readonly flight = new SingleFlight();

  constructor(
    @Inject(LOCATION_SERVICE) private readonly locations: LocationResolver,
    @Inject(CURRENT_WEATHER_BY_REF) private readonly currentByRef: CurrentWeatherByRef,
    @Inject(WEATHER_PROVIDER) private readonly provider: WeatherProvider,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getCurrent(
    input: LocationInput,
    signal?: AbortSignal,
  ): Promise<ServiceResult<CurrentWeather>> {
    const location = await this.locations.requireResolved(input, signal);
    return this.currentByRef.getCurrentByRef(
      { coordinates: { lat: location.latitude, lon: location.longitude } },
      signal,
    );
  }

  async getForecast(
    input: LocationInput,
    options: ForecastOptions,
    signal?: AbortSignal,
  ): Promise<ServiceResult<WeatherForecast>> {
    if (!Number.isInteger(options.days) || options.days < 1 || options.days > 3) {
      throw new AppError('VALIDATION_ERROR', 'days must be an integer between 1 and 3.');
    }
    const location = await this.locations.requireResolved(input, signal);
    const key = buildForecastKey(
      { latitude: location.latitude, longitude: location.longitude },
      { days: options.days, includeHourly: options.includeHourly },
    );
    return loadCached<WeatherForecast>({
      key,
      freshTtlSeconds: FORECAST_FRESH_TTL_SECONDS,
      staleMaxAgeSeconds: FORECAST_STALE_MAX_AGE_SECONDS,
      allowStale: true,
      cache: this.cache,
      clock: this.clock,
      flight: this.flight,
      signal,
      loader: async (loaderSignal) => {
        const forecast = await this.provider.getForecast(
          { coordinates: { lat: location.latitude, lon: location.longitude } },
          options.days,
          loaderSignal,
        );
        if (options.includeHourly) {
          return forecast;
        }
        return {
          ...forecast,
          days: forecast.days.map((day) => {
            const { hours: _hours, ...rest } = day;
            return rest;
          }),
        };
      },
    });
  }

  async getAlerts(
    input: LocationInput,
    signal?: AbortSignal,
  ): Promise<ServiceResult<WeatherAlertsResult>> {
    const location = await this.locations.requireResolved(input, signal);
    const key = buildAlertsKey(location.latitude, location.longitude);
    return loadCached<WeatherAlertsResult>({
      key,
      freshTtlSeconds: ALERTS_FRESH_TTL_SECONDS,
      staleMaxAgeSeconds: null,
      allowStale: false,
      cache: this.cache,
      clock: this.clock,
      flight: this.flight,
      signal,
      loader: async (loaderSignal) => {
        const alerts: WeatherAlert[] = await this.provider.getAlerts(
          { coordinates: { lat: location.latitude, lon: location.longitude } },
          loaderSignal,
        );
        return {
          location,
          observedAt: this.clock.now().toISOString(),
          coverage: 'limited',
          alerts,
        };
      },
    });
  }
}
