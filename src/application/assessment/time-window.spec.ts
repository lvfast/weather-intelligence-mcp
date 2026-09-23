import { describe, expect, it } from 'vitest';
import { makeClock, makeInterval } from '../../../test/helpers/fakes.js';
import {
  hasExplicitOffset,
  overlappingHours,
  parseAssessmentTimes,
  selectLocalDates,
} from './time-window.js';

const CLOCK_ISO = '2026-09-23T10:00:00.000Z';

function hour(iso: string) {
  return makeInterval({ time: iso });
}

describe('hasExplicitOffset', () => {
  it('accepts Z and explicit numeric offsets only', () => {
    expect(hasExplicitOffset('2026-09-23T10:00:00Z')).toBe(true);
    expect(hasExplicitOffset('2026-09-23T10:00:00+02:00')).toBe(true);
    expect(hasExplicitOffset('2026-09-23T10:00:00-05:00')).toBe(true);
    expect(hasExplicitOffset('2026-09-23T10:00:00')).toBe(false);
    expect(hasExplicitOffset('2026-09-23')).toBe(false);
  });
});

describe('parseAssessmentTimes', () => {
  it('rejects offset-less timestamps', () => {
    expect(() =>
      parseAssessmentTimes('2026-09-23T10:00:00', '2026-09-23T12:00:00', makeClock(CLOCK_ISO)),
    ).toThrowError(/offset/i);
    expect(() =>
      parseAssessmentTimes('2026-09-23T10:00:00Z', '2026-09-23T12:00:00', makeClock(CLOCK_ISO)),
    ).toThrowError(/offset/i);
  });

  it('rejects a single supplied time', () => {
    expect(() =>
      parseAssessmentTimes('2026-09-23T10:00:00Z', undefined, makeClock(CLOCK_ISO)),
    ).toThrowError(/together/i);
    expect(() =>
      parseAssessmentTimes(undefined, '2026-09-23T12:00:00Z', makeClock(CLOCK_ISO)),
    ).toThrowError(/together/i);
  });

  it('rejects non-positive durations', () => {
    expect(() =>
      parseAssessmentTimes('2026-09-23T12:00:00Z', '2026-09-23T12:00:00Z', makeClock(CLOCK_ISO)),
    ).toThrowError(/after/i);
    expect(() =>
      parseAssessmentTimes('2026-09-23T13:00:00Z', '2026-09-23T12:00:00Z', makeClock(CLOCK_ISO)),
    ).toThrowError(/after/i);
  });

  it('rejects windows longer than 72 hours', () => {
    expect(() =>
      parseAssessmentTimes('2026-09-23T10:00:00Z', '2026-09-26T10:00:01Z', makeClock(CLOCK_ISO)),
    ).toThrowError(/72/);
  });

  it('accepts exactly 72 hours', () => {
    expect(() =>
      parseAssessmentTimes('2026-09-23T10:00:00Z', '2026-09-26T10:00:00Z', makeClock(CLOCK_ISO)),
    ).not.toThrow();
  });

  it('builds an implicit now-to-two-hours window', () => {
    const window = parseAssessmentTimes(undefined, undefined, makeClock(CLOCK_ISO));
    expect(window.implicit).toBe(true);
    expect(window.start.toISO()).toBe('2026-09-23T10:00:00.000Z');
    expect(window.end.toISO()).toBe('2026-09-23T12:00:00.000Z');
  });

  it('marks explicit windows as such', () => {
    const window = parseAssessmentTimes(
      '2026-09-23T10:00:00Z',
      '2026-09-23T12:00:00Z',
      makeClock(CLOCK_ISO),
    );
    expect(window.implicit).toBe(false);
  });

  it('rejects malformed timestamps', () => {
    expect(() =>
      parseAssessmentTimes('not-a-dateZ', '2026-09-23T12:00:00Z', makeClock(CLOCK_ISO)),
    ).toThrowError(/valid ISO 8601/i);
  });
});

describe('selectLocalDates', () => {
  it('maps a DST fall-back window onto one local date', () => {
    expect(
      selectLocalDates(
        '2026-11-01T00:30:00-04:00',
        '2026-11-01T03:30:00-05:00',
        'America/New_York',
      ),
    ).toEqual(['2026-11-01']);
  });

  it('lists every local calendar date covered by a multi-day window', () => {
    expect(
      selectLocalDates('2026-09-23T22:00:00Z', '2026-09-26T02:00:00Z', 'Europe/Paris'),
    ).toEqual(['2026-09-24', '2026-09-25', '2026-09-26']);
  });

  it('does not include the end date when the window ends exactly at local midnight', () => {
    expect(
      selectLocalDates('2026-09-23T22:00:00Z', '2026-09-24T22:00:00Z', 'Europe/Paris'),
    ).toEqual(['2026-09-24']);
  });
});

describe('overlappingHours', () => {
  it('selects hourly intervals overlapping the half-open window', () => {
    const window = {
      startTime: '2026-09-23T10:30:00+02:00',
      endTime: '2026-09-23T11:30:00+02:00',
    };
    const hours = [
      hour('2026-09-23T10:00:00+02:00'),
      hour('2026-09-23T11:00:00+02:00'),
      hour('2026-09-23T12:00:00+02:00'),
    ];
    expect(overlappingHours(window, hours)).toHaveLength(2);
  });

  it('excludes intervals touching the window boundary only', () => {
    const window = {
      startTime: '2026-09-23T11:00:00Z',
      endTime: '2026-09-23T12:00:00Z',
    };
    const hours = [hour('2026-09-23T10:00:00Z'), hour('2026-09-23T12:00:00Z')];
    expect(overlappingHours(window, hours)).toHaveLength(0);
  });

  it('includes intervals that fully contain the window', () => {
    const window = {
      startTime: '2026-09-23T10:15:00Z',
      endTime: '2026-09-23T10:45:00Z',
    };
    const hours = [hour('2026-09-23T10:00:00Z')];
    expect(overlappingHours(window, hours)).toHaveLength(1);
  });

  it('skips malformed hour timestamps', () => {
    const window = {
      startTime: '2026-09-23T10:00:00Z',
      endTime: '2026-09-23T12:00:00Z',
    };
    const hours = [hour('garbage'), hour('2026-09-23T11:00:00Z')];
    expect(overlappingHours(window, hours)).toHaveLength(1);
  });
});
