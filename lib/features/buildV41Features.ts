import { buildV4Features } from "./buildV4Features";
import { FeatureRowV41, toFeatureRowV41 } from "./featureSchemaV41";
import { V3BallContext, V3Rolling } from "./buildV3Features";

export function buildV41Features(
  match: { teamA: string; teamB: string },
  ballContext: V3BallContext,
  rolling: V3Rolling
): FeatureRowV41 {
  const v4 = buildV4Features(match, ballContext, rolling);

  const isChase = Number(v4.isChase ?? 0);
  const isDeath = Number(v4.isDeath ?? 0);
  const isPowerplay = Number(v4.isPowerplay ?? 0);
  const rrDelta = Number(v4.rrDelta ?? 0);
  const wicketsInHand = Number(v4.wicketsInHand ?? 0);
  const rrLast12 = Number(v4.rrLast12 ?? 0);
  const rrr = Number(v4.rrr ?? 0);
  const runsNeeded = Number(v4.runsNeeded ?? 0);
  const ballsRemaining = Number(v4.ballsRemaining ?? 0);

  const pressure = isChase ? runsNeeded / Math.max(1, ballsRemaining) : 0;
  const momentumGap = isChase ? rrLast12 - rrr : 0;

  return toFeatureRowV41(v4, {
    rrDeltaSq: rrDelta * rrDelta,
    wicketsInHandSq: wicketsInHand * wicketsInHand,
    rrDelta_isDeath: rrDelta * isDeath,
    rrDelta_isPowerplay: rrDelta * isPowerplay,
    pressure: Number.isFinite(pressure) ? pressure : 0,
    pressureSq: Number.isFinite(pressure) ? pressure * pressure : 0,
    pressure_wkts: Number.isFinite(pressure) ? pressure * wicketsInHand : 0,
    momentumGap: Number.isFinite(momentumGap) ? momentumGap : 0,
    momentumGap_isDeath: Number.isFinite(momentumGap) ? momentumGap * isDeath : 0,
  });
}
