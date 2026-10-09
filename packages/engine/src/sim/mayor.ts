// Mayor Rating and ordinances.

import type { SimConfig } from '../config';
import { MR_SCHOOL_AGES } from '../data/mayor';
import { ORDINANCES, type OrdinanceDef, type OrdinanceId } from '../data/ordinances';
import { interp } from '../data/services';
import type { Rng } from '../rng';
import { DEV_TYPES, type DevType, type PerType } from '../types';
import { INF, type Fields } from './fields';
import { EDU_CURVES } from './services';
import { isLocalNet, structureFunding, Terrain, type CityEvent, type CityState } from './state';

export interface OrdinanceEffects {
  air: number;
  traffic: number;
  transitShare: number;
  hq: number;
  eq: number;
  crime: number;
  garbage: number;
  flammability: number;
  power: number;
  water: number;
  gasPlantOutput: number;
  plantWear: number;
  powerDealCost: number;
  mayorRating: number;
  demand: PerType;
  banNuclear: boolean;
}

/** Combined multipliers of the ordinances in effect (they stack multiplicatively). */
export function ordinanceEffects(s: { ordinances: readonly OrdinanceId[] }): OrdinanceEffects {
  const e: OrdinanceEffects = {
    air: 1, traffic: 1, transitShare: 0, hq: 1, eq: 1, crime: 1, garbage: 1, flammability: 1, power: 1, water: 1,
    gasPlantOutput: 1, plantWear: 1, powerDealCost: 1, mayorRating: 0, demand: Object.fromEntries(DEV_TYPES.map((t) => [t, 0])) as PerType, banNuclear: false,
  };
  for (const id of s.ordinances) {
    const o: OrdinanceDef = ORDINANCES[id];
    e.air *= o.air ?? 1;
    e.traffic *= o.traffic ?? 1;
    e.transitShare += o.transitShare ?? 0;
    e.hq *= o.hq ?? 1;
    e.eq *= o.eq ?? 1;
    e.crime *= o.crime ?? 1;
    e.garbage *= o.garbage ?? 1;
    e.flammability *= o.flammability ?? 1;
    e.power *= o.power ?? 1;
    e.water *= o.water ?? 1;
    e.gasPlantOutput *= o.gasPlantOutput ?? 1;
    e.plantWear *= o.plantWear ?? 1;
    e.powerDealCost *= o.powerDealCost ?? 1;
    e.mayorRating += o.mayorRating ?? 0;
    for (const [t, v] of Object.entries(o.demand ?? {})) e.demand[t as DevType] += v!;
    if (o.banNuclear) e.banNuclear = true;
  }
  return e;
}

/** Can the ordinance be enacted right now (some need a building first)? */
export function ordinanceAvailable(s: CityState, cfg: SimConfig, id: OrdinanceId): boolean {
  const req = (ORDINANCES[id] as OrdinanceDef).requires;
  if (!req) return true;
  const has = (pred: (k: string) => boolean) => [...s.structures.values()].some((st) => pred(st.kind));
  switch (req) {
    case 'park': return has((k) => cfg.structures[k as keyof typeof cfg.structures].category === 'park');
    case 'police': return has((k) => (cfg.structures[k as keyof typeof cfg.structures].police?.radius ?? 0) > 0);
    case 'clinic': return has((k) => k === 'medicalClinic');
    case 'library': return has((k) => k === 'localLibrary');
    case 'recycling': return has((k) => k === 'recyclingCenter');
    case 'landfillAndGas': return s.zone.includes(10) && has((k) => k === 'gasPlant');
    case 'transit': return has((k) => !!cfg.structures[k as keyof typeof cfg.structures].station);
  }
}

