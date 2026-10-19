// Disasters, Rush Hour's included. God Mode disasters are
// resolved at once here (paths of tornadoes and robots are walked step by
// step with the city's RNG); the fires they start burn on in the normal
// daily fire simulation. Simulation-initiated ones run monthly.

import type { SimConfig } from '../config';
import { interp } from '../data/services';
import type { Rng } from '../rng';
import type { Fields } from './fields';
import { ELEVATED, ELEVATED_KINDS, isAsphalt, tilesLinked, isRail, NETWORK_KINDS, Terrain, type CityState, type CityEvent } from './state';

export type DisasterKind = 'fire' | 'lightning' | 'meteor' | 'tornado' | 'earthquake' | 'volcano' | 'robot' | 'autosaurus' | 'ufo';
export const DISASTER_KINDS: readonly DisasterKind[] = [
  'fire', 'lightning', 'meteor', 'tornado', 'earthquake', 'volcano', 'robot', 'autosaurus', 'ufo',
];

export const Landform = { None: 0, Crater: 1, Cone: 2, Slope: 3, Fault: 4 } as const;

/** What a disaster destroyed and what rebuilding would cost (the damage report). */
export interface DamageReport {
  kind: DisasterKind | 'explosion' | 'meltdown' | 'sinkhole' | 'spill';
  day: number;
  x: number;
  y: number;
  buildings: number;
  structures: number;
  networkTiles: number;
  undergroundTiles: number;
  fires: number;
  rebuildCost: number;
}

export interface DisasterContext {
  s: CityState;
  f: Fields;
  cfg: SimConfig;
  rng: Rng;
  report: DamageReport;
  /** Destroys whatever stands on tile i (the whole lot) and, with `networks`, the network on it; leaves rubble. */
  /** `surface`: a monster's tread, which leaves what runs underground (a road's tunnel) alone. */
  destroyTile: (i: number, networks: boolean, surface?: boolean) => void;
  /** Breaks pipes and subway under tile i. */
  breakUnderground: (i: number) => void;
  /** Sets fire to whatever stands on tile i, at a starting stage. */
  igniteTile: (i: number, stage: number) => void;
}

/** Removes power lines and elevated networks, accounting for each layer without disturbing the road below. */
export function breakOverhead(s: CityState, cfg: SimConfig, report: DamageReport, i: number): void {
  if (s.power[i]) {
    s.power[i] = 0;
    s.lineWear[i] = 0;
    report.networkTiles++;
    report.rebuildCost += cfg.services.powerLineCost.build;
  }
  const elevated = s.elevated[i]!;
  if (elevated) {
    report.networkTiles++;
    const unit = cfg.economy.networkCost[elevated === ELEVATED.highway ? 'elevatedHighway' : ELEVATED_KINDS[elevated]!].build;
    report.rebuildCost += unit * (s.terrain[i] === Terrain.Water ? cfg.economy.bridgeCostMult : 1);
    s.elevated[i] = 0;
    if (s.tolls[i] === 2) s.tolls[i] = 0;
    if (!isAsphalt(s.net[i]!)) s.potholes[i] = 0;
  }
}

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;

const lerp = (r: readonly [number, number], k: number) => r[0] + r[1] * k;

function disk(s: CityState, cx: number, cy: number, r: number, fn: (i: number, d: number) => void): void {
  const n = s.size;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(n - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(n - 1, Math.ceil(cx + r)); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r) fn(y * n + x, d);
    }
  }
}

/** A God Mode disaster's Mayor Rating effect around (x, y). */
export function disasterEvent(cfg: SimConfig, x: number, y: number): CityEvent {
  return event(x, y, cfg.disasters.godMode.event);
}

function event(x: number, y: number, e: { amount: number; radius: number; months: number }): CityEvent {
  return { x, y, radius: e.radius, amount: e.amount, months: e.months, age: 0 };
}

