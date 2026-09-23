import { describe, expect, it } from 'vitest';
import { classifyConditionCode, CONDITION_CODE_MAP } from './condition-map.js';

describe('condition code mapping', () => {
  it('maps every pinned WeatherAPI code to a known category', () => {
    const categories = new Set([
      'clear',
      'cloudy',
      'fog',
      'rain',
      'snow',
      'sleet',
      'thunderstorm',
      'other',
    ]);
    for (const [code, mapping] of Object.entries(CONDITION_CODE_MAP)) {
      expect(categories.has(mapping.category), `code ${code}`).toBe(true);
    }
  });

  it.each([
    [1000, 'clear', 'light'],
    [1003, 'cloudy', 'light'],
    [1006, 'cloudy', 'moderate'],
    [1009, 'cloudy', 'heavy'],
    [1030, 'fog', 'light'],
    [1135, 'fog', 'moderate'],
    [1147, 'fog', 'heavy'],
    [1183, 'rain', 'light'],
    [1189, 'rain', 'moderate'],
    [1195, 'rain', 'heavy'],
    [1213, 'snow', 'light'],
    [1219, 'snow', 'moderate'],
    [1225, 'snow', 'heavy'],
    [1204, 'sleet', 'light'],
    [1207, 'sleet', 'heavy'],
    [1237, 'sleet', 'moderate'],
    [1087, 'thunderstorm', 'unknown'],
    [1273, 'thunderstorm', 'light'],
  ])('classifies code %s as %s/%s', (code, category, intensity) => {
    expect(classifyConditionCode(code)).toEqual({ category, intensity });
  });

  it('maps heavy-rain and heavy-snow thunder codes to heavy thunderstorm independently of text', () => {
    expect(classifyConditionCode(1276)).toEqual({ category: 'thunderstorm', intensity: 'heavy' });
    expect(classifyConditionCode(1282)).toEqual({ category: 'thunderstorm', intensity: 'heavy' });
  });

  it('maps unknown codes to other/unknown', () => {
    expect(classifyConditionCode(9999)).toEqual({ category: 'other', intensity: 'unknown' });
    expect(classifyConditionCode(-1)).toEqual({ category: 'other', intensity: 'unknown' });
  });
});
