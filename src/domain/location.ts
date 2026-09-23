import { z } from 'zod';

export const locationQueryInputSchema = z.strictObject({
  query: z
    .string()
    .trim()
    .min(1, 'query must not be blank')
    .max(200, 'query must be at most 200 characters'),
});

export const locationIdInputSchema = z.strictObject({
  locationId: z.string().min(1).max(200),
});

export const locationCoordinateInputSchema = z.strictObject({
  coordinates: z.strictObject({
    lat: z.number().min(-90, 'latitude must be between -90 and 90').max(90),
    lon: z.number().min(-180, 'longitude must be between -180 and 180').max(180),
  }),
});

export const locationInputSchema = z.union([
  locationQueryInputSchema,
  locationIdInputSchema,
  locationCoordinateInputSchema,
]);

export type LocationInput = z.infer<typeof locationInputSchema>;

export interface Location {
  locationId: string;
  name: string;
  region: string | null;
  country: string;
  latitude: number;
  longitude: number;
  timeZone: string;
}

export interface LocationCandidate {
  locationId: string;
  name: string;
  region: string | null;
  country: string;
  latitude: number;
  longitude: number;
  timeZone: string | null;
}

export type ResolvedLocationRef =
  { locationId: string } | { coordinates: { lat: number; lon: number } };

export type LocationResolution =
  | { status: 'resolved'; location: Location }
  | { status: 'ambiguous'; candidates: LocationCandidate[] }
  | { status: 'not_found'; candidates: [] };
