import { NextResponse } from "next/server";
import { z } from "zod";

const InputSchema = z.object({
  innings: z.union([z.literal(1), z.literal(2)]),
  runs: z.number().int().min(0),
  wickets: z.number().int().min(0).max(10),
  balls: z.number().int().min(0).max(120),
  targetRuns: z.number().int().min(1).nullable().optional(),
});

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

// v0 chase win probability for T20 (innings 2 only).
function winProbV0(input: z.infer<typeof InputSchema>) {
  const ballsRemaining = 120 - input.balls;

  if (input.innings === 2 && input.targetRuns) {
    const runsRemaining = input.targetRuns - input.runs;

    if (runsRemaining <= 0) return { winProb: 1, ballsRemaining, runsRemaining };
    if (ballsRemaining <= 0) return { winProb: 0, ballsRemaining, runsRemaining };
    if (input.wickets >= 10) return { winProb: 0, ballsRemaining, runsRemaining };

    const reqRr = (runsRemaining * 6) / ballsRemaining; // required runs per over
    const curRr = input.balls > 0 ? (input.runs * 6) / input.balls : 0;

    const wicketsInHand = 10 - input.wickets;

    // Hand-tuned logistic model (replace later with trained model)
    const x = 0.9 * (curRr - reqRr) + 0.12 * wicketsInHand + 0.004 * ballsRemaining;
    const winProb = clamp01(1 / (1 + Math.exp(-x)));

    return { winProb, ballsRemaining, runsRemaining, reqRr, curRr };
  }

  // innings 1 placeholder (we'll improve later)
  return { winProb: 0.5, ballsRemaining };
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = InputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = winProbV0(parsed.data);
  return NextResponse.json(result);
}
