import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertAdminKey } from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";
import { FEATURE_NAMES, type FeatureRow } from "@/lib/features/featureSchema";
import { buildV3Features } from "@/lib/features/buildV3Features";

const QuerySchema = z.object({
  matchId: z.string().min(1),
  n: z.coerce.number().int().positive().max(100).optional().default(20),
  epsilon: z.coerce.number().positive().optional().default(1e-9),
  modelVersion: z.string().optional().default("v3-lgbm"),
});

type SampledFeature = {
  innings: number;
  legalBallNumber: number;
  featureRow: FeatureRow;
};

export async function GET(request: NextRequest) {
  try {
    assertAdminKey(request);

    const parsed = QuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );

    const match = await prisma.match.findUnique({
      where: { id: parsed.matchId },
      select: { id: true, teamA: true, teamB: true },
    });

    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const legalEvents = await prisma.ballEvent.findMany({
      where: { matchId: parsed.matchId, legalBallNumber: { not: null } },
      orderBy: [{ innings: "asc" }, { over: "asc" }, { ballInOver: "asc" }],
      select: {
        innings: true,
        over: true,
        ballInOver: true,
        legalBallNumber: true,
        battingTeam: true,
        runsTotal: true,
        isWicket: true,
      },
    });

    if (legalEvents.length === 0) {
      return NextResponse.json({ error: "No legal balls found" }, { status: 404 });
    }

    const sampleCount = Math.min(parsed.n, legalEvents.length);
    const shuffled = [...legalEvents]
      .map((event) => ({ event, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .slice(0, sampleCount)
      .map((item) => item.event);

    const sampleKeySet = new Set(
      shuffled.map((e) => `${e.innings}:${e.legalBallNumber}`)
    );

    const firstInningsTarget =
      legalEvents
        .filter((event) => event.innings === 1)
        .reduce((sum, event) => sum + event.runsTotal, 0) + 1;

    const stateByInnings: Record<number, { runs: number; wickets: number; balls: number }> = {};
    const historyByInnings: Record<number, Array<{ runsTotal: number; isWicket: boolean }>> = {};
    const sampledFeatures: SampledFeature[] = [];

    for (const event of legalEvents) {
      if (!event.legalBallNumber) {
        continue;
      }

      if (!stateByInnings[event.innings]) {
        stateByInnings[event.innings] = { runs: 0, wickets: 0, balls: 0 };
      }
      if (!historyByInnings[event.innings]) {
        historyByInnings[event.innings] = [];
      }

      const state = stateByInnings[event.innings];
      const history = historyByInnings[event.innings];

      state.runs += event.runsTotal;
      state.balls += 1;
      if (event.isWicket) {
        state.wickets += 1;
      }

      const last6 = history.slice(Math.max(0, history.length - 6));
      const last12 = history.slice(Math.max(0, history.length - 12));

      const featureRow = buildV3Features(
        { teamA: match.teamA, teamB: match.teamB },
        {
          innings: event.innings as 1 | 2,
          battingTeam: event.battingTeam as "A" | "B",
          runs: state.runs,
          wickets: state.wickets,
          balls: state.balls,
          targetRuns: event.innings === 2 ? firstInningsTarget : undefined,
          runsThisBall: event.runsTotal,
          isWicketThisBall: event.isWicket,
        },
        {
          runsLast6: last6.reduce((sum, b) => sum + b.runsTotal, 0),
          wktsLast6: last6.filter((b) => b.isWicket).length,
          dotsLast6: last6.filter((b) => b.runsTotal === 0).length,
          boundariesLast6: last6.filter((b) => b.runsTotal === 4 || b.runsTotal === 6).length,
          runsLast12: last12.reduce((sum, b) => sum + b.runsTotal, 0),
          wktsLast12: last12.filter((b) => b.isWicket).length,
          dotsLast12: last12.filter((b) => b.runsTotal === 0).length,
          boundariesLast12: last12.filter((b) => b.runsTotal === 4 || b.runsTotal === 6).length,
        }
      );

      if (sampleKeySet.has(`${event.innings}:${event.legalBallNumber}`)) {
        sampledFeatures.push({
          innings: event.innings,
          legalBallNumber: event.legalBallNumber,
          featureRow,
        });
      }

      history.push({ runsTotal: event.runsTotal, isWicket: event.isWicket });
    }

    const predictions = await prisma.ballPrediction.findMany({
      where: {
        matchId: parsed.matchId,
        modelVersion: parsed.modelVersion,
        OR: sampledFeatures.map((item) => ({
          innings: item.innings,
          legalBallNumber: item.legalBallNumber,
        })),
      },
      select: {
        innings: true,
        legalBallNumber: true,
        featuresJson: true,
      },
    });

    const predictionMap = new Map(
      predictions.map((p) => [`${p.innings}:${p.legalBallNumber}`, p.featuresJson as Record<string, number> | null])
    );

    const mismatches: Array<{
      innings: number;
      legalBallNumber: number;
      diffs: Array<{ feature: string; training: number; inference: number; delta: number }>;
      reason?: string;
    }> = [];

    for (const item of sampledFeatures) {
      const key = `${item.innings}:${item.legalBallNumber}`;
      const stored = predictionMap.get(key);

      if (!stored) {
        mismatches.push({
          innings: item.innings,
          legalBallNumber: item.legalBallNumber,
          diffs: [],
          reason: "Missing BallPrediction or featuresJson",
        });
        continue;
      }

      const diffs: Array<{ feature: string; training: number; inference: number; delta: number }> = [];

      for (const feature of FEATURE_NAMES) {
        const trainingValue = item.featureRow[feature] ?? 0;
        const inferenceValue = Number(stored[feature] ?? 0);
        const delta = Math.abs(trainingValue - inferenceValue);

        if (delta > parsed.epsilon) {
          diffs.push({
            feature,
            training: trainingValue,
            inference: inferenceValue,
            delta,
          });
        }
      }

      if (diffs.length > 0) {
        mismatches.push({
          innings: item.innings,
          legalBallNumber: item.legalBallNumber,
          diffs,
        });
      }
    }

    return NextResponse.json(
      {
        success: mismatches.length === 0,
        matchId: parsed.matchId,
        modelVersion: parsed.modelVersion,
        sampled: sampledFeatures.length,
        epsilon: parsed.epsilon,
        mismatchCount: mismatches.length,
        mismatches,
      },
      { status: mismatches.length === 0 ? 200 : 409 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Failed to run feature diff",
        message: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
