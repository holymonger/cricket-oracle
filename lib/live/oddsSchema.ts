/**
 * Zod validation schemas for odds ingestion
 */

import { z } from "zod";

const selectionSchema = z.object({
  teamName: z.string().min(1),
  oddsDecimal: z.number().positive(),
});

const marketSchema = z.object({
  marketName: z.string().min(1), // "mock" now, later "rollbit"/"polymarket"
  externalEventId: z.string().min(1),
  observedAt: z.string().datetime(),
  selections: z.array(selectionSchema).min(2),
});

export const oddsPollBodySchema = z.object({
  matchId: z.string().min(1),
  timestamp: z.string().datetime(),
  markets: z.array(marketSchema).min(1),
});

export type OddsPollBody = z.infer<typeof oddsPollBodySchema>;
export type Market = z.infer<typeof marketSchema>;
export type Selection = z.infer<typeof selectionSchema>;

/**
 * Validate odds poll body
 */
export function validateOddsPoll(data: unknown) {
  return oddsPollBodySchema.parse(data);
}

/**
 * Safe validation that returns result object
 */
export function safeValidateOddsPoll(data: unknown) {
  return oddsPollBodySchema.safeParse(data);
}
