/**
 * Zod validation schemas for real-time delivery events
 */

import { z } from "zod";

export const TeamSideSchema = z.enum(["A", "B"]);

export const ExtrasSchema = z
  .object({
    wides: z.number().int().nonnegative().optional(),
    noballs: z.number().int().nonnegative().optional(),
    byes: z.number().int().nonnegative().optional(),
    legbyes: z.number().int().nonnegative().optional(),
  })
  .strict()
  .optional();

export const WicketSchema = z.object({
  playerOut: z.string().min(1),
  kind: z.string().min(1),
  fielders: z.array(z.string()).optional(),
});

export const CanonicalDeliveryEventSchema = z
  .object({
    matchId: z.string().min(1),
    provider: z.string().min(1),
    providerEventId: z.string().min(1),
    innings: z.union([z.literal(1), z.literal(2)]),
    over: z.number().int().nonnegative(),
    ballInOver: z.number().int().positive(),
    battingTeam: TeamSideSchema,
    striker: z.string().min(1),
    nonStriker: z.string().min(1),
    bowler: z.string().min(1),
    runsBat: z.number().int().nonnegative(),
    runsExtras: z.number().int().nonnegative(),
    runsTotal: z.number().int().nonnegative(),
    extras: ExtrasSchema,
    wickets: z.array(WicketSchema).optional(),
    isWide: z.boolean(),
    isNoBall: z.boolean(),
    isLegal: z.boolean(),
    targetRuns: z.number().int().positive().optional(),
    occurredAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((data) => data.runsTotal === data.runsBat + data.runsExtras, {
    message: "runsTotal must equal runsBat + runsExtras",
    path: ["runsTotal"],
  })
  .refine((data) => data.isLegal === !data.isWide && !data.isNoBall, {
    message: "isLegal must be true only when both isWide and isNoBall are false",
    path: ["isLegal"],
  });

export const FetchEventsResultSchema = z.object({
  events: z.array(CanonicalDeliveryEventSchema),
  nextCursor: z.string().optional(),
});

/**
 * Validate a canonical delivery event
 */
export function validateDeliveryEvent(event: unknown) {
  return CanonicalDeliveryEventSchema.parse(event);
}

/**
 * Safe validation that returns result object
 */
export function safeValidateDeliveryEvent(event: unknown) {
  return CanonicalDeliveryEventSchema.safeParse(event);
}
