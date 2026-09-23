import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import { Inject } from '@nestjs/common';
import {
  ACTIVITIES,
  type AssessWeatherInput,
  type AssessmentContext,
  type AssessmentSlot,
  type AssessmentSource,
  type WeatherAssessment,
} from '../../domain/assessment.js';
import { AppError } from '../../domain/errors.js';
import type { Location, LocationInput } from '../../domain/location.js';
import {
  CLOCK,
  LOCATION_SERVICE,
  WEATHER_SERVICE,
  type Clock,
  type ServiceResult,
} from '../../domain/ports.js';
import type {
  CurrentWeather,
  WeatherAlertsResult,
  WeatherForecast,
  WeatherInterval,
} from '../../domain/weather.js';
import { evaluateWeatherRules } from '../../rules/rule-engine.js';
import {
  localDaysBetween,
  overlappingHours,
  parseAssessmentTimes,
  selectLocalDates,
} from './time-window.js';

export interface LocationResolver {
  requireResolved(input: LocationInput, signal?: AbortSignal): Promise<Location>;
}

export interface WeatherPort {
  getCurrent(input: LocationInput, signal?: AbortSignal): Promise<ServiceResult<CurrentWeather>>;
  getForecast(
    input: LocationInput,
    options: { days: 1 | 2 | 3; includeHourly: boolean },
    signal?: AbortSignal,
  ): Promise<ServiceResult<WeatherForecast>>;
  getAlerts(
    input: LocationInput,
    signal?: AbortSignal,
  ): Promise<ServiceResult<WeatherAlertsResult>>;
}

