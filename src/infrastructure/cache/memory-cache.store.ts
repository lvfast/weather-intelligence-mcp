import type { CacheEntry, CacheStore, Clock } from '../../domain/ports.js';

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  constructor(
    private readonly maxEntries: number,
    private readonly clock: Clock,
  ) {}

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return null;
    }
    const now = this.clock.now().getTime();
    const retentionUntil = entry.staleUntil ?? entry.freshUntil;
    if (now >= Date.parse(retentionUntil)) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry as CacheEntry<T>;
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

    this.evictExpired(now);
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(key, { value, fetchedAt, freshUntil, staleUntil });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async health(): Promise<'up' | 'down'> {
    return 'up';
  }

  private evictExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      const retentionUntil = entry.staleUntil ?? entry.freshUntil;
      if (now >= Date.parse(retentionUntil)) {
        this.entries.delete(key);
      }
    }
  }
}
