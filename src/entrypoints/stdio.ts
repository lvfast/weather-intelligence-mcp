import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { AppModule } from '../app.module.js';
import { APP_LOGGER } from '../domain/ports.js';
import type { RedactedLogger } from '../observability/logger.js';
import { MCP_SERVER_FACTORY } from '../interfaces/mcp/mcp.module.js';
import type { McpServerFactory } from '../interfaces/mcp/mcp.factory.js';

async function bootstrap(): Promise<void> {
  const context = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const factory = context.get<McpServerFactory>(MCP_SERVER_FACTORY);
  const logger = context.get<RedactedLogger>(APP_LOGGER);
  const handle = serveStdio(factory, {
    onerror: (error) => {
      logger.warn({ interface: 'mcp-stdio', error: error.message }, 'MCP stdio error.');
    },
  });
  logger.info(
    { interface: 'mcp-stdio' },
    'Stdio runtime ready; stdout is reserved for MCP traffic.',
  );

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down the stdio runtime.');
    void handle.close().then(() => context.close().then(() => process.exit(0)));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

await bootstrap();
