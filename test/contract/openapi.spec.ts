import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import type { INestApplication } from '@nestjs/common';
import { createHttpTestApp } from '../helpers/http-app.js';

let app: INestApplication;

beforeAll(async () => {
  const created = await createHttpTestApp();
  app = created.app;
});

afterAll(async () => {
  await app.close();
});

const openApiMetaSchema = z.object({
  openapi: z.string().regex(/^3\.\d+/),
  info: z.object({ title: z.string(), version: z.string() }),
  paths: z.record(
    z.string(),
    z.record(z.enum(['get', 'post', 'put', 'delete', 'patch']), z.unknown()),
  ),
});

describe('OpenAPI contract', () => {
  it('serves the generated document at /docs-json', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const parsed = openApiMetaSchema.safeParse(response.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.info.title).toBeTruthy();
    }
  });

  it('documents every public route with the correct method', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const paths = response.body.paths as Record<string, Record<string, unknown>>;
    expect(paths['/api/v1/locations/resolve']?.get).toBeDefined();
    expect(paths['/api/v1/weather/current']?.get).toBeDefined();
    expect(paths['/api/v1/weather/forecast']?.get).toBeDefined();
    expect(paths['/api/v1/weather/alerts']?.get).toBeDefined();
    expect(paths['/api/v1/weather/assessments']?.post).toBeDefined();
    expect(paths['/health/live']?.get).toBeDefined();
    expect(paths['/health/ready']?.get).toBeDefined();
  });

  it('uses unique operation ids', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const operationIds: string[] = [];
    const paths = response.body.paths as Record<string, Record<string, { operationId?: string }>>;
    for (const methods of Object.values(paths)) {
      for (const operation of Object.values(methods)) {
        if (typeof operation.operationId === 'string') {
          operationIds.push(operation.operationId);
        }
      }
    }
    expect(operationIds.length).toBeGreaterThan(0);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it('serves the Swagger UI at /docs', async () => {
    const response = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(response.text).toContain('swagger');
  });
});
