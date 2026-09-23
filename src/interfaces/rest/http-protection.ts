import type { NextFunction, Request, Response } from 'express';
import { createClient } from 'redis';
import type { AppConfig } from '../../config/config.schema.js';
import type { RedactedLogger } from '../../observability/logger.js';
import { attachRequestId, type RequestWithContext } from './request-context.js';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function forbidden(response: Response, message: string, requestId: string): void {
  response.status(403).json({
    error: { code: 'VALIDATION_ERROR', message, requestId },
  });
}

export function hostGuard(
  config: AppConfig,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    const host = (request.headers.host ?? '').split(':')[0]?.toLowerCase() ?? '';
    const allowed =
      config.exposureMode === 'local'
        ? [...LOCAL_HOSTS, ...config.hostAllowlist.map((entry) => entry.toLowerCase())]
        : config.hostAllowlist.map((entry) => entry.toLowerCase());
    if (!allowed.includes(host)) {
      const requestId = (request as RequestWithContext).requestId ?? 'unknown';
      forbidden(response, 'The request host is not allowed.', requestId);
      return;
    }
    next();
  };
}

export function originGuard(
  config: AppConfig,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    const origin = request.headers.origin;
    if (origin === undefined) {
      next();
      return;
    }
    if (config.originAllowlist.includes(origin)) {
      next();
      return;
    }
    const requestId = (request as RequestWithContext).requestId ?? 'unknown';
    forbidden(response, 'The request origin is not allowed.', requestId);
  };
}

export function requestIdMiddleware(): (
  request: RequestWithContext,
  response: Response,
  next: NextFunction,
) => void {
  return (request, response, next) => {
    const requestId = attachRequestId(request);
    response.setHeader('X-Request-Id', requestId);
    next();
  };
}

export function deadlineMiddleware(
  config: AppConfig,
): (request: RequestWithContext, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    const controller = new AbortController();
    request.deadlineController = controller;
    request.deadlineSignal = controller.signal;
    const timer = setTimeout(() => {
      controller.abort(new Error('request deadline exceeded'));
    }, config.requestDeadlineMs);
    response.on('finish', () => clearTimeout(timer));
    response.on('close', () => clearTimeout(timer));
    next();
  };
}

interface RateBucket {
  timestamps: number[];
}

export function rateLimitMiddleware(
  config: AppConfig,
  logger: RedactedLogger,
): (request: Request, response: Response, next: NextFunction) => void {
  if (config.cacheBackend === 'redis' && config.redisUrl !== null) {
    return redisRateLimit(config, logger);
  }
  return memoryRateLimit(config, logger);
}

function clientIp(request: Request): string {
  return request.socket.remoteAddress ?? 'unknown';
}

function memoryRateLimit(
  config: AppConfig,
  logger: RedactedLogger,
): (request: Request, response: Response, next: NextFunction) => void {
  const buckets = new Map<string, RateBucket>();
  const limit = config.rateLimitPerMinute;
  return (request, response, next) => {
    const now = Date.now();
    const windowStart = now - 60_000;
    const ip = clientIp(request);
    const bucket = buckets.get(ip) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((timestamp) => timestamp > windowStart);
    if (bucket.timestamps.length >= limit) {
      const requestId = (request as RequestWithContext).requestId ?? 'unknown';
      logger.warn({ requestId, ip }, 'Request rejected by the rolling rate limit.');
      response.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests.', requestId },
      });
      return;
    }
    bucket.timestamps.push(now);
    buckets.set(ip, bucket);
    next();
  };
}

function redisRateLimit(
  config: AppConfig,
  logger: RedactedLogger,
): (request: Request, response: Response, next: NextFunction) => void {
  const client = createClient({
    url: config.redisUrl ?? undefined,
    socket: {
      reconnectStrategy: (retries) =>
        retries < 2 ? Math.min(retries * 200, 1000) : new Error('Redis unavailable'),
    },
  });
  client.connect().catch(() => undefined);
  const limit = config.rateLimitPerMinute;
  const script = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], 120)
end
return current
`;
  return (request, response, next) => {
    const now = new Date();
    const minute = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
    const key = `wis:rate:${clientIp(request)}:${minute}`;
    client
      .eval(script, { keys: [key], arguments: [] })
      .then((count) => {
        const calls = Number(count);
        if (calls > limit) {
          const requestId = (request as RequestWithContext).requestId ?? 'unknown';
          response.status(429).json({
            error: { code: 'RATE_LIMITED', message: 'Too many requests.', requestId },
          });
          return;
        }
        next();
      })
      .catch(() => {
        const requestId = (request as RequestWithContext).requestId ?? 'unknown';
        logger.warn({ requestId }, 'Rate-limit state is unavailable; failing closed.');
        response.status(429).json({
          error: { code: 'RATE_LIMITED', message: 'Rate-limit state is unavailable.', requestId },
        });
      });
  };
}
