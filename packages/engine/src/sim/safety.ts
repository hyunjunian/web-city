// Police, crime and fires.

import { lotDistance } from './rewards';
import { drain } from './steps';
import type { SimConfig } from '../config';
import { interp } from '../data/services';
import type { StructureDef } from '../data/structures';
import type { Rng } from '../rng';
import { WEALTHS, type DevType } from '../types';
import type { CrimeLot } from '../data/safety';
import type { Census } from './demand';
import { footprint, frontage, type Fields } from './fields';
import { ordinanceEffects } from './mayor';
import { structureFunding, type Building, type CityEvent, type CityState, type Fire, type Rect, type Structure } from './state';
import { addUnitCover } from './dispatch';

const centre = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

/** Funding and strikes scale a station's radius and strength. */
export function stationFactor(cfg: SimConfig, def: StructureDef, st: Structure, onRoad: boolean): number {
  const sf = cfg.safety;
  let k = interp(sf.funding, st.funding) * (st.strike > 0 ? cfg.services.strikeEffectiveness : 1);
  if (def.fire?.needsRoad && !onRoad) k *= sf.fireNoRoad;
  return k;
}

/** Adds a linear disk (strength `c0` at the centre → `c1` at radius) into `out`. */
function disk(n: number, out: Float32Array, r: Rect, radius: number, c0: number, c1: number): void {
  if (radius <= 0 || (c0 === 0 && c1 === 0)) return;
  const [cx, cy] = centre(r);
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(n - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(n - 1, Math.ceil(cx + radius)); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      const d = Math.sqrt(d2);
      out[y * n + x]! += c0 + ((c1 - c0) * d) / radius;
    }
  }
}

/** Effective flammability of a building (dry ×1.25, abandoned ×1.5). */
export function buildingFlammability(cfg: SimConfig, b: Building): number {
  const sf = cfg.safety;
  const t = b.type ?? b.origType;
  let v = sf.flammabilityBase[t] + (sf.flammabilityStageBonus[b.stage - 1] ?? 0);
  if (!b.watered) v *= sf.flammabilityDry;
  if (!b.type) v *= sf.flammabilityAbandoned;
  return v;
}

export function structureFlammability(cfg: SimConfig, def: StructureDef, watered: boolean): number {
  const v = def.flammability ?? cfg.safety.civicFlammability[def.category];
  return watered ? v : v * cfg.safety.flammabilityDry;
}

/**
 * Police and fire protection, flammability and short-term-event fields.
 * Stations are additive (police as in SimCity 4; we do the same for fire).
 */
export function computeSafetyFields(s: CityState, f: Fields, cfg: SimConfig): void {
  drain(computeSafetyFieldsSteps(s, f, cfg));
}

/** `computeSafetyFields` in steps (see ./steps). */
export function* computeSafetyFieldsSteps(s: CityState, f: Fields, cfg: SimConfig): Generator<void, void> {
  const n = s.size;
  f.policeCover.fill(0);
  f.fireCover.fill(0);
  yield;
  let piece1 = 0;
  for (const st of s.structures.values()) {
    if ((++piece1 & 0x1ff) === 0) yield;
    const def = cfg.structures[st.kind];
    if (!def.police && !def.fire) continue;
    const k = stationFactor(cfg, def, st, frontage(s, st).length > 0);
    st.effectiveness = k;
    if (def.police) disk(n, f.policeCover, st, def.police.radius * Math.min(1.1, k), def.police.center * k, 0);
    if (def.fire) disk(n, f.fireCover, st, def.fire.radius * Math.min(1.1, k), def.fire.center * k, def.fire.edge * k);
  }
  addUnitCover(s, f, cfg);
  // Casinos, army bases, prisons…: police are less effective around them (their crime effect).
  yield;
  let piece2 = 0;
  for (const st of s.structures.values()) {
    if ((++piece2 & 0x1ff) === 0) yield;
    const ce = cfg.structures[st.kind].crimeEffect;
    if (!ce) continue;
    // Full on the lot, fading to nothing at the radius from its edge (from the middle, a long lot reached far past its sides).
    const r = ce[1];
    for (let y = Math.max(0, Math.floor(st.y - r)); y <= Math.min(n - 1, Math.ceil(st.y + st.h + r)); y++) {
      for (let x = Math.max(0, Math.floor(st.x - r)); x <= Math.min(n - 1, Math.ceil(st.x + st.w + r)); x++) {
        const d = lotDistance(st, x, y);
        if (d < r || d === 0) f.policeCover[y * n + x]! *= 1 - (ce[0] / 100) * (r > 0 ? Math.max(0, 1 - d / r) : 1);
      }
    }
  }

  f.flammability.fill(0);
  const smoke = ordinanceEffects(s).flammability;
  yield;
  let piece3 = 0;
  for (const b of s.buildings.values()) {
    if ((++piece3 & 0x1ff) === 0) yield;
    const v = buildingFlammability(cfg, b) * smoke;
    for (const i of footprint(s, b)) f.flammability[i] = v;
  }
  yield;
  let piece4 = 0;
  for (const st of s.structures.values()) {
    if ((++piece4 & 0x1ff) === 0) yield;
    const def = cfg.structures[st.kind];
    const tiles = footprint(s, st);
    const v = structureFlammability(cfg, def, tiles.some((i) => f.watered[i] === 1)) * smoke;
    for (const i of tiles) f.flammability[i] = v;
  }

  f.events.fill(0);
  yield;
  let piece5 = 0;
  for (const e of s.events) {
    if ((++piece5 & 0x1ff) === 0) yield;
    const amount = e.amount * (1 - e.age / e.months);
    disk(n, f.events, { x: e.x, y: e.y, w: 1, h: 1 }, e.radius, amount, amount);
  }
}

