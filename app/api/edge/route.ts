import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { assertAdminKey } from "@/lib/auth/adminKey";
import { mapTeamNameToSide } from "@/lib/teams/mapToSide";
import { fairProbAFromTwoSidedDecimal } from "@/lib/markets/decimal";

type OddsPayload = {
  market: string;
  externalEventId: string;
  observedAt: string;
  selections: Array<{ teamName: string; oddsDecimal: number }>;
};

export async function GET(req: Request) {
  await assertAdminKey(req);

  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get("matchId");
  const modelVersion = searchParams.get("modelVersion") ?? "v3-lgbm";
  if (!matchId) return NextResponse.json({ error: "matchId required" }, { status: 400 });

  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return NextResponse.json({ error: "match not found" }, { status: 404 });

  const latestPred = await prisma.ballPrediction.findFirst({
    where: { matchId, modelVersion },
    orderBy: [{ innings: "desc" }, { legalBallNumber: "desc" }, { createdAt: "desc" }],
  });

  if (!latestPred) {
    return NextResponse.json(
      { error: `No BallPrediction found for modelVersion=${modelVersion}` },
      { status: 404 }
    );
  }

  // Fetch odds from aggregator format endpoint
  const oddsRes = await fetch(
    new URL(`/api/odds/${matchId}`, req.url),
    { headers: { "x-admin-key": req.headers.get("x-admin-key") ?? "" } }
  );
  if (!oddsRes.ok) {
    return NextResponse.json({ error: "failed to fetch odds" }, { status: 502 });
  }
  const oddsPayload = await oddsRes.json();

  // Extract first market from aggregator format
  if (!oddsPayload.markets || oddsPayload.markets.length === 0) {
    return NextResponse.json({ error: "no markets in odds payload" }, { status: 422 });
  }

  const market = oddsPayload.markets[0];
  const odds: OddsPayload = {
    market: market.marketName,
    externalEventId: market.externalEventId,
    observedAt: market.observedAt,
    selections: market.selections,
  };

  let oddsA: number | null = null;
  let oddsB: number | null = null;

  for (const sel of odds.selections) {
    const side = mapTeamNameToSide(match, sel.teamName);
    if (side === "A") oddsA = sel.oddsDecimal;
    if (side === "B") oddsB = sel.oddsDecimal;
  }

  if (!oddsA || !oddsB) {
    return NextResponse.json(
      { error: "Need both Team A and Team B odds to compute fair probability", odds },
      { status: 422 }
    );
  }

  const fair = fairProbAFromTwoSidedDecimal(oddsA, oddsB);

  const teamAWinProb = latestPred.teamAWinProb;
  const marketProbA = fair.pA_fair;
  const edgeA = teamAWinProb - marketProbA;

  return NextResponse.json({
    matchId,
    modelVersion,
    prediction: {
      innings: latestPred.innings,
      legalBallNumber: latestPred.legalBallNumber,
      teamAWinProb,
      createdAt: latestPred.createdAt,
    },
    market: {
      source: odds.market,
      observedAt: odds.observedAt,
      oddsA,
      oddsB,
      marketProbA_raw: fair.pA_raw,
      marketProbA_fair: fair.pA_fair,
      overround: fair.overround,
    },
    edgeA,
  });
}
