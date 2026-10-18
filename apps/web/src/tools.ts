// The tool palette: tool definitions, the dock's tool categories, the tool tray
// (facility pickers and extras included) and keyboard shortcuts.

import { DEFAULT_CONFIG, DEV_TYPES, DISASTER_KINDS, type DisasterKind, type NetworkKind, type StructureKind, STRUCTURES, ZONING_COST_HIGH_COMMERCIAL, type ZoneKind } from '@web-city/engine';
import { icon, type IconName } from './icons';
import { hoverUnderMouse, setPreview, updatePreview } from './input';
import { baseView, goalTools, markToolSite, nextStep, openCity, openGoal, suggestedKinds } from './manage';
import { firstStepTool } from './onboarding';
import { DISASTER_NAME, plainCodes, STRUCTURE_NAME } from './names';
import { holdForBuilding, isHeld, showHelp, showOverlay, viewProblem } from './controls';
import { structureMark } from './render';
import { city, cityLineage, redraw, renderer, setDrag } from './state';
import { closeInfo, closePane, closeSheet, showTab } from './tabs';
import { cancelMySimAction } from './mysims';
import { $, endFlash, flash, fmt, touchFirst } from './util';
import { SUGGEST_NOTE } from './tips';
import { GOAL_ORDER, GOALS, type GoalId } from './goals';
import { capped, cityEdges, goalStatus, readStats, roadLinked } from './readings';

export type Category = 'power' | 'water' | 'garbage' | 'safety' | 'health' | 'education' | 'park' | 'transport' | 'reward' | 'deal' | 'landmark';

export type Tool =
  | { id: string; label: string; kind: 'query' | 'route' | 'bulldoze' | 'powerline' | 'pipe' | 'unpipe' | 'subway' | 'unsubway' | 'toll' | 'cloverleaf' | 'transition' | 'mic' | 'level' | 'throw' | 'trees' }
  | { id: string; label: string; kind: 'disaster'; disaster: DisasterKind }
  | { id: string; label: string; kind: 'dispatch'; unit: 'fire' | 'police' }
  | { id: string; label: string; kind: 'terraform'; to: 'water' | 'land' | 'raise' | 'lower' }
  | { id: string; label: string; kind: 'elevated'; track: 'elrail' | 'monorail' | 'highway' }
  | { id: string; label: string; kind: 'network'; network: NetworkKind }
  | { id: string; label: string; kind: 'zone'; zone: ZoneKind; color: string }
  /** A facility; `only` narrows the engine's category to the kinds that police or fight fires. */
  | { id: string; label: string; kind: 'structure'; category: Category; only?: 'police' | 'fire' };

/** The dock's tool categories: each opens a tray with its groups' tools. */
export const CATEGORIES = [
  { id: 'inspect', label: '살펴보기', icon: 'search' },
  { id: 'transport', label: '교통', icon: 'road', short: '교통' },
  { id: 'zones', label: '개발 구역', icon: 'zones', short: '개발 구역' },
  { id: 'utilities', label: '에너지', icon: 'zap', short: '에너지' },
  { id: 'services', label: '시민 서비스', icon: 'civic', short: '서비스' },
  { id: 'special', label: '보상·거래', icon: 'award', short: '보상' },
  { id: 'terrain', label: '지형·재해', icon: 'terrain', short: '지형' },
  // (Last in the bar: taking down, after all that builds.)
  { id: 'bulldoze', label: '철거', icon: 'eraser' },
] as const satisfies readonly { id: string; label: string; icon: IconName; short?: string }[];

export type CategoryId = (typeof CATEGORIES)[number]['id'];

/** The categories that build (a window too low for them all gathers them behind one 짓기 button). */
const BUILD_CATS: CategoryId[] = ['transport', 'zones', 'utilities', 'services', 'special', 'terrain'];

export const TOOL_GROUPS: { title: string; cat: CategoryId; tools: Tool[] }[] = [
  {
    title: '살펴보기',
    cat: 'inspect',
    tools: [
      // (Looking is what the map does with nothing in hand: no tool to pick; routes and a passer-by's word are on the info card.)
      { id: 'query', label: '조회', kind: 'query' },
    ],
  },
  {
    title: '철거',
    cat: 'bulldoze',
    tools: [
      // (One tool: begun on an empty zone, its drag takes the zones away — input.ts.)
      { id: 'bulldoze', label: '철거', kind: 'bulldoze' },
    ],
  },
  {
    title: '도로',
    cat: 'transport',
    tools: [
      { id: 'road', label: '도로', kind: 'network', network: 'road' },
      { id: 'street', label: '골목', kind: 'network', network: 'street' },
      { id: 'avenue', label: '대로', kind: 'network', network: 'avenue' },
      { id: 'oneway', label: '일방통행', kind: 'network', network: 'oneway' },
      { id: 'highway', label: '고속도로', kind: 'network', network: 'highway' },
      { id: 'elhighway', label: '고가 고속도로', kind: 'elevated', track: 'highway' },
      { id: 'onramp', label: '진입로', kind: 'network', network: 'onramp' },
      { id: 'cloverleaf', label: '클로버형 교차로', kind: 'cloverleaf' },
      { id: 'toll', label: '톨게이트', kind: 'toll' },
    ],
  },
  {
    title: '선로',
    cat: 'transport',
    tools: [
      { id: 'rail', label: '철도', kind: 'network', network: 'rail' },
      { id: 'elrail', label: '고가 철도', kind: 'elevated', track: 'elrail' },
      { id: 'monorail', label: '모노레일', kind: 'elevated', track: 'monorail' },
      { id: 'subway', label: '지하철', kind: 'subway' },
      { id: 'transition', label: '지하철↔고가 전환', kind: 'transition' },
      { id: 'unsubway', label: '지하철 철거', kind: 'unsubway' },
    ],
  },
  { title: '정류장·역', cat: 'transport', tools: [{ id: 'transport', label: '정류장·역', kind: 'structure', category: 'transport' }] },
  {
    title: '주거',
    cat: 'zones',
    tools: [
      { id: 'R-low', label: '저밀도', kind: 'zone', zone: 'R-low', color: '#7cc76a' },
      { id: 'R-medium', label: '중밀도', kind: 'zone', zone: 'R-medium', color: '#3fa34d' },
      { id: 'R-high', label: '고밀도', kind: 'zone', zone: 'R-high', color: '#1f7a3a' },
    ],
  },
  {
    title: '상업',
    cat: 'zones',
    tools: [
      { id: 'C-low', label: '저밀도', kind: 'zone', zone: 'C-low', color: '#6bb5e8' },
      { id: 'C-medium', label: '중밀도', kind: 'zone', zone: 'C-medium', color: '#3b86d1' },
      { id: 'C-high', label: '고밀도', kind: 'zone', zone: 'C-high', color: '#2457a8' },
    ],
  },
  {
    title: '산업',
    cat: 'zones',
    tools: [
      { id: 'A', label: '농업', kind: 'zone', zone: 'A', color: '#c9b458' },
      { id: 'I-medium', label: '중밀도', kind: 'zone', zone: 'I-medium', color: '#d9822b' },
      { id: 'I-high', label: '고밀도', kind: 'zone', zone: 'I-high', color: '#b5651d' },
    ],
  },
  {
    title: '전력',
    cat: 'utilities',
    tools: [
      { id: 'powerline', label: '송전선', kind: 'powerline' },
      { id: 'power', label: '발전소', kind: 'structure', category: 'power' },
    ],
  },
  {
    title: '수도',
    cat: 'utilities',
    tools: [
      { id: 'pipe', label: '수도관', kind: 'pipe' },
      { id: 'unpipe', label: '수도관 철거', kind: 'unpipe' },
      { id: 'water', label: '수도 시설', kind: 'structure', category: 'water' },
    ],
  },
  {
    title: '쓰레기',
    cat: 'utilities',
    tools: [
      { id: 'landfill', label: '매립지', kind: 'zone', zone: 'landfill', color: '#8a7650' },
      { id: 'garbage', label: '처리 시설', kind: 'structure', category: 'garbage' },
    ],
  },
  {
    title: '경찰',
    cat: 'services',
    tools: [
      { id: 'police', label: '경찰서', kind: 'structure', category: 'safety', only: 'police' },
      { id: 'send-police', label: '경찰 출동', kind: 'dispatch', unit: 'police' },
    ],
  },
  {
    title: '소방',
    cat: 'services',
    tools: [
      { id: 'fire', label: '소방서', kind: 'structure', category: 'safety', only: 'fire' },
      { id: 'send-fire', label: '소방 출동', kind: 'dispatch', unit: 'fire' },
    ],
  },
  { title: '보건', cat: 'services', tools: [{ id: 'health', label: '병원', kind: 'structure', category: 'health' }] },
  { title: '교육', cat: 'services', tools: [{ id: 'education', label: '학교', kind: 'structure', category: 'education' }] },
  {
    title: '공원',
    cat: 'services',
    tools: [
      { id: 'park', label: '공원', kind: 'structure', category: 'park' },
      { id: 'trees', label: '나무 심기', kind: 'trees' },
    ],
  },
  {
    title: '보상',
    cat: 'special',
    tools: [
      { id: 'reward', label: '보상 건물', kind: 'structure', category: 'reward' },
      { id: 'throw', label: '돈 뿌리기', kind: 'throw' },
    ],
  },
  { title: '사업 거래', cat: 'special', tools: [{ id: 'deal', label: '거래 시설', kind: 'structure', category: 'deal' }] },
  { title: '랜드마크', cat: 'special', tools: [{ id: 'landmark', label: '랜드마크', kind: 'structure', category: 'landmark' }] },
  // Terrain first: opening the category picks a harmless tool, not a disaster.
  {
    title: '지형',
    cat: 'terrain',
    tools: [
      { id: 'level', label: '화산 지형 정리', kind: 'level' },
      { id: 'dig', label: '물 파기', kind: 'terraform', to: 'water' },
      { id: 'fill', label: '메우기', kind: 'terraform', to: 'land' },
      { id: 'raise', label: '높이기', kind: 'terraform', to: 'raise' },
      { id: 'lower', label: '낮추기', kind: 'terraform', to: 'lower' },
    ],
  },
  {
    title: '재해',
    cat: 'terrain',
    tools: DISASTER_KINDS.map((k) => ({ id: `disaster-${k}`, label: DISASTER_NAME[k], kind: 'disaster' as const, disaster: k })),
  },
];

/** Tools for the finer work, folded under 더 보기 in their group (the everyday ones lead). */
const MORE = new Set(['oneway', 'elhighway', 'onramp', 'cloverleaf', 'toll', 'elrail', 'monorail', 'transition', 'unsubway', 'unpipe', 'level']);
/** A facility tool's everyday kinds; its others fold under 더 보기 (airports and ferries are not where a town starts). */
const LEAD_KINDS: Record<string, StructureKind[]> = {
  transport: ['busStop', 'subwayStation', 'trainStation', 'freightStation'],
  // (Twenty-two kinds of park: a green, a plaza and a playground in three sizes say what parks do.)
  park: ['smallParkGreen', 'mediumParkGreen', 'largeParkGreen', 'smallPlaza', 'playground', 'communityGarden'],
  // (Fifty landmarks: the best known lead, the rest a click away.)
  landmark: ['bigBen', 'statueOfLiberty', 'empireStateBuilding', 'tajMahal', 'greatPyramid', 'tokyoTower'],
};
/** Tools that act on the city as it runs (send a unit, throw money): tiles after their group's facilities. */
const ACTIONS = new Set(['dispatch', 'throw']);

