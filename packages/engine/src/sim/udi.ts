// U-Drive-It. The engine decides which vehicles and missions are
// available, picks where a mission starts and where it has to go, checks
// where a vehicle may drive, and applies the outcome: a short-term Mayor
// Rating effect where the mission ended, cash, and reward unlocks (some take
// several missions). The driving itself happens in the viewer.

import type { SimConfig } from '../config';
import { MISSIONS, type MissionId } from '../data/missions';
import type { StructureKind } from '../data/structures';
import { PARTIAL_UNLOCKS, trainingOf, VEHICLES, type MissionDef, type PopulationKey, type TrainingClass, type VehicleDef, type VehicleId } from '../data/udi';
import { Rng } from '../rng';
import { LANDFILL_ZONE } from './garbage';
import { frontage } from './fields';
import { ELEVATED, isAsphalt, isRail, Terrain, ZONES, type CityState, type Structure } from './state';

/** A mission being driven: where the vehicle starts and the tile it must reach. */
export interface ActiveMission {
  id: MissionId;
  vehicle: VehicleId;
  start: number;
  target: number;
  /** Seconds of real time allowed (viewer clock). */
  seconds: number;
  /** Fire missions: the burning building (> 0) or structure (< 0, as fires store it) to put out. */
  fire?: number;
}

/** Missions played so far and progress towards multi-mission rewards. */
export interface UdiState {
  done: Partial<Record<MissionId, number>>;
  partial: Partial<Record<StructureKind, number>>;
}

/** Seconds to finish a mission by difficulty (our choice). */
export const MISSION_SECONDS = { easy: 90, medium: 70, hard: 50 } as const;
/** Tiles (along the grid) the base time is for. */
export const MISSION_REACH = 24;

function has(s: CityState, kinds: readonly StructureKind[]): Structure | undefined {
  for (const st of s.structures.values()) if (kinds.includes(st.kind)) return st;
  return undefined;
}

/** Residents or jobs of a zone class ('R', 'C', 'I') or of one developer type. */
function population(s: CityState, key: PopulationKey): number {
  let total = 0;
  for (const b of s.buildings.values()) {
    if (!b.type || b.occupancy <= 0) continue;
    if (key.length === 1 ? b.type[0] === key : b.type === key) total += b.capacity * b.occupancy;
  }
  return total;
}

export function vehicleAvailable(s: CityState, id: VehicleId): boolean {
  const v: VehicleDef = VEHICLES[id];
  if (!v.requires.every((group) => has(s, group))) return false;
  switch (v.needs) {
    case 'residential': return [...s.buildings.values()].some((b) => b.type?.[0] === 'R' && b.occupancy > 0);
    case 'commercial': return [...s.buildings.values()].some((b) => b.type?.[0] === 'C' && b.occupancy > 0);
    case 'landfill': return s.zone.includes(LANDFILL_ZONE);
    case 'mySim1': return s.mySims.some((m) => m.wealth === 0);
    case 'mySim2': return s.mySims.some((m) => m.wealth === 1);
    case 'mySim3': return s.mySims.some((m) => m.wealth === 2);
    default: return true;
  }
}

/** Has the training for this vehicle type been passed? */
export function trained(s: CityState, cls: TrainingClass): boolean {
  return (Object.keys(MISSIONS) as MissionId[]).some((id) => (MISSIONS[id] as MissionDef).training === cls && (s.udi.done[id] ?? 0) > 0);
}

/** The vehicle a mission is driven with: its own, or for training any available one of the class. */
export function vehicleFor(s: CityState, m: MissionDef): VehicleId | null {
  if (m.anyMySim) return (['mySimVehicle1', 'mySimVehicle2', 'mySimVehicle3'] as const).find((v) => vehicleAvailable(s, v)) ?? null;
  if (!m.training) return vehicleAvailable(s, m.vehicle) ? m.vehicle : null;
  // Any vehicle of the class that is available and has somewhere to go (track, water …).
  const N = s.size * s.size;
  const drivable = (v: VehicleId) => {
    for (let i = 0; i < N; i++) if (canDrive(s, v, i)) return true;
    return false;
  };
  const fits = (Object.keys(VEHICLES) as VehicleId[]).filter((v) => trainingOf(v) === m.training && vehicleAvailable(s, v));
  // (None with anywhere to go: not available, rather than one that then had "nowhere to drive".)
  return fits.find(drivable) ?? null;
}

