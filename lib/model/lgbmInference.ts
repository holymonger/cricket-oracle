/**
 * Pure TypeScript inference engine for LightGBM tree ensembles.
 *
 * Reads the JSON artifact produced by trainLightGBM.py and evaluates
 * a feature vector against the tree ensemble, returning a probability [0,1].
 *
 * LightGBM binary classification: sum raw leaf values across all trees,
 * then apply sigmoid to get the final probability.
 */

export interface LGBMTreeNode {
  split_feature?: number;
  threshold?: number | string;
  decision_type?: string; // "<=", "<", ">", ">="
  left_child?: LGBMTreeNode;
  right_child?: LGBMTreeNode;
  leaf_value?: number;
  // Numeric index form (LightGBM sometimes uses arrays instead of nested objects)
}

export interface LGBMTreeInfo {
  num_leaves: number;
  num_cat: number;
  split_feature: number[];
  split_gain: number[];
  threshold: (number | string)[];
  decision_type: string[];
  left_child: number[];
  right_child: number[];
  leaf_value: number[];
}

export interface LGBMArtifact {
  modelVersion: string;
  trainedAt: string;
  featureNames: string[];
  numTrees: number;
  metrics: {
    brier: number;
    logloss: number;
    accuracy: number;
    numValRows: number;
    numValMatches: number;
  };
  trees: LGBMTreeInfo[];
  objective: string;
  averageOutput: boolean;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Evaluate a single LightGBM tree (array-of-nodes format from dump_model()).
 *
 * LightGBM encodes trees as parallel arrays:
 *   split_feature[i] = feature index for internal node i
 *   threshold[i]     = split threshold for internal node i
 *   left_child[i]    = child node index if going left (negative = leaf index encoded as ~leaf_idx)
 *   right_child[i]   = child node index if going right
 *   leaf_value[j]    = raw score for leaf j
 *
 * A node index < 0 means it's a leaf: leaf_index = ~node_index (bitwise NOT)
 */
function evaluateTree(tree: LGBMTreeInfo, features: number[]): number {
  let nodeIdx = 0; // start at root (always node 0)

  while (true) {
    const featureIdx = tree.split_feature[nodeIdx];
    const threshold = tree.threshold[nodeIdx];
    const decisionType = tree.decision_type[nodeIdx];

    const featureVal = features[featureIdx] ?? 0;
    const thresh = typeof threshold === "string" ? parseFloat(threshold) : threshold;

    // Default decision type is "<="
    const goLeft = decisionType === "<="
      ? featureVal <= thresh
      : decisionType === "<"
      ? featureVal < thresh
      : decisionType === ">"
      ? featureVal > thresh
      : featureVal >= thresh;

    const childIdx = goLeft ? tree.left_child[nodeIdx] : tree.right_child[nodeIdx];

    if (childIdx < 0) {
      // Leaf: decode leaf index using bitwise NOT
      const leafIdx = ~childIdx;
      return tree.leaf_value[leafIdx];
    }

    nodeIdx = childIdx;
  }
}

/**
 * Run full LightGBM inference: sum raw scores across all trees, apply sigmoid.
 */
export function predictLGBM(artifact: LGBMArtifact, features: number[]): number {
  let rawScore = 0;
  for (const tree of artifact.trees) {
    rawScore += evaluateTree(tree, features);
  }
  if (artifact.averageOutput) {
    rawScore /= artifact.trees.length;
  }
  return sigmoid(rawScore);
}

/**
 * Build a feature vector from a named feature map using the artifact's feature order.
 */
export function buildFeatureVector(
  artifact: LGBMArtifact,
  featureMap: Record<string, number>
): number[] {
  return artifact.featureNames.map((name) => featureMap[name] ?? 0);
}
