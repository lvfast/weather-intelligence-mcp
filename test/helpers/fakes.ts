import { vi } from 'vitest';
import type {
  CacheEntry,
  CacheStore,
  Clock,
  ProviderQuota,
  QuotaReservation,
  ResolvedLocationLookup,
  WeatherProvider,
} from '../../src/domain/ports.js';
import type {
  Location,
  LocationCandidate,
  ResolvedLocationRef,
} from '../../src/domain/location.js';
import type {
  AlertSeverity,
  CurrentWeather,
  DailySummary,
  ForecastDay,
  NormalizedCondition,
  WeatherAlert,
  WeatherForecast,
  WeatherInterval,
  WeatherAlertsResult,
} from '../../src/domain/weather.js';

export interface ControllableClock extends Clock {
  set(iso: string): void;
  advanceSeconds(seconds: number): void;
  advanceMinutes(minutes: number): void;
  advanceHours(hours: number): void;
}

export function makeClock(startIso = '2026-09-23T10:00:00.000Z'): ControllableClock {
  let current = new Date(startIso);
  return {
    now(): Date {
      return new Date(current);
    },
    set(iso: string): void {
      current = new Date(iso);
    },
    advanceSeconds(seconds: number): void {
      current = new Date(current.getTime() + seconds * 1000);
    },
    advanceMinutes(minutes: number): void {
      current = new Date(current.getTime() + minutes * 60_000);
    },
    advanceHours(hours: number): void {
      current = new Date(current.getTime() + hours * 3_600_000);
    },
  };
}

export interface FakeCacheStore {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  health: ReturnType<typeof vi.fn>;
  entries: Map<string, CacheEntry<unknown>>;
}

export function makeCache(clock: Clock = makeClock()): FakeCacheStore {
  const entries = new Map<string, CacheEntry<unknown>>();
  return {
    entries,
    get: vi.fn(async (key: string): Promise<CacheEntry<unknown> | null> => {
      const entry = entries.get(key);
      if (entry === undefined) {
        return null;
      }
      const now = clock.now().getTime();
      const retentionUntil = entry.staleUntil ?? entry.freshUntil;
      if (now >= Date.parse(retentionUntil)) {
        entries.delete(key);
        return null;
      }
      return entry;
    }),
    set: vi.fn(async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
      const now = clock.now();
      const fetchedAt = now.toISOString();
      const freshUntil = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
      entries.set(key, { value, fetchedAt, freshUntil, staleUntil: null });
    }),
    delete: vi.fn(async (key: string): Promise<void> => {
      entries.delete(key);
    }),
    health: vi.fn(async (): Promise<'up' | 'down'> => 'up'),
  };
}

export interface FakeWeatherProvider {
  searchLocations: ReturnType<typeof vi.fn>;
  getCurrent: ReturnType<typeof vi.fn>;
  getForecast: ReturnType<typeof vi.fn>;
  getAlerts: ReturnType<typeof vi.fn>;
}

export function makeProvider(): FakeWeatherProvider {
  return {
    searchLocations: vi
      .fn<(query: string, signal?: AbortSignal) => Promise<LocationCandidate[]>>()
      .mockResolvedValue([]),
    getCurrent: vi
      .fn<(location: ResolvedLocationRef, signal?: AbortSignal) => Promise<CurrentWeather>>()
      .mockResolvedValue(makeCurrent()),
    getForecast: vi
      .fn<
        (
          location: ResolvedLocationRef,
          days: 1 | 2 | 3,
          signal?: AbortSignal,
        ) => Promise<WeatherForecast>
      >()
      .mockResolvedValue(makeForecast()),
    getAlerts: vi
      .fn<(location: ResolvedLocationRef, signal?: AbortSignal) => Promise<WeatherAlert[]>>()
      .mockResolvedValue([]),
  };
}

export interface FakeLookup {
  lookup: ReturnType<typeof vi.fn>;
}

export function makeLookup(): FakeLookup {
  return {
    lookup: vi
      .fn<(ref: ResolvedLocationRef, signal?: AbortSignal) => Promise<Location>>()
      .mockResolvedValue(makeLocation({ name: 'Lookupville' })),
  };
}

export interface FakeCurrentWeatherByRef {
  getCurrentByRef: ReturnType<typeof vi.fn>;
}

export function makeCurrentWeatherByRef(): FakeCurrentWeatherByRef {
  return {
    getCurrentByRef: vi
      .fn<
        (
          ref: ResolvedLocationRef,
          signal?: AbortSignal,
        ) => Promise<{ data: CurrentWeather; meta: unknown }>
      >()
      .mockResolvedValue({
        data: makeCurrent(),
        meta: {
          requestId: 'test-request-id',
          provider: 'weatherapi',
          fetchedAt: '2026-09-23T10:00:00.000Z',
          cached: false,
          stale: false,
          warnings: [],
        },
      }),
  };
}

