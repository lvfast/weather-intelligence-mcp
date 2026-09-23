# Weather Intelligence Service Design Specification

**Status:** Approved design, ready for implementation planning  
**Date:** 2026-09-23  
**Project:** Weather Intelligence Service  

## 1. Purpose

Weather Intelligence Service is a TypeScript backend that exposes normalized weather data and explainable activity-risk assessments through both REST and Model Context Protocol (MCP) interfaces. It is intended to be a portfolio-quality Junior Backend project, not a thin proxy over WeatherAPI.com.

The service has one application core. REST controllers and MCP tool handlers are adapters over the same application services. For the same validated input and application state, both interfaces must produce the same normalized semantic result.

## 2. Goals

- Resolve free-form or coordinate-based locations without silently choosing an ambiguous place.
- Provide normalized current weather, three-day forecast, and weather alerts from WeatherAPI.com Free plan.
- Assess conditions for commuting, running, travel, and outdoor events with a deterministic, versioned, explainable rule engine.
- Expose the capabilities through REST, MCP stdio, and stateless MCP Streamable HTTP.
- Protect the WeatherAPI key and the 100,000-call monthly provider quota.
- Demonstrate modular NestJS design, dependency inversion, Redis caching, resilience, testing, Docker, CI, and operational safeguards.

## 3. Non-goals

- A frontend or mobile application.
- User accounts, authentication, authorization, or saved preferences.
- A relational database or persistent assessment history.
- More than one weather provider.
- Historical, marine, sports, astronomy, pollen, or long-range weather APIs.
- User-editable rules or thresholds.
- Multi-region or multi-replica deployment.
- A guaranteed safety, medical, travel, or emergency advisory service.

PostgreSQL-backed assessment history, users, saved locations, metrics dashboards, authentication, and additional providers belong to later phases and require separate designs.

## 4. Technology Baseline

- Node.js 24 LTS.
- NestJS 12.0.4.
- TypeScript 6.0.x with ESM output.
- Official MCP TypeScript SDK v2 packages, pinned to exact versions in the lockfile.
- MCP protocol support for the stable 2026-07-28 revision and the SDK's stateless compatibility path for 2025-era clients.
- Zod v4 for transport and provider-boundary validation.
- Vitest for unit, integration, contract, and end-to-end tests.
- Redis for shared caching, quota counters, and public-HTTP rate-limit state.
- npm with a committed lockfile.
- Docker and Docker Compose for the production-like local stack.

All direct dependencies must be pinned to exact versions when implementation begins. The lockfile is the reproducibility source of truth.

## 5. External Constraints

WeatherAPI.com is the only provider in the MVP. The design assumes its Free plan:

- 100,000 provider calls per calendar month.
- Forecast range limited to one through three days.
- Weather alerts have limited coverage.
- Current observations normally update every 10-15 minutes.
- Forecasts normally update every 4-6 hours.
- The API key is supplied through `WEATHERAPI_KEY` and must never appear in public responses or logs.

Provider capability or plan errors must be exposed as normalized service errors, never as raw upstream bodies.

## 6. Architectural Style

The system is a modular monolith with ports and adapters. Dependencies point inward:

```text
REST / MCP adapters
        |
Application services
        |
Domain models and rule engine
        |
Provider, cache, quota, clock, and logging ports
        |
WeatherAPI, Redis, memory, and system adapters
```

NestJS composes modules and dependencies. Domain models and the rule engine remain plain TypeScript and do not import NestJS decorators, HTTP types, MCP types, Redis types, or WeatherAPI DTOs.

No controller or MCP handler may call WeatherAPI or Redis directly.

## 7. Runtime Modes

### 7.1 HTTP runtime

The HTTP entrypoint boots a NestJS web application containing:

- REST endpoints under `/api/v1`.
- Stateless MCP Streamable HTTP at `/mcp`.
- Swagger UI at `/docs` and generated OpenAPI JSON at `/docs-json`.
- Liveness and readiness endpoints.

Default binding is `127.0.0.1`. Binding to a non-loopback address requires explicit configuration.

### 7.2 Stdio runtime

The stdio entrypoint creates a NestJS application context without opening an HTTP listener, registers the same MCP tools, and connects an MCP stdio transport.

The stdio runtime must write protocol traffic only to `stdout`. All application logs go to `stderr`.

### 7.3 Shared composition

