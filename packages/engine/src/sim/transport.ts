// Travel model. Sims plan trips over a multimodal graph
// of (tile, mode) states: walking, car, bus, train and subway. Edge times come
// from the per-tile crossing times, slowed by last month's congestion
// and by intersections; boarding a bus or train costs the switching
// time, more when the station is overloaded or underfunded. Searches run
// backwards from destinations, so one pass gives every origin its fastest trip.

import { drain } from './steps';
import { MinHeap as Heap } from './heap';
import { tileWork } from './work';
import { allocateCapacitySteps } from './capacity';
import type { SimConfig } from '../config';
import { interp } from '../data/services';
import { ordinanceEffects } from './mayor';
import { edgeOf, neighbourCommute, neighbourOpenJobs, neighbourWorkEdges } from './region';
import type { BusinessType } from '../types';
import { buildingAccess, footprint, frontage, INF, type Fields } from './fields';
import { cargoCapacity, facilityJobs, carMove, tilesLinked, ELEVATED, isAsphalt, ONEWAY_DIRS, INTERCHANGE, isLocalNet, overNet, overNetVertical, SPAN, isRail, Net, NETWORK_KINDS, Terrain, trafficKind, type Building, type CityState, type Rect, type Structure } from './state';

/** Subway mode also covers elevated rail (the same trains, on raised track). */
/** Ferry carries foot passengers; CarFerry carries Sims who drove aboard (they drive off again). */
/** HighCar / HighBus: a car or bus up on an elevated highway or overpass (reached from onramps or ground highways). */
export const Mode = { Walk: 0, Car: 1, Bus: 2, Train: 3, Subway: 4, Monorail: 5, Ferry: 6, CarFerry: 7, HighCar: 8, HighBus: 9 } as const;
const MODES = 10;
const ONE: readonly number[] = Array.from({ length: MODES }, () => 1);

/**
 * A home's commuters by strategy (odds by wealth; the Commuter
 * Shuttle moves some to transit): the search each group follows, the state
 * it starts from and how many Sims. Those whose preferred means can't get
 * them there in time take the fastest way instead.
 */
export function commuters(
  s: CityState, cfg: SimConfig, tr: TravelFields, b: Building, a: { road: number; dist: number }, transitShare: number,
): { search: TravelSearch; start: number; amount: number }[] {
  const tc = cfg.transport;
  const N = s.size * s.size;
  // Healthier Sims work longer (the census's workforce share, by this home's HQ).
  const workers = b.capacity * b.occupancy * interp(cfg.services.workforceByHq, b.hq);
  if (!b.type || workers <= 0 || a.road < 0) return [];
  const extra = a.dist * tc.speed.street.car;
  const odds = tc.strategyOdds[cfg.demand.wealthOf[b.type]];
  let transit: number = odds.transit;
  let carOnly: number = odds.car;
  let fastest: number = odds.fastest;
  if (transitShare > 0) {
    const take = Math.min(transitShare, carOnly > 0 ? carOnly : fastest);
    transit += take;
    if (carOnly > 0) carOnly -= take;
    else fastest -= take;
  }
  const out: { search: TravelSearch; start: number; amount: number }[] = [];
  for (const [search, share, carOnlyRoute] of [
    [tr.car, carOnly, true], [tr.transit, transit, false], [tr.fastest, fastest, false],
  ] as const) {
    if (share <= 0) continue;
    let used = search;
    let start = origin(search, N, a.road, carOnlyRoute);
    if (start < 0 || used.time[start]! + extra > tc.tripLimit) {
      used = tr.fastest;
      start = origin(tr.fastest, N, a.road, false);
    }
    if (start < 0 || used.time[start]! + extra > tc.tripLimit) continue;
    out.push({ search: used, start, amount: workers * share });
  }
  return out;
}

/** Result of a backward search: time to the nearest destination from each state. */
export interface TravelSearch {
  /** Time as the Sim weighs it (strategy bias included). */
  dist: Float32Array;
  /** Real travel time along the chosen route. */
  time: Float32Array;
  /** Next state on the route (-1 at a destination). */
  next: Int32Array;
  /** Station boarded at a state, and the state boarding leads to (it counts only while that is still `next`). */
  via: Map<number, [station: number, to: number]>;
  /** Did the search have any destination at all? */
  hasSources: boolean;
}

export interface TravelFields {
  /** Per mode, centi-hours to enter each tile (0 = not passable in that mode). */
  cross: Float32Array[];
  /** Boarding edges for car-only commuters and for everyone else (with highway ramps). */
  carTransfers: Map<number, Transfer[]>;
  allTransfers: Map<number, Transfer[]>;
  car: TravelSearch;
  transit: TravelSearch;
  fastest: TravelSearch;
  /** Freight time to a connection, seaport or (with a penalty) airport: what industry's desirability sees. */
  freight: TravelSearch;
  /** Where trucks actually go when there are airports: connections and seaports only. */
  shipping?: TravelSearch;
}

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/** Speed lost to congestion at `u` times capacity (none up to capacity, then linear up to a cap). */
export function congestionSlowdown(u: number, c: { slope: number; max: number }): number {
  return u <= 1 ? 0 : Math.min(c.max, c.slope * (u - 1));
}

/** Tiles around a footprint (no corners), inside the map. */
export function perimeter(s: CityState, r: Rect): number[] {
  const out: number[] = [];
  const n = s.size;
  for (let y = r.y - 1; y <= r.y + r.h; y++) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
      const corner = (x === r.x - 1 || x === r.x + r.w) && (y === r.y - 1 || y === r.y + r.h);
      if (inside || corner || x < 0 || y < 0 || x >= n || y >= n) continue;
      out.push(y * n + x);
    }
  }
  return out;
}

/** Intersection slowdown per tile: 30% on the junction, 20% and 10% one and two tiles out. */
function* intersectionSlowdownSteps(s: CityState, f: Fields, cfg: SimConfig): Generator<void, Float32Array> {
  const n = s.size;
  const N = n * n;
  const out = new Float32Array(N);
  const dist = new Int32Array(N).fill(INF);
  const queue = tileWork(f, N);
  let tail = 0;
  for (let i = 0; i < N; i++) {
    if ((i & 0x1fff) === 0x1fff) yield;
    const a = s.net[i]!;
    if (!isLocalNet(a)) continue;
    const x = i % n;
    const y = (i - x) / n;
    let degree = 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k]!;
      const ny = y + DY[k]!;
      if (nx >= 0 && ny >= 0 && nx < n && ny < n && tilesLinked(s, i, ny * n + nx)) degree++;
    }
    if (degree >= 3) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  const slow = cfg.transport.intersection;
  for (let h = 0; h < tail; h++) {
    if ((h & 0xfff) === 0xfff) yield;
    const i = queue[h]!;
    const d = dist[i]!;
    out[i] = slow[d]!;
    if (d + 1 >= slow.length) continue;
    const x = i % n;
    const y = (i - x) / n;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k]!;
      const ny = y + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (dist[j]! <= d + 1 || !tilesLinked(s, i, j) || s.net[j] === Net.Highway) continue;
      dist[j] = d + 1;
      queue[tail++] = j;
    }
  }
  return out;
}

/**
 * Toll booths slow traffic like an intersection on the booth and the two tiles
 * before and after it, on the level the booth is on.
 */
function* tollSlowdownSteps(s: CityState, cfg: SimConfig): Generator<void, { ground: Float32Array; high: Float32Array }> {
  const n = s.size;
  const ground = new Float32Array(n * n);
  const high = new Float32Array(n * n);
  const slow = cfg.transport.intersection;
  for (let i = 0; i < n * n; i++) {
    if ((i & 0x1fff) === 0x1fff) yield;
    const level = s.tolls[i]!;
    if (!level) continue;
    const out = level === 2 ? high : ground;
    const x = i % n;
    const y = (i - x) / n;
    out[i] = Math.max(out[i]!, slow[0]!);
    for (let k = 0; k < 4; k++) {
      for (let d = 1; d < slow.length; d++) {
        const nx = x + DX[k]! * d;
        const ny = y + DY[k]! * d;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) break;
        const j = ny * n + nx;
        const on = level === 2 ? s.elevated[j] === ELEVATED.highway : s.net[j] === s.net[i];
        if (!on) break;
        out[j] = Math.max(out[j]!, slow[d]!);
      }
    }
  }
  return { ground, high };
}

/** Per-mode crossing times for this month (congestion lags a month, as trips are planned ahead). */
function* crossTimes(s: CityState, f: Fields, cfg: SimConfig): Generator<void, Float32Array[]> {
  const N = s.size * s.size;
  const tc = cfg.transport;
  const cross = Array.from({ length: MODES }, () => new Float32Array(N));
  const isect = yield* intersectionSlowdownSteps(s, f, cfg);
  yield;
  const tollSlow = yield* tollSlowdownSteps(s, cfg);
  yield;
  for (let i = 0; i < N; i++) {
    if ((i & 0x1fff) === 0x1fff) yield;
    const code = s.net[i]!;
    const kind = trafficKind(s, i);
    if (isRail(code)) {
      const sp = tc.speed.rail;
      cross[Mode.Train]![i] = sp.train / (1 - congestionSlowdown(f.railTraffic[i]! / sp.capacity, tc.congestion));
    }
    if (kind) {
      const sp = tc.speed[kind];
      if (kind !== 'rail') {
        // Toll booths: 60% of the road's capacity, a stop like an intersection and a 0.2 h wait.
        const toll = s.tolls[i] === 1;
        const capacity = toll ? sp.capacity * tc.toll.capacity : sp.capacity;
        const slow = (1 - congestionSlowdown(f.traffic[i]! / capacity, tc.congestion)) * (1 - Math.max(isect[i]!, tollSlow.ground[i]!));
        const pothole = s.potholes[i] ? tc.potholes.penalty : 0;
        // (The booth stops cars and trucks only; buses go through.)
        const booth = toll ? tc.toll.wait : 0;
        // Pedestrians can't enter tunnels.
        if (sp.walk !== null && s.tunnel[i] !== SPAN.tunnel) cross[Mode.Walk]![i] = sp.walk;
        cross[Mode.Car]![i] = sp.car! / slow + pothole + booth;
        cross[Mode.Bus]![i] = sp.bus! / slow + pothole;
      }
    }
    if (s.subway[i] || s.elevated[i] === ELEVATED.rail) {
      const sp = s.subway[i] ? tc.speed.subway : tc.speed.elrail;
      cross[Mode.Subway]![i] = sp.train / (1 - congestionSlowdown(f.subwayTraffic[i]! / sp.capacity, tc.congestion));
    }
    // Ferries sail open water and under bridges built tall enough for them (Rush Hour).
    if (s.terrain[i] === Terrain.Water && s.tunnel[i] !== SPAN.lowBridge) {
      const sp = tc.speed.ferry;
      const t = sp.train / (1 - congestionSlowdown(f.ferryTraffic[i]! / sp.capacity, tc.congestion));
      cross[Mode.Ferry]![i] = t;
      cross[Mode.CarFerry]![i] = t;
    }
    if (s.elevated[i] === ELEVATED.highway || s.interchange[i] === INTERCHANGE.overpass) {
      const sp = tc.speed.highway;
      const toll = s.tolls[i] === 2;
      const capacity = toll ? sp.capacity * tc.toll.capacity : sp.capacity;
      const slow = (1 - congestionSlowdown(f.highTraffic[i]! / capacity, tc.congestion)) * (1 - tollSlow.high[i]!);
      const wait = toll ? tc.toll.wait : 0;
      // (An elevated highway's own potholes: over a road, the flag is the road's below.)
      const pothole = s.potholes[i] && s.elevated[i] === ELEVATED.highway && !isAsphalt(s.net[i]!) ? tc.potholes.penalty : 0;
      cross[Mode.HighCar]![i] = sp.car / slow + wait + pothole;
      cross[Mode.HighBus]![i] = sp.bus / slow + wait + pothole;
    }
    // A road over a Ground Highway: its cars and buses ride the upper deck
    // (HighCar / HighBus at the road's speeds); Sims walk over it.
    const up = overNet(s, i);
    if (up) {
      const sp = tc.speed[NETWORK_KINDS[up]!];
      const slow = 1 - congestionSlowdown(f.highTraffic[i]! / sp.capacity, tc.congestion);
      if (sp.walk !== null) cross[Mode.Walk]![i] = sp.walk;
      cross[Mode.HighCar]![i] = sp.car! / slow;
      cross[Mode.HighBus]![i] = sp.bus! / slow;
    }
    if (s.elevated[i] === ELEVATED.monorail) {
      const sp = tc.speed.monorail;
      cross[Mode.Monorail]![i] = sp.train / (1 - congestionSlowdown(f.monorailTraffic[i]! / sp.capacity, tc.congestion));
    }
  }
  return cross;
}

