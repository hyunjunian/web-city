// Per-tile desirability for each developer type:
// baseline + Σ factor contributions, each clamped to its max/min.

import { drain } from './steps';
import type { SimConfig } from '../config';
import type { Range } from '../data/desirability';
import { DEV_TYPES, type DevType, type PerType } from '../types';
import { INF, type Fields } from './fields';
import { Terrain, zoneClassFor, zoneInfo, type CityState } from './state';

export type DesirabilityMap = PerType<Float32Array>;

export function createDesirability(n: number): DesirabilityMap {
  const out = {} as DesirabilityMap;
  for (const t of DEV_TYPES) out[t] = new Float32Array(n * n);
  return out;
}

/** Linear ramp from `range.max` at good=1 to `range.min` at good=0. */
function between(range: Range, good: number): number {
  const g = Math.min(1, Math.max(0, good));
  return range[1] + (range[0] - range[1]) * g;
}

/** Positive values scale toward the maximum, negative toward the minimum, saturating at `full`. */
function signed(range: Range, value: number, full: number): number {
  if (value >= 0) return range[0] * Math.min(1, value / full);
  return range[1] * Math.min(1, -value / full);
}

/** Short trips are good, long trips bad; unreachable is the minimum. */
function tripScore(range: Range, cost: number, short: number, long: number): number {
  if (cost >= INF) return range[1];
  if (cost <= short) return range[0];
  if (cost >= long) return range[1];
  return between(range, 1 - (cost - short) / (long - short));
}

/** min at quality 0, 0 at the tolerance, max at quality 1. */
function toleranceScore(range: Range, q: number, tol: number): number {
  if (q >= tol) return range[0] * (tol >= 1 ? 0 : (q - tol) / (1 - tol));
  return range[1] * (1 - q / tol);
}

export interface FactorBreakdown {
  baseline: number;
  factors: Record<string, number>;
  total: number;
}

/** Everything `scoreTile` reads from the config for one type, looked up once per pass. */
interface TypeConsts {
  cls: string;
  /** The type's wealth (residents weigh their commute to jobs of it). */
  wealth: number;
  baseline: number;
  air: Range; airTol: number; airSaturation: number;
  landValue: Range; pref: 'low' | 'medium' | 'high'; lvMax: number;
  prox: [Range, Range, Range]; maxDist: number; resFull: number;
  coProx2: Range; coProx3: Range;
  resNimby: Range; comNimby: Range; nimbyFull: number;
  slope: Range; flat: number; medium: number;
  traffic: Range; trafficHigh: number;
  trip: Range; streetCar: number; tripShort: number; tripLong: number;
  health: Range; healthTol: number; school: Range; schoolTol: number;
  crime: Range; crimeMax: number; crimeTol: number;
  eventScale: number;
  garbage: Range; gtol: number; gSaturation: number;
}

function typeConsts(cfg: SimConfig, t: DevType): TypeConsts {
  const d = cfg.desirability;
  const R = d.factorRange;
  const w = cfg.demand.wealthOf[t];
  return {
    cls: t[0]!,
    wealth: w,
    baseline: d.baseline[t],
    air: R.air[t], airTol: d.airTolerance[t], airSaturation: d.airSaturation,
    landValue: R.landValue[t], pref: d.landValuePref[t] as TypeConsts['pref'], lvMax: d.waterLandValue.max,
    prox: [R.rProx1[t], R.rProx2[t], R.rProx3[t]], maxDist: d.proximityDistanceMax, resFull: d.resProximityFull,
    coProx2: R.coProx2[t], coProx3: R.coProx3[t],
    resNimby: R.resNimby[t], comNimby: R.comNimby[t], nimbyFull: d.nimbyFull,
    slope: R.slope[t], flat: cfg.terrain.slope.flat, medium: cfg.terrain.slope.medium,
    traffic: R.traffic[t], trafficHigh: d.trafficHigh,
    trip: R.trip[t], streetCar: cfg.transport.speed.street.car, tripShort: d.tripShort, tripLong: d.tripLong,
    health: R.health[t], healthTol: cfg.services.healthTolerance[w], school: R.school[t], schoolTol: cfg.services.schoolTolerance[w],
    crime: R.crime[t], crimeMax: cfg.safety.crimeLevelMax, crimeTol: 1 - cfg.safety.crimeTolerance[t] / cfg.safety.crimeLevelMax,
    eventScale: cfg.safety.eventToDesirability,
    garbage: R.garbage[t], gtol: cfg.garbage.tolerance[w], gSaturation: cfg.garbage.saturation,
  };
}

