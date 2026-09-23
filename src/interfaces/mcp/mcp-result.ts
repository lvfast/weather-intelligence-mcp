import type { CallToolResult } from '@modelcontextprotocol/server';
import { AppError, isAppError, type ErrorCode } from '../../domain/errors.js';
import type { LocationCandidate, LocationResolution } from '../../domain/location.js';
import type { ServiceResult } from '../../domain/ports.js';

const SAFE_DETAILS_CODES = new Set<ErrorCode>(['VALIDATION_ERROR', 'LOCATION_AMBIGUOUS']);

export function textSummary(structured: unknown): string {
  const json = JSON.stringify(structured ?? {});
  return json.length <= 999 ? json : `${json.slice(0, 996)}...`;
}

function successResult(structured: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: textSummary(structured) }],
    structuredContent: structured,
  };
}

export function toMcpSuccess<T>(result: ServiceResult<T>): CallToolResult {
  return successResult(result as unknown as Record<string, unknown>);
}

export function toMcpResolutionResult(resolution: LocationResolution): CallToolResult {
  return successResult(resolution as unknown as Record<string, unknown>);
}

export function toMcpLocationResolution(resolution: LocationResolution): CallToolResult {
  if (resolution.status === 'resolved') {
    return successResult({ status: 'resolved', location: resolution.location });
  }
  if (resolution.status === 'ambiguous') {
    return successResult({
      status: 'location_resolution_required',
      candidates: resolution.candidates,
    });
  }
  return toMcpError(new AppError('LOCATION_NOT_FOUND', 'No matching location found.'));
}

export function toMcpError(error: unknown): CallToolResult {
  const code: ErrorCode = isAppError(error) ? error.code : 'INTERNAL_ERROR';
  const message = isAppError(error) ? error.message : 'An unexpected error occurred.';
  const details = isAppError(error) && SAFE_DETAILS_CODES.has(code) ? error.details : undefined;
  const structured = {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
  return {
    isError: true,
    content: [{ type: 'text', text: `${code}: ${message}` }],
    structuredContent: structured,
  };
}

export function toMcpWorkflowOrError(error: unknown): CallToolResult {
  if (isAppError(error) && error.code === 'LOCATION_AMBIGUOUS') {
    const details = error.details as { candidates?: LocationCandidate[] } | undefined;
    const candidates = Array.isArray(details?.candidates) ? details.candidates : [];
    return toMcpLocationResolution({ status: 'ambiguous', candidates });
  }
  return toMcpError(error);
}