/** Footprint size of whatever stands on tile i (0 if nothing). */
function lotSize(s: CityState, i: number): number {
  const occ = s.occupant[i]!;
  const r = occ > 0 ? s.buildings.get(occ) : occ < 0 ? s.structures.get(-occ) : undefined;
  return r ? r.w * r.h : 0;
}

/** Runs a God Mode disaster at (x, y) with intensity 0–1. */
/** Disasters that move about and can be steered (drag the tornado, direct the robot). */
export type LiveKind = 'tornado' | 'robot' | 'autosaurus' | 'meteor' | 'ufo';
export const LIVE_KINDS: readonly DisasterKind[] = ['tornado', 'robot', 'autosaurus', 'meteor', 'ufo'];

/** A moving disaster in progress. */
export interface LiveDisaster {
  id: number;
  kind: LiveKind;
  x: number;
  y: number;
  /** Steps taken and steps it lasts (intensity sets the length). */
  step: number;
  steps: number;
  /** Tornado: heading (index into the eight directions) and funnel radius. */
  dir: number;
  radius: number;
  /** Robot: where it is heading. */
  target: [number, number] | null;
  /** A point the player is pulling it towards (null: it roams on its own). */
  steer: [number, number] | null;
  /** Steps it has been pulled towards the same point: held long, it hurries there. */
  held?: number;
  /** Meteor: intensity it will hit with (pulling it down harder raises it). */
  k?: number;
  report: DamageReport;
}

/** Touches down: the moving disaster's starting state. */
export function startLive(ctx: DisasterContext, kind: LiveKind, x: number, y: number, k: number, id: number): LiveDisaster {
  const g = ctx.cfg.disasters.godMode;
  if (kind === 'meteor') {
    // Falls for a while; x, y is where it would land now.
    return { id, kind, x, y, step: 0, steps: ctx.cfg.disasters.live.meteorFall, dir: 0, radius: 0, target: null, steer: null, k, report: ctx.report };
  }
  if (kind === 'ufo') {
    // The death ray on the first step, then one mini-UFO shot a step.
    const u = g.ufo;
    return { id, kind, x, y, step: 0, steps: 1 + Math.round(lerp(u.saucers, k)) * u.shots, dir: 0, radius: Math.round(lerp(u.ray, k)), target: null, steer: null, report: ctx.report };
  }
  if (kind === 'tornado') {
    const radius = Math.round(lerp(g.tornado.radius, k));
    const dir = Math.floor(ctx.rng.next() * 8);
    return { id, kind, x, y, step: 0, steps: Math.round(lerp(g.tornado.steps, k)), dir, radius, target: null, steer: null, report: ctx.report };
  }
  return { id, kind, x, y, step: 0, steps: Math.round(lerp(kind === 'autosaurus' ? g.autosaurus.steps : g.robot.steps, k)), dir: 0, radius: 0, target: null, steer: null, report: ctx.report };
}

/** The eight-way heading closest to a vector. */
function heading(dx: number, dy: number): number {
  return ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
}

/**
 * One step of a moving disaster: the tornado wrecks what it touches above
 * ground, turns back from big buildings and dies over water (no fires,
 * nothing underground); the robots stomp a 2×2 path through the densest
 * buildings nearby, Servo throwing plates, water stopping the Autosaurus and
 * turning Servo away. Steering pulls either towards a point. Returns false
 * when it is over.
 */
