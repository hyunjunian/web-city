// RCI demand (with Rush Hour's changes).

import { drain } from './steps';
import type { SimConfig } from '../config';
import { interp } from '../data/services';
import { frontage } from './fields';
import { ordinanceEffects } from './mayor';
import {
  BUSINESS_TYPES, DEV_TYPES, RES_TYPES, WEALTHS,
  perType, type BusinessType, type DevType, type PerType, type PerWealth,
} from '../types';
import { cargoCapacity, structureFunding, type CityState } from './state';
import type { ConnectionKind } from '../data/demand';
import type { RegionalDemand } from './region';

export interface Census {
  /** Residents (R types) or jobs offered (business types). */
  population: PerType;
  /** Jobs actually filled per business type. */
  filled: PerType;
  residents: PerWealth;
  workers: PerWealth;
  /** Workers by wealth and EQ level (EQ1–EQ4). */
  workersByEq: [PerEq, PerEq, PerEq];
  /** Share of residents who work (varies with HQ). */
  workforceFraction: number;
  /** Jobs at civic buildings (schools, hospitals, plants) by worker wealth. */
  civicJobs: PerWealth;
  avgEq: PerWealth;
  avgHq: PerWealth;
  /** Jobs offered by wealth of the worker they need. */
  jobsByWealth: PerWealth;
  unemployed: PerWealth;
  /** Buildings per type and stage (index stage-1), excluding abandoned. */
  stageCounts: PerType<number[]>;
  abandoned: number;
  /** Abandoned buildings each type may move into (its own built type, or one it may downgrade into). */
  abandonedFor: PerType<number>;
  buildings: number;
}

export interface DemandReport {
  /** Final demand per type on the −1000…1000 scale. */
  demand: PerType;
  /** Raw shortage (positive) or surplus (negative) in Sims or jobs. */
  raw: PerType;
  cap: PerType;
  capPopulation: PerType;
  /** Tax effect applied, as a fraction of demand. */
  taxEffect: PerType;
  neutralTax: number;
  /** Raw demand at which the ±1000 scale is half way (it grows with the city). */
  halfSaturation?: number;
}

type PerEq = [number, number, number, number];

export function takeCensus(s: CityState, cfg: SimConfig): Census {
  return drain(takeCensusSteps(s, cfg));
}

