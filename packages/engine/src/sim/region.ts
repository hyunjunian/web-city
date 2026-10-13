// Neighbours and the region. Each map edge has one synthetic
// neighbour: SimNation (trip completion and the first connection of each
// kind only), an established city (named but never played: full office cap
// relief, commute at a punitive presumed time) or a developed one, which also
// trades power, water and garbage disposal (Neighbor Deals) and pushes its
// growth into the region.

import type { SimConfig } from '../config';
import type { ConnectionKind } from '../data/demand';
import type { NeighbourKind } from '../data/region';
import { interp } from '../data/services';
import { DEV_TYPES, perType, type PerType } from '../types';
import { isRail, Net, type CityState, type DealResource, type Neighbour, type NeighbourDeal } from './state';
import { ordinanceEffects } from './mayor';

export const EDGE_NAMES = ['West', 'East', 'North', 'South'] as const;

export function defaultNeighbours(): Neighbour[] {
  return ([0, 1, 2, 3] as const).map((edge) => ({
    edge, name: `${EDGE_NAMES[edge]} City`, kind: 'established' as NeighbourKind,
    population: perType(() => 0), capacity: { power: 0, water: 0, garbage: 0 }, usage: { power: 0, water: 0, garbage: 0 },
    funds: 0, growth: perType(() => 0),
  }));
}

/** Turns an edge's neighbour into SimNation, an established city or a developed one of a given size. */
export function makeNeighbour(cfg: SimConfig, edge: 0 | 1 | 2 | 3, kind: NeighbourKind, scale = 1, name?: string): Neighbour {
  const nb = defaultNeighbours()[edge]!;
  nb.kind = kind;
  if (name) nb.name = name;
  if (kind !== 'developed') return nb;
  const r = cfg.region;
  for (const t of DEV_TYPES) {
    nb.population[t] = Math.round(r.developedTemplate[t] * scale);
    nb.growth[t] = nb.population[t] * r.growth.share;
    nb.usage.power += nb.population[t] * cfg.services.powerPerCapita[t];
    nb.usage.water += nb.population[t] * cfg.services.waterPerCapita[t];
    nb.usage.garbage += nb.population[t] * cfg.garbage.perCapita[t];
  }
  const [cp, cw, cg] = r.developedUtilities.capacity[edge]!;
  nb.capacity = { power: nb.usage.power * cp, water: nb.usage.water * cw, garbage: nb.usage.garbage * cg };
  nb.funds = r.developedUtilities.funds * scale;
  return nb;
}

/** What a played city looks like to its neighbours when it is not open. */
export interface CitySnapshot {
  name: string;
  population: PerType;
  capacity: Record<DealResource, number>;
  usage: Record<DealResource, number>;
  /** What its standing Neighbor Deals buy and sell a month (older snapshots: none). */
  committed?: Record<DealResource, { bought: number; sold: number }>;
  funds: number;
  /** Per resource and edge (W, E, N, S): does a line, pipe or road reach it? (Older snapshots: unknown.) */
  edges?: Record<DealResource, [boolean, boolean, boolean, boolean]>;
  /** Per resource and edge: where along it (y on W/E, x on N/S) a line, pipe or road reaches it. */
  reach?: Record<DealResource, [number[], number[], number[], number[]]>;
  /** Raw demand left unmet when saved (pooled into connected cities' demand). */
  demand?: PerType;
  /** Residents' average commute, centi-hours (remembered for trips into this city). */
  commute?: number;
  /** Growth other cities exported here since it was last played (set by the region, not the city). */
  pending?: PerType;
}

