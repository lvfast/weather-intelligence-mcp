import type { Clock, ProviderQuota, QuotaReservation } from '../../domain/ports.js';
import { AppError } from '../../domain/errors.js';
import { nextUtcMonthBoundary, utcMonthKey } from './month-window.js';

export class MemoryProviderQuota implements ProviderQuota {
  private readonly usedByMonth = new Map<string, number>();

  constructor(
    private readonly limit: number,
    private readonly clock: Clock,
  ) {}

  async reserve(attempts: number): Promise<QuotaReservation> {
    const now = this.clock.now();
    const month = utcMonthKey(now);
    const boundary = nextUtcMonthBoundary(now);
    const used = this.usedByMonth.get(month) ?? 0;
    if (used + attempts > this.limit) {
      throw new AppError(
        'PROVIDER_BUDGET_EXHAUSTED',
        `Monthly provider budget of ${this.limit} calls is exhausted; ` +
          `the per-process counter resets at the next UTC month boundary.`,
        { details: { used, limit: this.limit, resetsAt: boundary.toISOString() } },
      );
    }
    this.usedByMonth.set(month, used + attempts);
    return {
      granted: true,
      used: used + attempts,
      limit: this.limit,
      resetsAt: boundary.toISOString(),
      mode: 'process',
    };
  }
}
