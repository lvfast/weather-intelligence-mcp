import { Module } from '@nestjs/common';
import {
  CACHE_STORE,
  CLOCK,
  CURRENT_WEATHER_BY_REF,
  LOCATION_SERVICE,
  WEATHER_PROVIDER,
  WEATHER_SERVICE,
  type CacheStore,
  type Clock,
  type CurrentWeatherByRef,
  type WeatherProvider,
} from '../../domain/ports.js';
import { CacheModule } from '../../infrastructure/cache/cache.module.js';
import { WeatherApiModule } from '../../infrastructure/weatherapi/weatherapi.module.js';
import { LocationModule } from '../location/location.module.js';
import type { LocationResolver } from './weather.service.js';
import { WeatherService } from './weather.service.js';

@Module({
  imports: [CacheModule, WeatherApiModule, LocationModule],
  providers: [
    {
      provide: WEATHER_SERVICE,
      useFactory: (
        locations: LocationResolver,
        currentByRef: CurrentWeatherByRef,
        provider: WeatherProvider,
        cache: CacheStore,
        clock: Clock,
      ) => new WeatherService(locations, currentByRef, provider, cache, clock),
      inject: [LOCATION_SERVICE, CURRENT_WEATHER_BY_REF, WEATHER_PROVIDER, CACHE_STORE, CLOCK],
    },
  ],
  exports: [WEATHER_SERVICE],
})
export class WeatherModule {}
