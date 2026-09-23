import { Module } from '@nestjs/common';
import {
  ASSESSMENT_SERVICE,
  CLOCK,
  LOCATION_SERVICE,
  WEATHER_SERVICE,
  type Clock,
} from '../../domain/ports.js';
import { CacheModule } from '../../infrastructure/cache/cache.module.js';
import { LocationModule } from '../location/location.module.js';
import { WeatherModule } from '../weather/weather.module.js';
import type { LocationResolver, WeatherPort } from './assessment.service.js';
import { AssessmentService } from './assessment.service.js';

@Module({
  imports: [CacheModule, LocationModule, WeatherModule],
  providers: [
    {
      provide: ASSESSMENT_SERVICE,
      useFactory: (locations: LocationResolver, weather: WeatherPort, clock: Clock) =>
        new AssessmentService(locations, weather, clock),
      inject: [LOCATION_SERVICE, WEATHER_SERVICE, CLOCK],
    },
  ],
  exports: [ASSESSMENT_SERVICE],
})
export class AssessmentModule {}
