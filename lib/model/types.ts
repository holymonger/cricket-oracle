import { z } from "zod";

export const BattingTeamSchema = z.union([z.literal("A"), z.literal("B")]);
export type BattingTeam = z.infer<typeof BattingTeamSchema>;

export const MatchStateSchema = z.object({
  innings: z.union([z.literal(1), z.literal(2)]),
  battingTeam: BattingTeamSchema.optional().default("A"),
  runs: z.number().int().min(0),
  wickets: z.number().int().min(0).max(10),
  balls: z.number().int().min(0).max(120),
  targetRuns: z.number().int().min(1).nullable().optional(),
  runsAfter6: z.number().int().min(0).nullable().optional(),
  runsAfter10: z.number().int().min(0).nullable().optional(),
  runsAfter12: z.number().int().min(0).nullable().optional(),
  teamFours: z.number().int().min(0).nullable().optional(),
  teamSixes: z.number().int().min(0).nullable().optional(),
  matchFours: z.number().int().min(0).nullable().optional(),
  matchSixes: z.number().int().min(0).nullable().optional(),
}).passthrough();

export type MatchState = z.infer<typeof MatchStateSchema>;

export interface WinProbResult {
  winProb: number; // Team A win probability, always in [0, 1]
  modelVersion: string; // "v0", "v1", etc.
  features: Record<string, number>;
}
