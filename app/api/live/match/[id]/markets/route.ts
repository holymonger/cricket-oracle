/**
 * GET /api/live/match/[id]/markets
 *
 * Automatically finds Polymarket markets that correspond to this CricAPI match.
 * Matches by team names (fuzzy word scoring) so no manual input needed.
 * Returns matched markets with live CLOB orderbook odds.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMatchInfo } from "@/lib/providers/cricapi/client";
import { searchCricketMarkets, getMarketOdds } from "@/lib/providers/polymarket/client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const match = await getMatchInfo(id);
    const [teamA, teamB] = match.teams;

    // Tokenise team names — e.g. "Mumbai Indians" → ["mumbai", "indians"]
    const tokenise = (name: string) =>
      name.toLowerCase().split(/[\s_\-]+/).filter((w) => w.length > 3);

    const teamAWords = tokenise(teamA);
    const teamBWords = tokenise(teamB);

    const allMarkets = await searchCricketMarkets("cricket");

    const scored = allMarkets
      .map((m) => {
        const text = `${m.question} ${m.description ?? ""}`.toLowerCase();
        let score = 0;

        // Full name match scores highest
        if (text.includes(teamA.toLowerCase())) score += 5;
        else teamAWords.forEach((w) => { if (text.includes(w)) score += 1; });

        if (text.includes(teamB.toLowerCase())) score += 5;
        else teamBWords.forEach((w) => { if (text.includes(w)) score += 1; });

        return { market: m, score };
      })
      .filter(({ score }) => score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(({ market }) => market);

    // Fetch live CLOB odds in parallel
    const markets = await Promise.all(
      scored.map(async (market) => {
        try {
          const odds = await getMarketOdds(market);
          return { ...market, odds };
        } catch {
          return { ...market, odds: null };
        }
      })
    );

    return NextResponse.json({
      matchId: id,
      teams: [teamA, teamB],
      markets,
      count: markets.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(`match/${id}/markets error:`, error);
    return NextResponse.json(
      { error: "Failed to fetch markets", message: error?.message },
      { status: 500 }
    );
  }
}
