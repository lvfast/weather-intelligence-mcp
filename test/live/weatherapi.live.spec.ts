import { describe, expect, it } from 'vitest';
import { CachedLocationLookup } from '../../src/application/location/location-lookup.js';
import { LocationService } from '../../src/application/location/location.service.js';
import { WeatherService } from '../../src/application/weather/weather.service.js';
import { MemoryCacheStore } from '../../src/infrastructure/cache/memory-cache.store.js';
import { SystemClock } from '../../src/infrastructure/clock/system-clock.js';
import { EmergencyLimiter } from '../../src/infrastructure/quota/emergency-limiter.js';
import { MemoryProviderQuota } from '../../src/infrastructure/quota/memory-provider-quota.js';
import { WeatherApiClient } from '../../src/infrastructure/weatherapi/weatherapi.client.js';

const apiKey = process.env.WEATHERAPI_KEY;
const enabled = process.env.RUN_LIVE_WEATHERAPI_TESTS === 'true' && apiKey !== undefined;

describe.skipIf(!enabled)('live WeatherAPI smoke test', () => {
  it('fetches normalized current weather for London with a one-call budget', async () => {
    const clock = new SystemClock();
    const cache = new MemoryCacheStore(100, clock);
    const quota = new MemoryProviderQuota(1, clock);
    const client = new WeatherApiClient(apiKey as string, quota, new EmergencyLimiter(1));
    const lookup = new CachedLocationLookup(client, cache, clock);
    const locations = new LocationService(client, cache, clock, lookup);
    const weather = new WeatherService(locations, lookup, client, cache, clock);

    const result = await weather.getCurrent({ query: 'London' });

    expect(result.meta.provider).toBe('weatherapi');
    expect(result.meta.cached).toBe(false);
    expect(result.data.location.name).toBeTruthy();
    expect(result.data.location.timeZone).toMatch(/^[A-Za-z_/+-]+$/);
    expect(typeof result.data.interval.temperatureC).toBe('number');
    expect(typeof result.data.interval.windKph).toBe('number');
    expect(result.data.interval.humidityPercent).toBeGreaterThanOrEqual(0);
    expect(result.data.interval.humidityPercent).toBeLessThanOrEqual(100);
    expect(result.data.observedAt).toMatch(/(Z|[+-]\d{2}:\d{2})$/);
  }, 30_000);
});
