/**
 * Probability calibration for v3-lgbm model.
 * 
 * Loads pre-trained calibration artifact and applies post-processing
 * to raw model probabilities.
 */

import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";

interface CalibrationArtifact {
  modelVersion: string;
  calibrationVersion: string;
  method: "isotonic" | "platt" | "temperature";
  x?: number[];  // isotonic points
  y?: number[];  // isotonic points
  a?: number;    // platt coefficient
  b?: number;    // platt coefficient
  temperature?: number; // temperature-scaling parameter
  trainedAt: string;
  notes: string;
}

const cachedArtifacts = new Map<string, CalibrationArtifact | null>();

/**
 * Resolve artifact path - try multiple locations for robustness.
 */
function resolveArtifactPath(modelVersion: string): string | null {
  const filename =
    modelVersion === "v42-logreg"
      ? "v42_temp_calibration.json"
      : `${modelVersion.split("-")[0]}_calibration.json`;
  
  // Try multiple possible locations
  const possiblePaths = [
    // Relative to this file (for dev/build)
    join(__dirname, "artifacts", filename),
    // Relative to project root (for scripts)
    join(process.cwd(), "lib", "model", "artifacts", filename),
    // Alternative: resolve from __dirname upward
    resolve(__dirname, "artifacts", filename),
    resolve(__dirname, "..", "..", "lib", "model", "artifacts", filename),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

/**
 * Load calibration artifact from disk (cached after first load).
 */
function loadArtifact(modelVersion: string): CalibrationArtifact | null {
  if (cachedArtifacts.has(modelVersion)) {
    return cachedArtifacts.get(modelVersion) ?? null;
  }

  const artifactPath = resolveArtifactPath(modelVersion);
  
  if (!artifactPath) {
    // Artifact not found - calibration not available
    cachedArtifacts.set(modelVersion, null);
    return null;
  }

  try {
    const content = readFileSync(artifactPath, "utf-8");
    const parsed = JSON.parse(content) as CalibrationArtifact;
    cachedArtifacts.set(modelVersion, parsed);
    return parsed;
  } catch (error) {
    // Invalid JSON or read error
    console.warn(`Failed to load calibration artifact: ${error}`);
    cachedArtifacts.set(modelVersion, null);
    return null;
  }
}

/**
 * Apply isotonic calibration via linear interpolation.
 */
function applyIsotonic(
  raw: number,
  xPoints: number[],
  yPoints: number[]
): number {
  // Clamp to valid range
  const clamped = Math.max(0, Math.min(1, raw));

  // Find the two points to interpolate between
  for (let i = 0; i < xPoints.length - 1; i++) {
    if (clamped >= xPoints[i] && clamped <= xPoints[i + 1]) {
      // Linear interpolation
      const t = (clamped - xPoints[i]) / (xPoints[i + 1] - xPoints[i]);
      return yPoints[i] + t * (yPoints[i + 1] - yPoints[i]);
    }
  }

  // Out of bounds: use closest point
  if (clamped < xPoints[0]) {
    return yPoints[0];
  } else {
    return yPoints[yPoints.length - 1];
  }
}

/**
 * Sigmoid function.
 */
function sigmoid(z: number): number {
  return 1.0 / (1.0 + Math.exp(-z));
}

/**
 * Logit function with epsilon clamping.
 */
function logit(p: number, eps = 1e-6): number {
  const clamped = Math.max(eps, Math.min(1 - eps, p));
  return Math.log(clamped / (1 - clamped));
}

/**
 * Apply Platt scaling calibration.
 */
function applyPlatt(raw: number, a: number, b: number): number {
  const eps = 1e-6;
  const clamped = Math.max(eps, Math.min(1 - eps, raw));
  const logitRaw = logit(clamped, eps);
  return sigmoid(a * logitRaw + b);
}

function applyTemperature(raw: number, temperature: number): number {
  const t = Math.max(0.5, Math.min(5, temperature));
  return sigmoid(logit(raw) / t);
}

/**
 * Calibrate a raw probability using the trained calibrator.
 * 
 * @param raw - Raw probability from model (0.0 to 1.0)
 * @param modelVersion - Model version (e.g. "v3-lgbm")
 * @returns Calibrated probability, or raw if calibration not available
 */
export function calibrateProb(raw: number, modelVersion: string): number {
  const artifact = loadArtifact(modelVersion);

  if (!artifact) {
    // No calibration available - return raw
    return raw;
  }

  if (artifact.method === "isotonic") {
    if (!artifact.x || !artifact.y) {
      console.warn("Isotonic artifact missing x/y points");
      return raw;
    }
    return applyIsotonic(raw, artifact.x, artifact.y);
  } else if (artifact.method === "platt") {
    if (artifact.a === undefined || artifact.b === undefined) {
      console.warn("Platt artifact missing a/b coefficients");
      return raw;
    }
    return applyPlatt(raw, artifact.a, artifact.b);
  } else if (artifact.method === "temperature") {
    if (artifact.temperature === undefined || !Number.isFinite(artifact.temperature)) {
      console.warn("Temperature artifact missing temperature value");
      return raw;
    }
    return applyTemperature(raw, artifact.temperature);
  } else {
    console.warn(`Unknown calibration method: ${artifact.method}`);
    return raw;
  }
}

/**
 * Check if calibration is available for a model version.
 */
export function hasCalibration(modelVersion: string): boolean {
  return loadArtifact(modelVersion) !== null;
}

/**
 * Get calibration info (for debugging/logging).
 */
export function getCalibrationInfo(modelVersion: string): {
  available: boolean;
  method?: string;
  trainedAt?: string;
  notes?: string;
} {
  const artifact = loadArtifact(modelVersion);
  
  if (!artifact) {
    return { available: false };
  }

  return {
    available: true,
    method: artifact.method,
    trainedAt: artifact.trainedAt,
    notes: artifact.notes,
  };
}
