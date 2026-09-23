import { describe, expect, it } from 'vitest';
import { classifyConditionCode, CONDITION_CODE_MAP } from './condition-map.js';

describe('condition code mapping', () => {
  const OFFICIAL_WEATHERAPI_CODES = [
    1000, 1003, 1006, 1009, 1012, 1015, 1018, 1021, 1024, 1027, 1030, 1033, 1036, 1039, 1042, 1045,
    1048, 1063, 1066, 1069, 1072, 1087, 1114, 1117, 1135, 1147, 1150, 1153, 1168, 1171, 1180, 1183,
    1186, 1189, 1192, 1195, 1198, 1201, 1204, 1207, 1210, 1213, 1216, 1219, 1222, 1225, 1237, 1240,
    1243, 1246, 1249, 1252, 1255, 1258, 1261, 1264, 1273, 1276, 1279, 1282,
  ];

  it('covers every official WeatherAPI condition code', () => {
    const missing = OFFICIAL_WEATHERAPI_CODES.filter((code) => !(code in CONDITION_CODE_MAP));
    expect(missing).toEqual([]);
  });

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
    [1036, 'fog', 'light'],
    [1039, 'fog', 'moderate'],
    [1042, 'fog', 'heavy'],
    [1021, 'fog', 'heavy'],
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
