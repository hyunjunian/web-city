// Plain-data city state. Everything here is serialisable and engine-agnostic.

import type { LiveDisaster } from './disasters';
import type { Density, DevType, PerType, ZoneClass } from '../types';
import type { Difficulty } from '../data/difficulty';
import type { StructureKind } from '../data/structures';
import type { OrdinanceId } from '../data/ordinances';
import type { NeighbourKind } from '../data/region';

export type DealResource = 'power' | 'water' | 'garbage';

/** A neighbouring city beyond one map edge (W, E, N, S). */
export interface Neighbour {
  edge: 0 | 1 | 2 | 3;
  name: string;
  kind: NeighbourKind;
  /** Residents and jobs per type (developed neighbours). */
  population: PerType;
  /** Utility capacity and use per month (power MWh, water m³, garbage tons). */
  capacity: Record<DealResource, number>;
  usage: Record<DealResource, number>;
  /**
   * A played neighbour across a border several cities share (a big city beside small ones): a deal
   * couldn't be kept on both sides, so none is offered.
   */
  dealsBlocked?: boolean;
  /** A played neighbour: what its own Neighbor Deals (with other cities) buy and sell a month. */
  committed?: Record<DealResource, { bought: number; sold: number }>;
  funds: number;
  /** Growth it still pushes into the region (10% of its population, drained monthly). */
  growth: PerType;
  /** A played neighbour: whether it reaches the shared border per resource (unknown if absent). */
  connected?: Record<DealResource, boolean>;
  /**
   * A played neighbour: the stretches of this city's edge [from, to) (its own
   * tiles) that played cities border, with whether the city across each one
   * reaches it per resource (unknown if absent). A connection joins only
   * where both sides reach the same stretch.
   */
  shared?: [number, number, Partial<Record<DealResource, boolean>>?][];
  /** A played neighbour: its demand left unmet when last played, pooled with this city's. */
  demand?: PerType;
  /**
   * This city's unmet demand the neighbour has taken up while inactive (in
   * its zones' spare room, up to 10% of its population): growth that only
   * exists in extrapolation until that city is played.
   */
  absorbed?: PerType;
  /** A played neighbour: its residents' average commute (centi-hours), remembered for trips into it. */
  commute?: number;
}

/** A rioting mob at a hotspot of low Mayor Rating. */
/** An arsonist about to strike (the mayor is warned ahead of the fire). */
export interface Arsonist {
  /** Building they mean to set alight, and where it stands. */
  target: number;
  x: number;
  y: number;
  /** Days until they do it, unless police on the scene lock them up first. */
  days: number;
}

export interface Riot {
  id: number;
  x: number;
  y: number;
  stage: number;
  energy: number;
  days: number;
  /** Has already split off a second mob (each mob spawns one; the chain goes on through them). */
  split?: boolean;
}

/** A fire truck, fire plane, police car or police helicopter sent out from its station. */
export interface DispatchUnit {
  id: number;
  kind: 'fire' | 'police';
  air: boolean;
  station: number;
  x: number;
  y: number;
  /** Days until it arrives; then days left on site. */
  travel: number;
  onSite: number;
  /** Effectiveness 0–1 from funding and strikes (air units always 1). */
  competence: number;
  /** The way there (tiles: along the roads for ground units, straight for aircraft) and the days it takes. */
  path?: number[];
  days?: number;
}

/** A Neighbor Deal: buying or selling a fixed amount a month for a year at a time. */
/** A My Sim: one resident you follow, in a home you chose, optionally with a job you chose. */
export interface MySim {
  id: number;
  name: string;
  /** Wealth ($, $$, $$$), fixed when the Sim moves in. */
  wealth: 0 | 1 | 2;
  /** Building id of the home, and a tile of its lot (to follow a redeveloped home). */
  home: number;
  homeTile: number;
  /** Workplace: building id (> 0), structure id (< 0), or 0 for none chosen. */
  job: number;
  /** Day the Sim moved into the city. */
  since: number;
  /** Day since which the Sim has had no job (none of their wealth in town): two months and they move out. */
  joblessSince?: number;
  /** Day since which their home has been gone with none of their wealth to move to: two months and they leave. */
  homelessSince?: number;
  /** Day since which they have had no route to work: two months and they lose the job. */
  noRouteSince?: number;
  /** Generation of the family (heirs take over the house at old age). */
  generation?: number;
}

