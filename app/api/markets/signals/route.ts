/**
 * Edge Signals API Endpoint
 * GET /api/markets/signals
 * Returns recent edge signals from database
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminKey } from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/markets/signals
 * Load recent edge signals
 */
export async function GET(request: NextRequest) {
  // Admin auth
  const adminKey = request.headers.get("x-admin-key");
  if (!verifyAdminKey(adminKey)) {
    return NextResponse.json(
      { error: "Unauthorized - invalid admin key" },
      { status: 401 }
    );
  }

  try {
    // Get recent edge signals with related data
    const edgeSignals = await prisma.edgeSignal.findMany({
      take: 100,
      orderBy: { observedAt: "desc" },
      include: {
        match: {
          select: {
            id: true,
            teamA: true,
            teamB: true,
          },
        },
        marketEvent: {
          include: {
            market: {
              select: {
                name: true,
              },
            },
            oddsTicks: {
              where: {
                observedAt: {
                  // Get odds from same observation window
                  gte: new Date(Date.now() - 60000), // last minute
                },
              },
              orderBy: { observedAt: "desc" },
              take: 2,
            },
          },
        },
      },
    });

    // Transform to UI format
    const signals = edgeSignals.map((signal) => {
      const oddsA = signal.marketEvent.oddsTicks.find((t) => t.side === "A");
      const oddsB = signal.marketEvent.oddsTicks.find((t) => t.side === "B");

      // Check if stale (>10s difference between prediction and odds)
      const staleness = Math.abs(
        signal.observedAt.getTime() - signal.createdAt.getTime()
      ) / 1000;
      const isStale = staleness > 10;

      return {
        id: signal.id,
        matchId: signal.match.id,
        teamA: signal.match.teamA,
        teamB: signal.match.teamB,
        market: signal.marketEvent.market.name,
        observedAt: signal.observedAt.toISOString(),
        oddsA: oddsA?.oddsDecimal || 0,
        oddsB: oddsB?.oddsDecimal || 0,
        marketProbA: signal.marketProbA_fair,
        teamAWinProb: signal.teamAWinProb,
        edgeA: signal.edgeA,
        overround: signal.overround,
        notes: signal.notes,
        isStale,
      };
    });

    return NextResponse.json({
      success: true,
      signals,
      count: signals.length,
    });
  } catch (error: any) {
    console.error("Failed to load signals:", error);
    return NextResponse.json(
      {
        error: "Failed to load signals",
        message: error.message,
      },
      { status: 500 }
    );
  }
}
