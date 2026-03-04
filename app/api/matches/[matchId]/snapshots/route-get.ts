import { NextResponse } from "next/server";
import { getMatch, getSnapshots } from "@/lib/store/memoryStore";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;

    const match = getMatch(matchId);
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const snapshots = getSnapshots(matchId);

    return NextResponse.json({
      match,
      snapshots,
    });
  } catch (error) {
    console.error("Error fetching snapshots:", error);
    return NextResponse.json(
      { error: "Server error", details: String(error) },
      { status: 500 }
    );
  }
}
