// Minimal economy (with Rush Hour changes).

/** Zoning cost per tile by density. Agriculture uses the low-density price. */
export const ZONING_COST = { low: 10, medium: 20, high: 50 } as const;
/** High-density commercial (§30, where residential and industry are §50), and dezoning a tile (§1). */
export const ZONING_COST_HIGH_COMMERCIAL = 30;
export const DEZONING_COST = 1;

/**
 * Networks: build cost per tile, monthly upkeep per tile, bulldoze cost.
 * Avenues and highways are one tile wide here, so their per-segment prices
 * (build and upkeep: the highway's §0.50 a month) are halved; onramps keep
 * the full §1,000 a ramp.
 */
/** Rush Hour: an Avenue run straight into a highway gets an in-line onramp for this (§200 ground, §600 elevated). */
export const AVENUE_RAMP_COST = 200;
export const ELEVATED_AVENUE_RAMP_COST = 600;

export const NETWORK_COST = {
  street: { build: 5, upkeep: 0.05, bulldoze: 1 },
  road: { build: 10, upkeep: 0.1, bulldoze: 2 },
  oneway: { build: 10, upkeep: 0.1, bulldoze: 2 },
  avenue: { build: 30, upkeep: 0.5, bulldoze: 5 },
  // Ground Highway (Rush Hour): §200 a 2-tile segment, a third of the Elevated Highway's §600.
  highway: { build: 100, upkeep: 0.25, bulldoze: 50 },
  elevatedHighway: { build: 300, upkeep: 0.25, bulldoze: 50 },
  onramp: { build: 1_000, upkeep: 2, bulldoze: 100 },
  rail: { build: 8, upkeep: 0.03, bulldoze: 1 },
  subway: { build: 156, upkeep: 0.3, bulldoze: 50 },
  elrail: { build: 50, upkeep: 1, bulldoze: 25 },
  monorail: { build: 100, upkeep: 1, bulldoze: 25 },
} as const;

/** Roads and streets may cross water as bridges at this multiple of the cost. */
export const BRIDGE_COST_MULT = 5;
/** A low bridge (too low for ferries, Rush Hour) costs this share of a tall one (assumed). */
export const LOW_BRIDGE_SHARE = 0.6;

/**
 * Bulldozing a zoned-but-empty tile or a building (per tile and stage). A lived-in or working building costs
 * at least `perOccupant` by wealth for each resident or job it holds: tearing it down means buying out its
 * owners at market value (RCI buildings are very costly to clear, civic ones far less).
 */
export const BULLDOZE_COST = { tile: 1, building: 5, perOccupant: [2, 4, 8] as readonly number[] } as const;

/** Going this far into the red gets the Mayor impeached. */
export const IMPEACHMENT_FUNDS = -100_000;

/**
 * Tax grows with tax rate, building value and occupancy; the formula is assumed:
 * Monthly tax = value × occupancy × rate × TAX_SCALE. Building value is
 * approximated per capacity unit (Sim or job) by wealth; larger buildings
 * are worth less per Sim. Tuned so a 30,000-resident city at 9% with
 * basic power, water, garbage, safety, health and schools runs a modest
 * surplus (about §9,000 a month in taxes).
 */
export const TAX_SCALE = 2.5;
export const VALUE_PER_CAPACITY = [0.9, 1.6, 3.0] as const;

/**
 * Loans up to §200,000 each in §5,000 steps, at most
 * §2,000,000 or 10 loans outstanding, 10 years at 8.5%, amortized monthly.
 */
export const LOANS = { max: 200_000, step: 5_000, totalMax: 2_000_000, count: 10, months: 120, rate: 0.085 } as const;