/** Several played cities along one edge, seen as one neighbour: their totals. */
export function mergeSnapshots(list: readonly CitySnapshot[]): CitySnapshot {
  const out: CitySnapshot = {
    name: list.map((c) => c.name).join(', '), population: perType(() => 0),
    capacity: { power: 0, water: 0, garbage: 0 }, usage: { power: 0, water: 0, garbage: 0 }, funds: 0,
  };
  for (const c of list) {
    for (const t of DEV_TYPES) out.population[t] += c.population[t];
    for (const r of ['power', 'water', 'garbage'] as const) {
      out.capacity[r] += c.capacity[r];
      out.usage[r] += c.usage[r];
    }
    out.funds += c.funds;
    if (c.committed) {
      out.committed ??= { power: { bought: 0, sold: 0 }, water: { bought: 0, sold: 0 }, garbage: { bought: 0, sold: 0 } };
      for (const r of ['power', 'water', 'garbage'] as const) {
        out.committed[r].bought += c.committed[r].bought;
        out.committed[r].sold += c.committed[r].sold;
      }
    }
  }
  const sum = (k: 'demand' | 'pending') => {
    if (!list.some((c) => c[k])) return;
    const total = perType(() => 0);
    for (const c of list) for (const t of DEV_TYPES) total[t] += c[k]?.[t] ?? 0;
    out[k] = total;
  };
  sum('demand');
  sum('pending');
  // The commute into them: their residents' average, weighted by residents.
  const residents = (c: CitySnapshot) => c.population['R$'] + c.population['R$$'] + c.population['R$$$'];
  const timed = list.filter((c) => c.commute !== undefined && residents(c) > 0);
  if (timed.length) out.commute = timed.reduce((a, c) => a + c.commute! * residents(c), 0) / timed.reduce((a, c) => a + residents(c), 0);
  // A connection from any of them counts; any snapshot that doesn't say leaves it unknown.
  if (list.every((c) => c.edges)) {
    for (const c of list) {
      out.edges ??= { power: [false, false, false, false], water: [false, false, false, false], garbage: [false, false, false, false] };
      for (const r of ['power', 'water', 'garbage'] as const) for (let e = 0; e < 4; e++) out.edges[r][e] ||= c.edges![r][e]!;
    }
  }
  return out;
}

/** A neighbour made from a real city in the region (its last saved state). */
export function neighbourFromSnapshot(cfg: SimConfig, edge: 0 | 1 | 2 | 3, snap: CitySnapshot, shared?: Neighbour['shared']): Neighbour {
  const nb = defaultNeighbours()[edge]!;
  nb.kind = 'developed';
  nb.name = snap.name;
  nb.population = { ...snap.population };
  nb.capacity = { ...snap.capacity };
  nb.usage = { ...snap.usage };
  if (snap.committed) {
    const c = snap.committed;
    nb.committed = { power: { ...c.power }, water: { ...c.water }, garbage: { ...c.garbage } };
  }
  nb.funds = snap.funds;
  // Whether it reaches the shared border with a line, pipe or road (its edge facing ours).
  if (snap.edges) {
    const facing = (edge ^ 1) as 0 | 1 | 2 | 3;
    nb.connected = { power: snap.edges.power[facing]!, water: snap.edges.water[facing]!, garbage: snap.edges.garbage[facing]! };
  }
  if (shared) nb.shared = shared.map(([a, b, theirs]) => (theirs ? [a, b, { ...theirs }] : [a, b]));
  if (snap.demand) nb.demand = { ...snap.demand };
  // A played city whose save had no commutes yet (nobody living or no jobs linked) is presumed punitively
  // far: it isn't the synthetic developed neighbour's 80.
  nb.commute = snap.commute ?? cfg.region.commute.established;
  // Growth already tossed to it (by any city) fills its spare zone capacity.
  if (snap.pending) nb.absorbed = { ...snap.pending };
  // Growth extrapolated for it while unplayed: 10% of its population.
  for (const t of DEV_TYPES) nb.growth[t] = snap.population[t] * cfg.region.growth.share;
  return nb;
}

export type EdgeKind = ConnectionKind | 'power' | 'pipe';

/** Which edge a border tile is on (W, E, N, S); corners count for W/E. */
function edgeOf(n: number, i: number): 0 | 1 | 2 | 3 {
  const x = i % n;
  const y = (i - x) / n;
  return x === 0 ? 0 : x === n - 1 ? 1 : y === 0 ? 2 : 3;
}