export const STATION_HINT = {
  bus: '도로 옆에 두고 집과 일터 양쪽에 필요',
  subway: '지하철·고가 철도 선로 위나 옆, 도로 옆에',
  monorail: '모노레일 선로 옆, 도로 옆에',
  ferry: '물가에 · 걸어서 타는 배 (같은 종류 터미널 2곳 이상)',
  carFerry: '물가에 · 차와 사람을 함께 실어 나름',
  rail: '철도와 도로에 모두 닿게',
  freight: '철도와 도로에 모두 닿게 · 화물을 철도로 연결',
} as const;

export const kindsOf = (c: Category) => (Object.keys(STRUCTURES) as StructureKind[]).filter((k) => STRUCTURES[k].category === c);

type StructureTool = Extract<Tool, { kind: 'structure' }>;

/** The kinds a facility tool offers. */
const kindsMemo = new Map<string, StructureKind[]>();
export const kindsFor = (t: StructureTool): StructureKind[] => {
  let v = kindsMemo.get(t.id);
  if (!v) kindsMemo.set(t.id, (v = kindsOf(t.category).filter((k) => !t.only || !!STRUCTURES[k][t.only])));
  return v;
};

export const TOOLS = TOOL_GROUPS.flatMap((g) => g.tools);

/** A tool that can do something now: facility tools need an unlocked kind. */
/** Takes up a facility of this kind (its tool, with the kind picked), as its card would: false when no tool holds it. */
export function pickStructure(k: StructureKind): boolean {
  const t = TOOLS.find((x): x is StructureTool => x.kind === 'structure' && kindsFor(x).includes(k));
  if (!t || !city.isUnlocked(k) || city.placementsLeft(k) <= 0) return false;
  chosen[t.id] = k;
  selectTool(t.id);
  return true;
}

const usable = (t: Tool | undefined): boolean => !!t && (t.kind !== 'structure' || kindsFor(t).some((k) => city.isUnlocked(k)));

/** Simulation speeds, shown like a player's buttons: pause, then one, two or three play arrows. */
export const SPEEDS: { icon: IconName; days: number; title: string }[] = [
  { icon: 'pause', days: 0, title: '멈춤 (0 · Space)' },
  { icon: 'play', days: 2, title: '느리게 (1)' },
  { icon: 'play2', days: 8, title: '보통 (2)' },
  { icon: 'play3', days: 30, title: '빠르게 (3)' },
];

export let tool: Tool = TOOLS[0]!;

/** The kind each facility tool places (by tool id). */
export const chosen: Record<string, StructureKind> = {
  power: 'coalPlant', water: 'waterPump', garbage: 'wasteToEnergyPlant', police: 'smallPoliceStation', fire: 'smallFireStation', health: 'medicalClinic', education: 'elementarySchool',
  park: 'smallParkGreen', transport: 'busStop', reward: 'mayorsHouse', deal: 'casino', landmark: 'bigBen',
};

/** A facility's swatch in a list: its colour on the map with the sign it carries there (★, +, B …). */
function swatchOf(k: StructureKind, title = ''): string {
  const m = structureMark(k);
  return `<span class="pick-swatch" style="background:${m.fill};color:${m.mark}"${title ? ` title="${title}"` : ''} aria-hidden="true">${m.glyph}</span>`;
}

/** An icon for each tool (zones use their colour swatch instead). */
const TOOL_ICON: Record<string, IconName> = {
  query: 'search', route: 'route', mic: 'mic', bulldoze: 'eraser',
  road: 'road', street: 'street', avenue: 'avenue', oneway: 'oneway', highway: 'highway', elhighway: 'elevated', onramp: 'onramp', cloverleaf: 'clover',
  rail: 'rail', subway: 'subway', unsubway: 'scissors', elrail: 'train', transition: 'transition', monorail: 'monorail', toll: 'ticket', transport: 'bus',
  powerline: 'cable', power: 'factory', pipe: 'pipe', unpipe: 'scissors', water: 'droplet', landfill: 'trash', garbage: 'recycle',
  police: 'shield', fire: 'flame', 'send-fire': 'flame', 'send-police': 'siren', health: 'health', education: 'school', park: 'trees', trees: 'tree',
  reward: 'trophy', throw: 'coins', deal: 'handshake', landmark: 'landmark', level: 'tractor',
  'disaster-fire': 'flameKindling', 'disaster-lightning': 'lightning', 'disaster-meteor': 'sparkles', 'disaster-tornado': 'tornado', 'disaster-earthquake': 'quake',
  'disaster-volcano': 'volcano', 'disaster-robot': 'bot', 'disaster-autosaurus': 'bug', 'disaster-ufo': 'ufo', dig: 'waves', fill: 'shovel', raise: 'raise', lower: 'lower',
};

/** The tool's look: its icon, or a zone's colour. */
export function toolGlyph(t: Tool): string {
  // Zones show their colour; dezoning is an action, not a zone, so it keeps its icon.
  return t.kind === 'zone' && t.zone !== 'none' ? `<span class="swatch" style="background:${t.color}"></span>` : icon(TOOL_ICON[t.id] ?? 'search');
}

/** The tool's full name (zones say which: 주거 저밀도). */
export function toolName(t: Tool): string {
  const g = TOOL_GROUPS.find((x) => x.tools.includes(t));
  return t.kind === 'zone' && t.zone !== 'none' && t.zone !== 'A' && t.zone !== 'landfill' && g ? `${g.title} ${t.label}` : t.label;
}

export const categoryOf = (id: string): CategoryId => TOOL_GROUPS.find((g) => g.tools.some((t) => t.id === id))?.cat ?? 'inspect';

/** The tool each category comes back to (the last one used there). */
const lastTool: Partial<Record<CategoryId, string>> = {};

/** The open tray's category, if any. */
let openCat: CategoryId | null = null;

/** The build category 짓기 opens (the last one used). */
let lastBuildCat: CategoryId = 'transport';

/** What a tool costs per tile, for its tooltip ('' when it varies). */
function toolPrice(t: Tool): string {
  const c = toolCost(t);
  return c ? `§${fmt(c.cost)}${c.unit}` : '';
}

/** What a tool costs at once, and per what (a tile of what is drawn, a tree, a throw; '' for one of a kind), as the
 *  engine charges it (null: nothing, or as it varies). Built before any city is open: prices come from the default
 *  config (every city uses it). */
function toolCost(t: Tool): { cost: number; unit: string } | null {
  const cfg = DEFAULT_CONFIG;
  const ec = cfg.economy;
  const per = (cost: number) => ({ cost, unit: '/칸' });
  switch (t.kind) {
    case 'network': return per(ec.networkCost[t.network].build);
    case 'elevated': return per(ec.networkCost[t.track === 'highway' ? 'elevatedHighway' : t.track].build);
    case 'subway': return per(ec.networkCost.subway.build);
    case 'powerline': return per(cfg.services.powerLineCost.build);
    case 'pipe': return per(cfg.services.pipeCost.build);
    case 'zone': {
      if (t.zone === 'none') return null;
      if (t.zone === 'landfill') return per(cfg.garbage.landfill.zoneCost);
      // (High-density commercial is the cheaper high density: §50 here read §30 at the drag.)
      if (t.zone === 'C-high') return per(ZONING_COST_HIGH_COMMERCIAL);
      const density = t.zone === 'A' ? 'low' : t.zone.endsWith('low') ? 'low' : t.zone.endsWith('medium') ? 'medium' : 'high';
      return per(ec.zoningCost[density]);
    }
    case 'terraform': return per(t.to === 'raise' || t.to === 'lower' ? cfg.terrain.terraform.cost : cfg.disasters.terraformCost);
    case 'level': return per(cfg.disasters.levelCost);
    case 'trees': return { cost: cfg.flora.saplingCost, unit: '/그루' };
    case 'toll': return { cost: cfg.transport.toll.cost, unit: '' };
    case 'cloverleaf': return { cost: cfg.transport.cloverleaf.cost, unit: '' };
    case 'transition': return { cost: cfg.transport.subwayTransition.cost, unit: '' };
    case 'unpipe': return per(cfg.services.pipeCost.bulldoze);
    case 'unsubway': return per(ec.networkCost.subway.bulldoze);
    case 'throw': return { cost: cfg.mayor.throwMoney.cost, unit: '/번' };
    default: return null;
  }
}

/** Money as the tools' card says it: whole sections, but the hundredths a tile of road costs a month (§0.05). */
const sect = (v: number) => `§${Number.isInteger(v) || Math.abs(v) >= 10 ? fmt(v) : String(+Math.abs(v).toFixed(2))}`;

/**
 * What a tool goes on costing once it is down, a month at a full budget ('' for an act that is over when done: the
 * land reshaped, a unit sent, a disaster): per tile for what is drawn — a zone's tiles nothing until built on (its
 * buildings pay taxes; the services they call for are their own buildings' upkeep) — and taken up, the saving (−).
 */
function toolMonthly(t: Tool): string {
  const cfg = DEFAULT_CONFIG;
  const ec = cfg.economy;
  const per = (v: number) => `월 ${sect(v)}/칸`;
  switch (t.kind) {
    case 'network': return per(ec.networkCost[t.network].upkeep);
    case 'elevated': return per(ec.networkCost[t.track === 'highway' ? 'elevatedHighway' : t.track].upkeep);
    case 'subway': return per(ec.networkCost.subway.upkeep);
    case 'powerline': return per(cfg.services.powerLineCost.upkeep);
    case 'pipe': return per(cfg.services.pipeCost.upkeep);
    case 'unpipe': return `월 −${sect(cfg.services.pipeCost.upkeep)}/칸`;
    case 'unsubway': return `월 −${sect(ec.networkCost.subway.upkeep)}/칸`;
    case 'zone': return t.zone === 'none' ? '' : t.zone === 'landfill' ? per(cfg.garbage.landfill.upkeep) : '월 §0';
    case 'toll': return `월 ${sect(cfg.transport.toll.upkeep)}`;
    case 'cloverleaf': return `월 ${sect(cfg.transport.cloverleaf.upkeep)}`;
    case 'transition': return `월 ${sect(cfg.transport.subwayTransition.upkeep)}`;
    case 'terraform': case 'level': case 'trees': return '월 §0';
    default: return '';
  }
}

/** What sending a unit or a disaster costs: nothing. (Money thrown has its price: toolCost.) */
function actPrice(t: Tool): string {
  return t.kind === 'dispatch' || t.kind === 'disaster' ? '무료' : '';
}

