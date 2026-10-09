// Civic structures.

import { DEALS, LANDMARKS, REWARDS } from './rewards';

export type StructureCategory =
  | 'park' | 'power' | 'water' | 'garbage' | 'health' | 'education' | 'safety' | 'transport' | 'reward' | 'deal' | 'landmark';

/** When a business deal is offered (on signs of lasting money trouble). */
export interface DealOffer {
  description: string;
  fundsBelow?: number;
  /** Funds fell by this share (or amount) over the last `months` months. */
  drop?: { months: number; fraction?: number; amount?: number };
  /** Last month's expenses exceeded income. */
  deficit?: boolean;
  population?: number;
  ordinance?: string;
  difficulty?: string;
}

/** Mass transit stops: what they board, how many, and the wait to board. */
export interface StationDef {
  mode: 'bus' | 'subway' | 'rail' | 'freight' | 'monorail' | 'ferry' | 'carFerry';
  /** Boardings a month it handles before the wait grows. */
  capacity: number;
  /** Centi-hours to board at full funding. */
  switchCost: number;
}

/** Power plant data. */
export interface PlantDef {
  /** MWh per month at full condition and funding. */
  output: number;
  /** Life expectancy in years at 100% funding and nominal load. */
  lifeYears: number;
  air: readonly [strength: number, radius: number];
  water: readonly [strength: number, radius: number];
}

/** Health or school coverage. */
export interface ServiceDef {
  radius: number;
  /** Patients or students served at full effectiveness and 100% funding. */
  capacity: number;
  /** The building's HQ or EQ boost. */
  boost: number;
  /** School buses or ambulances: monthly cost at 100% local funding (tuning); funding scales the radius. */
  vehicles?: number;
}

export interface StructureDef {
  name: string;
  category: StructureCategory;
  w: number;
  h: number;
  cost: number;
  /** Monthly cost at 100% funding. */
  upkeep: number;
  /** Demand cap relief for R$, R$$, R$$$. */
  relief: readonly [number, number, number];
  /** Commercial effect and radius, residential effect and radius (NIMBY/YIMBY). */
  com: readonly [effect: number, radius: number];
  res: readonly [effect: number, radius: number];
  /** Jobs offered to R$, R$$, R$$$ workers. */
  jobs: readonly [number, number, number];
  /** MWh per month the building consumes. */
  powerUse: number;
  /** Cubic meters of water per month it consumes when watered. */
  waterUse: number;
  /** Tons of garbage per month it produces. */
  garbage: number;
  /** Waste to Energy: burns up to `capacity` tons a month for `powerPerTon` MWh each. */
  incinerator?: { capacity: number; powerPerTon: number; lifeYears: number; air: readonly [number, number]; water: readonly [number, number] };
  /** Recycling Center: cuts citywide garbage by `reduction` for up to `residents` residents. */
  recycling?: { residents: number; reduction: number; lifeYears: number };
  plant?: PlantDef;
  /** Water pumps and towers. */
  pump?: { output: number; lifeYears: number };
  /** Police: protection from `center` at the station to 0 at `radius`; jail cells; cars (and a helicopter). */
  /** Police: protection, cells (radius 0: a jail), units to dispatch; `overcapacityCost` makes a jail that never overflows but charges per extra inmate a month. */
  police?: { radius: number; center: number; cells: number; units?: number; air?: number; overcapacityCost?: number };
  /** Fire: protection from `center` to `edge` at `radius`; trucks (and a fire plane) to dispatch. */
  fire?: { radius: number; center: number; edge: number; needsRoad: boolean; units?: number; air?: number };
  /** Flammability (0–255); defaults by category (see safety.ts). */
  flammability?: number;
  /** Highest fire stage a fire here can reach (default 4). */
  maxFire?: number;
  /** Water Treatment Plant: lowers water pollution from `center` at the plant to `edge` at `radius`. */
  /** Water Treatment Plant: cleaning strength at the plant and the radius edge, life expectancy (years). */
  treatment?: { center: number; edge: number; radius: number; lifeYears: number };
  health?: ServiceDef;
  /** School coverage; `curve` names the EQ-boost-by-age curve in services.ts. */
  school?: ServiceDef & { curve: EduCurve };
  station?: StationDef;
  /** Public Parking Garage: drivers park and walk on, paying `switchCost`. */
  parking?: { capacity: number; switchCost: number };
  /** Airport: Commercial Office cap relief up to `capacity`. */
  airport?: { capacity: number };
  /** Seaport: a freight destination giving `perTrip` industrial cap relief per trip, up to `relief`. */
  seaport?: { relief: number; perTrip: number };
  /** Must be built part on land, part on water. */
  onWater?: boolean;
  /** Reward unlock condition, checked against the city's census. */
  unlock?: Unlock;
  /** Rewards earned one copy at a time (Houses of Worship, Cemetery, Private School). */
  unlockTiers?: readonly Unlock[];
  /** Business deals: offered when the city's finances look like this. */
  offer?: DealOffer;
  /** Most copies a city may have (rewards and deals: one). */
  limit?: number;
  /** Bulldozing cost (as revised in Rush Hour); default is the generic building fee. */
  bulldoze?: number;
  /** Casino: Commercial Service demand it creates for Cs$, Cs$$, Cs$$$ (the only building that does). */
  serviceDemand?: readonly [number, number, number];
  /** Monthly income (business deals), paid even without utilities. */
  income?: number;
  /** Mayor Rating effect on tracts within `radius` tiles, fading with distance. */
  mayor?: readonly [effect: number, radius: number];
  /** Cuts police suppression by `effect` percent within `radius` tiles. */
  crimeEffect?: readonly [effect: number, radius: number];
  /** Extra cap relief for Commercial Office ($$, $$$) and industry. */
  officeRelief?: readonly [number, number];
  industryRelief?: Partial<Record<'IA' | 'ID' | 'IM' | 'IHT', number>>;
  /** Air pollution and radius, water pollution and radius (negative air cleans it). */
  pollution?: readonly [air: number, airRadius: number, water: number, waterRadius: number];
  /** Radiation: nothing develops within `radius` and it lingers `months` after removal. */
  radiation?: { radius: number; months: number };
  /** Missile Range: launches misfire with this chance a month, setting fires nearby. */
  missile?: { misfire: number; radius: number; fires: readonly [number, number] };
}

