export const CACHE_NAMESPACE = 'wis:v1';

export type CacheResource = 'location-search' | 'current' | 'forecast' | 'alerts';

export function normalizeQuery(query: string): string {
  return query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function coordinateKey(latitude: number, longitude: number): string {
  return `${roundCoordinate(latitude)},${roundCoordinate(longitude)}`;
}

export function buildCoordinateKey(latitude: number, longitude: number): string {
  return coordinateKey(latitude, longitude);
}

export function buildLocationSearchKey(query: string, limit = 5): string {
  return `${CACHE_NAMESPACE}:location-search:${normalizeQuery(query)}:${limit}`;
}

export function buildCurrentWeatherKey(latitude: number, longitude: number): string {
  return `${CACHE_NAMESPACE}:current:${coordinateKey(latitude, longitude)}`;
}

export interface ForecastKeyParameters {
  days: 1 | 2 | 3;
  includeHourly: boolean;
}

export function buildForecastKey(
  ref: { latitude: number; longitude: number },
  parameters: ForecastKeyParameters,
): string {
  return (
    `${CACHE_NAMESPACE}:forecast:${coordinateKey(ref.latitude, ref.longitude)}` +
    `:days=${parameters.days};hourly=${parameters.includeHourly ? '1' : '0'}`
  );
}

export function buildAlertsKey(latitude: number, longitude: number): string {
  return `${CACHE_NAMESPACE}:alerts:${coordinateKey(latitude, longitude)}`;
}
