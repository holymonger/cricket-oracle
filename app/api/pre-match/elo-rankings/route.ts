/**
 * GET /api/pre-match/elo-rankings?limit=20&minMatches=10&type=international|ipl
 *
 * Returns teams ranked by current Elo rating.
 * Elo is computed from all Cricsheet-imported T20 matches (IPL + T20I combined).
 * Results cached 10 minutes server-side.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTopTeams, getEloRatings, ACTIVE_IPL_TEAMS, DEFUNCT_IPL_TEAMS } from "@/lib/cricket/eloRatings";

function isIPLTeam(name: string): boolean {
  return ACTIVE_IPL_TEAMS.has(name) || DEFUNCT_IPL_TEAMS.has(name);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit      = Math.min(50, parseInt(searchParams.get("limit")      ?? "20", 10));
  const minMatches = parseInt(searchParams.get("minMatches") ?? "10", 10);
  const type       = searchParams.get("type"); // "international" | "ipl" | null (all)

  try {
    const ratings = await getEloRatings();
    // Always exclude defunct unless caller explicitly asks for all
    const includeDefunct = searchParams.get("includeDefunct") === "true";
    let teams = [...ratings.values()]
      .filter((r) => r.matchCount >= minMatches)
      .filter((r) => includeDefunct || !DEFUNCT_IPL_TEAMS.has(r.team));

    if (type === "ipl") {
      // Active IPL franchises only
      teams = teams.filter((r) => ACTIVE_IPL_TEAMS.has(r.team));
    } else if (type === "international") {
      teams = teams.filter((r) => !isIPLTeam(r.team));
    }

    teams = teams.sort((a, b) => b.elo - a.elo).slice(0, limit);

    return NextResponse.json({
      rankings: teams.map((r, i) => ({
        rank: i + 1,
        team: r.team,
        elo: Math.round(r.elo),
        matchCount: r.matchCount,
        wins: r.wins,
        losses: r.losses,
        winPct: Math.round(r.winPct * 1000) / 10, // one decimal
      })),
      totalTeams: ratings.size,
      type: type ?? "all",
      computedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("elo-rankings error:", error);
    return NextResponse.json(
      { error: "Failed to compute Elo rankings", message: error?.message },
      { status: 500 }
    );
  }
}
