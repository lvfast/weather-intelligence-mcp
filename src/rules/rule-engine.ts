import type {
  AssessmentContext,
  AssessmentEvidence,
  Recommendation,
  RiskLevel,
  RuleFinding,
  WeatherAssessmentCore,
} from '../domain/assessment.js';
import type { AlertSeverity, WeatherAlert } from '../domain/weather.js';
import {
  ALERT_MITIGATION,
  COVERAGE_MITIGATION,
  RAIN_COVERAGE_RULE,
  RULESET_VERSION,
} from './thresholds.js';
import { SEVERITY_ORDER, evaluateSlotRules } from './weather-rules.js';

export function scoreToRisk(score: number): RiskLevel {
  if (score < 20) {
    return 'low';
  }
  if (score < 40) {
    return 'moderate';
  }
  if (score < 70) {
    return 'high';
  }
  return 'severe';
}

export function riskToRecommendation(risk: RiskLevel): Recommendation {
  return risk === 'low' ? 'go' : risk === 'moderate' ? 'caution' : 'avoid';
}

export function stableSeverityComparator(a: RuleFinding, b: RuleFinding): number {
  return (
    SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
    b.points - a.points ||
    (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0)
  );
}

export interface AggregationResult {
  riskScore: number;
  riskLevel: RiskLevel;
  recommendation: Recommendation;
}

export function aggregate(findings: readonly RuleFinding[]): AggregationResult {
  const riskScore = Math.min(
    100,
    findings.reduce((sum, finding) => sum + finding.points, 0),
  );
  const riskLevel = scoreToRisk(riskScore);
  return { riskScore, riskLevel, recommendation: riskToRecommendation(riskLevel) };
}

interface AlertFloor {
  band: RuleFinding['severity'];
  points: RuleFinding['points'];
  ruleId: string;
  label: string;
}

const ALERT_FLOORS: Record<AlertSeverity, AlertFloor | null> = {
  Minor: null,
  Moderate: { band: 'moderate', points: 20, ruleId: 'universal.alert.moderate', label: 'Moderate' },
  Severe: { band: 'high', points: 40, ruleId: 'universal.alert.high', label: 'Severe' },
  Extreme: { band: 'severe', points: 70, ruleId: 'universal.alert.severe', label: 'Extreme' },
  Unknown: { band: 'moderate', points: 20, ruleId: 'universal.alert.unknown', label: 'unknown' },
};

function buildAlertFinding(
  alert: WeatherAlert,
  floor: AlertFloor,
  window: AssessmentContext['window'],
): RuleFinding {
  return {
    ruleId: floor.ruleId,
    severity: floor.band,
    points: floor.points,
    message: `Official alert "${alert.headline}" (${alert.severity}) imposes a ${floor.band} risk floor.`,
    evidence: {
      metric: 'alert',
      observed: alert.severity,
      operator: 'floor',
      threshold: floor.label,
    },
    window,
    mitigation: ALERT_MITIGATION,
  };
}

function evaluateAlertFindings(
  alerts: readonly WeatherAlert[],
  window: AssessmentContext['window'],
): RuleFinding[] {
  const byRuleId = new Map<string, RuleFinding>();
  for (const alert of alerts) {
    const floor = ALERT_FLOORS[alert.severity];
    if (floor === null) {
      continue;
    }
    if (!byRuleId.has(floor.ruleId)) {
      byRuleId.set(floor.ruleId, buildAlertFinding(alert, floor, window));
    }
  }
  return [...byRuleId.values()];
}

function evaluateCoverageFinding(context: AssessmentContext): RuleFinding | null {
  if (context.activity !== 'outdoor_event' || context.slots.length === 0) {
    return null;
  }
  const wetSlots = context.slots.filter((slot) => {
    const chance = slot.precipitationChancePercent;
    return chance !== null && chance >= RAIN_COVERAGE_RULE.probabilityThresholdPercent;
  }).length;
  if (wetSlots / context.slots.length < RAIN_COVERAGE_RULE.slotRatioThreshold) {
    return null;
  }
  return {
    ruleId: 'outdoor_event.rain-coverage.moderate',
    severity: 'moderate',
    points: 20,
    message:
      `Rain probability of at least ${RAIN_COVERAGE_RULE.probabilityThresholdPercent}% ` +
      `in ${wetSlots} of ${context.slots.length} evaluated slots ` +
      `(at least ${Math.round(RAIN_COVERAGE_RULE.slotRatioThreshold * 100)}%).`,
    evidence: {
      metric: 'coverage',
      observed: `${wetSlots}/${context.slots.length}`,
      operator: 'ratio >=',
      threshold: RAIN_COVERAGE_RULE.slotRatioThreshold,
    },
    window: context.window,
    mitigation: COVERAGE_MITIGATION,
  };
}

function buildSummary(
  context: AssessmentContext,
  riskScore: number,
  riskLevel: RiskLevel,
  findingCount: number,
): string {
  return (
    `Weather conditions for ${context.activity.replace('_', ' ')} around ` +
    `${context.location.name} indicate ${riskLevel} risk (score ${riskScore}/100) ` +
    `from ${findingCount} triggered rule${findingCount === 1 ? '' : 's'}.`
  );
}

export function evaluateWeatherRules(context: AssessmentContext): WeatherAssessmentCore {
  const perSlot = context.slots.map((slot) => ({
    slot,
    findings: evaluateSlotRules(slot, context.activity),
  }));

  const engineFindings: RuleFinding[] = [];
  const coverageFinding = evaluateCoverageFinding(context);
  if (coverageFinding !== null) {
    engineFindings.push(coverageFinding);
  }
  const alertFindings = evaluateAlertFindings(context.alerts, context.window);

  let riskScore = 0;
  let worstWindow = context.window;
  for (const entry of perSlot) {
    const slotScore = Math.min(
      100,
      entry.findings.reduce((sum, finding) => sum + finding.points, 0),
    );
    if (slotScore > riskScore) {
      riskScore = slotScore;
      worstWindow = entry.slot.window;
    }
  }

  for (const finding of alertFindings) {
    if (finding.points > riskScore) {
      riskScore = finding.points;
      worstWindow = context.window;
    }
  }

  if (context.dataQuality === 'degraded' && riskScore < 20) {
    riskScore = 20;
  }

  const triggeredRules = [
    ...perSlot.flatMap((entry) => entry.findings),
    ...engineFindings,
    ...alertFindings,
  ].sort(stableSeverityComparator);

  const riskLevel = scoreToRisk(riskScore);
  const evidence: AssessmentEvidence[] = perSlot.map((entry) => ({
    window: entry.slot.window,
    source: entry.slot.source,
    slot: entry.slot,
  }));

  return {
    ruleVersion: RULESET_VERSION,
    riskScore,
    riskLevel,
    recommendation: riskToRecommendation(riskLevel),
    summary: buildSummary(context, riskScore, riskLevel, triggeredRules.length),
    triggeredRules,
    evidence,
    mitigations: [...new Set(triggeredRules.map((finding) => finding.mitigation))],
    worstWindow,
    dataQuality: context.dataQuality,
  };
}
