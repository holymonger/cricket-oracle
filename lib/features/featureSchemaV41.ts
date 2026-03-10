import { FEATURE_NAMES_V4, FeatureRowV4, emptyFeatureRowV4 } from "./featureSchemaV4";

export const FEATURE_NAMES_V41 = [
  ...FEATURE_NAMES_V4,
  "rrDeltaSq",
  "wicketsInHandSq",
  "rrDelta_isDeath",
  "rrDelta_isPowerplay",
  "pressure",
  "pressureSq",
  "pressure_wkts",
  "momentumGap",
  "momentumGap_isDeath",
] as const;

export type FeatureNameV41 = (typeof FEATURE_NAMES_V41)[number];
export type FeatureRowV41 = Record<FeatureNameV41, number>;

export function emptyFeatureRowV41(): FeatureRowV41 {
  return FEATURE_NAMES_V41.reduce((row, name) => {
    row[name] = 0;
    return row;
  }, {} as FeatureRowV41);
}

export function toVectorV41(row: FeatureRowV41): number[] {
  return FEATURE_NAMES_V41.map((name) => row[name] ?? 0);
}

export function toFeatureRowV41(base: FeatureRowV4, extras: Partial<FeatureRowV41>): FeatureRowV41 {
  const row = emptyFeatureRowV41();
  const v4Base = emptyFeatureRowV4();

  for (const name of FEATURE_NAMES_V4) {
    row[name] = Number(base[name] ?? v4Base[name] ?? 0);
  }

  for (const name of FEATURE_NAMES_V41) {
    if (name in extras) {
      row[name] = Number(extras[name] ?? 0);
    }
  }

  return row;
}
