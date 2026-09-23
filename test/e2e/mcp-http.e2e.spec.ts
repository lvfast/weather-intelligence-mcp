import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { AppError } from '../../src/domain/errors.js';
import {
  currentWeatherSchema,
  forecastSchema,
  locationResolutionSchema,
  serviceResultSchema,
  weatherAlertsResultSchema,
  weatherAssessmentSchema,
} from '../../src/interfaces/common/schemas.js';
import { createHttpTestApp } from '../helpers/http-app.js';
import { makeCandidate, makeLocationService, makeWeatherService } from '../helpers/fakes.js';

let app: INestApplication;
let baseUrl: string;
let locationService: ReturnType<typeof makeLocationService>;
let weatherService: ReturnType<typeof makeWeatherService>;

const EXPECTED_TOOLS = [
  'resolve_location',
  'get_current_weather',
  'get_weather_forecast',
  'get_weather_alerts',
  'assess_weather_conditions',
];

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  const client = new Client({ name: 'weather-e2e', version: '1.0.0' });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

beforeAll(async () => {
  locationService = makeLocationService();
  weatherService = makeWeatherService();
  const created = await createHttpTestApp({
    overrides: { locationService, weatherService },
  });
  app = created.app;
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
});

describe('MCP Streamable HTTP', () => {
  it('lists exactly the five weather tools', async () => {
    await withClient(async (client) => {
      const listing = await client.listTools();
      expect(listing.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
      for (const tool of listing.tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.annotations?.destructiveHint).toBe(false);
      }
    });
  });

  it('resolves locations and validates the declared output schema', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'resolve_location',
        arguments: { query: 'Paris', limit: 3 },
      });
      expect(result.isError).toBeFalsy();
      locationResolutionSchema.parse(result.structuredContent);
      expect(result.structuredContent).toMatchObject({ status: 'resolved' });
    });
  });

  it('returns current weather as a schema-valid service envelope', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'get_current_weather',
        arguments: { locationId: 'opaque-1' },
      });
      expect(result.isError).toBeFalsy();
      serviceResultSchema(currentWeatherSchema).parse(result.structuredContent);
      expect(weatherService.getCurrent).toHaveBeenCalledWith(
        { locationId: 'opaque-1' },
        expect.anything(),
      );
    });
  });

  it('returns forecasts with hourly intervals only when requested', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'get_weather_forecast',
        arguments: { query: 'Paris', days: 2, includeHourly: true },
      });
      expect(result.isError).toBeFalsy();
      serviceResultSchema(forecastSchema).parse(result.structuredContent);
      expect(weatherService.getForecast).toHaveBeenCalledWith(
        { query: 'Paris' },
        { days: 2, includeHourly: true },
        expect.anything(),
      );
    });
  });

  it('returns alerts with limited coverage metadata', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'get_weather_alerts',
        arguments: { coordinates: { lat: 10.7, lon: 106.7 } },
      });
      expect(result.isError).toBeFalsy();
      serviceResultSchema(weatherAlertsResultSchema).parse(result.structuredContent);
    });
  });

  it('assesses conditions with the shared contract', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'assess_weather_conditions',
        arguments: {
          location: { query: 'Paris' },
          activity: 'running',
          startTime: '2026-09-24T06:00:00+02:00',
          endTime: '2026-09-24T08:00:00+02:00',
        },
      });
      expect(result.isError).toBeFalsy();
      serviceResultSchema(weatherAssessmentSchema).parse(result.structuredContent);
    });
  });

  it('returns ambiguity as a successful workflow result, not an execution error', async () => {
    weatherService.getCurrent.mockRejectedValueOnce(
      new AppError('LOCATION_AMBIGUOUS', 'Multiple locations match the query.', {
        details: {
          candidates: [makeCandidate({ locationId: 'a' }), makeCandidate({ locationId: 'b' })],
        },
      }),
    );
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'get_current_weather',
        arguments: { query: 'Springfield' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        status: 'location_resolution_required',
        candidates: expect.any(Array),
      });
    });
  });

  it('returns not-found as a structured tool error', async () => {
    weatherService.getCurrent.mockRejectedValueOnce(
      new AppError('LOCATION_NOT_FOUND', 'No matching location found.'),
    );
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'get_current_weather',
        arguments: { query: 'missing' },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: 'LOCATION_NOT_FOUND' },
      });
    });
  });

  it('rejects unknown input fields through the shared schema', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'get_current_weather',
        arguments: { query: 'Paris', extra: true },
      });
      expect(result.isError).toBe(true);
    });
  });

  it('serves sequential stateless calls', async () => {
    await withClient(async (client) => {
      await client.listTools();
      await client.callTool({ name: 'resolve_location', arguments: { query: 'Paris' } });
      await client.callTool({ name: 'resolve_location', arguments: { query: 'Paris' } });
      const second = await client.listTools();
      expect(second.tools).toHaveLength(5);
    });
  });

  it('answers unsupported GET and DELETE session operations with the SDK stateless response', async () => {
    await request(app.getHttpServer()).get('/mcp').expect(405);
    await request(app.getHttpServer()).delete('/mcp').expect(405);
  });

  it('applies Host and Origin safeguards to /mcp', async () => {
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Host', 'evil.example.com')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Origin', 'https://evil.example.com')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(403);
  });
});
