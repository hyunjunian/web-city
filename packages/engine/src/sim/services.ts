// Power grid, health and education.

import { drain } from './steps';
import type { SimConfig } from '../config';
import { interp } from '../data/services';
import type { EduCurve, StructureDef } from '../data/structures';
import type { Rng } from '../rng';
import { WEALTHS, type PerWealth } from '../types';
import type { Fields } from './fields';
import { ordinanceEffects } from './mayor';
import { structureFunding, type Building, type CityState, type Structure } from './state';
import { activeDeals, edgeTile } from './region';
import { powerDispatchLoads } from './energy';
import type { UtilityNetwork, UtilitySource } from './resilience';

export const EDU_CURVES = ['elementary', 'highSchool', 'college', 'university', 'library', 'mainLibrary', 'museum', 'artMuseum', 'privateSchool', 'opera'] as const;
/** Higher education: the fuller school system on top of a basic school, library or museum. */
const HIGHER_EDUCATION: ReadonlySet<string> = new Set(['college', 'university', 'mainLibrary', 'artMuseum', 'opera']);
/** Share of the school desirability bonus only higher education gives. */
const HIGHER_SHARE = 0.3;
/** Health coverage classes: clinics and medical centers count as one (Rush Hour). */
export const HEALTH_CLASSES = ['hospital', 'research', 'market'] as const;
export type HealthClass = (typeof HEALTH_CLASSES)[number];

/**
 * Hospitals and clinics serve a radius; a citywide research centre lifts
 * health everywhere; a citywide nudge to the health index (the Farmer's
 * Market) is no medical care at all.
 */
/** Share of the Disease Research Lab's HQ boost that counts (see computeCoverage). */
const RESEARCH_HQ_WEIGHT = 0.2;

export function healthClassOf(def: StructureDef): HealthClass | null {
  if (!def.health) return null;
  if (def.health.radius < 300) return 'hospital';
  return def.health.boost >= 1 ? 'research' : 'market';
}

export interface PowerGrid {
  supply: number;
  demand: number;
  /** Available local plant capacity, fixed waste-energy output, and imports on this grid. */
  localCapacity: number;
  wastePower: number;
  importCapacity: number;
  /** Demand left unserved after the blackout. */
  shortfall: number;
}

export interface PowerReport {
  grids: PowerGrid[];
  supply: number;
  demand: number;
  blackedOut: number;
}

const DX8 = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY8 = [-1, -1, -1, 0, 0, 1, 1, 1];

function residentsOf(b: Building): number {
  return b.capacity * b.occupancy;
}

function centre(b: { x: number; y: number; w: number; h: number }): [number, number] {
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/** MWh a building needs per month. */
export function powerUse(cfg: SimConfig, b: Building): number {
  if (!b.type) return 0;
  return Math.max(1, b.capacity * b.occupancy) * cfg.services.powerPerCapita[b.type];
}

/**
 * Builds power grids. Plants, power lines, zones and buildings conduct;
 * anything within POWER_GAP empty tiles of a conductor joins its grid.
 * Unzoned land and roads do not conduct. Sets f.powerGrid and f.powered.
 */
function* computeGrids(s: CityState, f: Fields, cfg: SimConfig): Generator<void, number> {
  const n = s.size;
  const N = n * n;
  const grid = f.powerGrid;
  grid.fill(-1);
  const conductor = new Uint8Array(N);
  // Conductors not yet in a grid: once none are left, the gap scans below can find nothing.
  let unassigned = 0;
  for (let i = 0; i < N; i++) {
    if (s.power[i] || s.zone[i] || s.occupant[i]) {
      conductor[i] = 1;
      unassigned++;
    }
  }
  const reach = cfg.services.powerGap + 1;
  let count = 0;
  let visited = 0;
  const stack: number[] = [];
  yield;
  for (let start = 0; start < N; start++) {
    if (!conductor[start] || grid[start]! >= 0) continue;
    grid[start] = count;
    unassigned--;
    stack.push(start);
    while (stack.length) {
      // (A tile at a conductor's edge looks across the whole gap: count that work too.)
      if (++visited > 0x3fff) {
        visited = 0;
        yield;
      }
      const i = stack.pop()!;
      const x = i % n;
      const y = (i - x) / n;
      // Interior tiles only need their 8 neighbours; edge tiles look across gaps.
      let edge = false;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX8[k]!;
        const ny = y + DY8[k]!;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (!conductor[j]) edge = true;
        else if (grid[j]! < 0) {
          grid[j] = count;
          unassigned--;
          stack.push(j);
        }
      }
      if (!edge || unassigned === 0) continue;
      visited += 2 * reach * reach;
      for (let ny = Math.max(0, y - reach); ny <= Math.min(n - 1, y + reach); ny++) {
        for (let nx = Math.max(0, x - reach); nx <= Math.min(n - 1, x + reach); nx++) {
          const j = ny * n + nx;
          if (conductor[j] && grid[j]! < 0) {
            grid[j] = count;
            unassigned--;
            stack.push(j);
          }
        }
      }
    }
    count++;
  }
  return count;
}

