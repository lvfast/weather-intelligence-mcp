import { Module } from '@nestjs/common';
import { AssessmentModule } from '../../application/assessment/assessment.module.js';
import { LocationModule } from '../../application/location/location.module.js';
import { WeatherModule } from '../../application/weather/weather.module.js';
import { LocationsController, WeatherController } from './rest.controllers.js';

@Module({
  imports: [LocationModule, WeatherModule, AssessmentModule],
  controllers: [LocationsController, WeatherController],
})
export class RestModule {}
