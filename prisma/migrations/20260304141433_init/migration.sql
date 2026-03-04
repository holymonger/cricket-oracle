-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "teamA" TEXT NOT NULL,
    "teamB" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_state_snapshots" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "innings" INTEGER NOT NULL,
    "runs" INTEGER NOT NULL,
    "wickets" INTEGER NOT NULL,
    "balls" INTEGER NOT NULL,
    "targetRuns" INTEGER,
    "runsAfter6" INTEGER,
    "runsAfter10" INTEGER,
    "runsAfter12" INTEGER,
    "teamFours" INTEGER,
    "teamSixes" INTEGER,
    "matchFours" INTEGER,
    "matchSixes" INTEGER,

    CONSTRAINT "match_state_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predictions" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelVersion" TEXT NOT NULL,
    "winProb" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_state_snapshots_matchId_idx" ON "match_state_snapshots"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "predictions_snapshotId_key" ON "predictions"("snapshotId");

-- AddForeignKey
ALTER TABLE "match_state_snapshots" ADD CONSTRAINT "match_state_snapshots_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "match_state_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