/** `takeCensus` in steps (see ./steps). */
export function* takeCensusSteps(s: CityState, cfg: SimConfig): Generator<void, Census> {
  const population = perType(() => 0);
  const filled = perType(() => 0);
  const stageCounts = perType<number[]>(() => []);
  let abandoned = 0;
  const abandonedFor = perType(() => 0);
  const eqSum: PerWealth = [0, 0, 0];
  const hqSum: PerWealth = [0, 0, 0];
  const workers: PerWealth = [0, 0, 0];
  const byEq: [PerEq, PerEq, PerEq] = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  yield;
  let piece1 = 0;
  for (const b of s.buildings.values()) {
    if ((++piece1 & 0x1ff) === 0) yield;
    if (!b.type) {
      abandoned++;
      abandonedFor[b.origType]++;
      // (A historical building waits for its own kind: no other may move in.)
      if (!b.historical) for (const t of cfg.development.downgrade[b.origType] ?? []) abandonedFor[t]++;
      continue;
    }
    const r = b.capacity * b.occupancy;
    population[b.type] += r;
    filled[b.type] += b.filled;
    const counts = stageCounts[b.type];
    counts[b.stage - 1] = (counts[b.stage - 1] ?? 0) + 1;
    if (b.type[0] !== 'R') continue;
    const w = cfg.demand.wealthOf[b.type];
    eqSum[w] += b.eq * r;
    hqSum[w] += b.hq * r;
    const working = r * interp(cfg.services.workforceByHq, b.hq);
    workers[w] += working;
    byEq[w][eqLevelOf(cfg, b.eq)] += working;
  }
  const residents: PerWealth = [population['R$'], population['R$$'], population['R$$$']];
  const avgEq = WEALTHS.map((w) => (residents[w] > 0 ? eqSum[w] / residents[w] : cfg.services.baseQuotient[w])) as PerWealth;
  const avgHq = WEALTHS.map((w) => (residents[w] > 0 ? hqSum[w] / residents[w] : cfg.services.baseQuotient[w])) as PerWealth;
  const total = residents[0] + residents[1] + residents[2];
  // Match the household-level health participation used by actual commuters.
  const wf = total > 0 ? (workers[0] + workers[1] + workers[2]) / total
    : interp(cfg.services.workforceByHq, cfg.services.baseQuotient[0]);
  const workersByEq = byEq;

  const jobsByWealth: PerWealth = [0, 0, 0];
  yield;
  for (const t of BUSINESS_TYPES) {
    const profile = cfg.demand.workforceProfile[t];
    for (const w of WEALTHS) jobsByWealth[w] += population[t] * profile[w];
  }
  // Civic jobs count only when the building is on the road network.
  const civicJobs: PerWealth = [0, 0, 0];
  yield;
  let piece3 = 0;
  for (const st of s.structures.values()) {
    if ((++piece3 & 0x1ff) === 0) yield;
    const jobs = cfg.structures[st.kind].jobs;
    if (jobs[0] + jobs[1] + jobs[2] === 0 || !frontage(s, st).length) continue;
    for (const w of WEALTHS) civicJobs[w] += jobs[w];
  }
  yield;
  for (const w of WEALTHS) jobsByWealth[w] += civicJobs[w];
  const unemployed = WEALTHS.map((w) => Math.max(0, workers[w] - jobsByWealth[w])) as PerWealth;
  return {
    population, filled, residents, workers, workersByEq, workforceFraction: wf, civicJobs, avgEq, avgHq,
    jobsByWealth, unemployed, stageCounts, abandoned, abandonedFor, buildings: s.buildings.size,
  };
}

/**
 * Matches workers to jobs by wealth: each wealth slice of a business can
 * only be filled by residents of that wealth. Updates `filled` on buildings.
 */
export function allocateJobs(s: CityState, cfg: SimConfig, census: Census): void {
  const fill = WEALTHS.map((w) =>
    census.jobsByWealth[w] > 0 ? Math.min(1, census.workers[w] / census.jobsByWealth[w]) : 1,
  ) as PerWealth;
  for (const b of s.buildings.values()) {
    if (!b.type || b.type[0] === 'R') {
      b.filled = 0;
      continue;
    }
    const profile = cfg.demand.workforceProfile[b.type as BusinessType];
    let share = 0;
    for (const w of WEALTHS) share += profile[w] * fill[w];
    b.filled = b.capacity * b.occupancy * share;
  }
}

export function neutralTaxRate(cfg: SimConfig, residents: number): number {
  for (const [maxPop, rate] of cfg.demand.neutralTax) if (residents < maxPop) return rate;
  return cfg.demand.neutralTax[cfg.demand.neutralTax.length - 1]![1];
}

/** Highest rate in force for a type during the tax memory window. */
export function peakTaxRate(s: CityState, cfg: SimConfig, t: DevType): number {
  let peak = s.taxRates[t];
  const since = s.day - cfg.demand.taxMemoryDays;
  for (const [day, type, rate] of s.taxLog) if (type === t && day >= since && rate > peak) peak = rate;
  return peak;
}

/**
 * Tax impact as a fraction of existing demand: up to +35% well below the
 * neutral rate, down to −350% well above it, log-interpolated on the ratio.
 */
export function taxImpact(cfg: SimConfig, ratio: number): number {
  const { lowRatio, maxBoost, highRatio, maxPenalty } = cfg.demand.taxImpact;
  if (ratio <= 0) return maxBoost;
  if (ratio < 1) return maxBoost * Math.min(1, Math.log(ratio) / Math.log(lowRatio));
  if (ratio > 1) return maxPenalty * Math.min(1, Math.log(ratio) / Math.log(highRatio));
  return 0;
}