/**
 * Plant output this month, by age. Funding doesn't change it: an underfunded
 * power plant only has a shorter life (it ages faster; see agePlants).
 */
export function plantCapacity(cfg: SimConfig, def: StructureDef, st: Structure, gasBonus = 1): number {
  if (!def.plant) return 0;
  const sv = cfg.services;
  const bonus = st.kind === 'gasPlant' ? gasBonus : 1;
  return def.plant.output * interp(sv.plantOutputByAge, st.life) * bonus;
}

/**
 * Supplies every grid. When a grid's demand exceeds supply, a section of
 * its RCI buildings large enough to cover the deficit is blacked out
 * (rolling blackouts); the section moves every month.
 */
export function computePower(s: CityState, f: Fields, cfg: SimConfig): PowerReport {
  return drain(computePowerSteps(s, f, cfg));
}

/** `computePower` in steps (see ./steps). */
export function* computePowerSteps(s: CityState, f: Fields, cfg: SimConfig): Generator<void, PowerReport> {
  const count = yield* computeGrids(s, f, cfg);
  const ord = ordinanceEffects(s);
  const grids: PowerGrid[] = Array.from({ length: count }, () => ({ supply: 0, demand: 0, shortfall: 0, localCapacity: 0, wastePower: 0, importCapacity: 0 }));
  const plants: Structure[][] = Array.from({ length: count }, () => []);
  const gridOf = (r: { x: number; y: number }) => f.powerGrid[r.y * s.size + r.x]!;

  yield;
  let piece1 = 0;
  for (const st of s.structures.values()) {
    if ((++piece1 & 0x1ff) === 0) yield;
    const def = cfg.structures[st.kind];
    st.capacity = def.plant ? plantCapacity(cfg, def, st, ord.gasPlantOutput) : st.capacity;
    const g = gridOf(st);
    if (g < 0) continue;
    if (def.plant) {
      grids[g]!.supply += st.capacity;
      grids[g]!.localCapacity += st.capacity;
      plants[g]!.push(st);
    }
    // Waste to Energy: power in proportion to last month's garbage burned.
    if (def.incinerator) {
      const power = st.load * def.incinerator.powerPerTon;
      grids[g]!.supply += power;
      grids[g]!.wastePower += power;
    }
    grids[g]!.demand += def.powerUse * ord.power;
  }
  const consumers: Building[][] = Array.from({ length: count }, () => []);
  yield;
  let piece2 = 0;
  for (const b of s.buildings.values()) {
    if ((++piece2 & 0x1ff) === 0) yield;
    const g = gridOf(b);
    if (g < 0 || !b.type) continue;
    grids[g]!.demand += powerUse(cfg, b) * ord.power;
    consumers[g]!.push(b);
  }
  // Neighbor Deals: bought power feeds the grid at the edge line (used before
  // our own plants'), sold power is extra demand on it.
  const imported = new Float64Array(count);
  yield;
  for (const d of activeDeals(s, 'power')) {
    const t = edgeTile(s, d.edge, (i) => s.power[i] === 1 && f.powerGrid[i]! >= 0);
    if (t < 0) continue;
    const g = f.powerGrid[t]!;
    if (d.direction === 'buy') {
      grids[g]!.supply += d.amount;
      grids[g]!.importCapacity += d.amount;
      imported[g]! += d.amount;
    } else grids[g]!.demand += d.amount;
  }

  // Blackouts: cut tracts in row order starting from a rotating offset.
  const T = cfg.development.tractSize;
  const tracts = Math.ceil(s.size / T) ** 2;
  const cut = new Set<Building>();
  const tractOf = (r: { x: number; y: number }) => Math.floor(r.y / T) * Math.ceil(s.size / T) + Math.floor(r.x / T);
  // Tracts in the dark: what stands there loses power too, pumps included
  // (a blackout over the water supply cuts the water as well).
  const darkTracts = new Set<number>();
  grids.forEach((grid, g) => {
    if (grid.demand <= grid.supply || grid.supply <= 0) return;
    // (The rotation steps over the tracts this grid serves: over every tract of the map, it
    // mostly landed on empty land and wrapped round to the same first homes month after month.)
    const served = [...new Set(consumers[g]!.map(tractOf))].sort((a, b) => a - b);
    const offset = served[(s.blackoutRotation * 7919) % served.length] ?? 0;
    const key = (b: Building) => (tractOf(b) - offset + tracts) % tracts;
    const list = consumers[g]!.sort((a, b) => key(a) - key(b) || a.id - b.id);
    let need = grid.demand - grid.supply;
    for (const b of list) {
      if (need <= 0) break;
      need -= powerUse(cfg, b) * ord.power;
      cut.add(b);
      darkTracts.add(tractOf(b));
    }
    grid.shortfall = Math.max(0, need);
  });

  // Imported electricity and the power already made while burning waste
  // displace generation. Local machines only produce the remaining load.
  yield;
  for (let g = 0; g < count; g++) {
    if ((g & 0x1ff) === 0x1ff) yield;
    const group = plants[g]!;
    if (!group.length) continue;
    const grid = grids[g]!;
    const loads = powerDispatchLoads(s, cfg, group, grid.demand - imported[g]! - grid.wastePower, s.powerDispatch ?? 'balanced');
    for (let k = 0; k < group.length; k++) {
      const st = group[k]!;
      st.load = loads[k]!;
      st.effectiveness = st.capacity > 0 ? st.load / st.capacity : 0;
    }
  }

  f.powered.fill(0);
  yield;
  for (let i = 0; i < f.powered.length; i++) {
    if ((i & 0x7fff) === 0x7fff) yield;
    const g = f.powerGrid[i]!;
    if (g >= 0 && grids[g]!.supply > 0) f.powered[i] = 1;
  }
  yield;
  let piece3 = 0;
  for (const b of s.buildings.values()) {
    if ((++piece3 & 0x1ff) === 0) yield;
    const g = gridOf(b);
    b.powered = g >= 0 && grids[g]!.supply > 0 && !cut.has(b);
  }
  yield;
  let piece4 = 0;
  for (const st of s.structures.values()) {
    if ((++piece4 & 0x1ff) === 0) yield;
    const def = cfg.structures[st.kind];
    const g = gridOf(st);
    st.powered = g >= 0 && grids[g]!.supply > 0 && (def.plant !== undefined || !darkTracts.has(tractOf(st)));
  }
  // Supply counts only grids that power something (as for water).
  let supply = 0;
  let demand = 0;
  let idle = 0;
  yield;
  let piece5 = 0;
  for (const g of grids) {
    if ((++piece5 & 0x1ff) === 0) yield;
    if (g.demand > 0) supply += g.supply;
    else idle += g.supply;
    demand += g.demand;
  }
  if (demand === 0) supply += idle;
  return { grids, supply, demand, blackedOut: cut.size };
}

