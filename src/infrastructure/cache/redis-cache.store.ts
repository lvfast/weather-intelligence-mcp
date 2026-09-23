import { createClient } from 'redis';
import type { CacheEntry, CacheStore, Clock } from '../../domain/ports.js';
import { AppError } from '../../domain/errors.js';

const SCHEMA_VERSION = 1;

interface SerializedEnvelope {
  version: number;
  entry: CacheEntry<unknown>;
}

type RedisClient = ReturnType<typeof createClient>;

export class RedisCacheStore implements CacheStore {
  readonly client: RedisClient;
  private connected = false;

  constructor(
    redisUrl: string,
    private readonly clock: Clock,
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

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const raw = await this.runOrThrow((client) => client.get(key));
    if (raw === null) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isValidEnvelope(parsed)) {
        return null;
      }
      return parsed.entry as CacheEntry<T>;
    } catch {
      return null;
    }
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number,
    staleMaxAgeSeconds?: number,
  ): Promise<void> {
    const now = this.clock.now().getTime();
    const fetchedAt = new Date(now).toISOString();
    const freshUntil = new Date(now + ttlSeconds * 1000).toISOString();
    const staleUntil =
      staleMaxAgeSeconds === undefined
        ? null
        : new Date(now + staleMaxAgeSeconds * 1000).toISOString();
    const entry: CacheEntry<unknown> = { value, fetchedAt, freshUntil, staleUntil };
    const retentionUntil = staleUntil ?? freshUntil;
    const retentionSeconds = Math.max(1, Math.ceil((Date.parse(retentionUntil) - now) / 1000));
    const envelope: SerializedEnvelope = { version: SCHEMA_VERSION, entry };
    await this.runOrThrow((client) =>
      client.set(key, JSON.stringify(envelope), { EX: retentionSeconds }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.runOrThrow((client) => client.del(key));
  }

  async health(): Promise<'up' | 'down'> {
    try {
      if (!this.connected) {
        return 'down';
      }
      await this.client.ping();
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async runOrThrow<T>(operation: (client: RedisClient) => Promise<T>): Promise<T> {
    if (!this.connected) {
      throw new AppError('CACHE_UNAVAILABLE', 'Redis cache backend is unavailable');
    }
    try {
      return await operation(this.client);
    } catch (error) {
      throw new AppError('CACHE_UNAVAILABLE', 'Redis cache backend is unavailable', {
        cause: error,
      });
    }
  }
}

function isValidEnvelope(value: unknown): value is SerializedEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.version !== SCHEMA_VERSION) {
    return false;
  }
  const entry = envelope.entry;
  if (typeof entry !== 'object' || entry === null) {
    return false;
  }
  const record = entry as Record<string, unknown>;
  return (
    typeof record.fetchedAt === 'string' &&
    typeof record.freshUntil === 'string' &&
    (typeof record.staleUntil === 'string' || record.staleUntil === null) &&
    'value' in record
  );
}