// ---------------------------------------------------------------- crime

/** Criminality share of each wealth level: base by EQ plus unemployment. */
export function criminality(cfg: SimConfig, census: Census): [number, number, number] {
  const sf = cfg.safety;
  return WEALTHS.map((w) => {
    const u = census.workers[w] > 0 ? census.unemployed[w] / census.workers[w] : 0;
    return Math.max(0, Math.min(1, interp(sf.baseCriminality[w], census.avgEq[w]) + interp(sf.unemploymentCrime, u)));
  }) as [number, number, number];
}

function stochasticRound(rng: Rng, v: number): number {
  const whole = Math.floor(v);
  return whole + (rng.next() < v - whole ? 1 : 0);
}

/**
 * Monthly crime: residents' criminality makes crimes (1 per 1,000
 * criminals) that land on random lots. Police prevent up to half and arrest
 * criminals where protection > 20; arrests fill station cells and jails, the
 * rest strike again next month. Returns arson targets (abandoned buildings).
 */
/** A developer type's lot class, for where each kind of crime can happen. */
function crimeLot(t: DevType): CrimeLot {
  if (t[0] === 'R') return 'res';
  if (t.startsWith('Cs')) return 'svc';
  if (t.startsWith('Co')) return 'office';
  return t === 'IA' ? 'agri' : t === 'ID' ? 'dirty' : t === 'IM' ? 'manuf' : 'hightech';
}

export function runCrime(s: CityState, f: Fields, cfg: SimConfig, census: Census, rng: Rng): Building[] {
  return drain(runCrimeSteps(s, f, cfg, census, rng));
}

