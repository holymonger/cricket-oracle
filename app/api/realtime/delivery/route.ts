import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { assertAdminKey } from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";
import { mapTeamNameToSide } from "@/lib/teams/mapToSide";
import { buildV3Features } from "@/lib/features/buildV3Features";
import { buildV4Features } from "@/lib/features/buildV4Features";
import { buildV41Features } from "@/lib/features/buildV41Features";
import { buildV42Features } from "@/lib/features/buildV42Features";
import { buildV43Features } from "@/lib/features/buildV43Features";
import { computeWinProb } from "@/lib/model";
import type { MatchState } from "@/lib/model/types";

/**
 * Check if v4-logreg artifact exists in the filesystem.
 * Used for shadow mode to determine if v4 is available for dual-write.
 */
function hasV4LogRegArtifact(): boolean {
  try {
    const artifactPath = path.join(
      process.cwd(),
      "lib",
      "model",
      "artifacts",
      "v4_logreg.json"
    );
    return fs.existsSync(artifactPath);
  } catch {
    return false;
  }
}

function hasV41LogRegArtifact(): boolean {
  try {
    const artifactPath = path.join(
      process.cwd(),
      "lib",
      "model",
      "artifacts",
      "v41_logreg.json"
    );
    return fs.existsSync(artifactPath);
  } catch {
    return false;
  }
}

function hasV42LogRegArtifact(): boolean {
  try {
    const artifactPath = path.join(
      process.cwd(),
      "lib",
      "model",
      "artifacts",
      "v42_logreg.json"
    );
    return fs.existsSync(artifactPath);
  } catch {
    return false;
  }
}

function hasV43LogRegArtifact(): boolean {
  try {
    const artifactPath = path.join(
      process.cwd(),
      "lib",
      "model",
      "artifacts",
      "v43_logreg.json"
    );
    return fs.existsSync(artifactPath);
  } catch {
    return false;
  }
}

const RealtimeModelVersionSchema = z.union([
  z.literal("v3-lgbm"),
  z.literal("v4-lgbm"),
  z.literal("v4-logreg"),
  z.literal("v41-logreg"),
  z.literal("v42-logreg"),
  z.literal("v43-logreg"),
]);

const DeliveryPayloadSchema = z
  .object({
    matchId: z.string().min(1),
    innings: z.union([z.literal(1), z.literal(2)]),
    over: z.number().int().nonnegative(),
    ballInOver: z.number().int().positive(),
    battingTeamName: z.string().min(1),
    strikerName: z.string().min(1),
    nonStrikerName: z.string().min(1),
    bowlerName: z.string().min(1),
    runs: z.object({
      total: z.number().int().nonnegative(),
      bat: z.number().int().nonnegative().optional(),
      extras: z.number().int().nonnegative().optional(),
    }),
    extras: z
      .object({
        wides: z.number().int().nonnegative().optional(),
        noballs: z.number().int().nonnegative().optional(),
        byes: z.number().int().nonnegative().optional(),
        legbyes: z.number().int().nonnegative().optional(),
      })
      .optional(),
    wickets: z.array(z.record(z.string(), z.unknown())).optional(),
    targetRuns: z.number().int().positive().optional(),
    provider: z.string().min(1).optional(),
    providerEventId: z.string().min(1).optional(),
    occurredAt: z.string().datetime().optional(),
    modelVersion: RealtimeModelVersionSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.innings === 2 && !data.targetRuns) {
        return false;
      }
      return true;
    },
    {
      message: "targetRuns is required for innings 2",
      path: ["targetRuns"],
    }
  );

