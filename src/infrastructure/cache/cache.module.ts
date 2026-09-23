import { Module } from '@nestjs/common';
import type { AppConfig } from '../../config/config.schema.js';
import { APP_CONFIG } from '../../config/config.module.js';
import { CACHE_STORE, CLOCK, type Clock } from '../../domain/ports.js';
import { SystemClock } from '../clock/system-clock.js';
import { MemoryCacheStore } from './memory-cache.store.js';
import { RedisCacheStore } from './redis-cache.store.js';

@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: CACHE_STORE,
      useFactory: (config: AppConfig, clock: Clock): MemoryCacheStore | RedisCacheStore => {
        if (config.cacheBackend === 'redis') {
          return new RedisCacheStore(config.redisUrl ?? 'redis://127.0.0.1:6379', clock);
        }
        return new MemoryCacheStore(config.cacheMaxEntries, clock);
      },
      inject: [APP_CONFIG, CLOCK],
    },
  ],
  exports: [CACHE_STORE, CLOCK],
})
export class CacheModule {}
