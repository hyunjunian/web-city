// Rewards, business deals and landmarks: unlock and
// offer conditions, radiation and missile misfires.

import type { SimConfig } from '../config';
import type { DealOffer, StructureKind, Unlock } from '../data/structures';
import type { Rng } from '../rng';
import { DEV_TYPES, type DevType } from '../types';
import type { Census } from './demand';
import type { CityState } from './state';
import { linkedNeighbours } from './region';
import { LOW_POLLUTION } from '../data/rewards';
import { Terrain } from './state';

export interface UnlockContext {
  s: CityState;
  cfg: SimConfig;
  census: Census;
  powerDemand: number;
  /** City water use, m³ a month. */
  waterDemand?: number;
  /** Hospitals (clinics and medical centers) in the city. */
  hospitals: number;
  connections: number;
  /** Average air pollution at the city's homes, per resident. */
  meanAir?: number;
}

function counts(s: CityState): Map<string, number> {
  const out = new Map<string, number>();
  for (const st of s.structures.values()) out.set(st.kind, (out.get(st.kind) ?? 0) + 1);
  return out;
}

/** One condition of an unlock: what it is, where the city stands and what it needs. */
export interface UnlockCheck {
  /** The Unlock field (or regional.<field>, or `${field}.${kind}` for per-kind counts). */
  key: string;
  have: number;
  need: number;
  /** For "below" conditions (private schools' school grade) `have` must stay under `need`. */
  below?: boolean;
  met: boolean;
}

const atLeast = (key: string, have: number, need: number): UnlockCheck => ({ key, have, need, met: have >= need });
const lowPollution = (ctx: UnlockContext): UnlockCheck => {
  const have = ctx.meanAir ?? 0;
  return { key: 'lowPollution', have, need: LOW_POLLUTION, met: have < LOW_POLLUTION, below: true };
};

/** Regional conditions: the other cities' saved totals plus this city now. */
function regionalChecks(ctx: UnlockContext, r: NonNullable<Unlock['regional']>): UnlockCheck[] {
  const { s, census: c } = ctx;
  const reg = s.region!;
  let own = 0;
  for (const t of DEV_TYPES) own += c.population[t];
  const ownHigh = c.population['R$$'] + c.population['R$$$'];
  // Connected: developed neighbours this city actually reaches by road, highway, rail or subway.
  const connected = linkedNeighbours(s).length;
  const out: UnlockCheck[] = [];
  if (r.population !== undefined) out.push(atLeast('regional.population', reg.population + own, r.population));
  if (r.highWealth !== undefined) out.push(atLeast('regional.highWealth', reg.highWealth + ownHigh, r.highWealth));
  if (r.cities !== undefined) out.push(atLeast('regional.cities', reg.cities + 1, r.cities));
  if (r.connected !== undefined) out.push(atLeast('regional.connected', connected, r.connected));
  if (r.linkedCities !== undefined) out.push(atLeast('regional.linkedCities', (reg.linkedCities ?? 0) + (connected > 0 ? 1 : 0), r.linkedCities));
  if (r.mayorRating !== undefined) out.push(atLeast('regional.mayorRating', s.mayorRating, r.mayorRating));
  if (r.lowPollution) out.push(lowPollution(ctx));
  return out;
}

/** A building's grade, 0–100 (its effectiveness after load and strikes). */
const grade = (st: { effectiveness: number }) => st.effectiveness * 100;

function goodCount(ctx: UnlockContext, kind: string): number {
  let n = 0;
  for (const st of ctx.s.structures.values()) if (st.kind === kind && grade(st) > 85) n++;
  return n;
}

/** City school grade: the average grade of elementary and high schools (0 with none). */
export function citySchoolGrade(ctx: Pick<UnlockContext, 's' | 'cfg'>): number {
  let sum = 0;
  let count = 0;
  for (const st of ctx.s.structures.values()) {
    const curve = ctx.cfg.structures[st.kind].school?.curve;
    if (curve !== 'elementary' && curve !== 'highSchool') continue;
    sum += grade(st);
    count++;
  }
  return count ? sum / count : 0;
}

/** Health and education: at least one hospital and one school or college, every health and education building funded at 100% or more. */
function wellFunded(ctx: UnlockContext): boolean {
  let health = 0;
  let school = 0;
  for (const st of ctx.s.structures.values()) {
    const def = ctx.cfg.structures[st.kind];
    if (!def.health && !def.school) continue;
    if (st.funding < 100) return false;
    if (def.health) health++;
    else if (!['library', 'mainLibrary', 'museum', 'artMuseum', 'opera'].includes(def.school!.curve)) school++;
  }
  return health > 0 && school > 0;
}

