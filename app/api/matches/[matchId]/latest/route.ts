import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  assertAdminKey,
  MissingAdminKeyConfigError,
  UnauthorizedAdminKeyError,
} from "@/lib/auth/adminKey";
import { RateLimitExceededError, rateLimitOrThrow } from "@/lib/auth/rateLimit";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    try {
      rateLimitOrThrow(req);
    } catch (rateLimitError) {
      if (rateLimitError instanceof RateLimitExceededError) {
        return NextResponse.json({ error: rateLimitError.message }, { status: 429 });
      }
      throw rateLimitError;
    }

    try {
      assertAdminKey(req);
    } catch (authError) {
      if (authError instanceof MissingAdminKeyConfigError) {
        return NextResponse.json({ error: authError.message }, { status: 500 });
      }
      if (authError instanceof UnauthorizedAdminKeyError) {
        return NextResponse.json({ error: authError.message }, { status: 401 });
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