/** Monthly cost of an ordinance (by its formula); negative = income. */
export function ordinanceCost(s: CityState, cfg: SimConfig, id: OrdinanceId, residents: number): number {
  const o: OrdinanceDef = ORDINANCES[id];
  if (o.income) return -o.income;
  let cost = o.base + o.perResident * residents;
  if (o.perBudget) {
    let budget = 0;
    for (const st of s.structures.values()) {
      const def = cfg.structures[st.kind];
      const match = o.perBudget.line === 'clinics' ? st.kind === 'medicalClinic'
        : o.perBudget.line === 'libraries' ? st.kind === 'localLibrary' || st.kind === 'mainLibrary' // (all libraries' monthly funding, citywide)
        : o.perBudget.line === 'landmarks' ? def.category === 'landmark' : def.category === 'park';
      if (match) budget += def.upkeep * (structureFunding(s, def, st) / 100);
    }
    cost += o.perBudget.rate * budget;
  }
  if (o.perLandfillTile) {
    let tiles = 0;
    for (let i = 0; i < s.zone.length; i++) if (s.zone[i] === 10) tiles++;
    cost += o.perLandfillTile * tiles;
  }
  if (o.perRecyclingCenter) {
    const n = [...s.structures.values()].filter((st) => st.kind === 'recyclingCenter').length;
    cost += n ? o.perRecyclingCenter.first + o.perRecyclingCenter.more * (n - 1) : 0;
  }
  return cost;
}

export interface MayorFactors {
  crime: number;
  air: number;
  water: number;
  garbage: number;
  nimby: number;
  school: number;
  hospital: number;
  commute: number;
  noise: number;
  valueWealth: number;
  ordinances: number;
  taxes: number;
  events: number;
  /** Rewards, business deals and landmarks nearby. */
  buildings: number;
  radiation: number;
  total: number;
}

/**
 * Local Mayor Rating of a residential tile: the sum of its factors.
 * `age` and `wealth` describe the household living there.
 */
export function mayorAt(
  s: CityState, f: Fields, cfg: SimConfig, i: number, wealth: 0 | 1 | 2, age: number, taxMood: number, ord: number,
): MayorFactors {
  const m = cfg.mayor;
  const c = s.crime[i]!;
  const k = m.crime;
  const crime = c <= k.low ? k.max * (1 - c / k.low)
    : c <= k.rampant ? (k.dragAtRampant * (c - k.low)) / (k.rampant - k.low)
    : k.dragAtRampant + (k.min - k.dragAtRampant) * Math.min(1, (c - k.rampant) / (k.top - k.rampant));
  const pol = (p: number) => (p < m.pollution.zero
    ? m.pollution.max * (1 - p / m.pollution.zero)
    : m.pollution.min * Math.min(1, (p - m.pollution.zero) / (m.pollution.worst - m.pollution.zero)));
  const g = s.garbage[i]!;
  const garbage = g <= 0.05 ? m.garbage.max : m.garbage.max + (m.garbage.min - m.garbage.max) * Math.min(1, g / m.garbage.worst);
  const nimby = Math.max(0, Math.min(m.nimby.max, (m.nimby.perHundred * f.nimbyRes[i]!) / 100));
  // School: the best school covering the tile that serves the household's age (±7, by the age
  // table), the full +7 for a fully funded one; an overcrowded or striking school counts for less.
  let schooled = 0;
  for (const kk of EDU_CURVES) {
    const [from, to] = MR_SCHOOL_AGES[kk];
    if (age >= from && age <= to) schooled = Math.max(schooled, f.eduEff[kk][i]!);
  }
  const school = schooled > 0 ? m.service * (2 * Math.min(1, schooled) - 1) : -m.service;
  const hospital = f.hospitalCover[i]! > 0 ? m.service : -m.service;
  const road = f.access[i]!;
  const cost = road >= 0 && f.commute[road]! < INF ? f.commute[road]! + f.accessDist[i]! * cfg.transport.speed.street.car : INF;
  const d = cfg.desirability;
  const commute = cost >= INF ? -m.service
    : cost <= d.tripShort ? m.service
    : cost >= d.tripLong ? -m.service
    : m.service - (2 * m.service * (cost - d.tripShort)) / (d.tripLong - d.tripShort);
  const traffic = Math.max(road >= 0 ? f.traffic[road]! : 0, f.highwayNoise[i]!);
  const noise = m.service - 2 * m.service * Math.min(1, traffic / m.noiseHigh);
  const lv = f.landValue[i]! / d.waterLandValue.max;
  const tier = lv < 1 / 3 ? 0 : lv < 2 / 3 ? 1 : 2;
  const valueWealth = m.valueWealth[tier][wealth]!;
  const events = f.events[i]!;
  const parts = {
    crime, air: pol(f.air[i]!), water: pol(f.waterPollution[i]!), garbage, nimby, school, hospital, commute, noise,
    valueWealth, ordinances: ord, taxes: taxMood, events,
    buildings: f.mayorEffect[i]!,
    // −50 on every tract in a radiation zone.
    radiation: s.radiation[i] ? -50 : 0,
  };
  let total = 0;
  for (const v of Object.values(parts)) total += v;
  return { ...parts, total: Math.max(-m.limit, Math.min(m.limit, total)) };
}

