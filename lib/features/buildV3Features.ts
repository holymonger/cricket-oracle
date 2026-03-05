import { FeatureRow, emptyFeatureRow } from "./featureSchema";

export type V3BallContext = {
  innings: 1 | 2;
  battingTeam: "A" | "B";
  runs: number;
  wickets: number;
  balls: number;
  targetRuns?: number;
  runsThisBall: number;
  isWicketThisBall: boolean;
};

export type V3Rolling = {
  runsLast6: number;
  wktsLast6: number;
  dotsLast6: number;
  boundariesLast6: number;
  runsLast12: number;
  wktsLast12: number;
  dotsLast12: number;
  boundariesLast12: number;
};

export function buildV3Features(
  _match: { teamA: string; teamB: string },
  ballContext: V3BallContext,
  rolling: V3Rolling
): FeatureRow {
  const row = emptyFeatureRow();

  const runs = Math.max(0, ballContext.runs || 0);
  const wickets = Math.max(0, Math.min(10, ballContext.wickets || 0));
  const balls = Math.max(0, Math.min(120, ballContext.balls || 0));
  const ballsRemaining = Math.max(0, 120 - balls);

  row.runs = runs;
  row.wickets = wickets;
  row.balls = balls;
  row.ballsRemaining = ballsRemaining;
  row.rr = balls > 0 ? (runs * 6) / balls : 0;

  const targetRuns =
    ballContext.innings === 2 && ballContext.targetRuns
      ? Math.max(0, ballContext.targetRuns)
      : 0;
  const runsNeeded = targetRuns > 0 ? Math.max(0, targetRuns - runs) : 0;
  const rrr = ballsRemaining > 0 ? (runsNeeded * 6) / ballsRemaining : 0;

  row.targetRuns = targetRuns;
  row.runsNeeded = runsNeeded;
  row.rrr = rrr;

  row.runsLast6 = Math.max(0, rolling.runsLast6 || 0);
  row.wktsLast6 = Math.max(0, rolling.wktsLast6 || 0);
  row.dotsLast6 = Math.max(0, rolling.dotsLast6 || 0);
  row.boundariesLast6 = Math.max(0, rolling.boundariesLast6 || 0);

  row.runsLast12 = Math.max(0, rolling.runsLast12 || 0);
  row.wktsLast12 = Math.max(0, rolling.wktsLast12 || 0);
  row.dotsLast12 = Math.max(0, rolling.dotsLast12 || 0);
  row.boundariesLast12 = Math.max(0, rolling.boundariesLast12 || 0);

  row.runsThisBallTotal = Math.max(0, ballContext.runsThisBall || 0);
  row.isWicketThisBall = ballContext.isWicketThisBall ? 1 : 0;
  row.isBoundaryThisBall = ballContext.runsThisBall === 4 || ballContext.runsThisBall === 6 ? 1 : 0;

  return row;
}
