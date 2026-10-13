// Development: picking a developer type, ranking tracts, and
// building, redeveloping, downgrading or abandoning buildings.

import { drain } from './steps';
import type { SimConfig } from '../config';
import type { StageTable } from '../data/stages';
import type { Rng } from '../rng';
import { DEV_TYPES, type DevType } from '../types';
import type { Census, DemandReport } from './demand';
import type { DesirabilityMap } from './desirability';
import { footprint, frontage, type Fields } from './fields';
import { idx, needsPower, needsWater, Net, Terrain, zoneClassFor, zoneInfo, type Building, type CityState, type Rect } from './state';

/** Target share of buildings per stage for a type at its current population. */
export function stageTargets(table: StageTable, population: number, mult: number): number[] {
  let col = 0;
  table.thresholds.forEach((th, i) => {
    if (population >= th * mult) col = i;
  });
  return table.rows.map((row) => row[col]! / 100);
}

/** Stage the next building should be: the largest still under its target share. */
export function chooseStage(targets: number[], counts: number[]): { preferred: number; max: number } {
  const total = counts.reduce((a, b) => a + (b ?? 0), 0);
  let max = 1;
  targets.forEach((t, i) => {
    if (t > 0) max = i + 1;
  });
  for (let s = max; s >= 1; s--) {
    const share = total > 0 ? (counts[s - 1] ?? 0) / total : 0;
    if (targets[s - 1]! > 0 && share < targets[s - 1]!) return { preferred: s, max };
  }
  return { preferred: max, max };
}

export function lotSize(cfg: SimConfig, t: DevType, stage: number): number {
  const tpl = cfg.development.templates[t][stage - 1]!;
  const bonus = stage <= 3 ? cfg.development.lotBonus[t] ?? 0 : 0;
  return Math.min(4, tpl.size + bonus);
}

/**
 * Capacity for occupant `t` of a building built by `origType` at `stage`.
 * Industrial outbuildings smaller than the template scale by area.
 */
/**
 * Lot shapes to try, best first. Small homes and shops sit on 1×2 lots
 * (house plus yard), so two-deep blocks fill like SC4's; industry and farms
 * fill leftover gaps with smaller outbuildings.
 */
export function lotShapes(cfg: SimConfig, t: DevType, stage: number): [number, number][] {
  const full = lotSize(cfg, t, stage);
  const cls = zoneClassFor(t);
  if (cls === 'I' || cls === 'A') {
    const out: [number, number][] = [];
    for (let s = full; s >= 1; s--) out.push([s, s]);
    return out;
  }
  if (full === 1) return [[1, 2], [2, 1], [1, 1]];
  return [[full, full]];
}

export function capacityOf(cfg: SimConfig, t: DevType, stage: number, origType: DevType, lot?: Rect): number {
  const tpl = cfg.development.templates[origType][stage - 1]!;
  const full = lotSize(cfg, origType, stage);
  const area = lot && lot.w * lot.h < full * full ? (lot.w * lot.h) / (full * full) : 1;
  return Math.max(1, Math.round(tpl.capacity * area * cfg.development.capacityMult[t] / cfg.development.capacityMult[origType]));
}

/** Average desirability of a type over a footprint. */
export function desirabilityOver(s: CityState, map: DesirabilityMap, t: DevType, b: Rect): number {
  let sum = 0;
  const tiles = footprint(s, b);
  for (const i of tiles) sum += map[t][i]!;
  return sum / tiles.length;
}

function wealthLine(t: DevType): string {
  return t.replace(/\$/g, '');
}

/** Types that may move into a building originally built for `orig` (same or lower wealth in its line). */
export function occupantsFor(cfg: SimConfig, orig: DevType): DevType[] {
  return [orig, ...(cfg.development.downgrade[orig] ?? [])];
}

export interface DevContext {
  s: CityState;
  cfg: SimConfig;
  f: Fields;
  desir: DesirabilityMap;
  census: Census;
  demand: DemandReport;
  rng: Rng;
  nextId: () => number;
  removeBuilding: (b: Building) => void;
  /** Tract rankings per type, valid until desirability is recomputed. */
  tractCache?: Map<DevType, { tx: number; ty: number; score: number }[]>;
  /** Tracts found full, per type and stage, until the next recompute. */
  tractFull?: Map<string, Set<number>>;
}

/**
 * Largest stage slope allows on a tile (slope is a gradual stage cap). The caps are for the
 * eight-stage types; one with fewer stages (industry and farms have three) is capped as far up its own
 * scale, so medium and steep land hold its biggest buildings back too.
 */
function slopeCap(ctx: DevContext, i: number, t?: DevType): number {
  const sl = ctx.f.slope[i]!;
  const sc = ctx.cfg.terrain.slope;
  const cap = sl <= sc.flat ? sc.maxStage[0]! : sl <= sc.medium ? sc.maxStage[1]! : sl <= sc.steep ? sc.maxStage[2]! : 0;
  if (!t || cap === 0) return cap;
  const stages = ctx.cfg.development.templates[t].length;
  return Math.max(1, Math.round((cap * stages) / sc.maxStage[0]!));
}

function zoneFits(ctx: DevContext, t: DevType, i: number, stage: number): boolean {
  const { s, cfg } = ctx;
  if (s.terrain[i] === Terrain.Water || s.net[i] !== Net.None || s.rubble[i] || s.elevated[i] || s.landform[i] === 2) return false;
  if (stage > slopeCap(ctx, i, t)) return false;
  const z = zoneInfo(s.zone[i]!);
  const want = zoneClassFor(t);
  if (z.cls !== want) return false;
  if (want === 'A') return true;
  return stage <= cfg.development.densityMaxStage[want][z.density];
}

