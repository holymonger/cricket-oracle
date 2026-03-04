import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;

    const snapshot = await prisma.matchStateSnapshot.findFirst({
      where: { matchId },
      orderBy: { createdAt: "desc" },
      include: { prediction: true },
    });

    if (!snapshot) {
      return NextResponse.json({ error: "No snapshots found" }, { status: 404 });
    }

    return NextResponse.json({
      snapshot,
      prediction: snapshot.prediction,
      winProb: snapshot.prediction?.winProb ?? 0.5,
    });
  } catch (error) {
    console.error("Error fetching latest snapshot:", error);
    return NextResponse.json(
      { error: "Server error", details: String(error) },
      { status: 500 }
    );
  }
}
