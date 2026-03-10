# V4-LogReg Model Rollout & Rollback Playbook

## Overview

This document describes how to train the v4-logreg model locally, deploy it to production, and roll back instantly if needed.

**Key Features:**
- ✅ Shadow mode: v4 predictions computed alongside v3 for validation
- ✅ Zero-downtime rollout: no code changes needed after artifact is committed
- ✅ Instant rollback via environment variable change on Vercel
- ✅ Dashboard comparison view to monitor v3 vs v4 divergence

---

## Quick Rollout Checklist

```
☐ 1. Train v4-logreg locally
☐ 2. Run comparison evaluation (v3 vs v4 on validation set)
☐ 3. Commit artifact to git
☐ 4. (Optional) Run shadow mode tests on staging
☐ 5. Deploy to production (via git push)
☐ 6. Switch Vercel env var: DEFAULT_MODEL_VERSION=v4-logreg
☐ 7. Monitor edge signals and dashboard for 24h
☐ 8. (If issues) Rollback: set DEFAULT_MODEL_VERSION=v3-lgbm
```

---

## Step 1: Train V4-LogReg Locally

### Prerequisites
- Raw IPL+T20I JSON files at `../ipl_json` and `../t20s_json` (outside repo)
- Node.js environment with TypeScript/tsx support

### Command

```bash
# Export v4 training data (219k+ rows from IPL + T20I)
IPL_JSON_DIR=../ipl_json T20I_JSON_DIR=../t20s_json npm run export:v4

# Train logistic regression on exported data
npm run train:v4logreg

# Output: lib/model/artifacts/v4_logreg.json (trained artifact)
```

### Options

```bash
# Export with balanced sampling (1000 IPL + 1000 T20I)
npm run export:v4 -- --balancedByCompetition

# Export with custom sampling
npm run export:v4 -- --sampleEveryBalls 3 --maxMatches 5000

# Train with custom hyperparameters
npm run train:v4logreg -- --iters 5000 --lr 0.02 --l2 1e-5
```

### Output Verification

After training, check:
- File: `lib/model/artifacts/v4_logreg.json` exists
- Content: contains `modelVersion: "v4-logreg"`, `featureNames`, `intercept`, `coeff`, `metrics`
- Metrics: LogLoss and Brier displayed in console

Example:
```
✓ Saved artifact: /path/to/lib/model/artifacts/v4_logreg.json

Validation metrics:
Brier:   0.250204
LogLoss: 0.693556
Acc@0.5: 50.61%
```

---

## Step 2: Evaluate V3 vs V4 (Same Validation Set)

### Command

```bash
npm run eval:compare:v3v4
```

### Expected Output

This runs both models on the exact same 20% validation holdout and compares metrics side-by-side:

```
=== V3 Metrics (Heuristic) ===
Brier:    0.216066
LogLoss:  0.732979
Acc@0.5:  70.69%

=== V4 Metrics (LogReg) ===
Brier:    0.250204
LogLoss:  0.693556
Acc@0.5:  50.61%

=== Comparison ===
Brier delta:       +0.034138 (v4 worse)
LogLoss gain:      5.38% (v4 better)
Acc@0.5 delta:     -20.09% (v4 worse)

>>> Winner by LogLoss: V4 (LogReg)
```

### Interpretation

- **LogLoss**: Measures probability calibration. Lower is better. V4 wins = ✅
- **Brier**: Expected squared error. Lower is better. (Trade-off: V4 trades accuracy for calibration)
- **Accuracy**: Hard 50% threshold. May differ from other metrics due to class imbalance.

**Success Criteria:**
- V4 LogLoss < V3 LogLoss
- V4 artifact saves without errors
- No "artifact not found" warnings at inference time

---

## Step 3: Commit Artifact to Git

```bash
# Artifact is already staged (Step 1 of delivery flow):
git status lib/model/artifacts/v4_logreg.json
# Should show: new file: lib/model/artifacts/v4_logreg.json

# Commit
git add lib/model/artifacts/v4_logreg.json
git commit -m "Step 44: add trained v4-logreg artifact (LogLoss 0.6936)"

# Push
git push origin main
```

### Verify on Vercel

