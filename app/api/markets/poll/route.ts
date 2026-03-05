/**
 * Market Polling API Endpoint
 * POST /api/markets/poll
 * Accept odds snapshots and persist to database with edge signals
 */

import { NextRequest, NextResponse } from "next/server";
import {
  assertAdminKey,
  UnauthorizedAdminKeyError,
} from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";
import { safeValidateOddsPoll } from "@/lib/live/oddsSchema";
import { fairProbAFromTwoSidedDecimal } from "@/lib/markets/decimal";
import {
  persistOddsTicks,
  upsertEdgeSignal,
  type PersistOddsResult,
} from "@/lib/markets/persistence";

/**
 * POST /api/markets/poll
 * Persist odds and compute edge signals
 */
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
        id: true,
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

    const results: Array<{
      marketName: string;
      marketEventId: string;
      ticksUpserted: number;
      edgeSignal?: {
        edgeA: number;
        teamAWinProb: number;
        marketProbA_fair: number;
        overround: number;
      };
      warning?: string;
    }> = [];

    // Process each market snapshot
    for (const mkt of input.markets) {
      let persistResult: PersistOddsResult;

      try {
        persistResult = await persistOddsTicks(match, mkt);
      } catch (error: any) {
        return NextResponse.json(
          {
            error: "team_mapping_failed",
            message: error.message,
            market: mkt.marketName,
            selections: mkt.selections.map((s) => s.teamName),
            matchTeamA: match.teamA,
            matchTeamB: match.teamB,
          },
          { status: 422 }
        );
      }

      const result: (typeof results)[0] = {
        marketName: mkt.marketName,
        marketEventId: persistResult.marketEventId,
        ticksUpserted: persistResult.ticksUpserted,
      };

      // If both sides present, compute edge signal
      if (persistResult.oddsA && persistResult.oddsB) {
        const fair = fairProbAFromTwoSidedDecimal(
          persistResult.oddsA,
          persistResult.oddsB
        );
        const observedAt = new Date(mkt.observedAt);
        const teamAWinProb = latestPred.teamAWinProb;
        const marketProbA_fair = fair.pA_fair;
        const edgeA = teamAWinProb - marketProbA_fair;

        // Check staleness
        const staleness =
          Math.abs(observedAt.getTime() - latestPred.createdAt.getTime()) /
          1000;
        let notes: string | undefined;
        if (staleness > 10) {
          notes = `stale prediction (${staleness.toFixed(0)}s old)`;
        }

        // Persist EdgeSignal
        await upsertEdgeSignal({
          matchId: match.id,
          marketEventId: persistResult.marketEventId,
          modelVersion,
          observedAt,
          predictionId: latestPred.id,
          teamAWinProb,
          marketProbA_raw: fair.pA_raw,
          marketProbA_fair: fair.pA_fair,
          overround: fair.overround,
          edgeA,
          notes,
        });

        result.edgeSignal = {
          edgeA,
          teamAWinProb,
          marketProbA_fair,
          overround: fair.overround,
        };
      } else {
        result.warning = "only one side provided, edge signal not computed";
      }

      results.push(result);
    }

    return NextResponse.json({
      ok: true,
      matchId: input.matchId,
      model: {
        modelVersion,
        innings: latestPred.innings,
        legalBallNumber: latestPred.legalBallNumber,
        teamAWinProb: latestPred.teamAWinProb,
        predictionTime: latestPred.createdAt,
      },
      results,
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
        error: "Failed to process markets poll",
        message: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
