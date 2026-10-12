// A region of city squares. The region is a grid of cells; a
// city covers 1×1 (small), 2×2 (medium) or 4×4 (large) cells, like
// SimCity 4's config bitmap. Only one city is open at a time; the others are kept
// as saves, and each open city sees the played cities along each edge as one
// developed neighbour made from their last saved state (no city there:
// SimNation). Pure data, so it runs in Workers too.

import { City, MAX_SIZE, type CityOptions } from './city';
import { copyData } from './copy';
import { loadCity, saveCity, type SavedCity } from './save';
import type { DealResource, Neighbour } from './sim/state';
import { apportionGrowth, mergeSnapshots, type CitySnapshot } from './sim/region';
import type { Heightmap } from './sim/terrain';
import { DEV_TYPES, perType, type DevType, type PerType } from './types';

/** Cells a city covers per side: small, medium, large (red 1×1, green 2×2, blue 4×4). */
export type CitySpan = 1 | 2 | 4;

interface RegionCity {
  x: number;
  y: number;
  span: CitySpan;
  save: SavedCity;
  snapshot: CitySnapshot;
  /** Growth other cities tossed to this one since it was last played (it sprouts when the city is opened). */
  pending?: PerType;
  /** Times it has been played and saved back. */
  closes?: number;
  /** Each neighbour's `closes` when this city was last saved (by cell key): unplayed since, its growth stays used up. */
  seen?: Record<number, number>;
}

export interface SavedRegion {
  format: 'web-city-region';
  version: 1 | 2;
  name: string;
  width: number;
  height: number;
  /** Tiles per side of one cell (a small city). */
  citySize: number;
  /** Version 2: the cities and the cells they cover. */
  cities?: RegionCity[];
  /** Version 1: row-major squares of one cell each. */
  squares?: ({ save: SavedCity; snapshot: CitySnapshot } | null)[];
}

