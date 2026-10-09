// Disasters, with Rush Hour's additions. SimCity 4 plays them out in real
// time; sizes, rates and durations here are tuning values chosen to match
// how they behave there (see README).

/** God Mode disasters: size grows with intensity (0–1), standing for how long the button is held. */
export const GOD_MODE = {
  /** Meteor crater radius 2 + 3k; burning debris on 6 + 10k tiles within 3 radii. */
  meteor: { crater: [2, 3], debris: [6, 10], debrisSpread: 3, debrisStage: 2, depth: 6 },
  /** Tornado: radius 1 + k, 40 + 80k steps, 30% chance to turn each step; big buildings (≥ 9 tiles) turn it back. */
  tornado: { radius: [1, 1], steps: [40, 80], turn: 0.3, bigBuilding: 9 },
  /** Earthquake: fault half-length 8 + 32k, damage band 2 + 6k either side. */
  earthquake: { halfLength: [8, 32], band: [2, 6], destroy: 0.8, ignite: 0.25, underground: 0.5 },
  /** Volcano: cone radius 3 + 3k (unbuildable), slopes to twice that, rising up to 120 m; lava flows and bombs set fires. */
  volcano: { cone: [3, 3], flows: [4, 4], flowLength: [4, 12], bombs: 9, bombSpread: 6, stage: 3, peak: 120 },
  /** Robot (Servo): 30 + 60k steps; throws plates every 15 steps (30%). */
  robot: { steps: [30, 60], seek: 16, plateEvery: 15, plateChance: 0.3, plateRange: [6, 12] },
  /** Autosaurus: leaves when it meets water (it fears rust); else after 240 + 240k steps at most. */
  autosaurus: { steps: [240, 240] },
  /** UFO: death ray radius 1 + k, then 3 + 2k small saucers firing 6 shots each within 12 tiles. */
  ufo: { ray: [1, 1], saucers: [3, 2], shots: 6, range: 12 },
  /** God Mode fire catches with 0.4 + flammability / 100 and starts at stage 1 + 2k. */
  fire: { base: 0.4 },
  /** Short-term Mayor Rating effect at the epicentre (UFO panic is wider). */
  event: { amount: -20, radius: 16, months: 4 },
  ufoEvent: { amount: -30, radius: 24, months: 4 },
} as const;

/** Leveling a volcano cone or slope with the terrain tools, per tile. */
export const LEVEL_COST = 500;

/** Terrain tools: turning land to water or back, per tile (assumed). */
export const TERRAFORM_COST = 50;

/**
 * Utility wear (lines spark below 50% power funding, pipes burst below
 * 50% water funding). Wear per month 8 × the funding shortfall; distressed at
 * 50; repaired 10 × funding a month (lines at 100%+, pipes from 50%).
 */
export const UTILITY_WEAR = {
  rate: 8, distressed: 50, repair: 10,
  /** Monthly spark chance per distressed line (×3: sparks only below 50% funding). `linesForDouble` is no longer used. */
  spark: 0.02, sparkLowFunding: 3, linesForDouble: 2_000,
  /** Monthly burst chance per distressed pipe below 50% funding; a burst spreads to worn neighbours. */
  burst: 0.01, burstSpread: 0.5,
  /** Water funding from which pipes are kept up (below 50% they aren't repaired and grow distressed). */
  pipeRepairAbove: 50,
} as const;

/** Plant explosions: blast radius 3, fires for 6 tiles beyond; a nuclear meltdown irradiates 24 tiles for good. */
export const EXPLOSION = { blast: 3, fireRing: 6, fireChance: 0.5, meltdownRadius: 24 } as const;

/**
 * Rail damage from underfunded mass transit (Rush Hour): repaired only above
 * 100%, best at 110%. A train over damaged track derails; 10% of freight
 * trains carry a toxic tank that cracks half the time.
 */
export const RAIL_DAMAGE = { damage: 0.03, repair: 0.5, best: 110, toxicTank: 0.1, crack: 0.5 } as const;

/** Toxic spill: air and water pollution until fire crews neutralise it; unattended for a month it leaves radiation. */
export const SPILL = { air: 100, water: 200, radius: 4, radiationMonths: 6, radiationRadius: 2 } as const;

/** Traffic pileups (Rush Hour): chance by intersection volume / capacity, at most one per month each. */
export const PILEUP: readonly [number, number][] = [[0.25, 0], [1, 0.05], [2, 0.3]];

/** Moving disasters played out over time: steps a simulated day moves them (viewers also step them in real time). */
export const LIVE_DISASTERS = {
  stepsPerDay: 20,
  /** A meteor falls for 24 steps (twice as fast while pulled), each pulled step adding 0.03 intensity. */
  meteorFall: 24, meteorPush: 0.03,
} as const;
