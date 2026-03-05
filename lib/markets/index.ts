/**
 * Markets & Odds Module
 * 
 * SAFETY NOTICE: This system is for analysis and research only.
 * - Never place real bets automatically
 * - Always verify odds and mappings manually
 * - Edge signals are informational only
 * - Past performance does not guarantee future results
 */

// Team utilities
export { canonicalizeTeamName, teamNamesMatch } from "../teams/canonicalize";
export {
  mapTeamNameToSide,
  tryMapTeamNameToSide,
  TeamMappingError,
} from "../teams/mapToSide";

// Odds calculations
export {
  impliedProbRawFromDecimal,
  fairProbAFromTwoSidedDecimal,
  decimalOddsFromProbability,
  expectedValue,
  isPositiveEV,
} from "./decimal";

// Aggregator client
export {
  OddsAggregatorClient,
  oddsAggregatorClient,
  type AggregatorPayload,
  type AggregatorMarket,
  type AggregatorSelection,
  type OddsAggregatorConfig,
} from "../providers/oddsAggregator/client";

// Aggregator adapter
export {
  processAggregatorPayload,
  type NormalizedMarketEvent,
  type NormalizedOddsTick,
  type AdapterResult,
} from "../providers/oddsAggregator/adapter";
