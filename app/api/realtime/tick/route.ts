/**
 * Realtime Tick API Endpoint
 * POST /api/realtime/tick
 * Unified endpoint for delivery updates + odds polling
 */

import { NextRequest, NextResponse } from "next/server";
import {
  assertAdminKey,
  UnauthorizedAdminKeyError,
} from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";
import {
  getLatestBallPrediction,
  getLatestEdgeSignal,
  type TickResponse,
} from "@/lib/realtime/latest";
import {
  getNextBallForReplay,
  ballEventToLiveDelivery,
  updateLiveCursor,
} from "@/lib/realtime/replay";

const API_BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export async function POST(request: NextRequest) {
  try {
    assertAdminKey(request);

    const body = await request.json();
    const {
      matchId,
      provider = "cricsheet-replay",
      oddsPayload,
      replay,
    } = body as {
      matchId: string;
      provider?: "cricsheet-replay" | "live-feed";
      oddsPayload?: any;
      replay?: { enabled?: boolean };
    };

    if (!matchId) {
      return NextResponse.json(
        { error: "matchId required" },
        { status: 400 }
      );
    }

    // Verify match exists
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, teamA: true, teamB: true },
    });

    if (!match) {
      return NextResponse.json(
        { error: "match_not_found", matchId },
        { status: 404 }
      );
    }

    const adminKey = request.headers.get("x-admin-key") || "";

    // Step 1: Update prediction stream (deliver next ball)
    let deliveryResult: any = null;

    if (provider === "cricsheet-replay") {
      try {
        // Get next ball from cricsheet data
        const nextBall = await getNextBallForReplay(matchId, 1); // Assuming innings 1 for now

        if (nextBall) {
          // Convert to LiveDelivery payload
          const deliveryPayload = await ballEventToLiveDelivery(nextBall);

          // POST to delivery endpoint (internal call)
          const deliveryRes = await fetch(`${API_BASE}/api/realtime/delivery`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-admin-key": adminKey,
            },
            body: JSON.stringify(deliveryPayload),
          });

          if (deliveryRes.ok) {
            deliveryResult = await deliveryRes.json();

            // Update cursor
            await updateLiveCursor(
              matchId,
              provider,
              `${nextBall.innings}-${nextBall.over}-${nextBall.ballInOver}`
            );
          } else {
            const err = await deliveryRes.json();
            console.error("Delivery error:", err);
          }
        } else {
          // No more balls
        }
      } catch (error: any) {
        console.error("Replay error:", error);
      }
    } else if (provider === "live-feed") {
      // Stub: live-feed not wired yet
    }

    // Step 2: Poll odds + compute edge
    let oddsResult: any = null;

    if (oddsPayload) {
      // Use provided odds payload
      const oddsRes = await fetch(`${API_BASE}/api/markets/poll`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify(oddsPayload),
      });

      if (oddsRes.ok) {
        oddsResult = await oddsRes.json();
      }
    }

    // Step 3: Load latest outputs from DB
    const latestPrediction = await getLatestBallPrediction(matchId, "v3-lgbm");
    const latestEdge = await getLatestEdgeSignal(matchId);

    // Step 4: Compute staleness
    let staleness = undefined;
    if (latestPrediction && latestEdge) {
      const diffMs = Math.abs(
        latestEdge.observedAt.getTime() - latestPrediction.createdAt.getTime()
      );
      const diffSeconds = diffMs / 1000;
      staleness = {
        stale: diffSeconds > 10,
        secondsDiff: Math.round(diffSeconds * 10) / 10,
        warning:
          diffSeconds > 10
            ? `Prediction is ${Math.round(diffSeconds)}s old relative to odds`
            : undefined,
      };
    }

    const response: TickResponse = {
      ok: true,
      matchId,
      timestamp: new Date(),
      prediction: latestPrediction
        ? {
            innings: latestPrediction.innings,
            legalBallNumber: latestPrediction.legalBallNumber,
            teamAWinProb: latestPrediction.teamAWinProb,
            createdAt: latestPrediction.createdAt,
          }
        : undefined,
      edge: latestEdge
        ? {
            marketName: latestEdge.marketEvent.market.name,
            observedAt: latestEdge.observedAt,
            marketProbA_fair: latestEdge.marketProbA_fair,
            marketProbA_raw: latestEdge.marketProbA_raw,
            overround: latestEdge.overround,
            edgeA: latestEdge.edgeA,
          }
        : undefined,
      staleness,
    };

    return NextResponse.json(response);
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

    console.error("Tick error:", error);
    return NextResponse.json(
      {
        error: "Failed to process tick",
        message: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
