// Desirability. Response-curve shapes, tolerances and baselines are tuning
// values.

import type { DevType, PerType } from '../types';

export type Range = readonly [max: number, min: number];

const r = (
  rs: Range, rss: Range, rsss: Range,
  cos2: Range, cos3: Range,
  cs1: Range, cs2: Range, cs3: Range,
  ia: Range, id: Range, im: Range, iht: Range,
): PerType<Range> => ({
  'R$': rs, 'R$$': rss, 'R$$$': rsss,
  'Co$$': cos2, 'Co$$$': cos3,
  'Cs$': cs1, 'Cs$$': cs2, 'Cs$$$': cs3,
  IA: ia, ID: id, IM: im, IHT: iht,
});
const Z: Range = [0, 0];

/** Max/min effect of each desirability factor per developer type. Column order: R$ R$$ R$$$ Co$$ Co$$$ Cs$ Cs$$ Cs$$$ IA ID IM IHT. */
export const FACTOR_RANGE = {
  air: r([25, -25], [50, -50], [50, -50], [25, -25], [40, -40], [12, -12], [25, -25], [40, -40], [50, -50], Z, [5, -5], [50, -50]),
  coProx2: r(Z, Z, Z, [0, -10], Z, Z, [0, -10], Z, Z, Z, Z, Z),
  coProx3: r(Z, Z, Z, Z, [0, -10], Z, Z, [0, -20], Z, Z, Z, Z),
  comNimby: r(Z, Z, Z, [20, -20], [30, -30], [10, -10], [20, -20], [30, -30], Z, Z, Z, Z),
  crime: r([25, -25], [50, -50], [50, -50], [50, -50], [50, -50], [25, -25], [50, -50], [50, -50], [10, -10], [10, -10], [25, -25], [50, -50]),
  garbage: r([25, -25], [50, -50], [50, -50], [50, -50], [50, -50], [25, -25], [50, -50], [50, -50], [50, -50], [5, -5], [5, -5], [50, -50]),
  health: r([5, -5], [8, -8], [10, -10], Z, Z, Z, Z, Z, Z, Z, Z, Z),
  landValue: r([10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0]),
  rProx1: r([5, 0], [0, -5], [0, -5], Z, Z, [0, -15], Z, Z, Z, Z, Z, Z),
  rProx2: r([0, -5], [5, 0], [0, -5], Z, Z, Z, [0, -20], Z, Z, Z, Z, Z),
  rProx3: r([0, -5], [0, -5], [5, 0], Z, Z, Z, Z, [0, -40], Z, Z, Z, Z),
  resNimby: r([10, -10], [24, -24], [30, -30], Z, Z, Z, Z, Z, Z, Z, Z, [30, -30]),
  school: r([10, -10], [20, -20], [25, -25], Z, Z, Z, Z, Z, Z, Z, Z, Z),
  slope: r(Z, Z, Z, Z, Z, Z, Z, Z, [10, 0], [10, 0], [10, 0], [10, 0]),
  traffic: r([2, -2], [5, -5], [10, -10], [20, -20], [24, -24], [20, -20], [24, -24], [40, -40], [50, -50], Z, Z, Z),
  trip: r([10, -10], [10, -10], [10, -10], Z, Z, Z, Z, Z, [15, -15], [15, -15], [15, -15], [15, -15]),
} as const;
export type Factor = keyof typeof FACTOR_RANGE;

/**
 * Initial desirability: high for R$, Cs$, IA, ID; enough for R$$, Cs$$, Co$$,
 * IM to build but not to stay; none for the $$$ types and IHT.
 */
export const BASELINE: PerType = {
  'R$': 70, 'Cs$': 70, IA: 65, ID: 65,
  'R$$': 52, 'Cs$$': 52, 'Co$$': 50, IM: 54,
  'R$$$': 0, 'Cs$$$': 0, 'Co$$$': 0, IHT: 0,
};

/** A tract needs at least this desirability for a developer type to build. */
export const DEVELOP_THRESHOLD = 50;
/** Occupancy is proportional to desirability; this value means full occupancy. */
export const FULL_OCCUPANCY_DESIRABILITY = 100;
/**
 * Below this, a building's occupants start leaving (downgrade/abandonment):
 * a building under 30% occupancy counts as abandoned.
 */
export const DISTRESS_DESIRABILITY = 30;

/**
 * Air pollution at which the effect turns from positive to negative, per type
 * (pollution units, roughly 0–100). Lower wealth tolerates more.
 */
export const AIR_TOLERANCE: PerType = {
  'R$': 35, 'R$$': 22, 'R$$$': 12,
  'Cs$': 45, 'Cs$$': 30, 'Cs$$$': 15,
  'Co$$': 30, 'Co$$$': 15,
  IA: 20, ID: 999, IM: 60, IHT: 10,
};
/** Pollution at which the negative effect saturates at the factor minimum. */
export const AIR_SATURATION = 100;

/** Land value (0–50 from water proximity) the type likes best: low, medium or high. */
export const LAND_VALUE_PREF: PerType<'low' | 'medium' | 'high'> = {
  'R$': 'low', 'Cs$': 'low', IA: 'low', ID: 'low',
  'R$$': 'medium', 'Cs$$': 'medium', 'Co$$': 'medium', IM: 'medium',
  'R$$$': 'high', 'Cs$$$': 'high', 'Co$$$': 'high', IHT: 'high',
};
/** Water imparts up to +50 land value, fading out over 10 tiles. */
export const WATER_LAND_VALUE = { max: 50, range: 10 } as const;

/** Radius (tiles) for residential same/other-wealth proximity. */
export const RES_PROXIMITY_RADIUS = 4;
/** Residents within the radius that count as full proximity. */
export const RES_PROXIMITY_FULL = 150;
/** Distance (tiles) at which "distance to Co / R" penalties saturate. */
export const PROXIMITY_DISTANCE_MAX = 24;

/** Traffic (trips/day on adjacent road) that counts as "high". */
export const TRAFFIC_HIGH = 400;
/**
 * Commute / freight trip time (centi-hours) that scores best and worst: the
 * score falls from its maximum at half an hour to its minimum at the
 * 2.5-hour trip limit.
 */
export const TRIP_SHORT = 50;
export const TRIP_LONG = 250;

/** NIMBY/YIMBY field strength at which a type's maximum (or minimum) is reached. */
export const NIMBY_FULL = 40;

export function rangeOf(f: Factor, t: DevType): Range {
  return FACTOR_RANGE[f][t];
}