/** Records this month's residential tax changes as fading mood (by the tax-change table). */
export function updateTaxMood(s: CityState, cfg: SimConfig): void {
  const types = ['R$', 'R$$', 'R$$$'] as const;
  for (const mood of s.taxMood) mood.age++;
  s.taxMood = s.taxMood.filter((m) => m.age < cfg.mayor.eventMonths);
  types.forEach((t, w) => {
    const delta = s.taxRates[t] - s.taxMonthStart[w]!;
    // Any change counts, scaled by the table (raising 0.9 a month went unnoticed).
    if (Math.abs(delta) >= 0.05) s.taxMood.push({ wealth: w as 0 | 1 | 2, amount: interp(cfg.mayor.taxChange, delta), age: 0, delta });
    s.taxMonthStart[w] = s.taxRates[t];
  });
}

/**
 * The tax mood of a wealth level: the table applied once to the recent changes taken together, each
 * fading (summed effect by effect, five +1 steps cost −25 against one +5 jump's −10, though a sudden
 * rise should be what angers residents most). Changes from older saves add their own effect.
 */
export function taxMoodFor(s: CityState, cfg: SimConfig, wealth: number): number {
  let gap = 0;
  let legacy = 0;
  for (const m of s.taxMood) {
    if (m.wealth !== wealth) continue;
    const fade = 1 - m.age / cfg.mayor.eventMonths;
    if (m.delta === undefined) legacy += m.amount * fade;
    else gap += m.delta * fade;
  }
  const v = (Math.abs(gap) >= 0.05 ? interp(cfg.mayor.taxChange, gap) : 0) + legacy;
  return Math.max(-25, Math.min(25, v));
}

/**
 * Monthly: local Mayor Rating for every residential building (all its
 * tiles get the value) and the citywide rating, averaged over tracts.
 */
export function computeMayor(s: CityState, f: Fields, cfg: SimConfig): number {
  const n = s.size;
  const ord = ordinanceEffects(s).mayorRating;
  const moods = [0, 1, 2].map((w) => taxMoodFor(s, cfg, w));
  f.mayor.fill(0);
  f.mayorSet.fill(0);
  // Global rating: the average over residential tracts, each tract
  // being the mean of the homes in it.
  const T = cfg.development.tractSize;
  const tracts = new Map<number, [number, number]>();
  for (const b of s.buildings.values()) {
    if (!b.type || b.type[0] !== 'R') continue;
    const w = cfg.demand.wealthOf[b.type];
    const i = Math.floor(b.y + b.h / 2) * n + Math.floor(b.x + b.w / 2);
    const v = mayorAt(s, f, cfg, i, w, b.age, moods[w]!, ord).total;
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        f.mayor[y * n + x] = v;
        f.mayorSet[y * n + x] = b.occupancy > 0 ? 1 : 2; // (2: an empty home, rated for the map but nobody to riot)
      }
    }
    if (b.occupancy <= 0) continue;
    const key = Math.floor((b.y + b.h / 2) / T) * n + Math.floor((b.x + b.w / 2) / T);
    const tr = tracts.get(key) ?? [0, 0];
    tr[0] += v;
    tr[1]++;
    tracts.set(key, tr);
  }
  let sum = 0;
  for (const [total, homes] of tracts.values()) sum += total / homes;
  return tracts.size ? sum / tracts.size : 0;
}

/**
 * Riots: where 3+ tiles at −50 or below sit within 4 tiles; 5 such
 * tiles give a 10% chance a month, 20 make it certain. Strong police
 * protection contains them; otherwise rioters set a building on fire.
 * Returns the ids of buildings to ignite.
 */