/** A facility kind's month as the budget charges a new one at full budgets: its upkeep (a plant's at full output) and
 *  a clinic's or a school's vehicles (their own row in its card) — or what a deal pays (+). */
function kindMonthly(k: StructureKind): { month: string; gain: boolean } {
  const d = STRUCTURES[k];
  return d.income ? { month: `월 +${sect(d.income)}`, gain: true } : { month: `월 ${sect(d.upkeep + ((d.health ?? d.school)?.vehicles ?? 0))}`, gain: false };
}

/**
 * The inside of a tile of the tools' card — every button there is one (a tool, a facility, an act, the folds): its
 * glyph, its name, what it does (a facility's figures, a line each, or why it is locked), and what it costs, at once
 * and then a month. (The facilities were cards in rows of two, the tools tiles; a price alone told nothing of the
 * upkeep that follows it every month.)
 */
function tileHtml(o: { glyph: string; name: string; stat?: string; now?: string; month?: string; gain?: boolean; short?: boolean; key?: string }): string {
  const cost = o.now || o.month
    ? `<span class="tile-cost">${o.now ? `<span class="tile-price${o.short ? ' short' : ''}">${o.now}</span>` : ''}${o.month ? `<span class="tile-month${o.gain ? ' gain' : ''}">${o.month}</span>` : ''}</span>`
    : '';
  return `<span class="tile-icon">${o.glyph}</span><span class="tile-label">${o.name}</span>${o.stat ? `<span class="tile-stat">${o.stat}</span>` : ''}${cost}${o.key ? `<kbd>${o.key}</kbd>` : ''}`;
}

/** A facility's figures for its tile: a line each, a number kept with its unit (급수 20,000 m³ broke before m³), and
 *  not a deal's pay (the tile's month says it). */
const tileStat = (stat: string) => statParts(stat).map((x) => x.replace(/ (m³|MWh|t)(?= |$)/g, '\u00a0$1')).join('<br>');
/** A facility's figures but a deal's pay (its month says it: the tooltip said it twice). */
const statParts = (stat: string) => stat.split(' · ').filter((x) => x && !x.startsWith('월 +§'));

/** A fold of the card's less usual tools or kinds, as a tile: how many it holds, or 접기. */
const foldTile = (open: boolean, count: number | string) =>
  tileHtml({ glyph: icon(open ? 'chevronDown' : 'more'), name: open ? '접기' : '더 보기', stat: open ? '' : `${count}개` });

export function buildTools(): void {
  // The dock: one button per category.
  const dock = $('#dock-tools');
  const catButton = (c: (typeof CATEGORIES)[number], cls: string, label: string = c.label) => {
    const keyed = Object.entries(TOOL_KEYS).filter(([, id]) => categoryOf(id) === c.id).map(([k, id]) => {
      const t = TOOLS.find((x) => x.id === id)!;
      return { key: k.toUpperCase(), name: t.kind === 'zone' ? TOOL_GROUPS.find((g) => g.tools.includes(t))!.title : t.label };
    });
    // What it holds (its groups, unless they are its name: 지형·재해) and its keys, each by the tool it picks (the
    // bar's tooltip shows them so: 도로 R · 골목 T …); one key for the one tool it is (철거) by itself.
    const groups = TOOL_GROUPS.filter((g) => g.cat === c.id).map((g) => g.title).join('·');
    // (철거 is a tool, not a card of them: pressed, it is in hand — what a drag does, said instead.)
    const holds = c.id === 'bulldoze' ? ': 끌어서 헐기 · 빈 구역에서 시작하면 구역 해제' : groups && groups !== c.label ? `: ${groups}` : '';
    const named = keyed.length > 1 || (keyed[0] && keyed[0].name !== c.label);
    const opens = c.id === 'bulldoze' ? 'aria-pressed="false"' : 'aria-expanded="false" aria-controls="tray"';
    return `<button class="${cls}" data-cat="${c.id}" ${opens} title="${c.label}${holds}${keyed.length ? ` (${keyed.map((k) => k.key).join('·')})` : ''}"${named ? ` data-keys="${keyed.map((k) => `${k.name} ${k.key}`).join(' · ')}"` : ''}>${icon(c.icon)}<span class="dock-label">${label}</span></button>`;
  };
  // Building the city, rewards and the land, taking down last — evenly spaced, one family (no gaps between groups).
  // (Not 살펴보기: with nothing in hand the map looks by itself.)
  dock.innerHTML = CATEGORIES.filter((c) => c.id !== 'inspect').map((c) => catButton(c, 'dock-btn', 'short' in c ? c.short : c.label)).join('');
  // A phone's tools' card heads itself with the build categories (the bar is away under the card there).
  // (철거 at its end as on the bar: the bulldozer was out of reach.)
  $('#tray-cats').innerHTML = [...BUILD_CATS, 'bulldoze' as const].map((id) => {
    const c = CATEGORIES.find((x) => x.id === id)!;
    return catButton(c, 'tray-cat', 'short' in c ? c.short : c.label);
  }).join('');
  document.querySelectorAll<HTMLButtonElement>('#dock-tools [data-cat], #tray-cats [data-cat]').forEach((b) => {
    b.onclick = (e) => {
      // 철거: the bulldozer in hand at once (no card: it is the one tool), and put down by a second press — on the
      // bar; the card's row only picks it up (in hand already, a press there to go on bulldozing put it down).
      if (b.dataset.cat === 'bulldoze') {
        const inRow = !!b.closest('#tray-cats');
        closeTray();
        if (!(inRow && tool.id === 'bulldoze')) selectTool(tool.id === 'bulldoze' ? 'query' : 'bulldoze');
        // (From the keyboard, on to the map, where Enter takes down at the cursor: left here, the next Enter pressed
        // 철거 again and put it down.)
        if (e.detail === 0 && tool.id === 'bulldoze') $('#map').focus({ preventScroll: true });
        return;
      }
      const inTray = !!b.closest('#tray-cats');
      const cat = b.dataset.cat as CategoryId;
      const same = openCat === cat;
      if (same && !inTray) {
        closeTray(true);
        return;
      }
      // A build category only opens its card: the tool is picked there (and picking one closes the card). Nothing is
      // armed unseen — a road or a zone armed by the press laid itself at the next drag, one meant to pan (§1,625 of
      // zone and streets for a look at 개발 구역), and nothing undoes a build. (Not a locked one: rewards and deals
      // start out all locked.)
      const tools = TOOL_GROUPS.find((g) => g.cat === cat)!.tools;
      const pick = [TOOLS.find((t) => t.id === lastTool[cat]), ...tools].find(usable);
      if (pick && !BUILD_CATS.includes(cat)) selectTool(pick.id);
      openTray(cat, true);
      // From the keyboard, carry on in the tray at the tool in hand, or the one last used there, or its first (arrows
      // move from there).
      if (e.detail === 0) {
        const section = '#tools .tray-section:not([hidden])';
        (document.querySelector<HTMLElement>(`${section} .tile.active:not([hidden])`)
          ?? (pick ? document.querySelector<HTMLElement>(`${section} .tile[data-tool="${pick.id}"]:not([hidden])`) : null)
          ?? document.querySelector<HTMLElement>(`${section} .tile:not([hidden]):not([disabled])`))?.focus();
      }
    };
  });
  $('#tray-close').onclick = () => closeTray(true);
  wireFind();
  // A fade at the card's foot while more of it is below (the parks under 서비스 sat past the foot unannounced).
  const tools = $('#tools');
  tools.addEventListener('scroll', markScroll, { passive: true });
  new ResizeObserver(markScroll).observe(tools);
  // Arrow keys move between the tray's tiles and cards: left/right in reading
  // order, up/down to the nearest button above or below.
  $('#tools').addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) return;
    const from = document.activeElement as HTMLElement | null;
    const items = [...document.querySelectorAll<HTMLButtonElement>('#tools .tray-section:not([hidden]) button:not([hidden]):not([disabled])')]
      .filter((b) => b.offsetParent);
    const at = from ? items.indexOf(from as HTMLButtonElement) : -1;
    if (at < 0) return;
    let to: HTMLButtonElement | undefined;
    if (k === 'ArrowLeft' || k === 'ArrowRight') to = items[at + (k === 'ArrowRight' ? 1 : -1)];
    else {
      const r = from!.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const down = k === 'ArrowDown';
      let best = Infinity;
      for (const b of items) {
        const q = b.getBoundingClientRect();
        const dy = down ? q.top - r.bottom : r.top - q.bottom;
        if (dy < -2) continue; // not below (or above)
        const d = dy * 4 + Math.abs(q.left + q.width / 2 - cx);
        if (b !== from && d < best) {
          best = d;
          to = b;
        }
      }
    }
    if (to) {
      to.focus();
      to.scrollIntoView({ block: 'nearest' });
      e.preventDefault();
      e.stopPropagation(); // not the map's arrow-key panning
    }
  });
  $('#tool-chip-close').onclick = () => selectTool('query');
  // The chip's name opens the tray at its category (another kind, another tool) — not 철거's: it is the one tool.
  const chipLabel = $('#tool-chip-label');
  chipLabel.onclick = (e) => {
    // (After a mouse press, Space is the game's pause again, not this button's.)
    if (e.detail > 0) chipLabel.blur();
    if (tool.kind !== 'bulldoze') openTray(categoryOf(tool.id));
  };
  $('#tool-alts').addEventListener('scroll', edgeAlts, { passive: true });
  new ResizeObserver(edgeAlts).observe($('#tool-alts')); // (shown again after the tray, or a narrower window)
  $('#tray-recent').addEventListener('scroll', () => edgeFade($('#tray-recent')), { passive: true });
  new ResizeObserver(() => edgeFade($('#tray-recent'))).observe($('#tray-recent'));
  $('#tool-alts').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.dataset.altKind && tool.kind === 'structure') {
      chosen[tool.id] = b.dataset.altKind as StructureKind;
      selectTool(tool.id);
    } else if (b.dataset.altTool) selectTool(b.dataset.altTool);
  });

  // The tray: every group's tiles, shown by category.
  const nav = $('#tools');
  nav.innerHTML = '';
  for (const g of TOOL_GROUPS) {
    const wrap = document.createElement('div');
    wrap.className = 'tray-section';
    wrap.dataset.cat = g.cat;
    // Zone groups say how much their class is wanted right now (filled by refreshZoneDemand).
    const demandOf = g.cat === 'zones' ? ({ 주거: 'R', 상업: 'C', 산업: 'I' } as Record<string, string>)[g.title] : undefined;
    if (demandOf) wrap.dataset.demand = demandOf;
    // A service's group says what it misses right now, as its view counts it (filled by refreshZoneDemand).
    const missing = SECTION_VIEW[g.title];
    if (missing) wrap.dataset.view = missing;
    // (Parks lift the homes' cap: their group says when people wait at it.)
    const lifts = g.title === '공원';
    if (lifts) wrap.dataset.cap = 'R';
    wrap.innerHTML = `<h3>${g.title}${demandOf || missing || lifts ? '<span class="zone-demand"></span>' : ''}</h3>`;
    const group = document.createElement('div');
    group.className = 'group';
    // (Acts on the running city — a unit sent, money thrown — after the group's facilities, a tile as the rest.)
    const acts = document.createElement('div');
    acts.className = 'group acts';
    for (const t of g.tools) {
      const b = document.createElement('button');
      b.type = 'button';
      // (A single finer tool is a tile of its own: "더 보기 1개" hid it behind a tile the same size.)
      b.className = MORE.has(t.id) && g.tools.filter((x) => MORE.has(x.id)).length > 1 ? 'tile more' : 'tile';
      b.dataset.tool = t.id;
      const key = Object.entries(TOOL_KEYS).find(([, id]) => id === t.id)?.[0]?.toUpperCase();
      const now = toolPrice(t) || actPrice(t);
      const month = toolMonthly(t);
      const cost = toolCost(t)?.cost;
      if (cost) b.dataset.cost = String(cost); // (marked short when the funds can't cover it: refreshToolPrices)
      b.innerHTML = tileHtml({ glyph: toolGlyph(t), name: t.label, now, month, key });
      b.title = `${toolName(t)}${key ? ` (${key})` : ''}${now ? ` · ${now}` : ''}${month ? ` · 유지 ${month}` : ''}`;
      b.onclick = (e) => pickTool(t.id, e.detail === 0);
      // A facility tool is picked with its kind's tile below, not with a tile of its own.
      if (t.kind === 'structure') b.hidden = true;
      (ACTIONS.has(t.kind) ? acts : group).append(b);
    }
    // The finer tools behind one tile at the group's end.
    const extra = g.tools.filter((t) => MORE.has(t.id)).length;
    if (extra > 1) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'tile tile-more';
      more.setAttribute('aria-expanded', 'false');
      more.innerHTML = foldTile(false, extra);
      more.title = g.tools.filter((t) => MORE.has(t.id)).map((t) => t.label).join(' · ');
      more.onclick = () => {
        const open = wrap.classList.toggle('show-more');
        more.setAttribute('aria-expanded', String(open));
        more.innerHTML = foldTile(open, extra);
      };
      group.append(more);
    }
    // One run of tiles a section: its tools, its facilities' kinds, its acts (rows of their own left a lone tile — 소방
    // 출동 — on a row under three).
    const tiles = document.createElement('div');
    tiles.className = 'tiles';
    wrap.append(tiles);
    if (g.tools.some((t) => t.kind !== 'structure' && !ACTIONS.has(t.kind))) tiles.append(group);
    const civic = g.tools.find((t): t is StructureTool => t.kind === 'structure');
    if (civic) {
      // The facility kinds as cards (filled by refreshStructureLists as unlocks change).
      const picker = document.createElement('div');
      picker.className = 'picker';
      picker.dataset.tool = civic.id;
      // (Its kinds are buttons pressed as the tools' are, not a listbox's options: the box is display: contents in its
      // section's run of tiles, which some screen readers drop — and the options' list with it.)
      picker.setAttribute('role', 'group');
      picker.setAttribute('aria-label', `${g.title} 시설 종류`);
      picker.addEventListener('click', (e) => {
        const fold = (e.target as HTMLElement).closest<HTMLElement>('[data-fold]');
        if (fold) {
          const open = wrap.classList.toggle('show-more');
          fold.setAttribute('aria-expanded', String(open));
          fold.innerHTML = foldTile(open, fold.dataset.count ?? '');
          return;
        }
        if ((e.target as HTMLElement).closest('[data-more]')) {
          picker.classList.toggle('show-locked');
          lockedLabel(picker);
          return;
        }
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-kind]');
        if (!b || b.disabled) return;
        chosen[civic.id] = b.dataset.kind as StructureKind;
        pickTool(civic.id, e.detail === 0);
      });
      tiles.append(picker);
    }
    if (acts.childElementCount) tiles.append(acts);
    if (g.tools.some((t) => t.kind === 'network' && t.network === 'road')) {
      // Bridges: tall enough for ferries by default; a low one is cheaper but blocks them (Rush Hour).
      const low = document.createElement('label');
      low.className = 'check more-only';
      low.title = '물 위에 놓는 다리를 낮게: 40% 싸지만 페리가 밑으로 지나가지 못합니다';
      low.innerHTML = '<input id="low-bridge" type="checkbox"> 낮은 다리 (40% 싸지만 페리를 막음)';
      wrap.append(low);
    }
    if (g.tools.some((t) => t.kind === 'disaster')) {
      const power = document.createElement('label');
      power.className = 'funding dept';
      power.innerHTML = '세기 <input id="disaster-intensity" type="range" min="0" max="100" step="10" value="50"><span>50%</span>';
      const input = power.querySelector('input')!;
      input.oninput = () => ((input.nextElementSibling as HTMLElement).textContent = `${input.value}%`);
      const extras = document.createElement('div');
      extras.className = 'extras';
      extras.append(power);
      wrap.append(extras);
    }
    nav.append(wrap);
  }
  selectTool('query');
}

