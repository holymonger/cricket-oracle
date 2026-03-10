/**
 * GET /api/oddsapi/cricket
 *
 * Returns upcoming + live cricket events with Rollbit ML odds.
 * Events with no Rollbit market are included (homeOdds/awayOdds = null).
 *
 * Query params:
 *   activeOnly=true  — only return events where Rollbit has odds
 *   limit=N          — max events to scan (default 20)
 */

import { NextRequest, NextResponse } from "next/server";
import { getRollbitCricketEvents, getRollbitActiveCricketMarkets } from "@/lib/providers/oddsapi/client";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const activeOnly = searchParams.get("activeOnly") === "true";
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 50);

  try {
    const events = activeOnly
      ? await getRollbitActiveCricketMarkets()
      : await getRollbitCricketEvents(limit);

    return NextResponse.json({
      events,
      count: events.length,
      activeMarkets: events.filter((e) => e.homeOdds !== null).length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("odds-api.io cricket route error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Rollbit cricket odds", message: error?.message },
      { status: 500 }
    );
  }
}
