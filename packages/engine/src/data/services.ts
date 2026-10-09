// Power, health and education tuning.

import type { PerType, PerWealth } from '../types';
import type { EduCurve } from './structures';

/** [x, y] breakpoints, linearly interpolated, clamped at the ends. */
export type Curve = readonly (readonly [number, number])[];

export function interp(curve: Curve, x: number): number {
  const first = curve[0]!;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i]!;
    const [x0, y0] = curve[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return curve[curve.length - 1]![1];
}

// ---------------------------------------------------------------- power

/** Power plant upkeep by age (life % → cost multiplier). */
export const PLANT_MAINTENANCE_BY_AGE: Curve = [
  [0, 1], [40, 1.03], [50, 1.05], [65, 1.15], [75, 1.3], [85, 1.55], [90, 1.85], [100, 3],
];
/** Power plant output by age (life % → share of capacity). */
export const PLANT_OUTPUT_BY_AGE: Curve = [
  [0, 1], [40, 0.95], [50, 0.92], [60, 0.86], [70, 0.77], [80, 0.6], [90, 0.35], [100, 0],
];
/** Plant aging speed by funding (funding % → aging multiplier). */
export const PLANT_DECAY_BY_FUNDING: Curve = [[0, 1.1], [100, 1], [120, 0.9]];
/**
 * Plant aging speed by load (capacity used % → aging multiplier). A listed
 * life expectancy holds at 100% capacity, so values are divided by
 * the 100% row (155%) to make a fully loaded plant last its listed life.
 */
export const PLANT_DECAY_BY_USAGE: Curve = [
  [0, 0.1 / 1.55], [25, 0.2 / 1.55], [50, 0.45 / 1.55], [75, 0.85 / 1.55],
  [90, 1.25 / 1.55], [100, 1], [110, 2 / 1.55], [120, 2.45 / 1.55],
];
/** A plant at or past this share of its life looks distressed. */
export const PLANT_DISTRESSED_LIFE = 90;
/** Tiles around an exploding plant whose buildings are destroyed. */
export const PLANT_EXPLOSION_RADIUS = 3;

/** Power reaches across gaps of up to this many tiles between conductors. */
export const POWER_GAP = 4;
/** Power line costs (§2 per tile, §0.10 a month, §5 to bulldoze). */
export const POWER_LINE_COST = { build: 2, upkeep: 0.1, bulldoze: 5 } as const;
/** Months an RCI building survives without power. */
export const NO_POWER_MONTHS = 6;

/**
 * MWh per month per resident or job. RCI consumption is assumed; these
 * make ~85,000 residents and jobs use about the 25,000 MWh the Nuclear plant
 * reward expects.
 */
export const POWER_PER_CAPITA: PerType = {
  'R$': 0.18, 'R$$': 0.22, 'R$$$': 0.28,
  'Cs$': 0.25, 'Cs$$': 0.28, 'Cs$$$': 0.32,
  'Co$$': 0.32, 'Co$$$': 0.38,
  IA: 0.15, ID: 0.55, IM: 0.45, IHT: 0.35,
};

// ---------------------------------------------------------------- quotients

/** HQ and EQ run from 0 to 200. */
export const QUOTIENT_MAX = 200;
/** Both drop 0.2 points every month regardless of services. */
export const QUOTIENT_DECAY = 0.2;
/** At the end of life a household passes on 80% of its HQ and EQ. */
export const INHERITANCE = 0.8;
/** Starting EQ/HQ by wealth. */
export const BASE_QUOTIENT: PerWealth = [20, 40, 60];
/** A household starts at this average age; new buildings get a spread of ages. */
export const START_AGE = 20;
export const START_AGE_SPREAD = 25;

/**
 * Life expectancy in years from HQ (breakpoints assumed): higher HQ means
 * longer lives, and a lifetime at best health is about 50 years of play.
 */
export const LIFE_EXPECTANCY_BY_HQ: Curve = [[0, 35], [100, 45], [200, 55]];

/**
 * Share of residents in the workforce by average HQ (about half, shifting
 * with health).
 */
export const WORKFORCE_BY_HQ: Curve = [[0, 0.44], [100, 0.5], [200, 0.55]];

// ---------------------------------------------------------------- health

/**
 * HQ points per month per point of a building's HQ boost (Clinic and
 * Medical Center 11.52, Disease Research Lab 8), at full effectiveness.
 * Tuned so a fully covered, unpolluted R$ population reaches HQ 200 in
 * about 65 years across generations, and about 50 with the health rewards
 * (at 0.045 it was 52 and 22).
 */
export const HQ_PER_BOOST = 0.04;
/**
 * HQ lost per month per unit of air + water pollution on the tract above
 * HQ_POLLUTION_FREE (medium pollution, as My Sims judge it). Assumed: bad
 * enough pollution can undo healthcare, but a fully effective clinic still
 * wins up to about 300.
 */
export const HQ_PER_POLLUTION = 0.0015;
export const HQ_POLLUTION_FREE = 100;
/**
 * Radiation counts toward that pollution; its strength is assumed: a
 * radioactive tile weighs like heavy smog (a coal plant's 200).
 */
export const RADIATION_POLLUTION = 200;
/**
 * Share of residents in a hospital's radius that count as patients
 * (assumed): a 500-place clinic serves about 7,000 people.
 */
export const PATIENT_FRACTION = 0.07;

/** Health quality (0–1) at which the desirability factor turns positive. */
export const HEALTH_TOLERANCE: PerWealth = [0.3, 0.5, 0.7];

// ---------------------------------------------------------------- education

/**
 * EQ boost (%) by average household age for each kind of school. Private
 * School and Opera House follow their age ranges (20–59 and 50–100) with a
 * school's and the museum's strength.
 */
