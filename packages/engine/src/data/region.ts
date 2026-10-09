// Neighbours and the region. One synthetic neighbour per map edge stands in
// for the rest of the region; many of the numbers below are tuning values
// (see README).

import type { PerType } from '../types';

export type NeighbourKind = 'simnation' | 'established' | 'developed';

/** Neighbor Deals: at least 1,000 units; buyers need a year's cash; projected need is 120% of use. */
export const DEALS = { minAmount: 1_000, cashMonths: 12, projectedNeed: 1.2, graceMonths: 6, probationMonths: 3, termMonths: 12 } as const;

/**
 * Price per unit = seller's average cost × (1.25 + 0.5 × buyer's need + 0.5 ×
 * how little surplus the seller keeps), at least 110% of either side's own
 * cost: the seller always profits and the buyer pays more than producing it.
 */
export const DEAL_PRICE = { floor: 1.25, need: 0.5, scarcity: 0.5, minOverCost: 1.1 } as const;

/** A synthetic neighbour's average costs per unit (from a coal plant, pump and landfill). */
export const NEIGHBOUR_COST = { power: 0.042, water: 0.0175, garbage: 0.04 } as const;

/** A "developed" neighbour at scale 1 (residents and jobs per type). */
export const DEVELOPED_TEMPLATE: PerType = {
  'R$': 8_000, 'R$$': 4_000, 'R$$$': 1_000, 'Cs$': 600, 'Cs$$': 500, 'Cs$$$': 400, 'Co$$': 900, 'Co$$$': 600,
  IA: 300, ID: 1_500, IM: 1_000, IHT: 200,
};

/**
 * Neighbours' utility capacity relative to their use (power, water, garbage) by edge (W, E, N, S), and
 * treasury. Some run short (below the 120% projected need), so there is someone to sell to:
 * the northern neighbour of power and water, the southern of garbage disposal.
 */
export const DEVELOPED_UTILITIES = {
  capacity: [[1.5, 1.5, 1.5], [1.5, 1.5, 1.5], [0.9, 0.9, 1.5], [1.5, 1.5, 0.9]] as readonly (readonly [number, number, number])[],
  funds: 50_000,
} as const;

/**
 * Regional demand: a developed neighbour pushes out 10% of its population as
 * growth, which arrives a twelfth at a time.
 */
export const REGIONAL_GROWTH = {
  share: 0.1, perMonth: 1 / 12,
  /**
   * Share of a month's unmet demand passed to inactive neighbours (rate
   * assumed). They take it up to `share` of their population.
   */
  exportShare: 0.25,
} as const;

/** Extra commute time to jobs in an established (never played) or developed neighbour, centi-hours. */
export const NEIGHBOUR_COMMUTE = { established: 150, developed: 80 } as const;
