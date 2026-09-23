import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, type NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import type { RedactedLogger } from '../../observability/logger.js';
import { registerWeatherTools, type McpServices } from './mcp-tools.js';

export const MCP_SERVER_INFO = {
  name: 'weather-intelligence-service',
  version: '1.0.0',
} as const;

export type McpServerFactory = () => McpServer;

export function createMcpServer(services: McpServices, logger: RedactedLogger): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, { capabilities: { tools: {} } });
  registerWeatherTools(server, services, logger);
  return server;
}

export function createMcpServerFactory(
  services: McpServices,
  logger: RedactedLogger,
): McpServerFactory {
  return () => createMcpServer(services, logger);
}

export function createStatelessHttpHandler(
  factory: McpServerFactory,
  logger: RedactedLogger,
): NodeMcpRequestHandler {
  const handler = createMcpHandler(factory, {
    legacy: 'stateless',
    onerror: (error) => {
      logger.warn({ interface: 'mcp-http', error: error.message }, 'MCP HTTP handler error.');
    },
  });
  return toNodeHandler(handler, {
    onerror: (error) => {
      logger.warn({ interface: 'mcp-http', error: error.message }, 'MCP HTTP adapter error.');
    },
  });
}