export interface FakeQuota {
  reserve: ReturnType<typeof vi.fn>;
}

export function makeQuota(): FakeQuota {
  return {
    reserve: vi.fn<(attempts: number) => Promise<QuotaReservation>>().mockResolvedValue({
      granted: true,
      used: 1,
      limit: 90_000,
      resetsAt: '2026-10-01T00:00:00.000Z',
      mode: 'process',
    } satisfies QuotaReservation),
  };
}

export function asCacheStore(fake: FakeCacheStore): CacheStore {
  return fake as unknown as CacheStore;
}

export function asWeatherProvider(fake: FakeWeatherProvider): WeatherProvider {
  return fake as unknown as WeatherProvider;
}

export function asResolvedLocationLookup(fake: FakeLookup): ResolvedLocationLookup {
  return fake as unknown as ResolvedLocationLookup;
}

export function asProviderQuota(fake: FakeQuota): ProviderQuota {
  return fake as unknown as ProviderQuota;
}

export function makeCondition(overrides: Partial<NormalizedCondition> = {}): NormalizedCondition {
  return { category: 'clear', intensity: 'unknown', text: null, ...overrides };
}

export function makeLocation(overrides: Partial<Location> = {}): Location {
  return {
    locationId: '48.8566,2.3522',
    name: 'Paris',
    region: 'Ile-de-France',
    country: 'France',
    latitude: 48.8566,
    longitude: 2.3522,
    timeZone: 'Europe/Paris',
    ...overrides,
  };
}

export function makeCandidate(overrides: Partial<LocationCandidate> = {}): LocationCandidate {
  return {
    locationId: '2807',
    name: 'Paris',
    region: 'Ile-de-France',
    country: 'France',
    latitude: 48.8566,
    longitude: 2.3522,
    timeZone: null,
    ...overrides,
  };
}

export function makeInterval(overrides: Partial<WeatherInterval> = {}): WeatherInterval {
  return {
    time: '2026-09-23T12:00:00.000+02:00',
    condition: makeCondition(),
    temperatureC: 20,
    feelsLikeC: 20,
    precipitationMm: 0,
    humidityPercent: 50,
    cloudCoverPercent: 0,
    precipitationChancePercent: 0,
    windKph: 10,
    gustKph: 15,
    visibilityKm: 10,
    uvIndex: 3,
    ...overrides,
  };
}

export function makeCurrent(overrides: Partial<CurrentWeather> = {}): CurrentWeather {
  return {
    location: makeLocation(),
    observedAt: '2026-09-23T12:00:00.000+02:00',
    interval: makeInterval(),
    ...overrides,
  };
}

export function makeDailySummary(overrides: Partial<DailySummary> = {}): DailySummary {
  return {
    condition: makeCondition(),
    maxTempC: 22,
    minTempC: 14,
    avgTempC: 18,
    totalPrecipitationMm: 0,
    maxWindKph: 20,
    maxGustKph: 30,
    precipitationChancePercent: 10,
    uvIndexMax: 5,
    ...overrides,
  };
}

export function makeForecastDay(overrides: Partial<ForecastDay> = {}): ForecastDay {
  return {
    date: '2026-09-23',
    summary: makeDailySummary(),
    hours: [],
    ...overrides,
  };
}

export function makeForecast(overrides: Partial<WeatherForecast> = {}): WeatherForecast {
  return {
    location: makeLocation(),
    generatedAt: '2026-09-23T10:00:00.000+02:00',
    days: [makeForecastDay()],
    ...overrides,
  };
}

export function makeAlert(overrides: Partial<WeatherAlert> = {}): WeatherAlert {
  return {
    headline: 'Test alert',
    event: 'Test event',
    severity: 'Moderate' as AlertSeverity,
    effectiveAt: '2026-09-23T10:00:00.000+00:00',
    expiresAt: '2026-09-23T18:00:00.000+00:00',
    description: null,
    instruction: null,
    areas: [],
    ...overrides,
  };
}

export function makeAlertsResult(
  overrides: Partial<WeatherAlertsResult> = {},
): WeatherAlertsResult {
  return {
    location: makeLocation(),
    observedAt: '2026-09-23T10:00:00.000+02:00',
    coverage: 'limited',
    alerts: [],
    ...overrides,
  };
}

export function refById(id: string): ResolvedLocationRef {
  return { locationId: id };
}

export function refByCoordinates(lat: number, lon: number): ResolvedLocationRef {
  return { coordinates: { lat, lon } };
}
