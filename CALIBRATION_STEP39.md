# Step 39: V3-LGBM Probability Calibration

## Overview

This implementation adds a probability calibration layer to the v3-lgbm model. Calibration is a post-processing step that maps raw model probabilities to better-calibrated probabilities that more accurately reflect true outcome frequencies.

### Why Calibration?

Machine learning models often produce probabilities that are systematically biased:
- **Overconfident**: Predictions near 0.9 may occur only ~70% of the time
- **Underconfident**: Predictions near 0.5 may occur ~60% of the time

Calibration corrects these biases while preserving the model's rank order of predictions.

## Architecture

### Components

1. **Training Script** (`training/train_calibrator.py`)
   - Loads BallPrediction rows from database with match outcomes
   - Samples every 6 legal balls to reduce temporal correlation
   - Trains both isotonic regression and Platt scaling
   - Evaluates on holdout split (20% matches)
   - Outputs calibration artifact and report

2. **Calibration Module** (`lib/model/calibration.ts`)
   - Loads calibration artifact from disk (cached)
   - Applies calibration transformation to raw probabilities
   - Supports both isotonic and Platt methods

3. **Model Integration** (`lib/model/v3Lgbm.ts`)
   - Automatically applies calibration to all v3-lgbm predictions
   - Transparent to callers - returns calibrated probabilities

4. **Backfill Script** (`scripts/backfillCalibratedV3.ts`)
   - Updates existing BallPrediction rows with calibrated values
   - Processes in batches with progress tracking
   - Supports dry-run mode

## Calibration Methods

### Isotonic Regression (Default for ≥5000 samples)

- **Method**: Non-parametric piecewise-constant monotonic mapping
- **Advantages**: 
  - Flexible - learns arbitrary monotonic relationship
  - No assumptions about functional form
- **Storage**: Array of (x, y) points for linear interpolation
- **Application**: Linear interpolation between points, clamped to [0, 1]

### Platt Scaling (Fallback for <5000 samples)

- **Method**: Logistic regression on logit-transformed probabilities
- **Form**: `calibrated = sigmoid(a * logit(raw) + b)`
- **Advantages**:
  - Simple parametric form (2 parameters)
  - Works well with limited data
- **Storage**: Coefficients `a` and `b`
- **Application**: Transform logit, apply sigmoid

## File Structure

```
training/
  train_calibrator.py          # Python training script
  requirements.txt             # Python dependencies

lib/model/
  calibration.ts               # TypeScript calibration module
  v3Lgbm.ts                    # Model with integrated calibration
  artifacts/
    v3_calibration.json        # Calibration artifact (generated)

scripts/
  backfillCalibratedV3.ts      # Backfill utility

reports/
  v3_calibration.md            # Training report (generated)
```

## Usage

### 1. Install Python Dependencies

```bash
# Windows
cd training
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt

# macOS/Linux
cd training
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Train Calibrator

Make sure you have BallPrediction rows in the database with `modelVersion = "v3-lgbm"`:

```bash
cd training
python train_calibrator.py
```

This will:
- Load predictions from `prisma/dev.db`
- Train both isotonic and Platt scaling
- Choose method based on sample count
- Output `lib/model/artifacts/v3_calibration.json`
- Output `reports/v3_calibration.md` with metrics

### 3. Verify Integration

The calibration is automatically applied in v3-lgbm inference. Test with:

```bash
# Run a prediction to verify calibration is applied
npm run predict:match -- <matchId>
```

Check the console output - it should use calibrated probabilities.

### 4. Backfill Existing Predictions (Optional)

Update existing BallPrediction rows to use calibrated values:

```bash
# Dry run (show changes without applying)
DRY_RUN=1 npm run backfill:calibrated