export type EduCurve = 'elementary' | 'highSchool' | 'college' | 'university' | 'library' | 'mainLibrary' | 'museum' | 'artMuseum' | 'privateSchool' | 'opera';

export interface Unlock {
  description: string;
  /** Residents of a type / jobs of a type / totals that must be reached. */
  population?: number;
  typePopulation?: Partial<Record<'R$$$' | 'IHT' | 'IA', number>>;
  residents?: number;
  powerDemand?: number;
  /** City water use, m³ a month. */
  waterDemand?: number;
  healthBuildings?: number;
  /** Citywide Mayor Rating needed. */
  mayorRating?: number;
  /** Rewards that must already stand in the city. */
  requires?: readonly string[];
  /** Park and recreation structures in the city. */
  parks?: number;
  /** Copies of other buildings needed (e.g. five local libraries). */
  buildings?: Readonly<Record<string, number>>;
  /** Copies of buildings with a grade above 85 (e.g. five libraries). */
  goodBuildings?: Readonly<Record<string, number>>;
  /** Copies of buildings at work: shipping or serving something last month (e.g. a working seaport). */
  workingBuildings?: Readonly<Record<string, number>>;
  /** City school grade (average grade of elementary and high schools, 0–100): at least `min`, below `below`. */
  schoolGrade?: { min?: number; below?: number };
  /** Health and education both well funded: a hospital and a school, all at 100% funding or more. */
  wellFunded?: boolean;
  /** At least one of these must stand in the city (e.g. any major airport). */
  anyOf?: readonly string[];
  /** Combined population (residents or jobs) of several developer types. */
  combined?: { types: readonly string[]; population: number };
  /** Neighbour connections (any kind). */
  connections?: number;
  /** Share of the map that is water. */
  waterShare?: number;
  /** A station of this kind running at this share of its capacity or more (Grand Railroad Station). */
  busyStation?: { kind: string; share: number };
  difficulty?: readonly string[];
  /** Regional play: conditions on the whole region (used instead of the city ones when in a region). */
  /** Alternative conditions: the unlock is also met when all of these are. */
  orElse?: Omit<Unlock, 'description' | 'orElse' | 'regional'>;
  /** Average air pollution over the city's buildings below LOW_POLLUTION (Resort Hotel: low pollution). */
  lowPollution?: boolean;
  regional?: { population?: number; highWealth?: number; cities?: number; connected?: number; linkedCities?: number; mayorRating?: number; lowPollution?: boolean };
}