/** Kind of neighbour connection a tile is, if any (streets and onramps can't connect). */
function tileKinds(s: CityState, i: number): EdgeKind[] {
  const out: EdgeKind[] = [];
  const code = s.net[i]!;
  if (code === Net.Road || code === Net.Avenue || code === Net.RailCrossing) out.push('road');
  if (code === Net.Highway || s.elevated[i] === 3) out.push('highway');
  if (isRail(code) || s.elevated[i] === 2) out.push('rail');
  if (s.subway[i] || s.elevated[i] === 1) out.push('subway');
  if (s.power[i]) out.push('power');
  if (s.pipe[i]) out.push('pipe');
  return out;
}

/**
 * Connections per edge and kind, counting a run of adjacent border tiles of
 * the same kind as one (a road laid along the edge is one connection). A
 * lone border tile counts only where it goes on inward (off the border) in
 * the same kind: not a stub on its own, nor the corner of a road along the
 * next edge (which would count twice).
 */
export function edgeConnections(s: CityState): Record<EdgeKind, [number, number, number, number]> {
  const n = s.size;
  const out = {
    road: [0, 0, 0, 0], highway: [0, 0, 0, 0], rail: [0, 0, 0, 0], subway: [0, 0, 0, 0], power: [0, 0, 0, 0], pipe: [0, 0, 0, 0],
  } as Record<EdgeKind, [number, number, number, number]>;
  const lines: number[][] = [
    Array.from({ length: n }, (_, y) => y * n), Array.from({ length: n }, (_, y) => y * n + n - 1),
    Array.from({ length: n - 2 }, (_, x) => x + 1), Array.from({ length: n - 2 }, (_, x) => (n - 1) * n + x + 1),
  ];
  // One tile in from each edge (west, east, north, south).
  const inward = [1, -1, n, -n];
  const border = (j: number) => {
    const x = j % n;
    const y = (j - x) / n;
    return x === 0 || y === 0 || x === n - 1 || y === n - 1;
  };
  lines.forEach((line, e) => {
    // Each kind's run under way: its length, and whether it went inward.
    const runs = new Map<EdgeKind, { len: number; inward: boolean }>();
    const end = (k: EdgeKind) => {
      const r = runs.get(k)!;
      if (r.len >= 2 || r.inward) out[k][e]!++;
      runs.delete(k);
    };
    for (const i of line) {
      const kinds = tileKinds(s, i);
      for (const k of [...runs.keys()]) if (!kinds.includes(k)) end(k);
      const j = i + inward[e]!;
      const inside = n > 2 && !border(j) ? tileKinds(s, j) : [];
      for (const k of kinds) {
        const r = runs.get(k) ?? { len: 0, inward: false };
        r.len++;
        r.inward ||= inside.includes(k);
        runs.set(k, r);
      }
    }
    for (const k of [...runs.keys()]) end(k);
  });
  return out;
}

/**
 * Connection counts for office cap relief: per real neighbour and kind; all
 * SimNation edges together act as one neighbour giving only the first
 * connection of each kind.
 */
export function reliefConnections(s: CityState, runs = edgeConnections(s)): Partial<Record<ConnectionKind, number[]>> {
  const out: Partial<Record<ConnectionKind, number[]>> = {};
  for (const k of ['road', 'highway', 'rail', 'subway'] as const) {
    const list: number[] = [];
    let sim = false;
    for (const nb of s.neighbours) {
      const c = runs[k][nb.edge]!;
      if (nb.kind === 'simnation') sim ||= c > 0;
      else list.push(c);
    }
    if (sim) list.push(1);
    out[k] = list;
  }
  return out;
}

/** Extra commute time to jobs beyond each edge (null: no jobs there). */
export function neighbourCommute(s: CityState, cfg: SimConfig): (number | null)[] {
  return [0, 1, 2, 3].map((e) => {
    const nb = s.neighbours[e];
    if (!nb || nb.kind === 'simnation') return cfg.region.simNationJobs ? cfg.transport.connectionCommute : null;
    // A played neighbour's own average commute, kept from when it was last
    // played, is added to trips that leave this city for it.
    if (nb.kind === 'developed') return nb.commute ?? cfg.region.commute.developed;
    return cfg.region.commute.established;
  });
}

