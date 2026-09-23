import type { Request } from 'express';
import { randomUUID } from 'node:crypto';

export interface RequestWithContext extends Request {
  requestId?: string;
  deadlineSignal?: AbortSignal;
  deadlineController?: AbortController;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function requestIdOf(request: RequestWithContext): string {
  return request.requestId ?? 'unknown';
}

export function attachRequestId(request: RequestWithContext): string {
  const header = request.headers['x-request-id'];
  const candidate = Array.isArray(header) ? header[0] : header;
  const requestId =
    candidate !== undefined && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
  request.requestId = requestId;
  return requestId;
}
