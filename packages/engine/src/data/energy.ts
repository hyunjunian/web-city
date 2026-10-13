import type { StructureKind } from './structures';

/** The part of full-load plant upkeep spent on generation, independent of the maintenance budget. Assumed operating cost splits. */
export const GENERATION_COST_SHARE: Partial<Record<StructureKind, number>> = {
  coalPlant: 0.35, oilPlant: 0.45, gasPlant: 0.55, nuclearPlant: 0.15,
  windPlant: 0, solarPlant: 0, hydrogenPlant: 0.5,
};

/** Polluting thermal equipment kept ready emits a small share even while idle. */
export const IDLE_EMISSION_SHARE = 0.15;

/** Relative weight of water pollution when ranking generators for clean dispatch. */
export const WATER_EMISSION_WEIGHT = 1;
