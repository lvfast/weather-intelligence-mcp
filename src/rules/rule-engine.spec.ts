import { describe, expect, it } from 'vitest';
import type {
  Activity,
  AssessmentContext,
  AssessmentSlot,
  RuleFinding,
} from '../domain/assessment.js';
import type { AlertSeverity } from '../domain/weather.js';
import { RULESET_VERSION } from './weather-rules.js';
import {
  aggregate,
  evaluateWeatherRules,
  riskToRecommendation,
  scoreToRisk,
  stableSeverityComparator,
} from './rule-engine.js';

const T0 = '2026-09-24T06:00:00+02:00';
const T1 = '2026-09-24T07:00:00+02:00';
const T2 = '2026-09-24T08:00:00+02:00';

function finding(
  severity: RuleFinding['severity'],
  points: RuleFinding['points'],
  ruleId?: string,
): RuleFinding {
  return {
    ruleId: ruleId ?? `test.${severity}.${points}`,
    severity,
    points,
    message: `${severity} finding`,
    evidence: { metric: 'x', observed: 1, operator: '>=', threshold: 1 },
    window: { startTime: T0, endTime: T1 },
    mitigation: 'shared mitigation',
  };
}

function slot(
  overrides: Partial<AssessmentSlot> & { window?: { startTime: string; endTime: string } } = {},
): AssessmentSlot {
  const { window = { startTime: T0, endTime: T1 }, ...rest } = overrides;
  return {
    window,
    source: 'forecast',
    condition: { category: 'clear', intensity: 'unknown', text: null },
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
    ...rest,
  };
}

function context(overrides: Partial<AssessmentContext> = {}): AssessmentContext {
  return {
    activity: 'running',
    location: { name: 'Testville', timeZone: 'Europe/Paris' },
    window: { startTime: T0, endTime: T2 },
    slots: [],
    alerts: [],
    dataQuality: 'normal',
    ...overrides,
  };
}

function alert(severity: AlertSeverity) {
  return {
    headline: 'Test alert',
    event: 'Test',
    severity,
    effectiveAt: T0,
    expiresAt: T2,
    description: null,
    instruction: null,
    areas: [],
  };
}

describe('aggregate', () => {
  it('sums finding points and caps at 100', () => {
    expect(aggregate([finding('high', 40), finding('moderate', 20)]).riskScore).toBe(60);
    expect(aggregate([finding('severe', 70), finding('high', 40)]).riskScore).toBe(100);
    expect(aggregate([]).riskScore).toBe(0);
  });
});

describe('scoreToRisk', () => {
  it('maps the four bands at exact boundaries', () => {
    expect(scoreToRisk(0)).toBe('low');
    expect(scoreToRisk(19)).toBe('low');
    expect(scoreToRisk(20)).toBe('moderate');
    expect(scoreToRisk(39)).toBe('moderate');
    expect(scoreToRisk(40)).toBe('high');
    expect(scoreToRisk(69)).toBe('high');
    expect(scoreToRisk(70)).toBe('severe');
    expect(scoreToRisk(100)).toBe('severe');
  });
});

describe('riskToRecommendation', () => {
  it('maps low to go and higher bands to caution/avoid', () => {
    expect(riskToRecommendation('low')).toBe('go');
    expect(riskToRecommendation('moderate')).toBe('caution');
    expect(riskToRecommendation('high')).toBe('avoid');
    expect(riskToRecommendation('severe')).toBe('avoid');
  });
});

