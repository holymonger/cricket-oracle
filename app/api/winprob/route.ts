import { NextResponse } from "next/server";
import { z } from "zod";
import { RateLimitExceededError, rateLimitOrThrow } from "@/lib/auth/rateLimit";
import { computeWinProb, getDefaultModelVersion } from "@/lib/model";
import type { MatchState } from "@/lib/statements/types";

const MODEL_VERSIONS = ["v0", "v1", "v3-lgbm", "v4-lgbm", "v4-logreg", "v41-logreg", "v42-logreg", "v43-logreg"] as const;

const InputSchema = z.object({
  innings: z.union([z.literal(1), z.literal(2)]),
  runs: z.number().int().min(0),
  wickets: z.number().int().min(0).max(10),
  balls: z.number().int().min(0).max(120),
  targetRuns: z.number().int().min(1).nullable().optional(),
  battingTeam: z.union([z.literal("A"), z.literal("B")]).optional().default("A"),
  modelVersion: z.enum(MODEL_VERSIONS).optional(),
});

export async function POST(req: Request) {
  try {
    rateLimitOrThrow(req);
  } catch (rateLimitError) {
    if (rateLimitError instanceof RateLimitExceededError) {
      return NextResponse.json({ error: rateLimitError.message }, { status: 429 });
    }
    return NextResponse.json({ error: "Rate limiter error" }, { status: 500 });
  }

  const body = await req.json();
  const parsed = InputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { modelVersion, ...stateData } = parsed.data;
  const state: MatchState = stateData as MatchState;

  // Use env-configured default if caller didn't specify a version
  const result = computeWinProb(state, modelVersion ?? getDefaultModelVersion());
  return NextResponse.json(result);
}

