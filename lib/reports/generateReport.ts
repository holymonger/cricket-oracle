/**
 * AI-powered pre-match report generation using Claude.
 * Takes structured pre-match statistics and produces a narrative analysis.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { PreMatchStats } from "@/lib/cricket/preMatchStats";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

export interface GeneratedReport {
  report: string;
  modelProbA: number;
  keyFactors: string[];
  generatedAt: string;
}

/**
 * Generate a pre-match analysis report using Claude.
 * The model does narrative generation; the probability comes from the stats model.
 */
export async function generatePreMatchReport(
  teamA: string,
  teamB: string,
  venue: string | undefined,
  stats: PreMatchStats
): Promise<GeneratedReport> {
  const { headToHead: h2h, teamAForm: fmA, teamBForm: fmB, venueStats, preMatchWinProbA } = stats;

  const contextBlock = JSON.stringify(
    {
      match: { teamA, teamB, venue: venue ?? "unknown" },
      headToHead: {
        totalMatches: h2h.totalMatches,
        teamAWins: h2h.teamAWins,
        teamBWins: h2h.teamBWins,
        teamAWinPct: (h2h.teamAWinPct * 100).toFixed(1) + "%",
        venueMatches: h2h.venueMatches,
        venueTeamAWinPct: h2h.venueMatches > 0 ? (h2h.venueTeamAWinPct * 100).toFixed(1) + "%" : "n/a",
        last5: h2h.recentMatches.slice(0, 5).map((m) => ({
          date: m.matchDate,
          venue: m.venue,
          winner: m.winner === "A" ? teamA : m.winner === "B" ? teamB : "unknown",
        })),
      },
      teamAForm: {
        last10WinPct: (fmA.last10WinPct * 100).toFixed(0) + "%",
        last10Record: `${fmA.last10Wins}W ${fmA.last10Losses}L`,
        avgFirstInningsScore: fmA.avgFirstInningsScore.toFixed(0),
        tossWinRate: (fmA.tossWinRate * 100).toFixed(0) + "%",
        tossBatFirstRate: (fmA.tossBatFirstRate * 100).toFixed(0) + "%",
        venueAvgScore: fmA.venueAvgScore?.toFixed(0) ?? "n/a",
      },
      teamBForm: {
        last10WinPct: (fmB.last10WinPct * 100).toFixed(0) + "%",
        last10Record: `${fmB.last10Wins}W ${fmB.last10Losses}L`,
        avgFirstInningsScore: fmB.avgFirstInningsScore.toFixed(0),
        tossWinRate: (fmB.tossWinRate * 100).toFixed(0) + "%",
        tossBatFirstRate: (fmB.tossBatFirstRate * 100).toFixed(0) + "%",
        venueAvgScore: fmB.venueAvgScore?.toFixed(0) ?? "n/a",
      },
      venueStats: venueStats
        ? {
            avgFirstInnings: venueStats.avgFirstInningsScore.toFixed(0),
            avgSecondInnings: venueStats.avgSecondInningsScore.toFixed(0),
            battingFirstWinPct: (venueStats.firstInningsWinPct * 100).toFixed(0) + "%",
            tossWinnerBatFirstPct: (venueStats.tossWinnerBatFirstPct * 100).toFixed(0) + "%",
            totalMatchesAtVenue: venueStats.totalMatches,
          }
        : null,
      modelProbA: (preMatchWinProbA * 100).toFixed(1) + "%",
    },
    null,
    2
  );

  const prompt = `You are Cricket Oracle, a world-class cricket analytics AI.
You have been given structured pre-match statistics for an upcoming T20 cricket match.

Your task:
1. Write a concise, expert pre-match analysis report (200-350 words).
2. Identify 3-5 key factors that will decide this match.
3. Give your own probability estimate for ${teamA} winning (you may adjust the model figure slightly based on your reasoning).

Guidelines:
- Be direct and opinionated, not vague.
- Lead with the headline finding (who is favoured and why).
- Reference specific stats from the data provided.
- Note any venue-specific patterns that matter.
- Flag the most important uncertainty or wildcard.
- Do not pad — every sentence should add information.

Return your response as valid JSON in this exact shape:
{
  "report": "<narrative report text, plain text, no markdown>",
  "adjustedProbA": <number between 0 and 1>,
  "keyFactors": ["<factor 1>", "<factor 2>", "<factor 3>"]
}

Match data:
${contextBlock}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  // Parse JSON response — extract from possible markdown code block
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude returned non-JSON response: " + rawText.slice(0, 200));
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    report: string;
    adjustedProbA: number;
    keyFactors: string[];
  };

  return {
    report: parsed.report,
    modelProbA: typeof parsed.adjustedProbA === "number"
      ? Math.max(0.05, Math.min(0.95, parsed.adjustedProbA))
      : preMatchWinProbA,
    keyFactors: Array.isArray(parsed.keyFactors) ? parsed.keyFactors : [],
    generatedAt: new Date().toISOString(),
  };
}
