import { NextResponse } from "next/server";
import { z } from "zod";
import { parseStatement } from "@/lib/statements/parse";
import { computeStatementProbability } from "@/lib/statements/compute";
import type { MatchState } from "@/lib/statements/types";
import { RateLimitExceededError, rateLimitOrThrow } from "@/lib/auth/rateLimit";

const RequestSchema = z.object({
  statementText: z.string().min(1),
  state: z.object({}).passthrough(),
});

export async function POST(req: Request) {
  try {
    try {
      rateLimitOrThrow(req);
    } catch (rateLimitError) {
      if (rateLimitError instanceof RateLimitExceededError) {
        return NextResponse.json({ error: rateLimitError.message }, { status: 429 });
      }
      throw rateLimitError;
    }

    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      console.error("Validation error:", parsed.error.flatten());
      return NextResponse.json(
        { 
          ok: false,
          error: "Invalid input - missing statementText or state", 
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { statementText, state } = parsed.data;
    const matchState = state as MatchState;

    // Parse the statement
    const template = parseStatement(statementText);
    if (!template) {
      return NextResponse.json({
        ok: false,
        error: "Could not parse statement. Try patterns like 'Team A over 170.5' or 'Match total under 329.5'.",
        supportedExamples: [
          "1st innings powerplay over 49.5",
          "2nd innings 0-10 under 78.5",
          "Team A over 170.5",
          "Team A 180+",
          "Match total over 329.5",
        ],
      });
    }

    // Compute probability
    const result = computeStatementProbability(matchState, template);
    return NextResponse.json(result);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { 
        ok: false,
        error: "Server error", 
        details: String(error) 
      },
      { status: 500 }
    );
  }
}