export interface NeighbourDeal {
  id: number;
  edge: 0 | 1 | 2 | 3;
  resource: DealResource;
  direction: 'buy' | 'sell';
  amount: number;
  price: number;
  startDay: number;
  status: 'active' | 'grace' | 'probation';
  /** Months left of grace or probation. */
  monthsLeft: number;
}

export const Terrain = { Land: 0, Water: 1 } as const;
/** Network per tile. A rail crossing is a road tile that trains also use. */
export const Net = { None: 0, Street: 1, Road: 2, Avenue: 3, Highway: 4, Onramp: 5, Rail: 6, RailCrossing: 7, OneWay: 8 } as const;
export type NetworkKind = 'street' | 'road' | 'avenue' | 'highway' | 'onramp' | 'rail' | 'oneway';
/** Network kind whose speeds and costs a tile code uses (crossings: the road's). */
export const NETWORK_KINDS = [null, 'street', 'road', 'avenue', 'highway', 'onramp', 'rail', 'road', 'oneway'] as const;

/**
 * The network kind a tile's traffic runs at: its own, and at a level crossing the road's that crosses
 * the rail (a street, an avenue: all crossings ran as a Road, an avenue's a bottleneck, a street's a
 * shortcut). Read from the road on either side of the crossing (one side, or a Road, failing that).
 */
export function trafficKind(s: { net: Uint8Array; size: number }, i: number): NetworkKind | null {
  const code = s.net[i]!;
  if (code !== Net.RailCrossing) return NETWORK_KINDS[code] ?? null;
  const n = s.size;
  const x = i % n;
  const at = (dx: number, dy: number) => {
    const xx = x + dx;
    const yy = (i - x) / n + dy;
    if (xx < 0 || yy < 0 || xx >= n || yy >= n) return 0;
    const c = s.net[yy * n + xx]!;
    return c === Net.Street || c === Net.Road || c === Net.Avenue || c === Net.OneWay ? c : 0;
  };
  const w = at(-1, 0), e = at(1, 0), nn = at(0, -1), so = at(0, 1);
  const pick = w && w === e ? w : nn && nn === so ? nn : w || e || nn || so;
  return pick ? NETWORK_KINDS[pick]! : 'road';
}

/** One-way directions (E, S, W, N), stored per tile as index + 1. */
export const ONEWAY_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

/** Streets, roads and avenues: lots front them and Sims walk along them. */
export function isLocalNet(code: number): boolean {
  return code === Net.Street || code === Net.Road || code === Net.Avenue || code === Net.RailCrossing || code === Net.OneWay;
}

/** Anything cars and trucks drive on. */
export function isAsphalt(code: number): boolean {
  return isLocalNet(code) || code === Net.Highway || code === Net.Onramp;
}

/** Days in a game month. */
export const DAYS_PER_MONTH = 30;

export const ELEVATED = { none: 0, rail: 1, monorail: 2, highway: 3 } as const;
/** Network cost entry for each elevated kind. */
export const ELEVATED_KINDS = [null, 'elrail', 'monorail', 'highway'] as const;

/**
 * Can a car drive from tile `from` to the adjacent tile `to`? Never against a
 * one-way road (entering or leaving it backwards); turning on or off is fine.
 */
export function carMove(s: { net: Uint8Array; oneway: Uint8Array; interchange: Uint8Array; links: Uint8Array; size: number }, from: number, to: number): boolean {
  if (!tilesLinked(s, from, to)) return false;
  // At an overpass the ground carries east–west traffic; north–south rides over it.
  if ((s.interchange[from] === INTERCHANGE.overpass || s.interchange[to] === INTERCHANGE.overpass) && from % s.size === to % s.size) return false;
  // (On a Ground Highway tile the direction is the one-way road's on the deck above, not the highway's.)
  const df = overNet(s, from) ? 0 : s.oneway[from]!;
  const dt = overNet(s, to) ? 0 : s.oneway[to]!;
  if (!df && !dt) return true;
  const dx = (to % s.size) - (from % s.size);
  const dy = Math.floor(to / s.size) - Math.floor(from / s.size);
  const back = (d: number) => ONEWAY_DIRS[d - 1]![0] === -dx && ONEWAY_DIRS[d - 1]![1] === -dy;
  return !(df && back(df)) && !(dt && back(dt));
}

/** Network tiles that leave the ground: through a hill, across a gorge, or low over water (no ferries under it). */
export const SPAN = { none: 0, tunnel: 1, bridge: 2, lowBridge: 3 } as const;

