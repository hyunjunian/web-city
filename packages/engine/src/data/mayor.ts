// Mayor Rating (with Rush Hour changes).
// The curve shapes between the ranges below are ours.

import type { Curve } from './services';

/** Crime: +10 … −50 (positive while low, constant drag, then plummets). */
export const MR_CRIME = { max: 10, low: 0.9, rampant: 3.6, dragAtRampant: -10, min: -50, top: 6 } as const;
/** Air and water pollution: +10 at none, 0 at 400, down to −35. */
export const MR_POLLUTION = { max: 10, zero: 400, min: -35, worst: 1000 } as const;
/** Garbage: +10 when collected, down to −35 as piles grow. */
export const MR_GARBAGE = { max: 10, min: -35, worst: 20 } as const;
/** NIMBY/YIMBY: +3 per 100 points of residential score, at most +3 (never negative). */
export const MR_NIMBY = { perHundred: 3, max: 3 } as const;
/** ±7 for school coverage (age-appropriate), hospital coverage, commute, traffic noise. */
export const MR_SERVICE = 7;
/** Traffic (trips a day) that counts as full noise. */
export const MR_NOISE_HIGH = 400;
/**
 * Land value vs. wealth. Rows: low, medium, high land value; columns:
 * wealth $, $$, $$$ (not the other way round: low-wealth Sims struggle on
 * high-value land, while R$$$ Sims are happy on cheap land).
 */
export const MR_VALUE_WEALTH = [
  [0, 3, 5],
  [-3, 0, 3],
  [-5, -3, 0],
] as const;
/** Local Mayor Rating is clamped to this range. */
export const MR_LIMIT = 100;

/** Mayor Rating change for a change in a residential tax rate (percentage points). */
export const MR_TAX_CHANGE: Curve = [
  [-20, 25], [-10, 20], [-5, 10], [-2, 7], [-1, 5], [0, 0], [1, -5], [5, -10], [10, -20], [20, -25],
];
/** Short-term effects fade by a quarter of their size a month. */
export const MR_EVENT_MONTHS = 4;
/** Ages each kind of school serves, for the Mayor Rating's school factor. */
export const MR_SCHOOL_AGES = {
  elementary: [20, 49], highSchool: [30, 59], college: [30, 79], university: [20, 100], library: [20, 79],
  mainLibrary: [20, 100], museum: [30, 100], artMuseum: [30, 100], privateSchool: [20, 59], opera: [50, 100],
} as const;

/**
 * Mayor's Limo "throw money" (Rush Hour, needs the Mayor's House): §50 a
 * throw, +10 on every residential tract within three tiles for about three
 * months.
 */
export const THROW_MONEY = { cost: 50, amount: 10, radius: 3, months: 3 } as const;

/** Placing a civic building: +25 within 8 tiles. */
export const CIVIC_EVENT = { amount: 25, radius: 8 } as const;

/**
 * Riots can start where tiles sit at −50 or below, even one alone
 * (1% a month here, a tuning value); a hotspot is 3 such tiles within 4
 * tiles; 5 tiles → 10% a month, 20 → certain.
 */
export const RIOT = { threshold: -50, radius: 4, minTiles: 1, chance: [[1, 0.01], [2, 0.02], [3, 0.05], [5, 0.1], [20, 1]] as Curve } as const;

/**
 * A riot: it grows through five stages (a day each here rather than 30
 * real-time seconds) and at the fifth throws Molotov cocktails. Police
 * that reach it drain its energy (competent crews only; helicopters always)
 * while it gathers `grow` a day per stage. The numbers are tuning values.
 */
export const RIOT_MOB = {
  energy: 60, grow: 5, policeHit: 15, heliHit: 25, competent: 0.6, maxDays: 30,
  /**
   * Off a dead-end street, a riot needs three or more dispatch units to bring under control:
   * fewer only wear it down at this share of their strength.
   */
  minUnits: 3, fewUnits: 0.3,
  stages: 5, fireRadius: 2, event: { amount: -10, radius: 8 },
  /** Daily chance a mob in its frenzy lobs a Molotov cocktail and starts a fire (rate assumed). */
  molotov: 0.25,
  /** Critical mass: a mob at its top stage with this much energy spawns one new mob this far away (at most `maxMobs` at once). */
  spawnEnergy: 100, spawnDistance: 5, maxMobs: 4,
} as const;
