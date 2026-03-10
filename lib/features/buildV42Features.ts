import { buildV41Features } from "./buildV41Features";
import { FeatureRowV42, toFeatureRowV42 } from "./featureSchemaV42";
import { V3BallContext, V3Rolling } from "./buildV3Features";

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function buildV42Features(
  match: { teamA: string; teamB: string },
  ballContext: V3BallContext,
  rolling: V3Rolling
): FeatureRowV42 {
  const v41 = buildV41Features(match, ballContext, rolling);

  const ballsRemaining = Math.max(0, Math.min(120, Math.round(toNum(v41.ballsRemaining))));
  const wicketsInHand = Math.max(0, Math.min(10, Math.round(toNum(v41.wicketsInHand))));

  const isChase = toNum(v41.isChase) > 0.5;
  const pressureRaw = toNum(v41.runsNeeded) / Math.max(1, toNum(v41.ballsRemaining));
  const pressure = isChase && Number.isFinite(pressureRaw) ? pressureRaw : 0;

  const rrDeltaRaw = toNum(v41.rrr) - toNum(v41.rr);
  const rrDelta = isChase && Number.isFinite(rrDeltaRaw) ? rrDeltaRaw : 0;

  const extras: Partial<FeatureRowV42> = {
    br_0_6: ballsRemaining <= 6 ? 1 : 0,
    br_7_12: ballsRemaining >= 7 && ballsRemaining <= 12 ? 1 : 0,
    br_13_18: ballsRemaining >= 13 && ballsRemaining <= 18 ? 1 : 0,
    br_19_24: ballsRemaining >= 19 && ballsRemaining <= 24 ? 1 : 0,
    br_25_36: ballsRemaining >= 25 && ballsRemaining <= 36 ? 1 : 0,
    br_37_60: ballsRemaining >= 37 && ballsRemaining <= 60 ? 1 : 0,
    br_61_90: ballsRemaining >= 61 && ballsRemaining <= 90 ? 1 : 0,
    br_91_120: ballsRemaining >= 91 && ballsRemaining <= 120 ? 1 : 0,

    wih_0_2: wicketsInHand <= 2 ? 1 : 0,
    wih_3_5: wicketsInHand >= 3 && wicketsInHand <= 5 ? 1 : 0,
    wih_6_8: wicketsInHand >= 6 && wicketsInHand <= 8 ? 1 : 0,
    wih_9_10: wicketsInHand >= 9 ? 1 : 0,

    p_0_0_5: isChase && pressure < 0.5 ? 1 : 0,
    p_0_5_1_0: isChase && pressure >= 0.5 && pressure < 1.0 ? 1 : 0,
    p_1_0_1_5: isChase && pressure >= 1.0 && pressure < 1.5 ? 1 : 0,
    p_1_5_2_0: isChase && pressure >= 1.5 && pressure < 2.0 ? 1 : 0,
    p_2_0_2_5: isChase && pressure >= 2.0 && pressure < 2.5 ? 1 : 0,
    p_2_5_3_0: isChase && pressure >= 2.5 && pressure < 3.0 ? 1 : 0,
    p_3p: isChase && pressure >= 3.0 ? 1 : 0,

    "rrd_-3p": isChase && rrDelta <= -3.0 ? 1 : 0,
    "rrd_-2_-3": isChase && rrDelta > -3.0 && rrDelta <= -2.0 ? 1 : 0,
    "rrd_-1_-2": isChase && rrDelta > -2.0 && rrDelta <= -1.0 ? 1 : 0,
    "rrd_-0_5_0_5": isChase && rrDelta > -1.0 && rrDelta <= 0.5 ? 1 : 0,
    rrd_1_0_5_1_5: isChase && rrDelta > 0.5 && rrDelta <= 1.5 ? 1 : 0,
    rrd_2_1_5_2_5: isChase && rrDelta > 1.5 && rrDelta <= 2.5 ? 1 : 0,
    rrd_3p: isChase && rrDelta > 2.5 ? 1 : 0,
  };

  return toFeatureRowV42(v41, extras);
}
