import { describe, expect, it } from 'vitest';
import { EmergencyLimiter } from './emergency-limiter.js';

describe('EmergencyLimiter', () => {
  it('grants exactly five attempts in one rolling minute', async () => {
    const limiter = new EmergencyLimiter(5, () => 0);
    for (let index = 0; index < 5; index += 1) {
      await expect(limiter.reserve(1)).resolves.toMatchObject({ granted: true, mode: 'emergency' });
    }
    await expect(limiter.reserve(1)).rejects.toMatchObject({ code: 'PROVIDER_BUDGET_UNAVAILABLE' });
  });

  it('allows again after sixty seconds', async () => {
    let now = 0;
    const limiter = new EmergencyLimiter(5, () => now);
    for (let index = 0; index < 5; index += 1) {
      await limiter.reserve(1);
    }
    now = 59_999;
    await expect(limiter.reserve(1)).rejects.toMatchObject({ code: 'PROVIDER_BUDGET_UNAVAILABLE' });
    now = 60_000;
    await expect(limiter.reserve(1)).resolves.toMatchObject({ granted: true });
  });

  it('consumes one slot per attempt for retrying operations', async () => {
    const now = 0;
    const limiter = new EmergencyLimiter(5, () => now);
    await limiter.reserve(2);
    await expect(limiter.reserve(2)).resolves.toMatchObject({ used: 4 });
    await expect(limiter.reserve(2)).rejects.toMatchObject({ code: 'PROVIDER_BUDGET_UNAVAILABLE' });
  });

  it('reports the rolling reset time', async () => {
    const now = 1_000_000;
    const limiter = new EmergencyLimiter(5, () => now);
    const reservation = await limiter.reserve(1);
    expect(Date.parse(reservation.resetsAt)).toBe(now + 60_000);
  });

  it('prunes stale timestamps before counting', async () => {
    let now = 0;
    const limiter = new EmergencyLimiter(5, () => now);
    for (let index = 0; index < 5; index += 1) {
      await limiter.reserve(1);
    }
    now = 61_000;
    await expect(limiter.reserve(1)).resolves.toMatchObject({ used: 1 });
  });
});
