/**
 * GET /api/pre-match/teams
 * Returns all distinct team names and venues from the DB.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  try {
    const [teamARows, teamBRows, venueRows] = await Promise.all([
      prisma.match.findMany({
        where: { source: "cricsheet", teamAName: { not: null } },
        select: { teamAName: true },
        distinct: ["teamAName"],
      }),
      prisma.match.findMany({
        where: { source: "cricsheet", teamBName: { not: null } },
        select: { teamBName: true },
        distinct: ["teamBName"],
      }),
      prisma.match.findMany({
        where: { source: "cricsheet", venue: { not: null } },
        select: { venue: true },
        distinct: ["venue"],
      }),
    ]);

    const teamSet = new Set<string>();
    for (const r of teamARows) if (r.teamAName) teamSet.add(r.teamAName);
    for (const r of teamBRows) if (r.teamBName) teamSet.add(r.teamBName);

    const teams = Array.from(teamSet).sort();
    const venues = venueRows
      .map((r) => r.venue!)
      .filter(Boolean)
      .sort();

    return NextResponse.json({ teams, venues });
  } catch (error: any) {
    console.error("Teams fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch teams", message: error?.message },
      { status: 500 }
    );
  }
}