/**
 * Jobs a neighbour has open for this city's commuters, per edge: a developed
 * city offers what its own workers leave unfilled (its open jobs are
 * known once it has been played); an established city or SimNation is
 * taken to have work for all.
 */
export function neighbourOpenJobs(s: CityState, cfg: SimConfig): number[] {
  return [0, 1, 2, 3].map((e) => {
    const nb = s.neighbours[e];
    if (!nb || nb.kind !== 'developed') return Infinity;
    let jobs = 0;
    let residents = 0;
    for (const t of DEV_TYPES) {
      if (t[0] === 'R') residents += nb.population[t];
      else if (t !== 'IA') jobs += nb.population[t];
    }
    return Math.max(0, jobs - residents * interp(cfg.services.workforceByHq, cfg.services.baseQuotient[1]));
  });
}

/**
 * The map edges whose neighbour takes commuters now: one with a commute (a SimNation link only when
 * its jobs are on) and, a developed city, with a job or so open. A neighbour with every job taken
 * offers none (counted as work, homes moved in, found nothing, and were abandoned in a loop).
 */
export function neighbourWorkEdges(s: CityState, cfg: SimConfig): boolean[] {
  const open = neighbourOpenJobs(s, cfg);
  return neighbourCommute(s, cfg).map((t, e) => t !== null && open[e]! >= 0.5);
}

export { edgeOf };

/** First tile on an edge passing `test` (−1 if none). */
export function edgeTile(s: CityState, edge: number, test: (i: number) => boolean, resource?: DealResource): number {
  for (const i of edgeTiles(s, edge, test, resource)) return i;
  return -1;
}

/** Matching border tiles, limited to the actual shared and resource-connected parts of the neighbour. */
export function* edgeTiles(s: CityState, edge: number, test: (i: number) => boolean, resource?: DealResource): Generator<number> {
  const n = s.size;
  if (edge !== 0 && edge !== 1 && edge !== 2 && edge !== 3) return;
  const neighbour = s.neighbours[edge];
  if (resource && neighbour?.connected?.[resource] === false) return;
  const shared = resource ? neighbour?.shared : undefined;
  for (let k = 0; k < n; k++) {
    // A played neighbour may touch only part of this edge. Feed the deal
    // through a connection in that part, rather than an earlier isolated stub.
    if (shared && !shared.some(([from, to, theirs]) => k >= from && k < to && theirs?.[resource!] !== false)) continue;
    const i = edge === 0 ? k * n : edge === 1 ? k * n + n - 1 : edge === 2 ? k : (n - 1) * n + k;
    if (test(i)) yield i;
  }
}

/** Active deals of a resource with the tile where each meets our network. */
export function activeDeals(s: CityState, resource: DealResource): NeighbourDeal[] {
  return s.neighbourDeals.filter((d) => d.resource === resource && d.status !== 'grace');
}

// ----------------------------------------------------------------- deals

/** The city's own capacity, use and average cost per unit of a resource. */
export interface Utility {
  capacity: number;
  usage: number;
  cost: number;
}

/** What a deal would look like right now, or why it can't be made. */
export interface DealOffer {
  edge: 0 | 1 | 2 | 3;
  resource: DealResource;
  direction: 'buy' | 'sell';
  ok: boolean;
  reason?: string;
  maxAmount: number;
  /** Price per unit at the maximum amount. */
  price: number;
}

const CONNECTION_FOR: Record<DealResource, EdgeKind[]> = { power: ['power'], water: ['pipe'], garbage: ['road', 'highway'] };

/**
 * Does a line, pipe or road for this resource reach the edge? Facing a played
 * neighbour, only where the two cities share the border counts (`whole`: anywhere).
 */
