// JSON save format. Tile arrays are run-length encoded; everything else is
// plain data. Uses only ES built-ins, so saves can move between a browser,
// a Worker (e.g. into KV/D1/R2) and Node.

import { City, MAX_SIZE, type CityOptions } from './city';
import { copyData } from './copy';
import { computeMayor } from './sim/mayor';
import { DAYS_PER_MONTH, ELEVATED, linkAll, Net, Terrain, ZONES, type Building, type CityState, type Structure } from './sim/state';
import { defaultNeighbours } from './sim/region';
import { drain } from './sim/steps';
import { STRUCTURES } from './data/structures';
import { DEV_TYPES } from './types';

export interface SavedCity {
  format: 'web-city';
  /** 1: RCI only. 2: power and services. 3: water. 4: police, crime, fire. 5: garbage. 6: Mayor Rating. */
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  name: string;
  size: number;
  seed: number;
  rngState: number;
  difficulty: CityState['difficulty'];
  day: number;
  funds: number;
  terrain: number[];
  net: number[];
  zone: number[];
  power?: number[];
  pipe?: number[];
  subway?: number[];
  oneway?: number[];
  radiation?: number[];
  trees?: number[];
  height?: number[];
  potholes?: number[];
  elevated?: number[];
  tolls?: number[];
  links?: number[];
  interchange?: number[];
  tunnel?: number[];
  monorailTraffic?: number[];
  highTraffic?: number[];
  ferryTraffic?: number[];
  /** The evening rush hour's cars (Traffic Data View). */
  eveningTraffic?: number[];
  /** Average trip time to jobs in town (what neighbours remember of commuting here); -1 for none yet. */
  localCommute?: number;
  departments?: Partial<CityState['departments']>;
  landform?: number[];
  lineWear?: number[];
  pipeWear?: number[];
  railDamage?: number[];
  spills?: CityState['spills'];
  faultAngle?: number | null;
  incidents?: CityState['incidents'];
  neighbours?: CityState['neighbours'];
  neighbourDeals?: CityState['neighbourDeals'];
  mySims?: CityState['mySims'];
  udi?: CityState['udi'];
  journal?: unknown;
  liveDisasters?: CityState['liveDisasters'];
  transitions?: number[];
  names?: Record<string, string>;
  nextDealId?: number;
  wind?: CityState['wind'];
  region?: CityState['region'];
  units?: CityState['units'];
  mobs?: CityState['mobs'];
  arsonists?: CityState['arsonists'];
  railTraffic?: number[];
  freightRail?: number[];
  subwayTraffic?: number[];
  rubble?: number[];
  /** Piled garbage and landfill contents, tons ×10, rounded. */
  garbage?: number[];
  landfill?: number[];
  garbageStats?: CityState['garbageStats'];
  ordinances?: CityState['ordinances'];
  ordinanceDays?: CityState['ordinanceDays'];
  loans?: CityState['loans'];
  history?: CityState['history'];
  mayorRating?: number;
  taxMonthStart?: CityState['taxMonthStart'];
  taxMood?: CityState['taxMood'];
  demandTrend?: CityState['demandTrend'];
  growthTarget?: CityState['growthTarget'];
  lastPopulation?: CityState['lastPopulation'];
  cheats?: CityState['cheats'];
  riots?: number;
  zonedSince?: number;
  /** Crime history ×100, rounded. */
  crime?: number[];
  fires?: CityState['fires'];
  treeFires?: CityState['treeFires'];
  events?: CityState['events'];
  safety?: CityState['safety'];
  carryCrimes?: number;
  fireTally?: CityState['fireTally'];
  blackoutRotation?: number;
  unlocked?: CityState['unlocked'];
  /** Trips/day per tile, rounded (recomputed monthly, so it must survive a reload). */
  traffic: number[];
  /** Versions 1–7: one object per building. */
  buildings?: SavedBuilding[];
  /** Version 8: buildings as a table (field names once, a row per building) — about half the size. */
  buildingTable?: { columns: string[]; rows: unknown[][] };
  structures: SavedStructure[];
  nextId: number;
  taxRates: CityState['taxRates'];
  taxLog: CityState['taxLog'];
  freightTrips: number;
  lastBudget: CityState['lastBudget'];
  impeached: boolean;
}

