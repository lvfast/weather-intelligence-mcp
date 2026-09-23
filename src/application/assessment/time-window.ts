import { DateTime } from 'luxon';
import type { Clock } from '../../domain/ports.js';
import type { WeatherInterval } from '../../domain/weather.js';
import { AppError } from '../../domain/errors.js';

const OFFSET_PATTERN = /(Z|[+-]\d{2}:\d{2})$/;

export const IMPLICIT_WINDOW_HOURS = 2;
export const MAX_WINDOW_HOURS = 72;

export function hasExplicitOffset(iso: string): boolean {
  return OFFSET_PATTERN.test(iso.trim());
}

export interface AssessmentWindow {
  start: DateTime;
  end: DateTime;
  implicit: boolean;
}

export function parseAssessmentTimes(
  startTime: string | undefined,
  endTime: string | undefined,
  clock: Clock,
): AssessmentWindow {
  if (startTime === undefined && endTime === undefined) {
    const now = DateTime.fromJSDate(clock.now(), { zone: 'utc' });
    return { start: now, end: now.plus({ hours: IMPLICIT_WINDOW_HOURS }), implicit: true };
  }
  if (startTime === undefined || endTime === undefined) {
    throw new AppError('VALIDATION_ERROR', 'startTime and endTime must be supplied together.');
  }
  if (!hasExplicitOffset(startTime) || !hasExplicitOffset(endTime)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'startTime and endTime must include an explicit UTC offset or a Z suffix.',
    );
  }
  const start = DateTime.fromISO(startTime, { setZone: false });
  const end = DateTime.fromISO(endTime, { setZone: false });
  if (!start.isValid || !end.isValid) {
    throw new AppError(
      'VALIDATION_ERROR',
      'startTime and endTime must be valid ISO 8601 timestamps.',
    );
  }
  if (end <= start) {
    throw new AppError('VALIDATION_ERROR', 'endTime must be after startTime.');
  }
  if (end.diff(start, 'hours').hours > MAX_WINDOW_HOURS) {
    throw new AppError(
      'VALIDATION_ERROR',
      `The assessment window may not exceed ${MAX_WINDOW_HOURS} hours.`,
    );
  }
  return { start, end, implicit: false };
}

export function selectLocalDates(startIso: string, endIso: string, timeZone: string): string[] {
  const start = DateTime.fromISO(startIso).setZone(timeZone);
  const end = DateTime.fromISO(endIso).setZone(timeZone);
  const dates: string[] = [];
  let cursor = start.startOf('day');
  let guard = 0;
  while (cursor < end && guard < 8) {
    dates.push(cursor.toFormat('yyyy-MM-dd'));
    cursor = cursor.plus({ days: 1 });
    guard += 1;
  }
  return dates;
}

export function overlappingHours(
  window: { startTime: string; endTime: string },
  hours: readonly WeatherInterval[],
): WeatherInterval[] {
  const start = DateTime.fromISO(window.startTime);
  const end = DateTime.fromISO(window.endTime);
  return hours.filter((hour) => {
    const hourStart = DateTime.fromISO(hour.time);
    if (!hourStart.isValid) {
      return false;
    }
    const hourEnd = hourStart.plus({ hours: 1 });
    return hourStart < end && hourEnd > start;
  });
}

export function localDaysBetween(fromDate: string, toDate: string, timeZone: string): number {
  const from = DateTime.fromISO(fromDate, { zone: timeZone }).startOf('day');
  const to = DateTime.fromISO(toDate, { zone: timeZone }).startOf('day');
  return Math.floor(to.diff(from, 'days').days);
}
