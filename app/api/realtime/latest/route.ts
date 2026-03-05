import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const QuerySchema = z.object({
  matchId: z.string().min(1),
});

export async function GET(request: NextRequest) {
  try {
    const params = QuerySchema.parse({
      matchId: request.nextUrl.searchParams.get("matchId"),
    });

    const { matchId } = params;

    // Verify match exists
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, teamA: true, teamB: true },
    });

    if (!match) {
      return NextResponse.json(
        { error: "Match not found", matchId },
        { status: 404 }
      );
    }

    // Get latest ball prediction (v3-lgbm only)
    const latestPrediction = await prisma.ballPrediction.findFirst({
      where: {
        matchId,
        modelVersion: "v3-lgbm",
      },
      orderBy: { createdAt: "desc" },
      select: {
        matchId: true,
        innings: true,
        legalBallNumber: true,
        modelVersion: true,
        teamAWinProb: true,
        featuresJson: true,
        createdAt: true,
      },
    });

    if (!latestPrediction) {
      return NextResponse.json(
        {
          matchId,
          teamA: match.teamA,
          teamB: match.teamB,
          latestPrediction: null,
          latestBallEvent: null,
          message: "No predictions available yet for this match",
        },
        { status: 200 }
      );
    }

    // Get last ball event for context
    const latestBallEvent = await prisma.liveBallEvent.findFirst({
      where: {
        matchId,
        innings: latestPrediction.innings,
      },
      orderBy: { createdAt: "desc" },
      select: {
        matchId: true,
        innings: true,
        over: true,
        ballInOver: true,
        battingTeam: true,
        striker: true,
        nonStriker: true,
        bowler: true,
        runsBat: true,
        runsExtras: true,
        runsTotal: true,
        isWide: true,
        isNoBall: true,
        isLegal: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      matchId,
      teamA: match.teamA,
      teamB: match.teamB,
      latestPrediction: {
        innings: latestPrediction.innings,
        legalBallNumber: latestPrediction.legalBallNumber,
        teamAWinProb: latestPrediction.teamAWinProb,
        modelVersion: latestPrediction.modelVersion,
        features: latestPrediction.featuresJson,
        createdAt: latestPrediction.createdAt,
      },
      latestBallEvent: latestBallEvent
        ? {
            innings: latestBallEvent.innings,
            over: latestBallEvent.over,
            ballInOver: latestBallEvent.ballInOver,
            battingTeam: latestBallEvent.battingTeam,
            striker: latestBallEvent.striker,
            nonStriker: latestBallEvent.nonStriker,
            bowler: latestBallEvent.bowler,
            runs: {
              total: latestBallEvent.runsTotal,
              bat: latestBallEvent.runsBat,
              extras: latestBallEvent.runsExtras,
            },
            isLegal: latestBallEvent.isLegal,
            isWide: latestBallEvent.isWide,
            isNoBall: latestBallEvent.isNoBall,
            createdAt: latestBallEvent.createdAt,
          }
        : null,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid query parameters",
          issues: error.issues,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to fetch latest prediction",
        message: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
