import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { verifyAdminKey } from "@/lib/auth/adminKey";
import { buildStatesFromBallEvents } from "@/lib/cricket/stateFromBalls";
import { predictWinProbTimeline } from "@/lib/cricket/predictTimeline";

const prisma = new PrismaClient();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  // Verify admin key
  const adminKey = request.headers.get("x-admin-key");
  if (!verifyAdminKey(adminKey)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { matchId } = await params;
  const modelVersion = request.nextUrl.searchParams.get("modelVersion") || "v1";
  const isBatchModel = modelVersion === "v3-lgbm";

  try {
    // Fetch match
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        teamA: true,
        teamB: true,
        source: true,
        sourceMatchId: true,
        matchDate: true,
        venue: true,
        city: true,
        winnerTeam: true,
      },
    });

    if (!match) {
      return NextResponse.json(
        { error: "Match not found" },
        { status: 404 }
      );
    }

    // If batch model (v3-lgbm), check for pre-computed predictions
    if (isBatchModel) {
      const predictions = await prisma.ballPrediction.findMany({
        where: { matchId, modelVersion },
        orderBy: [{ innings: "asc" }, { legalBallNumber: "asc" }],
      });

      if (predictions.length === 0) {
        return NextResponse.json(
          {
            error: "Predictions not found",
            message: `No ${modelVersion} predictions found for this match. Run: npm run predict:match -- ${match.sourceMatchId}`,
            modelVersion,
            matchId,
          },
          { status: 404 }
        );
      }

      // Fetch ball events for reference
      const ballEvents = await prisma.ballEvent.findMany({
        where: { matchId },
        orderBy: [
          { innings: "asc" },
          { over: "asc" },
          { ballInOver: "asc" },
        ],
        select: {
          id: true,
          matchId: true,
          innings: true,
          over: true,
          ballInOver: true,
          legalBallNumber: true,
          battingTeam: true,
          runsBat: true,
          runsExtras: true,
          runsTotal: true,
          isWide: true,
          isNoBall: true,
          isWicket: true,
        },
      });

      // Build state items for context (runs/wickets/balls)
      const ballStateItems = buildStatesFromBallEvents(
        {
          id: match.id,
          teamA: match.teamA,
          teamB: match.teamB,
          winnerTeam: match.winnerTeam || undefined,
        },
        ballEvents as any
      );

      // Map predictions to timeline points
      const timeline = predictions.map((pred) => {
        const stateItem = ballStateItems.find(
          (s) =>
            s.stateAfterEvent.innings === pred.innings &&
            s.stateAfterEvent.legalBallNumber === pred.legalBallNumber
        );

        const state = stateItem?.stateAfterEvent;

        return {
          over: state?.over ?? 0,
          ball: state?.ballInOver ?? 0,
          legalBallNumber: pred.legalBallNumber,
          innings: pred.innings,
          teamAWinProb: pred.teamAWinProb,
          runs: state?.runs ?? 0,
          wickets: state?.wickets ?? 0,
          balls: state?.balls ?? 0,
          isFour: (state?.runsThisBall ?? 0) === 4,
          isSix: (state?.runsThisBall ?? 0) === 6,
          isWicket: state?.isWicket ?? false,
          isWide: state?.isWide ?? false,
          isNoBall: state?.isNoBall ?? false,
          ballOutcome: state?.runsThisBall ?? 0,
        };
      });

      const summary = {
        match: match.id,
        modelVersion,
        ballCount: timeline.length,
        inningsCount: Math.max(...timeline.map((p) => p.innings), 1),
        finalWinProb: timeline[timeline.length - 1]?.teamAWinProb ?? 0.5,
      };

      return NextResponse.json({
        match: {
          ...match,
          ballCount: ballEvents.length,
        },
        timeline,
        summary,
      });
    }

    // For v0/v1: Compute on-the-fly (existing behavior)
    // Fetch ball events for this match, sorted
    const ballEvents = await prisma.ballEvent.findMany({
      where: { matchId },
      orderBy: [
        { innings: "asc" },
        { over: "asc" },
        { ballInOver: "asc" },
      ],
      select: {
        id: true,
        matchId: true,
        innings: true,
        over: true,
        ballInOver: true,
        legalBallNumber: true,
        battingTeam: true,
        runsBat: true,
        runsExtras: true,
        runsTotal: true,
        isWide: true,
        isNoBall: true,
        isWicket: true,
      },
    });

    // Build derived states
    const ballStateItems = buildStatesFromBallEvents(
      {
        id: match.id,
        teamA: match.teamA,
        teamB: match.teamB,
        winnerTeam: match.winnerTeam || undefined,
      },
      ballEvents as any
    );

    // Compute win probability timeline
    const timelineResult = await predictWinProbTimeline(
      {
        id: match.id,
        teamA: match.teamA,
        teamB: match.teamB,
        winnerTeam: match.winnerTeam || undefined,
      },
      ballStateItems,
      modelVersion
    );

    return NextResponse.json({
      match: {
        ...match,
        ballCount: ballEvents.length,
      },
      timeline: timelineResult.timeline,
      summary: timelineResult.summary,
    });
  } catch (error) {
    console.error("Error fetching timeline:", error);
    return NextResponse.json(
      { error: "Failed to fetch timeline" },
      { status: 500 }
    );
  }
}