const EDGE_STEP: readonly [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // W, E, N, S
const OPPOSITE = [1, 0, 3, 2] as const;

export class Region {
  readonly name: string;
  /** Size of the region in cells. */
  readonly width: number;
  readonly height: number;
  /** Tiles per side of one cell: a small city's size (medium and large are 2× and 4×). */
  readonly citySize: number;
  private cities: RegionCity[] = [];
  /** City index per cell (−1: empty). */
  private owner: Int32Array;
  /**
   * Grayscale topography for the whole region: each city founded
   * takes its part. Not saved; founded cities keep their land in their saves.
   */
  heightmap: Heightmap | null;

  constructor(opts: { name?: string; width?: number; height?: number; citySize?: number; heightmap?: Heightmap } = {}, cities: RegionCity[] = []) {
    this.heightmap = opts.heightmap ?? null;
    this.name = opts.name ?? 'New Region';
    this.width = opts.width ?? 3;
    this.height = opts.height ?? 3;
    this.citySize = opts.citySize ?? 64;
    // Bound the cell grid before allocation; a region may contain up to a million cells.
    if (![this.width, this.height].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIZE)) throw new RangeError('bad region dimensions');
    if (!Number.isInteger(this.citySize) || this.citySize < 8 || this.citySize > MAX_SIZE) throw new RangeError('bad region city size');
    this.owner = new Int32Array(this.width * this.height).fill(-1);
    for (const c of cities) this.claim(copyData(c));
  }

  private key(x: number, y: number): number {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.width || y >= this.height) throw new Error('square out of the region');
    return y * this.width + x;
  }

  private claim(c: RegionCity): void {
    if (!this.fits(c.x, c.y, c.span) || c.save.size !== this.citySize * c.span) throw new Error('corrupt region: bad city footprint or size');
    for (let y = c.y; y < c.y + c.span; y++) for (let x = c.x; x < c.x + c.span; x++) {
      if (this.owner[this.key(x, y)]! >= 0) throw new Error('corrupt region: overlapping cities');
    }
    const k = this.cities.push(c) - 1;
    for (let y = c.y; y < c.y + c.span; y++) for (let x = c.x; x < c.x + c.span; x++) this.owner[this.key(x, y)] = k;
  }

  private cityAt(x: number, y: number): RegionCity | null {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const k = this.owner[y * this.width + x]!;
    return k >= 0 ? this.cities[k]! : null;
  }

  /** Is a city founded on this cell? */
  has(x: number, y: number): boolean {
    return this.cityAt(x, y) !== null;
  }

  /** Snapshot of the city covering a cell (null if unfounded). */
  snapshotAt(x: number, y: number): CitySnapshot | null {
    const snapshot = this.cityAt(x, y)?.snapshot;
    return snapshot ? copyData(snapshot) : null;
  }

  /** The city covering a cell: its top-left cell and span (null if unfounded). */
  footprintAt(x: number, y: number): { x: number; y: number; span: CitySpan } | null {
    const c = this.cityAt(x, y);
    return c ? { x: c.x, y: c.y, span: c.span } : null;
  }

  /** Can a city of this span be founded with its top-left corner on (x, y)? */
  canFound(x: number, y: number, span: CitySpan = 1): boolean {
    if (!this.fits(x, y, span)) return false;
    for (let yy = y; yy < y + span; yy++) {
      for (let xx = x; xx < x + span; xx++) if (this.has(xx, yy) || this.founding.has(this.key(xx, yy))) return false;
    }
    return true;
  }

  private fits(x: number, y: number, span: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && (span === 1 || span === 2 || span === 4)
      && x >= 0 && y >= 0 && x + span <= this.width && y + span <= this.height && this.citySize * span <= MAX_SIZE;
  }

  /** Cells of cities founded but not yet closed into the region (one city per cell meanwhile). */
  private founding = new Set<number>();
  /** The open city's top-left cell (its pent-up growth is lost if another opens first). */
  private active: number | null = null;
  /** Growth already pending in each neighbour (by top-left cell) when the open city was opened. */
  private basePending = new Map<number, PerType>();

  /**
   * Another city is about to open: growth still pent up in the one open now
   * is lost (leaving an extrapolated city before all its pent-up growth has
   * sprouted throws the rest away for good).
   */
  private leave(next: number | null): void {
    if (this.active === null || this.active === next) return;
    const k = this.owner[this.active] ?? -1;
    // A city founded but never saved is given up: its cells are free again (only one is founded at a time).
    if (k < 0) this.founding.clear();
    const c = k >= 0 ? this.cities[k] : undefined;
    if (c?.save.growthTarget && Object.keys(c.save.growthTarget).length) this.cities[k] = { ...c, save: { ...c.save, growthTarget: {} } };
    this.active = null;
  }

  /** Founds a new city (1×1, 2×2 or 4×4 cells from (x, y)) and opens it. */
  found(x: number, y: number, opts: Omit<CityOptions, 'size'> = {}, span: CitySpan = 1): City {
    if (!this.canFound(x, y, span)) {
      throw new Error(x < 0 || y < 0 || x + span > this.width || y + span > this.height ? 'square out of the region' : 'a city already stands on this square');
    }
    const m = this.heightmap;
    const heightmap = m ? {
      ...m, crop: { x: (x * m.width) / this.width, y: (y * m.height) / this.height, w: (span * m.width) / this.width, h: (span * m.height) / this.height },
    } : undefined;
    this.leave(this.key(x, y));
    const city = new City({ name: `City ${x},${y}`, seed: this.key(x, y) + 1, heightmap, ...opts, size: this.citySize * span });
    this.attach(city, x, y, span);
    this.active = this.key(x, y);
    for (let yy = y; yy < y + span; yy++) for (let xx = x; xx < x + span; xx++) this.founding.add(this.key(xx, yy));
    return city;
  }

  /** Opens the city covering a cell, with its neighbours as they were when last saved. */
  open(x: number, y: number, opts: Pick<CityOptions, 'config'> = {}): City {
    const c = this.cityAt(x, y);
    if (!c) throw new Error('no city on this square');
    this.leave(this.key(c.x, c.y));
    const city = loadCity(c.save, opts);
    this.attach(city, c.x, c.y, c.span);
    // Growth tossed here while it was closed sprouts now.
    if (c.pending) {
      city.receiveGrowth(c.pending);
      this.cities[this.cities.indexOf(c)] = { ...c, pending: undefined };
    }
    this.active = this.key(c.x, c.y);
    return city;
  }

  /**
   * Saves a city back into its cells (do this before opening another). The
   * cell may be any the city covers; a new city's span comes from its size.
   * Neighbor Deals with a played neighbour are mirrored into its save: the
   * city just played holds the latest terms of every deal across its
   * borders (only where one city lines that edge).
   */
  close(x: number, y: number, city: City): void {
    const existing = this.cityAt(x, y);
    const span = (existing?.span ?? city.size / this.citySize) as CitySpan;
    if (city.size !== this.citySize * span) throw new Error('city size does not match the region footprint');
    if (!this.fits(existing?.x ?? x, existing?.y ?? y, span)) throw new Error('bad region city footprint or size');
    const entry: RegionCity = {
      x: existing?.x ?? x, y: existing?.y ?? y, span, save: saveCity(city), snapshot: city.snapshot(), closes: (existing?.closes ?? 0) + 1,
    };
    entry.seen = Object.fromEntries(this.neighbours(entry.x, entry.y, span).flat().map((c) => [this.key(c.x, c.y), c.closes ?? 0]));
    if (existing) this.cities[this.owner[this.key(x, y)]!] = entry;
    else {
      for (let yy = y; yy < y + span; yy++) for (let xx = x; xx < x + span; xx++) this.founding.delete(this.key(xx, yy));
      if (!this.canFound(x, y, span)) throw new Error('a city already stands on this square');
      this.claim(entry);
    }
    this.neighbours(entry.x, entry.y, span).forEach((others, edge) => {
      if (others.length !== 1) return;
      const other = others[0]!;
      const back = OPPOSITE[edge]!;
      // Only when each is the other's sole neighbour on this border: a big city lined by
      // several small ones keeps the deals it struck with the others.
      if (this.neighbours(other.x, other.y, other.span)[back]!.length !== 1) return;
      // A fresh save object (an earlier region save may share the old one),
      // with deal ids from the neighbour's own deal counter.
      const save = other.save;
      const kept = (save.neighbourDeals ?? []).filter((d) => d.edge !== back);
      let nextDealId = Math.max(save.nextDealId ?? 1, ...(save.neighbourDeals ?? []).map((d) => d.id + 1));
      const mirrored = city.state.neighbourDeals.filter((d) => d.edge === edge).map((d) => ({
        ...d, id: nextDealId++, edge: back, direction: d.direction === 'buy' ? 'sell' as const : 'buy' as const,
        // (As old in the partner's calendar as here: its day count is its own.)
        startDay: save.day - (city.state.day - d.startDay),
      }));
      // Its snapshot's standing deals follow (what other cities are offered of it): the deals across
      // this border replaced by their mirrors.
      let snapshot = other.snapshot;
      if (snapshot.committed) {
        const c = snapshot.committed;
        const committed = { power: { ...c.power }, water: { ...c.water }, garbage: { ...c.garbage } };
        const count = (d: { resource: DealResource; direction: 'buy' | 'sell'; amount: number; status: string }, sign: number) => {
          if (d.status === 'grace') return;
          committed[d.resource][d.direction === 'buy' ? 'bought' : 'sold'] += sign * d.amount;
        };
        for (const d of save.neighbourDeals ?? []) if (d.edge === back) count(d, -1);
        for (const d of mirrored) count(d, 1);
        snapshot = { ...snapshot, committed };
      }
      this.cities[this.cities.indexOf(other)] = { ...other, snapshot, save: { ...save, nextDealId, neighbourDeals: [...kept, ...mirrored] } };
    });
    // Demand this city tossed to its neighbours waits in them, to
    // sprout when they are next played: what was taken up since it was opened,
    // shared out by their populations (a later save of the same session replaces it).
    this.neighbours(entry.x, entry.y, span).forEach((others, edge) => {
      const taken = city.state.neighbours[edge]?.absorbed;
      if (!others.length || !taken) return;
      const base = others.map((o) => this.basePending.get(this.key(o.x, o.y)) ?? perType(() => 0));
      const pending = others.map((_, j) => ({ ...base[j]! }));
      for (const t of DEV_TYPES) {
        const had = base.reduce((a, b) => a + b[t], 0);
        const more = taken[t] - had;
        if (more <= 0) continue;
        const weights = others.map((o) => o.snapshot.population[t]);
        const parts = apportionGrowth(more, weights);
        others.forEach((_, j) => {
          pending[j]![t] += parts[j]!;
        });
      }
      others.forEach((o, j) => {
        this.cities[this.cities.indexOf(this.cityAt(o.x, o.y)!)] = { ...this.cityAt(o.x, o.y)!, pending: pending[j] };
      });
    });
  }

  /** Total residents and cities in the region (for regional reward conditions). */
  stats(): { cities: number; residents: number } {
    let residents = 0;
    for (const c of this.cities) residents += c.snapshot.population['R$'] + c.snapshot.population['R$$'] + c.snapshot.population['R$$$'];
    return { cities: this.cities.length, residents };
  }

  /** The distinct played cities along each edge (W, E, N, S) of a footprint. */
  private neighbours(x: number, y: number, span: number): RegionCity[][] {
    return EDGE_STEP.map(([dx, dy]) => {
      const found = new Set<RegionCity>();
      for (let k = 0; k < span; k++) {
        const cx = dx < 0 ? x - 1 : dx > 0 ? x + span : x + k;
        const cy = dy < 0 ? y - 1 : dy > 0 ? y + span : y + k;
        const c = this.cityAt(cx, cy);
        if (c) found.add(c);
      }
      return [...found];
    });
  }

  private attach(city: City, x: number, y: number, span: number): void {
    const here = this.cityAt(x, y);
    this.basePending.clear();
    // Totals of the other cities, for regional reward conditions.
    const others = { cities: 0, population: 0, highWealth: 0, byType: {} as Partial<Record<DevType, number>> };
    for (const c of this.cities) {
      if (c === here) continue;
      const p = c.snapshot.population;
      others.cities++;
      others.population += Object.values(p).reduce((a, b) => a + b, 0);
      others.highWealth += p['R$$'] + p['R$$$'];
      for (const t of DEV_TYPES) others.byType[t] = (others.byType[t] ?? 0) + (p[t] ?? 0);
    }
    // Cities joined to another city by a road reaching a shared edge (snapshots without edges: any neighbour).
    let linked = 0;
    for (const c of this.cities) {
      if (c === here) continue;
      const near = this.neighbours(c.x, c.y, c.span);
      if (near.some((list, e) => list.length > 0 && (c.snapshot.edges ? c.snapshot.edges.garbage[e]! : true))) linked++;
    }
    city.state.region = { ...others, linkedCities: linked };
    const cs = this.citySize;
    this.neighbours(x, y, span).forEach((list, edge) => {
      if (!list.length) return city.setNeighbourCity(edge as 0 | 1 | 2 | 3, null);
      // Only the stretch of border two cities share joins them: a connection
      // elsewhere on the edge faces an empty square (or another city).
      const facing = edge ^ 1;
      const shared: NonNullable<Neighbour['shared']> = [];
      const views = list.map((c) => {
        const along = edge < 2 ? [y, c.y] : [x, c.x];
        const from = Math.max(along[0]!, along[1]!) * cs;
        const to = Math.min(along[0]! + span, along[1]! + c.span) * cs;
        const stretch: [number, number] = [from - along[0]! * cs, to - along[0]! * cs]; // in this city's tiles
        this.basePending.set(this.key(c.x, c.y), { ...(c.pending ?? perType(() => 0)) });
        const reach = c.snapshot.reach;
        if (!reach || !c.snapshot.edges) {
          shared.push(stretch);
          return { ...c.snapshot, ...(c.pending ? { pending: c.pending } : {}) };
        }
        const lo = from - along[1]! * cs; // in the neighbour's tiles
        const hi = to - along[1]! * cs;
        const e0 = c.snapshot.edges;
        const edges = { power: [...e0.power], water: [...e0.water], garbage: [...e0.garbage] } as typeof e0;
        for (const r of ['power', 'water', 'garbage'] as const) edges[r][facing] = reach[r][facing]!.some((p) => p >= lo && p < hi);
        shared.push([...stretch, { power: edges.power[facing]!, water: edges.water[facing]!, garbage: edges.garbage[facing]! }]);
        return { ...c.snapshot, edges, ...(c.pending ? { pending: c.pending } : {}) };
      });
      const snap = views.length === 1 ? views[0]! : mergeSnapshots(views);
      const before = city.state.neighbours[edge];
      city.setNeighbourCity(edge as 0 | 1 | 2 | 3, snap, shared);
      // Neighbours not played since this city was: the growth and demand it drained from them stay
      // drained (the city stagnates until you switch); they are extrapolated afresh only once
      // a neighbour has been played and saved again. (Reopening refilled them every time.)
      const unplayed = here?.seen && list.every((c) => here.seen![this.key(c.x, c.y)] === (c.closes ?? 0));
      const now = city.state.neighbours[edge];
      // Deals are mirrored only between two cities each alone on their side of the border (see close;
      // this city counts there even before its first save). Across another border none is offered, and
      // any struck before a third city was founded there end on both sides (each drops its own).
      const across = list.length === 1 ? this.neighbours(list[0]!.x, list[0]!.y, list[0]!.span)[edge ^ 1]! : [];
      const alone = list.length === 1 && across.length + (here && across.includes(here) ? 0 : 1) === 1;
      if (now && !alone) {
        now.dealsBlocked = true;
        city.state.neighbourDeals = city.state.neighbourDeals.filter((d) => d.edge !== edge);
      }
      if (unplayed && before?.kind === 'developed' && now) {
        now.growth = { ...before.growth };
        if (before.demand) now.demand = { ...before.demand };
      }
    });
    city.refresh();
  }

  save(): SavedRegion {
    return {
      format: 'web-city-region', version: 2, name: this.name, width: this.width, height: this.height, citySize: this.citySize,
      cities: copyData(this.cities),
    };
  }

  static load(saved: SavedRegion): Region {
    if (saved.format !== 'web-city-region') throw new Error('not a region save');
    const cities: RegionCity[] = saved.cities ?? (saved.squares ?? []).flatMap((sq, k) =>
      sq ? [{ x: k % saved.width, y: Math.floor(k / saved.width), span: 1 as CitySpan, save: sq.save, snapshot: sq.snapshot }] : []);
    return new Region({ name: saved.name, width: saved.width, height: saved.height, citySize: saved.citySize }, cities);
  }
}
