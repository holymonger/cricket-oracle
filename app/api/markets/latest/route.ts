import { NextRequest, NextResponse } from "next/server";
import { assertAdminKey } from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  try {
    assertAdminKey(request);

    const { searchParams } = new URL(request.url);
    const matchId = searchParams.get("matchId");

    if (!matchId) {
      return NextResponse.json(
        { error: "matchId query parameter required" },
        { status: 400 }
      );
    }

    // Fetch latest prediction
    const latestPrediction = await prisma.ballPrediction.findFirst({
      where: { matchId, modelVersion: "v3-lgbm" },
      orderBy: [
        { innings: "desc" },
        { legalBallNumber: "desc" },
        { createdAt: "desc" },
      ],
    });

    // Fetch latest edge signal
    const latestEdge = await prisma.edgeSignal.findFirst({
      where: { matchId },
      orderBy: { observedAt: "desc" },
      include: {
        marketEvent: {
          include: { market: true },
        },
      },
    });

    // Fetch latest odds for sides A and B
    let oddsA = null;
    let oddsB = null;

    if (latestEdge?.marketEventId) {
      const latestOddsA = await prisma.oddsTick.findFirst({
        where: {
          marketEventId: latestEdge.marketEventId,
          side: "A",
        },
        orderBy: { observedAt: "desc" },
      });

      const latestOddsB = await prisma.oddsTick.findFirst({
        where: {
          marketEventId: latestEdge.marketEventId,
          side: "B",
        },
        orderBy: { observedAt: "desc" },
      });

      oddsA = latestOddsA;
      oddsB = latestOddsB;
    }

    // Compute staleness
    let stale = false;
    let stalenessSeconds = 0;
    if (latestEdge && latestPrediction) {
      const diffMs = Math.abs(
        latestEdge.observedAt.getTime() -
          latestPrediction.createdAt.getTime()
      );
      stalenessSeconds = Math.round(diffMs / 1000);
      stale = stalenessSeconds > 10;
    }

    return NextResponse.json({
      ok: true,
      matchId,
      prediction: latestPrediction
        ? {
            innings: latestPrediction.innings,
            legalBallNumber: latestPrediction.legalBallNumber,
            teamAWinProb: latestPrediction.teamAWinProb,
            createdAt: latestPrediction.createdAt,
          }
        : null,
      market:
        oddsA || oddsB
          ? {
              marketName: latestEdge?.marketEvent.market.name || "unknown",
              observedAt:
                oddsA?.observedAt || oddsB?.observedAt || new Date(),
              oddsA: oddsA?.oddsDecimal ?? null,
              oddsB: oddsB?.oddsDecimal ?? null,
              impliedProbA: oddsA?.impliedProbRaw ?? null,
              impliedProbB: oddsB?.impliedProbRaw ?? null,
            }
          : null,
      edge: latestEdge
        ? {
            marketName: latestEdge.marketEvent.market.name,
            observedAt: latestEdge.observedAt,
            teamAWinProb: latestEdge.teamAWinProb,
            marketProbA_raw: latestEdge.marketProbA_raw,
            marketProbA_fair: latestEdge.marketProbA_fair,
            overround: latestEdge.overround ?? null,
            edgeA: latestEdge.edgeA,
            stale,
            stalenessSeconds,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch market data", message },
      { status: 500 }
    );
  }
}
