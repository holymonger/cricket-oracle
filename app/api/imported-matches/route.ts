import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { verifyAdminKey } from "@/lib/auth/adminKey";

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  // Verify admin key
  const adminKey = request.headers.get("x-admin-key");
  if (!verifyAdminKey(adminKey)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const matches = await prisma.match.findMany({
      where: {
        source: "cricsheet",
      },
      select: {
        id: true,
        sourceMatchId: true,
        matchDate: true,
        teamA: true,
        teamB: true,
        venue: true,
        city: true,
        winnerTeam: true,
      },
      orderBy: {
        matchDate: "desc",
      },
    });

    return NextResponse.json({
      count: matches.length,
      matches,
    });
  } catch (error) {
    console.error("Error fetching imported matches:", error);
    return NextResponse.json(
      { error: "Failed to fetch matches" },
      { status: 500 }
    );
  }
}
