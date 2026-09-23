import { describe, expect, it } from 'vitest';
import type { Activity, AssessmentSlot } from '../domain/assessment.js';
import { RULESET_VERSION, evaluateSlotRules } from './weather-rules.js';

const T0 = '2026-09-24T06:00:00+02:00';
const T1 = '2026-09-24T07:00:00+02:00';

function slot(overrides: Partial<AssessmentSlot> = {}): AssessmentSlot {
  return {
    window: { startTime: T0, endTime: T1 },
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
    ...overrides,
  };
}

type Direction = 'gte' | 'lte' | 'lt';

function rowsFor(
  hazard: string,
  field: keyof AssessmentSlot,
  direction: Direction,
  perActivity: Partial<Record<Activity, readonly [number, number, number]>>,
  eps = 0.01,
): [string, Activity, keyof AssessmentSlot, number, boolean][] {
  const bands = ['moderate', 'high', 'severe'] as const;
  const out: [string, Activity, keyof AssessmentSlot, number, boolean][] = [];
  for (const [activity, thresholds] of Object.entries(perActivity)) {
    thresholds.forEach((threshold, index) => {
      const band = bands[index];
      if (band === undefined) {
        return;
      }
      const ruleId = `${activity}.${hazard}.${band}`;
      const notMatching = direction === 'gte' ? threshold - eps : threshold + eps;
      const matching = direction === 'lt' ? threshold - eps : threshold;
      out.push([ruleId, activity as Activity, field, notMatching, false]);
      out.push([ruleId, activity as Activity, field, matching, true]);
    });
  }
  return out;
}

const ALL_BAND_CASES: [string, Activity, keyof AssessmentSlot, number, boolean][] = [
  ...rowsFor('rain', 'precipitationMm', 'gte', {
    commute: [2.5, 7.5, 15],
    running: [1, 5, 10],
    travel: [5, 10, 20],
    outdoor_event: [1, 5, 10],
  }),
  ...rowsFor('gust', 'gustKph', 'gte', {
    commute: [40, 60, 80],
    running: [35, 50, 70],
    travel: [50, 70, 90],
    outdoor_event: [35, 55, 75],
  }),
  ...rowsFor('visibility', 'visibilityKm', 'lt', {
    commute: [5, 2, 0.5],
    running: [5, 2, 0.5],
    travel: [5, 2, 0.5],
    outdoor_event: [5, 2, 0.5],
  }),
  ...rowsFor('heat', 'feelsLikeC', 'gte', {
    commute: [35, 40, 45],
    running: [30, 35, 40],
    travel: [35, 40, 45],
    outdoor_event: [32, 38, 43],
  }),
  ...rowsFor('cold', 'feelsLikeC', 'lte', {
    commute: [0, -10, -20],
    running: [5, 0, -10],
    travel: [0, -10, -20],
    outdoor_event: [0, -10, -20],
  }),
  ...rowsFor('uv', 'uvIndex', 'gte', {
    running: [6, 8, 11],
    outdoor_event: [6, 8, 11],
  }),
  ...rowsFor('rain_probability', 'precipitationChancePercent', 'gte', {
    outdoor_event: [50, 70, 90],
  }),
];

describe('evaluateSlotRules band boundaries', () => {
  it.each(ALL_BAND_CASES)('%s with %s=%s fires: %s', (ruleId, activity, field, value, expected) => {
    const findings = evaluateSlotRules(
      slot({ [field]: value } as Partial<AssessmentSlot>),
      activity,
    );
    expect(findings.some((finding) => finding.ruleId === ruleId)).toBe(expected);
  });

  it('selects only the highest matching band per hazard', () => {
    const findings = evaluateSlotRules(slot({ precipitationMm: 12 }), 'running');
    const rainFindings = findings.filter((finding) => finding.ruleId.startsWith('running.rain'));
    expect(rainFindings).toHaveLength(1);
    expect(rainFindings[0]).toMatchObject({
      ruleId: 'running.rain.severe',
      severity: 'severe',
      points: 70,
    });
  });

  it('accumulates different hazards in one slot', () => {
    const findings = evaluateSlotRules(slot({ precipitationMm: 3, gustKph: 45 }), 'commute');
    const ruleIds = new Set(findings.map((finding) => finding.ruleId));
    expect(ruleIds.has('commute.rain.moderate')).toBe(true);
    expect(ruleIds.has('commute.gust.moderate')).toBe(true);
    expect(ruleIds.has('commute.rain.high')).toBe(false);
  });

  it('emits no findings for a clean slot', () => {
    expect(evaluateSlotRules(slot(), 'running')).toEqual([]);
    expect(evaluateSlotRules(slot(), 'commute')).toEqual([]);
    expect(evaluateSlotRules(slot(), 'travel')).toEqual([]);
    expect(evaluateSlotRules(slot(), 'outdoor_event')).toEqual([]);
  });

  it('ignores null UV and rain probability values', () => {
    const findings = evaluateSlotRules(slot({ uvIndex: null }), 'running');
    expect(findings.some((finding) => finding.ruleId.includes('.uv.'))).toBe(false);
    const outdoor = evaluateSlotRules(slot({ precipitationChancePercent: null }), 'outdoor_event');
    expect(outdoor.some((finding) => finding.ruleId.includes('rain_probability'))).toBe(false);
  });
});