export class AssessmentService {
  constructor(
    @Inject(LOCATION_SERVICE) private readonly locations: LocationResolver,
    @Inject(WEATHER_SERVICE) private readonly weather: WeatherPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async assess(
    input: AssessWeatherInput,
    signal?: AbortSignal,
  ): Promise<ServiceResult<WeatherAssessment>> {
    if (!ACTIVITIES.includes(input.activity)) {
      throw new AppError(
        'VALIDATION_ERROR',
        'activity must be one of commute, running, travel, outdoor_event.',
      );
    }
    const window = parseAssessmentTimes(input.startTime, input.endTime, this.clock);
    const location = await this.locations.requireResolved(input.location, signal);
    const timeZone = location.timeZone;
    const now = DateTime.fromJSDate(this.clock.now(), { zone: timeZone });

    if (!window.implicit) {
      const horizon = now.plus({ days: 3 });
      if (window.end > horizon) {
        throw new AppError(
          'FORECAST_WINDOW_UNAVAILABLE',
          'The assessment window extends beyond the available three-day forecast horizon.',
        );
      }
      if (window.end <= now) {
        throw new AppError(
          'FORECAST_WINDOW_UNAVAILABLE',
          'The assessment window lies entirely in the past.',
        );
      }
    }

    const windowStartIso = window.start.toISO() as string;
    const windowEndIso = window.end.toISO() as string;
    const localDates = selectLocalDates(windowStartIso, windowEndIso, timeZone);
    const todayLocal = now.toISODate() as string;
    const lastLocalDate = localDates[localDates.length - 1] ?? todayLocal;
    const forecastDays = Math.min(
      3,
      Math.max(1, localDaysBetween(todayLocal, lastLocalDate, timeZone) + 1),
    ) as 1 | 2 | 3;

    const [currentResult, forecastResult, alertsResult] = await Promise.all([
      window.implicit ? this.weather.getCurrent(input.location, signal) : Promise.resolve(null),
      this.weather.getForecast(input.location, { days: forecastDays, includeHourly: true }, signal),
      this.weather.getAlerts(input.location, signal),
    ]);

    const forecastHours = forecastResult.data.days.flatMap((day) => day.hours ?? []);
    const slots = this.buildSlots(window, currentResult, forecastHours);
    const requiredSlots = Math.max(
      1,
      Math.ceil((window.end.toMillis() - window.start.toMillis()) / 3_600_000),
    );
    if (slots.length < requiredSlots) {
      throw new AppError(
        'FORECAST_WINDOW_UNAVAILABLE',
        'Returned weather data does not fully cover the assessment window.',
      );
    }

    const anyStale =
      (currentResult?.meta.stale ?? false) || forecastResult.meta.stale || alertsResult.meta.stale;
    const anyCached =
      (currentResult?.meta.cached ?? false) ||
      forecastResult.meta.cached ||
      alertsResult.meta.cached;
    const dataQuality = anyStale ? 'degraded' : 'normal';

    const source: AssessmentSource = {
      provider: 'weatherapi',
      cached: anyCached,
      stale: anyStale,
      coverage: 'forecast-and-limited-alerts',
    };

    const observedAt = [
      currentResult?.data.observedAt,
      forecastResult.data.generatedAt,
      alertsResult.data.observedAt,
    ]
      .filter((value): value is string => value !== undefined && value !== null)
      .sort()
      .at(-1) as string;

    const context: AssessmentContext = {
      activity: input.activity,
      location: { name: location.name, timeZone },
      window: { startTime: windowStartIso, endTime: windowEndIso },
      slots,
      alerts: alertsResult.data.alerts,
      dataQuality,
    };
    const core = evaluateWeatherRules(context);

    const assessment: WeatherAssessment = {
      activity: input.activity,
      location,
      window: { startTime: windowStartIso, endTime: windowEndIso, timeZone },
      riskScore: core.riskScore,
      riskLevel: core.riskLevel,
      recommendation: core.recommendation,
      summary: core.summary,
      triggeredRules: core.triggeredRules,
      evidence: core.evidence,
      mitigations: core.mitigations,
      ruleVersion: core.ruleVersion,
      source,
      observedAt,
      dataQuality,
    };

    return {
      data: assessment,
      meta: {
        requestId: randomUUID(),
        provider: 'weatherapi',
        fetchedAt: observedAt,
        cached: false,
        stale: false,
        warnings: dataQuality === 'degraded' ? ['STALE_DATA'] : [],
      },
    };
  }

  private buildSlots(
    window: { start: DateTime; end: DateTime; implicit: boolean },
    currentResult: ServiceResult<CurrentWeather> | null,
    forecastHours: WeatherInterval[],
  ): AssessmentSlot[] {
    const slots: AssessmentSlot[] = [];
    if (window.implicit && currentResult !== null) {
      const now = window.start;
      const slotEnd = DateTime.min(now.plus({ hours: 1 }), window.end);
      slots.push(
        this.intervalToSlot(
          currentResult.data.interval,
          'current',
          now.toISO() as string,
          slotEnd.toISO() as string,
        ),
      );
      const remaining = {
        startTime: slotEnd.toISO() as string,
        endTime: window.end.toISO() as string,
      };
      for (const hour of overlappingHours(remaining, forecastHours)) {
        slots.push(this.hourToSlot(hour, 'forecast'));
      }
    } else {
      for (const hour of overlappingHours(
        { startTime: window.start.toISO() as string, endTime: window.end.toISO() as string },
        forecastHours,
      )) {
        slots.push(this.hourToSlot(hour, 'forecast'));
      }
    }
    return slots;
  }

  private hourToSlot(hour: WeatherInterval, source: 'forecast'): AssessmentSlot {
    const end = DateTime.fromISO(hour.time, { setZone: false }).plus({ hours: 1 });
    return this.intervalToSlot(hour, source, hour.time, end.toISO() as string);
  }

  private intervalToSlot(
    interval: WeatherInterval,
    source: 'current' | 'forecast',
    startTime: string,
    endTime: string,
  ): AssessmentSlot {
    return {
      window: { startTime, endTime },
      source,
      condition: interval.condition,
      temperatureC: interval.temperatureC,
      feelsLikeC: interval.feelsLikeC,
      precipitationMm: interval.precipitationMm,
      humidityPercent: interval.humidityPercent,
      cloudCoverPercent: interval.cloudCoverPercent,
      precipitationChancePercent: interval.precipitationChancePercent,
      windKph: interval.windKph,
      gustKph: interval.gustKph,
      visibilityKm: interval.visibilityKm,
      uvIndex: interval.uvIndex,
    };
  }
}
