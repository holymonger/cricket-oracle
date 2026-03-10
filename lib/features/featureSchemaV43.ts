import { FEATURE_NAMES_V42, FeatureRowV42, emptyFeatureRowV42 } from "./featureSchemaV42";

export const FEATURE_NAMES_V43 = [
  ...FEATURE_NAMES_V42,
  "battingTeamIsA",
] as const;

export type FeatureNameV43 = (typeof FEATURE_NAMES_V43)[number];
export type FeatureRowV43 = Record<FeatureNameV43, number>;

export function emptyFeatureRowV43(): FeatureRowV43 {
  return FEATURE_NAMES_V43.reduce((row, name) => {
    row[name] = 0;
    return row;
  }, {} as FeatureRowV43);
}

export function toVectorV43(row: FeatureRowV43): number[] {
  return FEATURE_NAMES_V43.map((name) => row[name] ?? 0);
}

export function toFeatureRowV43(base: FeatureRowV42, extras: Partial<FeatureRowV43>): FeatureRowV43 {
  const row = emptyFeatureRowV43();
  const v42Base = emptyFeatureRowV42();

  for (const name of FEATURE_NAMES_V42) {
    row[name] = Number(base[name] ?? v42Base[name] ?? 0);
  }

  for (const name of FEATURE_NAMES_V43) {
    if (name in extras) {
      row[name] = Number(extras[name] ?? 0);
    }
  }

  return row;
}
