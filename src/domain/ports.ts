import type { Location, LocationCandidate, ResolvedLocationRef } from './location.js';
import type { CurrentWeather, WeatherAlert, WeatherForecast } from './weather.js';

export interface WeatherProvider {
  searchLocations(query: string, signal?: AbortSignal): Promise<LocationCandidate[]>;
  getCurrent(location: ResolvedLocationRef, signal?: AbortSignal): Promise<CurrentWeather>;
  getForecast(
    location: ResolvedLocationRef,
    days: 1 | 2 | 3,
    signal?: AbortSignal,
  ): Promise<WeatherForecast>;
  getAlerts(location: ResolvedLocationRef, signal?: AbortSignal): Promise<WeatherAlert[]>;
}

export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  health(): Promise<'up' | 'down'>;
}

export interface ProviderQuota {
  reserve(attempts: number): Promise<QuotaReservation>;
}

export interface EmergencyLimiter {
  reserve(attempts: number): Promise<QuotaReservation>;
}

export interface ResolvedLocationLookup {
  lookup(ref: ResolvedLocationRef, signal?: AbortSignal): Promise<Location>;
}

export interface CurrentWeatherByRef {
  getCurrentByRef(
    ref: ResolvedLocationRef,
    signal?: AbortSignal,
  ): Promise<ServiceResult<CurrentWeather>>;
}

export interface Clock {
  now(): Date;
}

export interface ResultMeta {
  requestId: string;
  provider: 'weatherapi';
  fetchedAt: string;
  cached: boolean;
  stale: boolean;
  warnings: string[];
}

export interface ServiceResult<T> {
  data: T;
  meta: ResultMeta;
}

export interface CacheEntry<T> {
  value: T;
  fetchedAt: string;
  freshUntil: string;
  staleUntil: string | null;
}

export interface QuotaReservation {
  granted: true;
  used: number;
  limit: number;
  resetsAt: string;
  mode: 'shared' | 'process' | 'emergency';
}

export const WEATHER_PROVIDER = Symbol('WEATHER_PROVIDER');
export const CACHE_STORE = Symbol('CACHE_STORE');
export const PROVIDER_QUOTA = Symbol('PROVIDER_QUOTA');
export const CLOCK = Symbol('CLOCK');
export const EMERGENCY_LIMITER = Symbol('EMERGENCY_LIMITER');
export const RESOLVED_LOCATION_LOOKUP = Symbol('RESOLVED_LOCATION_LOOKUP');
export const CURRENT_WEATHER_BY_REF = Symbol('CURRENT_WEATHER_BY_REF');
export const LOCATION_SERVICE = Symbol('LOCATION_SERVICE');
export const WEATHER_SERVICE = Symbol('WEATHER_SERVICE');
export const ASSESSMENT_SERVICE = Symbol('ASSESSMENT_SERVICE');
export const APP_LOGGER = Symbol('APP_LOGGER');