describe('evaluateWeatherRules', () => {
  it('takes the maximum across slots, not the sum', () => {
    const slots = [
      slot({ precipitationMm: 1, window: { startTime: T0, endTime: T1 } }),
      slot({ precipitationMm: 5, window: { startTime: T1, endTime: T2 } }),
    ];
    const result = evaluateWeatherRules(context({ slots }));
    expect(result.riskScore).toBe(40);
    expect(result.riskLevel).toBe('high');
  });

  it('identifies the worst window in evidence', () => {
    const slots = [
      slot({ precipitationMm: 1, window: { startTime: T0, endTime: T1 } }),
      slot({ precipitationMm: 5, window: { startTime: T1, endTime: T2 } }),
    ];
    const result = evaluateWeatherRules(context({ slots }));
    expect(result.worstWindow).toEqual({ startTime: T1, endTime: T2 });
  });

  it('applies alert severity floors without adding points', () => {
    expect(evaluateWeatherRules(context({ alerts: [alert('Severe')] })).riskScore).toBe(40);
    expect(evaluateWeatherRules(context({ alerts: [alert('Extreme')] })).riskScore).toBe(70);
    expect(evaluateWeatherRules(context({ alerts: [alert('Moderate')] })).riskScore).toBe(20);
    expect(evaluateWeatherRules(context({ alerts: [alert('Unknown')] })).riskScore).toBe(20);
    expect(evaluateWeatherRules(context({ alerts: [alert('Minor')] })).riskScore).toBe(0);
  });

  it('does not lower an existing score through a weaker floor', () => {
    const slots = [slot({ precipitationMm: 5 })];
    const result = evaluateWeatherRules(context({ slots, alerts: [alert('Moderate')] }));
    expect(result.riskScore).toBe(40);
  });

  it('deduplicates alert findings from the same severity band', () => {
    const result = evaluateWeatherRules(
      context({ alerts: [alert('Severe'), { ...alert('Severe'), headline: 'Second' }] }),
    );
    const alertRules = result.triggeredRules.filter((f) => f.ruleId.startsWith('universal.alert'));
    expect(alertRules).toHaveLength(1);
    expect(result.riskScore).toBe(40);
  });

  it('floors degraded-data results to moderate', () => {
    expect(evaluateWeatherRules(context({ dataQuality: 'degraded' }))).toMatchObject({
      riskScore: 20,
      riskLevel: 'moderate',
      recommendation: 'caution',
      dataQuality: 'degraded',
    });
  });

  it('does not raise an already-high degraded score', () => {
    const result = evaluateWeatherRules(
      context({ slots: [slot({ precipitationMm: 5 })], dataQuality: 'degraded' }),
    );
    expect(result.riskScore).toBe(40);
    expect(result.recommendation).toBe('avoid');
  });

  it('applies the outdoor-event rain coverage rule', () => {
    const wet = slot({ precipitationChancePercent: 60 });
    const dry = slot({ precipitationChancePercent: 0 });
    const fires = evaluateWeatherRules(
      context({ activity: 'outdoor_event', slots: [wet, dry, dry] }),
    );
    expect(
      fires.triggeredRules.some((f) => f.ruleId === 'outdoor_event.rain-coverage.moderate'),
    ).toBe(true);
    const silent = evaluateWeatherRules(
      context({ activity: 'outdoor_event', slots: [wet, dry, dry, dry] }),
    );
    expect(
      silent.triggeredRules.some((f) => f.ruleId === 'outdoor_event.rain-coverage.moderate'),
    ).toBe(false);
  });

  it('counts unknown chance values against the evaluated-slot ratio', () => {
    const fires = evaluateWeatherRules(
      context({
        activity: 'outdoor_event',
        slots: [
          slot({ precipitationChancePercent: 60 }),
          slot({ precipitationChancePercent: null }),
          slot({ precipitationChancePercent: null }),
        ],
      }),
    );
    expect(
      fires.triggeredRules.some((f) => f.ruleId === 'outdoor_event.rain-coverage.moderate'),
    ).toBe(true);
    const noData = evaluateWeatherRules(
      context({
        activity: 'outdoor_event',
        slots: [
          slot({ precipitationChancePercent: null }),
          slot({ precipitationChancePercent: null }),
        ],
      }),
    );
    expect(
      noData.triggeredRules.some((f) => f.ruleId === 'outdoor_event.rain-coverage.moderate'),
    ).toBe(false);
  });

  it('includes evidence for every evaluated slot', () => {
    const slots = [slot(), slot({ precipitationMm: 5 })];
    const result = evaluateWeatherRules(context({ slots }));
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]).toMatchObject({
      source: 'forecast',
      window: { startTime: T0, endTime: T1 },
    });
  });

  it('deduplicates mitigations and emits a deterministic summary', () => {
    const slots = [slot({ precipitationMm: 5, gustKph: 55 })];
    const result = evaluateWeatherRules(context({ slots }));
    expect(new Set(result.mitigations).size).toBe(result.mitigations.length);
    expect(result.summary).toContain('running');
    expect(result.ruleVersion).toBe(RULESET_VERSION);
  });

  it('uses singular phrasing for exactly one triggered rule', () => {
    const result = evaluateWeatherRules(context({ slots: [slot({ precipitationMm: 1 })] }));
    expect(result.triggeredRules).toHaveLength(1);
    expect(result.summary).toContain('1 triggered rule.');
  });
});

describe('stableSeverityComparator', () => {
  it('orders by severity, then points, then stable rule id', () => {
    const findings = [
      finding('moderate', 20, 'b.moderate'),
      finding('high', 40, 'a.high'),
      finding('severe', 70, 'c.severe'),
      finding('high', 40, 'b.high'),
      finding('high', 70, 'x.high'),
    ];
    const sorted = [...findings].sort(stableSeverityComparator);
    expect(sorted.map((f) => f.ruleId)).toEqual([
      'c.severe',
      'x.high',
      'a.high',
      'b.high',
      'b.moderate',
    ]);
  });

  it('is stable for equal findings', () => {
    const findings = [finding('high', 40, 'a'), finding('high', 40, 'a')];
    expect([...findings].sort(stableSeverityComparator).map((f) => f.ruleId)).toEqual(['a', 'a']);
  });
});

describe('activity coverage', () => {
  it.each(['commute', 'running', 'travel', 'outdoor_event'] as const)(
    'evaluates %s without throwing',
    (activity: Activity) => {
      const result = evaluateWeatherRules(context({ activity, slots: [slot()] }));
      expect(result.riskScore).toBe(0);
      expect(result.recommendation).toBe('go');
    },
  );
});