/** Can lots front onto this network tile? Not inside a tunnel or high over a gorge; a low bridge sits at grade. */
export function atGrade(s: CityState, i: number): boolean {
  const t = s.tunnel[i]!;
  return t === SPAN.none || t === SPAN.lowBridge;
}

/**
 * Highway crossings: an overpass (no turns) until a Cloverleaf joins them
 * (Rush Hour); or a street, road or avenue passing over a Ground Highway
 * (`roadOver` + its index in OVER_NETS), joined to it only by onramps.
 */
export const INTERCHANGE = { none: 0, overpass: 1, cloverleaf: 2, roadOver: 3 } as const;
export const OVER_NETS = [Net.Street, Net.Road, Net.Avenue, Net.OneWay] as const;

/** The local network riding over this ground highway tile, or 0. */
export function overNet(s: { interchange: Uint8Array }, i: number): number {
  const v = s.interchange[i]!;
  return v >= INTERCHANGE.roadOver ? OVER_NETS[v - INTERCHANGE.roadOver] ?? 0 : 0;
}

/** Does the road over highway tile `i` run north–south (the highway east–west)? */
export function overNetVertical(s: { net: Uint8Array; size: number }, i: number): boolean {
  const x = i % s.size;
  return (x > 0 && s.net[i - 1] === Net.Highway) || (x + 1 < s.size && s.net[i + 1] === Net.Highway);
}

/** Trains run on rail and level crossings. */
export function isRail(code: number): boolean {
  return code === Net.Rail || code === Net.RailCrossing;
}

/** Can cars cross from tile code `a` to an adjacent tile code `b`? Highways only meet highways and onramps. */
/**
 * Roads, avenues and one-way roads (and their rail crossings) join a
 * neighbour of the kind only where drawn into it (lying side by side isn't
 * enough: the player links them by hand); streets join anything beside them.
 */
export function manualNet(code: number): boolean {
  return code === Net.Road || code === Net.Avenue || code === Net.OneWay || code === Net.RailCrossing;
}

/** The link bit for the step from tile `from` to its neighbour `to` (E 1, S 2, W 4, N 8). */
export function linkBit(from: number, to: number, n: number): number {
  const d = to - from;
  return d === 1 ? 1 : d === n ? 2 : d === -1 ? 4 : 8;
}

/** Can cars cross between adjacent tiles `i` and `j` (networks that join, drawn to join)? */
export function tilesLinked(s: { net: Uint8Array; links: Uint8Array; size: number }, i: number, j: number): boolean {
  const a = s.net[i]!;
  const b = s.net[j]!;
  if (!carLinked(a, b)) return false;
  if (!manualNet(a) || !manualNet(b)) return true;
  return (s.links[i]! & linkBit(i, j, s.size)) !== 0 && (s.links[j]! & linkBit(j, i, s.size)) !== 0;
}

/** Links every road tile to every adjacent asphalt (saves from before links were kept). */
export function linkAll(s: { net: Uint8Array; links: Uint8Array; size: number }): void {
  const n = s.size;
  for (let i = 0; i < n * n; i++) {
    if (!manualNet(s.net[i]!)) continue;
    const x = i % n;
    let m = 0;
    if (x + 1 < n && isAsphalt(s.net[i + 1]!)) m |= 1;
    if (i + n < n * n && isAsphalt(s.net[i + n]!)) m |= 2;
    if (x > 0 && isAsphalt(s.net[i - 1]!)) m |= 4;
    if (i - n >= 0 && isAsphalt(s.net[i - n]!)) m |= 8;
    s.links[i] = m;
  }
}

export function carLinked(a: number, b: number): boolean {
  if (!isAsphalt(a) || !isAsphalt(b)) return false;
  if (a === Net.Highway) return b === Net.Highway || b === Net.Onramp;
  if (b === Net.Highway) return a === Net.Onramp;
  return true;
}

/** Do buildings need power to grow and stay (unless the "fightthepower" cheat lifted it)? */
export function needsPower(s: { cheats: CityState['cheats'] }, cfg: { development: { requirePower: boolean } }): boolean {
  return cfg.development.requirePower && !s.cheats.power;
}

/** Do buildings need water above the well-water caps (unless the "howdryiam" cheat lifted it)? */
export function needsWater(s: { cheats: CityState['cheats'] }, cfg: { development: { requireWater: boolean } }): boolean {
  return cfg.development.requireWater && !s.cheats.water;
}

