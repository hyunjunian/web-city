// Stage limits, plus the Rush Hour low-wealth tables.
// Each table maps a developer type's population (residents or jobs) to the
// target share of its buildings at each stage. Columns use the largest
// threshold <= population; percentages, every column sums to 100.

import type { DevType } from '../types';

export interface StageTable {
  thresholds: readonly number[];
  /** rows[stage-1][column] in percent */
  rows: readonly (readonly number[])[];
}

const BASE_THRESHOLDS = [
  0, 300, 390, 507, 659, 857, 1114, 1448, 1882, 2447, 3181, 4135, 5376,
  6989, 9086, 11812, 15356, 19963, 25952, 33738, 43859, 57017, 74122, 96359, 125267,
];

/** Rush Hour thresholds for R$, Cs$, ID: 300 × 1.2^n. */
const LOW_WEALTH_THRESHOLDS = [
  0, 300, 360, 432, 518, 622, 746, 895, 1074, 1289, 1547, 1856, 2227,
  2672, 3206, 3847, 4616, 5539, 6647, 7976, 9571, 11485, 13782, 16538, 19846,
];

export const RES_OFFICE_STAGES: StageTable = {
  thresholds: BASE_THRESHOLDS,
  rows: [
    [100, 95, 80, 60, 45, 30, 27, 24, 21, 17, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 2, 1, 1, 1],
    [0, 5, 20, 35, 40, 45, 40, 36, 33, 30, 26, 23, 20, 17, 15, 13, 11, 9, 8, 7, 5, 4, 3, 2, 2],
    [0, 0, 0, 5, 15, 25, 28, 30, 32, 35, 33, 31, 28, 25, 21, 18, 15, 12, 10, 8, 7, 6, 5, 5, 5],
    [0, 0, 0, 0, 0, 0, 5, 10, 14, 18, 23, 27, 32, 36, 39, 37, 34, 32, 28, 26, 22, 19, 16, 13, 10],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 7, 10, 13, 14, 19, 24, 27, 30, 27, 24, 22, 19, 17, 15],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 6, 10, 15, 18, 24, 27, 25, 24, 21, 18],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 5, 11, 16, 21, 25, 29],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 6, 11, 16, 20],
  ],
};

export const SERVICE_STAGES: StageTable = {
  thresholds: BASE_THRESHOLDS,
  rows: [
    [100, 95, 92, 89, 86, 83, 80, 77, 74, 71, 68, 66, 64, 62, 60, 58, 56, 54, 52, 50, 48, 46, 44, 42, 40],
    [0, 5, 8, 10, 12, 14, 16, 17, 18, 19, 20, 20, 20, 19, 19, 18, 18, 17, 16, 16, 17, 14, 14, 14, 15],
    [0, 0, 0, 1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10, 10],
    [0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 8, 9, 9, 9, 9],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 4, 5, 5, 6, 6, 6, 7, 7, 7],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 4, 5, 5, 6, 6],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5],
  ],
};

export const INDUSTRY_STAGES: StageTable = {
  thresholds: BASE_THRESHOLDS,
  rows: [
    [100, 99, 98, 97, 96, 94, 91, 89, 86, 83, 79, 75, 71, 66, 61, 56, 50, 44, 37, 31, 23, 16, 8, 7, 7],
    [0, 1, 2, 3, 4, 6, 9, 11, 14, 16, 19, 21, 22, 23, 24, 25, 26, 27, 29, 29, 32, 33, 35, 29, 23],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 4, 7, 11, 15, 19, 24, 29, 34, 40, 45, 51, 57, 64, 70],
  ],
};

/**
 * Farms, unlike other industry, never grow with population:
 * all three farm sizes from the start, in fixed shares.
 */
export const FARM_STAGES: StageTable = {
  thresholds: BASE_THRESHOLDS,
  rows: [BASE_THRESHOLDS.map(() => 34), BASE_THRESHOLDS.map(() => 33), BASE_THRESHOLDS.map(() => 33)],
};

export const LOW_RES_STAGES: StageTable = {
  thresholds: LOW_WEALTH_THRESHOLDS,
  rows: RES_OFFICE_STAGES.rows,
};

export const LOW_SERVICE_STAGES: StageTable = {
  thresholds: LOW_WEALTH_THRESHOLDS,
  rows: SERVICE_STAGES.rows,
};

export const LOW_DIRTY_STAGES: StageTable = {
  thresholds: LOW_WEALTH_THRESHOLDS,
  rows: INDUSTRY_STAGES.rows,
};

export const STAGE_TABLE: Record<DevType, StageTable> = {
  'R$': LOW_RES_STAGES,
  'R$$': RES_OFFICE_STAGES,
  'R$$$': RES_OFFICE_STAGES,
  'Cs$': LOW_SERVICE_STAGES,
  'Cs$$': SERVICE_STAGES,
  'Cs$$$': SERVICE_STAGES,
  'Co$$': RES_OFFICE_STAGES,
  'Co$$$': RES_OFFICE_STAGES,
  IA: FARM_STAGES,
  ID: LOW_DIRTY_STAGES,
  IM: INDUSTRY_STAGES,
  IHT: INDUSTRY_STAGES,
};

/** Highest stage a zone density permits (R/C have 8 stages, I has 3). */
export const DENSITY_MAX_STAGE = {
  R: { low: 3, medium: 6, high: 8 },
  C: { low: 3, medium: 6, high: 8 },
  I: { low: 0, medium: 2, high: 3 },
} as const;