/**
 * Desirability of tile `i` for type `t`. When `out` is given, each factor's
 * contribution is recorded there too; the bulk pass and the query tool share
 * this function so they always agree.
 */
export function scoreTile(
  s: CityState, f: Fields, cfg: SimConfig, t: DevType, i: number, out: Record<string, number> | null,
): number {
  return score(s, f, typeConsts(cfg, t), i, out);
}

/** `scoreTile` with the type's constants at hand; no closures or allocations, as it runs for every tile and type. */
function score(s: CityState, f: Fields, k: TypeConsts, i: number, out: Record<string, number> | null): number {
  if (s.terrain[i] === Terrain.Water) return 0;
  // Radiation: nothing wants to live or work here (desirability −2000).
  if (s.radiation[i]) {
    if (out) out.radiation = -2000;
    return 0;
  }
  const cls = k.cls;
  let total = k.baseline;
  let v: number;

  // Air pollution: positive near zero, negative past the type's tolerance.
  const air = f.air[i]!;
  const tol = k.airTol;
  v = air <= tol
    ? k.air[0] * (1 - air / tol)
    : k.air[1] * Math.min(1, (air - tol) / Math.max(1, k.airSaturation - tol));
  total += v;
  if (out) out.air = v;

  // Land value preference (low / medium / high).
  const lv = f.landValue[i]! / k.lvMax;
  const pref = k.pref;
  v = between(k.landValue, pref === 'low' ? 1 - lv : pref === 'high' ? lv : 1 - Math.abs(lv - 0.5) * 2);
  total += v;
  if (out) out.landValue = v;

  // Proximity: residents like their own wealth nearby and dislike others;
  // commerce dislikes distance from residents / offices of its wealth.
  for (let w = 0; w < 3; w++) {
    const range = k.prox[w]!;
    if (range[0] === 0 && range[1] === 0) continue;
    if (cls === 'R') {
      const near = Math.min(1, f.resNear[w as 0][i]! / k.resFull);
      v = range[0] > 0 ? range[0] * near : range[1] * near;
    } else v = range[1] * Math.min(1, f.distRes[w as 0][i]! / k.maxDist);
    total += v;
    if (out) out[`rProx${w + 1}`] = v;
  }
  if (k.coProx2[1] !== 0) {
    v = k.coProx2[1] * Math.min(1, f.distCo2[i]! / k.maxDist);
    total += v;
    if (out) out.coProx2 = v;
  }
  if (k.coProx3[1] !== 0) {
    v = k.coProx3[1] * Math.min(1, f.distCo3[i]! / k.maxDist);
    total += v;
    if (out) out.coProx3 = v;
  }

  // NIMBY / YIMBY fields from parks and other structures.
  if (k.resNimby[0] !== 0) {
    v = signed(k.resNimby, f.nimbyRes[i]!, k.nimbyFull);
    total += v;
    if (out) out.resNimby = v;
  }
  if (k.comNimby[0] !== 0) {
    v = signed(k.comNimby, f.nimbyCom[i]!, k.nimbyFull);
    total += v;
    if (out) out.comNimby = v;
  }

  // Industry likes flat land: the full bonus on flat ground, half on a
  // medium slope, nothing on steep hills.
  if (k.slope[0] !== 0) {
    const sl = f.slope[i]!;
    v = sl <= k.flat ? k.slope[0] : sl <= k.medium ? k.slope[0] / 2 : 0;
    total += v;
    if (out) out.slope = v;
  }

  // Traffic on the nearest road: commerce wants it, residents and farms don't.
  const road = f.access[i]!;
  if (k.traffic[0] !== 0) {
    // (A highway beside the lot counts too: its volume hurts homes and farms and helps commerce.)
    const traffic = Math.min(1, Math.max(road >= 0 ? f.traffic[road]! : 0, f.highwayNoise[i]!) / k.trafficHigh);
    v = cls === 'C' ? between(k.traffic, Math.sqrt(traffic)) : between(k.traffic, 1 - traffic);
    total += v;
    if (out) out.traffic = v;
  }

  // Commute (residential) or freight trip (industrial) length.
  if (k.trip[0] !== 0) {
    const field = cls === 'R' ? f.commuteByWealth[k.wealth]! : f.freight;
    // Residents count the trip to open jobs: none if their road network has fewer jobs than workers.
    const open = cls !== 'R' || (road >= 0 && f.componentHasJobs[f.component[road]!] === 1);
    const cost = open && road >= 0 && field[road]! < INF ? field[road]! + f.accessDist[i]! * k.streetCar : INF;
    v = tripScore(k.trip, cost, k.tripShort, k.tripLong);
    total += v;
    if (out) out.trip = v;
  }

  // Health and schools (residential only): uncovered tracts get the minimum;
  // past a per-wealth tolerance the effect turns positive up to the maximum.
  if (cls === 'R') {
    v = toleranceScore(k.health, f.healthQuality[i]!, k.healthTol);
    total += v;
    if (out) out.health = v;
    v = toleranceScore(k.school, f.schoolQuality[i]!, k.schoolTol);
    total += v;
    if (out) out.school = v;
  }

  // Crime: low crime helps, beyond the type's tolerance it hurts.
  v = toleranceScore(k.crime, 1 - Math.min(1, s.crime[i]! / k.crimeMax), k.crimeTol);
  total += v;
  if (out) out.crime = v;

  // Rush Hour: short-term Mayor Rating effects (fires, …) move desirability.
  if (f.events[i]) {
    v = Math.max(-100, Math.min(100, f.events[i]! * k.eventScale));
    total += v;
    if (out) out.events = v;
  }

  // Piled garbage on the tile: a little is tolerated (more by lower wealth),
  // more turns negative. Industry barely notices (5/−5).
  const gtol = k.gtol;
  const pile = s.garbage[i]!;
  v = pile <= gtol
    ? k.garbage[0] * (1 - pile / gtol)
    : k.garbage[1] * Math.min(1, (pile - gtol) / (k.gSaturation - gtol));
  total += v;
  if (out) out.garbage = v;

  return total > 0 ? total : 0;
}

