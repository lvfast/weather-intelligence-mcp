import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixturePath = path.join(projectRoot, 'test', 'fixtures', 'stdio-test-server.ts');

function spawnServer(): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ['--import', 'tsx', fixturePath], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, WEATHERAPI_KEY: 'stdio-test-key', CACHE_BACKEND: 'memory' },
  });
}

interface RawExchange {
  process: ChildProcessWithoutNullStreams;
  stdoutLines: string[];
  stderrLines: string[];
  request(method: string, params?: unknown): Promise<Record<string, unknown>>;
  notify(method: string, params?: unknown): void;
  close(): Promise<void>;
}

function startRawExchange(): RawExchange {
  const child = spawnServer();
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let stdoutBuffer = '';
  let stderrBuffer = '';
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  let nextId = 1;

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8');
    let index = stdoutBuffer.indexOf('\n');
    while (index >= 0) {
      const line = stdoutBuffer.slice(0, index).trim();
      stdoutBuffer = stdoutBuffer.slice(index + 1);
      if (line.length > 0) {
        stdoutLines.push(line);
        try {
          const message = JSON.parse(line) as Record<string, unknown>;
          const id = message.id;
          if (typeof id === 'number' && pending.has(id)) {
            pending.get(id)?.(message);
            pending.delete(id);
          }
        } catch {
          // asserted later
        }
      }
      index = stdoutBuffer.indexOf('\n');
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString('utf8');
    let index = stderrBuffer.indexOf('\n');
    while (index >= 0) {
      const line = stderrBuffer.slice(0, index).trim();
      stderrBuffer = stderrBuffer.slice(index + 1);
      if (line.length > 0) {
        stderrLines.push(line);
      }
      index = stderrBuffer.indexOf('\n');
    }
  });

  const exchange: RawExchange = {
    process: child,
    stdoutLines,
    stderrLines,
    request(method, params) {
      const id = nextId;
      nextId += 1;
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 15_000);
        pending.set(id, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
        child.stdin.write(`${payload}\n`);
      });
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {} })}\n`);
    },
    close() {
      return new Promise((resolve) => {
        child.once('exit', () => resolve());
        child.kill();
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 2000);
      });
    },
  };
  return exchange;
}

async function waitFor(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('MCP stdio with the official client', () => {
  it('initializes, lists five tools, and calls a tool with deterministic fakes', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', fixturePath],
      cwd: projectRoot,
      stderr: 'pipe',
      env: { ...process.env, WEATHERAPI_KEY: 'stdio-test-key', CACHE_BACKEND: 'memory' },
    });
    const stderrChunks: string[] = [];
    transport.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString('utf8')));
    const client = new Client({ name: 'weather-stdio-e2e', version: '1.0.0' });
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
      const result = await client.callTool({
        name: 'get_current_weather',
        arguments: { query: 'Paris' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        data: { location: { name: 'Paris' } },
        meta: { provider: 'weatherapi' },
      });
      await waitFor(() => stderrChunks.join('').includes('stdio test server ready'));
      expect(stderrChunks.join('')).toContain('stdio test server ready');
    } finally {
      await client.close();
    }
  }, 60_000);
});

describe('MCP stdio stream separation', () => {
  it('emits only valid MCP protocol frames on stdout and diagnostics on stderr', async () => {
    const exchange = startRawExchange();
    try {
      const initialize = await exchange.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'raw-e2e', version: '1.0.0' },
      });
      expect(initialize).toMatchObject({ jsonrpc: '2.0' });
      exchange.notify('notifications/initialized');
      const tools = await exchange.request('tools/list');
      expect(tools).toMatchObject({ jsonrpc: '2.0' });
      const call = await exchange.request('tools/call', {
        name: 'get_current_weather',
        arguments: { query: 'Paris' },
      });
      expect(call).toMatchObject({ jsonrpc: '2.0' });

      await waitFor(() =>
        exchange.stderrLines.some((line) => line.includes('stdio test server ready')),
      );

      for (const line of exchange.stdoutLines) {
        const parsed = JSON.parse(line) as { jsonrpc?: string };
        expect(parsed.jsonrpc).toBe('2.0');
      }
      expect(exchange.stdoutLines.join('\n')).not.toContain('stdio test server ready');
      expect(exchange.stdoutLines.join('\n')).not.toContain('MCP tool call completed');

      const readyLine = exchange.stderrLines.find((line) =>
        line.includes('stdio test server ready'),
      );
      expect(readyLine).toBeDefined();
      expect(JSON.parse(readyLine as string)).toMatchObject({ level: 'info' });
      for (const line of exchange.stderrLines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    } finally {
      await exchange.close();
    }
  }, 60_000);
});
