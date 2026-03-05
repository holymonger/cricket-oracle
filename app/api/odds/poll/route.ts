import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  assertAdminKey,
  UnauthorizedAdminKeyError,
} from "@/lib/auth/adminKey";
import { safeValidateOddsPoll } from "@/lib/live/oddsSchema";
import { mapTeamNameToSide } from "@/lib/teams/mapToSide";
import { fairProbAFromTwoSidedDecimal } from "@/lib/markets/decimal";

export async function POST(request: NextRequest) {
  try {
    assertAdminKey(request);

    const body = await request.json();
    const parseResult = safeValidateOddsPoll(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "invalid_payload",
          issues: parseResult.error.issues,
        },
        { status: 422 }
      );
    }

    const input = parseResult.data;

    // Verify match exists
    const match = await prisma.match.findUnique({
      where: { id: input.matchId },
      select: { id: true, teamA: true, teamB: true },
    });

    if (!match) {
      return NextResponse.json(
        { error: "match_not_found", matchId: input.matchId },
        { status: 404 }
      );
    }

    // Get latest v3-lgbm prediction for this match
    const modelVersion = "v3-lgbm";
    const latestPred = await prisma.ballPrediction.findFirst({
      where: { matchId: input.matchId, modelVersion },
      orderBy: [
        { innings: "desc" },
        { legalBallNumber: "desc" },
        { createdAt: "desc" },
      ],
      select: {
        innings: true,
        legalBallNumber: true,
        teamAWinProb: true,
        createdAt: true,
      },
    });

    if (!latestPred) {
      return NextResponse.json(
        {
          error: "no_ballprediction_for_match",
          matchId: input.matchId,
          modelVersion,
        },
        { status: 404 }
      );
    }

    // Process first market snapshot
    const mkt = input.markets[0];

    let oddsA: number | null = null;
    let oddsB: number | null = null;

    for (const sel of mkt.selections) {
      const side = mapTeamNameToSide(match, sel.teamName);
      if (side === "A") oddsA = sel.oddsDecimal;
      if (side === "B") oddsB = sel.oddsDecimal;
    }

    if (!oddsA || !oddsB) {
      return NextResponse.json(
        {
          error: "missing_two_sided_odds",
          details: {
            oddsA,
            oddsB,
            selections: mkt.selections,
            matchTeamA: match.teamA,
            matchTeamB: match.teamB,
          },
        },
        { status: 422 }
      );
    }

    // Compute fair probability and edge
    const fair = fairProbAFromTwoSidedDecimal(oddsA, oddsB);
    const teamAWinProb = latestPred.teamAWinProb;
    const marketProbA = fair.pA_fair;
    const edgeA = teamAWinProb - marketProbA;

    // Optional: store EdgeSignal for later analysis
    // await prisma.edgeSignal.create({
    //   data: {
    //     matchId: input.matchId,
    //     marketName: mkt.marketName,
    //     externalEventId: mkt.externalEventId,
    //     modelVersion,
    //     teamAWinProb,
    //     marketProbA: marketProbA,
    //     edgeA,
    //     observedAt: new Date(mkt.observedAt),
    //   }
    // })

    return NextResponse.json({
      ok: true,
      matchId: input.matchId,
      market: {
        marketName: mkt.marketName,
        externalEventId: mkt.externalEventId,
        observedAt: mkt.observedAt,
        oddsA,
        oddsB,
      },
      model: {
        modelVersion,
        innings: latestPred.innings,
        legalBallNumber: latestPred.legalBallNumber,
        teamAWinProb,
        createdAt: latestPred.createdAt,
      },
      marketProbA_raw: fair.pA_raw,
      marketProbA_fair: fair.pA_fair,
      overround: fair.overround,
      edgeA,
      isSignificantEdge: Math.abs(edgeA) > 0.05, // Flag edges > 5%
    });
  } catch (error: any) {
    if (
      error instanceof UnauthorizedAdminKeyError ||
      error?.name === "UnauthorizedAdminKeyError"
    ) {
      return NextResponse.json(
        { error: "unauthorized_admin_key", message: error?.message },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to process odds poll",
        message: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
