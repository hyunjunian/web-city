// Spatial fields derived from the city state: road-network distances,
// traffic, air pollution, land value, proximity and NIMBY/YIMBY. They feed
// desirability and development. Recomputed periodically, never serialised.

import { drain } from './steps';
import type { SimConfig } from '../config';
import type { EduCurve } from '../data/structures';
import { interp } from '../data/services';
import { ordinanceEffects } from './mayor';
import { edgeOf, neighbourWorkEdges } from './region';
import { atGrade, idx, Net, tilesLinked, isAsphalt, isLocalNet, structureFunding, Terrain, zoneInfo, type Building, type CityState, type Rect } from './state';
import { connectionTiles, type TravelFields } from './transport';
import { utilityEmissionShare } from './energy';

export const INF = 0x3fffffff;

export interface Fields {
  /** Nearest network tile reachable within 3 steps (or -1) and its distance. */
  access: Int32Array;
  accessDist: Uint8Array;
  /** Road component id per network tile (-1 elsewhere). */
  component: Int32Array;
  /** Per component: does it touch a C or I zone (jobs for residents)? */
  componentHasJobs: Uint8Array;
  /**
   * Per component: does it lead to any workplace at all (a business, a civic building, or a
   * neighbour)? Enough for those already living there: a shortage of jobs is the six-month no-job rule.
   */
  componentHasWork: Uint8Array;
  /** Fastest trip (centi-hours) from each network tile to the nearest workplace. */
  commute: Float32Array;
  /** Last month's evening commute by car per tile (Traffic Data View's journey home; not averaged). */
  eveningTraffic: Float32Array;
  /** This month's trips as assigned, for the Route Query (a city just loaded replays the month for one). */
  tripLog: import('./transport').TripLog | null;
  /** Last month's average trip to a job in town, centi-hours (-1: none yet). */
  localCommute: number;
  /** The same, per wealth: to workplaces with jobs for that wealth (or a neighbour connection). */
  commuteByWealth: Float32Array[];
  /** Truck (or truck and freight rail) time from each tile to a connection. */
  freight: Float32Array;
  /** Cars and trucks per tile last month (morning trips). */
  traffic: Float32Array;
  /** Trains per rail tile and subway riders per subway tile last month. */
  railTraffic: Float32Array;
  /** Freight trains per tile (of railTraffic): where a derailment can spill toxic waste. */
  freightRail: Float32Array;
  subwayTraffic: Float32Array;
  monorailTraffic: Float32Array;
  ferryTraffic: Float32Array;
  /** Cars and trucks up on elevated highways (kept apart from the road below). */
  highTraffic: Float32Array;
  /** The busiest highway (ground or elevated) within 2 tiles: its noise reaches the lots beside it, which front only local roads. */
  highwayNoise: Float32Array;
  /** This month's travel searches (see transport.ts). */
  travel: TravelFields | null;
  /**
   * Homes whose commuters mostly found no open job this month (building id →
   * share left over), from the month's traffic; empty until it runs.
   */
  jobless: Map<number, number>;
  /** Reused search arrays, two generations (the last result stays valid while the next is computed). */
  /**
   * Reused search buffers. `touched` lists the states the last search set
   * (the first `count`), so the next one resets just those instead of the
   * whole arrays; `count` −1 means the buffers have never been cleared.
   */
  searchPool: { dist: Float32Array; time: Float32Array; next: Int32Array }[][];
  searchGen: number;
  /** The landfills' NIMBY field and the landfill tiles it was made for (it changes only with zoning). */
  landfillNimby: { tiles: string; field: Float32Array } | null;
  air: Float32Array;
  landValue: Float32Array;
  /** Largest height step to a neighbouring land tile (metres). */
  slope: Uint8Array;
  /** Residents of each wealth within the proximity radius. */
  resNear: [Float32Array, Float32Array, Float32Array];
  /** Chebyshev distance to residents of each wealth / to Co$$ and Co$$$. */
  distRes: [Int32Array, Int32Array, Int32Array];
  distCo2: Int32Array;
  distCo3: Int32Array;
  nimbyRes: Float32Array;
  nimbyCom: Float32Array;
  /** Industrial/agricultural tiles close enough (through zone) to a road. */
  industrialAccess: Uint8Array;
  /** Map-edge road, avenue, highway and rail tiles, i.e. neighbour connections. */
  connections: number[];
  waterPollution: Float32Array;
  /** Power grid id per conductor tile (-1 elsewhere) and 1 where a grid has supply. */
  powerGrid: Int32Array;
  powered: Uint8Array;
  /** Police and fire protection, flammability, short-term Mayor Rating events. */
  policeCover: Float32Array;
  fireCover: Float32Array;
  flammability: Float32Array;
  events: Float32Array;
  /** Water network covering each tile (-1 none) and 1 where that network has supply. */
  waterNet: Int32Array;
  watered: Uint8Array;
  /** Healthcare: HQ boost points and best coverage quality (0–1) per tile. */
  hqBoost: Float32Array;
  healthQuality: Float32Array;
  /** Effectiveness of clinic/medical-center coverage (Mayor Rating counts only these). */
  hospitalCover: Float32Array;
  /** Mayor Rating effects of rewards, deals and landmarks around each tile. */
  mayorEffect: Float32Array;
  /** Local Mayor Rating on residential tiles (mayorSet marks them: 1 lived in, 2 empty). */
  mayor: Float32Array;
  mayorSet: Uint8Array;
  /** Education: averaged effectiveness per kind of school, and overall quality (0–1). */
  eduEff: Record<EduCurve, Float32Array>;
  schoolQuality: Float32Array;
}