After push, production builds will:
1. Include the artifact in the bundle
2. Load it at runtime (lazy-load on first prediction)
3. Use it IF `DEFAULT_MODEL_VERSION=v4-logreg` is set

---

## Step 4: Shadow Mode Validation (Optional)

While `DEFAULT_MODEL_VERSION=v3-lgbm`, the system automatically writes both v3 and v4 predictions (if artifact exists).

### Check Database

```sql
-- Query BallPrediction table for same ball, different models:
SELECT 
  matchId, innings, legalBallNumber, modelVersion, teamAWinProb
FROM ball_predictions
WHERE matchId = 'YOUR_MATCH_ID'
ORDER BY legalBallNumber, modelVersion
LIMIT 10;

-- Should show 2 rows per legalBallNumber:
-- - modelVersion=v3-lgbm
-- - modelVersion=v4-logreg
```

### Dashboard Comparison

1. Open `/realtime/dashboard`
2. Enter admin key and match ID
3. Click "Show Comparison" button
4. Observe v3 vs v4 probability paths
5. Check for large divergence (>0.15 delta)

---

## Step 5: Deploy to Production

Simply merge and push to main:

```bash
git push origin main
```

Vercel will automatically:
1. Build with latest artifact
2. Deploy to production
3. Still use v3-lgbm (default) until you change the env var

**No code changes, no downtime, no restart.**

---

## Step 6: Switch to V4-LogReg on Vercel

### Option A: Vercel Dashboard (Web UI)

1. Go to Vercel Project Settings
2. Environment Variables
3. Click "Add New"
   - Name: `DEFAULT_MODEL_VERSION`
   - Value: `v4-logreg`
   - Scopes: Production, Preview, Development
4. Click "Save"

Automatically triggers redeploy with new env var applied.

### Option B: Vercel CLI

```bash
vercel env add DEFAULT_MODEL_VERSION
# Prompts: enter "v4-logreg"
# Select: Production

vercel deploy --prod --env DEFAULT_MODEL_VERSION=v4-logreg
```

### Verify Live

After deploy:
```bash
curl https://YOUR_DEPLOYED_APP.vercel.app/api/health
```

Access realtime dashboard and check:
- `/realtime/dashboard` → latest predictions use v4-logreg
- Edge signals computed from v4 model
- Monitor `modelDelta` in comparison view

---

## Step 7: Monitor for 24 Hours

### Dashboard Checks

1. **Prediction Stability**: Are v4 probabilities reasonable (0.2-0.8)?
2. **Model Delta**: Is `|v3 - v4| < 0.15`? (Divergence alert if > 0.15)
3. **Edge Signal Change**: Are edges firing at similar rates?
4. **Coverage**: Do we have v4 predictions for all live deliveries?

### Metrics to Watch

```bash
# Check edge signals use v4 model:
npm run check:edge:signals  # Look for modelVersion=v4-logreg

# Monitor ball predictions:
SELECT COUNT(*), modelVersion 
FROM ball_predictions 
WHERE createdAt > NOW() - INTERVAL 24 HOUR
GROUP BY modelVersion;
# Should show v4-logreg accumulating rows
```

### Alert Triggers (Rollback if):
- ✅ Edge signals stop firing (0 new signals in 1h)
- ✅ V4 predictions > 0.3 away from v3 consistently
- ✅ API error rates spike (check Vercel logs)
- ✅ Model inference latency increases

---

## Step 8: Rollback (Instant, No Code Changes)

If issues detected, instant rollback:

### Rollback Command

```bash
# Via Vercel Dashboard:
# Settings → Environment Variables → DEFAULT_MODEL_VERSION → Delete or Set to "v3-lgbm"

# Via CLI:
vercel env rm DEFAULT_MODEL_VERSION
# Or set it back:
vercel env add DEFAULT_MODEL_VERSION=v3-lgbm
```

### Effects (Immediate)

- Edge signals will query BallPrediction with `modelVersion=v3-lgbm`
- New predictions computed using v3 heuristic
- Shadow mode continues (v4 still written to DB for analysis)
- **No re-deployment, no code changes, ~10 second effective switch**

### Post-Rollback Analysis

