export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'LOCATION_NOT_FOUND',
  'LOCATION_AMBIGUOUS',
  'FORECAST_WINDOW_UNAVAILABLE',
  'UPSTREAM_UNAUTHORIZED',
  'UPSTREAM_QUOTA_EXCEEDED',
  'UPSTREAM_PLAN_RESTRICTED',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_UNAVAILABLE',
  'PROVIDER_BUDGET_EXHAUSTED',
  'PROVIDER_BUDGET_UNAVAILABLE',
  'CACHE_UNAVAILABLE',
  'RATE_LIMITED',
  'REQUEST_CANCELLED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const RETRYABLE_CODES = new Set<ErrorCode>([
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_UNAVAILABLE',
  'CACHE_UNAVAILABLE',
  'PROVIDER_BUDGET_UNAVAILABLE',
]);

export interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
  retryable?: boolean;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(code);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
