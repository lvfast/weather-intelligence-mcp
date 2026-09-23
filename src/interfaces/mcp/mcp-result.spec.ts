import { describe, expect, it } from 'vitest';
import { AppError } from '../../domain/errors.js';
import { makeCandidate, makeCurrent, makeLocation } from '../../../test/helpers/fakes.js';
import {
  textSummary,
  toMcpError,
  toMcpLocationResolution,
  toMcpResolutionResult,
  toMcpSuccess,
  toMcpWorkflowOrError,
} from './mcp-result.js';

const serviceResult = {
  data: makeCurrent(),
  meta: {
    requestId: 'req-1',
    provider: 'weatherapi' as const,
    fetchedAt: '2026-09-23T10:00:00.000Z',
    cached: false,
    stale: false,
    warnings: [],
  },
};

describe('toMcpSuccess', () => {
  it('mirrors the service result as structuredContent', () => {
    const result = toMcpSuccess(serviceResult);
    expect(result.structuredContent).toEqual(serviceResult);
  });

  it('emits a single text compatibility block', () => {
    const result = toMcpSuccess(serviceResult);
    expect(result.content).toEqual([{ type: 'text', text: expect.any(String) }]);
  });

  it('keeps the text summary under one thousand characters', () => {
    const result = toMcpSuccess(serviceResult);
    const [block] = result.content;
    expect(block).toMatchObject({ type: 'text' });
    if (block?.type === 'text') {
      expect(block.text.length).toBeLessThan(1000);
    }
    expect(textSummary({ big: 'x'.repeat(5000) }).length).toBeLessThan(1000);
  });
});

describe('toMcpLocationResolution', () => {
  it('maps ambiguity to a successful workflow status', () => {
    const result = toMcpLocationResolution({ status: 'ambiguous', candidates: [makeCandidate()] });
    expect(result.structuredContent).toMatchObject({
      status: 'location_resolution_required',
      candidates: expect.any(Array),
    });
    expect(result.isError).toBeUndefined();
  });

  it('maps not_found to a structured tool error', () => {
    const result = toMcpLocationResolution({ status: 'not_found', candidates: [] });
    expect(result).toMatchObject({ isError: true });
    expect(result.structuredContent).toMatchObject({
      error: { code: 'LOCATION_NOT_FOUND' },
    });
  });
});

describe('toMcpResolutionResult', () => {
  it('passes resolve_location statuses through unchanged', () => {
    const resolved = toMcpResolutionResult({ status: 'resolved', location: makeLocation() });
    expect(resolved.structuredContent).toMatchObject({ status: 'resolved' });
    const ambiguous = toMcpResolutionResult({
      status: 'ambiguous',
      candidates: [makeCandidate()],
    });
    expect(ambiguous.structuredContent).toMatchObject({ status: 'ambiguous' });
    const notFound = toMcpResolutionResult({ status: 'not_found', candidates: [] });
    expect(notFound.structuredContent).toMatchObject({ status: 'not_found' });
    expect(notFound.isError).toBeUndefined();
  });
});

describe('toMcpError', () => {
  it('marks expected errors as structured tool errors', () => {
    const result = toMcpError(new AppError('LOCATION_NOT_FOUND', 'Location not found'));
    expect(result).toMatchObject({ isError: true });
    expect(result.structuredContent).toMatchObject({
      error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' },
    });
  });

  it('never exposes secrets from causes or unsafe details', () => {
    const secretCause = new AppError('UPSTREAM_UNAVAILABLE', 'safe message', {
      cause: new Error('weather-api-secret-123'),
      details: { raw: 'weather-api-secret-123' },
    });
    expect(JSON.stringify(toMcpError(secretCause))).not.toContain('weather-api-secret');
  });

  it('normalizes unexpected errors to INTERNAL_ERROR', () => {
    const result = toMcpError(new Error('boom'));
    expect(result.structuredContent).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('boom');
  });

  it('keeps safe candidates for ambiguity details', () => {
    const error = new AppError('LOCATION_AMBIGUOUS', 'multiple', {
      details: { candidates: [makeCandidate()] },
    });
    expect(toMcpError(error).structuredContent).toMatchObject({
      error: { code: 'LOCATION_AMBIGUOUS', details: { candidates: expect.any(Array) } },
    });
  });
});

describe('toMcpWorkflowOrError', () => {
  it('converts ambiguity into the workflow result', () => {
    const error = new AppError('LOCATION_AMBIGUOUS', 'multiple', {
      details: {
        candidates: [makeCandidate({ locationId: 'a' }), makeCandidate({ locationId: 'b' })],
      },
    });
    const result = toMcpWorkflowOrError(error);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      status: 'location_resolution_required',
      candidates: expect.any(Array),
    });
  });

  it('keeps other errors as tool errors', () => {
    const result = toMcpWorkflowOrError(new AppError('UPSTREAM_TIMEOUT', 'slow'));
    expect(result).toMatchObject({ isError: true });
  });
});
