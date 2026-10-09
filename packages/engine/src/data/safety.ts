// Police, crime and fire.

import type { PerType } from '../types';
import type { Curve } from './services';

// ---------------------------------------------------------------- crime

/** Base criminality (share of a wealth level's residents) by its average EQ. */
export const BASE_CRIMINALITY: [Curve, Curve, Curve] = [
  [[0, 0.4], [100, 0.3], [200, 0]],
  [[0, 0.15], [100, 0.11], [200, 0]],
  [[0, 0.1], [100, 0.07], [200, 0]],
];
/**
 * Percentage points added to criminality by that wealth level's unemployment
 * rate. Full employment lowers it, bad times add up to +10; the breakpoints
 * are ours.
 */
export const UNEMPLOYMENT_CRIME: Curve = [[0, -0.02], [0.05, 0], [0.15, 0.05], [0.25, 0.1]];
/** 1,000 criminals commit one crime a month. */
export const CRIMINALS_PER_CRIME = 1000;
/** 66% of criminals who got away strike again next month. */
export const CRIME_CARRY_OVER = 0.66;
/** Police prevent at most 50% of crimes. Prevention = protection / divisor. */
export const MAX_SUPPRESSION = 0.5;
export const SUPPRESSION_DIVISOR = 400;
/** A crime on a tile with protection above 20 ends in an arrest. */
export const ARREST_THRESHOLD = 20;
/** Lot classes that decide where each crime can happen ("other": landmarks, deals, civic, utility and transport). */
export type CrimeLot = 'other' | 'res' | 'svc' | 'office' | 'tourism' | 'dirty' | 'manuf' | 'hightech' | 'agri';
const NOT_FARMS: readonly CrimeLot[] = ['other', 'res', 'svc', 'office', 'tourism', 'dirty', 'manuf', 'hightech'];

/**
 * The 13 crimes: relative odds and where each can happen.
 * `wealth` limits residential and business lots to those wealth levels
 * (0 low, 1 medium, 2 high); `abandoned` only strikes abandoned lots.
 */
export const CRIME_TYPES: readonly { id: string; odds: number; lots: readonly CrimeLot[]; wealth?: readonly number[]; abandoned?: boolean }[] = [
  { id: 'arson', odds: 1.3, lots: NOT_FARMS, wealth: [0, 1], abandoned: true },
  { id: 'bankRobbery', odds: 5.5, lots: ['svc', 'office'] },
  { id: 'assault', odds: 5.5, lots: NOT_FARMS },
  { id: 'stickUp', odds: 5.5, lots: ['svc', 'office'] },
  { id: 'drugs', odds: 5.5, lots: ['svc', 'office', 'tourism'] },
  { id: 'carTheft', odds: 8.2, lots: NOT_FARMS },
  { id: 'fighting', odds: 8.2, lots: [...NOT_FARMS, 'agri'] },
  { id: 'purseSnatching', odds: 8.2, lots: ['svc', 'tourism'] },
  { id: 'solicitation', odds: 8.2, lots: ['svc', 'office', 'tourism'] },
  { id: 'flashing', odds: 10.9, lots: NOT_FARMS },
  { id: 'pieThrowing', odds: 10.9, lots: NOT_FARMS },
  { id: 'graffiti', odds: 10.9, lots: NOT_FARMS },
  { id: 'tping', odds: 10.9, lots: ['res'], wealth: [1, 2] },
];

/** Reward buildings counted as Tourism lots (our choice: these draw visitors). */
export const TOURISM_LOTS: readonly string[] = ['touristTrap', 'resortHotel', 'casino', 'cruiseShipPort', 'stateFair'];
/** Average months an inmate serves (assumed; keeps small cities jail-free). */
export const SENTENCE_MONTHS = 24;
/** An overcrowded jail can break out down to 80% full. */
export const JAILBREAK_TARGET = 0.8;

/** Recent crime spreads over this radius and fades by this factor each month. */
export const CRIME_RADIUS = 8;
export const CRIME_DECAY = 0.75;
/**
 * Crime level at which the desirability factor turns negative (higher = more
 * tolerant; low wealth tolerates more) and where it bottoms out.
 */
export const CRIME_TOLERANCE: PerType = {
  'R$': 2, 'R$$': 1.2, 'R$$$': 0.6,
  'Cs$': 2, 'Cs$$': 1.2, 'Cs$$$': 0.6,
  'Co$$': 1.2, 'Co$$$': 0.6,
  IA: 2.5, ID: 2.5, IM: 2, IHT: 0.6,
};
export const CRIME_LEVEL_MAX = 6;

// ---------------------------------------------------------------- fire

/**
 * Flammability of RCI buildings: base by developer type plus a bonus by
 * stage. The values are assumed; dense or dry industry and abandoned,
 * unwatered buildings cross the hotspot line of 54.
 */