/** Can the mission be played now (vehicle, triggers, not already won unless repeatable)? */
export function missionAvailable(s: CityState, cfg: SimConfig, id: MissionId): boolean {
  const m: MissionDef = MISSIONS[id];
  if (!m.repeatable && (s.udi.done[id] ?? 0) > 0) return false;
  if (m.training) return vehicleFor(s, m) !== null;
  // Other missions open once their vehicle type's training is passed (land and air: we assume no
  // training at sea, and boat practice is only practice).
  const cls = trainingOf(m.vehicle);
  if (cls !== 'boat' && !trained(s, cls)) return false;
  if (!vehicleFor(s, m)) return false;
  const t = m.triggers;
  if (t.structures && !t.structures.every((group) => has(s, group))) return false;
  for (const [k, v] of Object.entries(t.population ?? {})) if (population(s, k as PopulationKey) <= v!) return false;
  if (t.fire && !s.fires.length) return false;
  if (t.landfill && !s.zone.includes(LANDFILL_ZONE)) return false;
  if (t.water && !s.terrain.includes(Terrain.Water)) return false;
  for (const { kinds, count } of t.atLeast ?? []) {
    let k = 0;
    for (const st of s.structures.values()) if (kinds.includes(st.kind)) k++;
    if (k < count) return false;
  }
  for (const [key, v] of Object.entries(t.lots ?? {})) {
    let k = 0;
    for (const b of s.buildings.values()) if (b.type && (key.length === 1 ? b.type[0] === key : b.type === key)) k++;
    if (k <= v!) return false;
  }
  if (t.tiles) {
    const count = { rail: 0, monorail: 0, lowResidential: 0, agriculture: 0 };
    for (let i = 0; i < s.net.length; i++) {
      if (isRail(s.net[i]!)) count.rail++;
      if (s.elevated[i] === ELEVATED.monorail) count.monorail++;
      if (s.zone[i] === LOW_RESIDENTIAL) count.lowResidential++;
      if (s.zone[i] === AGRICULTURE) count.agriculture++;
    }
    // Track lengths are "more than" (>20 rails: 21 or more); zone areas "at least".
    for (const [key, v] of Object.entries(t.tiles)) {
      const c = count[key as keyof typeof count];
      if (key === 'rail' || key === 'monorail' ? c <= v! : c < v!) return false;
    }
  }
  return true;
}

const LOW_RESIDENTIAL = ZONES.indexOf('R-low');
const AGRICULTURE = ZONES.indexOf('A');

/** Where a vehicle may be: roads for cars, track for trains, water for boats, anywhere for aircraft. */
export function canDrive(s: CityState, vehicle: VehicleId, i: number): boolean {
  const v: VehicleDef = VEHICLES[vehicle];
  if (i < 0 || i >= s.size * s.size) return false;
  switch (v.class) {
    case 'land': return isAsphalt(s.net[i]!);
    case 'rail': return vehicle === 'monorailEngine' ? s.elevated[i] === ELEVATED.monorail : isRail(s.net[i]!);
    case 'water': return s.terrain[i] === Terrain.Water;
    default: return true;
  }
}