export const EDU_CURVES: Record<EduCurve, Curve> = {
  elementary: [[20, 5], [30, 5], [40, 0.5], [50, 0]],
  highSchool: [[20, 0], [30, 0.5], [40, 5], [60, 0]],
  college: [[20, 0], [30, 0.5], [40, 1.5], [50, 5], [70, 0.5], [80, 0]],
  university: [[20, 2.5], [30, 0.5], [40, 0.5], [50, 5], [60, 5], [70, 1.5], [80, 0.5]],
  library: [[20, 30], [60, 30], [80, 20]],
  // Main City Library and Major Art Museum have the same age ranges
  // but are separate kinds: one doesn't average the other down.
  mainLibrary: [[20, 30], [60, 30], [80, 20]],
  museum: [[20, 0], [30, 0.3], [50, 0.3], [60, 0.7], [70, 1.5], [80, 3]],
  artMuseum: [[20, 0], [30, 0.3], [50, 0.3], [60, 0.7], [70, 1.5], [80, 3]],
  privateSchool: [[20, 5], [50, 5], [60, 0]],
  opera: [[45, 0], [50, 0.3], [60, 0.7], [70, 1.5], [80, 3]],
};

/**
 * Weight of each curve when turned into EQ points. Targets: R$
 * reaches max EQ in four generations with schools only, three with
 * libraries added, one with every building. Libraries' curve (30) is far
 * larger than schools' (5) yet they only save one generation, so they are
 * scaled down. The Private School counts 0.3: at full weight, schools with
 * it reached 200 in one generation, as only every building together should.
 */
export const EDU_WEIGHT: Record<EduCurve, number> = {
  elementary: 1, highSchool: 1, college: 1, university: 1, library: 0.02, mainLibrary: 0.02, museum: 0.5, artMuseum: 0.5, privateSchool: 0.3, opera: 0.5,
};
/**
 * EQ points per month per weighted boost point at full effectiveness. With
 * schools, Private School and college, R$ at HQ 100 reaches 200 in the third
 * generation (target: fourth), with libraries the third, with every
 * educational building the first. (Slower to match the fourth left a town
 * with no workers above EQ1 after ten years.)
 */
export const EQ_PER_BOOST = 0.06;
/**
 * Share of residents in a school's radius that count as students, weighted by
 * how much the school does at their age (assumed): a 500-place
 * elementary school serves about 8,000 people.
 */
export const STUDENT_FRACTION = 0.1;

/** School quality (0–1) at which the desirability factor turns positive. */
export const SCHOOL_TOLERANCE: PerWealth = [0.25, 0.4, 0.6];

// ---------------------------------------------------------------- funding

/**
 * Capacity multiplier by funding % for schools and hospitals: linear to 100%,
 * then little gain (next to none past 110%).
 */
/**
 * Local bus/ambulance funding (percent) → radius multiplier. More funding
 * enlarges the radius and less shrinks it; the curve is a tuning value.
 */
export const RADIUS_BY_VEHICLE_FUNDING: Curve = [[0, 0.5], [100, 1], [200, 1.4]];
export const CAPACITY_BY_FUNDING: Curve = [[0, 0], [100, 1], [110, 1.05], [150, 1.07]];
/** Effectiveness while on strike. */
export const STRIKE_EFFECTIVENESS = 0.2;
/** Monthly strike chance at the worst grade; grows linearly as grade drops. */
export const STRIKE_CHANCE = 0.06;
/** A strike ends once grade is back to 4 of 5 or after this many months. */
export const STRIKE_END_GRADE = 0.8;
export const STRIKE_MAX_MONTHS = 18;

// ---------------------------------------------------------------- water

/** Water and garbage building upkeep by age (life % → cost multiplier). */
export const WATER_MAINTENANCE_BY_AGE: Curve = [
  [0, 1], [50, 1.03], [65, 1.1], [75, 1.2], [90, 1.5], [100, 1.75], [110, 2.2],
];
/** Water and garbage building output by age (life % → share of capacity). Pumps die at 110%. */
export const WATER_OUTPUT_BY_AGE: Curve = [
  [0, 1], [50, 0.95], [65, 0.9], [75, 0.8], [90, 0.55], [100, 0.3], [110, 0],
];
/** Pipes and water structures water every tile within this many tiles. */
export const WATER_RADIUS = 6;
/**
 * Pipe costs: §11 per segment, as in the game. Upkeep §0.10, bulldoze §1.
 */
export const PIPE_COST = { build: 11, upkeep: 0.1, bulldoze: 1 } as const;
/** Months a building above its water stage cap survives without water. */
export const NO_WATER_MONTHS = 6;
/** Pumps and towers shut down when water pollution on their tile exceeds this. */
export const PUMP_POLLUTION_LIMIT = 512;

/**
 * Highest stage each developer type builds without city water (well
 * water). 0 = nothing develops without water.
 */
export const WATER_STAGE_CAP: PerType = {
  'R$': 3, 'R$$': 3, 'R$$$': 0,
  'Cs$': 3, 'Cs$$': 3, 'Cs$$$': 0,
  'Co$$': 3, 'Co$$$': 0,
  IA: 3, ID: 1, IM: 1, IHT: 0,
};

/**
 * Cubic meters per month per resident or job. RCI water use is
 * assumed; these make a 10,000-resident city use about the 40,000 m³ that
 * unlocks the Large Water Pump.
 */
export const WATER_PER_CAPITA: PerType = {
  'R$': 2.2, 'R$$': 2.6, 'R$$$': 3.2,
  'Cs$': 2, 'Cs$$': 2.2, 'Cs$$$': 2.5,
  'Co$$': 2.2, 'Co$$$': 2.5,
  IA: 1, ID: 3.5, IM: 3, IHT: 2.5,
};
