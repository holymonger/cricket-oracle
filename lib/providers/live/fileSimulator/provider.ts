/**
 * File-based live delivery simulator
 * Reads from JSON or JSONL files and replays deliveries in sequence
 * Useful for testing the full live workflow without external APIs
 */

import * as fs from "fs";
import * as path from "path";
import { LiveDeliveryProvider, LiveFetchInput, LiveFetchOutput, LiveDeliveryInput } from "../types";
import { decodeCursor, encodeCursor } from "./cursor";

type VerboseFileFormat = "unknown" | "json-array" | "jsonl";

class FileSimulatorProvider implements LiveDeliveryProvider {
  readonly name = "file-sim";
  private deliveries: LiveDeliveryInput[] = [];
  private loadError: string | null = null;

  constructor(private filePath: string) {
    this.loadDeliveries();
  }

  private loadDeliveries() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.loadError = `File not found: ${this.filePath}`;
        return;
      }

      const content = fs.readFileSync(this.filePath, "utf-8").trim();

      // Try JSONL first (each line is one object)
      if (!content.startsWith("[")) {
        const lines = content.split("\n").filter((line) => line.trim());
        this.deliveries = lines.map((line, idx) => {
          try {
            const obj = JSON.parse(line);
            return this.normalizeDelivery(obj);
          } catch (e) {
            throw new Error(`Line ${idx + 1}: ${(e as Error).message}`);
          }
        });
        return;
      }

      // Try JSON array
      const arr = JSON.parse(content);
      if (!Array.isArray(arr)) {
        throw new Error("Expected array or JSONL format");
      }

      this.deliveries = arr.map((obj, idx) => {
        try {
          return this.normalizeDelivery(obj);
        } catch (e) {
          throw new Error(`Item ${idx}: ${(e as Error).message}`);
        }
      });
    } catch (err) {
      this.loadError = `Failed to load ${this.filePath}: ${(err as Error).message}`;
    }
  }

  private normalizeDelivery(obj: Record<string, unknown>): LiveDeliveryInput {
    const delivery = obj as unknown as LiveDeliveryInput;

    // Ensure provider is set
    if (!delivery.provider) {
      delivery.provider = this.name;
    }

    // Generate providerEventId if missing
    if (!delivery.providerEventId) {
      delivery.providerEventId = `${delivery.matchId}:${delivery.innings}:${delivery.over}:${delivery.ballInOver}`;
    }

    // Validate required fields
    const required = ["matchId", "innings", "over", "ballInOver", "battingTeamName", "strikerName", "nonStrikerName", "bowlerName", "runs"];
    for (const field of required) {
      if (!(field in delivery)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate innings 2 has targetRuns
    if (delivery.innings === 2 && !delivery.targetRuns) {
      throw new Error("innings 2 delivery must have targetRuns");
    }

    return delivery;
  }

  async fetchNext(input: LiveFetchInput): Promise<LiveFetchOutput> {
    if (this.loadError) {
      throw new Error(this.loadError);
    }

    const take = input.take || 1;
    const index = decodeCursor(input.cursor);

    if (index >= this.deliveries.length) {
      return {
        deliveries: [],
        nextCursor: input.cursor,
      };
    }

    const deliveries = this.deliveries.slice(index, index + take);
    const nextIndex = Math.min(index + take, this.deliveries.length);
    const nextCursor = encodeCursor(nextIndex);

    return {
      deliveries,
      nextCursor,
    };
  }

  getStats() {
    return {
      name: this.name,
      totalDeliveries: this.deliveries.length,
      loadError: this.loadError,
    };
  }
}

/** Create a file simulator from environment variable or explicit path */
export function createFileSimulator(filePath?: string): FileSimulatorProvider {
  const resolvedPath =
    filePath ||
    process.env.LIVE_SIM_FILE ||
    process.env[`LIVE_SIM_FILE_${process.env.LIVE_SIM_MATCH_ID || ""}`] ||
    "data/live-sim/sample-match.jsonl";

  return new FileSimulatorProvider(path.resolve(process.cwd(), resolvedPath));
}

export const fileSimProviderInstance = createFileSimulator();
