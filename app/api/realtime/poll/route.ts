/**
 * Real-time polling endpoint
 * Fetches new events from provider and processes them
 * POST /api/realtime/poll
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminKey } from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { getProvider } from "@/lib/providers";
import { safeValidateDeliveryEvent } from "@/lib/live/schema";
import { computeWinProb } from "@/lib/model";
import type { MatchState } from "@/lib/model/types";
import type { CanonicalDeliveryEvent } from "@/lib/live/types";

const PollRequestSchema = z.object({
  matchId: z.string().min(1),
  provider: z.string().min(1).default("cricsheet-replay"),
  limit: z.number().int().positive().max(50).optional().default(1),
});

/**
 * POST /api/realtime/poll
 * Polls provider for new events and processes them
 */
export async function POST(request: NextRequest) {
  // Admin auth
  const adminKey = request.headers.get("x-admin-key");
  if (!verifyAdminKey(adminKey)) {
    return NextResponse.json(
      { error: "Unauthorized - invalid admin key" },
      { status: 401 }
    );
  }

  try {
    // Parse request body
    const body = await request.json();
    const { matchId, provider: providerName, limit } = PollRequestSchema.parse(body);

    // Verify match exists
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        teamA: true,
        teamB: true,
        winnerTeam: true,
      },
    });

    if (!match) {
      return NextResponse.json(
        { error: "Match not found", matchId },
        { status: 404 }
      );
    }

    // Get provider
    const provider = getProvider(providerName);

    // Load or create cursor
    let liveCursor = await prisma.liveCursor.findUnique({
      where: { matchId },
    });

    if (!liveCursor) {
      liveCursor = await prisma.liveCursor.create({
        data: {
          matchId,
          provider: providerName,
          cursor: null,
        },
      });
    }

    // Fetch new events from provider
    const { events, nextCursor } = await provider.fetchNewEvents({
      matchId,
      cursor: liveCursor.cursor || undefined,
      limit,
    });

    console.log(`📡 Fetched ${events.length} events from ${providerName}`);

    // Process each event
    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const event of events) {
      try {
        // Validate event
        const validation = safeValidateDeliveryEvent(event);
        if (!validation.success) {
          errors.push(
            `Validation failed for event ${event.providerEventId}: ${validation.error.message}`
          );
          skipped++;
          continue;
        }

        // Store in LiveBallEvent (upsert for idempotency)
        await prisma.liveBallEvent.upsert({
          where: {
            provider_providerEventId: {
              provider: event.provider,
              providerEventId: event.providerEventId,
            },
          },
          create: {
            matchId: event.matchId,
            provider: event.provider,
            providerEventId: event.providerEventId,
            innings: event.innings,
            over: event.over,
            ballInOver: event.ballInOver,
            battingTeam: event.battingTeam,
            striker: event.striker,
            nonStriker: event.nonStriker,
            bowler: event.bowler,
            runsBat: event.runsBat,
            runsExtras: event.runsExtras,
            runsTotal: event.runsTotal,
            extrasJson: event.extras || Prisma.JsonNull,
            wicketsJson: event.wickets || Prisma.JsonNull,
            isWide: event.isWide,
            isNoBall: event.isNoBall,
            isLegal: event.isLegal,
            occurredAt: event.occurredAt ? new Date(event.occurredAt) : null,
          },
          update: {
            // Update in case event was re-fetched (idempotency)
            runsBat: event.runsBat,
            runsExtras: event.runsExtras,
            runsTotal: event.runsTotal,
            extrasJson: event.extras || Prisma.JsonNull,
            wicketsJson: event.wickets || Prisma.JsonNull,
            isWide: event.isWide,
            isNoBall: event.isNoBall,
            isLegal: event.isLegal,
          },
        });

        // Process legal deliveries: compute state + prediction
        if (event.isLegal) {
          await processLegalDelivery(event, match);
        }

        processed++;
      } catch (err: any) {
        errors.push(
          `Failed to process event ${event.providerEventId}: ${err.message}`
        );
        skipped++;
      }
    }

    // Update cursor
    if (nextCursor !== undefined) {
      await prisma.liveCursor.update({
        where: { matchId },
        data: { cursor: nextCursor },
      });
    }

    console.log(
      `✓ Processed ${processed}/${events.length} events (skipped: ${skipped})`
    );

    return NextResponse.json({
      success: true,
      matchId,
      provider: providerName,
      fetched: events.length,
      processed,
      skipped,
      nextCursor,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error("Poll error:", error);
    return NextResponse.json(
      {
        error: "Failed to poll events",
        message: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * Process a legal delivery: compute match state and prediction
 */
async function processLegalDelivery(
  event: CanonicalDeliveryEvent,
  match: { id: string; teamA: string; teamB: string; winnerTeam: string | null }
) {
  // Compute cumulative state after this ball
  // We need to count all previous legal balls in this innings
  const previousLegalBalls = await prisma.liveBallEvent.count({
    where: {
      matchId: event.matchId,
      innings: event.innings,
      isLegal: true,
      OR: [
        { over: { lt: event.over } },
        {
          AND: [{ over: event.over }, { ballInOver: { lt: event.ballInOver } }],
        },
      ],
    },
  });

  const legalBallNumber = previousLegalBalls + 1;

  // Compute cumulative runs and wickets
  const cumulativeStats = await prisma.liveBallEvent.aggregate({
    where: {
      matchId: event.matchId,
      innings: event.innings,
      isLegal: true,
      OR: [
        { over: { lt: event.over } },
        {
          AND: [{ over: event.over }, { ballInOver: { lte: event.ballInOver } }],
        },
      ],
    },
    _sum: {
      runsTotal: true,
    },
  });

  const runs = cumulativeStats._sum.runsTotal || 0;

  // Count wickets
  const wicketsCount = await prisma.liveBallEvent.count({
    where: {
      matchId: event.matchId,
      innings: event.innings,
      isLegal: true,
      wicketsJson: { not: Prisma.JsonNull },
      OR: [
        { over: { lt: event.over } },
        {
          AND: [{ over: event.over }, { ballInOver: { lte: event.ballInOver } }],
        },
      ],
    },
  });

  // Build match state
  const balls = legalBallNumber;
  const wickets = wicketsCount;

  // Get target if innings 2
  let target: number | undefined = undefined;
  if (event.innings === 2) {
    const innings1Stats = await prisma.liveBallEvent.aggregate({
      where: {
        matchId: event.matchId,
        innings: 1,
        isLegal: true,
      },
      _sum: { runsTotal: true },
    });
    target = (innings1Stats._sum.runsTotal || 0) + 1;
  }

  const matchState: MatchState = {
    innings: event.innings,
    battingTeam: event.battingTeam,
    runs,
    wickets,
    balls,
    targetRuns: target || null,
  };

  // Compute win probability (using default model v1)
  const winProbResult = computeWinProb(matchState, "v1");

  // Store or update MatchStateSnapshot
  const snapshotId = `${event.matchId}:${event.innings}:${legalBallNumber}`;
  const snapshot = await prisma.matchStateSnapshot.upsert({
    where: { id: snapshotId },
    create: {
      id: snapshotId,
      matchId: event.matchId,
      innings: event.innings,
      runs,
      wickets,
      balls,
      targetRuns: target || null,
    },
    update: {
      runs,
      wickets,
      balls,
      targetRuns: target || null,
    },
  });

  // Store prediction
  await prisma.prediction.upsert({
    where: {
      snapshotId_modelVersion: {
        snapshotId: snapshot.id,
        modelVersion: "v1",
      },
    },
    create: {
      snapshotId: snapshot.id,
      modelVersion: "v1",
      winProb: winProbResult.winProb,
    },
    update: {
      winProb: winProbResult.winProb,
    },
  });

  console.log(
    `  ⚡ Ball ${event.innings}.${legalBallNumber}: ${runs}/${wickets} → ${(winProbResult.winProb * 100).toFixed(1)}%`
  );
}
