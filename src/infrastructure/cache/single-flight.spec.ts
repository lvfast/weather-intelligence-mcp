import { describe, expect, it, vi } from 'vitest';
import { SingleFlight } from './single-flight.js';

describe('SingleFlight', () => {
  it('removes the in-flight promise after rejection so the next caller retries', async () => {
    const flight = new SingleFlight();
    const failing = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce('second');
    await expect(flight.run('k', failing)).rejects.toThrow('first');
    await expect(flight.run('k', failing)).resolves.toBe('second');
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent callers into one loader execution', async () => {
    const flight = new SingleFlight();
    let resolveLoader: (value: string) => void = () => undefined;
    const loader = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoader = resolve;
        }),
    );
    const results = Array.from({ length: 20 }, () => flight.run('shared', loader));
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveLoader('value');
    const settled = await Promise.all(results);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(new Set(settled).size).toBe(1);
    expect(settled[0]).toBe('value');
  });

  it('keeps different keys independent', async () => {
    const flight = new SingleFlight();
    const loader = vi.fn((key: string) => Promise.resolve(key));
    const [a, b] = await Promise.all([
      flight.run('a', () => loader('a')),
      flight.run('b', () => loader('b')),
    ]);
    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('clears the key after success', async () => {
    const flight = new SingleFlight();
    const loader = vi.fn(() => Promise.resolve('done'));
    await flight.run('k', loader);
    await flight.run('k', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('tolerates synchronous loader failures', async () => {
    const flight = new SingleFlight();
    const loader = (): Promise<string> => {
      throw new Error('sync');
    };
    await expect(flight.run('k', loader)).rejects.toThrow('sync');
    await expect(flight.run('k', () => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