Both runtimes use the same NestJS modules, application services, input schemas, output schemas, provider adapter, rule engine, and error taxonomy. Transport adapters may change representation but not domain meaning.

The HTTP MCP endpoint is stateless. MCP server and transport objects are created with the lifecycle required by the official SDK, while NestJS application services remain process-level providers.

## 8. NestJS Modules and Responsibilities

### 8.1 `ConfigModule`

- Loads environment variables once at startup.
- Rejects invalid, missing, or contradictory settings before accepting traffic.
- Exposes typed configuration rather than raw `process.env` reads throughout the application.

### 8.2 `LocationModule`

- Resolves query strings, opaque location IDs, and coordinates.
- Applies strict ambiguity behavior.
- Produces normalized `Location` values.

### 8.3 `WeatherModule`

- Implements current, forecast, and alert use cases.
- Coordinates location resolution, cache access, provider quota, provider calls, normalization, and stale policy.

### 8.4 `AssessmentModule`

- Selects the correct observation or hourly forecast intervals for a requested time window.
- Loads active alerts for the resolved location so official-alert risk floors are always evaluated; an empty result retains limited-coverage metadata.
- Runs the pure rule engine.
- Produces versioned assessment results and data-quality metadata.

### 8.5 `WeatherApiModule`

- Implements the weather-provider port.
- Applies timeout, cancellation, retry, response validation, and WeatherAPI error mapping.
- Maps WeatherAPI DTOs into domain models.

### 8.6 `CacheModule`

- Provides memory and Redis implementations of one cache port.
- Implements TTL, bounded memory storage, serialization versioning, and per-process single-flight.

### 8.7 `QuotaModule`

- Reserves provider-call budget before every outbound attempt, including retries.
- Uses Redis atomic operations for process-shared monthly accounting.
- Provides a bounded in-process emergency limiter when Redis is unavailable.

### 8.8 `RestModule`

- Owns REST controllers, request DTOs, response DTOs, validation, OpenAPI annotations, and exception mapping.

### 8.9 `McpModule`

- Registers the five MCP tools.
- Maps MCP inputs to application requests and application results to `structuredContent` plus concise text content.
- Maps expected ambiguity separately from tool execution failures.

### 8.10 `HealthModule`

- Exposes process liveness and dependency readiness.
- Never calls WeatherAPI from a health endpoint.

## 9. Core Ports

The application layer depends on focused interfaces equivalent to:

```ts
interface WeatherProvider {
  searchLocations(query: string, signal?: AbortSignal): Promise<LocationCandidate[]>;
  getCurrent(location: ResolvedLocationRef, signal?: AbortSignal): Promise<CurrentWeather>;
  getForecast(location: ResolvedLocationRef, days: 1 | 2 | 3, signal?: AbortSignal): Promise<WeatherForecast>;
  getAlerts(location: ResolvedLocationRef, signal?: AbortSignal): Promise<WeatherAlert[]>;
}

interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  health(): Promise<'up' | 'down'>;
}

interface ProviderQuota {
  reserve(attempts: number): Promise<QuotaReservation>;
}

interface Clock {
  now(): Date;
}
```

These are the canonical application-facing operations. Infrastructure adapters may add private helper methods, but public port semantics and dependency direction may not change without revising this specification.

## 10. Normalized Domain Model

### 10.1 Location

```ts
interface Location {
  locationId: string;
  name: string;
  region: string | null;
  country: string;
  latitude: number;
  longitude: number;
  timeZone: string;
}
```

`locationId` is opaque to clients. A client may store and send it back but must not parse it.

Search results that lack a timezone may be enriched through a weather lookup only after the location is uniquely selected. The enrichment call is subject to cache and quota protection.

### 10.2 Weather values

Public weather data uses metric units:

- Temperature and feels-like temperature: degrees Celsius.
- Wind and gust: kilometres per hour.
- Precipitation: millimetres.
- Visibility: kilometres.
- Humidity, cloud cover, and precipitation probability: percent.
- UV: provider UV index.

Each current or hourly value includes an absolute ISO 8601 timestamp and the location IANA timezone. Daily forecasts use the location's local calendar date.

Provider condition codes are mapped to stable categories:

```text
clear, cloudy, fog, rain, snow, sleet, thunderstorm, other
```

Normalized conditions also carry `intensity: light | moderate | heavy | unknown`. WeatherAPI thunder codes with heavy rain or heavy snow map to `thunderstorm` plus `heavy`; other thunder codes map to their documented intensity or `unknown`.

