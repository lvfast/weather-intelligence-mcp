import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { AppModule } from '../../src/app.module.js';
import { CACHE_STORE, CLOCK, PROVIDER_QUOTA, WEATHER_PROVIDER } from '../../src/domain/ports.js';
import { MCP_SERVER_FACTORY } from '../../src/interfaces/mcp/mcp.module.js';
import type { McpServerFactory } from '../../src/interfaces/mcp/mcp.factory.js';
import { makeCache, makeCandidate, makeClock, makeProvider, makeQuota } from '../helpers/fakes.js';

process.env.WEATHERAPI_KEY = process.env.WEATHERAPI_KEY ?? 'stdio-test-key';
process.env.CACHE_BACKEND = 'memory';

const provider = makeProvider();
provider.searchLocations.mockResolvedValue([makeCandidate({ timeZone: 'Europe/Paris' })]);

const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(WEATHER_PROVIDER)
  .useValue(provider)
  .overrideProvider(CACHE_STORE)
  .useValue(makeCache())
  .overrideProvider(PROVIDER_QUOTA)
  .useValue(makeQuota())
  .overrideProvider(CLOCK)
  .useValue(makeClock())
  .compile();

const context = moduleRef.createNestApplication();
await context.init();
const factory = context.get<McpServerFactory>(MCP_SERVER_FACTORY);
serveStdio(factory, {
  onerror: (error) => {
    process.stderr.write(
      `${JSON.stringify({ level: 'warn', message: 'stdio server error', detail: error.message })}\n`,
    );
  },
});
process.stderr.write(`${JSON.stringify({ level: 'info', message: 'stdio test server ready' })}\n`);