export function createFields(n: number): Fields {
  const N = n * n;
  const i32 = () => new Int32Array(N).fill(INF);
  return {
    access: new Int32Array(N).fill(-1),
    accessDist: new Uint8Array(N),
    component: new Int32Array(N).fill(-1),
    componentHasJobs: new Uint8Array(0),
    componentHasWork: new Uint8Array(0),
    commute: new Float32Array(N).fill(INF),
    commuteByWealth: [0, 1, 2].map(() => new Float32Array(N).fill(INF)),
    localCommute: -1,
    tripLog: null,
    eveningTraffic: new Float32Array(N),
    freight: new Float32Array(N).fill(INF),
    traffic: new Float32Array(N),
    railTraffic: new Float32Array(N),
    freightRail: new Float32Array(N),
    subwayTraffic: new Float32Array(N),
    monorailTraffic: new Float32Array(N),
    ferryTraffic: new Float32Array(N),
    highTraffic: new Float32Array(N),
    highwayNoise: new Float32Array(N),
    travel: null,
    jobless: new Map(),
    searchPool: [[], []],
    searchGen: 0,
    landfillNimby: null,
    air: new Float32Array(N),
    landValue: new Float32Array(N),
    slope: new Uint8Array(N),
    resNear: [new Float32Array(N), new Float32Array(N), new Float32Array(N)],
    distRes: [i32(), i32(), i32()],
    distCo2: i32(),
    distCo3: i32(),
    nimbyRes: new Float32Array(N),
    nimbyCom: new Float32Array(N),
    industrialAccess: new Uint8Array(N),
    connections: [],
    waterPollution: new Float32Array(N),
    powerGrid: new Int32Array(N).fill(-1),
    powered: new Uint8Array(N),
    policeCover: new Float32Array(N),
    fireCover: new Float32Array(N),
    flammability: new Float32Array(N),
    events: new Float32Array(N),
    waterNet: new Int32Array(N).fill(-1),
    watered: new Uint8Array(N),
    hqBoost: new Float32Array(N),
    healthQuality: new Float32Array(N),
    hospitalCover: new Float32Array(N),
    mayorEffect: new Float32Array(N),
    mayor: new Float32Array(N),
    mayorSet: new Uint8Array(N),
    eduEff: {
      elementary: new Float32Array(N), highSchool: new Float32Array(N), college: new Float32Array(N),
      university: new Float32Array(N), library: new Float32Array(N), mainLibrary: new Float32Array(N),
      museum: new Float32Array(N), artMuseum: new Float32Array(N),
      privateSchool: new Float32Array(N), opera: new Float32Array(N),
    },
    schoolQuality: new Float32Array(N),
  };
}

/** Highest air or water pollution a tile can hold. */
const POLLUTION_MAX = 1000;

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/** Footprint tile indices of a building or structure. */
export function footprint(s: CityState, b: Rect): number[] {
  const out: number[] = [];
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) out.push(idx(s, x, y));
  return out;
}

/** Network tiles 4-adjacent to (or under) a footprint. */
export function frontage(s: CityState, b: Rect): number[] {
  const out: number[] = [];
  const n = s.size;
  for (let y = b.y - 1; y <= b.y + b.h; y++) {
    for (let x = b.x - 1; x <= b.x + b.w; x++) {
      const corner = (x === b.x - 1 || x === b.x + b.w) && (y === b.y - 1 || y === b.y + b.h);
      if (corner || x < 0 || y < 0 || x >= n || y >= n) continue;
      const i = y * n + x;
      if (isLocalNet(s.net[i]!) && atGrade(s, i)) out.push(i);
    }
  }
  return out;
}