/** Can a new building of type `t` replace building `b`? */
function replaceable(ctx: DevContext, t: DevType, stage: number, b: Building): boolean {
  // Historical buildings are never redeveloped, even when abandoned; they wait to be reoccupied.
  if (b.historical) return false;
  if (zoneClassFor(b.origType) !== zoneClassFor(t)) return false;
  // An abandoned building is reoccupied rather than demolished, unless for a taller one: a stage-1
  // house bulldozed an empty stage-6 tower.
  if (!b.type) return stage > b.stage;
  // Farms don't get bigger as the population grows, unlike the rest of industry: a working farm stays.
  if (b.type === 'IA') return false;
  if ((ctx.cfg.development.canDisplace[t] ?? []).includes(b.type)) return true;
  return stage > b.stage && wealthLine(b.type) === wealthLine(t) && ctx.cfg.demand.wealthOf[t] >= ctx.cfg.demand.wealthOf[b.type];
}

/**
 * Road access for a lot: R/C must front a road or street (residents' road
 * must also lead to jobs); industry and farms may sit up to a few tiles
 * into their zone.
 */
export function hasAccess(ctx: DevContext, t: DevType, lot: Rect, toMoveIn = false): boolean {
  const { s, f } = ctx;
  const cls = zoneClassFor(t);
  if (cls === 'I' || cls === 'A') return footprint(s, lot).some((i) => f.industrialAccess[i]);
  const front = frontage(s, lot);
  if (!front.length) return false;
  if (cls !== 'R') return true;
  // Sims must find a job of their wealth within the trip limit (a tract with no open job in reach is
  // skipped); once the city has workplaces at all (the first homes come before the first jobs).
  // Without it homes grew out of reach of every job and were abandoned six months later.
  // (For Sims moving in: those living there already leave by the six-month no-job rule, not as if the road were gone.)
  const reach = toMoveIn && ctx.f.travel?.fastest.hasSources ? f.commuteByWealth[ctx.cfg.demand.wealthOf[t]]! : null;
  // (Those already there need only a road that leads to work: a road leading nowhere, or only to more
  // homes, is the two-month no-road rule, a shortage of jobs the six-month no-job one.)
  const leads = toMoveIn ? f.componentHasJobs : f.componentHasWork;
  return front.some((r) => leads[f.component[r]!] && (!reach || reach[r]! <= ctx.cfg.transport.tripLimit));
}

interface Placement extends Rect {
  displaced: Building[];
  cost: number;
}

function tryPlace(ctx: DevContext, t: DevType, stage: number, w: number, h: number, tx: number, ty: number): Placement | null {
  const { s, cfg } = ctx;
  const T = cfg.development.tractSize;
  // Whether each tile could be part of the lot, worked out once: the
  // candidate windows below overlap, and would otherwise check each tile
  // many times over.
  const gx = Math.max(0, tx - w + 1);
  const gy = Math.max(0, ty - h + 1);
  const gw = Math.min(s.size, tx + T + w - 1) - gx;
  const gh = Math.min(s.size, ty + T + h - 1) - gy;
  if (gw <= 0 || gh <= 0) return null;
  // Summed-area table of the tiles that don't fit: a window fits when its sum is 0.
  const W = gw + 1;
  const bad = new Int32Array(W * (gh + 1));
  for (let yy = 0; yy < gh; yy++) {
    let row = 0;
    for (let xx = 0; xx < gw; xx++) {
      const i = idx(s, gx + xx, gy + yy);
      const occ = s.occupant[i]!;
      if (!(occ >= 0 && zoneFits(ctx, t, i, stage) && (occ === 0 || replaceable(ctx, t, stage, s.buildings.get(occ)!)))) row++;
      bad[(yy + 1) * W + xx + 1] = bad[yy * W + xx + 1]! + row;
    }
  }
  const candidates: Placement[] = [];
  for (let y = ty - h + 1; y < ty + T; y++) {
    for (let x = tx - w + 1; x < tx + T; x++) {
      if (x < 0 || y < 0 || x + w > s.size || y + h > s.size) continue;
      const ax = x - gx;
      const ay = y - gy;
      if (bad[(ay + h) * W + ax + w]! - bad[ay * W + ax + w]! - bad[(ay + h) * W + ax]! + bad[ay * W + ax]! > 0) continue;
      const displaced = new Set<Building>();
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          const occ = s.occupant[idx(s, xx, yy)]!;
          if (occ > 0) displaced.add(s.buildings.get(occ)!);
        }
      }
      // Displaced buildings must not stick out of the new footprint by much:
      // demolishing them whole is fine (the simulator aggregates lots).
      const lot = { x, y, w, h };
      if (!hasAccess(ctx, t, lot, true) || !hasPower(ctx, lot) || !waterAllows(ctx, t, stage, lot)) continue;
      let cost = 0;
      let others = 0;
      for (const b of displaced) {
        if (b.type && b.type !== t) others += b.capacity * b.occupancy;
        cost += b.type ? b.capacity * b.occupancy + 1 : 0.5;
      }
      // Taking over another type's occupied lots must keep roughly as many
      // people or jobs as it displaces: a half-empty Cs$$ shop replacing busy
      // Cs$ ones shrinks the city's jobs, keeps its own demand up and invites
      // the next replacement. (A type rebuilding its own lots denser may.)
      if (others > 0) {
        const expected = capacityOf(cfg, t, stage, t, lot) * Math.min(1, desirabilityOver(s, ctx.desir, t, lot) / cfg.desirability.fullOccupancy);
        if (expected < others * 0.8) continue;
        // …and be wanted: with the type's demand for half of it at most, the newcomers outnumber what the
        // city calls for, the building sits half empty and the displaced (who can't take it back) are gone.
        if (!wantedFor(ctx, t, expected)) continue;
      }
      candidates.push({ x, y, w, h, displaced: [...displaced], cost });
    }
  }
  if (!candidates.length) return null;
  let best = Infinity;
  for (const c of candidates) best = Math.min(best, c.cost);
  const top = candidates.filter((c) => c.cost === best);
  return top[ctx.rng.int(top.length)]!;
}