describe('universal thunderstorm rules', () => {
  it('emits a high finding for any thunderstorm category', () => {
    const findings = evaluateSlotRules(
      slot({ condition: { category: 'thunderstorm', intensity: 'unknown', text: 'Thundery' } }),
      'commute',
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        ruleId: 'universal.thunderstorm.high',
        severity: 'high',
        points: 40,
      }),
    );
  });

  it('emits a severe finding for heavy thunder regardless of localized text', () => {
    const findings = evaluateSlotRules(
      slot({ condition: { category: 'thunderstorm', intensity: 'heavy', text: 'Trovoada forte' } }),
      'travel',
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        ruleId: 'universal.thunderstorm.severe',
        severity: 'severe',
        points: 70,
      }),
    );
    expect(findings.some((finding) => finding.ruleId === 'universal.thunderstorm.high')).toBe(
      false,
    );
  });

  it('applies the thunderstorm rule to every activity', () => {
    for (const activity of ['commute', 'running', 'travel', 'outdoor_event'] as const) {
      const findings = evaluateSlotRules(
        slot({ condition: { category: 'thunderstorm', intensity: 'moderate', text: null } }),
        activity,
      );
      expect(findings.some((finding) => finding.ruleId === 'universal.thunderstorm.high')).toBe(
        true,
      );
    }
  });
});

describe('running compound heat-humidity rule', () => {
  it('fires at 28 C and 80 percent humidity', () => {
    const findings = evaluateSlotRules(slot({ temperatureC: 28, humidityPercent: 80 }), 'running');
    expect(findings).toContainEqual(
      expect.objectContaining({
        ruleId: 'running.heat-humidity.moderate',
        severity: 'moderate',
        points: 20,
      }),
    );
  });

  it('stays silent below either component', () => {
    expect(
      evaluateSlotRules(slot({ temperatureC: 27.99, humidityPercent: 90 }), 'running').some(
        (finding) => finding.ruleId === 'running.heat-humidity.moderate',
      ),
    ).toBe(false);
    expect(
      evaluateSlotRules(slot({ temperatureC: 30, humidityPercent: 79.99 }), 'running').some(
        (finding) => finding.ruleId === 'running.heat-humidity.moderate',
      ),
    ).toBe(false);
  });

  it('never fires for other activities', () => {
    for (const activity of ['commute', 'travel', 'outdoor_event'] as const) {
      const findings = evaluateSlotRules(slot({ temperatureC: 32, humidityPercent: 90 }), activity);
      expect(findings.some((finding) => finding.ruleId === 'running.heat-humidity.moderate')).toBe(
        false,
      );
    }
  });
});

describe('finding shape', () => {
  it('carries full explainable evidence', () => {
    const [finding] = evaluateSlotRules(slot({ precipitationMm: 5 }), 'running');
    expect(finding).toBeDefined();
    expect(finding).toMatchObject({
      ruleId: 'running.rain.high',
      severity: 'high',
      points: 40,
      evidence: {
        metric: 'precipitationMm',
        observed: 5,
        operator: '>=',
        threshold: 5,
        unit: 'mm/h',
      },
      window: { startTime: T0, endTime: T1 },
    });
    expect(typeof finding?.message).toBe('string');
    expect(typeof finding?.mitigation).toBe('string');
  });

  it('exports the pinned ruleset version', () => {
    expect(RULESET_VERSION).toBe('weather-activity-rules/1.0.0');
  });
});
