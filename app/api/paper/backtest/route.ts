import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertAdminKey, UnauthorizedAdminKeyError } from "@/lib/auth/adminKey";
import { runBacktestEdgeV1 } from "@/lib/paper/backtestEdgeV1";

const BacktestBodySchema = z.object({
  threshold: z.number().nonnegative().optional(),
  stake: z.number().positive().optional(),
  includeTeamB: z.boolean().optional(),
  limitMatches: z.number().int().positive().max(500).optional(),
});

export async function POST(request: NextRequest) {
  try {
    assertAdminKey(request);

    const payload = await request.json().catch(() => ({}));
    const parsed = BacktestBodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_payload", issues: parsed.error.issues },
        { status: 422 }
      );
    }

    const result = await runBacktestEdgeV1(parsed.data);

    return NextResponse.json({
      ok: true,
      strategy: "edge-v1",
      pnlConvention: "Net PnL excluding returned stake: win=stake*(odds-1), loss=-stake",
      ...result,
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
        error: "failed_to_run_backtest",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