/** An edge onto a line or off it: boarding carries the station's id, getting off `alighting(id)`, other moves -1. */
type Transfer = [from: number, cost: number, station: number];

const alighting = (station: number) => -2 - station;

/**
 * Does line state v go on by getting off at the station (its next step an
 * alighting there)? Boarding there to do so would be a ride nowhere: off the
 * platform onto another of the station's sides, which may be another network.
 */
function alightsAt(edges: Map<number, Transfer[]>, v: number, next: number, station: number): boolean {
  const list = next >= 0 ? edges.get(next) : undefined;
  if (!list) return false;
  const off = alighting(station);
  for (const [from, , st] of list) if (from === v && st === off) return true;
  return false;
}

/**
 * Boarding and alighting edges at stations, keyed by the state they lead to.
 * Boarding pays the switching cost; getting off is free (and can't follow
 * boarding at the same station: see `alightsAt`).
 */
export function transfers(s: CityState, cfg: SimConfig, freight: boolean): Map<number, Transfer[]> {
  const N = s.size * s.size;
  const out = new Map<number, Transfer[]>();
  const add = (from: number, to: number, cost: number, station: number) => {
    let list = out.get(to);
    if (!list) out.set(to, (list = []));
    list.push([from, cost, station]);
  };
  const terminals = new Map<string, number>();
  const ferryNeighbour = !freight && edgeTilesWhere(s, (i) => ferryWater(s, i) && ferryCity(s, edgeOf(s.size, i))).length > 0;
  for (const st of s.structures.values()) {
    const m = cfg.structures[st.kind].station?.mode;
    if (m === 'ferry' || m === 'carFerry') terminals.set(m, (terminals.get(m) ?? 0) + 1);
  }
  for (const st of s.structures.values()) {
    const sdef = cfg.structures[st.kind];
    // Parking garages: drive in, walk on to a transit stop (2 tenths of an hour).
    if (sdef.parking && !freight) {
      const full = 1 / (1 - congestionSlowdown(st.load / sdef.parking.capacity, cfg.transport.congestion));
      for (const a of frontage(s, st)) add(Mode.Car * N + a, Mode.Walk * N + a, sdef.parking.switchCost * full, st.id);
      continue;
    }
    const def = sdef.station;
    if (!def || (def.mode === 'freight') !== freight) continue;
    const fronts = frontage(s, st);
    if (!fronts.length) continue;
    // Underfunding mass transit lengthens the wait (200% at no funding); so does overload.
    const funding = 2 - Math.min(1, s.departments.transit / 100);
    const overload = 1 / (1 - congestionSlowdown(st.load / def.capacity, cfg.transport.congestion));
    // (A free transfer, as freight rail's, still waits when the station is over capacity: multiplied, its
    // 2,000 capacity did nothing.)
    const cost = def.switchCost > 0 ? def.switchCost * funding * overload : FREE_TRANSFER_WAIT * (overload - 1);
    const off = alighting(st.id);
    if (def.mode === 'bus') {
      for (const a of fronts) {
        add(Mode.Walk * N + a, Mode.Bus * N + a, cost, st.id);
        add(Mode.Bus * N + a, Mode.Walk * N + a, 0, off);
      }
      continue;
    }
    const near = [...footprint(s, st), ...perimeter(s, st)];
    if (def.mode === 'ferry' || def.mode === 'carFerry') {
      // Terminals sit on the shore: boats leave from their water tiles. Walk-on
      // boats need a second terminal of the same kind to sail to (a lone
      // Passenger terminal goes nowhere, however many Car & Passenger ones there are).
      const docks = near.filter((i) => s.terrain[i] === Terrain.Water);
      // The matching terminal may be in a neighbouring city across the water.
      const walkOn = (terminals.get(def.mode) ?? 0) >= 2 || ferryNeighbour;
      for (const a of fronts) {
        for (const t of docks) {
          if (walkOn) {
            add(Mode.Walk * N + a, Mode.Ferry * N + t, cost, st.id);
            add(Mode.Ferry * N + t, Mode.Walk * N + a, 0, off);
          }
          if (def.mode === 'carFerry') {
            add(Mode.Car * N + a, Mode.CarFerry * N + t, cost, st.id);
            add(Mode.CarFerry * N + t, Mode.Car * N + a, 0, off);
          }
        }
      }
      continue;
    }
    const tracks = def.mode === 'subway' ? near.filter((i) => s.subway[i] || s.elevated[i] === ELEVATED.rail)
      : def.mode === 'monorail' ? near.filter((i) => s.elevated[i] === ELEVATED.monorail)
      : perimeter(s, st).filter((i) => isRail(s.net[i]!));
    const mode = def.mode === 'subway' ? Mode.Subway : def.mode === 'monorail' ? Mode.Monorail : Mode.Train;
    for (const a of fronts) {
      for (const t of tracks) {
        if (def.mode === 'freight') {
          add(Mode.Car * N + a, mode * N + t, cost, st.id);
          continue;
        }
        add(Mode.Walk * N + a, mode * N + t, cost, st.id);
        // Passenger rail also takes Sims who drive to the station.
        if (def.mode === 'rail') add(Mode.Car * N + a, mode * N + t, cost, st.id);
        add(mode * N + t, Mode.Walk * N + a, 0, off);
      }
    }
  }
  return out;
}

/** Ramps between ground networks (onramps, ground highways) and elevated highways next to them. */
function ramps(s: CityState, cross: Float32Array[]): Map<number, Transfer[]> {
  const n = s.size;
  const N = n * n;
  const out = new Map<number, Transfer[]>();
  const add = (from: number, to: number, cost: number) => {
    let list = out.get(to);
    if (!list) out.set(to, (list = []));
    list.push([from, cost, -1]);
  };
  // Cars and buses alike.
  const ramp = (a: number, b: number) => {
    add(Mode.Car * N + a, Mode.HighCar * N + b, cross[Mode.HighCar]![b]!);
    add(Mode.HighCar * N + b, Mode.Car * N + a, cross[Mode.Car]![a]!);
    add(Mode.Bus * N + a, Mode.HighBus * N + b, cross[Mode.HighBus]![b]!);
    add(Mode.HighBus * N + b, Mode.Bus * N + a, cross[Mode.Bus]![a]!);
  };
  /** One way only: up from road tile a onto deck b, or down from b to a. */
  const rampOne = (a: number, b: number, up: boolean) => {
    if (up) {
      add(Mode.Car * N + a, Mode.HighCar * N + b, cross[Mode.HighCar]![b]!);
      add(Mode.Bus * N + a, Mode.HighBus * N + b, cross[Mode.HighBus]![b]!);
    } else {
      add(Mode.HighCar * N + b, Mode.Car * N + a, cross[Mode.Car]![a]!);
      add(Mode.HighBus * N + b, Mode.Bus * N + a, cross[Mode.Bus]![a]!);
    }
  };
  for (let b = 0; b < N; b++) {
    if (s.elevated[b] !== ELEVATED.highway) continue;
    const x = b % n;
    for (const a of [b - 1, b + 1, b - n, b + n]) {
      if (a < 0 || a >= N || Math.abs((a % n) - x) > 1) continue;
      const code = s.net[a]!;
      if (code !== Net.Onramp && code !== Net.Highway) continue;
      // A ground highway joins an elevated one only head-to-head, where one ends and the other goes on in
      // line (the type switches only where a highway is extended from its end; interchanges join highways
      // of one type). Over it, or running alongside, every touching tile was a free interchange.
      if (code === Net.Highway) {
        const on = 2 * b - a; // the elevated run's next tile, away from the ground highway
        if (s.net[b] === Net.Highway || s.elevated[a] === ELEVATED.highway) continue;
        if (on < 0 || on >= N || Math.abs((on % n) - x) > 1 || s.elevated[on] !== ELEVATED.highway) continue;
      }
      ramp(a, b);
    }
  }
  // Roads over ground highways: up from the road either side of the deck.
  for (let b = 0; b < N; b++) {
    if (!overNet(s, b)) continue;
    const ends = overNetVertical(s, b) ? [b - n, b + n] : [b - 1, b + 1];
    for (const a of ends) {
      if (a < 0 || a >= N || Math.abs((a % n) - (b % n)) > 1 || !isLocalNet(s.net[a]!)) continue;
      // A one-way deck: up from the end it runs from, down at the end it runs to.
      if (overNet(s, b) === Net.OneWay && s.oneway[b]) {
        if (deckWay(s, b, 2 * b - a)) rampOne(a, b, true);
        else rampOne(a, b, false);
      } else ramp(a, b);
    }
  }
  // Overpasses: the north–south highway climbs over the crossing from the tiles either side.
  for (let b = 0; b < N; b++) {
    if (s.interchange[b] !== INTERCHANGE.overpass) continue;
    for (const a of [b - n, b + n]) {
      if (a < 0 || a >= N || s.interchange[a] === INTERCHANGE.overpass) continue;
      if (s.net[a] !== Net.Highway && s.net[a] !== Net.Onramp) continue;
      ramp(a, b);
    }
  }
  return out;
}

function merge(...maps: Map<number, Transfer[]>[]): Map<number, Transfer[]> {
  const out = new Map<number, Transfer[]>();
  for (const m of maps) for (const [k, v] of m) out.set(k, [...(out.get(k) ?? []), ...v]);
  return out;
}

/** The wait at an overloaded station whose transfer is otherwise free, per unit of overload (hundredths of an hour, as a rail stop's). */
const FREE_TRANSFER_WAIT = 5;

/** Only the car-ferry boarding and landing edges of a transfer map. */
function carFerries(all: Map<number, Transfer[]>, N: number): Map<number, Transfer[]> {
  const out = new Map<number, Transfer[]>();
  for (const [to, list] of all) {
    const m = Math.floor(to / N);
    const keep = list.filter(([from]) => {
      const fm = Math.floor(from / N);
      return (m === Mode.CarFerry && fm === Mode.Car) || (m === Mode.Car && fm === Mode.CarFerry);
    });
    if (keep.length) out.set(to, keep);
  }
  return out;
}

/**
 * Upper-deck moves: a road over a highway only continues along itself (into
 * the next deck across a twin highway), never onto an elevated highway.
 */
function highMove(s: CityState, t: number, u: number): boolean {
  const a = overNet(s, t) !== 0;
  if (a !== (overNet(s, u) !== 0)) return false;
  if (!a) return true;
  if (overNetVertical(s, t) !== (t % s.size === u % s.size)) return false;
  // A one-way deck only its way.
  return deckWay(s, t, u) && deckWay(s, u, u - t + u);
}

/** May traffic on deck tile `t` move one tile on towards `u` (one-way decks only their way)? */
function deckWay(s: CityState, t: number, u: number): boolean {
  if (overNet(s, t) !== Net.OneWay) return true;
  const d = s.oneway[t]!;
  if (!d) return true;
  const n = s.size;
  const [dx, dy] = ONEWAY_DIRS[d - 1]!;
  return (u % n) - (t % n) === dx && Math.floor(u / n) - Math.floor(t / n) === dy;
}

export interface TruckNetworks { ground: Int32Array; high: Int32Array }
const TRUCK_NETWORKS = new WeakMap<TravelFields, TruckNetworks>();

