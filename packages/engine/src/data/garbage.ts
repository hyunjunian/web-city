// Garbage and garbage pollution.

import type { PerType } from '../types';

/**
 * Tons per resident or job per month. RCI garbage is assumed; these make one
 * Waste to Energy plant (500 t) enough for 12–15k people.
 */
export const GARBAGE_PER_CAPITA: PerType = {
  'R$': 0.02, 'R$$': 0.024, 'R$$$': 0.028,
  'Cs$': 0.025, 'Cs$$': 0.025, 'Cs$$$': 0.028,
  'Co$$': 0.022, 'Co$$$': 0.025,
  IA: 0.01, ID: 0.04, IM: 0.03, IHT: 0.015,
};

/** Landfill zone: §50 a tile, §10 a tile a month, 300 tons a tile. */
export const LANDFILL = {
  zoneCost: 50,
  upkeep: 10,
  tileCapacity: 300,
  /** Every landfill tile is a −100 NIMBY, radius 32, for homes and shops. */
  nimby: -100,
  nimbyRadius: 32,
  /** Cut off from roads, garbage decays 7% a month, at most 15 t a tile. */
  decayRate: 0.07,
  decayCap: 15,
} as const;

/** §0.005 per ton collected. */
export const PICKUP_COST = 0.005;
/** Most uncollected garbage a tile holds before it spills to other lots. */
export const PILE_CAP = 25;
/** Share of piled garbage collected each month once there is room again. */
export const BACKLOG_PICKUP = 0.5;
/**
 * Garbage on a tile (tons) where the desirability effect turns negative, by
 * wealth (lower wealth tolerates more), and where it bottoms out.
 */
export const GARBAGE_TOLERANCE = [4, 2, 1] as const;
export const GARBAGE_SATURATION = 20;
/** HQ pollution equivalent of one ton of piled garbage. */
export const GARBAGE_HQ_POLLUTION = 5;
