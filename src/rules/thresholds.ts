import type { Activity, FindingSeverity } from '../domain/assessment.js';

export const RULESET_VERSION = 'weather-activity-rules/1.0.0';

export type HazardId = 'rain' | 'gust' | 'visibility' | 'heat' | 'cold' | 'uv' | 'rain_probability';

export type ThresholdDirection = 'gte' | 'lte' | 'lt';

export interface HazardBand {
  band: FindingSeverity;
  points: 20 | 40 | 70;
  threshold: number;
}

export interface HazardDefinition {
  hazard: HazardId;
  metric: string;
  field:
    | 'precipitationMm'
    | 'gustKph'
    | 'visibilityKm'
    | 'feelsLikeC'
    | 'uvIndex'
    | 'precipitationChancePercent';
  direction: ThresholdDirection;
  unit: string;
  description: string;
  mitigation: string;
  bands: Partial<Record<Activity, readonly [HazardBand, HazardBand, HazardBand]>>;
}

const band = (
  bandSeverity: FindingSeverity,
  points: 20 | 40 | 70,
  threshold: number,
): HazardBand => ({ band: bandSeverity, points, threshold });

export const HAZARD_DEFINITIONS: readonly HazardDefinition[] = [
  {
    hazard: 'rain',
    metric: 'precipitationMm',
    field: 'precipitationMm',
    direction: 'gte',
    unit: 'mm/h',
    description: 'Rain rate',
    mitigation: 'Wear rain protection and check drainage on your route.',
    bands: {
      commute: [band('moderate', 20, 2.5), band('high', 40, 7.5), band('severe', 70, 15)],
      running: [band('moderate', 20, 1), band('high', 40, 5), band('severe', 70, 10)],
      travel: [band('moderate', 20, 5), band('high', 40, 10), band('severe', 70, 20)],
      outdoor_event: [band('moderate', 20, 1), band('high', 40, 5), band('severe', 70, 10)],
    },
  },
  {
    hazard: 'gust',
    metric: 'gustKph',
    field: 'gustKph',
    direction: 'gte',
    unit: 'km/h',
    description: 'Wind gust',
    mitigation: 'Secure loose items and consider sheltered alternatives.',
    bands: {
      commute: [band('moderate', 20, 40), band('high', 40, 60), band('severe', 70, 80)],
      running: [band('moderate', 20, 35), band('high', 40, 50), band('severe', 70, 70)],
      travel: [band('moderate', 20, 50), band('high', 40, 70), band('severe', 70, 90)],
      outdoor_event: [band('moderate', 20, 35), band('high', 40, 55), band('severe', 70, 75)],
    },
  },
  {
    hazard: 'visibility',
    metric: 'visibilityKm',
    field: 'visibilityKm',
    direction: 'lt',
    unit: 'km',
    description: 'Visibility',
    mitigation: 'Increase following distance and use lights.',
    bands: {
      commute: [band('moderate', 20, 5), band('high', 40, 2), band('severe', 70, 0.5)],
      running: [band('moderate', 20, 5), band('high', 40, 2), band('severe', 70, 0.5)],
      travel: [band('moderate', 20, 5), band('high', 40, 2), band('severe', 70, 0.5)],
      outdoor_event: [band('moderate', 20, 5), band('high', 40, 2), band('severe', 70, 0.5)],
    },
  },
  {
    hazard: 'heat',
    metric: 'feelsLikeC',
    field: 'feelsLikeC',
    direction: 'gte',
    unit: 'C',
    description: 'Feels-like temperature',
    mitigation: 'Stay hydrated and reduce exposure during peak heat.',
    bands: {
      commute: [band('moderate', 20, 35), band('high', 40, 40), band('severe', 70, 45)],
      running: [band('moderate', 20, 30), band('high', 40, 35), band('severe', 70, 40)],
      travel: [band('moderate', 20, 35), band('high', 40, 40), band('severe', 70, 45)],
      outdoor_event: [band('moderate', 20, 32), band('high', 40, 38), band('severe', 70, 43)],
    },
  },
  {
    hazard: 'cold',
    metric: 'feelsLikeC',
    field: 'feelsLikeC',
    direction: 'lte',
    unit: 'C',
    description: 'Feels-like temperature',
    mitigation: 'Wear insulated layers and protect exposed skin.',
    bands: {
      commute: [band('moderate', 20, 0), band('high', 40, -10), band('severe', 70, -20)],
      running: [band('moderate', 20, 5), band('high', 40, 0), band('severe', 70, -10)],
      travel: [band('moderate', 20, 0), band('high', 40, -10), band('severe', 70, -20)],
      outdoor_event: [band('moderate', 20, 0), band('high', 40, -10), band('severe', 70, -20)],
    },
  },
  {
    hazard: 'uv',
    metric: 'uvIndex',
    field: 'uvIndex',
    direction: 'gte',
    unit: 'UV',
    description: 'UV index',
    mitigation: 'Apply sunscreen and seek shade.',
    bands: {
      running: [band('moderate', 20, 6), band('high', 40, 8), band('severe', 70, 11)],
      outdoor_event: [band('moderate', 20, 6), band('high', 40, 8), band('severe', 70, 11)],
    },
  },
  {
    hazard: 'rain_probability',
    metric: 'precipitationChancePercent',
    field: 'precipitationChancePercent',
    direction: 'gte',
    unit: '%',
    description: 'Chance of precipitation',
    mitigation: 'Prepare rain contingency plans.',
    bands: {
      outdoor_event: [band('moderate', 20, 50), band('high', 40, 70), band('severe', 70, 90)],
    },
  },
];

export const COMPOUND_HEAT_HUMIDITY = {
  temperatureThresholdC: 28,
  humidityThresholdPercent: 80,
} as const;

export const RAIN_COVERAGE_RULE = {
  probabilityThresholdPercent: 50,
  slotRatioThreshold: 0.3,
} as const;

export const THUNDERSTORM_MITIGATION = 'Seek indoor shelter and avoid exposed areas.';
export const COMPOUND_HEAT_MITIGATION = 'Take breaks in cool, shaded areas and hydrate.';
export const ALERT_MITIGATION = 'Follow the guidance issued with the official alert.';
export const COVERAGE_MITIGATION = 'Prepare rain contingency plans across the event duration.';