export function stepLive(ctx: DisasterContext, d: LiveDisaster): boolean {
  const { s, cfg, rng } = ctx;
  const g = cfg.disasters.godMode;
  const n = s.size;
  const at = (px: number, py: number) => py * n + px;
  const inMap = (px: number, py: number) => px >= 0 && py >= 0 && px < n && py < n;
  if (d.step >= d.steps) return false;
  if (d.kind === 'ufo') {
    const u = g.ufo;
    if (d.step === 0) disk(s, d.x, d.y, d.radius, (i) => ctx.destroyTile(i, true));
    else {
      // The player can hold the pointer on a spot to aim the mini-UFOs:
      // held, they pick off lots close to it; else any within range of the mothership.
      const [cx, cy, r] = d.steer ? [d.steer[0], d.steer[1], 3] : [d.x, d.y, u.range];
      const near = [...s.buildings.values()].filter((b) => Math.hypot(b.x - cx, b.y - cy) <= r);
      if (near.length) {
        const b = near[Math.floor(rng.next() * near.length)]!;
        ctx.destroyTile(at(b.x, b.y), false);
      }
    }
    d.step++;
    if (d.step < d.steps) return true;
    s.events.push(event(d.x, d.y, g.ufoEvent));
    return false;
  }
  if (d.kind === 'meteor') {
    // Steered, its landing point drifts towards the pointer and it comes down
    // faster and harder; on the ground it strikes like an instant meteor.
    if (d.steer) {
      d.x += Math.sign(d.steer[0] - d.x);
      d.y += Math.sign(d.steer[1] - d.y);
      d.k = Math.min(1, (d.k ?? 0.5) + cfg.disasters.live.meteorPush);
      d.step++;
    }
    d.step++;
    if (d.step >= d.steps) {
      const x = Math.max(0, Math.min(n - 1, d.x));
      const y = Math.max(0, Math.min(n - 1, d.y));
      ctx.report.x = x;
      ctx.report.y = y;
      runDisaster(ctx, 'meteor', x, y, d.k ?? 0.5);
      return false;
    }
    return true;
  }
  if (d.kind === 'tornado') {
    const t = g.tornado;
    if (!inMap(d.x, d.y) || s.terrain[at(d.x, d.y)] === Terrain.Water) return false;
    let bounced = false;
    disk(s, d.x, d.y, d.radius, (i) => {
      if (lotSize(s, i) >= t.bigBuilding) bounced = true;
      else {
        ctx.destroyTile(i, false);
        breakOverhead(s, cfg, ctx.report, i);
      }
    });
    if (d.steer) d.dir = heading(d.steer[0] - d.x, d.steer[1] - d.y);
    else if (bounced) d.dir = (d.dir + 4) % 8;
    else if (rng.next() < t.turn) d.dir = (d.dir + (rng.next() < 0.5 ? 1 : 7)) % 8;
    if (!d.steer || d.steer[0] !== d.x || d.steer[1] !== d.y) {
      d.x += DIRS[d.dir]![0];
      d.y += DIRS[d.dir]![1];
    }
    d.step++;
    return true;
  }
  const r = g.robot;
  const step = d.step++;
  if (d.steer) d.target = d.steer;
  else if (!d.target || (Math.round(d.x) === d.target[0] && Math.round(d.y) === d.target[1]) || step % 20 === 0) {
    const near = [...s.buildings.values()].filter((b) => Math.hypot(b.x - d.x, b.y - d.y) <= r.seek);
    const b = near.length ? near[Math.floor(rng.next() * near.length)]! : null;
    d.target = b ? [b.x, b.y] : [Math.floor(rng.next() * n), Math.floor(rng.next() * n)];
  }
  const nx = d.x + Math.sign(d.target![0] - d.x);
  const ny = d.y + Math.sign(d.target![1] - d.y);
  if (!inMap(nx, ny)) return false;
  if (s.terrain[at(nx, ny)] === Terrain.Water) {
    if (d.kind === 'autosaurus') return false;
    d.target = null;
    if (d.steer) d.steer = null; // can't wade in: back to roaming
    return true;
  }
  d.x = nx;
  d.y = ny;
  for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    if (inMap(d.x + ox, d.y + oy)) ctx.destroyTile(at(d.x + ox, d.y + oy), true, true);
  }
  if (d.kind === 'robot' && step % r.plateEvery === 0 && rng.next() < r.plateChance) {
    const a = rng.next() * Math.PI * 2;
    const dist = r.plateRange[0] + rng.next() * (r.plateRange[1] - r.plateRange[0]);
    const tx = Math.round(d.x + Math.cos(a) * dist);
    const ty = Math.round(d.y + Math.sin(a) * dist);
    for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      if (inMap(tx + ox, ty + oy)) ctx.destroyTile(at(tx + ox, ty + oy), true, true);
    }
  }
  return true;
}

