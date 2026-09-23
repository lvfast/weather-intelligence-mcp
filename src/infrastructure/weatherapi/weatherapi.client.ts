import type { CurrentWeather, WeatherAlert, WeatherForecast } from '../../domain/weather.js';
import type { LocationCandidate, ResolvedLocationRef } from '../../domain/location.js';
import type { EmergencyLimiter, ProviderQuota, WeatherProvider } from '../../domain/ports.js';
import { AppError, isAppError } from '../../domain/errors.js';
import { mapAlerts, mapCurrent, mapForecast, mapSearch } from './weatherapi.mapper.js';
import {
  alertsResponseSchema,
  currentResponseSchema,
  forecastResponseSchema,
  searchResponseSchema,
  weatherApiErrorSchema,
} from './weatherapi.schemas.js';
import type { z } from 'zod';

const DEFAULT_BASE_URL = 'https://api.weatherapi.com/v1';
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_DEADLINE_MS = 8000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_BASE_MS = 250;
const MAX_BACKOFF_MS = 2000;

export interface WeatherApiRequestLogger {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
}

const NOOP_LOGGER: WeatherApiRequestLogger = {
  info: () => undefined,
  warn: () => undefined,
};

export interface WeatherApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  deadlineMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  jitter?: number | (() => number);
  logger?: WeatherApiRequestLogger;
}

interface ErrorCodePayload {
  code: number;
  message: string;
}

type Outcome =
  | { kind: 'success'; payload: unknown }
  | { kind: 'final'; error: AppError }
  | { kind: 'retryable'; error: AppError; retryAfterMs: number | null };