export function riotCheck(s: CityState, f: Fields, cfg: SimConfig, rng: Rng): number[] {
  const n = s.size;
  const r = cfg.mayor.riot;
  const low: number[] = [];
  const mask = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    if (f.mayorSet[i] === 1 && f.mayor[i]! <= r.threshold) {
      low.push(i);
      mask[i] = 1;
    }
  }
  if (low.length < r.minTiles) return [];
  // Count low tiles in each tile's (2r+1)² window with a summed-area table.
  const W = n + 1;
  const sat = new Int32Array(W * W);
  for (let y = 0; y < n; y++) {
    let row = 0;
    for (let x = 0; x < n; x++) {
      row += mask[y * n + x]!;
      sat[(y + 1) * W + x + 1] = sat[y * W + x + 1]! + row;
    }
  }
  const R = r.radius;
  const targets: number[] = [];
  const used = new Uint8Array(n * n);
  for (const i of low) {
    if (used[i]) continue;
    const x = i % n;
    const y = (i - x) / n;
    const x0 = Math.max(0, x - R), x1 = Math.min(n, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(n, y + R + 1);
    const count = sat[y1 * W + x1]! - sat[y0 * W + x1]! - sat[y1 * W + x0]! + sat[y0 * W + x0]!;
    // One roll per hotspot: mark the neighbourhood as handled.
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) used[yy * n + xx] = 1;
    if (count < r.minTiles || rng.next() >= interp(r.chance, count)) continue;
    if (s.mobs.length >= cfg.mayor.riotMob.maxMobs) break;
    // A mob gathers on the hotspot (one per neighbourhood; one already there was counted when it began).
    if (s.mobs.some((m) => Math.max(Math.abs(m.x - x), Math.abs(m.y - y)) <= R)) continue;
    s.riots++;
    s.mobs.push({ id: s.nextId++, x, y, stage: 1, energy: cfg.mayor.riotMob.energy, days: 0 });
    targets.push(i);
  }
  return targets;
}

/**
 * Is the mob on a dead-end street (cornering it is easy)? Its own tile or a street beside it (mobs gather
 * on lots) that has at most one street tile next to it.
 */
function deadEnd(s: CityState, x: number, y: number): boolean {
  const n = s.size;
  const street = (px: number, py: number) => px >= 0 && py >= 0 && px < n && py < n && isLocalNet(s.net[py * n + px]!);
  const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (const [dx, dy] of near) {
    const sx = x + dx;
    const sy = y + dy;
    if (!street(sx, sy)) continue;
    let ways = 0;
    for (const [ex, ey] of near) if ((ex || ey) && street(sx + ex, sy + ey)) ways++;
    if (ways <= 1) return true;
  }
  return false;
}

/**
 * Daily riot tick: mobs grow and climb a stage a day, setting fires at the
 * top stage; police on site (or strong cover) drain their energy until they
 * calm down. Returns buildings hit by Molotov cocktails.
 */
export function stepMobs(s: CityState, f: Fields, cfg: SimConfig, rng: Rng): number[] {
  const m = cfg.mayor.riotMob;
  const d = cfg.safety.dispatch.police;
  const n = s.size;
  const molotovs: number[] = [];
  const spawned: CityState['mobs'] = [];
  s.mobs = s.mobs.filter((mob) => {
    mob.days++;
    let hit = 0;
    let units = 0;
    for (const u of s.units) {
      if (u.kind !== 'police' || u.travel > 0 || Math.hypot(u.x - mob.x, u.y - mob.y) > d.radius + 1) continue;
      // A police unit short of funding can't turn back a strong riot.
      if (u.air) hit += m.heliHit;
      else if (u.competence >= m.competent) hit += m.policeHit;
      else continue;
      units++;
    }
    // Only dispatched units break it up, and it takes several fully funded ones (three or more, fewer for
    // a mob cornered in a dead end): fewer only wear it down, and a mob gathers strength with its stage,
    // so a serious riot takes more.
    if (units > 0 && units < m.minUnits && !deadEnd(s, mob.x, mob.y)) hit *= m.fewUnits;
    mob.energy += m.grow * mob.stage - hit;
    if (mob.energy <= 0 || mob.days > m.maxDays) return false;
    if (!hit && mob.stage < m.stages) {
      mob.stage++;
      // The neighbourhood remembers a riot that reached its frenzy (once a mob,
      // not every stage: stacked, they sank whole towns into more riots).
      if (mob.stage === m.stages) s.events.push({ x: mob.x, y: mob.y, radius: m.event.radius, amount: m.event.amount, months: cfg.mayor.eventMonths, age: 0 });
    }
    if (mob.stage >= m.stages) {
      // Critical mass: an unquelled mob spawns another nearby (which can
      // spawn one in turn, until police break them up).
      if (!hit && !mob.split && mob.energy >= m.spawnEnergy && s.mobs.length + spawned.length < m.maxMobs) {
        const a = rng.next() * 2 * Math.PI;
        const x = Math.max(0, Math.min(n - 1, Math.round(mob.x + Math.cos(a) * m.spawnDistance)));
        const y = Math.max(0, Math.min(n - 1, Math.round(mob.y + Math.sin(a) * m.spawnDistance)));
        if (s.terrain[y * n + x] !== Terrain.Water) {
          mob.split = true;
          spawned.push({ id: s.nextId++, x, y, stage: 1, energy: m.energy, days: 0 });
          s.riots++;
        }
      }
      const near: number[] = [];
      for (let y = Math.max(0, mob.y - m.fireRadius); y <= Math.min(n - 1, mob.y + m.fireRadius); y++) {
        for (let x = Math.max(0, mob.x - m.fireRadius); x <= Math.min(n - 1, mob.x + m.fireRadius); x++) {
          const occ = s.occupant[y * n + x]!;
          if (occ > 0) near.push(occ);
        }
      }
      if (near.length && rng.next() < m.molotov) molotovs.push(near[Math.floor(rng.next() * near.length)]!);
    }
    return true;
  });
  s.mobs.push(...spawned);
  return molotovs;
}

