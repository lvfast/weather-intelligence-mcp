import type {
  EmergencyLimiter as EmergencyLimiterPort,
  QuotaReservation,
} from '../../domain/ports.js';
import { AppError } from '../../domain/errors.js';

const WINDOW_MS = 60_000;

export class EmergencyLimiter implements EmergencyLimiterPort {
  private readonly grants: number[] = [];

  constructor(
    private readonly limitPerMinute: number,
    private readonly monotonicNow: () => number = Date.now,
  ) {}

  async reserve(attempts: number): Promise<QuotaReservation> {
    const now = this.monotonicNow();
    const windowStart = now - WINDOW_MS;
    while (this.grants.length > 0 && (this.grants[0] ?? Number.POSITIVE_INFINITY) <= windowStart) {
      this.grants.shift();
    }
    if (this.grants.length + attempts > this.limitPerMinute) {
      throw new AppError(
        'PROVIDER_BUDGET_UNAVAILABLE',
        'Emergency provider allowance is exhausted; retry after the rolling minute resets.',
      );
    }
    for (let index = 0; index < attempts; index += 1) {
      this.grants.push(now);
    }
    return {
      granted: true,
      used: this.grants.length,
      limit: this.limitPerMinute,
      resetsAt: new Date(now + WINDOW_MS).toISOString(),
      mode: 'emergency',
    };
  }
}
