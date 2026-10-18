// Line icons for the interface (lucide, ISC licence), as inline SVG strings so
// templates can use them. A few icons lucide doesn't have (roads, a pipe, the
// player's buttons, the city's stages) are drawn here in the same 24-unit,
// round-stroke style. Size and stroke come from CSS (.i).

import {
  ArrowDownToLine, Scan, ArrowLeft, ArrowUpDown, Target, ArrowUpFromLine, Award, Building2, Bus, Cable, CableCar, ChartLine, Check, ChevronDown, ChevronRight,
  CircleHelp, Clover, CornerUpRight, Droplet, Ellipsis, Eraser, Factory, Flame, Car, Plane, Ship, Briefcase, TrendingDown, Save, FolderOpen, Download, Upload, Camera, FileSpreadsheet, Pencil, SunMoon, Dices, FilePlus, FlameKindling, Hammer, Activity, Bot, Bug, CloudLightning, MountainSnow, Orbit, Sparkles, Footprints, Gauge, Globe, GraduationCap,
  HandCoins, LayoutDashboard, Handshake, HeartPulse, Info, Landmark, Layers, LayoutGrid, Lock, Map as MapIcon, Maximize2, Megaphone, Mic, Minimize2,
  Minus, Moon, MoonStar, Mountain, MoveRight, PanelLeftClose, PanelLeftOpen, Plus, Recycle, Route, Scissors, Search, Shield, Shovel, Siren, Sun, Ticket,
  Tornado, Tractor, TrainFront, TrainFrontTunnel, TrainTrack, Trash2, TreePine, Trees, TriangleAlert, Trophy, Users,
  Wallet, Waves, Wind, X, Zap, Gem, ThumbsUp, type IconNode,
} from 'lucide';

const line = (d: string): IconNode[number] => ['path', { d }];

/** Roads drawn top to bottom: carriageway edges and the centre dashes. */
const ROAD: IconNode = [line('M7 3v18'), line('M17 3v18'), line('M12 4v3'), line('M12 10.5v3'), line('M12 17v3')];
const STREET: IconNode = [line('M9 3v18'), line('M15 3v18')];
const AVENUE: IconNode = [line('M4 3v18'), line('M10 3v18'), line('M14 3v18'), line('M20 3v18'), line('M7 5v2'), line('M7 11v2'), line('M7 17v2'), line('M17 5v2'), line('M17 11v2'), line('M17 17v2')];
const HIGHWAY: IconNode = [line('M3 3v18'), line('M11 3v18'), line('M13 3v18'), line('M21 3v18'), line('M7 4v3'), line('M7 10.5v3'), line('M7 17v3'), line('M17 4v3'), line('M17 10.5v3'), line('M17 17v3')];
/** A water main with an elbow joint. */
const PIPE: IconNode = [line('M3 8h11a5 5 0 0 1 5 5v8'), line('M3 14h9a1 1 0 0 1 1 1v6'), line('M7 6.5v9'), line('M17.5 17h3')];
/** Player buttons, drawn solid. */
const solid = (d: string): IconNode[number] => ['path', { d, fill: 'currentColor' }];
const PAUSE: IconNode = [solid('M7 5.5h2.5v13H7z'), solid('M14.5 5.5H17v13h-2.5z')];
const PLAY: IconNode = [solid('M8.5 6v12l9-6z')];
const PLAY2: IconNode = [solid('M3.5 7v10l7.5-5z'), solid('M12.5 7v10l7.5-5z')];
const PLAY3: IconNode = [solid('M1.5 8.5v7l5.5-3.5z'), solid('M9.25 8.5v7l5.5-3.5z'), solid('M17 8.5v7l5.5-3.5z')];
const ELEVATED: IconNode = [line('M2 8h20'), line('M2 12h20'), line('M6 12v9'), line('M18 12v9'), line('M12 12v9')];
/** The city's stages (panels.ts), 마을 to 메트로폴리스: its skyline on one ground line, growing with them — a house by
 *  a tree, two houses, a steeple between houses, a block by it, then mid-rises, towers, and a spire among towers (its
 *  tallest building never lower than the stage before's). */