/** Road connectivity for collection trucks, including upper decks and actual ramps. Directions and travel times are ignored. */
export function* truckNetworksSteps(s: CityState, f: Fields): Generator<void, TruckNetworks> {
  const travel = f.travel;
  if (!travel) return { ground: f.component, high: new Int32Array(0) };
  const cached = TRUCK_NETWORKS.get(travel);
  if (cached) return cached;
  const upper = travel.cross[Mode.HighCar]!;
  if (!upper.some((cost) => cost > 0)) {
    const result = { ground: f.component, high: new Int32Array(0) };
    TRUCK_NETWORKS.set(travel, result);
    return result;
  }
  const n = s.size, N = n * n;
  const ground = new Int32Array(N).fill(-1), high = new Int32Array(N).fill(-1);
  const layers = [ground, high], crossings = [travel.cross[Mode.Car]!, upper];
  const joins = new Map<number, number[]>();
  const join = (a: number, b: number) => {
    const list = joins.get(a);
    if (list) list.push(b); else joins.set(a, [b]);
  };
  for (const [to, transfers] of travel.carTransfers) for (const [from] of transfers) {
    const a = Math.floor(from / N), b = Math.floor(to / N);
    if (!(a === Mode.Car && b === Mode.HighCar || a === Mode.HighCar && b === Mode.Car)) continue;
    const va = (a === Mode.Car ? 0 : N) + from % N, vb = (b === Mode.Car ? 0 : N) + to % N;
    join(va, vb); join(vb, va);
  }
  let count = 0, work = 0;
  for (let layer = 0; layer < 2; layer++) for (let start = 0; start < N; start++) {
    if ((++work & 0x7ff) === 0) yield;
    if (!(crossings[layer]![start]! > 0) || layers[layer]![start]! >= 0) continue;
    const queue = [layer * N + start];
    layers[layer]![start] = count;
    const visit = (v: number) => {
      const z = v >= N ? 1 : 0, tile = v % N;
      if (layers[z]![tile]! >= 0 || !(crossings[z]![tile]! > 0)) return;
      layers[z]![tile] = count;
      queue.push(v);
    };
    for (let head = 0; head < queue.length; head++) {
      if ((++work & 0x7ff) === 0) yield;
      const v = queue[head]!, z = v >= N ? 1 : 0, tile = v % N;
      const x = tile % n, y = (tile - x) / n;
      for (let direction = 0; direction < 4; direction++) {
        const nx = x + DX[direction]!, ny = y + DY[direction]!;
        if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
        const adjacent = ny * n + nx;
        if (!(crossings[z]![adjacent]! > 0)) continue;
        if (z === 0 ? carMove(s, tile, adjacent) || carMove(s, adjacent, tile)
          : highMove(s, tile, adjacent) || highMove(s, adjacent, tile)) visit(z * N + adjacent);
      }
      const transfers = joins.get(v);
      if (transfers) for (const to of transfers) visit(to);
    }
    count++;
  }
  const result = { ground, high };
  TRUCK_NETWORKS.set(travel, result);
  return result;
}

/** A workplace (or a neighbour city's connection) in a capacitated job search. */
interface JobTarget {
  /** Its states (front tiles on foot and by car, or the connection) and the cost of starting there. */
  sources: readonly [number, number][];
  /** Jobs still open to the commuters searched for. */
  open: () => number;
  /** Takes up to x of them; returns how many. */
  take: (x: number) => number;
}

/** Commuters waiting at their start states to be reached by the search. */
interface Waiting {
  need: number;
  /** Driveway time added to the trip. */
  extra: number;
}

/**
 * The closest open job, with capacities (Sims work at the nearest one still
 * open): one backward search grows from every target with jobs open at
 * once, so each state is labelled with the target nearest to it; commuters
 * are settled in order of their trip time and claim jobs at their label.
 * When a target fills, the states it held are released and its neighbours'
 * searches grow into them (seeded again from the states around), so the
 * commuters there go on to the next closest target with jobs. `claim` hears
 * of every job taken, with the route (valid only during the call).
 */
function* nearestOpenJobs(
  s: CityState, cross: Float32Array[], targets: readonly JobTarget[], waiting: Map<number, Waiting[]>,
  o: SearchOptions, buf: SearchBuffers, label: Int32Array,
  claim: (w: Waiting, target: number, amount: number, route: TravelSearch, start: number) => void,
): Generator<void, void> {
  const n = s.size;
  const N = n * n;
  const moves = yield* moveMasksSteps(s, cross);
  yield;
  const { dist, time, next } = buf;
  dist.fill(INF);
  time.fill(INF);
  yield;
  next.fill(-1);
  label.fill(-1);
  yield;
  const via = new Map<number, [station: number, to: number]>();
  const route: TravelSearch = { dist, time, next, via, hasSources: true };
  const allowed = new Uint8Array(MODES);
  for (const m of o.modes) allowed[m] = 1;
  const minOpen = OPEN_MIN;
  const closed = new Uint8Array(targets.length);
  const WAITING = 1, START = 2, BOARDING = 4;
  // Commuters still looking: the search ends once they all have work.
  let looking = 0;
  const seen = new Set<Waiting>();
  // Waiting commuters, starting targets and boarding edges share one byte per mode state.
  const flags = new Uint8Array(MODES * N);
  for (const [v, list] of waiting) {
    flags[v]! |= WAITING;
    for (const w of list) if (!seen.has(w)) {
      seen.add(w);
      looking += w.need;
    }
  }
  yield;
  // States each target has labelled (some since relabelled by others).
  const held: number[][] = targets.map(() => []);
  // Each state's targets starting there (several may share a front tile).
  const startsAt = new Map<number, [number, number][]>();
  const heap = new Heap();
  const relabel = (v: number, d: number, tv: number, nx: number, k: number) => {
    dist[v] = d;
    time[v] = tv;
    next[v] = nx;
    label[v] = k;
    held[k]!.push(v);
    heap.push(d, v);
  };
  /** Seeds a state from the best open target starting there (if any). */
  const seed = (v: number): void => {
    if (!(flags[v]! & START)) return;
    let best = -1;
    let cost = INF;
    for (const [k, c] of startsAt.get(v) ?? []) if (!closed[k] && c < cost) [best, cost] = [k, c];
    if (best >= 0 && Math.fround(cost) < dist[v]!) relabel(v, Math.fround(cost), cost, -1, best);
  };
  targets.forEach((tg, k) => {
    if (tg.open() < minOpen) closed[k] = 1;
    for (const [st, c] of tg.sources) {
      if (!allowed[Math.floor(st / N)]) continue;
      const list = startsAt.get(st);
      if (list) list.push([k, c]);
      else startsAt.set(st, [[k, c]]);
    }
  });
  yield;
  for (const st of startsAt.keys()) flags[st]! |= START;
  let seeded = 0;
  for (const st of startsAt.keys()) {
    if ((++seeded & 0xfff) === 0) yield;
    seed(st);
  }
  yield;
  // Who can reach a state by boarding (for seeding a released area again).
  const boardFrom = new Map<number, number[]>();
  for (const [to, list] of o.transfers) {
    for (const [from] of list) {
      const l = boardFrom.get(from);
      if (l) l.push(to);
      else boardFrom.set(from, [to]);
      flags[from]! |= BOARDING;
    }
  }
  const joins = new Set(s.transitions);
  /** States a state moves on to (whose search can reach it). */
  const onward = (v: number, f: (u: number) => void) => {
    const m = Math.floor(v / N);
    const t = v - m * N;
    const x = t % n;
    const y = (t - x) / n;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k]!;
      const ny = y + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const u = ny * n + nx;
      // u is reached from t when t is among u's allowed neighbours (bit for the step back from u).
      const back = k ^ 1;
      if (!(cross[m]![u]! > 0)) continue;
      if ((m === Mode.Car || m === Mode.Bus) && !(moves[u]! & (1 << back))) continue;
      if ((m === Mode.HighCar || m === Mode.HighBus) && !(moves[u]! & (16 << back))) continue;
      if (m === Mode.Subway && !trackJoins(s, u, t, joins)) continue;
      f(m * N + u);
    }
    if (flags[v]! & BOARDING) for (const u of boardFrom.get(v)!) f(u);
  };
  /** A target filled: release its states, and let the searches around grow into them. */
  const close = function* (k: number): Generator<void, void> {
    closed[k] = 1;
    const area = held[k]!.filter((v) => label[v] === k);
    held[k] = [];
    // A big area (a neighbour's jobs, a downtown) is many states: pause now and then.
    let done = 0;
    for (const v of area) {
      if ((++done & 0x3fff) === 0) yield;
      dist[v] = INF;
      time[v] = INF;
      next[v] = -1;
      label[v] = -1;
      via.delete(v);
    }
    for (const v of area) {
      if ((++done & 0x1fff) === 0) yield;
      seed(v);
      onward(v, (u) => {
        const lu = label[u]!;
        if (lu >= 0 && !closed[lu] && dist[u]! < INF) heap.push(dist[u]!, u);
      });
    }
  };
  let pops = 0;
  while (heap.size && looking > 1e-6) {
    // A pause point every so often (see City.steps): the search picks up where it left off.
    if ((++pops & 0x7ff) === 0) yield;
    const v = heap.pop();
    const d = heap.lastKey;
    if (d !== dist[v]) continue;
    const k = label[v]!;
    if (k < 0 || closed[k]) continue;
    const tv = time[v]!;
    if (tv > o.limit) continue;
    // Commuters starting here claim jobs at the target they reached.
    const here = flags[v]! & WAITING ? waiting.get(v) : undefined;
    if (here) {
      for (const w of here) {
        if (w.need <= 1e-6 || tv + w.extra > o.limit) continue;
        const got = targets[k]!.take(w.need);
        if (got > 0) {
          w.need -= got;
          looking -= got;
          claim(w, k, got, route, v);
        }
        if (targets[k]!.open() < minOpen) break;
      }
      if (targets[k]!.open() < minOpen) {
        // Those left here (and anyone else on its area) look further.
        yield* close(k);
        continue;
      }
    }
    const m = Math.floor(v / N);
    const t = v - m * N;
    const c = cross[m]![t]!;
    if (c > 0) {
      const road = m === Mode.Car || m === Mode.Bus;
      const high = m === Mode.HighCar || m === Mode.HighBus;
      const x = t % n;
      const y = (t - x) / n;
      const bc = c * o.bias[m]!;
      for (let dir = 0; dir < 4; dir++) {
        const nx = x + DX[dir]!;
        const ny = y + DY[dir]!;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const u = ny * n + nx;
        if (!(cross[m]![u]! > 0)) continue;
        if (road && !(moves[t]! & (1 << dir))) continue;
        if (high && !(moves[t]! & (16 << dir))) continue;
        if (m === Mode.Subway && !trackJoins(s, t, u, joins)) continue;
        const su = m * N + u;
        const nd = Math.fround(d + bc);
        if (nd < dist[su]!) relabel(su, nd, tv + c, v, k);
      }
    }
    for (const [su, cost, station] of o.transfers.get(v) ?? []) {
      if (!allowed[Math.floor(su / N)]) continue;
      if (station >= 0 && alightsAt(o.transfers, v, next[v]!, station)) continue;
      const nd = Math.fround(d + cost);
      if (nd < dist[su]!) {
        relabel(su, nd, tv + cost, v, k);
        if (station >= 0) via.set(su, [station, v]);
      }
    }
  }
}

/**
 * Evening trips home: a morning drive retraced, with the shortest legal way
 * round any stretch that runs against a one-way road (bounded, and kept for
 * the month: many trips share their detours).
 */
class ReturnTrip {
  private detours = new Map<number, number[] | null>();
  // Search scratch, reused: a state counts only when stamped with this search's mark.
  private dist: Float32Array;
  private prev: Int32Array;
  private stamp: Int32Array;
  private mark = 0;
  private moves: Uint8Array;
  constructor(private s: CityState, private cross: Float32Array[]) {
    const N = s.size * s.size;
    this.dist = new Float32Array(N);
    this.prev = new Int32Array(N);
    this.stamp = new Int32Array(N);
    this.moves = moveMasks(s, cross);
  }

  /** Can a car drive from tile a to its neighbour b? */
  private canDrive(a: number, b: number): boolean {
    const n = this.s.size;
    const d = b - a;
    // The bit for coming into b from a: the direction from b back to a (DX/DY order).
    const back = d === 1 ? 1 : d === -1 ? 0 : d === n ? 3 : 2;
    return (this.moves[b]! & (1 << back)) !== 0;
  }

  /** The tiles driven home, given the morning's in order. */
  route(tiles: readonly number[]): number[] {
    const out: number[] = [];
    let i = tiles.length - 1;
    out.push(tiles[i]!);
    while (i > 0) {
      if (this.canDrive(tiles[i]!, tiles[i - 1]!)) {
        out.push(tiles[--i]!);
        continue;
      }
      // Against a one-way road: skip to where the way back is open again.
      let j = i - 1;
      while (j > 0 && !this.canDrive(tiles[j]!, tiles[j - 1]!)) j--;
      const way = this.detour(tiles[i]!, tiles[j]!);
      if (!way) return out; // no way home in reach: the rest isn't driven
      for (let k = 1; k < way.length; k++) out.push(way[k]!);
      i = j;
    }
    return out;
  }