/** `runCrime` in steps (see ./steps). */
export function* runCrimeSteps(s: CityState, f: Fields, cfg: SimConfig, census: Census, rng: Rng): Generator<void, Building[]> {
  const sf = cfg.safety;
  const n = s.size;
  const crim = criminality(cfg, census);
  let expected = s.carryCrimes;
  yield;
  for (const w of WEALTHS) expected += (census.residents[w] * crim[w]) / sf.criminalsPerCrime;
  expected *= ordinanceEffects(s).crime;
  const count = stochasticRound(rng, expected);

  // Each crime is one of 13 kinds, on a lot where that kind can
  // happen (weighted by footprint); kinds with no such lot in town don't occur.
  const kinds: { ct: (typeof sf.crimeTypes)[number]; lots: { r: Rect; building?: Building }[]; weights: number[]; odds: number }[] = [];
  let selectionWork = 0;
  for (const ct of sf.crimeTypes) {
    yield;
    const lots: { r: Rect; building?: Building }[] = [];
    const weights: number[] = [];
    const add = (r: Rect, building?: Building) => {
      lots.push({ r, building });
      weights.push(r.w * r.h);
    };
    for (const b of s.buildings.values()) {
      if ((++selectionWork & 0x1fff) === 0) yield;
      if (ct.abandoned ? b.type !== null : b.type === null) continue;
      const t = b.type ?? b.origType;
      if (!ct.lots.includes(crimeLot(t))) continue;
      if (ct.wealth && !ct.wealth.includes(cfg.demand.wealthOf[t])) continue;
      add(b, b);
    }
    if (!ct.abandoned) {
      for (const st of s.structures.values()) {
        if ((++selectionWork & 0x1fff) === 0) yield;
        const def = cfg.structures[st.kind];
        if (def.category === 'park') continue;
        if (ct.lots.includes(sf.tourismLots.includes(st.kind) ? 'tourism' : 'other')) add(st);
      }
    }
    kinds.push({ ct, lots, weights, odds: lots.length ? ct.odds : 0 });
  }
  const odds = kinds.map((k) => k.odds);
  const stats = { crimes: 0, arrests: 0, prevented: 0, paroled: 0, byType: {} as Record<string, number>, spots: [] as [number, string][] };
  const arson: Building[] = [];
  let carry = 0;
  const arrested: number[] = [];

  // Fade old crime before adding this month's.
  yield;
  for (let i = 0; i < s.crime.length; i++) s.crime[i]! *= sf.crimeDecay;

  yield;
  for (let k = 0; k < count; k++) {
    // Each draw scans a kind's eligible lots. Even hundreds of crimes can
    // occupy a frame in a large city, well below the old 32,768-draw pause.
    if ((k & 0x1f) === 0x1f) yield;
    const kind = kinds[rng.weighted(odds)];
    if (!kind) break; // nowhere for any crime to happen
    const { r, building: b } = kind.lots[rng.weighted(kind.weights)]!;
    const i = (r.y + rng.int(r.h)) * n + r.x + rng.int(r.w);
    const protection = f.policeCover[i]!;
    if (rng.next() < Math.min(sf.maxSuppression, protection / sf.suppressionDivisor)) {
      stats.prevented++;
      continue;
    }
    stats.crimes++;
    stats.byType[kind.ct.id] = (stats.byType[kind.ct.id] ?? 0) + 1;
    stats.spots.push([i, kind.ct.id]);
    disk(n, s.crime, { x: i % n, y: Math.floor(i / n), w: 1, h: 1 }, sf.crimeRadius, 1, 0);
    if (protection > sf.arrestThreshold) {
      stats.arrests++;
      arrested.push(i);
    } else {
      carry += sf.carryOver;
      if (kind.ct.abandoned && b) arson.push(b);
    }
  }

  // Jails: each arrest goes to the station covering the tile most, then city jails.
  const stations = [...s.structures.values()].filter((st) => cfg.structures[st.kind].police);
  yield;
  let piece1 = 0;
  for (const st of stations) {
    if ((++piece1 & 0x1ff) === 0) yield;
    const def = cfg.structures[st.kind];
    // Inmates serve their time; jails' capacity follows funding.
    st.load = Math.max(0, st.load - Math.ceil(st.load / sf.sentenceMonths));
    const p = def.police!;
    st.capacity = p.radius > 0 || p.overcapacityCost ? p.cells : Math.round(p.cells * interp(cfg.services.capacityByFunding, structureFunding(s, def, st)));
  }
  const jails = stations.filter((st) => cfg.structures[st.kind].police!.radius === 0);
  const prison = jails.find((j) => cfg.structures[j.kind].police!.overcapacityCost);
  yield;
  let piece2 = 0;
  for (const i of arrested) {
    if ((++piece2 & 0x1ff) === 0) yield;
    const x = (i % n) + 0.5;
    const y = Math.floor(i / n) + 0.5;
    let best: Structure | null = null;
    let bestV = 0;
    for (const st of stations) {
      const p = cfg.structures[st.kind].police!;
      if (p.radius <= 0 || st.load >= st.capacity) continue;
      const [cx, cy] = centre(st);
      const d = Math.hypot(x - cx, y - cy);
      const v = d <= p.radius ? p.center * (1 - d / p.radius) : 0;
      if (v > bestV) {
        bestV = v;
        best = st;
      }
    }
    best ??= jails.find((j) => j.load < j.capacity) ?? prison ?? null;
    if (best) best.load++;
    else {
      stats.paroled++;
      carry += 1;
    }
  }
  // Overcrowded jails (after funding cuts) break out to 80% or parole the excess.
  yield;
  let piece3 = 0;
  for (const j of jails) {
    if ((++piece3 & 0x1ff) === 0) yield;
    if (j.load <= j.capacity || cfg.structures[j.kind].police!.overcapacityCost) continue;
    if (rng.next() < Math.min(1, (j.load / Math.max(1, j.capacity) - 1) * 2)) j.load = Math.floor(sf.jailbreakTarget * j.capacity);
    else {
      stats.paroled += j.load - j.capacity;
      carry += j.load - j.capacity;
      j.load = j.capacity;
    }
  }
  s.carryCrimes = carry;
  Object.assign(s.safety, stats);
  return arson;
}