export function hasDealConnection(s: CityState, edge: number, resource: DealResource, whole = false): boolean {
  const shared = whole ? undefined : s.neighbours[edge]?.shared;
  if (shared) {
    const mine = edgeReach(s, resource, edge);
    return shared.some(([a, b, theirs]) => theirs?.[resource] !== false && mine.some((p) => p >= a && p < b));
  }
  const runs = edgeConnections(s);
  return CONNECTION_FOR[resource].some((k) => runs[k][edge]! > 0);
}

/** Where along an edge (y on W/E, x on N/S; corners count for W/E) a connection for the resource reaches it. */
export function edgeReach(s: CityState, resource: DealResource, edge: number): number[] {
  const n = s.size;
  const out: number[] = [];
  const kinds = CONNECTION_FOR[resource];
  const from = edge < 2 ? 0 : 1;
  const to = edge < 2 ? n : n - 1;
  for (let p = from; p < to; p++) {
    const i = edge === 0 ? p * n : edge === 1 ? p * n + n - 1 : edge === 2 ? p : (n - 1) * n + p;
    if (tileKinds(s, i).some((k) => kinds.includes(k))) out.push(p);
  }
  return out;
}

export function dealPrice(cfg: SimConfig, sellerCost: number, buyerCost: number, amount: number, buyerUsage: number, seller: Utility): number {
  const p = cfg.region.dealPrice;
  const need = Math.min(1.2, amount / Math.max(1, buyerUsage));
  const slack = Math.max(0, seller.capacity - seller.usage - amount) / Math.max(1, seller.capacity);
  const price = sellerCost * (p.floor + p.need * need + p.scarcity * (1 - slack));
  return Math.max(price, p.minOverCost * Math.max(sellerCost, buyerCost));
}

/** What the city's standing deals buy and sell of a resource a month (deals in grace left out, as dealFlows). */
export function dealTotals(s: Pick<CityState, 'neighbourDeals'>, resource: DealResource): { bought: number; sold: number } {
  let bought = 0;
  let sold = 0;
  for (const d of s.neighbourDeals) {
    if (d.resource !== resource || d.status === 'grace') continue;
    if (d.direction === 'buy') bought += d.amount;
    else sold += d.amount;
  }
  return { bought, sold };
}

/** Deals already agreed for a resource, as net imports (buy +, sell −). */
export function dealFlows(s: CityState, resource: DealResource): number {
  let net = 0;
  for (const d of s.neighbourDeals) {
    if (d.resource !== resource || d.status === 'grace') continue;
    net += d.direction === 'buy' ? d.amount : -d.amount;
  }
  return net;
}

/** What a deal pays or earns a month: Power Conservation Act cuts power bought from neighbours 10%. */
export function dealMonthly(s: CityState, d: Pick<NeighbourDeal, 'amount' | 'price' | 'direction' | 'resource'>): number {
  return d.amount * d.price * (d.direction === 'buy' && d.resource === 'power' ? ordinanceEffects(s).powerDealCost : 1);
}

/**
 * Can this deal be struck, and for how much at most? Priced
 * for the maximum, or for `amount` when given (the unit price depends on it).
 */
