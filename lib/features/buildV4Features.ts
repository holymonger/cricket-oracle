import { buildV3Features, V3BallContext, V3Rolling } from "./buildV3Features";
import { FeatureRowV4, toFeatureRowV4 } from "./featureSchemaV4";

export function buildV4Features(
  match: { teamA: string; teamB: string },
  ballContext: V3BallContext,
  rolling: V3Rolling
): FeatureRowV4 {
  const v3 = buildV3Features(match, ballContext, rolling);

  const balls = Number(v3.balls ?? 0);
  const ballsRemaining = Number(v3.ballsRemaining ?? 0);
  const wickets = Number(v3.wickets ?? 0);
  const rr = Number(v3.rr ?? 0);
  const rrr = Number(v3.rrr ?? 0);
  const runsLast12 = Number(v3.runsLast12 ?? 0);
  const dotsLast12 = Number(v3.dotsLast12 ?? 0);
  const boundariesLast12 = Number(v3.boundariesLast12 ?? 0);

  const isChase = ballContext.innings === 2 ? 1 : 0;
  const isPowerplay = balls <= 36 ? 1 : 0;
  const isDeath = balls > 90 ? 1 : 0;
  const wicketsInHand = Math.max(0, 10 - wickets);
  const rrDelta = ballContext.innings === 2 ? rrr - rr : 0;
  const rrLast12 = (runsLast12 / 12) * 6;
  const dotRateLast12 = dotsLast12 / 12;
  const boundaryRateLast12 = boundariesLast12 / 12;
  const ballsRemainingFrac = ballsRemaining / 120;

  return toFeatureRowV4(v3, {
    isChase,
    isPowerplay,
    isDeath,
    wicketsInHand,
    rrDelta: Number.isFinite(rrDelta) ? rrDelta : 0,
    rrLast12: Number.isFinite(rrLast12) ? rrLast12 : 0,
    dotRateLast12: Number.isFinite(dotRateLast12) ? dotRateLast12 : 0,
    boundaryRateLast12: Number.isFinite(boundaryRateLast12) ? boundaryRateLast12 : 0,
    ballsRemainingFrac: Number.isFinite(ballsRemainingFrac) ? ballsRemainingFrac : 0,
  });
}