/** Zone codes stored per tile. */
export const ZONES = [
  'none', 'R-low', 'R-medium', 'R-high', 'C-low', 'C-medium', 'C-high', 'I-medium', 'I-high', 'A', 'landfill',
] as const;
export type ZoneKind = (typeof ZONES)[number];

export function zoneCode(z: ZoneKind): number {
  return ZONES.indexOf(z);
}

type ZoneInfo = Readonly<{ cls: ZoneClass | 'A' | null; density: Density }>;

/** Zone class and density by zone code (shared, read-only: this runs in per-tile loops). */
const ZONE_INFO: readonly ZoneInfo[] = [
  { cls: null, density: 'low' },
  { cls: 'R', density: 'low' }, { cls: 'R', density: 'medium' }, { cls: 'R', density: 'high' },
  { cls: 'C', density: 'low' }, { cls: 'C', density: 'medium' }, { cls: 'C', density: 'high' },
  { cls: 'I', density: 'medium' }, { cls: 'I', density: 'high' },
  { cls: 'A', density: 'low' },
];
const NO_ZONE = ZONE_INFO[0]!;

/** Zone class and density of a zone code; agriculture reports class 'A'. */
export function zoneInfo(code: number): ZoneInfo {
  return ZONE_INFO[code] ?? NO_ZONE;
}

/** The zone class a developer type grows in ('A' for agriculture). */
export function zoneClassFor(t: DevType): ZoneClass | 'A' {
  if (t === 'IA') return 'A';
  return t[0] === 'R' ? 'R' : t[0] === 'C' ? 'C' : 'I';
}

export type AbandonReason = 'desirability' | 'no-road' | 'demand' | 'no-power' | 'no-water' | 'explosion' | 'fire' | 'commute' | 'workforce';

/** A rectangle of tiles. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Building extends Rect {
  id: number;
  stage: number;
  /** Developer type that built it; it can only be occupied by this or lower. */
  origType: DevType;
  /** Current occupant type (null when abandoned). */
  type: DevType | null;
  /** Residents or jobs at full occupancy for the current occupant type. */
  capacity: number;
  /** Fraction of capacity occupied (0–1), driven by desirability. */
  occupancy: number;
  /** Jobs actually filled after matching workers by wealth (C/I only). */
  filled: number;
  distressMonths: number;
  noRoadMonths: number;
  noPowerMonths: number;
  /** Has power this month (false during a blackout or off-grid). */
  powered: boolean;
  noWaterMonths: number;
  /** Has city water this month (false outside pipe coverage or in a shortage). */
  watered: boolean;
  /** Residential only: average household age, EQ and HQ (0–200). */
  age: number;
  eq: number;
  hq: number;
  abandonReason: AbandonReason | null;
  builtDay: number;
  /** Fastest trip to work (residential) or to a connection (industrial), centi-hours; -1 none. */
  commute: number;
  /** Months in a row without a job reachable within the trip limit (residential). */
  noJobMonths: number;
  /** Marked Historical (Rush Hour): never redeveloped or reoccupied by another type, though it can still be abandoned or destroyed. */
  historical: boolean;
  /**
   * A home's workers' jobs, kept month to month (Rush Hour: Sims stay in a
   * job until something makes them leave it): workplace key
   * (a building's id, a structure's id negated, or JOB_EDGE + edge for a
   * neighbour) and Sims, flattened.
   */
  jobs?: number[];
}

export interface Structure extends Rect {
  id: number;
  kind: StructureKind;
  /** Funding level in percent (0–120 for plants, 0–150 for services). */
  funding: number;
  /** Power plants: share of life used, 0–100. */
  life: number;
  /** Plants/pumps: MWh or m³ supplied last update. Services: patients or students. */
  load: number;
  /** Plants/pumps: available output. Services: capacity at current funding. */
  capacity: number;
  /** Services: 0–1 after grade and strikes. Plants: share of capacity used. */
  effectiveness: number;
  /** Months on strike (0 = working normally). */
  strike: number;
  /** Schools and hospitals: local bus/ambulance funding in percent (absent = 100). */
  vehicleFunding?: number;
  powered: boolean;
}

