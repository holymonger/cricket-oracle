/**
 * POST /api/reports/pre-match
 * Generate an AI pre-match analysis report using Claude.
 *
 * Body: { teamA, teamB, venue?, stats }
 * Returns: { report, modelProbA, keyFactors, generatedAt }
 */

import { NextRequest, NextResponse } from "next/server";
import { generatePreMatchReport } from "@/lib/reports/generateReport";
import type { PreMatchStats } from "@/lib/cricket/preMatchStats";

export async function POST(request: NextRequest) {
  let body: { teamA: string; teamB: string; venue?: string; stats: PreMatchStats };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { teamA, teamB, venue, stats } = body;

  if (!teamA || !teamB || !stats) {
    return NextResponse.json(
      { error: "teamA, teamB, and stats are required" },
      { status: 400 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured on server" },
      { status: 503 }
    );
  }

  try {
    const result = await generatePreMatchReport(teamA, teamB, venue, stats);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Report generation error:", error);
    return NextResponse.json(
      { error: "Report generation failed", message: error?.message },
      { status: 500 }
    );
  }
}
