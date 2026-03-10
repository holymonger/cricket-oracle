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
    const { searchParams } = new URL(request.url);
    const matchIdFilter = searchParams.get("matchId") ?? undefined;
    const limit = Math.min(200, parseInt(searchParams.get("limit") ?? "100", 10));

    // Get recent edge signals with related data
    const edgeSignals = await prisma.edgeSignal.findMany({
      where: matchIdFilter ? { matchId: matchIdFilter } : undefined,
      take: limit,
      orderBy: { observedAt: "desc" },
      include: {
        match: { select: { id: true, teamA: true, teamB: true } },
        marketEvent: {
          include: {
            market: { select: { name: true } },
            // Get the two most recent ticks (one per side) for display
            oddsTicks: { orderBy: { observedAt: "desc" }, take: 4 },
          },
        },
      },
    });

    // Transform to UI format
    const signals = edgeSignals.map((signal) => {
      // Find best (most recent) odds per side
      const oddsA = signal.marketEvent.oddsTicks.find((t) => t.side === "A");
      const oddsB = signal.marketEvent.oddsTicks.find((t) => t.side === "B");

      return {
        id: signal.id,
        matchId: signal.match.id,
        teamA: signal.match.teamA,
        teamB: signal.match.teamB,
        market: signal.marketEvent.market.name,
        observedAt: signal.observedAt.toISOString(),
        oddsA: oddsA?.oddsDecimal ?? 0,
        oddsB: oddsB?.oddsDecimal ?? 0,
        marketProbA: signal.marketProbA_fair,
        marketProbA_raw: signal.marketProbA_raw,
        teamAWinProb: signal.teamAWinProb,
        edgeA: signal.edgeA,
        overround: signal.overround,
        isStale: signal.isStale,
        stalenessSeconds: signal.stalenessSeconds,
        notes: signal.notes,
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
