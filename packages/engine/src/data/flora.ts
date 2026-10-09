// Trees: landscaping, pollution and Mayor Rating.

/**
 * Plant Flora: §3 a sapling; saplings take three to five years to grow
 * (four used here). Trees cut local air pollution by 2 a sapling, up to 7
 * for clumps of grown trees. Planting cheers the neighbourhood: +3 within
 * radius 32 (two tiles, read like the fire event's 128 = 8 tiles).
 */
export const FLORA = {
  saplingCost: 3,
  grownMonths: 48,
  /**
   * Grown trees eventually give way to saplings and the cycle repeats; the
   * lifespan, twenty years, is assumed.
   */
  lifeMonths: 240,
  sapling: 2,
  clump: 7,
  event: { amount: 3, radius: 2, months: 4 },
} as const;
