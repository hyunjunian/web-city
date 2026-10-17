// The public engine API: a single city on a square tile grid running the
// SC4 Rush Hour RCI model. Pure TypeScript with no DOM or Node APIs, so it
// runs unchanged in browsers, Cloudflare Workers and Node.

import { makeConfig, type ConfigOverrides, type SimConfig } from './config';
import type { Difficulty } from './data/difficulty';
import type { StructureDef, StructureKind } from './data/structures';
import { Rng } from './rng';
import { copyData } from './copy';
import {
  allocateJobs, computeDemand, takeCensusSteps, type Census, type DemandReport,
} from './sim/demand';
import {
  computeDesirabilitySteps, computeDesirabilityEverywhere, createDesirability, factorsAt, type DesirabilityMap, type FactorBreakdown,
} from './sim/desirability';
import { developOnce, exodus, GROWTH_CODES, growthBlockers, INFO_ONLY, trackDemand, understaffed, updateBuildingsSteps, warmTractsSteps, type DevContext, type GrowthBlocker } from './sim/development';
import { computeEffectFieldsSteps, computeJobComponentsSteps, computeNetworkFieldsSteps, createFields, footprint, frontage, INF, type Fields } from './sim/fields';
import {
  DAYS_PER_MONTH, ELEVATED, ELEVATED_KINDS, idx, INTERCHANGE, linkBit, manualNet, tilesLinked, OVER_NETS, overNet, SPAN, inBounds, isLocalNet, isRail, Net, NETWORK_KINDS, ONEWAY_DIRS, isJail, Terrain, zoneCode, zoneInfo, ZONES,
  type BudgetReport, type Building, type CityState, type DealResource, type GarbageStats, type HistoryPoint, type Rect, type MySim, type NeighbourDeal, type NetworkKind,
  type Structure, type ZoneKind,
  type Neighbour,
} from './sim/state';
import { interp } from './data/services';
import { airportReach, assignTrafficSteps, computeTravelSteps, type VolumeKind } from './sim/transport';
import { drain } from './sim/steps';
import { checkUnlocks, missileMisfires, unlockChecks, updateRadiation, type UnlockCheck, type UnlockContext } from './sim/rewards';
import { updatePotholes } from './sim/roads';
import { collectBudget, collectBudgetSteps, departmentUpkeep, loanPrincipal, structureUpkeep, type BudgetContext } from './sim/budget';
import { autoDispatchSteps, dispatchUnit, FIT_CREW, freeUnits, neutraliseSpills, stepUnits, type DispatchKind } from './sim/dispatch';
import {
  dealMonthly, dealTotals, defaultNeighbours, drainRegionalGrowth, edgeConnections, evaluateDeal, exportDemand, makeNeighbour, regionalDemand, reliefConnections,
  edgeReach, edgeTile, hasDealConnection, neighbourFromSnapshot, repriceDeals, type CitySnapshot, type DealOffer, type Utility,
} from './sim/region';
import type { NeighbourKind } from './data/region';
import {
  damageRail, derailments, disasterEvent, Landform, LIVE_KINDS, pileups, runDisaster, startLive, stepLive, wearUtilities,
  type DamageReport, type DisasterContext, type DisasterKind, type LiveDisaster, type LiveKind,
} from './sim/disasters';
import type { ConnectionKind } from './data/demand';
import {
  agePlants, computeCoverageSteps, computePowerSteps, computeWaterSteps, healthClassOf, powerUse, updateQuotients, updateStrikes,
  waterUse, type PowerReport, type WaterReport,
} from './sim/services';
import {
  changeWind, computeSafetyFieldsSteps, ignite, igniteTree, monthlyIgnition, runCrimeSteps, stepFires, stepTreeFires, updateSafetyStrikes, type FireContext,
} from './sim/safety';
import { hasOperatingLandfill, hasOperatingLandfillSteps, incineratorPower, LANDFILL_ZONE, runGarbage, runGarbageSteps } from './sim/garbage';
import {
  civicEvent, computeMayor, mayorAt, ordinanceAvailable, ordinanceCost as ordinanceCostOf, ordinanceEffects,
  opinionPolls, riotCheck, stepMobs, taxMoodFor, updateTaxMood, type MayorFactors, type PollTopic,
} from './sim/mayor';
import { ORDINANCES, type OrdinanceId } from './data/ordinances';
import { commute, jobOf, thoughtsAt, thoughtsAtHome, type Thought } from './sim/mysims';
import { alightings, routeQuery, type RouteQuery } from './sim/routes';
import { adviseSteps, type Advice } from './sim/advisors';
import { canDrive, finishMission, missionAvailable, planMission, vehicleAvailable, type ActiveMission } from './sim/udi';
import { MISSIONS, type MissionId } from './data/missions';
import { VEHICLES, type VehicleId } from './data/udi';
import { generateForest, generateHeights, generateTerrain, terrainFromHeightmap, type Heightmap } from './sim/terrain';
import { DEZONING_COST, ZONING_COST_HIGH_COMMERCIAL } from './data/economy';
import { DEV_TYPES, perType, type DevType, type PerType } from './types';
import { assetOutlook, networkRepairCost, REPAIR_DEPARTMENTS, type AssetOutlook, type RepairDepartment, type RepairPreview } from './sim/infrastructure';
import { energyReport, POWER_DISPATCHES, type EnergyReport, type PowerDispatch } from './sim/energy';
import { infrastructureReport, maintenanceImpact, type InfrastructureReport, type MaintenanceImpact } from './sim/resilience';
import { budgetForecast, type BudgetForecast, type BudgetForecastOptions } from './sim/finance';

export interface CityOptions {
  name?: string;
  /** Tiles per side (SC4 city tiles are 64, 128 or 256). */
  size?: number;
  seed?: number;
  difficulty?: Difficulty;
  /** Generate a river and a lake. */
  water?: boolean;
  /** Land from a grayscale topographical map instead; `crop` is the part this city covers. */
  heightmap?: Heightmap & { crop?: { x: number; y: number; w: number; h: number } };
  config?: ConfigOverrides;
}

/** A My Sim's news: moved house or out of town, lost or found a job. */
export interface MySimNews {
  sim: MySim;
  /** homeGone / abandoned / outclassed (home no longer of their wealth) / noJob: moved out; searching: home gone, looking; moved: to another home of their wealth; jobGone: looking for work; newJob: found it. */
  kind: 'homeGone' | 'abandoned' | 'outclassed' | 'searching' | 'died' | 'heir' | 'promoted' | 'jobGone' | 'moved' | 'noJob' | 'newJob';
}

export interface ToolResult {
  ok: boolean;
  cost: number;
  message?: string;
}

export type { NetworkKind };

const NET_CODE: Record<NetworkKind, number> = {
  street: Net.Street, road: Net.Road, avenue: Net.Avenue, highway: Net.Highway, onramp: Net.Onramp, rail: Net.Rail,
  oneway: Net.OneWay,
};
/** Local networks can be upgraded in place: street → road → avenue. */
const LOCAL_RANK: Record<number, number> = { [Net.Street]: 1, [Net.Road]: 2, [Net.OneWay]: 2, [Net.Avenue]: 3 };

/** Tiles a line tool would build, its cost, and why it can't (if so). */
interface LinePlan {
  tiles: number[];
  cost: number;
  message?: string;
}

/** A planned network drag (see buildNetwork), or why it can't be built. */
type NetworkPlan =
  | {
    code: number; path: [number, number][]; tiles: [number, number][]; dirs: Map<number, number>; overpasses: number[];
    /** Ground highway tiles a local road passes over, and the interchange code it leaves. */
    over: [number, number][];
    tunnels: Map<number, number>; cost: number; message?: string;
  }
  | { message: string };

export interface TileInfo {
  x: number;
  y: number;
  terrain: 'land' | 'water';
  network: NetworkKind | 'crossing' | null;
  subway: boolean;
  elevated: 'elrail' | 'monorail' | 'highway' | null;
  toll: boolean;
  /** Ground highway crossing: an overpass, or joined by a Cloverleaf. */
  interchange: 'overpass' | 'cloverleaf' | null;
  /** A street, road or avenue passing over this ground highway tile. */
  over: 'street' | 'road' | 'avenue' | 'oneway' | null;
  tunnel: boolean;
  /** A bridge over a land gorge (bridges over water are ordinary water tiles). */
  bridge: boolean;
  /** A bridge over water too low for ferries to pass under. */
  lowBridge: boolean;
  /** A Subway-to-Elevated Transition on this tile (Rush Hour). */
  subwayTransition: boolean;
  /** The name the mayor gave the building or structure here, if any. */
  name: string | null;
  monorailTraffic: number;
  highwayTraffic: number;
  ferryTraffic: number;
  /** Fastest trip to work from here (centi-hours; null when none within the limit). */
  commute: number | null;
  /** Freight time to a connection (centi-hours; null when none). */
  freight: number | null;
  /** Trains and subway riders over this tile last month. */
  railTraffic: number;
  subwayTraffic: number;
  /** Months of radiation left (0 = none, 255 = a meltdown's, for good). */
  radiation: number;
  landform: 'none' | 'crater' | 'cone' | 'slope' | 'fault';
  /** Height above the water and largest step to a neighbour, metres. */
  height: number;
  slope: number;
  lineWear: number;
  pipeWear: number;
  railDamaged: boolean;
  zone: ZoneKind;
  building: Building | null;
  structure: Structure | null;
  landValue: number;
  airPollution: number;
  waterPollution: number;
  traffic: number;
  /** On a power grid that has supply (buildings may still be in a blackout). */
  powered: boolean;
  powerLine: boolean;
  /** Inside pipe coverage of a network that has supply. */
  watered: boolean;
  pipe: boolean;
  /** Recent crime around the tile, protection levels and flammability. */
  crime: number;
  policeProtection: number;
  fireProtection: number;
  flammability: number;
  rubble: boolean;
  burning: boolean;
  /** Uncollected garbage piled here (tons); landfill fill (tons of 300) or null. */
  garbage: number;
  landfill: number | null;
  /** 0–1 healthcare and school coverage quality. */
  healthQuality: number;
  schoolQuality: number;
  desirability: Record<DevType, FactorBreakdown>;
}

export interface CityStats {
  day: number;
  date: { year: number; month: number; day: number };
  funds: number;
  population: number;
  jobs: number;
  residents: [number, number, number];
  unemployed: [number, number, number];
  buildings: number;
  abandoned: number;
  impeached: boolean;
  power: { supply: number; demand: number; blackedOut: number };
  /** shortages: buildings short of water; of them, sourceless: on pipes with no pump or tower, pumpsOff: where they all make nothing. */
  water: { supply: number; demand: number; shortages: number; sourceless: number; pumpsOff: number; pumpsOffAt?: { x: number; y: number }; sourcelessAt?: { x: number; y: number } };
  garbage: GarbageStats;
  /** Citywide Mayor Rating (resident-weighted) and riots so far. */
  mayorRating: number;
  riots: number;
  /** Last month's crimes/arrests/fires; `burning` = fires right now. */
  safety: { crimes: number; arrests: number; prevented: number; paroled: number; fires: number; burned: number; burning: number; byType?: Record<string, number>; spots?: [number, string][] };
  /** Average EQ / HQ by wealth ($, $$, $$$). */
  eq: [number, number, number];
  hq: [number, number, number];
  workforceFraction: number;
}


/** Months of history kept for graphs (50 years). */
const HISTORY_MONTHS = 600;

/** Lines never run past this tile (no map is bigger). */
const LINE_LIMIT = 4096;
/** Largest map side (the viewer makes up to 256). */
export const MAX_SIZE = 1024;
/** New buildings between demand updates during a day's development. */
const DEMAND_EVERY = 4;
/** Days one step() call runs at most (a hundred years). */
const STEP_LIMIT = 36_000;

// Arguments can come from a client as any JSON (the worker example): names
// must be the table's own keys (not "toString"), edges 0–3, text a string.
const own = (table: object, key: unknown): boolean => typeof key === 'string' && Object.hasOwn(table, key);
const isEdge = (e: unknown): e is 0 | 1 | 2 | 3 => e === 0 || e === 1 || e === 2 || e === 3;
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const LINE_KINDS: readonly unknown[] = ['elrail', 'monorail', 'highway'];
const DISPATCH_KINDS: readonly unknown[] = ['fire', 'police'];
const NEIGHBOUR_KINDS: readonly unknown[] = ['simnation', 'established', 'developed'];
const DEAL_RESOURCES: readonly unknown[] = ['power', 'water', 'garbage'];

/** Tiles along an L-shaped path (horizontal leg first). */
export function linePath(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  // Whole tiles, and no further than any map reaches (bad input must not run away).
  if (![x0, y0, x1, y1].every(Number.isFinite)) return out;
  const tile = (v: number) => Math.max(-1, Math.min(LINE_LIMIT, Math.round(v)));
  [x0, y0, x1, y1] = [tile(x0), tile(y0), tile(x1), tile(y1)];
  const sx = Math.sign(x1 - x0);
  const sy = Math.sign(y1 - y0);
  let x = x0;
  out.push([x, y0]);
  while (x !== x1) {
    x += sx;
    out.push([x, y0]);
  }
  let y = y0;
  while (y !== y1) {
    y += sy;
    out.push([x1, y]);
  }
  return out;
}

/** Months over which free landfill space counts as monthly garbage capacity in Neighbor Deals. */
const GARBAGE_DEAL_MONTHS = 60;

/** Steps held on one point before a steered disaster speeds up by another step. */
const LIVE_HOLD_STEPS = 4;

/** Stage an arson fire starts at. */
const ARSON_STAGE = 2;
/** Days an arsonist is about before striking: time to send the police. */
const ARSON_FUSE_DAYS = 7;

/**
 * My Sims' fortunes (the rates are assumed): a monthly chance of dying in a
 * robbery or of pollution, scaled by how bad each is at home (a hospital nearby halves the second), and
 * the EQ at home that gets a § or §§ Sim promoted.
 */
const MY_SIM_FATE = { robbery: 0.01, pollution: 0.01, promoteEq: [90, 130] as readonly number[] };
/** How many of the closest workplaces a My Sim checks the commute to. */
const MY_SIM_JOB_TRIES = 12;
/** Days a My Sim goes without a job, a home or a route to work before giving up on it (two months). */
const MY_SIM_JOBLESS_DAYS = 60;

export class City {
  readonly cfg: SimConfig;
  readonly state: CityState;
  readonly fields: Fields;
  readonly desirability: DesirabilityMap;
  census!: Census;
  demand!: DemandReport;
  power!: PowerReport;
  water!: WaterReport;
  private rng: Rng;
  /**
   * Counts edits and other changes that need the fields redone (a client can
   * cache what it shows until this moves). Not saved.
   */
  revision = 0;
  private networkDirtyFlag = true;
  private get networkDirty(): boolean {
    return this.networkDirtyFlag;
  }
  private set networkDirty(v: boolean) {
    if (v) this.revision++;
    this.networkDirtyFlag = v;
  }
  private fares = 0;
  private nextOverhaulDay = Infinity;
  private reports: DamageReport[] = [];
  private endedDeals: NeighbourDeal[] = [];
  private repricedDeals: { deal: NeighbourDeal; was: number }[] = [];
  /** Ordinances repealed because what they need is gone (for the viewer to announce). */
  private repealed: OrdinanceId[] = [];
  private mySimNews: MySimNews[] = [];
  /** computeNetworkFields has run since the last network edit (see refresh). */
  private networkFieldsReady = false;
  /** Last month's trips by kind (Traffic Volume Graph). */
  volume: Partial<Record<VolumeKind, number>> = {};
  private newlyUnlocked: StructureKind[] = [];
  /**
   * Set by a viewer that moves tornadoes and robots itself in real time
   * (advanceDisasters): step() then leaves them, so they don't race ahead
   * with the game speed. Headless use keeps it off.
   */
  realTimeDisasters = false;
  private fullDesirability = new Map<DevType, Float32Array>();
  private growth: Uint8Array | null = null;
  private tractCache = new Map<DevType, { tx: number; ty: number; score: number }[]>();
  private tractFull = new Map<string, Set<number>>();
  private edgeRuns: ReturnType<typeof edgeConnections> | null = null;
  private effectsDirtyFlag = true;
  private coverageDirty = false;
  /** Utilities and pollution are fresh only through this settled simulation day. */
  private sourceFieldsDay = -1;
  /** A building left since the last census (burned, flattened): retaken at the day's end. */
  private censusStale = false;
  private get effectsDirty(): boolean {
    return this.effectsDirtyFlag;
  }
  private set effectsDirty(v: boolean) {
    if (v) this.revision++;
    this.effectsDirtyFlag = v;
  }

  constructor(opts: CityOptions = {}, state?: CityState) {
    this.cfg = makeConfig(opts.config);
    if (state) this.state = state;
    else {
      const size = opts.size ?? 128;
      const seed = (opts.seed ?? 1) >>> 0;
      const difficulty = opts.difficulty ?? 'medium';
      if (!Number.isInteger(size) || size < 8 || size > MAX_SIZE) throw new RangeError(`size must be a whole number from 8 to ${MAX_SIZE}`);
      if (!own(this.cfg.difficulty, difficulty)) throw new RangeError(`unknown difficulty ${difficulty}`);
      const fromMap = opts.heightmap ? terrainFromHeightmap(size, opts.heightmap, this.cfg.terrain.grayscale, opts.heightmap.crop) : null;
      const terrain = fromMap?.terrain ?? generateTerrain(size, seed, opts.water ?? true);
      this.state = {
        version: 1,
        name: opts.name ?? 'New City',
        size,
        seed,
        rngState: seed,
        difficulty,
        day: 0,
        funds: this.cfg.difficulty[difficulty].startingFunds,
        terrain,
        height: fromMap?.height ?? generateHeights(size, seed, terrain, opts.water ?? true, this.cfg.terrain.heights),
        trees: fromMap || (opts.water ?? true) ? generateForest(size, seed, terrain) : new Uint8Array(size * size),
        net: new Uint8Array(size * size),
        power: new Uint8Array(size * size),
        pipe: new Uint8Array(size * size),
        subway: new Uint8Array(size * size),
        oneway: new Uint8Array(size * size),
        radiation: new Uint8Array(size * size),
        potholes: new Uint8Array(size * size),
        elevated: new Uint8Array(size * size),
        tolls: new Uint8Array(size * size),
        links: new Uint8Array(size * size),
        interchange: new Uint8Array(size * size),
        tunnel: new Uint8Array(size * size),
        departments: { roads: 100, transit: 100, power: 100, water: 100, parks: 100, sanitation: 100, landmarks: 100, corrections: 100 },
        powerDispatch: 'balanced',
        landform: new Uint8Array(size * size),
        lineWear: new Uint8Array(size * size),
        pipeWear: new Uint8Array(size * size),
        railDamage: new Uint8Array(size * size),
        spills: [],
        faultAngle: null,
        incidents: [],
        neighbours: defaultNeighbours(),
        wind: { dir: 0, strength: 0.3 },
        units: [],
        mobs: [],
        arsonists: [],
        neighbourDeals: [],
        mySims: [],
        liveDisasters: [],
        transitions: [],
        names: {},
        udi: { done: {}, partial: {} },
        nextDealId: 1,
        garbage: new Float32Array(size * size),
        landfill: new Float32Array(size * size),
        garbageStats: {
          produced: 0, recycled: 0, incinerated: 0, landfilled: 0, uncollected: 0, piled: 0, capacity: 0, landfillSpace: 0,
          kept: 0,
        },
        rubble: new Uint8Array(size * size),
        crime: new Float32Array(size * size),
        fires: [],
        treeFires: [],
        events: [],
        safety: { crimes: 0, arrests: 0, prevented: 0, paroled: 0, fires: 0, burned: 0 },
        carryCrimes: 0,
        fireTally: { fires: 0, burned: 0 },
        zone: new Uint8Array(size * size),
        occupant: new Int32Array(size * size),
        buildings: new Map(),
        structures: new Map(),
        nextId: 1,
        taxRates: perType(() => this.cfg.demand.defaultTaxRate),
        taxLog: [],
        freightTrips: 0,
        blackoutRotation: 0,
        unlocked: [],
        lastBudget: null,
        ordinances: [],
        ordinanceDays: {},
        loans: [],
        history: [],
        mayorRating: 0,
        taxMonthStart: [0, 0, 0],
        taxMood: [],
        demandTrend: {},
        growthTarget: {},
        cheats: {},
        riots: 0,
        impeached: false,
      };
    }
    if (!state) {
      const r = this.state.taxRates;
      this.state.taxMonthStart = [r['R$'], r['R$$'], r['R$$$']];
    }
    // Forecasts use the most recently collected fares even before the next simulated month.
    const fares = this.state.lastBudget?.fares;
    this.fares = typeof fares === 'number' && Number.isFinite(fares) ? fares : 0;
    this.rng = new Rng(this.state.rngState);
    this.fields = createFields(this.state.size);
    this.desirability = createDesirability(this.state.size);
    this.refresh();
  }

  get size(): number {
    return this.state.size;
  }

  // ---------------------------------------------------------------- tools

  /**
   * Zones a rectangle. Like SC4, streets are drawn inside it automatically
   * (unless `autoStreets` is false) so every lot gets frontage: residential
   * and commercial lots are at most 2 deep, industry and farms reach 7 tiles.
   */
  zone(x0: number, y0: number, x1: number, y1: number, kind: ZoneKind, opts: { autoStreets?: boolean } = {}): ToolResult {
    this.settle();
    const s = this.state;
    const plan = this.planZone(x0, y0, x1, y1, kind, opts);
    if (plan.message) return { ok: false, cost: 0, message: plan.message };
    for (const i of plan.tiles) {
      s.zone[i] = plan.code;
      // Zones carry power themselves, so lines under them disappear.
      if (plan.code !== 0) s.power[i] = 0;
    }
    for (const i of plan.streets) {
      s.net[i] = Net.Street;
      s.zone[i] = 0;
    }
    s.funds -= plan.cost;
    if (plan.code !== 0 && plan.tiles.length && s.zonedSince === undefined) s.zonedSince = s.day;
    this.networkDirty = true;
    return { ok: plan.tiles.length + plan.streets.size > 0, cost: plan.cost };
  }

  /**
   * What zoning a rectangle would do, without doing it: the tiles that would
   * be zoned, the auto-streets that would be laid, the cost, and why it can't
   * be done (if so). For previews while dragging.
   */
  previewZone(x0: number, y0: number, x1: number, y1: number, kind: ZoneKind, opts: { autoStreets?: boolean } = {}): {
    ok: boolean; cost: number; tiles: number; streets: [number, number][]; message?: string;
    /** The tiles the drag would zone (not water, roads, what is already that zone, or buildings unless it upzones them). */
    cells: [number, number][];
  } {
    const plan = this.planZone(x0, y0, x1, y1, kind, opts);
    const n = this.state.size;
    return {
      ok: !plan.message && plan.tiles.length + plan.streets.size > 0, cost: plan.cost, tiles: plan.tiles.length,
      cells: plan.tiles.map((i) => [i % n, Math.floor(i / n)]),
      streets: [...plan.streets].map((i) => [i % n, Math.floor(i / n)]), ...(plan.message ? { message: plan.message } : {}),
    };
  }

