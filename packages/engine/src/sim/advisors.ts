// Advisors: seven department heads who flag problems (red),
// news (grey) and successes (green). Messages are codes with a value so a
// client can word them in any language. Only the City Planner is impartial;
// the others speak for their departments.

import type { SimConfig } from '../config';
import { DEV_TYPES, type DevType } from '../types';
import type { DemandReport } from './demand';
import { frontage, type Fields } from './fields';
import { isLocalNet, trafficKind, type CityState, type GarbageStats } from './state';
import { LANDFILL_ZONE } from './garbage';
import { healthClassOf } from './services';
import { LOW_POLLUTION } from '../data/rewards';
import { drain } from './steps';

export type AdvisorId = 'planner' | 'finance' | 'utilities' | 'safety' | 'healthEducation' | 'transportation' | 'environment';

export interface Advice {
  advisor: AdvisorId;
  level: 'good' | 'neutral' | 'bad';
  code: string;
  /** A number the message refers to (fires burning, months left, share congested …). */
  value?: number;
  /** A tile showing the problem (a fire, a dry building …), when there is one place to look. */
  at?: [number, number];
  /** The developer type the message is about (a demand cap), when it is one. */
  type?: DevType;
}

/** What advisors look at (the city's stats this month). */
export interface AdvisorStats {
  population: number;
  funds: number;
  mayorRating: number;
  power: { supply: number; demand: number; blackedOut?: number };
  water: { supply: number; demand: number; shortages: number; sourceless?: number; pumpsOff?: number; pumpsOffAt?: { x: number; y: number }; sourcelessAt?: { x: number; y: number } };
  garbage: GarbageStats;
  safety: { crimes: number; arrests: number; burning: number };
  /** Workers and those with no job (census, all wealth levels). */
  workers?: number;
  unemployed?: number;
  /** Businesses distressed for want of workers who can't move in. */
  understaffed?: readonly { x: number; y: number }[];
}

const ZONE_CLASS: Record<number, 'R' | 'C' | 'I' | 'A'> = { 1: 'R', 2: 'R', 3: 'R', 4: 'C', 5: 'C', 6: 'C', 7: 'I', 8: 'I', 9: 'A' };
const DEMAND_OF: Record<'R' | 'C' | 'I' | 'A', DevType[]> = {
  R: ['R$', 'R$$', 'R$$$'], C: ['Cs$', 'Cs$$', 'Cs$$$', 'Co$$', 'Co$$$'], I: ['ID', 'IM', 'IHT'], A: ['IA'],
};

export function advise(s: CityState, cfg: SimConfig, f: Fields, st: AdvisorStats, demand: DemandReport): Advice[] {
  return drain(adviseSteps(s, cfg, f, st, demand));
}