export function civicEvent(cfg: SimConfig, x: number, y: number): CityEvent {
  return { x, y, radius: cfg.mayor.civicEvent.radius, amount: cfg.mayor.civicEvent.amount, months: cfg.mayor.eventMonths, age: 0 };
}


/** City Opinion Poll topics, each read from Mayor Rating factors. */
export const POLL_TOPICS = {
  safety: ['crime'],
  environment: ['air', 'water', 'garbage', 'radiation'],
  traffic: ['commute'], // (the citywide commute only; noise is its own factor)
  health: ['hospital'],
  education: ['school'],
  taxes: ['taxes'],
  landValue: ['valueWealth'],
} as const satisfies Record<string, readonly (keyof MayorFactors)[]>;
export type PollTopic = keyof typeof POLL_TOPICS;

/**
 * City Opinion Polls: for each topic, the share of residents (weighted by
 * household size) who aren't unhappy with it (its Mayor Rating factors add up
 * to zero or more), and the average of those factors. Not precise.
 */
export function opinionPolls(s: CityState, f: Fields, cfg: SimConfig): Record<PollTopic, { approve: number; score: number }> {
  const n = s.size;
  const ord = ordinanceEffects(s).mayorRating;
  const moods = [0, 1, 2].map((w) => taxMoodFor(s, cfg, w));
  const topics = Object.keys(POLL_TOPICS) as PollTopic[];
  const yes = Object.fromEntries(topics.map((t) => [t, 0])) as Record<PollTopic, number>;
  const score = Object.fromEntries(topics.map((t) => [t, 0])) as Record<PollTopic, number>;
  let weight = 0;
  for (const b of s.buildings.values()) {
    if (!b.type || b.type[0] !== 'R' || b.occupancy <= 0) continue;
    const w = cfg.demand.wealthOf[b.type];
    const i = Math.floor(b.y + b.h / 2) * n + Math.floor(b.x + b.w / 2);
    const m = mayorAt(s, f, cfg, i, w, b.age, moods[w]!, ord);
    const r = b.capacity * b.occupancy;
    weight += r;
    // Safety covers fire protection as well as police: out of every fire station's reach counts against it.
    const unprotected = f.fireCover[i]! > 0 ? 0 : -cfg.mayor.service;
    for (const t of topics) {
      const v = (POLL_TOPICS[t] as readonly (keyof MayorFactors)[]).reduce((a, k) => a + m[k], 0) + (t === 'safety' ? unprotected : 0);
      if (v >= 0) yes[t] += r;
      score[t] += v * r;
    }
  }
  return Object.fromEntries(topics.map((t) => [t, {
    approve: weight > 0 ? yes[t] / weight : 0, score: weight > 0 ? score[t] / weight : 0,
  }])) as Record<PollTopic, { approve: number; score: number }>;
}
