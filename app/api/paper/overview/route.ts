import { NextRequest, NextResponse } from "next/server";
import { assertAdminKey, UnauthorizedAdminKeyError } from "@/lib/auth/adminKey";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  try {
    assertAdminKey(request);

    const { searchParams } = new URL(request.url);
    const accountName = searchParams.get("accountName") || "default";
    const matchId = searchParams.get("matchId") || undefined;

    const account = await prisma.paperAccount.upsert({
      where: { name: accountName },
      create: { name: accountName },
      update: {},
    });

    const where = {
      accountId: account.id,
      ...(matchId ? { matchId } : {}),
    };

    const [openBets, settledBets, aggregate] = await Promise.all([
      prisma.paperBet.findMany({
        where: { ...where, status: "open" },
        orderBy: { placedAt: "desc" },
        include: {
          match: { select: { id: true, teamA: true, teamB: true, winnerTeam: true } },
          marketEvent: { include: { market: true } },
        },
        take: 100,
      }),
      prisma.paperBet.findMany({
        where: { ...where, status: "settled" },
        orderBy: { settledAt: "desc" },
        include: {
          match: { select: { id: true, teamA: true, teamB: true, winnerTeam: true } },
          marketEvent: { include: { market: true } },
        },
        take: 200,
      }),
      prisma.paperBet.aggregate({
        where: { ...where, status: "settled" },
        _sum: { pnl: true, stake: true },
        _count: { _all: true },
      }),
    ]);

    const settledPnl = aggregate._sum.pnl ?? 0;
    const settledStake = aggregate._sum.stake ?? 0;
    const balance = account.startingBalance + settledPnl;

    return NextResponse.json({
      ok: true,
      account: {
        id: account.id,
        name: account.name,
        currency: account.currency,
        startingBalance: account.startingBalance,
        settledPnl,
        settledStake,
        balance,
      },
      openBets,
      settledBets,
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
        error: "failed_to_load_paper_overview",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