/** Whether a 1×2 or 2×1 lot has a road beyond one of its short ends (it runs back from the road). */
function shortSideRoad(s: CityState, lot: Rect): boolean {
  const road = (x: number, y: number) => x >= 0 && y >= 0 && x < s.size && y < s.size && s.net[idx(s, x, y)] !== Net.None;
  return lot.w < lot.h
    ? road(lot.x, lot.y - 1) || road(lot.x, lot.y + lot.h)
    : road(lot.x - 1, lot.y) || road(lot.x + lot.w, lot.y);
}

/** Whether a 1×2 or 2×1 lot lies along a road (a road beside one of its long sides). */
function longSideRoad(s: CityState, lot: Rect): boolean {
  const road = (x: number, y: number) => x >= 0 && y >= 0 && x < s.size && y < s.size && s.net[idx(s, x, y)] !== Net.None;
  for (let k = 0; k < Math.max(lot.w, lot.h); k++) {
    if (lot.w < lot.h ? road(lot.x - 1, lot.y + k) || road(lot.x + 1, lot.y + k) : road(lot.x + k, lot.y - 1) || road(lot.x + k, lot.y + 1)) return true;
  }
  return false;
}

/** Could an occupant of type `t` move into abandoned building `b` now? Its desirability there, or -1. */
function reoccupyScore(ctx: DevContext, t: DevType, b: Building): number {
  const { s, cfg, desir } = ctx;
  if (b.type || !occupantsFor(cfg, b.origType).includes(t) || !hasAccess(ctx, t, b, true)) return -1;
  if (b.historical && t !== b.origType) return -1; // a historical building waits for its own kind
  if (!hasPower(ctx, b) || !waterAllows(ctx, t, b.stage, b)) return -1;
  if (workersBlocked(ctx, t)) return -1;
  const d = desirabilityOver(s, desir, t, b);
  return d >= cfg.desirability.developThreshold ? d : -1;
}

function reoccupy(ctx: DevContext, t: DevType, b: Building, d: number): void {
  newHousehold(ctx, b, t);
  delete b.jobs; // new occupants look for their own jobs (those held were the last occupants', maybe of another wealth)
  b.type = t;
  b.capacity = capacityOf(ctx.cfg, t, b.stage, b.origType, b);
  b.occupancy = Math.min(1, d / ctx.cfg.desirability.fullOccupancy);
  b.abandonReason = null;
  // New occupants start every countdown afresh (left at their limits, a home
  // abandoned for its commute would go again after one bad month).
  b.distressMonths = 0;
  b.noRoadMonths = 0;
  b.noPowerMonths = 0;
  b.noWaterMonths = 0;
  b.noJobMonths = 0;
  b.commute = -1;
  b.filled = 0;
  b.powered = true;
}

/**
 * Moving into an empty building comes before building anew: the most
 * desirable abandoned building anywhere that a `t` occupant would take. Without
 * this, buildings left in a slump stay empty after demand returns, because the
 * best tracts (where developers look first) are rarely where they stand.
 */
function reoccupyAnywhere(ctx: DevContext, t: DevType): boolean {
  if (!(ctx.census.abandonedFor?.[t] ?? ctx.census.abandoned)) return false;
  let best: Building | null = null;
  let bestD = -1;
  for (const b of ctx.s.buildings.values()) {
    if (b.type) continue;
    const d = reoccupyScore(ctx, t, b);
    if (d > bestD) {
      best = b;
      bestD = d;
    }
  }
  if (!best) return false;
  reoccupy(ctx, t, best, bestD);
  return true;
}

/** Is there demand (people or jobs wanted) for at least half of `amount` more of type `t`? For taking over occupied lots. */
function wantedFor(ctx: DevContext, t: DevType, amount: number): boolean {
  return ctx.demand.raw[t] >= amount * TAKEOVER_DEMAND_SHARE;
}
const TAKEOVER_DEMAND_SHARE = 0.5;

/**
 * The chosen type moves into an inhabited building on the tract before building anew, supplanting a
 * less wealthy occupant: a building built for it, or for wealthier, now held by poorer Sims. Without
 * it a tower downgraded in a slump never went back up.
 */
