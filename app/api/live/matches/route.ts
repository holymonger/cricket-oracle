/**
 * GET /api/live/matches
 *
 * Match list is cached 24h server-side — one CricAPI hit per day.
 * Browser may call this as often as needed; no extra API hits until cache expires.
 *
 * Query params:
 *   type=t20      — filter to T20 only (default: all live)
 *   all=true      — include recently ended matches
 *   force=true    — bust server cache, force fresh CricAPI hit (costs 1 hit)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentMatches, getLiveMatches, getLiveT20Matches,
  getCacheInfo, CACHE_KEY_MATCHES,
} from "@/lib/providers/cricapi/client";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const includeAll = searchParams.get("all") === "true";
  const force = searchParams.get("force") === "true";

  try {
    let matches;
    if (includeAll) {
      matches = await getCurrentMatches(force);
    } else if (type === "t20") {
      matches = await getLiveT20Matches(force);
    } else {
      matches = await getLiveMatches(force);
    }

    const cacheInfo = getCacheInfo(CACHE_KEY_MATCHES);

    const list = matches.map((m) => ({
      id: m.id,
      name: m.name,
      matchType: m.matchType,
      status: m.status,
      venue: m.venue,
      date: m.dateTimeGMT,
      teams: m.teams,
      teamInfo: m.teamInfo,
      score: m.score,
      matchStarted: m.matchStarted,
      matchEnded: m.matchEnded,
      series_id: m.series_id,
    }));

    return NextResponse.json({
      matches: list,
      count: list.length,
      fromCache: !force,
      cachedAt: cacheInfo ? new Date(cacheInfo.fetchedAt).toISOString() : null,
      cacheExpiresAt: cacheInfo ? new Date(cacheInfo.expiresAt).toISOString() : null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("live/matches error:", error);
    return NextResponse.json(
      { error: "Failed to fetch live matches", message: error?.message },
      { status: 500 }
    );
  }
}
