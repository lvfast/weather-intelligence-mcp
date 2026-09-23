import type { McpServer } from '@modelcontextprotocol/server';
import type { LocationResolution } from '../../domain/location.js';
import type { AssessWeatherInput, WeatherAssessment } from '../../domain/assessment.js';
import type { LocationInput } from '../../domain/location.js';
import type { ServiceResult } from '../../domain/ports.js';
import type { CurrentWeather, WeatherAlertsResult, WeatherForecast } from '../../domain/weather.js';
import type { RedactedLogger } from '../../observability/logger.js';
import {
  assessToolInputSchema,
  forecastToolInputSchema,
  mcpLocationInputSchema,
  mcpLocationToLocationInput,
  resolveLocationToolInputSchema,
  serviceResultSchema,
  weatherAlertsResultSchema,
  weatherAssessmentSchema,
  currentWeatherSchema,
  forecastSchema,
  locationResolutionSchema,
  locationResolutionRequiredSchema,
} from '../common/schemas.js';
import { z } from 'zod';
import {
  toMcpError,
  toMcpResolutionResult,
  toMcpSuccess,
  toMcpWorkflowOrError,
} from './mcp-result.js';

export interface McpServices {
  locations: {
    resolve(
      input: LocationInput,
      options?: { limit?: number },
      signal?: AbortSignal,
    ): Promise<LocationResolution>;
  };
  weather: {
    getCurrent(input: LocationInput, signal?: AbortSignal): Promise<ServiceResult<CurrentWeather>>;
    getForecast(
      input: LocationInput,
      options: { days: 1 | 2 | 3; includeHourly: boolean },
      signal?: AbortSignal,
    ): Promise<ServiceResult<WeatherForecast>>;
    getAlerts(
      input: LocationInput,
      signal?: AbortSignal,
    ): Promise<ServiceResult<WeatherAlertsResult>>;
  };
  assessments: {
    assess(
      input: AssessWeatherInput,
      signal?: AbortSignal,
    ): Promise<ServiceResult<WeatherAssessment>>;
  };
}

export const MCP_TOOL_NAMES = [
  'resolve_location',
  'get_current_weather',
  'get_weather_forecast',
  'get_weather_alerts',
  'assess_weather_conditions',
] as const;

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const resolveLocationOutputSchema = locationResolutionSchema;
const currentWeatherOutputSchema = z.union([
  serviceResultSchema(currentWeatherSchema),
  locationResolutionRequiredSchema,
]);
const forecastOutputSchema = z.union([
  serviceResultSchema(forecastSchema),
  locationResolutionRequiredSchema,
]);
const alertsOutputSchema = z.union([
  serviceResultSchema(weatherAlertsResultSchema),
  locationResolutionRequiredSchema,
]);
const assessmentOutputSchema = z.union([
  serviceResultSchema(weatherAssessmentSchema),
  locationResolutionRequiredSchema,
]);

export function registerWeatherTools(
  server: McpServer,
  services: McpServices,
  logger: RedactedLogger,
): void {
  server.registerTool(
    'resolve_location',
    {
      title: 'Resolve location',
      description:
        'Resolve a free-form place name into normalized location candidates. ' +
        'Returns status resolved, ambiguous, or not_found. Never silently selects among matches.',
      inputSchema: resolveLocationToolInputSchema,
      outputSchema: resolveLocationOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, context) => {
      const startedAt = Date.now();
      try {
        const resolution = await services.locations.resolve(
          { query: args.query },
          { limit: args.limit ?? 5 },
          context.mcpReq.signal,
        );
        logToolCompletion(logger, 'resolve_location', startedAt, resolution.status);
        return toMcpResolutionResult(resolution);
      } catch (error) {
        logToolFailure(logger, 'resolve_location', startedAt);
        return toMcpError(error);
      }
    },
  );

  server.registerTool(
    'get_current_weather',
    {
      title: 'Get current weather',
      description:
        'Normalized current weather for one resolved location, in metric units with ISO 8601 timestamps.',
      inputSchema: mcpLocationInputSchema,
      outputSchema: currentWeatherOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, context) => {
      const startedAt = Date.now();
      try {
        const result = await services.weather.getCurrent(
          mcpLocationToLocationInput(args),
          context.mcpReq.signal,
        );
        logToolCompletion(logger, 'get_current_weather', startedAt, 'resolved');
        return toMcpSuccess(result);
      } catch (error) {
        logToolFailure(logger, 'get_current_weather', startedAt);
        return toMcpWorkflowOrError(error);
      }
    },
  );

  server.registerTool(
    'get_weather_forecast',
    {
      title: 'Get weather forecast',
      description:
        'One-to-three-day normalized forecast. Hourly intervals are included only when requested.',
      inputSchema: forecastToolInputSchema,
      outputSchema: forecastOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, context) => {
      const startedAt = Date.now();
      try {
        const result = await services.weather.getForecast(
          mcpLocationToLocationInput(args),
          { days: (args.days ?? 3) as 1 | 2 | 3, includeHourly: args.includeHourly ?? false },
          context.mcpReq.signal,
        );
        logToolCompletion(logger, 'get_weather_forecast', startedAt, 'resolved');
        return toMcpSuccess(result);
      } catch (error) {
        logToolFailure(logger, 'get_weather_forecast', startedAt);
        return toMcpWorkflowOrError(error);
      }
    },
  );

  server.registerTool(
    'get_weather_alerts',
    {
      title: 'Get weather alerts',
      description:
        'Normalized active alerts with limited coverage metadata. An empty list means the ' +
        'provider returned no alert; it does not guarantee that no hazard exists.',
      inputSchema: mcpLocationInputSchema,
      outputSchema: alertsOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, context) => {
      const startedAt = Date.now();
      try {
        const result = await services.weather.getAlerts(
          mcpLocationToLocationInput(args),
          context.mcpReq.signal,
        );
        logToolCompletion(logger, 'get_weather_alerts', startedAt, 'resolved');
        return toMcpSuccess(result);
      } catch (error) {
        logToolFailure(logger, 'get_weather_alerts', startedAt);
        return toMcpWorkflowOrError(error);
      }
    },
  );

  server.registerTool(
    'assess_weather_conditions',
    {
      title: 'Assess weather conditions',
      description:
        'Deterministic, explainable activity-risk assessment for commute, running, travel, ' +
        'or outdoor_event, optionally within an explicit ISO 8601 window with an offset.',
      inputSchema: assessToolInputSchema,
      outputSchema: assessmentOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, context) => {
      const startedAt = Date.now();
      try {
        const result = await services.assessments.assess(
          {
            location: mcpLocationToLocationInput(args.location),
            activity: args.activity,
            startTime: args.startTime,
            endTime: args.endTime,
          },
          context.mcpReq.signal,
        );
        logToolCompletion(logger, 'assess_weather_conditions', startedAt, 'assessed');
        return toMcpSuccess(result);
      } catch (error) {
        logToolFailure(logger, 'assess_weather_conditions', startedAt);
        return toMcpWorkflowOrError(error);
      }
    },
  );
}

function logToolCompletion(
  logger: RedactedLogger,
  tool: string,
  startedAt: number,
  outcome: string,
): void {
  logger.info(
    { interface: 'mcp', tool, durationMs: Date.now() - startedAt, outcome },
    'MCP tool call completed.',
  );
}

function logToolFailure(logger: RedactedLogger, tool: string, startedAt: number): void {
  logger.warn(
    { interface: 'mcp', tool, durationMs: Date.now() - startedAt, outcome: 'error' },
    'MCP tool call failed.',
  );
}