type BuildingV2Fields = 'noPowerMonths' | 'powered' | 'age' | 'eq' | 'hq' | 'noWaterMonths' | 'watered' | 'commute' | 'noJobMonths' | 'historical';
type StructureV2Fields = 'funding' | 'life' | 'load' | 'capacity' | 'effectiveness' | 'strike' | 'powered';
/** Version 1 saves lack the fields added with power and services. */
export type SavedBuilding = Omit<Building, BuildingV2Fields> & Partial<Pick<Building, BuildingV2Fields>>;
export type SavedStructure = Omit<Structure, StructureV2Fields | 'w' | 'h'> &
  Partial<Pick<Structure, StructureV2Fields | 'w' | 'h'>> & { size?: number };

/** Saves from before elevation: flat land at 20 m. */
function flatHeights(terrain: Uint8Array, N: number): Uint8Array {
  const h = new Uint8Array(N);
  for (let i = 0; i < N; i++) h[i] = terrain[i] ? 0 : 20;
  return h;
}

/** Objects as a table: the union of their keys as columns, one row of values per object. */
/** Traffic is kept to hundredths of a trip (the city rounds it the same way). */
const hundredths = (v: number) => Math.round(v * 100) / 100;

function toTable<T extends object>(items: readonly T[]): { columns: string[]; rows: unknown[][] } {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const it of items) for (const k of Object.keys(it)) if (!seen.has(k)) {
    seen.add(k);
    columns.push(k);
  }
  columns.sort(); // canonical: the same table whatever order the objects' keys were set in
  return { columns, rows: items.map((it) => columns.map((k) => copyData((it as Record<string, unknown>)[k]))) };
}

function fromTable<T>(t: { columns: string[]; rows: unknown[][] } | undefined): T[] {
  if (!t) return [];
  return t.rows.map((row) => {
    const o: Record<string, unknown> = Object.create(null);
    t.columns.forEach((k, j) => {
      if (row[j] !== undefined) o[k] = copyData(row[j]);
    });
    return o as T;
  });
}

/** Deep copy of plain JSON-like data (structuredClone is not in every runtime's lib types). */
function structuredCloneLite<T>(v: T): T {
  return copyData(v);
}

/** [value, count, value, count, …] */
export function rleEncode(a: ArrayLike<number>, map?: (v: number) => number): number[] {
  const out: number[] = [];
  // `map` rounds as it goes (no copy of a big map's array to round first).
  const at = map ? (i: number) => map(a[i]!) : (i: number) => a[i]!;
  for (let i = 0; i < a.length; ) {
    const v = at(i);
    let j = i + 1;
    while (j < a.length && at(j) === v) j++;
    out.push(v, j - i);
    i = j;
  }
  return out;
}

/** A byte layer whose codes have meaning to the simulation, rather than arbitrary bytes. */
function decodeCodes(runs: number[] | undefined, length: number, max: number, optional = false): Uint8Array {
  if (runs === undefined) {
    if (!optional) throw new Error('corrupt save: missing map layer');
    return new Uint8Array(length);
  }
  const out = rleDecode(runs, length);
  for (let k = 0; k < runs.length; k += 2) if (runs[k]! > max) throw new Error('corrupt save: unknown tile code');
  return out;
}

export function rleDecode(runs: readonly number[], length: number): Uint8Array;
export function rleDecode<T extends { fill(v: number, a: number, b: number): unknown }>(
  runs: readonly number[], length: number, out: T): T;
export function rleDecode(runs: readonly number[], length: number, out: Uint8Array | Float32Array = new Uint8Array(length)) {
  let p = 0;
  if (!Array.isArray(runs)) throw new Error('corrupt save: missing map layer');
  const bytes = out instanceof Uint8Array;
  for (let k = 0; k < runs.length; k += 2) {
    const len = runs[k + 1]!;
    const value = runs[k]!;
    if (!Number.isInteger(len) || len <= 0 || p + len > length) throw new Error(`corrupt save: bad run of ${len} tiles`);
    // Typed arrays silently wrap byte values and turn oversized floats into Infinity.
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
      || (bytes ? !Number.isInteger(value) || value > 255 : !Number.isFinite(Math.fround(value)))) {
      throw new Error('corrupt save: bad tile value');
    }
    out.fill(value, p, p + len);
    p += len;
  }
  if (p !== length) throw new Error(`corrupt save: expected ${length} tiles, got ${p}`);
  return out;
}

