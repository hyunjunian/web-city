// Route Query: the trips leaving or arriving at a building, or
// crossing a network tile, with the route each takes and by what means: the
// trips the traffic model assigned last month (in a city just loaded, those
// it would assign now).

import type { SimConfig } from '../config';
import type { Fields } from './fields';
import type { CityState } from './state';
import { footprint, frontage } from './fields';
import { Mode, perimeter, replayTrips } from './transport';

/** How a trip counts in the Route Query: on foot only, by car, or by the transit it used. */
export type TripMeans = 'walk' | 'car' | 'bus' | 'train' | 'subway' | 'monorail' | 'ferry' | 'freight';

export interface RouteTrip {
  means: TripMeans;
  /** Sims (or freight trips a day). */
  amount: number;
  /** Tiles along the route, and the mode on each. */
  tiles: number[];
  modes: number[];
  /** Building the trip starts from. */
  from: number;
}

export interface RouteQuery {
  trips: RouteTrip[];
  byMeans: Partial<Record<TripMeans, number>>;
}

function means(modes: number[]): TripMeans {
  if (modes.includes(Mode.Ferry) || modes.includes(Mode.CarFerry)) return 'ferry';
  if (modes.includes(Mode.Monorail)) return 'monorail';
  if (modes.includes(Mode.Subway)) return 'subway';
  if (modes.includes(Mode.Train)) return 'train';
  if (modes.includes(Mode.Bus) || modes.includes(Mode.HighBus)) return 'bus';
  if (modes.includes(Mode.Car) || modes.includes(Mode.HighCar)) return 'car';
  return 'walk';
}

/**
 * Route Query at (x, y): a home shows its commuters, an industry also its
 * freight; a workplace the commuters who arrive there; a network tile the
 * trips passing over it. Trips are listed largest first.
 */
export function routeQuery(s: CityState, f: Fields, cfg: SimConfig, x: number, y: number, limit = 60): RouteQuery {
  const n = s.size;
  const i = y * n + x;
  const occ = s.occupant[i]!;
  // A building or structure: the trips from and to it; a network tile: those across it.
  const onLot = occ > 0 ? s.buildings.has(occ) : occ < 0 && s.structures.has(-occ);
  // A city just loaded has no log yet: replay the month's assignment for one.
  const log = f.tripLog ?? replayTrips(s, f, cfg);
  // A station or parking garage: the trips that board, alight or park there (who arrives at and
  // leaves the station, by means); they change mode on its tiles. (It holds no jobs: it listed nothing.)
  const st = occ < 0 ? s.structures.get(-occ) : undefined;
  const def = st ? cfg.structures[st.kind] : undefined;
  const hub = st && (def?.station || def?.parking) ? new Set([...footprint(s, st), ...perimeter(s, st), ...frontage(s, st)]) : null;
  const picked: RouteTrip[] = [];
  for (let k = 0; log && k < log.count; k++) {
    // A workplace's arrivals are the trips to its jobs (its key: building id, structure id negated).
    const hit = hub ? log.changesAt(k, hub)
      : onLot
      ? (occ > 0 && log.from[k] === occ) || (!log.freight[k] && log.job[k] === occ)
      : log.crosses(k, i);
    if (!hit) continue;
    const r = log.route(k);
    picked.push({ means: log.freight[k] ? 'freight' : means(r.modes), amount: log.amount[k]!, ...r, from: log.from[k]! });
  }
  const byMeans: Partial<Record<TripMeans, number>> = {};
  for (const t of picked) byMeans[t.means] = (byMeans[t.means] ?? 0) + t.amount;
  picked.sort((a, b) => b.amount - a.amount);
  return { trips: picked.slice(0, limit), byMeans };
}

/** The lines riders leave at a station (onto foot), and the kinds of station each stops at. */
const LINES: ReadonlyMap<number, readonly string[]> = new Map([
  [Mode.Bus, ['bus']], [Mode.HighBus, ['bus']], [Mode.Train, ['rail']], [Mode.Subway, ['subway']], [Mode.Monorail, ['monorail']], [Mode.Ferry, ['ferry', 'carFerry']],
]);

/**
 * Riders who got off at each passenger station last month: per station id, the commuters whose ride ended on its tiles
 * (its lot, edge or frontage) by a line of its kind, shared where two such stations' tiles meet. Boardings are a
 * station's load; this is the other end, the stop by work that nobody boards.
 */
export function alightings(s: CityState, f: Fields, cfg: SimConfig): Map<number, number> {
  const at = new Map<number, { id: number; mode: string }[]>();
  for (const st of s.structures.values()) {
    const def = cfg.structures[st.kind].station;
    if (!def || def.mode === 'freight') continue;
    for (const t of new Set([...footprint(s, st), ...perimeter(s, st), ...frontage(s, st)])) {
      const list = at.get(t);
      if (list) list.push({ id: st.id, mode: def.mode });
      else at.set(t, [{ id: st.id, mode: def.mode }]);
    }
  }
  const out = new Map<number, number>();
  if (!at.size) return out;
  const log = f.tripLog ?? replayTrips(s, f, cfg);
  let amount = 0;
  const visit = (fromTile: number, toTile: number, fromMode: number, toMode: number) => {
    const kinds = toMode === Mode.Walk ? LINES.get(fromMode) : undefined;
    if (!kinds) return;
    const here = at.get(toTile)?.filter((x) => kinds.includes(x.mode)) ?? [];
    const list = here.length ? here : at.get(fromTile)?.filter((x) => kinds.includes(x.mode)) ?? [];
    for (const x of list) out.set(x.id, (out.get(x.id) ?? 0) + amount / list.length);
  };
  for (let k = 0; log && k < log.count; k++) {
    if (log.freight[k]) continue;
    amount = log.amount[k]!;
    log.visitChanges(k, visit);
  }
  return out;
}
