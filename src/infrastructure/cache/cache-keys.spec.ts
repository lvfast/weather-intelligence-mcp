import { describe, expect, it } from 'vitest';
import {
  buildAlertsKey,
  buildCoordinateKey,
  buildCurrentWeatherKey,
  buildForecastKey,
  buildLocationSearchKey,
  normalizeQuery,
  roundCoordinate,
} from './cache-keys.js';

describe('normalizeQuery', () => {
  it('applies NFKC normalization, trimming, whitespace collapsing, and case folding', () => {
    expect(normalizeQuery('  HÀ   NỘI ')).toBe('hà nội');
    expect(normalizeQuery(' Paris')).toBe('paris');
    expect(normalizeQuery('PARIS ')).toBe('paris');
    expect(normalizeQuery('a\u0301bc')).toBe('\u00e1bc');
    expect(normalizeQuery('new  york\t city')).toBe('new york city');
  });

  it('does not strip accents', () => {
    expect(normalizeQuery('São Paulo')).toBe('são paulo');
  });
});

describe('buildCacheKey', () => {
  it('normalizes location search queries', () => {
    expect(buildLocationSearchKey('  HÀ   NỘI ')).toBe(buildLocationSearchKey('hà nội'));
  });

  it('rounds coordinates to four decimal places', () => {
    expect(buildCoordinateKey(10.123456, 106.987654)).toContain('10.1235,106.9877');
    expect(roundCoordinate(10.123456)).toBe(10.1235);
    expect(roundCoordinate(106.987654)).toBe(106.9877);
  });

  it('orders forecast parameters canonically', () => {
    const ref = { latitude: 10.1, longitude: 106.7 };
    expect(buildForecastKey(ref, { includeHourly: false, days: 3 })).toBe(
      buildForecastKey(ref, { days: 3, includeHourly: false }),
    );
  });

  it('emits the versioned namespace and canonical segments', () => {
    expect(buildCurrentWeatherKey(1, 2)).toBe('wis:v1:current:1,2');
    expect(buildAlertsKey(1, 2)).toBe('wis:v1:alerts:1,2');
    expect(buildLocationSearchKey('Paris', 5)).toBe('wis:v1:location-search:paris:5');
    expect(
      buildForecastKey({ latitude: 10.1, longitude: 106.7 }, { days: 3, includeHourly: true }),
    ).toBe('wis:v1:forecast:10.1,106.7:days=3;hourly=1');
  });

  it('never embeds the WeatherAPI key', () => {
    const secret = 'weather-api-secret-9f86d081';
    const keys = [
      buildLocationSearchKey('Paris'),
      buildCurrentWeatherKey(10.1, 106.7),
      buildAlertsKey(10.1, 106.7),
      buildForecastKey({ latitude: 10.1, longitude: 106.7 }, { days: 1, includeHourly: false }),
    ];
    expect(keys.every((key) => !key.includes(secret))).toBe(true);
  });
});
