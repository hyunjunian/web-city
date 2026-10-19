// Emergency dispatch (with Rush Hour's air units). Stations
// own a fixed number of units; the quickest station with one free sends it.
// Ground units drive the road network from their station; fire trucks only
// reach fires within eight tiles of a road they can drive to. On site, a unit adds its own protection disk
// for a few days, then returns.

import type { SimConfig } from '../config';
import { interp } from '../data/services';
import type { Rng } from '../rng';
import { frontage, INF, type Fields } from './fields';
import { isAsphalt, tilesLinked, type CityState, type DispatchUnit, type Rect, type Structure } from './state';
import { drain } from './steps';

export type DispatchKind = 'fire' | 'police';

const centre = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

/** Effectiveness of a station's ground crews: fumbling below a funding threshold, 20% on strike. */
export function crewCompetence(cfg: SimConfig, kind: DispatchKind, st: Structure): number {
  const d = cfg.safety.dispatch[kind];
  const k = st.funding >= d.competentFunding ? interp(cfg.safety.funding, st.funding) : d.fumble * (st.funding / d.competentFunding);
  return k * (st.strike > 0 ? cfg.services.strikeEffectiveness : 1);
}

/**
 * Tiles to (x, y) for a ground unit standing on each road tile: along the
 * road network to a road within `reach` of the target, then straight there.
 * Unreachable tiles stay INF.
 */
function roadDistances(s: CityState, x: number, y: number, reach: number): Int32Array {
  const n = s.size;
  const dist = new Int32Array(n * n).fill(INF);
  // Bucket queue: seeds start at their straight-line distance (≤ reach); each road step adds 1.
  const buckets: number[][] = Array.from({ length: reach + 1 }, () => []);
  for (let yy = Math.max(0, y - reach); yy <= Math.min(n - 1, y + reach); yy++) {
    for (let xx = Math.max(0, x - reach); xx <= Math.min(n - 1, x + reach); xx++) {
      const i = yy * n + xx;
      if (!isAsphalt(s.net[i]!)) continue;
      const d = Math.max(Math.abs(xx - x), Math.abs(yy - y));
      dist[i] = d;
      buckets[d]!.push(i);
    }
  }
  for (let d = 0; d < buckets.length; d++) {
    const list = buckets[d]!;
    for (let h = 0; h < list.length; h++) {
      const i = list[h]!;
      if (dist[i]! !== d) continue;
      const ix = i % n;
      for (const j of [i - 1, i + 1, i - n, i + n]) {
        if (j < 0 || j >= n * n || Math.abs((j % n) - ix) > 1) continue;
        if (dist[j]! <= d + 1 || !tilesLinked(s, i, j)) continue;
        dist[j] = d + 1;
        (buckets[d + 1] ??= []).push(j);
      }
    }
  }
  return dist;
}

/** Walks down the road distances from a station's road tile to the target (then the last stretch off-road). */
function roadPath(s: CityState, road: Int32Array, from: number, x: number, y: number, reach: number): number[] {
  const n = s.size;
  const path = [from];
  let cur = from;
  for (let guard = 0; guard < n * n; guard++) {
    const d = road[cur]!;
    const cx = cur % n;
    // A seed: the road tile the crew leaves the vehicle at (within reach: a road heading straight for
    // the target further out has the same count, but the crew drives on).
    const cheb = Math.max(Math.abs(cx - x), Math.abs(Math.floor(cur / n) - y));
    if (cheb <= reach && d === cheb) break;
    let next = -1;
    for (const j of [cur - 1, cur + 1, cur - n, cur + n]) {
      if (j < 0 || j >= n * n || Math.abs((j % n) - cx) > 1) continue;
      if (road[j] === d - 1 && tilesLinked(s, cur, j)) {
        next = j;
        break;
      }
    }
    if (next < 0) break;
    path.push(next);
    cur = next;
  }
  path.push(y * n + x);
  return path;
}

/** Units a station owns and has out (ground, air). */
function fleet(s: CityState, cfg: SimConfig, kind: DispatchKind, st: Structure): { ground: number; air: number } {
  const def = cfg.structures[st.kind][kind];
  if (!def) return { ground: 0, air: 0 };
  let ground = def.units ?? 0;
  let air = def.air ?? 0;
  for (const u of s.units) {
    if (u.station !== st.id) continue;
    if (u.air) air--;
    else ground--;
  }
  return { ground, air };
}

/**
 * Sends the closest free unit to (x, y). Returns the unit, or why none can go.
 */