The public model may also contain provider condition text for display, but rules operate on normalized category, intensity, and numeric fields rather than localized prose.

### 10.3 Source metadata

Every successful public result contains:

```ts
interface ResultMeta {
  requestId: string;
  provider: 'weatherapi';
  fetchedAt: string;
  cached: boolean;
  stale: boolean;
  warnings: string[];
}
```

Assessment results additionally expose:

```ts
interface AssessmentSource {
  provider: 'weatherapi';
  cached: boolean;
  stale: boolean;
  coverage: 'current' | 'forecast' | 'forecast-and-limited-alerts';
}
```

## 11. Location Input and Ambiguity

All weather capabilities accept exactly one location form:

```ts
type LocationInput =
  | { query: string }
  | { locationId: string }
  | { coordinates: { lat: number; lon: number } };
```

Rules:

- Blank queries are validation errors.
- Latitude must be between -90 and 90; longitude between -180 and 180.
- Supplying zero or more than one form is a validation error.
- `locationId` is passed back through the provider adapter as a WeatherAPI ID lookup.
- Coordinates are considered explicit and do not require disambiguation.
- A query search yielding zero candidates returns `not_found`.
- A query search yielding exactly one candidate returns `resolved`.
- A query search yielding more than one candidate returns `ambiguous`; the service never silently selects the first result.

Query cache normalization applies Unicode NFKC normalization, trimming, whitespace collapsing, and case folding for keys. The normalized-but-case-preserving query is sent upstream. Accents are not stripped.

Ambiguity is an expected business result:

- `GET /api/v1/locations/resolve` returns HTTP 200 with `status: "ambiguous"` and candidates because discovering ambiguity is the successful purpose of that endpoint.
- Other REST capabilities map ambiguity to HTTP 409 with code `LOCATION_AMBIGUOUS` and candidates in `details`.
- `resolve_location` returns `status: "ambiguous"`; other MCP tools return `status: "location_resolution_required"` with candidates. Neither MCP result is marked as an execution error.
- The resolve capability returns `status: "not_found"` as a successful search result. Other REST capabilities map the same outcome to HTTP 404, and other MCP tools return a structured `LOCATION_NOT_FOUND` tool error.

## 12. REST API

### 12.1 Endpoints

```text
GET  /api/v1/locations/resolve
GET  /api/v1/weather/current
GET  /api/v1/weather/forecast
GET  /api/v1/weather/alerts
POST /api/v1/weather/assessments
GET  /health/live
GET  /health/ready
GET  /docs
GET  /docs-json
```

GET weather routes accept one of `q`, `locationId`, or the pair `lat` and `lon`. Forecast accepts `days=1..3` and `includeHourly=false` by default. Location resolution accepts `q` and `limit`, where `limit` defaults to 5 and is bounded from 1 through 10.

Assessment accepts a JSON body containing a `location`, an `activity`, and either both `startTime` and `endTime` or neither.

### 12.2 Success envelope

```json
{
  "data": {},
  "meta": {
    "requestId": "01J...",
    "provider": "weatherapi",
    "fetchedAt": "2026-09-23T08:00:00Z",
    "cached": true,
    "stale": false,
    "warnings": []
  }
}
```

### 12.3 Error envelope

```json
{
  "error": {
    "code": "LOCATION_AMBIGUOUS",
    "message": "Multiple locations match the query.",
    "details": {},
    "requestId": "01J..."
  }
}
```

No REST error contains an API key, upstream URL query string, raw upstream body, stack trace, or internal class name.

## 13. MCP Tools

### 13.1 `resolve_location`

Input:

- `query`: required non-blank string.
- `limit`: optional integer from 1 through 10; default 5.

Output status is `resolved`, `ambiguous`, or `not_found`, with normalized candidates where applicable.

### 13.2 `get_current_weather`

Input is `LocationInput`. Output includes the normalized location, observation time, condition, temperature, feels-like temperature, precipitation, humidity, wind, gust, visibility, UV, and source metadata.

### 13.3 `get_weather_forecast`

Input includes `LocationInput`, `days` from 1 through 3, and optional `includeHourly` defaulting to `false`. Output always includes daily summaries and includes hourly intervals only when requested.

### 13.4 `get_weather_alerts`

Input is `LocationInput`. Output contains normalized active alerts and always declares `coverage: "limited"` because the MVP uses WeatherAPI Free plan. An empty alert list means the provider returned no alert; it does not mean alerts are guaranteed unavailable for no hazards worldwide.

