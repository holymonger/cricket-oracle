import { FEATURE_NAMES_V41, FeatureRowV41, emptyFeatureRowV41 } from "./featureSchemaV41";

export const FEATURE_NAMES_V42 = [
  ...FEATURE_NAMES_V41,
  "br_0_6",
  "br_7_12",
  "br_13_18",
  "br_19_24",
  "br_25_36",
  "br_37_60",
  "br_61_90",
  "br_91_120",
  "wih_0_2",
  "wih_3_5",
  "wih_6_8",
  "wih_9_10",
  "p_0_0_5",
  "p_0_5_1_0",
  "p_1_0_1_5",
  "p_1_5_2_0",
  "p_2_0_2_5",
  "p_2_5_3_0",
  "p_3p",
  "rrd_-3p",
  "rrd_-2_-3",
  "rrd_-1_-2",
  "rrd_-0_5_0_5",
  "rrd_1_0_5_1_5",
  "rrd_2_1_5_2_5",
  "rrd_3p",
] as const;

export type FeatureNameV42 = (typeof FEATURE_NAMES_V42)[number];
export type FeatureRowV42 = Record<FeatureNameV42, number>;

export function emptyFeatureRowV42(): FeatureRowV42 {
  return FEATURE_NAMES_V42.reduce((row, name) => {
    row[name] = 0;
    return row;
  }, {} as FeatureRowV42);
}

export function toVectorV42(row: FeatureRowV42): number[] {
  return FEATURE_NAMES_V42.map((name) => row[name] ?? 0);
}

export function toFeatureRowV42(base: FeatureRowV41, extras: Partial<FeatureRowV42>): FeatureRowV42 {
  const row = emptyFeatureRowV42();
  const v41Base = emptyFeatureRowV41();

  for (const name of FEATURE_NAMES_V41) {
    row[name] = Number(base[name] ?? v41Base[name] ?? 0);
  }

  for (const name of FEATURE_NAMES_V42) {
    if (name in extras) {
      row[name] = Number(extras[name] ?? 0);
    }
  }

  return row;
}
