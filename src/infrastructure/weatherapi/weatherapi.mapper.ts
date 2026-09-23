import { DateTime } from 'luxon';
import type {
  CurrentWeather,
  DailySummary,
  ForecastDay,
  NormalizedCondition,
  WeatherAlert,
  WeatherForecast,
  WeatherInterval,
  AlertSeverity,
} from '../../domain/weather.js';
import type { Location, LocationCandidate } from '../../domain/location.js';
import { classifyConditionCode } from './condition-map.js';
import type { z } from 'zod';
import type {
  alertsResponseSchema,
  currentResponseSchema,
  forecastResponseSchema,
  searchResponseSchema,
} from './weatherapi.schemas.js';

type SearchPayload = z.infer<typeof searchResponseSchema>;
type CurrentPayload = z.infer<typeof currentResponseSchema>;
type ForecastPayload = z.infer<typeof forecastResponseSchema>;
type AlertsPayload = z.infer<typeof alertsResponseSchema>;

interface ProviderLocationDto {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  tz_id: string;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function isoFromEpoch(epoch: number, timeZone: string): string {
  const iso = DateTime.fromSeconds(epoch, { zone: timeZone }).toISO({
    suppressMilliseconds: false,
  });
  return iso ?? new Date(epoch * 1000).toISOString();
}

export function mapLocation(dto: ProviderLocationDto): Location {
  return {
    locationId: `${roundCoordinate(dto.lat)},${roundCoordinate(dto.lon)}`,
    name: dto.name,
    region: dto.region === '' ? null : dto.region,
    country: dto.country,
    latitude: dto.lat,
    longitude: dto.lon,
    timeZone: dto.tz_id,
  };
}

function mapCondition(dto: { text: string; code: number }): NormalizedCondition {
  const classification = classifyConditionCode(dto.code);
  return { category: classification.category, intensity: classification.intensity, text: dto.text };
}

export function mapSearch(payload: SearchPayload): LocationCandidate[] {
  return payload.map((row) => ({
    locationId: String(row.id),
    name: row.name,
    region: row.region === '' ? null : row.region,
    country: row.country,
    latitude: row.lat,
    longitude: row.lon,
    timeZone: null,
  }));
}

export function mapCurrent(payload: CurrentPayload): CurrentWeather {
  const observedAt = isoFromEpoch(payload.current.last_updated_epoch, payload.location.tz_id);
  return {
    location: mapLocation(payload.location),
    observedAt,
    interval: {
      time: observedAt,
      condition: mapCondition(payload.current.condition),
      temperatureC: payload.current.temp_c,
      feelsLikeC: payload.current.feelslike_c,
      precipitationMm: payload.current.precip_mm,
      humidityPercent: payload.current.humidity,
      cloudCoverPercent: payload.current.cloud,
      precipitationChancePercent: null,
      windKph: payload.current.wind_kph,
      gustKph: payload.current.gust_kph,
      visibilityKm: payload.current.vis_km,
      uvIndex: payload.current.uv,
    },
  };
}

function mapHour(
  hour: ForecastPayload['forecast']['forecastday'][number]['hour'][number],
  timeZone: string,
): WeatherInterval {
  return {
    time: isoFromEpoch(hour.time_epoch, timeZone),
    condition: mapCondition(hour.condition),
    temperatureC: hour.temp_c,
    feelsLikeC: hour.feelslike_c,
    precipitationMm: hour.precip_mm,
    humidityPercent: hour.humidity,
    cloudCoverPercent: hour.cloud,
    precipitationChancePercent: hour.chance_of_rain,
    windKph: hour.wind_kph,
    gustKph: hour.gust_kph,
    visibilityKm: hour.vis_km,
    uvIndex: hour.uv,
  };
}

function mapDay(
  day: ForecastPayload['forecast']['forecastday'][number],
  timeZone: string,
): ForecastDay {
  const hours = day.hour.map((hour) => mapHour(hour, timeZone));
  const maxGustKph = hours.reduce((max, hour) => Math.max(max, hour.gustKph), 0);
  const summary: DailySummary = {
    condition: mapCondition(day.day.condition),
    maxTempC: day.day.maxtemp_c,
    minTempC: day.day.mintemp_c,
    avgTempC: day.day.avgtemp_c,
    totalPrecipitationMm: day.day.totalprecip_mm,
    maxWindKph: day.day.maxwind_kph,
    maxGustKph,
    precipitationChancePercent: day.day.daily_chance_of_rain,
    uvIndexMax: day.day.uv,
  };
  return { date: day.date, summary, hours };
}

export function mapForecast(payload: ForecastPayload): WeatherForecast {
  return {
    location: mapLocation(payload.location),
    generatedAt: isoFromEpoch(payload.current.last_updated_epoch, payload.location.tz_id),
    days: payload.forecast.forecastday.map((day) => mapDay(day, payload.location.tz_id)),
  };
}

const KNOWN_SEVERITIES = new Set<AlertSeverity>([
  'Minor',
  'Moderate',
  'Severe',
  'Extreme',
  'Unknown',
]);

function normalizeSeverity(severity: string): AlertSeverity {
  return KNOWN_SEVERITIES.has(severity as AlertSeverity) ? (severity as AlertSeverity) : 'Unknown';
}

function normalizeAlertTimestamp(value: string): string {
  const parsed = DateTime.fromISO(value);
  if (!parsed.isValid) {
    return value;
  }
  return parsed.toISO() ?? value;
}

export function mapAlerts(payload: AlertsPayload): WeatherAlert[] {
  return payload.alerts.alert.map((alert) => ({
    headline: alert.headline,
    event: alert.event,
    severity: normalizeSeverity(alert.severity),
    effectiveAt: normalizeAlertTimestamp(alert.effective),
    expiresAt: normalizeAlertTimestamp(alert.expires),
    description: alert.desc && alert.desc.length > 0 ? alert.desc : null,
    instruction: alert.instruction && alert.instruction.length > 0 ? alert.instruction : null,
    areas: alert.areas
      .split(';')
      .map((area) => area.trim())
      .filter((area) => area.length > 0),
  }));
}
