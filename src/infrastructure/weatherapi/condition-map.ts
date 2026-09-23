import type { ConditionCategory, ConditionIntensity } from '../../domain/weather.js';

export interface ConditionClassification {
  category: ConditionCategory;
  intensity: ConditionIntensity;
}

type Category = ConditionClassification['category'];
type Intensity = ConditionClassification['intensity'];

const classification = (category: Category, intensity: Intensity): ConditionClassification => ({
  category,
  intensity,
});

export const CONDITION_CODE_MAP: Readonly<Record<number, ConditionClassification>> = {
  1000: classification('clear', 'light'),
  1003: classification('cloudy', 'light'),
  1006: classification('cloudy', 'moderate'),
  1009: classification('cloudy', 'heavy'),
  1012: classification('fog', 'light'),
  1015: classification('fog', 'light'),
  1018: classification('fog', 'moderate'),
  1021: classification('fog', 'heavy'),
  1024: classification('fog', 'heavy'),
  1027: classification('fog', 'heavy'),
  1030: classification('fog', 'light'),
  1033: classification('fog', 'light'),
  1036: classification('fog', 'light'),
  1039: classification('fog', 'moderate'),
  1042: classification('fog', 'heavy'),
  1045: classification('fog', 'moderate'),
  1048: classification('fog', 'light'),
  1063: classification('rain', 'light'),
  1066: classification('snow', 'light'),
  1069: classification('sleet', 'light'),
  1072: classification('sleet', 'light'),
  1087: classification('thunderstorm', 'unknown'),
  1114: classification('snow', 'moderate'),
  1117: classification('snow', 'heavy'),
  1135: classification('fog', 'moderate'),
  1147: classification('fog', 'heavy'),
  1150: classification('rain', 'light'),
  1153: classification('rain', 'light'),
  1168: classification('sleet', 'light'),
  1171: classification('sleet', 'heavy'),
  1180: classification('rain', 'light'),
  1183: classification('rain', 'light'),
  1186: classification('rain', 'moderate'),
  1189: classification('rain', 'moderate'),
  1192: classification('rain', 'heavy'),
  1195: classification('rain', 'heavy'),
  1198: classification('sleet', 'light'),
  1201: classification('sleet', 'heavy'),
  1204: classification('sleet', 'light'),
  1207: classification('sleet', 'heavy'),
  1210: classification('snow', 'light'),
  1213: classification('snow', 'light'),
  1216: classification('snow', 'moderate'),
  1219: classification('snow', 'moderate'),
  1222: classification('snow', 'heavy'),
  1225: classification('snow', 'heavy'),
  1237: classification('sleet', 'moderate'),
  1240: classification('rain', 'light'),
  1243: classification('rain', 'heavy'),
  1246: classification('rain', 'heavy'),
  1249: classification('sleet', 'light'),
  1252: classification('sleet', 'heavy'),
  1255: classification('snow', 'light'),
  1258: classification('snow', 'heavy'),
  1261: classification('sleet', 'light'),
  1264: classification('sleet', 'heavy'),
  1273: classification('thunderstorm', 'light'),
  1276: classification('thunderstorm', 'heavy'),
  1279: classification('thunderstorm', 'light'),
  1282: classification('thunderstorm', 'heavy'),
};

export function classifyConditionCode(code: number): ConditionClassification {
  return CONDITION_CODE_MAP[code] ?? classification('other', 'unknown');
}