/** Network tile a building uses: frontage if any, else its tiles' access road. */
export function buildingAccess(s: CityState, f: Fields, b: Building): { road: number; dist: number } {
  const front = frontage(s, b);
  if (front.length) return { road: front[0]!, dist: 0 };
  let best = -1;
  let bestD = INF;
  for (const i of footprint(s, b)) {
    if (f.access[i]! >= 0 && f.accessDist[i]! < bestD) {
      best = f.access[i]!;
      bestD = f.accessDist[i]!;
    }
  }
  return { road: best, dist: best < 0 ? INF : bestD };
}

function computeAccess(s: CityState, f: Fields): void {
  const n = s.size;
  f.access.fill(-1);
  f.accessDist.fill(255);
  const queue: number[] = [];
  for (let i = 0; i < n * n; i++) {
    if (isLocalNet(s.net[i]!) && atGrade(s, i)) {
      f.access[i] = i;
      f.accessDist[i] = 0;
      queue.push(i);
    }
  }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!;
    const d = f.accessDist[i]!;
    if (d >= 3) continue;
    const x = i % n;
    const y = (i - x) / n;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k]!;
      const ny = y + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (f.access[j]! >= 0 || s.terrain[j] === Terrain.Water) continue;
      f.access[j] = f.access[i]!;
      f.accessDist[j] = d + 1;
      queue.push(j);
    }
  }
}

function computeComponents(s: CityState, f: Fields, cfg: SimConfig): void {
  const n = s.size;
  f.component.fill(-1);
  let count = 0;
  const stack: number[] = [];
  for (let i = 0; i < n * n; i++) {
    if (!isAsphalt(s.net[i]!) || f.component[i]! >= 0) continue;
    f.component[i] = count;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % n;
      const y = (c - x) / n;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k]!;
        const ny = y + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (f.component[j]! < 0 && tilesLinked(s, c, j)) {
          f.component[j] = count;
          stack.push(j);
        }
      }
    }
    count++;
  }
  f.componentHasJobs = new Uint8Array(count);
  f.componentHasWork = new Uint8Array(count);
}

/** Jobs a tile of empty business land stands for (a small shop or workshop; an assumption). */
const JOBS_PER_EMPTY_TILE = 10;

/**
 * Road networks with jobs to go to (homes grow only on roads that lead to
 * open jobs; developers skip a tract with none):
 * one reaching a neighbour connection (jobs beyond the border), or whose
 * jobs (businesses, civic workplaces and C/I/A land still to build on)
 * outnumber the workers living on it.
 * Rerun at every refresh.
 */
export function computeJobComponents(s: CityState, f: Fields, cfg: SimConfig): void {
  drain(computeJobComponentsSteps(s, f, cfg));
}

/** `computeJobComponents` in steps (see ./steps). */
export function* computeJobComponentsSteps(s: CityState, f: Fields, cfg: SimConfig): Generator<void, void> {
  const n = s.size;
  const has = f.componentHasJobs;
  const count = has.length;
  has.fill(0);
  const jobs = new Float64Array(count);
  const workers = new Float64Array(count);
  const at = (t: number) => f.component[t]!;
  yield;
  for (let i = 0; i < n * n; i++) {
    if ((i & 0x7fff) === 0x7fff) yield;
    const cls = zoneInfo(s.zone[i]!).cls;
    if (cls !== 'C' && cls !== 'I' && cls !== 'A') continue;
    const occ = s.occupant[i]!;
    if (occ < 0 || (occ > 0 && s.buildings.get(occ)?.type)) continue; // built: counted below
    // Empty or abandoned business land: jobs to come, on the roads beside it.
    const x = i % n;
    const y = (i - x) / n;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k]!;
      const ny = y + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const c = at(ny * n + nx);
      if (c >= 0) {
        jobs[c]! += JOBS_PER_EMPTY_TILE;
        break;
      }
    }
  }
  yield;
  let piece1 = 0;
  for (const b of s.buildings.values()) {
    if ((++piece1 & 0x1ff) === 0) yield;
    if (!b.type) continue;
    const road = buildingAccess(s, f, b).road;
    const c = road >= 0 ? at(road) : -1;
    if (c < 0) continue;
    const people = b.capacity * b.occupancy;
    if (b.type[0] === 'R') workers[c]! += people * interp(cfg.services.workforceByHq, b.hq);
    else jobs[c]! += people;
  }
  yield;
  let piece2 = 0;
  for (const st of s.structures.values()) {
    if ((++piece2 & 0x1ff) === 0) yield;
    const def = cfg.structures[st.kind];
    const j = def.jobs[0] + def.jobs[1] + def.jobs[2];
    // Stations' few jobs aren't commute destinations (as in jobSites).
    if (def.station || j <= 0) continue;
    const front = frontage(s, st);
    if (front.length && at(front[0]!) >= 0) jobs[at(front[0]!)]! += j;
  }
  yield;
  const work = f.componentHasWork;
  for (let c = 0; c < count; c++) {
    has[c] = jobs[c]! > workers[c]! ? 1 : 0;
    work[c] = jobs[c]! > 0 ? 1 : 0;
  }
  yield;
  // A connection is work for its road only where the neighbour takes commuters (has a job open).
  const works = neighbourWorkEdges(s, cfg);
  for (const i of f.connections) if (at(i) >= 0 && works[edgeOf(s.size, i)]) has[at(i)] = work[at(i)] = 1;
}

