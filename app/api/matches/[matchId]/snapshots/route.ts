import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { MatchState } from "@/lib/statements/types";

const SnapshotSchema = z.object({
  state: z.object({}).passthrough(),
});

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

// Compute win prob for chase scenario
function computeWinProb(state: MatchState): number {
  if (state.innings !== 2 || !state.targetRuns) {
    return 0.5; // placeholder
  }

  const ballsRemaining = 120 - state.balls;
  const runsRemaining = state.targetRuns - state.runs;

  if (runsRemaining <= 0) return 1;
  if (ballsRemaining <= 0) return 0;
  if (state.wickets >= 10) return 0;

  const reqRr = (runsRemaining * 6) / ballsRemaining;
  const curRr = state.balls > 0 ? (state.runs * 6) / state.balls : 0;
  const wicketsInHand = 10 - state.wickets;

  const x = 0.9 * (curRr - reqRr) + 0.12 * wicketsInHand + 0.004 * ballsRemaining;
  return clamp01(1 / (1 + Math.exp(-x)));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
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
    const winProb = computeWinProb(state);

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

    const prediction = await prisma.prediction.create({
      data: {
        snapshotId: snapshot.id,
        modelVersion: "v0",
        winProb,
      },
    });

    return NextResponse.json({
      snapshot,
      prediction,
      winProb,
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
  _req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;

    const match = await prisma.match.findUnique({
      where: { id: matchId },
    });
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const snapshots = await prisma.matchStateSnapshot.findMany({
      where: { matchId },
      orderBy: { createdAt: "asc" },
      include: { prediction: true },
    });

    return NextResponse.json({
      match,
      snapshots: snapshots.map((snap: typeof snapshots[0]) => ({
        ...snap,
        winProb: snap.prediction?.winProb ?? 0.5,
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