export function eqLevelOf(cfg: SimConfig, eq: number): 0 | 1 | 2 | 3 {
  const th = cfg.demand.eqThresholds;
  let lvl = 0;
  for (const v of th) if (eq >= v) lvl++;
  return lvl as 0 | 1 | 2 | 3;
}

/** Neighbour connections on each map edge (W, E, N, S) by kind; a plain array means roads. */
export type ConnectionCounts = readonly number[] | Partial<Record<ConnectionKind, readonly number[]>>;

/** Cap relief from parks, neighbour connections and freight. */
export function capRelief(s: CityState, cfg: SimConfig, connectionsPerEdge: ConnectionCounts): PerType {
  const relief = perType(() => 0);
  for (const st of s.structures.values()) {
    const def = cfg.structures[st.kind];
    // Underfunded parks and rewards give proportionally less relief (at 60%
    // funding, 60% of the effect).
    const share = Math.min(1, structureFunding(s, def, st) / 100);
    for (const w of WEALTHS) relief[RES_TYPES[w]] += def.relief[w] * share;
    if (def.officeRelief) {
      relief['Co$$'] += def.officeRelief[0] * share;
      relief['Co$$$'] += def.officeRelief[1] * share;
    }
    for (const [t, v] of Object.entries(def.industryRelief ?? {})) relief[t as DevType] += v * share;
    // Airports: offices they can reach, up to their capacity; industry gets 10% of that.
    if (def.airport) {
      const r = Math.min(st.load, cargoCapacity(def, st.funding)!);
      relief['Co$$'] += r;
      relief['Co$$$'] += r;
      for (const t of ['IA', 'ID', 'IM', 'IHT'] as const) relief[t] += 0.1 * r;
    }
    // Seaports: 20 per freight trip that arrived, up to 650; offices get
    // 10% of that, the commercial sea traffic it implies.
    if (def.seaport) {
      // Funding scales its capacity like an airport's (overfunding increases it).
      const r = Math.min(def.seaport.relief * Math.min(1.2, st.funding / 100), def.seaport.perTrip * st.load);
      for (const t of ['IA', 'ID', 'IM', 'IHT'] as const) relief[t] += r;
      relief['Co$$'] += 0.1 * r;
      relief['Co$$$'] += 0.1 * r;
    }
  }
  // Commercial Office: the first connection of a kind to a neighbour gives the
  // full amount, repeats follow base × log2(n + 1) (a fit to the game's figures).
  let office = 0;
  const byKind = Array.isArray(connectionsPerEdge) ? { road: connectionsPerEdge } : connectionsPerEdge as Partial<Record<ConnectionKind, readonly number[]>>;
  for (const [kind, edges] of Object.entries(byKind) as [ConnectionKind, readonly number[]][]) {
    for (const n of edges) office += cfg.demand.connectionRelief[kind] * Math.log2(n + 1);
  }
  relief['Co$$'] += office;
  relief['Co$$$'] += office;
  const freight = s.freightTrips * cfg.demand.freightTripRelief;
  for (const t of ['IA', 'ID', 'IM', 'IHT'] as const) relief[t] += freight;
  return relief;
}