function computeConnections(s: CityState, f: Fields): void {
  f.connections = connectionTiles(s);
}

function computeLandValue(s: CityState, f: Fields, cfg: SimConfig): void {
  const n = s.size;
  const { max, range } = cfg.desirability.waterLandValue;
  const dist = new Int32Array(n * n).fill(INF);
  const queue: number[] = [];
  for (let i = 0; i < n * n; i++) {
    if (s.terrain[i] === Terrain.Water) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!;
    const d = dist[i]!;
    if (d >= range) continue;
    const x = i % n;
    const y = (i - x) / n;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (dist[j]! > d + 1) {
          dist[j] = d + 1;
          queue.push(j);
        }
      }
    }
  }
  // Elevation: ground above the average height of zoned land is worth more,
  // up to a point. Slope: the steepest step to a land neighbour.
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n * n; i++) {
    if (s.zone[i] && s.terrain[i] !== Terrain.Water) {
      sum += s.height[i]!;
      count++;
    }
  }
  if (!count) {
    for (let i = 0; i < n * n; i++) if (s.terrain[i] !== Terrain.Water) {
      sum += s.height[i]!;
      count++;
    }
  }
  const avg = count ? sum / count : 0;
  const ev = cfg.terrain.landValue;
  for (let i = 0; i < n * n; i++) {
    const d = dist[i]!;
    const water = s.terrain[i] === Terrain.Water || d > range ? 0 : max * (1 - (d - 1) / range);
    const above = s.height[i]! - avg;
    const elev = above <= 0 || above >= ev.zero ? 0
      : above <= ev.peak ? ev.max * (above / ev.peak) : ev.max * (1 - (above - ev.peak) / (ev.zero - ev.peak));
    f.landValue[i] = s.terrain[i] === Terrain.Water ? 0 : Math.min(max, water + elev);
    let slope = 0;
    if (s.terrain[i] !== Terrain.Water) {
      const x = i % n;
      const y = (i - x) / n;
      const h = s.height[i]!;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (s.terrain[j] !== Terrain.Water) slope = Math.max(slope, Math.abs(h - s.height[j]!));
      }
    }
    f.slope[i] = Math.min(255, slope);
  }
}

/** Multi-source Chebyshev distance, capped at `cap`. */
function chebyshev(n: number, sources: Iterable<number>, out: Int32Array, cap: number): void {
  // Two raster passes of the chessboard distance transform (exact for this metric).
  out.fill(INF); // INF + 1 still fits an Int32
  let any = false;
  for (const i of sources) {
    out[i] = 0;
    any = true;
  }
  if (!any) return;
  for (let y = 0; y < n; y++) {
    const row = y * n;
    for (let x = 0; x < n; x++) {
      const i = row + x;
      let d = out[i]!;
      if (d === 0) continue;
      if (x > 0 && out[i - 1]! + 1 < d) d = out[i - 1]! + 1;
      if (y > 0) {
        const up = i - n;
        if (out[up]! + 1 < d) d = out[up]! + 1;
        if (x > 0 && out[up - 1]! + 1 < d) d = out[up - 1]! + 1;
        if (x < n - 1 && out[up + 1]! + 1 < d) d = out[up + 1]! + 1;
      }
      out[i] = d;
    }
  }
  for (let y = n - 1; y >= 0; y--) {
    const row = y * n;
    for (let x = n - 1; x >= 0; x--) {
      const i = row + x;
      let d = out[i]!;
      if (d === 0) continue;
      if (x < n - 1 && out[i + 1]! + 1 < d) d = out[i + 1]! + 1;
      if (y < n - 1) {
        const down = i + n;
        if (out[down]! + 1 < d) d = out[down]! + 1;
        if (x > 0 && out[down - 1]! + 1 < d) d = out[down - 1]! + 1;
        if (x < n - 1 && out[down + 1]! + 1 < d) d = out[down + 1]! + 1;
      }
      // Like a search that stops at `cap`: farther tiles are unreached. (A
      // neighbour past the cap can't bring a tile within it, so clamping as
      // we go changes nothing.)
      out[i] = d > cap ? INF : d;
    }
  }
}

