import { z } from "zod";

export const DirectionSchema = z.union([z.literal("over"), z.literal("under")]);
export type Direction = z.infer<typeof DirectionSchema>;

export const InningsSchema = z.union([z.literal(1), z.literal(2)]);
export type Innings = z.infer<typeof InningsSchema>;

export const SegmentXOversSchema = z.union([z.literal(6), z.literal(10), z.literal(12)]);
export type SegmentXOvers = z.infer<typeof SegmentXOversSchema>;

export const MatchStateSchema = z.object({
  innings: InningsSchema,
  runs: z.number().int().min(0),
  wickets: z.number().int().min(0).max(10),
  balls: z.number().int().min(0).max(120),
  targetRuns: z.union([z.number().int().min(1), z.null()]).optional().default(null),

  // Optional checkpoints to support "0 to X overs" segment markets
  runsAfter6: z.union([z.number().int().min(0), z.null()]).optional().default(null),
  runsAfter10: z.union([z.number().int().min(0), z.null()]).optional().default(null),
  runsAfter12: z.union([z.number().int().min(0), z.null()]).optional().default(null),

  // Optional boundaries (manual for now, feed later)
  teamFours: z.union([z.number().int().min(0), z.null()]).optional().default(null),
  teamSixes: z.union([z.number().int().min(0), z.null()]).optional().default(null),
  matchFours: z.union([z.number().int().min(0), z.null()]).optional().default(null),
  matchSixes: z.union([z.number().int().min(0), z.null()]).optional().default(null),
}).passthrough();
export type MatchState = z.infer<typeof MatchStateSchema>;

// ---- Statement templates (DSL) ----

export const StatementTemplateSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("MATCH_WINNER_INCL_SUPER_OVER"),
    team: z.string().min(1),
  }),

  z.object({
    type: z.literal("TEAM_INNINGS_TOTAL_OVER_UNDER"),
    team: z.string().min(1),
    innings: InningsSchema,
    line: z.number(),
    direction: DirectionSchema,
  }),

  z.object({
    type: z.literal("TEAM_INNINGS_REACHES_THRESHOLD"),
    team: z.string().min(1),
    innings: InningsSchema,
    threshold: z.number().int(),
  }),

  z.object({
    type: z.literal("MATCH_TOTAL_RUNS_OVER_UNDER"),
    line: z.number(),
    direction: DirectionSchema,
  }),

  z.object({
    type: z.literal("INNINGS_RUNS_0_TO_X_OVER_UNDER"),
    innings: InningsSchema,
    xOvers: SegmentXOversSchema,
    line: z.number(),
    direction: DirectionSchema,
  }),

  z.object({
    type: z.literal("MATCH_TOTAL_FOURS_OVER_UNDER"),
    line: z.number(),
    direction: DirectionSchema,
  }),
  z.object({
    type: z.literal("MATCH_TOTAL_SIXES_OVER_UNDER"),
    line: z.number(),
    direction: DirectionSchema,
  }),
  z.object({
    type: z.literal("TEAM_TOTAL_FOURS_OVER_UNDER"),
    team: z.string().min(1),
    line: z.number(),
    direction: DirectionSchema,
  }),
  z.object({
    type: z.literal("TEAM_TOTAL_SIXES_OVER_UNDER"),
    team: z.string().min(1),
    line: z.number(),
    direction: DirectionSchema,
  }),
]);

export type StatementTemplate = z.infer<typeof StatementTemplateSchema>;

export type StatementComputeResult =
  | {
      ok: true;
      template: StatementTemplate;
      probability: number; // 0..1
      explanation: string;
      modelVersion: string;
    }
  | {
      ok: false;
      template?: StatementTemplate;
      error: string;
      missing?: string[];
      supportedExamples?: string[];
    };