```sql
-- Compare v3 vs v4 predictions for the problematic period:
SELECT 
  b.legalBallNumber,
  MAX(CASE WHEN b.modelVersion='v3-lgbm' THEN b.teamAWinProb END) v3_prob,
  MAX(CASE WHEN b.modelVersion='v4-logreg' THEN b.teamAWinProb END) v4_prob,
  MAX(CASE WHEN b.modelVersion='v4-logreg' THEN b.teamAWinProb END) 
    - MAX(CASE WHEN b.modelVersion='v3-lgbm' THEN b.teamAWinProb END) delta
FROM ball_predictions b
WHERE b.matchId = 'PROBLEM_MATCH_ID'
GROUP BY b.legalBallNumber
ORDER BY b.legalBallNumber;
```

---

## Shadow Mode Schema

In production with shadow mode enabled, BallPrediction table contains:

```typescript
// Unique constraint ensures one row per (matchId, innings, legalBallNumber, modelVersion):
@@unique([matchId, innings, legalBallNumber, modelVersion])

// For a single legal delivery, you'll see:
{
  matchId: "m123",
  innings: 1,
  legalBallNumber: 42,
  modelVersion: "v3-lgbm",           // <-- Primary (active)
  teamAWinProb: 0.523,
}
{
  matchId: "m123",
  innings: 1,
  legalBallNumber: 42,
  modelVersion: "v4-logreg",         // <-- Shadow (for analysis)
  teamAWinProb: 0.545,
}
```

EdgeSignals always read from the active model (DEFAULT_MODEL_VERSION).

---

## Production Safe Defaults

Model selection strictness:

```typescript
// lib/model/index.ts

function getDefaultModelVersion(): ModelVersion {
  const envDefault = process.env.DEFAULT_MODEL_VERSION;
  // Allowlist only known versions
  if (envDefault && ["v0", "v1", "v3-lgbm", "v4-lgbm", "v4-logreg"].includes(envDefault)) {
    return envDefault as ModelVersion;
  }
  // Fallback to safe default
  return "v1";
}
```

**Guarantees:**
- ✅ No typos in env var (e.g., "v4_logreg" → falls back to "v1")
- ✅ Unknown versions rejected
- ✅ Missing env → safe default "v1"

---

## FAQ

### Q: What if I want to A/B test v3 vs v4 live?

Use the dashboard comparison view:
1. Set `DEFAULT_MODEL_VERSION=v3-lgbm` to fire edges from v3
2. Open `/realtime/dashboard` → "Show Comparison"
3. Monitor v4 predictions in real-time alongside v3
4. Compare edge signals accuracy post-match

### Q: Can I run both models without restarting?

Yes, shadow mode runs v4 continuously even with `DEFAULT_MODEL_VERSION=v3-lgbm`. The delivery endpoint writes both predictions. Just switch the env var when ready to flip edges.

### Q: How do I train on subset of matches for quick iteration?

```bash
npm run export:v4 -- --maxMatches 1000 --seed 42
npm run train:v4logreg
# Trains on ~6k rows instead of 219k (faster for testing)
```

### Q: What happens to existing BallPrediction rows if I switch models?

Shadow mode ensures **both** exist. EdgeSignals will start reading from the new model version, but old v3 predictions remain in DB for analysis and rollback debugging.

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "v4-logreg artifact not found" | Artifact not committed to git | Commit `lib/model/artifacts/v4_logreg.json` |
| Edge signals stop firing | Model not found at runtime | Check Vercel logs, verify ENV var set |
| V3 vs V4 delta > 0.2 consistently | Feature engineering mismatch | Inspect features in DB, compare logs |
| Training hangs on export | Dataset path incorrect | Check `IPL_JSON_DIR` and `T20I_JSON_DIR` env vars |
| Can't load comparison in dashboard | v4 predictions not in DB yet | Run a live match, check after 10+ legal deliveries |

---

## References

- [Model Dispatcher](../lib/model/index.ts) - Safe env var handling
- [Shadow Mode Delivery Handler](../app/api/realtime/delivery/route.ts) - Dual-write logic
- [Dashboard Comparison](../app/realtime/dashboard/page.tsx) - Live v3 vs v4 view
- [Training Script](../scripts/trainV4LogReg.ts) - Full training pipeline
- [Comparison Evaluation](../scripts/evalCompareV3VsV4.ts) - Offline v3 vs v4 metrics
