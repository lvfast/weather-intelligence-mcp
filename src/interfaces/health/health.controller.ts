import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  type HealthCheckResult,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { CACHE_STORE, type CacheStore } from '../../domain/ports.js';

export class CacheHealthIndicator {
  constructor(
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
    @Inject(HealthIndicatorService) private readonly indicator: HealthIndicatorService,
  ) {}

  async checkCache(key: string): Promise<HealthIndicatorResult> {
    const status = await this.cache.health();
    return status === 'up' ? this.indicator.check(key).up() : this.indicator.check(key).down();
  }
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(CacheHealthIndicator) private readonly cacheHealth: CacheHealthIndicator,
  ) {}

  @Get('live')
  @ApiOperation({ operationId: 'liveness' })
  live(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ operationId: 'readiness' })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([() => this.cacheHealth.checkCache('cache')]);
  }
}
