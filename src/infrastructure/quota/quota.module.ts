import { Module } from '@nestjs/common';
import type { AppConfig } from '../../config/config.schema.js';
import { APP_CONFIG } from '../../config/config.module.js';
import { CLOCK, EMERGENCY_LIMITER, PROVIDER_QUOTA, type Clock } from '../../domain/ports.js';
import { CacheModule } from '../cache/cache.module.js';
import { EmergencyLimiter } from './emergency-limiter.js';
import { MemoryProviderQuota } from './memory-provider-quota.js';
import { RedisProviderQuota } from './redis-provider-quota.js';

@Module({
  imports: [CacheModule],
  providers: [
    {
      provide: PROVIDER_QUOTA,
      useFactory: (config: AppConfig, clock: Clock): MemoryProviderQuota | RedisProviderQuota => {
        if (config.cacheBackend === 'redis') {
          return new RedisProviderQuota(
            config.redisUrl ?? 'redis://127.0.0.1:6379',
            config.providerMonthlyBudget,
            clock,
          );
        }
        return new MemoryProviderQuota(config.providerMonthlyBudget, clock);
      },
      inject: [APP_CONFIG, CLOCK],
    },
    {
      provide: EMERGENCY_LIMITER,
      useFactory: (config: AppConfig) => new EmergencyLimiter(config.emergencyLimitPerMinute),
      inject: [APP_CONFIG],
    },
  ],
  exports: [PROVIDER_QUOTA, EMERGENCY_LIMITER],
})
export class QuotaModule {}