  /** Shortest legal drive from tile a to tile b (a and b included), within a short reach. */
  private detour(a: number, b: number): number[] | null {
    const n = this.s.size;
    const key = a * n * n + b;
    const known = this.detours.get(key);
    if (known !== undefined) return known;
    const cross = this.cross[Mode.Car]!;
    const { dist, prev, stamp } = this;
    const mark = ++this.mark;
    stamp[a] = mark;
    dist[a] = 0;
    prev[a] = -1;
    const heap = new Heap();
    heap.push(0, a);
    let found = false;
    // A detour around a block or two, not across town.
    const reach = (Math.abs((a % n) - (b % n)) + Math.abs(Math.floor(a / n) - Math.floor(b / n)) + 16) * 8;
    while (heap.size) {
      const v = heap.pop();
      const d = heap.lastKey;
      if (d > dist[v]!) continue;
      if (v === b) {
        found = true;
        break;
      }
      if (d > reach) break;
      const x = v % n;
      const y = (v - x) / n;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k]!;
        const ny = y + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const u = ny * n + nx;
        if (!(cross[u]! > 0) || !this.canDrive(v, u)) continue;
        const nd = Math.fround(d + cross[u]!);
        if (stamp[u] !== mark || nd < dist[u]!) {
          stamp[u] = mark;
          dist[u] = nd;
          prev[u] = v;
          heap.push(nd, u);
        }
      }
    }
    let way: number[] | null = null;
    if (found) {
      way = [b];
      for (let v = b; v !== a; ) {
        v = prev[v]!;
        way.push(v);
      }
      way.reverse();
    }
    this.detours.set(key, way);
    return way;
  }
}

interface SearchOptions {
  modes: readonly number[];
  bias: readonly number[];
  transfers: Map<number, Transfer[]>;
  limit: number;
}

type SearchBuffers = Fields['searchPool'][number][number];

/**
 * Per tile, which neighbours (bit k: DX[k], DY[k]) a car may come from
 * (bits 0–3) and an upper-deck car may (bits 4–7): one-way roads, links,
 * overpasses and decks, worked out once per travel plan (keyed by its
 * crossing times) instead of at every step of every search.
 */
const MOVES = new WeakMap<Float32Array, Uint8Array>();
function moveMasks(s: CityState, cross: Float32Array[]): Uint8Array {
  return drain(moveMasksSteps(s, cross));
}

/** Direction-mask preparation yields on large maps and skips tiles no driving mode can enter. */
function* moveMasksSteps(s: CityState, cross: Float32Array[]): Generator<void, Uint8Array> {
  const key = cross[Mode.Car]!;
  let m = MOVES.get(key);
  if (m) return m;
  const n = s.size;
  m = new Uint8Array(n * n);
  for (let t = 0; t < n * n; t++) {
    if ((t & 0x7ff) === 0x7ff) yield;
    const ground = cross[Mode.Car]![t]! > 0 || cross[Mode.Bus]![t]! > 0;
    const high = cross[Mode.HighCar]![t]! > 0 || cross[Mode.HighBus]![t]! > 0;
    if (!ground && !high) continue;
    const x = t % n;
    const y = (t - x) / n;
    let bits = 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k]!;
      const ny = y + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const u = ny * n + nx;
      if (ground && carMove(s, u, t)) bits |= 1 << k;
      if (high && highMove(s, u, t)) bits |= 16 << k; // (into t from u, as for the ground)
    }
    m[t] = bits;
  }
  MOVES.set(key, m);
  return m;
}

/** Backward Dijkstra from destination states, bounded by `limit` real time (into `buf` if given). */
function search(s: CityState, cross: Float32Array[], sources: readonly [number, number][], o: SearchOptions, buf?: SearchBuffers): TravelSearch {
  return drain(searchSteps(s, cross, sources, o, buf));
}

/** `search` in steps: a pause every few thousand states settled (see ./steps). */
function* searchSteps(s: CityState, cross: Float32Array[], sources: readonly [number, number][], o: SearchOptions, buf?: SearchBuffers): Generator<void, TravelSearch> {
  const n = s.size;
  const moves = yield* moveMasksSteps(s, cross);
  const N = n * n;
  const size = MODES * N;
  let dist: Float32Array, time: Float32Array, next: Int32Array;
  if (buf) {
    ({ dist, time, next } = buf);
    dist.fill(INF);
    time.fill(INF);
    next.fill(-1);
  } else {
    dist = new Float32Array(size).fill(INF);
    time = new Float32Array(size).fill(INF);
    next = new Int32Array(size).fill(-1);
  }
  // Stations boarded: few states, so kept aside rather than in a per-state array.
  const via = new Map<number, [station: number, to: number]>();
  const allowed = new Uint8Array(MODES);
  for (const m of o.modes) allowed[m] = 1;
  // Keys are rounded to float32 like the stored distances, so stale entries compare exactly.
  const heap = new Heap();
  for (const [st, c] of sources) {
    if (!allowed[Math.floor(st / N)] || dist[st]! <= c) continue;
    dist[st] = c;
    time[st] = c;
    heap.push(Math.fround(c), st);
  }
  const joins = new Set(s.transitions);
  let settled = 0;
  while (heap.size) {
    if ((++settled & 0x7ff) === 0) yield;
    const v = heap.pop();
    const d = heap.lastKey;
    if (d > dist[v]!) continue;
    const tv = time[v]!;
    if (tv > o.limit) continue;
    const m = Math.floor(v / N);
    const t = v - m * N;
    const c = cross[m]![t]!;
    if (c > 0) {
      const road = m === Mode.Car || m === Mode.Bus;
      const high = m === Mode.HighCar || m === Mode.HighBus;
      const x = t % n;
      const y = (t - x) / n;
      const bc = c * o.bias[m]!;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k]!;
        const ny = y + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const u = ny * n + nx;
        if (!(cross[m]![u]! > 0)) continue;
        if (road && !(moves[t]! & (1 << k))) continue;
        if (high && !(moves[t]! & (16 << k))) continue;
        if (m === Mode.Subway && !trackJoins(s, t, u, joins)) continue;
        const su = m * N + u;
        const nd = Math.fround(d + bc);
        if (nd < dist[su]!) {
          dist[su] = nd;
          time[su] = tv + c;
          next[su] = v;
          heap.push(nd, su);
        }
      }
    }
    const into = o.transfers.get(v);
    if (into) {
      for (const [su, cost, station] of into) {
        if (!allowed[Math.floor(su / N)]) continue;
        if (station >= 0 && alightsAt(o.transfers, v, next[v]!, station)) continue;
        const nd = Math.fround(d + cost);
        if (nd < dist[su]!) {
          dist[su] = nd;
          time[su] = tv + cost;
          next[su] = v;
          if (station >= 0) via.set(su, [station, v]);
          heap.push(nd, su);
        }
      }
    }
  }
  return { dist, time, next, via, hasSources: sources.length > 0 };
}

/** A neighbouring city across this edge for ferries to sail to (not SimNation's open sea). */
function ferryCity(s: CityState, edge: number): boolean {
  const nb = s.neighbours[edge];
  return !!nb && nb.kind !== 'simnation';
}

/** Water a ferry can sail (not under a low bridge). */
function ferryWater(s: CityState, i: number): boolean {
  return s.terrain[i] === Terrain.Water && s.tunnel[i] !== SPAN.lowBridge;
}

function edgeTilesWhere(s: CityState, test: (i: number) => boolean): number[] {
  const n = s.size;
  const out: number[] = [];
  // Same row-major border order, touching each corner once; interior tiles cannot be connections.
  for (let y = 0; y < n; y++) {
    const step = y === 0 || y === n - 1 ? 1 : n - 1;
    for (let x = 0; x < n; x += step) {
      const i = y * n + x;
      if (test(i)) out.push(i);
    }
  }
  return out;
}

/** Map-edge tiles of networks that can be neighbour connections (not streets or onramps). */
export function connectionTiles(s: CityState): number[] {
  return edgeTilesWhere(s, (i) => {
    const code = s.net[i]!;
    return code === Net.Road || code === Net.Avenue || code === Net.Highway || isRail(code);
  });
}

function isJobSite(b: Building): boolean {
  return b.type !== null && b.type[0] !== 'R' && b.occupancy > 0;
}

/** A workplace for commuters: its frontage tiles and the jobs it offers. */
interface JobSite {
  /** The workplace's key in a home's job memory (building id, or structure id negated). */
  key: number;
  fronts: number[];
  jobs: number;
  /** The jobs by the wealth that fills them (the type's workforce profile). */
  byWealth: [number, number, number];
}

/**
 * Every workplace commuters can head for: occupied C/I buildings and civic
 * buildings with jobs (transit stops aside: their couple of jobs sit on
 * every line).
 */
function jobSites(s: CityState, f: Fields, cfg: SimConfig): JobSite[] {
  const out: JobSite[] = [];
  for (const b of s.buildings.values()) {
    if (!isJobSite(b)) continue;
    // Industry and farms may sit back from the road: their workers arrive by the driveway's road (as in tripTo).
    let fronts = frontage(s, b);
    if (!fronts.length) {
      const a = buildingAccess(s, f, b);
      if (a.road >= 0) fronts = [a.road];
    }
    const jobs = b.capacity * b.occupancy;
    const p = cfg.demand.workforceProfile[b.type as BusinessType];
    out.push({ key: b.id, fronts, jobs, byWealth: [jobs * p[0]!, jobs * p[1]!, jobs * p[2]!] });
  }
  for (const st of s.structures.values()) {
    const def = cfg.structures[st.kind];
    const profile = facilityJobs(def, st);
    const jobs = profile[0] + profile[1] + profile[2];
    if (jobs > 0 && !def.station) out.push({ key: -st.id, fronts: frontage(s, st), jobs, byWealth: [profile[0], profile[1], profile[2]] });
  }
  return out;
}

/** Jobs in neighbouring cities, past a road or highway connection (none beyond SimNation in strict mode). */
function remoteJobs(s: CityState, cfg: SimConfig): [number, number][] {
  const N = s.size * s.size;
  const out: [number, number][] = [];
  const away = neighbourCommute(s, cfg);
  const works = neighbourWorkEdges(s, cfg);
  for (let e = 0; e < 4; e++) if (!works[e]) away[e] = null; // (no job open there: no destination)
  // A connection on part of an edge facing an empty square leads to SimNation, not the city beside it.
  const n = s.size;
  const beyond = cfg.region.simNationJobs ? cfg.transport.connectionCommute : null;
  const tripFrom = (c: number): number | null | undefined => {
    const e = edgeOf(n, c);
    const shared = s.neighbours[e]?.shared;
    if (!shared?.length) return away[e];
    const p = e < 2 ? Math.floor(c / n) : c % n;
    return shared.some(([a, b]) => p >= a && p < b) ? away[e] : beyond;
  };
  // Roads and rail leaving the map: drive, or ride the train, to the neighbour.
  for (const c of connectionTiles(s)) {
    const t = tripFrom(c);
    if (t === null || t === undefined) continue;
    // A level crossing carries two independent exits, one for each network.
    if (s.net[c] !== Net.Rail) out.push([Mode.Car * N + c, t]);
    if (isRail(s.net[c]!)) out.push([Mode.Train * N + c, t]);
  }
  // Elevated highways, subways, elevated rail and monorails leaving the map are
  // connections too: commuters can ride them into a neighbouring city.
  const leaving = [
    [Mode.HighCar, (i: number) => s.elevated[i] === ELEVATED.highway],
    [Mode.Subway, (i: number) => s.subway[i] !== 0 || s.elevated[i] === ELEVATED.rail],
    [Mode.Monorail, (i: number) => s.elevated[i] === ELEVATED.monorail],
    // Ferries sail off the map to cities on the same water.
    [Mode.Ferry, (i: number) => ferryWater(s, i)],
    [Mode.CarFerry, (i: number) => ferryWater(s, i)],
  ] as const;
  for (const [mode, test] of leaving) {
    for (const c of edgeTilesWhere(s, test)) {
      if ((mode === Mode.Ferry || mode === Mode.CarFerry) && !ferryCity(s, edgeOf(s.size, c))) continue;
      const t = tripFrom(c);
      if (t !== null && t !== undefined) out.push([mode * N + c, t]);
    }
  }
  return out;
}