export function computeDemand(
  s: CityState, cfg: SimConfig, census: Census, connectionsPerEdge: ConnectionCounts, regional?: RegionalDemand,
): DemandReport {
  const dc = cfg.demand;
  const workforce = WEALTHS.map(w => census.residents[w] > 0 ? census.workers[w] / census.residents[w]
    : interp(cfg.services.workforceByHq, census.avgHq[w])) as PerWealth;
  const pop = census.population;
  const raw = perType(() => 0);

  // The regional pool: growth neighbours took up for this city stands there
  // as Sims (who want jobs) and jobs (that want Sims), as if built here.
  const jobsByWealth = [...census.jobsByWealth] as PerWealth;
  const residents = [...census.residents] as PerWealth;
  const workersByEq = census.workersByEq.map((row) => [...row]) as typeof census.workersByEq;
  const pooled = regional?.pooled;
  if (pooled) {
    for (const w of WEALTHS) {
      const extra = pooled[RES_TYPES[w]];
      if (extra <= 0) continue;
      residents[w] += extra;
      // Their workers by education like this city's of the same wealth (all EQ1 if it has none).
      const row = census.workersByEq[w];
      const total = row.reduce((a, b) => a + b, 0);
      for (let lvl = 0; lvl < 4; lvl++) workersByEq[w][lvl]! += extra * workforce[w] * (total > 0 ? row[lvl]! / total : lvl === 0 ? 1 : 0);
    }
    for (const t of BUSINESS_TYPES) for (const w of WEALTHS) jobsByWealth[w] += pooled[t] * dc.workforceProfile[t][w]!;
  }

  // Residential: jobs (local + SimNation) want ~2 residents each.
  for (const w of WEALTHS) {
    raw[RES_TYPES[w]] = workforce[w] > 0 ? (jobsByWealth[w] + dc.baseJobs[w]) / workforce[w] - residents[w] : -residents[w];
  }

  // Business: workers demand jobs by wealth and education level. Agriculture
  // is a parallel channel (its column shares sit outside the 100%).
  for (const t of BUSINESS_TYPES) {
    let want = dc.baseBusiness[t];
    for (const w of WEALTHS) {
      for (let lvl = 0; lvl < 4; lvl++) want += workersByEq[w][lvl]! * (dc.businessProfile[t][w][lvl] ?? 0);
    }
    raw[t] = want - pop[t] - (pooled?.[t] ?? 0);
  }
  // The Casino's customers want shops (Commercial Service demand).
  for (const st of s.structures.values()) {
    const sd = cfg.structures[st.kind].serviceDemand;
    if (!sd) continue;
    raw['Cs$'] += sd[0];
    raw['Cs$$'] += sd[1];
    raw['Cs$$$'] += sd[2];
  }
  // Growth pushed in by developed neighbours (regional demand).
  if (regional) for (const t of DEV_TYPES) raw[t] += regional.extra[t];

  const totalResidents = census.residents[0] + census.residents[1] + census.residents[2];
  const half = dc.halfSaturation.base + dc.halfSaturation.perCapita * totalResidents;
  const neutral = neutralTaxRate(cfg, totalResidents);
  const boost = cfg.difficulty[s.difficulty].demandBoost;

  const relief = capRelief(s, cfg, connectionsPerEdge);
  const ord = ordinanceEffects(s);
  const nonFarmJobs = BUSINESS_TYPES.reduce((sum, t) => (t === 'IA' ? sum : sum + pop[t]), 0);

  const demand = perType(() => 0);
  const cap = perType(() => Infinity);
  const capPopulation = perType(() => 0);
  const taxEffect = perType(() => 0);
  for (const t of DEV_TYPES) {
    let d = (1000 * raw[t]) / (Math.abs(raw[t]) + half);

    // Taxes: the penalty side remembers the highest rate of the last 90 days.
    const peak = peakTaxRate(s, cfg, t);
    const ratio = peak > neutral ? peak / neutral : s.taxRates[t] / neutral;
    const impact = taxImpact(cfg, ratio);
    taxEffect[t] = impact;
    d += Math.abs(d) * impact;

    // Ordinances nudge some demand by a percentage (Tourism only when positive).
    const od = ord.demand[t];
    if (od) d = d >= 0 ? d * (1 + od) : od < 0 ? d * (1 - od) : d;

    // Demand cap: the ceiling falls linearly as population nears the cap.
    capPopulation[t] = t === 'IA' ? nonFarmJobs : pop[t];
    cap[t] = dc.initialCaps[t] + relief[t];
    if (Number.isFinite(cap[t])) d = Math.min(d, Math.max(0, 1000 * (1 - capPopulation[t] / cap[t])));
    // Difficulty boost props demand up, or negative demand toward zero: on all demand as it is shown
    // (it scales every demand before display), the capped ceiling too.
    d = d >= 0 ? d * (1 + boost) : d * (1 - boost);

    demand[t] = Math.max(-1000, Math.min(1000, d));
  }
  return { demand, raw, cap, capPopulation, taxEffect, neutralTax: neutral, halfSaturation: half };
}