function moveUp(ctx: DevContext, t: DevType, tx: number, ty: number): boolean {
  const { s, cfg, desir } = ctx;
  const T = cfg.development.tractSize;
  const lower = cfg.development.canDisplace[t];
  if (!lower?.length || workersBlocked(ctx, t)) return false;
  const seen = new Set<number>();
  let best: Building | null = null;
  let bestD = -Infinity;
  for (let y = ty; y < Math.min(s.size, ty + T); y++) {
    for (let x = tx; x < Math.min(s.size, tx + T); x++) {
      const id = s.occupant[idx(s, x, y)]!;
      if (id <= 0 || seen.has(id)) continue;
      seen.add(id);
      const b = s.buildings.get(id);
      if (!b?.type || b.historical || !lower.includes(b.type) || !occupantsFor(cfg, b.origType).includes(t)) continue;
      if (!hasAccess(ctx, t, b, true) || !hasPower(ctx, b) || !waterAllows(ctx, t, b.stage, b)) continue;
      const d = desirabilityOver(s, desir, t, b);
      if (d < cfg.desirability.developThreshold || d <= bestD) continue;
      if (!wantedFor(ctx, t, capacityOf(cfg, t, b.stage, b.origType, b) * Math.min(1, d / cfg.desirability.fullOccupancy))) continue;
      [best, bestD] = [b, d];
    }
  }
  if (!best) return false;
  reoccupy(ctx, t, best, bestD);
  return true;
}

/** Could a building of type `t` (at `stage`) start on tile `i`? Cheap pre-check for ranking. */
function tileOpen(ctx: DevContext, t: DevType, stage: number, i: number): boolean {
  const { s, f, cfg } = ctx;
  const occ = s.occupant[i]!;
  if (occ < 0 || s.rubble[i]) return false;
  if (needsPower(s, cfg) && !f.powered[i]) return false;
  if (needsWater(s, cfg) && cfg.services.waterStageCap[t] === 0 && !f.watered[i]) return false;
  const cls = zoneClassFor(t);
  if (occ > 0) {
    const b = s.buildings.get(occ)!;
    if (!b.type) return occupantsFor(cfg, b.origType).includes(t);
    // Redevelopment can only go as high as the zone density allows.
    const z = zoneInfo(s.zone[i]!);
    const cap = cls === 'A' || !z.cls || z.cls === 'A' ? stage : cfg.development.densityMaxStage[cls][z.density];
    return replaceable(ctx, t, Math.min(stage, cap), b);
  }
  if (cls === 'I' || cls === 'A') return f.industrialAccess[i] === 1;
  return f.access[i]! >= 0 && f.accessDist[i] === 1;
}

/**
 * Tract ranking for a type: mean desirability over the tract's matching zone
 * tiles, keeping only tracts with somewhere to build and at least the
 * development threshold.
 */
export function rankTracts(ctx: DevContext, t: DevType, stage = 1, limit = Infinity): Tract[] {
  const { s } = ctx;
  const T = ctx.cfg.development.tractSize;
  const out: Tract[] = [];
  // Scores only change when desirability is recomputed; openness is checked
  // best tracts first until enough are found. A full tract is remembered as
  // full until the next recompute (new room appears mostly through
  // abandonment, which the weekly refresh picks up).
  const key = `${t}|${stage}`;
  let full = ctx.tractFull?.get(key);
  if (ctx.tractFull && !full) ctx.tractFull.set(key, (full = new Set()));
  for (const tract of tractScores(ctx, t)) {
    if (out.length >= limit) break;
    const id = tract.ty * s.size + tract.tx;
    if (full?.has(id)) continue;
    let open = false;
    for (let y = tract.ty; y < Math.min(s.size, tract.ty + T) && !open; y++) {
      for (let x = tract.tx; x < Math.min(s.size, tract.tx + T); x++) {
        if (tileOpen(ctx, t, stage, idx(s, x, y))) {
          open = true;
          break;
        }
      }
    }
    if (open) out.push(tract);
    else full?.add(id);
  }
  return out;
}

interface Tract {
  tx: number;
  ty: number;
  score: number;
}

/**
 * Works out, a type at a time, the tract scores the next `developOnce` looks
 * at (the first attempt after a refresh would otherwise do them all at once).
 */
export function* warmTractsSteps(ctx: DevContext): Generator<void, void> {
  for (const t of DEV_TYPES) {
    if (ctx.demand.demand[t] <= 0 || ctx.tractCache?.has(t)) continue;
    tractScores(ctx, t);
    yield;
  }
}

