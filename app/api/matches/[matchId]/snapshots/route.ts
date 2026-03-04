import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  assertAdminKey,
  MissingAdminKeyConfigError,
  UnauthorizedAdminKeyError,
} from "@/lib/auth/adminKey";
import { RateLimitExceededError, rateLimitOrThrow } from "@/lib/auth/rateLimit";
import type { MatchState } from "@/lib/statements/types";
import { computeWinProb } from "@/lib/model";

const SnapshotSchema = z.object({
  state: z.object({}).passthrough(),
  modelVersion: z.union([z.literal("v0"), z.literal("v1")]).optional().default("v1"),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    try {
      rateLimitOrThrow(req);
    } catch (rateLimitError) {
      if (rateLimitError instanceof RateLimitExceededError) {
        return NextResponse.json({ error: rateLimitError.message }, { status: 429 });
      }
      throw rateLimitError;
    }

    // Validate admin key for write operation
    try {
      assertAdminKey(req);
    } catch (authError) {
      if (authError instanceof MissingAdminKeyConfigError) {
        return NextResponse.json(
          { error: authError.message },
          { status: 500 }
        );
      }
      if (authError instanceof UnauthorizedAdminKeyError) {
        return NextResponse.json({ error: authError.message }, { status: 401 });
      }
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { matchId } = await params;
    const body = await req.json();
    const parsed = SnapshotSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const match = await prisma.match.findUnique({
      where: { id: matchId },
    });
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const state = parsed.data.state as MatchState;
    const modelVersion = parsed.data.modelVersion as "v0" | "v1";

    // Compute win prob using specified model (defaults to v1)
    const result = computeWinProb(state, modelVersion);

    const snapshot = await prisma.matchStateSnapshot.create({
      data: {
        matchId,
        innings: state.innings,
        runs: state.runs,
        wickets: state.wickets,
        balls: state.balls,
        targetRuns: state.targetRuns ?? null,
        runsAfter6: state.runsAfter6 ?? null,
        runsAfter10: state.runsAfter10 ?? null,
        runsAfter12: state.runsAfter12 ?? null,
        teamFours: state.teamFours ?? null,
        teamSixes: state.teamSixes ?? null,
        matchFours: state.matchFours ?? null,
        matchSixes: state.matchSixes ?? null,
      },
    });

    // Store prediction with specified model version
    const prediction = await prisma.prediction.create({
      data: {
        snapshotId: snapshot.id,
        modelVersion,
        winProb: result.winProb,
      },
    });

    return NextResponse.json({
      snapshot,
      prediction,
      winProb: result.winProb,
      modelVersion: result.modelVersion,
      features: result.features,
    });
  } catch (error) {
    console.error("Error saving snapshot:", error);
    return NextResponse.json(
      { error: "Server error", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    try {
      rateLimitOrThrow(req);
    } catch (rateLimitError) {
      if (rateLimitError instanceof RateLimitExceededError) {
        return NextResponse.json({ error: rateLimitError.message }, { status: 429 });
      }
      throw rateLimitError;
    }

    try {
      assertAdminKey(req);
    } catch (authError) {
      if (authError instanceof MissingAdminKeyConfigError) {
        return NextResponse.json({ error: authError.message }, { status: 500 });
      }
      if (authError instanceof UnauthorizedAdminKeyError) {
        return NextResponse.json({ error: authError.message }, { status: 401 });
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { matchId } = await params;
    
    // Query parameter for model version filter (defaults to v1)
    const url = new URL(req.url);
    const modelVersion = (url.searchParams.get("modelVersion") || "v1") as "v0" | "v1";

    const match = await prisma.match.findUnique({
      where: { id: matchId },
    });
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const snapshots = await prisma.matchStateSnapshot.findMany({
      where: { matchId },
      orderBy: { createdAt: "asc" },
      include: { 
        predictions: {
          where: { modelVersion }
        }
      },
    });

    return NextResponse.json({
      match,
      modelVersion,
      snapshots: snapshots.map((snap: typeof snapshots[0]) => ({
        ...snap,
        winProb: snap.predictions?.[0]?.winProb ?? 0.5,
        modelVersion: snap.predictions?.[0]?.modelVersion ?? modelVersion,
      })),
    });
  } catch (error) {
    console.error("Error fetching snapshots:", error);
    return NextResponse.json(
      { error: "Server error", details: String(error) },
      { status: 500 }
    );
  }
}