  private planZone(x0: number, y0: number, x1: number, y1: number, kind: ZoneKind, opts: { autoStreets?: boolean }): {
    code: number; tiles: number[]; streets: Set<number>; cost: number; message?: string;
  } {
    this.settle();
    const s = this.state;
    const code = zoneCode(kind);
    const none = { code, tiles: [], streets: new Set<number>(), cost: 0 };
    if (code < 0) return { ...none, message: `unknown zone ${kind}` };
    const landfill = code === LANDFILL_ZONE;
    // Landfills come in blocks of at least 2×2 and get no auto-streets.
    if (landfill && (Math.abs(x1 - x0) < 1 || Math.abs(y1 - y0) < 1)) {
      return { ...none, message: 'landfills need at least 2×2 tiles' };
    }
    // Agricultural zones are 4×4 at the smallest.
    if (kind === 'A' && (Math.abs(x1 - x0) < 3 || Math.abs(y1 - y0) < 3)) {
      return { ...none, message: 'farm zones need at least 4×4 tiles' };
    }
    const streets = code !== 0 && !landfill && opts.autoStreets !== false ? this.planStreets(x0, y0, x1, y1, code) : new Set<number>();
    const tiles: number[] = [];
    for (const [x, y] of this.rect(x0, y0, x1, y1)) {
      const i = idx(s, x, y);
      if (streets.has(i) || s.terrain[i] === Terrain.Water || s.net[i] !== Net.None || s.elevated[i]) continue;
      // Built-on land takes only a denser zone of its own class (SC4's upzoning): the
      // building stays and is redeveloped at the new density when it is replaced.
      if (s.occupant[i] !== 0 && !this.upzones(i, code)) continue;
      // Volcano cones can't be zoned; their slopes take low density only.
      if (code !== 0 && (s.landform[i] === Landform.Cone || (s.landform[i] === Landform.Slope && zoneInfo(code).density !== 'low'))) continue;
      if (s.zone[i] === code) continue;
      // A landfill tile can only be rezoned once its garbage has decomposed.
      if (s.zone[i] === LANDFILL_ZONE && s.landfill[i]! > 0) continue;
      tiles.push(i);
    }
    const density = zoneInfo(code).density;
    const unit = code === 0 ? DEZONING_COST : landfill ? this.cfg.garbage.landfill.zoneCost
      : density === 'high' && zoneInfo(code).cls === 'C' ? ZONING_COST_HIGH_COMMERCIAL : this.cfg.economy.zoningCost[density];
    const cost = tiles.length * unit + streets.size * this.cfg.economy.networkCost.street.build;
    if (cost > s.funds) return { code, tiles, streets, cost, message: 'not enough funds' };
    return { code, tiles, streets, cost };
  }

  /** Whether zone `code` is a denser zone of the same class as the developed tile `i`'s. */
  private upzones(i: number, code: number): boolean {
    const s = this.state;
    if (s.occupant[i]! <= 0 || code === 0 || code === LANDFILL_ZONE || !s.buildings.get(s.occupant[i]!)) return false;
    const from = zoneInfo(s.zone[i]!);
    const to = zoneInfo(code);
    const rank = { low: 0, medium: 1, high: 2 };
    return !!from.cls && from.cls === to.cls && rank[to.density] > rank[from.density];
  }

