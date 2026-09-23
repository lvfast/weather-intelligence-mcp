import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module.js';
import { parseConfig, type AppConfig } from '../config/config.schema.js';
import {
  NestLoggerAdapter,
  createRedactedLogger,
  type RedactedLogger,
} from '../observability/logger.js';
import { RestExceptionFilter } from '../interfaces/rest/rest-exception.filter.js';
import {
  deadlineMiddleware,
  hostGuard,
  originGuard,
  rateLimitMiddleware,
  requestIdMiddleware,
} from '../interfaces/rest/http-protection.js';

const BODY_LIMIT_BYTES = 65_536;

export function configureHttpApp(
  app: INestApplication,
  config: AppConfig,
  logger: RedactedLogger,
): void {
  app.use(requestIdMiddleware());
  app.use(hostGuard(config));
  app.use(originGuard(config));
  const rateLimit = rateLimitMiddleware(config, logger);
  app.use((request: Request, response: Response, next: NextFunction) => {
    const path = request.path ?? '';
    if (path.startsWith('/api') || path.startsWith('/mcp')) {
      rateLimit(request, response, next);
      return;
    }
    next();
  });
  app.use(deadlineMiddleware(config));
  app.use(express.json({ limit: BODY_LIMIT_BYTES }));
  app.useGlobalFilters(new RestExceptionFilter(logger));

  if (config.originAllowlist.length > 0) {
    app.enableCors({ origin: config.originAllowlist });
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Weather Intelligence Service')
    .setDescription(
      'Normalized WeatherAPI data and deterministic activity-risk assessments ' +
        'through REST and MCP. Weather units are metric and timestamps are ISO 8601 ' +
        'with explicit offsets.',
    )
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}

export async function bootstrapHttp(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = parseConfig(env);
  const logger = createRedactedLogger(config);
  const app = await NestFactory.create(AppModule, {
    logger: new NestLoggerAdapter(logger),
    bodyParser: false,
  });
  configureHttpApp(app, config, logger);
  await app.listen(config.port, config.host);
  logger.info({ host: config.host, port: config.port }, 'HTTP runtime listening.');
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down the HTTP runtime.');
    void app.close().then(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await bootstrapHttp();
}