export class WeatherApiClient implements WeatherProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly deadlineMs: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly jitter: () => number;
  private readonly logger: WeatherApiRequestLogger;

  constructor(
    private readonly apiKey: string,
    private readonly quota: ProviderQuota,
    private readonly emergencyLimiter: EmergencyLimiter,
    options: WeatherApiClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    const jitterSource = options.jitter ?? Math.random;
    this.jitter = typeof jitterSource === 'function' ? jitterSource : () => jitterSource;
    this.logger = options.logger ?? NOOP_LOGGER;
  }

  searchLocations(query: string, signal?: AbortSignal): Promise<LocationCandidate[]> {
    return this.request('search.json', { q: query }, searchResponseSchema, mapSearch, signal);
  }

  getCurrent(location: ResolvedLocationRef, signal?: AbortSignal): Promise<CurrentWeather> {
    return this.request(
      'current.json',
      { q: refToQuery(location) },
      currentResponseSchema,
      mapCurrent,
      signal,
    );
  }

  getForecast(
    location: ResolvedLocationRef,
    days: 1 | 2 | 3,
    signal?: AbortSignal,
  ): Promise<WeatherForecast> {
    return this.request(
      'forecast.json',
      { q: refToQuery(location), days: String(days) },
      forecastResponseSchema,
      mapForecast,
      signal,
    );
  }

  getAlerts(location: ResolvedLocationRef, signal?: AbortSignal): Promise<WeatherAlert[]> {
    return this.request(
      'alerts.json',
      { q: refToQuery(location) },
      alertsResponseSchema,
      mapAlerts,
      signal,
    );
  }

  private async request<TInput, TOutput>(
    method: string,
    parameters: Record<string, string>,
    schema: z.ZodType<TInput>,
    transform: (payload: TInput) => TOutput,
    callerSignal?: AbortSignal,
  ): Promise<TOutput> {
    const operationStartedAt = performance.now();
    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(() => {
      deadlineController.abort(new Error('deadline exceeded'));
    }, this.deadlineMs);
    let attempt = 0;
    try {
      for (;;) {
        attempt += 1;
        if (signalAborted(callerSignal)) {
          throw new AppError('REQUEST_CANCELLED', 'The request was cancelled.');
        }
        await this.reserveAttempt();

        const attemptController = new AbortController();
        const timeoutTimer = setTimeout(() => {
          attemptController.abort(new Error('attempt timeout'));
        }, this.timeoutMs);
        const combinedSignal = AbortSignal.any([
          ...(callerSignal === undefined ? [] : [callerSignal]),
          attemptController.signal,
          deadlineController.signal,
        ]);
        try {
          const response = await fetch(this.buildUrl(method, parameters), {
            signal: combinedSignal,
          });
          const outcome = await this.classify(
            response,
            method,
            attempt,
            operationStartedAt,
            performance.now(),
          );
          if (outcome.kind === 'success') {
            const parsed = schema.safeParse(outcome.payload);
            if (!parsed.success) {
              throw new AppError(
                'UPSTREAM_UNAVAILABLE',
                'WeatherAPI returned an unexpected payload.',
                {
                  cause: parsed.error,
                },
              );
            }
            return transform(parsed.data);
          }
          if (outcome.kind === 'retryable' && attempt <= this.maxRetries) {
            await this.backoff(
              outcome.retryAfterMs ?? this.backoffDelayMs(attempt),
              callerSignal,
              deadlineController.signal,
            );
            continue;
          }
          throw outcome.error;
        } catch (error) {
          if (signalAborted(callerSignal)) {
            throw new AppError('REQUEST_CANCELLED', 'The request was cancelled.');
          }
          if (deadlineController.signal.aborted) {
            throw new AppError(
              'UPSTREAM_TIMEOUT',
              'WeatherAPI did not respond within the overall deadline.',
            );
          }
          if (attemptController.signal.aborted) {
            if (attempt <= this.maxRetries) {
              await this.backoff(
                this.backoffDelayMs(attempt),
                callerSignal,
                deadlineController.signal,
              );
              continue;
            }
            throw new AppError(
              'UPSTREAM_TIMEOUT',
              'WeatherAPI did not respond within the attempt timeout.',
            );
          }
          if (isAppError(error)) {
            throw error;
          }
          if (attempt <= this.maxRetries) {
            this.logger.warn(
              { method, upstreamStatus: 'network-error', attempt },
              'WeatherAPI attempt failed with a network error',
            );
            await this.backoff(
              this.backoffDelayMs(attempt),
              callerSignal,
              deadlineController.signal,
            );
            continue;
          }
          throw new AppError('UPSTREAM_UNAVAILABLE', 'WeatherAPI is unreachable.', {
            cause: error,
          });
        } finally {
          clearTimeout(timeoutTimer);
        }
      }
    } finally {
      clearTimeout(deadlineTimer);
    }
  }

  private async reserveAttempt(): Promise<void> {
    try {
      await this.quota.reserve(1);
    } catch (error) {
      if (isAppError(error) && error.code === 'PROVIDER_BUDGET_UNAVAILABLE') {
        await this.emergencyLimiter.reserve(1);
        return;
      }
      throw error;
    }
  }

  private async classify(
    response: Response,
    method: string,
    attempt: number,
    operationStartedAt: number,
    finishedAt: number,
  ): Promise<Outcome> {
    const durationMs = Math.round(finishedAt - operationStartedAt);
    if (response.ok) {
      this.logger.info(
        { method, upstreamStatus: response.status, attempt, durationMs },
        'WeatherAPI attempt succeeded',
      );
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new AppError('UPSTREAM_UNAVAILABLE', 'WeatherAPI returned an unexpected payload.', {
          cause: error,
        });
      }
      return { kind: 'success', payload };
    }

    this.logger.warn(
      { method, upstreamStatus: response.status, attempt, durationMs },
      'WeatherAPI attempt failed',
    );

    if (response.status === 429) {
      const retryAfterMs = this.parseRetryAfter(response.headers.get('retry-after'));
      const remainingDeadlineMs =
        this.deadlineMs - Math.round(performance.now() - operationStartedAt);
      if (retryAfterMs !== null && retryAfterMs <= remainingDeadlineMs) {
        return {
          kind: 'retryable',
          retryAfterMs,
          error: new AppError('UPSTREAM_UNAVAILABLE', 'WeatherAPI rate limit reached.'),
        };
      }
      return {
        kind: 'final',
        error: new AppError('UPSTREAM_UNAVAILABLE', 'WeatherAPI rate limit reached.'),
      };
    }

    if (response.status >= 500) {
      return {
        kind: 'retryable',
        retryAfterMs: null,
        error: new AppError(
          'UPSTREAM_UNAVAILABLE',
          `WeatherAPI is unavailable (HTTP ${response.status}).`,
        ),
      };
    }

    const parsedError = await this.readErrorBody(response);
    if (parsedError !== null) {
      switch (parsedError.code) {
        case 1006:
          return {
            kind: 'final',
            error: new AppError('LOCATION_NOT_FOUND', 'No matching location found.'),
          };
        case 2006:
        case 2008:
          return {
            kind: 'final',
            error: new AppError(
              'UPSTREAM_UNAUTHORIZED',
              'The WeatherAPI key is invalid or disabled.',
            ),
          };
        case 2007:
          return {
            kind: 'final',
            error: new AppError(
              'UPSTREAM_QUOTA_EXCEEDED',
              'The WeatherAPI monthly call quota has been exceeded.',
            ),
          };
        case 2009:
          return {
            kind: 'final',
            error: new AppError(
              'UPSTREAM_PLAN_RESTRICTED',
              'The WeatherAPI plan does not include the requested resource.',
            ),
          };
        default:
          return {
            kind: 'final',
            error: new AppError(
              'UPSTREAM_UNAVAILABLE',
              `WeatherAPI rejected the request with error code ${parsedError.code}.`,
            ),
          };
      }
    }

    return {
      kind: 'final',
      error: new AppError(
        'UPSTREAM_UNAVAILABLE',
        `WeatherAPI rejected the request (HTTP ${response.status}).`,
      ),
    };
  }

  private async readErrorBody(response: Response): Promise<ErrorCodePayload | null> {
    try {
      const body: unknown = await response.json();
      const parsed = weatherApiErrorSchema.safeParse(body);
      return parsed.success ? parsed.data.error : null;
    } catch {
      return null;
    }
  }

  private parseRetryAfter(header: string | null): number | null {
    if (header === null) {
      return null;
    }
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
    const date = Date.parse(header);
    if (Number.isFinite(date)) {
      return Math.max(0, date - Date.now());
    }
    return null;
  }

  private backoffDelayMs(attempt: number): number {
    const base = Math.min(this.backoffBaseMs * 2 ** (attempt - 1), MAX_BACKOFF_MS);
    const factor = 0.5 + this.jitter() / 2;
    return Math.round(base * factor);
  }

  private backoff(
    delayMs: number,
    callerSignal: AbortSignal | undefined,
    deadlineSignal: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (callerSignal?.aborted === true) {
        reject(new AppError('REQUEST_CANCELLED', 'The request was cancelled.'));
        return;
      }
      if (deadlineSignal.aborted) {
        reject(
          new AppError(
            'UPSTREAM_TIMEOUT',
            'WeatherAPI did not respond within the overall deadline.',
          ),
        );
        return;
      }
      const fail = (): void => {
        cleanup();
        if (callerSignal?.aborted === true) {
          reject(new AppError('REQUEST_CANCELLED', 'The request was cancelled.'));
        } else {
          reject(
            new AppError(
              'UPSTREAM_TIMEOUT',
              'WeatherAPI did not respond within the overall deadline.',
            ),
          );
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, delayMs);
      callerSignal?.addEventListener('abort', fail, { once: true });
      deadlineSignal.addEventListener('abort', fail, { once: true });
      const cleanup = (): void => {
        clearTimeout(timer);
        callerSignal?.removeEventListener('abort', fail);
        deadlineSignal.removeEventListener('abort', fail);
      };
    });
  }

  private buildUrl(method: string, parameters: Record<string, string>): string {
    const url = new URL(`${this.baseUrl}/${method}`);
    url.searchParams.set('key', this.apiKey);
    for (const [name, value] of Object.entries(parameters)) {
      url.searchParams.set(name, value);
    }
    return url.toString();
  }
}

function refToQuery(ref: ResolvedLocationRef): string {
  if ('locationId' in ref) {
    return `id:${ref.locationId}`;
  }
  return `${ref.coordinates.lat},${ref.coordinates.lon}`;
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