export interface BudgetReport {
  month: number;
  income: number;
  taxByType: PerType;
  expenses: number;
  roadUpkeep: number;
  parkUpkeep: number;
  powerUpkeep: number;
  waterUpkeep: number;
  safetyUpkeep: number;
  garbageUpkeep: number;
  ordinanceCost: number;
  ordinanceIncome: number;
  loanPayments: number;
  healthUpkeep: number;
  educationUpkeep: number;
  transitUpkeep: number;
  fares: number;
  rewardUpkeep: number;
  landmarkUpkeep: number;
  dealIncome: number;
  /** Neighbor Deals: income from selling, cost of buying. */
  neighbourIncome: number;
  neighbourExpense: number;
}

export interface CityState {
  version: 1;
  name: string;
  size: number;
  seed: number;
  rngState: number;
  difficulty: Difficulty;
  day: number;
  funds: number;
  terrain: Uint8Array;
  net: Uint8Array;
  /** 1 where a power line runs. */
  power: Uint8Array;
  /** 1 where an (underground) water pipe runs. */
  pipe: Uint8Array;
  /** One-way roads: direction + 1 (see ONEWAY_DIRS), 0 elsewhere. */
  oneway: Uint8Array;
  /** Ground highway crossings (see INTERCHANGE). */
  interchange: Uint8Array;
  /** Where a network runs through a hill or over a gorge (see SPAN): no frontage; no walkers in tunnels. */
  tunnel: Uint8Array;
  /** Subway track (underground, like pipes). */
  subway: Uint8Array;
  /** Height above the water in metres (water tiles 0). */
  height: Uint8Array;
  /** Trees: 0 none, else age in months + 1 (capped at 255). */
  trees: Uint8Array;
  /** Months of radiation left per tile (Toxic Waste Dump, Area 5.1). */
  radiation: Uint8Array;
  /** Elevated track above the ground: 1 elevated rail, 2 monorail, 3 elevated highway. */
  elevated: Uint8Array;
  /** Toll booths: 1 on the ground road, avenue or highway, 2 on the elevated highway above (Rush Hour). */
  tolls: Uint8Array;
  /** Which neighbours (bits E, S, W, N) a road, avenue or one-way tile was drawn to join (see tilesLinked). */
  links: Uint8Array;
  /** Damaged asphalt tiles (underfunded road maintenance). */
  potholes: Uint8Array;
  /** Department funding in percent: road maintenance, mass transit, power lines, water pipes, city beautification (parks). */
  /** landmarks: all Landmarks together (none funded on its own); corrections: all jails (likewise). */
  departments: { roads: number; transit: number; power: number; water: number; parks: number; sanitation: number; landmarks: number; corrections: number };
  /** Scars left by disasters: 1 crater, 2 volcano cone (unbuildable), 3 volcano slope, 4 fault line. */
  landform: Uint8Array;
  /** Wear of power lines and water pipes (0–255; distressed from 50). */
  lineWear: Uint8Array;
  pipeWear: Uint8Array;
  /** Damaged rail tiles (trains derail on them). */
  railDamage: Uint8Array;
  /** Unneutralised toxic spills. */
  spills: { i: number; months: number }[];
  /** Fault line direction once the first earthquake has struck (later ones follow it). */
  faultAngle: number | null;
  /** Fire and police units out on call. */
  units: DispatchUnit[];
  /** Riots under way. */
  mobs: Riot[];
  /** Arsonists at large: set a fire when their time runs out. */
  arsonists: Arsonist[];
  /** Wind that drives fire spread: direction index (E, SE, S, …) and strength 0–1. */
  wind: { dir: number; strength: number };
  neighbours: Neighbour[];
  /** Set when the city is part of a Region: the other cities' totals at their last save. */
  /** Regional play: the other cities' totals (population by developer type counts toward stage limits). */
  /** The other cities of the region: their count, people, and how many are joined to another city (Tourist Trap). */
  region?: { cities: number; population: number; highWealth: number; byType?: Partial<Record<DevType, number>>; linkedCities?: number };
  neighbourDeals: NeighbourDeal[];
  /** My Sims living in the city. */
  mySims: MySim[];
  /** Tornadoes and robots on the move (see sim/disasters.ts LiveDisaster). */
  liveDisasters: LiveDisaster[];
  /** Subway-to-Elevated Transitions (Rush Hour): subway tiles where trains rise onto elevated rail. */
  transitions: number[];
  /** Names the mayor gave buildings (Query box), by occupant id: building id, or −structure id. */
  names: Record<string, string>;
  /**
   * U-Drive-It: missions completed, partial unlock progress, and the
   * mission under way (only it can be finished), with its vehicle and, for Fire!
   * missions, the fire to put out.
   */
  udi: { done: Partial<Record<string, number>>; partial: Partial<Record<string, number>>; active?: string; vehicle?: string; fire?: number };
  /** The player's record kept by the interface (news, actions and their results): saved and restored as it is, never read by the simulation. */
  journal?: unknown;
  nextDealId: number;
  /** Recent accidents and derailments, for display: tile and day. */
  incidents: { i: number; day: number; kind: 'pileup' | 'derailment' }[];
  /** 1 where a burned-down building left rubble (blocks development until bulldozed). */
  rubble: Uint8Array;
  /** Monthly history for graphs (latest last). */
  history: HistoryPoint[];
  /** Outstanding loans: monthly payment and payments left. */
  loans: Loan[];
  /** Ordinances in effect. */
  ordinances: OrdinanceId[];
  /** Days each ordinance has been in effect this month (billed by share at month end). */
  ordinanceDays: Partial<Record<OrdinanceId, number>>;
  /** Citywide (resident-weighted) Mayor Rating, last month. */
  mayorRating: number;
  /** Residential tax rates at the start of the month (for the tax-change effect). */
  taxMonthStart: [number, number, number];
  /** Mood from tax changes per residential wealth, fading over a few months. */
  /** Recent residential tax changes: the rate change (delta, points) and its own table effect (amount). */
  taxMood: { wealth: 0 | 1 | 2; amount: number; age: number; delta?: number }[];
  /** Demand smoothed month by month (Sims leave only when it stays low, not on one bad month). */
  demandTrend: Partial<Record<DevType, number>>;
  /**
   * Populations to grow to: growth neighbours exported here while this city
   * was inactive (it grows in once the city is played again),
   * added to demand until built (the region drops it if the city closes first).
   */
  growthTarget: Partial<Record<DevType, number>>;
  /** Each type's population at the last month's end: regional growth is used up by what is built since. */
  lastPopulation?: Partial<Record<DevType, number>>;
  /** Console cheats in force: buildings need no power, no water. */
  cheats: { power?: boolean; water?: boolean };
  riots: number;
  /** The day the first zone was laid (for "zoned two months ago and nothing grew"); absent before. */
  zonedSince?: number;
  /** Tons of uncollected garbage piled on each tile. */
  garbage: Float32Array;
  /** Tons stored in each landfill tile (0–300). */
  landfill: Float32Array;
  /** Last month's garbage numbers. */
  garbageStats: GarbageStats;
  /** Recent crime around each tile (decays monthly). */
  crime: Float32Array;
  /** Buildings (id > 0) and structures (id < 0) on fire. */
  fires: Fire[];
  /** Wooded tiles on fire (fires catch on trees), with days burning. */
  treeFires: { i: number; days: number }[];
  /** Short-term Mayor Rating effects (fires, …) that also move desirability. */
  events: CityEvent[];
  /** Last month's public-safety numbers. */
  safety: SafetyStats;
  /** Fires started / buildings burned so far this month. */
  fireTally: { fires: number; burned: number };
  /** Criminals who got away and strike again next month (in crimes). */
  carryCrimes: number;
  zone: Uint8Array;
  /** >0 building id, <0 structure id, 0 empty. */
  occupant: Int32Array;
  buildings: Map<number, Building>;
  structures: Map<number, Structure>;
  nextId: number;
  taxRates: PerType;
  /** Rate changes within the tax memory window: [day, type, rate]. */
  taxLog: [number, DevType, number][];
  /** Freight trips completed last month (drives industrial cap relief). */
  freightTrips: number;
  /** Rotates which part of an overloaded grid is blacked out each month. */
  blackoutRotation: number;
  /** Reward buildings the city has earned. */
  unlocked: StructureKind[];
  lastBudget: BudgetReport | null;
  impeached: boolean;
}

