#!/usr/bin/env python3
"""
Train a LightGBM binary classifier for T20 cricket win probability.

Reads the v43 stratified training JSONL, trains LightGBM with early stopping,
dumps the model as JSON (for TypeScript inference), and reports eval metrics.

Usage:
    pip install lightgbm numpy scikit-learn
    python scripts/trainLightGBM.py

Output:
    lib/model/artifacts/v5_lgbm.json   -- model artifact (TypeScript reads this)
    reports/v5_lgbm_eval.txt           -- eval report
"""

import json
import sys
import random
import math
import argparse
from pathlib import Path

try:
    import numpy as np
    import lightgbm as lgb
    from sklearn.metrics import brier_score_loss, log_loss
    from sklearn.model_selection import GroupShuffleSplit
except ImportError:
    print("Missing dependencies. Run: pip install lightgbm numpy scikit-learn")
    sys.exit(1)

ROOT = Path(__file__).parent.parent

parser = argparse.ArgumentParser(description="Train LightGBM T20 win-probability model")
parser.add_argument("--data", type=str, default=None, help="Path to training JSONL (default: training/training_rows_v43_stratified.jsonl)")
parser.add_argument("--out", type=str, default=None, help="Path for output model JSON (default: lib/model/artifacts/v5_lgbm.json)")
_args = parser.parse_args()

DATA_PATH = Path(_args.data) if _args.data else ROOT / "training" / "training_rows_v43_stratified.jsonl"
OUTPUT_MODEL = Path(_args.out) if _args.out else ROOT / "lib" / "model" / "artifacts" / "v5_lgbm.json"
# Derive eval report name from model output path
OUTPUT_REPORT = OUTPUT_MODEL.parent / (OUTPUT_MODEL.stem + "_eval.txt")

RANDOM_STATE = 42
VAL_FRACTION = 0.2

print(f"Loading training data from {DATA_PATH}...")

rows = []
with open(DATA_PATH, "r") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))

print(f"Loaded {len(rows):,} rows")

# Extract feature names — rows have a nested "features" sub-object
first_row = rows[0]
if "features" in first_row and isinstance(first_row["features"], dict):
    feature_names = list(first_row["features"].keys())
    def get_features(r): return r["features"]
else:
    META_FIELDS = {"matchKey", "y", "innings", "legalBall", "matchId", "weight", "sampleWeight",
                   "competition", "ballKey", "legalBallNumber", "battingTeam"}
    feature_names = [k for k in first_row.keys() if k not in META_FIELDS]
    def get_features(r): return r

print(f"Features ({len(feature_names)}): {feature_names[:10]}...")

# Build arrays
match_keys = [r.get("matchKey", r.get("matchId", str(i))) for i, r in enumerate(rows)]
X = np.array([[get_features(r).get(f, 0.0) for f in feature_names] for r in rows], dtype=np.float32)
y = np.array([r["y"] for r in rows], dtype=np.float32)
groups = np.array([str(mk) for mk in match_keys])

print(f"X shape: {X.shape}, positive rate: {y.mean():.3f}")

# Train/val split by match (no data leakage)
unique_matches = np.unique(groups)
rng = random.Random(RANDOM_STATE)
rng.shuffle(list(unique_matches))
n_val = int(len(unique_matches) * VAL_FRACTION)
val_matches = set(list(unique_matches)[:n_val])

train_mask = np.array([g not in val_matches for g in groups])
val_mask = ~train_mask

X_train, y_train = X[train_mask], y[train_mask]
X_val, y_val = X[val_mask], y[val_mask]

print(f"Train: {len(X_train):,} rows ({train_mask.sum()} samples, {len(unique_matches)-n_val} matches)")
print(f"Val:   {len(X_val):,} rows ({val_mask.sum()} samples, {n_val} matches)")

# LightGBM training
train_data = lgb.Dataset(X_train, label=y_train, feature_name=feature_names)
val_data = lgb.Dataset(X_val, label=y_val, feature_name=feature_names, reference=train_data)

params = {
    "objective": "binary",
    "metric": ["binary_logloss", "binary_error"],
    "boosting_type": "gbdt",
    "num_leaves": 63,
    "max_depth": -1,
    "learning_rate": 0.05,
    "n_estimators": 1000,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "min_child_samples": 50,
    "lambda_l1": 0.1,
    "lambda_l2": 1.0,
    "scale_pos_weight": 1.0,
    "verbose": -1,
    "seed": RANDOM_STATE,
}

print("\nTraining LightGBM...")
callbacks = [
    lgb.early_stopping(stopping_rounds=50, verbose=True),
    lgb.log_evaluation(period=100),
]

model = lgb.train(
    params,
    train_data,
    num_boost_round=1000,
    valid_sets=[val_data],
    callbacks=callbacks,
)

# Evaluate
val_preds = model.predict(X_val)
brier = brier_score_loss(y_val, val_preds)
ll = log_loss(y_val, val_preds)
acc = ((val_preds > 0.5) == y_val).mean()

print(f"\n=== Validation Metrics ===")
print(f"Brier:   {brier:.6f}")
print(f"LogLoss: {ll:.6f}")
print(f"Acc@0.5: {acc*100:.2f}%")
print(f"Trees:   {model.num_trees()}")

# Calibration report
print(f"\n=== Calibration (10 bins) ===")
bins = [(i/10, (i+1)/10) for i in range(10)]
for lo, hi in bins:
    mask = (val_preds >= lo) & (val_preds < hi)
    if mask.sum() > 0:
        print(f"  {lo:.1f}-{hi:.1f}  n={mask.sum():6d}  pred={val_preds[mask].mean():.4f}  actual={y_val[mask].mean():.4f}")

# Export model as JSON for TypeScript inference
print(f"\nExporting model to {OUTPUT_MODEL}...")
model_dump = model.dump_model()

# Build compact artifact
artifact = {
    "modelVersion": "v5-lgbm",
    "trainedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    "featureNames": feature_names,
    "numTrees": model.num_trees(),
    "metrics": {
        "brier": round(brier, 6),
        "logloss": round(ll, 6),
        "accuracy": round(float(acc), 6),
        "numValRows": int(val_mask.sum()),
        "numValMatches": n_val,
    },
    # LightGBM tree ensemble — each tree has the structure needed for inference
    "trees": model_dump["tree_info"],
    "objective": "binary",
    # sigmoid is applied post-inference (LightGBM binary outputs raw margin)
    "averageOutput": model_dump.get("average_output", False),
}

OUTPUT_MODEL.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT_MODEL, "w") as f:
    json.dump(artifact, f, separators=(",", ":"))

size_mb = OUTPUT_MODEL.stat().st_size / 1024 / 1024
print(f"Saved {size_mb:.1f} MB")

# Write eval report
OUTPUT_REPORT.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT_REPORT, "w") as f:
    f.write(f"v5-lgbm Evaluation Report\n")
    f.write(f"=========================\n")
    f.write(f"Brier:    {brier:.6f}\n")
    f.write(f"LogLoss:  {ll:.6f}\n")
    f.write(f"Acc@0.5:  {acc*100:.2f}%\n")
    f.write(f"Trees:    {model.num_trees()}\n")
    f.write(f"Features: {len(feature_names)}\n")

print(f"\nDone. Run `npm run dev` to use the new model (set DEFAULT_MODEL_VERSION=v5-lgbm).")