/** Is an unlock condition met right now? */
export function unlockMet(ctx: UnlockContext, u: Unlock, built = counts(ctx.s)): boolean {
  if (u.orElse && !(u.regional && ctx.s.region) && unlockChecks(ctx, { description: u.description, ...u.orElse }, built).every((c) => c.met)) return true;
  return unlockChecks(ctx, u, built).every((c) => c.met);
}

/** Each condition of an unlock with the city's current standing (the `orElse` alternative not included). */
export function unlockChecks(ctx: UnlockContext, u: Unlock, built = counts(ctx.s)): UnlockCheck[] {
  const { s, cfg, census: c } = ctx;
  if (u.regional && s.region) return regionalChecks(ctx, u.regional);
  const residents = c.residents[0] + c.residents[1] + c.residents[2];
  let jobs = 0;
  for (const t of DEV_TYPES) if (t[0] !== 'R') jobs += c.population[t];
  const out: UnlockCheck[] = [];
  const has = (k: string) => built.get(k) ?? 0;
  if (u.population !== undefined) out.push(atLeast('population', residents + jobs, u.population));
  if (u.residents !== undefined) out.push(atLeast('residents', residents, u.residents));
  if (u.lowPollution) out.push(lowPollution(ctx));
  if (u.powerDemand !== undefined) out.push(atLeast('powerDemand', ctx.powerDemand, u.powerDemand));
  if (u.waterDemand !== undefined) out.push(atLeast('waterDemand', ctx.waterDemand ?? 0, u.waterDemand));
  if (u.healthBuildings !== undefined) out.push(atLeast('healthBuildings', ctx.hospitals, u.healthBuildings));
  if (u.mayorRating !== undefined) out.push(atLeast('mayorRating', s.mayorRating, u.mayorRating));
  for (const [t, v] of Object.entries(u.typePopulation ?? {})) out.push(atLeast(`typePopulation.${t}`, c.population[t as DevType], v!));
  for (const k of u.requires ?? []) out.push(atLeast(`requires.${k}`, Math.min(1, has(k)), 1));
  if (u.parks !== undefined) {
    let parks = 0;
    for (const st of s.structures.values()) if (cfg.structures[st.kind].category === 'park') parks++;
    out.push(atLeast('parks', parks, u.parks));
  }
  for (const [k, v] of Object.entries(u.buildings ?? {})) out.push(atLeast(`buildings.${k}`, has(k), v));
  for (const [k, v] of Object.entries(u.goodBuildings ?? {})) out.push(atLeast(`goodBuildings.${k}`, goodCount(ctx, k), v));
  for (const [k, v] of Object.entries(u.workingBuildings ?? {})) {
    let working = 0;
    for (const st of s.structures.values()) if (st.kind === k && st.load > 0) working++;
    out.push(atLeast(`workingBuildings.${k}`, working, v));
  }
  if (u.schoolGrade !== undefined) {
    const v = citySchoolGrade(ctx);
    if (u.schoolGrade.min !== undefined) out.push(atLeast('schoolGrade', v, u.schoolGrade.min));
    if (u.schoolGrade.below !== undefined) out.push({ key: 'schoolGrade', have: v, need: u.schoolGrade.below, below: true, met: v < u.schoolGrade.below });
  }
  if (u.wellFunded) out.push(atLeast('wellFunded', +wellFunded(ctx), 1));
  if (u.anyOf !== undefined) out.push(atLeast('anyOf', Math.min(1, u.anyOf.reduce((a, k) => a + has(k), 0)), 1));
  if (u.combined !== undefined) out.push(atLeast('combined', u.combined.types.reduce((a, t) => a + c.population[t as DevType], 0), u.combined.population));
  if (u.connections !== undefined) out.push(atLeast('connections', ctx.connections, u.connections));
  if (u.waterShare !== undefined) {
    let water = 0;
    for (let i = 0; i < s.terrain.length; i++) if (s.terrain[i] === Terrain.Water) water++;
    out.push(atLeast('waterShare', water / s.terrain.length, u.waterShare));
  }
  if (u.busyStation !== undefined) {
    const b = u.busyStation;
    let best = 0;
    for (const st of s.structures.values()) {
      const cap = cfg.structures[st.kind].station?.capacity ?? 0;
      if (st.kind === b.kind && cap > 0) best = Math.max(best, st.load / cap);
    }
    out.push(atLeast('busyStation', best, b.share));
  }
  if (u.difficulty !== undefined) out.push(atLeast('difficulty', +u.difficulty.includes(s.difficulty), 1));
  return out;
}