const ZERO3 = [0, 0, 0] as const;
const NONE = [0, 0] as const;

type Extra = Partial<Omit<StructureDef, 'name' | 'category' | 'w' | 'h' | 'cost' | 'upkeep'>>;
const def = (
  name: string, category: StructureCategory, w: number, h: number, cost: number, upkeep: number, extra: Extra = {},
): StructureDef => ({ name, category, w, h, cost, upkeep, relief: ZERO3, com: NONE, res: NONE, jobs: ZERO3, powerUse: 0, waterUse: 0, garbage: 0, ...extra });

/** A park: cost, monthly and bulldoze cost, R relief, Com/Res YIMBY, air and water pollution. */
const park = (
  name: string, size: number | [number, number], cost: number, upkeep: number, bulldoze: number, relief: number,
  com: [number, number], res: [number, number], air: [number, number], water: [number, number],
  waterUse: number, garbage: number, extra: Extra = {},
): StructureDef => def(name, 'park', typeof size === 'number' ? size : size[0], typeof size === 'number' ? size : size[1], cost, upkeep, {
  relief: [relief, relief, relief], com, res, waterUse, garbage, bulldoze, pollution: [air[0], air[1], water[0], water[1]], ...extra,
});

const plant = (
  name: string, w: number, h: number, cost: number, upkeep: number, p: PlantDef,
  jobs: [number, number, number], extra: Extra = {},
): StructureDef => def(name, 'power', w, h, cost, upkeep, { plant: p, jobs, ...extra });

const airport = (
  name: string, w: number, h: number, cost: number, upkeep: number, capacity: number,
  jobs: [number, number, number], pollution: [number, number, number, number], garbage: number,
): StructureDef => def(name, 'transport', w, h, cost, upkeep, {
  airport: { capacity }, jobs, pollution, garbage, bulldoze: name.includes('Landing') ? 1_800 : 4_500, flammability: 40,
});