/** A school's or hospital's radius after its local bus/ambulance funding. */
export function serviceRadius(cfg: SimConfig, def: StructureDef, st: Structure): number {
  const svc = (def.health ?? def.school)!;
  return svc.vehicles ? svc.radius * interp(cfg.services.radiusByVehicleFunding, st.vehicleFunding ?? 100) : svc.radius;
}

/**
 * Calls `fn(row, x0, x1)` for each row's run of tiles whose centre lies within
 * `radius` of a footprint's centre (x0..x1 inclusive; the same tiles a
 * per-tile distance test picks, found with one square root per row).
 */
function forDisk(n: number, r: { x: number; y: number; w: number; h: number }, radius: number, fn: (row: number, x0: number, x1: number) => void): void {
  const [cx, cy] = centre(r);
  const r2 = radius * radius;
  const lo = Math.max(0, Math.floor(cx - radius));
  const hi = Math.min(n - 1, Math.ceil(cx + radius));
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(n - 1, Math.ceil(cy + radius)); y++) {
    const dy = y + 0.5 - cy;
    const left = r2 - dy * dy;
    if (left < 0) continue;
    const inside = (x: number) => (x + 0.5 - cx) ** 2 + dy * dy <= r2;
    const half = Math.sqrt(left);
    let x0 = Math.max(lo, Math.ceil(cx - half - 0.5));
    let x1 = Math.min(hi, Math.floor(cx + half - 0.5));
    // Settle the ends exactly on the per-tile test (rounding at the rim).
    while (x0 > lo && inside(x0 - 1)) x0--;
    while (x0 <= x1 && !inside(x0)) x0++;
    while (x1 < hi && inside(x1 + 1)) x1++;
    while (x1 >= x0 && !inside(x1)) x1--;
    if (x0 <= x1) fn(y * n, x0, x1);
  }
}

function centreTile(n: number, b: Building): number {
  const [cx, cy] = centre(b);
  return Math.min(n - 1, Math.floor(cy)) * n + Math.min(n - 1, Math.floor(cx));
}

type ServiceKey = HealthClass | EduCurve;

/**
 * Coverage for hospitals and schools. Each building's load is the share of
 * residents (students: age-appropriate ones) in its radius, split among
 * overlapping buildings of the same kind; grade = capacity / load.
 * Overlapping buildings of the same kind are averaged, different
 * kinds add up.
 */
export function computeCoverage(s: CityState, f: Fields, cfg: SimConfig): void {
  drain(computeCoverageSteps(s, f, cfg));
}