/** Box sum of `src` over a (2r+1)² window, via a summed-area table. */
function boxSum(n: number, src: Float32Array, r: number, out: Float32Array): void {
  const W = n + 1;
  const sat = new Float64Array(W * W);
  for (let y = 0; y < n; y++) {
    let row = 0;
    for (let x = 0; x < n; x++) {
      row += src[y * n + x]!;
      sat[(y + 1) * W + x + 1] = sat[y * W + x + 1]! + row;
    }
  }
  for (let y = 0; y < n; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(n, y + r + 1);
    for (let x = 0; x < n; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(n, x + r + 1);
      out[y * n + x] = sat[y1 * W + x1]! - sat[y0 * W + x1]! - sat[y1 * W + x0]! + sat[y0 * W + x0]!;
    }
  }
}

/** (dx, dy, weight) triples of a radius-2.5 cone, matching `splat` on a tile centre. */
const TRAFFIC_KERNEL: number[] = [];
for (let dy = -2; dy <= 2; dy++) {
  for (let dx = -2; dx <= 2; dx++) {
    const d = Math.hypot(dx, dy);
    if (d < 2.5) TRAFFIC_KERNEL.push(dx, dy, 1 - d / 2.5);
  }
}

/** Adds a linearly decaying radial effect centred on a footprint. */
function splat(n: number, out: Float32Array, cx: number, cy: number, strength: number, radius: number): void {
  if (strength === 0 || radius <= 0) return;
  const r2 = radius * radius;
  const fall = strength / radius;
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(n - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const dy2 = dy * dy;
    if (dy2 >= r2) continue;
    // Only the span of this row inside the circle.
    const half = Math.sqrt(r2 - dy2);
    const x0 = Math.max(0, Math.floor(cx - half));
    const x1 = Math.min(n - 1, Math.ceil(cx + half));
    const row = y * n;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const d2 = dx * dx + dy2;
      if (d2 < r2) out[row + x]! += strength - fall * Math.sqrt(d2);
    }
  }
}

/**
 * Pollution from a lot: full strength over its footprint, then
 * fading outward from the lot's edges to nothing at `radius` tiles.
 */
function lotSplat(n: number, out: Float32Array, lot: Rect, strength: number, radius: number, height?: Uint8Array): void {
  if (strength === 0) return;
  const reach = radius + 1;
  const y0 = Math.max(0, lot.y - radius);
  const y1 = Math.min(n - 1, lot.y + lot.h - 1 + radius);
  const x0 = Math.max(0, lot.x - radius);
  const x1 = Math.min(n - 1, lot.x + lot.w - 1 + radius);
  const cx = lot.x + (lot.w - 1) / 2;
  const cy = lot.y + (lot.h - 1) / 2;
  const hs = height ? height[Math.round(cy) * n + Math.round(cx)]! : 0;
  // A ridge has to rise above the source: with nothing in reach higher, there is none to look for.
  let hills = false;
  if (height) {
    for (let y = y0; y <= y1 && !hills; y++) for (let x = x0; x <= x1; x++) if (height[y * n + x]! > hs) { hills = true; break; }
  }
  for (let y = y0; y <= y1; y++) {
    const dy = y < lot.y ? lot.y - y : y >= lot.y + lot.h ? y - (lot.y + lot.h - 1) : 0;
    for (let x = x0; x <= x1; x++) {
      const dx = x < lot.x ? lot.x - x : x >= lot.x + lot.w ? x - (lot.x + lot.w - 1) : 0;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= reach) continue;
      let v = strength * (1 - d / reach);
      // A hill in between holds it back, a taller one more.
      if (hills && d > 1 && v > 0) {
        const ends = Math.max(hs, height![y * n + x]!);
        let ridge = 0;
        const steps = Math.ceil(Math.max(Math.abs(x - cx), Math.abs(y - cy)));
        for (let k = 1; k < steps; k++) {
          const h = height![Math.round(cy + ((y - cy) * k) / steps) * n + Math.round(cx + ((x - cx) * k) / steps)]!;
          if (h - ends > ridge) ridge = h - ends;
        }
        if (ridge > 0) v *= Math.max(0, 1 - ridge / HILL_BLOCKS_AT);
      }
      out[y * n + x]! += v;
    }
  }
}
/** Height (m) of a ridge above both ends that stops air pollution altogether. */
const HILL_BLOCKS_AT = 30;

/** A fixed amount on every tile within `radius` of the lot's edges (Mayor Rating effects). */
function plateau(n: number, out: Float32Array, lot: Rect, amount: number, radius: number): void {
  if (amount === 0) return;
  const y0 = Math.max(0, Math.floor(lot.y - radius));
  const y1 = Math.min(n - 1, Math.ceil(lot.y + lot.h - 1 + radius));
  const x0 = Math.max(0, Math.floor(lot.x - radius));
  const x1 = Math.min(n - 1, Math.ceil(lot.x + lot.w - 1 + radius));
  const r2 = radius * radius;
  for (let y = y0; y <= y1; y++) {
    const dy = y < lot.y ? lot.y - y : y >= lot.y + lot.h ? y - (lot.y + lot.h - 1) : 0;
    for (let x = x0; x <= x1; x++) {
      const dx = x < lot.x ? lot.x - x : x >= lot.x + lot.w ? x - (lot.x + lot.w - 1) : 0;
      if (dx * dx + dy * dy <= r2) out[y * n + x]! += amount;
    }
  }
}