/** Tiles reachable from `start` by the vehicle (4-neighbour flood fill). */
function reachable(s: CityState, vehicle: VehicleId, start: number): Uint8Array {
  const n = s.size;
  const seen = new Uint8Array(n * n);
  const queue = [start];
  seen[start] = 1;
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!;
    const x = i % n;
    for (const j of [i - 1, i + 1, i - n, i + n]) {
      if (j < 0 || j >= n * n || seen[j] || Math.abs((j % n) - x) > 1 || !canDrive(s, vehicle, j)) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return seen;
}

/** The vehicle's home structure (where missions start). */
function depot(s: CityState, vehicle: VehicleId): Structure | undefined {
  const v: VehicleDef = VEHICLES[vehicle];
  return v.requires.length ? has(s, v.requires[0]!) : undefined;
}

/** Picks a start and a target for a mission, or explains why it can't start. */
export function planMission(s: CityState, cfg: SimConfig, id: MissionId): ActiveMission | string {
  if (!missionAvailable(s, cfg, id)) return 'mission not available';
  const m: MissionDef = MISSIONS[id];
  const vehicle = vehicleFor(s, m)!;
  const n = s.size;
  // (By the id's characters: by its length, missions with names as long got the same start and target.)
  let hash = 0;
  for (let k = 0; k < id.length; k++) hash = (Math.imul(hash, 31) + id.charCodeAt(k)) | 0;
  const rng = new Rng((s.day * 2_654_435_761) ^ hash ^ (s.udi.done[id] ?? 0));
  const ok = (i: number) => canDrive(s, vehicle, i);
  // Start: by the vehicle's depot, else anywhere it can be.
  let start = -1;
  const home = depot(s, vehicle);
  if (home) {
    const around: number[] = [];
    for (let y = home.y - 3; y < home.y + home.h + 3; y++) for (let x = home.x - 3; x < home.x + home.w + 3; x++) {
      if (x >= 0 && y >= 0 && x < n && y < n && ok(y * n + x)) around.push(y * n + x);
    }
    const front = frontage(s, home).filter(ok);
    start = front[0] ?? around[rng.int(Math.max(1, around.length))] ?? -1;
  }
  if (start < 0) {
    const all: number[] = [];
    for (let i = 0; i < n * n; i++) if (ok(i)) all.push(i);
    if (!all.length) return 'nowhere to drive';
    start = all[rng.int(all.length)]!;
  }
  const reach = reachable(s, vehicle, start);
  // Target: the fire for Fire!-type missions, else a reachable tile some way off.
  let target = -1;
  let fireTarget: number | undefined;
  if (m.triggers.fire && s.fires.length) {
    const fire = s.fires[rng.int(s.fires.length)]!;
    fireTarget = fire.target;
    const r = fire.target > 0 ? s.buildings.get(fire.target) : s.structures.get(-fire.target);
    if (r) {
      const near = frontage(s, r).filter((i) => reach[i]);
      target = near[0] ?? -1;
      if (target < 0 && VEHICLES[vehicle].class === 'air') target = Math.floor(r.y + r.h / 2) * n + Math.floor(r.x + r.w / 2);
    }
  }
  if (target < 0) {
    const sx = start % n;
    const sy = Math.floor(start / n);
    const want = m.training ? Math.min(12, Math.floor(n / 4)) : Math.min(24, Math.floor(n / 3));
    const far: number[] = [];
    const any: number[] = [];
    for (let i = 0; i < n * n; i++) {
      if (!reach[i] || i === start) continue;
      const d = Math.abs((i % n) - sx) + Math.abs(Math.floor(i / n) - sy);
      if (d >= want) far.push(i);
      else if (d >= 4) any.push(i);
    }
    const pool = far.length ? far : any;
    if (!pool.length) return 'nowhere to go: build more road, track or water for this vehicle';
    target = pool[rng.int(pool.length)]!;
  }
  // Time limits grow with how far the target is: the base time
  // covers MISSION_REACH tiles, farther targets get proportionally more.
  const dist = Math.abs((target % n) - (start % n)) + Math.abs(Math.floor(target / n) - Math.floor(start / n));
  const seconds = Math.round(MISSION_SECONDS[m.difficulty] * Math.max(1, dist / MISSION_REACH));
  return { id, vehicle, start, target, seconds, ...(fireTarget !== undefined ? { fire: fireTarget } : {}) };
}

/** Applies a mission's outcome at the tile where it ended; returns rewards newly unlocked. */
export function finishMission(s: CityState, cfg: SimConfig, id: MissionId, success: boolean, at: number): StructureKind[] {
  const m: MissionDef = MISSIONS[id];
  const r = success ? m.success : m.failure;
  const n = s.size;
  if (r.mr) s.events.push({ x: at % n, y: Math.floor(at / n), radius: r.radius, amount: r.mr, months: cfg.mayor.eventMonths, age: 0 });
  s.funds += r.cash;
  const unlocked: StructureKind[] = [];
  const unlock = (k: StructureKind) => {
    if (s.unlocked.includes(k)) return;
    s.unlocked.push(k);
    unlocked.push(k);
  };
  if (success) {
    s.udi.done[id] = (s.udi.done[id] ?? 0) + 1;
    for (const k of r.unlocks ?? []) unlock(k);
    if (r.partial) {
      const got = (s.udi.partial[r.partial] = (s.udi.partial[r.partial] ?? 0) + 1);
      if (got >= (PARTIAL_UNLOCKS[r.partial] ?? 1)) unlock(r.partial);
    }
  }
  return unlocked;
}
