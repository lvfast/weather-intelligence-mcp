import type { Activity, AssessmentSlot, RuleFinding } from '../domain/assessment.js';
import {
  COMPOUND_HEAT_HUMIDITY,
  COMPOUND_HEAT_MITIGATION,
  HAZARD_DEFINITIONS,
  RULESET_VERSION,
  THUNDERSTORM_MITIGATION,
  type HazardBand,
  type HazardDefinition,
} from './thresholds.js';

export { RULESET_VERSION };

const BAND_ORDER: readonly RuleFinding['severity'][] = ['moderate', 'high', 'severe'];

function operatorText(direction: HazardDefinition['direction']): string {
  switch (direction) {
    case 'gte':
      return '>=';
    case 'lte':
      return '<=';
    case 'lt':
      return '<';
  }
}

function describeComparison(definition: HazardDefinition, band: HazardBand, value: number): string {
  const operator = operatorText(definition.direction);
  return `${definition.description} ${value} ${definition.unit} ${operator} threshold ${band.threshold} ${definition.unit}`;
}

function buildBandFinding(
  definition: HazardDefinition,
  activity: Activity,
  band: HazardBand,
  slot: AssessmentSlot,
  value: number,
): RuleFinding {
  return {
    ruleId: `${activity}.${definition.hazard}.${band.band}`,
    severity: band.band,
    points: band.points,
    message: describeComparison(definition, band, value),
    evidence: {
      metric: definition.metric,
      observed: value,
      operator: operatorText(definition.direction),
      threshold: band.threshold,
      unit: definition.unit,
    },
    window: slot.window,
    mitigation: definition.mitigation,
  };
}

function buildThunderstormFinding(slot: AssessmentSlot, heavy: boolean): RuleFinding {
  const severity = heavy ? 'severe' : 'high';
  return {
    ruleId: `universal.thunderstorm.${severity}`,
    severity,
    points: heavy ? 70 : 40,
    message: heavy
      ? 'Thunderstorm with heavy intensity in this slot.'
      : 'Thunderstorm activity in this slot.',
    evidence: {
      metric: 'condition',
      observed: heavy ? 'thunderstorm/heavy' : 'thunderstorm',
      operator: 'is',
      threshold: heavy ? 'heavy' : 'thunderstorm',
    },
    window: slot.window,
    mitigation: THUNDERSTORM_MITIGATION,
  };
}

function buildCompoundHeatHumidityFinding(slot: AssessmentSlot): RuleFinding {
  return {
    ruleId: 'running.heat-humidity.moderate',
    severity: 'moderate',
    points: 20,
    message:
      `Compound heat-humidity: temperature ${slot.temperatureC} C at or above ` +
      `${COMPOUND_HEAT_HUMIDITY.temperatureThresholdC} C with humidity ${slot.humidityPercent}% ` +
      `at or above ${COMPOUND_HEAT_HUMIDITY.humidityThresholdPercent}%.`,
    evidence: {
      metric: 'temperatureC',
      observed: slot.temperatureC,
      operator: '>=',
      threshold: COMPOUND_HEAT_HUMIDITY.temperatureThresholdC,
      unit: 'C',
    },
    window: slot.window,
    mitigation: COMPOUND_HEAT_MITIGATION,
  };
}

function matches(
  direction: HazardDefinition['direction'],
  threshold: number,
  value: number,
): boolean {
  switch (direction) {
    case 'gte':
      return value >= threshold;
    case 'lte':
      return value <= threshold;
    case 'lt':
      return value < threshold;
  }
}

export function evaluateSlotRules(slot: AssessmentSlot, activity: Activity): RuleFinding[] {
  const findings: RuleFinding[] = [];

  for (const definition of HAZARD_DEFINITIONS) {
    const bands = definition.bands[activity];
    if (bands === undefined) {
      continue;
    }
    const value = slot[definition.field];
    if (value === null) {
      continue;
    }
    let matched: HazardBand | null = null;
    for (const candidate of bands) {
      if (matches(definition.direction, candidate.threshold, value)) {
        matched = candidate;
      }
    }
    if (matched !== null) {
      findings.push(buildBandFinding(definition, activity, matched, slot, value));
    }
  }

  if (slot.condition.category === 'thunderstorm') {
    findings.push(buildThunderstormFinding(slot, slot.condition.intensity === 'heavy'));
  }

  if (
    activity === 'running' &&
    slot.temperatureC >= COMPOUND_HEAT_HUMIDITY.temperatureThresholdC &&
    slot.humidityPercent >= COMPOUND_HEAT_HUMIDITY.humidityThresholdPercent
  ) {
    findings.push(buildCompoundHeatHumidityFinding(slot));
  }

  return findings;
}

export const SEVERITY_ORDER: Record<RuleFinding['severity'], number> = {
  moderate: 1,
  high: 2,
  severe: 3,
};

export { BAND_ORDER };