/** Recomputes network-derived fields (cheap; runs after edits and weekly). */
export function computeNetworkFields(s: CityState, f: Fields, cfg: SimConfig): void {
  drain(computeNetworkFieldsSteps(s, f, cfg));
}

/** `computeNetworkFields` in steps (see ./steps). */
export function* computeNetworkFieldsSteps(s: CityState, f: Fields, cfg: SimConfig): Generator<void, void> {
  computeConnections(s, f);
  computeAccess(s, f);
  computeComponents(s, f, cfg);
  computeLandValue(s, f, cfg);

  // Industrial reach: I/A zone tiles within N steps (through I/A zone) of a road,
  // which also gives them that road as their access.
  const n = s.size;
  const reach = cfg.development.industrialReach;
  const depth = new Int32Array(n * n).fill(INF);
  const queue: number[] = [];
  yield;
  for (let i = 0; i < n * n; i++) {
    if ((i & 0x7fff) === 0x7fff) yield;
    const cls = zoneInfo(s.zone[i]!).cls;
    if ((cls === 'I' || cls === 'A') && f.access[i]! >= 0 && f.accessDist[i] === 1) {
      depth[i] = 0;
      queue.push(i);
    }
  }
  yield;
  for (let h = 0; h < queue.length; h++) {
    if ((h & 0x7fff) === 0x7fff) yield;
    const i = queue[h]!;
    if (depth[i]! >= reach) continue;
    const x = i % n;
    const y = (i - x) / n;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k]!;
      const ny = y + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      const cls = zoneInfo(s.zone[j]!).cls;
      if ((cls === 'I' || cls === 'A') && depth[j]! > depth[i]! + 1) {
        depth[j] = depth[i]! + 1;
        // Lots this deep reach their road through the zone: trucks, workers and
        // garbage pickup use that road too, a few tiles further on.
        if (f.access[j]! < 0) {
          f.access[j] = f.access[i]!;
          f.accessDist[j] = Math.min(255, f.accessDist[i]! + 1);
        }
        queue.push(j);
      }
    }
  }
  yield;
  for (let i = 0; i < n * n; i++) f.industrialAccess[i] = depth[i]! < INF ? 1 : 0;
  // (After the industrial reach: lots deep in an I or A zone reach their road only through it, and their
  // jobs count on that road's network.)
  computeJobComponents(s, f, cfg);
}

/** Recomputes pollution, proximity and NIMBY fields from buildings. */
export function computeEffectFields(s: CityState, f: Fields, cfg: SimConfig): void {
  drain(computeEffectFieldsSteps(s, f, cfg));
}

