import { z } from 'zod';

export const conditionDtoSchema = z.object({
  text: z.string(),
  code: z.number().int().min(0),
});

export const locationDtoSchema = z.object({
  name: z.string(),
  region: z.string(),
  country: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  tz_id: z.string(),
  localtime_epoch: z.number().int().nonnegative(),
  localtime: z.string(),
});

export const searchResultSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  region: z.string(),
  country: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  url: z.string(),
});

export const searchResponseSchema = z.array(searchResultSchema);

export const currentDtoSchema = z.object({
  last_updated_epoch: z.number().int().nonnegative(),
  last_updated: z.string(),
  temp_c: z.number(),
  is_day: z.number().int().min(0).max(1),
  condition: conditionDtoSchema,
  wind_kph: z.number().min(0),
  pressure_mb: z.number().min(0),
  precip_mm: z.number().min(0),
  humidity: z.number().min(0).max(100),
  cloud: z.number().min(0).max(100),
  feelslike_c: z.number(),
  vis_km: z.number().min(0),
  uv: z.number().min(0).max(15),
  gust_kph: z.number().min(0),
});

export const currentResponseSchema = z.object({
  location: locationDtoSchema,
  current: currentDtoSchema,
});

export const hourDtoSchema = z.object({
  time_epoch: z.number().int().nonnegative(),
  time: z.string(),
  temp_c: z.number(),
  is_day: z.number().int().min(0).max(1),
  condition: conditionDtoSchema,
  wind_kph: z.number().min(0),
  pressure_mb: z.number().min(0),
  precip_mm: z.number().min(0),
  humidity: z.number().min(0).max(100),
  cloud: z.number().min(0).max(100),
  feelslike_c: z.number(),
  chance_of_rain: z.number().min(0).max(100),
  vis_km: z.number().min(0),
  gust_kph: z.number().min(0),
  uv: z.number().min(0).max(15),
});

export const dayDtoSchema = z.object({
  maxtemp_c: z.number(),
  mintemp_c: z.number(),
  avgtemp_c: z.number(),
  maxwind_kph: z.number().min(0),
  totalprecip_mm: z.number().min(0),
  avghumidity: z.number().min(0).max(100),
  daily_chance_of_rain: z.number().min(0).max(100),
  condition: conditionDtoSchema,
  uv: z.number().min(0).max(15),
});

export const forecastDaySchema = z.object({
  date: z.string(),
  date_epoch: z.number().int().nonnegative(),
  day: dayDtoSchema,
  hour: z.array(hourDtoSchema).min(1).max(48),
});

export const forecastResponseSchema = z.object({
  location: locationDtoSchema,
  current: z.object({
    last_updated_epoch: z.number().int().nonnegative(),
  }),
  forecast: z.object({
    forecastday: z.array(forecastDaySchema).min(1).max(3),
  }),
});

export const alertDtoSchema = z.object({
  headline: z.string(),
  severity: z.string(),
  event: z.string(),
  effective: z.string(),
  expires: z.string(),
  desc: z.string().optional(),
  instruction: z.string().optional(),
  areas: z.string(),
});

export const alertsResponseSchema = z.object({
  location: locationDtoSchema,
  alerts: z.object({
    alert: z.array(alertDtoSchema),
  }),
});

export const weatherApiErrorSchema = z.object({
  error: z.object({
    code: z.number().int(),
    message: z.string(),
  }),
});
