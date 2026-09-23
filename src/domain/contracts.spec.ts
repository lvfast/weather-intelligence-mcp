import { describe, expect, it } from 'vitest';
import { AppError, isAppError } from './errors.js';
import { locationInputSchema } from './location.js';

describe('locationInputSchema', () => {
  it('rejects zero or multiple location forms', () => {
    expect(locationInputSchema.safeParse({}).success).toBe(false);
    expect(locationInputSchema.safeParse({ query: 'Paris', locationId: '1' }).success).toBe(false);
    expect(
      locationInputSchema.safeParse({ query: 'Paris', coordinates: { lat: 1, lon: 2 } }).success,
    ).toBe(false);
  });

  it('rejects blank queries', () => {
    expect(locationInputSchema.safeParse({ query: '   ' }).success).toBe(false);
    expect(locationInputSchema.safeParse({ query: '' }).success).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    expect(locationInputSchema.safeParse({ coordinates: { lat: 91, lon: 0 } }).success).toBe(false);
    expect(locationInputSchema.safeParse({ coordinates: { lat: -90.1, lon: 0 } }).success).toBe(
      false,
    );
    expect(locationInputSchema.safeParse({ coordinates: { lat: 0, lon: -181 } }).success).toBe(
      false,
    );
  });

  it('accepts each location form', () => {
    expect(locationInputSchema.safeParse({ query: 'Paris' }).success).toBe(true);
    expect(locationInputSchema.safeParse({ locationId: 'opaque-1' }).success).toBe(true);
    expect(
      locationInputSchema.safeParse({ coordinates: { lat: 48.8566, lon: 2.3522 } }).success,
    ).toBe(true);
    expect(locationInputSchema.safeParse({ coordinates: { lat: -90, lon: 180 } }).success).toBe(
      true,
    );
  });

  it('rejects unknown fields', () => {
    expect(locationInputSchema.safeParse({ query: 'Paris', extra: true }).success).toBe(false);
    expect(
      locationInputSchema.safeParse({ coordinates: { lat: 1, lon: 2, altitude: 3 } }).success,
    ).toBe(false);
  });
});

describe('AppError', () => {
  it('carries a taxonomy code, safe message, details, and cause', () => {
    const cause = new Error('root');
    const error = new AppError('UPSTREAM_TIMEOUT', 'provider timed out', {
      details: { attempt: 2 },
      cause,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe('UPSTREAM_TIMEOUT');
    expect(error.message).toBe('provider timed out');
    expect(error.details).toEqual({ attempt: 2 });
    expect(error.cause).toBe(cause);
  });

  it('classifies retryable codes by default and allows override', () => {
    expect(new AppError('UPSTREAM_TIMEOUT', 'x').retryable).toBe(true);
    expect(new AppError('UPSTREAM_UNAVAILABLE', 'x').retryable).toBe(true);
    expect(new AppError('UPSTREAM_UNAUTHORIZED', 'x').retryable).toBe(false);
    expect(new AppError('UPSTREAM_QUOTA_EXCEEDED', 'x').retryable).toBe(false);
    expect(new AppError('LOCATION_NOT_FOUND', 'x', { retryable: true }).retryable).toBe(true);
  });

  it('is identifiable through the shared guard', () => {
    expect(isAppError(new AppError('INTERNAL_ERROR', 'boom'))).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});
