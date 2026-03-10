#!/usr/bin/env node

/**
 * CLI script to export training data from imported Cricsheet matches
 * 
 * Usage:
 *   tsx scripts/exportTrainingData.ts
 *   tsx scripts/exportTrainingData.ts --featureVersion v3
 *   tsx scripts/exportTrainingData.ts --featureVersion v4
 */

import * as fs from "fs";
import * as path from "path";

function loadEnvFromFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadEnvironment(): void {
  const root = process.cwd();
  loadEnvFromFile(path.join(root, ".env.local"));
  loadEnvFromFile(path.join(root, ".env"));
}

async function main() {
  try {
    loadEnvironment();
    const { exportTrainingData } = await import("./features/buildTrainingRows");
    const result = await exportTrainingData();
    
    // Exit with 0 if successful
    process.exit(0);
  } catch (error) {
    console.error("Export failed:", error);
    process.exit(1);
  }
}

main();