// ---------------------------------------------------------------- fire

export interface FireContext {
  s: CityState;
  f: Fields;
  cfg: SimConfig;
  rng: Rng;
  /** Destroys a burned building/structure and leaves rubble. */
  destroy: (target: number) => void;
}

function targetRect(s: CityState, target: number): (Rect & { building?: Building; structure?: Structure }) | null {
  if (target > 0) {
    const b = s.buildings.get(target);
    return b ? { x: b.x, y: b.y, w: b.w, h: b.h, building: b } : null;
  }
  const st = s.structures.get(-target);
  return st ? { x: st.x, y: st.y, w: st.w, h: st.h, structure: st } : null;
}

function bestProtection(f: Fields, n: number, r: Rect): number {
  let best = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) best = Math.max(best, f.fireCover[y * n + x]!);
  return best;
}

/** Highest fire stage a target can reach (bigger buildings burn bigger). */
function maxStage(cfg: SimConfig, r: { building?: Building; structure?: Structure }): number {
  if (r.building) return Math.min(5, 1 + Math.ceil(r.building.stage / 2));
  return (r.structure && cfg.structures[r.structure.kind].maxFire) ?? 4;
}

function isBurning(s: CityState, target: number): boolean {
  return s.fires.some((fi) => fi.target === target);
}

/** Starts a fire unless local protection snuffs it at once (small fires go out unseen). */
export function ignite(ctx: FireContext, target: number, stage = 1): boolean {
  const { s, f, cfg } = ctx;
  if (isBurning(s, target)) return false;
  const r = targetRect(s, target);
  if (!r) return false;
  // Coverage snuffs small blazes; disaster fires start bigger and need more.
  if (bestProtection(f, s.size, r) >= cfg.safety.protectionPerStage * stage) return false;
  s.fires.push({ target, stage, days: 0, daysAtMax: 0 });
  s.fireTally.fires++;
  s.events.push(fireEvent(cfg, r));
  return true;
}

/** Sets a wooded tile alight (fires catch on trees, not bare ground). */
export function igniteTree(ctx: FireContext, i: number, burning?: Set<number>): boolean {
  const { s, f, cfg } = ctx;
  if (!s.trees[i] || s.occupant[i] || (burning ? burning.has(i) : s.treeFires.some((t) => t.i === i))) return false;
  if (f.fireCover[i]! >= cfg.safety.protectionPerStage) return false;
  s.treeFires.push({ i, days: 0 });
  burning?.add(i);
  return true;
}

/**
 * A day of tree fires: each spreads to wooded neighbours (more downwind) and
 * to adjacent buildings by their flammability, and burns its trees away after
 * a few days; fire cover puts it out. Returns whether trees burned.
 */
export function stepTreeFires(ctx: FireContext): boolean {
  const { s, f, cfg, rng } = ctx;
  const tf = cfg.safety.treeFire;
  const n = s.size;
  const [wx, wy] = WIND_DIRS[s.wind.dir]!;
  const current = s.treeFires;
  s.treeFires = [];
  // Tiles burning today or lit today: none is lit twice.
  const burning = new Set(current.map((t) => t.i));
  let burned = false;
  for (const t of current) {
    if (!s.trees[t.i] || s.occupant[t.i]) continue; // cleared or built over
    if (f.fireCover[t.i]! >= cfg.safety.protectionPerStage) continue; // put out
    const x = t.i % n;
    const y = (t.i - x) / n;
    for (let k = 0; k < 8; k++) {
      const [dx, dy] = WIND_DIRS[k]!;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      const downwind = (dx * wx + dy * wy) / (Math.hypot(dx, dy) * Math.hypot(wx, wy));
      const chance = tf.spread * (1 + s.wind.strength * downwind);
      if (rng.next() >= chance) continue;
      const occ = s.occupant[j]!;
      if (occ) {
        if (rng.next() < f.flammability[j]! / 100) ignite(ctx, occ);
      } else igniteTree(ctx, j, burning);
    }
    if (++t.days >= tf.burnDays) {
      s.trees[t.i] = 0;
      burned = true;
    } else s.treeFires.push(t);
  }
  return burned;
}