export function runDisaster(ctx: DisasterContext, kind: DisasterKind, x: number, y: number, k: number): void {
  const { s, cfg, rng } = ctx;
  const g = cfg.disasters.godMode;
  const n = s.size;
  const at = (px: number, py: number) => py * n + px;
  const inMap = (px: number, py: number) => px >= 0 && py >= 0 && px < n && py < n;

  switch (kind) {
    case 'fire': {
      // Catches more readily where flammability is high; longer holds start bigger.
      const i = at(x, y);
      const p = Math.min(1, g.fire.base + ctx.f.flammability[i]! / 100);
      if (rng.next() < p) ctx.igniteTile(i, 1 + Math.floor(2 * k));
      return;
    }
    case 'lightning':
      ctx.igniteTile(at(x, y), 2);
      return;

    case 'meteor': {
      // A crater destroying everything above and below ground; burning debris around it.
      const m = g.meteor;
      const rc = Math.round(lerp(m.crater, k));
      const land = s.terrain[at(x, y)] !== Terrain.Water;
      if (land) {
        disk(s, x, y, rc, (i) => {
          ctx.destroyTile(i, true);
          ctx.breakUnderground(i);
          if (s.terrain[i] !== Terrain.Water) {
            s.landform[i] = Landform.Crater;
            s.height[i] = Math.max(1, s.height[i]! - g.meteor.depth);
          }
        });
      }
      const debris = Math.round(lerp(m.debris, k));
      for (let d = 0; d < debris; d++) {
        const a = rng.next() * Math.PI * 2;
        const r = rc + rng.next() * rc * (m.debrisSpread - 1);
        const px = Math.round(x + Math.cos(a) * r);
        const py = Math.round(y + Math.sin(a) * r);
        if (inMap(px, py)) ctx.igniteTile(at(px, py), m.debrisStage);
      }
      break;
    }

    case 'tornado':
    case 'robot':
    case 'autosaurus': {
      // Moving disasters: walked to the end at once (see startLive/stepLive to play them out).
      const live = startLive(ctx, kind, x, y, k, 0);
      while (stepLive(ctx, live));
      break;
    }

    case 'earthquake': {
      // A straight fault through the epicentre (all quakes share its direction);
      // shattered buildings and fires in a band along it, broken pipes and subway.
      const e = g.earthquake;
      if (s.faultAngle === null) s.faultAngle = rng.next() * Math.PI;
      const ux = Math.cos(s.faultAngle);
      const uy = Math.sin(s.faultAngle);
      const half = lerp(e.halfLength, k);
      const band = lerp(e.band, k);
      const hit = new Set<number>();
      for (let t = -half; t <= half; t += 0.5) {
        const px = Math.round(x + ux * t);
        const py = Math.round(y + uy * t);
        if (!inMap(px, py)) continue;
        const i = at(px, py);
        ctx.destroyTile(i, true);
        ctx.breakUnderground(i);
        if (s.terrain[i] !== Terrain.Water) s.landform[i] = Landform.Fault;
      }
      // Band: distance from the fault line.
      const reach = half + band;
      disk(s, x, y, reach, (i) => {
        const px = i % n;
        const py = (i - px) / n;
        const along = (px - x) * ux + (py - y) * uy;
        if (Math.abs(along) > half) return;
        const d = Math.abs(-(px - x) * uy + (py - y) * ux);
        if (d > band || d < 0.5) return;
        const w = 1 - d / band;
        if ((s.pipe[i] || s.subway[i]) && rng.next() < e.underground * w) ctx.breakUnderground(i);
        const occ = s.occupant[i]!;
        if (!occ || hit.has(occ)) return;
        hit.add(occ);
        const roll = rng.next();
        if (roll < e.destroy * w) ctx.destroyTile(i, false);
        else if (roll < (e.destroy + e.ignite) * w) ctx.igniteTile(i, 2);
      });
      break;
    }

    case 'volcano': {
      // Raises a cratered cone (destroying everything on and around it, above
      // and below ground), then lava flows and bombs set fires further out.
      const v = g.volcano;
      const rc = Math.round(lerp(v.cone, k));
      const rs = rc * 2;
      disk(s, x, y, rs, (i, d) => {
        ctx.destroyTile(i, true);
        ctx.breakUnderground(i);
        if (d <= rc) s.terrain[i] = Terrain.Land;
        if (s.terrain[i] !== Terrain.Water) {
          s.landform[i] = d <= rc ? Landform.Cone : Landform.Slope;
          // A mountain rising from the land around it.
          s.height[i] = Math.min(250, Math.max(s.height[i]!, Math.round(s.height[i]! + v.peak * (1 - d / rs))));
        }
      });
      const flows = Math.round(lerp(v.flows, k));
      for (let fl = 0; fl < flows; fl++) {
        const a = rng.next() * Math.PI * 2;
        let px = x + Math.cos(a) * rc;
        let py = y + Math.sin(a) * rc;
        const len = rc + v.flowLength[0] + rng.next() * (v.flowLength[1] - v.flowLength[0]);
        for (let step = 0; step < len; step++) {
          const ox = px - x;
          const oy = py - y;
          const o = Math.hypot(ox, oy) || 1;
          // Outward with some wobble, never back towards the cone.
          const w = (rng.next() - 0.5) * 1.2;
          px += ox / o + (-oy / o) * w;
          py += oy / o + (ox / o) * w;
          const ix = Math.round(px);
          const iy = Math.round(py);
          if (!inMap(ix, iy)) break;
          ctx.igniteTile(at(ix, iy), v.stage);
        }
      }
      for (let b = 0; b < v.bombs; b++) {
        const a = rng.next() * Math.PI * 2;
        const r = rng.next() * (rs + v.bombSpread);
        const ix = Math.round(x + Math.cos(a) * r);
        const iy = Math.round(y + Math.sin(a) * r);
        if (inMap(ix, iy)) ctx.igniteTile(at(ix, iy), v.stage);
      }
      break;
    }

    case 'ufo': {
      // A death ray, then small saucers picking off single lots: surgical damage, widespread panic.
      const u = g.ufo;
      disk(s, x, y, Math.round(lerp(u.ray, k)), (i) => ctx.destroyTile(i, true));
      const saucers = Math.round(lerp(u.saucers, k));
      for (let sc = 0; sc < saucers; sc++) {
        for (let shot = 0; shot < u.shots; shot++) {
          const near = [...s.buildings.values()].filter((b) => Math.hypot(b.x - x, b.y - y) <= u.range);
          if (!near.length) break;
          const b = near[Math.floor(rng.next() * near.length)]!;
          ctx.destroyTile(at(b.x, b.y), false);
        }
      }
      s.events.push(event(x, y, g.ufoEvent));
      return;
    }
  }
  s.events.push(event(x, y, g.event));
}

