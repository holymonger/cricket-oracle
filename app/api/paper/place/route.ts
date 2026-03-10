import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertAdminKey, UnauthorizedAdminKeyError } from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";
import { evaluateEdgeSignalForBet } from "@/lib/paper/strategyEdgeV1";

const PlaceBetSchema = z.object({
  accountName: z.string().min(1).default("default").optional(),
  matchId: z.string().min(1),
  edgeSignalId: z.string().min(1),
  stake: z.number().positive().optional(),
  threshold: z.number().nonnegative().optional(),
});

export async function POST(request: NextRequest) {
  try {
    assertAdminKey(request);

    const json = await request.json();
    const parsed = PlaceBetSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 422 }
      );
    }

    const { accountName = "default", matchId, edgeSignalId, stake, threshold } = parsed.data;

    const edgeSignal = await prisma.edgeSignal.findUnique({
      where: { id: edgeSignalId },
    });

    if (!edgeSignal || edgeSignal.matchId !== matchId) {
      return NextResponse.json(
        { error: "edge_signal_not_found", matchId, edgeSignalId },
        { status: 404 }
      );
    }

    const openExisting = await prisma.paperBet.findFirst({
      where: {
        matchId,
        status: "open",
        account: { name: accountName },
      },
      select: { id: true },
    });

    if (openExisting) {
      return NextResponse.json(
        { error: "open_bet_exists", message: "An open bet already exists for this match and account." },
        { status: 409 }
      );
    }

    const [oddsA, oddsB] = await Promise.all([
      prisma.oddsTick.findFirst({
        where: {
          marketEventId: edgeSignal.marketEventId,
          side: "A",
          observedAt: { lte: edgeSignal.observedAt },
        },
        orderBy: { observedAt: "desc" },
      }),
      prisma.oddsTick.findFirst({
        where: {
          marketEventId: edgeSignal.marketEventId,
          side: "B",
          observedAt: { lte: edgeSignal.observedAt },
        },
        orderBy: { observedAt: "desc" },
      }),
    ]);

    const candidate = evaluateEdgeSignalForBet({
      edgeSignal,
      oddsA,
      oddsB,
      stake,
      options: {
        threshold,
        includeTeamB: false,
      },
    });

    if (!candidate) {
      return NextResponse.json(
        {
          error: "strategy_rejected",
          message: "Signal does not satisfy edge-v1 constraints (stale/threshold/odds).",
        },
        { status: 422 }
      );
    }

    const account = await prisma.paperAccount.upsert({
      where: { name: accountName },
      create: { name: accountName },
      update: {},
    });

    const bet = await prisma.paperBet.create({
      data: {
        accountId: account.id,
        matchId,
        marketEventId: candidate.marketEventId,
        placedAt: new Date(),
        observedAt: candidate.observedAt,
        side: candidate.side,
        stake: candidate.stake,
        oddsDecimal: candidate.oddsDecimal,
        impliedProb: candidate.impliedProb,
        modelProbA: candidate.modelProbA,
        marketProbA: candidate.marketProbA,
        edgeA: candidate.edgeA,
        ruleVersion: candidate.ruleVersion,
        status: "open",
      },
      include: {
        account: { select: { id: true, name: true, currency: true } },
      },
    });

    return NextResponse.json({ ok: true, bet });
  } catch (error: unknown) {
    if (
      error instanceof UnauthorizedAdminKeyError ||
      (error as { name?: string })?.name === "UnauthorizedAdminKeyError"
    ) {
      return NextResponse.json(
        { error: "unauthorized_admin_key", message: (error as Error).message },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error: "failed_to_place_paper_bet",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