function siteSources(N: number, sites: readonly JobSite[], remote: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [...remote];
  for (const site of sites) for (const a of site.fronts) out.push([Mode.Walk * N + a, 0], [Mode.Car * N + a, 0]);
  return out;
}

const ALL_MODES = [Mode.Walk, Mode.Car, Mode.Bus, Mode.Train, Mode.Subway, Mode.Monorail, Mode.Ferry, Mode.CarFerry, Mode.HighCar, Mode.HighBus];

/** The three commuter searches (car only, transit-leaning, fastest) towards `jobs`. */
function* commuteSearches(
  s: CityState, cfg: SimConfig, cross: Float32Array[], jobs: [number, number][],
  t: { carTransfers: Map<number, Transfer[]>; allTransfers: Map<number, Transfer[]> }, buf: (k: number) => SearchBuffers, first: number,
  /** Only these strategies' searches (the fastest one, everyone's fallback, always); the others stand in as the fastest. */
  only?: ReadonlySet<'car' | 'transit' | 'fastest'>,
): Generator<void, { car: TravelSearch; transit: TravelSearch; fastest: TravelSearch }> {
  const tc = cfg.transport;
  const limit = tc.tripLimit;
  const fastest = (yield* searchSteps(s, cross, jobs, { modes: ALL_MODES, bias: ONE, transfers: t.allTransfers, limit }, buf(first + 1)));
  yield; // a pause between searches (see City.steps)
  // Car-only Sims may still drive onto a car ferry.
  const car = !only || only.has('car')
    ? (yield* searchSteps(s, cross, jobs, { modes: [Mode.Car, Mode.CarFerry, Mode.HighCar], bias: ONE, transfers: t.carTransfers, limit }, buf(first)))
    : fastest;
  yield;
  const b = tc.transitCarBias;
  const transit = !only || only.has('transit')
    ? (yield* searchSteps(s, cross, jobs, { modes: ALL_MODES, bias: [1, b, 1, 1, 1, 1, 1, 1, b, 1], transfers: t.allTransfers, limit }, buf(first + 2)))
    : fastest;
  return { car, transit, fastest };
}

/**
 * Subway and elevated rail share a layer but only meet at a
 * Subway-to-Elevated Transition. A tile carrying both kinds of track
 * passes trains either way.
 */
function trackJoins(s: CityState, a: number, b: number, joins: ReadonlySet<number>): boolean {
  const level = (i: number) => (s.subway[i] ? 1 : 0) | (s.elevated[i] === ELEVATED.rail ? 2 : 0);
  const la = level(a);
  const lb = level(b);
  return la === lb || la === 3 || lb === 3 || joins.has(a) || joins.has(b);
}

/** Search buffers of the current generation, made on first use. */
function bufferPool(f: Fields, N: number): (k: number) => SearchBuffers {
  const pool = f.searchPool[f.searchGen]!;
  const size = MODES * N;
  return (k) => {
    if (pool[k]?.dist.length !== size) {
      pool[k] = { dist: new Float32Array(size), time: new Float32Array(size), next: new Int32Array(size) };
    }
    return pool[k]!;
  };
}

/** Plans this month's travel: crossing times and the four searches. Runs when the network changes and at each month's first refresh. */
export function computeTravel(s: CityState, f: Fields, cfg: SimConfig): TravelFields {
  return drain(computeTravelSteps(s, f, cfg));
}

/** `computeTravel` in steps: a pause after each search (see City.steps). */
export function* computeTravelSteps(s: CityState, f: Fields, cfg: SimConfig): Generator<void, TravelFields> {
  const N = s.size * s.size;
  const tc = cfg.transport;
  const cross = yield* crossTimes(s, f, cfg);
  yield;

  // Destinations for commuters: every workplace's frontage, on foot or by car,
  // and jobs elsewhere in the region beyond a neighbour connection.
  const sites = jobSites(s, f, cfg);
  const remote = remoteJobs(s, cfg);
  const jobs = siteSources(N, sites, remote);
  yield;
  const edges = connectionTiles(s);
  const highEdges = edgeTilesWhere(s, (i) => s.elevated[i] === ELEVATED.highway);

  // Search arrays are kept on the fields and reused (the old plan isn't read while the new one is made).
  const buf = bufferPool(f, N);

  yield;
  const passenger = transfers(s, cfg, false);
  yield;
  const ramp = ramps(s, cross);
  yield;
  const ways = { carTransfers: merge(carFerries(passenger, N), ramp), allTransfers: merge(passenger, ramp) };
  const limit = tc.tripLimit;
  yield;
  const { car, transit, fastest } = yield* commuteSearches(s, cfg, cross, jobs, ways, buf, 0);
  yield;

  // Freight: trucks to a road or highway connection or a seaport, or onto
  // freight rail out of town or to a seaport. Airports count for industry's
  // freight time, but less than the others, so they start with a penalty;
  // no actual trips go there (trucks follow a search without them).
  const outs: [number, number][] = [];
  for (const c of edges) {
    if (s.net[c] !== Net.Rail) outs.push([Mode.Car * N + c, 0]);
    if (isRail(s.net[c]!)) outs.push([Mode.Train * N + c, 0]);
  }
  for (const c of highEdges) outs.push([Mode.HighCar * N + c, 0]);
  for (const st of s.structures.values()) {
    const def = cfg.structures[st.kind];
    if (!(cargoCapacity(def, st.funding)! > 0)) continue;
    if (def.airport) for (const a of frontage(s, st)) outs.push([Mode.Car * N + a, tc.airportFreightPenalty]);
    if (!def.seaport) continue;
    for (const a of frontage(s, st)) outs.push([Mode.Car * N + a, 0]);
    for (const t of perimeter(s, st)) if (isRail(s.net[t]!)) outs.push([Mode.Train * N + t, 0]);
  }
  const freightWays = { modes: [Mode.Car, Mode.Train, Mode.HighCar], bias: ONE, transfers: merge(transfers(s, cfg, true), ramp), limit };
  const freight = (yield* searchSteps(s, cross, outs, freightWays, buf(3)));
  yield;
  const airOuts = outs.filter(([, cost]) => cost > 0);
  const shipping = airOuts.length ? (yield* searchSteps(s, cross, outs.filter(([, cost]) => cost === 0), freightWays, buf(8))) : undefined;
  if (shipping) yield;

  // Per tile: fastest commute (walking or driving) and freight time, for desirability.
  f.commute.fill(INF);
  f.freight.fill(INF);
  for (let i = 0; i < N; i++) {
    const w = fastest.time[Mode.Walk * N + i]!;
    const c = fastest.time[Mode.Car * N + i]!;
    f.commute[i] = Math.min(w, c);
    f.freight[i] = freight.time[Mode.Car * N + i]!;
  }
  // And per wealth, to the jobs Sims of that wealth can take: what homes of each weigh.
  // One search at a time in a buffer the month's job finding reuses later.
  const allWays = { modes: ALL_MODES, bias: ONE, transfers: ways.allTransfers, limit };
  for (let w = 0; w < 3; w++) {
    const own = (yield* searchSteps(s, cross, siteSources(N, sites.filter((x) => x.byWealth[w]! > 0), remote), allWays, buf(4)));
    const field = f.commuteByWealth[w]!;
    for (let i = 0; i < N; i++) field[i] = Math.min(own.time[Mode.Walk * N + i]!, own.time[Mode.Car * N + i]!);
    yield;
  }
  return { cross, ...ways, car, transit, fastest, freight, ...(shipping ? { shipping } : {}) };
}

/** The station boarded at state v on the search's route (-1 if none). */
export function boardedAt(search: TravelSearch, v: number): number {
  const b = search.via.get(v);
  return b && b[1] === search.next[v] ? b[0] : -1;
}

/** Best origin state at a tile for a search (walking or driving), or -1. */
function origin(search: TravelSearch, N: number, tile: number, carOnly: boolean): number {
  const c = Mode.Car * N + tile;
  if (carOnly) return search.dist[c]! < INF ? c : -1;
  const w = Mode.Walk * N + tile;
  const best = search.dist[w]! <= search.dist[c]! ? w : c;
  return search.dist[best]! < INF ? best : -1;
}

/**
 * This month's trips as assigned (for the Route Query): who, how many, and
 * the route, the tiles packed into shared typed arrays.
 */
export class TripLog {
  from: number[] = [];
  amount: number[] = [];
  freight: boolean[] = [];
  /** The workplace a commuter's trip is to (its job-memory key; 0 for freight). */
  job: number[] = [];
  private start: number[] = [];
  private length: number[] = [];
  private tiles = new Int32Array(4096);
  private modes = new Uint8Array(4096);
  private used = 0;

  get count(): number {
    return this.from.length;
  }

  begin(from: number, amount: number, freight: boolean, job = 0): void {
    this.from.push(from);
    this.job.push(job);
    this.amount.push(amount);
    this.freight.push(freight);
    this.start.push(this.used);
  }

  /** The next state on the trip being logged (a change of means on the spot keeps one tile). */
  step(tile: number, mode: number): void {
    const begun = this.start[this.start.length - 1]!;
    if (this.used > begun && this.tiles[this.used - 1] === tile) {
      this.modes[this.used - 1] = mode;
      return;
    }
    if (this.used === this.tiles.length) {
      const tiles = new Int32Array(this.used * 2);
      tiles.set(this.tiles);
      this.tiles = tiles;
      const modes = new Uint8Array(this.used * 2);
      modes.set(this.modes);
      this.modes = modes;
    }
    this.tiles[this.used] = tile;
    this.modes[this.used++] = mode;
  }

  end(): void {
    this.length.push(this.used - this.start[this.start.length - 1]!);
  }

  /** Trip k's tiles and the mode on each. */
  route(k: number): { tiles: number[]; modes: number[] } {
    const a = this.start[k]!;
    const b = a + this.length[k]!;
    return { tiles: Array.from(this.tiles.subarray(a, b)), modes: Array.from(this.modes.subarray(a, b)) };
  }

  /** Does trip k change mode on or beside one of these tiles, without copying its route? */
  changesAt(k: number, tiles: ReadonlySet<number>): boolean {
    const a = this.start[k]!, end = a + this.length[k]!;
    for (let i = a + 1; i < end; i++) {
      if (this.modes[i] !== this.modes[i - 1] && (tiles.has(this.tiles[i]!) || tiles.has(this.tiles[i - 1]!))) return true;
    }
    return false;
  }

  /** Visits adjacent tiles where trip k changes mode, without copying its route. */
  visitChanges(k: number, visit: (fromTile: number, toTile: number, fromMode: number, toMode: number) => void): void {
    const a = this.start[k]!, end = a + this.length[k]!;
    for (let i = a + 1; i < end; i++) {
      if (this.modes[i] !== this.modes[i - 1]) visit(this.tiles[i - 1]!, this.tiles[i]!, this.modes[i - 1]!, this.modes[i]!);
    }
  }

  /** Does trip k cross tile t? */
  crosses(k: number, t: number): boolean {
    const a = this.start[k]!;
    return this.tiles.subarray(a, a + this.length[k]!).includes(t);
  }

  /** The tile trip k ends on. */
  last(k: number): number {
    return this.tiles[this.start[k]! + this.length[k]! - 1]!;
  }
}

/** Traffic Volume Graph lines. */
export const VOLUME_KINDS = ['pedestrian', 'car', 'bus', 'subway', 'passengerTrain', 'freightTrain', 'freightTruck', 'ferry', 'monorail'] as const;
export type VolumeKind = (typeof VOLUME_KINDS)[number];

export interface TrafficResult {
  freightTrips: number;
  fares: number;
  tolls: number;
  /** Trips this month by kind: commuters by the means they took, freight by truck or train. */
  volume: Record<VolumeKind, number>;
}

/** The kind a trip counts as, from the modes along it (transit wins over the walk or drive to it). */
function volumeKind(seen: number, freight: boolean): VolumeKind {
  const has = (m: number) => (seen & (1 << m)) !== 0;
  if (freight) return has(Mode.Train) ? 'freightTrain' : 'freightTruck';
  if (has(Mode.Ferry) || has(Mode.CarFerry)) return 'ferry';
  if (has(Mode.Monorail)) return 'monorail';
  if (has(Mode.Subway)) return 'subway';
  if (has(Mode.Train)) return 'passengerTrain';
  if (has(Mode.Bus) || has(Mode.HighBus)) return 'bus';
  if (has(Mode.Car) || has(Mode.HighCar)) return 'car';
  return 'pedestrian';
}

