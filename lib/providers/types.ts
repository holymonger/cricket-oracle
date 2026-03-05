/**
 * Provider interface for real-time cricket data feeds
 * Allows pluggable data sources (Cricsheet replay, Cricbuzz live, etc.)
 */

import type { CanonicalDeliveryEvent, FetchEventsResult } from "../live/types";

/**
 * Input for fetching new events from provider
 */
export interface FetchEventsInput {
  /** Match identifier in our system */
  matchId: string;

  /** Opaque cursor from previous fetch (provider-specific) */
  cursor?: string;

  /** Maximum number of events to return (provider may ignore) */
  limit?: number;
}

/**
 * Live provider interface - must be implemented by all data sources
 */
export interface LiveProvider {
  /** Provider name (unique identifier) */
  readonly name: string;

  /** Optional: List currently live matches */
  listLiveMatches?(): Promise<Array<{
    matchId: string;
    title: string;
    status: string;
  }>>;

  /**
   * Fetch new events since cursor
   * Returns events in chronological order with next cursor
   */
  fetchNewEvents(input: FetchEventsInput): Promise<FetchEventsResult>;

  /**
   * Optional: Initialize provider resources
   */
  initialize?(): Promise<void>;

  /**
   * Optional: Cleanup provider resources
   */
  cleanup?(): Promise<void>;
}

/**
 * Registry of available providers
 */
export interface ProviderRegistry {
  [providerName: string]: LiveProvider;
}
