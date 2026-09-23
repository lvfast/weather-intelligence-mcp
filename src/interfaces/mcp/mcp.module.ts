import { All, Controller, Inject, Module, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import {
  APP_LOGGER,
  ASSESSMENT_SERVICE,
  LOCATION_SERVICE,
  WEATHER_SERVICE,
} from '../../domain/ports.js';
import type { AppConfig } from '../../config/config.schema.js';
import { APP_CONFIG, ConfigModule } from '../../config/config.module.js';
import { createRedactedLogger, type RedactedLogger } from '../../observability/logger.js';
import { AssessmentModule } from '../../application/assessment/assessment.module.js';
import type { AssessmentService } from '../../application/assessment/assessment.service.js';
import { LocationModule } from '../../application/location/location.module.js';
import type { LocationService } from '../../application/location/location.service.js';
import { WeatherModule } from '../../application/weather/weather.module.js';
import type { WeatherService } from '../../application/weather/weather.service.js';
import {
  createMcpServerFactory,
  createStatelessHttpHandler,
  type McpServerFactory,
} from './mcp.factory.js';

export const MCP_SERVER_FACTORY = Symbol('MCP_SERVER_FACTORY');
export const MCP_HTTP_HANDLER = Symbol('MCP_HTTP_HANDLER');

@Controller('mcp')
export class McpController {
  constructor(@Inject(MCP_HTTP_HANDLER) private readonly handler: NodeMcpRequestHandler) {}

  @All()
  async handle(@Req() request: Request, @Res() response: Response): Promise<void> {
    const parsedBody = (request as Request & { body?: unknown }).body;
    await this.handler(request, response, parsedBody);
  }
}

@Module({
  imports: [ConfigModule, LocationModule, WeatherModule, AssessmentModule],
  controllers: [McpController],
  providers: [
    {
      provide: APP_LOGGER,
      useFactory: (config: AppConfig) => createRedactedLogger(config),
      inject: [APP_CONFIG],
    },
    {
      provide: MCP_SERVER_FACTORY,
      useFactory: (
        locations: LocationService,
        weather: WeatherService,
        assessments: AssessmentService,
        logger: RedactedLogger,
      ): McpServerFactory => createMcpServerFactory({ locations, weather, assessments }, logger),
      inject: [LOCATION_SERVICE, WEATHER_SERVICE, ASSESSMENT_SERVICE, APP_LOGGER],
    },
    {
      provide: MCP_HTTP_HANDLER,
      useFactory: (factory: McpServerFactory, logger: RedactedLogger): NodeMcpRequestHandler =>
        createStatelessHttpHandler(factory, logger),
      inject: [MCP_SERVER_FACTORY, APP_LOGGER],
    },
  ],
  exports: [MCP_SERVER_FACTORY, MCP_HTTP_HANDLER, APP_LOGGER],
})
export class McpModule {}
