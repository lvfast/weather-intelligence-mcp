import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const apiKey = process.env.WEATHERAPI_KEY;
const enabled = process.env.RUN_LIVE_WEATHERAPI_TESTS === 'true' && apiKey !== undefined;

describe.skipIf(!enabled)('live MCP stdio smoke test', () => {
  it('drives the real provider through the official MCP client over stdio', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', path.join(projectRoot, 'src', 'entrypoints', 'stdio.ts')],
      cwd: projectRoot,
      stderr: 'pipe',
      env: { ...process.env, WEATHERAPI_KEY: apiKey as string, CACHE_BACKEND: 'memory' },
    });
    transport.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk.toString('utf8')));
    const client = new Client({ name: 'weather-live-verify', version: '1.0.0' });
    try {
      await client.connect(transport);

      const listing = await client.listTools();
      expect(listing.tools.map((tool) => tool.name)).toEqual([
        'resolve_location',
        'get_current_weather',
        'get_weather_forecast',
        'get_weather_alerts',
        'assess_weather_conditions',
      ]);

      const resolved = await client.callTool({
        name: 'resolve_location',
        arguments: { query: 'Hanoi' },
      });
      expect(resolved.isError).toBeFalsy();
      expect(resolved.structuredContent).toMatchObject({
        status: 'resolved',
        location: { name: 'Hanoi', country: 'Vietnam' },
      });

      const current = await client.callTool({
        name: 'get_current_weather',
        arguments: { query: 'Hanoi' },
      });
      expect(current.isError).toBeFalsy();
      const currentData = current.structuredContent as {
        data: {
          location: { timeZone: string };
          interval: { temperatureC: number; humidityPercent: number };
        };
        meta: { provider: string; stale: boolean };
      };
      expect(currentData.meta).toMatchObject({ provider: 'weatherapi', stale: false });
      expect(currentData.data.location.timeZone).toBeTruthy();
      expect(typeof currentData.data.interval.temperatureC).toBe('number');
      expect(currentData.data.interval.humidityPercent).toBeGreaterThanOrEqual(0);
      expect(currentData.data.interval.humidityPercent).toBeLessThanOrEqual(100);

      const assessment = await client.callTool({
        name: 'assess_weather_conditions',
        arguments: { location: { query: 'Hanoi' }, activity: 'running' },
      });
      expect(assessment.isError).toBeFalsy();
      expect(assessment.structuredContent).toMatchObject({
        data: {
          activity: 'running',
          ruleVersion: 'weather-activity-rules/1.0.0',
          source: { provider: 'weatherapi' },
        },
      });
    } finally {
      await client.close();
    }
  }, 60_000);
});
