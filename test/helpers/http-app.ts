import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { configureHttpApp } from '../../src/entrypoints/http.js';
import { parseConfig, type AppConfig } from '../../src/config/config.schema.js';
import { createRedactedLogger, type RedactedLogger } from '../../src/observability/logger.js';
import {
  ASSESSMENT_SERVICE,
  CLOCK,
  LOCATION_SERVICE,
  WEATHER_PROVIDER,
  WEATHER_SERVICE,
} from '../../src/domain/ports.js';
import {
  makeAssessmentService,
  makeClock,
  makeLocationService,
  makeProvider,
  makeWeatherService,
} from './fakes.js';

export interface HttpTestAppOverrides {
  locationService?: unknown;
  weatherService?: unknown;
  assessmentService?: unknown;
  provider?: unknown;
  clock?: unknown;
}

export interface HttpTestApp {
  app: INestApplication;
  logger: RedactedLogger;
  config: AppConfig;
}

export async function createHttpTestApp(
  options: {
    env?: Record<string, string>;
    overrides?: HttpTestAppOverrides;
  } = {},
): Promise<HttpTestApp> {
  const clock = options.overrides?.clock ?? makeClock();
  const provider = options.overrides?.provider ?? makeProvider();
  const locationService = options.overrides?.locationService ?? makeLocationService();
  const weatherService = options.overrides?.weatherService ?? makeWeatherService();
  const assessmentService = options.overrides?.assessmentService ?? makeAssessmentService();

  process.env.WEATHERAPI_KEY = process.env.WEATHERAPI_KEY ?? 'test-key';
  for (const [key, value] of Object.entries(options.env ?? {})) {
    process.env[key] = value;
  }
  const config = parseConfig(process.env);
  const logger = createRedactedLogger({ logLevel: 'silent' } as never);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WEATHER_PROVIDER)
    .useValue(provider)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(LOCATION_SERVICE)
    .useValue(locationService)
    .overrideProvider(WEATHER_SERVICE)
    .useValue(weatherService)
    .overrideProvider(ASSESSMENT_SERVICE)
    .useValue(assessmentService)
    .compile();

  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureHttpApp(app, config, logger);
  await app.init();
  return { app, logger, config };
}