export function saveCity(city: City): SavedCity {
  city.settle(); // not part-way through a day (see City.beginSteps)
  return drain(saveCitySteps(city));
}

/**
 * {@link saveCity} a layer at a time, for a viewer that saves between
 * frames. Start it between days (not while the city is stepping) and run no
 * day until it is done: the pieces must all see the same city.
 */
export function* saveCitySteps(city: City): Generator<void, SavedCity> {
  city.settle();
  const s = city.state;
  const r = {} as Record<string, ReturnType<typeof rleEncode>>;
  const layers: [string, () => ReturnType<typeof rleEncode>][] = [
    ['terrain', () => rleEncode(s.terrain)],
    ['net', () => rleEncode(s.net)],
    ['zone', () => rleEncode(s.zone)],
    ['power', () => rleEncode(s.power)],
    ['pipe', () => rleEncode(s.pipe)],
    ['subway', () => rleEncode(s.subway)],
    ['oneway', () => rleEncode(s.oneway)],
    ['radiation', () => rleEncode(s.radiation)],
    ['trees', () => rleEncode(s.trees)],
    ['height', () => rleEncode(s.height)],
    ['potholes', () => rleEncode(s.potholes)],
    ['elevated', () => rleEncode(s.elevated)],
    ['tolls', () => rleEncode(s.tolls)],
    ['links', () => rleEncode(s.links)],
    ['interchange', () => rleEncode(s.interchange)],
    ['tunnel', () => rleEncode(s.tunnel)],
    ['monorailTraffic', () => rleEncode(city.fields.monorailTraffic, hundredths)],
    ['highTraffic', () => rleEncode(city.fields.highTraffic, hundredths)],
    ['ferryTraffic', () => rleEncode(city.fields.ferryTraffic, hundredths)],
    ['eveningTraffic', () => rleEncode(city.fields.eveningTraffic, hundredths)],
    ['landform', () => rleEncode(s.landform)],
    ['lineWear', () => rleEncode(s.lineWear)],
    ['pipeWear', () => rleEncode(s.pipeWear)],
    ['railDamage', () => rleEncode(s.railDamage)],
    ['railTraffic', () => rleEncode(city.fields.railTraffic, hundredths)],
    ['freightRail', () => rleEncode(city.fields.freightRail, hundredths)],
    ['subwayTraffic', () => rleEncode(city.fields.subwayTraffic, hundredths)],
    ['rubble', () => rleEncode(s.rubble)],
    ['garbage', () => rleEncode(s.garbage, (v) => Math.round(v * 10))],
    ['landfill', () => rleEncode(s.landfill, (v) => Math.round(v * 10))],
    ['crime', () => rleEncode(s.crime, (v) => Math.round(v * 100))],
    ['traffic', () => rleEncode(city.fields.traffic, hundredths)],
  ];
  for (const [key, encode] of layers) {
    r[key] = encode();
    yield;
  }
  const buildingTable = toTable([...s.buildings.values()]);
  yield;
  // Keys in a fixed order: a city loaded and saved again writes the same text.
  const structures = [...s.structures.values()].map((st) => Object.fromEntries(Object.entries(st).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) as unknown as Structure);
  yield;
  return {
    format: 'web-city',
    version: 8,
    name: s.name,
    size: s.size,
    seed: s.seed,
    rngState: city.rngNow(),
    difficulty: s.difficulty,
    day: s.day,
    funds: s.funds,
    terrain: r.terrain!,
    net: r.net!,
    zone: r.zone!,
    power: r.power!,
    pipe: r.pipe!,
    subway: r.subway!,
    oneway: r.oneway!,
    radiation: r.radiation!,
    trees: r.trees!,
    height: r.height!,
    potholes: r.potholes!,
    elevated: r.elevated!,
    tolls: r.tolls!,
    links: r.links!,
    interchange: r.interchange!,
    tunnel: r.tunnel!,
    monorailTraffic: r.monorailTraffic!,
    highTraffic: r.highTraffic!,
    ferryTraffic: r.ferryTraffic!,
    eveningTraffic: r.eveningTraffic!,
    localCommute: city.fields.localCommute,
    departments: { ...s.departments },
    landform: r.landform!,
    lineWear: r.lineWear!,
    pipeWear: r.pipeWear!,
    railDamage: r.railDamage!,
    spills: s.spills.map((x) => ({ ...x })),
    faultAngle: s.faultAngle,
    incidents: s.incidents.map((x) => ({ ...x })),
    neighbours: s.neighbours.map((nb) => structuredCloneLite(nb)),
    neighbourDeals: s.neighbourDeals.map((d) => ({ ...d })),
    mySims: s.mySims.map((m) => ({ ...m })),
    udi: { done: { ...s.udi.done }, partial: { ...s.udi.partial }, ...activeMission(s.udi) },
    liveDisasters: structuredCloneLite(s.liveDisasters),
    ...(s.journal !== undefined ? { journal: JSON.parse(JSON.stringify(s.journal)) as unknown } : {}),
    transitions: [...s.transitions],
    names: { ...s.names },
    nextDealId: s.nextDealId,
    wind: { ...s.wind },
    region: s.region ? { ...s.region } : undefined,
    units: copyData(s.units),
    mobs: s.mobs.map((m) => ({ ...m })),
    arsonists: s.arsonists.map((a) => ({ ...a })),
    railTraffic: r.railTraffic!,
    freightRail: r.freightRail!,
    subwayTraffic: r.subwayTraffic!,
    rubble: r.rubble!,
    garbage: r.garbage!,
    landfill: r.landfill!,
    garbageStats: { ...s.garbageStats },
    ordinances: [...s.ordinances],
    ordinanceDays: { ...s.ordinanceDays },
    loans: s.loans.map((l) => ({ ...l })),
    history: copyData(s.history),
    mayorRating: s.mayorRating,
    taxMonthStart: [...s.taxMonthStart],
    taxMood: s.taxMood.map((m) => ({ ...m })),
    demandTrend: { ...s.demandTrend },
    growthTarget: { ...s.growthTarget },
    ...(s.lastPopulation ? { lastPopulation: { ...s.lastPopulation } } : {}),
    cheats: { ...s.cheats },
    riots: s.riots,
    ...(s.zonedSince !== undefined ? { zonedSince: s.zonedSince } : {}),
    crime: r.crime!,
    fires: s.fires.map((fi) => ({ ...fi })),
    treeFires: s.treeFires.map((t) => ({ ...t })),
    events: s.events.map((e) => ({ ...e })),
    safety: copyData(s.safety),
    carryCrimes: s.carryCrimes,
    fireTally: { ...s.fireTally },
    blackoutRotation: s.blackoutRotation,
    unlocked: [...s.unlocked],
    traffic: r.traffic!,
    buildingTable,
    structures,
    nextId: s.nextId,
    taxRates: { ...s.taxRates },
    taxLog: s.taxLog.map((e) => [...e] as [number, (typeof e)[1], number]),
    freightTrips: s.freightTrips,
    lastBudget: copyData(s.lastBudget),
    impeached: s.impeached,
  };
}

