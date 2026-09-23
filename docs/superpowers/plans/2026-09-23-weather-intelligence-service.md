# Weather Intelligence Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-minded NestJS backend that exposes normalized WeatherAPI data and deterministic activity-risk assessments through REST, MCP stdio, and stateless MCP Streamable HTTP.

**Architecture:** Implement one ports-and-adapters application core. Plain TypeScript domain code sits behind NestJS application services; WeatherAPI, Redis/memory cache, provider quota, REST, and MCP are adapters. REST and MCP share request schemas and application result types, with parity tests preventing semantic drift.

**Tech Stack:** Node.js 24 LTS, NestJS 12.0.4, TypeScript 6.0.x ESM, Zod 4, Vitest, official MCP TypeScript SDK v2, Redis, Luxon, Pino-compatible Nest logging, Docker Compose, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-23-weather-intelligence-service-design.md`

## Global Constraints

- Use Node.js 24 LTS, NestJS 12.0.4, TypeScript 6.0.x, ESM, Zod 4, Vitest, and official MCP TypeScript SDK v2.
- Pin every direct dependency exactly and commit `package-lock.json`; use `npm ci` in CI.
- WeatherAPI.com Free plan is the only provider: 100,000 calls/month, one-to-three-day forecasts, limited alerts.
- Default provider budget is 90,000 calls/month; never exceed 95,000 without the explicit unsafe override from the spec.
- Domain and rule files import no NestJS, HTTP, MCP, Redis, or WeatherAPI DTO types.
- REST controllers and MCP handlers call the same application services; neither calls WeatherAPI or Redis directly.
- JSON fields are camelCase, weather units are metric, and timestamps are ISO 8601 with an explicit offset.
- Unknown input fields are rejected. Provider payloads and errors are validated and never exposed raw.
- `stdio` reserves stdout for MCP protocol traffic; all logs use stderr.
- HTTP defaults to `127.0.0.1`; public mode requires Redis, host allowlist, request limits, and configured exposure safeguards.
- No frontend, relational database, authentication, additional provider, persistent history, or runtime-editable rule configuration.

## Review Focus

- A disconnect during retry backoff must abort the operation and must not consume a later provider quota reservation; Task 5 pins this behavior.
- A DST transition or offset-less assessment timestamp must not select the wrong local forecast day; Task 8 pins both cases.
- A failed in-flight cached request must be removed so the next caller can retry; Task 3 pins rejection cleanup.
- Redis loss in public mode must not create unlimited provider traffic; Task 4 and Task 9 pin readiness plus the five-attempt emergency ceiling.
- REST and MCP ambiguity, stale-data, quota-exhaustion, and upstream-outage responses must remain semantically equivalent; Task 11 pins parity for all five cases.

---

## Planned File Map

```text
src/
  app.module.ts                         # Shared Nest composition root
  entrypoints/http.ts                   # REST + Streamable HTTP bootstrap
  entrypoints/stdio.ts                  # MCP stdio bootstrap
  config/config.schema.ts               # Strict environment parsing
  config/config.module.ts               # Typed configuration provider
  domain/
    errors.ts                           # Stable application error taxonomy
    location.ts                         # Location inputs, candidates, results
    weather.ts                          # Normalized current/forecast/alert types
    assessment.ts                       # Assessment context/result types
    ports.ts                            # Provider/cache/quota/clock interfaces and tokens
  rules/
    thresholds.ts                       # Versioned activity thresholds
    weather-rules.ts                    # Pure per-slot and alert rules
    rule-engine.ts                      # Deterministic aggregation
  infrastructure/
    clock/system-clock.ts               # Production clock adapter
    cache/cache-keys.ts                 # Canonical key construction
    cache/memory-cache.store.ts         # Bounded LRU cache
    cache/redis-cache.store.ts          # Redis cache adapter
    cache/single-flight.ts              # Per-process request coalescing
    cache/cache.module.ts               # Backend selection
    quota/memory-provider-quota.ts       # Per-process monthly quota
    quota/redis-provider-quota.ts        # Atomic shared monthly quota
    quota/emergency-limiter.ts           # Redis-outage safety ceiling
    quota/quota.module.ts                # Quota adapter selection
    weatherapi/weatherapi.schemas.ts     # Strict upstream response schemas
    weatherapi/condition-map.ts          # Provider code normalization
    weatherapi/weatherapi.mapper.ts      # Provider DTO to domain mapping
    weatherapi/weatherapi.client.ts      # Timeout/retry/cancellation/error mapping
    weatherapi/weatherapi.module.ts      # Provider binding
  application/
    location/location.service.ts         # Strict resolution workflow
    location/location.module.ts
    weather/weather.service.ts           # Cache-aside weather use cases
    weather/weather.module.ts
    assessment/time-window.ts            # Timezone/window selection
    assessment/assessment.service.ts     # Weather orchestration + rules
    assessment/assessment.module.ts
  interfaces/
    common/schemas.ts                    # Shared Zod request/output schemas
    rest/rest.controllers.ts             # Five REST capabilities
    rest/rest-exception.filter.ts        # Error-to-HTTP mapping
    rest/http-protection.ts              # Host/origin/deadline/body/rate guards
    rest/rest.module.ts
    mcp/mcp-tools.ts                     # Five tool definitions and handlers
    mcp/mcp-result.ts                    # Structured/text/error mapping
    mcp/mcp.factory.ts                   # Per-connection/request MCP server factory
    mcp/mcp.module.ts
    health/health.controller.ts          # Liveness/readiness
    health/health.module.ts
  observability/logger.ts                # Redacted structured logger
test/
  fixtures/weatherapi/*.json             # Deterministic upstream payloads
  helpers/fakes.ts                        # Shared fake ports and builders
  integration/*.integration.spec.ts      # Redis/provider adapter tests
  e2e/*.e2e.spec.ts                      # REST/MCP transports
  contract/interface-parity.spec.ts      # Cross-interface semantic parity
  live/weatherapi.live.spec.ts            # Opt-in real-provider smoke test
.github/workflows/ci.yml                  # Full quality pipeline
Dockerfile                               # Multi-stage non-root image
compose.yaml                             # App + Redis demo stack
.env.example                             # Safe configuration sample
README.md                                # Setup, API, MCP client examples
```

Tests colocated under `src/**/*.spec.ts` are unit/application tests. `test/` contains tests that cross adapter or process boundaries.

For Tasks 3, 4, 9, 11, and 13, start the pinned integration Redis before running Redis-backed tests:

```powershell
docker run --rm -d --name wis-test-redis -p 6379:6379 redis:8.2.1-alpine
$env:TEST_REDIS_URL='redis://127.0.0.1:6379'
```

After the owning tests finish, stop it with `docker stop wis-test-redis`. Never point integration tests at a shared or production Redis instance; the suites flush their `wis:test:<run-id>:` namespace.

### Task 1: Establish the ESM NestJS Walking Skeleton and Typed Contracts

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `vitest.config.ts`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `src/config/config.schema.ts`
- Create: `src/config/config.module.ts`
- Create: `src/domain/errors.ts`
- Create: `src/domain/location.ts`
- Create: `src/domain/weather.ts`
- Create: `src/domain/assessment.ts`
- Create: `src/domain/ports.ts`
- Create: `src/app.module.ts`
- Create: `src/entrypoints/http.ts`
- Create: `src/entrypoints/stdio.ts`
- Test: `src/config/config.schema.spec.ts`
- Test: `src/domain/contracts.spec.ts`

**Interfaces:**
- Consumes: The approved specification only.
- Produces: `AppError`, all domain types, `WeatherProvider`, `CacheStore`, `ProviderQuota`, `Clock`, DI tokens, `parseConfig(env)`, and build/test scripts used by every later task.

- [ ] **Step 1: Initialize pinned production and development dependencies**

Run:

```powershell
npm init -y
npm install --save-exact @nestjs/common@12.0.4 @nestjs/core@12.0.4 @nestjs/platform-express@12.0.4 @nestjs/config@latest @nestjs/swagger@latest @nestjs/terminus@latest @nestjs/throttler@latest @modelcontextprotocol/server@2.0.0 @modelcontextprotocol/node@2.0.0 zod@latest redis@latest luxon@latest reflect-metadata@latest rxjs@latest pino@latest
npm install --save-dev --save-exact typescript@6.0.3 @types/node@latest @types/luxon@latest vitest@latest @vitest/coverage-v8@latest eslint@latest typescript-eslint@latest prettier@latest supertest@latest @types/supertest@latest tsx@latest
```

Then verify every direct entry in `dependencies` and `devDependencies` is an exact version with no `^` or `~`.

- [ ] **Step 2: Write failing configuration and contract tests**

Create tests with these assertions:

```ts
expect(() => parseConfig({})).toThrowError(/WEATHERAPI_KEY/);
expect(parseConfig({ WEATHERAPI_KEY: 'secret' })).toMatchObject({
  nodeEnv: 'development', host: '127.0.0.1', port: 3000,
  exposureMode: 'local', cacheBackend: 'memory', providerMonthlyBudget: 90_000,
});
expect(() => parseConfig({
  WEATHERAPI_KEY: 'secret', EXPOSURE_MODE: 'public', CACHE_BACKEND: 'memory', HOST: '0.0.0.0',
})).toThrowError(/public.*Redis/i);
expect(() => parseConfig({ WEATHERAPI_KEY: 'secret', PROVIDER_MONTHLY_BUDGET: '95001' }))
  .toThrowError(/UNSAFE_ALLOW_HIGH_PROVIDER_BUDGET/);
