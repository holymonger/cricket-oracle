/**
 * Odds Aggregator API Client
 * Fetches odds from external aggregator service
 */

/**
 * Raw selection from aggregator API
 */
export interface AggregatorSelection {
  teamName: string;
  oddsDecimal: number;
}

/**
 * Raw market data from aggregator API
 */
export interface AggregatorMarket {
  marketName: string;          // e.g. "rollbit", "polymarket"
  externalEventId: string;      // market's unique identifier
  observedAt: string;           // ISO 8601 timestamp
  selections: AggregatorSelection[];
}

/**
 * Full payload from aggregator API
 */
export interface AggregatorPayload {
  matchId: string;
  markets: AggregatorMarket[];
  timestamp: string;            // ISO 8601 timestamp
}

/**
 * Configuration for odds aggregator client
 */
export interface OddsAggregatorConfig {
  url?: string;
  apiKey?: string;
}

/**
 * Odds Aggregator Client
 */
export class OddsAggregatorClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(config?: OddsAggregatorConfig) {
    this.baseUrl =
      config?.url ||
      process.env.ODDS_AGGREGATOR_URL ||
      "http://localhost:3001";
    this.apiKey = config?.apiKey || process.env.ODDS_AGGREGATOR_KEY;
  }

  /**
   * Fetch odds for a specific match
   * 
   * @param match - Match details
   * @returns Aggregator payload with odds from multiple markets
   */
  async fetchOddsForMatch(match: {
    id: string;
    teamA: string;
    teamB: string;
  }): Promise<AggregatorPayload> {
    const url = `${this.baseUrl}/api/odds/${match.id}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Aggregator API error (${response.status}): ${errorText}`
        );
      }

      const data = await response.json();
      return data as AggregatorPayload;
    } catch (error: any) {
      if (error.code === "ECONNREFUSED") {
        throw new Error(
          `Cannot connect to odds aggregator at ${this.baseUrl}. ` +
            `Is the service running?`
        );
      }
      throw error;
    }
  }

  /**
   * Health check for aggregator service
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Singleton client instance
 */
export const oddsAggregatorClient = new OddsAggregatorClient();