/** Largest building or facility side (the biggest is well under this). */
const MAX_FOOTPRINT = 32;

export function loadCity(saved: SavedCity, opts: Pick<CityOptions, 'config'> = {}): City {
  if (saved.format !== 'web-city' || ![1, 2, 3, 4, 5, 6, 7, 8].includes(saved.version)) {
    throw new Error('unsupported save format');
  }
  // Saves can come from anywhere (the worker takes them in requests): a size or
  // footprint out of range would allocate or loop without end.
  if (!Number.isInteger(saved.size) || saved.size < 8 || saved.size > MAX_SIZE) throw new Error('corrupt save: bad map size');
  const fits = (r: { x: number; y: number; w?: number; h?: number }, w: number, h: number) => [r.x, r.y, w, h].every(Number.isInteger)
    && w >= 1 && h >= 1 && w <= MAX_FOOTPRINT && h <= MAX_FOOTPRINT && r.x >= 0 && r.y >= 0 && r.x + w <= saved.size && r.y + h <= saved.size;
  const whole = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (typeof saved.name !== 'string') throw new Error('corrupt save: bad name');
  if (!whole(saved.day) || !whole(saved.seed) || !whole(saved.rngState)) throw new Error('corrupt save: bad day or seed');
  if (typeof saved.funds !== 'number' || !Number.isFinite(saved.funds)) throw new Error('corrupt save: bad funds');
  if (!['easy', 'medium', 'hard'].includes(saved.difficulty)) throw new Error('corrupt save: bad difficulty');
  // (Caught here, not as NaN funds or an unknown kind deep inside the first step.)
  if (!saved.taxRates || !DEV_TYPES.every((t) => typeof saved.taxRates[t] === 'number' && Number.isFinite(saved.taxRates[t]))) {
    throw new Error('corrupt save: bad tax rates');
  }
  if (!Array.isArray(saved.structures)) throw new Error('corrupt save: no structures');
  if (saved.taxLog !== undefined && !Array.isArray(saved.taxLog)) throw new Error('corrupt save: bad tax log');
  if (saved.buildingTable && (!Array.isArray(saved.buildingTable.rows) || !Array.isArray(saved.buildingTable.columns))) {
    throw new Error('corrupt save: bad building table');
  }
  const N = saved.size * saved.size;
  const terrain = decodeCodes(saved.terrain, N, Terrain.Water);
  const occupant = new Int32Array(N);
  const buildings = new Map<number, Building>();
  const structures = new Map<number, Structure>();
  const ids = new Set<number>();
  let nextId = 1;
  const claim = (r: { id: number; x: number; y: number; w: number; h: number }, sign: 1 | -1) => {
    if (!Number.isInteger(r.id) || r.id <= 0 || r.id > 0x7fffffff || ids.has(r.id)) throw new Error('corrupt save: bad or duplicate id');
    ids.add(r.id);
    nextId = Math.max(nextId, r.id + 1);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * saved.size + x;
      if (occupant[i] !== 0) throw new Error('corrupt save: overlapping lots');
      occupant[i] = sign * r.id;
    }
  };
  for (const b of saved.buildings ?? fromTable<SavedBuilding>(saved.buildingTable)) {
    // Version 1 saves predate power and households: fill in defaults.
    const base = 20 + 20 * (b.type === 'R$$' ? 1 : b.type === 'R$$$' ? 2 : 0);
    if (!fits(b, b.w, b.h)) throw new Error(`corrupt save: building ${b.id} is off the map`);
    if (!whole(b.id) || !DEV_TYPES.includes(b.origType) || (b.type !== null && !DEV_TYPES.includes(b.type))) throw new Error(`corrupt save: building ${b.id} has no known type`);
    claim(b, 1);
    buildings.set(b.id, { noPowerMonths: 0, powered: true, age: 30, eq: base, hq: base, noWaterMonths: 0, watered: false, commute: -1, noJobMonths: 0, ...copyData(b), historical: b.historical === true });
  }
  for (const old of saved.structures) {
    // Version 1 parks were square with a `size`.
    const { size, ...st } = old;
    const full: Structure = {
      funding: 100, life: 0, load: 0, capacity: 0, effectiveness: 0, strike: 0, powered: false,
      ...st, w: st.w ?? size ?? 1, h: st.h ?? size ?? 1,
    };
    if (!fits(full, full.w, full.h)) throw new Error(`corrupt save: structure ${full.id} is off the map`);
    if (!whole(full.id) || !Object.hasOwn(STRUCTURES, full.kind)) throw new Error(`corrupt save: structure ${full.id} has no known kind`);
    claim(full, -1);
    structures.set(full.id, full);
  }
  for (const sim of saved.mySims ?? []) nextId = Math.max(nextId, sim.id + 1);
  const state: CityState = {
    version: 1,
    name: saved.name,
    size: saved.size,
    seed: saved.seed,
    rngState: saved.rngState,
    difficulty: saved.difficulty,
    day: saved.day,
    funds: saved.funds,
    terrain,
    net: decodeCodes(saved.net, N, Net.OneWay),
    zone: decodeCodes(saved.zone, N, ZONES.length - 1),
    power: decodeCodes(saved.power, N, 1, true),
    pipe: decodeCodes(saved.pipe, N, 1, true),
    subway: decodeCodes(saved.subway, N, 1, true),
    oneway: decodeCodes(saved.oneway, N, 4, true),
    radiation: saved.radiation ? rleDecode(saved.radiation, N) : new Uint8Array(N),
    trees: saved.trees ? rleDecode(saved.trees, N) : new Uint8Array(N),
    height: saved.height ? rleDecode(saved.height, N) : flatHeights(terrain, N),
    potholes: saved.potholes ? rleDecode(saved.potholes, N) : new Uint8Array(N),
    elevated: decodeCodes(saved.elevated, N, ELEVATED.highway, true),
    tolls: decodeCodes(saved.tolls, N, 1, true),
    links: saved.links ? rleDecode(saved.links, N) : new Uint8Array(N),
    interchange: saved.interchange ? rleDecode(saved.interchange, N) : new Uint8Array(N),
    tunnel: saved.tunnel ? rleDecode(saved.tunnel, N) : new Uint8Array(N),
    departments: { roads: 100, transit: 100, power: 100, water: 100, parks: 100, sanitation: 100, landmarks: 100, corrections: 100, ...saved.departments },
    landform: saved.landform ? rleDecode(saved.landform, N) : new Uint8Array(N),
    lineWear: saved.lineWear ? rleDecode(saved.lineWear, N) : new Uint8Array(N),
    pipeWear: saved.pipeWear ? rleDecode(saved.pipeWear, N) : new Uint8Array(N),
    railDamage: saved.railDamage ? rleDecode(saved.railDamage, N) : new Uint8Array(N),
    spills: (saved.spills ?? []).map((x) => ({ ...x })),
    faultAngle: saved.faultAngle ?? null,
    incidents: (saved.incidents ?? []).map((x) => ({ ...x })),
    neighbours: saved.neighbours ? saved.neighbours.map((nb) => structuredCloneLite(nb)) : defaultNeighbours(),
    neighbourDeals: (saved.neighbourDeals ?? []).map((d) => ({ ...d })),
    mySims: (saved.mySims ?? []).map((m) => ({ ...m })),
    udi: { done: { ...saved.udi?.done }, partial: { ...saved.udi?.partial }, ...activeMission(saved.udi) },
    liveDisasters: structuredCloneLite(saved.liveDisasters ?? []),
    ...(saved.journal !== undefined ? { journal: JSON.parse(JSON.stringify(saved.journal)) as unknown } : {}),
    transitions: [...(saved.transitions ?? [])],
    names: { ...(saved.names ?? {}) },
    nextDealId: saved.nextDealId ?? 1,
    wind: saved.wind ? { ...saved.wind } : { dir: 0, strength: 0.3 },
    region: saved.region ? { ...saved.region } : undefined,
    units: copyData(saved.units ?? []),
    mobs: (saved.mobs ?? []).map((m) => ({ ...m })),
    arsonists: (saved.arsonists ?? []).map((a) => ({ ...a })),
    rubble: saved.rubble ? rleDecode(saved.rubble, N) : new Uint8Array(N),
    garbage: saved.garbage ? rleDecode(saved.garbage, N, new Float32Array(N)).map((v) => v / 10) : new Float32Array(N),
    landfill: saved.landfill ? rleDecode(saved.landfill, N, new Float32Array(N)).map((v) => v / 10) : new Float32Array(N),
    ordinances: [...(saved.ordinances ?? [])],
    // (Older saves: those in effect count from the month's start.)
    ordinanceDays: saved.ordinanceDays ? { ...saved.ordinanceDays }
      : Object.fromEntries((saved.ordinances ?? []).map((o) => [o, saved.day % DAYS_PER_MONTH])),
    loans: (saved.loans ?? []).map((l) => ({ ...l })),
    history: copyData(saved.history ?? []),
    mayorRating: saved.mayorRating ?? 0,
    taxMonthStart: saved.taxMonthStart
      ? [...saved.taxMonthStart]
      : [saved.taxRates['R$'], saved.taxRates['R$$'], saved.taxRates['R$$$']],
    taxMood: (saved.taxMood ?? []).map((m) => ({ ...m })),
    demandTrend: { ...saved.demandTrend },
    growthTarget: { ...saved.growthTarget },
    ...(saved.lastPopulation ? { lastPopulation: { ...saved.lastPopulation } } : {}),
    cheats: { ...saved.cheats },
    riots: saved.riots ?? 0,
    ...(whole(saved.zonedSince) ? { zonedSince: saved.zonedSince } : {}),
    garbageStats: {
      produced: 0, recycled: 0, kept: 0, incinerated: 0, landfilled: 0, uncollected: 0, piled: 0, capacity: 0, landfillSpace: 0,
      ...saved.garbageStats,
    },
    crime: saved.crime ? rleDecode(saved.crime, N, new Float32Array(N)).map((v) => v / 100) : new Float32Array(N),
    fires: (saved.fires ?? []).map((fi) => ({ ...fi })),
    treeFires: (saved.treeFires ?? []).map((t) => ({ ...t })),
    events: (saved.events ?? []).map((e) => ({ ...e })),
    safety: { crimes: 0, arrests: 0, prevented: 0, paroled: 0, fires: 0, burned: 0, ...copyData(saved.safety) },
    carryCrimes: saved.carryCrimes ?? 0,
    fireTally: { fires: 0, burned: 0, ...saved.fireTally },
    blackoutRotation: saved.blackoutRotation ?? 0,
    unlocked: [...(saved.unlocked ?? [])],
    occupant,
    buildings,
    structures,
    // Ids are handed out from here: never one already taken (a missing or stale count gave NaN ids, or
    // a new facility that replaced an old one under its id).
    nextId: Math.max(whole(saved.nextId) ? saved.nextId : 0, nextId),
    taxRates: { ...saved.taxRates },
    taxLog: (saved.taxLog ?? []).map((e) => [...e] as [number, (typeof e)[1], number]),
    freightTrips: saved.freightTrips,
    lastBudget: copyData(saved.lastBudget),
    impeached: saved.impeached,
  };
  // Saves from before roads kept their links: every road joins its neighbours, as it did then.
  if (!saved.links) linkAll(state);
  const city = new City(opts, state);
  if (saved.traffic) {
    rleDecode(saved.traffic, N, city.fields.traffic);
    if (saved.railTraffic) rleDecode(saved.railTraffic, N, city.fields.railTraffic);
    if (saved.freightRail) rleDecode(saved.freightRail, N, city.fields.freightRail);
    if (saved.subwayTraffic) rleDecode(saved.subwayTraffic, N, city.fields.subwayTraffic);
    if (saved.monorailTraffic) rleDecode(saved.monorailTraffic, N, city.fields.monorailTraffic);
    if (saved.highTraffic) rleDecode(saved.highTraffic, N, city.fields.highTraffic);
    if (saved.ferryTraffic) rleDecode(saved.ferryTraffic, N, city.fields.ferryTraffic);
    if (saved.eveningTraffic) rleDecode(saved.eveningTraffic, N, city.fields.eveningTraffic);
    city.refresh();
  }
  if (saved.localCommute !== undefined) city.fields.localCommute = saved.localCommute;
  // The Mayor Rating map is drawn monthly; draw it now (the citywide rating is saved).
  computeMayor(city.state, city.fields, city.cfg);
  return city;
}

/** The mission under way, with its vehicle and fire, if any. */
function activeMission(udi: Partial<CityState['udi']> | undefined): Pick<CityState['udi'], 'active' | 'vehicle' | 'fire'> {
  if (!udi?.active) return {};
  return {
    active: udi.active,
    ...(udi.vehicle ? { vehicle: udi.vehicle } : {}),
    ...(udi.fire !== undefined ? { fire: udi.fire } : {}),
  };
}
