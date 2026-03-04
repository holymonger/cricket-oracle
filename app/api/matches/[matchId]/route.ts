import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  assertAdminKey,
  MissingAdminKeyConfigError,
  UnauthorizedAdminKeyError,
} from "@/lib/auth/adminKey";
import { RateLimitExceededError, rateLimitOrThrow } from "@/lib/auth/rateLimit";

export async function DELETE(
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

    // Require admin key to delete matches
    try {
      assertAdminKey(req);
    } catch (authError) {
      if (authError instanceof MissingAdminKeyConfigError) {
        return NextResponse.json(
          { error: authError.message },
          { status: 500 }
        );
      }
      if (authError instanceof UnauthorizedAdminKeyError) {
        return NextResponse.json({ error: authError.message }, { status: 401 });
      }
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { matchId } = await params;

    // Check if match exists
    const match = await prisma.match.findUnique({
      where: { id: matchId },
    });

    if (!match) {
      return NextResponse.json(
        { error: "Match not found" },
        { status: 404 }
      );
    }

    // Delete match (cascade will handle snapshots and predictions)
    await prisma.match.delete({
      where: { id: matchId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting match:", error);
    return NextResponse.json(
      { error: "Server error", details: String(error) },
      { status: 500 }
    );
  }
}