/** `computeCoverage` in steps (see ./steps). */
export function* computeCoverageSteps(s: CityState, f: Fields, cfg: SimConfig): Generator<void, void> {
  const n = s.size;
  const sv = cfg.services;
  const keyOf = (def: StructureDef): ServiceKey | null => healthClassOf(def) ?? def.school?.curve ?? null;

  const count = new Map<ServiceKey, Uint8Array>();
  // Capacity reaching each tile, per kind: a home's patients or pupils split by it (a big
  // hospital beside a clinic takes most of them, not half).
  const capSum = new Map<ServiceKey, Float32Array>();
  const capOf = (def: StructureDef, st: Structure) => Math.max(1, (def.health ?? def.school)!.capacity * interp(sv.capacityByFunding, st.funding));
  const effSum = new Map<ServiceKey, Float32Array>();
  const list: { st: Structure; def: StructureDef; key: ServiceKey; radius: number }[] = [];
  // HQ boost per health class, from its facilities (the same within a class).
  const classBoost = new Map<ServiceKey, number>();
  yield;
  let piece1 = 0;
  for (const st of s.structures.values()) {
    if ((++piece1 & 0x1ff) === 0) yield;
    const def = cfg.structures[st.kind];
    const key = keyOf(def);
    if (!key) continue;
    const radius = serviceRadius(cfg, def, st);
    list.push({ st, def, key, radius });
    // (The Disease Research Lab's citywide boost counts a fifth: at full, it alone halved the time to HQ
    // 200, against the 65 years it takes with healthcare and 50 with the health rewards.)
    if (def.health) classBoost.set(key, def.health.boost * (key === 'research' ? RESEARCH_HQ_WEIGHT : 1));
    if (!count.has(key)) {
      count.set(key, new Uint8Array(n * n));
      effSum.set(key, new Float32Array(n * n));
      capSum.set(key, new Float32Array(n * n));
    }
    const c = count.get(key)!;
    const cs = capSum.get(key)!;
    const cap = capOf(def, st);
    forDisk(n, st, radius, (row, x0, x1) => {
      for (let i = row + x0; i <= row + x1; i++) {
        if (c[i]! < 255) c[i]!++;
        cs[i]! += cap;
      }
    });
  }

  // Homes as flat arrays: centre, residents, centre tile and age (every
  // facility below scans them all, so this avoids per-pair work).
  const homes = [...s.buildings.values()].filter((b) => b.type?.[0] === 'R' && b.occupancy > 0);
  const H = homes.length;
  const hx = new Float64Array(H);
  const hy = new Float64Array(H);
  const people = new Float64Array(H);
  const tile = new Int32Array(H);
  yield;
  for (let k = 0; k < H; k++) {
    if ((k & 0x7fff) === 0x7fff) yield;
    const b = homes[k]!;
    hx[k] = b.x + b.w / 2;
    hy[k] = b.y + b.h / 2;
    people[k] = residentsOf(b);
    tile[k] = centreTile(n, b);
  }
  // How much each home counts as pupils for a school curve: its boost at the
  // household's age against the curve's peak (computed once per curve).
  const ofAge = new Map<EduCurve, Float32Array>();
  yield;
  // (Each facility looks over every home and paints its disk: pause by that work.)
  let work = 0;
  for (const { st, def, key, radius } of list) {
    work += H + 4 * radius * radius;
    if (work > 0x3ffff) {
      work = 0;
      yield;
    }
    const svc = (def.health ?? def.school)!;
    const fraction = def.health ? sv.patientFraction : sv.studentFraction;
    const cs = capSum.get(key)!;
    const cap = capOf(def, st);
    const [cx, cy] = centre(st);
    let pupils: Float32Array | null = null;
    if (def.school) {
      const curve = def.school.curve;
      pupils = ofAge.get(curve) ?? null;
      if (!pupils) {
        const peak = Math.max(...sv.eduCurves[curve].map(([, v]) => v));
        pupils = new Float32Array(H);
        for (let k = 0; k < H; k++) pupils[k] = peak > 0 ? interp(sv.eduCurves[curve], homes[k]!.age) / peak : 0;
        ofAge.set(curve, pupils);
      }
    }
    const r2 = radius * radius;
    let load = 0;
    for (let k = 0; k < H; k++) {
      if ((hx[k]! - cx) ** 2 + (hy[k]! - cy) ** 2 > r2) continue;
      const share = pupils ? pupils[k]! : 1;
      if (share <= 0) continue;
      load += (people[k]! * fraction * share * cap) / Math.max(cap, cs[tile[k]!]!);
    }
    st.load = load;
    st.capacity = svc.capacity * interp(sv.capacityByFunding, st.funding);
    const grade = load > 0 ? Math.min(1, st.capacity / load) : st.capacity > 0 ? 1 : 0;
    st.effectiveness = grade * (st.strike > 0 ? sv.strikeEffectiveness : 1);
    const e = effSum.get(key)!;
    const eff = st.effectiveness;
    forDisk(n, st, radius, (row, x0, x1) => {
      for (let i = row + x0; i <= row + x1; i++) e[i]! += eff;
    });
  }

  // Per tile: averaged effectiveness per kind.
  f.hqBoost.fill(0);
  f.healthQuality.fill(0);
  f.hospitalCover.fill(0);
  f.schoolQuality.fill(0);
  yield;
  for (const k of EDU_CURVES) f.eduEff[k].fill(0);
  const N = n * n;
  yield;
  let piece3 = 0;
  for (const [key, c] of count) {
    yield;
    if ((++piece3 & 0x1ff) === 0) yield;
    const e = effSum.get(key)!;
    if (key === 'market') {
      // Only the health index moves.
      const boost = classBoost.get(key)!;
      for (let i = 0; i < N; i++) if (c[i]) f.hqBoost[i]! += boost * (e[i]! / c[i]!);
    } else if (key === 'hospital' || key === 'research') {
      const boost = classBoost.get(key)!;
      const hq = f.hqBoost;
      const quality = f.healthQuality;
      // Any healthcare building's radius counts as care for the Mayor Rating (the lab's is citywide).
      const cover = f.hospitalCover;
      for (let i = 0; i < N; i++) {
        if (!c[i]) continue;
        const avg = e[i]! / c[i]!;
        hq[i]! += boost * avg;
        if (avg > quality[i]!) quality[i] = avg;
        if (avg > cover[i]!) cover[i] = avg;
      }
    } else {
      const out = f.eduEff[key];
      for (let i = 0; i < N; i++) if (c[i]) out[i] = e[i]! / c[i]!;
    }
  }
  // School quality for desirability: one fully funded school, library or
  // museum reaching a tile covers it well, but only a fuller school system
  // earns the whole bonus: the best building covering the tile gives most
  // of it, a college, university, main library or art museum the rest.
  const q = f.schoolQuality;
  const top = new Float32Array(N);
  yield;
  // (Only kinds the city has: the others' fields are all 0.)
  for (const k of EDU_CURVES) {
    if (!count.has(k)) continue;
    const eff = f.eduEff[k];
    const higher = HIGHER_EDUCATION.has(k);
    for (let i = 0; i < N; i++) {
      if (eff[i]! > q[i]!) q[i] = eff[i]!;
      if (higher && eff[i]! > top[i]!) top[i] = eff[i]!;
    }
    yield;
  }
  for (let i = 0; i < N; i++) q[i] = Math.min(1, (1 - HIGHER_SHARE) * q[i]! + HIGHER_SHARE * top[i]!);
}