/**
 * Units of a kind free to send now, across every station (ground and air); with `minCompetence`, only crews at
 * least that competent (air units always are).
 */
export function freeUnits(s: CityState, cfg: SimConfig, kind: DispatchKind, minCompetence = 0): number {
  let n = 0;
  for (const st of s.structures.values()) {
    const f = fleet(s, cfg, kind, st);
    if (f.ground > 0 && (minCompetence <= 0 || crewCompetence(cfg, kind, st) >= minCompetence)) n += f.ground;
    n += Math.max(0, f.air);
  }
  return n;
}

export function dispatchUnit(
  s: CityState, cfg: SimConfig, kind: DispatchKind, x: number, y: number, groundOnly = false, minCompetence = 0,
): DispatchUnit | string {
  const d = cfg.safety.dispatch;
  // (No unit free: no map-wide road search for nothing, every day for every fire.)
  if (freeUnits(s, cfg, kind, minCompetence) <= 0) return 'no free units';
  let road: Int32Array | undefined;
  let best: { st: Structure; air: boolean; days: number; from: number } | null = null;
  let anyGround = false;
  let tooFar = false;
  for (const st of s.structures.values()) {
    const free = { ...fleet(s, cfg, kind, st) };
    // (Crews too underfunded or on strike to help are not sent when help is wanted.)
    if (minCompetence > 0 && free.ground > 0 && crewCompetence(cfg, kind, st) < minCompetence) free.ground = 0;
    if (free.ground + free.air <= 0) continue;
    const [cx, cy] = centre(st);
    // Ground units drive out of the station's frontage along the roads.
    let tiles = INF;
    let from = -1;
    if (free.ground > 0) {
      road ??= roadDistances(s, x, y, d[kind].roadReach);
      for (const t of frontage(s, st)) {
        if (road[t]! < tiles) {
          tiles = road[t]!;
          from = t;
        }
      }
    }
    if (free.ground > 0) anyGround = true;
    // Fire trucks arrive too late at a fire more than half a medium map's width away.
    if (kind === 'fire' && tiles < INF && tiles > cfg.safety.dispatchRange) {
      tiles = INF;
      tooFar = true;
    }
    const ground = tiles < INF ? tiles / d.tilesPerDay : INF;
    const air = free.air > 0 && !groundOnly ? d.airLaunchDays + Math.max(Math.abs(cx - x), Math.abs(cy - y)) / (d.tilesPerDay * 1.5) : INF;
    const days = Math.min(ground, air);
    if (days === INF) continue;
    if (!best || days < best.days) best = { st, air: air < ground, days, from };
  }
  if (!best) return anyGround ? (kind === 'fire' ? (tooFar ? 'too far from any fire station' : 'too far from a road for fire trucks') : 'no road to get there') : 'no free units';
  const n = s.size;
  const [sx, sy] = centre(best.st);
  const path = best.air ? [Math.floor(sy) * n + Math.floor(sx), y * n + x] : roadPath(s, road!, best.from, x, y, d[kind].roadReach);
  const unit: DispatchUnit = {
    id: s.nextId++, kind, air: best.air, station: best.st.id, x, y,
    travel: Math.floor(best.days), onSite: d.onSiteDays,
    competence: best.air ? 1 : crewCompetence(cfg, kind, best.st),
    path, days: Math.floor(best.days),
  };
  s.units.push(unit);
  return unit;
}

/** Protection that units on site add at (x, y): each a disk from centre to edge strength. */
export function unitProtection(s: CityState, cfg: SimConfig, kind: DispatchKind, x: number, y: number): number {
  const d = cfg.safety.dispatch[kind];
  let p = 0;
  for (const u of s.units) {
    if (u.kind !== kind || u.travel > 0) continue;
    const dist = Math.hypot(u.x - x, u.y - y);
    if (dist > d.radius) continue;
    p += (d.center - (d.center - d.edge) * (dist / d.radius)) * u.competence;
  }
  return p;
}

/** Daily: units drive, work on site, then go home. */
export function stepUnits(s: CityState): void {
  s.units = s.units.filter((u) => {
    if (u.travel > 0) u.travel--;
    else u.onSite--;
    return u.onSite >= 0;
  });
}

/** Least competence of a crew sent automatically to a fire or spill (an unfunded one does nothing there). */
export const FIT_CREW = 0.5;

/** Fire crews' summed competence covering (x, y): covered from a fit crew's worth (FIT_CREW). */
function fireCover(s: CityState, cfg: SimConfig, x: number, y: number, groundOnly: boolean): number {
  let c = 0;
  for (const u of s.units) {
    if (u.kind === 'fire' && !(groundOnly && u.air) && Math.hypot(u.x - x, u.y - y) <= cfg.safety.dispatch.fire.radius) c += u.competence;
  }
  return c;
}

