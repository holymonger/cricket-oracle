/**
 * Backfill calibrated probabilities for existing v3-lgbm BallPrediction rows.
 * 
 * This script:
 * 1. Loads all v3-lgbm predictions from database
 * 2. Applies calibration to the stored teamAWinProb
 * 3. Updates each row with the calibrated probability
 * 
 * Usage:
 *   npm run backfill:calibrated
 * 
 * Environment:
 *   DRY_RUN=1  # Show changes without applying them
 */

import { PrismaClient } from "@prisma/client";
import { calibrateProb, hasCalibration, getCalibrationInfo } from "../lib/model/calibration";

const prisma = new PrismaClient();

const MODEL_VERSION = "v3-lgbm";
const DRY_RUN = process.env.DRY_RUN === "1";
const BATCH_SIZE = 1000;

async function main() {
  console.log("=" .repeat(60));
  console.log("Backfill Calibrated Probabilities");
  console.log("=" .repeat(60));
  console.log();

  // Check calibration availability
  if (!hasCalibration(MODEL_VERSION)) {
    console.error(`ERROR: No calibration artifact found for ${MODEL_VERSION}`);
    console.error("Run training/train_calibrator.py first to generate the artifact.");
    process.exit(1);
  }

  const calibInfo = getCalibrationInfo(MODEL_VERSION);
  console.log("Calibration Info:");
  console.log(`  Method: ${calibInfo.method}`);
  console.log(`  Trained at: ${calibInfo.trainedAt}`);
  console.log(`  Notes: ${calibInfo.notes || "N/A"}`);
  console.log();

  if (DRY_RUN) {
    console.log("⚠️  DRY RUN MODE - No changes will be saved");
    console.log();
  }

  // Count total rows
  const totalCount = await prisma.ballPrediction.count({
    where: { modelVersion: MODEL_VERSION },
  });

  console.log(`Found ${totalCount.toLocaleString()} predictions to calibrate`);
  console.log();

  if (totalCount === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  let processedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  // Process in batches
  let skip = 0;
  while (skip < totalCount) {
    const batch = await prisma.ballPrediction.findMany({
      where: { modelVersion: MODEL_VERSION },
      select: {
        id: true,
        teamAWinProb: true,
      },
      skip,
      take: BATCH_SIZE,
      orderBy: { id: "asc" },
    });

    if (!DRY_RUN) {
      // Update each prediction in transaction
      const updates = batch.map((pred) => {
        try {
          const rawProb = pred.teamAWinProb;
          const calibratedProb = calibrateProb(rawProb, MODEL_VERSION);

          // Only update if value changed (avoid unnecessary writes)
          const changed = Math.abs(calibratedProb - rawProb) > 1e-9;

          if (changed) {
            return prisma.ballPrediction.update({
              where: { id: pred.id },
              data: { teamAWinProb: calibratedProb },
            });
          } else {
            return null;
          }
        } catch (error) {
          console.error(`Error processing prediction ${pred.id}:`, error);
          errorCount++;
          return null;
        }
      }).filter(Boolean);

      try {
        await prisma.$transaction(updates as any[]);
        updatedCount += updates.length;
      } catch (error) {
        console.error(`Error updating batch:`, error);
        errorCount += batch.length;
      }
    } else {
      // Dry run: just show a sample
      if (skip === 0) {
        console.log("Sample calibration results (first 5):");
        console.log();
        for (let i = 0; i < Math.min(5, batch.length); i++) {
          const pred = batch[i];
          const rawProb = pred.teamAWinProb;
          const calibratedProb = calibrateProb(rawProb, MODEL_VERSION);
          const delta = calibratedProb - rawProb;
          console.log(
            `  ${pred.id.substring(0, 12)}... : ${rawProb.toFixed(6)} → ${calibratedProb.toFixed(6)} (Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(6)})`
          );
        }
        console.log();
      }
      updatedCount += batch.length;
    }

    processedCount += batch.length;
    skip += BATCH_SIZE;

    // Progress update
    const progress = ((processedCount / totalCount) * 100).toFixed(1);
    process.stdout.write(`\rProgress: ${processedCount.toLocaleString()} / ${totalCount.toLocaleString()} (${progress}%)`);
  }

  console.log();
  console.log();
  console.log("=" .repeat(60));
  console.log("Summary");
  console.log("=" .repeat(60));
  console.log(`Total processed: ${processedCount.toLocaleString()}`);
  console.log(`Updated: ${updatedCount.toLocaleString()}`);
  console.log(`Errors: ${errorCount.toLocaleString()}`);
  
  if (DRY_RUN) {
    console.log();
    console.log("DRY RUN complete. Run without DRY_RUN=1 to apply changes.");
  } else {
    console.log();
    console.log("✓ Backfill complete!");
  }
}

main()
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