/** Commuters from one home by one strategy, heading for the nearest job. */
interface CommuteFlow {
  /** The home's building id. */
  home: number;
  road: number;
  extra: number;
  strategy: 'car' | 'transit' | 'fastest';
  search: TravelSearch;
  start: number;
  amount: number;
  /** The commuters' wealth: they take jobs of the same wealth. */
  wealth: 0 | 1 | 2;
  /** Where the route last led (set once the flow has looked for a job). */
  end?: number;
}

/** A road network's jobs count as all taken when no more than this share is left open. */
const JOBS_FULL = 0.05;

/** Tiles from a full workplace within which commuters left without a job take the nearest open one. */
const SPILL = 32;

/** Jobs a workplace must have open to draw commuters' searches (less can still take one spilling over). */
const OPEN_MIN = 0.5;

/** Months between a home's reviews of jobs held in another wealth's openings (routes are reworked about every four months). */
const JOB_REVIEW_MONTHS = 4;

/** Job-memory key of a neighbour's jobs past edge e: JOB_EDGE + e. */
export const JOB_EDGE = 1e9;

/**
 * Sends commuters to work, filling each workplace only up to its jobs of
 * their wealth (a Sim takes the nearest open job of their own wealth):
 * jobs held from last month first, then the nearest commuters claim the
 * closest open jobs, each going on to the next closest when a workplace
 * fills (nearestOpenJobs). Any still without one take the nearest open job
 * near where their planned trip led, their own wealth first, then any (a
 * small city's richer Sims would otherwise have nowhere to work); the rest
 * stay home this month. A developed neighbour has only its open jobs to
 * give; others never fill.
 */
function* commuteToJobs(
  s: CityState, f: Fields, cfg: SimConfig, flows: CommuteFlow[],
  go: (search: TravelSearch, start: number, amount: number, from: number, job: number) => void,
): Generator<void, void> {
  const tr = f.travel!;
  const N = s.size * s.size;
  const limit = cfg.transport.tripLimit;
  const sites = jobSites(s, f, cfg);
  // Open jobs per site and wealth (site k, wealth w at k * 3 + w).
  const left = new Float64Array(sites.length * 3);
  sites.forEach((x, k) => {
    for (let w = 0; w < 3; w++) left[k * 3 + w] = x.byWealth[w]!;
  });
  yield;
  const openAt = (k: number) => left[k * 3]! + left[k * 3 + 1]! + left[k * 3 + 2]!;
  /** Takes up to `x` of site k's open jobs for wealth w; returns how many. */
  const takeJobs = (k: number, w: number, x: number): number => {
    const i = k * 3 + w;
    const was = left[i]!;
    const take = Math.min(x, was);
    if (take <= 0) return 0;
    left[i] = was - take;
    return take;
  };
  const at = new Map<number, number[]>();
  sites.forEach((site, k) => {
    for (const a of site.fronts) {
      for (const v of [Mode.Walk * N + a, Mode.Car * N + a]) {
        const list = at.get(v);
        if (list) list.push(k);
        else at.set(v, [k]);
      }
    }
  });
  yield;
  const destination = (search: TravelSearch, start: number): number => {
    let v = start;
    for (let guard = MODES * N; guard > 0; guard--) {
      const nx = search.next[v]!;
      if (nx < 0) return v;
      v = nx;
    }
    return v;
  };
  // Per home: commuters setting out, and those who found a job.
  const setOut = new Map<number, number>();
  const placed = new Map<number, number>();
  for (const fl of flows) setOut.set(fl.home, (setOut.get(fl.home) ?? 0) + fl.amount);
  const found = (fl: CommuteFlow, amount: number) => placed.set(fl.home, (placed.get(fl.home) ?? 0) + amount);
  // Each home's commuters' trip times as they go (weighted by how many take each).
  const tripTime = new Map<number, number>();
  // Trips to jobs in town alone (what a neighbour remembers of a trip into this city).
  let localSum = 0;
  let localSims = 0;
  /** Sends commuters along a route to a workplace (traffic, logged) and notes how long their trip takes. */
  const trip = (fl: CommuteFlow, search: TravelSearch, start: number, amount: number, job: number) => {
    go(search, start, amount, fl.home, job);
    const time = search.time[start]! + fl.extra;
    tripTime.set(fl.home, (tripTime.get(fl.home) ?? 0) + time * amount);
    if (!away.has(destination(search, start))) {
      localSum += time * amount;
      localSims += amount;
    }
  };
  // Nearby sites to spill over to once the rounds are done: open sites on the
  // same road network within SPILL tiles, nearest first (the route to the full
  // site stands in for the last stretch). Sites bucketed by 8-tile cells.
  const n = s.size;
  const CELL = 8;
  const cells = Math.ceil(n / CELL);
  const bucket: number[][] = Array.from({ length: cells * cells }, () => []);
  const siteAt = sites.map((site) => site.fronts[0] ?? -1);
  siteAt.forEach((t, k) => {
    if (t >= 0) bucket[Math.floor(Math.floor(t / n) / CELL) * cells + Math.floor((t % n) / CELL)]!.push(k);
  });
  const nearby = new Map<number, number[]>();
  const spillTo = (k: number): number[] => {
    let list = nearby.get(k);
    if (list) return list;
    const t = siteAt[k]!;
    list = [];
    if (t >= 0) {
      const x = t % n;
      const y = Math.floor(t / n);
      const comp = f.component[t]!;
      const r = Math.ceil(SPILL / CELL);
      const cx = Math.floor(x / CELL);
      const cy = Math.floor(y / CELL);
      const found: [number, number][] = [];
      for (let by = Math.max(0, cy - r); by <= Math.min(cells - 1, cy + r); by++) {
        for (let bx = Math.max(0, cx - r); bx <= Math.min(cells - 1, cx + r); bx++) {
          for (const j of bucket[by * cells + bx]!) {
            const u = siteAt[j]!;
            const d = Math.max(Math.abs((u % n) - x), Math.abs(Math.floor(u / n) - y));
            if (j !== k && d <= SPILL && f.component[u] === comp) found.push([j, d]);
          }
        }
      }
      found.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      list = found.map(([j]) => j);
    }
    nearby.set(k, list);
    return list;
  };
  yield;
  let remote = remoteJobs(s, cfg);
  const away = new Set(remote.map(([v]) => v));
  const edgeLeft = neighbourOpenJobs(s, cfg);
  const edgeAt = (v: number) => edgeOf(n, v % N);
  // Commuters who found nothing: where their search last led (for the jobless check).
  const gaveUp: CommuteFlow[] = [];
  // Where each home's workers found jobs this month (kept as its job memory).
  const held = new Map<number, Map<number, number>>();
  const hold = (home: number, key: number, amount: number) => {
    let m = held.get(home);
    if (!m) held.set(home, (m = new Map()));
    m.set(key, (m.get(key) ?? 0) + amount);
  };
  /**
   * Takes jobs at the sites near site k (and at k itself when `here`), for
   * wealth w only or (w < 0) any but the commuters' own; returns those left.
   */
  const takeNear = (fl: CommuteFlow, need: number, w: number, here: boolean): number => {
    for (const k of at.get(fl.end!) ?? []) {
      for (const j of here ? [k, ...spillTo(k)] : spillTo(k)) {
        let got = 0;
        for (let v = 0; v < 3 && need > 1e-6; v++) {
          if (w >= 0 ? v !== w : v === fl.wealth) continue;
          const take = takeJobs(j, v, need);
          need -= take;
          got += take;
        }
        if (got > 0) {
          hold(fl.home, sites[j]!.key, got);
          // Logged as a trip to the workplace that took them (by the route in hand).
          trip(fl, fl.search, fl.start, got, sites[j]!.key);
        }
      }
    }
    return need;
  };
  /**
   * No job of their wealth is left where their search leads: take one of
   * their wealth open nearby (the route in hand stands in for the last
   * stretch). Returns those still without, to try any wealth once every
   * wealth has looked.
   */
  const spillOwn = (fl: CommuteFlow): CommuteFlow | null => {
    const need = takeNear(fl, fl.amount, fl.wealth, false);
    if (fl.amount - need > 0) found(fl, fl.amount - need);
    gaveUp.push(fl);
    return need > 1e-6 ? { ...fl, amount: need } : null;
  };
  /** Any wealth's job nearby (a small city's richer Sims would otherwise have nowhere to work); the rest may try a neighbour city. */
  const spillAny = (fl: CommuteFlow) => {
    const need = takeNear(fl, fl.amount, -1, true);
    if (fl.amount - need > 0) found(fl, fl.amount - need);
  };
  // Jobs held from last month (Rush Hour: Sims stay in a job until something
  // makes them leave it): a home's workers go back to the
  // workplaces they had while those still stand, can be reached in time and
  // have jobs open; every fourth month (staggered by home) only jobs of their
  // own wealth are kept, so a spill-over job in another's opening is given up.
  yield;
  const siteOf = new Map<number, number>();
  sites.forEach((x, k) => siteOf.set(x.key, k));
  const byHome = new Map<number, CommuteFlow[]>();
  for (const fl of flows) {
    const list = byHome.get(fl.home);
    if (list) list.push(fl);
    else byHome.set(fl.home, [fl]);
  }
  // Homes holding jobs this month and what they hold.
  const memory = new Map<number, Map<number, number>>();
  const heldSites = new Set<number>();
  const heldEdges = new Set<number>();
  yield;
  let remembered = 0;
  for (const home of byHome.keys()) {
    if ((++remembered & 0x3ff) === 0) yield;
    const mem = s.buildings.get(home)?.jobs;
    // (Held at the route's review too: the Sim stays in the job and just switches to the faster route
    // there; only a job that can't be reached in time is given up. Looking afresh every four
    // months moved whole neighbourhoods to new jobs.)
    if (!mem?.length) continue;
    const m = new Map<number, number>();
    for (let i = 0; i + 1 < mem.length; i += 2) {
      const key = mem[i]!;
      if (key >= JOB_EDGE) {
        if (!remote.some(([v]) => edgeAt(v) === key - JOB_EDGE)) continue;
        heldEdges.add(key - JOB_EDGE);
      } else {
        const k = siteOf.get(key);
        if (k === undefined) continue;
        heldSites.add(k);
      }
      m.set(key, mem[i + 1]!);
    }
    if (m.size) memory.set(home, m);
  }
  /** Commuters on a route ending at one of their home's held workplaces keep those jobs; returns how many. */
  const keep = (fl: CommuteFlow, m: Map<number, number>, search: TravelSearch, start: number): number => {
    const end = destination(search, start);
    let take = 0;
    if (away.has(end)) {
      const e = edgeAt(end);
      const key = JOB_EDGE + e;
      take = Math.min(fl.amount, m.get(key) ?? 0, edgeLeft[e]!);
      if (take > 1e-9) {
        edgeLeft[e]! -= take;
        m.set(key, m.get(key)! - take);
        hold(fl.home, key, take);
        trip(fl, search, start, take, key);
      } else take = 0;
    } else {
      for (const k of at.get(end) ?? []) {
        const key = sites[k]!.key;
        let got = 0;
        // A job held is kept whichever wealth's opening it was (one taken in the spill-over too), but at the
        // home's review (every four months) only one of their own wealth: a spill-over job of
        // another wealth was held for good, while their own went begging.
        const review = (fl.home + Math.floor(s.day / 30)) % JOB_REVIEW_MONTHS === 0;
        for (const w of review ? [fl.wealth] : [fl.wealth, 0, 1, 2]) {
          if (Math.min(fl.amount - take, m.get(key) ?? 0, left[k * 3 + w]!) <= 1e-9) continue;
          const part = takeJobs(k, w, Math.min(fl.amount - take, m.get(key) ?? 0));
          m.set(key, m.get(key)! - part);
          take += part;
          got += part;
        }
        if (got > 0) {
          hold(fl.home, key, got);
          trip(fl, search, start, got, key);
        }
      }
    }
    if (take > 1e-9) {
      found(fl, take);
      fl.amount -= take;
    }
    return take;
  };
  // Most keep their job on this month's planned route; only homes whose
  // route now leads elsewhere need routes to the held workplaces (one search
  // for them all). One led elsewhere even then (a held workplace nearer, a
  // road cut) looks afresh.
  const unmatched: [number, Map<number, number>][] = [];
  let homes = 0;
  for (const [home, m] of memory) {
    if ((++homes & 0x1ff) === 0) yield;
    let rest = false;
    for (const fl of byHome.get(home)!) {
      keep(fl, m, fl.search, fl.start);
      if (fl.amount > 1e-6) rest = true;
    }
    if (rest && [...m.values()].some((v) => v > 1e-6)) unmatched.push([home, m]);
  }
  if (unmatched.length) {
    const toHeld = yield* commuteSearches(
      s, cfg, tr.cross, siteSources(N, [...heldSites].map((k) => sites[k]!), remote.filter(([v]) => heldEdges.has(edgeAt(v)))),
      tr, bufferPool(f, N), 4,
    );
    yield;
    for (const [home, m] of unmatched) {
      if ((++homes & 0x1ff) === 0) yield;
      for (const fl of byHome.get(home)!) {
        if (fl.amount <= 1e-6) continue;
        let search = toHeld[fl.strategy];
        let start = origin(search, N, fl.road, fl.strategy === 'car');
        if (start < 0 || search.time[start]! + fl.extra > limit) {
          search = toHeld.fastest;
          start = origin(search, N, fl.road, false);
        }
        if (start >= 0 && search.time[start]! + fl.extra <= limit) keep(fl, m, search, start);
      }
    }
  }
  // Each wealth looks for jobs of its own (jobs are matched by wealth
  // level), the nearest commuters first, each going on to
  // the next closest workplace with jobs when one fills (nearestOpenJobs);
  // the jobs of a neighbour city past a connection count too. Car-only Sims
  // search by car, transit riders by transit; who found nothing that way
  // tries any means. Still without a job, they take one of their wealth
  // nearby, and any wealth's once every wealth has looked.
  yield;
  const label = new Int32Array(MODES * N);
  const buf = bufferPool(f, N)(4);
  const b = cfg.transport.transitCarBias;
  const ways = {
    car: { modes: [Mode.Car, Mode.CarFerry, Mode.HighCar], bias: ONE, transfers: tr.carTransfers, limit },
    transit: { modes: ALL_MODES, bias: [1, b, 1, 1, 1, 1, 1, 1, b, 1], transfers: tr.allTransfers, limit },
    fastest: { modes: ALL_MODES, bias: ONE, transfers: tr.allTransfers, limit },
  } as const;
  const remoteByEdge = new Map<number, [number, number][]>();
  for (const r of remote) {
    const e = edgeAt(r[0]);
    const l = remoteByEdge.get(e);
    if (l) l.push(r);
    else remoteByEdge.set(e, [r]);
  }
  const riding = [...s.structures.values()].some((st) => {
    const m = cfg.structures[st.kind].station?.mode;
    return m !== undefined && m !== 'freight';
  });
  const deferred: CommuteFlow[] = [];
  for (const w of [0, 1, 2] as const) {
    const group = flows.filter((fl) => fl.wealth === w && fl.amount > 1e-6);
    if (!group.length) continue;
    const targets: (JobTarget & { key: number })[] = [];
    sites.forEach((site, k) => {
      if (left[k * 3 + w]! < OPEN_MIN) return;
      const sources: [number, number][] = [];
      for (const a of site.fronts) sources.push([Mode.Walk * N + a, 0], [Mode.Car * N + a, 0]);
      targets.push({ key: site.key, sources, open: () => left[k * 3 + w]!, take: (x) => takeJobs(k, w, x) });
    });
    for (const [e, sources] of remoteByEdge) {
      targets.push({
        key: JOB_EDGE + e, sources, open: () => edgeLeft[e]!,
        take: (x) => {
          const got = Math.min(x, edgeLeft[e]!);
          edgeLeft[e]! -= got;
          return got;
        },
      });
    }
    yield;
    // Searching by car first, then by transit, would hand drivers the closest
    // jobs everywhere: each of those passes may take only its share of each
    // workplace's jobs (as its commuters are of all), the last one the rest.
    const total = group.reduce((a, fl) => a + fl.amount, 0);
    const base = targets.map((tg) => tg.open());
    for (const way of ['car', 'transit', 'fastest'] as const) {
      // The fastest search also takes those the car or transit one couldn't
      // place, and transit riders where there is no transit to ride (their
      // search would only weigh the same walks and drives).
      if (way === 'transit' && !riding) continue;
      const list = group.filter((fl) => fl.amount > 1e-6 && (way === 'fastest' || fl.strategy === way));
      if (!list.length || !targets.length) continue;
      const share = way === 'fastest' ? 1 : list.reduce((a, fl) => a + fl.amount, 0) / total;
      const quota = base.map((b) => b * share);
      const passTargets: JobTarget[] = way === 'fastest' ? targets : targets.map((tg, k) => ({
        sources: tg.sources,
        open: () => Math.min(tg.open(), quota[k]!),
        take: (x) => {
          const got = tg.take(Math.min(x, quota[k]!));
          quota[k]! -= got;
          return got;
        },
      }));
      const waiting = new Map<number, (Waiting & { fl: CommuteFlow })[]>();
      for (const fl of list) {
        const wt = { need: fl.amount, extra: fl.extra, fl };
        const starts = way === 'car' ? [Mode.Car * N + fl.road] : [Mode.Walk * N + fl.road, Mode.Car * N + fl.road];
        for (const st of starts) {
          const l = waiting.get(st);
          if (l) l.push(wt);
          else waiting.set(st, [wt]);
        }
      }
      yield;
      yield* nearestOpenJobs(s, tr.cross, passTargets, waiting, ways[way], buf, label, (wt, k, amount, route, start) => {
        const fl = (wt as Waiting & { fl: CommuteFlow }).fl;
        trip(fl, route, start, amount, targets[k]!.key);
        found(fl, amount);
        hold(fl.home, targets[k]!.key, amount);
      });
      for (const l of waiting.values()) for (const wt of l) wt.fl.amount = wt.need;
    }
    // Still without a job of their wealth: one nearby (the month's first planned trip stands in).
    yield;
    let spilt = 0;
    for (const fl of group) {
      if (fl.amount <= 1e-6) continue;
      if ((++spilt & 0x1ff) === 0) yield;
      const rest = spillOwn({ ...fl, end: destination(fl.search, fl.start) });
      if (rest) deferred.push(rest);
    }
  }
  yield;
  for (let k = 0; k < deferred.length; k++) {
    if ((k & 0x1ff) === 0x1ff) yield;
    spillAny(deferred[k]!);
  }
  yield;
  // Each home remembers where its workers work, for next month (an emptied home forgets).
  for (const b of s.buildings.values()) if (b.jobs && !byHome.has(b.id)) delete b.jobs;
  let saved = 0;
  for (const home of byHome.keys()) {
    if ((++saved & 0x3ff) === 0) yield;
    const b = s.buildings.get(home);
    if (!b) continue;
    const m = held.get(home);
    if (!m) {
      delete b.jobs;
      continue;
    }
    const keys = [...m.keys()].sort((a, c) => a - c);
    b.jobs = keys.flatMap((key) => [key, Math.round(m.get(key)! * 1000) / 1000]);
  }
  yield;
  // A home is short of jobs only when the road networks it looked on (its own,
  // and where its last search led, e.g. downtown by subway) have (almost) no
  // jobs left open: commuters who merely lost the race to nearer homes would find one.
  const offered = new Map<number, number>();
  const open = new Map<number, number>();
  sites.forEach((site, k) => {
    const comps = new Set(site.fronts.map((t) => f.component[t]!));
    for (const c of comps) {
      offered.set(c, (offered.get(c) ?? 0) + site.jobs);
      open.set(c, (open.get(c) ?? 0) + openAt(k));
    }
  });
  const full = (c: number) => (open.get(c) ?? 0) <= JOBS_FULL * (offered.get(c) ?? 0);
  const looked = new Map<number, number[]>();
  for (const fl of flows) looked.set(fl.home, [f.component[fl.road]!]);
  for (const fl of gaveUp) looked.get(fl.home)?.push(f.component[fl.end! % N]!);
  // A home's commute is the trips its workers make (to the jobs they got), not
  // the nearest workplace's; homes nobody left from keep the fastest trip out.
  for (const [home, sum] of tripTime) {
    const b = s.buildings.get(home);
    const p = placed.get(home) ?? 0;
    if (b && p > 0) b.commute = sum / p;
  }
  f.localCommute = localSims > 0 ? localSum / localSims : -1;
  f.jobless.clear();
  for (const [home, total] of setOut) {
    const share = 1 - (placed.get(home) ?? 0) / total;
    if (total > 0 && share > 1e-6 && looked.get(home)!.every(full)) f.jobless.set(home, share);
  }
}