### 13.5 `assess_weather_conditions`

Input:

```ts
interface AssessWeatherInput {
  location: LocationInput;
  activity: 'commute' | 'running' | 'travel' | 'outdoor_event';
  startTime?: string;
  endTime?: string;
}
```

Output must contain at least:

```ts
interface WeatherAssessment {
  activity: Activity;
  location: Location;
  window: { startTime: string; endTime: string; timeZone: string };
  riskScore: number;
  riskLevel: 'low' | 'moderate' | 'high' | 'severe';
  recommendation: 'go' | 'caution' | 'avoid';
  summary: string;
  triggeredRules: RuleFinding[];
  evidence: AssessmentEvidence[];
  mitigations: string[];
  ruleVersion: string;
  source: AssessmentSource;
  observedAt: string;
  dataQuality: 'normal' | 'degraded';
}
```

MCP tool results include canonical `structuredContent` and a short text summary. Text is a presentation aid, not a second contract.

## 14. Time and Forecast Semantics

- Client-supplied `startTime` and `endTime` must be ISO 8601 timestamps with `Z` or an explicit UTC offset. Offset-less timestamps are rejected.
- Both times must be supplied together.
- `endTime` must be after `startTime`.
- Maximum assessment duration is 72 hours.
- The entire interval must fall within data available from the Free-plan three-day forecast at request time.
- If no interval is supplied, the window is from the injected clock's current time through two hours later.
- Hourly intervals are selected by overlap with the half-open assessment window `[startTime, endTime)`.
- Local dates, day boundaries, and requested forecast-day count are calculated with the resolved location's IANA timezone, not the server timezone.
- Current observations are used for the present portion of an implicit window. Forecast hours are used for future portions and for every explicit future window.
- `observedAt` is the newest provider observation or forecast generation timestamp used by the assessment.
- Daylight-saving transitions are handled through IANA timezone conversion; the implementation must not add fixed 24-hour durations to derive local calendar days.

## 15. Rule Engine

### 15.1 Properties

The rule engine is pure and deterministic:

- It performs no network, cache, filesystem, clock, or random operations.
- All required time and weather data are passed in its context.
- It returns the same result for the same context and rule version.
- Every finding names the rule, observed metric, comparison, threshold, points, severity, affected window, message, and mitigation.

Rules are typed source code reviewed through Git. Runtime-editable JSON or YAML rules are outside the MVP.

### 15.2 Finding model

```ts
interface RuleFinding {
  ruleId: string;
  severity: 'moderate' | 'high' | 'severe';
  points: 20 | 40 | 70;
  message: string;
  evidence: {
    metric: string;
    observed: number | string;
    operator: string;
    threshold: number | string;
    unit?: string;
  };
  window: { startTime: string; endTime: string };
  mitigation: string;
}
```

For a hazard in one hourly slot, only the highest matching band fires. The same hazard is not double-counted through lower bands. Different hazards may accumulate.

### 15.3 Initial thresholds

Values are moderate/high/severe thresholds. A dash means that hazard is not activity-specific beyond universal alert and thunderstorm rules.

| Hazard | Commute | Running | Travel | Outdoor event |
|---|---:|---:|---:|---:|
| Rain, mm/hour at or above | 2.5 / 7.5 / 15 | 1 / 5 / 10 | 5 / 10 / 20 | 1 / 5 / 10 |
| Gust, km/h at or above | 40 / 60 / 80 | 35 / 50 / 70 | 50 / 70 / 90 | 35 / 55 / 75 |
| Visibility, km below | 5 / 2 / 0.5 | 5 / 2 / 0.5 | 5 / 2 / 0.5 | 5 / 2 / 0.5 |
| Feels-like heat, C at or above | 35 / 40 / 45 | 30 / 35 / 40 | 35 / 40 / 45 | 32 / 38 / 43 |
| Feels-like cold, C at or below | 0 / -10 / -20 | 5 / 0 / -10 | 0 / -10 / -20 | 0 / -10 / -20 |
| UV at or above | - | 6 / 8 / 11 | - | 6 / 8 / 11 |
| Rain probability at or above | - | - | - | 50 / 70 / 90 percent |

Additional rules:

- Any thunderstorm category contributes a high finding; a thunderstorm with normalized `heavy` intensity contributes a severe finding.
- Running with temperature at least 28 C and humidity at least 80 percent contributes a moderate compound heat-humidity finding.
- An outdoor event with rain probability at least 50 percent in at least 30 percent of its evaluated hourly slots contributes one moderate event-coverage finding.
- Official alert severity `Moderate` sets a moderate risk floor, `Severe` sets a high floor, and `Extreme` sets a severe floor. Unknown non-empty severities set a moderate floor.
- Alert coverage remains marked limited even when no alert is returned.

### 15.4 Aggregation

- Each hourly slot score is the capped sum of its distinct findings: `min(100, sum(points))`.
- Overall `riskScore` is the maximum hourly slot score, not the sum across time.
- An alert floor may raise the resulting band without inventing extra points. If a floor raises the band, `riskScore` is raised to that band's minimum.
- Bands are: 0-19 low, 20-39 moderate, 40-69 high, and 70-100 severe.
- Recommendations map as: low to `go`, moderate to `caution`, high or severe to `avoid`.
- The result identifies the `worstWindow` in its evidence.
- Stale inputs set `dataQuality` to `degraded`; the recommendation may not be `go`, so risk is floored to moderate.
- Rules are ordered by severity, then points, then stable rule ID for deterministic output.

The initial ruleset version is `weather-activity-rules/1.0.0`.

## 16. Caching

### 16.1 Backends

`CACHE_BACKEND=memory` is the default for stdio and dependency-free local execution. `CACHE_BACKEND=redis` is the production-like HTTP and Docker Compose configuration.

Redis is a cache and coordination dependency, never the source of business truth. Losing Redis loses cached values and shared counters, not weather records owned by this service.

### 16.2 Keys

Keys use the format:

```text
wis:v1:<resource>:<normalized-location>:<canonical-parameters>
```

Keys never include the WeatherAPI key. Coordinate keys round latitude and longitude to four decimal places. Canonical parameter order is stable.

### 16.3 TTL and bounds

| Resource | Fresh TTL | Stale-if-error maximum age |
|---|---:|---:|
| Positive location search | 24 hours | 7 days |
| Location not found | 5 minutes | none |
| Current weather | 10 minutes | 30 minutes from fetch |
| Forecast | 60 minutes | 6 hours from fetch |
| Alerts | 5 minutes | none |

Memory cache defaults to a maximum of 1,000 entries and uses LRU eviction. The maximum is configurable from 100 through 10,000.

Assessment results are not cached independently. They are recalculated over cached normalized weather so a ruleset deployment cannot serve an assessment produced by an older rule version.

### 16.4 Stampede behavior

Concurrent cache misses for the same key in one process share one in-flight promise. The promise is removed on both success and failure. Distributed locking is outside MVP because multi-replica deployment is outside scope.

### 16.5 Redis failure

Redis errors do not become unbounded direct WeatherAPI traffic:

- Readiness becomes unhealthy while the configured Redis backend is unavailable.
- Existing request handling may bypass the failed cache only after the quota guard grants an emergency reservation.
- Emergency upstream traffic is limited to five attempts per minute per process by default.
- Every retry consumes another emergency reservation.
- Once the emergency allowance is exhausted, the request fails with `CACHE_UNAVAILABLE` or `PROVIDER_BUDGET_UNAVAILABLE`; it does not call WeatherAPI.
- The service logs one rate-limited warning category rather than one full stack trace per request.

The implementation does not silently replace an explicitly selected Redis backend with a new memory cache.

## 17. Provider Quota Protection

Quota protection is independent of response caching and applies to every WeatherAPI request attempt.

- Default monthly provider budget: 90,000 calls, reserving 10 percent of the Free-plan allowance for manual testing and operational margin.
- The budget is configurable downward but may not exceed 95,000 without an explicit unsafe override.
- Redis mode uses an atomic reserve operation against `wis:quota:weatherapi:<YYYY-MM>` in UTC.
- The quota key expires after the following monthly reset boundary.
- A reservation is made before the outbound attempt and is not refunded, because the provider may have received a request even when the client observes a timeout.
- Cache hits and pure rule evaluation consume no provider budget.
- Budget exhaustion returns normalized code `PROVIDER_BUDGET_EXHAUSTED` and performs no upstream call.
- Memory mode enforces the same budget per process and clearly reports that the counter is not shared across separate stdio processes.
- Public HTTP mode requires Redis for globally coherent quota and rate-limit counters. If Redis is lost after startup, only the emergency limiter described above permits temporary provider traffic.

