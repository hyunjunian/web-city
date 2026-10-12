// All tunable simulation data in one object. Every value comes from
// src/engine/data; pass overrides to `new City({ config })` to tune the
// model without touching code.

import * as demand from './data/demand';
import * as desir from './data/desirability';
import * as buildings from './data/buildings';
import * as economy from './data/economy';
import * as sv from './data/services';
import * as sf from './data/safety';
import * as gb from './data/garbage';
import * as mr from './data/mayor';
import * as tr from './data/transport';
import * as ds from './data/disasters';
import * as rg from './data/region';
import { FLORA } from './data/flora';
import { MY_SIMS } from './data/mysims';
import * as tn from './data/terrain';
import { DIFFICULTY } from './data/difficulty';
import { STAGE_TABLE, DENSITY_MAX_STAGE } from './data/stages';
import { STRUCTURES } from './data/structures';

export const DEFAULT_CONFIG = {
  demand: {
    wealthOf: demand.WEALTH_OF,
    workforceProfile: demand.WORKFORCE_PROFILE,
    businessProfile: demand.BUSINESS_PROFILE,
    initialCaps: demand.INITIAL_CAPS,
    startQuotient: demand.START_QUOTIENT,
    connectionRelief: demand.CONNECTION_RELIEF,
    freightTripRelief: demand.FREIGHT_TRIP_RELIEF,
    neutralTax: demand.NEUTRAL_TAX,
    defaultTaxRate: demand.DEFAULT_TAX_RATE,
    taxImpact: demand.TAX_IMPACT,
    taxMemoryDays: demand.TAX_MEMORY_DAYS,
    eqThresholds: demand.EQ_THRESHOLDS,
    baseJobs: demand.BASE_JOBS,
    baseBusiness: demand.BASE_BUSINESS,
    halfSaturation: demand.DEMAND_HALF_SATURATION,
    freightTripsPerJob: demand.FREIGHT_TRIPS_PER_JOB,
    exodusDemand: demand.EXODUS_DEMAND,
    exodusRate: demand.EXODUS_RATE,
    exodusSlack: demand.EXODUS_SLACK,
  },
  desirability: {
    factorRange: desir.FACTOR_RANGE,
    baseline: desir.BASELINE,
    developThreshold: desir.DEVELOP_THRESHOLD,
    fullOccupancy: desir.FULL_OCCUPANCY_DESIRABILITY,
    distress: desir.DISTRESS_DESIRABILITY,
    airTolerance: desir.AIR_TOLERANCE,
    airSaturation: desir.AIR_SATURATION,
    landValuePref: desir.LAND_VALUE_PREF,
    waterLandValue: desir.WATER_LAND_VALUE,
    resProximityRadius: desir.RES_PROXIMITY_RADIUS,
    resProximityFull: desir.RES_PROXIMITY_FULL,
    proximityDistanceMax: desir.PROXIMITY_DISTANCE_MAX,
    trafficHigh: desir.TRAFFIC_HIGH,
    tripShort: desir.TRIP_SHORT,
    tripLong: desir.TRIP_LONG,
    nimbyFull: desir.NIMBY_FULL,
  },
  development: {
    stageTable: STAGE_TABLE,
    densityMaxStage: DENSITY_MAX_STAGE,
    templates: buildings.STAGE_TEMPLATES,
    capacityMult: buildings.CAPACITY_MULT,
    lotBonus: buildings.LOT_BONUS,
    canDisplace: buildings.CAN_DISPLACE,
    downgrade: buildings.DOWNGRADE,
    airPollution: buildings.AIR_POLLUTION,
    waterPollution: buildings.WATER_POLLUTION,
    trafficPollution: buildings.TRAFFIC_POLLUTION,
    /** Tract edge length in tiles (16-tile tracts). */
    tractSize: 4,
    /** Development attempts per day, plus one per this many map tiles. */
    attemptsPerDay: 2,
    tilesPerExtraAttempt: 2048,
    /** Top-ranked tracts tried per attempt. */
    tractsPerAttempt: 24,
    /** Industrial lots may sit this far (through I zone) from a road. */
    industrialReach: 7,
    /** Months below distress desirability before downgrade/abandonment. */
    distressMonths: 3,
    /**
     * A business staffed below this share of its jobs distresses when the Sims
     * it needs can't move in (an IHT with no R$$ to hire). The share is an assumption.
     */
    understaffed: 0.5,
    /** Months without road access before abandonment. */
    noRoadMonths: 2,
    /** Days between full desirability recomputes. */
    desirabilityInterval: 7,
    /** Nothing develops without power. Off only for tests and experiments. */
    requirePower: true,
    /** Above its water stage cap a building needs city water. */
    requireWater: true,
  },
  services: {
    plantMaintenanceByAge: sv.PLANT_MAINTENANCE_BY_AGE,
    plantOutputByAge: sv.PLANT_OUTPUT_BY_AGE,
    plantDecayByFunding: sv.PLANT_DECAY_BY_FUNDING,
    plantDecayByUsage: sv.PLANT_DECAY_BY_USAGE,
    plantDistressedLife: sv.PLANT_DISTRESSED_LIFE,
    plantExplosionRadius: sv.PLANT_EXPLOSION_RADIUS,
    powerGap: sv.POWER_GAP,
    powerLineCost: sv.POWER_LINE_COST,
    noPowerMonths: sv.NO_POWER_MONTHS,
    powerPerCapita: sv.POWER_PER_CAPITA,
    quotientMax: sv.QUOTIENT_MAX,
    quotientDecay: sv.QUOTIENT_DECAY,
    inheritance: sv.INHERITANCE,
    baseQuotient: sv.BASE_QUOTIENT,
    startAge: sv.START_AGE,
    startAgeSpread: sv.START_AGE_SPREAD,
    lifeExpectancyByHq: sv.LIFE_EXPECTANCY_BY_HQ,
    workforceByHq: sv.WORKFORCE_BY_HQ,
    hqPerBoost: sv.HQ_PER_BOOST,
    hqPerPollution: sv.HQ_PER_POLLUTION,
    hqPollutionFree: sv.HQ_POLLUTION_FREE,
    radiationPollution: sv.RADIATION_POLLUTION,
    patientFraction: sv.PATIENT_FRACTION,
    healthTolerance: sv.HEALTH_TOLERANCE,
    eduCurves: sv.EDU_CURVES,
    eduWeight: sv.EDU_WEIGHT,
    eqPerBoost: sv.EQ_PER_BOOST,
    studentFraction: sv.STUDENT_FRACTION,
    schoolTolerance: sv.SCHOOL_TOLERANCE,
    capacityByFunding: sv.CAPACITY_BY_FUNDING,
    radiusByVehicleFunding: sv.RADIUS_BY_VEHICLE_FUNDING,
    strikeEffectiveness: sv.STRIKE_EFFECTIVENESS,
    strikeChance: sv.STRIKE_CHANCE,
    strikeEndGrade: sv.STRIKE_END_GRADE,
    strikeMaxMonths: sv.STRIKE_MAX_MONTHS,
    waterMaintenanceByAge: sv.WATER_MAINTENANCE_BY_AGE,
    waterOutputByAge: sv.WATER_OUTPUT_BY_AGE,
    waterRadius: sv.WATER_RADIUS,
    pipeCost: sv.PIPE_COST,
    noWaterMonths: sv.NO_WATER_MONTHS,
    pumpPollutionLimit: sv.PUMP_POLLUTION_LIMIT,
    waterStageCap: sv.WATER_STAGE_CAP,
    waterPerCapita: sv.WATER_PER_CAPITA,
  },
  economy: {
    zoningCost: economy.ZONING_COST,
    networkCost: economy.NETWORK_COST,
    avenueRampCost: economy.AVENUE_RAMP_COST,
    elevatedAvenueRampCost: economy.ELEVATED_AVENUE_RAMP_COST,
    bridgeCostMult: economy.BRIDGE_COST_MULT,
    lowBridgeShare: economy.LOW_BRIDGE_SHARE,
    bulldozeCost: economy.BULLDOZE_COST,
    impeachmentFunds: economy.IMPEACHMENT_FUNDS,
    taxScale: economy.TAX_SCALE,
    valuePerCapacity: economy.VALUE_PER_CAPACITY,
    loans: economy.LOANS,
  },
  mayor: {
    crime: mr.MR_CRIME,
    pollution: mr.MR_POLLUTION,
    garbage: mr.MR_GARBAGE,
    nimby: mr.MR_NIMBY,
    service: mr.MR_SERVICE,
    noiseHigh: mr.MR_NOISE_HIGH,
    valueWealth: mr.MR_VALUE_WEALTH,
    limit: mr.MR_LIMIT,
    taxChange: mr.MR_TAX_CHANGE,
    eventMonths: mr.MR_EVENT_MONTHS,
    civicEvent: mr.CIVIC_EVENT,
    throwMoney: mr.THROW_MONEY,
    riot: mr.RIOT,
    riotMob: mr.RIOT_MOB,
    /** Riots can happen (off for tests about other systems). */
    riots: true,
  },
  garbage: {
    perCapita: gb.GARBAGE_PER_CAPITA,
    landfill: gb.LANDFILL,
    pickupCost: gb.PICKUP_COST,
    pileCap: gb.PILE_CAP,
    backlogPickup: gb.BACKLOG_PICKUP,
    tolerance: gb.GARBAGE_TOLERANCE,
    saturation: gb.GARBAGE_SATURATION,
    hqPollution: gb.GARBAGE_HQ_POLLUTION,
    /** Uncollected garbage piles up (off only for tests about other systems). */
    piles: true,
  },
  safety: {
    baseCriminality: sf.BASE_CRIMINALITY,
    unemploymentCrime: sf.UNEMPLOYMENT_CRIME,
    criminalsPerCrime: sf.CRIMINALS_PER_CRIME,
    carryOver: sf.CRIME_CARRY_OVER,
    maxSuppression: sf.MAX_SUPPRESSION,
    suppressionDivisor: sf.SUPPRESSION_DIVISOR,
    arrestThreshold: sf.ARREST_THRESHOLD,
    crimeTypes: sf.CRIME_TYPES,
    tourismLots: sf.TOURISM_LOTS,
    sentenceMonths: sf.SENTENCE_MONTHS,
    jailbreakTarget: sf.JAILBREAK_TARGET,
    crimeRadius: sf.CRIME_RADIUS,
    crimeDecay: sf.CRIME_DECAY,
    crimeTolerance: sf.CRIME_TOLERANCE,
    crimeLevelMax: sf.CRIME_LEVEL_MAX,
    flammabilityBase: sf.FLAMMABILITY_BASE,
    flammabilityStageBonus: sf.FLAMMABILITY_STAGE_BONUS,
    flammabilityDry: sf.FLAMMABILITY_DRY,
    flammabilityAbandoned: sf.FLAMMABILITY_ABANDONED,
    civicFlammability: sf.CIVIC_FLAMMABILITY,
    monthlyFireChance: sf.MONTHLY_FIRE_CHANCE,
    hotspotFlammability: sf.HOTSPOT_FLAMMABILITY,
    hotspotRadius: sf.HOTSPOT_RADIUS,
    hotspotChance: sf.HOTSPOT_CHANCE,
    ignitionProtection: sf.IGNITION_PROTECTION,
    protectionPerStage: sf.PROTECTION_PER_STAGE,
    fireGrowChance: sf.FIRE_GROW_CHANCE,
    fireSpreadChance: sf.FIRE_SPREAD_CHANCE,
    burnDaysAtMax: sf.BURN_DAYS_AT_MAX,
    maxBurnDays: sf.MAX_BURN_DAYS,
    treeFire: sf.TREE_FIRE,
    dispatchProtection: sf.DISPATCH_PROTECTION,
    dispatchRange: sf.DISPATCH_RANGE,
    dispatch: sf.DISPATCH,
    /** Idle fire units go to fires on their own (in SimCity 4 the player sends them). */
    autoDispatch: true,
    rubbleBulldoze: sf.RUBBLE_BULLDOZE,
    fireEvent: sf.FIRE_EVENT,
    eventToDesirability: sf.EVENT_TO_DESIRABILITY,
    funding: sf.SAFETY_FUNDING,
    fireNoRoad: sf.FIRE_NO_ROAD,
    strikeChance: sf.SAFETY_STRIKE_CHANCE,
    strikeEndFunding: sf.SAFETY_STRIKE_END_FUNDING,
    /** Fires can start (off for tests that need a calm city). */
    fires: true,
  },
  transport: {
    speed: tr.NETWORK_SPEED,
    tripLimit: tr.TRIP_LIMIT,
    airportFreightPenalty: tr.AIRPORT_FREIGHT_PENALTY,
    congestion: tr.CONGESTION,
    intersection: tr.INTERSECTION_SLOWDOWN,
    strategyOdds: tr.STRATEGY_ODDS,
    transitCarBias: tr.TRANSIT_CAR_BIAS,
    farePerTile: tr.FARE_PER_TILE,
    ferryFare: tr.FERRY_FARE,
    connectionCommute: tr.CONNECTION_COMMUTE,
    potholes: tr.POTHOLES,
    toll: tr.TOLL,
    cloverleaf: tr.CLOVERLEAF,
    roadOverpass: tr.ROAD_OVERPASS,
    freightTraffic: tr.FREIGHT_TRAFFIC_PER_JOB,
    /** Weight of a month's assigned traffic in the volumes routes are planned on (1: last month's alone). */
    trafficSmoothing: 0.4,
    subwayTransition: tr.SUBWAY_TRANSITION,
    tunnel: tr.TUNNEL,
    /** Months a resident building may go without a reachable job before it is abandoned. */
    noJobMonths: 6,
    /** A home counts as jobless when more than this share of its commuters found no open job (an assumption). */
    joblessShare: 0.5,
  },
  disasters: {
    godMode: ds.GOD_MODE,
    live: ds.LIVE_DISASTERS,
    levelCost: ds.LEVEL_COST,
    terraformCost: ds.TERRAFORM_COST,
    wear: ds.UTILITY_WEAR,
    explosion: ds.EXPLOSION,
    rail: ds.RAIL_DAMAGE,
    spill: ds.SPILL,
    pileup: ds.PILEUP,
    /** Sparks, bursts, derailments, spills and pileups (engine option; SC4 has no "disasters off"). */
    simulated: true,
  },
  flora: FLORA,
  terrain: { slope: tn.SLOPE, landValue: tn.ELEVATION_LAND_VALUE, terraform: tn.TERRAFORM_STEP, heights: tn.HEIGHTS, grayscale: tn.GRAYSCALE },
  region: {
    deals: rg.DEALS,
    dealPrice: rg.DEAL_PRICE,
    neighbourCost: rg.NEIGHBOUR_COST,
    developedTemplate: rg.DEVELOPED_TEMPLATE,
    developedUtilities: rg.DEVELOPED_UTILITIES,
    growth: rg.REGIONAL_GROWTH,
    commute: rg.NEIGHBOUR_COMMUTE,
    /** SimNation edges offer jobs at the presumed commute (SimCity 4's don't; kept for small maps). */
    simNationJobs: true,
  },
  mySims: MY_SIMS,
  difficulty: DIFFICULTY,
  structures: STRUCTURES,
};

