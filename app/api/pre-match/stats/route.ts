/**
 * GET /api/pre-match/stats?teamA=Mumbai+Indians&teamB=Chennai+Super+Kings&venue=Wankhede
 * Returns H2H records, team form, venue stats and a pre-match win probability.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPreMatchStats } from "@/lib/cricket/preMatchStats";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const teamA = searchParams.get("teamA");
  const teamB = searchParams.get("teamB");
  const venue = searchParams.get("venue") ?? undefined;

  if (!teamA || !teamB) {
    return NextResponse.json(
      { error: "teamA and teamB query params are required" },
      { status: 400 }
    );
  }

  try {
    const stats = await getPreMatchStats(teamA, teamB, venue);
    return NextResponse.json(stats);
  } catch (error: any) {
    console.error("Pre-match stats error:", error);
    return NextResponse.json(
      { error: "Failed to compute pre-match stats", message: error?.message },
      { status: 500 }
    );
  }
}
