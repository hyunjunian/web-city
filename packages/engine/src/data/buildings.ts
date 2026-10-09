// Building templates. Footprints and capacities are tuning values, chosen so
// that an R$$ starter house holds 12 Sims (17 once it drops to R$) and
// wealthy Sims need larger lots.

import type { DevType, PerType, ZoneClass } from '../types';

export interface StageTemplate {
  /** Square footprint side in tiles. */
  size: number;
  /** Residents (R) or jobs (C/I) at full occupancy. */
  capacity: number;
}

const res: StageTemplate[] = [
  { size: 1, capacity: 12 },
  { size: 1, capacity: 24 },
  { size: 2, capacity: 70 },
  { size: 2, capacity: 160 },
  { size: 2, capacity: 360 },
  { size: 3, capacity: 800 },
  { size: 3, capacity: 1700 },
  { size: 4, capacity: 3800 },
];

const service: StageTemplate[] = [
  { size: 1, capacity: 8 },
  { size: 1, capacity: 16 },
  { size: 2, capacity: 40 },
  { size: 2, capacity: 90 },
  { size: 2, capacity: 200 },
  { size: 3, capacity: 450 },
  { size: 3, capacity: 950 },
  { size: 4, capacity: 2200 },
];

const office: StageTemplate[] = service.map((s) => ({ size: s.size, capacity: Math.round(s.capacity * 1.5) }));

const industry: StageTemplate[] = [
  { size: 2, capacity: 40 },
  { size: 3, capacity: 120 },
  { size: 4, capacity: 320 },
];

const farm: StageTemplate[] = [
  { size: 3, capacity: 12 },
  { size: 4, capacity: 20 },
  { size: 4, capacity: 30 },
];

export const STAGE_TEMPLATES: Record<DevType, readonly StageTemplate[]> = {
  'R$': res, 'R$$': res, 'R$$$': res,
  'Cs$': service, 'Cs$$': service, 'Cs$$$': service,
  'Co$$': office, 'Co$$$': office,
  IA: farm, ID: industry, IM: industry, IHT: industry,
};

/** Capacity multiplier by occupant type: poorer Sims take less space (12 → 17). */
export const CAPACITY_MULT: PerType = {
  'R$': 17 / 12, 'R$$': 1, 'R$$$': 0.65,
  'Cs$': 1, 'Cs$$': 1, 'Cs$$$': 1, 'Co$$': 1, 'Co$$$': 1,
  IA: 1, ID: 1, IM: 1, IHT: 1,
};

/** Wealthy residents want yards: footprint grows by this for stages 1–3. */
export const LOT_BONUS: Partial<Record<DevType, number>> = { 'R$$$': 1 };

export function stageCount(t: DevType): number {
  return STAGE_TEMPLATES[t].length;
}

/**
 * Air pollution emitted per building: strength at the source (× stage) and radius. Among the worst air
 * polluters, the average Dirty Industry building ranks below a Natural Gas plant (60) and above the
 * international airports (~25), Manufacturing below those airports and above a large municipal one (15):
 * at the stage-2 average, ID ≈ 40 and IM ≈ 20.
 */
export const AIR_POLLUTION: Partial<Record<DevType, { perStage: number; radius: number }>> = {
  ID: { perStage: 20, radius: 9 },
  IM: { perStage: 10, radius: 7 },
  IHT: { perStage: 4, radius: 3 },
  IA: { perStage: 5, radius: 3 },
};
/**
 * Water pollution per building. Farms: WP 4 within 6 tiles from every tile of
 * the farm (`perTile`). Industry: assumed beyond Dirty Industry being a heavy
 * water polluter; set at about half its air rating, ID > IM > IHT.
 */
export const WATER_POLLUTION: Partial<Record<DevType, { perStage: number; radius: number; perTile?: boolean }>> = {
  ID: { perStage: 20, radius: 6 },
  IM: { perStage: 8, radius: 4 },
  IHT: { perStage: 1, radius: 2 },
  IA: { perStage: 4, radius: 6, perTile: true },
};
/** Air pollution per trip/day on a road tile (radius 2). */
export const TRAFFIC_POLLUTION = 0.02;

/** Which zone class a developer type grows in. IA grows only in agricultural zones. */
export function zoneFor(t: DevType): ZoneClass {
  return t[0] === 'R' ? 'R' : t[0] === 'C' ? 'C' : 'I';
}

/**
 * Who may displace whom when redeveloping: occupants can be
 * supplanted only by a wealthier type.
 */
export const CAN_DISPLACE: Partial<Record<DevType, readonly DevType[]>> = {
  'R$$': ['R$'],
  'R$$$': ['R$$', 'R$'],
  'Cs$$': ['Cs$'],
  'Cs$$$': ['Cs$$', 'Cs$', 'Co$$'],
  'Co$$': ['Cs$'],
  'Co$$$': ['Co$$', 'Cs$$', 'Cs$'],
  IM: ['ID'],
  IHT: ['IM', 'ID'],
};

/** Downgrade chains: a building may be reoccupied by a lower type in its line. */
export const DOWNGRADE: Partial<Record<DevType, readonly DevType[]>> = {
  'R$$$': ['R$$', 'R$'],
  'R$$': ['R$'],
  'Cs$$$': ['Cs$$', 'Cs$'],
  'Cs$$': ['Cs$'],
  'Co$$$': ['Co$$'],
};