/**
 * Sends this month's commuters and freight along their planned routes:
 * per-tile volumes (cars and trucks on asphalt, trains on rail, subway
 * riders), station boardings, fares and each building's trip time.
 */
export function assignTraffic(s: CityState, f: Fields, cfg: SimConfig, opts: { smoothing?: number } = {}): TrafficResult {
  return drain(assignTrafficSteps(s, f, cfg, opts));
}


/** `assignTraffic` in steps: it pauses now and then (see City.steps). */
export function* assignTrafficSteps(s: CityState, f: Fields, cfg: SimConfig, opts: { smoothing?: number } = {}): Generator<void, TrafficResult> {
  const N = s.size * s.size;
  const tc = cfg.transport;
  const tr = f.travel;
  // Last month's volumes (what the map shows), blended with this month's at the end.
  const volumes = [f.traffic, f.railTraffic, f.freightRail, f.subwayTraffic, f.monorailTraffic, f.ferryTraffic, f.highTraffic];
  const alpha = opts.smoothing ?? 1;
  // This month's, built apart: while the work pauses the map keeps last month's whole.
  const fresh = volumes.map((a) => new Float32Array(a.length));
  const [traffic, railTraffic, freightRail, subwayTraffic, monorailTraffic, ferryTraffic, highTraffic] = fresh as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
  const ports = new Map<number, number>();
  // Stations' and garages' riders last month, to blend this month's into (as the volumes).
  const riders = new Map<number, number>();
  for (const st of s.structures.values()) {
    const def = cfg.structures[st.kind];
    if (alpha < 1 && (def.station || def.parking)) riders.set(st.id, st.load);
    if (def.station || def.seaport || def.parking) st.load = 0;
    if (!def.seaport || !(cargoCapacity(def, st.funding)! > 0)) continue;
    for (const a of frontage(s, st)) ports.set(Mode.Car * N + a, st.id);
    for (const t of perimeter(s, st)) if (isRail(s.net[t]!)) ports.set(Mode.Train * N + t, st.id);
  }
  if (!tr) {
    for (const a of volumes) a.fill(0); // no plan, no trips
    return { freightTrips: 0, fares: 0, tolls: 0, volume: Object.fromEntries(VOLUME_KINDS.map((k) => [k, 0])) as Record<VolumeKind, number> };
  }
  const ord = ordinanceEffects(s);
  let fareTiles = 0;
  let freightTrips = 0;

  /** Walks a planned route adding its volumes; returns the destination state. */
  const volume = Object.fromEntries(VOLUME_KINDS.map((k) => [k, 0])) as Record<VolumeKind, number>;
  // The evening commute goes home the same way, except where one-way roads
  // won't let it (a one-way network must still let every trip get back):
  // there it takes the shortest way round. Where that differs, it is tallied
  // apart, and each tile carries the busier of the two rush hours.
  const log = new TripLog();
  f.tripLog = log;
  const oneways = s.oneway.some((d) => d !== 0);
  const evening = oneways ? new Float32Array(N) : null;
  // Commuters' cars in the morning (the evening's on two-way roads: freight goes out in the morning only).
  const commuterCars = new Float32Array(N);
  /** Freight trucks per tile (ground, elevated): they pay a toll once, going out in the morning only. */
  const trucks = new Float32Array(N);
  const highTrucks = new Float32Array(N);
  const home = evening ? new ReturnTrip(s, tr.cross) : null;
  /** A morning stretch of road driven back in the evening (tiles in morning order). */
  const driveBack = (tiles: number[], amount: number) => {
    for (const t of home!.route(tiles)) evening![t]! += amount;
  };
  const follow = (search: TravelSearch, start: number, amount: number, carShare: number, fare: boolean, from: number, job = 0): number => {
    let v = start;
    let last = start;
    let guard = MODES * N;
    let seen = 0;
    log.begin(from, amount, !fare, job);
    let drive: number[] | null = evening && fare ? [] : null;
    while (v >= 0 && guard-- > 0) {
      last = v;
      const m = Math.floor(v / N);
      const t = v - m * N;
      seen |= 1 << m;
      if (drive) {
        if (m === Mode.Car) drive.push(t);
        else if (drive.length) {
          driveBack(drive, amount * carShare);
          drive = [];
        }
      }
      log.step(t, m);
      if (m === Mode.Car && fare) commuterCars[t]! += amount * carShare;
      if (m === Mode.Car) traffic[t]! += amount * carShare;
      else if (m === Mode.Train) {
        railTraffic[t]! += amount;
        if (!fare) freightRail[t]! += amount;
      }
      else if (m === Mode.Subway) subwayTraffic[t]! += amount;
      else if (m === Mode.Monorail) monorailTraffic[t]! += amount;
      else if (m === Mode.Ferry || m === Mode.CarFerry) ferryTraffic[t]! += amount;
      else if (m === Mode.HighCar) highTraffic[t]! += amount * carShare;
      if (!fare && m === Mode.Car) trucks[t]! += amount * carShare;
      else if (!fare && m === Mode.HighCar) highTrucks[t]! += amount * carShare;
      if (fare && ((m >= Mode.Bus && m <= Mode.Monorail) || m === Mode.HighBus)) fareTiles += amount;
      const station = boardedAt(search, v);
      if (station >= 0) {
        const st = s.structures.get(station);
        if (st) st.load += amount;
      }
      v = search.next[v]!;
    }
    if (drive?.length) driveBack(drive, amount * carShare);
    log.end();
    volume[volumeKind(seen, !fare)] += amount;
    return last;
  };

  const flows: CommuteFlow[] = [];
  let seen = 0;
  for (const b of s.buildings.values()) {
    if ((++seen & 0xff) === 0) yield;
    if (!b.type) continue;
    const a = buildingAccess(s, f, b);
    if (a.road < 0) {
      b.commute = -1;
      continue;
    }
    // Lots set back from the road reach it along a short driveway.
    const extra = a.dist * tc.speed.street.car;
    if (b.type[0] === 'R') {
      const fast = origin(tr.fastest, N, a.road, false);
      b.commute = fast >= 0 ? tr.fastest.time[fast]! + extra : -1;
      for (const c of commuters(s, cfg, tr, b, a, ord.transitShare)) {
        const strategy = c.search === tr.car ? 'car' : c.search === tr.transit ? 'transit' : 'fastest';
        flows.push({ home: b.id, road: a.road, extra, strategy, search: c.search, start: c.start, amount: c.amount, wealth: cfg.demand.wealthOf[b.type] });
      }
    } else if (b.type[0] === 'I') {
      const start = origin(tr.freight, N, a.road, true);
      const time = start >= 0 ? tr.freight.time[start]! + extra : INF;
      b.commute = time < INF ? time : -1;
      const trips = b.filled * cfg.demand.freightTripsPerJob;
      // Only shipments that reach a connection in time count; shipping
      // by air is theoretical (no trucks), so trucks follow the search without airports.
      const ship = tr.shipping ?? tr.freight;
      const from = ship === tr.freight ? start : origin(ship, N, a.road, true);
      const shipTime = from >= 0 ? ship.time[from]! + extra : INF;
      if (trips > 0 && shipTime <= tc.tripLimit) {
        const end = follow(ship, from, b.filled * tc.freightTraffic, ord.traffic, false, b.id); // (trucks carpool too: the 20% cut applies to all traffic)
        // Trips to a seaport count there (its relief is capped); the rest reach a connection.
        const port = ports.get(end);
        const st = port !== undefined ? s.structures.get(port) : undefined;
        if (st) st.load += trips;
        else freightTrips += trips;
      }
    } else b.commute = -1;
  }
  yield;
  yield* commuteToJobs(s, f, cfg, flows, (search, start, amount, from, job) => follow(search, start, amount, ord.traffic, true, from, job));
  // Fares: §0.001 per tile ridden, §0.01 a ferry trip, there and back; tolls §0.10 a car each way.
  let ferryTrips = 0;
  for (const st of s.structures.values()) {
    const m = cfg.structures[st.kind].station?.mode;
    if (m === 'ferry' || m === 'carFerry') ferryTrips += st.load;
  }
  yield;
  // Tolls: a road booth charges each car that passes it, the morning commuters and the evening ones
  // (counted apart: one-way roads may send the drive home another way) and the trucks once; an
  // elevated booth charges its commuters there and back, its trucks once.
  let tolls = 0;
  for (let i = 0; i < N; i++) {
    if (!s.tolls[i]) continue;
    tolls += (s.tolls[i] === 2
      ? (highTraffic[i]! - highTrucks[i]!) * 2 + highTrucks[i]!
      : commuterCars[i]! + (evening ? evening[i]! : commuterCars[i]!) + trucks[i]!) * tc.toll.fare;
  }
  if (evening) for (let i = 0; i < N; i++) if (evening[i]! > traffic[i]!) traffic[i] = evening[i]!;
  f.eveningTraffic = evening ?? commuterCars;
  // The volumes routes are planned on (and the map shows) average this
  // month's into the months before (method of successive averages): when
  // all-or-nothing route choice sends everyone off a jammed road at once,
  // its congestion fades rather than flipping to the next road and back.
  volumes.forEach((a, k) => {
    const now = fresh[k]!;
    if (alpha < 1) for (let i = 0; i < N; i++) a[i] = a[i]! + alpha * (now[i]! - a[i]!);
    else a.set(now);
  });
  // Likewise the riders an overloaded station's wait is planned on: otherwise
  // all leave a full stop at once, and come back the month after.
  for (const [id, old] of riders) {
    const st = s.structures.get(id)!;
    st.load = old + alpha * (st.load - old);
  }
  // To industry a seaport is one more connection, its relief capped: the shipments past its cap
  // still leave town, and count as a connection's (a port nearer than the map edge capped industry at 650).
  for (const id of new Set(ports.values())) {
    const st = s.structures.get(id);
    const sp = st && cfg.structures[st.kind].seaport;
    if (!st || !sp) continue;
    const full = (sp.relief * Math.min(1.2, st.funding / 100)) / sp.perTrip;
    if (st.load > full) freightTrips += st.load - full;
  }
  return { freightTrips, fares: fareTiles * tc.farePerTile * 2 + ferryTrips * tc.ferryFare * 2, tolls, volume };
}

