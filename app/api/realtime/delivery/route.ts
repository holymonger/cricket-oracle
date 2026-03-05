import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertAdminKey } from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";
import { mapTeamNameToSide } from "@/lib/teams/mapToSide";
import { buildV3Features } from "@/lib/features/buildV3Features";
import { computeWinProb } from "@/lib/model";
import type { MatchState } from "@/lib/model/types";

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

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.liveBallEvent.findUnique({
        where: {
          provider_providerEventId: {
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

      const featureRow = buildV3Features(
        { teamA: match.teamA, teamB: match.teamB },
        {
          innings: body.innings,
          battingTeam,
          runs: nextRuns,
          wickets: nextWickets,
          balls: nextBalls,
          targetRuns,
          runsThisBall: runsTotal,
          isWicketThisBall,
        },
        rolling
      );

      const matchState: MatchState = {
        innings: body.innings,
        battingTeam,
        runs: nextRuns,
        wickets: nextWickets,
        balls: nextBalls,
        targetRuns: targetRuns ?? null,
      };

      const prediction = computeWinProb(matchState, "v3-lgbm", featureRow);

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
          teamAWinProb: prediction.winProb,
          featuresJson: featureRow,
        },
        update: {
          teamAWinProb: prediction.winProb,
          featuresJson: featureRow,
        },
      });

      return {
        duplicate: false,
        isLegal: true,
        legalBallNumber,
        teamAWinProb: prediction.winProb,
      };
    });

    return NextResponse.json({
      success: true,
      matchId: body.matchId,
      innings: body.innings,
      over: body.over,
      ballInOver: body.ballInOver,
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
