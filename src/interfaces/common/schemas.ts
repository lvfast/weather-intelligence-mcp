import { z } from 'zod';
import { locationInputSchema, type LocationInput } from '../../domain/location.js';
import { ACTIVITIES } from '../../domain/assessment.js';

export const enumSchema = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values);

export const numericQueryParam = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : Number(value)),
  z.number(),
);

export const resolveLocationQuerySchema = z
  .strictObject({
    q: z.string().trim().min(1).max(200),
    limit: numericQueryParam.pipe(z.number().int().min(1).max(10)).default(5),
  })
  .strict();

export const weatherLocationQuerySchema = z
  .strictObject({})
  .extend({
    q: z.string().trim().min(1).max(200).optional(),
    locationId: z.string().min(1).max(200).optional(),
    lat: numericQueryParam.pipe(z.number().min(-90).max(90)).optional(),
    lon: numericQueryParam.pipe(z.number().min(-180).max(180)).optional(),
  })
  .superRefine((value, context) => {
    const forms = [
      value.q !== undefined,
      value.locationId !== undefined,
      value.lat !== undefined || value.lon !== undefined,
    ].filter(Boolean).length;
    if (forms !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'supply exactly one of q, locationId, or the lat/lon pair',
      });
    }
    if (
      (value.lat === undefined && value.lon !== undefined) ||
      (value.lat !== undefined && value.lon === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'lat and lon must be supplied together',
      });
    }
  });

export const forecastQuerySchema = weatherLocationQuerySchema
  .extend({
    days: numericQueryParam.pipe(z.number().int().min(1).max(3)).default(3),
    includeHourly: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .strict();

export const alertsQuerySchema = weatherLocationQuerySchema.strict();

export const assessmentBodySchema = z
  .strictObject({
    location: locationInputSchema,
    activity: z.enum(ACTIVITIES),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
  })
  .strict();

const mcpLocationInputBase = z.strictObject({
  query: z.string().trim().min(1).max(200).optional(),
  locationId: z.string().min(1).max(200).optional(),
  coordinates: z
    .strictObject({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    })
    .optional(),
});

function exactlyOneMcpLocationForm(
  value: { query?: string; locationId?: string; coordinates?: unknown },
  context: z.RefinementCtx,
): void {
  const forms = [value.query, value.locationId, value.coordinates].filter(
    (form) => form !== undefined,
  ).length;
  if (forms !== 1) {
    context.addIssue({
      code: 'custom',
      message: 'supply exactly one of query, locationId, or coordinates',
    });
  }
}

export const mcpLocationInputSchema = mcpLocationInputBase.superRefine(exactlyOneMcpLocationForm);

export type McpLocationInput = z.infer<typeof mcpLocationInputSchema>;

export function mcpLocationToLocationInput(input: McpLocationInput): LocationInput {
  if (input.query !== undefined) {
    return { query: input.query };
  }
  if (input.locationId !== undefined) {
    return { locationId: input.locationId };
  }
  if (input.coordinates !== undefined) {
    return { coordinates: input.coordinates };
  }
  throw new Error('mcpLocationToLocationInput requires a validated location form');
}

export const resolveLocationToolInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(10).optional(),
});

export const forecastToolInputSchema = mcpLocationInputBase
  .extend({
    days: z.number().int().min(1).max(3).optional(),
    includeHourly: z.boolean().optional(),
  })
  .superRefine(exactlyOneMcpLocationForm);

export const assessToolInputSchema = z.strictObject({
  location: mcpLocationInputSchema,
  activity: z.enum(ACTIVITIES),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

export const conditionSchema = z.object({
  category: z.enum(['clear', 'cloudy', 'fog', 'rain', 'snow', 'sleet', 'thunderstorm', 'other']),
  intensity: z.enum(['light', 'moderate', 'heavy', 'unknown']),
  text: z.string().nullable(),
});

export const locationSchema = z.object({
  locationId: z.string(),
  name: z.string(),
  region: z.string().nullable(),
  country: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  timeZone: z.string(),
});

export const locationCandidateSchema = z.object({
  locationId: z.string(),
  name: z.string(),
  region: z.string().nullable(),
  country: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  timeZone: z.string().nullable(),
});

export const locationResolutionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('resolved'), location: locationSchema }),
  z.object({ status: z.literal('ambiguous'), candidates: z.array(locationCandidateSchema) }),
  z.object({ status: z.literal('not_found'), candidates: z.array(locationCandidateSchema).max(0) }),
]);

