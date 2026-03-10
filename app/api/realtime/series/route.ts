import { NextRequest, NextResponse } from "next/server";
import { assertAdminKey } from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  try {
    assertAdminKey(request);

    const { searchParams } = new URL(request.url);
    const matchId = searchParams.get("matchId");
    const modelVersion = searchParams.get("modelVersion") || "v3-lgbm";
    const limit = parseInt(searchParams.get("limit") ?? "240", 10);

    if (!matchId) {
      return NextResponse.json(
        { error: "matchId query parameter required" },
        { status: 400 }
      );
    }

    // Fetch last N predictions ordered by innings, legalBallNumber
    const predictions = await prisma.ballPrediction.findMany({
      where: { matchId, modelVersion },
      orderBy: [
        { innings: "asc" },
        { legalBallNumber: "asc" },
      ],
      select: {
        innings: true,
        legalBallNumber: true,
        teamAWinProb: true,
        createdAt: true,
      },
      take: limit,
    });

    // Reverse to get chronological order (oldest first)
    predictions.sort((a, b) => {
      if (a.innings !== b.innings) return a.innings - b.innings;
      return (a.legalBallNumber ?? 0) - (b.legalBallNumber ?? 0);
    });

    return NextResponse.json({
      ok: true,
      matchId,
      modelVersion,
      count: predictions.length,
      data: predictions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch prediction series", message },
      { status: 500 }
    );
  }
}
