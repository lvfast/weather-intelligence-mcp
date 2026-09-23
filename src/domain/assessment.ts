import type { Location, LocationInput } from './location.js';
import type { NormalizedCondition, WeatherAlert } from './weather.js';

export type Activity = 'commute' | 'running' | 'travel' | 'outdoor_event';

export const ACTIVITIES: readonly Activity[] = ['commute', 'running', 'travel', 'outdoor_event'];

export type RiskLevel = 'low' | 'moderate' | 'high' | 'severe';

export type Recommendation = 'go' | 'caution' | 'avoid';

export type FindingSeverity = 'moderate' | 'high' | 'severe';

export interface RuleFinding {
  ruleId: string;
  severity: FindingSeverity;
  points: 20 | 40 | 70;
  message: string;
  evidence: {
    metric: string;
    observed: number | string;
    operator: string;
    threshold: number | string;
    unit?: string;
  };
  window: { startTime: string; endTime: string };
  mitigation: string;
}

export interface AssessmentSlot {
  window: { startTime: string; endTime: string };
  source: 'current' | 'forecast';
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

export interface AssessmentEvidence {
  window: { startTime: string; endTime: string };
  source: 'current' | 'forecast';
  slot: AssessmentSlot;
}

export interface AssessmentContext {
  activity: Activity;
  location: { name: string; timeZone: string };
  window: { startTime: string; endTime: string };
  slots: AssessmentSlot[];
  alerts: WeatherAlert[];
  dataQuality: 'normal' | 'degraded';
}

export interface WeatherAssessmentCore {
  ruleVersion: string;
  riskScore: number;
  riskLevel: RiskLevel;
  recommendation: Recommendation;
  summary: string;
  triggeredRules: RuleFinding[];
  evidence: AssessmentEvidence[];
  mitigations: string[];
  worstWindow: { startTime: string; endTime: string };
  dataQuality: 'normal' | 'degraded';
}

export type AssessmentSourceCoverage = 'current' | 'forecast' | 'forecast-and-limited-alerts';

export interface AssessmentSource {
  provider: 'weatherapi';
  cached: boolean;
  stale: boolean;
  coverage: AssessmentSourceCoverage;
}

export interface WeatherAssessment {
  activity: Activity;
  location: Location;
  window: { startTime: string; endTime: string; timeZone: string };
  riskScore: number;
  riskLevel: RiskLevel;
  recommendation: Recommendation;
  summary: string;
  triggeredRules: RuleFinding[];
  evidence: AssessmentEvidence[];
  mitigations: string[];
  ruleVersion: string;
  source: AssessmentSource;
  observedAt: string;
  dataQuality: 'normal' | 'degraded';
}

export interface AssessWeatherInput {
  location: LocationInput;
  activity: Activity;
  startTime?: string;
  endTime?: string;
}