/** Opens the tray under the dock (at the map's top) with a category's tools. */
/**
 * A tool has built something: it is one of the recent ones. (Picked up alone it isn't: every tray read
 * "최근 [주거 저밀도] [도로]" before anything was built.)
 */
export function toolUsed(used: Tool = tool): void {
  noteRecent(used);
}

/** Whether the tools' card goes on below what shows of it: its foot fades then. */
function markScroll(): void {
  const el = $('#tools');
  el.classList.toggle('more-below', el.scrollHeight - el.scrollTop - el.clientHeight > 4);
}

/** The next step's tool its dot points to now, and the one the player last looked at (in which city). */
let shownAct = '';
let seen = { act: '', city: -1 };
/** The player looked where the dot pointed: it goes until the next step is another. */
function sawSuggestion(cat: CategoryId | null, id?: string): void {
  if (!shownAct || (id ? id !== shownAct : categoryOf(shownAct) !== cat)) return;
  seen = { act: shownAct, city: cityLineage };
  markSuggested();
}

export function openTray(cat: CategoryId, fromDock = false): void {
  openCat = cat;
  sawSuggestion(cat);
  // Opened from the tool's bar (a tool in hand), the card goes when that tool is put down.
  $('#tray').classList.toggle('from-bar', !fromDock && tool.id !== 'query');
  // One card at a time where they share the space: the app sheet and info card (the tray
  // reaches across under it on wide screens too), and on phones the pane.
  closeSheet();
  if (matchMedia('(max-width: 860px)').matches) closePane();
  closeInfo();
  const c = CATEGORIES.find((x) => x.id === cat)!;
  $('#tray-title').innerHTML = `${icon(c.icon)}${c.label}`;
  document.querySelectorAll<HTMLElement>('#tools .tray-section').forEach((s) => (s.hidden = s.dataset.cat !== cat));
  // One group: its title would only repeat the category's.
  $('#tray').classList.toggle('single', TOOL_GROUPS.filter((g) => g.cat === cat).length === 1);
  $('#tray').classList.toggle('build', BUILD_CATS.includes(cat));
  $('#tray').dataset.cat = cat;
  if (BUILD_CATS.includes(cat)) lastBuildCat = cat;
  $('#tray').hidden = false;
  refreshStructureLists(); // its cards were left alone while shut
  clearFind();
  $('#tools').scrollTop = 0;
  requestAnimationFrame(markScroll);
  // Reopened, it shows the tool in hand (a landfill or a pump sat a scroll down every time).
  // (A facility's hidden tile is 'active' too: its card in the list is the one to show.)
  document.querySelector<HTMLElement>('#tools .tray-section:not([hidden]) .tile.active:not([hidden])')?.scrollIntoView({ block: 'nearest' });
  document.querySelectorAll<HTMLButtonElement>('#dock-tools [aria-controls="tray"], #tray-cats [aria-controls="tray"]').forEach((b) => {
    const on = b.dataset.cat === cat;
    b.classList.toggle('open', on);
    b.setAttribute('aria-expanded', String(on));
  });
}

/**
 * Closes the tray (the tool stays picked). Returns whether it was open. (byPlayer: put away by its ×, Esc or its dock
 * button again — focus goes back to that button.)
 */
export function closeTray(byPlayer = false): boolean {
  if (!openCat) return false;
  const cat = openCat;
  openCat = null;
  // Keyboard focus inside the tray goes back to the dock button that opened it, not to the page.
  // (After a mouse pick it goes nowhere: on the dock button, Space would open the tray again instead of pausing.)
  const active = document.activeElement as HTMLElement | null;
  const hadFocus = !!active && $('#tray').contains(active) && active.matches(':focus-visible');
  if (!hadFocus && active && $('#tray').contains(active)) active.blur();
  $('#tray').hidden = true;
  if (hadFocus) {
    // (A tool picked from it: the keys are the map's now — focus back on the dock button had the next Enter open 교통
    // again and swap the tool for 도로, where the help says Enter builds at the cursor. Not when it was put away, Esc
    // with a tool already in hand: back to where it was opened from.)
    if (tool.id !== 'query' && !byPlayer) active?.blur();
    else document.querySelector<HTMLButtonElement>(`#dock-tools [data-cat="${cat}"]`)?.focus();
  }
  document.querySelectorAll<HTMLButtonElement>('#dock-tools [aria-controls="tray"], #tray-cats [aria-controls="tray"]').forEach((b) => {
    b.classList.remove('open');
    b.setAttribute('aria-expanded', 'false');
  });
  return true;
}