const GROUND = line('M2 21h20');
const STAGE1: IconNode = [GROUND, line('M2.5 21v-7l4.5-4 4.5 4v7'), line('M7 16.5h.01'),
  line('M15.5 18a2.5 2.5 0 0 1-.9-4.8 2.6 2.6 0 0 1 5-1 2.5 2.5 0 0 1 1.9 4.3A2.5 2.5 0 0 1 19.5 18z'), line('M17.5 18v3')];
const STAGE2: IconNode = [GROUND, line('M3.5 21v-8l5-4.5 5 4.5v8'), line('M13.5 16l3.5-3 3.5 3v5'), line('M8.5 16h.01'), line('M17 18h.01')];
const STAGE3: IconNode = [GROUND, line('M9.5 21V11l2.5-6 2.5 6v10'), line('M2.5 21v-5l3.5-3 3.5 3'), line('M14.5 16l3.5-3 3.5 3v5'), line('M12 14h.01')];
const STAGE4: IconNode = [GROUND, line('M2.5 21V12a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v9'), line('M5.5 14h3'), line('M5.5 17.5h3'),
  line('M11.5 21V11l2.5-6 2.5 6v10'), line('M16.5 16l2.5-2.5 2.5 2.5v5')];
const STAGE5: IconNode = [GROUND, line('M2.5 21v-7a1 1 0 0 1 1-1H8'), line('M8 21V7a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v14'), line('M10.5 9.5h3'),
  line('M10.5 13h3'), line('M10.5 16.5h3'), line('M16 16l2.75-2.5 2.75 2.5v5')];
const STAGE6: IconNode = [GROUND, line('M3 21V6a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v15'), line('M5.5 8.5h2'), line('M5.5 12h2'), line('M5.5 15.5h2'),
  line('M10 21v-6h4'), line('M14 21V11a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v10'), line('M16.5 13.5h2'), line('M16.5 17h2')];
const STAGE7: IconNode = [GROUND, line('M2.5 21v-9a1 1 0 0 1 1-1H8'), line('M8 21V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v17'), line('M10.5 6.5h3'),
  line('M10.5 10h3'), line('M10.5 13.5h3'), line('M10.5 17h3'), line('M16 13h4.5a1 1 0 0 1 1 1v7')];
const STAGE8: IconNode = [GROUND, line('M2.5 21V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V21'), line('M5.5 6v.01'), line('M5.5 9.5v.01'), line('M5.5 13v.01'), line('M5.5 16.5v.01'),
  line('M8.5 21v-8h3'), line('M11.5 21V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v13'), line('M14.5 10.5v.01'), line('M14.5 14v.01'), line('M17.5 21v-6h3a1 1 0 0 1 1 1v5')];
const STAGE9: IconNode = [GROUND, line('M2.5 21V9a1 1 0 0 1 1-1H7'), line('M7 21V7l2.5-2.5V2'), line('M9.5 4.5 12 7v14'), line('M12 21V9.5h3'),
  line('M15 21V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v15'), line('M9.5 10v.01'), line('M9.5 13.5v.01'), line('M9.5 17v.01'), line('M18 8.5v.01'), line('M18 12v.01'), line('M18 15.5v.01')];
const STAGE10: IconNode = [GROUND, line('M2 21v-7a1 1 0 0 1 1-1h2'), line('M5 21V7a1 1 0 0 1 1-1h3.5'), line('M9.5 21V5.5L12 3V1.5'), line('M12 3l2.5 2.5V21'),
  line('M14.5 8.5H18a1 1 0 0 1 1 1V21'), line('M19 15h2a1 1 0 0 1 1 1v5'), line('M7.5 9v.01'), line('M7.5 12.5v.01'), line('M7.5 16v.01'),
  line('M12 8v.01'), line('M12 11.5v.01'), line('M12 15v.01'), line('M16.75 11.5v.01'), line('M16.75 15v.01')];

