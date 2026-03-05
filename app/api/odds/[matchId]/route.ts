import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { assertAdminKey } from "@/lib/auth/adminKey";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  await assertAdminKey(req);

  const { matchId } = await params;
  if (!matchId) {
    return NextResponse.json({ error: "matchId required" }, { status: 400 });
  }

  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) {
    return NextResponse.json({ error: "match not found" }, { status: 404 });
  }

  // Mock odds matching AggregatorPayload format
  const payload = {
    matchId: matchId,
    timestamp: new Date().toISOString(),
    markets: [
      {
        marketName: "mock",
        externalEventId: `mock_${matchId}_${Date.now()}`,
        observedAt: new Date().toISOString(),
        selections: [
          { teamName: match.teamA, oddsDecimal: 1.85 },
          { teamName: match.teamB, oddsDecimal: 2.05 },
        ],
      },
    ],
  };

  return NextResponse.json(payload);
}