export interface HistoryPoint {
  month: number;
  population: number;
  jobs: number;
  funds: number;
  mayorRating: number;
  crimes: number;
  /** Traffic Volume Graph: trips that month by kind (absent in older saves). */
  trips?: Partial<Record<string, number>>;
  /** The other graphs (absent in older saves). */
  arrests?: number;
  /** Average residential commute, hours (to the hundredth). */
  commute?: number;
  powerSupply?: number;
  powerDemand?: number;
  waterSupply?: number;
  waterDemand?: number;
  garbageCapacity?: number;
  garbageProduced?: number;
  /** Garbage left lying uncollected that month, tons (absent in older saves). */
  garbageUncollected?: number;
  /** Fires that broke out that month, and buildings they burned down (absent in older saves). */
  fires?: number;
  burned?: number;
  /** Citywide average air and water pollution over land. */
  air?: number;
  waterPollution?: number;
  /** Average land value under the buildings (absent in older saves, and while nothing is built). */
  landValue?: number;
  /** Resident-weighted average EQ, HQ (absent in older saves) and life expectancy (years). */
  eq?: number;
  hq?: number;
  lifeExpectancy?: number;
  income?: number;
  expenses?: number;
  /** Abandoned buildings at month end. */
  abandoned?: number;
}

export interface Loan {
  amount: number;
  payment: number;
  monthsLeft: number;
}

