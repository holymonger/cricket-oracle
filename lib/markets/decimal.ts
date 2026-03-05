/**
 * Decimal odds utilities
 * Convert between decimal odds, implied probabilities, and fair probabilities
 */

export function impliedProbRawFromDecimal(odds: number): number {
  if (!Number.isFinite(odds) || odds <= 1) throw new Error(`Invalid decimal odds: ${odds}`);
  return 1 / odds;
}

export function fairProbAFromTwoSidedDecimal(oddsA: number, oddsB: number) {
  const pA_raw = impliedProbRawFromDecimal(oddsA);
  const pB_raw = impliedProbRawFromDecimal(oddsB);
  const overround = pA_raw + pB_raw;
  return {
    pA_raw,
    pB_raw,
    overround,
    pA_fair: pA_raw / overround,
    pB_fair: pB_raw / overround,
  };
}

/**
 * Convert probability back to decimal odds
 * 
 * @param probability - Win probability (0-1)
 * @returns Decimal odds
 */
export function decimalOddsFromProbability(probability: number): number {
  if (probability <= 0 || probability >= 1) {
    throw new Error(
      `Invalid probability: ${probability}. Must be between 0 and 1 (exclusive).`
    );
  }
  return 1 / probability;
}

/**
 * Compute expected value (EV) of a bet
 * 
 * EV = (winProb * profit) - (loseProb * stake)
 * With stake normalized to 1:
 * EV = (winProb * (odds - 1)) - (1 - winProb)
 *    = winProb * odds - 1
 * 
 * @param trueProbability - Your estimated true win probability
 * @param oddsDecimal - Market odds
 * @returns Expected value per unit stake (positive = +EV)
 */
export function expectedValue(
  trueProbability: number,
  oddsDecimal: number
): number {
  if (trueProbability <= 0 || trueProbability >= 1) {
    throw new Error(
      `Invalid probability: ${trueProbability}. Must be between 0 and 1.`
    );
  }
  if (oddsDecimal <= 1) {
    throw new Error(`Invalid odds: ${oddsDecimal}. Must be > 1.`);
  }

  return trueProbability * oddsDecimal - 1;
}

/**
 * Check if a bet has positive expected value
 */
export function isPositiveEV(trueProbability: number, oddsDecimal: number): boolean {
  return expectedValue(trueProbability, oddsDecimal) > 0;
}
