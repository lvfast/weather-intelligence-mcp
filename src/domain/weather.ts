import type { Location } from './location.js';

export type ConditionCategory =
  'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'sleet' | 'thunderstorm' | 'other';

export type ConditionIntensity = 'light' | 'moderate' | 'heavy' | 'unknown';

export interface NormalizedCondition {
  category: ConditionCategory;
  intensity: ConditionIntensity;
  text: string | null;
}

export interface WeatherInterval {
  time: string;
  condition: NormalizedCondition;
  temperatureC: number;
  feelsLikeC: number;
  precipitationMm: number;
  humidityPercent: number;
  cloudCoverPercent: number;
  precipitationChancePercent: number | null;
  windKph: number;
  gustKph: number;
  visibilityKm: number;
  uvIndex: number | null;
}

export interface CurrentWeather {
  location: Location;
  observedAt: string;
  interval: WeatherInterval;
}

export interface DailySummary {
  condition: NormalizedCondition;
  maxTempC: number;
  minTempC: number;
  avgTempC: number;
  totalPrecipitationMm: number;
  maxWindKph: number;
  maxGustKph: number;
  precipitationChancePercent: number | null;
  uvIndexMax: number | null;
}

export interface ForecastDay {
  date: string;
  summary: DailySummary;
  hours?: WeatherInterval[];
}

export interface WeatherForecast {
  location: Location;
  generatedAt: string;
  days: ForecastDay[];
}

export type AlertSeverity = 'Minor' | 'Moderate' | 'Severe' | 'Extreme' | 'Unknown';

export interface WeatherAlert {
  headline: string;
  event: string;
  severity: AlertSeverity;
  effectiveAt: string;
  expiresAt: string;
  description: string | null;
  instruction: string | null;
  areas: string[];
}

export interface WeatherAlertsResult {
  location: Location;
  observedAt: string;
  coverage: 'limited';
  alerts: WeatherAlert[];
}
