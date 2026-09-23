import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureHttpApp } from '../../src/entrypoints/http.js';
import { parseConfig, type AppConfig } from '../../src/config/config.schema.js';
import { createRedactedLogger, type RedactedLogger } from '../../src/observability/logger.js';
import {
  ASSESSMENT_SERVICE,
  CACHE_STORE,
  CLOCK,
  LOCATION_SERVICE,
  WEATHER_PROVIDER,
  WEATHER_SERVICE,
} from '../../src/domain/ports.js';
import {
  makeCandidate,
  makeClock,
  makeProvider,
  type FakeCacheStore,
  type FakeWeatherProvider,
} from './fakes.js';

export interface HttpTestAppOverrides {
  locationService?: unknown;
  weatherService?: unknown;
  assessmentService?: unknown;
  provider?: unknown;
  clock?: unknown;
  cache?: FakeCacheStore;
}

export interface HttpTestApp {
  app: INestApplication;
  logger: RedactedLogger;
  config: AppConfig;
  clock: ReturnType<typeof makeClock>;
  provider: FakeWeatherProvider;
  cache: FakeCacheStore | null;
}

function defaultProvider(): FakeWeatherProvider {
  const provider = makeProvider();
  provider.searchLocations.mockResolvedValue([makeCandidate({ timeZone: 'Europe/Paris' })]);
  return provider;
}

export async function createHttpTestApp(
  options: {
    env?: Record<string, string>;
    overrides?: HttpTestAppOverrides;
  } = {},
): Promise<HttpTestApp> {
  const clock = options.overrides?.clock ?? makeClock();
  const provider = (options.overrides?.provider as FakeWeatherProvider) ?? defaultProvider();
  const cache = options.overrides?.cache ?? null;

  process.env.WEATHERAPI_KEY = process.env.WEATHERAPI_KEY ?? 'test-key';
  for (const [key, value] of Object.entries(options.env ?? {})) {
    process.env[key] = value;
  }
  const config = parseConfig(process.env);
  const logger = createRedactedLogger({ logLevel: 'silent' } as never);

  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WEATHER_PROVIDER)
    .useValue(provider)
    .overrideProvider(CLOCK)
    .useValue(clock);

  if (cache !== null) {
    builder.overrideProvider(CACHE_STORE).useValue(cache);
  }
  if (options.overrides?.locationService !== undefined) {
    builder.overrideProvider(LOCATION_SERVICE).useValue(options.overrides.locationService);
  }
  if (options.overrides?.weatherService !== undefined) {
    builder.overrideProvider(WEATHER_SERVICE).useValue(options.overrides.weatherService);
  }
  if (options.overrides?.assessmentService !== undefined) {
    builder.overrideProvider(ASSESSMENT_SERVICE).useValue(options.overrides.assessmentService);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureHttpApp(app, config, logger);
  await app.init();
  return {
    app,
    logger,
    config,
    clock: clock as ReturnType<typeof makeClock>,
    provider,
    cache,
  };
}