/** Idle units head for fires burning past their first day, and for riots, that no unit is covering. */
export function autoDispatch(s: CityState, cfg: SimConfig): void {
  drain(autoDispatchSteps(s, cfg));
}

/** {@link autoDispatch} in steps: a pause after each unit sent (each looks for a route across the map). */
export function* autoDispatchSteps(s: CityState, cfg: SimConfig): Generator<void, void> {
  // Enough cars to outdo the mob (a grown one takes several, see stepMobs).
  const rm = cfg.mayor.riotMob;
  for (const mob of s.mobs) {
    // (Its daily growth, plus its strength worn down within the cars' days on site.)
    const want = Math.max(rm.minUnits, Math.ceil((rm.grow * (mob.stage + 1) + mob.energy / cfg.safety.dispatch.onSiteDays) / rm.policeHit));
    // (Only cars that can face a mob count, as stepMobs judges: underfunded or striking crews don't.)
    let have = s.units.filter((u) => u.kind === 'police' && (u.air || u.competence >= rm.competent)
      && Math.hypot(u.x - mob.x, u.y - mob.y) <= cfg.safety.dispatch.police.radius).length;
    while (have < want && typeof dispatchUnit(s, cfg, 'police', mob.x, mob.y, false, rm.competent) !== 'string') have++;
    yield;
  }
  for (const a of s.arsonists) {
    if (s.units.some((u) => u.kind === 'police' && Math.hypot(u.x - a.x, u.y - a.y) <= cfg.safety.dispatch.police.radius)) continue;
    dispatchUnit(s, cfg, 'police', a.x, a.y);
    yield;
  }
  for (const fire of s.fires) {
    if (fire.days < 1) continue;
    const r = fire.target > 0 ? s.buildings.get(fire.target) : s.structures.get(-fire.target);
    if (!r) continue;
    const [cx, cy] = centre(r);
    if (fireCover(s, cfg, cx, cy, false) >= FIT_CREW) continue;
    dispatchUnit(s, cfg, 'fire', Math.floor(cx), Math.floor(cy), false, FIT_CREW);
    yield;
  }
  // Toxic spills: fire engines have to be sent.
  const n = s.size;
  for (const spill of s.spills) {
    const x = spill.i % n;
    const y = (spill.i - x) / n;
    // (Engines only: the Fire Plane can't foam a spill.)
    if (fireCover(s, cfg, x, y, true) >= FIT_CREW) continue;
    dispatchUnit(s, cfg, 'fire', x, y, true, FIT_CREW);
    yield;
  }
}

/**
 * Daily: fire crews on site neutralise the toxic spills within their reach,
 * each day with the chance of their competence (funding sets it); not the
 * Fire Plane. Returns how many were cleaned up.
 */
export function neutraliseSpills(s: CityState, cfg: SimConfig, rng: Rng): number {
  const n = s.size;
  const before = s.spills.length;
  s.spills = s.spills.filter((spill) => {
    const x = spill.i % n;
    const y = (spill.i - x) / n;
    for (const u of s.units) {
      // Engines bring the foam; the Fire Plane only drops water.
      if (u.kind !== 'fire' || u.air || u.travel > 0 || Math.hypot(u.x - x, u.y - y) > cfg.safety.dispatch.fire.radius) continue;
      if (rng.next() < u.competence) return false;
    }
    return true;
  });
  return before - s.spills.length;
}

/** Adds on-site units to the protection fields (police help against crime and riots too). */
export function addUnitCover(s: CityState, f: Fields, cfg: SimConfig): void {
  const n = s.size;
  for (const u of s.units) {
    if (u.travel > 0) continue;
    const d = cfg.safety.dispatch[u.kind];
    const out = u.kind === 'fire' ? f.fireCover : f.policeCover;
    for (let y = Math.max(0, Math.floor(u.y - d.radius)); y <= Math.min(n - 1, Math.ceil(u.y + d.radius)); y++) {
      for (let x = Math.max(0, Math.floor(u.x - d.radius)); x <= Math.min(n - 1, Math.ceil(u.x + d.radius)); x++) {
        const dist = Math.hypot(x - u.x, y - u.y);
        if (dist <= d.radius) out[y * n + x]! += (d.center - (d.center - d.edge) * (dist / d.radius)) * u.competence;
      }
    }
  }
}
