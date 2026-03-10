import { V3BallContext, V3Rolling } from "./buildV3Features";
import { buildV42Features } from "./buildV42Features";
import { FeatureRowV43, toFeatureRowV43 } from "./featureSchemaV43";

export function buildV43Features(
  match: { teamA: string; teamB: string },
  ballContext: V3BallContext,
  rolling: V3Rolling
): FeatureRowV43 {
  const v42 = buildV42Features(match, ballContext, rolling);
  return toFeatureRowV43(v42, {
    battingTeamIsA: ballContext.battingTeam === "A" ? 1 : 0,
  });
}