  /** Street tiles to add inside a zoning rectangle, parallel to its long side. */
  private planStreets(x0: number, y0: number, x1: number, y1: number, code: number): Set<number> {
    const s = this.state;
    const n = s.size;
    const cls = zoneInfo(code).cls;
    // (Industry and farms: lots reach a tile further than the distance counted here, which starts at 1 on the
    // zone's first tile; at 7, an 8-deep zone got a street it doesn't need.)
    const reach = cls === 'R' || cls === 'C' ? 2 : this.cfg.development.industrialReach + 1;
    const ax = Math.max(0, Math.min(x0, x1));
    const bx = Math.min(n - 1, Math.max(x0, x1));
    const ay = Math.max(0, Math.min(y0, y1));
    const by = Math.min(n - 1, Math.max(y0, y1));
    const horizontal = bx - ax >= by - ay;
    // Work in (along, across) coordinates; lines run along the long side.
    const alongLen = horizontal ? bx - ax + 1 : by - ay + 1;
    const acrossLen = horizontal ? by - ay + 1 : bx - ax + 1;
    const tile = (a: number, c: number) => (horizontal ? (ay + c) * n + ax + a : (ay + a) * n + ax + c);
    // Industry and farms get no street in a zone of 8×8 or less, road nearby or not: an isolated
    // small parcel waits for a road rather than being cut below the size of a farm.
    if ((cls === 'I' || cls === 'A') && alongLen <= 8 && acrossLen <= 8) return new Set();

    // Distance from existing networks (4-neighbour BFS, capped).
    const dist = new Map<number, number>();
    const queue: number[] = [];
    for (let y = Math.max(0, ay - reach); y <= Math.min(n - 1, by + reach); y++) {
      for (let x = Math.max(0, ax - reach); x <= Math.min(n - 1, bx + reach); x++) {
        const i = y * n + x;
        if (isLocalNet(s.net[i]!)) {
          dist.set(i, 0);
          queue.push(i);
        }
      }
    }
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h]!;
      const d = dist.get(i)!;
      if (d >= reach) continue;
      const x = i % n;
      const y = (i - x) / n;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (!dist.has(j)) {
          dist.set(j, d + 1);
          queue.push(j);
        }
      }
    }
    // (Not on a volcano's cone, as the street tool refuses.)
    const buildable = (i: number) => s.terrain[i] !== Terrain.Water && s.occupant[i] === 0 && s.landform[i] !== Landform.Cone;
    const rowCovered = (c: number) => {
      for (let a = 0; a < alongLen; a++) {
        const i = tile(a, c);
        if (buildable(i) && s.net[i] === Net.None && !(dist.get(i)! <= reach)) return false;
      }
      return true;
    };

    const out = new Set<number>();
    let c = 0;
    while (c < acrossLen) {
      if (rowCovered(c)) {
        c++;
        continue;
      }
      const line = Math.min(acrossLen - 1, c + reach);
      for (let a = 0; a < alongLen; a++) {
        const i = tile(a, line);
        if (buildable(i) && s.net[i] === Net.None) out.add(i);
      }
      c = line + reach + 1;
    }
    // Cross streets tie the new lines to each other and to roads along the
    // zone's edges: at both ends and every 12 tiles.
    if (out.size) {
      const cross = new Set([0, alongLen - 1]);
      for (let a = 12; a < alongLen - 6; a += 12) cross.add(a);
      for (const a of cross) {
        for (let c2 = 0; c2 < acrossLen; c2++) {
          const i = tile(a, c2);
          if (buildable(i) && s.net[i] === Net.None) out.add(i);
        }
      }
    }
    // No street up a cliff the street tool would refuse (steeper than a tunnel's grade): a tile that would
    // step that far to a street or road beside it is left out, and the zone waits for a road there.
    const grade = this.cfg.transport.tunnel.grade;
    for (const i of [...out]) {
      const x = i % n;
      const y = (i - x) / n;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if ((out.has(j) || isLocalNet(s.net[j]!)) && Math.abs(s.height[i]! - s.height[j]!) > grade) {
          out.delete(i);
          break;
        }
      }
    }
    return out;
  }

  /**
   * Lays a network along an L-shaped path. Streets, roads and avenues upgrade
   * each other in place; rail crosses them at level crossings; highways can't
   * cross other networks (like SimCity 4's Ground Highway) and are reached by
   * onramps.
   */
  buildNetwork(x0: number, y0: number, x1: number, y1: number, kind: NetworkKind, opts: { lowBridge?: boolean } = {}): ToolResult {
    this.settle();
    const s = this.state;
    const plan = this.planNetwork(x0, y0, x1, y1, kind, opts);
    if (plan.message !== undefined || !('tiles' in plan)) return { ok: false, cost: 0, message: plan.message };
    const { code, path, tiles, dirs, overpasses, over, tunnels } = plan;
    let cost = plan.cost;
    for (const [i, to] of tiles) {
      if (tunnels.has(i)) s.tunnel[i] = tunnels.get(i)!;
      s.net[i] = to;
      s.zone[i] = 0;
      s.rubble[i] = 0;
      s.trees[i] = 0;
      // Redrawing a one-way road sets (or reverses) its direction; a level
      // crossing keeps the direction of the one-way road through it.
      s.oneway[i] = to === Net.OneWay || (to === Net.RailCrossing && code === Net.OneWay) ? dirs.get(i) ?? 0
        : to === Net.RailCrossing ? s.oneway[i]! : 0;
      if (s.terrain[i] === Terrain.Water) s.tunnel[i] = opts.lowBridge ? SPAN.lowBridge : SPAN.none;
    }
    for (const i of overpasses) s.interchange[i] = INTERCHANGE.overpass;
    if (manualNet(code)) this.linkPath(path);
    for (const [i, v] of over) {
      s.interchange[i] = v;
      // A one-way deck keeps its direction (the highway below has none of its own).
      s.oneway[i] = overNet(s, i) === Net.OneWay ? dirs.get(i) ?? 0 : 0;
    }
    if (code === Net.Avenue || code === Net.Highway) cost += this.inlineRamps(path, new Set(tiles.map(([i]) => i)), s.funds - cost);
    s.funds -= cost;
    this.networkDirty = true;
    if (overpasses.length) return { ok: true, cost, message: 'highways pass over each other; place a Cloverleaf to join them' };
    return { ok: tiles.length + over.length > 0, cost };
  }

  /**
   * What dragging a network would do, without doing it: the cost (with any
   * direct ramps an avenue or highway adds), the tiles it builds or upgrades,
   * bridges and tunnels, and why it can't be built (if so).
   */
  previewNetwork(x0: number, y0: number, x1: number, y1: number, kind: NetworkKind, opts: { lowBridge?: boolean } = {}): {
    ok: boolean; cost: number; tiles: number; bridges: number; tunnels: number; message?: string;
  } {
    const plan = this.planNetwork(x0, y0, x1, y1, kind, opts);
    if (!('tiles' in plan)) return { ok: false, cost: 0, tiles: 0, bridges: 0, tunnels: 0, message: plan.message };
    const s = this.state;
    let bridges = 0;
    let tunnels = 0;
    for (const [i] of plan.tiles) {
      if (s.terrain[i] === Terrain.Water || plan.tunnels.get(i) === SPAN.bridge) bridges++;
      else if (plan.tunnels.has(i)) tunnels++;
    }
    // The in-line ramps an avenue or highway adds where it meets the other (see inlineRamps).
    let ramps = 0;
    if (plan.message === undefined && (plan.code === Net.Avenue || plan.code === Net.Highway)) {
      const after = new Map(plan.tiles);
      ramps = this.rampJoints(plan.path, new Set(after.keys()), s.funds - plan.cost, (i) => after.get(i) ?? s.net[i]!, (i) => s.elevated[i]!).cost;
    }
    return {
      ok: plan.message === undefined && plan.tiles.length + plan.over.length > 0, cost: plan.cost + ramps, tiles: plan.tiles.length + plan.over.length, bridges, tunnels,
      ...(plan.message !== undefined ? { message: plan.message } : {}),
    };
  }

  private planNetwork(x0: number, y0: number, x1: number, y1: number, kind: NetworkKind, opts: { lowBridge?: boolean }): NetworkPlan {
    this.settle();
    const s = this.state;
    if (!own(NET_CODE, kind)) return { message: `unknown network ${kind}` };
    const code = NET_CODE[kind];
    const unit = this.cfg.economy.networkCost[kind].build;
    const tiles: [number, number][] = [];
    const dirs = new Map<number, number>();
    const overpasses: number[] = [];
    const over: [number, number][] = [];
    let cost = 0;
    const path = linePath(x0, y0, x1, y1);
    for (let k = 0; k < path.length; k++) {
      const [x, y] = path[k]!;
      if (!inBounds(s, x, y)) continue;
      const i = idx(s, x, y);
      if (s.occupant[i] !== 0) return { message: 'path is blocked by a building' };
      if (code === Net.OneWay) {
        // Traffic flows the way the road was dragged.
        const [nx, ny] = path[k + 1] ?? [x, y];
        const [px, py] = path[k - 1] ?? [x, y];
        const dx = k + 1 < path.length ? nx - x : x - px;
        const dy = k + 1 < path.length ? ny - y : y - py;
        dirs.set(i, ONEWAY_DIRS.findIndex(([ax, ay]) => ax === dx && ay === dy) + 1);
        if (s.terrain[i] === Terrain.Water) return { message: 'one-way roads cannot build bridges' };
      }
      if (s.landform[i] === Landform.Cone) return { message: 'path crosses a volcano' };
      const old = s.net[i]!;
      if (code === Net.Highway && old === Net.Highway && s.interchange[i] === INTERCHANGE.none && this.crossesHighway(path, k)) overpasses.push(i);
      // A street, road or avenue crossing a Ground Highway goes over it
      // (at a hefty extra cost); onramps join them.
      if (old === Net.Highway && LOCAL_RANK[code] && (s.interchange[i] === INTERCHANGE.none || overNet(s, i))) {
        if (!this.crossesHighway(path, k) || s.tunnel[i]) return { message: 'path crosses another network' };
        // (The deck and an elevated highway would share the upper level: the highway was cut there.)
        if (s.elevated[i] === ELEVATED.highway) return { message: 'path crosses other elevated track' };
        const had = overNet(s, i);
        // (A one-way deck redrawn, the other way or as a road, takes the new direction.)
        if (had && (LOCAL_RANK[had]! > LOCAL_RANK[code]! || (had === code && code !== Net.OneWay))) continue;
        over.push([i, INTERCHANGE.roadOver + OVER_NETS.indexOf(code as (typeof OVER_NETS)[number])]);
        cost += unit + (had ? 0 : this.cfg.transport.roadOverpass.cost);
        continue;
      }
      let to: number = code;
      if ((old === code && code !== Net.OneWay) || old === Net.RailCrossing && (isLocalNet(code) || code === Net.Rail)) continue;
      if (old !== Net.None) {
        const local = LOCAL_RANK[code] && LOCAL_RANK[old];
        if (local) {
          if (LOCAL_RANK[code]! < LOCAL_RANK[old]!) continue;
        } else if ((code === Net.Rail && isLocalNet(old)) || (old === Net.Rail && isLocalNet(code))) {
          if (s.terrain[i] === Terrain.Water) return { message: 'no crossings on bridges' };
          to = Net.RailCrossing;
        } else if (code === Net.Onramp && (old === Net.Road || old === Net.Avenue)) {
          // An onramp replaces the road tile it is built on (roads and avenues: streets "can't accommodate
          // onramps", and over a level crossing it cut the rail line).
        } else return { message: 'path crosses another network' };
      }
      tiles.push([i, to]);
      // Over water the network becomes a bridge.
      // Over water the network becomes a bridge; a low one is cheaper but ferries can't pass under it.
      const water = s.terrain[i] === Terrain.Water;
      cost += water ? unit * this.cfg.economy.bridgeCostMult * (opts.lowBridge ? this.cfg.economy.lowBridgeShare : 1) : unit;
    }
    // Steep climbs: roads, rail and highways tunnel through; other kinds can't.
    const tunnels = this.tunnelsAlong(path, code);
    if (typeof tunnels === 'string') return { message: tunnels };
    for (const [i] of tiles) {
      const span = tunnels.get(i);
      if (span) cost += unit * ((span === SPAN.bridge ? this.cfg.economy.bridgeCostMult : this.cfg.transport.tunnel.costMult) - 1);
    }
    return { code, path, tiles, dirs, overpasses, over, tunnels, cost, ...(cost > s.funds ? { message: 'not enough funds' } : {}) };
  }

  /**
   * Tiles of a path that must run in a tunnel (after a climb steeper than the
   * tunnel grade, until the ground is back within a grade of the entry height)
   * or on a bridge over a gorge (after such a drop, until the ground climbs
   * back): tunnels for upward slopes over 45°, bridges for downward
   * ones. Maps tile → SPAN kind; a string says why the path can't be built.
   */
  private tunnelsAlong(path: [number, number][], code: number): Map<number, number> | string {
    const s = this.state;
    const grade = this.cfg.transport.tunnel.grade;
    const canTunnel = code === Net.Road || code === Net.Rail || code === Net.Highway;
    const out = new Map<number, number>();
    const h = (k: number) => {
      const [x, y] = path[k]!;
      return s.height[idx(s, x, y)]!;
    };
    const land = (k: number) => {
      const [x, y] = path[k]!;
      return inBounds(s, x, y) && s.terrain[idx(s, x, y)] !== Terrain.Water;
    };
    const mark = (from: number, to: number, kind: number = SPAN.tunnel) => {
      for (let t = from; t <= to; t++) {
        const [x, y] = path[t]!;
        out.set(idx(s, x, y), kind);
      }
    };
    const inside = (k: number) => {
      const [x, y] = path[k]!;
      return out.has(idx(s, x, y));
    };
    for (let k = 1; k < path.length; k++) {
      if (!land(k) || !land(k - 1)) continue;
      const rise = h(k) - h(k - 1);
      if (Math.abs(rise) <= grade || inside(k) || inside(k - 1)) continue;
      if (!canTunnel) return 'too steep for this network';
      if (rise > 0) {
        // Into the hill: on until the ground is back down near the entry height.
        const entry = h(k - 1);
        let e = k;
        while (e < path.length && land(e) && h(e) > entry + grade) e++;
        if (e >= path.length || !land(e)) return 'a tunnel has to come out on the other side';
        mark(k, e - 1);
        k = e;
      } else {
        // Out of a hill the path was already crossing: tunnel back to where the ground was this low.
        const exit = h(k);
        let a = k - 1;
        while (a >= 0 && land(a) && h(a) > exit + grade) a--;
        if (a >= 0 && land(a)) {
          mark(a + 1, k - 1);
          continue;
        }
        // Off the edge of a gorge: bridge it until the ground climbs back (downward slopes make bridges).
        const deck = h(k - 1);
        let e = k;
        while (e < path.length && land(e) && h(e) < deck - grade) e++;
        if (e >= path.length || !land(e)) return 'too steep: a bridge has to reach the other side';
        mark(k, e - 1, SPAN.bridge);
        k = e;
      }
    }
    return out;
  }

  /** Does the path run straight across an existing highway (rather than along or into it) at step k? */
  /**
   * Joins a dragged road's tiles to each other, and its ends onward in the
   * drag direction (drawn up to a road, it meets it); a one-tile drag joins
   * everything around it.
   */
  private linkPath(path: [number, number][]): void {
    const s = this.state;
    const n = s.size;
    const at = ([x, y]: readonly [number, number]) => (inBounds(s, x, y) ? y * n + x : -1);
    const join = (i: number, j: number) => {
      if (i < 0 || j < 0) return;
      s.links[i] = s.links[i]! | linkBit(i, j, n);
      s.links[j] = s.links[j]! | linkBit(j, i, n);
    };
    if (!path.length) return;
    if (path.length === 1) {
      const [x, y] = path[0]!;
      for (const [dx, dy] of ONEWAY_DIRS) join(at([x, y]), at([x + dx, y + dy]));
      return;
    }
    for (let k = 0; k + 1 < path.length; k++) join(at(path[k]!), at(path[k + 1]!));
    const ext = (a: [number, number], b: [number, number]): [number, number] => [2 * a[0] - b[0], 2 * a[1] - b[1]];
    join(at(path[0]!), at(ext(path[0]!, path[1]!)));
    join(at(path.at(-1)!), at(ext(path.at(-1)!, path.at(-2)!)));
  }

  private crossesHighway(path: [number, number][], k: number): boolean {
    const s = this.state;
    const n = s.size;
    if (k === 0 || k + 1 >= path.length) return false;
    const [x, y] = path[k]!;
    const [px, py] = path[k - 1]!;
    const [nx, ny] = path[k + 1]!;
    const hw = (xx: number, yy: number) => inBounds(s, xx, yy) && s.net[yy * n + xx] === Net.Highway;
    const oldH = hw(x - 1, y) || hw(x + 1, y);
    const oldV = hw(x, y - 1) || hw(x, y + 1);
    if (px === nx) return oldH && !oldV;
    if (py === ny) return oldV && !oldH;
    return false;
  }

  /** Puts a Cloverleaf on a ground highway tile so highways crossing there connect (§3,000, Rush Hour). */
  placeCloverleaf(x: number, y: number): ToolResult {
    this.settle();
    const s = this.state;
    if (!inBounds(s, x, y)) return { ok: false, cost: 0, message: 'out of bounds' };
    const i = idx(s, x, y);
    if (s.net[i] !== Net.Highway) return { ok: false, cost: 0, message: 'cloverleafs go on ground highways' };
    if (s.interchange[i] === INTERCHANGE.cloverleaf) return { ok: false, cost: 0, message: 'already a cloverleaf' };
    if (overNet(s, i)) return { ok: false, cost: 0, message: 'a road passes over this highway' };
    const cost = this.cfg.transport.cloverleaf.cost;
    if (cost > s.funds) return { ok: false, cost: 0, message: 'not enough funds' };
    s.interchange[i] = INTERCHANGE.cloverleaf;
    s.funds -= cost;
    this.networkDirty = true;
    return { ok: true, cost };
  }

  /** Renames the city (trimmed, up to 40 characters; an empty name is refused). */
  rename(name: string): ToolResult {
    this.settle();
    const clean = text(name).trim().slice(0, 40);
    if (!clean) return { ok: false, cost: 0, message: 'name is empty' };
    this.state.name = clean;
    this.revision++;
    return { ok: true, cost: 0 };
  }

  /**
   * A console cheat: "you don't deserve it" makes every reward available,
   * "fightthepower" and "howdryiam" lift the power and water requirements
   * (again to restore them), "weaknesspays" adds §1,000 and "whererufrom"
   * renames the city. Codes for the view (zots, the clock) are refused here.
   */
  cheat(code: string): ToolResult & { cheat?: string } {
    this.settle();
    const s = this.state;
    const raw = text(code).trim();
    const lower = raw.toLowerCase().replace(/[’']/g, "'");
    if (lower === "you don't deserve it") {
      for (const [kind, def] of Object.entries(this.cfg.structures) as [StructureKind, StructureDef][]) {
        const want = def.unlockTiers ? def.unlockTiers.length : def.unlock ? 1 : 0;
        while (s.unlocked.filter((k) => k === kind).length < want) s.unlocked.push(kind);
      }
      this.revision++;
      return { ok: true, cost: 0, cheat: 'rewards' };
    }
    if (lower === 'fightthepower' || lower === 'howdryiam') {
      const key = lower === 'fightthepower' ? 'power' : 'water';
      if (s.cheats[key]) delete s.cheats[key];
      else s.cheats[key] = true;
      this.effectsDirty = true;
      return { ok: true, cost: 0, cheat: s.cheats[key] ? `${key}Off` : `${key}On` };
    }
    if (lower === 'weaknesspays') {
      s.funds += 1000;
      return { ok: true, cost: -1000, cheat: 'funds' };
    }
    if (lower.startsWith('whererufrom ')) {
      const res = this.rename(raw.slice('whererufrom '.length));
      return res.ok ? { ...res, cheat: 'rename' } : res;
    }
    return { ok: false, cost: 0, message: 'unknown cheat' };
  }

  /** Renames the building or structure on a tile (any building, from its Query box); an empty name clears it. */
  renameBuilding(x: number, y: number, name: string): ToolResult {
    this.settle();
    const s = this.state;
    if (!inBounds(s, x, y)) return { ok: false, cost: 0, message: 'out of bounds' };
    const occ = s.occupant[idx(s, x, y)]!;
    if (!occ) return { ok: false, cost: 0, message: 'no building here' };
    const clean = text(name).trim().slice(0, 40);
    if (clean) s.names[occ] = clean;
    else delete s.names[occ];
    return { ok: true, cost: 0 };
  }

  /**
   * Marks the RCI building on a tile Historical, or clears the mark (Rush
   * Hour): it keeps its type and stage whatever happens to desirability, but
   * can still be abandoned (then only its original type moves back in), burn
   * or be bulldozed.
   */
  markHistorical(x: number, y: number, on = true): ToolResult {
    this.settle();
    const s = this.state;
    if (!inBounds(s, x, y)) return { ok: false, cost: 0, message: 'out of bounds' };
    const occ = s.occupant[idx(s, x, y)]!;
    const b = occ > 0 ? s.buildings.get(occ) : undefined;
    if (!b) return { ok: false, cost: 0, message: 'no building here' };
    b.historical = on;
    return { ok: true, cost: 0 };
  }

  /** Clears a rectangle: buildings, civic structures, networks, elevated track, power lines, rubble and trees (not pipes or subway). Burning lots can't be bulldozed. */
  private planBulldoze(x0: number, y0: number, x1: number, y1: number) {
    this.settle();
    const s = this.state;
    const ec = this.cfg.economy;
    let cost = 0;
    const removeB = new Set<Building>();
    const removeS = new Set<Structure>();
    const roads: number[] = [];
    const elevated: number[] = [];
    const lines: number[] = [];
    const rubble: number[] = [];
    for (const [x, y] of this.rect(x0, y0, x1, y1)) {
      const i = idx(s, x, y);
      const occ = s.occupant[i]!;
      if (occ > 0) removeB.add(s.buildings.get(occ)!);
      else if (occ < 0) removeS.add(s.structures.get(-occ)!);
      if (s.net[i] !== Net.None) {
        roads.push(i);
        cost += ec.networkCost[NETWORK_KINDS[s.net[i]!]!].bulldoze;
      }
      if (s.elevated[i]) {
        elevated.push(i);
        cost += ec.networkCost[s.elevated[i] === ELEVATED.highway ? 'elevatedHighway' : ELEVATED_KINDS[s.elevated[i]!]!].bulldoze;
      }
      if (s.power[i]) {
        lines.push(i);
        cost += this.cfg.services.powerLineCost.bulldoze;
      }
      if (s.rubble[i]) {
        rubble.push(i);
        cost += this.cfg.safety.rubbleBulldoze;
      }
    }
    // A burning building can't be bulldozed.
    const burning = new Set(s.fires.map((fi) => fi.target));
    for (const b of removeB) if (burning.has(b.id)) return { removeB, removeS, roads, elevated, lines, rubble, cost, message: 'building is on fire' };
    for (const st of removeS) if (burning.has(-st.id)) return { removeB, removeS, roads, elevated, lines, rubble, cost, message: 'building is on fire' };
    // RCI buildings at fair market value (more than civic ones, which the city owns): the base fee
    // for each stage and tile of the lot, §5 for a stage-1 house and hundreds for a tower (it was §5 for any).
    for (const b of removeB) {
      const base = ec.bulldozeCost.building * Math.max(1, b.stage) * b.w * b.h;
      cost += b.type ? Math.max(base, Math.round(b.capacity * b.occupancy * ec.bulldozeCost.perOccupant[this.cfg.demand.wealthOf[b.type]]!)) : base;
    }
    for (const st of removeS) cost += this.cfg.structures[st.kind].bulldoze ?? ec.bulldozeCost.building;
    // A business deal's demolition fee may be paid into the red: offered only to broke cities, it
    // could otherwise never be taken down.
    const dealFee = [...removeS].reduce((a, st) => a + (this.cfg.structures[st.kind].category === 'deal' ? this.cfg.structures[st.kind].bulldoze ?? ec.bulldozeCost.building : 0), 0);
    return { removeB, removeS, roads, elevated, lines, rubble, cost, ...(cost - dealFee > 0 && cost - dealFee > s.funds ? { message: 'not enough funds' } : {}) };
  }

  /** What bulldozing a rectangle would remove and cost, without doing it (for previews). */
  previewBulldoze(x0: number, y0: number, x1: number, y1: number): {
    ok: boolean; cost: number; buildings: number; structures: number; networkTiles: number; powerLines: number; rubble: number;
    /** Footprints of the buildings and facilities that would go. */
    lots: Rect[]; message?: string;
  } {
    const p = this.planBulldoze(x0, y0, x1, y1);
    const any = p.removeB.size + p.removeS.size + p.roads.length + p.elevated.length + p.lines.length + p.rubble.length > 0;
    return {
      ok: any && !p.message, cost: p.cost, buildings: p.removeB.size, structures: p.removeS.size,
      networkTiles: p.roads.length + p.elevated.length, powerLines: p.lines.length, rubble: p.rubble.length,
      lots: [...p.removeB, ...p.removeS].map(({ x, y, w, h }) => ({ x, y, w, h })), ...(p.message ? { message: p.message } : {}),
    };
  }

  bulldoze(x0: number, y0: number, x1: number, y1: number): ToolResult {
    this.settle();
    const s = this.state;
    const { removeB, removeS, roads, elevated, lines, rubble, cost, message } = this.planBulldoze(x0, y0, x1, y1);
    if (message) return { ok: false, cost: 0, message };
    for (const b of removeB) this.removeBuilding(b);
    // My Sims whose home is bulldozed look for another of their wealth nearby: at once, else for two
    // months before moving out (see checkMySims).
    for (const sim of s.mySims) {
      if (![...removeB].some((b) => b.id === sim.home) || this.rehouseMySim(sim)) continue;
      sim.homelessSince = s.day;
      this.mySimNews.push({ sim: { ...sim }, kind: 'searching' });
    }
    for (const st of removeS) {
      for (const i of footprint(s, st)) s.occupant[i] = 0;
      s.structures.delete(st.id);
    }
    for (const i of roads) {
      s.net[i] = Net.None;
      s.oneway[i] = 0;
      s.tolls[i] = 0;
      s.links[i] = 0;
      s.interchange[i] = 0;
      s.tunnel[i] = 0;
      s.potholes[i] = 0;
    }
    for (const i of elevated) {
      if (s.tolls[i] === 2) s.tolls[i] = 0;
      s.elevated[i] = 0;
    }
    for (const i of lines) s.power[i] = 0;
    for (const i of rubble) s.rubble[i] = 0;
    // The bulldozer clears trees too (free).
    for (const [x, y] of this.rect(x0, y0, x1, y1)) s.trees[idx(s, x, y)] = 0;
    // Clearing a lot hauls away the garbage piled on it.
    for (const b of removeB) for (const i of footprint(s, b)) s.garbage[i] = 0;
    s.funds -= cost;
    this.networkDirty = true;
    // (Homes and jobs gone at once in the figures, not at the next day: as enacting an ordinance does.)
    if (this.censusStale) this.updateDemand();
    return { ok: removeB.size + removeS.size + roads.length + elevated.length + lines.length + rubble.length > 0, cost };
  }

  /**
   * Clears every rubble tile in the city at the bulldozer's price, and
   * nothing else (a rectangle bulldozed over scattered rubble takes the
   * roads and homes between). `preview` only prices it.
   */
  clearRubble(preview = false): ToolResult & { tiles: number } {
    this.settle();
    const s = this.state;
    let tiles = 0;
    for (let i = 0; i < s.rubble.length; i++) if (s.rubble[i]) tiles++;
    const cost = tiles * this.cfg.safety.rubbleBulldoze;
    if (!tiles) return { ok: false, cost: 0, tiles, message: 'no rubble' };
    if (cost > s.funds) return { ok: false, cost, tiles, message: 'not enough funds' };
    if (preview) return { ok: true, cost, tiles };
    s.rubble.fill(0);
    s.funds -= cost;
    this.networkDirty = true;
    return { ok: true, cost, tiles };
  }

  /** Plops a civic structure (park, plant, school, station, reward …) with its top-left at (x, y): the site must be clear land (shore for seaports, ferries and marinas) and the reward unlocked. */
  /** Whether `kind` could be placed at (x, y) now, and why not (same checks as placeStructure). */
  canPlaceStructure(kind: StructureKind, x: number, y: number): ToolResult {
    const def = this.cfg.structures[kind];
    const problem = this.placementProblem(kind, x, y);
    return problem ? { ok: false, cost: 0, message: problem } : { ok: true, cost: def.cost };
  }

  /**
   * Does a road run beside the rectangle at grade (where garbage trucks, fire
   * engines and buses reach a facility)? Without one its garbage piles up.
   */
  roadBeside(x: number, y: number, w: number, h: number): boolean {
    if (![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1 || w > 64 || h > 64) return false;
    return frontage(this.state, { x, y, w, h }).length > 0;
  }

  /**
   * Whether a structure placed here would join a power grid: 'powered' when a
   * conductor within reach (zone, building, power line) has power, 'linked'
   * when one is in reach but unpowered, 'none' when nothing is (it would need
   * a power line). As of the last refresh.
   */
  powerReach(kind: StructureKind, x: number, y: number): 'powered' | 'linked' | 'none' {
    const s = this.state;
    if (!own(this.cfg.structures, kind)) return 'none';
    const def = this.cfg.structures[kind];
    const n = s.size;
    const reach = this.cfg.services.powerGap + 1;
    let found: 'linked' | 'none' = 'none';
    for (let ty = Math.max(0, y - reach); ty <= Math.min(n - 1, y + def.h - 1 + reach); ty++) {
      for (let tx = Math.max(0, x - reach); tx <= Math.min(n - 1, x + def.w - 1 + reach); tx++) {
        if (tx >= x && tx < x + def.w && ty >= y && ty < y + def.h) continue;
        const i = ty * n + tx;
        if (!s.power[i] && !s.zone[i] && !s.occupant[i]) continue;
        if (this.fields.powered[i]) return 'powered';
        found = 'linked';
      }
    }
    return found;
  }

  private placementProblem(kind: StructureKind, x: number, y: number): string | null {
    this.settle();
    const s = this.state;
    if (!own(this.cfg.structures, kind)) return `unknown structure ${kind}`;
    const def = this.cfg.structures[kind];
    if (!this.isUnlocked(kind)) {
      const when = def.unlock?.description ?? def.unlockTiers?.[0]?.description ?? def.offer?.description;
      return when ? `locked: ${when}` : 'locked';
    }
    if (kind === 'nuclearPlant' && ordinanceEffects(s).banNuclear) return 'Nuclear Free Zone is in effect';
    if (this.placementsLeft(kind) <= 0) return 'no more of these allowed';
    const needs = def.offer?.ordinance;
    if (needs && !s.ordinances.includes(needs as OrdinanceId)) return `needs the ${needs} ordinance`;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + def.w > s.size || y + def.h > s.size) return 'out of bounds';
    const tiles = footprint(s, { x, y, w: def.w, h: def.h });
    // Seaports sit part on land, part on water; everything else on land.
    const wet = tiles.filter((i) => s.terrain[i] === Terrain.Water).length;
    if (def.onWater ? wet === 0 || wet === tiles.length : wet > 0) return def.onWater ? 'must be built on the shore' : 'site is on water';
    // What is in the way, so the player knows what to clear.
    if (tiles.some((i) => s.occupant[i] !== 0)) return 'site has a building on it';
    if (tiles.some((i) => s.net[i] !== Net.None || s.elevated[i])) return 'site has a road or track on it';
    if (tiles.some((i) => s.rubble[i])) return 'site has rubble on it';
    if (tiles.some((i) => s.landform[i] === Landform.Cone)) return 'site is on a volcano';
    if (def.cost > s.funds) return 'not enough funds';
    return null;
  }

  placeStructure(kind: StructureKind, x: number, y: number): ToolResult {
    this.settle();
    const s = this.state;
    const problem = this.placementProblem(kind, x, y);
    if (problem) return { ok: false, cost: 0, message: problem };
    const def = this.cfg.structures[kind];
    const st: Structure = {
      id: 0, kind, x, y, w: def.w, h: def.h,
      funding: 100, life: 0, load: 0, capacity: 0, effectiveness: 0, strike: 0, powered: false,
    };
    const tiles = footprint(s, st);
    st.id = s.nextId++;
    s.structures.set(st.id, st);
    for (const i of tiles) {
      s.occupant[i] = -st.id;
      s.zone[i] = 0;
      s.power[i] = 0;
      s.trees[i] = 0;
    }
    s.funds -= def.cost;
    // A new civic building cheers the neighbourhood (+25 within 8 tiles).
    if (def.category === 'health' || def.category === 'education' || def.category === 'safety') {
      s.events.push(civicEvent(this.cfg, x + Math.floor(def.w / 2), y + Math.floor(def.h / 2)));
    }
    this.networkDirty = true;
    if (!this.batching) this.refresh(); // demand, coverage and ratings show the new facility at once
    return { ok: true, cost: def.cost };
  }

  /** Power lines along an L-shaped path; they may cross roads and water. */
  buildPowerLine(x0: number, y0: number, x1: number, y1: number): ToolResult {
    this.settle();
    const s = this.state;
    const plan = this.planPowerLine(x0, y0, x1, y1);
    if (plan.message) return { ok: false, cost: 0, message: plan.message };
    for (const i of plan.tiles) s.power[i] = 1;
    s.funds -= plan.cost;
    this.networkDirty = true;
    return { ok: plan.tiles.length > 0, cost: plan.cost };
  }

  private planPowerLine(x0: number, y0: number, x1: number, y1: number): LinePlan {
    this.settle();
    const s = this.state;
    const tiles: number[] = [];
    for (const [x, y] of linePath(x0, y0, x1, y1)) {
      if (!inBounds(s, x, y)) continue;
      const i = idx(s, x, y);
      if (s.occupant[i] !== 0) return { tiles, cost: 0, message: 'path is blocked by a building' };
      // Zones already conduct power; no line needed there.
      if (s.power[i] || s.zone[i]) continue;
      tiles.push(i);
    }
    return this.priced(tiles, tiles.length * this.cfg.services.powerLineCost.build);
  }

  /** Underground water pipes along an L-shaped path; they run under anything on land and stop at the water's edge. */
  buildPipe(x0: number, y0: number, x1: number, y1: number): ToolResult {
    this.settle();
    const s = this.state;
    const plan = this.planPipe(x0, y0, x1, y1);
    if (plan.message) return { ok: false, cost: 0, message: plan.message };
    for (const i of plan.tiles) s.pipe[i] = 1;
    s.funds -= plan.cost;
    this.networkDirty = true;
    return { ok: plan.tiles.length > 0, cost: plan.cost };
  }

  private planPipe(x0: number, y0: number, x1: number, y1: number): LinePlan {
    this.settle();
    const s = this.state;
    const tiles: number[] = [];
    let onLand = false;
    for (const [x, y] of linePath(x0, y0, x1, y1)) {
      if (!inBounds(s, x, y)) continue;
      const i = idx(s, x, y);
      // Pipes stop at the shore: the line is laid up to the water (refused only when it starts there).
      if (s.terrain[i] === Terrain.Water) {
        if (!onLand) return { tiles, cost: 0, message: 'pipes cannot cross open water' };
        break;
      }
      onLand = true;
      if (!s.pipe[i]) tiles.push(i);
    }
    return this.priced(tiles, tiles.length * this.cfg.services.pipeCost.build);
  }

  /** Removes pipes in a rectangle (the surface bulldozer leaves them alone). */
  bulldozePipes(x0: number, y0: number, x1: number, y1: number): ToolResult {
    this.settle();
    const s = this.state;
    const tiles: number[] = [];
    for (const [x, y] of this.rect(x0, y0, x1, y1)) if (s.pipe[idx(s, x, y)]) tiles.push(idx(s, x, y));
    const cost = tiles.length * this.cfg.services.pipeCost.bulldoze;
    if (cost > s.funds) return { ok: false, cost: 0, message: 'not enough funds' };
    for (const i of tiles) s.pipe[i] = 0;
    s.funds -= cost;
    this.networkDirty = true;
    return { ok: tiles.length > 0, cost };
  }

  /** Subway track along an L-shaped path; it runs under anything, water included. */
  buildSubway(x0: number, y0: number, x1: number, y1: number): ToolResult {
    this.settle();
    const s = this.state;
    const plan = this.planSubway(x0, y0, x1, y1);
    if (plan.message) return { ok: false, cost: 0, message: plan.message };
    for (const i of plan.tiles) s.subway[i] = 1;
    s.funds -= plan.cost;
    this.networkDirty = true;
    return { ok: plan.tiles.length > 0, cost: plan.cost };
  }

  private planSubway(x0: number, y0: number, x1: number, y1: number): LinePlan {
    this.settle();
    const s = this.state;
    const tiles: number[] = [];
    for (const [x, y] of linePath(x0, y0, x1, y1)) {
      if (!inBounds(s, x, y)) continue;
      const i = idx(s, x, y);
      if (!s.subway[i]) tiles.push(i);
    }
    return this.priced(tiles, tiles.length * this.cfg.economy.networkCost.subway.build);
  }

  /**
   * Elevated rail or monorail along an L-shaped path (Rush Hour). It runs
   * over roads, rail, water and open land, but not over buildings or zones.
   */
  buildElevated(x0: number, y0: number, x1: number, y1: number, kind: 'elrail' | 'monorail' | 'highway'): ToolResult {
    this.settle();
    const s = this.state;
    const plan = this.planElevated(x0, y0, x1, y1, kind);
    if (plan.message) return { ok: false, cost: 0, message: plan.message };
    const code = kind === 'elrail' ? ELEVATED.rail : kind === 'monorail' ? ELEVATED.monorail : ELEVATED.highway;
    let cost = plan.cost;
    for (const i of plan.tiles) s.elevated[i] = code;
    if (code === ELEVATED.highway) cost += this.inlineRamps(linePath(x0, y0, x1, y1), new Set(plan.tiles), s.funds - cost);
    s.funds -= cost;
    this.networkDirty = true;
    return { ok: plan.tiles.length > 0, cost };
  }

  private planElevated(x0: number, y0: number, x1: number, y1: number, kind: 'elrail' | 'monorail' | 'highway'): LinePlan {
    this.settle();
    const s = this.state;
    if (!LINE_KINDS.includes(kind)) return { tiles: [], cost: 0, message: `unknown line ${kind}` };
    const code = kind === 'elrail' ? ELEVATED.rail : kind === 'monorail' ? ELEVATED.monorail : ELEVATED.highway;
    const tiles: number[] = [];
    let cost = 0;
    const unit = this.cfg.economy.networkCost[kind === 'highway' ? 'elevatedHighway' : kind].build;
    for (const [x, y] of linePath(x0, y0, x1, y1)) {
      if (!inBounds(s, x, y)) continue;
      const i = idx(s, x, y);
      if (s.elevated[i] === code) continue;
      if (s.elevated[i]) return { tiles, cost: 0, message: 'path crosses other elevated track' };
      // An elevated highway over a road's deck across a Ground Highway: both on the upper level (it was cut there).
      if (code === ELEVATED.highway && overNet(s, i)) return { tiles, cost: 0, message: 'path crosses other elevated track' };
      if (s.occupant[i] !== 0 || s.zone[i] !== 0) return { tiles, cost: 0, message: 'path is blocked by a building or zone' };
      tiles.push(i);
      cost += s.terrain[i] === Terrain.Water ? unit * this.cfg.economy.bridgeCostMult : unit;
    }
    return this.priced(tiles, cost);
  }

  /** A plan's cost, refused when the city can't pay it. */
  private priced(tiles: number[], cost: number): LinePlan {
    return cost > this.state.funds ? { tiles, cost, message: 'not enough funds' } : { tiles, cost };
  }

  /**
   * What dragging a line tool would build and cost, without building: power
   * lines, pipes, subway or elevated track (with any ramps an elevated
   * highway adds). Tiles already built are left out.
   */
  previewLine(kind: 'powerline' | 'pipe' | 'subway' | 'elrail' | 'monorail' | 'highway', x0: number, y0: number, x1: number, y1: number): {
    ok: boolean; cost: number; tiles: number; message?: string;
  } {
    const plan = kind === 'powerline' ? this.planPowerLine(x0, y0, x1, y1)
      : kind === 'pipe' ? this.planPipe(x0, y0, x1, y1)
      : kind === 'subway' ? this.planSubway(x0, y0, x1, y1)
      : this.planElevated(x0, y0, x1, y1, kind);
    let ramps = 0;
    if (kind === 'highway' && !plan.message) {
      const built = new Set(plan.tiles);
      ramps = this.rampJoints(linePath(x0, y0, x1, y1), built, this.state.funds - plan.cost, (i) => this.state.net[i]!,
        (i) => (built.has(i) ? ELEVATED.highway : this.state.elevated[i]!)).cost;
    }
    return { ok: !plan.message && plan.tiles.length > 0, cost: plan.cost + ramps, tiles: plan.tiles.length, ...(plan.message ? { message: plan.message } : {}) };
  }

  /**
   * Rush Hour: an Avenue meeting a highway head-on joins it through an
   * in-line onramp drawn on the Avenue's end tile (§200 for a Ground
   * Highway, §600 for an Elevated one, cheaper than a full onramp). Looks at
   * both ends of a just-built path; only ends this drag built count. Returns
   * what the ramps cost (none if `budget` doesn't cover one).
   */
  private inlineRamps(path: [number, number][], built: ReadonlySet<number>, budget: number): number {
    const { joints, cost } = this.rampJoints(path, built, budget, (i) => this.state.net[i]!, (i) => this.state.elevated[i]!);
    for (const j of joints) this.state.net[j] = Net.Onramp;
    return cost;
  }

  /**
   * Where {@link inlineRamps} would put its ramps and what they cost, given the
   * map as it is (or will be) after the drag: `net` and `elevated` read a tile.
   * Shared with the previews, so the price shown while dragging includes them.
   */
  private rampJoints(
    path: [number, number][], built: ReadonlySet<number>, budget: number, net: (i: number) => number, elevated: (i: number) => number,
  ): { joints: number[]; cost: number } {
    const s = this.state;
    const joints: number[] = [];
    if (path.length < 2) return { joints, cost: 0 };
    let cost = 0;
    for (const [[ex, ey], [px, py]] of [[path[0]!, path[1]!], [path[path.length - 1]!, path[path.length - 2]!]] as const) {
      const qx = 2 * ex - px;
      const qy = 2 * ey - py;
      if (!inBounds(s, ex, ey) || !inBounds(s, qx, qy)) continue;
      const e = idx(s, ex, ey);
      const q = idx(s, qx, qy);
      if (!built.has(e)) continue;
      const highway = (i: number) => (net(i) === Net.Highway ? 'ground' : elevated(i) === ELEVATED.highway ? 'elevated' : null);
      let joint = -1;
      let kind: 'ground' | 'elevated' | null = null;
      if (net(e) === Net.Avenue && (kind = highway(q))) joint = e;
      else if (net(q) === Net.Avenue && (kind = highway(e))) joint = q;
      if (joint < 0 || !kind || joints.includes(joint)) continue;
      const price = kind === 'ground' ? this.cfg.economy.avenueRampCost : this.cfg.economy.elevatedAvenueRampCost;
      if (budget - cost < price) continue;
      joints.push(joint);
      cost += price;
    }
    return { joints, cost };
  }

  /** Puts a toll booth on a road, avenue or highway tile (Rush Hour). */
  placeToll(x: number, y: number): ToolResult {
    this.settle();
    const s = this.state;
    if (!inBounds(s, x, y)) return { ok: false, cost: 0, message: 'out of bounds' };
    const i = idx(s, x, y);
    const code = s.net[i]!;
    // On the ground road, avenue or highway; else on an elevated highway overhead (Rush Hour).
    const level = code === Net.Road || code === Net.Avenue || code === Net.Highway ? 1 : s.elevated[i] === ELEVATED.highway ? 2 : 0;
    if (!level) return { ok: false, cost: 0, message: 'toll booths go on roads, avenues or highways' };
    if (s.tolls[i]) return { ok: false, cost: 0, message: 'already a toll booth' };
    // The booth needs two straight tiles without junctions on each side.
    const n = s.size;
    const on = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < n && yy < n
      && (level === 2 ? s.elevated[yy * n + xx] === ELEVATED.highway : s.net[yy * n + xx] === code);
    const side = (fx: number, fy: number, xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < n && yy < n
      && (level === 2 ? s.elevated[yy * n + xx] === ELEVATED.highway : tilesLinked(s, fy * n + fx, yy * n + xx));
    const straight = (dx: number, dy: number) => [-2, -1, 0, 1, 2].every((d) => {
      const tx = x + dx * d;
      const ty = y + dy * d;
      return on(tx, ty) && !side(tx, ty, tx + dy, ty + dx) && !side(tx, ty, tx - dy, ty - dx);
    });
    if (!straight(1, 0) && !straight(0, 1)) return { ok: false, cost: 0, message: 'a toll booth needs two straight tiles without junctions on each side' };
    const cost = this.cfg.transport.toll.cost;
    if (cost > s.funds) return { ok: false, cost: 0, message: 'not enough funds' };
    s.tolls[i] = level;
    s.funds -= cost;
    this.networkDirty = true;
    return { ok: true, cost };
  }

  /** Removes subway track in a rectangle (the surface bulldozer leaves it alone). */
  bulldozeSubway(x0: number, y0: number, x1: number, y1: number): ToolResult {
    this.settle();
    const s = this.state;
    const tiles: number[] = [];
    for (const [x, y] of this.rect(x0, y0, x1, y1)) if (s.subway[idx(s, x, y)]) tiles.push(idx(s, x, y));
    const cost = tiles.length * this.cfg.economy.networkCost.subway.bulldoze;
    if (cost > s.funds) return { ok: false, cost: 0, message: 'not enough funds' };
    for (const i of tiles) s.subway[i] = 0;
    const gone = new Set(tiles);
    s.transitions = s.transitions.filter((i) => !gone.has(i));
    s.funds -= cost;
    this.networkDirty = true;
    return { ok: tiles.length > 0, cost };
  }

  /**
   * Subway-to-Elevated Transition (Rush Hour): on a subway tile next to
   * elevated rail, it lets trains run between the two.
   */
  placeSubwayTransition(x: number, y: number): ToolResult {
    this.settle();
    const s = this.state;
    if (!inBounds(s, x, y)) return { ok: false, cost: 0, message: 'out of bounds' };
    const i = idx(s, x, y);
    if (!s.subway[i]) return { ok: false, cost: 0, message: 'transitions go on subway track' };
    if (s.transitions.includes(i)) return { ok: false, cost: 0, message: 'already a transition' };
    const n = s.size;
    const near = [i - 1, i + 1, i - n, i + n].some((j) => j >= 0 && j < n * n && Math.abs((j % n) - x) <= 1 && s.elevated[j] === ELEVATED.rail);
    if (!near && s.elevated[i] !== ELEVATED.rail) return { ok: false, cost: 0, message: 'a transition needs elevated rail beside it' };
    const cost = this.cfg.transport.subwayTransition.cost;
    if (cost > s.funds) return { ok: false, cost: 0, message: 'not enough funds' };
    s.transitions.push(i);
    s.funds -= cost;
    this.networkDirty = true;
    return { ok: true, cost };
  }

  /**
   * Road maintenance, mass transit, power line, water pipe or sanitation funding in
   * percent (0–120); city beautification and landmarks 0–100 (can't overfund).
   */
  setDepartmentFunding(dept: 'roads' | 'transit' | 'power' | 'water' | 'parks' | 'sanitation' | 'landmarks' | 'corrections', percent: number): void {
    this.settle();
    if (!Number.isFinite(percent) || !Object.hasOwn(this.state.departments, dept)) return;
    const level = Math.max(0, Math.min(dept === 'parks' || dept === 'landmarks' ? 100 : 120, Math.round(percent)));
    if (this.state.departments[dept] === level) return;
    this.state.departments[dept] = level;
    if (dept === 'roads' || dept === 'transit') this.networkDirty = true;
    else this.effectsDirty = true;
  }

  /** Sets a civic building's funding level in percent (plants 0–120, services 0–150). */
  setFunding(structureId: number, percent: number): boolean {
    this.settle();
    const st = this.state.structures.get(structureId);
    if (!st || !Number.isFinite(percent)) return false;
    const def = this.cfg.structures[st.kind];
    if (def.category === 'landmark' || isJail(def)) return false; // funded together (setDepartmentFunding('landmarks' / 'corrections'))
    const max = def.plant || def.police || def.fire || def.incinerator || def.recycling || def.airport || def.seaport ? 120 : def.health || def.school ? 150 : 100;
    const level = Math.max(0, Math.min(max, Math.round(percent)));
    if (st.funding === level) return true;
    st.funding = level;
    if (this.coverageOnlyFacility(def) && def.com[0] <= 0 && def.res[0] <= 0 && (def.mayor?.[0] ?? 0) <= 0 && (def.pollution?.[0] ?? 0) >= 0) {
      this.coverageDirty = true;
      this.revision++;
    } else this.effectsDirty = true;
    return true;
  }

  /** Local bus/ambulance funding of a school or hospital, 0–200% (scales its radius). */
  setVehicleFunding(structureId: number, percent: number): boolean {
    this.settle();
    const st = this.state.structures.get(structureId);
    if (!st || !Number.isFinite(percent)) return false;
    const def = this.cfg.structures[st.kind];
    const svc = def.health ?? def.school;
    if (!svc?.vehicles) return false;
    const level = Math.max(0, Math.min(200, Math.round(percent)));
    if ((st.vehicleFunding ?? 100) === level) return true;
    st.vehicleFunding = level;
    if (this.coverageOnlyFacility(def)) {
      this.coverageDirty = true;
      this.revision++;
    } else this.effectsDirty = true;
    return true;
  }

  private coverageOnlyFacility(def: StructureDef): boolean {
    return (def.category === 'health' || def.category === 'education') && !def.plant && !def.pump && !def.incinerator
      && !def.recycling && !def.treatment && !def.station && !def.airport && !def.seaport && !def.police && !def.fire;
  }

  /** This month's values for the city's graphs. */
  private *graphPointSteps(st: CityStats): Generator<void, Partial<HistoryPoint>> {
    const s = this.state;
    const sv = this.cfg.services;
    let people = 0;
    let commuters = 0;
    let commute = 0;
    let eq = 0;
    let hq = 0;
    let life = 0;
    let piece = 0;
    for (const b of s.buildings.values()) {
      if ((++piece & 0x1ff) === 0) yield;
      if (!b.type || b.type[0] !== 'R') continue;
      const r = b.capacity * b.occupancy;
      people += r;
      eq += b.eq * r;
      hq += b.hq * r;
      life += (sv.startAge + interp(sv.lifeExpectancyByHq, b.hq)) * r;
      if (b.commute >= 0) {
        commuters += r;
        commute += b.commute * r;
      }
    }
    let land = 0;
    let air = 0;
    let water = 0;
    for (let i = 0; i < s.terrain.length; i++) {
      if ((i & 0x1fff) === 0x1fff) yield;
      if (s.terrain[i] === Terrain.Water) continue;
      land++;
      air += Math.max(0, this.fields.air[i]!);
      water += Math.max(0, this.fields.waterPollution[i]!);
    }
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      arrests: st.safety.arrests,
      // (To the hundredth of an hour: to the tenth, a commute steady near 1.15 h read 1시간 06분 one month and 1시간 12분
      // the next, a change of 6 minutes that was only rounding.)
      commute: commuters ? Math.round(commute / commuters) / 100 : 0,
      powerSupply: Math.round(st.power.supply), powerDemand: Math.round(st.power.demand),
      waterSupply: Math.round(st.water.supply), waterDemand: Math.round(st.water.demand),
      garbageCapacity: Math.round(st.garbage.capacity), garbageProduced: Math.round(st.garbage.produced),
      garbageUncollected: Math.round(st.garbage.uncollected),
      fires: st.safety.fires, burned: st.safety.burned,
      air: land ? r1(air / land) : 0, waterPollution: land ? r1(water / land) : 0,
      eq: people ? r1(eq / people) : 0, hq: people ? r1(hq / people) : 0, lifeExpectancy: people ? r1(life / people) : 0,
      income: Math.round(s.lastBudget?.income ?? 0), expenses: Math.round(s.lastBudget?.expenses ?? 0),
      abandoned: [...s.buildings.values()].filter((b) => !b.type).length,
    };
  }

  private *recordHistorySteps(): Generator<void, void> {
    const s = this.state;
    const st = this.stats();
    const point = yield* this.graphPointSteps(st);
    s.history.push({
      month: Math.floor(s.day / DAYS_PER_MONTH), population: st.population, jobs: st.jobs,
      funds: Math.round(s.funds), mayorRating: st.mayorRating, crimes: st.safety.crimes,
      trips: Object.fromEntries(Object.entries(this.volume).map(([k, v]) => [k, Math.round(v! * 10) / 10])),
      ...point,
    });
    if (s.history.length > HISTORY_MONTHS) s.history.splice(0, s.history.length - HISTORY_MONTHS);
  }

  /** Monthly payment for a loan (amortized over 10 years at 8.5%, rounded down). */
  loanPayment(amount: number): number {
    const l = this.cfg.economy.loans;
    const r = l.rate / 12;
    if (r === 0) return Math.floor(amount / l.months);
    return Math.floor((amount * r) / -Math.expm1(-l.months * Math.log1p(r)));
  }

  /** Borrows money (within the loan limits). */
  takeLoan(amount: number): ToolResult {
    this.settle();
    const s = this.state;
    const l = this.cfg.economy.loans;
    if (s.impeached) return { ok: false, cost: 0, message: 'the mayor has been impeached' };
    const a = Math.round(amount / l.step) * l.step;
    const owed = s.loans.reduce((sum, x) => sum + this.loanBalance(x), 0);
    if (!Number.isFinite(a) || a <= 0 || a > l.max) return { ok: false, cost: 0, message: `loans are §${l.step}–§${l.max}` };
    if (s.loans.length >= l.count) return { ok: false, cost: 0, message: `at most ${l.count} loans` };
    if (owed + a > l.totalMax) return { ok: false, cost: 0, message: 'too much debt outstanding' };
    s.loans.push({ amount: a, payment: this.loanPayment(a), monthsLeft: l.months });
    s.funds += a;
    return { ok: true, cost: -a };
  }

  /** Principal still owed on a loan. */
  loanBalance(loan: { amount: number; monthsLeft: number }): number {
    return loanPrincipal(this.cfg, loan);
  }

  /** Pays a loan off early (our own addition; the balance is the remaining principal). */
  repayLoan(index: number): ToolResult {
    this.settle();
    const s = this.state;
    if (!Number.isInteger(index) || index < 0 || index >= s.loans.length) return { ok: false, cost: 0, message: 'no such loan' };
    const loan = s.loans[index]!;
    const due = this.loanBalance(loan);
    if (due > s.funds) return { ok: false, cost: 0, message: 'not enough funds' };
    s.funds -= due;
    s.loans.splice(index, 1);
    return { ok: true, cost: due };
  }

  /** Can this ordinance be enacted now (some need a building or a road-served landfill first)? */
  ordinanceAvailable(id: OrdinanceId): boolean {
    if (!own(ORDINANCES, id)) return false;
    if (id === 'landfillGas') this.refreshIfDirty();
    return ordinanceAvailable(this.state, this.cfg, id, id === 'landfillGas' && hasOperatingLandfill(this.state, this.fields, this.cfg));
  }

  /** Monthly cost of an ordinance at the current population (negative = income). */
  ordinanceCost(id: OrdinanceId): number {
    if (!own(ORDINANCES, id)) return 0;
    const c = this.census;
    return ordinanceCostOf(this.state, this.cfg, id, c.residents[0] + c.residents[1] + c.residents[2]);
  }

  /** Enacts an ordinance if its prerequisite is met; its monthly cost or income is billed by the days it is in effect. */
  enactOrdinance(id: OrdinanceId): ToolResult {
    this.settle();
    const s = this.state;
    if (!own(ORDINANCES, id)) return { ok: false, cost: 0, message: `unknown ordinance ${id}` };
    if (s.ordinances.includes(id)) return { ok: false, cost: 0, message: 'already in effect' };
    if (!this.ordinanceAvailable(id)) return { ok: false, cost: 0, message: 'not available yet' };
    s.ordinances.push(id);
    // Nuclear Free Zone decommissions existing nuclear plants.
    if (id === 'nuclearFreeZone') {
      for (const st of [...s.structures.values()]) {
        if (st.kind !== 'nuclearPlant') continue;
        for (const i of footprint(s, st)) s.occupant[i] = 0;
        s.structures.delete(st.id);
      }
    }
    this.networkDirty = true;
    this.updateDemand();
    return { ok: true, cost: 0 };
  }

  /** Repeals an ordinance (repealing Legalized Gambling removes the Casino). */
  repealOrdinance(id: OrdinanceId): ToolResult {
    this.settle();
    const s = this.state;
    if (!s.ordinances.includes(id)) return { ok: false, cost: 0, message: 'not in effect' };
    s.ordinances = s.ordinances.filter((o) => o !== id);
    // Repealing Legalize Gambling closes the casinos.
    for (const st of [...s.structures.values()]) {
      if (this.cfg.structures[st.kind].offer?.ordinance !== id) continue;
      for (const i of footprint(s, st)) s.occupant[i] = 0;
      s.structures.delete(st.id);
    }
    this.networkDirty = true;
    this.updateDemand();
    return { ok: true, cost: 0 };
  }

  /**
   * Sends the closest free fire or police unit to (x, y). Fire trucks need a
   * road within eight tiles; planes and helicopters (Rush Hour) fly anywhere.
   */
  dispatch(kind: DispatchKind, x: number, y: number): ToolResult {
    this.settle();
    const s = this.state;
    if (!DISPATCH_KINDS.includes(kind)) return { ok: false, cost: 0, message: `unknown unit ${kind}` };
    if (!inBounds(s, x, y)) return { ok: false, cost: 0, message: 'out of bounds' };
    const res = dispatchUnit(s, this.cfg, kind, x, y);
    if (typeof res === 'string') return { ok: false, cost: 0, message: res };
    this.effectsDirty = true;
    return { ok: true, cost: 0 };
  }

  /** How many fire or police units are free to send right now; `fit`: only the crews automatic dispatch would send (an underfunded one fumbles). */
  freeUnits(kind: DispatchKind, fit = false): number {
    return DISPATCH_KINDS.includes(kind) ? freeUnits(this.state, this.cfg, kind, fit ? FIT_CREW : 0) : 0;
  }

  /** Mayor's Limo: throws §50 at the crowd for a short local Mayor Rating boost (needs the Mayor's House). */
  throwMoney(x: number, y: number): ToolResult {
    this.settle();
    const s = this.state;
    const t = this.cfg.mayor.throwMoney;
    if (![...s.structures.values()].some((st) => st.kind === 'mayorsHouse')) return { ok: false, cost: 0, message: "needs the Mayor's House" };
    if (!inBounds(s, x, y)) return { ok: false, cost: 0, message: 'out of bounds' };
    if (t.cost > s.funds) return { ok: false, cost: 0, message: 'not enough funds' };
    s.funds -= t.cost;
    s.events.push({ x, y, radius: t.radius, amount: t.amount, months: t.months, age: 0 });
    this.effectsDirty = true;
    return { ok: true, cost: t.cost };
  }

  /** Mayor Rating effect of recent residential tax changes for a wealth level (0–2), as homes feel it. */
  taxMoodOf(wealth: 0 | 1 | 2): number {
    return taxMoodFor(this.state, this.cfg, wealth);
  }

  /** Mayor Rating factors for the residential building at (x, y), if any. */
  mayorAt(x: number, y: number): MayorFactors | null {
    const s = this.state;
    if (!inBounds(s, x, y)) return null;
    this.refreshIfDirty();
    const occ = s.occupant[idx(s, x, y)]!;
    const b = occ > 0 ? s.buildings.get(occ) : undefined;
    if (!b?.type || b.type[0] !== 'R') return null;
    const w = this.cfg.demand.wealthOf[b.type];
    const i = Math.floor(b.y + b.h / 2) * s.size + Math.floor(b.x + b.w / 2);
    return mayorAt(s, this.fields, this.cfg, i, w, b.age, taxMoodFor(s, this.cfg, w), ordinanceEffects(s).mayorRating);
  }

  /** Reward buildings need their unlock condition met once; others are always available. */
  isUnlocked(kind: StructureKind): boolean {
    if (!own(this.cfg.structures, kind)) return false;
    const def = this.cfg.structures[kind];
    return !(def.unlock || def.unlockTiers || def.offer) || this.state.unlocked.includes(kind);
  }

  private unlockContext(): UnlockContext {
    const s = this.state;
    let hospitals = 0;
    for (const st of s.structures.values()) if (healthClassOf(this.cfg.structures[st.kind]) === 'hospital') hospitals++;
    // The city's energy demand for unlocks includes power sold to neighbours.
    let sold = 0;
    for (const d of s.neighbourDeals) if (d.resource === 'power' && d.direction === 'sell' && d.status !== 'grace') sold += d.amount;
    // The air the city's residents breathe (factories' own lots aside), by head.
    let air = 0;
    let lots = 0;
    for (const b of s.buildings.values()) {
      if (!b.type || b.type[0] !== 'R') continue;
      const people = b.capacity * b.occupancy;
      air += this.fields.air[b.y * s.size + b.x]! * people;
      lots += people;
    }
    return {
      s, cfg: this.cfg, census: this.census, powerDemand: this.powerDemand() * ordinanceEffects(s).power + sold, waterDemand: this.waterDemand() * ordinanceEffects(s).water, hospitals,
      meanAir: lots ? air / lots : 0,
      connections: Object.values(edgeConnections(s)).slice(0, 4).reduce((a, e) => a + e.reduce((x, y) => x + y, 0), 0),
    };
  }

  private checkUnlocks(): void {
    this.newlyUnlocked.push(...checkUnlocks(this.unlockContext()));
  }

  /**
   * Rewards not yet earned (the next tier for those earned in tiers) and
   * where the city stands on each of their conditions. Business deals are
   * offered rather than earned, so they are not listed.
   */
  rewardProgress(): { kind: StructureKind; description: string; checks: UnlockCheck[] }[] {
    const ctx = this.unlockContext();
    const out: { kind: StructureKind; description: string; checks: UnlockCheck[] }[] = [];
    for (const kind of Object.keys(this.cfg.structures) as StructureKind[]) {
      const def = this.cfg.structures[kind];
      const earned = this.state.unlocked.filter((k) => k === kind).length;
      const u = def.unlockTiers ? def.unlockTiers[earned] : earned ? undefined : def.unlock;
      if (!u) continue;
      out.push({ kind, description: u.description, checks: unlockChecks(ctx, u) });
    }
    return out;
  }

  /** Rewards and deals earned since the last call (for announcements). */
  takeNewUnlocks(): StructureKind[] {
    return this.newlyUnlocked.splice(0);
  }

  /** Copies of a structure the city may still place (Infinity when unlimited). */
  placementsLeft(kind: StructureKind): number {
    const s = this.state;
    if (!own(this.cfg.structures, kind)) return 0;
    const def = this.cfg.structures[kind];
    const max = def.unlockTiers ? s.unlocked.filter((k) => k === kind).length : def.limit ?? Infinity;
    let have = 0;
    for (const st of s.structures.values()) if (st.kind === kind) have++;
    return Math.max(0, max - have);
  }

  /** Sets the tax rate (0–20%) for one of the twelve developer types (Rush Hour). */
  setTaxRate(type: DevType, rate: number): void {
    this.settle();
    const s = this.state;
    if (!Number.isFinite(rate) || !Object.hasOwn(s.taxRates, type)) return;
    const r = Math.max(0, Math.min(20, Math.round(rate * 10) / 10));
    if (r === s.taxRates[type]) return;
    s.taxLog.push([s.day, type, s.taxRates[type]]);
    s.taxRates[type] = r;
    this.updateDemand();
  }

  /**
   * Desirability of a type on every tile, zoned or not (for overlays). The
   * simulation only keeps it for tiles zoned for that type.
   */
  desirabilityMap(t: DevType): Float32Array {
    let map = this.fullDesirability.get(t);
    if (!map) {
      map = new Float32Array(this.state.size * this.state.size);
      computeDesirabilityEverywhere(this.state, this.fields, this.cfg, t, map);
      this.fullDesirability.set(t, map);
    }
    return map;
  }

  /** Nesting depth of `batch` calls; placing a facility refreshes only outside one. */
  private batching = 0;

  /**
   * Runs a series of edits with one refresh at the end instead of one per
   * facility placed (building a town from a script, say). Returns `fn`'s result.
   */
  batch<T>(fn: () => T): T {
    this.settle();
    this.batching++;
    try {
      return fn();
    } finally {
      if (--this.batching === 0) this.refreshIfDirty();
    }
  }

  /**
   * The random generator's state as of now (what a save stores). Tools such as
   * disaster() draw from it between days, after the state's copy was taken.
   */
  rngNow(): number {
    this.state.rngState = this.rng.state;
    return this.rng.state;
  }

  /**
   * What a department's budget pays a month at `level` percent (its own level by default), all else as it stands: the
   * part of the month's spending its slider moves (garbage pickup, paid by the ton, left out).
   */
  departmentUpkeep(dept: keyof CityState['departments'], level = this.state.departments[dept]): number {
    return departmentUpkeep(this.state, this.cfg, dept, level);
  }

  /** A facility's monthly cost as the budget charges it (running, vehicles, a jail's overcrowding), or null. */
  structureUpkeep(id: number): { running: number; vehicles: number; overcapacity: number; total: number } | null {
    const st = this.state.structures.get(id);
    return st ? structureUpkeep(this.state, this.cfg, st) : null;
  }

  /** A utility facility's remaining life, ageing rate, output and overhaul price at current utilisation and funding; null for facilities without a finite service life. */
  assetOutlook(id: number): AssetOutlook | null {
    this.refreshIfDirty();
    const st = this.state.structures.get(id);
    return st ? assetOutlook(this.state, this.cfg, st) : null;
  }

  /** Capital maintenance needs and power/water resilience per connected network, including loss of its largest single supply source. Empty pipe stubs are omitted; current load and funding are held constant. */
  infrastructureReport(): InfrastructureReport {
    this.refreshIfDirty();
    return infrastructureReport(this.state, this.cfg, this.fields, this.power, this.water);
  }

  /** Capacity lost while one utility is overhauled, with the affected network's current consumers and any working pumps exposed to a power shortfall. Holds demand, contracts and consumer assignments constant; does not predict blackout order, pollution feedback or alternative pipe coverage. Null for non-utility facilities. */
  maintenanceImpact(id: number): MaintenanceImpact | null {
    this.refreshIfDirty();
    const st = this.state.structures.get(id);
    return st ? maintenanceImpact(this.state, this.cfg, this.fields, this.power, this.water, st) : null;
  }

  /** Collection and disposal if the monthly tally ran under today's population, roads, funding, equipment and piles. Includes current contracts and overhaul availability; future growth and completion of work are not advanced. Does not change garbage, landfill contents, facility loads or random state. */
  previewGarbage(): CityState['garbageStats'] {
    this.refreshIfDirty();
    const state = { ...this.state, garbage: this.state.garbage.slice(), landfill: this.state.landfill.slice(),
      structures: new Map([...this.state.structures].map(([id, st]) => [id, { ...st }])) };
    const residents = this.census.residents[0] + this.census.residents[1] + this.census.residents[2];
    return runGarbage(state, this.fields, this.cfg, new Rng(this.rng.state), residents);
  }

  /** Sets power dispatch within each grid: balanced shares the load, economical uses the lowest generation cost first, clean the lowest air/water emission burden. Imports and waste energy are used first. */
  setPowerDispatch(strategy: PowerDispatch): ToolResult {
    this.settle();
    if (!POWER_DISPATCHES.includes(strategy)) return { ok: false, cost: 0, message: 'unknown power dispatch strategy' };
    if (this.state.powerDispatch !== strategy) {
      this.state.powerDispatch = strategy;
      this.effectsDirty = true;
      if (!this.batching) this.refreshIfDirty();
    }
    return { ok: true, cost: 0 };
  }

  /** Generation, plant operating costs and source emissions for today's grid demand. With a strategy, compares it without changing the city or advancing time; future growth, wear and pollution feedback are left out. */
  energyReport(strategy: PowerDispatch = this.state.powerDispatch ?? 'balanced'): EnergyReport | null {
    this.refreshIfDirty();
    return POWER_DISPATCHES.includes(strategy) ? energyReport(this.state, this.cfg, this.fields, this.power, strategy) : null;
  }

  /** Overhauls an ageing utility on its existing site, retaining its id, name and connections. Restores machinery to 20% life used with seven days of suspended output by default; `preview` only prices it. */
  refurbishStructure(id: number, preview = false): ToolResult & { lifeBefore?: number; lifeAfter?: number; offlineUntilDay?: number } {
    this.refreshIfDirty();
    const s = this.state;
    const st = s.structures.get(id);
    if (!st) return { ok: false, cost: 0, message: 'no such structure' };
    const outlook = assetOutlook(s, this.cfg, st);
    if (!outlook) return { ok: false, cost: 0, message: 'this structure has no ageing machinery' };
    if (st.offlineUntilDay !== undefined) return { ok: false, cost: 0, message: 'this facility is already being overhauled' };
    if (!outlook.refurbishment.eligible) return { ok: false, cost: 0, message: 'the machinery does not need an overhaul yet' };
    if (s.fires.some((fire) => fire.target === -id)) return { ok: false, cost: 0, message: 'put out the fire before an overhaul' };
    const { cost, lifeAfter, downtimeDays } = outlook.refurbishment;
    if (cost > s.funds) return { ok: false, cost, message: 'not enough funds' };
    const offlineUntilDay = s.day + downtimeDays;
    if (!Number.isSafeInteger(offlineUntilDay)) return { ok: false, cost: 0, message: 'the city clock cannot schedule an overhaul' };
    const result = { ok: true, cost, lifeBefore: st.life, lifeAfter, ...(downtimeDays > 0 ? { offlineUntilDay } : {}) };
    if (!preview) {
      s.funds -= cost;
      st.life = lifeAfter;
      if (downtimeDays > 0) {
        st.offlineUntilDay = offlineUntilDay;
        this.nextOverhaulDay = Math.min(this.nextOverhaulDay, offlineUntilDay);
      }
      this.effectsDirty = true;
      if (!this.batching) this.refreshIfDirty();
    }
    return result;
  }

  /** Prices repair of only the damaged roads/rails or worn lines/pipes in a rectangle. Healthy tiles and other networks are left out. */
  previewRepairNetworks(dept: RepairDepartment, x0: number, y0: number, x1: number, y1: number): RepairPreview {
    const plan = this.planNetworkRepairs(dept, x0, y0, x1, y1);
    return { ok: !plan.message && plan.tiles.length > 0, cost: plan.cost, tiles: plan.tiles.length, ...(plan.message ? { message: plan.message } : {}) };
  }

  /** Pays for the previewed network repairs immediately without demolishing anything or changing routes. Further deterioration still depends on department funding. */
  repairNetworks(dept: RepairDepartment, x0: number, y0: number, x1: number, y1: number): RepairPreview {
    const plan = this.planNetworkRepairs(dept, x0, y0, x1, y1);
    if (plan.message || !plan.tiles.length) return { ok: false, cost: plan.cost, tiles: plan.tiles.length, ...(plan.message ? { message: plan.message } : {}) };
    const s = this.state;
    const damage = dept === 'power' ? s.lineWear : dept === 'water' ? s.pipeWear : dept === 'roads' ? s.potholes : s.railDamage;
    for (const i of plan.tiles) damage[i] = 0;
    s.funds -= plan.cost;
    if (dept === 'roads') this.networkDirty = true; // potholes change travel time
    else this.effectsDirty = true;
    return { ok: true, cost: plan.cost, tiles: plan.tiles.length };
  }

  private planNetworkRepairs(dept: RepairDepartment, x0: number, y0: number, x1: number, y1: number): LinePlan {
    this.settle();
    if (!REPAIR_DEPARTMENTS.includes(dept)) return { tiles: [], cost: 0, message: 'unknown repair department' };
    if (![x0, y0, x1, y1].every(Number.isFinite)) return { tiles: [], cost: 0, message: 'invalid rectangle' };
    const tiles: number[] = [];
    let cost = 0;
    for (const [x, y] of this.rect(x0, y0, x1, y1)) {
      const i = idx(this.state, x, y);
      const price = networkRepairCost(this.state, this.cfg, dept, i);
      if (price !== null) {
        tiles.push(i);
        cost += price;
      }
    }
    return this.priced(tiles, Math.ceil(cost));
  }

  /** Recomputes fields if a tool changed the map since the last refresh. */
  refreshIfDirty(): void {
    this.settle();
    if (this.coverageDirty && !this.networkDirty && !this.effectsDirty && this.sourceFieldsDay === this.state.day) drain(this.refreshCoverageSteps());
    else if (this.networkDirty || this.effectsDirty || this.coverageDirty) this.refresh({ travel: this.networkDirty });
  }

  /** Everything about one tile: terrain, zone, networks, the building or structure on it, fields (pollution, crime, coverage, land value …), trip times and desirability by developer type with each factor. */
  query(x: number, y: number): TileInfo | null {
    const s = this.state;
    if (!inBounds(s, x, y)) return null;
    this.refreshIfDirty();
    const i = idx(s, x, y);
    const occ = s.occupant[i]!;
    const road = this.fields.access[i]!;
    const desirability = {} as Record<DevType, FactorBreakdown>;
    for (const t of DEV_TYPES) desirability[t] = factorsAt(s, this.fields, this.cfg, t, i);
    return {
      x, y,
      terrain: s.terrain[i] === Terrain.Water ? 'water' : 'land',
      network: s.net[i] === Net.RailCrossing ? 'crossing' : NETWORK_KINDS[s.net[i]!] ?? null,
      subway: s.subway[i] === 1,
      elevated: ELEVATED_KINDS[s.elevated[i]!] ?? null,
      toll: s.tolls[i] !== 0,
      interchange: s.interchange[i] === INTERCHANGE.overpass ? 'overpass' : s.interchange[i] === INTERCHANGE.cloverleaf ? 'cloverleaf' : null,
      over: overNet(s, i) ? NETWORK_KINDS[overNet(s, i)] as 'street' | 'road' | 'avenue' | 'oneway' : null,
      tunnel: s.tunnel[i] === SPAN.tunnel,
      bridge: s.tunnel[i] === SPAN.bridge,
      lowBridge: s.tunnel[i] === SPAN.lowBridge,
      subwayTransition: s.transitions.includes(i),
      name: occ ? s.names[occ] ?? null : null,
      monorailTraffic: this.fields.monorailTraffic[i]!,
      highwayTraffic: this.fields.highTraffic[i]!,
      ferryTraffic: this.fields.ferryTraffic[i]!,
      commute: this.tripTime(this.fields.commute, i),
      freight: this.tripTime(this.fields.freight, i),
      railTraffic: this.fields.railTraffic[i]!,
      subwayTraffic: this.fields.subwayTraffic[i]!,
      radiation: s.radiation[i]!,
      landform: (['none', 'crater', 'cone', 'slope', 'fault'] as const)[s.landform[i]!] ?? 'none',
      height: s.height[i]!,
      slope: this.fields.slope[i]!,
      lineWear: s.lineWear[i]!,
      pipeWear: s.pipeWear[i]!,
      railDamaged: s.railDamage[i] === 1,
      zone: ZONES[s.zone[i]!]!,
      building: occ > 0 ? s.buildings.get(occ) ?? null : null,
      structure: occ < 0 ? s.structures.get(-occ) ?? null : null,
      landValue: this.fields.landValue[i]!,
      airPollution: this.fields.air[i]!,
      waterPollution: this.fields.waterPollution[i]!,
      traffic: road >= 0 ? this.fields.traffic[road]! : 0,
      powered: this.fields.powered[i] === 1,
      powerLine: s.power[i] === 1,
      watered: this.fields.watered[i] === 1,
      pipe: s.pipe[i] === 1,
      crime: s.crime[i]!,
      policeProtection: this.fields.policeCover[i]!,
      fireProtection: this.fields.fireCover[i]!,
      flammability: this.fields.flammability[i]!,
      rubble: s.rubble[i] === 1,
      garbage: s.garbage[i]!,
      landfill: s.zone[i] === LANDFILL_ZONE ? s.landfill[i]! : null,
      burning: occ !== 0 && s.fires.some((fi) => fi.target === occ),
      healthQuality: this.fields.healthQuality[i]!,
      schoolQuality: this.fields.schoolQuality[i]!,
      desirability,
    };
  }

  // ----------------------------------------------------------- simulation

  /** Advances the simulation by `days` days. */
  step(days = 1): void {
    this.settle();
    drain(this.steps(days));
  }

  /** Days begun with `beginSteps`, paused part-way (null when none is under way). */
  private inFlight: Generator<void, void> | null = null;
  private resuming = false;

  /**
   * Begins `days` days to be run a piece at a time with `resume` (a viewer
   * runs a month's end across frames instead of freezing for it). Outcomes
   * are exactly those of `step`. Public edits and tool previews finish pending days first;
   * call `settle` before reading the state directly.
   */
  beginSteps(days = 1): void {
    this.settle();
    this.inFlight = this.steps(days);
  }

  /** Runs the days under way for one piece (a few ms of work); false once they are done. */
  resume(): boolean {
    const g = this.inFlight;
    if (!g) return false;
    this.resuming = true;
    try {
      if (g.next().done) this.inFlight = null;
    } catch (e) {
      this.inFlight = null;
      throw e;
    } finally {
      this.resuming = false;
    }
    return this.inFlight !== null;
  }

  /** Whether days begun with `beginSteps` are still under way (the city is part-way through one). */
  get stepping(): boolean {
    return this.inFlight !== null;
  }

  /** Finishes days under way: anything that reads the whole city or changes it must come after. */
  settle(): void {
    if (this.resuming) return;
    while (this.resume());
  }

  /**
   * `step` in small pieces: the generator pauses every few milliseconds of
   * work (between fields, between route searches, within the job search), so
   * a viewer can run a month's end across frames instead of freezing for
   * it. Running it to the end is exactly `step`. While it is paused the city
   * is mid-day: finish it before anything else reads or edits the city.
   */
  *steps(days = 1): Generator<void, void> {
    if (!Number.isFinite(days)) return;
    for (let d = 0; d < Math.min(days, STEP_LIMIT); d++) {
      if (this.state.impeached) return;
      yield* this.daySteps();
    }
  }

  /**
   * Rounds the maps a save stores rounded (traffic to hundredths of a trip,
   * garbage and landfill to tenths of a ton, crime to hundredths), so a
   * reloaded city carries on exactly like the original.
   */
  private *quantizeSteps(): Generator<void, void> {
    const f = this.fields;
    const s = this.state;
    for (const a of [f.traffic, f.railTraffic, f.freightRail, f.subwayTraffic, f.monorailTraffic, f.highTraffic, f.ferryTraffic]) {
      for (let i = 0; i < a.length; i++) {
        if ((i & 0x1fff) === 0x1fff) yield;
        if (a[i] !== 0) a[i] = Math.round(a[i]! * 100) / 100;
      }
    }
    for (let i = 0; i < s.garbage.length; i++) {
      if ((i & 0x1fff) === 0x1fff) yield;
      if (s.garbage[i] !== 0) s.garbage[i] = Math.round(s.garbage[i]! * 10) / 10;
      if (s.landfill[i] !== 0) s.landfill[i] = Math.round(s.landfill[i]! * 10) / 10;
      if (s.crime[i] !== 0) s.crime[i] = Math.round(s.crime[i]! * 100) / 100;
    }
  }

  private *daySteps(): Generator<void, void> {
    const s = this.state;
    const dc = this.cfg.development;
    if (s.liveDisasters.length && !this.realTimeDisasters) this.advanceDisasters(this.cfg.disasters.live.stepsPerDay);
    // Periodic refreshes fall on the 1st, 8th, 15th… of each month: the first
    // catches the fields up with last month's changes, as a city loaded from a
    // save made at the month's end would be (so the two stay identical).
    // The last periodic slot (day 28) is skipped: its fields would serve only two
    // days of growth before the month-end refresh. Those two days use the
    // previous week's fields instead (a speed trade; outcomes stay close).
    const d = s.day % DAYS_PER_MONTH;
    if (this.networkDirty || this.effectsDirty || this.coverageDirty || (d % dc.desirabilityInterval === 0 && d + dc.desirabilityInterval <= DAYS_PER_MONTH)) {
      // Routes change with the network; otherwise the month's first refresh
      // plans them and the weekly ones reuse that plan (it is the costliest part).
      yield* this.refreshSteps({ travel: this.networkDirty || s.day % DAYS_PER_MONTH === 0 });
    }

    const attempts = dc.attemptsPerDay + Math.floor((s.size * s.size) / dc.tilesPerExtraAttempt);
    // New buildings feed back into demand every few (a census per building
    // was a tenth of a big city's time); spatial fields catch up at the next
    // periodic refresh.
    let pending = 0;
    yield* warmTractsSteps(this.devContext());
    for (let a = 0; a < attempts; a++) {
      if ((a & 3) === 3) yield;
      if (developOnce(this.devContext()) && ++pending >= DEMAND_EVERY) {
        yield* this.updateDemandSteps();
        pending = 0;
        yield;
        yield* warmTractsSteps(this.devContext());
      }
    }
    if (pending) yield* this.updateDemandSteps();
    yield;
    // Burned-down buildings mark the map dirty themselves.
    const onSite = this.unitsOnSite();
    if (this.cfg.safety.autoDispatch && (s.fires.length || s.mobs.length || s.spills.length || s.arsonists.length)) {
      yield* autoDispatchSteps(s, this.cfg);
    }
    if (s.spills.length && s.units.length && neutraliseSpills(s, this.cfg, this.rng)) this.effectsDirty = true;
    if (s.mobs.length) {
      const molotovs = stepMobs(s, this.fields, this.cfg, this.rng);
      if (this.cfg.safety.fires) for (const id of molotovs) ignite(this.fireContext(), id, 2);
      this.effectsDirty ||= molotovs.length > 0;
    }
    if (s.arsonists.length) this.stepArsonists();
    if (s.fires.length) stepFires(this.fireContext());
    // Trees lost to fire reach the fields at the next weekly refresh (a full one per burned tree is costly).
    if (s.treeFires.length) stepTreeFires(this.fireContext());
    if (s.units.length) stepUnits(s);
    yield;
    // A unit that arrived or went home changes the cover at once (not at the next refresh).
    if (this.unitsOnSite() !== onSite) yield* computeSafetyFieldsSteps(s, this.fields, this.cfg);
    // Buildings burned or flattened today leave the census (a city loaded now would count without them).
    if (this.censusStale) yield* this.updateDemandSteps();
    for (const o of s.ordinances) s.ordinanceDays[o] = (s.ordinanceDays[o] ?? 0) + 1;
    s.day++;
    const overhaulsFinished = s.day >= this.nextOverhaulDay && this.finishOverhauls();
    if (s.day % DAYS_PER_MONTH === 0) {
      yield;
      yield* this.monthSteps();
      yield* this.quantizeSteps();
      yield;
      // Plants aged, buildings left and loads moved after the month's
      // refresh: catch the fields up, so the figures a save made now reports
      // (power and water capacity, loads) are those a city loaded from it has.
      yield* this.refreshSteps({ travel: false });
    } else if (overhaulsFinished) {
      yield* this.refreshSteps({ travel: false });
    }
    s.rngState = this.rng.state;
  }

  private *monthSteps(): Generator<void, void> {
    const s = this.state;
    // An ordinance whose building is gone lapses (it would otherwise keep
    // working, often at no cost, with nothing to carry it out).
    const landfillOperating = s.ordinances.includes('landfillGas') && (yield* hasOperatingLandfillSteps(s, this.fields, this.cfg));
    const lapsed = s.ordinances.filter((id) => !ordinanceAvailable(s, this.cfg, id, landfillOperating));
    if (lapsed.length) {
      s.ordinances = s.ordinances.filter((id) => !lapsed.includes(id));
      this.repealed.push(...lapsed);
    }
    allocateJobs(s, this.cfg, this.census);
    const traffic = yield* assignTrafficSteps(s, this.fields, this.cfg, { smoothing: this.cfg.transport.trafficSmoothing });
    yield;
    airportReach(s, this.fields, this.cfg);
    yield;
    updatePotholes(s, this.cfg, this.rng);
    s.freightTrips = traffic.freightTrips;
    this.fares = traffic.fares + traffic.tolls;
    this.volume = traffic.volume;
    s.blackoutRotation++;
    // Tomorrow's refresh plans routes on this month's traffic; until then keep the plan.
    yield* this.refreshSteps({ travel: false });
    updateQuotients(s, this.fields, this.cfg);
    yield;
    updateStrikes(s, this.cfg, this.rng);
    for (const plant of agePlants(s, this.cfg)) this.explode(plant);
    updateRadiation(s, this.cfg);
    yield;
    // (Growth this month, by type: from last month's census; none the first month after opening.)
    const pop = this.census.population;
    const last = s.lastPopulation;
    const built = last ? perType((t) => pop[t] - (last[t] ?? pop[t])) : undefined;
    s.lastPopulation = { ...pop };
    drainRegionalGrowth(s, this.cfg, this.census, built);
    yield;
    // (Each tree's own span, up to five years short of it, so a forest doesn't renew all at once.)
    const life = this.cfg.flora.lifeMonths;
    for (let i = 0; i < s.trees.length; i++) if (s.trees[i]) s.trees[i] = s.trees[i]! >= life - ((i * 37) % 60) ? 1 : s.trees[i]! + 1;
    yield;
    changeWind(s, this.rng);
    if (this.cfg.disasters.simulated) yield* this.miniDisastersSteps();
    yield;
    const debris = missileMisfires(s, this.cfg, this.rng);
    if (this.cfg.safety.fires) for (const id of debris) ignite(this.fireContext(), id);
    yield;
    yield* updateBuildingsSteps(this.devContext());
    yield;
    trackDemand(s, this.demand);
    exodus(this.devContext());
    yield;
    // Abandoned buildings are room to move into again.
    this.tractFull.clear();
    yield* this.updateDemandSteps();
    // Garbage.
    yield;
    const c = this.census;
    s.garbageStats = yield* runGarbageSteps(s, this.fields, this.cfg, this.rng, c.residents[0] + c.residents[1] + c.residents[2]);
    yield;
    // Crime and fire.
    const arson = yield* runCrimeSteps(s, this.fields, this.cfg, this.census, this.rng);
    yield;
    if (this.cfg.safety.fires) {
      // The arsonists take to the streets first, which leaves time to send police to arrest them before
      // they strike. See stepArsonists.
      for (const b of arson) s.arsonists.push({ target: b.id, x: b.x, y: b.y, days: ARSON_FUSE_DAYS });
      yield;
      monthlyIgnition(this.fireContext());
      yield;
    }
    updateSafetyStrikes(s, this.cfg, this.rng);
    yield;
    // Mayor Rating: tax mood, local ratings and riots.
    updateTaxMood(s, this.cfg);
    yield* computeSafetyFieldsSteps(s, this.fields, this.cfg);
    yield;
    s.mayorRating = computeMayor(s, this.fields, this.cfg);
    yield;
    if (this.cfg.mayor.riots) riotCheck(s, this.fields, this.cfg, this.rng);
    s.safety.fires = s.fireTally.fires;
    s.safety.burned = s.fireTally.burned;
    s.fireTally = { fires: 0, burned: 0 };
    for (const e of s.events) e.age++;
    s.events = s.events.filter((e) => e.age < e.months);
    // Demand left unmet this month is tossed to inactive neighbours.
    exportDemand(s, this.cfg, this.demand.raw);
    yield;
    yield* this.updateDemandSteps();
    allocateJobs(s, this.cfg, this.census);
    yield;
    yield* this.collectBudgetSteps();
    yield;
    this.checkUnlocks();
    yield;
    yield* this.recordHistorySteps();
    yield;
    const since = s.day - this.cfg.demand.taxMemoryDays;
    s.taxLog = s.taxLog.filter(([day]) => day >= since);
    if (s.funds <= this.cfg.economy.impeachmentFunds) s.impeached = true;
  }

  /**
   * Next month's budget if it were settled now: today's tax rates, budgets,
   * ordinances and loans on last month's tax base and fares. Nothing is paid
   * (it runs on a copy); the 재정 panel shows it beside last month's.
   */
  previewBudget(): BudgetReport {
    this.refreshIfDirty(); // finish pending days and use today's utility supply for standing deals
    // What settling changes: the treasury, loans' months and deals' standing.
    const s = this.state;
    return this.settleBudget({ ...s, garbageStats: this.previewGarbage(), loans: s.loans.map((l) => ({ ...l })), neighbourDeals: s.neighbourDeals.map((d) => ({ ...d })) }).report;
  }

  /** Projects 1–120 months of cash and debt at today's tax base, operating costs, delivery conditions and contract prices, with loan maturities and deal grace/probation. Optional capital spending, tax-income and operating-cost scenarios change no city state; growth, ageing and disasters are left out. */
  budgetForecast(months = 12, options: BudgetForecastOptions = {}): BudgetForecast {
    this.refreshIfDirty();
    const state = { ...this.state, garbageStats: this.previewGarbage() };
    return budgetForecast(state, this.cfg, this.budgetContext(state), months, options);
  }

  private settleBudget(s: CityState): ReturnType<typeof collectBudget> {
    return drain(this.settleBudgetSteps(s));
  }

  /** `days`: bill ordinances by the days they were in effect (the real month end, not a preview). */
  private settleBudgetSteps(s: CityState, days = false): ReturnType<typeof collectBudgetSteps> {
    return collectBudgetSteps(s, this.cfg, this.budgetContext(s, days));
  }

  private budgetContext(s: CityState, days = false): BudgetContext {
    const c = this.census;
    const deliveredByDeal = new Map<number, boolean>();
    const graceRoom = new Map<string, number>();
    if (s.garbageStats.failedImports) for (const deal of s.neighbourDeals) {
      if (deal.direction === 'sell' && deal.resource === 'garbage') deliveredByDeal.set(deal.id, !s.garbageStats.failedImports.includes(deal.id));
    }
    // Active sales already count in network demand. Grace-period sales need spare
    // capacity reserved once, in id order, before they can return on probation.
    const sales = s.neighbourDeals.filter((deal) => deal.direction === 'sell' && deal.resource !== 'garbage')
      .sort((a, b) => Number(a.status === 'grace') - Number(b.status === 'grace') || a.id - b.id);
    for (const deal of sales) {
      const power = deal.resource === 'power';
      const port = edgeTile(s, deal.edge, (i) => power ? s.power[i] === 1 && this.fields.powerGrid[i]! >= 0
        : s.pipe[i] === 1 && this.fields.pipeGrid[i]! >= 0, deal.resource);
      const id = port < 0 ? -1 : power ? this.fields.powerGrid[port]! : this.fields.pipeGrid[port]!;
      const network = power ? this.power.grids[id] : this.water.networks.find((network) => network.id === id);
      if (!network) { deliveredByDeal.set(deal.id, false); continue; }
      const key = `${deal.resource}:${id}`;
      let ok = network.supply + 1e-9 >= network.demand;
      if (deal.status === 'grace') {
        const reserve = graceRoom.get(key) ?? network.supply - network.demand;
        ok = reserve + 1e-9 >= deal.amount;
        if (ok) graceRoom.set(key, Math.max(0, reserve - deal.amount));
      }
      deliveredByDeal.set(deal.id, ok);
    }
    return {
      residents: c.residents[0] + c.residents[1] + c.residents[2],
      fares: this.fares,
      deliveredByDeal,
      delivered: {
        power: this.power.supply >= this.power.demand,
        // A pipe stub without a pump isn't a failure to supply the deal.
        // (Idle-pump networks count as short only while the city has water somewhere.)
        water: this.water.shortages - (this.water.sourceless ?? 0) - (this.water.supply > 0 ? this.water.pumpsOff ?? 0 : 0) === 0 && this.water.supply >= this.water.demand,
        garbage: (s.garbageStats.importShort ?? 0) <= 0,
      },
      month: Math.floor(s.day / DAYS_PER_MONTH),
      ...(days ? { ordinanceDays: s.ordinanceDays } : {}),
    };
  }

  private *collectBudgetSteps(): Generator<void, void> {
    const s = this.state;
    const { report, ended } = yield* this.settleBudgetSteps(s, true);
    s.ordinanceDays = {};
    s.lastBudget = report;
    for (const d of ended) this.endedDeals.push(d);
    yield;
    this.repricedDeals.push(...repriceDeals(s, this.cfg, (r) => this.utilitySnapshot(r)));
    yield;
    this.checkMySims();
  }

  /** My Sims leave when their home is gone or abandoned, and lose a job that closes. */
  private checkMySims(): void {
    const s = this.state;
    s.mySims = s.mySims.filter((sim) => {
      let home = s.buildings.get(sim.home);
      // Redeveloped: the Sim stays on in the new building on the lot if it suits their wealth.
      const now = home ? null : s.buildings.get(s.occupant[sim.homeTile]!);
      if (now?.type && now.type[0] === 'R' && this.cfg.demand.wealthOf[now.type] === sim.wealth) {
        sim.home = now.id;
        home = now;
        delete sim.homelessSince;
      }
      // Home gone: the closest home of their wealth near the old one; none for two months and they move out.
      if (!home) {
        if (this.rehouseMySim(sim)) {
          delete sim.homelessSince;
          return true;
        }
        if (s.day - (sim.homelessSince ??= s.day) < MY_SIM_JOBLESS_DAYS) return true;
        this.mySimNews.push({ sim: { ...sim }, kind: 'homeGone' });
        return false;
      }
      // Abandoned, or no longer of their wealth (a §§ Sim moves out rather than slum, a § one is priced out):
      // another home of their wealth nearby, else out of town.
      if (!home.type || home.occupancy <= 0 || this.cfg.demand.wealthOf[home.type] !== sim.wealth) {
        if (this.rehouseMySim(sim)) return true;
        this.mySimNews.push({ sim: { ...sim }, kind: home.type ? 'outclassed' : 'abandoned' });
        return false;
      }
      if (sim.job && !this.jobStillOpen(sim)) {
        this.mySimNews.push({ sim: { ...sim }, kind: 'jobGone' });
        sim.job = 0;
        sim.joblessSince = s.day; // (the two months start now, not at some earlier spell without work)
        delete sim.noRouteSince;
      }
      // Fate: an early death (no heir), old age (an heir takes the house), or a promotion.
      const fate = this.mySimFate(sim, home);
      if (fate === 'died') return false;
      // No route to work for two months: the job is lost.
      if (sim.job && this.fields.travel) {
        const c = commute(s, this.fields, this.cfg, sim);
        if (c && (c.time < 0 || c.time > this.cfg.transport.tripLimit)) {
          if (s.day - (sim.noRouteSince ??= s.day) >= MY_SIM_JOBLESS_DAYS) {
            delete sim.noRouteSince;
            this.mySimNews.push({ sim: { ...sim }, kind: 'jobGone' });
            sim.job = 0;
            sim.joblessSince = s.day;
          }
        } else delete sim.noRouteSince;
      }
      // Work: the closest open job of their wealth; none for two months and they move on.
      if (!sim.job) {
        if (this.findMySimJob(sim)) {
          delete sim.joblessSince;
          this.mySimNews.push({ sim: { ...sim }, kind: 'newJob' });
        } else if (s.day - (sim.joblessSince ??= s.day) >= MY_SIM_JOBLESS_DAYS) {
          this.mySimNews.push({ sim: { ...sim }, kind: 'noJob' });
          return false;
        }
      }
      return true;
    });
  }

  /** A month of a My Sim's life: 'died' if they don't make it (news pushed). */
  private mySimFate(sim: MySim, home: Building): 'died' | null {
    const s = this.state;
    const f = this.fields;
    const m = this.cfg.mayor;
    const i = sim.homeTile;
    const share = (v: number, from: number, to: number) => Math.max(0, Math.min(1, (v - from) / (to - from)));
    const robbery = MY_SIM_FATE.robbery * share(s.crime[i]!, m.crime.low, m.crime.top);
    const smog = MY_SIM_FATE.pollution * share(f.air[i]!, m.pollution.zero, m.pollution.worst) * (f.hospitalCover[i]! > 0 ? 0.5 : 1);
    if (this.rng.next() < robbery + smog) {
      this.mySimNews.push({ sim: { ...sim }, kind: 'died' });
      return 'died';
    }
    // Old age (the life expectancy of the household): an heir of the same name takes over the house.
    if (s.day - sim.since >= interp(this.cfg.services.lifeExpectancyByHq, home.hq) * 360) {
      sim.since = s.day;
      sim.generation = (sim.generation ?? 1) + 1;
      this.mySimNews.push({ sim: { ...sim }, kind: 'heir' });
      return null;
    }
    // Promotion comes with a rising EQ while the next wealth level is in demand and has work: a home and
    // a job of the next wealth, or no promotion.
    if (sim.wealth < 2 && home.eq >= MY_SIM_FATE.promoteEq[sim.wealth]!) {
      const next = (sim.wealth + 1) as 1 | 2;
      if ((this.demand.demand[(['R$', 'R$$', 'R$$$'] as const)[next]] ?? 0) > 0) {
        const was = { wealth: sim.wealth, job: sim.job, home: sim.home, homeTile: sim.homeTile };
        sim.wealth = next;
        // (The new home first: the job must be within reach of where they will live.)
        if (this.rehouseMySim(sim, false) && this.findMySimJob(sim)) {
          delete sim.joblessSince;
          delete sim.noRouteSince;
          this.mySimNews.push({ sim: { ...sim }, kind: 'promoted' });
        } else Object.assign(sim, was);
      }
    }
    return null;
  }

  /** Moves a My Sim to the closest lived-in home of their wealth near the old one; false if there is none. */
  private rehouseMySim(sim: MySim, news = true): boolean {
    const s = this.state;
    const hx = sim.homeTile % s.size;
    const hy = Math.floor(sim.homeTile / s.size);
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of s.buildings.values()) {
      if (b.id === sim.home || !b.type || b.type[0] !== 'R' || b.occupancy <= 0 || this.cfg.demand.wealthOf[b.type] !== sim.wealth) continue;
      const d = Math.abs(b.x - hx) + Math.abs(b.y - hy);
      if (d < bestD) [best, bestD] = [b, d];
    }
    if (!best) return false;
    sim.home = best.id;
    sim.homeTile = idx(s, best.x, best.y);
    if (news) this.mySimNews.push({ sim: { ...sim }, kind: 'moved' });
    return true;
  }

  /** Gives a jobless My Sim the closest workplace with a job of their wealth open, within reach; false if none. */
  private findMySimJob(sim: MySim): boolean {
    const s = this.state;
    const hx = sim.homeTile % s.size;
    const hy = Math.floor(sim.homeTile / s.size);
    const found: { key: number; d: number }[] = [];
    const consider = (key: number, x: number, y: number) => found.push({ key, d: Math.abs(x - hx) + Math.abs(y - hy) });
    for (const b of s.buildings.values()) {
      // (Hiring: fewer filled than the jobs it offers now.)
      if (b.type && b.type[0] !== 'R' && b.occupancy > 0 && this.cfg.demand.wealthOf[b.type] === sim.wealth && b.filled < b.capacity * b.occupancy - 0.5) consider(b.id, b.x, b.y);
    }
    for (const st of s.structures.values()) if ((this.cfg.structures[st.kind].jobs[sim.wealth] ?? 0) > 0) consider(-st.id, st.x, st.y);
    if (!found.length) return false;
    found.sort((a, b) => a.d - b.d || a.key - b.key);
    // The closest job they can actually get to within the trip limit (not one across a river); before
    // the city's trips are first planned, simply the closest.
    if (!this.fields.travel) {
      sim.job = found[0]!.key;
      return true;
    }
    for (const { key } of found.slice(0, MY_SIM_JOB_TRIES)) {
      sim.job = key;
      const c = commute(s, this.fields, this.cfg, sim);
      if (c && c.time >= 0 && c.time <= this.cfg.transport.tripLimit) return true;
    }
    sim.job = 0;
    return false;
  }

  /**
   * Daily: an arsonist with police on the scene is locked up; one whose time is up sets the building
   * alight, bigger than a spark (arson can start large fires; at stage 1 any fire
   * cover at all snuffed it).
   */
  private stepArsonists(): void {
    const s = this.state;
    const reach = this.cfg.safety.dispatch.police.radius;
    s.arsonists = s.arsonists.filter((a) => {
      if (s.units.some((u) => u.kind === 'police' && u.travel <= 0 && Math.hypot(u.x - a.x, u.y - a.y) <= reach)) {
        s.safety.arrests++;
        return false;
      }
      if (--a.days > 0) return true;
      const b = s.buildings.get(a.target);
      if (b?.type && this.cfg.safety.fires) {
        ignite(this.fireContext(), b.id, ARSON_STAGE);
        this.effectsDirty = true;
      }
      return false;
    });
  }

  /** The My Sim's workplace still stands, is occupied and hires their wealth. */
  private jobStillOpen(sim: MySim): boolean {
    const job = jobOf(this.state, sim);
    if (!job) return false;
    if ('kind' in job) return this.cfg.structures[job.kind].jobs[sim.wealth]! > 0;
    return !!job.type && job.occupancy > 0 && this.cfg.demand.wealthOf[job.type] === sim.wealth;
  }

  /** Moves a new My Sim into the home at (x, y); its wealth is the home's. */
  addMySim(name: string, x: number, y: number): ToolResult & { sim?: MySim } {
    this.settle();
    const s = this.state;
    if (s.mySims.length >= this.cfg.mySims.max) return { ok: false, cost: 0, message: `at most ${this.cfg.mySims.max} My Sims` };
    const home = this.homeAt(x, y);
    if (!home) return { ok: false, cost: 0, message: 'pick a lived-in home' };
    const sim: MySim = {
      id: s.nextId++, name: text(name).trim().slice(0, 40) || 'Sim', wealth: this.cfg.demand.wealthOf[home.type!], home: home.id, homeTile: idx(s, home.x, home.y), job: 0, since: s.day,
    };
    // A newcomer looks for work straight away.
    this.findMySimJob(sim);
    s.mySims.push(sim);
    return { ok: true, cost: 0, sim };
  }

  /** Change My Sim's House: only to a home of the Sim's own wealth. */
  moveMySim(id: number, x: number, y: number): ToolResult {
    this.settle();
    const sim = this.state.mySims.find((m) => m.id === id);
    if (!sim) return { ok: false, cost: 0, message: 'no such My Sim' };
    const home = this.homeAt(x, y);
    if (!home) return { ok: false, cost: 0, message: 'pick a lived-in home' };
    if (this.cfg.demand.wealthOf[home.type!] !== sim.wealth) return { ok: false, cost: 0, message: 'not a home for this wealth level' };
    sim.home = home.id;
    sim.homeTile = idx(this.state, home.x, home.y);
    delete sim.homelessSince;
    return { ok: true, cost: 0 };
  }

  /** Change My Sim's Job: a workplace with jobs for the Sim's wealth level. */
  setMySimJob(id: number, x: number, y: number): ToolResult {
    this.settle();
    const s = this.state;
    const sim = s.mySims.find((m) => m.id === id);
    if (!sim) return { ok: false, cost: 0, message: 'no such My Sim' };
    if (!inBounds(s, x, y)) return { ok: false, cost: 0, message: 'out of bounds' };
    const occ = s.occupant[idx(s, x, y)]!;
    const b = occ > 0 ? s.buildings.get(occ) : undefined;
    const st = occ < 0 ? s.structures.get(-occ) : undefined;
    const fits = b?.type && b.type[0] !== 'R' && b.occupancy > 0 ? this.cfg.demand.wealthOf[b.type] === sim.wealth
      : st ? this.cfg.structures[st.kind].jobs[sim.wealth] > 0 : false;
    if (!fits) return { ok: false, cost: 0, message: 'no jobs here for this wealth level' };
    sim.job = b ? b.id : -st!.id;
    delete sim.joblessSince;
    delete sim.noRouteSince;
    return { ok: true, cost: 0 };
  }

  /** Evicts a My Sim. */
  removeMySim(id: number): boolean {
    this.settle();
    const before = this.state.mySims.length;
    this.state.mySims = this.state.mySims.filter((m) => m.id !== id);
    return this.state.mySims.length < before;
  }

  /** What a My Sim thinks about at home: local conditions, commute, stops, landmarks (green = approve). */
  mySimThoughts(id: number): Thought[] {
    const sim = this.state.mySims.find((m) => m.id === id);
    return sim ? thoughtsAtHome(this.state, this.fields, this.cfg, sim) : [];
  }

  /**
   * Microphone tool (Rush Hour): an anonymous Sim from the
   * nearest home within a few tiles of (x, y) says what they think of local
   * conditions. Null when nobody lives nearby.
   */
  interview(x: number, y: number, reach = 4): { wealth: 0 | 1 | 2; home: Rect; thoughts: Thought[] } | null {
    const s = this.state;
    if (!inBounds(s, x, y)) return null;
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of s.buildings.values()) {
      if (!b.type || b.type[0] !== 'R' || b.occupancy <= 0) continue;
      const dx = Math.max(b.x - x, 0, x - (b.x + b.w - 1));
      const dy = Math.max(b.y - y, 0, y - (b.y + b.h - 1));
      const d = Math.max(dx, dy);
      if (d <= reach && d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (!best) return null;
    const wealth = this.cfg.demand.wealthOf[best.type!] as 0 | 1 | 2;
    const passerby: MySim = { id: 0, name: '', wealth, home: best.id, homeTile: idx(s, best.x, best.y), job: 0, since: s.day };
    return { wealth, home: { x: best.x, y: best.y, w: best.w, h: best.h }, thoughts: thoughtsAtHome(s, this.fields, this.cfg, passerby) };
  }

  /** The Sim's commute in centi-hours (−1: can't get there) and whether it uses transit. */
  mySimCommute(id: number): { time: number; transit: boolean } | null {
    const sim = this.state.mySims.find((m) => m.id === id);
    return sim ? commute(this.state, this.fields, this.cfg, sim) : null;
  }

  /** My Sims Dispatch: the Sim visits (x, y) and gives an opinion of it. */
  dispatchMySim(id: number, x: number, y: number): Thought[] {
    const s = this.state;
    const sim = s.mySims.find((m) => m.id === id);
    if (!sim || !inBounds(s, x, y)) return [];
    return thoughtsAt(s, this.fields, this.cfg, sim, x, y, {
      hospitalGrade: (st) => st.effectiveness, uncollected: s.garbageStats.uncollected,
    });
  }

  /**
   * Why an empty zoned tile hasn't developed, or why nobody moves back into
   * an abandoned building: no power, no road, no demand, too little
   * desirability … (null for anything else).
   */
  growthBlockers(x: number, y: number): GrowthBlocker[] | null {
    if (!inBounds(this.state, x, y)) return null;
    this.refreshIfDirty();
    return growthBlockers(this.devContext(), idx(this.state, x, y));
  }

  /**
   * The main growth blocker of every empty zoned tile, for a data view:
   * 0 where the tile isn't an empty zone, else 1 + its index in
   * GROWTH_CODES (the first blocker found; dry land blocks only where every type that wants in needs water).
   * Recomputed when the fields are.
   */
  growthMap(): Uint8Array {
    this.settle();
    return drain(this.growthMapSteps());
  }

  /**
   * {@link growthMap} a piece of the map at a time, for a viewer that works
   * it out between frames. Resume it only between days (not while
   * {@link stepping}); a map that a day or an edit overtook part-way is
   * returned but not kept.
   */
  *growthMapSteps(): Generator<void, Uint8Array> {
    this.refreshIfDirty();
    if (this.growth) return this.growth;
    const s = this.state;
    const day = s.day;
    const revision = this.revision;
    const map = new Uint8Array(s.size * s.size);
    const ctx = this.devContext();
    const memo = new Map<string, { type: DevType; value: number } | null>();
    for (let i = 0; i < map.length; i++) {
      if ((i & 0x3ff) === 0x3ff) yield;
      if (!s.zone[i] || s.occupant[i] !== 0 || s.net[i]) continue;
      const main = growthBlockers(ctx, i, memo)?.find((b) => !INFO_ONLY.has(b.code));
      if (main) map[i] = GROWTH_CODES.indexOf(main.code as (typeof GROWTH_CODES)[number]) + 1;
    }
    if (s.day === day && this.revision === revision) this.growth = map;
    return map;
  }

  /**
   * How tall a type may build now (stage limits): its population
   * (city plus region), the highest stage its table allows, and the
   * population at which the next stage opens (null at the top).
   */
  stageOutlook(t: DevType): { population: number; maxStage: number; next: { stage: number; at: number } | null } {
    if (!own(this.cfg.development.stageTable, t)) return { population: 0, maxStage: 0, next: null };
    const table = this.cfg.development.stageTable[t];
    const mult = this.cfg.difficulty[this.state.difficulty].stageLimitMult;
    const population = this.census.population[t] + (this.state.region?.byType?.[t] ?? 0);
    const maxAt = (col: number) => table.rows.reduce((m, row, k) => (row[col]! > 0 ? k + 1 : m), 1);
    let col = 0;
    table.thresholds.forEach((th, k) => {
      if (population >= th * mult) col = k;
    });
    const maxStage = maxAt(col);
    for (let k = col + 1; k < table.thresholds.length; k++) {
      const m = maxAt(k);
      if (m > maxStage) return { population, maxStage, next: { stage: m, at: Math.ceil(table.thresholds[k]! * mult) } };
    }
    return { population, maxStage, next: null };
  }

  /**
   * Is this business short of workers it can't get (under half its jobs filled
   * while the Sims it mostly hires can't move in)? Such a building distresses
   * and is abandoned for 'workforce'.
   */
  understaffed(buildingId: number): boolean {
    const b = this.state.buildings.get(buildingId);
    return !!b && understaffed(this.devContext(), b);
  }

  /** Advisors' messages: problems, news and successes by department. */
  advisors(): Advice[] {
    this.settle();
    return drain(this.advisorsSteps());
  }

  /** {@link advisors} in pieces, like {@link growthMapSteps} (resume it only between days). */
  *advisorsSteps(): Generator<void, Advice[]> {
    this.refreshIfDirty();
    const st = this.stats();
    const sum = (v: readonly number[]) => v.reduce((a, b) => a + b, 0);
    yield;
    // Businesses counting down for want of workers who can't move in.
    const ctx = this.devContext();
    const short: Building[] = [];
    let n = 0;
    for (const b of this.state.buildings.values()) {
      if (b.distressMonths <= 0) continue;
      if ((++n & 0x1f) === 0) yield;
      if (understaffed(ctx, b)) short.push(b);
    }
    yield;
    return yield* adviseSteps(this.state, this.cfg, this.fields, {
      ...st, safety: { ...st.safety }, workers: sum(this.census.workers), unemployed: sum(this.census.unemployed), understaffed: short,
    }, this.demand);
  }

  /**
   * Population by Age and Education by Age (bar graphs): residents
   * and their average EQ in 10-year groups of household age (from 0–9 up).
   */
  ageProfile(): { from: number; residents: number; eq: number }[] {
    const groups = new Map<number, [number, number]>();
    for (const b of this.state.buildings.values()) {
      if (!b.type || b.type[0] !== 'R') continue;
      const r = b.capacity * b.occupancy;
      if (r <= 0) continue;
      const k = Math.max(0, Math.floor(b.age / 10)) * 10;
      const g = groups.get(k) ?? [0, 0];
      g[0] += r;
      g[1] += b.eq * r;
      groups.set(k, g);
    }
    return [...groups].sort((a, b) => a[0] - b[0]).map(([from, [r, eq]]) => ({ from, residents: Math.round(r), eq: Math.round(eq / r) }));
  }

  /** City Opinion Polls: per topic, the share of residents who approve. */
  opinionPolls(): Record<PollTopic, { approve: number; score: number }> {
    this.refreshIfDirty();
    return opinionPolls(this.state, this.fields, this.cfg);
  }

  /** Riders who got off at each passenger station last month (station id → riders; boardings are its load). */
  alightings(): Map<number, number> {
    this.refreshIfDirty();
    return alightings(this.state, this.fields, this.cfg);
  }

  /** Route Query: trips from, to or across (x, y), their routes and means. */
  routeQuery(x: number, y: number): RouteQuery {
    if (!inBounds(this.state, x, y)) return { trips: [], byMeans: {} };
    this.refreshIfDirty();
    return routeQuery(this.state, this.fields, this.cfg, x, y);
  }

  /** U-Drive-It missions that can be played now. */
  availableMissions(): MissionId[] {
    return (Object.keys(MISSIONS) as MissionId[]).filter((id) => missionAvailable(this.state, this.cfg, id));
  }

  /** Vehicles the city's structures make available. */
  availableVehicles(): VehicleId[] {
    return (Object.keys(VEHICLES) as VehicleId[]).filter((v) => vehicleAvailable(this.state, v));
  }

  /** Starts a mission: where the vehicle starts, where it must get to, and the time allowed. */
  startMission(id: MissionId): ActiveMission | ToolResult {
    this.settle();
    if (!Object.hasOwn(MISSIONS, id)) return { ok: false, cost: 0, message: `unknown mission ${id}` };
    const plan = planMission(this.state, this.cfg, id);
    if (typeof plan === 'string') return { ok: false, cost: 0, message: plan };
    const udi = this.state.udi;
    udi.active = id;
    udi.vehicle = plan.vehicle;
    if (plan.fire !== undefined) udi.fire = plan.fire;
    else delete udi.fire;
    return plan;
  }

  /** May the vehicle move onto tile (x, y)? */
  canDrive(vehicle: VehicleId, x: number, y: number): boolean {
    return Object.hasOwn(VEHICLES, vehicle) && inBounds(this.state, x, y) && canDrive(this.state, vehicle, idx(this.state, x, y));
  }

  /**
   * U-Drive-It special controls that change the city. 'spray':
   * the Fire Engine's crew (or the Fire Plane's water drop, wider) puts out
   * fires on and beside the tile at full competence whatever the funding,
   * and the Fire Engine neutralises toxic spills there. 'shoot': the Tank
   * demolishes the building or structure on the tile, leaving rubble.
   */
  vehicleAction(vehicle: VehicleId, action: 'spray' | 'shoot', x: number, y: number): ToolResult & { hits: number } {
    this.settle();
    const s = this.state;
    const no = (message: string) => ({ ok: false, cost: 0, message, hits: 0 });
    if (!inBounds(s, x, y)) return no('out of bounds');
    // Only the vehicle of the mission under way: no free demolition or firefighting otherwise.
    if (!s.udi.active || s.udi.vehicle !== vehicle) return no('no mission with this vehicle');
    if (!vehicleAvailable(s, vehicle)) return no('vehicle not available');
    const i = idx(s, x, y);
    if (action === 'spray') {
      if (vehicle !== 'fireEngine' && vehicle !== 'firePlane') return no('this vehicle has no water');
      const r = vehicle === 'firePlane' ? 2 : 1;
      const near = (rect: Rect) => x >= rect.x - r && x < rect.x + rect.w + r && y >= rect.y - r && y < rect.y + rect.h + r;
      const before = s.fires.length;
      s.fires = s.fires.filter((fire) => {
        const rect = fire.target > 0 ? s.buildings.get(fire.target) : s.structures.get(-fire.target);
        return !(rect && near(rect));
      });
      const trees = s.treeFires.length;
      s.treeFires = s.treeFires.filter((t) => !near({ x: t.i % s.size, y: Math.floor(t.i / s.size), w: 1, h: 1 }));
      let hits = before - s.fires.length + trees - s.treeFires.length;
      if (vehicle === 'fireEngine') {
        const n = s.size;
        const left = s.spills.filter((sp) => Math.max(Math.abs((sp.i % n) - x), Math.abs(Math.floor(sp.i / n) - y)) > r);
        hits += s.spills.length - left.length;
        s.spills = left;
      }
      if (hits) this.effectsDirty = true;
      return { ok: hits > 0, cost: 0, hits, message: hits ? undefined : 'nothing to put out here' };
    }
    if (vehicle !== 'tank') return no('only the tank can fire');
    const occ = s.occupant[i]!;
    if (!occ) return no('nothing to hit here');
    this.burnDown(occ); // occupant ids: buildings > 0, structures < 0, as fires use
    this.effectsDirty = true;
    return { ok: true, cost: 0, hits: 1 };
  }

  /**
   * Ends the mission under way at (x, y): Mayor Rating effect there, cash, and
   * any rewards it unlocks. Only a mission started with startMission, once.
   */
  finishMission(id: MissionId, success: boolean, x: number, y: number): { cash: number; mr: number; unlocked: StructureKind[] } {
    this.settle();
    const udi = this.state.udi;
    if (udi.active !== id || !inBounds(this.state, x, y)) return { cash: 0, mr: 0, unlocked: [] };
    // A Fire! mission succeeds only once its fire is out, with the building still standing (not burnt down).
    if (udi.fire !== undefined && MISSIONS[id].alignment === 'good') {
      const f = udi.fire;
      const standing = f > 0 ? this.state.buildings.has(f) : this.state.structures.has(-f);
      if (!standing || this.state.fires.some((x) => x.target === f)) success = false;
    }
    delete udi.active;
    delete udi.vehicle;
    delete udi.fire;
    const r = success ? MISSIONS[id].success : MISSIONS[id].failure;
    const unlocked = finishMission(this.state, this.cfg, id, success, idx(this.state, x, y));
    this.newlyUnlocked.push(...unlocked);
    this.effectsDirty = true;
    return { cash: r.cash, mr: r.mr, unlocked };
  }

  /** Surrenders the mission under way: no result either way (giving up spares the failure penalty). */
  abortMission(): boolean {
    this.settle();
    const udi = this.state.udi;
    if (!udi.active) return false;
    delete udi.active;
    delete udi.vehicle;
    delete udi.fire;
    return true;
  }

  /** My Sims who moved out or lost their job since the last call. */
  takeMySimNews(): MySimNews[] {
    return this.mySimNews.splice(0);
  }

  private homeAt(x: number, y: number): Building | null {
    const s = this.state;
    if (!inBounds(s, x, y)) return null;
    const occ = s.occupant[idx(s, x, y)]!;
    const b = occ > 0 ? s.buildings.get(occ) : undefined;
    return b?.type?.[0] === 'R' && b.occupancy > 0 ? b : null;
  }


  /**
   * Recomputes fields, desirability, census and demand. `travel: false` keeps the
   * last route plan (no network change; new workplaces join at the next plan).
   */
  refresh(opts: { travel?: boolean } = {}): void {
    this.settle(); // a day part-way through finishes first (inside one, a no-op)
    drain(this.refreshSteps(opts));
  }

  /** `refresh` in steps: a pause between fields (see `steps`). */
  private *refreshSteps(opts: { travel?: boolean } = {}): Generator<void, void> {
    const s = this.state;
    this.finishOverhauls();
    // Access, road components, land value and slope depend only on networks,
    // zones and terrain: every edit to those marks the network dirty.
    if (this.networkDirty || !this.networkFieldsReady) {
      yield* computeNetworkFieldsSteps(s, this.fields, this.cfg);
      this.networkFieldsReady = true;
    } else yield* computeJobComponentsSteps(s, this.fields, this.cfg);
    yield;
    if (opts.travel !== false || !this.fields.travel) this.fields.travel = yield* computeTravelSteps(s, this.fields, this.cfg);
    this.edgeRuns = null;
    this.power = yield* computePowerSteps(s, this.fields, this.cfg);
    yield;
    yield* computeEffectFieldsSteps(s, this.fields, this.cfg);
    yield;
    this.water = yield* computeWaterSteps(s, this.fields, this.cfg);
    yield;
    yield* computeSafetyFieldsSteps(s, this.fields, this.cfg);
    yield;
    yield* computeCoverageSteps(s, this.fields, this.cfg);
    yield;
    yield* computeDesirabilitySteps(s, this.fields, this.cfg, this.desirability);
    this.fullDesirability.clear();
    this.growth = null;
    this.tractCache.clear();
    this.tractFull.clear();
    this.networkDirty = false;
    this.effectsDirty = false;
    this.coverageDirty = false;
    this.sourceFieldsDay = s.day;
    yield;
    yield* this.updateDemandSteps();
  }

  /** A same-day school/clinic edit changes coverage and desirability, while utility loads and source geometry stay current. */
  private *refreshCoverageSteps(): Generator<void, void> {
    yield* computeCoverageSteps(this.state, this.fields, this.cfg);
    yield;
    yield* computeDesirabilitySteps(this.state, this.fields, this.cfg, this.desirability);
    this.fullDesirability.clear();
    this.growth = null;
    this.tractCache.clear();
    this.tractFull.clear();
    this.coverageDirty = false;
    yield;
    yield* this.updateDemandSteps();
  }

  /** Only completion days scan for deadlines during stepping; regular refreshes pick up loaded or edited schedules. */
  private finishOverhauls(): boolean {
    let finished = false;
    let next = Infinity;
    for (const st of this.state.structures.values()) {
      if (st.offlineUntilDay === undefined) continue;
      if (st.offlineUntilDay <= this.state.day) {
        delete st.offlineUntilDay;
        finished = true;
      } else next = Math.min(next, st.offlineUntilDay);
    }
    this.nextOverhaulDay = next;
    if (finished) this.effectsDirty = true;
    return finished;
  }

  private updateDemand(): void {
    drain(this.updateDemandSteps());
  }

  private *updateDemandSteps(): Generator<void, void> {
    this.censusStale = false;
    this.census = yield* takeCensusSteps(this.state, this.cfg);
    // Edge connections only change with the network (refresh).
    this.edgeRuns ??= edgeConnections(this.state);
    yield;
    this.demand = computeDemand(
      this.state, this.cfg, this.census, reliefConnections(this.state, this.edgeRuns), regionalDemand(this.state, this.census, this.edgeRuns),
    );
  }

  /** Neighbour connections on each map edge (W, E, N, S) by kind. */
  connectionsPerEdge(): Record<ConnectionKind, [number, number, number, number]> {
    const s = this.state;
    const n = s.size;
    const out: Record<ConnectionKind, [number, number, number, number]> = {
      road: [0, 0, 0, 0], highway: [0, 0, 0, 0], rail: [0, 0, 0, 0], subway: [0, 0, 0, 0],
    };
    const edge = (i: number) => {
      const x = i % n;
      const y = (i - x) / n;
      return x === 0 ? 0 : x === n - 1 ? 1 : y === 0 ? 2 : 3;
    };
    for (const i of this.fields.connections) {
      const code = s.net[i]!;
      out[code === Net.Highway ? 'highway' : isRail(code) ? 'rail' : 'road'][edge(i)]++;
    }
    for (let i = 0; i < n * n; i++) {
      const x = i % n;
      const y = (i - x) / n;
      if (s.subway[i] && (x === 0 || y === 0 || x === n - 1 || y === n - 1)) out.subway[edge(i)]++;
    }
    return out;
  }

  /** Trip time from a tile through its access road (centi-hours), or null. */
  private tripTime(field: Float32Array, i: number): number | null {
    const road = this.fields.access[i]!;
    if (road < 0 || field[road]! >= INF) return null;
    const t = field[road]! + this.fields.accessDist[i]! * this.cfg.transport.speed.street.car;
    return t <= this.cfg.transport.tripLimit ? t : null;
  }

  /** Citywide numbers: date, funds, population and jobs, utilities, garbage, safety, Mayor Rating, EQ and HQ. */
  stats(): CityStats {
    const s = this.state;
    const c = this.census;
    const month = Math.floor(s.day / DAYS_PER_MONTH);
    let jobs = 0;
    for (const b of s.buildings.values()) if (b.type && b.type[0] !== 'R') jobs += b.capacity * b.occupancy;
    // Schools, hospitals and plants employ Sims too (as the census counts them against the workforce).
    jobs += c.civicJobs[0] + c.civicJobs[1] + c.civicJobs[2];
    return {
      day: s.day,
      date: { year: 2000 + Math.floor(month / 12), month: (month % 12) + 1, day: (s.day % DAYS_PER_MONTH) + 1 },
      funds: s.funds,
      population: Math.round(c.residents[0] + c.residents[1] + c.residents[2]),
      jobs: Math.round(jobs),
      residents: c.residents.map(Math.round) as [number, number, number],
      unemployed: c.unemployed.map(Math.round) as [number, number, number],
      buildings: c.buildings - c.abandoned,
      abandoned: c.abandoned,
      impeached: s.impeached,
      // Demand as the grids reckon it: conservation ordinances cut it.
      power: { supply: this.power.supply, demand: this.powerDemand() * ordinanceEffects(s).power, blackedOut: this.power.blackedOut },
      water: { supply: this.water.supply, demand: this.waterDemand() * ordinanceEffects(s).water, shortages: this.water.shortages, sourceless: this.water.sourceless ?? 0, pumpsOff: this.water.pumpsOff ?? 0, ...(this.water.pumpsOffAt ? { pumpsOffAt: { ...this.water.pumpsOffAt } } : {}), ...(this.water.sourcelessAt ? { sourcelessAt: { ...this.water.sourcelessAt } } : {}) },
      safety: { ...copyData(s.safety), burning: s.fires.length + s.treeFires.length },
      garbage: copyData(s.garbageStats),
      mayorRating: Math.round(s.mayorRating),
      riots: s.riots,
      eq: c.avgEq.map(Math.round) as [number, number, number],
      hq: c.avgHq.map(Math.round) as [number, number, number],
      workforceFraction: c.workforceFraction,
    };
  }

  /** Current power demand of every building (grid supply is updated at refresh). */
  powerDemand(): number {
    let total = 0;
    for (const b of this.state.buildings.values()) total += powerUse(this.cfg, b);
    for (const st of this.state.structures.values()) total += this.cfg.structures[st.kind].powerUse;
    return total;
  }

  /** Water every building and civic structure would use with full service. */
  waterDemand(): number {
    let total = 0;
    for (const b of this.state.buildings.values()) total += waterUse(this.cfg, b);
    for (const st of this.state.structures.values()) total += this.cfg.structures[st.kind].waterUse;
    return total;
  }

  /** A plant at the end of its life explodes, destroying buildings around it. */
  /**
   * A plant explodes (end of life or burned down): a huge blast, destroying
   * everything within a few tiles and starting fires in the blocks around; a
   * nuclear plant melts down and irradiates the area for good.
   */
  private explode(plant: Structure): void {
    const s = this.state;
    const ex = this.cfg.disasters.explosion;
    const r = this.cfg.services.plantExplosionRadius;
    const nuclear = plant.kind === 'nuclearPlant';
    const cx = plant.x + plant.w / 2;
    const cy = plant.y + plant.h / 2;
    const ctx = this.damageContext(nuclear ? 'meltdown' : 'explosion', Math.floor(cx), Math.floor(cy));
    for (const i of footprint(s, plant)) s.occupant[i] = 0;
    s.structures.delete(plant.id);
    s.fires = s.fires.filter((fi) => fi.target !== -plant.id); // nothing left to burn
    ctx.report.structures++;
    ctx.report.rebuildCost += this.cfg.structures[plant.kind].cost + plant.w * plant.h * this.cfg.safety.rubbleBulldoze;
    const half = Math.max(plant.w, plant.h) / 2;
    const n = s.size;
    for (let y = Math.max(0, Math.floor(cy - half - r - ex.fireRing)); y <= Math.min(n - 1, Math.ceil(cy + half + r + ex.fireRing)); y++) {
      for (let x = Math.max(0, Math.floor(cx - half - r - ex.fireRing)); x <= Math.min(n - 1, Math.ceil(cx + half + r + ex.fireRing)); x++) {
        const d = Math.max(Math.abs(x + 0.5 - cx), Math.abs(y + 0.5 - cy)) - half;
        const i = y * n + x;
        if (d <= r) ctx.destroyTile(i, true);
        else if (this.rng.next() < ex.fireChance / 4) ctx.igniteTile(i, 2);
      }
    }
    if (nuclear) {
      for (let y = Math.max(0, Math.floor(cy - ex.meltdownRadius)); y <= Math.min(n - 1, Math.ceil(cy + ex.meltdownRadius)); y++) {
        for (let x = Math.max(0, Math.floor(cx - ex.meltdownRadius)); x <= Math.min(n - 1, Math.ceil(cx + ex.meltdownRadius)); x++) {
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= ex.meltdownRadius) s.radiation[y * n + x] = 255;
        }
      }
    }
    this.finishDamage(ctx);
  }

  // ------------------------------------------------------------- disasters

  /**
   * Starts a God Mode disaster at (x, y) (the player picks the kind, time and
   * place; `intensity` 0–1 stands for how long you hold the button). Fires it
   * starts burn on day by day. Returns the damage report.
   */
  /**
   * Sets a tornado, Servo the robot or the Autosaurus loose at (x, y) to move
   * over time: advanceDisasters() moves it a step (each simulated day moves it
   * several), steerDisaster() pulls it towards a point. Other kinds strike at
   * once (use disaster()).
   */
  unleash(kind: DisasterKind, x: number, y: number, intensity = 0.5): LiveDisaster | ToolResult {
    this.settle();
    if (!LIVE_KINDS.includes(kind)) return { ok: false, cost: 0, message: 'only tornadoes and robots move; use disaster()' };
    if (!inBounds(this.state, x, y)) return { ok: false, cost: 0, message: 'out of bounds' };
    const ctx = this.damageContext(kind, x, y);
    const live = startLive(ctx, kind as LiveKind, x, y, Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0.5, this.state.nextId++);
    this.state.liveDisasters.push(live);
    return live;
  }

  /** Pulls a moving disaster towards (x, y) until released (click and hold, or drag). */
  steerDisaster(id: number, x: number, y: number): boolean {
    this.settle();
    const d = this.state.liveDisasters.find((l) => l.id === id);
    if (!d || !inBounds(this.state, x, y)) return false;
    if (!d.steer || d.steer[0] !== x || d.steer[1] !== y) d.held = 0;
    d.steer = [x, y];
    return true;
  }

  /** Lets a moving disaster roam on its own again. */
  releaseDisaster(id: number): boolean {
    this.settle();
    const d = this.state.liveDisasters.find((l) => l.id === id);
    if (!d) return false;
    d.steer = null;
    return true;
  }

  /** Moves every moving disaster `steps` steps; those that end file their damage report. Returns the ones still going. */
  advanceDisasters(steps = 1): LiveDisaster[] {
    this.settle();
    const s = this.state;
    if (!s.liveDisasters.length) return [];
    s.liveDisasters = s.liveDisasters.filter((d) => {
      const ctx = this.damageContext(d.kind, d.x, d.y, d.report);
      let going = true;
      // Steering held on one point speeds the disaster up, to at most three steps at once (meteors have
      // their own push).
      for (let k = 0; k < steps && going; k++) {
        let moves = 1;
        if (d.steer && d.kind !== 'meteor' && d.kind !== 'ufo') {
          d.held = (d.held ?? 0) + 1;
          moves += Math.min(2, Math.floor(d.held / LIVE_HOLD_STEPS));
        }
        for (let m = 0; m < moves && going; m++) going = stepLive(ctx, d);
      }
      if (!going) {
        this.finishDamage(ctx);
        // (Its Mayor Rating effect, as a disaster struck at once has: played out, it cost none. A meteor
        // lands through runDisaster, which already leaves it.)
        if (d.kind !== 'meteor' && d.kind !== 'ufo') s.events.push(disasterEvent(this.cfg, d.report.x, d.report.y));
      } else this.networkDirty = true;
      return going;
    });
    return s.liveDisasters;
  }

  /** Strikes a God Mode disaster at (x, y) at once (intensity 0–1) and returns its damage report; see unleash() to play moving ones out over time. */
  disaster(kind: DisasterKind, x: number, y: number, intensity = 0.5): DamageReport {
    this.settle();
    if (!inBounds(this.state, x, y)) throw new Error('disaster out of bounds');
    const ctx = this.damageContext(kind, x, y);
    runDisaster(ctx, kind, x, y, Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0.5);
    this.finishDamage(ctx);
    return ctx.report;
  }

  // ------------------------------------------------------------- neighbours

  /** Sets the city beyond an edge (0 W, 1 E, 2 N, 3 S): SimNation, established, or developed at a size (0–100 times the template). */
  setNeighbour(edge: 0 | 1 | 2 | 3, kind: NeighbourKind, scale = 1, name?: string): void {
    this.settle();
    const s = this.state;
    if (!isEdge(edge) || !NEIGHBOUR_KINDS.includes(kind) || !Number.isFinite(scale)) return;
    scale = Math.max(0, Math.min(100, scale));
    if (name !== undefined) name = text(name).trim().slice(0, 40) || undefined;
    s.neighbours[edge] = makeNeighbour(this.cfg, edge, kind, scale, name ?? s.neighbours[edge]?.name);
    if (kind !== 'developed') s.neighbourDeals = s.neighbourDeals.filter((d) => d.edge !== edge);
    this.networkDirty = true;
  }

  /** Uses a real city's snapshot as the neighbour beyond an edge (regional play). */
  setNeighbourCity(edge: 0 | 1 | 2 | 3, snap: CitySnapshot | null, shared?: Neighbour['shared']): void {
    this.settle();
    const s = this.state;
    if (!isEdge(edge)) return;
    if (!snap) {
      s.neighbours[edge] = makeNeighbour(this.cfg, edge, 'simnation');
      s.neighbourDeals = s.neighbourDeals.filter((d) => d.edge !== edge);
    } else {
      // Keep deals; refresh what the neighbour has now.
      s.neighbours[edge] = neighbourFromSnapshot(this.cfg, edge, snap, shared);
    }
    this.networkDirty = true;
  }

  /** How this city looks to its neighbours (population, utilities, treasury). */
  snapshot(): CitySnapshot {
    const c = this.census;
    const use = (r: DealResource) => this.utility(r);
    const power = use('power');
    const water = use('water');
    const garbage = use('garbage');
    return {
      name: this.state.name,
      population: { ...c.population },
      capacity: { power: power.capacity, water: water.capacity, garbage: garbage.capacity },
      usage: { power: power.usage, water: water.usage, garbage: garbage.usage },
      // Its standing deals: another neighbour is offered only what is left after them.
      committed: Object.fromEntries((['power', 'water', 'garbage'] as const).map((r) => [r, dealTotals(this.state, r)])) as NonNullable<CitySnapshot['committed']>,
      funds: this.state.funds,
      edges: Object.fromEntries((['power', 'water', 'garbage'] as const).map((r) =>
        [r, [0, 1, 2, 3].map((e) => hasDealConnection(this.state, e, r, true))])) as NonNullable<CitySnapshot['edges']>,
      reach: Object.fromEntries((['power', 'water', 'garbage'] as const).map((r) =>
        [r, [0, 1, 2, 3].map((e) => edgeReach(this.state, r, e))])) as NonNullable<CitySnapshot['reach']>,
      demand: this.ownDemand(),
      // Trips into this city take what its own commutes to jobs in town take (not those leaving it).
      ...(this.fields.localCommute >= 0 ? { commute: Math.round(this.fields.localCommute) }
        : this.averageCommute() !== null ? { commute: this.averageCommute()! } : {}),
    };
  }

  /** Raw demand this city leaves unmet by itself (what the region added taken back out), whole Sims or jobs. */
  private ownDemand(): PerType {
    // An undeveloped city adds none (it has no zones): its base demand alone, saved, was
    // added to every neighbour's.
    if (!this.state.buildings.size) return perType(() => 0);
    const region = regionalDemand(this.state, this.census, this.edgeRuns ?? undefined).extra;
    return perType((t) => Math.round(this.demand.raw[t] - region[t]));
  }

  /** Residents' average commute, centi-hours (null with nobody commuting). */
  private averageCommute(): number | null {
    let sum = 0;
    let sims = 0;
    for (const b of this.state.buildings.values()) {
      if (!b.type || b.type[0] !== 'R' || b.commute < 0) continue;
      const n = b.capacity * b.occupancy;
      sum += b.commute * n;
      sims += n;
    }
    return sims > 0 ? Math.round(sum / sims) : null;
  }

  /**
   * Growth other cities tossed to this one while it was inactive: it
   * sprouts as extra demand until built. The region hands it over
   * when it opens the city.
   */
  receiveGrowth(growth: Partial<Record<DevType, number>>): void {
    this.settle();
    for (const t of DEV_TYPES) {
      const g = growth[t] ?? 0;
      if (g > 0) this.state.growthTarget[t] = Math.round((this.state.growthTarget[t] ?? this.census.population[t]) + g);
    }
    this.updateDemand();
  }

  /** The city's own capacity, use and average cost of power, water or garbage disposal. */
  utility(resource: DealResource): Utility {
    this.refreshIfDirty();
    return this.utilitySnapshot(resource);
  }

  /** Utility values from the fields already settled by the monthly simulation. */
  private utilitySnapshot(resource: DealResource): Utility {
    const s = this.state;
    const cfg = this.cfg;
    let capacity = 0;
    let cost = 0;
    for (const st of s.structures.values()) {
      const def = cfg.structures[st.kind];
      if (resource === 'power' && (def.plant || def.incinerator)) {
        capacity += def.plant ? st.capacity : incineratorPower(s, cfg, st);
        if (def.plant) cost += structureUpkeep(s, cfg, st).total;
      } else if (resource === 'water' && def.pump) {
        capacity += st.capacity;
        cost += structureUpkeep(s, cfg, st).total;
      } else if (resource === 'garbage' && def.incinerator) {
        cost += structureUpkeep(s, cfg, st).total;
        capacity += st.capacity;
      }
    }
    let usage: number;
    // (As the grids use it: less under the conservation ordinances.)
    if (resource === 'power') usage = this.powerDemand() * ordinanceEffects(s).power;
    else if (resource === 'water') usage = this.waterDemand() * ordinanceEffects(s).water;
    else {
      const g = s.garbageStats;
      // Tons a month, like the usage it is set against: incinerators' monthly capacity, and the free landfill
      // spread over five years (all of it, a stock, made any landfill a vast monthly surplus to sell).
      capacity += Math.max(0, g.landfillSpace ?? 0) / GARBAGE_DEAL_MONTHS * Math.max(0, Math.min(1, s.departments.sanitation / 100));
      usage = g.kept ?? g.produced - g.recycled;
      let tiles = 0;
      for (let i = 0; i < s.zone.length; i++) if (s.zone[i] === LANDFILL_ZONE) tiles++;
      cost += tiles * cfg.garbage.landfill.upkeep * (s.departments.sanitation / 100) + usage * cfg.garbage.pickupCost;
    }
    const fallback = cfg.region.neighbourCost[resource];
    return { capacity, usage, cost: capacity > 0 && cost > 0 ? cost / capacity : fallback };
  }

  /** Every Neighbor Deal the city could strike now, with its maximum amount and price, or why not. */
  dealOffers(): DealOffer[] {
    const out: DealOffer[] = [];
    const utilities = { power: this.utility('power'), water: this.utility('water'), garbage: this.utility('garbage') };
    for (const edge of [0, 1, 2, 3] as const) {
      for (const resource of ['power', 'water', 'garbage'] as const) {
        const own = utilities[resource];
        for (const direction of ['buy', 'sell'] as const) out.push(evaluateDeal(this.state, this.cfg, own, edge, resource, direction));
      }
    }
    return out;
  }

  /** What a deal (struck or offered, at an amount) pays or earns a month, ordinances included. */
  dealMonthly(d: Pick<NeighbourDeal, 'amount' | 'price' | 'direction' | 'resource'>): number {
    return dealMonthly(this.state, d);
  }

  /** The unit price a deal for `amount` would be struck at (a smaller deal is priced lower), or null when it can't be. */
  dealPriceFor(edge: 0 | 1 | 2 | 3, resource: DealResource, direction: 'buy' | 'sell', amount: number): number | null {
    if (!isEdge(edge) || !DEAL_RESOURCES.includes(resource) || (direction !== 'buy' && direction !== 'sell')) return null;
    const offer = evaluateDeal(this.state, this.cfg, this.utility(resource), edge, resource, direction, amount);
    return offer.ok ? offer.price : null;
  }

  /** Strikes a Neighbor Deal (amount defaults to the maximum). It runs until cancelled or until a side can't keep it (grace, then probation). */
  makeDeal(edge: 0 | 1 | 2 | 3, resource: DealResource, direction: 'buy' | 'sell', amount?: number): ToolResult {
    this.settle();
    const s = this.state;
    if (!isEdge(edge) || !DEAL_RESOURCES.includes(resource) || (direction !== 'buy' && direction !== 'sell')) {
      return { ok: false, cost: 0, message: 'no such deal' };
    }
    const offer = evaluateDeal(s, this.cfg, this.utility(resource), edge, resource, direction, amount === undefined ? undefined : Math.round(amount));
    if (!offer.ok) return { ok: false, cost: 0, message: offer.reason };
    const a = Math.round(amount ?? offer.maxAmount);
    if (!Number.isFinite(a) || a < this.cfg.region.deals.minAmount || a > offer.maxAmount) {
      return { ok: false, cost: 0, message: `amount must be ${this.cfg.region.deals.minAmount}–${offer.maxAmount}` };
    }
    s.neighbourDeals.push({
      id: s.nextDealId++, edge, resource, direction, amount: a, price: offer.price, startDay: s.day, status: 'active', monthsLeft: 0,
    });
    this.networkDirty = true;
    return { ok: true, cost: 0 };
  }

  /** Cancels a Neighbor Deal (no penalty). */
  cancelDeal(id: number): boolean {
    this.settle();
    const s = this.state;
    const before = s.neighbourDeals.length;
    s.neighbourDeals = s.neighbourDeals.filter((d) => d.id !== id);
    this.networkDirty = true;
    return s.neighbourDeals.length < before;
  }

  /** Deals that fell through since the last call (breached past their grace or probation). */
  /** Deals whose price was set again on their anniversary since the last call (with the old price). */
  takeRepricedDeals(): { deal: NeighbourDeal; was: number }[] {
    return this.repricedDeals.splice(0);
  }

  takeEndedDeals(): NeighbourDeal[] {
    return this.endedDeals.splice(0);
  }

  /** Ordinances repealed since the last call because the building they need is gone. */
  takeRepealedOrdinances(): OrdinanceId[] {
    return this.repealed.splice(0);
  }

  /** Damage reports since the last call (disasters, explosions, sinkholes, spills). */
  takeReports(): DamageReport[] {
    return this.reports.splice(0);
  }

  /**
   * Has the city been founded: anything built or zoned yet? Until then the land is shaped for free, as
   * before a city is established in SimCity 4 (afterwards terraforming is costly).
   */
  established(): boolean {
    const s = this.state;
    if (s.structures.size || s.buildings.size) return true;
    for (let i = 0; i < s.net.length; i++) if (s.net[i] || s.zone[i] || s.power[i] || s.pipe[i] || s.elevated[i] || s.tunnel[i]) return true;
    return false;
  }

  /**
   * Terrain tool: digs water or fills it in over a rectangle. Only open tiles
   * change (no buildings, zones, networks or pipes).
   */
  terraform(x0: number, y0: number, x1: number, y1: number, to: 'water' | 'land' | 'raise' | 'lower'): ToolResult {
    this.settle();
    const s = this.state;
    if (to === 'raise' || to === 'lower') return this.reshape(x0, y0, x1, y1, to === 'raise' ? 1 : -1);
    const want = to === 'water' ? Terrain.Water : Terrain.Land;
    const { tiles, cost } = this.planTerraform(x0, y0, x1, y1, to);
    if (cost > s.funds) return { ok: false, cost: 0, message: 'not enough funds' };
    // Filled-in land comes up level with its surroundings.
    let avg = 0;
    let k = 0;
    for (const [x, y] of this.rect(x0 - 1, y0 - 1, x1 + 1, y1 + 1)) {
      const i = idx(s, x, y);
      if (s.terrain[i] !== Terrain.Water) {
        avg += s.height[i]!;
        k++;
      }
    }
    const fill = k ? Math.round(avg / k) : this.cfg.terrain.heights.flat;
    for (const i of tiles) {
      s.terrain[i] = want;
      s.landform[i] = 0;
      if (want === Terrain.Water) s.trees[i] = 0; // no trees on water
      s.height[i] = want === Terrain.Water ? 0 : fill;
    }
    s.funds -= cost;
    this.networkDirty = true;
    return { ok: tiles.length > 0, cost };
  }

  /** What a terraform drag would change and cost, without changing it (the tiles it can't touch left out). */
  previewTerraform(x0: number, y0: number, x1: number, y1: number, to: 'water' | 'land' | 'raise' | 'lower'): { ok: boolean; cost: number; tiles: number; message?: string } {
    const { tiles, cost } = this.planTerraform(x0, y0, x1, y1, to);
    return { ok: tiles.length > 0 && cost <= this.state.funds, cost, tiles: tiles.length, ...(cost > this.state.funds ? { message: 'not enough funds' } : {}) };
  }

  /** What planting a rectangle would cost: open land only (see plantTrees). */
  previewTrees(x0: number, y0: number, x1: number, y1: number): { ok: boolean; cost: number; tiles: number; message?: string } {
    const tiles = this.planTrees(x0, y0, x1, y1);
    const cost = tiles.length * this.cfg.flora.saplingCost;
    return { ok: tiles.length > 0 && cost <= this.state.funds, cost, tiles: tiles.length, ...(cost > this.state.funds ? { message: 'not enough funds' } : {}) };
  }

  /** Land raised or lowered one step (within the ceiling and floor). */
  private reshaped(h: number, dir: number): number {
    return Math.max(1, Math.min(250, h + dir * this.cfg.terrain.terraform.metres));
  }

  /** The tiles a terraform drag changes and its cost (free until the city is founded). */
  private planTerraform(x0: number, y0: number, x1: number, y1: number, to: 'water' | 'land' | 'raise' | 'lower'): { tiles: number[]; cost: number } {
    this.settle();
    const s = this.state;
    const tiles: number[] = [];
    if (to === 'raise' || to === 'lower') {
      const dir = to === 'raise' ? 1 : -1;
      for (const [x, y] of this.rect(x0, y0, x1, y1)) {
        const i = idx(s, x, y);
        if (s.terrain[i] === Terrain.Water || s.occupant[i] || s.net[i] || s.pipe[i] || s.power[i] || s.elevated[i] || s.rubble[i]) continue;
        // (Land already at the ceiling or floor can't go further: not charged.)
        if (this.reshaped(s.height[i]!, dir) === s.height[i]) continue;
        tiles.push(i);
      }
      return { tiles, cost: this.established() ? tiles.length * this.cfg.terrain.terraform.cost : 0 };
    }
    const want = to === 'water' ? Terrain.Water : Terrain.Land;
    for (const [x, y] of this.rect(x0, y0, x1, y1)) {
      const i = idx(s, x, y);
      if (s.terrain[i] === want) continue;
      if (s.occupant[i] || s.net[i] || s.zone[i] || s.pipe[i] || s.power[i] || s.elevated[i] || s.rubble[i]) continue;
      if (want === Terrain.Water && s.landform[i] === Landform.Cone) continue;
      tiles.push(i);
    }
    return { tiles, cost: this.established() ? tiles.length * this.cfg.disasters.terraformCost : 0 };
  }

  /** Open land in a rectangle that takes a sapling. */
  private planTrees(x0: number, y0: number, x1: number, y1: number): number[] {
    this.settle();
    const s = this.state;
    const tiles: number[] = [];
    for (const [x, y] of this.rect(x0, y0, x1, y1)) {
      const i = idx(s, x, y);
      if (s.trees[i] || s.terrain[i] === Terrain.Water || s.occupant[i] || s.net[i] || s.rubble[i] || s.zone[i] === LANDFILL_ZONE) continue;
      if (s.landform[i] === Landform.Cone) continue;
      tiles.push(i);
    }
    return tiles;
  }

  /**
   * Plant Flora: saplings (§3 each) on open land in a rectangle. They grow
   * for about four years, clean the air around them and, when planted, give
   * the neighbourhood a small lift.
   */
  plantTrees(x0: number, y0: number, x1: number, y1: number): ToolResult {
    this.settle();
    const s = this.state;
    const fl = this.cfg.flora;
    const tiles = this.planTrees(x0, y0, x1, y1);
    const cost = tiles.length * fl.saplingCost;
    if (cost > s.funds) return { ok: false, cost: 0, message: 'not enough funds' };
    for (const i of tiles) s.trees[i] = 1;
    s.funds -= cost;
    if (tiles.length) {
      const ax = Math.round((Math.min(x0, x1) + Math.max(x0, x1)) / 2);
      const ay = Math.round((Math.min(y0, y1) + Math.max(y0, y1)) / 2);
      s.events.push({ x: ax, y: ay, radius: fl.event.radius + Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2, amount: fl.event.amount, months: fl.event.months, age: 0 });
    }
    this.effectsDirty = true;
    return { ok: tiles.length > 0, cost };
  }

  /** Raises or lowers open land in a rectangle by one step. */
  private reshape(x0: number, y0: number, x1: number, y1: number, dir: 1 | -1): ToolResult {
    const s = this.state;
    const { tiles, cost } = this.planTerraform(x0, y0, x1, y1, dir > 0 ? 'raise' : 'lower');
    if (cost > s.funds) return { ok: false, cost: 0, message: 'not enough funds' };
    for (const i of tiles) s.height[i] = this.reshaped(s.height[i]!, dir);
    s.funds -= cost;
    this.networkDirty = true;
    return { ok: tiles.length > 0, cost };
  }

  /** Flattens volcano cones and slopes (and other scars) in a rectangle. */
  levelLandform(x0: number, y0: number, x1: number, y1: number): ToolResult {
    this.settle();
    const s = this.state;
    const tiles: number[] = [];
    let cost = 0;
    for (const [x, y] of this.rect(x0, y0, x1, y1)) {
      const i = idx(s, x, y);
      if (!s.landform[i]) continue;
      tiles.push(i);
      if (s.landform[i] === Landform.Cone || s.landform[i] === Landform.Slope) cost += this.cfg.disasters.levelCost;
    }
    if (cost > s.funds) return { ok: false, cost: 0, message: 'not enough funds' };
    // Each volcano or crater brought down (or filled) to the land around it: the lowest unscarred tile on its
    // rim, else the lowest rim tile at all. Fault lines keep their heights, and
    // so does any tile with something built on it (as the terrain tools leave them).
    const reshaped = new Set(tiles.filter((i) => s.landform[i] !== Landform.Fault));
    const done = new Set<number>();
    for (const start of reshaped) {
      if (done.has(start)) continue;
      const scar = [start];
      done.add(start);
      let plain = Infinity;
      let any = Infinity;
      for (let k = 0; k < scar.length; k++) {
        const i = scar[k]!;
        const x = i % s.size;
        const y = Math.floor(i / s.size);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!inBounds(s, x + dx, y + dy)) continue;
          const j = idx(s, x + dx, y + dy);
          if (reshaped.has(j)) {
            if (!done.has(j)) {
              done.add(j);
              scar.push(j);
            }
            continue;
          }
          if (s.terrain[j] === Terrain.Water) continue;
          any = Math.min(any, s.height[j]!);
          if (!s.landform[j]) plain = Math.min(plain, s.height[j]!);
        }
      }
      const base = Number.isFinite(plain) ? plain : any;
      if (!Number.isFinite(base)) continue;
      for (const i of scar) {
        if (s.terrain[i] === Terrain.Water || s.occupant[i] || s.net[i] !== Net.None || s.elevated[i]) continue;
        s.height[i] = base;
      }
    }
    for (const i of tiles) s.landform[i] = 0;
    s.funds -= cost;
    this.networkDirty = true;
    return { ok: tiles.length > 0, cost };
  }

  private damageContext(kind: DamageReport['kind'], x: number, y: number, into?: DamageReport): DisasterContext {
    const s = this.state;
    const ec = this.cfg.economy;
    const report: DamageReport = into ?? {
      kind, day: s.day, x, y, buildings: 0, structures: 0, networkTiles: 0, undergroundTiles: 0, fires: 0, rebuildCost: 0,
    };
    const fires = this.fireContext();
    return {
      s, f: this.fields, cfg: this.cfg, rng: this.rng, report,
      destroyTile: (i, networks, surface) => {
        const occ = s.occupant[i]!;
        // Burning lots are destroyed too (fires go out with them).
        if (occ > 0) {
          const b = s.buildings.get(occ);
          if (b) {
            s.fires = s.fires.filter((fi) => fi.target !== occ);
            this.removeBuilding(b);
            for (const j of footprint(s, b)) s.rubble[j] = 1;
            report.buildings++;
            report.rebuildCost += b.w * b.h * this.cfg.safety.rubbleBulldoze;
          }
        } else if (occ < 0) {
          const st = s.structures.get(-occ);
          if (st) {
            const def = this.cfg.structures[st.kind];
            s.fires = s.fires.filter((fi) => fi.target !== occ);
            for (const j of footprint(s, st)) s.rubble[j] = 1;
            // (Flattened, a plant is rubble like any lot: it explodes only at the end of its life or
            // burned down; a tornado or a robot set off the blast and its ring of fires.)
            {
              for (const j of footprint(s, st)) s.occupant[j] = 0;
              s.structures.delete(st.id);
              report.structures++;
              report.rebuildCost += def.cost + st.w * st.h * this.cfg.safety.rubbleBulldoze;
            }
          }
        }
        if (networks && s.net[i] && !(surface && s.tunnel[i] === SPAN.tunnel)) {
          const kindName = NETWORK_KINDS[s.net[i]!]!;
          report.networkTiles++;
          report.rebuildCost += ec.networkCost[kindName].build;
          s.net[i] = Net.None;
          s.oneway[i] = 0;
          s.tolls[i] = 0;
          s.links[i] = 0;
          s.interchange[i] = 0;
          s.tunnel[i] = 0;
          s.potholes[i] = 0;
          s.railDamage[i] = 0;
          if (s.terrain[i] !== Terrain.Water) s.rubble[i] = 1;
        }
        if (networks && (s.power[i] || s.elevated[i])) {
          report.networkTiles++;
          s.power[i] = 0;
          if (s.tolls[i] === 2) s.tolls[i] = 0;
          s.elevated[i] = 0;
        }
      },
      breakUnderground: (i) => {
        if (s.pipe[i]) {
          s.pipe[i] = 0;
          report.undergroundTiles++;
          report.rebuildCost += this.cfg.services.pipeCost.build;
        }
        if (s.subway[i]) {
          s.subway[i] = 0;
          s.transitions = s.transitions.filter((t) => t !== i);
          report.undergroundTiles++;
          report.rebuildCost += ec.networkCost.subway.build;
        }
      },
      igniteTile: (i, stage) => {
        const occ = s.occupant[i]!;
        if (occ ? ignite(fires, occ, stage) : igniteTree(fires, i)) report.fires++;
      },
    };
  }

  private finishDamage(ctx: DisasterContext): void {
    const r = ctx.report;
    if (r.buildings + r.structures + r.networkTiles + r.undergroundTiles + r.fires > 0 || r.kind === 'meltdown') {
      this.reports.push(r);
    }
    this.networkDirty = true;
  }

  /** Sparking lines, bursting pipes, rail damage, derailments, toxic spills and pileups (monthly). */
  private *miniDisastersSteps(): Generator<void, void> {
    const s = this.state;
    const n = s.size;
    const { sparks, bursts } = wearUtilities(s, this.cfg, this.rng);
    yield;
    const fires = this.fireContext();
    for (const i of sparks) {
      // A spark lands on a neighbouring building or tree.
      const x = i % n;
      const y = (i - x) / n;
      // (Lots by their occupant, or an empty wooded tile: it never landed on trees.)
      const near: { lot?: number; tree?: number }[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!(dx || dy) || !inBounds(s, x + dx, y + dy)) continue;
          const j = (y + dy) * n + x + dx;
          if (s.occupant[j]) near.push({ lot: s.occupant[j]! });
          else if (s.trees[j]) near.push({ tree: j });
        }
      }
      if (near.length) {
        const pick = near[Math.floor(this.rng.next() * near.length)]!;
        if (pick.tree !== undefined) igniteTree(fires, pick.tree);
        else ignite(fires, pick.lot!);
      }
    }
    for (const i of bursts) {
      // The sinkhole destroys everything on the surrounding land; the pipe is gone.
      const x = i % n;
      const y = (i - x) / n;
      const ctx = this.damageContext('sinkhole', x, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inBounds(s, x + dx, y + dy)) ctx.destroyTile((y + dy) * n + x + dx, false);
      ctx.breakUnderground(i);
      this.finishDamage(ctx);
    }
    yield;
    damageRail(s, this.cfg, this.rng);
    yield;
    for (const i of derailments(s, this.fields, this.cfg, this.rng)) s.spills.push({ i, months: 0 });
    yield;
    pileups(s, this.fields, this.cfg, this.rng);
    // Toxic spills: fire crews sent there neutralise them (daily, see neutraliseSpills);
    // left a month, they leave radiation.
    const sp = this.cfg.disasters.spill;
    s.spills = s.spills.filter((spill) => {
      if (++spill.months <= 1) return true;
      const x = spill.i % n;
      const y = (spill.i - x) / n;
      for (let dy = -sp.radiationRadius; dy <= sp.radiationRadius; dy++) {
        for (let dx = -sp.radiationRadius; dx <= sp.radiationRadius; dx++) {
          if (inBounds(s, x + dx, y + dy) && Math.hypot(dx, dy) <= sp.radiationRadius) {
            const j = (y + dy) * n + x + dx;
            if (s.radiation[j]! < 255) s.radiation[j] = Math.max(s.radiation[j]!, sp.radiationMonths);
          }
        }
      }
      this.reports.push({ kind: 'spill', day: s.day, x, y, buildings: 0, structures: 0, networkTiles: 0, undergroundTiles: 0, fires: 0, rebuildCost: 0 });
      return false;
    });
    s.incidents = s.incidents.filter((e) => s.day - e.day < 30);
  }

  // -------------------------------------------------------------- helpers

  private removeBuilding(b: Building): void {
    for (const i of footprint(this.state, b)) {
      if (this.state.occupant[i] === b.id) this.state.occupant[i] = 0;
    }
    this.state.buildings.delete(b.id);
    this.censusStale = true;
    // Redevelopment replaces buildings constantly; fields catch up at the
    // weekly refresh. Tools that remove buildings mark the map dirty themselves.
  }

  /** Starts a fire on whatever stands at (x, y) (testing / disasters). */
  igniteAt(x: number, y: number): boolean {
    this.settle();
    const occ = this.state.occupant[idx(this.state, x, y)]!;
    if (!occ) return false;
    return ignite(this.fireContext(), occ);
  }

  private fireContext(): FireContext {
    return {
      s: this.state, f: this.fields, cfg: this.cfg, rng: this.rng,
      destroy: (target) => this.burnDown(target),
    };
  }

  /** A building or structure that burned down leaves rubble; plants explode. */
  private burnDown(target: number): void {
    const s = this.state;
    if (target > 0) {
      const b = s.buildings.get(target);
      if (!b) return;
      this.removeBuilding(b);
      for (const i of footprint(s, b)) s.rubble[i] = 1;
      // Like a building that goes up or is abandoned, the spatial fields catch
      // up at the next periodic refresh (roads, zones and terrain are
      // untouched, and commuters to a lost workplace look again when traffic
      // is assigned). A refresh per fire was most of a big city's cost.
      return;
    }
    const st = s.structures.get(-target);
    if (!st) return;
    if (this.cfg.structures[st.kind].plant) this.explode(st);
    else {
      for (const i of footprint(s, st)) s.occupant[i] = 0;
      s.structures.delete(st.id);
    }
    for (const i of footprint(s, st)) s.rubble[i] = 1;
    this.networkDirty = true;
  }

  /** Which emergency units are working on site (to notice arrivals and departures). */
  private unitsOnSite(): string {
    let key = '';
    for (const u of this.state.units) if (u.travel <= 0) key += `${u.id},`;
    return key;
  }

  private devContext(): DevContext {
    return {
      s: this.state,
      cfg: this.cfg,
      f: this.fields,
      desir: this.desirability,
      census: this.census,
      demand: this.demand,
      rng: this.rng,
      nextId: () => this.state.nextId++,
      removeBuilding: (b) => {
        this.removeBuilding(b);
        // Redevelopment may leave part of the old lot free.
        this.tractFull.clear();
      },
      tractCache: this.tractCache,
      tractFull: this.tractFull,
    };
  }

  private *rect(x0: number, y0: number, x1: number, y1: number): Generator<[number, number]> {
    const n = this.state.size;
    [x0, y0, x1, y1] = [x0, y0, x1, y1].map(Math.round) as [number, number, number, number];
    const ax = Math.max(0, Math.min(x0, x1));
    const bx = Math.min(n - 1, Math.max(x0, x1));
    const ay = Math.max(0, Math.min(y0, y1));
    const by = Math.min(n - 1, Math.max(y0, y1));
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) yield [x, y];
  }
}