/** Tracts with a matching zone and mean desirability above the threshold, best first (cached). */
function tractScores(ctx: DevContext, t: DevType): Tract[] {
  const cached = ctx.tractCache?.get(t);
  if (cached) return cached;
  const { s, cfg, desir } = ctx;
  const T = cfg.development.tractSize;
  const want = zoneCode2Class(t);
  const out: Tract[] = [];
  for (let ty = 0; ty < s.size; ty += T) {
    for (let tx = 0; tx < s.size; tx += T) {
      let sum = 0;
      let n = 0;
      for (let y = ty; y < Math.min(s.size, ty + T); y++) {
        for (let x = tx; x < Math.min(s.size, tx + T); x++) {
          const i = idx(s, x, y);
          if (!want[s.zone[i]!]) continue;
          sum += desir[t][i]!;
          n++;
        }
      }
      if (!n) continue;
      const score = sum / n;
      if (score >= cfg.desirability.developThreshold) out.push({ tx, ty, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  ctx.tractCache?.set(t, out);
  return out;
}

/** Lookup table: which zone codes a type may grow in. */
function zoneCode2Class(t: DevType): boolean[] {
  const want = zoneClassFor(t);
  const out: boolean[] = [];
  for (let c = 0; c < 10; c++) out.push(zoneInfo(c).cls === want);
  return out;
}

/** One development attempt: the developer's steps, in order. */
export function developOnce(ctx: DevContext): Building | 'reoccupied' | null {
  const { s, cfg, census, demand, rng } = ctx;
  // A type with no zone desirable enough to build on (farms in a city with
  // no farm zone) takes no attempts, unless it may move into an empty building
  // of its own (any abandoned house drew farms and factories that could use none).
  const weights = DEV_TYPES.map((t) => (demand.demand[t] > 0 && ((census.abandonedFor?.[t] ?? census.abandoned) || tractScores(ctx, t).length) ? demand.demand[t] : 0));
  const pick = rng.weighted(weights);
  if (pick < 0) return null;
  const t = DEV_TYPES[pick]!;

  const mult = cfg.difficulty[s.difficulty].stageLimitMult;
  // Stage limits count the whole region's population of the type.
  const targets = stageTargets(cfg.development.stageTable[t], census.population[t] + (s.region?.byType?.[t] ?? 0), mult);
  const { preferred } = chooseStage(targets, census.stageCounts[t]);
  if (reoccupyAnywhere(ctx, t)) return 'reoccupied';
  // Try the best few tracts, with a little shuffling among near-equals.
  const tries = rankTracts(ctx, t, preferred, cfg.development.tractsPerAttempt);
  for (let k = tries.length - 1; k > 0; k--) {
    const j = rng.int(k + 1);
    if (Math.abs(tries[k]!.score - tries[j]!.score) < 5) [tries[k], tries[j]] = [tries[j]!, tries[k]!];
  }
  for (const { tx, ty } of tries) {
    if (moveUp(ctx, t, tx, ty)) return 'reoccupied';
    for (let stage = preferred; stage >= 1; stage--) {
      let p: Placement | null = null;
      for (const [w, h] of lotShapes(cfg, t, stage)) {
        p = tryPlace(ctx, t, stage, w, h, tx, ty);
        if (!p) continue;
        // A house and yard runs back from its road: a 1×2 lying along a north–south road left the
        // zone's back column empty (its 2×1 was tried only when no 1×2 fitted at all). Of the two,
        // the one fronting its road on a short side.
        if (w !== h && w + h === 3 && !shortSideRoad(s, p) && longSideRoad(s, p)) {
          const turned = tryPlace(ctx, t, stage, h, w, tx, ty);
          if (turned && shortSideRoad(s, turned)) p = turned;
        }
        break;
      }
      if (!p) {
        // No stage fits anywhere in this tract: count it full for this type
        // until the next refresh. (A tract with one replaceable tile counts as
        // open but may never hold a whole lot; left in, the same best tracts
        // took every attempt and growth stalled with demand high.)
        if (stage === 1) ctx.tractFull?.get(`${t}|${preferred}`)?.add(ty * s.size + tx);
        continue;
      }
      for (const b of p.displaced) ctx.removeBuilding(b);
      // Building on a wooded lot clears it.
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) s.trees[y * s.size + x] = 0;
      const b: Building = {
        id: ctx.nextId(), x: p.x, y: p.y, w: p.w, h: p.h, stage,
        origType: t, type: t,
        capacity: capacityOf(cfg, t, stage, t, p),
        occupancy: 0, filled: 0, distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true,
        noWaterMonths: 0, watered: hasWater(ctx, p),
        age: 0, eq: 0, hq: 0, abandonReason: null, builtDay: s.day, commute: -1, noJobMonths: 0, historical: false,
      };
      newHousehold(ctx, b, t);
      b.occupancy = Math.min(1, desirabilityOver(s, ctx.desir, t, b) / cfg.desirability.fullOccupancy);
      s.buildings.set(b.id, b);
      for (const i of footprint(s, b)) s.occupant[i] = b.id;
      return b;
    }
  }
  return null;
}

/** Why an empty zoned tile is still empty: what the developer checks, in order. */
export type GrowthBlocker =
  | { code: 'unbuildable' } // water, a road, an elevated line or a volcano cone
  | { code: 'rubble' } // disaster rubble: bulldoze it
  | { code: 'tooSteep' }
  | { code: 'noPower' }
  | { code: 'noRoad' } // R/C must front a road; I/A must be within reach of one
  | { code: 'noJobs' } // the road reaches no C or I zone
  | { code: 'noDemand' }
  | { code: 'noWater' } // an abandoned building above its well-water cap
  | { code: 'lowDesirability'; type: DevType; value: number; need: number }
  | { code: 'waterCap'; value: number } // not a blocker: no city water caps the stage
  | { code: 'interior'; value: number } // not a blocker: tiles from the road, filled only by a lot that deep
  | { code: 'capped'; type: DevType; value: number } // no demand because a type that wants in is held at its cap
  | { code: 'noWorkers' } // businesses short of staff where no home can grow for the workers they lack
  | { code: 'waiting' }; // nothing in the way: a developer will come when demand picks it

/** Notes that don't keep a tile empty by themselves. */
export const INFO_ONLY = new Set<GrowthBlocker['code']>(['waterCap', 'interior']);

/** Codes of `growthMap` (index + 1): the main blocker of each empty zone tile. */
export const GROWTH_CODES = ['unbuildable', 'tooSteep', 'noPower', 'noRoad', 'noJobs', 'noDemand', 'lowDesirability', 'waiting', 'noWater', 'capped', 'rubble', 'noWorkers'] as const;

/**
 * The blockers for an empty zoned tile, or null when the tile isn't an empty
 * zone (a building, a facility or unzoned land). Mirrors `tileOpen`,
 * `zoneFits`, `hasAccess` and the tract ranking.
 */
export function growthBlockers(
  ctx: DevContext, i: number,
  /** Tract results shared across calls (one pass over the map). */
  memo?: Map<string, { type: DevType; value: number } | null>,
): GrowthBlocker[] | null {
  const { s, f, cfg, demand, desir } = ctx;
  if (s.occupant[i]! > 0) {
    const b = s.buildings.get(s.occupant[i]!);
    return b && !b.type ? reoccupyBlockers(ctx, b) : null;
  }
  const z = zoneInfo(s.zone[i]!);
  if (!z.cls || s.occupant[i] !== 0) return null;
  if (s.rubble[i]) return [{ code: 'rubble' }];
  if (s.terrain[i] === Terrain.Water || s.net[i] !== Net.None || s.elevated[i] || s.landform[i] === 2) return [{ code: 'unbuildable' }];
  if (slopeCap(ctx, i) === 0) return [{ code: 'tooSteep' }];
  const out: GrowthBlocker[] = [];
  if (needsPower(s, cfg) && !f.powered[i]) out.push({ code: 'noPower' });
  const industrial = z.cls === 'I' || z.cls === 'A';
  // R/C lots must front a road, but a deep lot covers tiles up to three back.
  if (industrial ? !f.industrialAccess[i] : f.access[i]! < 0) out.push({ code: 'noRoad' });
  else if (z.cls === 'R' && !f.componentHasJobs[f.component[f.access[i]!]!]) out.push({ code: 'noJobs' });
  const types = DEV_TYPES.filter((t) => zoneClassFor(t) === z.cls);
  // Sims who would come but for the cap (the farm cap counts other jobs, so it isn't one to lift here).
  const atCap = (t: DevType) => t !== 'IA' && demand.raw[t] > 0 && Number.isFinite(demand.cap[t]) && demand.capPopulation[t] >= 0.95 * demand.cap[t];
  // (Nor less than one, which the demand figures show as 0; and a trickle left at the cap is the cap's, not room: empty
  // homes read "곧 개발됩니다" on R$$$'s 0.46 and R$'s 1.4 at its cap — 21,532 of the 21,560 allowed — while a year
  // filled 19 of 909 tiles, and the lots flipped between that and the cap month to month.)
  const wanted = types.filter((t) => demand.demand[t] >= 1 && !(atCap(t) && demand.demand[t] < 10));
  // (Or every wanted wealth's jobs are beyond the trip limit: see hasAccess.)
  if (z.cls === 'R' && f.access[i]! >= 0 && f.componentHasJobs[f.component[f.access[i]!]!] && f.travel?.fastest.hasSources && wanted.length
    && wanted.every((t) => !(f.commuteByWealth[cfg.demand.wealthOf[t]]![f.access[i]!]! <= cfg.transport.tripLimit))) out.push({ code: 'noJobs' });
  const capped = types.find(atCap);
  if (!wanted.length) out.push(capped ? { code: 'capped', type: capped, value: demand.cap[capped] } : { code: 'noDemand' });
  // (The developer holds back businesses that couldn't find staff: see workersBlocked.)
  else if (wanted.every((t) => workersBlocked(ctx, t))) out.push({ code: 'noWorkers' });
  else {
    // The tract's mean desirability over its matching zone tiles must reach the threshold.
    const T = cfg.development.tractSize;
    const x = i % s.size;
    const y = Math.floor(i / s.size);
    const tx = x - (x % T);
    const ty = y - (y % T);
    const key = `${tx},${ty},${z.cls}`;
    let best: { type: DevType; value: number } | null = memo?.get(key) ?? null;
    if (!memo?.has(key)) for (const t of wanted) {
      let sum = 0;
      let n = 0;
      for (let yy = ty; yy < Math.min(s.size, ty + T); yy++) {
        for (let xx = tx; xx < Math.min(s.size, tx + T); xx++) {
          const j = idx(s, xx, yy);
          if (zoneInfo(s.zone[j]!).cls !== z.cls) continue;
          sum += desir[t][j]!;
          n++;
        }
      }
      const v = n ? sum / n : 0;
      if (!best || v > best.value) best = { type: t, value: v };
    }
    memo?.set(key, best);
    const need = cfg.desirability.developThreshold;
    if (best && best.value < need) out.push({ code: 'lowDesirability', type: best.type, value: best.value, need });
  }
  if (!industrial && f.access[i]! >= 0 && f.accessDist[i]! > 1) out.push({ code: 'interior', value: f.accessDist[i]! });
  if (needsWater(s, cfg) && !f.watered[i]) {
    // Dry land caps how big the types that want in may grow (none at all for the top wealth's):
    // with every one of them at 0, nothing comes until pipes reach it (tileOpen).
    const caps = (wanted.length ? wanted : types).map((t) => cfg.services.waterStageCap[t]);
    if (wanted.length && caps.every((c) => c === 0)) out.push({ code: 'noWater' });
    else out.push({ code: 'waterCap', value: Math.max(...caps) });
  }
  if (!out.some((b) => !INFO_ONLY.has(b.code))) out.push({ code: 'waiting' });
  return out;
}

/** What keeps anyone from moving back into an abandoned building (mirrors `reoccupyScore`). */
function reoccupyBlockers(ctx: DevContext, b: Building): GrowthBlocker[] {
  const { s, cfg, demand, desir } = ctx;
  const out: GrowthBlocker[] = [];
  const types = occupantsFor(cfg, b.origType).filter((t) => !b.historical || t === b.origType);
  if (!hasPower(ctx, b)) out.push({ code: 'noPower' });
  if (!types.some((t) => hasAccess(ctx, t, b))) out.push({ code: 'noRoad' });
  if (!types.some((t) => waterAllows(ctx, t, b.stage, b))) out.push({ code: 'noWater' });
  const wanted = types.filter((t) => demand.demand[t] > 0);
  if (!wanted.length) out.push({ code: 'noDemand' });
  else if (wanted.every((t) => workersBlocked(ctx, t))) out.push({ code: 'noWorkers' });
  else {
    let best: { type: DevType; value: number } | null = null;
    for (const t of wanted) {
      const v = desirabilityOver(s, desir, t, b);
      if (!best || v > best.value) best = { type: t, value: v };
    }
    const need = cfg.desirability.developThreshold;
    if (best!.value < need) out.push({ code: 'lowDesirability', type: best!.type, value: best!.value, need });
  }
  if (!out.length) out.push({ code: 'waiting' });
  return out;
}

/** Power reaches a lot when any of its tiles is on a supplied grid. */
export function hasPower(ctx: DevContext, lot: Rect): boolean {
  if (!needsPower(ctx.s, ctx.cfg)) return true;
  return footprint(ctx.s, lot).some((i) => ctx.f.powered[i] === 1);
}

/** Without city water a type only builds up to its well-water stage cap. */
export function waterAllows(ctx: DevContext, t: DevType, stage: number, lot: Rect): boolean {
  if (!needsWater(ctx.s, ctx.cfg) || stage <= ctx.cfg.services.waterStageCap[t]) return true;
  return hasWater(ctx, lot);
}

export function hasWater(ctx: DevContext, lot: Rect): boolean {
  return footprint(ctx.s, lot).some((i) => ctx.f.watered[i] === 1);
}

/** New occupants start at their wealth's base EQ/HQ with a spread of ages. */
function newHousehold(ctx: DevContext, b: Building, t: DevType): void {
  const sv = ctx.cfg.services;
  const base = sv.baseQuotient[ctx.cfg.demand.wealthOf[t]];
  b.age = sv.startAge + ctx.rng.next() * sv.startAgeSpread;
  b.eq = base;
  b.hq = base;
}

function abandon(b: Building, reason: Building['abandonReason']): void {
  b.type = null;
  b.occupancy = 0;
  b.filled = 0;
  b.abandonReason = reason;
  b.distressMonths = 0;
}

/**
 * Monthly building upkeep: occupancy follows desirability; long distress
 * downgrades to a lower wealth occupant or abandons; lost road access abandons.
 */
export function updateBuildings(ctx: DevContext): void {
  drain(updateBuildingsSteps(ctx));
}

/** `updateBuildings` in steps (see ./steps). */
export function* updateBuildingsSteps(ctx: DevContext): Generator<void, void> {
  const { s, cfg, f, desir } = ctx;
  const dv = cfg.desirability;
  yield;
  let piece1 = 0;
  for (const b of s.buildings.values()) {
    if ((++piece1 & 0x1ff) === 0) yield;
    if (!b.type) continue;
    if (!hasAccess(ctx, b.type, b)) {
      if (++b.noRoadMonths >= cfg.development.noRoadMonths) abandon(b, 'no-road');
      continue;
    }
    b.noRoadMonths = 0;

    // No power for six months (off-grid or in rolling blackouts) → abandoned.
    if (needsPower(s, cfg) && !b.powered) {
      if (++b.noPowerMonths >= cfg.services.noPowerMonths) abandon(b, 'no-power');
      if (!b.type) continue;
    } else b.noPowerMonths = 0;

    // Above its well-water cap a building needs city water; six dry months → abandoned.
    if (needsWater(s, cfg) && b.stage > cfg.services.waterStageCap[b.type] && !b.watered) {
      if (++b.noWaterMonths >= cfg.services.noWaterMonths) abandon(b, 'no-water');
      if (!b.type) continue;
    } else b.noWaterMonths = 0;

    // Residents who can't reach an open job within the trip limit leave after
    // six months (the no-job zot): no workplace in reach, or most of the
    // home's commuters found every job in reach taken. Only once there are jobs.
    if (b.type[0] === 'R' && f.travel?.fastest.hasSources) {
      if (b.commute < 0 || b.commute > cfg.transport.tripLimit || (f.jobless.get(b.id) ?? 0) > cfg.transport.joblessShare) {
        if (++b.noJobMonths >= cfg.transport.noJobMonths) abandon(b, 'commute');
        if (!b.type) continue;
      } else b.noJobMonths = 0;
    }

    // Staffing is measured against the jobs the month's hiring was for (before occupancy changes).
    const starved = understaffed(ctx, b);
    const d = desirabilityOver(s, desir, b.type, b);
    b.occupancy = Math.min(1, d / dv.fullOccupancy);
    if (d >= dv.distress && !starved) {
      b.distressMonths = 0;
      continue;
    }
    if (++b.distressMonths < cfg.development.distressMonths) continue;
    // Reoccupy with the highest lower type that wants in and would develop
    // there (desirable to a lower type, and demand for it; the same
    // bar as building or moving into an empty one).
    const lower = b.historical ? undefined : (cfg.development.downgrade[b.type] ?? []).find(
      // (Moving in, like any other: a job of their wealth in reach, workers for a business.)
      (t) => ctx.demand.demand[t] > 0 && desirabilityOver(s, desir, t, b) >= cfg.desirability.developThreshold
        && hasAccess(ctx, t, b, true) && !workersBlocked(ctx, t),
    );
    if (lower) {
      b.type = lower;
      delete b.jobs; // (the jobs the wealthier households held aren't theirs)
      b.capacity = capacityOf(cfg, lower, b.stage, b.origType, b);
      b.occupancy = Math.min(1, desirabilityOver(s, desir, lower, b) / dv.fullOccupancy);
      b.distressMonths = 0;
      // New households, not the wealthier ones' education, health, age and months without work.
      if (lower[0] === 'R') {
        const sv = cfg.services;
        b.eq = b.hq = sv.baseQuotient[cfg.demand.wealthOf[lower]];
        b.age = sv.startAge + sv.startAgeSpread / 2;
        b.noJobMonths = 0;
      }
    } else abandon(b, starved ? 'workforce' : 'desirability');
  }
}

const HOMES_OF = ['R$', 'R$$', 'R$$$'] as const;

/**
 * A business that can never fill its jobs distresses and is
 * abandoned whatever the demand for it, e.g. an IHT plant in a town with too
 * few R$$. Only once the Sims it mostly hires can't come: their homes are at
 * the cap or not wanted. (Jobs left open while homes are still filling in, as
 * in any young town, are no cause.)
 */
export function understaffed(ctx: DevContext, b: Building): boolean {
  const { cfg } = ctx;
  if (!b.type || b.type[0] === 'R') return false;
  const jobs = b.capacity * b.occupancy;
  if (jobs <= 0 || b.filled >= jobs * cfg.development.understaffed) return false;
  return homesBlocked(ctx, mainWealth(cfg, b.type));
}

/** The wealth a business type mostly hires. */
function mainWealth(cfg: DevContext['cfg'], t: DevType): 0 | 1 | 2 {
  const profile = cfg.demand.workforceProfile[t as Exclude<DevType, 'R$' | 'R$$' | 'R$$$'>];
  let main: 0 | 1 | 2 = 0;
  for (const w of [1, 2] as const) if (profile[w]! > profile[main]!) main = w;
  return main;
}

/** Homes of this wealth can't take more Sims (at their cap, or not wanted). */
function homesBlocked(ctx: DevContext, w: 0 | 1 | 2): boolean {
  const { demand } = ctx;
  const home = HOMES_OF[w]!;
  const capped = Number.isFinite(demand.cap[home]) && demand.capPopulation[home] >= 0.95 * demand.cap[home];
  return capped || demand.demand[home] <= 0;
}

/**
 * A business type that couldn't be staffed now: the city fills under the
 * understaffed share of its main wealth's jobs and those Sims can't move in.
 * (Reoccupying an abandoned lot with it would only see it abandoned again.)
 */
function workersBlocked(ctx: DevContext, t: DevType): boolean {
  if (t[0] === 'R') return false;
  const w = mainWealth(ctx.cfg, t);
  const c = ctx.census;
  const fill = c.jobsByWealth[w] > 0 ? c.workers[w] / c.jobsByWealth[w] : 1;
  return fill < ctx.cfg.development.understaffed && homesBlocked(ctx, w);
}

/** Share of the new month's demand taken into the trend. */
const TREND_WEIGHT = 0.3;

/** Folds this month's demand into the smoothed trend (once a month). */
export function trackDemand(s: CityState, demand: DemandReport): void {
  for (const t of DEV_TYPES) {
    const d = demand.demand[t];
    const old = s.demandTrend[t];
    s.demandTrend[t] = old === undefined ? d : Math.round(old + TREND_WEIGHT * (d - old));
  }
}

/**
 * Sustained negative demand: excess occupants leave, abandoning their least
 * desirable buildings until roughly the surplus is gone.
 */
export function exodus(ctx: DevContext): number {
  const { s, cfg, demand, desir } = ctx;
  let left = 0;
  for (const t of DEV_TYPES) {
    const d = demand.demand[t];
    // Only demand that stays low empties buildings: one bad month after a
    // building boom would otherwise send Sims away just to call them back.
    const trend = s.demandTrend[t] ?? d;
    if (d > cfg.demand.exodusDemand || trend > cfg.demand.exodusDemand) continue;
    // The surplus behind the (negative) demand: too many Sims or jobs, or as
    // many as taxes have made unwanted (high taxes can drive out those
    // already living or working here; demand turned back into Sims or jobs).
    const half = demand.halfSaturation ?? 0;
    // (The demand curve's inverse runs to infinity as demand nears −1000, where taxes clamp it: a
    // moderate surplus at a 20% tax emptied a whole type in a month. At most half of those there at
    // full −1000, in proportion below it, before the monthly rate.)
    const unwanted = Math.min((half * -d) / Math.max(1, 1000 + d), ctx.census.population[t] * (-d / 1000) * 0.5);
    let surplus = Math.max(-demand.raw[t], unwanted) * cfg.demand.exodusRate;
    if (surplus <= 0) continue;
    // (Each building's desirability worked out once, not at every comparison of the sort.)
    const mine = [...s.buildings.values()]
      .filter((b) => b.type === t)
      .map((b) => [b, desirabilityOver(s, desir, t, b)] as const)
      .sort((a, b) => a[1] - b[1])
      .map(([b]) => b);
    for (const b of mine) {
      if (surplus <= 0) break;
      // A building far bigger than the surplus stays: emptying a tower for a
      // few dozen excess Sims would swing demand the other way.
      const people = b.capacity * b.occupancy;
      if (people > 2 * surplus + cfg.demand.exodusSlack) continue;
      surplus -= people;
      abandon(b, 'demand');
      left++;
    }
  }
  return left;
}

