import { describe, expect, it } from 'vitest';
import type { Clock } from '../../src/domain/ports.js';
import { AppError } from '../../src/domain/errors.js';
import { RedisCacheStore } from '../../src/infrastructure/cache/redis-cache.store.js';

class FakeClock implements Clock {
  now(): Date {
    return new Date('2026-09-23T00:00:00.000Z');
  }
}

const REDIS_URL = process.env.TEST_REDIS_URL;

describe.skipIf(REDIS_URL === undefined)('RedisCacheStore', () => {
  it('round-trips serialized records with schema versioning', async () => {
    const store = new RedisCacheStore(REDIS_URL as string, new FakeClock());
    await store.connect();
    try {
      await store.set('key:roundtrip', { greeting: 'hello' }, 60);
      const entry = await store.get<{ greeting: string }>('key:roundtrip');
      expect(entry).toMatchObject({
        value: { greeting: 'hello' },
        fetchedAt: '2026-09-23T00:00:00.000Z',
        freshUntil: '2026-09-23T00:01:00.000Z',
      });
      expect(entry?.staleUntil).toBeNull();
    } finally {
      await store.close();
    }
  });

  it('honors expiry', async () => {
    const store = new RedisCacheStore(REDIS_URL as string, new FakeClock());
    await store.connect();
    try {
      await store.set('key:expiry', 'data', 1);
      expect(await store.get('key:expiry')).not.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(await store.get('key:expiry')).toBeNull();
    } finally {
      await store.close();
    }
  });

  it('treats version mismatch as a cache miss', async () => {
    const store = new RedisCacheStore(REDIS_URL as string, new FakeClock());
    await store.connect();
    try {
      await store.set('key:version', 'data', 60);
      await store.client.set(
        'key:version',
        JSON.stringify({
          version: 99,
          entry: { value: 'old', fetchedAt: 'x', freshUntil: 'y', staleUntil: null },
        }),
        { EX: 60 },
      );
      expect(await store.get('key:version')).toBeNull();
    } finally {
      await store.close();
    }
  });

  it('treats an invalid envelope as a cache miss', async () => {
    const store = new RedisCacheStore(REDIS_URL as string, new FakeClock());
    await store.connect();
    try {
      await store.client.set('key:corrupt', '{not json', { EX: 60 });
      expect(await store.get('key:corrupt')).toBeNull();
    } finally {
      await store.close();
    }
  });

  it('deletes keys', async () => {
    const store = new RedisCacheStore(REDIS_URL as string, new FakeClock());
    await store.connect();
    try {
      await store.set('key:delete', 'data', 60);
      await store.delete('key:delete');
      expect(await store.get('key:delete')).toBeNull();
    } finally {
      await store.close();
    }
  });

  it('reports health transitions', async () => {
    const store = new RedisCacheStore(REDIS_URL as string, new FakeClock());
    await expect(store.health()).resolves.toBe('down');
    await store.connect();
    await expect(store.health()).resolves.toBe('up');
    await store.close();
    await expect(store.health()).resolves.toBe('down');
  });

  it('fails reads with CACHE_UNAVAILABLE while disconnected', async () => {
    const store = new RedisCacheStore(REDIS_URL as string, new FakeClock());
    await expect(store.get('key:x')).rejects.toBeInstanceOf(AppError);
    await expect(store.get('key:x')).rejects.toMatchObject({ code: 'CACHE_UNAVAILABLE' });
    await expect(store.set('key:x', 'v', 60)).rejects.toMatchObject({ code: 'CACHE_UNAVAILABLE' });
  });
});
