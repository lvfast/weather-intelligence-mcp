import { describe, expect, it } from 'vitest';
import type { Clock } from '../../src/domain/ports.js';
import { isAppError } from '../../src/domain/errors.js';
import { RedisProviderQuota } from '../../src/infrastructure/quota/redis-provider-quota.js';

const REDIS_URL = process.env.TEST_REDIS_URL;

class FakeClock implements Clock {
  current: Date;

  constructor(iso: string) {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current);
  }
}

describe.skipIf(REDIS_URL === undefined)('RedisProviderQuota', () => {
  it('grants exactly the budget under 100 concurrent reservations', async () => {
    const clock = new FakeClock('2026-09-15T10:00:00Z');
    const quota = new RedisProviderQuota(REDIS_URL as string, 50, clock, {
      namespace: 'test-concurrent',
    });
    await quota.connect();
    try {
      const results = await Promise.allSettled(Array.from({ length: 100 }, () => quota.reserve(1)));
      const granted = results.filter((result) => result.status === 'fulfilled');
      const denied = results.filter((result) => result.status === 'rejected');
      expect(granted).toHaveLength(50);
      expect(denied).toHaveLength(50);
      for (const result of denied) {
        if (result.status === 'rejected') {
          expect(isAppError(result.reason)).toBe(true);
          expect(result.reason).toMatchObject({ code: 'PROVIDER_BUDGET_EXHAUSTED' });
        }
      }
      const used = await quota.readUsed();
      expect(used).toBe(50);
    } finally {
      await quota.deleteNamespace();
      await quota.close();
    }
  });

  it('uses the UTC month key and rolls over with the clock', async () => {
    const clock = new FakeClock('2026-09-30T23:59:59Z');
    const quota = new RedisProviderQuota(REDIS_URL as string, 10, clock, {
      namespace: 'test-rollover',
    });
    await quota.connect();
    try {
      await expect(quota.reserve(1)).resolves.toMatchObject({ used: 1, mode: 'shared' });
      expect(await quota.readUsed('2026-09')).toBe(1);
      clock.current = new Date('2026-10-01T00:00:00Z');
      await expect(quota.reserve(1)).resolves.toMatchObject({ used: 1 });
      expect(await quota.readUsed('2026-10')).toBe(1);
      expect(await quota.readUsed('2026-09')).toBe(1);
    } finally {
      await quota.deleteNamespace();
      await quota.close();
    }
  });

  it('sets a finite TTL that extends past the month boundary', async () => {
    const clock = new FakeClock('2026-09-15T10:00:00Z');
    const quota = new RedisProviderQuota(REDIS_URL as string, 100, clock, {
      namespace: 'test-ttl',
    });
    await quota.connect();
    try {
      await quota.reserve(1);
      const ttlSeconds = await quota.readTtl();
      expect(ttlSeconds).toBeGreaterThan(0);
      expect(ttlSeconds).toBeLessThan(40 * 24 * 60 * 60);
      const boundary = Date.parse('2026-10-01T00:00:00Z');
      const now = Date.parse('2026-09-15T10:00:00Z');
      expect(ttlSeconds * 1000).toBeGreaterThan(boundary - now);
    } finally {
      await quota.deleteNamespace();
      await quota.close();
    }
  });

  it('rejects with PROVIDER_BUDGET_UNAVAILABLE while disconnected', async () => {
    const quota = new RedisProviderQuota(
      REDIS_URL as string,
      10,
      new FakeClock('2026-09-15T10:00:00Z'),
    );
    await expect(quota.reserve(1)).rejects.toMatchObject({ code: 'PROVIDER_BUDGET_UNAVAILABLE' });
  });
});
