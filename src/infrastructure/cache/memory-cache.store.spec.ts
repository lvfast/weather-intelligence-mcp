import { describe, expect, it } from 'vitest';
import type { Clock } from '../../domain/ports.js';
import { MemoryCacheStore } from './memory-cache.store.js';

class FakeClock implements Clock {
  current: Date;

  constructor(iso: string) {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

const START = '2026-09-23T00:00:00.000Z';

describe('MemoryCacheStore', () => {
  it('returns null on a miss', async () => {
    const store = new MemoryCacheStore(100, new FakeClock(START));
    await expect(store.get('k')).resolves.toBeNull();
  });

  it('round-trips values with entry metadata', async () => {
    const clock = new FakeClock(START);
    const store = new MemoryCacheStore(100, clock);
    await store.set('k', { hello: 'world' }, 60);
    const entry = await store.get<{ hello: string }>('k');
    expect(entry).toMatchObject({
      value: { hello: 'world' },
      fetchedAt: START,
      freshUntil: '2026-09-23T00:01:00.000Z',
    });
    expect(entry?.staleUntil).toBeNull();
  });

  it('serves a fresh hit until the fresh window expires', async () => {
    const clock = new FakeClock(START);
    const store = new MemoryCacheStore(100, clock);
    await store.set('k', 1, 60);
    clock.advanceSeconds(59.999);
    await expect(store.get('k')).not.toBeNull();
  });

  it('retains stale entries through the stale window when requested', async () => {
    const clock = new FakeClock(START);
    const store = new MemoryCacheStore(100, clock);
    await store.set('k', 'data', 600, 1800);
    clock.advanceSeconds(601);
    const stale = await store.get('k');
    expect(stale).not.toBeNull();
    expect(stale?.freshUntil).toBe('2026-09-23T00:10:00.000Z');
    expect(stale?.staleUntil).toBe('2026-09-23T00:30:00.000Z');
  });

  it('evicts entries exactly at the stale boundary', async () => {
    const clock = new FakeClock(START);
    const store = new MemoryCacheStore(100, clock);
    await store.set('k', 'data', 600, 1800);
    clock.advanceSeconds(1799.999);
    expect(await store.get('k')).not.toBeNull();
    clock.advanceSeconds(0.001);
    expect(await store.get('k')).toBeNull();
  });

  it('evicts entries with no stale window at the fresh boundary', async () => {
    const clock = new FakeClock(START);
    const store = new MemoryCacheStore(100, clock);
    await store.set('k', 'data', 300);
    clock.advanceSeconds(299.999);
    expect(await store.get('k')).not.toBeNull();
    clock.advanceSeconds(0.001);
    expect(await store.get('k')).toBeNull();
  });

  it('supports the negative-location five-minute TTL', async () => {
    const clock = new FakeClock(START);
    const store = new MemoryCacheStore(100, clock);
    await store.set('missing', [], 300);
    clock.advanceSeconds(300);
    expect(await store.get('missing')).toBeNull();
  });

  it('evicts the least recently used entry beyond the bound', async () => {
    const clock = new FakeClock(START);
    const store = new MemoryCacheStore(3, clock);
    await store.set('a', 1, 1000);
    await store.set('b', 2, 1000);
    await store.set('c', 3, 1000);
    expect(await store.get('a')).not.toBeNull();
    await store.set('d', 4, 1000);
    expect(await store.get('b')).toBeNull();
    expect(await store.get('a')).not.toBeNull();
    expect(await store.get('c')).not.toBeNull();
    expect(await store.get('d')).not.toBeNull();
  });

  it('touches entries on read so recent reads survive eviction', async () => {
    const clock = new FakeClock(START);
    const store = new MemoryCacheStore(2, clock);
    await store.set('a', 1, 1000);
    await store.set('b', 2, 1000);
    await store.get('a');
    await store.set('c', 3, 1000);
    expect(await store.get('b')).toBeNull();
    expect(await store.get('a')).not.toBeNull();
  });

  it('deletes entries explicitly', async () => {
    const store = new MemoryCacheStore(10, new FakeClock(START));
    await store.set('k', 1, 60);
    await store.delete('k');
    expect(await store.get('k')).toBeNull();
  });

  it('reports healthy in memory mode', async () => {
    const store = new MemoryCacheStore(10, new FakeClock(START));
    await expect(store.health()).resolves.toBe('up');
  });

  it('does not evict when the bound has not been reached', async () => {
    const store = new MemoryCacheStore(100, new FakeClock(START));
    for (let index = 0; index < 100; index += 1) {
      await store.set(`k${index}`, index, 1000);
    }
    expect(await store.get('k0')).not.toBeNull();
    expect(await store.get('k99')).not.toBeNull();
  });
});