/**
 * The month's trips as the traffic model would assign them now, for the
 * Route Query of a city whose log is gone (one just loaded): the assignment
 * runs and everything it changes is put back, the log aside.
 */
export function replayTrips(s: CityState, f: Fields, cfg: SimConfig): TripLog | null {
  if (!f.travel) return null;
  const arrays = [f.traffic, f.railTraffic, f.freightRail, f.subwayTraffic, f.monorailTraffic, f.ferryTraffic, f.highTraffic];
  const copies = arrays.map((a) => Float32Array.from(a));
  const loads = [...s.structures.values()].map((st) => st.load);
  const homes = [...s.buildings.values()].map((b) => [b.commute, b.jobs, Object.hasOwn(b, 'jobs')] as const);
  const { localCommute, eveningTraffic } = f;
  const jobless = new Map(f.jobless);
  assignTraffic(s, f, cfg);
  const log = f.tripLog;
  arrays.forEach((a, k) => a.set(copies[k]!));
  [...s.structures.values()].forEach((st, k) => (st.load = loads[k]!));
  [...s.buildings.values()].forEach((b, k) => {
    const [commute, jobs, hadJobs] = homes[k]!;
    b.commute = commute;
    if (hadJobs) b.jobs = jobs;
    else delete b.jobs; // adding an undefined key would change the saved building table's columns
  });
  Object.assign(f, { localCommute, eveningTraffic, jobless, tripLog: log });
  return log;
}

/**
 * Assign office demand to reachable airports without exceeding shared capacity.
 * An office's demand is counted once; funding scales capacity up to 120%.
 */
export function airportReach(s: CityState, f: Fields, cfg: SimConfig): void {
  drain(airportReachSteps(s, f, cfg));
}

/** Airport catchments and capacity allocation, with pauses during route searches. */
export function* airportReachSteps(s: CityState, f: Fields, cfg: SimConfig): Generator<void, void> {
  const tr = f.travel;
  if (!tr) return;
  const airports: { st: Structure; fronts: number[]; components: number[]; capacity: number }[] = [];
  let work = 0;
  for (const st of s.structures.values()) {
    if ((++work & 0x1ff) === 0) yield;
    const def = cfg.structures[st.kind];
    if (!def.airport) continue;
    st.capacity = cargoCapacity(def, st.funding)!;
    st.load = 0;
    if (!st.capacity) continue;
    const fronts = frontage(s, st);
    if (!fronts.length) continue;
    airports.push({ st, fronts, components: [], capacity: st.capacity });
  }
  // Ordinary cities have no airport: avoid scanning every building or allocating route buffers.
  if (!airports.length) return;
  const offices: { roads: number[]; demand: number; reached: number[] }[] = [];
  for (const b of s.buildings.values()) {
    if ((++work & 0x1ff) === 0) yield;
    if ((b.type !== 'Co$$' && b.type !== 'Co$$$') || !(b.capacity * b.occupancy > 0)) continue;
    const roads = frontage(s, b);
    if (!roads.length) {
      const road = buildingAccess(s, f, b).road;
      if (road < 0) continue;
      roads.push(road);
    }
    offices.push({ roads, demand: b.capacity * b.occupancy, reached: [] });
  }
  if (!offices.length) return;
  const N = s.size * s.size, limit = cfg.transport.tripLimit;
  const transfers = ramps(s, tr.cross);
  for (let k = 0; k < airports.length; k++) {
    const { fronts } = airports[k]!;
    // A scratch buffer from the pool (the month's commute is done with it).
    const reach = yield* searchSteps(s, tr.cross, fronts.map((a): [number, number] => [Mode.Car * N + a, 0]), {
      modes: [Mode.Car, Mode.HighCar], bias: ONE, transfers, limit,
    }, bufferPool(f, N)(4));
    for (const office of offices) {
      if ((++work & 0x1ff) === 0) yield;
      if (office.roads.some(road => reach.time[Mode.Car * N + road]! <= limit)) office.reached.push(k);
    }
  }
  // Offices sharing a catchment form one flow node, keeping the allocation graph small.
  const groups = new Map<string, number>(), demand = new Map<number, number>();
  for (const office of offices) {
    if ((++work & 0x1ff) === 0) yield;
    if (!office.reached.length) continue;
    const key = office.reached.join(',');
    let group = groups.get(key);
    if (group === undefined) {
      group = groups.size;
      groups.set(key, group);
      for (const k of office.reached) airports[k]!.components.push(group);
    }
    demand.set(group, (demand.get(group) ?? 0) + office.demand);
  }
  const allocation = yield* allocateCapacitySteps(demand, airports);
  airports.forEach(({ st }, k) => { st.load = allocation.used[k]!; });
}

/**
 * One trip from a road tile to a particular workplace by the fastest way
 * (a My Sim's commute): time in centi-hours and the modes used, or null if
 * it can't be reached within the trip limit.
 */
export function tripTo(s: CityState, f: Fields, cfg: SimConfig, from: number, dest: Rect | Building): { time: number; modes: number[] } | null {
  const tr = f.travel;
  if (!tr) return null;
  const N = s.size * s.size;
  const sources: [number, number][] = [];
  // Lots set back from the road are reached along a driveway.
  const front = frontage(s, dest);
  if (!front.length && 'type' in dest) {
    const a = buildingAccess(s, f, dest);
    if (a.road >= 0) front.push(a.road);
  }
  for (const a of front) sources.push([Mode.Walk * N + a, 0], [Mode.Car * N + a, 0]);
  if (!sources.length) return null;
  const all = Object.values(Mode);
  const res = search(s, tr.cross, sources, {
    // (The month's merged boardings and ramps: built afresh here, every My Sim query redid the whole map's.)
    modes: all, bias: ONE, transfers: tr.allTransfers, limit: cfg.transport.tripLimit,
  }, bufferPool(f, N)(4)); // No search arrays escape this query; the assignment scratch slot is free.
  const o = origin(res, N, from, false);
  if (o < 0) return null;
  const modes: number[] = [];
  for (let v = o; v >= 0; v = res.next[v]!) {
    const m = Math.floor(v / N);
    if (modes.at(-1) !== m) modes.push(m);
  }
  return { time: res.time[o]!, modes };
}
