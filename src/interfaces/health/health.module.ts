import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { CacheModule } from '../../infrastructure/cache/cache.module.js';
import { CacheHealthIndicator, HealthController } from './health.controller.js';

@Module({
  imports: [TerminusModule, CacheModule],
  controllers: [HealthController],
  providers: [CacheHealthIndicator],
})
export class HealthModule {}