export interface Fire {
  /** Building id (> 0) or −structure id. */
  target: number;
  stage: number;
  days: number;
  daysAtMax: number;
}

export interface CityEvent {
  x: number;
  y: number;
  radius: number;
  /** Mayor Rating effect at full strength; fades linearly over `months`. */
  amount: number;
  months: number;
  age: number;
}

export interface GarbageStats {
  /** The month's garbage before recycling and ordinances cut it. */
  produced: number;
  recycled: number;
  /** What was left to collect after recycling and ordinances (older saves fall back to production minus recycling). */
  kept?: number;
  incinerated: number;
  landfilled: number;
  /** Tons left on the curb this month, and everything still piled up. */
  uncollected: number;
  piled: number;
  /** Disposal room this month (incinerators + landfill space). */
  capacity: number;
  /** Landfill space left that garbage trucks can reach. */
  landfillSpace: number;
  /** Space left in landfills no road joins to the city (being decommissioned, or forgotten). */
  landfillCutOff?: number;
  /** Neighbor Deals: tons sent away, tons taken in, and tons we promised but couldn't take. */
  exported?: number;
  imported?: number;
  importShort?: number;
  /** Of the uncollected tons, those from lots no road reaches (no truck could take them). */
  stranded?: number;
  /** Road-accessible local waste whose collection network reaches no disposal facility or contracted export port. */
  routeCutOff?: number;
  /** Incoming-waste contracts that could not be delivered, including suspended contracts without capacity to resume. */
  failedImports?: number[];
}

export interface SafetyStats {
  crimes: number;
  arrests: number;
  prevented: number;
  paroled: number;
  fires: number;
  burned: number;
  /** Crimes committed last month by kind (the 13 crimes). */
  byType?: Record<string, number>;
  /** Where last month's crimes happened: [tile, kind]. */
  spots?: [number, string][];
}

export function idx(s: { size: number }, x: number, y: number): number {
  return y * s.size + x;
}

export function inBounds(s: { size: number }, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < s.size && y < s.size;
}

/** A city jail (cells, no patrol radius); the Federal Prison is a business deal, not funded. */
export function isJail(def: { category: string; police?: { radius: number } }): boolean {
  return def.category === 'safety' && def.police?.radius === 0;
}

/** The department that funds a civic building together with the rest of its kind, if any. */
export function fundingDepartment(def: { station?: unknown; category: string; police?: { radius: number } }): keyof CityState['departments'] | null {
  return def.station ? 'transit' : def.category === 'park' ? 'parks' : def.category === 'garbage' ? 'sanitation' : def.category === 'water' ? 'water'
    : def.category === 'landmark' ? 'landmarks' : isJail(def) ? 'corrections' : null;
}

/** Funding that applies to a civic building: its own, or the department that funds its kind together. */
export function structureFunding(s: CityState, def: { station?: unknown; category: string; police?: { radius: number } }, st: Structure): number {
  const department = fundingDepartment(def);
  return department === null ? st.funding : s.departments[department];
}

/** Office jobs served by an airport, or freight trips at a port; null for other facilities. */
export function cargoCapacity(def: { airport?: { capacity: number }; seaport?: { relief: number; perTrip: number } }, funding: number): number | null {
  if (!def.airport && !def.seaport) return null;
  const share = Math.max(0, Math.min(1.2, funding / 100));
  if (def.airport) return Math.max(0, def.airport.capacity * share);
  if (def.seaport) return def.seaport.perTrip > 0 ? Math.max(0, def.seaport.relief * share / def.seaport.perTrip) : 0;
  return null;
}