/**
 * Monthly strikes: hospitals and schools by grade (ends at 4/5),
 * or on their own after many months. Police and fire stations strike by
 * funding (updateSafetyStrikes).
 */
export function updateStrikes(s: CityState, cfg: SimConfig, rng: Rng): void {
  const sv = cfg.services;
  for (const st of s.structures.values()) {
    const def = cfg.structures[st.kind];
    // (Police and fire stations strike by funding in updateSafetyStrikes: counted here as well, their
    // strikes advanced two months a month and rolled twice.)
    if (!def.health && !def.school) continue;
    const grade = st.load > 0 ? Math.min(1, st.capacity / st.load) : 1;
    if (st.strike > 0) {
      st.strike++;
      if (grade >= sv.strikeEndGrade || st.strike > sv.strikeMaxMonths) st.strike = 0;
    } else if (grade < 1 && rng.next() < sv.strikeChance * (1 - grade)) st.strike = 1;
  }
}

/**
 * Ages power plants and water pumps by funding and usage (the same tables
 * for both). Returns power plants that reached the end of their life; pumps
 * simply stop producing at 110%.
 */
export function utilityLifeYears(def: StructureDef): number | null {
  return def.plant?.lifeYears ?? def.pump?.lifeYears ?? def.incinerator?.lifeYears ?? def.recycling?.lifeYears ?? def.treatment?.lifeYears ?? null;
}

/** Life percentage used in a month at the current load and funding. Shared with capital forecasts. */
export function utilityWear(s: CityState, cfg: SimConfig, st: Structure, plantWear = ordinanceEffects(s).plantWear): number {
  const def = cfg.structures[st.kind];
  const life = utilityLifeYears(def);
  if (!life) return 0;
  // Recycling centers and treatment plants have no throughput; treat them as fully used.
  const usage = def.recycling || def.treatment ? 100 : Math.min(120, st.effectiveness * 100);
  return (100 / (life * 12)) * interp(cfg.services.plantDecayByFunding, structureFunding(s, def, st))
    * interp(cfg.services.plantDecayByUsage, usage) * (def.plant ? plantWear : 1);
}

export function agePlants(s: CityState, cfg: SimConfig): Structure[] {
  const dead: Structure[] = [];
  const plantWear = ordinanceEffects(s).plantWear;
  for (const st of s.structures.values()) {
    const def = cfg.structures[st.kind];
    const life = utilityLifeYears(def);
    if (!life) continue;
    st.life += utilityWear(s, cfg, st, plantWear);
    if (!def.plant) st.life = Math.min(110, st.life);
    if (def.plant && st.life >= 100) dead.push(st);
  }
  return dead;
}

/** A Medical Clinic's and a school's full boost: the yardsticks for citywide ordinance effects. */
const CLINIC_BOOST = 11.52;
const SCHOOL_BOOST = 5;

/**
 * Monthly HQ and EQ for residential buildings (household averages): decay,
 * healthcare and school boosts, pollution, ageing and inheritance.
 */
