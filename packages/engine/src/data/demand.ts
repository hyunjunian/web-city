// Demand tables.
// Percentages are stored as fractions. Values are tunable data, not code.

import type { BusinessType, DevType, PerType, PerWealth, Wealth } from '../types';

/** Wealth tier of each developer type (used for taxes and job matching). */
export const WEALTH_OF: PerType<Wealth> = {
  'R$': 0, 'R$$': 1, 'R$$$': 2,
  'Cs$': 0, 'Cs$$': 1, 'Cs$$$': 2,
  'Co$$': 1, 'Co$$$': 2,
  IA: 0, ID: 0, IM: 1, IHT: 2,
};

/** Workforce Demand table: wealth split of each business type's jobs. */
export const WORKFORCE_PROFILE: Record<BusinessType, PerWealth> = {
  'Cs$': [1.0, 0, 0],
  'Cs$$': [0.68, 0.27, 0.05],
  'Cs$$$': [0.62, 0.3, 0.08],
  'Co$$': [0.4, 0.5, 0.1],
  'Co$$$': [0.2, 0.65, 0.15],
  IA: [1.0, 0, 0],
  ID: [1.0, 0, 0],
  IM: [0.5, 0.45, 0.05],
  IHT: [0.1, 0.8, 0.1],
};

/**
 * Business Demand table: share of jobs demanded by workers of each
 * wealth (outer index) and EQ level (inner index, EQ1..EQ4).
 * Every column except IA sums to 100%; IA is a parallel channel.
 */
export const BUSINESS_PROFILE: Record<BusinessType, [PerEq, PerEq, PerEq]> = {
  'Cs$': [[0.25, 0.25, 0.2, 0.15], [0.1, 0.05, 0, 0], [0.05, 0, 0, 0]],
  'Cs$$': [[0, 0, 0.05, 0.1], [0.15, 0.2, 0.25, 0.2], [0.15, 0.1, 0.05, 0]],
  'Cs$$$': [[0, 0, 0, 0], [0, 0, 0, 0.05], [0.05, 0.15, 0.2, 0.25]],
  'Co$$': [[0, 0, 0.15, 0.45], [0.2, 0.3, 0.15, 0.1], [0.4, 0.4, 0.2, 0]],
  'Co$$$': [[0, 0, 0, 0.15], [0, 0.05, 0.15, 0.3], [0.15, 0.3, 0.4, 0.5]],
  IA: [[1.0, 0, 0, 0], [0.8, 0, 0, 0], [0, 0, 0, 0]],
  ID: [[0.75, 0.5, 0.25, 0], [0.2, 0.1, 0, 0], [0.1, 0, 0, 0]],
  IM: [[0, 0.25, 0.35, 0.15], [0.35, 0.3, 0.2, 0], [0.1, 0.05, 0, 0]],
  IHT: [[0, 0, 0, 0], [0, 0, 0.25, 0.35], [0, 0, 0.15, 0.25]],
};
type PerEq = [number, number, number, number];

/** Initial Demand Caps. `Infinity` = uncapped (Commercial Service). */
export const INITIAL_CAPS: PerType = {
  'R$': 20_000, 'R$$': 2_000, 'R$$$': 1_000,
  'Cs$': Infinity, 'Cs$$': Infinity, 'Cs$$$': Infinity,
  'Co$$': 3_000, 'Co$$$': 2_000,
  IA: 30_000, ID: 14_000, IM: 7_000, IHT: 4_000,
};

/** Starting EQ/HQ of Sims by residential wealth. */
export const START_QUOTIENT: PerWealth = [20, 40, 60];

/**
 * Commercial Office cap relief for the first connection of a kind to a
 * neighbour. Repeat connections follow base × log2(n + 1) cumulatively,
 * which reproduces the game's 2nd/3rd connection values exactly.
 */
export const CONNECTION_RELIEF = {
  highway: 100_000,
  subway: 20_000,
  road: 10_000,
  rail: 10_000,
} as const;
export type ConnectionKind = keyof typeof CONNECTION_RELIEF;

/** Cap relief added to every Industrial type per freight trip reaching a connection. */
export const FREIGHT_TRIP_RELIEF = 20;

/** Neutral tax rate (%) by residential population; first matching row wins. */
export const NEUTRAL_TAX: readonly [maxPop: number, rate: number][] = [
  [150_000, 9.0], [450_000, 8.9], [600_000, 8.8], [900_000, 8.7],
  [1_050_000, 8.6], [1_350_000, 8.5], [1_500_000, 8.4], [1_800_000, 8.3],
  [1_950_000, 8.2], [2_100_000, 8.1], [Infinity, 8.0],
];

/** Rush Hour default: 9% for all 12 developer types (base game used 7%). */
export const DEFAULT_TAX_RATE = 9;

/** Tax effect on demand, keyed by current/neutral ratio (log-interpolated). */
export const TAX_IMPACT = { lowRatio: 0.2, maxBoost: 0.35, highRatio: 5, maxPenalty: -3.5 } as const;
/** Days a raised tax rate keeps penalising demand. */
export const TAX_MEMORY_DAYS = 90;

export function businessShare(t: BusinessType, w: Wealth, eq: number): number {
  return BUSINESS_PROFILE[t][w][eq] ?? 0;
}

export function isCapped(t: DevType): boolean {
  return Number.isFinite(INITIAL_CAPS[t]);
}

// ---- Tuning values ------------------------------------------------------


/**
 * EQ values at which workers move to EQ2, EQ3, EQ4 for business demand
 * (assumed): quarters of the 0–200 scale.
 */
export const EQ_THRESHOLDS = [50, 100, 150] as const;

/**
 * Demand a brand-new city sees from the outside world (SimNation): jobs that
 * want residents, and residents that want local businesses. Without it
 * nothing would ever start growing.
 */
export const BASE_JOBS: PerWealth = [300, 250, 60];
export const BASE_BUSINESS: Record<BusinessType, number> = {
  'Cs$': 40, 'Cs$$': 40, 'Cs$$$': 10,
  'Co$$': 60, 'Co$$$': 20,
  IA: 60, ID: 120, IM: 100, IHT: 0,
};

/**
 * Raw demand (Sims or jobs) maps onto the ±1000 scale with
 * 1000 × raw / (|raw| + halfSaturation); halfSaturation grows with the city.
 */
export const DEMAND_HALF_SATURATION = { base: 300, perCapita: 0.05 } as const;

/**
 * Freight trips per filled industrial job per month that reach a connection (several a month, more
 * for bigger industry): a few a month for a 100-job factory. At 0.1, the 20 relief a trip
 * outgrew the jobs themselves (2 per job), the industrial caps never bound and the relief buildings
 * (University, Army Base…) did nothing; at 0.6 a job they bind near 35,000 jobs of a type.
 */
export const FREIGHT_TRIPS_PER_JOB = 0.03;

/** Sustained negative demand below this drives an exodus (abandonment). */
export const EXODUS_DEMAND = -150;
/** Share of the surplus that leaves each month. */
export const EXODUS_RATE = 0.35;
/** Occupants a building may have beyond twice the remaining surplus and still be left by an exodus. */
export const EXODUS_SLACK = 50;