/** Marks the facility card in hand (none while another tool is). */
function markPicked(picker: HTMLElement): void {
  const id = picker.dataset.tool!;
  picker.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) => {
    const on = tool.id === id && b.dataset.kind === chosen[id];
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** The fold button's label: how many locked kinds it hides, or that it hides them. */
function lockedLabel(picker: HTMLElement): void {
  const more = picker.querySelector<HTMLButtonElement>('[data-more]');
  if (!more) return;
  const shown = picker.classList.contains('show-locked');
  more.setAttribute('aria-expanded', String(shown));
  more.innerHTML = tileHtml({ glyph: icon('lock'), name: shown ? '잠긴 시설 숨기기' : '잠긴 시설', stat: shown ? '' : `${more.dataset.count}개 보기` });
}

/** A facility's headline figure for its card (the hover hint spells out more). */
export function structureStat(k: StructureKind): string {
  const d = STRUCTURES[k];
  if (d.plant) return `${fmt(d.plant.output)} MWh`;
  if (d.pump) return `급수 ${fmt(d.pump.output)} m³`;
  if (d.treatment) return `반경 ${d.treatment.radius}칸 · 수질 정화`;
  if (d.incinerator) return `월 ${fmt(d.incinerator.capacity)} t 소각`;
  if (d.recycling) return `쓰레기 −${Math.round(d.recycling.reduction * 100)}%`;
  if (d.police) return d.police.radius ? `반경 ${Math.round(d.police.radius)}칸${d.police.cells ? ` · 감방 ${fmt(d.police.cells)}명` : ''}` : `수감 ${fmt(d.police.cells)}명${d.income ? ` · 월 +§${fmt(d.income)}` : ''}`;
  if (d.fire) return `반경 ${Math.round(d.fire.radius)}칸`;
  if (d.health) return `반경 ${d.health.radius}칸 · 환자 ${fmt(d.health.capacity)}명`;
  if (d.school) return `${d.school.radius >= 300 ? '도시 전체' : `반경 ${d.school.radius}칸`} · 학생 ${fmt(d.school.capacity)}명`;
  if (d.station) return `월 ${fmt(d.station.capacity)}명`;
  if (d.parking) return `월 ${fmt(d.parking.capacity)}대`;
  if (d.airport) return `오피스 상한 최대 +${fmt(d.airport.capacity)}`;
  if (d.seaport) return `산업 상한 최대 +${fmt(d.seaport.relief)}`;
  if (d.income) return `월 +§${fmt(d.income)}`;
  if (d.category === 'landmark' || d.category === 'reward') return d.mayor?.[0] ? `시장 평점 ${d.mayor[0] > 0 ? '+' : ''}${d.mayor[0]}` : '';
  return d.relief[0] ? `주거 상한 +${fmt(d.relief[0])}` : '';
}

/** The tools' prices as the city stands: the land's tools cost nothing until it is founded (as the getting-started list
 *  says), and a price the funds can't cover is red, as a facility's is. */
function refreshToolPrices(): void {
  const free = !city.established();
  const funds = city.state.funds;
  document.querySelectorAll<HTMLElement>('#tools .tile[data-tool]').forEach((b) => {
    const t = TOOLS.find((x) => x.id === b.dataset.tool);
    const price = b.querySelector('.tile-price');
    if (!t || !price) return;
    const gratis = free && t.kind === 'terraform';
    if (t.kind === 'terraform') {
      price.textContent = gratis ? '무료' : toolPrice(t);
      b.classList.toggle('free', gratis);
    }
    price.classList.toggle('short', !gratis && Number(b.dataset.cost ?? 0) > funds);
  });
}

/** The view whose count a facility group's heading shows (what its buildings fix), and the goal it is part of. */
const SECTION_VIEW: Record<string, string> = { 도로: 'traffic', '정류장·역': 'traffic', 전력: 'power', 수도: 'waterService', 쓰레기: 'garbage', 경찰: 'police', 소방: 'fire', 보건: 'health', 교육: 'school' };
const VIEW_GOAL: Record<string, GoalId> = { traffic: 'traffic', power: 'power', waterService: 'water', garbage: 'garbage', police: 'police', fire: 'fire', health: 'health', school: 'education' };

/** The groups' headings: a service's shortfall now (none: nothing said); a zone class's strongest demand, or that its cap holds it, or none. */
function refreshZoneDemand(): void {
  // (Once a tray: 도로 and 정류장·역 share the traffic view, and both read "막힌 길 139칸".)
  const said = new Set<string>();
  document.querySelectorAll<HTMLElement>('#tools .tray-section[data-view]').forEach((sec) => {
    const el = sec.querySelector<HTMLElement>('.zone-demand')!;
    if (said.has(sec.dataset.view!)) {
      if (el.textContent) el.textContent = '';
      el.className = 'zone-demand';
      return;
    }
    said.add(sec.dataset.view!);
    // (Under its own heading the service needn't be named again: 경찰 · 닿지 않는 건물 147채.)
    const gap = viewProblem(sec.dataset.view!).replace(/^(경찰|소방|병원|학교)[이가] /, '').replace(/^용량을 넘어 /, '');
    // (Nothing out of reach: how full it runs, where that is the trouble — hospitals past their places, the grid near its output.)
    const goal = VIEW_GOAL[sec.dataset.view!]!;
    const bar = goal === 'power' || goal === 'water' || goal === 'health' || goal === 'education' ? goalStatus(goal).bar : undefined;
    const pct = bar !== undefined && Number.isFinite(bar) ? Math.round(bar * 100) : 0;
    // (A grid with nothing feeding it reads no share: with no pump at all, 급수량의 200% 사용 중 was said.)
    const fed = goal === 'power' ? readStats().power.supply > 0 : goal === 'water' ? readStats().water.supply > 0 : true;
    const text = gap || (goal === 'power' || goal === 'water' ? (fed && pct > 85 ? `${goal === 'power' ? '발전량' : '급수량'}의 ${pct}% 사용 중` : '') : pct > 100 ? `정원의 ${pct}% · 넘침` : '');
    if (el.textContent !== text) el.textContent = text;
    // (Amber only while the goal itself asks for a look, as the city's list colours it: a gap in police cover
    // while crime stays low is a fact to build by, not an alarm.)
    el.className = `zone-demand${text && goalStatus(goal).tone ? ' cap' : ''}`;
  });
  const dem = city.demand;
  document.querySelectorAll<HTMLElement>('#tools .tray-section[data-cap]').forEach((sec) => {
    const el = sec.querySelector<HTMLElement>('.zone-demand')!;
    const waiting = (['R$', 'R$$', 'R$$$'] as const).filter((t) => capped(t) && dem.raw[t] > 0).reduce((sum, t) => sum + dem.raw[t], 0);
    const text = waiting >= 1 ? `주거 상한 · 약 ${fmt(Math.round(waiting))}명 대기` : '';
    if (el.textContent !== text) el.textContent = text;
    el.className = `zone-demand${text ? ' cap' : ''}`;
  });
  document.querySelectorAll<HTMLElement>('#tools .tray-section[data-demand]').forEach((sec) => {
    const k = sec.dataset.demand!;
    const types = DEV_TYPES.filter((t) => t[0] === k);
    const top = types.reduce((a, b) => (dem.demand[b] > dem.demand[a] ? b : a));
    const v = dem.demand[top];
    // (Held at its cap as the pane says it, with people waiting to come.)
    const held = types.some((t) => t !== 'IA' && capped(t) && dem.raw[t] > 0);
    // Farms share the industry group: say so when it's them that are wanted.
    // (A trickle beside a cap is the cap: "수요 +1" read as wanted when the class was held at its limit.)
    // (No lock: that is a facility not yet unlocked; zoning more of a capped class still works.)
    const html = v >= 10 ? `${top === 'IA' ? '농업 ' : ''}수요 +${fmt(v)}` : held ? '수요 상한' : v >= 1 ? '수요 적음' : '수요 없음';
    const tone = v >= 100 ? 'up' : v < 10 && held ? 'cap' : ''; // a trickle of demand isn't news
    const el = sec.querySelector<HTMLElement>('.zone-demand')!;
    if (el.innerHTML !== html) el.innerHTML = html;
    el.className = `zone-demand ${tone}`;
  });
}

/** A zone tool's class demand for the chip: whether zoning more of it will fill now. */
function zoneDemandChip(zone: ZoneKind): string {
  if (zone === 'none' || zone === 'landfill') return '';
  const cls = zone === 'A' ? 'IA' : zone[0];
  const types = DEV_TYPES.filter((t) => (cls === 'IA' ? t === 'IA' : cls === 'I' ? t[0] === 'I' && t !== 'IA' : t[0] === cls));
  const dem = city.demand;
  const top = Math.max(...types.map((t) => dem.demand[t]));
  const held = types.some((t) => t !== 'IA' && capped(t) && dem.raw[t] > 0);
  return top >= 10 ? `<span class="zone-demand${top >= 100 ? ' up' : ''}">수요 +${fmt(Math.round(top))}</span>`
    : `<span class="zone-demand${held ? ' cap' : ''}">${held ? '수요 상한' : top >= 1 ? '수요 적음' : '수요 없음'}</span>`;
}

/** Fills the facility cards: ones that can be built first, then built-once rewards, then locked ones with their condition. */
export function refreshStructureLists(): void {
  // With the tray shut only the tool in hand needs checking (opening the tray brings the cards up to date).
  if ($('#tray').hidden) {
    if (tool.kind === 'structure') {
      const id = tool.id;
      const buildable = (k: StructureKind) => city.isUnlocked(k) && city.placementsLeft(k) > 0;
      if (!buildable(chosen[id]!)) chosen[id] = kindsFor(tool).find(buildable) ?? chosen[id]!;
      if (!buildable(chosen[id]!)) selectTool('query');
    }
    markSuggested();
    refreshToolChip();
    return;
  }
  refreshZoneDemand();
  refreshToolPrices();
  document.querySelectorAll<HTMLElement>('#tools .picker[data-tool]').forEach((picker) => {
    const id = picker.dataset.tool!;
    const kinds = kindsFor(TOOLS.find((t) => t.id === id) as StructureTool);
    // (Affordable or not too: a card the funds can't cover says so before the map does.)
    const signature = kinds.map((k) => `${+city.isUnlocked(k)}${+(city.placementsLeft(k) > 0)}${+(STRUCTURES[k].cost <= city.state.funds)}`).join('');
    if (picker.dataset.signature !== signature) {
      picker.dataset.signature = signature;
      const rank = (k: StructureKind) => (!city.isUnlocked(k) ? 2 : city.placementsLeft(k) <= 0 ? 1 : 0);
      const locked = kinds.filter((k) => !city.isUnlocked(k)).length;
      picker.innerHTML = kinds.map((k, i) => [k, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([k]) => {
        const def = STRUCTURES[k];
        const open = city.isUnlocked(k);
        const placed = open && city.placementsLeft(k) <= 0;
        const earned = city.state.unlocked.filter((u) => u === k).length;
        const why = plainCodes(def.unlock?.description ?? def.unlockTiers?.[earned]?.description ?? def.offer?.description ?? '');
        const short = open && !placed && def.cost > city.state.funds;
        const stat = structureStat(k);
        const folded = open && !!LEAD_KINDS[id] && !LEAD_KINDS[id]!.includes(k);
        const { month, gain } = kindMonthly(k);
        const now = def.cost ? `§${fmt(def.cost)}` : '무료';
        // (What it does a line each — 반경 24칸 / 환자 500명; locked, why; built once, so. Then its price and its month.)
        const does = statParts(stat).join(' · ');
        return `<button type="button" class="tile${!open ? ' locked' : placed ? ' placed' : ''}${folded ? ' more' : ''}" data-kind="${k}" aria-pressed="false" ${!open || placed ? 'disabled' : ''}
          title="${attr(`${STRUCTURE_NAME[k]} · ${def.w}×${def.h}칸 · 건설 ${now} · ${gain ? '수입' : '유지'} ${month}${does ? ` · ${does}` : ''}${short ? ' · 자금이 모자랍니다' : ''}${!open ? ` — ${why}` : ''}`)}">${tileHtml({
            // (Locked, the whole of what opens it, a condition a line: cut to three lines it lost the last — 총인구 —
            // and a touch has no tooltip to read the rest in.)
            glyph: !open ? icon('lock') : placed ? icon('check') : swatchOf(k, `${def.w}×${def.h}칸`), name: STRUCTURE_NAME[k],
            stat: !open ? statParts(why).join('<br>') : placed ? '이미 지음' : tileStat(stat), now: placed ? '' : now, month: placed ? '' : month, gain, short })}</button>`;
      }).join('')
        // The less usual kinds fold behind 더 보기; locked ones behind one tile of their own (many for rewards and landmarks).
        + (LEAD_KINDS[id] ? (() => {
          const n = kinds.filter((k) => city.isUnlocked(k) && !LEAD_KINDS[id]!.includes(k)).length;
          const shown = !!picker.closest('.show-more');
          return n ? `<button type="button" class="tile tile-more" data-fold data-count="${n}" aria-expanded="${shown}">${foldTile(shown, n)}</button>` : '';
        })() : '')
        + (locked ? `<button type="button" class="tile tile-more" data-more aria-expanded="false" data-count="${locked}"></button>` : '');
      lockedLabel(picker);
    }
    // A service short where it counts: the kind its goal would build marked 추천 (the same pick as its screen's).
    const suggested = suggestedKinds().get(id);
    picker.querySelectorAll<HTMLElement>('.tile[data-kind]').forEach((b) => {
      const on = b.dataset.kind === suggested;
      b.classList.toggle('suggested', on);
      // (Nor folded away behind 더 보기: the growth screen's 테니스장 was a park out of sight, its 추천 unseen.)
      b.dataset.folded ??= b.classList.contains('more') ? '1' : '';
      b.classList.toggle('more', b.dataset.folded === '1' && !on);
    });
    const fold = picker.querySelector<HTMLElement>('[data-fold]');
    if (fold) {
      const n = picker.querySelectorAll('.tile.more').length;
      if (fold.dataset.count !== String(n)) {
        fold.dataset.count = String(n);
        if (!picker.closest('.show-more')) fold.innerHTML = foldTile(false, n);
      }
      fold.hidden = !n;
    }
    // A kind that can't be built (locked here, or a built-once reward now standing) gives way to one that can.
    const buildable = (k: StructureKind) => city.isUnlocked(k) && city.placementsLeft(k) > 0;
    if (!buildable(chosen[id]!)) chosen[id] = kinds.find(buildable) ?? kinds.find((k) => city.isUnlocked(k)) ?? chosen[id]!;
    // Nothing of this tool can be built (another city opened, the last reward placed): put it down.
    if (tool.id === id && !buildable(chosen[id]!)) selectTool('query');
    markPicked(picker);
  });
  markSuggested();
  refreshToolChip(); // a kind unlocked or built (a built-once reward) joins or leaves the row; the funds move
}

/** Keyboard shortcuts for the most used tools (shown in their tooltips). */
export const TOOL_KEYS: Record<string, string> = {
  q: 'query', x: 'bulldoze', r: 'road', t: 'street', v: 'avenue', h: 'highway',
  z: 'R-low', c: 'C-low', i: 'I-medium', l: 'powerline', p: 'pipe',
};

/**
 * A tool picked in the tray: the tray steps aside for the map it covers (the
 * chip on the map reopens it). Picked from the keyboard, it stays for the
 * arrow keys.
 */
function pickTool(id: string, keyboard = false): void {
  selectTool(id);
  if (!keyboard) {
    closeTray();
    hoverUnderMouse();
  }
}

/** The tool held before the current one (` swaps back to it). */
export let previousTool = 'query';

/** Another city: no tool of the last one to swap back to (an armed disaster, a reward locked here). */
export function forgetPreviousTool(): void {
  previousTool = 'query';
}

/** The chip on the map naming the tool in hand (none for 조회), with its price or, for dispatch, the units free. */
export function refreshToolChip(): void {
  const chip = $('#tool-chip');
  chip.hidden = tool.id === 'query';
  if (chip.hidden) {
    $('#tool-alts').hidden = true; // (and , . have no siblings to step through)
    return;
  }
  $('#tool-chip-icon').innerHTML = toolGlyph(tool);
  chip.dataset.kind = tool.kind; // (a phone's narrow bar drops a facility's price: its confirm bar says it)
  // Facilities: the kind picked in the tray, with its price.
  const kind = tool.kind === 'structure' ? chosen[tool.id]! : null;
  const price = kind ? `§${fmt(STRUCTURES[kind].cost)} · 월 §${fmt(STRUCTURES[kind].upkeep)}`
    : tool.kind === 'dispatch' ? `출동 가능 ${city.freeUnits(tool.unit)}대`
    : tool.kind === 'terraform' && !city.established() ? '무료 (처음 짓기 전)' : toolPrice(tool);
  const short = !!kind && STRUCTURES[kind].cost > city.state.funds;
  const demand = tool.kind === 'zone' ? zoneDemandChip(tool.zone) : '';
  // 철거: how a drag works, in place of a price (a finger has no hover to say it first), and no card to open.
  const bulldoze = tool.kind === 'bulldoze';
  $('#tool-chip-label').title = bulldoze ? '철거: 끌어서 헐기 · 빈 구역에서 시작하면 구역 해제' : '다른 종류 고르기';
  $('#tool-chip-label').tabIndex = bulldoze ? -1 : 0;
  // (Not the clock held for building as well: a ⏸ 멈춤 here whose press set time going read as the reverse of what
  // it did. The bar's speeds say it, ringed — on a phone its 시간, 잠시 멈춤 — and the hint, the first times.)
  const how = bulldoze ? '끌어서 헐기 · 빈 구역은 해제' : price;
  const html = `<b>${kind ? STRUCTURE_NAME[kind] : toolName(tool)}</b>${how ? `<span${short ? ' class="short" title="자금이 모자랍니다"' : ''}>${how}</span>` : ''}${demand}${bulldoze ? '' : icon('chevronDown', 'chip-more')}`;
  if ($('#tool-chip-label').innerHTML !== html) $('#tool-chip-label').innerHTML = html;
  refreshToolAlts();
}

/**
 * Under the chip, the tool's siblings — the other roads, densities, kinds of
 * plant — one click away, without the tray (it covers the map being built on).
 */
function refreshToolAlts(): void {
  const row = $('#tool-alts');
  let html = '';
  // Each with its price, how they differ (in a tooltip only, a finger never saw it) — the land's free before the first
  // build, as the chip says it.
  const cost = (price: string) => (price ? `<small class="alt-cost">${price}</small>` : '');
  const priceOf = (t: Tool) => (t.kind === 'terraform' && !city.established() ? '무료' : toolPrice(t));
  if (tool.kind === 'structure') {
    const t = tool;
    // (The everyday kinds where there are many — the bar would scroll through 22 parks — and the one in hand.)
    const kinds = kindsFor(t).filter((k) => city.isUnlocked(k) && city.placementsLeft(k) > 0 && (!LEAD_KINDS[t.id] || LEAD_KINDS[t.id]!.includes(k) || k === chosen[t.id]));
    // A plant or a pump is half the job: its line or pipe is one click away too.
    const line = ({ power: 'powerline', water: 'pipe' } as Record<string, string>)[t.id];
    const lineTool = line ? TOOLS.find((x) => x.id === line) : undefined;
    if (kinds.length > 1 || lineTool) {
      html = kinds.map((k) => `<button type="button" class="${chosen[t.id] === k ? 'active' : ''}" data-alt-kind="${k}" aria-pressed="${chosen[t.id] === k}"
        title="${attr(`${STRUCTURES[k].w}×${STRUCTURES[k].h}칸 · §${fmt(STRUCTURES[k].cost)} · 월 §${fmt(STRUCTURES[k].upkeep)}`)}">${swatchOf(k)}${STRUCTURE_NAME[k]}${cost(`§${fmt(STRUCTURES[k].cost)}`)}</button>`).join('')
        + (lineTool ? `<button type="button" data-alt-tool="${lineTool.id}" title="${attr(`${toolName(lineTool)} · ${toolPrice(lineTool)}`)}">${toolGlyph(lineTool)}${lineTool.label}${cost(toolPrice(lineTool))}</button>` : '');
    }
  } else if (tool.id !== 'query') {
    const g = TOOL_GROUPS.find((x) => x.tools.includes(tool));
    // Removal tools stay in the tray: one stray click there undoes a whole line.
    const sibs = g && g.cat !== 'inspect' ? g.tools.filter((t) => t.kind !== 'structure' && usable(t) && t.kind !== 'unpipe' && t.kind !== 'unsubway' && (!MORE.has(t.id) || t.id === tool.id)) : []; // (the tray's folded ones stay there, as the tray shows them)
    if (sibs.length > 1) {
      html = sibs.map((t) => {
        const key = Object.entries(TOOL_KEYS).find(([, id]) => id === t.id)?.[0];
        return `<button type="button" class="${t.id === tool.id ? 'active' : ''}" data-alt-tool="${t.id}" aria-pressed="${t.id === tool.id}"
          title="${attr(`${toolName(t)}${key ? ` (${key.toUpperCase()})` : ''}${toolPrice(t) ? ` · ${toolPrice(t)}` : ''}`)}">${toolGlyph(t)}${t.label}${cost(priceOf(t))}</button>`;
      }).join('');
    }
    // A line or pipe leads back to the plant or pump it serves (the kind last chosen).
    const back = ({ powerline: 'power', pipe: 'water' } as Record<string, string>)[tool.id];
    if (back && city.isUnlocked(chosen[back]!)) {
      const k = chosen[back]!;
      html = (html || `<button type="button" class="active" data-alt-tool="${tool.id}" aria-pressed="true">${toolGlyph(tool)}${tool.label}</button>`)
        + `<button type="button" data-alt-tool="${back}" title="${attr(`${STRUCTURE_NAME[k]} · §${fmt(STRUCTURES[k].cost)}`)}">${swatchOf(k)}${STRUCTURE_NAME[k]}${cost(`§${fmt(STRUCTURES[k].cost)}`)}</button>`;
    }
  }
  if (row.dataset.html !== html) {
    row.dataset.html = html;
    row.innerHTML = html;
    row.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  row.hidden = !html;
  edgeAlts();
}

/** A row cut off at an edge fades there (a narrow screen scrolls the rest into view). */
export function edgeFade(row: HTMLElement): void {
  row.classList.toggle('more-right', row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
  row.classList.toggle('more-left', row.scrollLeft > 2);
}
const edgeAlts = () => edgeFade($('#tool-alts'));

/** Tools that look or act on the running city (time keeps going for them); the rest build or clear. */
const WATCHING = new Set(['query', 'route', 'mic', 'dispatch', 'disaster', 'throw']);

/** Counts tool picks (a tool handed out by a suggestion is its job only until another is picked). */
export let toolPicks = 0;

export function selectTool(id: string): void {
  sawSuggestion(null, id);
  toolPicks++;
  cancelMySimAction(); // the map click goes to the new tool
  endFlash(); // the last tool's message gives way to this one's hints
  const before = tool;
  tool = TOOLS.find((t) => t.id === id) ?? TOOLS[0]!;
  if (before && before.id !== tool.id) {
    previousTool = before.id;
    setDrag(null); // a start set with the old tool (a keyboard build's) isn't the new one's
    renderer.cursor = null;
  }
  // A drawing tool needs the map: the info card (a third of it on desktop) steps aside.
  if (tool.kind !== 'query' && tool.kind !== 'route' && tool.kind !== 'mic') closeInfo();
  document.getElementById('view')?.classList.toggle('holding', tool.kind !== 'query' && tool.kind !== 'route' && tool.kind !== 'mic');
  const cat = categoryOf(tool.id);
  // A tool of another category (a key, a goal's button) puts away a card that shows something else.
  if (openCat && ((openCat !== cat && tool.id !== 'query') || (tool.id === 'query' && $('#tray').classList.contains('from-bar')))) closeTray(); // (the bar's card goes with the tool put down)
  lastTool[cat] = tool.id;
  if (BUILD_CATS.includes(cat)) lastBuildCat = cat;
  document.querySelectorAll<HTMLElement>('#tools .picker[data-tool]').forEach((p) => markPicked(p));
  document.querySelectorAll<HTMLButtonElement>('#tools button[data-tool]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tool === tool.id);
    b.setAttribute('aria-pressed', String(b.dataset.tool === tool.id));
  });
  // The dock marks the category in use; the chip on the map names the tool (none for 조회).
  document.querySelectorAll<HTMLButtonElement>('#dock-tools [data-cat], #tray-cats [data-cat]').forEach((b) =>
    b.classList.toggle('current', b.dataset.cat === cat));
  document.querySelectorAll('#dock-tools [data-cat="bulldoze"], #tray-cats [data-cat="bulldoze"]').forEach((b) => b.setAttribute('aria-pressed', String(tool.id === 'bulldoze')));
  // Building or clearing: time waits while it is planned (and runs on when the tool is put down).
  holdForBuilding(!WATCHING.has(tool.kind));
  refreshToolChip();
  renderer.canvas.style.cursor = 'crosshair';
  setPreview(null);
  updatePreview(); // the new tool's hint and preview where the pointer already is
  if (tool.kind !== 'query' && tool.kind !== 'route') renderer.routes = null; // (looking: the open card's routes stay drawn)
  refreshEdgeHint();
  // Pipes, track underground and power lines are laid where the map doesn't
  // show them, and a facility where its service is missing: their view comes on
  // with the tool and goes with it.
  // Touch: once, how to look around while a drawing tool is in hand (one finger draws).
  if (touchFirst() && DRAWING.has(tool.kind)) {
    try {
      if (!localStorage.getItem(PAN_TIP_KEY)) {
        localStorage.setItem(PAN_TIP_KEY, '1');
        flash(`도구를 든 동안 한 손가락은 그립니다 · 지도 이동은 두 손가락으로${isHeld() ? ' · 짓는 동안 시간은 잠시 멈춥니다' : ''}`, 'info'); // (it takes the hold's own tip's place)
        panTipAt = performance.now();
      }
    } catch { /* storage unavailable */ }
  }
  const view = toolView();
  // (The view as the screen names it — 'volume:road', not the overlay's 'volume', which named no view to come back to.)
  const current = document.querySelector<HTMLSelectElement>('#overlay-kind')?.value;
  // Underground work is seen in its view whatever view was on (laid under the traffic view, pipes stayed unseen); put
  // down, the view the map rests on comes back: the open screen's tab's, else none.
  if (current === undefined) autoView = null; // (the first tool, at the start, comes before the views are built)
  else if (view && current !== view) {
    showOverlay(view);
    autoView = view;
  } else if (autoView && autoView !== view && current === autoView) {
    showOverlay(baseView());
    autoView = null;
  } else if (!view) autoView = null;
  markToolSite(); // (a station in hand: where it fills the biggest gap)
  redraw();
}

const PAN_TIP_KEY = 'web-city:pan-tip';
/** When the one-finger tip was last shown (a tip given with it needn't say it again). */
export let panTipAt = -Infinity;
/** Tools a one-finger drag draws with (so it doesn't pan the map). */
const DRAWING = new Set<Tool['kind']>(['network', 'zone', 'bulldoze', 'powerline', 'pipe', 'unpipe', 'subway', 'unsubway', 'elevated', 'trees', 'terraform', 'level']);

/** The data view a tool turns on while it is in hand (what it builds is otherwise hidden). */
const UNDERGROUND_VIEW: Partial<Record<Tool['kind'], string>> = {
  pipe: 'waterService', unpipe: 'waterService', subway: 'subway', unsubway: 'subway', transition: 'subway', powerline: 'power',
};
/** A facility is placed where it is missing: its reach comes on with it (the gaps show where to put it). */
const PLACING_VIEW: Record<string, string> = {
  police: 'police', fire: 'fire', health: 'health', education: 'school', power: 'power', water: 'waterService', garbage: 'garbage', landfill: 'garbage',
};
/** The view a tool turned on itself (turned off again when another tool is picked). */
let autoView: string | null = null;

/** The view the tool in hand turns on, if any. */
const toolView = (): string | null => UNDERGROUND_VIEW[tool.kind] ?? PLACING_VIEW[tool.id] ?? null;

/** The map's view with no tool's to hold: the tool in hand's own, else the one the map rests on (baseView). */
export function restView(): void {
  const view = toolView();
  showOverlay(view ?? baseView());
  autoView = view;
}

// ------------------------------------------------------------------ finding a tool

/** What the search box can find: every tool, every kind of facility (by its own name), and the screens (by what they hold). */
type Found = { key: string; name: string; where: string; glyph: string; sub: string; cost?: number; month?: string; gain?: boolean; locked: string; pick: () => void; words?: string; aside?: true };

/**
 * Everyday words a tool or facility answers to besides its name: 물 found 물 파기 and 박물관 but no pump, 전기 only
 * 풍력 발전기, and 집·공장·상가·다리 nothing at all.
 */
function wordsFor(t: Tool, d?: (typeof STRUCTURES)[StructureKind]): string {
  if (d) return d.pump || d.category === 'water' ? '물 수도 급수' : d.plant ? '전기 전력' : d.incinerator || d.recycling ? '쓰레기' : d.police ? '경찰 범죄 치안'
    : d.fire ? '불 화재 소방' : d.health ? '병원 건강 보건' : d.school ? '학교 교육' : d.category === 'park' ? '공원 녹지 놀이터' : d.station ? '대중교통 정류장 역' : '';
  if (t.kind === 'zone') return t.zone[0] === 'R' ? '집 주택 아파트 주거' : t.zone[0] === 'C' ? '상가 가게 상점 사무실 상업' : t.zone[0] === 'I' ? '공장 산업 일자리' : t.zone === 'A' ? '농장 농사 밭' : t.zone === 'landfill' ? '쓰레기' : '';
  if (t.kind === 'pipe') return '물 수도';
  if (t.kind === 'bulldoze') return '구역 해제 해제 헐기 부수기 허물기 잔해'; // (구역 해제 is a drag of it now: it is found under its old name)
  if (t.kind === 'powerline') return '전기 전력 전선';
  if (t.kind === 'network' && (t.network === 'road' || t.network === 'street' || t.network === 'avenue' || t.network === 'highway')) return '다리 길 차';
  return '';
}

/**
 * The words that find each screen: what is done or read there. Typed 세율 or 대출, the box offered no tool and
 * said nothing; now 재정 comes up.
 */
const SCREEN_WORDS: Record<GoalId, string> = {
  finance: '세율 세금 예산 부서 대출 빚 조례 수입 지출 자금 돈 결산 재정 정책', growth: '수요 재개발 상한 소득별 종류별',
  amenity: '쾌적도 시장평점 평점 여론 불만 공원 부유층 고급 보상 랜드마크 관광',
  power: '전기 발전 정전 송전', water: '물 급수 단수 펌프 수도관 정수 수질', garbage: '쓰레기 매립 소각 재활용 수거 청결',
  police: '범죄 경찰 교도소 감방 폭동 체포', fire: '화재 불 소방차 출동', health: '건강 병원 수명 HQ 보건소',
  education: '학교 교육지수 EQ 대학 도서관', traffic: '통근 혼잡 대중교통 버스 지하철 철도 정류장',
  environment: '오염 공기 대기 연기 스모그 방사능', land: '땅값 물가 고지대 부유층',
};

/**
 * The screens the box finds besides tools: the city's own (its residents), each goal's, 지역, and the help. (Not 주민:
 * off the web screen for now.)
 */
function screens(): Found[] {
  const out: Found[] = [{ key: 'screen:city', name: '인구', where: '도시 화면 (G)', glyph: icon('trophy'), sub: '', locked: '',
    words: '인구 주민 일자리 실업 일하는 소득별 나이 보상 건물 버려진 빈구역 개발막힘 도시 단계', pick: () => openCity() }];
  out.push(...GOAL_ORDER.map((id) => ({
    key: `screen:${id}`, name: GOALS[id].name, where: '관리 화면', glyph: icon(GOALS[id].icon), sub: '', locked: '',
    words: SCREEN_WORDS[id], pick: () => openGoal(id),
  })));
  out.push(
    { key: 'screen:region', name: '지역', where: '화면 (J)', glyph: icon('globe'), sub: '', locked: '', words: '이웃 도시 거래 사고팔기 심네이션', pick: () => showTab('region') },
    { key: 'screen:help', name: '조작법', where: '도움말 (?)', glyph: icon('help'), sub: '', locked: '', words: '도움말 단축키 키보드 사용법', pick: () => showHelp() },
  );
  return out;
}

function findables(): Found[] {
  const out: Found[] = [];
  for (const g of TOOL_GROUPS) {
    const cat = CATEGORIES.find((c) => c.id === g.cat)!;
    for (const t of g.tools) {
      if (t.kind === 'structure') {
        for (const k of kindsFor(t)) {
          const d = STRUCTURES[k];
          const open = city.isUnlocked(k);
          const placed = open && city.placementsLeft(k) <= 0;
          const earned = city.state.unlocked.filter((u) => u === k).length;
          const why = plainCodes(d.unlock?.description ?? d.unlockTiers?.[earned]?.description ?? d.offer?.description ?? '잠김');
          out.push({
            key: `${t.id}:${k}`, name: STRUCTURE_NAME[k], where: `${cat.label} · ${g.title}`, words: wordsFor(t, d),
            glyph: swatchOf(k),
            sub: d.cost ? `§${fmt(d.cost)}` : '무료', cost: d.cost, ...kindMonthly(k),
            locked: !open ? why : placed ? '이미 지음' : '',
            pick: () => {
              chosen[t.id] = k;
              selectTool(t.id);
            },
          });
        }
      } else {
        // (Terrain and disasters are listed after the rest: Enter on 물 dug a lake.)
        // (철거 and 조회 are their categories' only tools: "철거 · 철거" said nothing.)
        const where = t.kind === 'bulldoze' ? '끌어서 헐기 · 빈 구역은 해제' : cat.label === g.title ? cat.label : `${cat.label} · ${g.title}`;
        out.push({ key: t.id, name: toolName(t), where, words: wordsFor(t), glyph: toolGlyph(t), sub: t.kind === 'terraform' && !city.established() ? '무료' : toolPrice(t) || actPrice(t), cost: t.kind === 'terraform' && !city.established() ? 0 : toolCost(t)?.cost, month: toolMonthly(t), locked: usable(t) ? '' : '잠김', pick: () => selectTool(t.id),
          ...(t.kind === 'terraform' || t.kind === 'disaster' || t.kind === 'level' || t.kind === 'trees' ? { aside: true as const } : {}) });
      }
    }
  }
  return out;
}

/** The tools and kinds picked lately, newest first (a few, kept for the next visit). */
const RECENT_KEY = 'web-city:recent-tools';
let recent: string[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
})();

function noteRecent(t: Tool): void {
  if (t.kind === 'query' || t.kind === 'route' || t.kind === 'mic' || t.kind === 'disaster') return;
  const key = t.kind === 'structure' ? `${t.id}:${chosen[t.id]}` : t.id;
  if (recent[0] === key) return;
  recent = [key, ...recent.filter((k) => k !== key)].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch { /* storage unavailable */ }
  if (!$('#tray').hidden) renderRecent();
}

/** The tool card's row again while it is open: the screen's tools in it change with the screen and its tab. */
export function refreshRecent(): void {
  if (!$('#tray').hidden) renderRecent();
}

/** The current pick's key, to mark it among the found and the recent. */
const currentKey = () => (tool.kind === 'structure' ? `${tool.id}:${chosen[tool.id]}` : tool.id);

function renderRecent(): void {
  const all = new Map(findables().map((f) => [f.key, f]));
  const chips = (list: Found[]) => list.map((f) => `<button type="button" data-find="${attr(f.key)}" class="${f.key === currentKey() ? 'active' : ''}" title="${attr(`${f.name} · ${f.where}${f.sub ? ` · ${f.sub}` : ''}${f.month ? ` · ${f.month}` : ''}`)}">${f.glyph}${f.name}</button>`).join('');
  // (Not the tool in hand, nor those already on the open card: a row of 최근 [도로] above 도로 said nothing.)
  const items = recent.map((k) => all.get(k)).filter((f): f is Found => !!f && !f.locked && f.key !== currentKey() && categoryOf(f.key.split(':')[0]!) !== openCat);
  // While a goal's screen is open, its tools lead (whatever category the tray shows) — but not those on the open
  // card already: with 교통's screen open, the 교통 card began with a row of the very tiles under it.
  const goal = goalTools();
  const mine = goal ? goal.keys.flatMap((k) => (k.includes(':') ? [k] : [...all.keys()].filter((x) => x === k || x.startsWith(`${k}:`))))
    .map((k) => all.get(k)).filter((f): f is Found => !!f && !f.locked && categoryOf(f.key.split(':')[0]!) !== openCat) : [];
  const row = $('#tray-recent');
  row.hidden = items.length + mine.length === 0;
  row.innerHTML = (mine.length ? `<span class="recent-label goal-label">${goal!.name} 화면</span>${chips(mine)}${items.length ? '<i class="recent-sep"></i>' : ''}` : '')
    + (items.length ? `<span class="recent-label">최근</span>${chips(items)}` : '');
  row.scrollLeft = 0;
  edgeFade(row);
}

let found: Found[] = [];

function renderFound(q: string): void {
  const res = $('#tray-results');
  const query = q.trim().toLowerCase().replace(/\s+/g, '');
  $('#tools').hidden = !!query;
  res.hidden = !query;
  // The title says what the tray now shows: the search, or the category again.
  const c = CATEGORIES.find((x) => x.id === openCat);
  if (!query) {
    if (c) $('#tray-title').innerHTML = `${icon(c.icon)}${c.label}`;
    return;
  }
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  // Typed as initial consonants only (ㅅㅂㅅ), it matches names by theirs (소방서).
  const initials = /^[ㄱ-ㅎ]+$/.test(query);
  const key = (v: string) => (initials ? chosung(norm(v)) : norm(v));
  // A name that starts with it first, then a word it answers to (물 finds the pumps, 세율 finds 재정), then a
  // name with it inside (발전기 has 전기 in it), then where it sits (발전 finds the plants; 서비스 the services).
  // Terrain and disasters after all the rest, and the locked after the open.
  const tier = (f: Found, at: number) => (at === 0 ? 0 : !initials && (f.words ?? '').split(' ').some((w) => norm(w).startsWith(query)) ? 1
    : at > 0 ? 2 + at / 100 : !initials && (key(f.where).includes(query) || norm(f.words ?? '').includes(query)) ? 3 : -1);
  found = [...findables(), ...screens()]
    .map((f) => ({ f, t: tier(f, key(f.name).indexOf(query)) }))
    .filter((x) => x.t >= 0)
    .sort((a, b) => +!!a.f.aside - +!!b.f.aside || a.t - b.t || +!!a.f.locked - +!!b.f.locked)
    .map((x) => x.f);
  $('#tray-title').innerHTML = `${icon('search')}찾기 · ${found.length}개`;
  res.innerHTML = found.length
    ? found.map((f, i) => `<button type="button" class="tile${f.locked ? ' locked' : ''}${i === 0 && !f.locked ? ' first' : ''}" role="option" data-find="${attr(f.key)}" ${f.locked ? 'disabled' : ''} title="${attr(`${f.name} · ${f.where}${f.sub ? ` · ${f.sub}` : ''}${f.month ? ` · ${f.month}` : ''}${f.locked ? ` — ${f.locked}` : ''}`)}">${tileHtml({
        glyph: f.locked ? icon('lock') : f.glyph, name: f.name, stat: f.locked || f.where, now: f.locked ? '' : f.sub, month: f.locked ? '' : f.month, gain: f.gain,
        short: !f.locked && !!f.cost && f.cost > city.state.funds })}</button>`).join('')
    : `<p class="legend find-none">'${q.trim().replace(/[<&]/g, '')}'${'에 맞는 도구가 없습니다'}</p>`;
}

const CHOSUNG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** A word's initial consonants (소방서 → ㅅㅂㅅ); other characters stay as they are. */
function chosung(v: string): string {
  return [...v].map((ch) => {
    const c = ch.charCodeAt(0) - 0xac00;
    return c >= 0 && c < 11172 ? CHOSUNG[Math.floor(c / 588)]! : ch;
  }).join('');
}

function clearFind(): void {
  const input = $<HTMLInputElement>('#tray-search');
  input.value = '';
  renderFound('');
  renderRecent();
}

function pickFound(key: string): void {
  const f = [...findables(), ...screens()].find((x) => x.key === key);
  if (!f || f.locked) return;
  // (A screen is no tool: the card is put away first, as by its ×.)
  if (f.key.startsWith('screen:')) closeTray(true);
  f.pick();
  closeTray();
  hoverUnderMouse();
}

function wireFind(): void {
  const input = $<HTMLInputElement>('#tray-search');
  input.addEventListener('input', () => renderFound(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = found.find((f) => !f.locked);
      if (input.value.trim() && first) pickFound(first.key);
      e.preventDefault();
    } else if (e.key === 'ArrowDown' && input.value.trim()) {
      document.querySelector<HTMLButtonElement>('#tray-results .tile:not([disabled])')?.focus();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      // The first Esc empties the box; the next closes the tray (the page's own keys skip a text box).
      if (input.value) clearFind();
      else closeTray(true);
      e.stopPropagation();
    }
  });
  // Arrows step through what was found; up from the first goes back to the box.
  $('#tray-results').addEventListener('keydown', (e) => {
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) return;
    const items = [...document.querySelectorAll<HTMLButtonElement>('#tray-results .tile:not([disabled])')];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const to = at + (k === 'ArrowRight' || k === 'ArrowDown' ? 1 : -1);
    if (to < 0) input.focus();
    else items[Math.min(to, items.length - 1)]?.focus();
    e.preventDefault();
    e.stopPropagation();
  });
  for (const id of ['#tray-results', '#tray-recent']) {
    $(id).addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-find]');
      if (b && !b.disabled) pickFound(b.dataset.find!);
    });
  }
}

