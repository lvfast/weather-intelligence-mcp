import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { CacheModule } from './infrastructure/cache/cache.module.js';
import { QuotaModule } from './infrastructure/quota/quota.module.js';
import { WeatherApiModule } from './infrastructure/weatherapi/weatherapi.module.js';
import { LocationModule } from './application/location/location.module.js';
import { WeatherModule } from './application/weather/weather.module.js';
import { AssessmentModule } from './application/assessment/assessment.module.js';

@Module({
  imports: [
    ConfigModule,
    CacheModule,
    QuotaModule,
    WeatherApiModule,
    LocationModule,
    WeatherModule,
    AssessmentModule,
  ],
})
export class AppModule {}