/** `computeEffectFields` in steps (see ./steps). */
export function* computeEffectFieldsSteps(s: CityState, f: Fields, cfg: SimConfig): Generator<void, void> {
  const n = s.size;
  const N = n * n;
  const dcfg = cfg.desirability;

  f.air.fill(0);
  yield;
  let piece1 = 0;
  for (const b of s.buildings.values()) {
    if ((++piece1 & 0x1ff) === 0) yield;
    if (!b.type) continue;
    const p = cfg.development.airPollution[b.type];
    if (!p) continue;
    lotSplat(n, f.air, b, p.perStage * b.stage * Math.sqrt(b.occupancy), p.radius, s.height);
  }
  // Cars and trucks pollute the tiles along their road; trains a quarter as
  // much per trip (an assumption); buses and subways not at all. Same
  // cone as `splat` with radius 2.5, applied as a precomputed 5×5 kernel.
  const tp = cfg.development.trafficPollution;
  yield;
  for (let y = 0; y < n; y++) {
    if ((y & 31) === 31) yield;
    for (let x = 0; x < n; x++) {
      const t = f.traffic[y * n + x]! + f.highTraffic[y * n + x]! + f.railTraffic[y * n + x]! * 0.25;
      if (t <= 0) continue;
      const v = t * tp;
      for (let k = 0; k < TRAFFIC_KERNEL.length; k += 3) {
        const nx = x + TRAFFIC_KERNEL[k]!;
        const ny = y + TRAFFIC_KERNEL[k + 1]!;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        f.air[ny * n + nx]! += v * TRAFFIC_KERNEL[k + 2]!;
      }
    }
  }
  // Highway noise: the busiest highway tile within 2, spread from the highway tiles (few: a filter over
  // every tile was the costliest part of this pass).
  // (Highway volume brings noise to the tracts beside it, lowering Mayor Rating and residential
  // desirability; lots front local roads only, so their own road's traffic missed it.)
  yield;
  f.highwayNoise.fill(0);
  for (let i = 0; i < N; i++) {
    const v = (s.net[i] === Net.Highway ? f.traffic[i]! : 0) + f.highTraffic[i]!;
    if (!(v > 0)) continue;
    const x = i % n;
    const y = (i - x) / n;
    for (let yy = Math.max(0, y - 2); yy <= Math.min(n - 1, y + 2); yy++) {
      for (let xx = Math.max(0, x - 2); xx <= Math.min(n - 1, x + 2); xx++) {
        const j = yy * n + xx;
        if (f.highwayNoise[j]! < v) f.highwayNoise[j] = v;
      }
    }
  }
  const ord = ordinanceEffects(s);

  // Residents per wealth, spread over footprints, then box-summed.
  const dens = [new Float32Array(N), new Float32Array(N), new Float32Array(N)] as const;
  const resSrc: [number[], number[], number[]] = [[], [], []];
  const co2: number[] = [];
  const co3: number[] = [];
  yield;
  let piece2 = 0;
  for (const b of s.buildings.values()) {
    if ((++piece2 & 0x1ff) === 0) yield;
    if (!b.type) continue;
    const tiles = footprint(s, b);
    const w = cfg.demand.wealthOf[b.type];
    if (b.type[0] === 'R') {
      const per = (b.capacity * b.occupancy) / tiles.length;
      for (const i of tiles) {
        dens[w][i]! += per;
        resSrc[w].push(i);
      }
    } else if (b.type === 'Co$$') co2.push(...tiles);
    else if (b.type === 'Co$$$') co3.push(...tiles);
  }
  const cap = dcfg.proximityDistanceMax;
  yield;
  for (let w = 0; w < 3; w++) {
    boxSum(n, dens[w as 0]!, dcfg.resProximityRadius, f.resNear[w as 0]);
    chebyshev(n, resSrc[w as 0], f.distRes[w as 0], cap);
  }
  chebyshev(n, co2, f.distCo2, cap);
  chebyshev(n, co3, f.distCo3, cap);

  f.nimbyRes.fill(0);
  f.nimbyCom.fill(0);
  f.waterPollution.fill(0);
  yield;
  let piece3 = 0;
  for (const b of s.buildings.values()) {
    if ((++piece3 & 0x1ff) === 0) yield;
    if (!b.type) continue;
    const p = cfg.development.waterPollution[b.type];
    if (!p) continue;
    if (p.perTile) {
      for (const i of footprint(s, b)) splat(n, f.waterPollution, (i % n) + 0.5, Math.floor(i / n) + 0.5, p.perStage * b.occupancy, p.radius + 0.5);
    } else lotSplat(n, f.waterPollution, b, p.perStage * b.stage * Math.sqrt(b.occupancy), p.radius);
  }
  f.mayorEffect.fill(0);
  yield;
  let piece4 = 0;
  for (const st of s.structures.values()) {
    // (A landmark's or plant's splats cover much of the map: a few at a time.)
    if ((++piece4 & 0xf) === 0) yield;
    const def = cfg.structures[st.kind];
    const cx = st.x + st.w / 2;
    const cy = st.y + st.h / 2;
    // Underfunded rewards and landmarks lose their good effects in proportion;
    // bad ones stay.
    const share = Math.min(1, structureFunding(s, def, st) / 100);
    const funded = (v: number) => (v > 0 ? v * share : v);
    if (def.pollution) {
      // Parks that clean the air do less of it when underfunded.
      lotSplat(n, f.air, st, def.pollution[0] < 0 ? def.pollution[0] * share : def.pollution[0], def.pollution[1], def.pollution[0] > 0 ? s.height : undefined);
      lotSplat(n, f.waterPollution, st, def.pollution[2], def.pollution[3]);
    }
    if (def.mayor) plateau(n, f.mayorEffect, st, funded(def.mayor[0]), def.mayor[1]);
    const polluter = def.plant ?? def.incinerator;
    if (polluter) {
      // Source strength follows generation (thermal equipment has standby
      // emissions). Incinerators emit only in proportion to actual waste burned.
      const emission = utilityEmissionShare(cfg, st);
      lotSplat(n, f.air, st, polluter.air[0] * emission, polluter.air[1], s.height);
      lotSplat(n, f.waterPollution, st, polluter.water[0] * emission, polluter.water[1]);
    }
    splat(n, f.nimbyCom, cx, cy, funded(def.com[0]), def.com[1]);
    splat(n, f.nimbyRes, cx, cy, funded(def.res[0]), def.res[1]);
  }
  // Toxic spills pollute until they are neutralised.
  const sp = cfg.disasters.spill;
  yield;
  let piece5 = 0;
  for (const spill of s.spills) {
    if ((++piece5 & 0x1ff) === 0) yield;
    const x = spill.i % n;
    const y = (spill.i - x) / n;
    splat(n, f.air, x + 0.5, y + 0.5, sp.air, sp.radius);
    splat(n, f.waterPollution, x + 0.5, y + 0.5, sp.water, sp.radius);
  }
  // Landfills: every tile is a −100 NIMBY for homes and shops. A
  // wide cone per tile is costly, so the sum is kept until the zoning changes.
  const lf = cfg.garbage.landfill;
  const fillTiles: number[] = [];
  yield;
  for (let i = 0; i < N; i++) if (s.zone[i] === 10) fillTiles.push(i);
  const key = `${lf.nimby}|${lf.nimbyRadius}|${fillTiles.join(',')}`;
  if (f.landfillNimby?.tiles !== key || f.landfillNimby.field.length !== N) {
    const field = new Float32Array(N);
    for (const i of fillTiles) {
      const x = i % n;
      const y = (i - x) / n;
      splat(n, field, x + 0.5, y + 0.5, lf.nimby, lf.nimbyRadius);
    }
    f.landfillNimby = { tiles: key, field };
  }
  if (fillTiles.length) {
    const lfField = f.landfillNimby.field;
    for (let i = 0; i < N; i++) {
      const v = lfField[i]!;
      if (v === 0) continue;
      f.nimbyCom[i]! += v;
      f.nimbyRes[i]! += v;
    }
  }

  // Emission ordinances cut air pollution everywhere.
  if (ord.air !== 1) for (let i = 0; i < N; i++) f.air[i]! *= ord.air;
  // Trees: −2 a sapling, up to −7 in a clump of grown trees, on the
  // tile and half that next to it.
  const fl = cfg.flora;
  // (Summed over the trees around a tile, then capped at the clump's −7: added up, a tile inside a forest
  // lost 35.)
  const treeCut = new Float32Array(N);
  yield;
  for (let i = 0; i < N; i++) {
    if ((i & 0x7fff) === 0x7fff) yield;
    const age = s.trees[i]!;
    if (!age) continue;
    const x = i % n;
    const y = (i - x) / n;
    let grown = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < n && ny < n && s.trees[ny * n + nx]! > fl.grownMonths) grown++;
      }
    }
    const cut = age <= fl.grownMonths ? fl.sapling : fl.sapling + ((fl.clump - fl.sapling) * grown) / 8;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < n && ny < n) treeCut[ny * n + nx]! += dx || dy ? cut / 2 : cut;
      }
    }
  }
  for (let i = 0; i < N; i++) if (treeCut[i]! > 0) f.air[i]! -= Math.min(fl.clump, treeCut[i]!);
  // Parks-like rewards clean the air around them, never below zero.
  yield;
  for (let i = 0; i < N; i++) if (f.air[i]! < 0) f.air[i] = 0;

  // Overlapping sources saturate at the maximum (assumed to be 1000, the
  // Mayor Rating's worst level).
  yield;
  for (let i = 0; i < N; i++) {
    if ((i & 0x7fff) === 0x7fff) yield;
    if (f.air[i]! > POLLUTION_MAX) f.air[i] = POLLUTION_MAX;
    if (f.waterPollution[i]! > POLLUTION_MAX) f.waterPollution[i] = POLLUTION_MAX;
  }

  // Water Treatment Plants (powered) cancel water pollution: −300 at the plant
  // easing to −250 at the 48-tile edge, never below zero. They reach full
  // strength two months after opening and lose it with age.
  yield;
  let piece6 = 0;
  for (const st of s.structures.values()) {
    if ((++piece6 & 0x1ff) === 0) yield;
    const t = cfg.structures[st.kind].treatment;
    if (!t || !st.powered) continue;
    const startUp = Math.min(1, st.life / ((2 * 100) / (t.lifeYears * 12)));
    // (Water Department underfunding reduces its efficiency, as it does a pump's output.)
    const k = startUp * interp(cfg.services.waterOutputByAge, st.life) * Math.min(1, s.departments.water / 100);
    if (k <= 0) continue;
    const cx = st.x + st.w / 2;
    const cy = st.y + st.h / 2;
    const r = t.radius;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(n - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(n - 1, Math.ceil(cx + r)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        const i = y * n + x;
        f.waterPollution[i] = Math.max(0, f.waterPollution[i]! - k * (t.center - ((t.center - t.edge) * d) / r));
      }
    }
  }
}

