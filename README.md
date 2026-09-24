# Weather Intelligence Service

[![CI](https://github.com/lvfast/weather-intelligence-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/lvfast/weather-intelligence-mcp/actions/workflows/ci.yml)
[![Node.js 24](https://img.shields.io/badge/node-24%20LTS-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A production-minded NestJS backend that exposes normalized WeatherAPI.com data and
deterministic, explainable activity-risk assessments through **REST**, **MCP stdio**,
and **stateless MCP Streamable HTTP**.

## Architecture

One application core serves every interface. Ports-and-adapters keep dependencies
pointing inward:

```text
REST / MCP adapters
        |
Application services (location, weather, assessment)
        |
Domain models and the pure rule engine
        |
Ports: provider, cache, quota, clock, logging
        |
WeatherAPI, Redis, memory, and system adapters
```

- REST controllers and MCP tool handlers call the **same application services** and
  share the same strict Zod request/output schemas.
- Domain models and the rule engine import no NestJS, HTTP, MCP, Redis, or
  WeatherAPI DTO types.
- Contract tests (`test/contract/interface-parity.spec.ts`) prove that REST and MCP
  return canonically equal results for identical inputs, including ambiguity,
  stale-data, quota-exhaustion, and upstream-outage cases.

### Provider limitations

WeatherAPI.com Free plan is the only provider:

- 100,000 calls per calendar month. The default service budget is 90,000 calls,
  reservable downward; above 95,000 requires `UNSAFE_ALLOW_HIGH_PROVIDER_BUDGET=true`.
- Forecasts cover one to three days only.
- **Alerts have limited coverage.** An empty alert list means the provider returned
  no alert; it does not guarantee that no hazard exists. Every alert response
  declares `coverage: "limited"`.

## Quick start (memory cache, no Redis)

Requires Node.js 24.

```powershell
npm ci
$env:WEATHERAPI_KEY='your-key'
npm run start:dev:http
```

The HTTP runtime listens on `http://127.0.0.1:3000` by default.

### Docker Compose (app + Redis)

```powershell
$env:WEATHERAPI_KEY='your-key'
docker compose up -d --build
curl.exe --fail http://127.0.0.1:3000/health/live
curl.exe --fail http://127.0.0.1:3000/health/ready
docker compose down
```

Compose binds the app to `127.0.0.1:3000` and uses Redis for the shared cache,
quota counter, and (in public mode) rate-limit state.

## REST API

All endpoints live under `/api/v1`; success responses use a `{ data, meta }`
envelope with `requestId`, `provider`, `fetchedAt`, `cached`, `stale`, and
`warnings`.

```powershell
# 1. Resolve a free-form place name (ambiguity is a successful 200 result here)
curl.exe "http://127.0.0.1:3000/api/v1/locations/resolve?q=Paris&limit=5"

# 2. Current weather by query, opaque id, or coordinates
curl.exe "http://127.0.0.1:3000/api/v1/weather/current?q=Paris"
curl.exe "http://127.0.0.1:3000/api/v1/weather/current?locationId=2807"
curl.exe "http://127.0.0.1:3000/api/v1/weather/current?lat=48.8566&lon=2.3522"

# 3. Forecast (days 1-3, hourly intervals only when requested)
curl.exe "http://127.0.0.1:3000/api/v1/weather/forecast?q=Paris&days=3&includeHourly=true"

# 4. Alerts (always declares limited coverage)
curl.exe "http://127.0.0.1:3000/api/v1/weather/alerts?q=Paris"

# 5. Assessment for an activity with an optional explicit window (ISO 8601 with offset)
curl.exe -X POST "http://127.0.0.1:3000/api/v1/weather/assessments" ^
  -H "Content-Type: application/json" ^
  -d "{\"location\":{\"query\":\"Paris\"},\"activity\":\"running\",\"startTime\":\"2026-09-24T06:00:00+02:00\",\"endTime\":\"2026-09-24T08:00:00+02:00\"}"
```

Other routes: `GET /health/live`, `GET /health/ready`, Swagger UI at `/docs`,
generated OpenAPI JSON at `/docs-json`.

### Error envelope

```json
{
  "error": {
    "code": "LOCATION_AMBIGUOUS",
    "message": "Multiple locations match the query.",
    "details": { "candidates": [] },
    "requestId": "01J..."
  }
}
```

No error ever contains the API key, upstream query strings, raw provider bodies,
stack traces, or internal causes. Ambiguity outside `/locations/resolve` maps to
HTTP 409; location resolution is the one endpoint where discovering ambiguity is
the successful purpose.

### Rule explanation example

```json
{
  "activity": "running",
  "riskScore": 60,
  "riskLevel": "high",
  "recommendation": "avoid",
  "ruleVersion": "weather-activity-rules/1.0.0",
  "triggeredRules": [
    {
      "ruleId": "running.rain.high",
      "severity": "high",
      "points": 40,
      "evidence": {
        "metric": "precipitationMm",
        "observed": 6.2,
        "operator": ">=",
        "threshold": 5,
        "unit": "mm/h"
      },
      "window": {
        "startTime": "2026-09-24T06:00:00+02:00",
        "endTime": "2026-09-24T07:00:00+02:00"
      },
      "mitigation": "Wear rain protection and check drainage on your route."
    }
  ]
}
```

The engine is pure, deterministic, versioned, and fully boundary-tested with 100%
branch coverage. Findings aggregate per hourly slot (capped at 100), the overall
score is the worst slot, official alert severities apply risk floors, and stale
inputs floor results to moderate risk with `dataQuality: "degraded"`.

## MCP

Five tools are exposed over both stdio and stateless Streamable HTTP:

| Tool                        | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `resolve_location`          | Resolve a query into normalized candidates |
| `get_current_weather`       | Normalized current conditions              |
| `get_weather_forecast`      | One-to-three-day forecast, optional hourly |
| `get_weather_alerts`        | Alerts with limited-coverage metadata      |
| `assess_weather_conditions` | Deterministic activity-risk assessment     |

Ambiguity is a **workflow result**, not a tool error: other tools return
`status: "location_resolution_required"` with candidates. Not-found is a
structured tool error (`LOCATION_NOT_FOUND`). Every result carries canonical
`structuredContent` plus a short text summary.

### Streamable HTTP

```powershell
# Endpoint (stateless; GET/DELETE session operations answer 405 by design)
http://127.0.0.1:3000/mcp
```

### Stdio clients

Point the client at the built entrypoint (absolute paths shown) and keep the key in
client-managed environment configuration — never in arguments or committed files.

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.weather-intelligence]
command = "node"
args = ["C:\\path\\to\\weather-intelligence-mcp\\dist\\entrypoints\\stdio.js"]
env = { WEATHERAPI_KEY = "your-key", CACHE_BACKEND = "memory" }
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "weather-intelligence": {
      "command": "node",
      "args": ["C:\\path\\to\\weather-intelligence-mcp\\dist\\entrypoints\\stdio.js"],
      "env": { "WEATHERAPI_KEY": "your-key", "CACHE_BACKEND": "memory" }
    }
  }
}
```

OpenClaw / generic MCP client:

```json
{
  "mcp": {
    "weather-intelligence": {
      "transport": "stdio",
      "command": "node",
      "args": ["C:\\path\\to\\weather-intelligence-mcp\\dist\\entrypoints\\stdio.js"],
      "env": { "WEATHERAPI_KEY": "your-key" }
    }
  }
}
```

Build first with `npm run build`. Stdio reserves stdout for MCP protocol traffic;
all logs go to stderr.

## Configuration

See `.env.example` for every key, default, and constraint. Highlights:

- `EXPOSURE_MODE=public` requires Redis, a non-empty `HOST_ALLOWLIST`, and an
  explicit non-loopback `HOST`.
- Default HTTP protection: 60 requests per rolling minute per IP, 64 KiB request
  bodies, 10-second processing deadline, Host and Origin validation on every route
  including `/mcp`.
- Provider budget: reserve before every upstream attempt including retries;
  exhaustion fails fast with `PROVIDER_BUDGET_EXHAUSTED`.
- Redis outage: readiness reports 503 and provider traffic is gated by an
  emergency limiter (five attempts per rolling minute per process by default).

## Testing

```powershell
npm test                 # unit + contract tests (offline, no provider key)
npm run test:coverage    # coverage thresholds: 85% statements/lines/functions, 80% branches; 100% rule branches
npm run test:e2e         # REST, MCP HTTP, and spawned stdio end-to-end tests
npm run test:all         # coverage + integration + e2e
```

Redis-backed integration tests need a disposable Redis:

```powershell
docker run --rm -d --name wis-test-redis -p 6379:6379 redis:8.2.1-alpine
$env:TEST_REDIS_URL='redis://127.0.0.1:6379'
npm run test:integration
docker stop wis-test-redis
```

### Opt-in live smoke test

```powershell
$env:RUN_LIVE_WEATHERAPI_TESTS='true'
$env:WEATHERAPI_KEY='your-key'
npm run test:live
```

The live test makes one quota-guarded provider call for London, prints no secret,
and is skipped by default and in CI.

## Security limitations

- HTTP authentication is **not** part of the MVP. An Internet deployment without
  authentication is suitable only as a controlled portfolio demo; keep every
  safeguard enabled (Redis, host allowlist, CORS allowlist, rate limits, budget).
- The WeatherAPI base URL is fixed configuration; tool input cannot redirect
  upstream traffic (no SSRF through inputs).
- API keys exist only in server or client-managed environment configuration.

## License

MIT — see `LICENSE`.