export const FLAMMABILITY_BASE: PerType = {
  'R$': 26, 'R$$': 24, 'R$$$': 22,
  'Cs$': 28, 'Cs$$': 27, 'Cs$$$': 26,
  'Co$$': 26, 'Co$$$': 25,
  IA: 20, ID: 44, IM: 38, IHT: 26,
};
export const FLAMMABILITY_STAGE_BONUS = [0, 1, 2, 3, 5, 7, 9, 11] as const;
/** No water ×1.25, abandoned ×1.5 (both ×1.875). */
export const FLAMMABILITY_DRY = 1.25;
export const FLAMMABILITY_ABANDONED = 1.5;
/** Default flammability of civic buildings by category when not set per building. */
export const CIVIC_FLAMMABILITY = { park: 5, power: 60, water: 30, garbage: 66, health: 32, education: 32, safety: 28, transport: 20, reward: 48, deal: 48, landmark: 48 } as const;

/**
 * Fires catch on trees too. How they spread is assumed: a burning tree tile
 * lights each wooded neighbour with this daily chance (more downwind, scaled by
 * wind strength), lights an adjacent building with chance × its flammability,
 * and is burned (the tree gone) after `burnDays`; fire cover puts it out.
 * About one new tile per burning one: a forest fire smoulders on rather than
 * sweeping a whole woodland in days.
 */
export const TREE_FIRE = { spread: 0.06, burnDays: 3 };

/** A fire starts somewhere in the city with this chance each month. */
export const MONTHLY_FIRE_CHANCE = 0.05;
/** Hotspot = at least 40 tiles of flammability ≥ 54 within 8 tiles. */
export const HOTSPOT_FLAMMABILITY = 54;
export const HOTSPOT_RADIUS = 8;
/** Monthly fire chance by high-flammability tile count (Rush Hour). */
export const HOTSPOT_CHANCE: Curve = [[39, 0], [40, 0.07], [50, 0.15], [70, 0.2], [100, 0.25]];

/** Protection P cuts ignition chance by max(0.05, 1 − P / divisor). */
export const IGNITION_PROTECTION = 250;
/** A fire is beaten back when protection ≥ stage × this. */
export const PROTECTION_PER_STAGE = 40;
/** Daily chance a fire grows a stage (×1.25 without water) and spreads (per stage). */
export const FIRE_GROW_CHANCE = 0.25;
export const FIRE_SPREAD_CHANCE = 0.04;
/** Days at its maximum stage (or in total) before a building burns down. */
export const BURN_DAYS_AT_MAX = 5;
export const MAX_BURN_DAYS = 20;
/** Fire trucks bring 96 protection (radius 8). */
export const DISPATCH_PROTECTION = 96;
/** Fire trucks reach fires at most this many road tiles away: half the width of a medium map. */
export const DISPATCH_RANGE = 64;

/**
 * Dispatch units: fire trucks spray 96 at the centre to 32 at 8
 * tiles and need a road within 8 tiles of the fire; police cars 200 to 20 at
 * 3 tiles. Below 85% (fire) or 60% (police) funding crews fumble; strikes
 * cut them to 20%. Fire planes and police helicopters (Rush Hour) ignore
 * funding and roads. Ground units drive the road network from their station
 * and go the last `roadReach` tiles on foot (police: tuning value). Travel:
 * tiles per day, then days on site (assumed).
 */
export const DISPATCH = {
  fire: { center: 96, edge: 32, radius: 8, competentFunding: 85, fumble: 0.5, roadReach: 8 },
  police: { center: 200, edge: 20, radius: 3, competentFunding: 60, fumble: 0.4, roadReach: 8 },
  tilesPerDay: 48, onSiteDays: 3,
  /** Aircraft take this long to get off the ground (days assumed). */
  airLaunchDays: 1,
} as const;
/** Bulldozing rubble, per tile. */
export const RUBBLE_BULLDOZE = 5;

/**
 * A fire's short-term Mayor Rating hit is −20 within 8 tiles, easing
 * 25% of the initial amount each month; in Rush Hour it also lowers
 * desirability (≈ effect × 100/127).
 */
export const FIRE_EVENT = { amount: -20, radius: 8, months: 4 } as const;
export const EVENT_TO_DESIRABILITY = 100 / 127;

// ---------------------------------------------------------------- shared

/** Funding % → radius/strength multiplier (+10% at most at 120%). */
export const SAFETY_FUNDING: Curve = [[0, 0], [100, 1], [120, 1.1]];
/** No road at a fire station costs 20% of its radius and strength. */
export const FIRE_NO_ROAD = 0.8;
/** Monthly strike chance below full funding: k × (1 − funding)². */
export const SAFETY_STRIKE_CHANCE = 0.5;
/** Strikes end once funding is back above 90%. */
export const SAFETY_STRIKE_END_FUNDING = 90;

