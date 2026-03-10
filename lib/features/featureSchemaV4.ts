import { FEATURE_NAMES, FeatureRow } from "./featureSchema";

export const FEATURE_NAMES_V4 = [
  ...FEATURE_NAMES,
  "isChase",
  "isPowerplay",
  "isDeath",
  "wicketsInHand",
  "rrDelta",
  "rrLast12",
  "dotRateLast12",
  "boundaryRateLast12",
  "ballsRemainingFrac",
] as const;

export type FeatureNameV4 = (typeof FEATURE_NAMES_V4)[number];
export type FeatureRowV4 = Record<FeatureNameV4, number>;

export function emptyFeatureRowV4(): FeatureRowV4 {
  return FEATURE_NAMES_V4.reduce((row, name) => {
    row[name] = 0;
    return row;
  }, {} as FeatureRowV4);
}

export function toVectorV4(row: FeatureRowV4): number[] {
  return FEATURE_NAMES_V4.map((name) => row[name] ?? 0);
}

export function toFeatureRowV4(base: FeatureRow, extras: Partial<FeatureRowV4>): FeatureRowV4 {
  const row = emptyFeatureRowV4();
  for (const name of FEATURE_NAMES) {
    row[name] = Number(base[name] ?? 0);
  }
  for (const name of FEATURE_NAMES_V4) {
    if (name in extras) {
      row[name] = Number(extras[name] ?? 0);
    }
  }
  return row;
}