expect(locationInputSchema.safeParse({ query: 'Paris', locationId: '1' }).success).toBe(false);
expect(locationInputSchema.safeParse({ coordinates: { lat: 91, lon: 0 } }).success).toBe(false);
```

- [ ] **Step 3: Run the focused tests and verify red**

Run: `npm test -- src/config/config.schema.spec.ts src/domain/contracts.spec.ts`

Expected: FAIL because config parsing and domain schemas do not exist.

- [ ] **Step 4: Define scripts, TypeScript configuration, domain types, ports, errors, and strict config**

Set `package.json` to ESM and define at least:

```json
{
  "type": "module",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "lint": "eslint .",
    "format:check": "prettier --check .",
    "start:http": "node dist/entrypoints/http.js",
    "start:stdio": "node dist/entrypoints/stdio.js"
  }
}
```

Define the canonical ports exactly as:

```ts
export interface WeatherProvider {
  searchLocations(query: string, signal?: AbortSignal): Promise<LocationCandidate[]>;
  getCurrent(location: ResolvedLocationRef, signal?: AbortSignal): Promise<CurrentWeather>;
  getForecast(location: ResolvedLocationRef, days: 1 | 2 | 3, signal?: AbortSignal): Promise<WeatherForecast>;
  getAlerts(location: ResolvedLocationRef, signal?: AbortSignal): Promise<WeatherAlert[]>;
}
export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  health(): Promise<'up' | 'down'>;
}
export interface ProviderQuota { reserve(attempts: number): Promise<QuotaReservation>; }
export interface Clock { now(): Date; }
export const WEATHER_PROVIDER = Symbol('WEATHER_PROVIDER');
export const CACHE_STORE = Symbol('CACHE_STORE');
export const PROVIDER_QUOTA = Symbol('PROVIDER_QUOTA');
export const CLOCK = Symbol('CLOCK');
```

Define the shared wrappers used by later tasks exactly as:

```ts
export interface ServiceResult<T> { data: T; meta: ResultMeta; }
export interface CacheEntry<T> {
  value: T;
  fetchedAt: string;
  freshUntil: string;
  staleUntil: string | null;
}
export interface QuotaReservation {
  granted: true;
  used: number;
  limit: number;
  resetsAt: string;
  mode: 'shared' | 'process' | 'emergency';
}
```

Make `AppError` carry one code from Section 20 of the spec, a safe message, optional safe details, and optional cause. Implement a strict Zod environment schema with the defaults and constraints in Sections 16-19.

- [ ] **Step 5: Add minimal composition roots without product behavior**

`AppModule` imports only the typed configuration module at this stage. `http.ts` creates and closes a Nest application; `stdio.ts` creates and closes a Nest application context. Do not register routes or MCP tools yet.

- [ ] **Step 6: Run baseline quality checks**

Run:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all commands PASS; tests prove strict unions, ranges, config defaults, and public-mode rejection.

- [ ] **Step 7: Commit the walking skeleton**

```powershell
git add package.json package-lock.json tsconfig.json tsconfig.build.json vitest.config.ts eslint.config.js .prettierrc.json .gitignore src
git commit -m "chore: bootstrap weather intelligence service"
```

### Task 2: Implement the Pure Explainable Rule Engine

**Files:**
- Create: `src/rules/thresholds.ts`
- Create: `src/rules/weather-rules.ts`
- Create: `src/rules/rule-engine.ts`
- Test: `src/rules/weather-rules.spec.ts`
- Test: `src/rules/rule-engine.spec.ts`
- Modify: `src/domain/assessment.ts`
- Modify: `src/domain/weather.ts`

**Interfaces:**
- Consumes: `WeatherInterval`, `WeatherAlert`, `Activity`, `AssessmentContext` from Task 1.
- Produces: `RULESET_VERSION = 'weather-activity-rules/1.0.0'`, `evaluateWeatherRules(context): WeatherAssessmentCore`, stable rule IDs, findings, risk bands, and recommendations.

- [ ] **Step 1: Write table-driven boundary tests for every threshold**

Use a table shaped like:

```ts
it.each([
  ['running.rain.moderate', 'running', 'precipitationMm', 0.99, false],
  ['running.rain.moderate', 'running', 'precipitationMm', 1, true],
  ['running.rain.moderate', 'running', 'precipitationMm', 1.01, true],
  ['commute.gust.severe', 'commute', 'gustKph', 79.99, false],
  ['commute.gust.severe', 'commute', 'gustKph', 80, true],
])('%s at %s=%s', (ruleId, activity, field, value, expected) => {
  const findings = evaluateSlotRules(slot({ [field]: value }), activity as Activity);
  expect(findings.some((finding) => finding.ruleId === ruleId)).toBe(expected);
});
```

Cover every moderate/high/severe boundary in the spec, thunder intensity, compound running heat/humidity, outdoor-event rain coverage, and all alert severities.

- [ ] **Step 2: Write aggregation tests**

Pin these cases:

```ts
expect(aggregate([finding('high', 40), finding('moderate', 20)]).riskScore).toBe(60);
expect(aggregate([finding('severe', 70), finding('high', 40)]).riskScore).toBe(100);
expect(resultForTwoSlots(20, 40).riskScore).toBe(40);
expect(aggregateWithAlert([], 'Severe').riskScore).toBe(40);
expect(aggregateDegraded([])).toMatchObject({ riskScore: 20, riskLevel: 'moderate', recommendation: 'caution' });
expect(duplicateBandsForOneHazard()).toHaveLength(1);
expect(findings.map((x) => x.ruleId)).toEqual([...findings.map((x) => x.ruleId)].sort(stableSeverityComparator));
```

- [ ] **Step 3: Run the rule tests and verify red**

Run: `npm test -- src/rules/weather-rules.spec.ts src/rules/rule-engine.spec.ts`

Expected: FAIL because rule evaluation and aggregation are absent.

- [ ] **Step 4: Implement thresholds and pure rule evaluation**

Encode the exact table from specification Section 15.3 as readonly typed data. Use stable IDs in the form `<activity>.<hazard>.<band>` and `universal.thunderstorm.<band>`. `evaluateSlotRules` must select only the highest matching band per hazard and return complete `RuleFinding` values with observed values, operators, thresholds, units, window, message, and mitigation.

- [ ] **Step 5: Implement deterministic aggregation**

Expose:

```ts
export function evaluateWeatherRules(context: AssessmentContext): WeatherAssessmentCore;
export function scoreToRisk(score: number): RiskLevel;
export function riskToRecommendation(risk: RiskLevel): Recommendation;
```

Aggregate by slot maximum, cap at 100, apply official-alert and stale-data floors, deduplicate mitigations, identify the worst window, and sort findings deterministically.

- [ ] **Step 6: Verify rule purity and coverage**

Run:

```powershell
npm test -- src/rules
npm run typecheck
npm run test:coverage -- src/rules
```

Expected: PASS with 100% branch coverage for `src/rules/**`.

- [ ] **Step 7: Commit the rules**

```powershell
git add src/domain src/rules
git commit -m "feat: add explainable weather rule engine"
```

### Task 3: Implement Cache Keys, Memory LRU, Redis Cache, and Single-flight

**Files:**
- Create: `src/infrastructure/cache/cache-keys.ts`
- Create: `src/infrastructure/cache/memory-cache.store.ts`
- Create: `src/infrastructure/cache/redis-cache.store.ts`
- Create: `src/infrastructure/cache/single-flight.ts`
- Create: `src/infrastructure/cache/cache.module.ts`
- Test: `src/infrastructure/cache/cache-keys.spec.ts`
- Test: `src/infrastructure/cache/memory-cache.store.spec.ts`
- Test: `src/infrastructure/cache/single-flight.spec.ts`
- Test: `test/integration/redis-cache.integration.spec.ts`
- Create: `vitest.integration.config.ts`

**Interfaces:**
- Consumes: `CacheStore`, `CacheEntry<T>`, configuration, and clock from Task 1.
- Produces: `buildCacheKey(resource, location, parameters)`, `MemoryCacheStore`, `RedisCacheStore`, `SingleFlight`, and `CacheModule` binding `CACHE_STORE`.

- [ ] **Step 1: Write cache key and memory behavior tests**

Pin canonical behavior:

```ts
expect(buildLocationSearchKey('  HÀ   NỘI ')).toBe(buildLocationSearchKey('hà nội'));
expect(buildCoordinateKey(10.123456, 106.987654)).toContain('10.1235,106.9877');
expect(buildForecastKey(ref, { includeHourly: false, days: 3 }))
  .toBe(buildForecastKey(ref, { days: 3, includeHourly: false }));
expect(allGeneratedKeys.every((key) => !key.includes('weather-api-secret'))).toBe(true);
```

Use a fake clock to verify fresh, stale-but-retained, expired, and LRU eviction behavior at the exact boundaries from Section 16.3.

- [ ] **Step 2: Write the single-flight rejection-cleanup test**

```ts
const flight = new SingleFlight();
const failing = vi.fn().mockRejectedValueOnce(new Error('first')).mockResolvedValueOnce('second');
await expect(flight.run('k', failing)).rejects.toThrow('first');
await expect(flight.run('k', failing)).resolves.toBe('second');
expect(failing).toHaveBeenCalledTimes(2);
```

Also verify 20 concurrent callers execute the loader once and receive the same value.

- [ ] **Step 3: Run unit tests and verify red**

Run: `npm test -- src/infrastructure/cache`

Expected: FAIL because cache implementations do not exist.

- [ ] **Step 4: Implement canonical keys, memory LRU, and single-flight**

`CacheEntry<T>` stores `value`, `fetchedAt`, `freshUntil`, and `staleUntil`. Use a `Map` insertion order for a bounded LRU; touch entries on read; delete entries older than `staleUntil`. Store negative location results for five minutes with no stale window. Remove in-flight promises in `finally`.

- [ ] **Step 5: Write Redis integration tests**

With `TEST_REDIS_URL`, assert round-trip serialization, expiry, version mismatch as a cache miss, delete, and `health()` transitions. Prefix serialized records with schema version `1` and validate the envelope before returning it.

- [ ] **Step 6: Implement Redis cache and backend selection**

Use one connected Redis client owned by `CacheModule`. `CACHE_BACKEND=memory` binds a bounded `MemoryCacheStore`; `redis` binds `RedisCacheStore`. Do not silently switch implementations after startup.

- [ ] **Step 7: Run cache unit and integration tests**

Run:

```powershell
npm test -- src/infrastructure/cache
$env:TEST_REDIS_URL='redis://127.0.0.1:6379'; npm run test:integration -- test/integration/redis-cache.integration.spec.ts
npm run typecheck
```

Expected: unit tests PASS; integration test PASS when Redis is available and otherwise skips with an explicit message only when `TEST_REDIS_URL` is absent.

- [ ] **Step 8: Commit caching**

```powershell
git add src/infrastructure/cache src/domain/ports.ts test/integration/redis-cache.integration.spec.ts vitest.integration.config.ts
git commit -m "feat: add memory and Redis cache adapters"
```

### Task 4: Implement Provider Budget and Redis-outage Emergency Limiting

**Files:**
- Create: `src/infrastructure/quota/memory-provider-quota.ts`
- Create: `src/infrastructure/quota/redis-provider-quota.ts`
- Create: `src/infrastructure/quota/emergency-limiter.ts`
- Create: `src/infrastructure/quota/quota.module.ts`
- Test: `src/infrastructure/quota/memory-provider-quota.spec.ts`
- Test: `src/infrastructure/quota/emergency-limiter.spec.ts`
- Test: `test/integration/redis-provider-quota.integration.spec.ts`
- Modify: `src/domain/ports.ts`

**Interfaces:**
- Consumes: `ProviderQuota`, `Clock`, config, and Redis connection from Tasks 1 and 3.
- Produces: `MemoryProviderQuota.reserve(attempts)`, `RedisProviderQuota.reserve(attempts)`, `EmergencyLimiter.reserve()`, and `QuotaModule` binding `PROVIDER_QUOTA`.

- [ ] **Step 1: Write monthly-budget tests**

```ts
await expect(quota.reserve(1)).resolves.toMatchObject({ granted: true, used: 1, limit: 90_000 });
clock.set('2026-09-30T23:59:59Z');
await quota.reserve(89_999);
await expect(quota.reserve(1)).rejects.toMatchObject({ code: 'PROVIDER_BUDGET_EXHAUSTED' });
clock.set('2026-10-01T00:00:00Z');
await expect(quota.reserve(1)).resolves.toMatchObject({ used: 1 });
```

Verify a denied reservation does not call the provider by using a spy at the use-site boundary.

- [ ] **Step 2: Write emergency limiter tests**

Use a fake monotonic clock. Assert exactly five grants in one rolling minute, denial of the sixth, allowance after 60 seconds, and that `reserve(2)` consumes two attempt slots for a retrying operation.

- [ ] **Step 3: Run quota unit tests and verify red**

Run: `npm test -- src/infrastructure/quota`

Expected: FAIL because quota adapters do not exist.

- [ ] **Step 4: Implement memory and emergency adapters**

Use the UTC `YYYY-MM` key for monthly budget. Reservations are monotonic and never refunded. Throw `AppError('PROVIDER_BUDGET_EXHAUSTED', ...)` on exhaustion and `AppError('PROVIDER_BUDGET_UNAVAILABLE', ...)` when neither shared budget nor emergency reservation can be made.

- [ ] **Step 5: Write and implement the Redis atomic reservation test**

Launch 100 concurrent one-attempt reservations against a budget of 50. Assert exactly 50 grants and 50 normalized rejections, the stored count is 50, and key TTL extends past the next UTC month boundary but is finite. Implement the decision in one Lua script or one Redis function so increment and limit enforcement are atomic.

- [ ] **Step 6: Wire quota backend selection**

Memory cache mode uses `MemoryProviderQuota`. Redis mode uses `RedisProviderQuota`; if Redis fails after startup, callers must explicitly use `EmergencyLimiter` through the provider-call coordinator rather than replacing the monthly counter.

- [ ] **Step 7: Run unit, integration, and type checks**

Run:

```powershell
npm test -- src/infrastructure/quota
$env:TEST_REDIS_URL='redis://127.0.0.1:6379'; npm run test:integration -- test/integration/redis-provider-quota.integration.spec.ts
npm run typecheck
```

Expected: PASS, including atomic concurrency and month rollover.

- [ ] **Step 8: Commit quota protection**

```powershell
git add src/infrastructure/quota src/domain/ports.ts test/integration/redis-provider-quota.integration.spec.ts
git commit -m "feat: protect WeatherAPI provider quota"
```

### Task 5: Build the Validated WeatherAPI Adapter with Retry and Cancellation

**Files:**
- Create: `src/infrastructure/weatherapi/weatherapi.schemas.ts`
- Create: `src/infrastructure/weatherapi/condition-map.ts`
- Create: `src/infrastructure/weatherapi/weatherapi.mapper.ts`
- Create: `src/infrastructure/weatherapi/weatherapi.client.ts`
- Create: `src/infrastructure/weatherapi/weatherapi.module.ts`
- Create: `test/fixtures/weatherapi/search.json`
- Create: `test/fixtures/weatherapi/current.json`
- Create: `test/fixtures/weatherapi/forecast.json`
- Create: `test/fixtures/weatherapi/alerts.json`
- Test: `src/infrastructure/weatherapi/condition-map.spec.ts`
- Test: `src/infrastructure/weatherapi/weatherapi.mapper.spec.ts`
- Test: `test/integration/weatherapi-client.integration.spec.ts`

**Interfaces:**
- Consumes: `WeatherProvider`, `ProviderQuota`, `EmergencyLimiter`, domain weather types, typed config, and `AbortSignal`.
- Produces: `WeatherApiClient implements WeatherProvider`, strict upstream schemas, normalized condition mapping, and `WeatherApiModule` binding `WEATHER_PROVIDER`.

- [ ] **Step 1: Save minimal deterministic provider fixtures and write schema/mapping tests**

Fixtures must include only fields the mapper consumes plus provider error bodies. Test:

```ts
expect(mapSearch(searchFixture)[0]).toMatchObject({
  locationId: expect.any(String), name: expect.any(String), latitude: expect.any(Number),
});
expect(mapCurrent(currentFixture).condition).toMatchObject({ category: 'rain', intensity: 'light' });
expect(mapForecast(forecastFixture).days).toHaveLength(3);
expect(mapAlerts(alertFixture)[0]).toMatchObject({ severity: 'Moderate' });
expect(() => currentResponseSchema.parse({ location: {}, current: { temp_c: 'hot' } })).toThrow();
```

- [ ] **Step 2: Write condition-code tests**

Cover every WeatherAPI condition code used by the Free-plan responses, with explicit cases for clear/cloud/fog/rain/snow/sleet/thunderstorm/other and light/moderate/heavy/unknown. Pin heavy thunder mapping independently from localized condition text.

- [ ] **Step 3: Run mapper tests and verify red**

Run: `npm test -- src/infrastructure/weatherapi`

Expected: FAIL because schemas and mappers do not exist.

- [ ] **Step 4: Implement strict schemas and pure mappers**

Parse `search.json`, `current.json`, `forecast.json`, and `alerts.json` independently. Convert provider local timestamps using returned `tz_id` and epoch fields, emit ISO timestamps with offsets, convert protocol-relative icon URLs to HTTPS only if included, and reject impossible numeric values. Preserve no raw response object.

- [ ] **Step 5: Write HTTP behavior integration tests with a local stub server**

Test these exact scenarios:

```ts
it('retries two 500 responses, succeeds on the third, and reserves three calls');
it('does not retry WeatherAPI error 1006 location not found');
it('maps 2006 to UPSTREAM_UNAUTHORIZED and 2007 to UPSTREAM_QUOTA_EXCEEDED');
it('maps 2009 to UPSTREAM_PLAN_RESTRICTED without exposing the raw body');
it('times out one attempt at three seconds and the whole operation by eight seconds');
it('does not start the next retry when the caller aborts during backoff');
it('does not reserve quota for a retry that cancellation prevents');
it('does not issue HTTP when provider budget reservation is denied');
```

Use fake timers for backoff and a random source fixed to `0.5` so jitter is deterministic.

- [ ] **Step 6: Run the client integration test and verify red**

Run: `npm run test:integration -- test/integration/weatherapi-client.integration.spec.ts`

Expected: FAIL because the client is absent.

- [ ] **Step 7: Implement request coordination**

Build requests against fixed base URL `https://api.weatherapi.com/v1`; send the key only as WeatherAPI's required `key` query parameter. Before every attempt call `ProviderQuota.reserve(1)`. When Redis quota access is unavailable, require `EmergencyLimiter.reserve(1)` before the attempt. Compose caller cancellation, per-attempt timeout, and overall deadline into abort signals. Retry only the conditions in specification Section 18, honoring a usable `Retry-After` only inside the overall deadline.

- [ ] **Step 8: Add safe provider error mapping and redaction**

Parse WeatherAPI error code/status into the shared taxonomy. Log method name, upstream status, attempt, and duration, but never the full URL, query string, key, or raw body. A malformed success payload becomes `UPSTREAM_UNAVAILABLE` with its validation failure retained only as the internal cause.

- [ ] **Step 9: Verify adapter tests**

Run:

```powershell
npm test -- src/infrastructure/weatherapi
npm run test:integration -- test/integration/weatherapi-client.integration.spec.ts
npm run typecheck
```

Expected: PASS; cancellation test proves no later quota reservation or HTTP attempt occurs.

- [ ] **Step 10: Commit the provider adapter**

```powershell
git add src/infrastructure/weatherapi test/fixtures/weatherapi test/integration/weatherapi-client.integration.spec.ts
git commit -m "feat: integrate WeatherAPI with resilient client"
```

### Task 6: Implement Strict Location Resolution

**Files:**
- Create: `src/application/location/location.service.ts`
- Create: `src/application/location/location.module.ts`
- Test: `src/application/location/location.service.spec.ts`
- Modify: `test/helpers/fakes.ts`
- Modify: `src/domain/ports.ts`

**Interfaces:**
- Consumes: `WeatherProvider`, `CacheStore`, `SingleFlight`, `LocationInput`, `ResolvedLocationLookup`, and location cache-key helpers.
- Produces: `LocationService.resolve(input, options?, signal?)`, `LocationResolution = resolved | ambiguous | not_found`, and the `ResolvedLocationLookup` port/token that Task 7 implements.

- [ ] **Step 1: Add reusable fake ports and location builders**

Create typed fakes whose methods are Vitest spies and builders with deterministic defaults. A test must be able to override provider results, cache entries, clock time, and quota results without importing infrastructure adapters.

- [ ] **Step 2: Write resolution workflow tests**

Pin:

```ts
expect(await service.resolve({ query: 'Paris' })).toMatchObject({ status: 'resolved' });
expect(await service.resolve({ query: 'Springfield' })).toMatchObject({ status: 'ambiguous', candidates: expect.any(Array) });
expect(await service.resolve({ query: 'missing' })).toEqual({ status: 'not_found', candidates: [] });
expect(await service.resolve({ locationId: 'opaque-1' })).toMatchObject({ status: 'resolved' });
expect(await service.resolve({ coordinates: { lat: 10.7769, lon: 106.7009 } })).toMatchObject({ status: 'resolved' });
expect(provider.searchLocations).not.toHaveBeenCalledOnSecondIdenticalNormalizedQuery();
expect(await twentyConcurrentResolutions()).toHaveOneProviderCall();
```

Also assert positive search TTL 24 hours, negative TTL five minutes, positive stale window seven days, limit default 5/range 1-10, and that more than one candidate is never auto-selected.

- [ ] **Step 3: Run focused tests and verify red**

Run: `npm test -- src/application/location/location.service.spec.ts`

Expected: FAIL because `LocationService` is absent.

- [ ] **Step 4: Implement location resolution**

For `query`, read cache, run a single-flight provider search on miss, cache a bounded candidate list, and return the strict result union. For `locationId` and coordinates, depend on this port rather than calling the provider directly:

```ts
export interface ResolvedLocationLookup {
  lookup(ref: ResolvedLocationRef, signal?: AbortSignal): Promise<Location>;
}
export const RESOLVED_LOCATION_LOOKUP = Symbol('RESOLVED_LOCATION_LOOKUP');
```

Tests inject a fake lookup. Do not import `WeatherService`, which does not exist until Task 7, and do not import infrastructure adapters.

Expose two methods so Task 7 can distinguish discovery from a required location:

```ts
resolve(input: LocationInput, options?: { limit?: number }, signal?: AbortSignal): Promise<LocationResolution>;
requireResolved(input: LocationInput, signal?: AbortSignal): Promise<Location>;
```

`requireResolved` throws `LOCATION_NOT_FOUND`, throws `LOCATION_AMBIGUOUS` with safe candidates, and returns the sole resolved location.

- [ ] **Step 5: Verify application behavior**

Run:

```powershell
npm test -- src/application/location
npm run typecheck
```

Expected: PASS with no infrastructure imports beyond ports and cache-key functions.

- [ ] **Step 6: Commit location resolution**

```powershell
git add src/application/location src/domain/ports.ts test/helpers/fakes.ts
git commit -m "feat: add strict location resolution"
```

### Task 7: Implement Cached Weather Application Services

**Files:**
- Create: `src/application/weather/weather.service.ts`
- Create: `src/application/weather/weather.module.ts`
- Test: `src/application/weather/weather.service.spec.ts`
- Modify: `src/application/location/location.service.ts`
- Modify: `src/infrastructure/cache/cache-keys.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `LocationService`, `ResolvedLocationLookup`, `WeatherProvider`, `CacheStore`, `SingleFlight`, clock, cache keys, and normalized domain types.
- Produces: `getCurrent`, `getForecast`, and `getAlerts`, each returning `{ data, meta }` with cache/stale provenance, plus the concrete `ResolvedLocationLookup` binding.

The public signatures are:

```ts
getCurrent(input: LocationInput, signal?: AbortSignal): Promise<ServiceResult<CurrentWeather>>;
getForecast(
  input: LocationInput,
  options: { days: 1 | 2 | 3; includeHourly: boolean },
  signal?: AbortSignal,
): Promise<ServiceResult<WeatherForecast>>;
getAlerts(input: LocationInput, signal?: AbortSignal): Promise<ServiceResult<WeatherAlertsResult>>;
```

- [ ] **Step 1: Write current-weather cache-aside tests**

Cover fresh hit, miss, ten-minute freshness, stale fallback up to 30 minutes only after retryable provider failure, stale rejection after 30 minutes, and no stale fallback for validation/auth/quota errors. Assert `cached` and `stale` metadata exactly.

- [ ] **Step 2: Write forecast and alerts tests**

Cover:

```ts
await expect(service.getForecast(input, { days: 0, includeHourly: false })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
await expect(service.getForecast(input, { days: 4, includeHourly: false })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
expect((await service.getForecast(input, { days: 3, includeHourly: false })).data.days[0]).not.toHaveProperty('hours');
expect((await service.getForecast(input, { days: 3, includeHourly: true })).data.days[0].hours).toHaveLength(24);
expect((await service.getAlerts(input)).data).toMatchObject({ coverage: 'limited', alerts: [] });
```

Pin forecast 60-minute freshness/six-hour stale window and alert five-minute freshness/no stale behavior.

- [ ] **Step 3: Write Redis-failure decision tests**

When configured Redis reads fail, assert the service proceeds only if provider-call coordination grants an emergency reservation. When the limiter denies, assert no WeatherAPI call and normalized `PROVIDER_BUDGET_UNAVAILABLE` or `CACHE_UNAVAILABLE` according to the failure point.

- [ ] **Step 4: Run service tests and verify red**

Run: `npm test -- src/application/weather/weather.service.spec.ts`

Expected: FAIL because weather use cases are absent.

- [ ] **Step 5: Implement one generic cache-aside helper and three use cases**

Use a private generic flow equivalent to:

```ts
loadCached<T>({
  key, freshTtlSeconds, staleMaxAgeSeconds, allowStale,
  loader, signal,
}): Promise<ServiceResult<T>>;
```

Return fresh cache immediately. Coalesce misses. On retryable provider failure, return eligible stale data only for current/forecast and append a stable warning code. Never cache unexpected failures. Keep alert `coverage: 'limited'` even for an empty list.

- [ ] **Step 6: Resolve the location/current circular workflow explicitly**

Implement `ResolvedLocationLookup.lookup(ref, signal)` with an internal `getCurrentByRef(ref, signal)` path and bind it to `RESOLVED_LOCATION_LOOKUP`. It must use the same key, cache, provider, quota, and resilience path as public `getCurrent`. `LocationService` depends only on that token, so no `forwardRef()` or circular module import is allowed.

- [ ] **Step 7: Verify weather services and module graph**

Run:

```powershell
npm test -- src/application/location src/application/weather
npm run typecheck
npm run build
```

Expected: PASS; Nest dependency graph boots without `forwardRef()` if the lookup port is extracted correctly.

- [ ] **Step 8: Commit weather use cases**

```powershell
git add src/application src/infrastructure/cache/cache-keys.ts src/app.module.ts
git commit -m "feat: add cached weather use cases"
```

### Task 8: Implement Timezone-aware Assessment Orchestration

**Files:**
- Create: `src/application/assessment/time-window.ts`
- Create: `src/application/assessment/assessment.service.ts`
- Create: `src/application/assessment/assessment.module.ts`
- Test: `src/application/assessment/time-window.spec.ts`
- Test: `src/application/assessment/assessment.service.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `LocationService`, `WeatherService`, `Clock`, `evaluateWeatherRules`, and assessment/domain types.
- Produces: `AssessmentService.assess(input, signal?): Promise<ServiceResult<WeatherAssessment>>`, timezone/window helpers, and the complete required assessment contract.

- [ ] **Step 1: Write input and time-window tests**

Cover explicit-offset enforcement, paired start/end requirement, positive duration, 72-hour maximum, past/unavailable window rejection, and implicit now-to-two-hours window. Include:

```ts
expect(() => parseAssessmentTimes('2026-09-23T10:00:00', '2026-09-23T12:00:00')).toThrow(/offset/i);
expect(selectLocalDates('2026-11-01T00:30:00-04:00', '2026-11-01T03:30:00-05:00', 'America/New_York'))
  .toEqual(['2026-11-01']);
expect(overlappingHours(window('10:30', '11:30'), [hour('10:00'), hour('11:00'), hour('12:00')]))
  .toHaveLength(2);
```

- [ ] **Step 2: Write orchestration tests**

Pin that assessment:

- Resolves once and stops on ambiguity before weather calls.
- Uses current plus forecast for the implicit window.
- Uses forecast hours for an explicit future window.
- Always requests alerts.
- Requests only one-to-three forecast days based on location-local dates.
- Carries limited-alert coverage into `source`.
- Chooses newest used data timestamp for `observedAt`.
- Does not cache the final assessment.
- Floors stale-input results to moderate/caution with `dataQuality: 'degraded'`.

- [ ] **Step 3: Run assessment tests and verify red**

Run: `npm test -- src/application/assessment`

Expected: FAIL because time-window helpers and service are absent.

- [ ] **Step 4: Implement timezone/window helpers**

Use Luxon with IANA zones. Treat assessment windows as half-open. Calculate local calendar dates with zone conversion, never by adding 24-hour milliseconds. Reject intervals that cannot be fully covered by returned hourly data with `FORECAST_WINDOW_UNAVAILABLE`.

- [ ] **Step 5: Implement `AssessmentService`**

The service resolves location, constructs the window, loads current/forecast/alerts in parallel where dependencies allow, selects overlapping intervals, builds `AssessmentContext`, calls the pure engine, and decorates its result with location, source, `observedAt`, `ruleVersion`, summary, and deduplicated mitigations.

Use the exact public signature:

```ts
assess(input: AssessWeatherInput, signal?: AbortSignal): Promise<ServiceResult<WeatherAssessment>>;
```

- [ ] **Step 6: Verify timezone and assessment coverage**

Run:

```powershell
npm test -- src/application/assessment src/rules
npm run typecheck
npm run test:coverage -- src/application/assessment
```

Expected: PASS, including offset-less rejection and DST case.

- [ ] **Step 7: Commit assessment orchestration**

```powershell
git add src/application/assessment src/app.module.ts
git commit -m "feat: orchestrate weather condition assessments"
```

### Task 9: Expose the REST API, OpenAPI, Health, Logging, and HTTP Safeguards

**Files:**
- Create: `src/interfaces/common/schemas.ts`
- Create: `src/interfaces/rest/rest.controllers.ts`
- Create: `src/interfaces/rest/rest-exception.filter.ts`
- Create: `src/interfaces/rest/http-protection.ts`
- Create: `src/interfaces/rest/rest.module.ts`
- Create: `src/interfaces/health/health.controller.ts`
- Create: `src/interfaces/health/health.module.ts`
- Create: `src/observability/logger.ts`
- Modify: `src/entrypoints/http.ts`
- Modify: `src/app.module.ts`
- Create: `vitest.e2e.config.ts`
- Test: `test/e2e/rest.e2e.spec.ts`
- Test: `test/e2e/http-protection.e2e.spec.ts`
- Test: `test/contract/openapi.spec.ts`

**Interfaces:**
- Consumes: Location, weather, and assessment application services; shared domain results and errors.
- Produces: all `/api/v1` routes, health routes, `/docs`, `/docs-json`, strict shared Zod schemas, request-ID propagation, safe REST error envelopes, structured logging, and HTTP protection used by `/mcp` in Task 10.

- [ ] **Step 1: Define shared schemas and write REST happy-path tests**

Define strict Zod schemas for every application request/result before controller code. In a Nest test application with mocked services, pin:

```ts
await request(app).get('/api/v1/locations/resolve').query({ q: 'Paris' }).expect(200);
await request(app).get('/api/v1/weather/current').query({ locationId: 'opaque-1' }).expect(200);
await request(app).get('/api/v1/weather/forecast').query({ lat: 10.7, lon: 106.7, days: 3, includeHourly: true }).expect(200);
await request(app).get('/api/v1/weather/alerts').query({ q: 'Paris' }).expect(200);
await request(app).post('/api/v1/weather/assessments').send({
  location: { query: 'Paris' }, activity: 'running',
  startTime: '2026-09-24T06:00:00+02:00', endTime: '2026-09-24T08:00:00+02:00',
}).expect(201);
```

Assert controllers call the injected services once and return the standard `{ data, meta }` envelope without reimplementing calculations.

- [ ] **Step 2: Write REST validation and error mapping tests**

Cover unknown fields, multiple location forms, partial coordinates, invalid days/limit/activity/timestamps, body over 64 KiB, and these mappings:

```text
VALIDATION_ERROR -> 400
LOCATION_NOT_FOUND -> 404
LOCATION_AMBIGUOUS -> 409 with safe candidates
FORECAST_WINDOW_UNAVAILABLE -> 422
RATE_LIMITED -> 429
UPSTREAM_UNAUTHORIZED -> 502
UPSTREAM_QUOTA_EXCEEDED -> 503
UPSTREAM_PLAN_RESTRICTED -> 502
UPSTREAM_TIMEOUT -> 504
UPSTREAM_UNAVAILABLE -> 503
PROVIDER_BUDGET_EXHAUSTED -> 503
PROVIDER_BUDGET_UNAVAILABLE -> 503
CACHE_UNAVAILABLE -> 503
REQUEST_CANCELLED -> 499 when the socket remains writable; otherwise no response write
INTERNAL_ERROR -> 500
```

Assert errors never contain a secret, upstream query string/body, internal cause, or stack.

- [ ] **Step 3: Write health and HTTP protection tests**

Pin:

- `/health/live` returns 200 without touching Redis or WeatherAPI.
- `/health/ready` returns 200 in memory mode, 200 with healthy configured Redis, and 503 when configured Redis is down.
- Local mode rejects non-local Host headers.
- Public mode refuses bootstrap without Redis and non-empty host allowlist.
- A disallowed Host is rejected on both REST and a temporary `/mcp` probe route.
- Present-but-disallowed Origin is rejected; an absent Origin is allowed when Host is allowed.
- The 61st request in a rolling minute is 429 at the default limit.
- Request deadline creates an abort signal after 10 seconds.
- Redis loss in public mode leaves readiness at 503 and does not disable provider emergency ceilings.

- [ ] **Step 4: Run REST tests and verify red**

Run:

```powershell
npm run test:e2e -- test/e2e/rest.e2e.spec.ts test/e2e/http-protection.e2e.spec.ts
npm test -- test/contract/openapi.spec.ts
```

Expected: FAIL because HTTP adapters are absent.

- [ ] **Step 5: Implement strict request parsing and controllers**

Convert query parameters explicitly before validating with strict schemas. Keep `GET /locations/resolve` ambiguity/not-found as HTTP 200 business results; map ambiguity/not-found from other routes as specified. Pass the request abort signal to every application service. Set/propagate `X-Request-Id` using a generated UUID when the client value is absent or invalid.

- [ ] **Step 6: Implement the global exception filter and redacted logger**

`RestExceptionFilter` converts only known `AppError` details and replaces unknown errors with `INTERNAL_ERROR`. Logger serializers remove keys matching `key`, `apiKey`, `authorization`, `cookie`, and redact URL query strings. In stdio mode configure the logger destination as stderr.

- [ ] **Step 7: Implement host/origin/body/deadline/rate protection**

Apply safeguards before REST and `/mcp` routing. Local mode keeps in-memory rate state; public mode uses Redis and fails closed for rate-state loss except health endpoints. CORS is disabled for an empty list and allowlist-based otherwise. Limit parsed bodies to 65,536 bytes.

- [ ] **Step 8: Implement health and Swagger/OpenAPI**

Generate OpenAPI from the same schemas/classes used at the boundary. Document all success and error shapes, ambiguity responses, units, limited-alert coverage, and assessment enums. The OpenAPI contract test must assert route/method presence, no duplicate operation IDs, and successful schema validation.

- [ ] **Step 9: Verify HTTP behavior**

Run:

```powershell
npm run test:e2e -- test/e2e/rest.e2e.spec.ts test/e2e/http-protection.e2e.spec.ts
npm test -- test/contract/openapi.spec.ts
npm run typecheck
npm run build
```

Expected: PASS; health tests prove zero provider calls.

- [ ] **Step 10: Commit REST and operations surface**

```powershell
git add src/interfaces src/observability src/entrypoints/http.ts src/app.module.ts vitest.e2e.config.ts test/e2e test/contract/openapi.spec.ts
git commit -m "feat: expose protected REST weather API"
```

### Task 10: Expose Five MCP Tools over Stdio and Streamable HTTP

**Files:**
- Create: `src/interfaces/mcp/mcp-result.ts`
- Create: `src/interfaces/mcp/mcp-tools.ts`
- Create: `src/interfaces/mcp/mcp.factory.ts`
- Create: `src/interfaces/mcp/mcp.module.ts`
- Modify: `src/entrypoints/http.ts`
- Modify: `src/entrypoints/stdio.ts`
- Modify: `src/app.module.ts`
- Test: `src/interfaces/mcp/mcp-result.spec.ts`
- Test: `test/e2e/mcp-http.e2e.spec.ts`
- Test: `test/e2e/mcp-stdio.e2e.spec.ts`
- Create: `test/fixtures/stdio-test-server.ts`

**Interfaces:**
- Consumes: shared Zod schemas and the four application services; official MCP SDK v2.
- Produces: `createMcpServer(services, logger)`, five registered tools, stateless `/mcp`, stdio transport, canonical `structuredContent`, and concise text compatibility content.

- [ ] **Step 1: Write MCP result-mapping unit tests**

Assert:

```ts
expect(toMcpSuccess(serviceResult).structuredContent).toEqual(serviceResult);
expect(toMcpSuccess(serviceResult).content).toEqual([{ type: 'text', text: expect.any(String) }]);
expect(toMcpLocationResolution(ambiguous).structuredContent).toMatchObject({ status: 'location_resolution_required' });
expect(toMcpError(new AppError('LOCATION_NOT_FOUND', 'Location not found'))).toMatchObject({ isError: true });
expect(JSON.stringify(toMcpError(secretCause))).not.toContain('weather-api-secret');
```

The text summary must be generated from the structured result and remain under 1,000 characters.

- [ ] **Step 2: Write Streamable HTTP MCP tests with the official client**

Connect to `/mcp`, list tools, and assert exactly:

```text
resolve_location
get_current_weather
get_weather_forecast
get_weather_alerts
assess_weather_conditions
```

Call each tool and validate `structuredContent` against its declared output schema. Verify a new stateless request lifecycle works for sequential client calls, Host/Origin safeguards cover `/mcp`, and unsupported GET/DELETE session operations receive the SDK-defined stateless response.

- [ ] **Step 3: Write stdio process tests**

Spawn `node --import tsx test/fixtures/stdio-test-server.ts`, a test-only composition root that overrides `WEATHER_PROVIDER`, `CACHE_STORE`, `PROVIDER_QUOTA`, and `CLOCK` with deterministic fakes before connecting the production MCP factory to stdio. Do not add a fake-provider switch to production configuration. Use the official MCP client over stdio to initialize, list, and call tools. Capture streams separately and assert every stdout frame is valid MCP protocol traffic while diagnostic JSON appears only on stderr.

- [ ] **Step 4: Run MCP tests and verify red**

Run:

```powershell
npm test -- src/interfaces/mcp/mcp-result.spec.ts
npm run test:e2e -- test/e2e/mcp-http.e2e.spec.ts test/e2e/mcp-stdio.e2e.spec.ts
```

Expected: FAIL because MCP adapters are absent.

- [ ] **Step 5: Implement the shared MCP factory and tool registry**

Register tools from a single array of definitions. Reuse the shared strict input/output schemas. Every handler only validates, calls one application service method, and maps its result. Set read-only and non-destructive tool annotations explicitly.

Use these handler-to-service mappings:

```text
resolve_location -> LocationService.resolve
get_current_weather -> WeatherService.getCurrent
get_weather_forecast -> WeatherService.getForecast
get_weather_alerts -> WeatherService.getAlerts
assess_weather_conditions -> AssessmentService.assess
```

- [ ] **Step 6: Mount stateless Streamable HTTP**

Use the official SDK v2 handler/factory API with the SDK's 2025-era stateless compatibility path. Construct protocol state at the lifecycle required by the SDK rather than reusing a stateless transport incorrectly. Adapt the web-standard handler into the Nest/Node server at `/mcp`, behind the protection middleware from Task 9.

- [ ] **Step 7: Implement the stdio bootstrap**

Create the Nest application context, resolve application services, create the same MCP server definition, connect stdio, route logger output to stderr, and register signal handlers that close MCP, Nest, Redis, and pending provider requests once.

- [ ] **Step 8: Verify both MCP transports**

Run:

```powershell
npm run build
npm test -- src/interfaces/mcp
npm run test:e2e -- test/e2e/mcp-http.e2e.spec.ts test/e2e/mcp-stdio.e2e.spec.ts
```

Expected: PASS; both transports list the same five tools and return schema-valid structured output.

- [ ] **Step 9: Commit MCP interfaces**

```powershell
git add src/interfaces/mcp src/entrypoints src/app.module.ts test/e2e/mcp-http.e2e.spec.ts test/e2e/mcp-stdio.e2e.spec.ts
git commit -m "feat: expose weather intelligence MCP tools"
```

### Task 11: Prove Cross-interface Semantic Parity and Failure Semantics

**Files:**
- Create: `test/contract/interface-parity.spec.ts`
- Create: `test/contract/schema-contracts.spec.ts`
- Modify: `test/helpers/fakes.ts`
- Modify: `src/interfaces/common/schemas.ts`
- Modify: `src/interfaces/rest/rest.controllers.ts`
- Modify: `src/interfaces/mcp/mcp-tools.ts`

**Interfaces:**
- Consumes: running REST and MCP HTTP adapters backed by the same deterministic fake application services.
- Produces: a parity harness that compares canonical semantic results after stripping transport-only metadata.

- [ ] **Step 1: Build a canonical comparison helper**

Implement in the test file:

```ts
function canonicalize(value: unknown): unknown {
  return deepSort(removePaths(value, [
    'meta.requestId', 'error.requestId', 'content', 'isError',
  ]));
}
```

Do not remove `cached`, `stale`, warnings, risk fields, candidates, error codes, or source coverage.

- [ ] **Step 2: Write happy-path parity cases for all capabilities**

For one query, one location ID, and one coordinate input, invoke equivalent REST and MCP operations and assert canonical equality for resolve, current, forecast daily, forecast hourly, alerts, and all four activities.

- [ ] **Step 3: Write failure/workflow parity cases**

Pin the five Review Focus cases plus input validation:

```ts
it.each([
  'LOCATION_AMBIGUOUS',
  'STALE_DATA',
  'PROVIDER_BUDGET_EXHAUSTED',
  'UPSTREAM_UNAVAILABLE',
  'LOCATION_NOT_FOUND',
  'VALIDATION_ERROR',
])('preserves %s semantics across REST and MCP', async (scenario) => { /* invoke both adapters */ });
```

For ambiguity, compare candidate arrays even though REST uses 409 outside resolve and MCP uses a successful workflow result. For errors, compare normalized code and safe details rather than transport status flags.

- [ ] **Step 4: Run parity tests and observe any drift**

Run: `npm test -- test/contract/interface-parity.spec.ts test/contract/schema-contracts.spec.ts`

Expected: tests may initially FAIL on adapter-only naming/envelope differences; no application service or rule duplication is permitted as a fix.

- [ ] **Step 5: Centralize any drifting mappings**

Move shared request conversion and result schema definitions into `interfaces/common/schemas.ts`. Keep only protocol-specific envelope/error mapping in REST/MCP files. Validate every MCP `structuredContent` and REST `data` result with the same corresponding output schema before returning it.

- [ ] **Step 6: Run full contract and transport suite**

Run:

```powershell
npm test -- test/contract
npm run test:e2e
npm run typecheck
```

Expected: PASS with semantic parity for every capability and listed failure mode.

- [ ] **Step 7: Commit parity guarantees**

```powershell
git add test/contract test/helpers/fakes.ts src/interfaces/common src/interfaces/rest src/interfaces/mcp
git commit -m "test: enforce REST and MCP semantic parity"
```

### Task 12: Add Docker, CI, Documentation, and Final Verification

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `compose.yaml`
- Create: `.env.example`
- Create: `.github/workflows/ci.yml`
- Create: `README.md`
- Create: `test/live/weatherapi.live.spec.ts`
- Modify: `package.json`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: complete service and all test commands.
- Produces: non-root image, app+Redis demo stack, offline CI, opt-in live smoke test, and handoff-quality documentation for REST, Codex, Claude, and OpenClaw.

- [ ] **Step 1: Write an opt-in live smoke test**

Gate the suite on both `RUN_LIVE_WEATHERAPI_TESTS=true` and `WEATHERAPI_KEY`. Make one `get_current_weather` application call for `London`, assert normalized metric fields and provider name, and set a test-specific provider budget of one. Default `npm test` must report it skipped and make no network request.

- [ ] **Step 2: Add coverage and final scripts**

Set coverage thresholds to 85% statements/lines/functions and 80% branches globally, while retaining 100% branch coverage for `src/rules/**`. Add:

```json
{
  "test:all": "npm run test:coverage && npm run test:integration && npm run test:e2e",
  "test:live": "vitest run test/live/weatherapi.live.spec.ts",
  "start:dev:http": "node --watch --import tsx src/entrypoints/http.ts",
  "start:dev:stdio": "node --watch --import tsx src/entrypoints/stdio.ts"
}
```

`tsx` is already pinned by Task 1; do not add an alternate runtime transpiler.

- [ ] **Step 3: Create the production container and Compose stack**

The Dockerfile must:

- Build with `npm ci` in a Node 24 image.
- Copy only production artifacts/dependencies into the runtime stage.
- Run as a non-root user.
- Use `node dist/entrypoints/http.js` as the default command.
- Expose only port 3000.

Compose must define `app` and `redis`, use Redis persistence only for realistic local restart behavior, configure `CACHE_BACKEND=redis`, set `EXPOSURE_MODE=local`, include health checks, and read `WEATHERAPI_KEY` from the environment without embedding it.

- [ ] **Step 4: Create the CI workflow**

Use Node 24 and a pinned Redis container image. Run:

```text
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run test:integration
npm run test:e2e
npm run build
docker build .
```

Do not supply a real WeatherAPI key. Cache npm downloads, not `node_modules`. Upload coverage as an artifact even if a later step fails.

- [ ] **Step 5: Write `.env.example` and README**

Document every configuration key with safe defaults and constraints. README must include:

- Architecture and why one core serves REST and MCP.
- WeatherAPI Free-plan limitations and limited-alert meaning.
- Local memory-cache startup and Docker Compose Redis startup.
- REST curl examples for all five capabilities.
- Swagger/OpenAPI locations.
- Codex, Claude Desktop, and OpenClaw stdio configuration examples using absolute paths and `WEATHERAPI_KEY` in client-managed environment configuration.
- Streamable HTTP endpoint example at `http://127.0.0.1:3000/mcp`.
- Rule explanation example including evidence and `ruleVersion`.
- Test commands, opt-in live test, security limitations, and Phase 2 roadmap.

- [ ] **Step 6: Validate container and documentation commands**

Run:

```powershell
docker compose config
docker build -t weather-intelligence-service:test .
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:all
npm run build
```

Expected: every command PASS without a real WeatherAPI key; live test is skipped.

- [ ] **Step 7: Run a local Compose smoke test**

With a developer-owned WeatherAPI key in the shell, run:

```powershell
docker compose up -d --build
curl.exe --fail http://127.0.0.1:3000/health/live
curl.exe --fail http://127.0.0.1:3000/health/ready
curl.exe --fail "http://127.0.0.1:3000/api/v1/weather/current?q=London"
docker compose down
```

Expected: both health endpoints and the normalized current-weather response succeed; logs contain no API key. Do not commit the shell environment or Compose runtime data.

- [ ] **Step 8: Commit delivery artifacts**

```powershell
git add Dockerfile .dockerignore compose.yaml .env.example .github/workflows/ci.yml README.md test/live package.json package-lock.json vitest.config.ts
git commit -m "docs: add delivery and usage workflow"
```

### Task 13: Final Acceptance Audit

**Files:**
- Modify only files whose verification exposes a concrete defect.
- Test: all suites and generated artifacts.

**Interfaces:**
- Consumes: the entire implementation and approved specification.
- Produces: evidence that every acceptance criterion is implemented with no uncommitted fixes.

- [ ] **Step 1: Create a spec-to-evidence checklist in the commit notes**

Record one test file or command for every criterion in specification Section 25. At minimum map five REST/MCP capabilities, both transports, strict ambiguity, normalized DTOs, assessment fields, pure rules, timezone behavior, both cache adapters, quota/HTTP safeguards, Redis failure, health behavior, stdio stream separation, OpenAPI, offline tests, and Compose.

- [ ] **Step 2: Run the complete verification from a clean install**

Run:

```powershell
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
$env:TEST_REDIS_URL='redis://127.0.0.1:6379'; npm run test:integration
npm run test:e2e
npm run build
docker compose config
docker build -t weather-intelligence-service:acceptance .
git status --short
```

Expected: all checks PASS and `git status --short` is empty.

- [ ] **Step 3: Inspect secret and boundary hygiene**

Run:

```powershell
rg -n "WEATHERAPI_KEY=|api\.weatherapi\.com.*key=|console\.log|process\.env" . -g '!package-lock.json' -g '!docs/**'
```

Expected: no committed secret; no full upstream URL logging; `process.env` reads exist only in entrypoint/config bootstrap; stdout logging is absent from stdio paths.

- [ ] **Step 4: Fix only evidence-backed acceptance defects and rerun their owning suite**

For each failure, first add or tighten the smallest failing test in the owning task's test file, verify it fails, implement the minimal correction, and rerun that focused test plus `npm run typecheck`. Do not add roadmap features during the audit.

- [ ] **Step 5: Commit verified audit fixes if any**

If Step 4 changed files:

```powershell
git add src test package.json package-lock.json README.md Dockerfile compose.yaml .github/workflows/ci.yml
git commit -m "fix: satisfy weather service acceptance criteria"
```

If no files changed, do not create an empty commit.

- [ ] **Step 6: Produce implementation handoff evidence**

Report the final commit hash, all verification commands and outcomes, coverage summary, Docker image name, any skipped live test, and the exact known limitation that public mode has safeguards but no authentication.

## Spec Coverage Matrix

| Specification area | Owning tasks | Verification evidence |
|---|---|---|
| Technology baseline and exact dependency locking | 1, 12 | lockfile inspection, typecheck, production build |
| Ports-and-adapters boundaries | 1, 6-10 | import boundaries, Nest module boot, controller/tool spy tests |
| HTTP and stdio runtime modes | 9, 10 | REST, MCP HTTP, and spawned stdio E2E suites |
| Normalized domain models and units | 1, 5 | contract tests and WeatherAPI mapper fixtures |
| Strict location disambiguation | 6, 9-11 | application tests and interface parity tests |
| Current, forecast, and limited alerts | 5, 7 | provider integration and weather service tests |
| Timezone and forecast semantics | 8 | offset, overlap, availability, and DST unit tests |
| Explainable deterministic rules | 2 | full boundary suite and 100% rule branch coverage |
| Cache keys, TTL, LRU, stale, and single-flight | 3, 7 | cache contract and weather service tests |
| Redis degradation behavior | 3, 4, 7, 9 | adapter, emergency-limit, service, and readiness tests |
| Monthly provider quota | 4, 5 | concurrent atomic reservation and per-attempt retry tests |
| Timeout, retry, and cancellation | 5 | local upstream-stub integration suite |
| HTTP request safeguards | 9 | Host, Origin, body, rate, deadline, and bootstrap E2E tests |
| Shared REST and MCP semantics | 9-11 | output-schema validation and canonical parity suite |
| Logging, redaction, and health | 9, 10 | safe error snapshots, health spies, stdout/stderr assertions |
| CI, Docker, docs, and live smoke isolation | 12 | workflow, image build, Compose smoke, skipped-live assertion |
| Complete acceptance criteria | 13 | clean-install verification and spec-to-evidence audit |