export function updateQuotients(s: CityState, f: Fields, cfg: SimConfig): void {
  const sv = cfg.services;
  const n = s.size;
  const ord = ordinanceEffects(s);
  for (const b of s.buildings.values()) {
    if (!b.type || b.type[0] !== 'R') continue;
    const i = centreTile(n, b);
    let edu = 0;
    for (const k of EDU_CURVES) {
      const e = f.eduEff[k][i]!;
      if (e > 0) edu += sv.eduWeight[k] * interp(sv.eduCurves[k], b.age) * e;
    }
    const pollution = f.air[i]! + f.waterPollution[i]! + s.garbage[i]! * cfg.garbage.hqPollution + (s.radiation[i]! > 0 ? sv.radiationPollution : 0);
    // Health and reading ordinances work on every block, not only where
    // a clinic or school reaches: a citywide share of a clinic's or school's full boost.
    b.hq += sv.hqPerBoost * (f.hqBoost[i]! * ord.hq + (ord.hq - 1) * CLINIC_BOOST) - sv.quotientDecay - sv.hqPerPollution * Math.max(0, pollution - sv.hqPollutionFree);
    b.eq += sv.eqPerBoost * (edu * ord.eq + (ord.eq - 1) * SCHOOL_BOOST) - sv.quotientDecay;
    b.hq = Math.max(0, Math.min(sv.quotientMax, b.hq));
    b.eq = Math.max(0, Math.min(sv.quotientMax, b.eq));
    b.age += 1 / 12;
    if (b.age >= sv.startAge + interp(sv.lifeExpectancyByHq, b.hq)) {
      const base = sv.baseQuotient[cfg.demand.wealthOf[b.type]];
      b.age = sv.startAge;
      b.eq = Math.max(base, sv.inheritance * b.eq);
      b.hq = Math.max(base, sv.inheritance * b.hq);
    }
  }
}

/** Residents' average EQ and HQ by wealth (occupancy weighted). */
export function quotientAverages(s: CityState): { eq: PerWealth; hq: PerWealth } {
  const sum = { eq: [0, 0, 0] as PerWealth, hq: [0, 0, 0] as PerWealth, n: [0, 0, 0] as PerWealth };
  for (const b of s.buildings.values()) {
    if (!b.type || b.type[0] !== 'R') continue;
    const w = b.type === 'R$' ? 0 : b.type === 'R$$' ? 1 : 2;
    const r = residentsOf(b);
    sum.eq[w] += b.eq * r;
    sum.hq[w] += b.hq * r;
    sum.n[w] += r;
  }
  const avg = (v: PerWealth) => WEALTHS.map((w) => (sum.n[w] > 0 ? v[w] / sum.n[w] : 0)) as PerWealth;
  return { eq: avg(sum.eq), hq: avg(sum.hq) };
}


// ---------------------------------------------------------------- water

export interface WaterReport {
  supply: number;
  demand: number;
  /** Active pipe networks only (empty, sourceless stubs are left out). */
  networks: UtilityNetwork[];
  /** Buildings cut off by shortages this month (including those on piped networks with no working source). */
  shortages: number;
  /** Of those, buildings on networks with no working source (not a shortfall in supply). */
  sourceless?: number;
  /** Buildings on networks whose pumps and towers all make nothing (unpowered, polluted, unfunded), and one such pump. */
  pumpsOff?: number;
  pumpsOffAt?: { x: number; y: number };
  /** A building on pipes no pump feeds (where to join them up). */
  sourcelessAt?: { x: number; y: number };
}

/** m³ a building uses per month. */
export function waterUse(cfg: SimConfig, b: Building): number {
  if (!b.type) return 0;
  return Math.max(1, b.capacity * b.occupancy) * cfg.services.waterPerCapita[b.type];
}

/** Pump/tower output this month: age, funding, power and pollution. */
export function pumpCapacity(cfg: SimConfig, f: Fields, n: number, def: StructureDef, st: Structure, funding: number): number {
  if (!def.pump || !st.powered) return 0;
  const sv = cfg.services;
  for (let y = st.y; y < st.y + st.h; y++) {
    for (let x = st.x; x < st.x + st.w; x++) if (f.waterPollution[y * n + x]! > sv.pumpPollutionLimit) return 0;
  }
  return def.pump.output * interp(sv.waterOutputByAge, st.life) * Math.min(1, funding / 100);
}

/**
 * Water networks are pipes plus the pumps and towers on or next to them;
 * zones and buildings do not carry water (unlike power). Every tile within
 * WATER_RADIUS of a network is covered, and a building is watered when any
 * of its tiles is covered. Shortages cut off the buildings farthest from a
 * water source first.
 */
export function computeWater(s: CityState, f: Fields, cfg: SimConfig): WaterReport {
  return drain(computeWaterSteps(s, f, cfg));
}