/** {@link advise} in pieces: it pauses between departments and part-way through each pass over the map. */
export function* adviseSteps(s: CityState, cfg: SimConfig, f: Fields, st: AdvisorStats, demand: DemandReport): Generator<void, Advice[]> {
  const out: Advice[] = [];
  const say = (advisor: AdvisorId, level: Advice['level'], code: string, value?: number, at?: { x: number; y: number }) =>
    out.push({ advisor, level, code, value, ...(at ? { at: [at.x, at.y] as [number, number] } : {}) });
  const has = (test: (k: string) => boolean) => [...s.structures.values()].some((x) => test(x.kind));
  const def = (k: string) => cfg.structures[k as keyof typeof cfg.structures];

  // Utilities: power, water, garbage.
  const zoned = s.zone.some((z) => z !== 0);
  if (zoned && st.power.supply === 0) say('utilities', 'bad', 'noPower');
  // (Short where rolling blackouts actually fall: total demand counts grids no plant reaches too.)
  else if ((st.power.blackedOut ?? 0) > 0) say('utilities', 'bad', 'powerShort');
  else if (st.power.supply > 0 && st.power.demand < st.power.supply * 0.5 && st.population > 2000) say('utilities', 'neutral', 'powerSurplus');
  // A plant on a grid of its own powers nobody.
  // (Load alone can't tell: a neighbour deal may cover a connected plant's grid.)
  const used = new Set<number>();
  for (const b of s.buildings.values()) used.add(f.powerGrid[b.y * s.size + b.x]!);
  // (A pump, school or station on the grid uses its power too.)
  for (const x of s.structures.values()) if (!def(x.kind).plant && (def(x.kind).powerUse ?? 0) > 0) used.add(f.powerGrid[x.y * s.size + x.x]!);
  // Buildings on lines no plant reaches, while the city has power elsewhere: a gap in the lines.
  if (st.power.supply > 0) {
    let off = 0;
    let first: { x: number; y: number } | undefined;
    for (const b of s.buildings.values()) {
      if (!b.type || f.powered[b.y * s.size + b.x]) continue;
      off++;
      first ??= b;
    }
    if (off) say('utilities', 'bad', 'powerCutOff', off, first);
  }
  const idlePlants = [...s.structures.values()].filter((x) => def(x.kind).plant && x.capacity > 0 && !used.has(f.powerGrid[x.y * s.size + x.x]!));
  if (idlePlants.length && st.power.demand > 0) say('utilities', 'neutral', 'idlePlant', idlePlants.length, idlePlants[0]);
  // Plants explode at the end of their lives; warn while there's time to replace them.
  const old = [...s.structures.values()].filter((x) => def(x.kind).plant && x.life >= 85).sort((a, b) => b.life - a.life);
  if (old.length) {
    const p = old[0]!;
    // Months left at the plant's nominal aging rate (funding and load change it).
    const months = Math.max(0, Math.round((100 - p.life) / (100 / (def(p.kind).plant!.lifeYears * 12))));
    say('utilities', 'bad', 'plantOld', months, p);
  }
  // Pumps wear out and stop at 110% of their lives: one past 95% wants replacing.
  const worn = [...s.structures.values()].filter((x) => def(x.kind).pump && x.life >= 95).sort((a, b) => b.life - a.life);
  if (worn.length) say('utilities', 'bad', 'pumpOld', worn.length, worn[0]);
  // A pump left off the pipe network pumps for nobody.
  const idlePumps = [...s.structures.values()].filter((x) => def(x.kind).pump && x.capacity > 0 && x.load === 0);
  if (idlePumps.length && st.water.demand > 0) say('utilities', 'neutral', 'idlePump', idlePumps.length, idlePumps[0]);
  // Pipes no pump feeds are short however much the pumps elsewhere make: join them up.
  const sourceless = st.water.sourceless ?? 0;
  if (sourceless > 0) say('utilities', 'bad', 'pipesNoSource', sourceless, st.water.sourcelessAt);
  // A network whose pumps all stand idle: no power, polluted water, or no funding.
  const pumpsOff = st.water.pumpsOff ?? 0;
  if (pumpsOff > 0) say('utilities', 'bad', 'pumpsOff', pumpsOff, st.water.pumpsOffAt);
  // (Idle-pump buildings are among the shortages only while the city has water somewhere.)
  if (st.water.shortages > sourceless + (st.water.supply > 0 ? pumpsOff : 0)) say('utilities', 'bad', 'waterShort');
  else if (!sourceless && !pumpsOff) {
    const dry = [...s.buildings.values()].find((b) => b.type && !b.watered && b.stage > cfg.services.waterStageCap[b.type]);
    if (dry) say('utilities', 'bad', 'dryBuildings', undefined, dry);
  }
  if (st.population > 3000 && st.water.supply === 0 && !(st.water.pumpsOff ?? 0)) say('utilities', 'bad', 'noWater');
  const g = st.garbage;
  // Facilities with no road beside them: trucks can't take their garbage (and fire
  // engines can't leave, buses can't stop). That, not disposal, is then the trouble.
  const offRoad = [...s.structures.values()].filter((x) => def(x.kind).garbage > 0 && !frontage(s, x).length);
  // Bad when crews are stuck (police, fire, health, schools); otherwise only garbage piles there.
  const serious = offRoad.filter((x) => { const d = def(x.kind); return !!(d.police || d.fire || d.health || d.school); });
  if (offRoad.length) say('utilities', serious.length ? 'bad' : 'neutral', 'facilityNoRoad', offRoad.length, serious[0] ?? offRoad[0]);
  // Garbage piling for want of disposal (not merely off the road).
  // (Value 1: there is a landfill, and it is full — not one missing.)
  if (g.uncollected - (g.stranded ?? 0) > 1) {
    say('utilities', 'bad', 'garbagePiling', g.landfillSpace <= 0 && s.zone.includes(LANDFILL_ZONE) ? 1 : undefined);
    // Room left only where no road reaches: join it up (tons it could take).
    if ((g.landfillCutOff ?? 0) > 0) say('utilities', 'bad', 'landfillNoRoad', Math.round(g.landfillCutOff!));
  } else if (g.landfillSpace > 0) {
    const months = g.landfillSpace / Math.max(1, g.landfilled);
    if (months < 6) say('utilities', 'bad', 'landfillFull', Math.floor(months));
    // A heads-up while there is still time to zone more or build an incinerator.
    else if (months < 18) say('utilities', 'neutral', 'landfillSoon', Math.floor(months));
  }
  // Worn lines and distressed pipes: left as they are, they end in a mini-disaster.
  const distressed = cfg.disasters.wear.distressed;
  if (s.departments.power < 100 && s.lineWear.some((w) => w >= distressed)) say('utilities', 'bad', 'linesWorn');
  // (Pipes wear only below the funding that keeps them repaired.)
  if (s.departments.water < cfg.disasters.wear.pipeRepairAbove && s.pipeWear.some((w) => w >= distressed)) say('utilities', 'bad', 'pipesWorn');

  yield;
  // Public safety.
  if (st.safety.burning) {
    const t = s.fires[0]?.target ?? 0;
    const tree = s.treeFires[0]?.i;
    const woods = tree !== undefined ? { x: tree % s.size, y: Math.floor(tree / s.size) } : undefined;
    say('safety', 'bad', 'fires', st.safety.burning, t > 0 ? s.buildings.get(t) : t < 0 ? s.structures.get(-t) : woods);
  }
  if (s.mobs.length) say('safety', 'bad', 'riot', s.mobs.length, s.mobs[0]);
  // (With a station that reaches nobody, it's its reach, not a missing station.)
  if (st.population > 3000 && st.safety.crimes > 3 && st.safety.arrests === 0) {
    say('safety', 'bad', has((k) => (def(k).police?.radius ?? 0) > 0) ? 'policeReach' : 'noPolice');
  }
  // Cells full: arrested criminals go free and strike again next month (build a jail).
  if ((s.safety.paroled ?? 0) > 5) say('safety', 'bad', 'cellsFull', s.safety.paroled);
  if (st.population > 3000 && !has((k) => !!def(k).fire)) say('safety', 'bad', 'noFire');
  // Strikers outside a station: underfunded, and only restored funding ends it.
  const strike = [...s.structures.values()].find((x) => x.strike > 0 && (def(x.kind).fire || (def(x.kind).police?.radius ?? 0) > 0));
  if (strike) say('safety', 'bad', def(strike.kind).fire ? 'fireStrike' : 'policeStrike', undefined, strike);
  // A plant that burns down explodes; keep plants inside a fire station's reach.
  if (s.buildings.size) {
    const n = s.size;
    const exposed = [...s.structures.values()].filter((x) => {
      if (!def(x.kind).plant) return false;
      for (let y = x.y; y < x.y + x.h; y++) for (let xx = x.x; xx < x.x + x.w; xx++) if (f.fireCover[y * n + xx]! > 0) return false;
      return true;
    });
    if (exposed.length) say('safety', 'bad', 'plantUnprotected', exposed.length, exposed[0]);
  }

  yield;
  // Health and education.
  // (A Farmer's Market lifts health but is no care: only a clinic, hospital or the lab counts.)
  if (st.population > 2000 && !has((k) => ['hospital', 'research'].includes(healthClassOf(def(k)) ?? ''))) say('healthEducation', 'bad', 'noHospital');
  if (st.population > 2000 && !has((k) => !!def(k).school)) say('healthEducation', 'bad', 'noSchool');
  const care = [...s.structures.values()].filter((x) => def(x.kind).health || def(x.kind).school);
  const striking = care.find((x) => x.strike > 0);
  if (striking) say('healthEducation', 'bad', def(striking.kind).school ? 'schoolStrike' : 'hospitalStrike', undefined, striking);
  else {
    // Past capacity the grade falls and a strike may follow (its chance grows with the overload); above
    // 125% one lasts (it ends when the grade is back to 0.8): the worst one, as a percentage.
    let worst: (typeof care)[number] | null = null;
    for (const x of care) if (x.capacity > 0 && x.load * cfg.services.strikeEndGrade > x.capacity && (!worst || x.load / x.capacity > worst.load / worst.capacity)) worst = x;
    if (worst) say('healthEducation', 'neutral', def(worst.kind).school ? 'schoolFull' : 'hospitalFull', Math.round((worst.load / worst.capacity) * 100), worst);
  }

  // EQ and HQ barely above where households start (this advisor watches both): a note to
  // widen schools' and hospitals' reach and budgets. Residents weighted; from a town of some size.
  // Only while there is something to do about it: homes out of reach, a facility overloaded or underfunded,
  // or (EQ) no higher education yet, (HQ) dirty air at home. With all that done the gain is what the city's
  // schools and hospitals give; the note stood for 330 months of a 336-month game.
  let people = 0;
  let eqGain = 0;
  let hqGain = 0;
  let noSchool = 0;
  let noCare = 0;
  let dirty = 0;
  for (const b of s.buildings.values()) {
    if (b.type?.[0] !== 'R' || b.occupancy <= 0) continue;
    const r = b.capacity * b.occupancy;
    const base = cfg.services.baseQuotient[cfg.demand.wealthOf[b.type]]!;
    const i = b.y * s.size + b.x;
    people += r;
    eqGain += (b.eq - base) * r;
    hqGain += (b.hq - base) * r;
    if (!f.eduEff.elementary[i] && !f.eduEff.highSchool[i]) noSchool += r;
    if (!f.hospitalCover[i]) noCare += r;
    if (f.air[i]! > LOW_POLLUTION) dirty += r;
  }
  const strained = (test: (d: ReturnType<typeof def>) => boolean) => [...s.structures.values()].some((x) =>
    test(def(x.kind)) && (x.load > x.capacity || x.funding < 100));
  if (st.population > 5000 && people > 0) {
    const higher = has((k) => ['college', 'university', 'mainLibrary', 'artMuseum', 'opera'].includes(def(k).school?.curve ?? ''));
    const eqToDo = noSchool > 0.1 * people || strained((d) => !!d.school) || !higher;
    const hqToDo = noCare > 0.1 * people || strained((d) => !!d.health) || dirty > 0.1 * people;
    if (eqGain / people < 10 && eqToDo && has((k) => !!def(k).school)) say('healthEducation', 'neutral', 'eqLow', Math.round(eqGain / people));
    if (hqGain / people < 10 && hqToDo && has((k) => !!def(k).health)) say('healthEducation', 'neutral', 'hqLow', Math.round(hqGain / people));
  }

  yield;
  // Transportation: congestion on local roads and Sims with no way to work.
  let roads = 0;
  let jammed = 0;
  for (let i = 0; i < s.net.length; i++) {
    if ((i & 0x3fff) === 0x3fff) yield;
    if (!isLocalNet(s.net[i]!)) continue;
    roads++;
    if (f.traffic[i]! > cfg.transport.speed[trafficKind(s, i)!].capacity) jammed++;
  }
  if (roads > 50 && jammed / roads > 0.1) say('transportation', 'bad', 'congestion', Math.round((jammed / roads) * 100));
  let stranded = 0;
  let firstStranded: { x: number; y: number } | undefined;
  for (const b of s.buildings.values()) {
    if (b.type?.[0] !== 'R' || b.noJobMonths <= 0) continue;
    stranded++;
    firstStranded ??= b;
  }
  if (stranded > 0) say('transportation', 'bad', 'noCommute', stranded, firstStranded);
  if (s.departments.roads < 100 && s.potholes.some((p) => p > 0)) say('transportation', 'bad', 'potholes');
  // A station over its capacity: riders wait longer, and some go back to their cars.
  const full = [...s.structures.values()].filter((x) => def(x.kind).station && def(x.kind).station!.mode !== 'freight' && x.load > def(x.kind).station!.capacity)
    .sort((a, b) => b.load / def(b.kind).station!.capacity - a.load / def(a.kind).station!.capacity)[0];
  if (full) say('transportation', 'neutral', 'stationFull', Math.round((full.load / def(full.kind).station!.capacity) * 100), full);

  yield;
  // Environment.
  let air = 0;
  let homes = 0;
  for (const b of s.buildings.values()) {
    if (b.type?.[0] !== 'R') continue;
    homes++;
    air += f.air[b.y * s.size + b.x]!;
  }
  if (homes > 20 && air / homes > 100) say('environment', 'bad', 'smog');
  if (s.radiation.some((r) => r > 0)) say('environment', 'bad', 'radiation');
  if (st.population > 5000 && !has((k) => def(k).category === 'park')) say('environment', 'neutral', 'noParks');

  yield;
  // Finance.
  const b = s.lastBudget;
  if (st.funds < 0) say('finance', 'bad', 'broke');
  else if (b && b.expenses > b.income) say('finance', 'bad', 'deficit', Math.round(b.expenses - b.income));
  else if (b && b.income > b.expenses && st.population > 1000) say('finance', 'good', 'surplus', Math.round(b.income - b.expenses));

  // Taxes above neutral eating demand Sims would bring (the bars alone don't say why they stay low):
  // the type cut most, by how much (%). Not where a cap holds it anyway.
  let taxed: DevType | null = null;
  for (const t of DEV_TYPES) {
    if (demand.raw[t] <= 0 || demand.taxEffect[t] > -0.3) continue;
    if (Number.isFinite(demand.cap[t]) && demand.capPopulation[t] >= 0.95 * demand.cap[t]) continue;
    if (!taxed || demand.taxEffect[t] < demand.taxEffect[taxed]) taxed = t;
  }
  if (taxed && st.population > 0) {
    say('finance', demand.demand[taxed] <= 0 ? 'bad' : 'neutral', 'taxHigh', Math.round(-demand.taxEffect[taxed] * 100));
    out[out.length - 1]!.type = taxed;
  }

  yield;
  // City Planner: zoning for demand, and the Mayor's standing.
  const free = { R: 0, C: 0, I: 0, A: 0 };
  for (let i = 0; i < s.zone.length; i++) {
    if ((i & 0x3fff) === 0x3fff) yield;
    const c = ZONE_CLASS[s.zone[i]!];
    if (c && s.occupant[i] === 0 && s.net[i] === 0) free[c]++;
  }
  for (const c of ['R', 'C', 'I', 'A'] as const) {
    const want = Math.max(...DEMAND_OF[c].map((t) => demand.demand[t]));
    // (Once anyone lives here: a town of 150 whose homes had filled their zones, wanting 800 more, heard nothing.)
    if (want > 300 && free[c] < 16 && st.population > 0) say('planner', 'neutral', `zone${c}`);
  }
  // Demand held at its cap: Sims want to come but the city's ceiling stops
  // them, and the bar alone (sitting at 0) doesn't say why.
  const capped = (types: readonly DevType[]) => types.find((t) =>
    demand.raw[t] > 0 && Number.isFinite(demand.cap[t]) && demand.capPopulation[t] >= 0.95 * demand.cap[t]);
  const capGroups = [['capRes', ['R$', 'R$$', 'R$$$']], ['capOffice', ['Co$$', 'Co$$$']], ['capIndustry', ['ID', 'IM', 'IHT']]] as const;
  for (const [code, types] of capGroups) {
    const t = capped(types);
    // Held right down (no demand left at all), it is what stops the city: a problem, not a note.
    if (!t) continue;
    say('planner', demand.demand[t] <= 0 ? 'bad' : 'neutral', code, Math.round(demand.cap[t]));
    out[out.length - 1]!.type = t;
  }

  yield;
  // Abandoned buildings (more than a few, or over 5%): the planner points at one. A problem past 5% (or
  // 50); a dozen among a big city's thousand buildings is a note (it stopped the clock as a problem).
  const empty = [...s.buildings.values()].filter((b) => !b.type);
  const many = empty.length >= 50 || (empty.length >= 3 && empty.length > s.buildings.size * 0.05);
  if (many || empty.length >= 10) say('planner', many ? 'bad' : 'neutral', 'abandoned', empty.length, empty[0]);
  // Disaster rubble on zoned land stays until it is bulldozed: nothing grows there.
  let rubble = 0;
  let firstRubble = -1;
  for (let i = 0; i < s.rubble.length; i++) {
    if ((i & 0x3fff) === 0x3fff) yield;
    if (!s.rubble[i] || !s.zone[i]) continue;
    rubble++;
    if (firstRubble < 0) firstRubble = i;
  }
  if (rubble >= 4) say('planner', 'bad', 'rubble', rubble, { x: firstRubble % s.size, y: Math.floor(firstRubble / s.size) });
  yield;
  // Buildings half-way to abandonment on any countdown (each has its own limit): warn before they go.
  const limit = { power: cfg.services.noPowerMonths, water: cfg.services.noWaterMonths, road: cfg.development.noRoadMonths, job: cfg.transport.noJobMonths };
  const risky = [...s.buildings.values()].filter((b) => b.type && Math.max(
    b.noPowerMonths / limit.power, b.noWaterMonths / limit.water, b.noRoadMonths / limit.road, b.noJobMonths / limit.job) >= 0.5);
  if (risky.length >= 3) say('planner', 'bad', 'atRisk', risky.length, risky[0]);
  // Zones laid out two months ago and still nothing built: something blocks every lot.
  if (s.buildings.size === 0 && s.day - (s.zonedSince ?? 0) >= 60) {
    const first = s.zone.findIndex((z, i) => !!ZONE_CLASS[z] && !s.net[i] && !s.occupant[i]);
    if (first >= 0) say('planner', 'bad', 'noGrowth', undefined, { x: first % s.size, y: Math.floor(first / s.size) });
  }
  // More than a tenth of the workforce without a job: they need C/I zones (or a way to reach them).
  if (st.understaffed?.length) say('planner', 'bad', 'understaffed', st.understaffed.length, st.understaffed[0]);
  if ((st.workers ?? 0) > 500 && (st.unemployed ?? 0) / st.workers! > 0.1) say('planner', 'bad', 'unemployment', Math.round((st.unemployed! / st.workers!) * 100));
  if (st.population > 1000 && st.mayorRating < 0) say('planner', 'bad', 'mayorLow', st.mayorRating);
  else if (st.population > 1000 && st.mayorRating >= 50) say('planner', 'good', 'mayorHigh', st.mayorRating);
  return out;
}
