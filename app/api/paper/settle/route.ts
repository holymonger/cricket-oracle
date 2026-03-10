import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertAdminKey, UnauthorizedAdminKeyError } from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";
import { settlePnl } from "@/lib/paper/backtestEdgeV1";

const SettleBodySchema = z.object({
  accountName: z.string().min(1).default("default").optional(),
  matchId: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  try {
    assertAdminKey(request);

    const json = await request.json().catch(() => ({}));
    const parsed = SettleBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 422 }
      );
    }

    const { accountName = "default", matchId } = parsed.data;

    const account = await prisma.paperAccount.findUnique({
      where: { name: accountName },
      select: { id: true, name: true },
    });

    if (!account) {
      return NextResponse.json(
        { error: "account_not_found", accountName },
        { status: 404 }
      );
    }

    const openBets = await prisma.paperBet.findMany({
      where: {
        accountId: account.id,
        status: "open",
        ...(matchId ? { matchId } : {}),
      },
      include: {
        match: {
          select: {
            id: true,
            winnerTeam: true,
          },
        },
      },
      orderBy: { placedAt: "asc" },
      take: 1000,
    });

    let settledCount = 0;
    let skippedNoResult = 0;
    let totalPnl = 0;

    for (const bet of openBets) {
      const winnerTeam = bet.match.winnerTeam;
      if (winnerTeam !== "A" && winnerTeam !== "B") {
        skippedNoResult++;
        continue;
      }

      const outcome = settlePnl(
        bet.side as "A" | "B",
        winnerTeam,
        bet.stake,
        bet.oddsDecimal
      );

      await prisma.paperBet.update({
        where: { id: bet.id },
        data: {
          status: "settled",
          settledAt: new Date(),
          result: outcome.result,
          pnl: outcome.pnl,
        },
      });

      settledCount++;
      totalPnl += outcome.pnl;
    }

    return NextResponse.json({
      ok: true,
      accountName: account.name,
      matchId: matchId || null,
      openBetsScanned: openBets.length,
      settledCount,
      skippedNoResult,
      totalPnl,
      pnlConvention: "Net PnL excluding returned stake: win=stake*(odds-1), loss=-stake",
    });
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
        error: "failed_to_settle_paper_bets",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
