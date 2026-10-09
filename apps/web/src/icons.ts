// Line icons for the interface (lucide, ISC licence), as inline SVG strings so
// templates can use them. A few road icons lucide doesn't have are drawn here
// in the same 24-unit, round-stroke style. Size and stroke come from CSS (.i).

import {
  ArrowDownToLine, Scan, ArrowLeft, ArrowUpDown, Target, ArrowUpFromLine, Award, Building2, Bus, Cable, CableCar, ChartLine, Check, ChevronDown, ChevronRight,
  CircleHelp, Clover, CornerUpRight, Droplet, Ellipsis, Eraser, Factory, Flame, Car, Plane, Ship, Briefcase, TrendingDown, Save, FolderOpen, Download, Upload, Camera, FileSpreadsheet, Pencil, SunMoon, Dices, FilePlus, FlameKindling, Hammer, Activity, Bot, Bug, CloudLightning, MountainSnow, Orbit, Sparkles, Footprints, Gauge, Globe, GraduationCap,
  HandCoins, LayoutDashboard, Handshake, HeartPulse, Info, Landmark, Layers, LayoutGrid, Lock, Map as MapIcon, Maximize2, Megaphone, Mic, Minimize2,
  Minus, Moon, MoonStar, Mountain, MoveRight, Plus, Recycle, Route, Scissors, Search, Shield, Shovel, Siren, SquareDashed, Sun, Ticket,
  Tornado, Tractor, TrainFront, TrainFrontTunnel, TrainTrack, Trash2, TreePine, Trees, TriangleAlert, Trophy, Undo2, Redo2, Users,
  Wallet, Waves, Wind, X, Zap, type IconNode,
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

const ICONS = {
  // Dock, status bar and panels
  search: Search, route: Route, mic: Mic, eraser: Eraser, dezone: SquareDashed,
  road: ROAD, street: STREET, avenue: AVENUE, highway: HIGHWAY, elevated: ELEVATED, oneway: MoveRight, onramp: CornerUpRight, clover: Clover,
  rail: TrainTrack, subway: TrainFrontTunnel, train: TrainFront, monorail: CableCar, transition: ArrowUpDown, scissors: Scissors, ticket: Ticket, bus: Bus,
  pipe: PIPE, zones: LayoutGrid, zap: Zap, cable: Cable, factory: Factory, droplet: Droplet, trash: Trash2, recycle: Recycle,
  shield: Shield, flame: Flame, siren: Siren, health: HeartPulse, school: GraduationCap, trees: Trees, tree: TreePine,
  civic: Landmark, award: Award, trophy: Trophy, coins: HandCoins, handshake: Handshake, landmark: Building2,
  terrain: Mountain, tornado: Tornado, tractor: Tractor, waves: Waves, shovel: Shovel, raise: ArrowUpFromLine, lower: ArrowDownToLine,
  wallet: Wallet, chart: ChartLine, users: Users, globe: Globe, map: MapIcon, info: Info, gauge: Gauge, layers: Layers,
  undo: Undo2, redo: Redo2, help: CircleHelp, maximize: Maximize2, minimize: Minimize2, moon: Moon, moonStar: MoonStar, sun: Sun, more: Ellipsis, car: Car, plane: Plane, ship: Ship, briefcase: Briefcase, trendDown: TrendingDown, save: Save, folder: FolderOpen, download: Download, upload: Upload, camera: Camera, sheet: FileSpreadsheet, pencil: Pencil, theme: SunMoon, dice: Dices, filePlus: FilePlus, pause: PAUSE, play: PLAY, play2: PLAY2, play3: PLAY3, flameKindling: FlameKindling, lightning: CloudLightning, sparkles: Sparkles, quake: Activity, volcano: MountainSnow, bot: Bot, bug: Bug, ufo: Orbit, hammer: Hammer, apps: LayoutDashboard,
  plus: Plus, minus: Minus, fit: Scan, close: X, check: Check, lock: Lock, chevronDown: ChevronDown, chevronRight: ChevronRight,
  back: ArrowLeft, target: Target,
  wind: Wind, alert: TriangleAlert, megaphone: Megaphone, walk: Footprints,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

const esc = (v: string | number) => String(v).replace(/"/g, '&quot;');

/** An icon as inline SVG (decorative: labelled by the text next to it). */
export function icon(name: IconName, cls = ''): string {
  const node: IconNode = ICONS[name];
  const body = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${esc(v!)}"`).join(' ')}/>`).join('');
  return `<svg class="i${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Fills the page's static [data-icon] placeholders with their icons. */
export function paintIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    el.outerHTML = icon(el.dataset.icon as IconName);
  });
}
