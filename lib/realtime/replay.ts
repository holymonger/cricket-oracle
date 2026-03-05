/**
 * Helpers for cricsheet replay processing
 */

import { prisma } from "@/lib/db/prisma";

/**
 * Get next BallEvent after the latest processed for a match/innings
 */
export async function getNextBallForReplay(matchId: string, innings: number) {
  // Get the last processed legal ball number
  const lastPrediction = await prisma.ballPrediction.findFirst({
    where: { matchId, innings },
    orderBy: { legalBallNumber: "desc" },
    select: { legalBallNumber: true },
  });

  const lastLegalBallNumber = lastPrediction?.legalBallNumber ?? 0;

  // Get next legal ball event (legalBallNumber is not null)
  const nextBall = await prisma.ballEvent.findFirst({
    where: {
      matchId,
      innings,
      legalBallNumber: {
        not: null,
        gt: lastLegalBallNumber,
      },
    },
    orderBy: {
      legalBallNumber: "asc",
    },
  });

  return nextBall;
}

/**
 * Convert BallEvent to LiveDelivery payload
 */
export async function ballEventToLiveDelivery(ballEvent: any) {
  // Fetch player and match data if needed for team names
  const match = await prisma.match.findUnique({
    where: { id: ballEvent.matchId },
  });

  if (!match) {
    throw new Error(`Match not found: ${ballEvent.matchId}`);
  }

  const teamName =
    ballEvent.battingTeam === "A" ? match.teamA : match.teamB;

  return {
    matchId: ballEvent.matchId,
    innings: ballEvent.innings,
    over: ballEvent.over,
    ballInOver: ballEvent.ballInOver,
    battingTeamName: teamName,
    strikerName: ballEvent.striker, // These are player names in the schema
    nonStrikerName: ballEvent.nonStriker,
    bowlerName: ballEvent.bowler,
    runs: {
      total: ballEvent.runsTotal,
      bat: ballEvent.runsBat,
      extras: ballEvent.runsExtras,
    },
    provider: "cricsheet-replay",
    providerEventId: `${ballEvent.matchId}-${ballEvent.innings}-${ballEvent.over}-${ballEvent.ballInOver}`,
    occurredAt: new Date().toISOString(),
  };
}

/**
 * Update LiveCursor after processing
 */
export async function updateLiveCursor(
  matchId: string,
  provider: string,
  cursor: string
) {
  return await prisma.liveCursor.upsert({
    where: { matchId },
    create: { matchId, provider, cursor },
    update: { provider, cursor, updatedAt: new Date() },
  });
}