/**
 * Monthly ignition: a 5% citywide chance plus hotspots — clusters of
 * at least 40 tiles of flammability ≥ 54 within 8 tiles (Rush Hour values).
 * Protection lowers the odds; the target is picked by flammability.
 */
export function monthlyIgnition(ctx: FireContext): void {
  const { s, f, cfg, rng } = ctx;
  const sf = cfg.safety;
  const n = s.size;
  const targets: number[] = [];
  const weights: number[] = [];
  const weightOf = (r: Rect, flam: number) => {
    const pf = Math.max(0.05, 1 - bestProtection(f, n, r) / sf.ignitionProtection);
    return flam * r.w * r.h * pf;
  };
  for (const b of s.buildings.values()) {
    targets.push(b.id);
    weights.push(weightOf(b, f.flammability[b.y * n + b.x]!));
  }
  for (const st of s.structures.values()) {
    targets.push(-st.id);
    weights.push(weightOf(st, f.flammability[st.y * n + st.x]!));
  }
  if (!targets.length) return;
  if (rng.next() < sf.monthlyFireChance) {
    const k = rng.weighted(weights);
    if (k >= 0) ignite(ctx, targets[k]!);
  }

  // Hotspots: count high-flammability tiles in an (approximately circular) window.
  const hot = new Float32Array(n * n);
  let any = false;
  for (let i = 0; i < n * n; i++) {
    if (f.flammability[i]! >= sf.hotspotFlammability) {
      hot[i] = 1;
      any = true;
    }
  }
  if (!any) return;
  const R = sf.hotspotRadius;
  const W = n + 1;
  const sat = new Float64Array(W * W);
  for (let y = 0; y < n; y++) {
    let row = 0;
    for (let x = 0; x < n; x++) {
      row += hot[y * n + x]!;
      sat[(y + 1) * W + x + 1] = sat[y * W + x + 1]! + row;
    }
  }
  const box = (x: number, y: number) => {
    const x0 = Math.max(0, x - R), x1 = Math.min(n, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(n, y + R + 1);
    // A square window overcounts a circle by 4/π.
    return ((sat[y1 * W + x1]! - sat[y0 * W + x1]! - sat[y1 * W + x0]! + sat[y0 * W + x0]!) * Math.PI) / 4;
  };
  // About one roll per hotspot-sized area: each hot building takes its share (its tiles over the
  // window's count) of the roll for the window around its middle; a big hot district holds several hotspots.
  for (const b of s.buildings.values()) {
    const i = b.y * n + b.x;
    if (!hot[i]) continue;
    const c = box(b.x + (b.w >> 1), b.y + (b.h >> 1));
    const p = c >= 40 ? interp(sf.hotspotChance, c) : 0;
    if (p <= 0) continue;
    // Spread the cluster's single roll over its hot tiles.
    const share = (b.w * b.h) / Math.max(1, c);
    const pf = Math.max(0.05, 1 - bestProtection(f, n, b) / sf.ignitionProtection);
    if (rng.next() < p * share * pf) ignite(ctx, b.id);
  }
}

/**
 * Daily fire tick: protection (plus fire units on site) beats fires back;
 * otherwise they grow, spread to neighbours and finally burn the building down.
 */
export function stepFires(ctx: FireContext): void {
  const { s, f, cfg, rng } = ctx;
  const sf = cfg.safety;
  const n = s.size;
  const next: Fire[] = [];
  const started: number[] = [];
  // Walk a snapshot: a fire that burns its target down can set off more (a
  // plant's explosion), which land in a fresh list and start burning tomorrow.
  const current = s.fires;
  s.fires = [];
  for (const fire of current) {
    const r = targetRect(s, fire.target);
    if (!r) continue;
    // Units on site are in the fire cover already (kept current as they come and go).
    let protection = bestProtection(f, n, r);
    fire.days++;
    const handle = Math.floor(protection / sf.protectionPerStage);
    if (handle >= fire.stage) {
      fire.stage--;
      if (fire.stage > 0) next.push(fire);
      continue;
    }
    const watered = r.building ? r.building.watered : true;
    const top = maxStage(cfg, r);
    if (fire.stage < top && rng.next() < sf.fireGrowChance * (watered ? 1 : sf.flammabilityDry)) fire.stage++;
    fire.daysAtMax = fire.stage >= top ? fire.daysAtMax + 1 : 0;

    // Spread to a flammable neighbour, mostly downwind (more wind carries
    // it further): a strong wind reaches one more tile that way.
    if (rng.next() < sf.fireSpreadChance * fire.stage) {
      const reach = fire.stage >= 4 ? 2 : 1;
      const [wx, wy] = WIND_DIRS[s.wind.dir]!;
      const far = s.wind.strength > 0.5 ? 1 : 0;
      const seen = new Set<number>();
      const wood: number[] = [];
      const x0 = r.x - reach - (wx < 0 ? far : 0);
      const x1 = r.x + r.w + reach + (wx > 0 ? far : 0);
      const y0 = r.y - reach - (wy < 0 ? far : 0);
      const y1 = r.y + r.h + reach + (wy > 0 ? far : 0);
      for (let y = Math.max(0, y0); y < Math.min(n, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(n, x1); x++) {
          const occ = s.occupant[y * n + x]!;
          if (occ !== 0 && occ !== fire.target) seen.add(occ);
          else if (occ === 0 && s.trees[y * n + x]) wood.push(y * n + x);
        }
      }
      const options = [...seen];
      if (options.length) {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const weights = options.map((o) => {
          const t = targetRect(s, o)!;
          const dx = t.x + t.w / 2 - cx;
          const dy = t.y + t.h / 2 - cy;
          const d = Math.hypot(dx, dy) || 1;
          return 1 + s.wind.strength * ((dx * wx + dy * wy) / (d * Math.hypot(wx, wy)));
        });
        const pick = options[Math.max(0, rng.weighted(weights))]!;
        const flam = f.flammability[(() => {
          const t = targetRect(s, pick)!;
          return t.y * n + t.x;
        })()]!;
        if (rng.next() < flam / 100) started.push(pick);
      }
      // Fires catch on trees too.
      if (wood.length) igniteTree(ctx, wood[rng.int(wood.length)]!);
    }

    if (fire.daysAtMax >= sf.burnDaysAtMax || fire.days >= sf.maxBurnDays) {
      ctx.destroy(fire.target);
      s.fireTally.burned++;
      continue;
    }
    next.push(fire);
  }
  // Keep fires whose target still stands (an explosion may have taken it), one per target.
  const seen = new Set<number>();
  s.fires = [...next, ...s.fires].filter((fire) => {
    if (seen.has(fire.target) || !targetRect(s, fire.target)) return false;
    seen.add(fire.target);
    return true;
  });
  for (const t of started) ignite(ctx, t);
}

/** Wind directions (the way it blows), E, SE, S, SW, W, NW, N, NE. */
export const WIND_DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;

/** The wind changes every month (direction and strength). */
export function changeWind(s: CityState, rng: Rng): void {
  s.wind = { dir: Math.floor(rng.next() * 8), strength: rng.next() };
}

/** A fire's short-term Mayor Rating (and desirability) hit around it. */
export function fireEvent(cfg: SimConfig, r: Rect): CityEvent {
  const e = cfg.safety.fireEvent;
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2), radius: e.radius, amount: e.amount, months: e.months, age: 0 };
}

/** Monthly: police/fire strikes follow funding. */
export function updateSafetyStrikes(s: CityState, cfg: SimConfig, rng: Rng): void {
  const sf = cfg.safety;
  for (const st of s.structures.values()) {
    const def = cfg.structures[st.kind];
    if (!def.fire && !(def.police && def.police.radius > 0)) continue;
    if (st.strike > 0) {
      st.strike++;
      // Only funding ends it: a strike may run past 18 months, until funding is back above 90%.
      if (st.funding >= sf.strikeEndFunding) st.strike = 0;
    } else if (st.funding < 100 && rng.next() < sf.strikeChance * (1 - st.funding / 100) ** 2) st.strike = 1;
  }
}
