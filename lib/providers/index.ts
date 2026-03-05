/**
 * Provider registry - central place to access all live providers
 */

import type { LiveProvider, ProviderRegistry } from "./types";
import { cricsheetReplayProvider } from "./cricsheetReplay/provider";

/**
 * Registry of all available providers
 */
export const providers: ProviderRegistry = {
  "cricsheet-replay": cricsheetReplayProvider,
};

/**
 * Get provider by name
 * @throws Error if provider not found
 */
export function getProvider(name: string): LiveProvider {
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Provider "${name}" not found. Available: ${Object.keys(providers).join(", ")}`
    );
  }
  return provider;
}

/**
 * List all available provider names
 */
export function listProviders(): string[] {
  return Object.keys(providers);
}
