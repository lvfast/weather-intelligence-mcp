import { describe, expect, it } from 'vitest';
import type { Clock } from '../../domain/ports.js';
import { isAppError } from '../../domain/errors.js';
import { MemoryProviderQuota } from './memory-provider-quota.js';

class FakeClock implements Clock {
  current: Date;

  constructor(iso: string) {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(iso: string): void {
    this.current = new Date(iso);
  }
}

describe('MemoryProviderQuota', () => {
  it('reserves calls against the monthly budget in process mode', async () => {
    const quota = new MemoryProviderQuota(90_000, new FakeClock('2026-09-15T10:00:00Z'));
    await expect(quota.reserve(1)).resolves.toMatchObject({
      granted: true,
      used: 1,
      limit: 90_000,
      mode: 'process',
    });
  });

  it('enforces exhaustion and rolls over at the UTC month boundary', async () => {
    const clock = new FakeClock('2026-09-15T10:00:00Z');
    const quota = new MemoryProviderQuota(90_000, clock);
    await expect(quota.reserve(1)).resolves.toMatchObject({
      granted: true,
      used: 1,
      limit: 90_000,
    });
    clock.set('2026-09-30T23:59:59Z');
    await quota.reserve(89_999);
    await expect(quota.reserve(1)).rejects.toMatchObject({ code: 'PROVIDER_BUDGET_EXHAUSTED' });
    clock.set('2026-10-01T00:00:00Z');
    await expect(quota.reserve(1)).resolves.toMatchObject({ used: 1 });
  });

  it('does not advance the counter on a denied reservation', async () => {
    const quota = new MemoryProviderQuota(5, new FakeClock('2026-09-15T10:00:00Z'));
    await quota.reserve(4);
    await expect(quota.reserve(2)).rejects.toMatchObject({ code: 'PROVIDER_BUDGET_EXHAUSTED' });
    await expect(quota.reserve(1)).resolves.toMatchObject({ used: 5 });
    await expect(quota.reserve(1)).rejects.toBeInstanceOf(Error);
  });

  it('consumes multiple attempts per reservation', async () => {
    const quota = new MemoryProviderQuota(10, new FakeClock('2026-09-15T10:00:00Z'));
    await expect(quota.reserve(3)).resolves.toMatchObject({ used: 3 });
    await expect(quota.reserve(3)).resolves.toMatchObject({ used: 6 });
  });

  it('reports the next UTC month boundary as the reset time', async () => {
    const quota = new MemoryProviderQuota(10, new FakeClock('2026-09-15T10:00:00Z'));
    const reservation = await quota.reserve(1);
    expect(reservation.resetsAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('reports the process-scoped caveat through mode', async () => {
    const quota = new MemoryProviderQuota(10, new FakeClock('2026-09-15T10:00:00Z'));
    await expect(quota.reserve(1)).resolves.toMatchObject({ mode: 'process' });
  });

  it('raises a shared AppError on exhaustion', async () => {
    const quota = new MemoryProviderQuota(1, new FakeClock('2026-09-15T10:00:00Z'));
    await quota.reserve(1);
    const error = await quota.reserve(1).catch((caught: unknown) => caught);
    await expect(quota.reserve(1)).rejects.toMatchObject({ code: 'PROVIDER_BUDGET_EXHAUSTED' });
    expect(isAppError(error)).toBe(true);
  });
});