export function factorsAt(s: CityState, f: Fields, cfg: SimConfig, t: DevType, i: number): FactorBreakdown {
  const factors: Record<string, number> = {};
  const total = scoreTile(s, f, cfg, t, i, factors);
  return { baseline: cfg.desirability.baseline[t], factors, total };
}

/**
 * Desirability of each type on the tiles zoned for it (the only ones
 * development and occupancy read); other tiles are left at 0. Use
 * `computeDesirabilityEverywhere` for a full map (overlays).
 */
export function computeDesirability(s: CityState, f: Fields, cfg: SimConfig, out: DesirabilityMap): void {
  drain(computeDesirabilitySteps(s, f, cfg, out));
}

/** `computeDesirability` in steps (see ./steps). */
export function* computeDesirabilitySteps(s: CityState, f: Fields, cfg: SimConfig, out: DesirabilityMap): Generator<void, void> {
  const N = s.size * s.size;
  // Zone class per zone code, looked up once per code rather than per tile.
  const codeCls: (string | null)[] = [];
  yield;
  for (let c = 0; c < 16; c++) codeCls.push(zoneInfo(c).cls);
  yield;
  // The zoned tiles of each class, gathered in one pass: each type then scores only its own class's
  // tiles (twelve passes over the whole map, mostly unzoned, were most of the time on a big map).
  const tiles = new Map<string, number[]>();
  for (let i = 0; i < N; i++) {
    const cls = codeCls[s.zone[i]!];
    if (!cls) continue;
    let list = tiles.get(cls);
    if (!list) tiles.set(cls, (list = []));
    list.push(i);
  }
  yield;
  for (const t of DEV_TYPES) {
    const arr = out[t];
    const k = typeConsts(cfg, t);
    arr.fill(0);
    const list = tiles.get(zoneClassFor(t)) ?? [];
    for (let j = 0; j < list.length; j++) {
      if ((j & 0x3fff) === 0x3fff) yield;
      const i = list[j]!;
      arr[i] = score(s, f, k, i, null);
    }
    yield;
  }
}

/** Desirability of one type on every tile. */
export function computeDesirabilityEverywhere(s: CityState, f: Fields, cfg: SimConfig, t: DevType, out: Float32Array): void {
  const k = typeConsts(cfg, t);
  for (let i = 0; i < out.length; i++) out[i] = score(s, f, k, i, null);
}