export function evaluateDeal(
  s: CityState, cfg: SimConfig, own: Utility, edge: 0 | 1 | 2 | 3, resource: DealResource, direction: 'buy' | 'sell', amount?: number,
): DealOffer {
  const D = cfg.region.deals;
  const nb = s.neighbours[edge]!;
  const base = { edge, resource, direction, maxAmount: 0, price: 0 };
  const no = (reason: string): DealOffer => ({ ...base, ok: false, reason });
  if (nb.kind !== 'developed') return no('neighbour has no utilities to trade');
  if (nb.dealsBlocked) return no('several cities share this border');
  if (nb.connected && !nb.connected[resource]) return no(resource === 'power' ? 'the neighbour has no power line to the border' : resource === 'water' ? 'the neighbour has no water pipe to the border' : 'the neighbour has no road to the border');
  // Our line reaches the edge, but not where the city across has one.
  if (!hasDealConnection(s, edge, resource) && hasDealConnection(s, edge, resource, true) && s.neighbours[edge]?.shared) {
    return no('our connection does not meet the neighbour\'s');
  }
  if (!hasDealConnection(s, edge, resource)) return no(resource === 'power' ? 'needs a power line to the edge' : resource === 'water' ? 'needs a water pipe to the edge' : 'needs a road or highway to the edge');
  if (s.neighbourDeals.some((d) => d.edge === edge && d.resource === resource)) return no('already a deal with this neighbour');
  // (What it already sells to, or buys from, other cities: the same surplus isn't offered twice.)
  const committed = nb.committed?.[resource];
  const theirs: Utility = {
    capacity: nb.capacity[resource] + (committed?.bought ?? 0), usage: nb.usage[resource] + (committed?.sold ?? 0), cost: cfg.region.neighbourCost[resource],
  };
  const flows = dealFlows(s, resource);
  const ownCap = own.capacity + Math.max(0, flows);
  const ownUse = own.usage + Math.max(0, -flows);
  let max: number;
  let price: number;
  if (direction === 'buy') {
    const surplus = theirs.capacity - theirs.usage;
    if (surplus <= D.minAmount) return no('neighbour has no surplus');
    // Up to the projected need, whatever the city makes itself: bought supply is used before the city's own,
    // so a big enough purchase takes load off its utility buildings.
    max = Math.min(surplus, Math.max(D.minAmount, D.projectedNeed * ownUse));
    price = dealPrice(cfg, theirs.cost, own.cost, max, ownUse, theirs);
    // A smaller deal the treasury can cover for a year, rather than none (the year's cash was checked at
    // the largest amount, refusing cities that could afford the minimum).
    max = Math.min(max, s.funds / Math.max(1e-9, price * D.cashMonths));
    if (max < D.minAmount) return no('not enough cash for a year');
    price = dealPrice(cfg, theirs.cost, own.cost, Math.min(max, amount ?? max), ownUse, theirs); // (priced for the amount offered)
  } else {
    if (theirs.capacity >= D.projectedNeed * theirs.usage) return no('neighbour needs no more');
    const surplus = ownCap - ownUse;
    if (surplus <= D.minAmount) return no('no surplus to sell');
    max = Math.min(surplus, D.projectedNeed * theirs.usage - theirs.capacity);
    price = dealPrice(cfg, own.cost, theirs.cost, max, theirs.usage, { ...own, capacity: ownCap, usage: ownUse });
    max = Math.min(max, nb.funds / Math.max(1e-9, price * D.cashMonths));
    if (max < D.minAmount) return no('neighbour lacks the cash');
    price = dealPrice(cfg, own.cost, theirs.cost, Math.min(max, amount ?? max), theirs.usage, { ...own, capacity: ownCap, usage: ownUse });
  }
  if (max < D.minAmount) return no('less than the minimum deal');
  return { ...base, ok: true, maxAmount: Math.floor(max), price };
}

/**
 * Monthly settlement: breaches put a deal into six months' grace, fixing it
 * gives three months' probation, a breach on probation (or grace running
 * out) ends it. Returns income and expenses for the budget.
 */