// ------------------------------------------------------------ mini-disasters

/** Monthly utility wear from department funding; returns tiles of sparking lines and bursting pipes. */
export function wearUtilities(s: CityState, cfg: SimConfig, rng: Rng): { sparks: number[]; bursts: number[] } {
  const w = cfg.disasters.wear;
  const sparks: number[] = [];
  const bursts: number[] = [];
  const wear = (layer: Uint8Array, has: Uint8Array, funding: number, keptUpFrom = 100) => {
    const f = funding / 100;
    const worn = funding < keptUpFrom;
    for (let i = 0; i < layer.length; i++) {
      if (!has[i]) {
        layer[i] = 0;
        continue;
      }
      if (worn) {
        const add = w.rate * (1 - f);
        layer[i] = Math.min(255, layer[i]! + Math.floor(add) + (rng.next() < add % 1 ? 1 : 0));
      } else layer[i] = Math.max(0, layer[i]! - Math.round(w.repair * f));
    }
  };
  wear(s.lineWear, s.power, s.departments.power);
  // (Pipes wear only below half funding: at 90% they grew distressed over the years, and burst the
  // moment funding fell under 50%.)
  wear(s.pipeWear, s.pipe, s.departments.water, w.pipeRepairAbove);
  // Sparks once lines are left to degrade below 50% funding, each distressed line alike: a chance
  // that grew with the line count too made a big grid's sparks grow with its square. (Above 50% lines
  // still wear, gradually, ready to spark when funding falls.)
  const sparkP = w.spark * w.sparkLowFunding;
  if (s.departments.power < 50) {
    for (let i = 0; i < s.lineWear.length; i++) {
      if (s.lineWear[i]! >= w.distressed && rng.next() < sparkP) sparks.push(i);
    }
  }
  // Bursts only below 50% water funding; a burst can spread to worn neighbours.
  if (s.departments.water < 50) {
    const n = s.size;
    for (let i = 0; i < s.pipeWear.length; i++) {
      if (s.pipeWear[i]! < w.distressed || rng.next() >= w.burst) continue;
      bursts.push(i);
      const x = i % n;
      for (const j of [i - 1, i + 1, i - n, i + n]) {
        if (j < 0 || j >= s.pipe.length || (Math.abs((j % n) - x) > 1)) continue;
        if (s.pipe[j] && s.pipeWear[j]! >= w.distressed && rng.next() < w.burstSpread) bursts.push(j);
      }
    }
  }
  return { sparks, bursts };
}

