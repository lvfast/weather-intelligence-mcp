import { Module } from '@nestjs/common';
import {
  CACHE_STORE,
  CLOCK,
  CURRENT_WEATHER_BY_REF,
  LOCATION_SERVICE,
  RESOLVED_LOCATION_LOOKUP,
  WEATHER_PROVIDER,
  type CacheStore,
  type Clock,
  type WeatherProvider,
} from '../../domain/ports.js';
import { CacheModule } from '../../infrastructure/cache/cache.module.js';
import { WeatherApiModule } from '../../infrastructure/weatherapi/weatherapi.module.js';
import { CachedLocationLookup } from './location-lookup.js';
import { LocationService } from './location.service.js';

@Module({
  imports: [CacheModule, WeatherApiModule],
  providers: [
    {
      provide: RESOLVED_LOCATION_LOOKUP,
      useFactory: (provider: WeatherProvider, cache: CacheStore, clock: Clock) =>
        new CachedLocationLookup(provider, cache, clock),
      inject: [WEATHER_PROVIDER, CACHE_STORE, CLOCK],
    },
    { provide: CURRENT_WEATHER_BY_REF, useExisting: RESOLVED_LOCATION_LOOKUP },
    {
      provide: LOCATION_SERVICE,
      useFactory: (
        provider: WeatherProvider,
        cache: CacheStore,
        clock: Clock,
        lookup: CachedLocationLookup,
      ) => new LocationService(provider, cache, clock, lookup),
      inject: [WEATHER_PROVIDER, CACHE_STORE, CLOCK, RESOLVED_LOCATION_LOOKUP],
    },
  ],
  exports: [LOCATION_SERVICE, RESOLVED_LOCATION_LOOKUP, CURRENT_WEATHER_BY_REF],
})
export class LocationModule {}