// Constants may use literal types; a tunable numeric or boolean setting accepts other values too.
// Numeric enums (such as wealth 0 | 1 | 2) retain their allowed choices.
type IsUnion<T, Whole = T> = T extends Whole ? ([Whole] extends [T] ? false : true) : never;
type Tunable<T> = [T] extends [number] ? ([IsUnion<T>] extends [false] ? number : T)
  : T extends boolean ? boolean : T extends object ? { [K in keyof T]: Tunable<T[K]> } : T;
export type SimConfig = Tunable<typeof DEFAULT_CONFIG>;

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type ConfigOverrides = DeepPartial<SimConfig>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merges overrides onto the defaults (arrays are replaced, not merged). */
export function makeConfig(overrides: ConfigOverrides = {}): SimConfig {
  // Every city gets its own copy: changing one city's cfg (a test, a mod) must
  // not reach DEFAULT_CONFIG or any other city.
  const copy = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(copy) : isPlainObject(v) && Object.getPrototypeOf(v) === Object.prototype ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) : v;
  const merge = (base: unknown, over: unknown): unknown => {
    if (!isPlainObject(base) || !isPlainObject(over)) return copy(over === undefined ? base : over);
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(base), ...Object.keys(over)])) out[k] = merge(base[k], over[k]);
    return out;
  };
  return merge(DEFAULT_CONFIG, overrides) as SimConfig;
}