/** Rail damage from mass transit funding, like potholes but repaired only above 100% (Rush Hour). */
export function damageRail(s: CityState, cfg: SimConfig, rng: Rng): void {
  const r = cfg.disasters.rail;
  const f = s.departments.transit;
  const crack = f < 100 ? r.damage * (1 - f / 100) : 0;
  const fix = f > 100 ? Math.min(1, r.repair * (Math.min(f, r.best) - 100) / (r.best - 100)) : 0;
  for (let i = 0; i < s.net.length; i++) {
    if (!isRail(s.net[i]!)) {
      s.railDamage[i] = 0;
      continue;
    }
    if (s.railDamage[i]) {
      if (fix && rng.next() < fix) s.railDamage[i] = 0;
    } else if (crack && rng.next() < crack) s.railDamage[i] = 1;
  }
}

/** Trains over damaged track derail; some freight trains spill toxic waste. Returns spill tiles. */
export function derailments(s: CityState, f: Fields, cfg: SimConfig, rng: Rng): number[] {
  const r = cfg.disasters.rail;
  const spills: number[] = [];
  for (let i = 0; i < s.railDamage.length; i++) {
    if (!s.railDamage[i] || f.railTraffic[i]! <= 0) continue;
    s.incidents.push({ i, day: s.day, kind: 'derailment' });
    // Freight trains carry a toxic tank 10% of the time; it cracks half the time.
    // Only where freight trains run over the broken track.
    if (f.freightRail[i]! > 0 && rng.next() < r.toxicTank * r.crack) spills.push(i);
  }
  return spills;
}

/** Monthly pileup rolls at congested intersections (Rush Hour values). Cosmetic. */
export function pileups(s: CityState, f: Fields, cfg: SimConfig, rng: Rng): void {
  const n = s.size;
  for (let i = 0; i < s.net.length; i++) {
    const code = s.net[i]!;
    if (!isAsphalt(code) || f.traffic[i]! <= 0) continue;
    const x = i % n;
    let degree = 0;
    for (const j of [i - 1, i + 1, i - n, i + n]) {
      if (j < 0 || j >= s.net.length || Math.abs((j % n) - x) > 1) continue;
      if (tilesLinked(s, i, j)) degree++;
    }
    if (degree < 3) continue;
    const kind = NETWORK_KINDS[code]!;
    const u = f.traffic[i]! / cfg.transport.speed[kind].capacity;
    if (rng.next() < Math.min(0.3, interp(cfg.disasters.pileup, u))) s.incidents.push({ i, day: s.day, kind: 'pileup' });
  }
}