export const STRUCTURES = {
  smallParkGreen: park('Small Park Green', 1, 40, 5, 10, 250, [30, 15], [50, 15], [-2, 3], [1, 1], 5, 0),
  mediumParkGreen: park('Medium Park Green', 2, 160, 15, 20, 1_000, [20, 15], [60, 30], [-7, 4], [2, 2], 10, 0),
  largeParkGreen: park('Large Park Green', 3, 320, 25, 30, 2_500, [30, 15], [75, 45], [-15, 6], [4, 3], 15, 0),
  smallPlaza: park('Small Plaza', 1, 90, 10, 10, 1_000, [50, 15], [25, 15], [0, 0], [0, 0], 0, 1),
  mediumPlaza: park('Medium Plaza', 2, 210, 25, 20, 4_000, [60, 15], [25, 25], [0, 0], [1, 0], 0, 0),
  largePlaza: park('Large Plaza', 3, 400, 35, 40, 9_000, [80, 15], [35, 30], [0, 0], [0, 0], 0, 1),
  smallFlowerGarden: park('Small Flower Garden', 1, 80, 5, 10, 750, [20, 10], [60, 15], [-2, 2], [1, 1], 5, 0),
  mediumFlowerGarden: park('Medium Flower Garden', 2, 170, 20, 20, 3_000, [20, 10], [70, 30], [-7, 4], [2, 2], 10, 0),
  largeFlowerGarden: park('Large Flower Garden', 3, 310, 35, 30, 7_000, [35, 10], [85, 45], [-15, 6], [3, 3], 15, 0),
  playground: park('Playground', 1, 90, 10, 10, 1_000, [0, 0], [60, 15], [-1, 2], [1, 1], 1, 0),
  mediumPlayground: park('Medium Playground', 2, 210, 25, 20, 3_000, [0, 0], [75, 25], [-5, 4], [2, 1], 2, 1),
  basketballCourt: park('Basketball Court', [2, 1], 90, 10, 10, 1_000, [0, 0], [30, 30], [0, 0], [0, 0], 0, 1, { powerUse: 1 }),
  tennisCourt: park('Tennis Court', [2, 1], 130, 15, 10, 4_000, [0, 0], [30, 30], [0, 0], [0, 0], 0, 1),
  skateboardPark: park('Skateboard Park', [2, 1], 210, 25, 20, 4_000, [0, 0], [30, 60], [0, 0], [0, 0], 0, 0),
  soccerField: park('Soccer Field', [3, 5], 340, 35, 30, 5_000, [20, 5], [30, 50], [-8, 5], [4, 3], 80, 7),
  softballField: park('Softball Field', 3, 400, 35, 40, 6_000, [20, 5], [30, 50], [-10, 5], [4, 4], 90, 6),
  gazebo: park('Gazebo', 1, 90, 10, 10, 1_000, [20, 10], [40, 40], [-1, 2], [1, 2], 5, 1),
  communityGarden: park('Community Garden', 2, 70, 5, 10, 250, [0, 0], [40, 35], [-2, 3], [1, 1], 15, 0),
  openGrass: park('Open Grass Area', 1, 40, 5, 10, 250, [20, 10], [30, 15], [-2, 2], [1, 1], 5, 0),
  openPaved: park('Open Paved Area', 1, 40, 5, 10, 250, [30, 10], [10, 10], [0, 0], [0, 0], 0, 1),
  rangerStation: park('Ranger Station', [2, 1], 90, 10, 10, 1_000, [0, 0], [20, 80], [-3, 2], [1, 1], 10, 1),
  // Beaches go on the shore.
  beach: park('Beach', [7, 5], 70, 5, 10, 250, [50, 10], [80, 10], [0, 0], [0, 0], 0, 1, { onWater: true }),

  // ---- Power. The Waste to Energy plant is under garbage.
  coalPlant: plant('Coal Power Plant', 4, 4, 10_000, 250,
    { output: 6_000, lifeYears: 75, air: [200, 16], water: [150, 14] }, [30, 16, 2], { bulldoze: 450, garbage: 25, flammability: 80, waterUse: 50 }),
  gasPlant: plant('Natural Gas Power Plant', 4, 4, 9_000, 400,
    { output: 3_000, lifeYears: 75, air: [60, 12], water: [65, 12] }, [28, 15, 5], { bulldoze: 410, garbage: 20, flammability: 76, waterUse: 20 }),
  oilPlant: plant('Oil Power Plant', 4, 4, 17_000, 600,
    { output: 7_000, lifeYears: 75, air: [150, 14], water: [80, 14] }, [28, 15, 5], { bulldoze: 770, garbage: 22, flammability: 78, waterUse: 25 }),
  windPlant: plant('Wind Power Plant', 2, 1, 500, 50,
    { output: 200, lifeYears: 100, air: [0, 0], water: [0, 0] }, [0, 0, 0], { bulldoze: 20, flammability: 30 }),
  solarPlant: plant('Solar Power Plant', 6, 6, 30_000, 1_000,
    { output: 5_000, lifeYears: 100, air: [5, 3], water: [5, 3] }, [10, 12, 10],
    { bulldoze: 1350, garbage: 11, flammability: 58, waterUse: 5, unlock: { description: 'R$$$ 인구 3,000 · 시장 평점 60', typePopulation: { 'R$$$': 3_000 }, mayorRating: 60 } }),
  nuclearPlant: plant('Nuclear Power Plant', 4, 4, 40_000, 3_000,
    { output: 16_000, lifeYears: 60, air: [10, 4], water: [45, 5] }, [20, 20, 8],
    { bulldoze: 1800, garbage: 15, flammability: 72, waterUse: 900, unlock: { description: '총인구 85,000 · 전력 수요 25,000', population: 85_000, powerDemand: 25_000 } }),
  hydrogenPlant: plant('Hydrogen Power Plant', 5, 5, 100_000, 10_000,
    { output: 50_000, lifeYears: 50, air: [10, 3], water: [8, 4] }, [10, 23, 15],
    { bulldoze: 4500, garbage: 11, flammability: 70, waterUse: 1300, unlock: { description: 'IHT 일자리 4,000 · 전력 수요 30,000', typePopulation: { IHT: 4_000 }, powerDemand: 30_000 } }),

  // ---- Water. Pumps and towers draw from underground aquifers,
  // so they can go anywhere; they need power.
  waterPump: def('Water Pump', 'water', 1, 1, 1_400, 350, {
    bulldoze: 100, pollution: [1, 1, 0, 0], pump: { output: 20_000, lifeYears: 75 }, powerUse: 3,
  }),
  waterTower: def('Water Tower', 'water', 1, 1, 150, 50, {
    bulldoze: 10, pump: { output: 2_400, lifeYears: 100 }, powerUse: 1,
  }),
  largeWaterPump: def('Large Water Pump', 'water', 1, 2, 15_400, 3_150, {
    flammability: 40, maxFire: 3, pollution: [12, 2, 0, 0], pump: { output: 200_000, lifeYears: 75 }, powerUse: 33,
    unlock: { description: '총인구 10,000 또는 물 사용량 월 40,000m³', population: 10_000, orElse: { waterDemand: 40_000 } },
  }),
  waterTreatmentPlant: def('Water Treatment Plant', 'water', 7, 6, 15_000, 350, {
    bulldoze: 1_350, treatment: { center: 300, edge: 250, radius: 48, lifeYears: 75 }, pollution: [1, 3, 0, 0], jobs: [2, 10, 4], powerUse: 50, garbage: 12, waterUse: 100,
  }),

  // ---- Garbage. Landfills are a zone; these are the plants.
  wasteToEnergyPlant: def('Waste to Energy Plant', 'garbage', 4, 4, 25_000, 1_000, {
    bulldoze: 2_250, incinerator: { capacity: 500, powerPerTon: 10, lifeYears: 80, air: [250, 20], water: [200, 19] },
    jobs: [28, 15, 5], waterUse: 1_000, flammability: 74,
  }),
  recyclingCenter: def('Recycling Center', 'garbage', 3, 2, 5_000, 350, {
    bulldoze: 450, pollution: [4, 3, 5, 4], recycling: { residents: 25_000, reduction: 0.2, lifeYears: 75 },
    jobs: [18, 0, 0], powerUse: 9, waterUse: 150, flammability: 66,
  }),

  // ---- Police. Kiosk and Deluxe station are Rush Hour.
  policeKiosk: def('Police Kiosk', 'safety', 1, 1, 80, 40, {
    pollution: [1, 2, 1, 3], police: { radius: 12, center: 100, cells: 0 }, jobs: [3, 2, 0], powerUse: 1, garbage: 2, waterUse: 1,
  }),
  smallPoliceStation: def('Small Police Station', 'safety', 3, 2, 250, 125, {
    bulldoze: 20, pollution: [1, 2, 1, 3], police: { radius: 24, center: 200, cells: 25, units: 2 }, jobs: [10, 12, 0], powerUse: 2, garbage: 5, waterUse: 2,
  }),
  largePoliceStation: def('Large Police Station', 'safety', 3, 3, 800, 250, {
    bulldoze: 50, pollution: [1, 2, 1, 3], police: { radius: 36.5, center: 300, cells: 50, units: 4 }, jobs: [80, 10, 0], powerUse: 3, garbage: 10, waterUse: 5,
  }),
  deluxePoliceStation: def('Deluxe Police Station', 'safety', 3, 3, 1_200, 300, {
    flammability: 40, pollution: [1, 2, 1, 3], police: { radius: 43, center: 350, cells: 75, units: 6, air: 1 }, jobs: [80, 10, 0], powerUse: 5, garbage: 14, waterUse: 7,
    unlock: { description: '총인구 41,000', population: 41_000 },
  }),
  cityJail: def('City Jail', 'safety', 3, 3, 2_500, 450, {
    bulldoze: 230, pollution: [7, 2, 5, 3], police: { radius: 0, center: 0, cells: 1_000 }, jobs: [40, 15, 0], powerUse: 75, garbage: 25, waterUse: 100,
  }),

  // ---- Fire. The Landing Strip (Rush Hour) needs no road.
  smallFireStation: def('Small Fire Station', 'safety', 1, 2, 250, 125, {
    bulldoze: 20, pollution: [1, 2, 1, 3], fire: { radius: 24, center: 200, edge: 50, needsRoad: true, units: 1 }, jobs: [7, 0, 0], powerUse: 2, garbage: 3, waterUse: 5,
  }),
  largeFireStation: def('Large Fire Station', 'safety', 3, 2, 800, 250, {
    bulldoze: 50, pollution: [1, 2, 1, 3], fire: { radius: 37, center: 200, edge: 50, needsRoad: true, units: 2 }, jobs: [20, 8, 0], powerUse: 3, garbage: 6, waterUse: 10,
    flammability: 30,
  }),
  fireLandingStrip: def('Fire Department Landing Strip', 'safety', 15, 4, 1_200, 800, {
    maxFire: 2, pollution: [1, 2, 1, 3], fire: { radius: 37, center: 200, edge: 50, needsRoad: false, units: 2, air: 1 }, jobs: [20, 8, 0], powerUse: 3, garbage: 6, waterUse: 25,
    flammability: 32, unlock: { description: '총인구 31,000', population: 31_000 },
  }),

  // ---- Health. Rush Hour: clinics and medical centers count as
  // the same kind of coverage.
  medicalClinic: def('Medical Clinic', 'health', 1, 2, 400, 400, {
    bulldoze: 40, pollution: [1, 2, 1, 3], health: { radius: 24, capacity: 500, boost: 11.52, vehicles: 50 },
    jobs: [1, 6, 1], powerUse: 4, garbage: 9, waterUse: 10, relief: [20, 20, 20],
  }),
  largeMedicalCenter: def('Large Medical Center', 'health', 3, 4, 1_100, 1_200, {
    bulldoze: 100, pollution: [2, 3, 2, 4], health: { radius: 37, capacity: 3_000, boost: 11.52, vehicles: 150 },
    jobs: [35, 53, 11], powerUse: 63, garbage: 21, waterUse: 175, relief: [20, 20, 20],
  }),
  diseaseResearchLab: def('Disease Research Lab', 'health', 5, 6, 26_000, 180, {
    pollution: [3, 3, 2, 4], health: { radius: 363, capacity: 6_000, boost: 8 },
    jobs: [0, 80, 32], powerUse: 55, garbage: 10, waterUse: 110, relief: [0, 10_000, 10_000], com: [40, 20],
    mayor: [2, 440], bulldoze: 3_000, limit: 1,
    unlock: { description: '총인구 56,000 · 병원 3곳 · 시장 평점 45', population: 56_000, healthBuildings: 3, mayorRating: 45 },
  }),

  // ---- Education. The High School's capacity is our estimate: 1/6 of the
  // Rush Hour Large High School's. Radius 363 = citywide.
  elementarySchool: def('Elementary School', 'education', 2, 2, 300, 400, {
    bulldoze: 30, pollution: [1, 2, 1, 3], school: { radius: 24, capacity: 500, boost: 5, curve: 'elementary', vehicles: 50 },
    jobs: [12, 4, 0], powerUse: 2, garbage: 6, waterUse: 5,
  }),
  highSchool: def('High School', 'education', 4, 4, 1_050, 750, {
    bulldoze: 90, pollution: [1, 2, 1, 3], school: { radius: 32, capacity: 750, boost: 5, curve: 'highSchool', vehicles: 100 },
    jobs: [90, 10, 0], powerUse: 5, garbage: 9, waterUse: 15,
  }),
  largeElementarySchool: def('Large Elementary School', 'education', 4, 3, 2_100, 1_500, {
    flammability: 32, maxFire: 3, pollution: [1, 3, 1, 4], school: { radius: 43, capacity: 3_000, boost: 5, curve: 'elementary', vehicles: 500 },
    jobs: [12, 4, 0], powerUse: 14, garbage: 14, waterUse: 35,
    unlock: { description: '주거 인구 4,000', residents: 4_000 },
  }),
  largeHighSchool: def('Large High School', 'education', 4, 6, 7_350, 3_250, {
    flammability: 32, pollution: [1, 3, 1, 4], school: { radius: 51, capacity: 4_500, boost: 5, curve: 'highSchool', vehicles: 400 },
    jobs: [90, 10, 0], powerUse: 35, garbage: 16, waterUse: 105,
    unlock: { description: '주거 인구 6,000', residents: 6_000 },
  }),
  localLibrary: def('Local Branch Library', 'education', 2, 2, 1_000, 250, {
    bulldoze: 90, pollution: [1, 2, 1, 3], school: { radius: 32, capacity: 30_000, boost: 30, curve: 'library' },
    jobs: [3, 7, 0], powerUse: 1, garbage: 2, waterUse: 2,
  }),
  cityMuseum: def('City Museum', 'education', 2, 3, 1_500, 450, {
    bulldoze: 140, pollution: [2, 3, 1, 4], school: { radius: 363, capacity: 900, boost: 3, curve: 'museum' },
    jobs: [3, 15, 7], powerUse: 23, garbage: 19, waterUse: 35,
  }),
  cityCollege: def('City College', 'education', 4, 3, 3_000, 1_000, {
    bulldoze: 270, pollution: [2, 2, 1, 3], school: { radius: 363, capacity: 7_000, boost: 5, curve: 'college' },
    jobs: [80, 120, 20], powerUse: 48, garbage: 20, waterUse: 90,
  }),
  university: def('University', 'education', 12, 10, 12_000, 1_500, {
    pollution: [2, 2, 1, 3], school: { radius: 363, capacity: 10_000, boost: 5, curve: 'university' },
    jobs: [76, 116, 19], powerUse: 150, garbage: 15, waterUse: 200, relief: [0, 15_000, 15_000], com: [50, 22], res: [50, 22],
    officeRelief: [15_000, 0], industryRelief: { IHT: 100_000 }, bulldoze: 3_080, limit: 1,
    unlock: { description: '주거 인구 15,000 · 시장 평점 42 · 도시 학교 등급 95', residents: 15_000, mayorRating: 42, schoolGrade: { min: 95 } },
  }),

  // ---- Transportation. Stations sit beside a street or road;
  // rail stations also touch rail track, subway stations subway track.
  busStop: def('Bus Stop', 'transport', 1, 1, 150, 5, {
    bulldoze: 10, pollution: [1, 1, 1, 1], station: { mode: 'bus', capacity: 1_000, switchCost: 20 }, jobs: [2, 0, 0], powerUse: 1, garbage: 1,
  }),
  subwayStation: def('Subway Station', 'transport', 1, 1, 500, 20, {
    bulldoze: 50, pollution: [1, 1, 1, 1], station: { mode: 'subway', capacity: 2_000, switchCost: 5 }, jobs: [2, 0, 0], powerUse: 3, garbage: 2, waterUse: 5,
  }),
  trainStation: def('Passenger Train Station', 'transport', 3, 3, 100, 10, {
    bulldoze: 10, pollution: [1, 1, 1, 2], station: { mode: 'rail', capacity: 2_000, switchCost: 5 }, jobs: [4, 0, 0], powerUse: 5, garbage: 6, waterUse: 5,
  }),
  freightStation: def('Freight Train Station', 'transport', 3, 3, 100, 10, {
    bulldoze: 10, pollution: [1, 1, 4, 2], station: { mode: 'freight', capacity: 2_000, switchCost: 0 }, jobs: [4, 0, 0], powerUse: 3, garbage: 4, waterUse: 5,
  }),
  // Rush Hour. Elevated rail stations board the subway network's trains.
  elRailStation: def('Elevated Rail Station', 'transport', 1, 2, 500, 20, {
    pollution: [1, 1, 1, 1], station: { mode: 'subway', capacity: 2_000, switchCost: 5 }, jobs: [2, 0, 0], garbage: 2,
  }),
  monorailStation: def('Monorail Station', 'transport', 2, 2, 500, 20, {
    pollution: [1, 1, 1, 1], station: { mode: 'monorail', capacity: 2_000, switchCost: 5 }, jobs: [2, 0, 0], garbage: 2,
  }),
  // Ferry terminals sit part on land, part on water (Rush Hour).
  passengerFerry: def('Passenger Ferry Terminal', 'transport', 2, 3, 150, 10, {
    pollution: [1, 1, 1, 1], station: { mode: 'ferry', capacity: 1_000, switchCost: 5 }, onWater: true, limit: 16, garbage: 1,
  }),
  carFerry: def('Car and Passenger Ferry Terminal', 'transport', 3, 4, 300, 20, {
    pollution: [1, 1, 1, 1], station: { mode: 'carFerry', capacity: 1_000, switchCost: 5 }, onWater: true, limit: 16, garbage: 1,
  }),
  parkingGarage: def('Public Parking Garage', 'transport', 3, 3, 150, 5, {
    pollution: [1, 1, 1, 1], parking: { capacity: 1_000, switchCost: 20 }, garbage: 1,
  }),

  // Airports and seaports. Medium and large costs are upgrade prices, added
  // here to the small one's; footprints are tuning values.
  // Capacities are Rush Hour's (ten times the base game's).
  smallLandingStrip: airport('Small Landing Strip', 4, 10, 20_000, 700, 102_000, [50, 35, 15], [14, 12, 2, 2], 2),
  mediumLandingStrip: airport('Medium Landing Strip', 4, 14, 25_700, 900, 131_000, [65, 45, 20], [16, 14, 3, 2], 3),
  largeLandingStrip: airport('Large Landing Strip', 5, 18, 31_400, 1_100, 160_000, [80, 55, 25], [18, 13, 4, 3], 4),
  smallMunicipalAirport: airport('Small Municipal Airport', 8, 12, 35_000, 1_225, 288_000, [90, 60, 25], [32, 18, 6, 3], 8),
  mediumMunicipalAirport: airport('Medium Municipal Airport', 10, 14, 41_400, 1_450, 341_000, [105, 70, 30], [35, 19, 8, 4], 10),
  largeMunicipalAirport: airport('Large Municipal Airport', 12, 16, 48_600, 1_700, 400_000, [125, 80, 35], [38, 20, 10, 5], 12),
  smallInternationalAirport: airport('Small International Airport', 12, 16, 50_000, 1_225, 700_000, [130, 85, 35], [50, 20, 12, 5], 16),
  mediumInternationalAirport: airport('Medium International Airport', 14, 18, 56_400, 1_450, 800_000, [150, 95, 40], [54, 21, 15, 6], 18),
  largeInternationalAirport: airport('Large International Airport', 16, 20, 63_600, 1_700, 900_000, [170, 105, 45], [58, 23, 18, 6], 20),
  internationalPort: def('International Port', 'transport', 6, 6, 10_000, 500, {
    seaport: { relief: 650, perTrip: 20 }, onWater: true, bulldoze: 1_500, jobs: [95, 5, 0],
    pollution: [14, 6, 25, 7], garbage: 13, powerUse: 13, waterUse: 50, flammability: 62, // (ranked just above Solar)
  }),

  ...REWARDS,
  ...DEALS,
  ...LANDMARKS,
} as const satisfies Record<string, StructureDef>;

export type StructureKind = keyof typeof STRUCTURES;
