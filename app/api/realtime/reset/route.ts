/**
 * Reset API Endpoint
 * POST /api/realtime/reset (admin only)
 * Clears live data and resets provider cursors for replaying
 */

import { NextRequest, NextResponse } from "next/server";
import { assertAdminKey, UnauthorizedAdminKeyError } from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: NextRequest) {
  try {
    assertAdminKey(request);

    const body = await request.json();
    const { matchId } = body as { matchId: string };

    if (!matchId) {
      return NextResponse.json({ error: "matchId required" }, { status: 400 });
    }

    // Verify match exists
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true },
    });

    if (!match) {
      return NextResponse.json(
        { error: "match_not_found", matchId },
        { status: 404 }
      );
    }

    // Delete live data
    const [liveDeliveries, liveInnings, predictions, cursors] = await Promise.all([
      prisma.liveBallEvent.deleteMany({ where: { matchId } }),
      (prisma as any).liveInningsState.deleteMany({
        where: { matchId },
      }),
      prisma.ballPrediction.deleteMany({
        where: { matchId, modelVersion: "v3-lgbm" },
      }),
      prisma.liveProviderCursor.deleteMany({ where: { matchId } }),
    ]);

    return NextResponse.json({
      ok: true,
      matchId,
      deleted: {
        liveBallEvents: liveDeliveries.count,
        liveInningsStates: liveInnings.count,
        ballPredictions: predictions.count,
        providerCursors: cursors.count,
      },
    });
  } catch (error: any) {
    if (
      error instanceof UnauthorizedAdminKeyError ||
      error?.name === "UnauthorizedAdminKeyError"
    ) {
      return NextResponse.json(
        { error: "unauthorized_admin_key", message: error?.message },
        { status: 401 }
      );
    }

    console.error("Reset error:", error);
    return NextResponse.json(
      {
        error: "Failed to reset realtime data",
        message: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
