// Canvas 2D top-down renderer for a City.

import { DEFAULT_CONFIG, DEV_TYPES, ELEVATED, GROWTH_CODES, INTERCHANGE, isLocalNet, isRail, Net, NETWORK_KINDS, overNet, overNetVertical, STRUCTURES, Terrain, tilesLinked, ZONES, type City, type DevType, type Rect, type RouteTrip, type StructureKind, type TripMeans, type ZoneKind } from '@web-city/engine';
import { ABANDONED_COLOR, buildingRisk, coverageRadius, GROWTH_COLOR, growthNow, RISK_COLOR, volumeAt } from './views';

/** Networks the volume view can show, one at a time (a button per network). */
export type VolumeNetwork = 'road' | 'evening' | 'rail' | 'subway' | 'monorail' | 'highway' | 'ferry';

export type Overlay =
  | { kind: 'none' }
  | { kind: 'desirability'; type: DevType }
  | { kind: 'landValue' }
  | { kind: 'air' }
  | { kind: 'police' }
  | { kind: 'fire' }
  | { kind: 'garbage' }
  | { kind: 'mayor' }
  | { kind: 'waterPollution' }
  | { kind: 'waterService' }
  | { kind: 'traffic' }
  | { kind: 'volume'; network: VolumeNetwork }
  | { kind: 'subway' }
  | { kind: 'power' }
  | { kind: 'health' }
  | { kind: 'school' }
  | { kind: 'age' }
  | { kind: 'commute' }
  | { kind: 'zones' }
  | { kind: 'growth' }
  | { kind: 'radiation' };

export interface Camera {
  /** Tile coordinate at the canvas origin. */
  x: number;
  y: number;
  /** Pixels per tile. */
  scale: number;
}

export interface Preview {
  tiles: [number, number][];
  ok: boolean;
  /** Auto-streets a zoning drag would lay, drawn darker. */
  streets?: [number, number][];
  /** Buildings and facilities a bulldozer drag would remove, outlined red. */
  remove?: Rect[];
  /** What the query pointer is over (outlined). */
  hover?: Rect;
  /** A facility's coverage while placing it: centre and radius in tiles. */
  ring?: { x: number; y: number; r: number };
  /** Fill where it can go, when not the accent blue (a zone's own colour, the bulldozer's amber). */
  color?: string;
  /** The dragged rectangle, outlined (its tiles may be only some of it). */
  box?: Rect;
}

/** Colour per developer type: residential greens, commerce blues/purples, industry ambers. */
export const TYPE_COLOR: Record<DevType, string> = {
  'R$': '#7cc76a', 'R$$': '#3fa34d', 'R$$$': '#1f7a3a',
  'Cs$': '#6bb5e8', 'Cs$$': '#3b86d1', 'Cs$$$': '#2457a8',
  'Co$$': '#9c7ae0', 'Co$$$': '#6a43c4',
  IA: '#c9b458', ID: '#d9822b', IM: '#c9a227', IHT: '#e0c341',
};

const ZONE_COLOR = [
  null,
  // Strong enough to stand out from the grass the moment they are laid.
  'rgba(100,200,90,0.42)', 'rgba(70,180,70,0.5)', 'rgba(40,150,55,0.58)',
  'rgba(80,150,235,0.42)', 'rgba(60,120,225,0.5)', 'rgba(45,95,205,0.58)',
  'rgba(230,135,45,0.5)', 'rgba(200,100,30,0.6)', // industry orange, as its tool and the RCI bar (yellow read as farmland)
  'rgba(190,155,80,0.5)',
  null, // landfill: drawn separately
];

/** A zone kind's colour, strong enough to preview a drag with (dezoning grey, landfill brown). */
export function zoneTint(kind: ZoneKind): string {
  if (kind === 'none') return 'rgba(150,150,150,0.55)';
  if (kind === 'landfill') return 'rgba(130,90,40,0.6)';
  return ZONE_COLOR[ZONES.indexOf(kind)]?.replace(/[\d.]+\)$/, '0.65)') ?? 'rgba(52,120,246,0.5)';
}

const LAND = '#cfd8b8';
/** Pixels a tile in the cached ground image used when zoomed out. */
const GROUND_SCALE = 4;
/** Below this scale the slow-changing layers come from one cached image (see `staticImage`); buildings stand flat there anyway. */
const STATIC_BELOW = 5;
/** The cached image is repainted by chunks of this many tiles a side. */
const CHUNK = 16;

/** Days a new building takes to go up (drawn only). */
const BUILD_DAYS = 8;
const CAR_COLORS = ['#e8e8e8', '#d9534f', '#3b6fd1', '#f0c419', '#2b2b2b', '#8fa3b8'];
// Water in close tones (three far-apart ones banded like a staircase).
const WATER_SHALLOW = '#73a3d4';
const WATER_DEEP = '#5689c2';
const SAND = '#e8dcae';
const TREE_GREENS = ['#2f6b32', '#3a7a3a', '#2a5f2e'];
const STREET = '#808184';
const ROAD = '#55565a';
/** Route Query colours by trip means, and by travel mode along a route. */
export const ROUTE_COLOR: Record<TripMeans, string> = {
  walk: '#d9d9d9', car: '#ff9f43', bus: '#f6d32d', train: '#a0522d', subway: '#b06ad6', monorail: '#7fd3ff', ferry: '#3e8ef7', freight: '#e5484d',
};
// Mode order: Walk, Car, Bus, Train, Subway, Monorail, Ferry, CarFerry, HighCar, HighBus.
const MODE_COLOR = [
  ROUTE_COLOR.walk, ROUTE_COLOR.car, ROUTE_COLOR.bus, ROUTE_COLOR.train, ROUTE_COLOR.subway, ROUTE_COLOR.monorail,
  ROUTE_COLOR.ferry, ROUTE_COLOR.ferry, ROUTE_COLOR.car, ROUTE_COLOR.bus,
];

const NET_COLOR: Record<number, string> = {
  [Net.Street]: STREET, [Net.Road]: ROAD, [Net.Avenue]: '#45464b', [Net.Highway]: '#36404f',
  [Net.Onramp]: '#56606e', [Net.RailCrossing]: ROAD, [Net.OneWay]: '#4f5157',
};
const STATION_GLYPH = { bus: 'B', subway: 'M', rail: 'T', freight: 'F', monorail: 'Ⓜ', ferry: '⛴', carFerry: '⛴' } as const;

const CIVIC_STYLE = {
  power: { fill: '#5d5f66', mark: '#ffd400', glyph: '⚡' },
  water: { fill: '#3f7fc4', mark: '#e6f2ff', glyph: '💧' },
  garbage: { fill: '#6b6a3a', mark: '#e8e2b0', glyph: '♻' },
  police: { fill: '#2b4d9a', mark: '#ffffff', glyph: '★' },
  fire: { fill: '#b8322a', mark: '#ffe0d0', glyph: '🔥' },
  health: { fill: '#f1f1f1', mark: '#d93636', glyph: '+' },
  education: { fill: '#c98a4a', mark: '#fff2c4', glyph: '✎' },
  park: { fill: '#4e9a45', mark: '#2f6f2a', glyph: '' },
  transport: { fill: '#3d4a63', mark: '#ffffff', glyph: '' },
  reward: { fill: '#c9a227', mark: '#3b2f05', glyph: '★' },
  deal: { fill: '#5b3a3a', mark: '#ffb3b3', glyph: '$' },
  landmark: { fill: '#8f6bb8', mark: '#ffffff', glyph: '♦' },
} as const;

/** The colour a facility is drawn in (parks green, police blue …). */
export function structureColor(kind: keyof typeof STRUCTURES): string {
  const def = STRUCTURES[kind];
  const style = def.category === 'safety' ? (def.fire ? 'fire' : 'police') : def.category;
  return def.category === 'park' ? (kind === 'beach' ? '#e6d49a' : '#4e9a45') : CIVIC_STYLE[style as keyof typeof CIVIC_STYLE].fill;
}

/** The sign a facility carries on the map over its colour (★ police, + a hospital, B a bus stop, P parking …). */
function civicGlyph(def: (typeof STRUCTURES)[keyof typeof STRUCTURES], style: keyof typeof CIVIC_STYLE): string {
  const station = 'station' in def ? def.station : undefined;
  return station ? STATION_GLYPH[station.mode] : def.parking ? 'P' : def.airport ? '✈' : def.seaport ? '⚓' : CIVIC_STYLE[style].glyph;
}

/** A facility as the map marks it — its colour, the sign on it and the sign's colour — for its swatch in a list,
 *  so a card's row looks like the building it puts down (a park has its green alone). */
export function structureMark(kind: keyof typeof STRUCTURES): { fill: string; mark: string; glyph: string } {
  const def = STRUCTURES[kind];
  if (def.category === 'park') return { fill: structureColor(kind), mark: '', glyph: '' };
  const style = (def.category === 'safety' ? (def.fire ? 'fire' : 'police') : def.category) as keyof typeof CIVIC_STYLE;
  return { fill: CIVIC_STYLE[style].fill, mark: CIVIC_STYLE[style].mark, glyph: civicGlyph(def, style) };
}

/** Civic buildings' drawn height in tiles (see buildingRise). */
const CIVIC_RISE: Record<keyof typeof CIVIC_STYLE, number> = {
  power: 0.35, water: 0.2, garbage: 0.2, police: 0.35, fire: 0.35, health: 0.45, education: 0.35,
  park: 0, transport: 0.18, reward: 0.5, deal: 0.35, landmark: 0.7,
};

function drawCivic(
  ctx: CanvasRenderingContext2D, st: Rect, category: keyof typeof CIVIC_STYLE, sc: number, distressed: boolean, glyph?: string,
): void {
  const style = { ...CIVIC_STYLE[category], ...(glyph ? { glyph } : {}) };
  const pad = 0.08;
  const fill = distressed ? '#2c2c2c' : style.fill;
  const x = st.x + pad;
  const w = st.w - 2 * pad;
  const h = st.h - 2 * pad;
  const rise = sc >= 5 ? CIVIC_RISE[category] : 0;
  const y = st.y + pad - rise;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + w, y + 0.12, Math.max(0.15, rise * 0.5), h + rise - 0.12);
  if (rise > 0) {
    ctx.fillStyle = shade(fill, 0.62);
    ctx.fillRect(x, y + h, w, rise);
  }
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (sc >= 10) {
    ctx.strokeStyle = shade(fill, 0.78);
    ctx.lineWidth = 0.05;
    ctx.strokeRect(x + 0.06, y + 0.06, w - 0.12, h - 0.12);
  }
  if (category === 'power' && st.w * st.h >= 9) {
    // Smokestacks.
    ctx.fillStyle = '#3d3f45';
    ctx.fillRect(x + st.w * 0.15, y + st.h * 0.1, 0.5, 0.5);
    ctx.fillRect(x + st.w * 0.5, y + st.h * 0.1, 0.5, 0.5);
  }
  if (sc >= 5) {
    const size = Math.min(st.w, st.h) * 0.6;
    ctx.fillStyle = style.mark;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(style.glyph, x + w / 2, y + h / 2 + size * 0.05);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }
}

/** How far a building's roof is drawn above its footprint, in tiles: taller with each stage. */
export function buildingRise(type: DevType, stage: number): number {
  if (type === 'IA') return 0;
  if (type[0] === 'I') return 0.14 + stage * 0.12;
  return 0.08 + stage * 0.095;
}

const shades = new Map<string, string>();

/** `hex` with each channel scaled by k (k > 1 lightens), cached. */
/** Views that colour the networks themselves (no street lines drawn over them). */
const NETWORK_VIEWS = new Set(['traffic', 'volume', 'subway', 'zones']);
/** The views of a field that varies smoothly over the land, washed on smoothly rather than tile by tile. */
const SMOOTH_VIEWS = new Set(['air', 'waterPollution', 'landValue', 'desirability']);

/** A toll booth: a yellow block with a white-edged barrier, seen at any zoom. */
function tollBooth(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#e8b422';
  ctx.fillRect(x + 0.1, y + 0.1, 0.8, 0.8);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 0.08;
  ctx.strokeRect(x + 0.1, y + 0.1, 0.8, 0.8);
  ctx.fillStyle = '#3a2c05';
  ctx.fillRect(x + 0.4, y + 0.2, 0.2, 0.6);
}

/** Whether the reader asked for less motion (looked up when first needed). */
let lessMotion: MediaQueryList | null = null;

