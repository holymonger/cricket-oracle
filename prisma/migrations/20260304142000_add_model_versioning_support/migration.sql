-- DropIndex
DROP INDEX IF EXISTS "predictions_snapshotId_key";

-- Add battingTeam column to match_state_snapshots
ALTER TABLE "match_state_snapshots" ADD COLUMN "battingTeam" TEXT NOT NULL DEFAULT 'A';

-- CreateIndex for unique constraint on (snapshotId, modelVersion)
CREATE UNIQUE INDEX "predictions_snapshotId_modelVersion_key" ON "predictions"("snapshotId", "modelVersion");
