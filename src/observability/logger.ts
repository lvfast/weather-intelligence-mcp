import pino from 'pino';
import type { LoggerService } from '@nestjs/common';
import type { AppConfig } from '../config/config.schema.js';

const REDACT_PATHS = [
  'key',
  '*.key',
  'apiKey',
  '*.apiKey',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'headers.authorization',
  'req.headers.authorization',
];

export class RedactedLogger {
  constructor(private readonly pinoLogger: pino.Logger) {}

  debug(data: Record<string, unknown>, message: string): void {
    this.pinoLogger.debug(data, message);
  }

  info(data: Record<string, unknown>, message: string): void {
    this.pinoLogger.info(data, message);
  }

  warn(data: Record<string, unknown>, message: string): void {
    this.pinoLogger.warn(data, message);
  }

  error(data: Record<string, unknown>, message: string): void {
    this.pinoLogger.error(data, message);
  }

  child(bindings: Record<string, unknown>): RedactedLogger {
    return new RedactedLogger(this.pinoLogger.child(bindings));
  }
}

export function createRedactedLogger(config: Pick<AppConfig, 'logLevel'>): RedactedLogger {
  const destination = pino.destination({ dest: process.stderr.fd, sync: true });
  const pinoLogger = pino(
    {
      level: config.logLevel,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
    destination,
  );
  return new RedactedLogger(pinoLogger);
}

export class NestLoggerAdapter implements LoggerService {
  constructor(private readonly logger: RedactedLogger) {}

  log(message: unknown, context?: string): void {
    this.logger.info({ context: context ?? 'Nest' }, String(message));
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.logger.error({ context: context ?? 'Nest', stack }, String(message));
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn({ context: context ?? 'Nest' }, String(message));
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug({ context: context ?? 'Nest' }, String(message));
  }
}