/** A streetlight's pool of light, drawn once. */
let glowSprite: HTMLCanvasElement | null = null;
function streetGlow(): HTMLCanvasElement {
  if (glowSprite) return glowSprite;
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(24, 24, 0, 24, 24, 24);
  grad.addColorStop(0, 'rgba(255,205,130,0.3)');
  grad.addColorStop(1, 'rgba(255,205,130,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 48, 48);
  return (glowSprite = c);
}

/** House roofs seen up close: tiles, slate and shingle. */
const ROOFS = ['#b8694f', '#9a7b6a', '#7d8790', '#c08a5a', '#8e5b4a', '#a35f45'];

/** A colour mixed toward a pale grey by t (0 to 1), as hex (so shade() still applies). */
function pale(hex: string, t: number): string {
  if (t <= 0) return hex;
  const key = hex + '~' + t;
  let out = shades.get(key);
  if (!out) {
    const v = parseInt(hex.slice(1), 16);
    const c = (sh: number, to: number) => Math.round(((v >> sh) & 255) * (1 - t) + to * t);
    out = '#' + ((c(16, 214) << 16) | (c(8, 214) << 8) | c(0, 206)).toString(16).padStart(6, '0');
    shades.set(key, out);
  }
  return out;
}

export function shade(hex: string, k: number): string {
  const key = hex + k;
  let out = shades.get(key);
  if (!out) {
    const v = parseInt(hex.slice(1), 16);
    const c = (sh: number) => Math.max(0, Math.min(255, Math.round(((v >> sh) & 255) * k)));
    out = `rgb(${c(16)},${c(8)},${c(0)})`;
    shades.set(key, out);
  }
  return out;
}

/** Roof furniture: parapets and rooftop units on towers, sawtooth roofs and stacks on factories. */
function roofDetail(
  ctx: CanvasRenderingContext2D, id: number, type: DevType, stage: number,
  x: number, y: number, w: number, h: number, base: string,
): void {
  if (type[0] === 'I') {
    // Sawtooth: alternating light and dark strips.
    // (Soft: hard stripes shimmered across a district.) Half run the other way.
    ctx.fillStyle = shade(base, 0.9);
    if (id % 2) for (let k = y + 0.12; k < y + h - 0.04; k += 0.24) ctx.fillRect(x + 0.04, k, w - 0.08, 0.1);
    else for (let k = x + 0.12; k < x + w - 0.04; k += 0.24) ctx.fillRect(k, y + 0.04, 0.1, h - 0.08);
    if (type === 'ID' || type === 'IM') {
      // Smokestacks: how many and in which corner by the building, so a district isn't stamped out.
      const stacks = type === 'ID' ? 1 + (id % 3) : id % 2;
      const right = id % 4 < 2;
      const cy = (id >> 2) % 2 ? y + h - 0.22 : y + 0.22;
      for (let k = 0; k < stacks; k++) {
        const cx = right ? x + w - 0.2 - k * 0.3 : x + 0.2 + k * 0.3;
        ctx.fillStyle = '#5a4a40';
        ctx.beginPath();
        ctx.arc(cx, cy, 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2a221e';
        ctx.beginPath();
        ctx.arc(cx, cy, 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return;
  }
  // Flat roof with a parapet.
  ctx.strokeStyle = shade(base, 0.75);
  ctx.lineWidth = 0.05;
  ctx.strokeRect(x + 0.05, y + 0.05, w - 0.1, h - 0.1);
  // Rooftop units, placed by the building's id so they stay put.
  ctx.fillStyle = '#c7ccd4';
  const units = 1 + (id % 3) + Math.floor(w * h / 2);
  for (let k = 0; k < units; k++) {
    const ux = x + 0.15 + (((id * 7 + k * 5) % 10) / 10) * Math.max(0, w - 0.45);
    const uy = y + 0.15 + (((id * 3 + k * 7) % 10) / 10) * Math.max(0, h - 0.45);
    ctx.fillRect(ux, uy, 0.14, 0.12);
  }
  if (stage >= 7 && w * h >= 2) {
    // Helipad on the tallest towers.
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.22, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** A dashed coverage circle with a light fill. */
function drawRing(ctx: CanvasRenderingContext2D, ring: { x: number; y: number; r: number }, sc: number): void {
  ctx.beginPath();
  ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(77,163,255,0.08)';
  ctx.fill();
  ctx.setLineDash([6 / sc, 4 / sc]);
  ctx.strokeStyle = 'rgba(77,163,255,0.9)';
  ctx.lineWidth = Math.max(0.05, 2 / sc);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * The coverage views (police, fire, health, school) share one scheme: blue,
 * stronger with more cover (0–1); a faint red only where people live or
 * work and none reaches, not over open country.
 */
export function coverage(v: number, used: boolean): string {
  if (v > 0) return `rgba(40,110,230,${Math.min(0.65, 0.12 + v * 0.53).toFixed(3)})`;
  return used ? 'rgba(230,60,60,0.3)' : '';
}

/**
 * Over the health and school views: a home the service reaches, as blue as its residents' index, full from 100 (a
 * city's homes stand at 20 to 70: on the 0–200 scale they read alike, little above the faint reach around them), and
 * never as faint as that reach.
 */
export const INDEX_FULL = 100;
export const indexColor = (v: number) => `rgba(40,110,230,${(0.24 + 0.56 * Math.max(0, Math.min(1, v / INDEX_FULL))).toFixed(3)})`;
/** Over the power and water views: a line or pipe worn to 50 and past (it sparks, it bursts; its budget mends it). */
export const WORN_COLOR = 'rgba(196,64,214,0.95)';
/** The crimes drawn larger and red on the police view (the rest smaller, yellow), and visited first. */
export const HEINOUS: ReadonlySet<string> = new Set(['arson', 'bankRobbery', 'assault', 'stickUp']);
/** The 쾌적도 view's marks on homes unhappy with the mayor: below 0, and below −50 (where riots gather). */
export const UNHAPPY_DOT = '#ff9f1c';
export const RIOT_DOT = '#ff2d2d';
/** Over the fire view: what catches easily (risk from 54, where fires break out), inside the stations' reach and out of it. */
export const FIRE_RISK = 54;
export const RISK_IN = 'rgba(240,150,30,0.62)';
export const RISK_OUT = 'rgba(220,30,30,0.72)';
/** A home or works whose trip reaches nothing within the limit (it is left in six months). */
export const NO_TRIP = 'rgb(110,20,20)';
/** Over the congestion view: rail broken (by a disaster, or worn out with transit unfunded). */
export const BROKEN_RAIL = 'rgba(120,20,20,0.95)';
/**
 * The traffic view's bands: from this many pixels a tile, each network tile is drawn as a band along the way it runs,
 * as wide as the trips over it (closer than this a width can't be told: the tile's colour alone).
 */
const BAND_MIN = 5;
/** A band's width at the busiest tile in the city (in tiles), and at the fewest trips (at least a pixel or so). */
const BAND_WIDE = 0.86;
const BAND_THIN = 0.12;
/** A band's colour by how near its capacity the trips come (0 free → 1 at twice it), in this many steps. */
const BAND_STEPS = 10;
/** The bands are built in blocks of this many tiles a side (only those in view, kept until the traffic changes). */
const BAND_BLOCK = 16;
/** The four ways out of a tile: a band's arms. */
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
/**
 * One kind of way the traffic view draws as bands: where it runs, the trips over it there and its capacity, and the trips
 * of a neighbour it runs into — on its own kind, or another's (a road onto the deck carrying it over a highway) — or −1.
 */
type BandLayer = { on: (i: number) => boolean; trips: (i: number) => number; cap: (i: number) => number; into: (i: number, j: number) => number };

/**
 * The traffic view's kinds of way, in the order drawn: ferry routes (under the bridges), roads, rail, then what rides
 * above them — a road's deck over a ground highway, the north–south highway over an overpass (the ground under both is
 * the east–west highway), elevated rail, monorail and elevated highway.
 */
function bandLayers(city: City): BandLayer[] {
  const s = city.state;
  const f = city.fields;
  const n = s.size;
  const speed = DEFAULT_CONFIG.transport.speed;
  const road = (i: number) => s.net[i] !== Net.None && s.net[i] !== Net.Rail;
  const highway = (i: number) => s.net[i] === Net.Highway || s.net[i] === Net.Onramp;
  const overpass = (i: number) => s.interchange[i] === INTERCHANGE.overpass;
  const deck = (i: number) => overpass(i) || overNet(s, i) !== 0;
  const upright = (i: number) => overpass(i) || overNetVertical(s, i);
  const along = (i: number, j: number, up: boolean) => (up ? i % n === j % n : i - (i % n) === j - (j % n));
  // What a deck comes down onto at its ends: the highway it lifts over an overpass, the local road it carries over a highway.
  const ends = (d: number, j: number) => !deck(j) && (overpass(d) ? highway(j) : road(j) && !highway(j));
  const ferry = (i: number) => s.terrain[i] === Terrain.Water && f.ferryTraffic[i]! > 0;
  const rail = (i: number) => isRail(s.net[i]!) && !s.railDamage[i];
  const lifted = (k: number, trips: Float32Array, cap: number): BandLayer => ({
    on: (i) => s.elevated[i] === k, trips: (i) => trips[i]!, cap: () => cap,
    into: (_, j) => (s.elevated[j] === k ? trips[j]! : k === ELEVATED.highway && s.net[j] === Net.Onramp ? f.traffic[j]! : -1),
  });
  return [
    { on: ferry, trips: (i) => f.ferryTraffic[i]!, cap: () => speed.ferry.capacity, into: (_, j) => (ferry(j) ? f.ferryTraffic[j]! : -1) },
    {
      on: road, trips: (i) => f.traffic[i]!, cap: (i) => speed[NETWORK_KINDS[s.net[i]!]!].capacity,
      // (Onto a deck where it comes down; else as cars may go — at an overpass the ground runs east–west only.)
      into: (i, j) => (deck(j) && along(i, j, upright(j)) && ends(j, i) ? f.highTraffic[j]!
        : road(j) && tilesLinked(s, i, j) && !((overpass(i) || overpass(j)) && i % n === j % n) ? f.traffic[j]! : -1),
    },
    { on: rail, trips: (i) => f.railTraffic[i]!, cap: () => speed.rail.capacity, into: (_, j) => (rail(j) ? f.railTraffic[j]! : -1) },
    {
      on: deck, trips: (i) => f.highTraffic[i]!, cap: (i) => (overpass(i) ? speed.highway.capacity : speed[NETWORK_KINDS[overNet(s, i)]!]!.capacity),
      into: (i, j) => (!along(i, j, upright(i)) ? -1 : deck(j) && upright(j) === upright(i) ? f.highTraffic[j]! : ends(i, j) ? f.traffic[j]! : -1),
    },
    lifted(ELEVATED.rail, f.subwayTraffic, speed.elrail.capacity),
    lifted(ELEVATED.monorail, f.monorailTraffic, speed.monorail.capacity),
    lifted(ELEVATED.highway, f.highTraffic, speed.highway.capacity),
  ];
}
/**
 * The congestion colour (t: 0 free-flowing → 1 at twice the capacity): green, yellow at the capacity, red — the ramp the
 * homes and works between take for their trips (straight from green to red, the middle was a muddy olive).
 */
const jamColor = (t: number, alpha = 1) => {
  const r = t < 0.5 ? Math.round(50 + t * 2 * 175) : 225;
  const g = t < 0.5 ? 205 : Math.round(205 - (t - 0.5) * 2 * 150);
  return `rgba(${r},${g},55,${alpha.toFixed(3)})`;
};

function heat(v: number): string {
  // 0 → red, 0.5 → yellow, 1 → green.
  const t = Math.max(0, Math.min(1, v));
  const r = t < 0.5 ? 220 : Math.round(220 - (t - 0.5) * 2 * 170);
  const g = t < 0.5 ? Math.round(60 + t * 2 * 160) : 220;
  return `rgba(${r},${g},60,0.55)`;
}

function ramp(v: number): string {
  // 0 → transparent, 1 → strong purple.
  const t = Math.max(0, Math.min(1, v));
  return `rgba(120,40,160,${(t * 0.7).toFixed(3)})`;
}

/** The brown the 수도 view lays under the water's supply as it fouls. */
export const FOUL_RGB = [120, 85, 45] as const;
/** Where on the 수도 view's brown the water starts to harm the homes on it (100), as its scale's share. */
export const FOUL_HARM = 0.3;
/**
 * How deep that brown lies on water as foul as `p`: none while it runs nearly clean (20), plain by where it harms the
 * homes on it (0.3 at 100: at 0.12 it read as the blue beside it), deepest (0.45) where it stops a pump (`limit`).
 * (In steps of 0.01: the colours are parsed and kept by their string.)
 */
export function foulness(p: number, limit: number): number {
  const a = p <= 20 ? 0 : p <= 100 ? (FOUL_HARM * (p - 20)) / 80 : FOUL_HARM + 0.15 * Math.min(1, (p - 100) / (limit - 100));
  return Math.round(a * 100) / 100;
}
/**
 * `top` (an rgba string, or '' for nothing) laid over the foul brown at alpha `a`, as one colour (source-over): the supply
 * keeps its own colour over the dirt, which browns what shows through it. (The dirt laid over the supply hid it: a fouled
 * district's dry lots read as brown, not red.)
 */
function overDirt(top: string, a: number): string {
  const [r, g, b] = FOUL_RGB;
  if (!top) return `rgba(${r},${g},${b},${a})`;
  const c = rgbaOf(top);
  const ta = (c & 255) / 255;
  const oa = ta + a * (1 - ta);
  const mix = (t: number, u: number) => Math.round((t * ta + u * a * (1 - ta)) / oa);
  return `rgba(${mix(c >>> 24, r)},${mix((c >>> 16) & 255, g)},${mix((c >>> 8) & 255, b)},${oa.toFixed(3)})`;
}

/** A view colour (rgb(), rgba() or #rrggbb) as packed RGBA bytes, remembered (the views reuse a few hundred). */
const rgbaMemo = new Map<string, number>();
function rgbaOf(color: string): number {
  let v = rgbaMemo.get(color);
  if (v !== undefined) return v;
  let r = 0, g = 0, b = 0, a = 1;
  if (color[0] === '#') {
    r = parseInt(color.slice(1, 3), 16);
    g = parseInt(color.slice(3, 5), 16);
    b = parseInt(color.slice(5, 7), 16);
  } else {
    const p = color.slice(color.indexOf('(') + 1, -1).split(',').map(Number);
    [r, g, b] = p as [number, number, number];
    if (p.length > 3) a = p[3]!;
  }
  v = ((r & 255) << 24 | (g & 255) << 16 | (b & 255) << 8 | Math.round(a * 255)) >>> 0;
  if (rgbaMemo.size > 8192) rgbaMemo.clear();
  rgbaMemo.set(color, v);
  return v;
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
  }

  /** Canvas CSS pixel → tile coordinate. */
  toTile(cam: Camera, px: number, py: number): [number, number] {
    return [Math.floor(cam.x + px / cam.scale), Math.floor(cam.y + py / cam.scale)];
  }

  /** Colour around the map (the theme's). */
  background = '#1b1d22';

  /** Night view (cosmetic): darker map, lit windows and streets. */
  night = false;

  /** How much of the current day has passed (0–1), to place moving units between days. */
  dayFraction = 0;

  /** Seconds of simulated running time, to move traffic (stops while paused). */
  clock = 0;

  /** Offscreen canvas the overlay is painted on (one pixel per tile). */
  private layer = document.createElement('canvas');

  /** The traffic view's ways, the busiest tile's trips and the bands built so far, block by block (paintTrafficBands). */
  private bandCache: { city: City | null; key: string; layers: BandLayer[]; max: number; thin: number; blocks: Map<number, (Path2D | null)[][]> } = { city: null, key: '', layers: [], max: 0, thin: 0, blocks: new Map() };

  /** True when the last frame drew moving cars, so the caller keeps redrawing. */
  animating = false;
  /** Short-lived build feedback drawn over the map (see `draw`); kept running by `animatingEffects`. */
  effects: { kind: 'flash' | 'dust' | 'cost' | 'ping'; x: number; y: number; w: number; h: number; t0: number; text?: string }[] = [];
  /**
   * A goal's screen marks its facilities on the map (amber or red where one
   * is in trouble) and the spots it points to (a problem, a place to build). A spot that is a site for a
   * facility names it (`site`): a press in its ring with that facility in hand lands on it.
   */
  marks: { x: number; y: number; w: number; h: number; tone: '' | 'warn' | 'bad' | 'spot' | 'area'; label?: string; hot?: boolean; site?: StructureKind }[] = [];
  /** A line the guide offers to lay (tile by tile), drawn dashed between its two targets before it is laid. */
  guidePath: [number, number][] | null = null;
  /** What a My Sim's pick in progress may take (a home or a workplace of its wealth), outlined. */
  pickable: { x: number; y: number; w: number; h: number }[] = [];
  /** Edge markers drawn for targets out of view: where (CSS pixels on the canvas) and the tile they point to. */
  edgeMarks: { x: number; y: number; r: number; tx: number; ty: number; label: string }[] = [];
  /** The part of the map nothing covers (CSS px from its top left; see mapBand), where the edge arrows keep. */
  band: { left: number; top: number; right: number; bottom: number } | null = null;
  /** The cards over its top corners (the same; see mapCovers): a target under one is out of sight. */
  covers: { left: number; top: number; right: number; bottom: number }[] = [];
  /** A road in hand on a town not yet joined to its neighbours: the map's edge is where it should reach. */
  edgeHint = false;
  /** With it, the stretches of the edge a city lies across, [side (0 W, 1 E, 2 N, 3 S), from, to); null: all of it. */
  edgeSpans: [number, number, number][] | null = null;
  /** Where the keyboard's build cursor is (set by the arrows; a mouse moving takes it away). */
  cursor: { x: number; y: number } | null = null;
  /** Adds build feedback: a flash or dust over a rectangle, or a cost rising from a point. */
  effect(kind: 'flash' | 'dust' | 'cost' | 'ping', x: number, y: number, w = 1, h = 1, text?: string): void {
    this.effects.push({ kind, x, y, w, h, t0: performance.now(), text });
  }
  /** The cached zoomed-out image still has chunks to repaint: draw again next frame. */
  pendingStill = false;

  /** Tornadoes and robots on the move, with where they are being pulled. */
  live: { x: number; y: number; icon: string; steer: [number, number] | null }[] = [];

  /** Route Query trips to draw (null: none). */
  routes: RouteTrip[] | null = null;

  /** U-Drive-It vehicle and target, when a mission is being driven. */
  drive: { x: number; y: number; tx: number; ty: number; color: string } | null = null;

  private ground: { city: City; image: HTMLCanvasElement; g: CanvasRenderingContext2D; keys: Uint32Array } | null = null;
  /** The zoomed-out map without what moves (see `staticImage`); `painted` holds each tile's key as last drawn. */
  private still: { city: City; image: HTMLCanvasElement; g: CanvasRenderingContext2D; painted: Uint32Array; gate: string; dirty: Set<number>; keys: Uint32Array | null } | null = null;

  /**
   * A key per tile for everything the cached layers draw there: when it
   * changes, the tile's chunk is repainted. Buildings and structures key their
   * whole footprint (their kind, stage, how full; a plant's age).
   */
  private stillKeys(city: City): Uint32Array {
    const s = city.state;
    const N = s.size * s.size;
    const lot = new Uint32Array(N);
    for (const b of s.buildings.values()) {
      let k = (b.id * 2654435761) >>> 0;
      k = Math.imul(k ^ (b.stage | ((b.type ? DEV_TYPES.indexOf(b.type) + 1 : 0) << 4) | (Math.round(b.occupancy * 8) << 9) | (b.historical ? 1 << 13 : 0)), 16777619) >>> 0;
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) lot[y * s.size + x] = k;
    }
    const shabby = s.departments.parks < 60 ? 2 : 0; // parks look run down (see paintLayerB)
    for (const st of s.structures.values()) {
      const k = Math.imul((st.id * 2246822519) ^ (st.life >= 90 ? 1 : 0) ^ shabby, 16777619) >>> 0;
      for (let y = st.y; y < st.y + st.h; y++) for (let x = st.x; x < st.x + st.w; x++) lot[y * s.size + x] = k;
    }
    const keys = new Uint32Array(N);
    for (let i = 0; i < N; i++) {
      let h = (s.terrain[i]! | (s.height[i]! << 2) | (s.net[i]! << 10) | (s.zone[i]! << 16) | (s.tunnel[i]! << 22) | (s.elevated[i]! << 24) | (s.power[i] ? 1 << 28 : 0)) >>> 0;
      h = Math.imul(h ^ lot[i]!, 16777619);
      h = Math.imul(h ^ (Math.min(48, s.trees[i]!) | (s.rubble[i] ? 64 : 0) | (s.tolls[i]! << 7) | (s.interchange[i]! << 9) | (s.landform[i]! << 12)), 16777619);
      h = Math.imul(h ^ (Math.round(s.landfill[i]! / 50) | (Math.min(255, Math.round(s.garbage[i]! * 4)) << 12)), 16777619);
      keys[i] = h >>> 0;
    }
    return keys;
  }

  /**
   * Zoomed out: the ground, networks, trees, structures, buildings, landfill,
   * rubble and scars as one image at GROUND_SCALE, so a frame draws it in one
   * go instead of tens of thousands of shapes (a 256 map). Kept up to date by
   * chunks whose tiles changed, a few milliseconds' worth a frame: a month's
   * end that touches every building catches up over a few frames.
   */
  private staticImage(city: City): HTMLCanvasElement {
    const s = city.state;
    const n = s.size;
    const K = GROUND_SCALE;
    const chunks = Math.ceil(n / CHUNK);
    let c = this.still;
    if (!c || c.city !== city || c.painted.length !== n * n) {
      const image = document.createElement('canvas');
      image.width = n * K;
      image.height = n * K;
      const g = image.getContext('2d')!;
      g.setTransform(K, 0, 0, K, 0, 0);
      // Chunks not yet painted read as land, not holes, while zooming out.
      g.fillStyle = LAND;
      g.fillRect(0, 0, n, n);
      c = this.still = { city, image, g, painted: new Uint32Array(n * n), gate: '', dirty: new Set(), keys: null };
      for (let k = 0; k < chunks * chunks; k++) c.dirty.add(k);
    }
    // The keys are worked out only when the city may have changed.
    const gate = `${s.day}|${city.revision}|${s.departments.parks}`;
    // (Kept while the gate holds: the frames catching up on dirty chunks needn't hash the map again each.)
    let keys = gate === c.gate ? c.keys : null;
    if (gate !== c.gate) {
      c.gate = gate;
      keys = c.keys = this.stillKeys(city);
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] === c.painted[i]) continue;
        const x = i % n;
        const y = (i - x) / n;
        const cx = Math.floor(x / CHUNK);
        const cy = Math.floor(y / CHUNK);
        c.dirty.add(cy * chunks + cx);
        // Shapes on a chunk's edge may reach a little into the next one.
        if (x % CHUNK === 0 && cx > 0) c.dirty.add(cy * chunks + cx - 1);
        if (x % CHUNK === CHUNK - 1 && cx < chunks - 1) c.dirty.add(cy * chunks + cx + 1);
        if (y % CHUNK === 0 && cy > 0) c.dirty.add((cy - 1) * chunks + cx);
        if (y % CHUNK === CHUNK - 1 && cy < chunks - 1) c.dirty.add((cy + 1) * chunks + cx);
      }
    }
    this.pendingStill = c.dirty.size > 0;
    if (!c.dirty.size) return c.image;
    keys ??= c.keys = this.stillKeys(city);
    const until = performance.now() + 4;
    const g = c.g;
    for (const k of c.dirty) {
      const cx = (k % chunks) * CHUNK;
      const cy = Math.floor(k / chunks) * CHUNK;
      const x1 = Math.min(n, cx + CHUNK);
      const y1 = Math.min(n, cy + CHUNK);
      g.save();
      g.beginPath();
      g.rect(cx, cy, x1 - cx, y1 - cy);
      g.clip();
      // What reaches into the chunk from around it (a big building, a line) is drawn too, clipped.
      const m = 4;
      const [rx0, ry0, rx1, ry1] = [Math.max(0, cx - m), Math.max(0, cy - m), Math.min(n, x1 + m), Math.min(n, y1 + m)];
      this.paintGround(g, s, rx0, ry0, rx1, ry1, K, 0, 1);
      this.paintLayerA(g, city, rx0, ry0, rx1, ry1, K, 0, 1 + 1 / K);
      this.paintLayerB(g, city, rx0, ry0, rx1, ry1, K, 0, 1 + 1 / K);
      this.paintLayerC(g, city, rx0, ry0, rx1, ry1, K, 0, 1 + 1 / K);
      g.restore();
      for (let y = cy; y < y1; y++) for (let x = cx; x < x1; x++) c.painted[y * n + x] = keys[y * n + x]!;
      c.dirty.delete(k);
      if (performance.now() > until) break;
    }
    // Chunks left for later frames keep the gate open so they are looked at again,
    // and ask for that next frame (nothing else may: zoomed out, a loaded city stayed half-drawn).
    if (c.dirty.size) c.gate = '';
    this.pendingStill = c.dirty.size > 0;
    return c.image;
  }

  /**
   * The ground at GROUND_SCALE pixels a tile, for drawing zoomed out. Tiles
   * whose terrain, network, zone or lot changed are repainted with the two
   * around them (shores and hill shading look at neighbours); a whole new
   * map is painted afresh.
   */
  private groundImage(city: City): HTMLCanvasElement {
    const s = city.state;
    const n = s.size;
    const K = GROUND_SCALE;
    const keys = new Uint32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      keys[i] = (s.terrain[i]! | (s.height[i]! << 2) | (s.net[i]! << 10) | (s.zone[i]! << 16) | (s.occupant[i] ? 1 << 21 : 0) | (s.tunnel[i]! << 22)) >>> 0;
    }
    let g = this.ground;
    if (!g || g.city !== city || g.keys.length !== keys.length) {
      const image = document.createElement('canvas');
      image.width = n * K;
      image.height = n * K;
      const gctx = image.getContext('2d')!;
      gctx.setTransform(K, 0, 0, K, 0, 0);
      this.paintGround(gctx, s, 0, 0, n, n, K, 0, 1);
      this.ground = { city, image, g: gctx, keys };
      return image;
    }
    const changed: number[] = [];
    for (let i = 0; i < keys.length; i++) if (keys[i] !== g.keys[i]) changed.push(i);
    if (changed.length > (n * n) / 8) {
      this.paintGround(g.g, s, 0, 0, n, n, K, 0, 1);
    } else {
      for (const i of changed) {
        const x = i % n;
        const y = (i - x) / n;
        this.paintGround(g.g, s, Math.max(0, x - 2), Math.max(0, y - 2), Math.min(n, x + 3), Math.min(n, y + 3), K, 0, 1);
      }
    }
    g.keys = keys;
    return g.image;
  }

  /** The land's colour per tile (height tint and north-west light), remade when the city changes. */
  private land: { city: City['state']; key: string; image: HTMLCanvasElement } | null = null;
  private landImage(s: City['state']): HTMLCanvasElement {
    const n = s.size;
    // Heights change with terraforming (an edit) and nothing else; a sampled sum notices.
    let sum = 0;
    for (let i = 0; i < n * n; i += 7) sum = (sum * 31 + s.height[i]!) | 0;
    const key = `${n}|${sum}`;
    if (this.land?.city === s && this.land.key === key) return this.land.image;
    const image = this.land?.city === s ? this.land.image : document.createElement('canvas');
    image.width = n;
    image.height = n;
    const g = image.getContext('2d')!;
    const data = g.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const h = s.height[i]!;
        // Light from the north-west over two tiles, gently: one-tile steps made a checkerboard.
        const west = x > 1 ? s.height[i - 2]! : h;
        const north = y > 1 ? s.height[i - 2 * n]! : h;
        const light = Math.max(-0.12, Math.min(0.12, ((h - west) + (h - north)) * 0.01));
        const tint = Math.min(1, h / 120);
        data.data[4 * i] = Math.round((207 - 40 * tint) * (1 + light));
        data.data[4 * i + 1] = Math.round((216 - 30 * tint) * (1 + light));
        data.data[4 * i + 2] = Math.round((184 - 50 * tint) * (1 + light));
        data.data[4 * i + 3] = 255;
      }
    }
    g.putImageData(data, 0, 0);
    this.land = { city: s, key, image };
    return image;
  }

  /**
   * The water's colour per tile by how far it lies from the shore, shallow to deep (land pixels take the shallows'
   * colour, so the blend along a shore stays shallow), remade when the shore moves.
   */
  private water: { city: City['state']; key: number; image: HTMLCanvasElement; frame: number } | null = null;
  private waterImage(s: City['state']): HTMLCanvasElement {
    const n = s.size;
    // (The shore looked at once a frame: the ground is painted a few tiles at a time after an edit or a month's growth,
    // and each piece by the water hashed the whole map again.)
    if (this.water?.city === s && this.water.frame === this.frames) return this.water.image;
    let key = n;
    for (let i = 0; i < n * n; i++) key = (key * 31 + s.terrain[i]! + 1) | 0;
    if (this.water?.city === s && this.water.key === key) {
      this.water.frame = this.frames;
      return this.water.image;
    }
    const image = this.water?.city === s ? this.water.image : document.createElement('canvas');
    image.width = n;
    image.height = n;
    // Tiles to the nearest land, out to 4.
    const far = new Uint8Array(n * n).fill(255);
    let edge: number[] = [];
    for (let i = 0; i < n * n; i++) if (s.terrain[i] !== Terrain.Water) {
      far[i] = 0;
      edge.push(i);
    }
    for (let d = 1; d <= 4 && edge.length; d++) {
      const next: number[] = [];
      for (const i of edge) {
        const x = i % n;
        for (const j of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, i - n, i + n]) {
          if (j < 0 || j >= n * n || far[j] !== 255) continue;
          far[j] = d;
          next.push(j);
        }
      }
      edge = next;
    }
    const rgb = (c: string) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
    const [a, b] = [rgb(WATER_SHALLOW), rgb(WATER_DEEP)];
    const g = image.getContext('2d')!;
    const data = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const t = far[i] === 0 ? 0 : Math.min(1, (Math.min(far[i]!, 4) - 1) / 3);
      for (let k = 0; k < 3; k++) data.data[4 * i + k] = Math.round(a[k]! + (b[k]! - a[k]!) * t);
      data.data[4 * i + 3] = 255;
    }
    g.putImageData(data, 0, 0);
    this.water = { city: s, key, image, frame: this.frames };
    return image;
  }

  /**
   * Terrain, zones and networks over tiles [x0, x1) × [y0, y1) at scale `sc`.
   * Land is tinted by height and lit from the north-west so hills read at a glance.
   */
  private paintGround(ctx: CanvasRenderingContext2D, s: City['state'], x0: number, y0: number, x1: number, y1: number, sc: number, gap: number, e: number): void {
    const n = s.size;
    // The land's colour by height, one pixel a tile, stretched smoothly over the area
    // (tile by tile it stepped in blocks up close). A tile's margin around the area
    // keeps the blend continuous across the pieces it is drawn in.
    const land = this.landImage(s);
    const ax = Math.max(0, x0 - 1);
    const ay = Math.max(0, y0 - 1);
    const bx = Math.min(n, x1 + 1);
    const by = Math.min(n, y1 + 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(land, ax, ay, bx - ax, by - ay, ax, ay, bx - ax, by - ay);
    // The water likewise, its depth blended within it and its shore kept sharp (three flat shades by distance to the
    // shore, tile by tile, left stray dark squares in the rivers).
    ctx.beginPath();
    let wet = false;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (s.terrain[y * n + x] === Terrain.Water) {
      ctx.rect(x, y, 1, 1);
      wet = true;
    }
    if (wet) {
      ctx.clip();
      ctx.drawImage(this.waterImage(s), ax, ay, bx - ax, by - ay, ax, ay, bx - ax, by - ay);
    }
    ctx.restore();
    // A shore's corners rounded off up close (it ran in square steps): the corner of a tile outside the quarter circle
    // about its middle, filled — land cut back by water where water lies on two sides of it, a bay's corner filled with
    // sand where land does.
    const corner = (x: number, y: number, cx: 0 | 1, cy: 0 | 1) => {
      ctx.beginPath();
      ctx.moveTo(x + cx, y + cy);
      ctx.lineTo(x + cx, y + 0.5);
      ctx.arc(x + 0.5, y + 0.5, 0.5, cx ? 0 : Math.PI, cy ? Math.PI / 2 : -Math.PI / 2, cx !== cy);
      ctx.closePath();
      ctx.fill();
    };
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * n + x;
        const water = s.terrain[i] === Terrain.Water;
        const net = s.net[i]!;
        const isWater = (ax: number, ay: number) => ax < 0 || ay < 0 || ax >= n || ay >= n || s.terrain[ay * n + ax] === Terrain.Water;
        if (water) {
          // (Its colour is waterImage's, drawn above.) A bay's corners rounded with sand, up close.
          if (sc >= 3 && net === Net.None) {
            ctx.fillStyle = SAND;
            for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
              const land = (dx: number, dy: number) => x + dx >= 0 && y + dy >= 0 && x + dx < n && y + dy < n && !isWater(x + dx, y + dy);
              if (land(cx ? 1 : -1, 0) && land(0, cy ? 1 : -1)) corner(x, y, cx, cy);
            }
          }
        } else {
          // (The land's own colour is landImage's, drawn above.)
          if (sc >= 3 && net === Net.None) {
            // Sand along the water's edge.
            ctx.fillStyle = SAND;
            if (y > 0 && isWater(x, y - 1)) ctx.fillRect(x, y, e, 0.22);
            if (y + 1 < n && isWater(x, y + 1)) ctx.fillRect(x, y + 0.78, e, 0.22);
            if (x > 0 && isWater(x - 1, y)) ctx.fillRect(x, y, 0.22, e);
            if (x + 1 < n && isWater(x + 1, y)) ctx.fillRect(x + 0.78, y, 0.22, e);
            // A point of land between water on two sides (and across the corner): rounded off, its sand along the curve.
            for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
              const [dx, dy] = [cx ? 1 : -1, cy ? 1 : -1];
              const wetAt = (ax: number, ay: number) => ax >= 0 && ay >= 0 && ax < n && ay < n && isWater(ax, ay);
              if (!wetAt(x + dx, y) || !wetAt(x, y + dy) || !wetAt(x + dx, y + dy) || s.occupant[i] !== 0) continue;
              ctx.fillStyle = WATER_SHALLOW;
              corner(x, y, cx, cy);
              ctx.strokeStyle = SAND;
              ctx.lineWidth = 0.22;
              ctx.beginPath();
              ctx.arc(x + 0.5, y + 0.5, 0.39, cx ? 0 : Math.PI, cy ? Math.PI / 2 : -Math.PI / 2, cx !== cy);
              ctx.stroke();
              ctx.fillStyle = SAND;
            }
          }
        }
        // Tunnels: the hill shows; the line under it is drawn later.
        if (net !== Net.None && s.tunnel[i] === 1) continue;
        if (net === Net.Rail) {
          // Ballast and two rails; bridges over water get a dark deck.
          ctx.fillStyle = water ? '#4a3f33' : '#b9ad95';
          ctx.fillRect(x, y, e, e);
          continue;
        }
        if (net !== Net.None) {
          ctx.fillStyle = NET_COLOR[net]!;
          if (water) ctx.fillRect(x + 0.15, y + 0.15, 0.7, 0.7);
          else ctx.fillRect(x, y, e, e);
          // A low bridge sits on piers in the water (ferries can't pass).
          if (water && s.tunnel[i] === 3) {
            ctx.fillStyle = '#2b3442';
            ctx.fillRect(x + 0.05, y + 0.05, 0.18, 0.18);
            ctx.fillRect(x + 0.77, y + 0.77, 0.18, 0.18);
          }
          continue;
        }
        const z = ZONE_COLOR[s.zone[i]!];
        if (z && s.occupant[i] === 0) {
          ctx.fillStyle = z;
          // Up close a block of zone reads as one field with faint lot lines (gaps between
          // tiles drew it as graph paper); from afar the gaps keep tiles apart.
          if (sc >= 8) {
            ctx.fillRect(x, y, 1, 1);
            ctx.strokeStyle = 'rgba(255,255,255,0.28)';
            ctx.lineWidth = 1 / sc;
            ctx.strokeRect(x + 0.5 / sc, y + 0.5 / sc, 1 - 1 / sc, 1 - 1 / sc);
          } else ctx.fillRect(x + gap, y + gap, 1 - 2 * gap, 1 - 2 * gap);
        }
      }
    }

  }

  /** Map detail under the traffic: potholes, rails, trees, one-way arrows, road markings, tunnels, elevated lines (see `draw`). */
  private paintLayerA(ctx: CanvasRenderingContext2D, city: City, x0: number, y0: number, x1: number, y1: number, sc: number, gap: number, e: number): void {
    const s = city.state;
    const n = s.size;
    // Potholes when zoomed in.
    if (sc >= 6) {
      ctx.fillStyle = 'rgba(20,20,20,0.75)';
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (!s.potholes[y * n + x]) continue;
          ctx.beginPath();
          ctx.arc(x + 0.3 + ((x * 7 + y * 3) % 5) * 0.1, y + 0.35 + ((x * 3 + y * 5) % 4) * 0.1, 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Rails (and level crossings) as two steel lines along the track.
    if (sc >= 4) {
      ctx.fillStyle = '#4d4d52';
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (!isRail(s.net[y * n + x]!) || s.tunnel[y * n + x] === 1) continue;
          // Track runs only towards the rail it joins, so corners turn instead of crossing.
          const l = x > 0 && isRail(s.net[y * n + x - 1]!);
          const r = x + 1 < n && isRail(s.net[y * n + x + 1]!);
          const u = y > 0 && isRail(s.net[(y - 1) * n + x]!);
          const d = y + 1 < n && isRail(s.net[(y + 1) * n + x]!);
          const lone = !l && !r && !u && !d;
          if (l || r || lone) {
            const a = l || lone ? 0 : 0.3;
            const b = r || lone ? e : 0.7;
            ctx.fillRect(x + a, y + 0.3, b - a, 0.08);
            ctx.fillRect(x + a, y + 0.62, b - a, 0.08);
          }
          if (u || d) {
            const a = u ? 0 : 0.3;
            const b = d ? e : 0.7;
            ctx.fillRect(x + 0.3, y + a, 0.08, b - a);
            ctx.fillRect(x + 0.62, y + a, 0.08, b - a);
          }
        }
      }
    }

    // Trees on open land: saplings small and light, grown ones darker.
    if (sc >= 3) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * n + x;
          const age = s.trees[i]!;
          if (!age || s.occupant[i] || s.net[i]) continue;
          const grown = Math.min(1, age / 48);
          // Crowns of a few greens and sizes (one disc stamped everywhere read as a pattern), lit from the north-west.
          const v = (x * 13 + y * 7) % 5;
          const cx = x + 0.5 + (v - 2) * 0.05;
          const cy = y + 0.5 + ((x * 5 + y * 11) % 5 - 2) * 0.05;
          // From afar crowns touch, so a wood reads as a wood (not a grid of dots).
          const r = sc < 8 ? 0.3 + 0.25 * grown : (0.18 + 0.22 * grown) * (0.85 + v * 0.075);
          if (sc >= 8) {
            // A soft shadow to the south-east, as the buildings cast.
            ctx.fillStyle = 'rgba(0,0,0,0.14)';
            ctx.beginPath();
            ctx.arc(cx + 0.07, cy + 0.08, r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = grown < 1 ? '#6fae4f' : TREE_GREENS[(x * 7 + y * 3) % 3]!;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          if (sc >= 8 && grown >= 1) {
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.beginPath();
            ctx.arc(cx - 0.08, cy - 0.08, r * 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    // One-way arrows when zoomed in.
    if (sc >= 10) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const d = s.oneway[y * n + x]!;
          if (!d || (x + y) % 2) continue;
          const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][d - 1]!;
          const cx = x + 0.5;
          const cy = y + 0.5;
          ctx.beginPath();
          ctx.moveTo(cx + dx! * 0.3, cy + dy! * 0.3);
          ctx.lineTo(cx - dx! * 0.2 - dy! * 0.2, cy - dy! * 0.2 + dx! * 0.2);
          ctx.lineTo(cx - dx! * 0.2 + dy! * 0.2, cy - dy! * 0.2 - dx! * 0.2);
          ctx.fill();
        }
      }
    }

    // Kerbs up close: a pale edge where a street meets land, so roads have a side to them.
    if (sc >= 14) {
      ctx.fillStyle = 'rgba(205,207,212,0.75)';
      const k = 0.06;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * n + x;
          const net = s.net[i]!;
          if (!net || !isLocalNet(net) || s.tunnel[i] === 1 || s.terrain[i] === Terrain.Water) continue;
          const land = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < n && yy < n && !s.net[yy * n + xx];
          if (land(x, y - 1)) ctx.fillRect(x, y, 1, k);
          if (land(x, y + 1)) ctx.fillRect(x, y + 1 - k, 1, k);
          if (land(x - 1, y)) ctx.fillRect(x, y, k, 1);
          if (land(x + 1, y)) ctx.fillRect(x + 1 - k, y, k, 1);
        }
      }
    }

    // Road markings when zoomed in: white dashes on roads and highways, a
    // yellow centre line on avenues.
    if (sc >= 14) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const net = s.net[y * n + x]!;
          if ((net !== Net.Road && net !== Net.Avenue && net !== Net.Highway) || s.tunnel[y * n + x] === 1) continue;
          ctx.fillStyle = net === Net.Avenue ? 'rgba(240,200,60,0.8)' : 'rgba(255,255,255,0.55)';
          // Which way the road runs, by how far it goes each way (an avenue is two tiles wide); junctions stay clear.
          const run = (dx: number, dy: number) => {
            let c = 0;
            for (let k = 1; k <= 2; k++) {
              const ax = x + dx * k;
              const ay = y + dy * k;
              if (ax < 0 || ay < 0 || ax >= n || ay >= n || !s.net[ay * n + ax]) break;
              c++;
            }
            return c;
          };
          const hr = run(1, 0) + run(-1, 0);
          const vr = run(0, 1) + run(0, -1);
          if (hr >= 2 && vr >= 2) continue;
          const h = hr >= vr;
          if (net === Net.Avenue) {
            if (h) ctx.fillRect(x, y + 0.46, 1, 0.08);
            else ctx.fillRect(x + 0.46, y, 0.08, 1);
          } else if (h) ctx.fillRect(x + 0.35, y + 0.47, 0.3, 0.06);
          else ctx.fillRect(x + 0.47, y + 0.35, 0.06, 0.3);
        }
      }
    }

    // Tunnels: a dotted line through the hill and a dark portal at each mouth.
    if (sc >= 3) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * n + x;
          if (!s.tunnel[i]) continue;
          const net = (j: number) => j >= 0 && j < n * n && s.net[j] !== Net.None;
          const h = (x + 1 < n && net(i + 1)) || (x > 0 && net(i - 1));
          if (s.tunnel[i] === 2) {
            // Bridge over a gorge: railings and a shadow on the valley floor.
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            if (h) ctx.fillRect(x, y + 1, e, 0.25);
            else ctx.fillRect(x + 1, y, 0.25, e);
            ctx.fillStyle = '#e9e4d6';
            if (h) {
              ctx.fillRect(x, y, e, 0.08);
              ctx.fillRect(x, y + 0.92, e, 0.08);
            } else {
              ctx.fillRect(x, y, 0.08, e);
              ctx.fillRect(x + 0.92, y, 0.08, e);
            }
            continue;
          }
          ctx.fillStyle = 'rgba(40,40,46,0.55)';
          for (let k = 0; k < 3; k++) {
            if (h) ctx.fillRect(x + 0.1 + k * 0.33, y + 0.44, 0.14, 0.12);
            else ctx.fillRect(x + 0.44, y + 0.1 + k * 0.33, 0.12, 0.14);
          }
          ctx.fillStyle = '#26262b';
          const mouth = (j: number, dx: number, dy: number) => {
            if (!net(j) || s.tunnel[j]) return;
            if (dx) ctx.fillRect(dx > 0 ? x + 0.75 : x, y + 0.15, 0.25, 0.7);
            else ctx.fillRect(x + 0.15, dy > 0 ? y + 0.75 : y, 0.7, 0.25);
          };
          if (h) {
            if (x + 1 < n) mouth(i + 1, 1, 0);
            if (x > 0) mouth(i - 1, -1, 0);
          } else {
            mouth(i + n, 0, 1);
            mouth(i - n, 0, -1);
          }
        }
      }
    }

    // Elevated rail (grey) and monorail (white) above everything on the ground; toll booths.
    if (sc >= 3) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * n + x;
          if (s.interchange[i] === 1) {
            // Overpass: a lighter north–south deck with railings over the crossing.
            ctx.fillStyle = '#6b7787';
            ctx.fillRect(x + 0.12, y - 0.08, 0.76, 1.16);
            ctx.fillStyle = '#c9d1db';
            ctx.fillRect(x + 0.12, y - 0.08, 0.06, 1.16);
            ctx.fillRect(x + 0.82, y - 0.08, 0.06, 1.16);
          } else if (s.interchange[i]! >= 3) {
            // A street, road or avenue over a ground highway: a deck with railings along the road.
            const v = (x > 0 && s.net[i - 1] === Net.Highway) || (x + 1 < n && s.net[i + 1] === Net.Highway);
            const w = s.interchange[i] === 5 ? 0.84 : s.interchange[i] === 3 ? 0.5 : 0.66;
            const o = (1 - w) / 2;
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            if (v) ctx.fillRect(x + o + 0.08, y, w, e);
            else ctx.fillRect(x, y + o + 0.08, e, w);
            ctx.fillStyle = '#5b5f66';
            if (v) ctx.fillRect(x + o, y - 0.06, w, 1.12);
            else ctx.fillRect(x - 0.06, y + o, 1.12, w);
            ctx.fillStyle = '#c9d1db';
            if (v) {
              ctx.fillRect(x + o, y - 0.06, 0.05, 1.12);
              ctx.fillRect(x + o + w - 0.05, y - 0.06, 0.05, 1.12);
            } else {
              ctx.fillRect(x - 0.06, y + o, 1.12, 0.05);
              ctx.fillRect(x - 0.06, y + o + w - 0.05, 1.12, 0.05);
            }
          } else if (s.interchange[i] === 2) {
            // Cloverleaf: a ring of ramps.
            ctx.strokeStyle = '#7fb26b';
            ctx.lineWidth = 0.18;
            ctx.beginPath();
            ctx.arc(x + 0.5, y + 0.5, 0.36, 0, Math.PI * 2);
            ctx.stroke();
          }
          const ev = s.elevated[i]!;
          if (!ev) {
            if (s.tolls[i]) tollBooth(ctx, x, y);
            continue;
          }
          ctx.fillStyle = ev === 1 ? 'rgba(120,124,135,0.95)' : ev === 2 ? 'rgba(235,240,250,0.95)' : 'rgba(54,64,79,0.95)';
          const same = (j: number) => s.elevated[j] === ev;
          const h = (x + 1 < n && same(i + 1)) || (x > 0 && same(i - 1));
          const v = (y + 1 < n && same(i + n)) || (y > 0 && same(i - n));
          const w = ev === 3 ? 0.7 : 0.28;
          if (h || !v) ctx.fillRect(x, y + 0.5 - w / 2, e, w);
          if (v) ctx.fillRect(x + 0.5 - w / 2, y, w, e);
          // A toll on an elevated highway sits on its deck (drawn under it, it was hidden).
          if (s.tolls[i]) tollBooth(ctx, x, y);
        }
      }
    }

  }

  /** Power lines, structures, buildings, landfills, garbage and rubble (see `draw`). */
  private paintLayerB(ctx: CanvasRenderingContext2D, city: City, x0: number, y0: number, x1: number, y1: number, sc: number, gap: number, e: number): void {
    const s = city.state;
    const n = s.size;
    // Power lines: a dashed wire between poles.
    if (sc >= 3) {
      ctx.strokeStyle = '#3a3226';
      ctx.lineWidth = Math.max(0.06, 1 / sc);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (!s.power[y * n + x]) continue;
          // Wire from the pole towards each line it joins.
          const l = x > 0 && s.power[y * n + x - 1];
          const r = x + 1 < n && s.power[y * n + x + 1];
          const u = y > 0 && s.power[(y - 1) * n + x];
          const d = y + 1 < n && s.power[(y + 1) * n + x];
          ctx.beginPath();
          for (const [on, ex, ey] of [[l, x, y + 0.5], [r, x + 1, y + 0.5], [u, x + 0.5, y], [d, x + 0.5, y + 1]] as const) {
            if (!on) continue;
            ctx.moveTo(x + 0.5, y + 0.5);
            ctx.lineTo(ex, ey);
          }
          if (!l && !r && !u && !d) {
            ctx.moveTo(x, y + 0.5);
            ctx.lineTo(x + 1, y + 0.5);
          }
          ctx.stroke();
          ctx.fillStyle = '#6b5a3e';
          ctx.fillRect(x + 0.4, y + 0.4, 0.2, 0.2);
        }
      }
    }

    // Parks and other structures.
    for (const st of s.structures.values()) {
      if (st.x >= x1 || st.y >= y1 || st.x + st.w <= x0 || st.y + st.h <= y0) continue;
      const def = STRUCTURES[st.kind];
      if (def.category !== 'park') {
        const style = def.category === 'safety' ? (def.fire ? 'fire' : 'police') : def.category;
        drawCivic(ctx, st, style, sc, st.life >= 90, civicGlyph(def, style));
        continue;
      }
      // Below 60% city beautification funding parks look distressed.
      const shabby = s.departments.parks < 60;
      ctx.fillStyle = st.kind === 'beach' ? '#e6d49a' : shabby ? '#8a8f5a' : '#4e9a45';
      ctx.fillRect(st.x + 0.06, st.y + 0.06, st.w - 0.12, st.h - 0.12);
      if (st.kind === 'beach') continue;
      ctx.fillStyle = shabby ? '#5e5f3a' : '#2f6f2a';
      const trees = st.w * st.h * 2;
      for (let k = 0; k < trees; k++) {
        const tx = st.x + 0.2 + ((k * 0.618 * 7) % (st.w - 0.4));
        const ty = st.y + 0.2 + ((k * 0.382 * 5) % (st.h - 0.4));
        ctx.beginPath();
        ctx.arc(tx, ty, 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Buildings: a roof raised above the footprint by its stage, with the south wall showing, drawn
    // north to south so nearer buildings overlap the ones behind them.
    const blocks = [...s.buildings.values()]
      .filter((b) => !(b.x >= x1 || b.y >= y1 + 2 || b.x + b.w <= x0 || b.y + b.h <= y0))
      .sort((a, b) => a.y + a.h - (b.y + b.h) || a.x - b.x);
    const raised = sc >= 5;
    for (const b of blocks) {
      const pad = 0.08;
      const fx = b.x + pad;
      const fy = b.y + pad;
      const fw = b.w - 2 * pad;
      const fh = b.h - 2 * pad;
      if (!b.type) {
        // Abandoned: a grey shell, boarded with a cross.
        const r = raised ? buildingRise(b.origType, b.stage) * 0.8 : 0;
        ctx.fillStyle = '#4a4541';
        ctx.fillRect(fx, fy + fh - r, fw, r);
        ctx.fillStyle = '#5b5550';
        ctx.fillRect(fx, fy - r, fw, fh);
        ctx.strokeStyle = '#2b2622';
        ctx.lineWidth = 0.08;
        ctx.beginPath();
        ctx.moveTo(fx + 0.17, fy - r + 0.17);
        ctx.lineTo(fx + fw - 0.17, fy - r + fh - 0.17);
        ctx.moveTo(fx + fw - 0.17, fy - r + 0.17);
        ctx.lineTo(fx + 0.17, fy - r + fh - 0.17);
        ctx.stroke();
        continue;
      }
      const kind = b.type[0];
      const house = kind === 'R' && b.stage <= 3;
      // Up close a house's roof is a roof colour (its green lawn says residential);
      // a part-empty building is paler, still solid (see-through roofs showed the lawn).
      // Up close one factory in three has a plain metal roof.
      const metal = sc >= 12 && kind === 'I' && b.type !== 'IA' && b.id % 3 === 0;
      const base = pale(house && sc >= 8 ? ROOFS[b.id % ROOFS.length]! : metal ? '#9aa0a6' : TYPE_COLOR[b.type], Math.round((1 - b.occupancy) * 4) / 10);
      if (house && sc >= 8) {
        // A house on a lawn: the lot shows around it.
        ctx.fillStyle = '#9fc57f';
        ctx.fillRect(fx, fy, fw, fh);
        if (sc >= 12 && b.w * b.h > 1) {
          ctx.fillStyle = '#4f8a3c';
          ctx.beginPath();
          ctx.arc(fx + fw - 0.22, fy + fh - 0.22, 0.17, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const inset = house && sc >= 8 ? Math.min(fw, fh) * (b.w * b.h > 1 ? 0.22 : 0.12) : 0;
      const hx = fx + inset;
      const hy = fy + inset;
      const hw = fw - 2 * inset;
      const hh = fh - 2 * inset;
      // New buildings go up over their first days: lower, in scaffolding.
      const age = s.day + this.dayFraction - b.builtDay;
      const constructing = b.type !== 'IA' && age < BUILD_DAYS && sc >= 5;
      const progress = constructing ? Math.max(0.15, age / BUILD_DAYS) : 1;
      const rise = raised ? buildingRise(b.type, b.stage) * progress : 0;
      if (rise > 0) {
        // Shadow to the east (light from the west), then the south wall.
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        const sw = Math.min(0.55, rise * 0.45);
        ctx.fillRect(hx + hw, hy - rise + 0.12, sw, hh + rise - 0.12);
        ctx.fillStyle = constructing ? '#8c7b5e' : shade(base, 0.62);
        ctx.fillRect(hx, hy + hh - rise, hw, rise);
        if (sc >= 16 && rise >= 0.3 && !constructing) {
          // Window rows, one per floor.
          ctx.fillStyle = 'rgba(225,238,255,0.4)';
          const floors = Math.max(1, Math.floor((rise - 0.08) / 0.15));
          for (let f = 0; f < floors; f++) {
            const wy = hy + hh - rise + 0.06 + f * ((rise - 0.08) / floors);
            for (let wx = hx + 0.06; wx + 0.08 <= hx + hw - 0.04; wx += 0.16) ctx.fillRect(wx, wy, 0.08, 0.06);
          }
        }
      } else if (!house || sc < 8) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(hx + 0.06, hy + 0.06, hw, hh);
      }
      const ry = hy - rise;
      if (constructing) {
        // Bare concrete with scaffolding lines, and a crane on bigger lots.
        ctx.fillStyle = '#c9c2b4';
        ctx.fillRect(hx, ry, hw, hh);
        if (sc >= 10) {
          ctx.strokeStyle = '#8c7b5e';
          ctx.lineWidth = 0.035;
          ctx.beginPath();
          for (let k = 0.2; k < hw + hh; k += 0.22) {
            ctx.moveTo(hx + Math.min(k, hw), ry + Math.max(0, k - hw));
            ctx.lineTo(hx + Math.max(0, k - hh), ry + Math.min(k, hh));
          }
          ctx.stroke();
          if (b.stage >= 4) {
            ctx.strokeStyle = '#e8b422';
            ctx.lineWidth = 0.07;
            ctx.beginPath();
            ctx.moveTo(hx + 0.15, ry + hh - 0.1);
            ctx.lineTo(hx + 0.15, ry - 0.5);
            ctx.lineTo(hx + Math.min(hw, 1.6), ry - 0.5);
            ctx.stroke();
          }
        }
      } else if (b.type === 'IA' && sc >= 8) {
        // Farm: crop rows and a red barn.
        ctx.fillStyle = base;
        ctx.fillRect(hx, ry, hw, hh);
        ctx.fillStyle = shade(base, 0.78);
        for (let k = hy + 0.1; k < hy + hh - 0.04; k += 0.2) ctx.fillRect(hx + 0.04, k, hw - 0.08, 0.07);
        ctx.fillStyle = '#a8432f';
        ctx.fillRect(hx + 0.06, hy + 0.06, 0.3, 0.24);
        ctx.fillStyle = '#7c2f21';
        ctx.fillRect(hx + 0.06, hy + 0.06, 0.3, 0.06);
      } else if (house && sc >= 12) {
        // Pitched roof: two slopes and a ridge.
        ctx.fillStyle = shade(base, 1.12);
        ctx.fillRect(hx, ry, hw, hh / 2);
        ctx.fillStyle = shade(base, 0.82);
        ctx.fillRect(hx, ry + hh / 2, hw, hh / 2);
        ctx.fillStyle = shade(base, 0.6);
        ctx.fillRect(hx, ry + hh / 2 - 0.025, hw, 0.05);
      } else {
        ctx.fillStyle = base;
        ctx.fillRect(hx, ry, hw, hh);
        if (sc >= 12) roofDetail(ctx, b.id, b.type, b.stage, hx, ry, hw, hh, base);
      }
      ctx.globalAlpha = 1;
      if (sc >= 10 && !house && b.type !== 'IA' && !constructing) {
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(hx, ry, hw, 0.06);
      }
      const roofY = b.y - rise;
      if (b.historical && sc >= 6) {
        // Historical: a gold border.
        ctx.strokeStyle = '#e0b84a';
        ctx.lineWidth = 0.1;
        ctx.strokeRect(fx, roofY + pad, fw, fh);
      }
      if (sc >= 6 && b.type && !b.watered && b.stage > city.cfg.services.waterStageCap[b.type]) {
        // No-water "zot": a drop, only on buildings that need city water.
        ctx.fillStyle = '#4aa3ff';
        ctx.beginPath();
        const dx = b.x + b.w - 0.3;
        const dy = roofY + 0.35;
        ctx.moveTo(dx, dy - 0.25);
        ctx.quadraticCurveTo(dx + 0.18, dy, dx, dy + 0.15);
        ctx.quadraticCurveTo(dx - 0.18, dy, dx, dy - 0.25);
        ctx.fill();
      }
      if (!b.powered && sc >= 6) {
        // No-power "zot".
        ctx.fillStyle = '#ffd400';
        ctx.beginPath();
        const zx = b.x + b.w / 2;
        const zy = roofY + b.h / 2;
        ctx.moveTo(zx + 0.08, zy - 0.35);
        ctx.lineTo(zx - 0.18, zy + 0.05);
        ctx.lineTo(zx, zy + 0.05);
        ctx.lineTo(zx - 0.08, zy + 0.35);
        ctx.lineTo(zx + 0.18, zy - 0.05);
        ctx.lineTo(zx, zy - 0.05);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Landfills: brown earth that darkens as it fills.
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * n + x;
        if (s.zone[i] !== 10) continue;
        const fill = s.landfill[i]! / 300;
        ctx.fillStyle = `rgb(${Math.round(150 - 60 * fill)},${Math.round(130 - 60 * fill)},${Math.round(90 - 40 * fill)})`;
        ctx.fillRect(x, y, e, e);
      }
    }

    // Garbage piled on lots.
    if (sc >= 4) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const g = s.garbage[y * n + x]!;
          if (g < 0.5) continue;
          ctx.fillStyle = '#7a6a3a';
          const k = Math.min(0.45, 0.12 + g / 50);
          ctx.fillRect(x + 0.05, y + 0.95 - k, k, k);
          ctx.fillStyle = '#c9b78a';
          ctx.fillRect(x + 0.08, y + 0.95 - k * 0.6, k * 0.4, k * 0.3);
        }
      }
    }

    // Rubble left by fires.
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!s.rubble[y * n + x]) continue;
        // Scorched ground strewn with broken chunks (a square with two dark
        // marks read as a little house): placed by the tile, so it stays put.
        ctx.fillStyle = 'rgba(58,52,46,0.55)';
        ctx.fillRect(x, y, 1, 1);
        let h = Math.imul((y * n + x) ^ 0x9e3779b9, 2654435761) >>> 0;
        for (let k = 0; k < 6; k++) {
          h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
          const cx = (h & 255) / 255;
          const cy = ((h >>> 8) & 255) / 255;
          const sz = 0.12 + ((h >>> 16) & 15) / 70;
          ctx.fillStyle = k % 3 === 0 ? '#2e2a26' : k % 3 === 1 ? '#8c8379' : '#5f5850';
          ctx.fillRect(x + 0.04 + cx * (0.92 - sz), y + 0.04 + cy * (0.92 - sz), sz, sz * 0.8);
        }
      }
    }

  }

  /** Disaster scars (see `draw`). */
  private paintLayerC(ctx: CanvasRenderingContext2D, city: City, x0: number, y0: number, x1: number, y1: number, sc: number, gap: number, e: number): void {
    const s = city.state;
    const n = s.size;
    // Disaster scars: craters, volcano cones and slopes, fault lines.
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const lf = s.landform[y * n + x]!;
        if (!lf || s.occupant[y * n + x]) continue;
        ctx.fillStyle = lf === 1 ? 'rgba(70,50,35,0.45)' : lf === 2 ? '#5a4a42' : lf === 3 ? 'rgba(120,95,80,0.45)' : 'rgba(40,30,25,0.6)';
        ctx.fillRect(x, y, e, e);
      }
    }
  }


  /** Frames drawn (what is looked at once a frame keys by it). */
  private frames = 0;

  /**
   * The traffic view's ways close up: each tile of a way a band along the ways it joins, as wide as the trips over it
   * against the busiest tile in the city (so a road keeps its width as the view pans), coloured by how near its capacity
   * they come (see bandLayers for which ways, in which order). Where two tiles join, the band takes the width between
   * theirs (no step at the seam); a way nobody takes is left to the faint tile under it. Built a block of the map at a
   * time and kept until the traffic or the city changes (built afresh each frame, a big map's bands took longer than
   * the rest of the frame).
   */
  private paintTrafficBands(ctx: CanvasRenderingContext2D, city: City, x0: number, y0: number, x1: number, y1: number, sc: number): void {
    const f = city.fields;
    const n = city.state.size;
    // (The month's traffic is laid down over several frames without the city's revision moving: a sample of it keys
    // the cache too — keyed by the day, the busiest tile of last month stood all the next.)
    const every = Math.max(1, Math.floor((n * n) / 20000));
    let sum = 0;
    for (let i = 0; i < n * n; i += every) sum += f.traffic[i]! + f.railTraffic[i]! + f.highTraffic[i]! + f.subwayTraffic[i]! + f.monorailTraffic[i]! + f.ferryTraffic[i]!;
    const key = `${city.revision}|${n}|${sum}`;
    let c = this.bandCache;
    if (c.city !== city || c.key !== key) {
      const layers = bandLayers(city);
      let max = 0;
      for (const L of layers) for (let i = 0; i < n * n; i++) if (L.on(i)) max = Math.max(max, L.trips(i));
      c = this.bandCache = { city, key, layers, max, thin: 0, blocks: new Map() };
    }
    if (!c.max) return;
    // The fewest trips a pixel or so wide, however far out (in steps: each step builds the blocks again).
    const thin = Math.max(BAND_THIN, Math.ceil(1.2 / sc / 0.04) * 0.04);
    if (c.thin !== thin) {
      c.thin = thin;
      c.blocks.clear();
    }
    const { layers, max } = c;
    const width = (v: number) => (v > 0 ? thin + (BAND_WIDE - thin) * Math.sqrt(Math.min(1, v / max)) : 0);
    const block = (bx: number, by: number): (Path2D | null)[][] => {
      const paths = layers.map(() => new Array<Path2D | null>(BAND_STEPS).fill(null));
      layers.forEach((L, l) => {
        for (let y = by * BAND_BLOCK; y < Math.min(n, (by + 1) * BAND_BLOCK); y++) {
          for (let x = bx * BAND_BLOCK; x < Math.min(n, (bx + 1) * BAND_BLOCK); x++) {
            const i = y * n + x;
            if (!L.on(i)) continue;
            const v = L.trips(i);
            const w = width(v);
            if (!w) continue;
            const step = Math.round(Math.min(1, v / L.cap(i) / 2) * (BAND_STEPS - 1));
            const p = (paths[l]![step] ??= new Path2D());
            p.rect(x + 0.5 - w / 2, y + 0.5 - w / 2, w, w);
            // Half a tile toward each neighbour it runs into that carries trips too, at the width between the two.
            for (const [dx, dy] of SIDES) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
              const wj = width(L.into(i, yy * n + xx));
              if (!wj) continue;
              const h = (w + wj) / 4;
              if (dx) p.rect(dx > 0 ? x + 0.5 : x, y + 0.5 - h, 0.5, 2 * h);
              else p.rect(x + 0.5 - h, dy > 0 ? y + 0.5 : y, 2 * h, 0.5);
            }
          }
        }
      });
      return paths;
    };
    const seen: (Path2D | null)[][][] = [];
    for (let by = Math.floor(y0 / BAND_BLOCK); by * BAND_BLOCK < y1; by++) {
      for (let bx = Math.floor(x0 / BAND_BLOCK); bx * BAND_BLOCK < x1; bx++) {
        const k = by * n + bx;
        let b = c.blocks.get(k);
        if (!b) c.blocks.set(k, (b = block(bx, by)));
        seen.push(b);
      }
    }
    // A kind of way over the whole view before the next (what rides above lies over the ways under it everywhere).
    for (let l = 0; l < layers.length; l++) {
      for (const b of seen) {
        b[l]!.forEach((p, k) => {
          if (!p) return;
          ctx.fillStyle = jamColor(k / (BAND_STEPS - 1));
          ctx.fill(p);
        });
      }
    }
  }

  draw(city: City, cam: Camera, overlay: Overlay, preview: Preview | null, selected: Rect | null): void {
    this.frames++;
    const { ctx } = this;
    const s = city.state;
    const n = s.size;
    const sc = cam.scale * this.dpr;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(sc, 0, 0, sc, -cam.x * sc, -cam.y * sc);
    // Where the map's edge is in view, it casts a soft shadow on the margin (a hard cut looked unfinished),
    // and the margin is a faint grid of dots that moves with the map: a table the map lies on, not a void.
    if (cam.x < 0 || cam.y < 0 || cam.x + W / sc > n || cam.y + H / sc > n) {
      let step = 2; // tiles between dots: a power of two, at least 18 pixels apart at any zoom
      while (step * sc < 18) step *= 2;
      const dot = 2 / sc;
      ctx.fillStyle = document.documentElement.dataset.theme === 'light' && !this.night ? 'rgba(20,30,50,0.09)' : 'rgba(255,255,255,0.1)';
      const gx0 = Math.floor(cam.x / step) * step;
      const gy0 = Math.floor(cam.y / step) * step;
      for (let gy = gy0; gy <= cam.y + H / sc; gy += step) {
        for (let gx = gx0; gx <= cam.x + W / sc; gx += step) {
          if (gx > 0 && gx < n && gy > 0 && gy < n) continue; // (the map covers its own)
          ctx.fillRect(gx - dot / 2, gy - dot / 2, dot, dot);
        }
      }
      ctx.save();
      ctx.shadowColor = this.night ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.18)';
      ctx.shadowBlur = 24;
      ctx.fillStyle = LAND;
      ctx.fillRect(0, 0, n, n);
      ctx.restore();
    }

    const x0 = Math.max(0, Math.floor(cam.x));
    const y0 = Math.max(0, Math.floor(cam.y));
    const x1 = Math.min(n, Math.ceil(cam.x + W / sc) + 1);
    const y1 = Math.min(n, Math.ceil(cam.y + H / sc) + 1);
    const gap = sc >= 6 ? 0.04 : 0;
    // Slight overdraw hides anti-aliasing seams between neighbouring tiles.
    const e = 1 + 1 / sc;

    // Terrain, zones, networks. Zoomed out, the whole map is in view and a
    // tile is a few pixels: a cached image of it (kept up to date tile by
    // tile) instead of a fill per tile.
    // Further out still, the layers above it that change slowly come cached as well.
    const still = sc < STATIC_BELOW;
    if (still) {
      const image = this.staticImage(city);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0, n, n);
      ctx.imageSmoothingEnabled = true;
    } else if (sc < GROUND_SCALE * 1.5) {
      const image = this.groundImage(city);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0, n, n);
      ctx.imageSmoothingEnabled = true;
    } else this.paintGround(ctx, s, x0, y0, x1, y1, sc, gap, e);

    if (!still) this.paintLayerA(ctx, city, x0, y0, x1, y1, sc, gap, e);

    // Cars: a few moving dots per road tile, more and slower as traffic nears capacity.
    this.animating = false;
    if (sc >= 8) {
      const f = city.fields;
      const speed = DEFAULT_CONFIG.transport.speed;
      const road = (j: number) => s.net[j] !== Net.None && !isRail(s.net[j]!) && s.tunnel[j] !== 1;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * n + x;
          if (!road(i)) continue;
          const u = f.traffic[i]! / speed[NETWORK_KINDS[s.net[i]!]!].capacity;
          const cars = Math.min(4, Math.round(Math.sqrt(u) * 5));
          if (!cars) continue;
          // Direction from how far the road runs each way (an avenue is two tiles wide).
          const run = (dx: number, dy: number) => {
            let c = 0;
            for (let k = 1; k <= 2; k++) {
              const ax = x + dx * k;
              const ay = y + dy * k;
              if (ax < 0 || ay < 0 || ax >= n || ay >= n || !road(ay * n + ax)) break;
              c++;
            }
            return c;
          };
          const hr = run(1, 0) + run(-1, 0);
          const vr = run(0, 1) + run(0, -1);
          if (hr >= 2 && vr >= 2) continue; // keep junctions clear
          const v = vr > hr;
          const h = !v;
          this.animating = true;
          const pace = 0.9 / (1 + u * 1.5);
          const seed = ((x * 73856093) ^ (y * 19349663)) >>> 0;
          for (let k = 0; k < cars; k++) {
            const lane = k % 2;
            let p = (this.clock * pace + k / cars + (seed % 97) / 97) % 1;
            // Two-way: the second lane drives back. One-way (1 east, 2 south, 3 west, 4 north): both lanes go its way.
            const ow = s.net[i] === Net.Highway ? 0 : s.oneway[i]!; // (a one-way deck above keeps its own direction)
            if (ow ? ow === 3 || ow === 4 : lane) p = 1 - p;
            ctx.fillStyle = CAR_COLORS[(seed + k) % CAR_COLORS.length]!;
            const off = lane ? 0.32 : 0.68;
            if (v && !h) ctx.fillRect(x + (lane ? 0.68 : 0.32) - 0.07, y + p - 0.1, 0.14, 0.2);
            else ctx.fillRect(x + p - 0.1, y + off - 0.07, 0.2, 0.14);
          }
        }
      }
    }

    if (!still) this.paintLayerB(ctx, city, x0, y0, x1, y1, sc, gap, e);

    // Fires: flickering flames sized by stage.
    const t = performance.now() / 200;
    for (const fire of s.fires) {
      const r = fire.target > 0 ? s.buildings.get(fire.target) : s.structures.get(-fire.target);
      if (!r) continue;
      const k = 0.25 + fire.stage * 0.12;
      for (let j = 0; j < Math.max(1, r.w * r.h); j++) {
        const fx = r.x + ((j % r.w) + 0.5);
        const fy = r.y + (Math.floor(j / r.w) + 0.6);
        const flick = 0.85 + 0.15 * Math.sin(t + j * 1.7 + fire.target);
        ctx.fillStyle = 'rgba(255,120,0,0.85)';
        ctx.beginPath();
        ctx.ellipse(fx, fy, k * 0.55, k * flick, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,230,80,0.9)';
        ctx.beginPath();
        ctx.ellipse(fx, fy + k * 0.2, k * 0.25, k * 0.5 * flick, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // From any zoom, a red ring round what burns, beating slowly (still, asked for less motion): zoomed out its
      // flames were two dots of a few pixels, and the fire station's red badge beside them looked more like a fire.
      const u = this.dpr / sc;
      const beat = (lessMotion ??= matchMedia('(prefers-reduced-motion: reduce)')).matches ? 1 : 0.8 + 0.2 * Math.sin(t * 0.8 + fire.target);
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.max(Math.max(r.w, r.h) / 2 + 0.4, 11 * u), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,60,40,0.18)';
      ctx.fill();
      // A dark edge under the red, so it still reads on orange industry and yellow farms.
      ctx.lineWidth = 5 * u;
      ctx.strokeStyle = 'rgba(30,8,4,0.5)';
      ctx.stroke();
      ctx.lineWidth = 2.5 * u;
      ctx.strokeStyle = `rgba(255,60,40,${beat.toFixed(3)})`;
      ctx.stroke();
    }

    // Burning woods: a small flame per tile.
    for (const tf of s.treeFires) {
      const fx = (tf.i % n) + 0.5;
      const fy = Math.floor(tf.i / n) + 0.6;
      const flick = 0.85 + 0.15 * Math.sin(t + tf.i);
      ctx.fillStyle = 'rgba(255,120,0,0.85)';
      ctx.beginPath();
      ctx.ellipse(fx, fy, 0.22, 0.4 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,230,80,0.9)';
      ctx.beginPath();
      ctx.ellipse(fx, fy + 0.08, 0.1, 0.2 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!still) this.paintLayerC(ctx, city, x0, y0, x1, y1, sc, gap, e);

    // Damaged rail, toxic spills, recent pileups and derailments.
    if (sc >= 4) {
      ctx.strokeStyle = '#d63a2f';
      ctx.lineWidth = 0.12;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (!s.railDamage[y * n + x]) continue;
          ctx.beginPath();
          ctx.moveTo(x + 0.25, y + 0.25);
          ctx.lineTo(x + 0.75, y + 0.75);
          ctx.moveTo(x + 0.75, y + 0.25);
          ctx.lineTo(x + 0.25, y + 0.75);
          ctx.stroke();
        }
      }
    }
    for (const sp of s.spills) {
      const x = sp.i % n;
      const y = (sp.i - x) / n;
      ctx.fillStyle = 'rgba(120,220,40,0.7)';
      ctx.beginPath();
      ctx.arc(x + 0.5, y + 0.5, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fire and police units: a filled badge on site; on the way, a ring moving
    // along its route (the fraction of today gone smooths it between days).
    for (const u of s.units) {
      ctx.strokeStyle = u.kind === 'fire' ? '#ff5a3c' : '#4d8dff';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 0.15;
      let px = u.x;
      let py = u.y;
      if (u.travel > 0 && u.path && u.path.length > 1) {
        const days = Math.max(1, u.days ?? u.travel);
        const p = Math.max(0, Math.min(1, (days - u.travel + this.dayFraction) / days));
        const f = p * (u.path.length - 1);
        const k = Math.min(u.path.length - 2, Math.floor(f));
        const a = u.path[k]!;
        const b = u.path[k + 1]!;
        const t = f - k;
        px = (a % n) * (1 - t) + (b % n) * t;
        py = Math.floor(a / n) * (1 - t) + Math.floor(b / n) * t;
      }
      ctx.beginPath();
      ctx.arc(px + 0.5, py + 0.5, u.air ? 0.8 : 0.6, 0, Math.PI * 2);
      if (u.travel > 0) ctx.stroke();
      else ctx.fill();
    }

    // Riots: a ring that grows with the crowd (see-through: the lots under it
    // stay readable) round a small solid badge with its stage.
    for (const mob of s.mobs) {
      const colour = `255,${200 - mob.stage * 30},40`;
      const r = 0.8 + mob.stage * 0.3;
      ctx.fillStyle = `rgba(${colour},0.18)`;
      ctx.strokeStyle = `rgba(${colour},0.9)`;
      ctx.lineWidth = Math.max(0.12, 2 / sc);
      ctx.beginPath();
      ctx.arc(mob.x + 0.5, mob.y + 0.5, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = `rgba(${colour},0.95)`;
      ctx.beginPath();
      ctx.arc(mob.x + 0.5, mob.y + 0.5, 0.55, 0, Math.PI * 2);
      ctx.fill();
      if (sc >= 5) {
        ctx.fillStyle = '#1b1d22';
        ctx.font = 'bold 1px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(mob.stage), mob.x + 0.5, mob.y + 0.55);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }
    }

    // Arsonists about to strike: a torch (a flame over a dark dot) on the building they mean to set alight.
    for (const a of s.arsonists) {
      ctx.fillStyle = 'rgba(27,29,34,0.85)';
      ctx.beginPath();
      ctx.arc(a.x + 0.5, a.y + 0.65, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,140,30,0.95)';
      ctx.beginPath();
      ctx.arc(a.x + 0.5, a.y + 0.2, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,230,90,0.95)';
      ctx.beginPath();
      ctx.arc(a.x + 0.5, a.y + 0.25, 0.14, 0, Math.PI * 2);
      ctx.fill();
    }

    // Night: the city darkens, windows and streetlights come on, radiation glows brighter.
    if (this.night) {
      ctx.fillStyle = 'rgba(8,12,32,0.62)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = 'rgba(255,214,120,0.9)';
      for (const b of s.buildings.values()) {
        if (!b.type || b.occupancy <= 0 || b.x >= x1 || b.y >= y1 || b.x + b.w <= x0 || b.y + b.h <= y0) continue;
        const rise = sc >= 5 ? buildingRise(b.type, b.stage) : 0;
        if (rise >= 0.3) {
          // Lit windows on the south wall, more in fuller buildings.
          const x = b.x + 0.08;
          const w = b.w - 0.16;
          const y = b.y + b.h - 0.08 - rise;
          const floors = Math.max(1, Math.floor((rise - 0.08) / 0.15));
          let k = 0;
          for (let f = 0; f < floors; f++) {
            for (let wx = x + 0.06; wx + 0.08 <= x + w - 0.04; wx += 0.16, k++) {
              if (((b.id * 31 + k * 17) % 100) / 100 < b.occupancy * 0.8) {
                ctx.fillRect(wx, y + 0.06 + f * ((rise - 0.08) / floors), 0.08, 0.06);
              }
            }
          }
          continue;
        }
        // A few lit windows, more in fuller buildings.
        const lit = Math.max(1, Math.round(b.w * b.h * 3 * b.occupancy));
        for (let k = 0; k < lit; k++) {
          const wx = b.x + 0.2 + (((b.id * 7 + k * 13) % 10) / 10) * (b.w - 0.4);
          const wy = b.y + 0.2 - rise + (((b.id * 11 + k * 5) % 10) / 10) * (b.h - 0.4);
          ctx.fillRect(wx, wy, 0.12, 0.12);
        }
      }
      if (sc >= 4) {
        // Streetlights: a soft pool of light around a bright point (the pools close up, where they read and are few).
        if (sc >= 8) {
          const glow = streetGlow();
          ctx.globalCompositeOperation = 'lighter';
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            if (s.net[y * n + x] && !s.tunnel[y * n + x] && (x + y) % 3 === 0) ctx.drawImage(glow, x - 0.25, y - 0.25, 1.5, 1.5);
          }
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.fillStyle = 'rgba(255,240,190,0.85)';
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          if (s.net[y * n + x] && !s.tunnel[y * n + x] && (x + y) % 3 === 0) ctx.fillRect(x + 0.45, y + 0.45, 0.1, 0.1);
        }
      }
    }

    // Pileups and derailments, over the night (darkened they read as brown blobs):
    // a disc with a white ring, and a "!" up close.
    for (const inc of s.incidents) {
      const x = inc.i % n;
      const y = (inc.i - x) / n;
      ctx.fillStyle = inc.kind === 'pileup' ? '#ff9a2e' : '#d63a2f';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.arc(x + 0.5, y + 0.5, 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (sc >= 8) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x + 0.46, y + 0.28, 0.08, 0.28);
        ctx.fillRect(x + 0.46, y + 0.62, 0.08, 0.08);
      }
    }

    // Radiation zones glow until they clear.
    ctx.fillStyle = this.night ? 'rgba(190,255,60,0.55)' : 'rgba(170,230,40,0.28)';
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (s.radiation[y * n + x]) ctx.fillRect(x, y, e, e);

    // Overlay.
    if (overlay.kind !== 'none') {
      const f = city.fields;
      const desir = overlay.kind === 'desirability' ? city.desirabilityMap(overlay.type) : null;
      const growth = overlay.kind === 'growth' ? growthNow(city) : null;
      const pumpLimit = city.cfg.services.pumpPollutionLimit;
      let volumeMax = 0;
      // Against the busiest tile in the whole city (a road's colour must not change as the view pans).
      if (overlay.kind === 'volume') for (let i = 0; i < n * n; i++) volumeMax = Math.max(volumeMax, volumeAt(s, f, overlay.network, i));
      const onWater = overlay.kind === 'volume' && overlay.network === 'ferry';
      // The traffic view close enough for widths: its ways drawn as bands after the tiles.
      const bands = overlay.kind === 'traffic' && sc >= BAND_MIN;
      // A tile where people live: zoned for homes (codes 1–3), or a home stands on it.
      const homeAt = (i: number): boolean => {
        const z = s.zone[i]!;
        if (z >= 1 && z <= 3) return true;
        const occ = s.occupant[i]!;
        return occ > 0 && s.buildings.get(occ)?.type?.[0] === 'R';
      };
      // Painted at one pixel per tile, then scaled up in one piece: no seams where
      // translucent tiles would overlap.
      if (this.layer.width !== n) {
        this.layer.width = n;
        this.layer.height = n;
      }
      const lctx = this.layer.getContext('2d')!;
      // Written as pixels (a fillRect per tile was tens of thousands of calls a frame on a big map).
      const pw = x1 - x0;
      const pixels = new ImageData(Math.max(1, pw), Math.max(1, y1 - y0));
      const px = pixels.data;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * n + x;
          if (s.terrain[i] === Terrain.Water && !onWater) continue;
          let color: string;
          switch (overlay.kind) {
            case 'desirability': {
              // Yellow at the develop threshold (50), full green from 150.
              const v = desir![i]!;
              color = heat(v < 50 ? v / 100 : 0.5 + (v - 50) / 200);
              break;
            }
            case 'landValue':
              color = ramp(f.landValue[i]! / 50);
              break;
            case 'air':
              color = `rgba(90,70,40,${Math.min(0.75, f.air[i]! / 80).toFixed(3)})`;
              break;
            case 'police':
              // (Its reach; last month's crimes are dots over it, below.)
              color = coverage(f.policeCover[i]! / 300, s.zone[i]! > 0 && s.zone[i] !== 10 || s.occupant[i]! > 0);
              if (!color) continue;
              break;
            case 'fire': {
              // Its reach, and over it what catches easily: amber where a station reaches, red where none does.
              const used = s.zone[i]! > 0 && s.zone[i] !== 10 || s.occupant[i]! > 0;
              const risky = used && f.flammability[i]! >= FIRE_RISK;
              color = risky ? (f.fireCover[i]! > 0 ? RISK_IN : RISK_OUT) : coverage(f.fireCover[i]! / 250, used);
              if (!color) continue;
              break;
            }
            case 'mayor':
              if (!f.mayorSet[i]) continue;
              color = heat((f.mayor[i]! + 60) / 120);
              break;
            case 'garbage':
              if (s.zone[i] === 10) color = `rgba(120,80,30,${(0.3 + 0.6 * s.landfill[i]! / 300).toFixed(3)})`;
              else if (s.garbage[i]! > 0.1) color = `rgba(200,40,40,${Math.min(0.8, 0.2 + s.garbage[i]! / 25).toFixed(3)})`;
              else continue;
              break;
            case 'waterPollution':
              color = `rgba(120,85,45,${Math.min(0.75, f.waterPollution[i]! / 80).toFixed(3)})`;
              break;
            case 'waterService': {
              // Underground view: pipes (the worn ones apart), coverage and dry lots — and under them how foul the
              // water runs, browner the fouler, deepest where it stops a pump (수질, one map with the supply).
              if (s.pipe[i]) {
                color = s.pipeWear[i]! >= 50 ? WORN_COLOR : 'rgba(20,90,200,0.95)';
                break;
              }
              const supply = f.watered[i] ? 'rgba(70,150,255,0.35)' : f.waterNet[i]! >= 0 ? 'rgba(255,150,40,0.4)'
                : (s.zone[i] && s.zone[i] !== 10) || s.occupant[i]! > 0 ? 'rgba(230,40,40,0.3)' : '';
              const dirt = foulness(f.waterPollution[i]!, pumpLimit);
              if (!dirt && !supply) continue;
              color = dirt ? overDirt(supply, dirt) : supply;
              break;
            }
            case 'power':
              // (The worn lines apart: the grid's own trouble, mended by its budget.)
              if (s.power[i] && s.lineWear[i]! >= 50) color = WORN_COLOR;
              else if (f.powered[i]) color = 'rgba(255,214,0,0.35)';
              else if ((s.zone[i] && s.zone[i] !== 10) || s.occupant[i]! > 0) color = 'rgba(230,40,40,0.45)';
              else continue;
              break;
            // (Hospitals and schools are for homes alone: red where people live and none reaches, not on the
            // workplaces — a large red patch of industry sat beside "모든 집이 병원 범위 안입니다".) Where one reaches, a
            // home is as blue as its residents are healthy (or schooled), indexColor; the rest of the reach faintly.
            case 'health':
            case 'school': {
              const reach = (overlay.kind === 'health' ? f.healthQuality : f.schoolQuality)[i]!;
              if (!homeAt(i)) {
                if (!(reach > 0)) continue;
                color = coverage(0.001, false);
                break;
              }
              const occ = s.occupant[i]!;
              const b = occ > 0 ? s.buildings.get(occ) : undefined;
              color = !(reach > 0) ? coverage(0, true) : b?.type?.[0] === 'R' ? indexColor(overlay.kind === 'health' ? b.hq : b.eq) : coverage(0.001, false);
              break;
            }
            case 'age': {
              // Resident average age: pale for young households, deep blue for old.
              const occ = s.occupant[i]!;
              const b = occ > 0 ? s.buildings.get(occ) : undefined;
              if (!b?.type || b.type[0] !== 'R') continue;
              const a = Math.max(0, Math.min(1, (b.age - 18) / 62));
              color = `rgb(${Math.round(250 - 220 * a)},${Math.round(235 - 165 * a)},${Math.round(160 + 60 * a)})`;
              break;
            }
            case 'growth': {
              // Empty zones by what keeps developers away (built since the last refresh: skipped).
              const occ = s.occupant[i]!;
              if (occ > 0) {
                // Abandoned buildings, and those counting down to it: the other half of "why isn't it growing".
                const b = s.buildings.get(occ);
                if (!b) continue;
                if (!b.type) color = ABANDONED_COLOR;
                else if (buildingRisk(b)) color = RISK_COLOR;
                else continue;
                break;
              }
              const code = occ ? 0 : growth?.[i] ?? 0;
              if (!code) continue;
              color = GROWTH_COLOR[GROWTH_CODES[code - 1]!];
              break;
            }
            case 'commute': {
              // Residents' trip to work and industry's freight trip: green quick, red near the
              // 2.5-hour limit, dark red where nothing is reachable.
              const occ = s.occupant[i]!;
              const b = occ > 0 ? s.buildings.get(occ) : undefined;
              if (!b?.type || (b.type[0] !== 'R' && b.type[0] !== 'I')) continue;
              const limit = DEFAULT_CONFIG.transport.tripLimit;
              color = b.commute < 0 || b.commute > limit ? NO_TRIP : heat(1 - b.commute / limit);
              break;
            }
            case 'zones':
              // Buildings collapsed: only how the land is zoned (the Zones view).
              if (s.zone[i] === 10) color = 'rgb(130,95,55)';
              else if (ZONE_COLOR[s.zone[i]!]) color = ZONE_COLOR[s.zone[i]!]!.replace(/[\d.]+\)$/, '0.95)');
              else continue;
              break;
            case 'radiation':
              if (!s.radiation[i]) {
                color = 'rgba(20,24,30,0.35)';
                break;
              }
              color = `rgba(170,255,40,${Math.min(0.95, 0.35 + s.radiation[i]! / 120).toFixed(3)})`;
              break;
            case 'traffic': {
              // Volume against capacity: green when free-flowing, red at twice capacity; broken rail apart. Between the
              // networks the homes and works, by how long their trip takes, as the commute view had them (the traffic
              // screen's one map: where it jams, and whom it keeps waiting).
              const code = s.net[i]!;
              if (code === Net.None) {
                const occ = s.occupant[i]!;
                const b = occ > 0 ? s.buildings.get(occ) : undefined;
                if (!b?.type || (b.type[0] !== 'R' && b.type[0] !== 'I')) continue;
                const limit = DEFAULT_CONFIG.transport.tripLimit;
                color = b.commute < 0 || b.commute > limit ? NO_TRIP : heat(1 - b.commute / limit);
                break;
              }
              if (s.railDamage[i]) {
                color = BROKEN_RAIL;
                break;
              }
              // Close enough for widths: a faint way under its band (paintTrafficBands), which says the rest.
              if (bands) {
                color = this.night ? 'rgba(150,150,160,0.3)' : 'rgba(110,110,118,0.28)';
                break;
              }
              const speed = DEFAULT_CONFIG.transport.speed;
              const u = code === Net.Rail ? f.railTraffic[i]! / speed.rail.capacity
                : f.traffic[i]! / speed[NETWORK_KINDS[code]!].capacity;
              const t = Math.min(1, u / 2);
              // Free-flowing roads recede; jams stand out (every road a solid bar read as a green lattice).
              color = jamColor(t, 0.4 + 0.55 * Math.min(1, t * 1.6));
              break;
            }
            case 'volume': {
              // Volume on one network: white (little) to dark blue (the busiest tile on screen).
              const v = volumeAt(s, f, overlay.network, i);
              if (v < 0) continue;
              const t = volumeMax > 0 ? Math.sqrt(v / volumeMax) : 0;
              color = `rgb(${Math.round(240 - 215 * t)},${Math.round(244 - 190 * t)},${Math.round(250 - 110 * t)})`;
              break;
            }
            case 'subway': {
              // Underground view: track shaded by riders, stations outlined below.
              if (s.subway[i]) {
                const t = Math.min(1, f.subwayTraffic[i]! / DEFAULT_CONFIG.transport.speed.subway.capacity);
                color = `rgba(${Math.round(60 + 190 * t)},${Math.round(90 + 60 * (1 - t))},${Math.round(220 - 160 * t)},0.95)`;
              } else color = 'rgba(20,24,30,0.55)';
              break;
            }
          }
          const c = rgbaOf(color);
          const o = 4 * ((y - y0) * pw + x - x0);
          px[o] = c >>> 24;
          px[o + 1] = (c >>> 16) & 255;
          px[o + 2] = (c >>> 8) & 255;
          px[o + 3] = c & 255;
        }
      }
      if (pw > 0 && y1 > y0) lctx.putImageData(pixels, x0, y0);
      // The city washed out under the data, as in SC4: buildings' own colours
      // would otherwise mix with the view's (green homes under a red-to-green
      // scale read as neither). The zones view is the buildings' colours.
      if (overlay.kind !== 'zones') {
        ctx.fillStyle = this.night ? 'rgba(16,16,20,0.45)' : 'rgba(238,239,241,0.5)';
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      // (A field that varies smoothly over the land drawn as one — a soft wash, as SC4's data views are; tile by tile it
      // read as stairs. The rest — reach, zones, networks, homes — keep their tiles.)
      ctx.imageSmoothingEnabled = SMOOTH_VIEWS.has(overlay.kind);
      ctx.drawImage(this.layer, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      ctx.imageSmoothingEnabled = true;
      if (bands) this.paintTrafficBands(ctx, city, x0, y0, x1, y1, sc);
      // Streets stay as the map's reference over area data (views of the networks colour them already).
      if (!NETWORK_VIEWS.has(overlay.kind)) {
        ctx.fillStyle = this.night ? 'rgba(200,200,210,0.28)' : 'rgba(60,60,64,0.42)';
        ctx.beginPath(); // one fill for all of them (a call per tile was thousands a frame)
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (s.net[y * n + x]) ctx.rect(x, y, 1, 1);
        ctx.fill();
      }
    }

    // Names the mayor gave buildings, when zoomed in.
    if (sc >= 14) {
      ctx.font = `${(11 / sc).toFixed(3)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3 / sc;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.fillStyle = '#fff';
      const CIVIC_RISE_OF = (sid: number) => {
        const st = s.structures.get(sid);
        if (!st) return 0;
        const def = STRUCTURES[st.kind];
        const style = def.category === 'safety' ? (def.fire ? 'fire' : 'police') : def.category;
        return CIVIC_RISE[style as keyof typeof CIVIC_RISE] ?? 0;
      };
      for (const [key, name] of Object.entries(s.names)) {
        const id = Number(key);
        const r = id > 0 ? s.buildings.get(id) : s.structures.get(-id);
        if (!r || r.x >= x1 || r.y >= y1 || r.x + r.w <= x0 || r.y + r.h <= y0) continue;
        // Above the roof: buildings and facilities are drawn raised.
        const b = id > 0 ? s.buildings.get(id) : undefined;
        const lift = b?.type ? buildingRise(b.type, b.stage) : id < 0 ? CIVIC_RISE_OF(-id) : 0;
        ctx.strokeText(name, r.x + r.w / 2, r.y - lift - 0.15);
        ctx.fillText(name, r.x + r.w / 2, r.y - lift - 0.15);
      }
      ctx.textAlign = 'start';
    }

    // Subway-to-Elevated Transitions: a ramp where trains come up.
    if (sc >= 4) {
      for (const i of s.transitions) {
        const x = i % n;
        const y = (i - x) / n;
        if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
        ctx.fillStyle = ROUTE_COLOR.subway;
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y + 0.1);
        ctx.lineTo(x + 0.9, y + 0.5);
        ctx.lineTo(x + 0.5, y + 0.9);
        ctx.lineTo(x + 0.1, y + 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // The police view: last month's crimes where they happened (heinous ones larger), over the reach.
    if (overlay.kind === 'police' && sc >= 3) {
      for (const [i, kind] of s.safety.spots ?? []) {
        const x = i % n;
        const y = (i - x) / n;
        if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
        const big = HEINOUS.has(kind);
        ctx.fillStyle = big ? '#ff2d2d' : '#ffd23f';
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.arc(x + 0.5, y + 0.5, big ? 0.42 : 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // The 쾌적도 view: over the land's 쾌적도, the homes whose residents are unhappy with the mayor — its rating, where it
    // is low (amber below 0, red below −50, where riots gather), a mark at each home's middle.
    if (overlay.kind === 'desirability' && sc >= 3) {
      const f = city.fields;
      for (const b of s.buildings.values()) {
        if (b.type?.[0] !== 'R') continue;
        const x = b.x + (b.w >> 1);
        const y = b.y + (b.h >> 1);
        if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
        const r = f.mayor[y * n + x]!;
        if (f.mayorSet[y * n + x] !== 1 || r >= 0) continue; // (lived in: an empty home's rating riots nobody)
        ctx.fillStyle = r <= -50 ? RIOT_DOT : UNHAPPY_DOT;
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.arc(x + 0.5, y + 0.5, r <= -50 ? 0.42 : 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // What was just built or cleared: a flash over the area, dust where things came down,
    // and the cost rising from where the drag ended (a build used to change only a number).
    if (this.effects.length) {
      const now = performance.now();
      this.effects = this.effects.filter((fx) => now - fx.t0 < (fx.kind === 'ping' ? 1100 : 900));
      for (const fx of this.effects) {
        const k = (now - fx.t0) / (fx.kind === 'cost' ? 900 : fx.kind === 'dust' ? 450 : fx.kind === 'ping' ? 1100 : 280);
        if (k >= 1) continue;
        if (fx.kind === 'ping') {
          // What 찾아가기 found: a ring closing in on it, in the 추천 자리's colours (a pale flash went unseen on a
          // pale view, and at once). Asked for less motion, the ring stands still at its end and fades.
          const e = (lessMotion ??= matchMedia('(prefers-reduced-motion: reduce)')).matches ? 1 : 1 - (1 - Math.min(1, k / 0.7)) ** 3;
          const r = ((48 - 32 * e) * this.dpr) / sc;
          const a = k < 0.75 ? 1 : (1 - k) / 0.25;
          const [cx, cy] = [fx.x + fx.w / 2, fx.y + fx.h / 2];
          ctx.setLineDash([]);
          for (const [w, colour] of [[6, `rgba(255,255,255,${(0.9 * a).toFixed(3)})`], [3, `rgba(47,111,224,${a.toFixed(3)})`]] as const) {
            ctx.lineWidth = (w * this.dpr) / sc;
            ctx.strokeStyle = colour;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (fx.kind === 'flash') {
          ctx.fillStyle = `rgba(255,255,255,${(0.4 * (1 - k)).toFixed(3)})`;
          ctx.fillRect(fx.x, fx.y, fx.w, fx.h);
        } else if (fx.kind === 'dust') {
          ctx.fillStyle = `rgba(150,145,135,${(0.55 * (1 - k)).toFixed(3)})`;
          for (let y = fx.y; y < fx.y + fx.h; y++) for (let x = fx.x; x < fx.x + fx.w; x++) {
            for (let d = 0; d < 3; d++) {
              ctx.beginPath();
              ctx.arc(x + 0.25 + 0.25 * d, y + 0.3 + ((x * 7 + y * 3 + d * 5) % 5) * 0.1, 0.18 + 0.3 * k, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else if (fx.text) {
          const px = (13 * this.dpr) / sc; // CSS pixels: legible on a phone's dense screen too
          ctx.font = `700 ${px}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.lineWidth = (3 * this.dpr) / sc;
          ctx.strokeStyle = `rgba(0,0,0,${(0.55 * (1 - k)).toFixed(3)})`;
          ctx.fillStyle = `rgba(255,255,255,${(1 - k * k).toFixed(3)})`;
          const ty = fx.y - ((12 * this.dpr) / sc) * k;
          ctx.strokeText(fx.text, fx.x, ty);
          ctx.fillText(fx.text, fx.x, ty);
          ctx.textAlign = 'start';
        }
      }
    }

    // The keyboard's build cursor: a white-edged accent square, wider than the tile (a pointer's hover needs none).
    if (this.cursor) {
      const u = this.dpr / sc;
      const { x, y } = this.cursor;
      const m = Math.max(0.15, 4 * u);
      ctx.setLineDash([]);
      ctx.lineWidth = 5 * u;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeRect(x - m, y - m, 1 + 2 * m, 1 + 2 * m);
      ctx.lineWidth = 2.5 * u;
      ctx.strokeStyle = '#2f6fe0';
      ctx.strokeRect(x - m, y - m, 1 + 2 * m, 1 + 2 * m);
    }

    if (this.edgeHint) {
      // The whole edge, dashed in the accent, and a word on where the road should go. (In a region, the stretches a
      // city lies across, each with its word.)
      const u = this.dpr / sc;
      const spans = this.edgeSpans;
      ctx.setLineDash([8 * u, 6 * u]);
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = 'rgba(47,111,224,0.85)';
      if (spans) {
        ctx.beginPath();
        for (const [e, a, b] of spans) {
          const [x0, y0, x1, y1] = e === 0 ? [0.5, a, 0.5, b] : e === 1 ? [n - 0.5, a, n - 0.5, b] : e === 2 ? [a, 0.5, b, 0.5] : [a, n - 0.5, b, n - 0.5];
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        }
        ctx.stroke();
      } else ctx.strokeRect(0.5, 0.5, n - 1, n - 1);
      ctx.setLineDash([]);
      const px = 13 * u;
      ctx.font = `700 ${px}px system-ui, sans-serif`;
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.fillStyle = '#2f6fe0';
      // (By the side edges, halfway down: the tool bar and the menu cover the top and the foot.)
      // (A narrow map, a phone's: one line in the middle, the two would meet.)
      const wide = ctx.measureText('← 가장자리까지 이으면 이웃 도시와 연결').width * 2 + 24 * u < n;
      // (Not with the suggested road to the neighbours drawn — the path that reaches the edge, not a screen's own line:
      // its label says as much, and on a phone the one line in the middle lay over its start.)
      const toEdge = !!this.guidePath?.some(([x, y]) => x === 0 || y === 0 || x === n - 1 || y === n - 1);
      const say = '가장자리까지 이으면 이웃 도시와 연결';
      const spots: (readonly [number, number, CanvasTextAlign, string])[] = toEdge ? []
        : spans ? spans.map(([e, a, b]) => e === 0 ? [1 + 6 * u, (a + b) / 2, 'start', `← ${say}`] as const
          : e === 1 ? [n - 1 - 6 * u, (a + b) / 2, 'end', `${say} →`] as const
          : e === 2 ? [(a + b) / 2, 1 + 16 * u, 'center', `↑ ${say}`] as const : [(a + b) / 2, n - 1 - 8 * u, 'center', `↓ ${say}`] as const)
        : wide ? [[1 + 6 * u, n / 2, 'start', `← ${say}`], [n - 1 - 6 * u, n / 2, 'end', `${say} →`]] : [[n / 2, n / 2, 'center', say]];
      for (const [tx, ty, align, words] of spots) {
        ctx.textAlign = align;
        ctx.strokeText(words, tx, ty);
        ctx.fillText(words, tx, ty);
      }
      ctx.textAlign = 'start';
    }

    if (this.guidePath && this.guidePath.length > 1) {
      // The line to lay: dashed blue through the tiles' middles, over a pale casing so it reads on any ground.
      const u = this.dpr / sc;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.guidePath.forEach(([x, y], k) => (k ? ctx.lineTo(x + 0.5, y + 0.5) : ctx.moveTo(x + 0.5, y + 0.5)));
      ctx.setLineDash([]);
      ctx.lineWidth = 6 * u;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
      ctx.setLineDash([7 * u, 5 * u]);
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = '#2f6fe0';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter'; // (the facility outlines after it keep their square corners)
    }

    // A My Sim's pick in progress: the buildings it may take, outlined (nothing on the map said which would do).
    if (this.pickable.length) {
      const u = this.dpr / sc;
      ctx.setLineDash([]);
      ctx.lineWidth = 3.5 * u;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      for (const p of this.pickable) ctx.strokeRect(p.x + 0.1, p.y + 0.1, p.w - 0.2, p.h - 0.2);
      ctx.setLineDash([5 * u, 3 * u]);
      ctx.lineWidth = 2 * u;
      ctx.strokeStyle = '#2f6fe0';
      for (const p of this.pickable) ctx.strokeRect(p.x + 0.1, p.y + 0.1, p.w - 0.2, p.h - 0.2);
      ctx.setLineDash([]);
    }

    if (!this.marks.length) this.edgeMarks = [];
    if (this.marks.length) {
      const pad = 0.35;
      const u = this.dpr / sc; // one CSS pixel, in tiles (the same on a phone's dense screen)
      // (The targets and their labels last, over the outlines: a block's dashed edge ran through its own label.)
      for (const m of [...this.marks.filter((k) => k.tone !== 'spot'), ...this.marks.filter((k) => k.tone === 'spot')]) {
        if (m.tone === 'spot') {
          // A target: rings round the point, and its label above.
          const cx = m.x + m.w / 2;
          const cy = m.y + m.h / 2;
          const r = Math.max(2.2, 18 * u);
          ctx.setLineDash([]);
          if (m.hot) {
            // The button that builds here is under the pointer: the target lights up.
            ctx.fillStyle = 'rgba(47,111,224,0.45)';
            ctx.beginPath();
            ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.lineWidth = 3.5 * u;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          for (const k of [1, 0.45]) {
            ctx.beginPath();
            ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.lineWidth = 2 * u;
          ctx.strokeStyle = '#2f6fe0';
          for (const k of [1, 0.45]) {
            ctx.beginPath();
            ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (m.label) {
            const px = 12 * u;
            ctx.font = `700 ${px}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.lineWidth = 3 * u;
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.fillStyle = '#fff';
            // (Below the ring where a card over the map's top — the view's legend unfolded — would cover it above: the
            // ring stood just clear of the card with its name under it.)
            const half = (ctx.measureText(m.label).width / 2) * cam.scale;
            const [lx, ly] = [(cx - cam.x) * cam.scale, (cy - r - 5 * u - cam.y) * cam.scale];
            const below = this.covers.some((c) => lx + half > c.left && lx - half < c.right && ly > c.top && ly - 13 < c.bottom);
            const ty = below ? cy + r + 15 * u : cy - r - 5 * u;
            ctx.strokeText(m.label, cx, ty);
            ctx.fillText(m.label, cx, ty);
            ctx.textAlign = 'start';
          }
          continue;
        }
        if (m.tone === 'area') {
          // An area the guide would lay (a landfill, a zone block): dashed blue over a pale casing, as its path is.
          ctx.setLineDash([]);
          ctx.lineWidth = 5 * u;
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.strokeRect(m.x, m.y, m.w, m.h);
          ctx.setLineDash([7 * u, 5 * u]);
          ctx.lineWidth = 2.5 * u;
          ctx.strokeStyle = '#2f6fe0';
          ctx.strokeRect(m.x, m.y, m.w, m.h);
          continue;
        }
        ctx.strokeStyle = m.tone === 'bad' ? '#ff4d4f' : m.tone === 'warn' ? '#f5a524' : 'rgba(255,255,255,0.95)';
        ctx.lineWidth = (m.tone ? 2.5 : 1.5) * u;
        ctx.setLineDash(m.tone ? [] : [4 * u, 3 * u]);
        ctx.strokeRect(m.x - pad, m.y - pad, m.w + 2 * pad, m.h + 2 * pad);
      }
      ctx.setLineDash([]);
      // A target out of view: a marker at the edge pointing to it (a build button hovered lit nothing the eye could
      // find). Inside the part of the map nothing covers (below the bar row, above a phone's city sheet, beside it held
      // sideways) and above the hint bar; a target under one of the cards over the top corners — the view's legend,
      // the minimap — is out of view too, and an arrow that would stand under one stands below it. (A quarter of the
      // band across its top was kept for those cards: a target framed just below the legend got an arrow on itself,
      // and a press there went to it instead of building. Fixed insets crossed on a short map: every target got an
      // arrow, in plain sight or not.)
      const [cssW, cssH] = [W / this.dpr, H / this.dpr];
      const b = this.band ?? { left: 0, top: 0, right: cssW, bottom: cssH };
      const inBottom = Math.min(b.bottom - 12, cssH - 96);
      const [left, top, right, bottom] = [cam.x + (b.left + 36) * u, cam.y + (b.top + 36) * u, cam.x + (b.right - 36) * u, cam.y + inBottom * u];
      // (In sight in the strip kept for the hint bar it has none: it got an arrow drawn on itself.)
      const [vl, vt, vr, vb] = [cam.x + (b.left + 8) * u, cam.y + (b.top + 8) * u, cam.x + (b.right - 8) * u, cam.y + (b.bottom - 8) * u];
      const under = (x: number, y: number, pad: number) => this.covers.find((c) => x >= cam.x + (c.left - pad) * u && x <= cam.x + (c.right + pad) * u
        && y >= cam.y + (c.top - pad) * u && y <= cam.y + (c.bottom + pad) * u);
      this.edgeMarks = [];
      // (No room for one: none.)
      if (bottom - top >= 30 * u && right - left >= 30 * u) for (const m of this.marks) {
        if (m.tone !== 'spot') continue;
        const [cx, cy] = [m.x + m.w / 2, m.y + m.h / 2];
        if (cx >= vl && cx <= vr && cy >= vt && cy <= vb && !under(cx, cy, 0)) continue;
        let [px, py] = [Math.min(right, Math.max(left, cx)), Math.min(bottom, Math.max(top, cy))];
        // (Below each card it would stand under, in turn: a phone's chips have the view's legend just under them.)
        for (let k = 0, card = under(px, py, 16); card && k < 4; k++, card = under(px, py, 16)) py = Math.min(bottom, cam.y + (card.bottom + 24) * u);
        const len = Math.hypot(cx - px, cy - py) || 1;
        const [dx, dy] = [(cx - px) / len, (cy - py) / len];
        const r = (m.hot ? 13 : 11) * u;
        this.edgeMarks.push({ x: (px - cam.x) * cam.scale, y: (py - cam.y) * cam.scale, r: r / u, tx: cx, ty: cy, label: m.label ?? '' });
        ctx.beginPath();
        ctx.arc(px, py, r + 2 * u, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = m.hot ? '#1d5bd6' : '#2f6fe0';
        ctx.fill();
        // The arrow: a shaft and its head along the way to the target (a filled triangle in a blue disc read as ▶,
        // the clock's play button, over a paused map).
        const [tipX, tipY] = [px + dx * r * 0.55, py + dy * r * 0.55];
        const h = r * 0.42;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(px - dx * r * 0.55, py - dy * r * 0.55);
        ctx.lineTo(tipX, tipY);
        ctx.moveTo(tipX - dx * h - dy * h * 0.85, tipY - dy * h + dx * h * 0.85);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(tipX - dx * h + dy * h * 0.85, tipY - dy * h - dx * h * 0.85);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = r * 0.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
      }
    }

    if (selected) {
      // A selected facility shows how far it reaches.
      const occ = s.occupant[selected.y * n + selected.x];
      const st = occ && occ < 0 ? s.structures.get(-occ) : undefined;
      const r = st ? coverageRadius(st.kind, st) : 0;
      if (st && r) drawRing(ctx, { x: st.x + st.w / 2, y: st.y + st.h / 2, r }, sc);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / sc;
      ctx.strokeRect(selected.x, selected.y, selected.w, selected.h);
    }

    // Route Query: each trip a line through its tiles, coloured by mode, darker for more trips.
    if (this.routes?.length) {
      // A veil over the map and any data view, so the routes stand out from it.
      ctx.fillStyle = 'rgba(20, 22, 28, 0.38)';
      ctx.fillRect(0, 0, n, n);
      const max = Math.max(...this.routes.map((t) => t.amount));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const t of [...this.routes].reverse()) {
        const alpha = 0.35 + 0.6 * Math.sqrt(t.amount / max);
        ctx.globalAlpha = alpha;
        ctx.lineWidth = Math.max(2 / sc, 0.12 + 0.2 * Math.sqrt(t.amount / max));
        for (let k = 1; k < t.tiles.length; k++) {
          const a = t.tiles[k - 1]!;
          const b = t.tiles[k]!;
          ctx.strokeStyle = t.means === 'freight' ? ROUTE_COLOR.freight : MODE_COLOR[t.modes[k]!] ?? '#fff';
          ctx.beginPath();
          ctx.moveTo((a % n) + 0.5, Math.floor(a / n) + 0.5);
          ctx.lineTo((b % n) + 0.5, Math.floor(b / n) + 0.5);
          ctx.stroke();
        }
        // A dot where the trip ends.
        const end = t.tiles.at(-1)!;
        ctx.fillStyle = t.means === 'freight' ? ROUTE_COLOR.freight : '#ffffff';
        ctx.beginPath();
        ctx.arc((end % n) + 0.5, Math.floor(end / n) + 0.5, 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Moving disasters: an icon on the spot, a line to where they're being pulled.
    for (const d of this.live) {
      if (d.steer) {
        ctx.strokeStyle = 'rgba(255,90,60,0.8)';
        ctx.lineWidth = 2 / sc;
        ctx.setLineDash([4 / sc, 4 / sc]);
        ctx.beginPath();
        ctx.moveTo(d.x + 0.5, d.y + 0.5);
        ctx.lineTo(d.steer[0] + 0.5, d.steer[1] + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // A dark funnel under the icon, so it shows even without emoji fonts.
      ctx.fillStyle = 'rgba(40,40,48,0.85)';
      ctx.beginPath();
      ctx.arc(d.x + 0.5, d.y + 0.5, 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 / sc;
      ctx.stroke();
      ctx.font = '2.4px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.icon, d.x + 0.5, d.y + 0.5);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }

    // U-Drive-It: the target (a pulsing ring) and the vehicle.
    if (this.drive) {
      const d = this.drive;
      const pulse = 0.55 + 0.25 * Math.sin(performance.now() / 180);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 3 / sc;
      ctx.beginPath();
      ctx.arc(d.tx + 0.5, d.ty + 0.5, pulse + 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,210,63,0.35)';
      ctx.fillRect(d.tx, d.ty, 1, 1);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(d.x + 0.5, d.y + 0.5, 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.x + 0.5, d.y + 0.5, 0.48, 0, Math.PI * 2);
      ctx.fill();
      // An arrow beside the vehicle pointing at the target, and a faint dashed line the rest of the way (off screen
      // it shows which way the target lies).
      const ang = Math.atan2(d.ty - d.y, d.tx - d.x);
      if (d.tx !== d.x || d.ty !== d.y) {
        if (Math.hypot(d.tx - d.x, d.ty - d.y) > 3.5) {
          ctx.save();
          const u = this.dpr / sc;
          ctx.setLineDash([8 * u, 7 * u]);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(d.x + 0.5 + Math.cos(ang) * 3.4, d.y + 0.5 + Math.sin(ang) * 3.4);
          ctx.lineTo(d.tx + 0.5 - Math.cos(ang) * 1, d.ty + 0.5 - Math.sin(ang) * 1);
          // (On a dark edge, so it reads over a road's own yellow and the cars on it.)
          ctx.lineWidth = 5 * u;
          ctx.strokeStyle = 'rgba(20,16,4,0.55)';
          ctx.stroke();
          ctx.lineWidth = 3 * u;
          ctx.strokeStyle = 'rgba(255,210,63,0.95)';
          ctx.stroke();
          ctx.restore();
        }
        const ax = d.x + 0.5 + Math.cos(ang) * 2.2;
        const ay = d.y + 0.5 + Math.sin(ang) * 2.2;
        ctx.fillStyle = '#ffd23f';
        ctx.strokeStyle = '#2b2205';
        ctx.lineWidth = 1.5 / sc;
        ctx.beginPath();
        ctx.moveTo(ax + Math.cos(ang) * 1.1, ay + Math.sin(ang) * 1.1);
        ctx.lineTo(ax + Math.cos(ang + 2.5) * 0.8, ay + Math.sin(ang + 2.5) * 0.8);
        ctx.lineTo(ax + Math.cos(ang - 2.5) * 0.8, ay + Math.sin(ang - 2.5) * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    if (preview) {
      // Accent blue (red where it can't go) with a light rim, so it reads on pale ground and on water.
      ctx.fillStyle = preview.ok ? preview.color ?? 'rgba(52,120,246,0.5)' : 'rgba(255,60,60,0.5)';
      ctx.beginPath();
      for (const [x, y] of preview.tiles) ctx.rect(x, y, 1, 1);
      ctx.fill();
      if (sc >= 6) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1 / sc;
        ctx.stroke();
      }
      if (preview.box) {
        const r = preview.box;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5 / sc;
        ctx.setLineDash([4 / sc, 3 / sc]);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([]);
      }
      if (preview.ring) drawRing(ctx, preview.ring, sc);
      if (preview.hover) {
        const r = preview.hover;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(0.05, 2 / sc);
        ctx.strokeRect(r.x + 0.03, r.y + 0.03, r.w - 0.06, r.h - 0.06);
      }
      if (preview.remove?.length) {
        ctx.fillStyle = 'rgba(255,70,70,0.3)';
        ctx.strokeStyle = '#ff4d4d';
        ctx.lineWidth = Math.max(0.06, 2 / sc);
        for (const r of preview.remove) {
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.strokeRect(r.x + 0.04, r.y + 0.04, r.w - 0.08, r.h - 0.08);
        }
      }
      if (preview.streets?.length) {
        ctx.fillStyle = 'rgba(70,72,78,0.85)';
        for (const [x, y] of preview.streets) ctx.fillRect(x + 0.1, y + 0.1, 0.8, 0.8);
      }
    }

    // Map border.
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1 / sc;
    ctx.strokeRect(0, 0, n, n);
  }
}
