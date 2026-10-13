// Capital maintenance is an engine extension. Prices are shares of the
// equivalent new asset, so mods that change construction prices stay balanced.

/** A major overhaul retains the foundations and restores the machinery to this life percentage. */
export const REFURBISHMENT = {
  targetLife: 20,
  /** No paid overhaul until at least this much useful life can be recovered. */
  minRecovery: 10,
  /** Mobilisation plus the share of a replacement represented by recovered life. */
  fixedCostShare: 0.15,
  recoveredLifeCostShare: 0.85,
} as const;

/** Network repairs retain the route and foundations; severe wear costs more to mend. */
export const NETWORK_REPAIR = {
  fixedCostShare: 0.2,
  wearCostShare: 0.6,
  /** Resurfacing asphalt or renewing damaged rails, relative to new construction. */
  damageCostShare: 0.5,
} as const;
