// Elevation. Heights are in metres above the water
// (water tiles sit at 0); slope is the largest height step to a neighbour.

/**
 * Slope classes: flat, medium, steep and too steep to develop. Industry likes
 * flat land (full slope bonus), less on medium slopes, none on steep ones;
 * slope also caps how big a building can get (a soft stage limit).
 */
export const SLOPE = {
  flat: 2,
  medium: 5,
  steep: 9,
  /** Highest stage that can stand on flat, medium, steep land (beyond steep: none). */
  maxStage: [8, 6, 3] as readonly number[],
} as const;

/**
 * Inherent land value from height: ground above the average elevation of zoned
 * land gains up to `max`, rising to `peak` metres above average and falling
 * back to nothing at `zero` (ground can sit too high to be worth much).
 */
export const ELEVATION_LAND_VALUE = { max: 25, peak: 24, zero: 80 } as const;

/** Raise / lower terrain tool: metres a click and § per tile (assumed). */
export const TERRAFORM_STEP = { metres: 4, cost: 25 } as const;

/** Height of flat maps (no hills), and the hills' range on generated maps. */
export const HEIGHTS = { flat: 20, base: 6, hills: 48, shore: 24 } as const;

/**
 * Grayscale topographical maps: 0 is the ocean floor, 83 sea level, 255 the
 * highest ground. Metres per shade is a tuning value.
 */
export const GRAYSCALE = { seaLevel: 83, metresPerStep: 1 } as const;
