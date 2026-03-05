/**
 * Market Polling API Endpoint
 * POST /api/markets/poll
 * Fetches odds from aggregator and computes edge signals
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminKey } from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";
import { oddsAggregatorClient } from "@/lib/providers/oddsAggregator/client";
import { processAggregatorPayload } from "@/lib/providers/oddsAggregator/adapter";

const PollRequestSchema = z.object({
  matchId: z.string().min(1),
});

/**
 * POST /api/markets/poll
 * Fetch odds and compute edge signals
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
    const { matchId } = PollRequestSchema.parse(body);

    // Load match
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        teamA: true,
        teamB: true,
      },
    });

    if (!match) {
      return NextResponse.json(
        { error: "Match not found", matchId },
        { status: 404 }
      );
    }

    // Fetch odds from aggregator
    let aggregatorPayload;
    try {
      aggregatorPayload = await oddsAggregatorClient.fetchOddsForMatch(match);
    } catch (error: any) {
      return NextResponse.json(
        {
          error: "Failed to fetch odds from aggregator",
          message: error.message,
          matchId,
        },
        { status: 503 }
      );
    }

    // Process payload
    const adapterResult = processAggregatorPayload(aggregatorPayload, match);

    if (adapterResult.errors.length > 0) {
      console.warn("Adapter errors:", adapterResult.errors);
    }

    if (adapterResult.events.length === 0) {
      return NextResponse.json(
        {
          error: "No valid market events after processing",
          matchId,
          errors: adapterResult.errors,
        },
        { status: 422 }
      );
    }

    // Get latest prediction for this match (prefer v3-lgbm)
    const latestPrediction = await prisma.prediction.findFirst({
      where: {
        snapshot: {
          matchId,
        },
      },
      orderBy: { createdAt: "desc" },
      include: {
        snapshot: true,
      },
    });

    if (!latestPrediction) {
      return NextResponse.json(
        {
          error: "No predictions found for match",
          message:
            "Run predictions first (e.g., npm run predict:match -- <sourceMatchId>)",
          matchId,
        },
        { status: 404 }
      );
    }

    const teamAWinProb = latestPrediction.winProb;
    const modelVersion = latestPrediction.modelVersion;
    const predictionTime = latestPrediction.createdAt;

    // Process each market event
    const edgeSignals: Array<{
      market: string;
      teamAWinProb: number;
      marketProbA: number;
      edgeA: number;
      overround: number;
      observedAt: string;
    }> = [];

    for (const event of adapterResult.events) {
      // Upsert Market
      const market = await prisma.market.upsert({
        where: { name: event.marketName },
        create: { name: event.marketName },
        update: {},
      });

      // Upsert MarketEvent
      const marketEvent = await prisma.marketEvent.upsert({
        where: {
          marketId_externalEventId: {
            marketId: market.id,
            externalEventId: event.externalEventId,
          },
        },
        create: {
          matchId: match.id,
          marketId: market.id,
          externalEventId: event.externalEventId,
          selectionTeamAName: event.selectionTeamAName,
          selectionTeamBName: event.selectionTeamBName,
          status: "open",
        },
        update: {
          selectionTeamAName: event.selectionTeamAName,
          selectionTeamBName: event.selectionTeamBName,
          status: "open",
        },
      });

      // Insert OddsTicks
      for (const tick of event.oddsTicks) {
        await prisma.oddsTick.create({
          data: {
            marketEventId: marketEvent.id,
            observedAt: event.observedAt,
            side: tick.side,
            oddsDecimal: tick.oddsDecimal,
            impliedProbRaw: tick.impliedProbRaw,
            sourceJson: tick.sourceJson || null,
          },
        });
      }

      // Compute edge
      const marketProbA = event.fairProbA;
      const edgeA = teamAWinProb - marketProbA;

      // Check staleness
      const staleness = Math.abs(
        event.observedAt.getTime() - predictionTime.getTime()
      ) / 1000;
      let notes = event.notes || "";
      if (staleness > 10) {
        notes += (notes ? "; " : "") + `stale prediction (${staleness.toFixed(0)}s old)`;
      }

      // Store EdgeSignal
      await prisma.edgeSignal.create({
        data: {
          matchId: match.id,
          marketEventId: marketEvent.id,
          modelVersion,
          observedAt: event.observedAt,
          teamAWinProb,
          marketProbA,
          edgeA,
          overround: event.overround,
          notes: notes || null,
        },
      });

      edgeSignals.push({
        market: event.marketName,
        teamAWinProb,
        marketProbA,
        edgeA,
        overround: event.overround,
        observedAt: event.observedAt.toISOString(),
      });
    }

    console.log(`✓ Processed ${edgeSignals.length} edge signals for match ${matchId}`);

    return NextResponse.json({
      success: true,
      matchId,
      edgeSignals,
      errors: adapterResult.errors.length > 0 ? adapterResult.errors : undefined,
    });
  } catch (error: any) {
    console.error("Market poll error:", error);
    return NextResponse.json(
      {
        error: "Failed to poll markets",
        message: error.message,
      },
      { status: 500 }
    );
  }
}
