import { createClient } from 'redis';
import type { Clock, ProviderQuota, QuotaReservation } from '../../domain/ports.js';
import { AppError, isAppError } from '../../domain/errors.js';
import { nextUtcMonthBoundary, utcMonthKey } from './month-window.js';

const RESERVE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local attempts = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
if current + attempts > limit then
  return { -1, current }
end
local next = redis.call('INCRBY', KEYS[1], attempts)
redis.call('PEXPIRE', KEYS[1], ttl)
return { next, next }
`;

const TTL_MARGIN_MS = 5 * 60 * 1000;

export interface RedisQuotaOptions {
  namespace?: string;
}

type RedisClient = ReturnType<typeof createClient>;

export class RedisProviderQuota implements ProviderQuota {
  private readonly client: RedisClient;
  private connected = false;

  constructor(
    redisUrl: string,
    private readonly limit: number,
    private readonly clock: Clock,
    private readonly options: RedisQuotaOptions = {},
  ) {
    this.client = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) =>
          retries < 2 ? Math.min(retries * 200, 1000) : new Error('Redis unavailable'),
      },
    });
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.client.connect();
    this.connected = true;
  }

  async close(): Promise<void> {
    this.connected = false;
    try {
      if (this.client.isReady) {
        await this.client.quit();
      } else {
        await this.client.destroy();
      }
    } catch {
      // already closed
    }
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.connect();
    } catch {
      this.connected = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async reserve(attempts: number): Promise<QuotaReservation> {
    const now = this.clock.now();
    const month = utcMonthKey(now);
    const boundary = nextUtcMonthBoundary(now);
    const ttlMs = boundary.getTime() - now.getTime() + TTL_MARGIN_MS;
    if (!this.connected) {
      throw new AppError(
        'PROVIDER_BUDGET_UNAVAILABLE',
        'Shared provider quota backend is unavailable',
      );
    }
    try {
      const result = (await this.client.eval(RESERVE_SCRIPT, {
        keys: [this.keyFor(month)],
        arguments: [String(attempts), String(this.limit), String(ttlMs)],
      })) as [number, number];
      const status = result[0];
      const used = result[1];
      if (status === -1) {
        throw new AppError(
          'PROVIDER_BUDGET_EXHAUSTED',
          `Monthly provider budget of ${this.limit} calls is exhausted; ` +
            `the shared counter resets at the next UTC month boundary.`,
          { details: { used, limit: this.limit, resetsAt: boundary.toISOString() } },
        );
      }
      return {
        granted: true,
        used,
        limit: this.limit,
        resetsAt: boundary.toISOString(),
        mode: 'shared',
      };
    } catch (error) {
      if (isAppError(error)) {
        throw error;
      }
      throw new AppError(
        'PROVIDER_BUDGET_UNAVAILABLE',
        'Shared provider quota backend is unavailable',
        {
          cause: error,
        },
      );
    }
  }

  async readUsed(month?: string): Promise<number> {
    const raw = await this.client.get(this.keyFor(month ?? utcMonthKey(this.clock.now())));
    return raw === null ? 0 : Number(raw);
  }

  async readTtl(): Promise<number> {
    return this.client.ttl(this.keyFor(utcMonthKey(this.clock.now())));
  }

  async deleteNamespace(): Promise<void> {
    if (this.options.namespace === undefined) {
      return;
    }
    const keys = await this.client.keys(`wis:test:${this.options.namespace}:*`);
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }

  private keyFor(month: string): string {
    return this.options.namespace === undefined
      ? `wis:quota:weatherapi:${month}`
      : `wis:test:${this.options.namespace}:quota:${month}`;
  }
}