export function settleDeals(
  s: CityState, cfg: SimConfig, delivered: Record<DealResource, boolean>,
  connected?: (edge: number, resource: DealResource) => boolean,
  deliveredByDeal?: ReadonlyMap<number, boolean>,
): { income: number; expense: number; ended: NeighbourDeal[] } {
  const D = cfg.region.deals;
  let income = 0;
  let expense = 0;
  const ended: NeighbourDeal[] = [];
  s.neighbourDeals = s.neighbourDeals.filter((d) => {
    const monthly = dealMonthly(s, d);
    const nb = s.neighbours[d.edge];
    const ok = (connected ? connected(d.edge, d.resource) : hasDealConnection(s, d.edge, d.resource)) && nb?.kind === 'developed' && nb.connected?.[d.resource] !== false
      && (d.direction === 'buy' ? s.funds >= monthly : deliveredByDeal?.get(d.id) ?? delivered[d.resource]);
    if (!ok) {
      if (d.status === 'probation') {
        ended.push(d);
        return false;
      }
      if (d.status === 'active') {
        d.status = 'grace';
        d.monthsLeft = D.graceMonths;
      } else if (--d.monthsLeft <= 0) {
        ended.push(d);
        return false;
      }
      return true;
    }
    if (d.status === 'grace') {
      d.status = 'probation';
      d.monthsLeft = D.probationMonths;
    } else if (d.status === 'probation' && --d.monthsLeft <= 0) d.status = 'active';
    if (d.direction === 'buy') expense += monthly;
    else income += monthly;
    return true;
  });
  return { income, expense, ended };
}

/**
 * Yearly review of deal terms: on each anniversary a deal's price is set
 * again from both cities' costs and needs now, for the same amount (the
 * player may cancel). Returns the deals whose price changed, with the old price.
 */
export function repriceDeals(
  s: CityState, cfg: SimConfig, own: (r: DealResource) => Utility,
): { deal: NeighbourDeal; was: number }[] {
  const out: { deal: NeighbourDeal; was: number }[] = [];
  const months = cfg.region.deals.termMonths;
  for (const d of s.neighbourDeals) {
    const age = Math.round((s.day - d.startDay) / 30);
    if (age <= 0 || age % months !== 0) continue;
    const nb = s.neighbours[d.edge];
    if (!nb || nb.kind !== 'developed') continue;
    const mine = own(d.resource);
    const theirs: Utility = { capacity: nb.capacity[d.resource], usage: nb.usage[d.resource], cost: cfg.region.neighbourCost[d.resource] };
    const price = d.direction === 'buy'
      ? dealPrice(cfg, theirs.cost, mine.cost, d.amount, mine.usage, theirs)
      : dealPrice(cfg, mine.cost, theirs.cost, d.amount, theirs.usage, mine);
    if (Math.abs(price - d.price) < 1e-9) continue;
    out.push({ deal: d, was: d.price });
    d.price = price;
  }
  return out;
}

/** Developed neighbours this city reaches by road, highway, rail or subway (on a stretch of border they share). */
export function linkedNeighbours(s: CityState, runs = edgeConnections(s)): Neighbour[] {
  return s.neighbours.filter((nb) => nb.kind === 'developed'
    && (['road', 'highway', 'rail', 'subway'] as const).some((k) => runs[k][nb.edge]! > 0) && facesShared(s, nb));
}

/**
 * Does a road, highway, rail or subway meet the edge where a played city lies
 * across it? (Part of an edge may face an empty square: a connection there
 * reaches SimNation, not the city beside it.) True when unknown.
 */
export function facesShared(s: CityState, nb: Neighbour): boolean {
  if (!nb.shared?.length) return true;
  const n = s.size;
  const e = nb.edge;
  for (const [a, b] of nb.shared) {
    for (let p = Math.max(0, a); p < Math.min(n, b); p++) {
      const i = e === 0 ? p * n : e === 1 ? p * n + n - 1 : e === 2 ? p : (n - 1) * n + p;
      if (tileKinds(s, i).some((k) => k === 'road' || k === 'highway' || k === 'rail' || k === 'subway')) return true;
    }
  }
  return false;
}

/** What the region adds to a city's demand (see regionalDemand). */
export interface RegionalDemand {
  /** Added to raw demand: neighbours' extrapolated growth, their pooled unmet demand, and growth tossed here while inactive. */
  extra: PerType;
  /** Growth this city's demand has had taken up by neighbours: counted as built (Sims or jobs) in the regional pool. */
  pooled: PerType;
}

/**
 * Regional demand, from developed, transport-linked neighbours (directly
 * connected ones; indirectly connected ones count through a neighbour's own
 * pooled demand): the 10% growth they are extrapolated to make, their demand
 * left unmet when last played (pooled with this city's), and the growth this
 * city tossed to them, which now stands there as Sims and jobs. Growth
 * tossed here while this city was inactive sprouts until built.
 */
