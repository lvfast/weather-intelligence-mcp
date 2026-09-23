import { randomUUID } from 'node:crypto';
import type { CacheEntry, CacheStore, Clock, ServiceResult } from '../domain/ports.js';
import { isAppError } from '../domain/errors.js';
import type { SingleFlight } from '../infrastructure/cache/single-flight.js';

export interface EntryTtls {
  freshTtlSeconds: number;
  staleMaxAgeSeconds: number | null;
}

export interface LoadCachedOptions<T> {
  key: string;
  freshTtlSeconds: number;
  staleMaxAgeSeconds: number | null;
  allowStale: boolean;
  loader: (signal?: AbortSignal) => Promise<T>;
  cache: CacheStore;
  clock: Clock;
  flight: SingleFlight;
  signal?: AbortSignal;
  ttlFor?: (data: T) => EntryTtls;
}

export function buildCacheEntry<T>(
  value: T,
  clock: Clock,
  freshTtlSeconds: number,
  staleMaxAgeSeconds: number | null,
): CacheEntry<T> {
  const now = clock.now();
  return {
    value,
    fetchedAt: now.toISOString(),
    freshUntil: new Date(now.getTime() + freshTtlSeconds * 1000).toISOString(),
    staleUntil:
      staleMaxAgeSeconds === null
        ? null
        : new Date(now.getTime() + staleMaxAgeSeconds * 1000).toISOString(),
  };
}

function resultFromEntry<T>(
  entry: CacheEntry<T>,
  flags: { cached: boolean; stale: boolean; warnings: string[] },
): ServiceResult<T> {
  return {
    data: entry.value,
    meta: {
      requestId: randomUUID(),
      provider: 'weatherapi',
      fetchedAt: entry.fetchedAt,
      cached: flags.cached,
      stale: flags.stale,
      warnings: flags.warnings,
    },
  };
}

export async function loadCached<T>(options: LoadCachedOptions<T>): Promise<ServiceResult<T>> {
  let physical: CacheEntry<CacheEntry<T>> | null = null;
  try {
    physical = await options.cache.get<CacheEntry<T>>(options.key);
  } catch (error) {
    if (!(isAppError(error) && error.code === 'CACHE_UNAVAILABLE')) {
      throw error;
    }
  }
  const entry = physical?.value ?? null;
  const now = options.clock.now().getTime();

  if (entry !== null && now < Date.parse(entry.freshUntil)) {
    return resultFromEntry(entry, { cached: true, stale: false, warnings: [] });
  }

  const staleCandidate =
    entry !== null && entry.staleUntil !== null && now < Date.parse(entry.staleUntil)
      ? entry
      : null;

  try {
    const data = await options.flight.run(options.key, () => options.loader(options.signal));
    const ttls = options.ttlFor?.(data) ?? {
      freshTtlSeconds: options.freshTtlSeconds,
      staleMaxAgeSeconds: options.staleMaxAgeSeconds,
    };
    const newEntry = buildCacheEntry(
      data,
      options.clock,
      ttls.freshTtlSeconds,
      ttls.staleMaxAgeSeconds,
    );
    const retentionSeconds = ttls.staleMaxAgeSeconds ?? ttls.freshTtlSeconds;
    await options.cache.set(options.key, newEntry, retentionSeconds).catch(() => undefined);
    return resultFromEntry(newEntry, { cached: false, stale: false, warnings: [] });
  } catch (error) {
    if (options.allowStale && staleCandidate !== null && isAppError(error) && error.retryable) {
      return resultFromEntry(staleCandidate, {
        cached: true,
        stale: true,
        warnings: ['STALE_DATA'],
      });
    }
    throw error;
  }
}