const ICONS = {
  // Dock, top bar and panels
  search: Search, route: Route, mic: Mic, eraser: Eraser,
  road: ROAD, street: STREET, avenue: AVENUE, highway: HIGHWAY, elevated: ELEVATED, oneway: MoveRight, onramp: CornerUpRight, clover: Clover,
  rail: TrainTrack, subway: TrainFrontTunnel, train: TrainFront, monorail: CableCar, transition: ArrowUpDown, scissors: Scissors, ticket: Ticket, bus: Bus,
  pipe: PIPE, zones: LayoutGrid, zap: Zap, cable: Cable, factory: Factory, droplet: Droplet, trash: Trash2, recycle: Recycle,
  shield: Shield, flame: Flame, siren: Siren, health: HeartPulse, school: GraduationCap, trees: Trees, tree: TreePine,
  civic: Landmark, award: Award, trophy: Trophy, gem: Gem, approval: ThumbsUp, coins: HandCoins, handshake: Handshake, landmark: Building2,
  terrain: Mountain, tornado: Tornado, tractor: Tractor, waves: Waves, shovel: Shovel, raise: ArrowUpFromLine, lower: ArrowDownToLine,
  wallet: Wallet, chart: ChartLine, users: Users, globe: Globe, map: MapIcon, info: Info, gauge: Gauge, layers: Layers,
  help: CircleHelp, maximize: Maximize2, minimize: Minimize2, panelClose: PanelLeftClose, panelOpen: PanelLeftOpen, moon: Moon, moonStar: MoonStar, sun: Sun, more: Ellipsis, car: Car, plane: Plane, ship: Ship, briefcase: Briefcase, trendDown: TrendingDown, save: Save, folder: FolderOpen, download: Download, upload: Upload, camera: Camera, sheet: FileSpreadsheet, pencil: Pencil, theme: SunMoon, dice: Dices, filePlus: FilePlus, pause: PAUSE, play: PLAY, play2: PLAY2, play3: PLAY3, flameKindling: FlameKindling, lightning: CloudLightning, sparkles: Sparkles, quake: Activity, volcano: MountainSnow, bot: Bot, bug: Bug, ufo: Orbit, hammer: Hammer, apps: LayoutDashboard,
  plus: Plus, minus: Minus, fit: Scan, close: X, check: Check, lock: Lock, chevronDown: ChevronDown, chevronRight: ChevronRight,
  back: ArrowLeft, target: Target,
  stage1: STAGE1, stage2: STAGE2, stage3: STAGE3, stage4: STAGE4, stage5: STAGE5, stage6: STAGE6, stage7: STAGE7, stage8: STAGE8, stage9: STAGE9, stage10: STAGE10,
  wind: Wind, alert: TriangleAlert, megaphone: Megaphone, walk: Footprints,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

/** The icon of the city's stage `step` (counted from 1, panels.ts stageOf): the city as far as it has grown. */
export const stageIcon = (step: number): IconName => `stage${Math.max(1, Math.min(10, Math.round(step)))}` as IconName;

const esc = (v: string | number) => String(v).replace(/"/g, '&quot;');

/** An icon as inline SVG (decorative: labelled by the text next to it). */
export function icon(name: IconName, cls = ''): string {
  const node: IconNode = ICONS[name];
  const body = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${esc(v!)}"`).join(' ')}/>`).join('');
  return `<svg class="i${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** An icon's paths for a canvas (the map's signs, drawn as the cards draw them): its `path` elements, in its 24 units. */
const pathCache = new Map<IconName, Path2D[]>();
export function iconPaths(name: IconName): Path2D[] {
  let out = pathCache.get(name);
  if (!out) {
    const node: IconNode = ICONS[name];
    out = node.filter(([tag]) => tag === 'path').map(([, attrs]) => new Path2D(String((attrs as { d?: string }).d ?? '')));
    pathCache.set(name, out);
  }
  return out;
}

/** Fills the page's static [data-icon] placeholders with their icons. */
export function paintIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    el.outerHTML = icon(el.dataset.icon as IconName);
  });
}