export function regionalDemand(s: CityState, census: { population: PerType }, runs = edgeConnections(s)): RegionalDemand {
  const extra = perType(() => 0);
  const pooled = perType(() => 0);
  for (const nb of linkedNeighbours(s, runs)) {
    for (const t of DEV_TYPES) {
      extra[t] += nb.growth[t] + (nb.demand?.[t] ?? 0);
      pooled[t] += nb.absorbed?.[t] ?? 0;
    }
  }
  for (const t of DEV_TYPES) {
    const target = s.growthTarget[t];
    if (target !== undefined) extra[t] += Math.max(0, target - census.population[t]);
  }
  return { extra, pooled };
}

/**
 * Monthly: the region's pent-up growth and pooled demand are used up a
 * twelfth at a time, then demand stagnates; growth tossed here that
 * has been built is done with.
 */
export function drainRegionalGrowth(s: CityState, cfg: SimConfig, census: { population: PerType }, built?: PerType): void {
  const k = 1 - cfg.region.growth.perMonth;
  const linked = linkedNeighbours(s);
  // What was built here this month satisfies the region's growth first (as far as it goes; once used up,
  // demand stagnates): taken from the neighbours' share in proportion.
  if (built) for (const t of DEV_TYPES) {
    const pool = linked.reduce((a, nb) => a + Math.max(0, nb.growth[t]), 0);
    const used = Math.min(pool, Math.max(0, built[t]));
    if (used > 0) for (const nb of linked) nb.growth[t] -= (Math.max(0, nb.growth[t]) / pool) * used;
  }
  for (const nb of linked) {
    for (const t of DEV_TYPES) {
      nb.growth[t] *= k;
      if (nb.demand) nb.demand[t] *= k;
    }
  }
  for (const t of DEV_TYPES) {
    const target = s.growthTarget[t];
    if (target !== undefined && census.population[t] >= target) delete s.growthTarget[t];
  }
}

/** Shares a whole count by weight, assigning leftover Sims to the largest fractional shares. */
export function apportionGrowth(amount: number, weights: readonly number[]): number[] {
  if (!weights.length) return [];
  const count = Math.round(amount);
  if (!Number.isFinite(count) || count <= 0) return weights.map(() => 0);
  const total = weights.reduce((a, b) => a + b, 0);
  const quotas = weights.map(w => total > 0 ? count * (w / total) : count / weights.length);
  const shares = quotas.map(Math.floor);
  const left = count - shares.reduce((a, b) => a + b, 0);
  const order = quotas.map((_, j) => j).sort((a, b) => (quotas[b]! - shares[b]!) - (quotas[a]! - shares[a]!) || a - b);
  for (let j = 0; j < left && j < order.length; j++) shares[order[j]!]!++;
  return shares;
}

/**
 * Exporting demand: at the month's end, demand the city didn't
 * satisfy is tossed to inactive linked neighbours, which take it up with
 * their spare zone capacity (up to 10% of their population, less what they
 * already took). Returns what was taken per type.
 */
export function exportDemand(s: CityState, cfg: SimConfig, raw: PerType): PerType {
  const out = perType(() => 0);
  const rg = cfg.region.growth;
  const takers = linkedNeighbours(s);
  if (!takers.length) return out;
  for (const t of DEV_TYPES) {
    const want = Math.max(0, raw[t]) * rg.exportShare;
    if (want <= 0) continue;
    const room = takers.map((nb) => Math.max(0, nb.population[t] * rg.share - (nb.absorbed?.[t] ?? 0)));
    const total = room.reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    const take = Math.min(want, total);
    const parts = apportionGrowth(take, room);
    takers.forEach((nb, k) => {
      const part = parts[k]!;
      if (part <= 0) return;
      nb.absorbed ??= perType(() => 0);
      nb.absorbed[t] += part;
      out[t] += part;
    });
  }
  return out;
}