/** Does the city look like it needs this deal (prolonged money trouble)? */
export function offerMet(ctx: UnlockContext, o: DealOffer): boolean {
  const { s, census: c } = ctx;
  let people = c.residents[0] + c.residents[1] + c.residents[2];
  for (const t of DEV_TYPES) if (t[0] !== 'R') people += c.population[t];
  if (o.fundsBelow !== undefined && !(s.funds < o.fundsBelow)) return false;
  if (o.population !== undefined && people < o.population) return false;
  if (o.deficit && !(s.lastBudget && s.lastBudget.expenses > s.lastBudget.income)) return false;
  if (o.ordinance && !s.ordinances.includes(o.ordinance as CityState['ordinances'][number])) return false;
  if (o.difficulty && s.difficulty !== o.difficulty) return false;
  if (o.drop) {
    const then = s.history[s.history.length - o.drop.months];
    if (!then) return false;
    const fell = then.funds - s.funds;
    if (o.drop.fraction !== undefined && !(then.funds > 0 && fell >= o.drop.fraction * then.funds)) return false;
    if (o.drop.amount !== undefined && !(fell >= o.drop.amount)) return false;
  }
  return true;
}

/** Earns rewards, tiers and deal offers whose conditions are met (they stay earned). */
export function checkUnlocks(ctx: UnlockContext): StructureKind[] {
  const { s, cfg } = ctx;
  const built = counts(s);
  const earned: StructureKind[] = [];
  for (const [kind, def] of Object.entries(cfg.structures) as [StructureKind, SimConfig['structures'][StructureKind]][]) {
    const have = s.unlocked.filter((k) => k === kind).length;
    let ok = false;
    if ('unlockTiers' in def && def.unlockTiers) {
      const next = def.unlockTiers[have];
      ok = !!next && unlockMet(ctx, next, built);
    } else if (have === 0) {
      if ('offer' in def && def.offer) ok = offerMet(ctx, def.offer);
      else if (def.unlock) ok = unlockMet(ctx, def.unlock, built);
    }
    if (ok) {
      s.unlocked.push(kind);
      earned.push(kind);
    }
  }
  return earned;
}

/** Radiation fades a month at a time; active sources keep their zone hot. */
export function updateRadiation(s: CityState, cfg: SimConfig): void {
  const n = s.size;
  // 255 marks a meltdown: it never clears in a playable span (10,000 years).
  for (let i = 0; i < s.radiation.length; i++) if (s.radiation[i] && s.radiation[i]! < 255) s.radiation[i]!--;
  for (const st of s.structures.values()) {
    const r = cfg.structures[st.kind].radiation;
    if (!r) continue;
    // The radius from the lot's edge (a circle from the middle of Area 5.1's 20×9 lot reached 12 tiles past its long sides, not 7).
    const rad = r.radius;
    for (let y = Math.max(0, Math.floor(st.y - rad)); y <= Math.min(n - 1, Math.ceil(st.y + st.h + rad)); y++) {
      for (let x = Math.max(0, Math.floor(st.x - rad)); x <= Math.min(n - 1, Math.ceil(st.x + st.w + rad)); x++) {
        if (lotDistance(st, x, y) > rad) continue;
        const i = y * n + x;
        if (s.radiation[i]! < 255) s.radiation[i] = Math.max(s.radiation[i]!, r.months);
      }
    }
  }
}

/** Missile launches that misfire scatter debris: buildings to set on fire. */
export function missileMisfires(s: CityState, cfg: SimConfig, rng: Rng): number[] {
  const out: number[] = [];
  for (const st of s.structures.values()) {
    const m = cfg.structures[st.kind].missile;
    // Its income comes without power, but it launches only once powered (and then
    // fires a missile every so often).
    if (!m || !st.powered || rng.next() >= m.misfire) continue;
    const cx = st.x + st.w / 2;
    const cy = st.y + st.h / 2;
    const near = [...s.buildings.values()].filter((b) => Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy) <= m.radius);
    const fires = m.fires[0] + Math.floor(rng.next() * (m.fires[1] - m.fires[0] + 1));
    for (let k = 0; k < fires && near.length; k++) out.push(near.splice(Math.floor(rng.next() * near.length), 1)[0]!.id);
  }
  return out;
}

/** From a tile's middle to the nearest point of a lot, in tiles (0 on it). */
export function lotDistance(r: { x: number; y: number; w: number; h: number }, x: number, y: number): number {
  const dx = Math.max(r.x - (x + 0.5), 0, x + 0.5 - (r.x + r.w));
  const dy = Math.max(r.y - (y + 0.5), 0, y + 0.5 - (r.y + r.h));
  return Math.hypot(dx, dy);
}