/** `computeWater` in steps (see ./steps). */
export function* computeWaterSteps(s: CityState, f: Fields, cfg: SimConfig): Generator<void, WaterReport> {
  const n = s.size;
  const N = n * n;
  const sv = cfg.services;
  const node = new Uint8Array(N);
  const pumps: Structure[] = [];
  yield;
  for (let i = 0; i < N; i++) if (s.pipe[i]) node[i] = 1;
  yield;
  let piece1 = 0;
  for (const st of s.structures.values()) {
    if ((++piece1 & 0x1ff) === 0) yield;
    if (!cfg.structures[st.kind].pump) continue;
    pumps.push(st);
    for (let y = st.y; y < st.y + st.h; y++) for (let x = st.x; x < st.x + st.w; x++) node[y * n + x] = 1;
  }

  // Networks: 4-connected node tiles.
  const net = new Int32Array(N).fill(-1);
  let count = 0;
  const stack: number[] = [];
  yield;
  for (let start = 0; start < N; start++) {
    if ((start & 0x7fff) === 0x7fff) yield;
    if (!node[start] || net[start]! >= 0) continue;
    net[start] = count;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % n;
      const y = (i - x) / n;
      for (const j of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1]) {
        if (j >= 0 && node[j] && net[j]! < 0) {
          net[j] = count;
          stack.push(j);
        }
      }
    }
    count++;
  }

  // Coverage: Chebyshev distance ≤ radius from any network tile.
  const cover = f.waterNet;
  cover.fill(-1);
  const dist = new Uint16Array(N).fill(0xffff);
  const queue: number[] = [];
  yield;
  for (let i = 0; i < N; i++) {
    if ((i & 0x7fff) === 0x7fff) yield;
    if (net[i]! >= 0) {
      cover[i] = net[i]!;
      dist[i] = 0;
      queue.push(i);
    }
  }
  yield;
  for (let h = 0; h < queue.length; h++) {
    if ((h & 0x1fff) === 0x1fff) yield;
    const i = queue[h]!;
    const d = dist[i]!;
    if (d >= sv.waterRadius) continue;
    const x = i % n;
    const y = (i - x) / n;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX8[k]!;
      const ny = y + DY8[k]!;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (dist[j]! > d + 1) {
        dist[j] = d + 1;
        cover[j] = cover[i]!;
        queue.push(j);
      }
    }
  }

  const supply = new Float64Array(count);
  const demand = new Float64Array(count);
  const sources: Structure[][] = Array.from({ length: count }, () => []);
  const pumpOn: (Structure | undefined)[] = new Array(count); // a pump or tower on each network, working or not
  yield;
  let piece2 = 0;
  for (const st of pumps) {
    if ((++piece2 & 0x1ff) === 0) yield;
    st.capacity = pumpCapacity(cfg, f, n, cfg.structures[st.kind], st, structureFunding(s, cfg.structures[st.kind], st));
    const g = net[st.y * n + st.x]!;
    pumpOn[g] ??= st;
    supply[g]! += st.capacity;
    if (st.capacity > 0) sources[g]!.push(st);
  }
  // Neighbor Deals on the pipe network that reaches each edge.
  const imported = new Float64Array(count);
  const importSources = new Map<number, UtilitySource[]>();
  yield;
  for (const d of activeDeals(s, 'water')) {
    const t = edgeTile(s, d.edge, (i) => s.pipe[i] === 1 && net[i]! >= 0);
    if (t < 0) continue;
    const g = net[t]!;
    if (d.direction === 'buy') {
      supply[g]! += d.amount;
      imported[g]! += d.amount;
      const list = importSources.get(g) ?? [];
      list.push({ kind: 'import', id: d.id, capacity: d.amount, x: t % n, y: Math.floor(t / n), edge: d.edge });
      importSources.set(g, list);
    } else demand[g]! += d.amount;
  }
  // An idle pipe network must not hide coverage from a supplied one nearby.
  // Keep cover's pipe identities for queries; consumers prefer the supplied coverage.
  let suppliedCover = cover;
  if (supply.some((v) => v > 0) && supply.some((v) => v <= 0)) {
    suppliedCover = new Int32Array(N).fill(-1);
    dist.fill(0xffff);
    queue.length = 0;
    for (let i = 0; i < N; i++) {
      if ((i & 0x7fff) === 0x7fff) yield;
      if (net[i]! >= 0 && supply[net[i]!]! > 0) {
        suppliedCover[i] = net[i]!;
        dist[i] = 0;
        queue.push(i);
      }
    }
    yield;
    for (let h = 0; h < queue.length; h++) {
      if ((h & 0x1fff) === 0x1fff) yield;
      const i = queue[h]!;
      const d = dist[i]!;
      if (d >= sv.waterRadius) continue;
      const x = i % n;
      const y = (i - x) / n;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX8[k]!;
        const ny = y + DY8[k]!;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (dist[j]! > d + 1) {
          dist[j] = d + 1;
          suppliedCover[j] = suppliedCover[i]!;
          queue.push(j);
        }
      }
    }
  }
  const netOf = (r: { x: number; y: number; w: number; h: number }) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const g = suppliedCover[y * n + x]!;
        if (g >= 0 && supply[g]! > 0) return g;
      }
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) if (cover[y * n + x]! >= 0) return cover[y * n + x]!;
    }
    return -1;
  };
  type Consumer = { use: number; g: number; b?: Building; x: number; y: number };
  const ordWater = ordinanceEffects(s).water;
  const consumers: Consumer[] = [];
  yield;
  let piece3 = 0;
  for (const b of s.buildings.values()) {
    if ((++piece3 & 0x1ff) === 0) yield;
    b.watered = false;
    const g = netOf(b);
    if (g < 0 || !b.type) continue;
    const use = waterUse(cfg, b) * ordWater;
    demand[g]! += use;
    consumers.push({ use, g, b, x: b.x + b.w / 2, y: b.y + b.h / 2 });
  }
  yield;
  let piece4 = 0;
  for (const st of s.structures.values()) {
    if ((++piece4 & 0x1ff) === 0) yield;
    const use = cfg.structures[st.kind].waterUse * ordWater;
    const g = netOf(st);
    if (g >= 0 && use > 0) demand[g]! += use;
  }

  // Shortages: farthest consumers from a working source lose water first.
  let cut = 0;
  const byNet: Consumer[][] = Array.from({ length: count }, () => []);
  yield;
  for (const c of consumers) byNet[c.g]!.push(c);
  // Once the city has water somewhere, a piped network with no working source
  // (cut off by a burst, its pumps off) is short too.
  const anySupply = supply.some((v) => v > 0);
  let sourceless = 0;
  let pumpsOff = 0;
  let pumpsOffAt: { x: number; y: number } | undefined;
  let sourcelessAt: { x: number; y: number } | undefined;
  yield;
  for (let g = 0; g < count; g++) {
    if ((g & 0x7fff) === 0x7fff) yield;
    const list = byNet[g]!;
    // Pumps that all stand idle are told apart even while the city has no water
    // anywhere (those buildings aren't counted as short then, as before).
    if (supply[g]! <= 0 && pumpOn[g] && list.length) {
      pumpsOff += list.length;
      pumpsOffAt ??= { x: pumpOn[g]!.x, y: pumpOn[g]!.y };
    }
    if (supply[g]! <= 0 && anySupply) {
      cut += list.length;
      if (!pumpOn[g] && list.length) {
        sourceless += list.length;
        sourcelessAt ??= { x: list[0]!.b!.x, y: list[0]!.b!.y };
      }
    }
    const src = sources[g]!;
    let excess = demand[g]! - supply[g]!;
    if (excess > 0 && src.length) {
      // Farthest from a source first (ties by id): each consumer's distance to
      // its nearest source, then by distance in buckets (a comparison sort of
      // a city-wide network is a frame's work).
      const byFar = new Map<number, Consumer[]>();
      let measured = 0;
      for (const c of list) {
        // (Work grows with the sources as well as the consumers.)
        measured += src.length;
        if (measured > 0x3fff) {
          measured = 0;
          yield;
        }
        let d = Infinity;
        for (const p of src) d = Math.min(d, Math.max(Math.abs(p.x + p.w / 2 - c.x), Math.abs(p.y + p.h / 2 - c.y)));
        const same = byFar.get(d);
        if (same) same.push(c);
        else byFar.set(d, [c]);
      }
      yield;
      list.length = 0;
      for (const d of [...byFar.keys()].sort((a, b) => b - a)) {
        const same = byFar.get(d)!;
        if (same.length > 1) same.sort((a, b) => a.b!.id - b.b!.id);
        for (const c of same) list.push(c);
      }
    }
    for (const c of list) {
      if (supply[g]! <= 0) continue;
      if (excess > 0) {
        excess -= c.use;
        cut++;
        continue;
      }
      c.b!.watered = true;
    }
  }

  f.watered.fill(0);
  yield;
  for (let i = 0; i < N; i++) if (suppliedCover[i]! >= 0 && supply[suppliedCover[i]!]! > 0) f.watered[i] = 1;

  // Supply counts only networks that serve something: a pump on its own pipe
  // stub waters nobody (once anything is connected at all).
  let totalSupply = 0;
  let totalDemand = 0;
  let idle = 0;
  yield;
  for (let g = 0; g < count; g++) {
    if ((g & 0x7fff) === 0x7fff) yield;
    if (demand[g]! > 0) totalSupply += supply[g]!;
    else idle += supply[g]!;
    totalDemand += demand[g]!;
  }
  if (totalDemand === 0) totalSupply += idle;
  yield;
  let piece5 = 0;
  for (const st of pumps) {
    if ((++piece5 & 0x1ff) === 0) yield;
    const g = net[st.y * n + st.x]!;
    const own = supply[g]! - imported[g]!;
    st.load = own > 0 ? (Math.max(0, Math.min(demand[g]!, supply[g]!) - imported[g]!) * st.capacity) / own : 0;
    st.effectiveness = st.capacity > 0 ? st.load / st.capacity : 0;
  }
  const networks: UtilityNetwork[] = [];
  yield;
  for (let g = 0; g < count; g++) {
    if ((g & 0x1fff) === 0x1fff) yield;
    if (!(supply[g]! > 0 || demand[g]! > 0)) continue;
    const list = byNet[g]!;
    const local = sources[g]!.map((st): UtilitySource => ({ kind: 'pump', id: st.id, capacity: st.capacity, x: st.x, y: st.y }));
    const allSources = [...local, ...(importSources.get(g) ?? [])];
    const at = pumpOn[g] ?? list[0]?.b ?? allSources[0];
    networks.push({
      id: g, resource: 'water', supply: supply[g]!, demand: demand[g]!, importCapacity: imported[g]!, sources: allSources,
      buildings: list.length, residents: list.reduce((total, c) => total + (c.b!.type?.[0] === 'R' ? c.b!.capacity * c.b!.occupancy : 0), 0),
      x: at?.x ?? 0, y: at?.y ?? 0,
    });
  }
  return { supply: totalSupply, demand: totalDemand, networks, shortages: cut, sourceless, pumpsOff, ...(pumpsOffAt ? { pumpsOffAt } : {}), ...(sourcelessAt ? { sourcelessAt } : {}) };
}
