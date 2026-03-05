export const FEATURE_NAMES = [
  "runs",
  "wickets",
  "balls",
  "ballsRemaining",
  "rr",
  "targetRuns",
  "runsNeeded",
  "rrr",
  "runsLast6",
  "wktsLast6",
  "dotsLast6",
  "boundariesLast6",
  "runsLast12",
  "wktsLast12",
  "dotsLast12",
  "boundariesLast12",
  "runsThisBallTotal",
  "isWicketThisBall",
  "isBoundaryThisBall",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureRow = Record<FeatureName, number>;

export function emptyFeatureRow(): FeatureRow {
  return FEATURE_NAMES.reduce((row, name) => {
    row[name] = 0;
    return row;
  }, {} as FeatureRow);
}

export function toVector(row: FeatureRow): number[] {
  return FEATURE_NAMES.map((name) => row[name] ?? 0);
}