export async function POST(request: NextRequest) {
  try {
    assertAdminKey(request);

    const json = await request.json();
    const parseResult = DeliveryPayloadSchema.safeParse(json);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid delivery payload",
          issues: parseResult.error.issues,
        },
        { status: 422 }
      );
    }

    const body = parseResult.data;
    const modelVersionFromQuery = request.nextUrl.searchParams.get("modelVersion");
    const modelVersionResult = RealtimeModelVersionSchema.safeParse(
      modelVersionFromQuery ?? body.modelVersion ?? "v3-lgbm"
    );

    if (!modelVersionResult.success) {
      return NextResponse.json(
        {
          error: "Invalid modelVersion",
          allowed: ["v3-lgbm", "v4-lgbm", "v4-logreg", "v41-logreg", "v42-logreg", "v43-logreg"],
        },
        { status: 422 }
      );
    }

    const selectedModelVersion = modelVersionResult.data;

    const match = await prisma.match.findUnique({
      where: { id: body.matchId },
      select: { id: true, teamA: true, teamB: true },
    });

    if (!match) {
      return NextResponse.json({ error: "Match not found", matchId: body.matchId }, { status: 404 });
    }

    const battingTeam = mapTeamNameToSide(match, body.battingTeamName);

    const extras = body.extras || {};
    const extrasSum =
      (extras.wides || 0) +
      (extras.noballs || 0) +
      (extras.byes || 0) +
      (extras.legbyes || 0);

    const runsExtras = body.runs.extras ?? extrasSum;
    const runsBat = body.runs.bat ?? Math.max(0, body.runs.total - runsExtras);
    const runsTotal = body.runs.total;

    const isWide = (extras.wides || 0) > 0;
    const isNoBall = (extras.noballs || 0) > 0;
    const isLegal = !isWide && !isNoBall;
    const isWicketThisBall = (body.wickets?.length || 0) > 0;

    const provider = body.provider ?? "realtime-delivery";
    const providerEventId =
      body.providerEventId ??
      `${body.matchId}:${body.innings}:${body.over}:${body.ballInOver}`;

    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : null;
    const wicketsJsonValue = body.wickets?.length
      ? (body.wickets as Prisma.InputJsonValue)
      : Prisma.JsonNull;

    // Declare v4 state outside transaction so it's accessible in response
    let v4Available = false;
    let v4Prediction: any = null;
    let v4Features: any = null;
    let v41Available = false;
    let v41Prediction: any = null;
    let v41Features: any = null;
    let v42Available = false;
    let v42Prediction: any = null;
    let v42Features: any = null;
    let v43Available = false;
    let v43Prediction: any = null;
    let v43Features: any = null;

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.liveBallEvent.findUnique({
        where: {
          matchId_provider_providerEventId: {
            matchId: match.id,
            provider,
            providerEventId,
          },
        },
      });

      if (existing) {
        return {
          duplicate: true,
          isLegal: existing.isLegal,
          legalBallNumber: null,
          teamAWinProb: null,
        };
      }

      if (!isLegal) {
        await tx.liveBallEvent.create({
          data: {
            matchId: body.matchId,
            provider,
            providerEventId,
            innings: body.innings,
            over: body.over,
            ballInOver: body.ballInOver,
            battingTeam,
            striker: body.strikerName,
            nonStriker: body.nonStrikerName,
            bowler: body.bowlerName,
            runsBat,
            runsExtras,
            runsTotal,
            extrasJson: body.extras || Prisma.JsonNull,
            wicketsJson: wicketsJsonValue,
            isWide,
            isNoBall,
            isLegal,
            occurredAt,
          },
        });

        return {
          duplicate: false,
          isLegal: false,
          legalBallNumber: null,
          teamAWinProb: null,
        };
      }

      const previousLegal = await tx.liveBallEvent.findMany({
        where: {
          matchId: body.matchId,
          innings: body.innings,
          isLegal: true,
        },
        orderBy: [{ over: "desc" }, { ballInOver: "desc" }, { createdAt: "desc" }],
        take: 12,
        select: {
          runsTotal: true,
          wicketsJson: true,
        },
      });

      const last6 = previousLegal.slice(0, 6);
      const rolling = {
        runsLast6: last6.reduce((sum, e) => sum + e.runsTotal, 0),
        wktsLast6: last6.filter((e) => Array.isArray(e.wicketsJson) && e.wicketsJson.length > 0).length,
        dotsLast6: last6.filter((e) => e.runsTotal === 0).length,
        boundariesLast6: last6.filter((e) => e.runsTotal === 4 || e.runsTotal === 6).length,
        runsLast12: previousLegal.reduce((sum, e) => sum + e.runsTotal, 0),
        wktsLast12: previousLegal.filter((e) => Array.isArray(e.wicketsJson) && e.wicketsJson.length > 0).length,
        dotsLast12: previousLegal.filter((e) => e.runsTotal === 0).length,
        boundariesLast12: previousLegal.filter((e) => e.runsTotal === 4 || e.runsTotal === 6).length,
      };

      let inningsState = await tx.liveInningsState.findUnique({
        where: {
          matchId_innings: {
            matchId: body.matchId,
            innings: body.innings,
          },
        },
      });

      if (!inningsState) {
        const [agg, wicketsCount, legalCount] = await Promise.all([
          tx.liveBallEvent.aggregate({
            where: { matchId: body.matchId, innings: body.innings, isLegal: true },
            _sum: { runsTotal: true },
          }),
          tx.liveBallEvent.count({
            where: {
              matchId: body.matchId,
              innings: body.innings,
              isLegal: true,
              wicketsJson: { not: Prisma.JsonNull },
            },
          }),
          tx.liveBallEvent.count({
            where: { matchId: body.matchId, innings: body.innings, isLegal: true },
          }),
        ]);

        // For innings 2, use targetRuns from payload; for innings 1, keep it null
        const targetRunsToSet = body.innings === 2 ? (body.targetRuns ?? null) : null;

        inningsState = await tx.liveInningsState.create({
          data: {
            matchId: body.matchId,
            innings: body.innings,
            runs: agg._sum.runsTotal || 0,
            wickets: wicketsCount,
            balls: legalCount,
            targetRuns: targetRunsToSet,
          },
        });
      } else if (body.innings === 2 && body.targetRuns) {
        // For innings 2, validate targetRuns consistency
        if (inningsState.targetRuns !== null && inningsState.targetRuns !== body.targetRuns) {
          return NextResponse.json(
            {
              error: "Target runs conflict",
              message: `Innings 2 targetRuns already set to ${inningsState.targetRuns}, but payload specifies ${body.targetRuns}`,
              stored: inningsState.targetRuns,
              received: body.targetRuns,
            },
            { status: 409 }
          );
        }

        // If targetRuns was null, update it
        if (inningsState.targetRuns === null) {
          inningsState = await tx.liveInningsState.update({
            where: {
              matchId_innings: {
                matchId: body.matchId,
                innings: body.innings,
              },
            },
            data: {
              targetRuns: body.targetRuns,
            },
          });
        }
      }

      const legalBallNumber = inningsState.balls + 1;
      const nextRuns = inningsState.runs + runsTotal;
      const nextWickets = inningsState.wickets + (isWicketThisBall ? 1 : 0);
      const nextBalls = inningsState.balls + 1;
      const targetRuns =
        body.innings === 2 ? (inningsState.targetRuns ?? 0) || undefined : undefined;

      const ballContext = {
        innings: body.innings,
        battingTeam,
        runs: nextRuns,
        wickets: nextWickets,
        balls: nextBalls,
        targetRuns,
        runsThisBall: runsTotal,
        isWicketThisBall,
      };

      const matchState: MatchState = {
        innings: body.innings,
        battingTeam,
        runs: nextRuns,
        wickets: nextWickets,
        balls: nextBalls,
        targetRuns: targetRuns ?? null,
      };

      // Build v3 features and prediction (always)
      const v3Features = buildV3Features(
        { teamA: match.teamA, teamB: match.teamB },
        ballContext,
        rolling
      );
      const v3Prediction = computeWinProb(matchState, "v3-lgbm", v3Features);

      // Shadow mode: also build v4 predictions if artifact exists
      // Update outer scope v4 state
      v4Available = hasV4LogRegArtifact();
      if (v4Available) {
        v4Features = buildV4Features(
          { teamA: match.teamA, teamB: match.teamB },
          ballContext,
          rolling
        );
        try {
          v4Prediction = computeWinProb(matchState, "v4-logreg", v4Features);
        } catch (e) {
          // If v4 computation fails, just skip it
          console.warn("Warning: v4-logreg computation failed, skipping shadow prediction:", e);
          v4Prediction = null;
        }
      }

      // Optional v4.1 path for direct selection
      v41Available = hasV41LogRegArtifact();
      if (v41Available) {
        v41Features = buildV41Features(
          { teamA: match.teamA, teamB: match.teamB },
          ballContext,
          rolling
        );
        try {
          v41Prediction = computeWinProb(matchState, "v41-logreg", v41Features);
        } catch (e) {
          console.warn("Warning: v41-logreg computation failed, using fallback prediction:", e);
          v41Prediction = null;
        }
      }

      v42Available = hasV42LogRegArtifact();
      if (v42Available) {
        v42Features = buildV42Features(
          { teamA: match.teamA, teamB: match.teamB },
          ballContext,
          rolling
        );
        try {
          v42Prediction = computeWinProb(matchState, "v42-logreg", v42Features);
        } catch (e) {
          console.warn("Warning: v42-logreg computation failed, using fallback prediction:", e);
          v42Prediction = null;
        }
      }

      v43Available = hasV43LogRegArtifact();
      if (v43Available) {
        v43Features = buildV43Features(
          { teamA: match.teamA, teamB: match.teamB },
          ballContext,
          rolling
        );
        try {
          v43Prediction = computeWinProb(matchState, "v43-logreg", v43Features);
        } catch (e) {
          console.warn("Warning: v43-logreg computation failed, using fallback prediction:", e);
          v43Prediction = null;
        }
      }

      // Use selected model for response (from query param or body), or fall back to v3
      const selectedModelVersion = modelVersionResult.data;
      const responseFeatures = selectedModelVersion === "v43-logreg"
        ? (v43Features ?? v3Features)
        : selectedModelVersion === "v42-logreg"
        ? (v42Features ?? v3Features)
        : selectedModelVersion === "v41-logreg"
        ? (v41Features ?? v3Features)
        : selectedModelVersion === "v4-logreg"
        ? (v4Features ?? v3Features)
        : v3Features;
      const responsePrediction = selectedModelVersion === "v43-logreg"
        ? (v43Prediction ?? v3Prediction)
        : selectedModelVersion === "v42-logreg"
        ? (v42Prediction ?? v3Prediction)
        : selectedModelVersion === "v41-logreg"
        ? (v41Prediction ?? v3Prediction)
        : selectedModelVersion === "v4-logreg"
        ? (v4Prediction ?? v3Prediction)
        : v3Prediction;

      await tx.liveBallEvent.create({
        data: {
          matchId: body.matchId,
          provider,
          providerEventId,
          innings: body.innings,
          over: body.over,
          ballInOver: body.ballInOver,
          battingTeam,
          striker: body.strikerName,
          nonStriker: body.nonStrikerName,
          bowler: body.bowlerName,
          runsBat,
          runsExtras,
          runsTotal,
          extrasJson: body.extras || Prisma.JsonNull,
          wicketsJson: wicketsJsonValue,
          isWide,
          isNoBall,
          isLegal,
          occurredAt,
        },
      });

      await tx.liveInningsState.update({
        where: {
          matchId_innings: {
            matchId: body.matchId,
            innings: body.innings,
          },
        },
        data: {
          runs: nextRuns,
          wickets: nextWickets,
          balls: nextBalls,
        },
      });

      // Shadow mode: write BOTH v3 and v4 predictions (if v4 available)
      // Start with v3
      await tx.ballPrediction.upsert({
        where: {
          matchId_innings_legalBallNumber_modelVersion: {
            matchId: body.matchId,
            innings: body.innings,
            legalBallNumber,
            modelVersion: "v3-lgbm",
          },
        },
        create: {
          matchId: body.matchId,
          innings: body.innings,
          legalBallNumber,
          modelVersion: "v3-lgbm",
          teamAWinProb: v3Prediction.winProb,
          featuresJson: v3Features,
        },
        update: {
          teamAWinProb: v3Prediction.winProb,
          featuresJson: v3Features,
        },
      });

      // Also write v4 if available.
      if (v4Prediction && v4Features) {
        await tx.ballPrediction.upsert({
          where: {
            matchId_innings_legalBallNumber_modelVersion: {
              matchId: body.matchId,
              innings: body.innings,
              legalBallNumber,
              modelVersion: "v4-logreg",
            },
          },
          create: {
            matchId: body.matchId,
            innings: body.innings,
            legalBallNumber,
            modelVersion: "v4-logreg",
            teamAWinProb: v4Prediction.winProb,
            featuresJson: v4Features,
          },
          update: {
            teamAWinProb: v4Prediction.winProb,
            featuresJson: v4Features,
          },
        });
      }

      // Persist selected model prediction for direct v41/v42/v43 usage.
      if (selectedModelVersion !== "v3-lgbm" && selectedModelVersion !== "v4-logreg") {
        await tx.ballPrediction.upsert({
          where: {
            matchId_innings_legalBallNumber_modelVersion: {
              matchId: body.matchId,
              innings: body.innings,
              legalBallNumber,
              modelVersion: selectedModelVersion,
            },
          },
          create: {
            matchId: body.matchId,
            innings: body.innings,
            legalBallNumber,
            modelVersion: selectedModelVersion,
            teamAWinProb: responsePrediction.winProb,
            featuresJson: responseFeatures,
          },
          update: {
            teamAWinProb: responsePrediction.winProb,
            featuresJson: responseFeatures,
          },
        });
      }

      return {
        duplicate: false,
        isLegal: true,
        modelVersion: selectedModelVersion,
        legalBallNumber,
        teamAWinProb: responsePrediction.winProb,
      };
    });

    return NextResponse.json({
      success: true,
      matchId: body.matchId,
      innings: body.innings,
      over: body.over,
      ballInOver: body.ballInOver,
      modelVersion: selectedModelVersion,
      shadowMode: {
        v3Written: true,
        v4Written: v4Available && v4Prediction !== null,
        v4Available,
      },
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Failed to process delivery",
        message: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
