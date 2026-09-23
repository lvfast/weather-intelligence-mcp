import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AppError } from '../../domain/errors.js';
import type { LocationInput, LocationResolution } from '../../domain/location.js';
import type { AssessWeatherInput } from '../../domain/assessment.js';
import {
  ASSESSMENT_SERVICE,
  LOCATION_SERVICE,
  WEATHER_SERVICE,
  type ServiceResult,
} from '../../domain/ports.js';
import type { CurrentWeather, WeatherAlertsResult, WeatherForecast } from '../../domain/weather.js';
import type { WeatherAssessment } from '../../domain/assessment.js';
import { requestIdOf, type RequestWithContext } from './request-context.js';
import {
  alertsQuerySchema,
  assessmentBodySchema,
  forecastQuerySchema,
  resolveLocationQuerySchema,
  weatherLocationQuerySchema,
} from '../common/schemas.js';
import type { z } from 'zod';

interface LocationResolverPort {
  resolve(
    input: LocationInput,
    options?: { limit?: number },
    signal?: AbortSignal,
  ): Promise<LocationResolution>;
}

interface WeatherPort {
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
}

interface AssessmentPort {
  assess(
    input: AssessWeatherInput,
    signal?: AbortSignal,
  ): Promise<ServiceResult<WeatherAssessment>>;
}

export function toLocationInput(parsed: {
  q?: string;
  locationId?: string;
  lat?: number;
  lon?: number;
}): LocationInput {
  if (parsed.q !== undefined) {
    return { query: parsed.q };
  }
  if (parsed.locationId !== undefined) {
    return { locationId: parsed.locationId };
  }
  if (parsed.lat !== undefined && parsed.lon !== undefined) {
    return { coordinates: { lat: parsed.lat, lon: parsed.lon } };
  }
  throw new AppError('VALIDATION_ERROR', 'A valid location form is required.');
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid request parameters.', {
      details: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }
  return parsed.data;
}

function emptyMeta(request: RequestWithContext) {
  return {
    requestId: requestIdOf(request),
    provider: 'weatherapi' as const,
    fetchedAt: new Date().toISOString(),
    cached: false,
    stale: false,
    warnings: [] as string[],
  };
}

function envelope<T>(result: ServiceResult<T>, request: RequestWithContext) {
  return {
    data: result.data,
    meta: { ...result.meta, requestId: requestIdOf(request) },
  };
}

@ApiTags('locations')
@Controller('api/v1/locations')
export class LocationsController {
  constructor(@Inject(LOCATION_SERVICE) private readonly locations: LocationResolverPort) {}

  @Get('resolve')
  @ApiOperation({ operationId: 'resolveLocation' })
  @ApiOkResponse({ description: 'Location resolution result' })
  async resolve(@Query() query: Record<string, unknown>, @Req() request: RequestWithContext) {
    const parsed = parseOrThrow(resolveLocationQuerySchema, query);
    const result = await this.locations.resolve(
      { query: parsed.q },
      { limit: parsed.limit },
      request.deadlineSignal,
    );
    return { data: result, meta: emptyMeta(request) };
  }
}

@ApiTags('weather')
@Controller('api/v1/weather')
export class WeatherController {
  constructor(
    @Inject(WEATHER_SERVICE) private readonly weather: WeatherPort,
    @Inject(ASSESSMENT_SERVICE) private readonly assessments: AssessmentPort,
  ) {}

  @Get('current')
  @ApiOperation({ operationId: 'getCurrentWeather' })
  @ApiOkResponse({ description: 'Normalized current weather' })
  async current(@Query() query: Record<string, unknown>, @Req() request: RequestWithContext) {
    const parsed = parseOrThrow(weatherLocationQuerySchema, query);
    return envelope(
      await this.weather.getCurrent(toLocationInput(parsed), request.deadlineSignal),
      request,
    );
  }

  @Get('forecast')
  @ApiOperation({ operationId: 'getWeatherForecast' })
  @ApiOkResponse({ description: 'Normalized weather forecast' })
  async forecast(@Query() query: Record<string, unknown>, @Req() request: RequestWithContext) {
    const parsed = parseOrThrow(forecastQuerySchema, query);
    return envelope(
      await this.weather.getForecast(
        toLocationInput(parsed),
        { days: parsed.days as 1 | 2 | 3, includeHourly: parsed.includeHourly },
        request.deadlineSignal,
      ),
      request,
    );
  }

  @Get('alerts')
  @ApiOperation({ operationId: 'getWeatherAlerts' })
  @ApiOkResponse({ description: 'Normalized weather alerts' })
  async alerts(@Query() query: Record<string, unknown>, @Req() request: RequestWithContext) {
    const parsed = parseOrThrow(alertsQuerySchema, query);
    return envelope(
      await this.weather.getAlerts(toLocationInput(parsed), request.deadlineSignal),
      request,
    );
  }

  @Post('assessments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'assessWeatherConditions' })
  async assess(@Body() body: unknown, @Req() request: RequestWithContext) {
    const parsed = parseOrThrow(assessmentBodySchema, body);
    return envelope(await this.assessments.assess(parsed, request.deadlineSignal), request);
  }
}