## 18. Resilience and Cancellation

- Each WeatherAPI attempt has a three-second timeout.
- The overall provider-operation deadline is eight seconds.
- At most two retries are permitted after the initial attempt.
- Retry delay uses exponential backoff with jitter.
- Only network failures, attempt timeouts, HTTP 429 with a usable delay inside the overall deadline, and HTTP 5xx are retryable.
- Validation failures, location not found, invalid key, disabled key, quota exceeded, and plan restriction are not retryable.
- Every attempt, including retries, requires a quota reservation.
- HTTP client disconnect, MCP cancellation, or application deadline aborts pending cache wait, backoff, and provider fetch through `AbortSignal` propagation where supported.
- Cancellation is not logged as an internal server error.
- Current and forecast may use eligible stale values only after a retryable provider failure.
- Alerts never use stale values.

## 19. HTTP Protection

The service has two exposure modes:

- `local` is the default, binds to `127.0.0.1`, and permits localhost hosts.
- `public` requires explicit bind address, non-empty host allowlist, Redis, and configured CORS origins where browser access is needed.

Safeguards:

- Default per-IP limit: 60 HTTP requests per rolling minute, configurable downward or upward with validation.
- Redis-backed rate-limit state in public mode.
- Maximum request body: 64 KiB.
- Maximum request processing deadline: 10 seconds.
- Host header validation on every HTTP route, including `/mcp`.
- Requests containing an `Origin` header must match the configured origin allowlist. Requests without `Origin` remain valid for server-to-server and MCP clients if the Host is allowed.
- CORS is disabled when no origin allowlist is configured.
- Provider monthly budget and emergency limiter apply after HTTP rate limiting and before every upstream attempt.
- The API key is never accepted from public request input.
- Authentication remains outside MVP. Documentation must state that an Internet deployment without authentication is suitable only for a controlled portfolio demo and must retain all safeguards above.

## 20. Error Taxonomy

The shared error codes are:

```text
VALIDATION_ERROR
LOCATION_NOT_FOUND
LOCATION_AMBIGUOUS
FORECAST_WINDOW_UNAVAILABLE
UPSTREAM_UNAUTHORIZED
UPSTREAM_QUOTA_EXCEEDED
UPSTREAM_PLAN_RESTRICTED
UPSTREAM_TIMEOUT
UPSTREAM_UNAVAILABLE
PROVIDER_BUDGET_EXHAUSTED
PROVIDER_BUDGET_UNAVAILABLE
CACHE_UNAVAILABLE
RATE_LIMITED
REQUEST_CANCELLED
INTERNAL_ERROR
```

Location ambiguity is a business result, not an internal exception. Unexpected errors are logged with request ID and returned as a generic `INTERNAL_ERROR` without implementation details.

REST maps codes to appropriate 4xx/5xx statuses. MCP maps validation and execution failures into structured tool errors. Expected location disambiguation remains a successful MCP call with a workflow status.

## 21. Logging and Health

Structured JSON logs include:

- Timestamp, level, service version, runtime mode, and request ID.
- Interface (`rest`, `mcp-http`, or `mcp-stdio`) and operation/tool name.
- Duration, normalized outcome code, cache outcome, retry count, and upstream latency.
- Assessment activity, risk level, rule version, and count of triggered rules, but not full user input by default.

Logs exclude API keys, authorization values, full upstream URLs, raw upstream bodies, stack traces in public responses, and unbounded location strings.

`/health/live` reports only that the process event loop can answer. `/health/ready` checks configuration and Redis when Redis is configured. Neither endpoint calls WeatherAPI or consumes quota.

Prometheus, tracing backends, and dashboards are deferred.

## 22. Testing Strategy

### 22.1 Unit tests

- Every rule immediately below, equal to, and above each threshold.
- Hazard de-duplication, score capping, alert floors, risk bands, deterministic ordering, and degraded-data floor.
- Time-window overlap, timezone conversion, local day selection, and daylight-saving boundaries.
- Provider DTO validation and mapping.
- Cache key normalization, TTL, stale policy, LRU eviction, and single-flight cleanup after rejection.
- Quota reservation, month rollover, retry accounting, and emergency limiter.

### 22.2 Application tests

Use fake provider, cache, quota, and clock ports to cover:

- Unique, ambiguous, missing, ID-based, and coordinate-based location flows.
- Current, forecast, alert, and assessment orchestration.
- Cache hit, miss, stale recovery, and Redis failure decisions.
- Provider errors and cancellation.
- Current-versus-forecast selection for assessment windows.

### 22.3 Integration tests

- WeatherAPI adapter against deterministic HTTP fixtures; CI never requires a real API key.
- Redis adapter and atomic quota operations against a real Redis service.
- NestJS REST application through HTTP.
- MCP tool discovery and calls through official SDK clients for stdio and Streamable HTTP.

### 22.4 Contract and parity tests

- Generated OpenAPI document contains all public routes and validates against the OpenAPI schema.
- Each REST capability and corresponding MCP tool are invoked with semantically identical inputs.
- Tests compare normalized domain data after removing transport-only metadata; checking only HTTP status or MCP success is insufficient.
- Ambiguity, validation failure, not found, stale data, quota exhaustion, and upstream outage are included in parity cases.
- MCP outputs validate against declared output schemas and REST outputs validate against OpenAPI-derived schemas.

### 22.5 Optional live smoke test

A separately invoked test may use a real WeatherAPI key for one known location. It is excluded from default test and CI commands, is quota guarded, and prints no secret.

## 23. CI and Delivery

Every pull request runs, in order:

1. Frozen dependency installation.
2. Formatting check and lint.
3. Type checking.
4. Unit tests with coverage threshold.
5. Integration tests with a Redis service.
6. REST and MCP end-to-end/contract tests.
7. Production build.
8. Docker image build.

The repository includes:

- A multi-stage Dockerfile running as a non-root user.
- Docker Compose for the service and Redis.
- `.env.example` without secrets.
- README setup for REST, Codex, Claude, OpenClaw, stdio, and Streamable HTTP.
- Example requests and expected structured outputs.
- Generated OpenAPI verification in CI.

## 24. Security Boundaries

- WeatherAPI base URL is fixed configuration; users cannot supply arbitrary upstream URLs, preventing SSRF through tool input.
- Input schemas reject unknown fields and enforce length/range limits.
- API keys exist only in server configuration.
- Docker runs as non-root and exposes only the configured HTTP port.
- Dependencies are lockfile-pinned and audited in CI without automatically mutating versions.
- HTTP authentication is explicitly absent from MVP; public deployment is a controlled demo, not a multi-tenant service.

## 25. Acceptance Criteria

The MVP is complete only when:

- All five capabilities work through MCP and their REST equivalents.
- REST and MCP call the same application services and pass semantic parity tests.
- Stdio and Streamable HTTP connect successfully using official MCP clients.
- Location ambiguity never silently selects a candidate.
- Public weather output contains normalized models, not WeatherAPI DTOs.
- Assessment output contains `riskLevel`, `recommendation`, `triggeredRules`, `evidence`, `ruleVersion`, `source`, and `observedAt`.
- The rule engine is pure, deterministic, versioned, and fully boundary-tested.
- Timezone and forecast-window behavior follow Section 14.
- Redis and memory cache adapters satisfy the same cache contract.
- Public HTTP safeguards and global provider quota protection work under tests.
- Redis failure cannot cause unlimited provider calls.
- Health checks never call WeatherAPI.
- Stdio emits no application logs to stdout.
- OpenAPI is generated from code and verified in CI.
- The complete default test suite passes without network access or a real WeatherAPI key.
- Docker Compose starts a usable HTTP service with Redis, and memory mode remains usable without Redis.

## 26. Design Rationale

This design deliberately avoids microservices and a relational database. There is no persistent business entity in the MVP, while Redis has concrete uses for expiring weather data, quota accounting, and rate limiting. A single modular service is easier to complete, test, deploy, and explain while still demonstrating production backend concerns.

The distinguishing architectural property is not the number of technologies. It is that one deterministic weather-intelligence core is delivered consistently through REST and MCP, with contract tests preventing interface drift.

## 27. References

- WeatherAPI documentation: <https://www.weatherapi.com/docs/>
- WeatherAPI pricing and Free-plan limits: <https://www.weatherapi.com/pricing.aspx>
- NestJS releases: <https://github.com/nestjs/nest/releases>
- Node.js release schedule: <https://nodejs.org/en/about/previous-releases>
- TypeScript 6.0 release notes: <https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html>
- MCP TypeScript SDK server guide: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md>
- MCP TypeScript SDK protocol versions: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md>
- Reference repository supplied during design: <https://github.com/ezh0v/weather-mcp-server>
