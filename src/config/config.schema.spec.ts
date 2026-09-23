import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.schema.js';

describe('parseConfig', () => {
  it('requires a WeatherAPI key', () => {
    expect(() => parseConfig({})).toThrowError(/WEATHERAPI_KEY/);
  });

  it('applies local-mode defaults', () => {
    expect(parseConfig({ WEATHERAPI_KEY: 'secret' })).toMatchObject({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 3000,
      exposureMode: 'local',
      cacheBackend: 'memory',
      providerMonthlyBudget: 90_000,
    });
  });

  it('rejects public mode without Redis', () => {
    expect(() =>
      parseConfig({
        WEATHERAPI_KEY: 'secret',
        EXPOSURE_MODE: 'public',
        CACHE_BACKEND: 'memory',
        HOST: '0.0.0.0',
      }),
    ).toThrowError(/public.*Redis/i);
  });

  it('rejects budgets above the safe ceiling without the unsafe override', () => {
    expect(() =>
      parseConfig({ WEATHERAPI_KEY: 'secret', PROVIDER_MONTHLY_BUDGET: '95001' }),
    ).toThrowError(/UNSAFE_ALLOW_HIGH_PROVIDER_BUDGET/);
  });

  it('allows budgets above the safe ceiling only with the unsafe override', () => {
    expect(
      parseConfig({
        WEATHERAPI_KEY: 'secret',
        PROVIDER_MONTHLY_BUDGET: '97000',
        UNSAFE_ALLOW_HIGH_PROVIDER_BUDGET: 'true',
      }).providerMonthlyBudget,
    ).toBe(97_000);
  });

  it('caps the budget at the provider plan allowance', () => {
    expect(() =>
      parseConfig({
        WEATHERAPI_KEY: 'secret',
        PROVIDER_MONTHLY_BUDGET: '100001',
        UNSAFE_ALLOW_HIGH_PROVIDER_BUDGET: 'true',
      }),
    ).toThrowError(/100,000/);
  });

  it('requires a Redis URL when the Redis cache backend is selected', () => {
    expect(() => parseConfig({ WEATHERAPI_KEY: 'secret', CACHE_BACKEND: 'redis' })).toThrowError(
      /REDIS_URL/,
    );
  });

  it('requires a non-empty host allowlist in public mode', () => {
    expect(() =>
      parseConfig({
        WEATHERAPI_KEY: 'secret',
        EXPOSURE_MODE: 'public',
        CACHE_BACKEND: 'redis',
        REDIS_URL: 'redis://127.0.0.1:6379',
        HOST: '0.0.0.0',
      }),
    ).toThrowError(/host allowlist/i);
  });

  it('requires an explicit non-loopback bind host in public mode', () => {
    expect(() =>
      parseConfig({
        WEATHERAPI_KEY: 'secret',
        EXPOSURE_MODE: 'public',
        CACHE_BACKEND: 'redis',
        REDIS_URL: 'redis://127.0.0.1:6379',
        HOST_ALLOWLIST: 'demo.example.com',
      }),
    ).toThrowError(/bind host/i);
  });

  it('accepts a fully configured public mode', () => {
    const config = parseConfig({
      WEATHERAPI_KEY: 'secret',
      EXPOSURE_MODE: 'public',
      CACHE_BACKEND: 'redis',
      REDIS_URL: 'redis://127.0.0.1:6379',
      HOST: '0.0.0.0',
      HOST_ALLOWLIST: 'demo.example.com, localhost:3000',
      ORIGIN_ALLOWLIST: 'https://demo.example.com',
    });
    expect(config.hostAllowlist).toEqual(['demo.example.com', 'localhost:3000']);
    expect(config.originAllowlist).toEqual(['https://demo.example.com']);
    expect(config.redisUrl).toBe('redis://127.0.0.1:6379');
  });

  it('parses and bounds numeric settings', () => {
    expect(parseConfig({ WEATHERAPI_KEY: 'secret', PORT: '8080' }).port).toBe(8080);
    expect(() => parseConfig({ WEATHERAPI_KEY: 'secret', PORT: '0' })).toThrowError(/PORT/);
    expect(() => parseConfig({ WEATHERAPI_KEY: 'secret', CACHE_MAX_ENTRIES: '99' })).toThrowError(
      /CACHE_MAX_ENTRIES/,
    );
    expect(
      parseConfig({ WEATHERAPI_KEY: 'secret', CACHE_MAX_ENTRIES: '5000' }).cacheMaxEntries,
    ).toBe(5000);
    expect(() =>
      parseConfig({ WEATHERAPI_KEY: 'secret', RATE_LIMIT_PER_MINUTE: '0' }),
    ).toThrowError(/RATE_LIMIT_PER_MINUTE/);
    expect(() =>
      parseConfig({ WEATHERAPI_KEY: 'secret', EMERGENCY_LIMIT_PER_MINUTE: '1000' }),
    ).toThrowError(/EMERGENCY_LIMIT_PER_MINUTE/);
    expect(() => parseConfig({ WEATHERAPI_KEY: 'secret', REQUEST_DEADLINE_MS: '50' })).toThrowError(
      /REQUEST_DEADLINE_MS/,
    );
  });

  it('rejects invalid enum values', () => {
    expect(() => parseConfig({ WEATHERAPI_KEY: 'secret', NODE_ENV: 'staging' })).toThrowError(
      /NODE_ENV/,
    );
    expect(() => parseConfig({ WEATHERAPI_KEY: 'secret', EXPOSURE_MODE: 'internet' })).toThrowError(
      /EXPOSURE_MODE/,
    );
    expect(() =>
      parseConfig({ WEATHERAPI_KEY: 'secret', CACHE_BACKEND: 'filesystem' }),
    ).toThrowError(/CACHE_BACKEND/);
  });
});