/** The / key: the tray opens with the search box ready. */
export function openFind(): void {
  if (!openCat) openTray(lastBuildCat);
  $<HTMLInputElement>('#tray-search').focus();
}

/** , and .: the previous or next of the tool's siblings under the chip (another road, density, kind). */
export function stepAlt(dir: 1 | -1): void {
  const items = [...document.querySelectorAll<HTMLButtonElement>('#tool-alts button')];
  if ($('#tool-alts').hidden || items.length < 2) return;
  const at = items.findIndex((b) => b.classList.contains('active'));
  // (A kind not in the row — a built-once reward just built — steps to either end.)
  items[at < 0 ? (dir > 0 ? 0 : items.length - 1) : (at + dir + items.length) % items.length]!.click();
  hoverUnderMouse();
}

/** The dock's categories holding a 추천: a small dot (where a short service's answer is, without saying more). */
export function markSuggested(): void {
  // One dot at a time: the category of the one next step (what the most troubled goal's screen recommends) (more dots said nothing).
  const act = firstStepTool ?? (city ? nextStep().act : '');
  // Not once the player has looked (its category opened, or its tool picked) until the next step is another: there is
  // always a next step, and a dot always on read as unread, and went unread.
  if (act !== seen.act) seen = { act: '', city: -1 }; // (a step come back after another is news again)
  shownAct = act && categoryOf(act) !== 'inspect' && !(seen.act === act && seen.city === cityLineage) ? act : '';
  const cats = new Set(shownAct ? [categoryOf(shownAct)] : []);
  document.querySelectorAll<HTMLElement>('#dock-tools [data-cat], #tray-cats [data-cat]').forEach((b) => {
    const on = cats.has(b.dataset.cat as CategoryId);
    if (b.classList.contains('suggest') === on) return;
    b.classList.toggle('suggest', on);
    // (Said in words too, for a tooltip and a screen reader.)
    b.dataset.title0 ??= b.title;
    b.title = on ? `${b.dataset.title0} · ${SUGGEST_NOTE}` : b.dataset.title0;
  });
}

/**
 * A road in hand on a town with no way to its neighbours yet: the map's edge is outlined (see renderer.edgeHint).
 * (A road or an avenue: a street or a one-way at the edge links nothing, and a highway needs its ramps besides.)
 */
export function refreshEdgeHint(): void {
  const on = tool.kind === 'network' && (tool.network === 'road' || tool.network === 'avenue') && !roadLinked();
  // (In a region, only the stretches a city lies across: the whole edge was outlined, and a road to the rest joined
  // nobody.)
  const spans = on ? cityEdges() : null;
  if (on !== renderer.edgeHint || JSON.stringify(spans) !== JSON.stringify(renderer.edgeSpans)) {
    renderer.edgeHint = on;
    renderer.edgeSpans = spans;
    redraw();
  }
}
