import { z } from 'zod';

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  host: string;
  port: number;
  exposureMode: 'local' | 'public';
  hostAllowlist: string[];
  originAllowlist: string[];
  cacheBackend: 'memory' | 'redis';
  redisUrl: string | null;
  cacheMaxEntries: number;
  providerMonthlyBudget: number;
  rateLimitPerMinute: number;
  emergencyLimitPerMinute: number;
  requestDeadlineMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  weatherApiKey: string;
}

type Env = Record<string, string | undefined>;

function parseValue<T>(env: Env, key: string, schema: z.ZodType<T>, fallback?: T): T {
  const raw = env[key];
  if (raw === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`Configuration error: ${key} is required`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ` : '') + issue.message)
      .join('; ');
    throw new Error(`Configuration error: ${key}: ${messages}`);
  }
  return result.data;
}

const nodeEnvSchema = z.enum(['development', 'production', 'test']);
const exposureModeSchema = z.enum(['local', 'public']);
const cacheBackendSchema = z.enum(['memory', 'redis']);
const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
const nonEmptyStringSchema = z.string().min(1);
const commaListSchema = z.string().transform((value) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0),
);
const portSchema = z.coerce.number().int().min(1).max(65_535);
const intSchema = z.coerce.number().int();

export function parseConfig(env: Env = {}): AppConfig {
  const weatherApiKey = parseValue(env, 'WEATHERAPI_KEY', nonEmptyStringSchema);
  const nodeEnv = parseValue(env, 'NODE_ENV', nodeEnvSchema, 'development');
  const host = parseValue(env, 'HOST', nonEmptyStringSchema, '127.0.0.1');
  const port = parseValue(env, 'PORT', portSchema, 3000);
  const exposureMode = parseValue(env, 'EXPOSURE_MODE', exposureModeSchema, 'local');
  const cacheBackend = parseValue(env, 'CACHE_BACKEND', cacheBackendSchema, 'memory');
  const hostAllowlist = parseValue(env, 'HOST_ALLOWLIST', commaListSchema, []);
  const originAllowlist = parseValue(env, 'ORIGIN_ALLOWLIST', commaListSchema, []);
  const cacheMaxEntries = parseValue(
    env,
    'CACHE_MAX_ENTRIES',
    intSchema.min(100).max(10_000),
    1000,
  );
  const providerMonthlyBudget = parseValue(
    env,
    'PROVIDER_MONTHLY_BUDGET',
    intSchema.min(1),
    90_000,
  );
  const rateLimitPerMinute = parseValue(
    env,
    'RATE_LIMIT_PER_MINUTE',
    intSchema.min(1).max(10_000),
    60,
  );
  const emergencyLimitPerMinute = parseValue(
    env,
    'EMERGENCY_LIMIT_PER_MINUTE',
    intSchema.min(1).max(60),
    5,
  );
  const requestDeadlineMs = parseValue(
    env,
    'REQUEST_DEADLINE_MS',
    intSchema.min(100).max(120_000),
    10_000,
  );
  const logLevel = parseValue(env, 'LOG_LEVEL', logLevelSchema, 'info');

  const unsafeBudgetOverride = env.UNSAFE_ALLOW_HIGH_PROVIDER_BUDGET === 'true';
  if (providerMonthlyBudget > 95_000 && !unsafeBudgetOverride) {
    throw new Error(
      'Configuration error: provider budget above 95,000 calls/month requires ' +
        'UNSAFE_ALLOW_HIGH_PROVIDER_BUDGET=true',
    );
  }
  if (providerMonthlyBudget > 100_000) {
    throw new Error(
      'Configuration error: provider budget may not exceed the 100,000 call plan allowance',
    );
  }

  let redisUrl: string | null = null;
  if (cacheBackend === 'redis') {
    redisUrl = parseValue(env, 'REDIS_URL', nonEmptyStringSchema);
  }

  if (exposureMode === 'public') {
    if (cacheBackend !== 'redis') {
      throw new Error('Configuration error: public exposure mode requires a Redis cache backend');
    }
    if (hostAllowlist.length === 0) {
      throw new Error(
        'Configuration error: public exposure mode requires a non-empty host allowlist',
      );
    }
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
    if (loopbackHosts.has(host)) {
      throw new Error(
        'Configuration error: public exposure mode requires an explicit non-loopback bind host',
      );
    }
  }

  return {
    nodeEnv,
    host,
    port,
    exposureMode,
    hostAllowlist,
    originAllowlist,
    cacheBackend,
    redisUrl,
    cacheMaxEntries,
    providerMonthlyBudget,
    rateLimitPerMinute,
    emergencyLimitPerMinute,
    requestDeadlineMs,
    logLevel,
    weatherApiKey,
  };
}
