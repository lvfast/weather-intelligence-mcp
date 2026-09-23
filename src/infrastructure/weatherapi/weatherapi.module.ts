import { Module } from '@nestjs/common';
import type { AppConfig } from '../../config/config.schema.js';
import { APP_CONFIG } from '../../config/config.module.js';
import {
  EMERGENCY_LIMITER,
  PROVIDER_QUOTA,
  WEATHER_PROVIDER,
  type EmergencyLimiter,
  type ProviderQuota,
} from '../../domain/ports.js';
import { QuotaModule } from '../quota/quota.module.js';
import { WeatherApiClient } from './weatherapi.client.js';

@Module({
  imports: [QuotaModule],
  providers: [
    {
      provide: WEATHER_PROVIDER,
      useFactory: (config: AppConfig, quota: ProviderQuota, emergencyLimiter: EmergencyLimiter) =>
        new WeatherApiClient(config.weatherApiKey, quota, emergencyLimiter),
      inject: [APP_CONFIG, PROVIDER_QUOTA, EMERGENCY_LIMITER],
    },
  ],
  exports: [WEATHER_PROVIDER],
})
export class WeatherApiModule {}
