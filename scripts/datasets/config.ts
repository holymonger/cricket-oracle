import * as path from "path";

export type DatasetPaths = {
  iplDir: string;
  t20iDir: string;
};

export const DEFAULT_DATASET_PATHS: DatasetPaths = {
  iplDir: process.env.IPL_JSON_DIR ?? "../ipl_json",
  t20iDir: process.env.T20I_JSON_DIR ?? "../t20s_json",
};

export function resolveDatasetPaths(overrides?: Partial<DatasetPaths>): DatasetPaths {
  return {
    iplDir: path.resolve(process.cwd(), overrides?.iplDir ?? DEFAULT_DATASET_PATHS.iplDir),
    t20iDir: path.resolve(process.cwd(), overrides?.t20iDir ?? DEFAULT_DATASET_PATHS.t20iDir),
  };
}