export const locationResolutionRequiredSchema = z.object({
  status: z.literal('location_resolution_required'),
  candidates: z.array(locationCandidateSchema),
});

export const weatherIntervalSchema = z.object({
  time: z.string(),
  condition: conditionSchema,
  temperatureC: z.number(),
  feelsLikeC: z.number(),
  precipitationMm: z.number(),
  humidityPercent: z.number(),
  cloudCoverPercent: z.number(),
  precipitationChancePercent: z.number().nullable(),
  windKph: z.number(),
  gustKph: z.number(),
  visibilityKm: z.number(),
  uvIndex: z.number().nullable(),
});

export const currentWeatherSchema = z.object({
  location: locationSchema,
  observedAt: z.string(),
  interval: weatherIntervalSchema,
});

export const dailySummarySchema = z.object({
  condition: conditionSchema,
  maxTempC: z.number(),
  minTempC: z.number(),
  avgTempC: z.number(),
  totalPrecipitationMm: z.number(),
  maxWindKph: z.number(),
  maxGustKph: z.number(),
  precipitationChancePercent: z.number().nullable(),
  uvIndexMax: z.number().nullable(),
});

export const forecastDaySchema = z.object({
  date: z.string(),
  summary: dailySummarySchema,
  hours: z.array(weatherIntervalSchema).optional(),
});

export const forecastSchema = z.object({
  location: locationSchema,
  generatedAt: z.string(),
  days: z.array(forecastDaySchema),
});

export const weatherAlertSchema = z.object({
  headline: z.string(),
  event: z.string(),
  severity: z.enum(['Minor', 'Moderate', 'Severe', 'Extreme', 'Unknown']),
  effectiveAt: z.string(),
  expiresAt: z.string(),
  description: z.string().nullable(),
  instruction: z.string().nullable(),
  areas: z.array(z.string()),
});

export const weatherAlertsResultSchema = z.object({
  location: locationSchema,
  observedAt: z.string(),
  coverage: z.literal('limited'),
  alerts: z.array(weatherAlertSchema),
});

export const ruleFindingSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(['moderate', 'high', 'severe']),
  points: z.union([z.literal(20), z.literal(40), z.literal(70)]),
  message: z.string(),
  evidence: z.object({
    metric: z.string(),
    observed: z.union([z.number(), z.string()]),
    operator: z.string(),
    threshold: z.union([z.number(), z.string()]),
    unit: z.string().optional(),
  }),
  window: z.object({ startTime: z.string(), endTime: z.string() }),
  mitigation: z.string(),
});

export const assessmentEvidenceSchema = z.object({
  window: z.object({ startTime: z.string(), endTime: z.string() }),
  source: z.enum(['current', 'forecast']),
  slot: z.object({
    window: z.object({ startTime: z.string(), endTime: z.string() }),
    source: z.enum(['current', 'forecast']),
    condition: conditionSchema,
    temperatureC: z.number(),
    feelsLikeC: z.number(),
    precipitationMm: z.number(),
    humidityPercent: z.number(),
    cloudCoverPercent: z.number(),
    precipitationChancePercent: z.number().nullable(),
    windKph: z.number(),
    gustKph: z.number(),
    visibilityKm: z.number(),
    uvIndex: z.number().nullable(),
  }),
});

export const weatherAssessmentSchema = z.object({
  activity: z.enum(ACTIVITIES),
  location: locationSchema,
  window: z.object({ startTime: z.string(), endTime: z.string(), timeZone: z.string() }),
  riskScore: z.number().min(0).max(100),
  riskLevel: z.enum(['low', 'moderate', 'high', 'severe']),
  recommendation: z.enum(['go', 'caution', 'avoid']),
  summary: z.string(),
  triggeredRules: z.array(ruleFindingSchema),
  evidence: z.array(assessmentEvidenceSchema),
  mitigations: z.array(z.string()),
  ruleVersion: z.string(),
  source: z.object({
    provider: z.literal('weatherapi'),
    cached: z.boolean(),
    stale: z.boolean(),
    coverage: z.enum(['current', 'forecast', 'forecast-and-limited-alerts']),
  }),
  observedAt: z.string(),
  dataQuality: z.enum(['normal', 'degraded']),
});

export const resultMetaSchema = z.object({
  requestId: z.string(),
  provider: z.literal('weatherapi'),
  fetchedAt: z.string(),
  cached: z.boolean(),
  stale: z.boolean(),
  warnings: z.array(z.string()),
});

export function serviceResultSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    meta: resultMetaSchema,
  });
}

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
