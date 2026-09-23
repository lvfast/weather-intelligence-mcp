import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { isAppError, type ErrorCode } from '../../domain/errors.js';
import type { RedactedLogger } from '../../observability/logger.js';
import { requestIdOf, type RequestWithContext } from './request-context.js';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  LOCATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  LOCATION_AMBIGUOUS: HttpStatus.CONFLICT,
  FORECAST_WINDOW_UNAVAILABLE: HttpStatus.UNPROCESSABLE_ENTITY,
  UPSTREAM_UNAUTHORIZED: HttpStatus.BAD_GATEWAY,
  UPSTREAM_QUOTA_EXCEEDED: HttpStatus.SERVICE_UNAVAILABLE,
  UPSTREAM_PLAN_RESTRICTED: HttpStatus.BAD_GATEWAY,
  UPSTREAM_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  UPSTREAM_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  PROVIDER_BUDGET_EXHAUSTED: HttpStatus.SERVICE_UNAVAILABLE,
  PROVIDER_BUDGET_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  CACHE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  REQUEST_CANCELLED: 499,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

const SAFE_DETAILS_CODES = new Set<ErrorCode>(['LOCATION_AMBIGUOUS', 'VALIDATION_ERROR']);

interface HttpLikeError {
  statusCode?: number;
  status?: number;
  type?: string;
}

function isPayloadTooLarge(exception: unknown): boolean {
  if (typeof exception !== 'object' || exception === null) {
    return false;
  }
  const candidate = exception as HttpLikeError;
  return (
    candidate.statusCode === 413 ||
    candidate.status === 413 ||
    candidate.type === 'entity.too.large'
  );
}

@Catch()
export class RestExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: RedactedLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<RequestWithContext>();
    const requestId = requestIdOf(request);

    if (isPayloadTooLarge(exception)) {
      response.status(413).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request body exceeds the 64 KiB limit.',
          requestId,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === HttpStatus.SERVICE_UNAVAILABLE
          ? 'CACHE_UNAVAILABLE'
          : status === HttpStatus.TOO_MANY_REQUESTS
            ? 'RATE_LIMITED'
            : 'INTERNAL_ERROR';
      response.status(status).json({
        error: { code, message: exception.message, requestId },
      });
      return;
    }

    if (isAppError(exception)) {
      const status = STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
      if (exception.code === 'REQUEST_CANCELLED') {
        this.logger.warn(
          { code: exception.code, requestId },
          'Request cancelled; no response written.',
        );
        if (!response.writableEnded && response.socket?.writable) {
          response.status(499).json({
            error: { code: exception.code, message: exception.message, requestId },
          });
        }
        return;
      }
      this.logger.warn({ code: exception.code, requestId }, 'Request failed with a known error.');
      response.status(status).json({
        error: {
          code: exception.code,
          message: exception.message,
          ...(SAFE_DETAILS_CODES.has(exception.code) && exception.details !== undefined
            ? { details: exception.details }
            : {}),
          requestId,
        },
      });
      return;
    }

    this.logger.error(
      { requestId, error: exception instanceof Error ? exception.message : String(exception) },
      'Unhandled error while serving request.',
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId },
    });
  }
}