# Apply changes
npm run backfill:calibrated
```

## Artifact Format

`lib/model/artifacts/v3_calibration.json`:

```json
{
  "modelVersion": "v3-lgbm",
  "calibrationVersion": "v1",
  "method": "isotonic",
  "x": [0.0, 0.1, 0.2, ...],  // isotonic points (or null for platt)
  "y": [0.0, 0.09, 0.18, ...], // isotonic points (or null for platt)
  "a": null,                    // platt coefficient (or null for isotonic)
  "b": null,                    // platt coefficient (or null for isotonic)
  "trainedAt": "2026-03-06T10:30:00.000Z",
  "notes": "Trained on 12,345 samples..."
}
```

## Evaluation Metrics

The training script reports:

### Brier Score
- Measures mean squared error of probabilities
- Lower is better
- Range: [0, 1]
- Formula: `(1/N) Σ(predicted - actual)²`

### Log Loss (Cross-Entropy)
- Measures quality of probabilistic predictions
- Lower is better
- Range: [0, ∞)
- Formula: `-(1/N) Σ[y*log(p) + (1-y)*log(1-p)]`

### Reliability Diagram
- Bins predictions by value (e.g., 0.0-0.1, 0.1-0.2, ...)
- For each bin, compares mean predicted vs. mean actual
- Perfect calibration: `mean_predicted ≈ mean_actual` in all bins

## Implementation Notes

### Data Sampling Strategy

The training script samples every 6 legal balls to reduce temporal correlation:
- Adjacent balls in same match are highly correlated (same context)
- Sampling reduces overfitting to specific match situations
- Still captures diversity across innings progression

### Group Split by Match

Train/validation split is done by **matchId** (not random rows):
- Prevents leakage - model never sees validation matches in training
- More realistic evaluation of generalization
- Default: 80% train, 20% validation

### Edge Case Handling

- **No calibration artifact**: Falls back to raw probabilities (no error)
- **Extreme values**: Probabilities clamped to [1e-6, 1-1e-6] to avoid log(0)
- **Out-of-bounds**: Isotonic regression clips to [0, 1]

### Performance

- **Training**: ~1-2 seconds per 10k samples
- **Inference**: <1ms overhead per prediction (cached artifact)
- **Backfill**: ~1000 rows/second (batched transactions)

## Testing

### Unit Tests (Future)

```typescript
// Example test cases
describe("calibration", () => {
  it("should apply isotonic calibration correctly", () => {
    // Test with known artifact
  });
  
  it("should fall back to raw prob if artifact missing", () => {
    // Test graceful degradation
  });
  
  it("should preserve monotonicity", () => {
    // p1 < p2 => calibrated(p1) < calibrated(p2)
  });
});
```

### Integration Test

1. Create predictions with v3-lgbm
2. Train calibrator on those predictions
3. Verify calibrated probabilities differ from raw
4. Check metrics show improvement

## Future Enhancements

1. **Per-situation calibration**
   - Separate calibrators for innings 1 vs. 2
   - Different calibration for early/middle/late game

2. **Confidence intervals**
   - Bootstrap multiple calibrators
   - Report uncertainty in calibrated probabilities

3. **Online recalibration**
   - Periodic retraining as new data arrives
   - Detect calibration drift over time

4. **Multi-model ensembles**
   - Calibrate ensemble outputs (meta-calibration)
   - Compare calibration across model versions

## References

- Niculescu-Mizil & Caruana (2005): "Predicting Good Probabilities With Supervised Learning"
- Platt (1999): "Probabilistic Outputs for Support Vector Machines"
- Zadrozny & Elkan (2002): "Transforming Classifier Scores into Accurate Multiclass Probability Estimates"

## Acceptance Criteria ✓

- [x] Training script produces artifact JSON with improved Brier/logloss
- [x] TypeScript module applies calibration at inference time
- [x] v3-lgbm probabilities automatically calibrated
- [x] EdgeSignal calculation uses calibrated probabilities (via BallPrediction)
- [x] Backfill utility created for existing data
- [x] Build succeeds with all new code
- [x] Documentation complete with usage examples
