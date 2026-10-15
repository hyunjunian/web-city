// Map input: pointer and keyboard handling, tool previews and applying tools.

import { active as activeGoal, closeGoal, handedPlaced, noteAction, stepTab, toggleFinance, toggleGrowthTab, toggleUrgentGoal } from './manage';
import { DEV_TYPES, GROWTH_CODES, isLocalNet, Net, linePath, type Rect, LIVE_KINDS, NETWORK_KINDS, STRUCTURES, Terrain, ZONES, type StructureKind } from '@web-city/engine';
import { chooseSpeed, closeClock, isHeld, resumeAfterBuilding, runningSpeed, showHelp, speedChosen, toggleNight } from './controls';
import { aloneReached, cancelGlide, keepInView, showInfo, showRoutes } from './info';
import { grabDisaster, setSteering, steering } from './live';
import { ko } from './messages';
import { interviewAt, mySimAction, mySimClick } from './mysims';
import { ABANDON_NAME, DISASTER_NAME, NETWORK_NAME, STRUCTURE_NAME, TYPE_NAME, ZONE_NAME } from './names';
import { updatePanels } from './panels';
import { type Preview, zoneTint } from './render';
import { coverageRadius, GROWTH_LABEL, growthNow, overlayReading } from './views';
import { facilityLine, newlyReached, plantsReached, roadLinked, smokeClear, subwayAlone, subwayGap } from './readings';
import { goalOfStructure } from './goals';
import { cam, centerOn, city, drag, fitCamera, glideTo, hover, mapBand, overlay, redraw, renderer, selected, setDrag, setHover, speed, stopFlight } from './state';
import { drive, SPECIAL } from './udi';
import { closeTopLayer, dismissPane, paneShown, toggleSheet } from './tabs';
import { chosen, closeTray, openFind, previousTool, stepAlt, refreshToolChip, selectTool, STATION_HINT, tool, TOOL_KEYS, toolName, toolUsed, refreshEdgeHint } from './tools';
import { $, ask, askText, escapeHtml, keyForControl, onHintRestore, flash, flashing, fmt, josa, touchFirst, flashYields, endFlash } from './util';

/** What each cheat did, for the toast. */
const CHEAT_DONE: Record<string, string> = {
  rewards: '모든 보상 건물을 지을 수 있습니다',
  powerOff: '이제 건물에 전력이 없어도 됩니다',
  powerOn: '건물에 다시 전력이 필요합니다',
  waterOff: '이제 건물에 물이 없어도 됩니다',
  waterOn: '건물에 다시 물이 필요합니다',
  funds: '§1,000을 받았습니다',
  rename: '도시 이름을 바꿨습니다',
};

export let preview: Preview | null = null;

/**
 * Touch screens: a facility tapped onto the map waits here, drawn in place
 * with its cost and warnings, until 짓기 (or a second tap on the spot); a
 * lifted finger alone never spends money on a §10,000 plant.
 */
let proposal: { kind: StructureKind; at: [number, number] } | null = null;
/** 짓기 is being pressed: the build the proposal waits for. */
let confirming = false;

/** Moves the map so a proposed facility isn't under the confirm bar that asks about it. */
function clearOfBar(kind: StructureKind, x: number, y: number): void {
  const bar = $('#confirm-bar');
  if (bar.hidden) return;
  const [, sy] = footprintAt(kind, [x, y]);
  const v = renderer.canvas.getBoundingClientRect();
  const bottom = v.top + (sy + STRUCTURES[kind].h - cam.y) * cam.scale;
  const top = bar.getBoundingClientRect().top - 12;
  if (bottom <= top) return;
  cam.y += (bottom - top) / cam.scale + 1;
  redraw();
}

function dropProposal(): void {
  proposal = null;
  $('#confirm-bar').hidden = true;
}

export function rectTiles(a: [number, number], b: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  const n = city.size;
  for (let y = Math.max(0, Math.min(a[1], b[1])); y <= Math.min(n - 1, Math.max(a[1], b[1])); y++) {
    for (let x = Math.max(0, Math.min(a[0], b[0])); x <= Math.min(n - 1, Math.max(a[0], b[0])); x++) out.push([x, y]);
  }
  return out;
}


/** The building or facility on a tile (its whole lot), or the tile itself. */
function lotAt(x: number, y: number): Rect {
  const s = city.state;
  const occ = x >= 0 && y >= 0 && x < s.size && y < s.size ? s.occupant[y * s.size + x]! : 0;
  const r = occ > 0 ? s.buildings.get(occ) : occ < 0 ? s.structures.get(-occ) : undefined;
  return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : { x, y, w: 1, h: 1 };
}

/** One line about the tile under the pointer: building, facility, road or bare land. */
/** An onramp that doesn't reach both a highway and a local road joins nothing (it was built silently). */
function rampWarning(tiles: [number, number][]): string {
  const s = city.state;
  const n = s.size;
  let highway = false;
  let local = false;
  for (const [x, y] of tiles) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const i = yy * n + xx;
      const kind = NETWORK_KINDS[s.net[i]!];
      if (kind === 'highway' || s.elevated[i] === 3) highway = true; // (1 and 2 are elevated rail and monorail)
      if (s.net[i] && isLocalNet(s.net[i]!)) local = true; // a road under an elevated highway is both
    }
  }
  return highway && local ? '' : ` · ⚠ ${highway ? '일반 도로' : local ? '고속도로' : '고속도로와 일반 도로'}에 닿지 않아 아무것도 잇지 못함`;
}

const plain0 = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
/** Wide: the city pane is beside the map, not a sheet over it (the stylesheet's own test). */
const wideScreen = () => !matchMedia('(max-width: 860px)').matches;

/** Zone tools a zone key steps through when pressed again. */
const DENSITY_CYCLE = [['R-low', 'R-medium', 'R-high'], ['C-low', 'C-medium', 'C-high'], ['I-medium', 'I-high', 'A']];

export function describeTile(x: number, y: number): string {
  const s = city.state;
  const i = y * s.size + x;
  if (x < 0 || y < 0 || x >= s.size || y >= s.size) return '';
  const occ = s.occupant[i]!;
  const name = s.names[occ] ? `「${s.names[occ]}」 ` : '';
  if (occ > 0) {
    const b = s.buildings.get(occ);
    if (b) {
      if (!b.type) return `${name}버려진 건물${b.abandonReason ? ` (${ABANDON_NAME[b.abandonReason]})` : ''}`;
      const problems = [!b.powered && '⚠ 전기 없음', !b.watered && b.stage > city.cfg.services.waterStageCap[b.type] && '⚠ 물 없음', b.historical && '역사 건물'] // (⚠: the chip is edged amber)
        .filter(Boolean).join(' · ');
      return `${name}${TYPE_NAME[b.type]} ${b.stage}단계 · ${b.type[0] === 'R' ? '주민' : '일자리'} ${fmt(Math.round(b.capacity * b.occupancy))}명 (${Math.round(b.occupancy * 100)}%)${problems ? ` · ${problems}` : ''}`;
    }
  }
  if (occ < 0) {
    const st = s.structures.get(-occ);
    // Its name and how it is doing (the goal screen's line: a plant's output and life, a school's pupils…).
    if (st) {
      const [line, tone] = facilityLine(st);
      return `${name}${STRUCTURE_NAME[st.kind]}${line ? ` · ${tone === 'bad' ? '⚠ ' : ''}${line}` : ''}${st.funding !== 100 && STRUCTURES[st.kind].category !== 'garbage' ? ` · 예산 ${st.funding}%` : ''}`;
    }
  }
  const net = s.net[i]!;
  if (net) {
    const kind = NETWORK_KINDS[net];
    const label = kind ? NETWORK_NAME[kind] : NETWORK_NAME.crossing;
    // Rail carries trains (its own tally); roads and crossings their cars.
    const flow = net === Net.Rail ? city.fields.railTraffic[i]! : city.fields.traffic[i]!;
    // Against its capacity (the info card's meter): only said when it is filling up.
    const cap = kind ? city.cfg.transport.speed[kind]?.capacity : undefined;
    const load = cap ? flow / cap : 0;
    const busy = load > 1 ? ` · ⚠ 막힘 ${Math.round(load * 100)}%` : load > 0.7 ? ` · 붐빔 ${Math.round(load * 100)}%` : '';
    // The ringed "!" on it: a pileup or a derailment this month (the mark said nothing of itself).
    const inc = s.incidents.find((e) => e.i === i);
    const crash = inc ? (inc.kind === 'pileup' ? ' · ⚠ 교통사고 (붐비는 교차로에서 남)' : ' · ⚠ 탈선 (손상된 선로: 대중교통 예산을 100% 넘게 올리면 고쳐짐)') : '';
    return `${label} · 하루 통행 ${fmt(flow)}${busy}${crash}${s.terrain[i] === Terrain.Water ? ' · 다리' : ''}`;
  }
  if (s.terrain[i] === Terrain.Water) return '물';
  const zone = ZONE_NAME[ZONES[s.zone[i]!]!];
  // An empty lot of a zone: what keeps it empty (the info card says more), rather than its height.
  if (zone && ZONES[s.zone[i]!] === 'landfill') return `${zone} · ${s.landfill[i] ? `${fmt(Math.round(s.landfill[i]!))} / ${fmt(city.cfg.garbage.landfill.tileCapacity)} t 찼음` : '비어 있음'}`;
  if (zone) {
    // (From the growth map as last worked out: asking the engine mid-day finished the day inside the pointer's move.)
    const code = growthNow(city)?.[i] ?? 0;
    const why = code ? `${GROWTH_CODES[code - 1] === 'waiting' ? '' : '⚠ '}${GROWTH_LABEL[GROWTH_CODES[code - 1]!]}` : ''; // (held back: the chip is edged amber)
    return `${zone} · 빈 구역${why ? ` · ${why}` : ''}`;
  }
  // (What lies on bare ground, as its card says: a wood, rubble, a disaster's scar — all read "빈 땅".)
  const lf = s.landform[i];
  const ground = s.rubble[i] ? '잔해 · 철거 도구로 치움' : lf === 2 ? '화산 원뿔 · 평탄화 전에는 지을 수 없음' : lf === 3 ? '용암 비탈 · 구역은 저밀도만'
    : lf === 1 ? '운석 구덩이' : lf === 4 ? '단층' : s.trees[i] ? '숲' : '빈 땅';
  return `${ground} · 고도 ${s.height[i]} m · ${x}, ${y}`;
}

/** How much a zone's class is wanted now (its strongest type's demand; farms for 농업). */
function zoneWant(zone: string): number {
  const types = DEV_TYPES.filter((t) => (zone === 'A' ? t === 'IA' : t[0] === zone[0] && t !== 'IA'));
  return types.length ? Math.max(...types.map((t) => city.demand.demand[t])) : 0;
}

/** Whether a road or other street-level network touches a rectangle or runs through it. */
function roadNear(a: [number, number], b: [number, number]): boolean {
  const n = city.size;
  const net = city.state.net;
  for (let y = Math.max(0, Math.min(a[1], b[1]) - 1); y <= Math.min(n - 1, Math.max(a[1], b[1]) + 1); y++) {
    for (let x = Math.max(0, Math.min(a[0], b[0]) - 1); x <= Math.min(n - 1, Math.max(a[0], b[0]) + 1); x++) {
      if (isLocalNet(net[y * n + x]!)) return true;
    }
  }
  return false;
}

/** Whether power reaches within 4 tiles of a rectangle (zones pass it on that far). */
function powerNear(a: [number, number], b: [number, number]): boolean {
  const n = city.size;
  const powered = city.fields.powered;
  for (let y = Math.max(0, Math.min(a[1], b[1]) - 4); y <= Math.min(n - 1, Math.max(a[1], b[1]) + 4); y++) {
    for (let x = Math.max(0, Math.min(a[0], b[0]) - 4); x <= Math.min(n - 1, Math.max(a[0], b[0]) + 4); x++) {
      if (powered[y * n + x]) return true;
    }
  }
  return false;
}

/** Removing pipes or subway in a rectangle: only the tiles that have them count (and cost). */
function removal(tiles: [number, number][], layer: Uint8Array, unit: number, what: string): string {
  const n = tiles.filter(([x, y]) => layer[y * city.size + x]).length;
  return n ? `${what} 철거 ${n}칸 §${fmt(n * unit)}` : `여기에는 ${what}${josa(what, '이', '가')} 없습니다`;
}

/** The fire tool's hint, and over a fire whether units are on it (a truck sent where nothing burns is refused). */
function fireHint(hx: number, hy: number): string {
  const base = '가까운 소방서에서 소방차를 보냅니다(도로에서 8칸 안). 소방 비행장은 비행기도 보냅니다.';
  const s = city.state;
  if (hx < 0 || hy < 0 || hx >= city.size || hy >= city.size) return base;
  const here = hy * city.size + hx;
  const occ = s.occupant[here] ?? 0;
  const burning = (occ !== 0 && s.fires.some((f) => f.target === occ)) || s.treeFires.some((t) => t.i === here);
  if (!burning) return s.fires.length || s.treeFires.length ? `${base} 불난 곳을 누르세요.` : base;
  const near = s.units.filter((u) => u.kind === 'fire' && Math.hypot(u.x - hx, u.y - hy) <= city.cfg.safety.dispatch.fire.radius);
  const there = near.filter((u) => u.travel <= 0).length;
  const coming = near.length - there;
  return `불 · 소방 ${there}대 현장${coming ? `, ${coming}대 가는 중` : ''} · 남은 차량 ${city.freeUnits('fire')}대 · 눌러서 출동`;
}

/** The police tool's hint, and over a riot how many cars it has against the three it takes (stepMobs). */
function policeHint(hx: number, hy: number): string {
  const base = '가까운 경찰서에서 경찰차를 보냅니다. 범죄와 폭동을 막고 3일간 머뭅니다.';
  const r = riotCars(hx, hy);
  if (!r) return base;
  return `폭동 ${r.stage}단계 · 경찰차 ${r.there}대 현장${r.cars > r.there ? `, ${r.cars - r.there}대 가는 중` : ''} / ${r.need}대 이상 필요 · 남은 차량 ${city.freeUnits('police')}대`;
}

/** A riot at or next to (x, y): the police cars there or on the way (as stepMobs counts them), and the three it takes. */
function riotCars(x: number, y: number): { stage: number; cars: number; there: number; need: number } | undefined {
  const s = city.state;
  const mob = s.mobs.find((m) => Math.max(Math.abs(m.x - x), Math.abs(m.y - y)) <= 1);
  if (!mob) return undefined;
  const near = s.units.filter((u) => u.kind === 'police' && Math.hypot(u.x - mob.x, u.y - mob.y) <= city.cfg.safety.dispatch.police.radius + 1);
  return { stage: mob.stage, cars: near.length, there: near.filter((u) => u.travel <= 0).length, need: city.cfg.mayor.riotMob.minUnits };
}

export function updatePreview(): void {
  // A message keeps the hint bar for its time, unless a drag needs it for the cost.
  // With a mouse, the reading goes by the tile the pointer is on (the chip there), not to the
  // bar at the map's foot: the bar is for messages, and for touch screens, which have no hover.
  const bar = $('#hint');
  const besidePointer = !!pointerAt && !pointerAt.touch && !touchFirst() && !drive; // (driving: the bar says the map can't be changed)
  chipText = '';
  if (besidePointer && !flashing() && bar.textContent) {
    bar.textContent = '';
    delete bar.dataset.tone;
  }
  const hint = { set textContent(v: string) {
    if (besidePointer) chipText = v;
    else if (!flashing() || drag) {
      bar.textContent = v;
      delete bar.dataset.tone;
    }
  } };
  // A proposal outlives its tool and kind only until they change.
  if (proposal && (tool.kind !== 'structure' || proposal.kind !== chosen[tool.id] || drive)) dropProposal();
  const at = hover ?? proposal?.at;
  if (!at || drive) {
    // (A touch screen has no hover to show the site: it says how a facility is placed.)
    // (Driving: how to drive, what the moment wants, rather than what can't be done.)
    hint.textContent = drive ? `${touchFirst() ? '방향 버튼으로' : '방향키·WASD로'} 노란 목표까지 운전하세요${SPECIAL[drive.plan.vehicle] ? ` · ${touchFirst() ? SPECIAL[drive.plan.vehicle]!.label.replace(' (Space)', ' 버튼') : SPECIAL[drive.plan.vehicle]!.label}` : ''} · 운전 중에는 짓지 못함`
      : touchFirst() && tool.kind === 'structure' ? '놓을 자리를 누르세요 · 그 자리 카드의 여기에 짓기로 확정합니다' : '';
    preview = null;
    tag = null;
    placeTag(); // off the map (or driving): no tag left where the pointer was
    return;
  }
  const [hx, hy] = at;
  tag = null;
  // A tool placed on one tile: beside the pointer its price in bold and where it goes under it (the bar: all in a line).
  const oneSpot = (cost: number, head: string, where: string) => {
    if (besidePointer) costTag('', cost);
    hint.textContent = besidePointer ? where : `${head} · ${where}`;
  };
  if (tool.kind !== 'structure') justBuilt = null;
  // Still over the facility just placed: it says so (not "a building is there", in red, over one's own work).
  const over = (k: StructureKind, [fx, fy]: [number, number], r: Rect) => fx < r.x + r.w && fx + STRUCTURES[k].w > r.x && fy < r.y + r.h && fy + STRUCTURES[k].h > r.y;
  if (tool.kind === 'structure' && besidePointer && justBuilt && chosen[tool.id] === justBuilt.kind && (city.state.occupant[justBuilt.y * city.size + justBuilt.x] ?? 0) < 0 && over(chosen[tool.id]!, footprintAt(chosen[tool.id]!, at), justBuilt)) {
    preview = { tiles: [], ok: true, hover: justBuilt };
    tag = { text: `${STRUCTURE_NAME[justBuilt.kind]} 지음`, tone: '' };
    hint.textContent = '옆으로 옮기면 하나 더 놓을 수 있습니다';
  } else if (tool.kind === 'structure') {
    justBuilt = null;
    const kind = chosen[tool.id]!;
    const def = STRUCTURES[kind];
    const [sx, sy] = footprintAt(kind, at);
    const check = city.canPlaceStructure(kind, sx, sy);
    const reach = reachAt(kind, sx, sy);
    // A plant feeds what lies within reach of its lot (zones and lines carry it on): outline that reach.
    const gap = city.cfg.services.powerGap + 1;
    // A spot it can take but with a catch (no road beside it, no pipe, no power) shows amber.
    const warnings = check.ok ? siteWarnings(kind, sx, sy) : '';
    const caught = !!warnings;
    preview = {
      tiles: rectTiles([sx, sy], [sx + def.w - 1, sy + def.h - 1]), ok: check.ok, ...(caught ? { color: 'rgba(240,170,40,0.5)' } : {}),
      ...(reach ? { ring: { x: sx + def.w / 2, y: sy + def.h / 2, r: reach } } : {}),
      ...(def.plant ? { box: { x: sx - gap, y: sy - gap, w: def.w + 2 * gap, h: def.h + 2 * gap } } : {}),
      // (A pump or tower off the pipes waters what stands within the pipes' reach of it: that reach, where the hint's
      // "새로 물이 닿는 건물 N채" are.)
      ...(def.pump && check.ok && !pipedAt(kind, sx, sy) ? ((r) => ({ box: { x: sx - r, y: sy - r, w: def.w + 2 * r, h: def.h + 2 * r } }))(city.cfg.services.waterRadius) : {}),
    };
    const extra = def.plant
      ? `발전량 ${fmt(def.plant.output)} MWh`
      : def.pump ? `급수량 ${fmt(def.pump.output)} m³ · 전력 필요`
      : def.treatment ? `반경 ${def.treatment.radius}칸 수질 정화`
      : def.incinerator ? `월 ${def.incinerator.capacity} t 소각 · 톤당 ${def.incinerator.powerPerTon} MWh`
      : def.recycling ? `주민 ${fmt(def.recycling.residents)}명당 쓰레기 −${def.recycling.reduction * 100}%`
      : def.police ? (def.police.radius ? `반경 ${Math.round(def.police.radius)}칸${def.police.cells ? ` · 감방 ${fmt(def.police.cells)}명` : ''}` : `수감 ${fmt(def.police.cells)}명${def.income ? ` · 사업 거래 수입 월 +§${fmt(def.income)}` : ''}`)
      : def.fire ? `반경 ${Math.round(def.fire.radius)}칸 화재 진압`
      : def.health ? `반경 ${def.health.radius}칸 · 환자 ${fmt(def.health.capacity)}명`
      : def.school ? `${def.school.radius >= 300 ? '도시 전체' : `반경 ${def.school.radius}칸`} · 학생 ${fmt(def.school.capacity)}명`
      : def.station ? `월 승차 ${fmt(def.station.capacity)}명 · ${STATION_HINT[def.station.mode]}`
      : def.airport ? `오피스 수요 상한 완화 최대 ${fmt(def.airport.capacity)} (도로로 닿는 오피스만큼)`
      : def.parking ? `차를 세우고 걸어서 대중교통으로 갈아탐 · 월 ${fmt(def.parking.capacity)}대`
      : def.seaport ? `물가에 · 화물 운행당 산업 상한 +${def.seaport.perTrip} (최대 ${def.seaport.relief})`
      : def.income ? `월 §${fmt(def.income)} 수입 · 시장 평점 ${def.mayor?.[0] ?? 0}${def.radiation ? ' · 방사능' : ''}`
      : def.category === 'landmark' || def.category === 'reward' ? `시장 평점 ${(def.mayor?.[0] ?? 0) >= 0 ? '+' : ''}${def.mayor?.[0] ?? 0}${def.mayor ? ` (${def.mayor[1] >= city.size ? '도시 전체' : `${def.mayor[1]}칸`})` : ''} · 상업 ${def.com[0]}${def.bulldoze ? ` · 철거 §${fmt(def.bulldoze)}` : ''}`
      : `주거 상한 +${fmt(def.relief[0])}`; // (as the tray and the park's card say it)
    // (A station: how many of what its service misses it would reach from here, the figure to move it about by.)
    const goal = reach && check.ok && !city.stepping ? goalOfStructure(kind) : null; // (not mid-day: its cover is being redone)
    const gained = goal && (goal === 'police' || goal === 'fire' || goal === 'health' || goal === 'education')
      ? newlyReached(goal, sx + def.w / 2, sy + def.h / 2, reach) : -1;
    // (A fire station: the plants it would take in too.)
    const plants = gained >= 0 && goal === 'fire' ? plantsReached(sx + def.w / 2, sy + def.h / 2, reach) : 0;
    // (A pump or tower off the pipes: the buildings it waters as it stands, and that pipes take it further.)
    const watered = def.pump && check.ok && !pipedAt(kind, sx, sy) ? wateredBy(kind, sx, sy) : 0;
    const reached = watered ? `새로 물이 닿는 건물 ${fmt(watered)}채 · 더\u00a0멀리는\u00a0수도관으로` : gained < 0 ? '' : `새로 닿는 ${plants ? `발전소 ${fmt(plants)}곳 · ` : ''}${goal === 'health' || goal === 'education' ? '집' : '건물'} ${gained ? `${fmt(gained)}채` : '없음'}`;
    const extraNow = reached ? `${extra} · ${reached}` : extra;
    // Warnings and refusals first: the hint shows three lines, and the ⚠ were last to be cut.
    // (Name and price are on the tool chip and by the pointer: the bar says what they don't.)
    // (Beside the pointer each catch on a line of its own, without its remedy — the built message gives that — then what it does.)
    const short = warnings.split(' · ⚠ ').map((w) => w.replace(/^ · ⚠ /, '').replace(/\s*\(.*\)$/, '').trim()).filter(Boolean).map((w) => `⚠ ${w}`);
    const text = check.ok
      ? besidePointer ? [...short, extra, reached].filter(Boolean).join('\n') : `${warnings ? `${warnings.replace(/^ · /, '')} · ` : ''}${extraNow}`
      : besidePointer ? ko(check.message ?? '') : `놓을 수 없음: ${ko(check.message ?? '')}`; // (the chip's bold line says it can't)
    tag = check.ok ? { text: `${caught && !besidePointer ? '⚠ ' : ''}§${fmt(def.cost)}${def.cost > city.state.funds ? ' · 자금 부족' : ''}`, tone: def.cost > city.state.funds ? 'bad' : caught ? 'warn' : '' } : { text: '놓을 수 없음', tone: 'bad' };
    if (proposal && !hover) {
      // The waiting facility: its whole reading in the bar (the hint bar would cut it short).
      // Laid out to read at a glance: what and what it costs, then each catch on a line of its own.
      const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const catches = warnings.split(' · ⚠ ').map((w) => w.trim()).filter(Boolean);
      $('#confirm-text').innerHTML = `<b>${esc(STRUCTURE_NAME[kind])}</b> ${def.w}×${def.h} · 건설 §${fmt(def.cost)} · 유지 월 §${fmt(def.upkeep)}`
        + (check.ok ? `<span class="confirm-stat">${esc(extraNow)}</span>` : `<span class="confirm-no">놓을 수 없음: ${esc(ko(check.message ?? ''))}</span><span class="confirm-stat">지도에서 다른 자리를 눌러 옮겨 보세요</span>`)
        + (catches.length ? `<span class="confirm-warns">${catches.map((w) => `<span>⚠ ${esc(w)}</span>`).join('')}</span>` : '');
      $<HTMLButtonElement>('#confirm-build').disabled = !check.ok;
      // (여기에 짓기, not 짓기: the foot bar's 짓기 under it opens the tools.)
      $('#confirm-build').textContent = check.ok ? `여기에 짓기 §${fmt(def.cost)}` : '여기에 짓기';
      $('#confirm-bar').hidden = false;
    } else hint.textContent = text;
  } else if (drag && tool.kind === 'powerline') {
    const tiles = linePath(...lineEnds(drag));
    const plan = city.previewLine('powerline', ...lineEnds(drag));
    preview = { tiles, ok: !plan.message };
    lineTag(plan);
    hint.textContent = plan.message ? `송전선 · ${reason(plan)}` : (besidePointer ? '구역은 전기를 4칸까지 넘겨주니 구역 위로는 깔리지 않습니다' : `송전선 ${plan.tiles}칸 §${fmt(plan.cost)} (구역은 전기를 4칸까지 넘겨주니 구역 위로는 깔리지 않습니다)`);
  } else if (drag && (tool.kind === 'pipe' || tool.kind === 'unpipe')) {
    let tiles = tool.kind === 'pipe' ? linePath(...lineEnds(drag)) : rectTiles(drag.start, drag.end);
    const plan = tool.kind === 'pipe' ? city.previewLine('pipe', ...lineEnds(drag)) : null;
    // A pipe stops at the water's edge: the preview ends there too.
    const shore = plan && !plan.message ? tiles.findIndex(([x, y]) => city.state.terrain[y * city.size + x] === Terrain.Water) : -1;
    if (shore >= 0) tiles = tiles.slice(0, shore);
    preview = { tiles, ok: !plan?.message };
    if (plan) lineTag(plan);
    hint.textContent = !plan ? removal(tiles, city.state.pipe, city.cfg.services.pipeCost.bulldoze, '수도관')
      : plan.message ? `수도관 · ${reason(plan)}` : (besidePointer ? `${shore >= 0 ? '물가에서 멈춤 (물은 건널 수 없음) · ' : ''}관에서 6칸까지 물이 닿습니다` : `수도관 ${plan.tiles}칸 §${fmt(plan.cost)}${shore >= 0 ? ' · 물가에서 멈춤 (물은 건널 수 없음)' : ''} (관에서 6칸까지 물이 닿습니다)`);
  } else if (drag && (tool.kind === 'subway' || tool.kind === 'unsubway')) {
    const tiles = tool.kind === 'subway' ? linePath(...lineEnds(drag)) : rectTiles(drag.start, drag.end);
    const plan = tool.kind === 'subway' ? city.previewLine('subway', ...lineEnds(drag)) : null;
    preview = { tiles, ok: !plan?.message };
    if (plan) lineTag(plan);
    hint.textContent = !plan ? removal(tiles, city.state.subway, city.cfg.economy.networkCost.subway.bulldoze, '지하철 선로')
      : plan.message ? `지하철 · ${reason(plan)}` : (besidePointer ? '역은 선로 위나 옆, 도로 옆에' : `지하철 선로 ${plan.tiles}칸 §${fmt(plan.cost)} (역은 선로 위나 옆, 도로 옆에)`);
  } else if (drag && tool.kind === 'elevated') {
    const tiles = linePath(...lineEnds(drag));
    const plan = city.previewLine(tool.track, ...lineEnds(drag));
    preview = { tiles, ok: !plan.message };
    lineTag(plan);
    hint.textContent = plan.message ? `${tool.label} · ${reason(plan)}` : (besidePointer ? '도로·철도·물 위로 지나갈 수 있음, 건물·구역 위는 안 됨' : `${tool.label} ${plan.tiles}칸 §${fmt(plan.cost)} (도로·철도·물 위로 지나갈 수 있음, 건물·구역 위는 안 됨)`);
  } else if (tool.kind === 'dispatch') {
    const r = city.cfg.safety.dispatch[tool.unit].radius;
    preview = { tiles: rectTiles([hx - r, hy - r], [hx + r, hy + r]), ok: true };
    const said = tool.unit === 'fire' ? fireHint(hx, hy) : policeHint(hx, hy);
    // Beside the pointer, away from a fire or riot: the cars free in bold, what a press does under it (the long line is the bar's).
    if (besidePointer && said.startsWith('가까운')) {
      const free = city.freeUnits(tool.unit);
      tag = { text: `출동 가능 ${free}대`, tone: free ? '' : 'bad' };
      const s = city.state;
      hint.textContent = tool.unit === 'fire'
        ? (s.fires.length || s.treeFires.length ? '불난 곳을 누르면 보냅니다' : '지금 불난 곳이 없습니다')
        : '누른 곳에 보내 3일간 범죄·폭동을 막습니다';
    } else hint.textContent = said;
  } else if (tool.kind === 'throw') {
    const tr = city.cfg.mayor.throwMoney.radius;
    preview = { tiles: rectTiles([hx - tr, hy - tr], [hx + tr, hy + tr]), ok: true };
    oneSpot(city.cfg.mayor.throwMoney.cost, `시장 리무진 §${city.cfg.mayor.throwMoney.cost}`, `돈을 뿌려 ${tr}칸 안 시장 평점 +${city.cfg.mayor.throwMoney.amount} (3개월, 시장 관저 필요)`);
  } else if (tool.kind === 'disaster') {
    const kind = tool.disaster;
    preview = { tiles: [[hx, hy]], ok: true, color: 'rgba(255,60,60,0.5)' }; // red for danger, not for "can't"
    // (Beside the pointer: its name in bold, what a press does under it.)
    if (besidePointer) tag = { text: DISASTER_NAME[kind], tone: '' };
    hint.textContent = besidePointer
      ? kind === 'ufo' ? '누른 곳에 광선 · 누른 채로 있으면 그곳을 노림'
        : LIVE_KINDS.includes(kind) ? '누른 곳에 나타나고, 끌면 따라 움직입니다' : '누른 곳에서 시작 · 세기가 클수록 피해가 큼'
      : kind === 'ufo'
      ? 'UFO — 누른 곳에 광선을 쏘고, 작은 UFO들이 주변 건물을 하나씩 노립니다. 누른 채로 있으면 그곳을 노립니다.'
      : LIVE_KINDS.includes(kind)
      ? `${DISASTER_NAME[kind]} — 누른 곳에 나타나고, 누른 채로 끌면 그쪽으로 움직입니다. 놓으면 제멋대로 돌아다닙니다.`
      : `${DISASTER_NAME[kind]} — 누른 곳에서 시작합니다. 세기가 클수록 피해가 큽니다.`;
  } else if (drag && tool.kind === 'trees') {
    const tiles = rectTiles(drag.start, drag.end);
    preview = { tiles, ok: true };
    // (Only open land takes a sapling: the engine counts them.)
    const plan = city.previewTrees(drag.start[0], drag.start[1], drag.end[0], drag.end[1]);
    costTag(`${plan.tiles}그루`, plan.cost);
    const why = `대기 오염 −2, 다 자란 숲은 최대 −7, 심으면 주변 시장 평점 +${city.cfg.flora.event.amount} (${city.cfg.flora.event.months}개월)`;
    // (Beside the pointer the count and price are its bold line.)
    hint.textContent = besidePointer ? `그루당 §${city.cfg.flora.saplingCost} · 빈 땅에만\n${why}` : `묘목 ${plan.tiles}그루 · 그루당 §${city.cfg.flora.saplingCost} (${why})`;
  } else if (drag && tool.kind === 'terraform') {
    const tiles = rectTiles(drag.start, drag.end);
    preview = { tiles, ok: true };
    // Before anything is built the land is shaped for free (only after the city is founded does it cost).
    const free = !city.established();
    // (Built-on, zoned and unchanged tiles are left out: the engine counts what it would change.)
    const plan = city.previewTerraform(drag.start[0], drag.start[1], drag.end[0], drag.end[1], tool.to);
    costTag(`${plan.tiles}칸`, plan.cost);
    hint.textContent = free
      ? `${tool.label} ${plan.tiles}칸 · 아직 아무것도 짓지 않아 무료입니다 (도시를 세운 뒤에는 칸당 돈이 듭니다)`
      : tool.to === 'raise' || tool.to === 'lower'
      ? `${tool.label} ${plan.tiles}칸 · ${city.cfg.terrain.terraform.metres}m씩, 칸당 §${city.cfg.terrain.terraform.cost} (평균보다 높은 땅은 땅값이 오르고, 경사가 심하면 큰 건물이 못 섭니다)`
      : `${tool.label} ${plan.tiles}칸 · 칸당 §${fmt(city.cfg.disasters.terraformCost)} (빈 땅·물만 바뀝니다)`;
    // (Beside the pointer the count and price are its bold line: what is left, without them.)
    if (besidePointer) chipText = chipText.replace(`${tool.label} ${plan.tiles}칸 · `, '').replace(/ \((.*)\)$/, ' · $1').replace(/^(.*)씩, /, '$1씩 · ');
  } else if (drag && tool.kind === 'level') {
    const tiles = rectTiles(drag.start, drag.end);
    preview = { tiles, ok: true };
    hint.textContent = `화산 지형 정리 ${tiles.length}칸 · 용암 원뿔·비탈 칸마다 §${fmt(city.cfg.disasters.levelCost)}`;
  } else if (tool.kind === 'cloverleaf') {
    preview = { tiles: [[hx, hy]], ok: true };
    oneSpot(city.cfg.transport.cloverleaf.cost, `클로버형 교차로 §${fmt(city.cfg.transport.cloverleaf.cost)}, 월 §${city.cfg.transport.cloverleaf.upkeep}`, '고속도로가 엇갈리는 칸에 놓으면 서로 이어집니다');
  } else if (tool.kind === 'transition') {
    preview = { tiles: [[hx, hy]], ok: true };
    oneSpot(city.cfg.transport.subwayTransition.cost, `지하철↔고가 철도 전환 §${fmt(city.cfg.transport.subwayTransition.cost)}, 월 §${city.cfg.transport.subwayTransition.upkeep}`, '고가 철도 옆 지하철 칸에 놓으면 두 노선이 이어집니다');
  } else if (tool.kind === 'toll') {
    preview = { tiles: [[hx, hy]], ok: true };
    oneSpot(city.cfg.transport.toll.cost, `톨게이트 §${fmt(city.cfg.transport.toll.cost)}, 월 §${fmt(city.cfg.transport.toll.upkeep)}`, '차 한 대당 §0.10, 용량 60%로 줄고 0.2시간 정차');
  } else if (drag && tool.kind === 'network') {
    const tiles = linePath(...lineEnds(drag));
    const lowBridge = $<HTMLInputElement>('#low-bridge').checked;
    const plan = city.previewNetwork(...lineEnds(drag), tool.network, { lowBridge });
    preview = { tiles, ok: !plan.message };
    // Blocked by buildings: those in the way are outlined (what to clear, rather than a red line).
    if (plan.message?.startsWith('path is blocked')) {
      const seen = new Set<number>();
      const lots: Rect[] = [];
      for (const [tx, ty] of tiles) {
        const occ = city.state.occupant[ty * city.size + tx] ?? 0;
        if (occ && !seen.has(occ)) {
          seen.add(occ);
          lots.push(lotAt(tx, ty));
        }
      }
      if (lots.length) preview.remove = lots;
    }
    lineTag(plan);
    const extra = [plan.bridges && `다리 ${plan.bridges}칸`, plan.tunnels && `터널 ${plan.tunnels}칸`].filter(Boolean).join(' · ');
    // (Length and price ride by the pointer: the bar only for what they leave out.)
    hint.textContent = plan.message
      ? `${tool.label} ${tiles.length}칸 · ${reason(plan)}`
      : [extra, plan.tiles < tiles.length && `이미 있는 ${tiles.length - plan.tiles}칸 제외`, tool.network === 'onramp' && rampWarning(tiles).replace(/^ · /, '')].filter(Boolean).join(' · ');
  } else if (drag && tool.kind === 'zone') {
    const tiles = rectTiles(drag.start, drag.end);
    const plan = city.previewZone(drag.start[0], drag.start[1], drag.end[0], drag.end[1], tool.zone);
    // What the drag would zone, in its colour (water, roads and lots already so stay as they are); the whole box when it can't.
    const box = { x: Math.min(drag.start[0], drag.end[0]), y: Math.min(drag.start[1], drag.end[1]), w: Math.abs(drag.end[0] - drag.start[0]) + 1, h: Math.abs(drag.end[1] - drag.start[1]) + 1 };
    preview = { tiles: plan.message ? tiles : plan.cells, ok: plan.ok || !plan.message, streets: plan.streets, color: zoneTint(tool.zone), box };
    const w = Math.abs(drag.end[0] - drag.start[0]) + 1;
    const h = Math.abs(drag.end[1] - drag.start[1]) + 1;
    // Built-on tiles: a denser zone of their class goes under the buildings (redeveloped later); others are left out.
    const st = city.state;
    const inPlan = new Set(plan.cells.map(([cx, cy]) => cy * st.size + cx));
    let under = 0;
    let skipped = 0;
    for (const [cx, cy] of tiles) {
      const i = cy * st.size + cx;
      if (st.occupant[i]! <= 0) continue;
      if (inPlan.has(i)) under++;
      else if (st.zone[i] !== ZONES.indexOf(tool.zone)) skipped++;
    }
    const built = `${under ? ` · 건물 선 ${under}칸 포함 (재개발 때 새 밀도로)` : ''}${skipped && tool.zone !== 'none' ? ` · 건물 선 ${skipped}칸 제외` : ''}`;
    // What stops it or would keep it empty comes first (the hint shows three lines).
    const catches = `${plan.message ? ` · ${reason(plan)}` : ''}${
      tool.zone !== 'none' && !roadNear(drag.start, drag.end) ? ' · ⚠ 도로에 안 닿음' : ''}${
      tool.zone !== 'none' && tool.zone !== 'landfill' && !powerNear(drag.start, drag.end) ? ' · ⚠ 전기 없음' : ''}${
      // (No one wants this class now: it would lie empty until they do.)
      tool.zone !== 'none' && tool.zone !== 'landfill' && zoneWant(tool.zone) <= 0 ? ' · ⚠ 지금 수요 없음 (한동안 비어 있음)' : ''}`;
    if (plan.message && !(plan.message === 'not enough funds' && plan.cost)) tag = { text: '지정할 수 없음', tone: 'bad' };
    else costTag(`${w}×${h}`, plan.cost, catches.includes('⚠'));
    // (Size and price ride by the pointer; the zone's name is on the chip: the bar for what stops it, and what else it does.)
    // (Beside the pointer, a line each.)
    hint.textContent = `${catches}${plan.streets.length ? ` · 골목 ${plan.streets.length}칸 함께 놓음` : ''}${built}`.replace(/^ · /, '').split(' · ').join(besidePointer ? '\n' : ' · ');
  } else if (drag && dezoning()) {
    // Begun on an empty zone: the drag takes the zones away (the empty tiles; what is built stays, as it does).
    const plan = city.previewZone(drag.start[0], drag.start[1], drag.end[0], drag.end[1], 'none');
    const box = { x: Math.min(drag.start[0], drag.end[0]), y: Math.min(drag.start[1], drag.end[1]), w: Math.abs(drag.end[0] - drag.start[0]) + 1, h: Math.abs(drag.end[1] - drag.start[1]) + 1 };
    preview = { tiles: plan.cells, ok: plan.ok || !plan.message, color: 'rgba(240,160,40,0.45)', box };
    let built = 0;
    for (const [cx, cy] of rectTiles(drag.start, drag.end)) if (city.state.occupant[cy * city.size + cx]! > 0 && city.state.zone[cy * city.size + cx]! > 0) built++;
    const kept = built ? `건물 선 ${built}칸은 그대로 (건물에서 시작하면 철거)` : '';
    if (plan.message && !(plan.message === 'not enough funds' && plan.cost)) tag = { text: '구역 해제할 수 없음', tone: 'bad' };
    else if (plan.tiles) costTag('구역 해제', plan.cost);
    else tag = { text: '해제할 빈 구역 없음', tone: '' };
    hint.textContent = plan.message ? `구역 해제 · ${reason(plan)}` : plan.tiles
      ? [besidePointer ? `빈 구역 ${plan.tiles}칸` : `구역 해제: 빈 구역 ${plan.tiles}칸 · §${fmt(plan.cost)}`, kept].filter(Boolean).join(besidePointer ? '\n' : ' · ')
      : '해제할 빈 구역이 없습니다';
  } else if (drag && tool.kind === 'bulldoze') {
    const tiles = rectTiles(drag.start, drag.end);
    const plan = city.previewBulldoze(drag.start[0], drag.start[1], drag.end[0], drag.end[1]);
    preview = { tiles, ok: !plan.message, remove: plan.lots, color: 'rgba(240,160,40,0.45)' };
    const parts = [plan.buildings && `건물 ${plan.buildings}`, plan.structures && `시설 ${plan.structures}`, plan.networkTiles && `도로·선로 ${plan.networkTiles}칸`,
      plan.powerLines && `송전선 ${plan.powerLines}칸`, plan.rubble && `잔해 ${plan.rubble}칸`].filter(Boolean).join(' · ');
    if (plan.message) tag = { text: '철거할 수 없음', tone: 'bad' };
    else if (parts) costTag('철거', plan.cost);
    hint.textContent = plan.message ? `철거 · ${reason(plan)}` : parts ? (besidePointer ? parts : `철거: ${parts} · §${fmt(plan.cost)}`) : '철거할 것이 없습니다'; // (beside the pointer the price is the chip's bold line)
  } else {
    const look = tool.kind === 'query' || tool.kind === 'route' || tool.kind === 'mic';
    preview = look ? { tiles: [], ok: true, hover: lotAt(hx, hy) } : { tiles: [[hx, hy]], ok: true };
    // Before a drag: what the tool is and costs (its tooltip), then where the pointer is.
    const title = document.querySelector<HTMLElement>(`#tools [data-tool="${tool.id}"]`)?.title.replace(/ \([A-Z]\)/, '');
    const verb = tool.kind === 'zone' ? '끌어서 지정' : tool.kind === 'terraform' || tool.kind === 'trees' ? `끌어서 ${tool.label}` : tool.kind === 'bulldoze' || tool.kind === 'unpipe' || tool.kind === 'unsubway' ? '끌어서 철거' : '끌어서 짓기';
    const straight = LINE_KINDS.has(tool.kind) && !touchFirst() ? ' (Shift: 곧게)' : '';
    const reading = overlay.kind !== 'none' ? overlayReading(city, overlay, hx, hy) : '';
    // Over the lot the open info card already describes, only a view's reading is news.
    // A touch screen has no hover: what a tap found opens in the card, and a pointer line would stay behind.
    const described = look && (touchFirst() || !!selected && !$('#info-card').hidden
      && hx >= selected.x && hx < selected.x + selected.w && hy >= selected.y && hy < selected.y + selected.h);
    // (Bare ground has nothing to say: a line of its height and place followed every move over open land.)
    const i = hy * city.size + hx;
    const bare = look && !reading && hx >= 0 && hy >= 0 && hx < city.size && hy < city.size && !city.state.occupant[i] && !city.state.net[i] && !city.state.zone[i] && city.state.terrain[i] !== Terrain.Water;
    // (Beside the pointer, before a drag, a drawing tool has nothing to add: the tool bar names it and its price.)
    // (Until a tool of its kind has been dragged once, the chip says how it is used.)
    const howTo = besidePointer && !look && !drawnKinds().has(tool.kind) ? `${verb}${straight}` : '';
    hint.textContent = described || bare ? reading : look ? ((d) => d + (reading && !d.includes(reading) ? ` · ${reading}` : ''))(describeTile(hx, hy)) : besidePointer ? [howTo, reading].filter(Boolean).join(' · ') : `${title ? `${title} · ${verb}${straight} · ` : ''}${hx}, ${hy}`;
    // The bulldozer over something: what it would take down and the price before pressing (a lived-in
    // building costs its residents' or workers' market value, far more than an empty one).
    if (tool.kind === 'bulldoze' && !touchFirst() && (city.state.occupant[hy * city.size + hx] || city.state.net[hy * city.size + hx])) {
      const plan = city.previewBulldoze(hx, hy, hx, hy);
      if (!plan.message && plan.cost > 0) {
        // (Outlined whole, in the drag's amber: the tile alone lit up blue, as a build tool's does, while the price
        // was the whole building's.)
        preview = { tiles: [[hx, hy]], ok: true, remove: plan.lots, color: 'rgba(240,160,40,0.45)' };
        const occ = city.state.occupant[hy * city.size + hx]!;
        const b = plan.buildings ? city.state.buildings.get(occ) : undefined;
        // (A station some buildings have only it to reach them: how many it leaves out, before the press.)
        const st = occ < 0 ? city.state.structures.get(-occ) : undefined;
        const alone = st && !city.stepping ? aloneReached(st) : null;
        const left = alone?.n ? ` · ⚠ 혼자 맡던 ${alone.what} ${fmt(alone.n)}채가 범위 밖이 됨` : '';
        hint.textContent = besidePointer ? `${describeTile(hx, hy).replace(/⚠ /g, '')}${b?.type ? ' · 주민·일자리 시가 포함' : ''}${left}` : `철거 · §${fmt(plan.cost)}${b?.type ? ' (주민·일자리 시가 포함)' : ''}${left} · ${verb}`;
        costTag('철거', plan.cost);
      }
    } else if (tool.kind === 'bulldoze' && !touchFirst() && emptyZone(hx, hy)) {
      // Over an empty zone: a drag from here takes the zone away (no building to take down yet).
      const plan = city.previewZone(hx, hy, hx, hy, 'none');
      preview = { tiles: [[hx, hy]], ok: true, color: 'rgba(240,160,40,0.45)' };
      hint.textContent = besidePointer ? `${describeTile(hx, hy).replace(/⚠ /g, '')} · 끌면 구역 해제` : `구역 해제 · §${fmt(plan.cost)}/칸 · 빈 구역에서 시작해 끌기`;
      costTag('구역 해제', plan.cost);
    }
  }
  // While a drag lays something down, what floats over the map steps back (the work is where the eye is).
  $('#view').classList.toggle('drawing', !!drag && !drag.pan);
  // Where it can't go, the reason reads in red (as the preview does).
  chipTone = preview && !preview.ok ? 'bad' : preview?.ok && chipText.includes('⚠') ? 'warn' : '';
  if (!besidePointer) {
    if (preview && !preview.ok && (!flashing() || drag)) bar.dataset.tone = 'bad';
    // It can go there but with a catch (⚠): the bar is edged amber, as the preview is.
    else if (preview?.ok && bar.textContent?.includes('⚠') && (!flashing() || drag)) bar.dataset.tone = 'warn';
  }
  placeTag();
}

/** The kinds of tool the player has built with (kept): their "끌어서 …" how-to stops showing by the pointer. */
const DRAWN_KEY = 'web-city:drawn';
let drawn: Set<string> | null = null;
function drawnKinds(): Set<string> {
  if (!drawn) {
    try {
      drawn = new Set(JSON.parse(localStorage.getItem(DRAWN_KEY) ?? '[]') as string[]);
    } catch {
      drawn = new Set();
    }
  }
  return drawn;
}
function noteDrawn(kind: string): void {
  const d = drawnKinds();
  if (d.has(kind)) return;
  d.add(kind);
  try {
    localStorage.setItem(DRAWN_KEY, JSON.stringify([...d]));
  } catch { /* storage unavailable */ }
}

/** The facility last placed, while the pointer is still over it. */
let justBuilt: (Rect & { kind: StructureKind }) | null = null;

/** The map point under the last press (a double click zooms on it). */
let pressedAt: [number, number] | null = null;

/** The drag's count and cost, read beside the pointer (the hint bar is a glance away). */
let tag: { text: string; tone: '' | 'warn' | 'bad' } | null = null;
/** With a mouse: the reading for the tile under the pointer (what is there, what the tool would do). */
let chipText = '';
let chipTone: '' | 'warn' | 'bad' = '';
/** Where the pointer last was over the map (page coordinates), for the tag. */
let pointerAt: { x: number; y: number; touch: boolean } | null = null;

function costTag(what: string, cost: number, caught = false): void {
  const short = cost > city.state.funds;
  tag = { text: cost ? `${what ? `${what} · ` : ''}§${fmt(cost)}${short ? ' · 자금 부족' : ''}` : what, tone: short ? 'bad' : caught ? 'warn' : '' };
}

function lineTag(plan: { tiles: number; cost: number; message?: string | null }): void {
  // (Short of money: the price, in red, says what it would take; any other block, that it can't go.)
  if (plan.message && !(plan.message === 'not enough funds' && plan.cost)) tag = { text: '놓을 수 없음', tone: 'bad' };
  else costTag(`${plan.tiles}칸`, plan.cost);
}

/** Why a plan can't go ahead, in words: short of money says by how much (자금이 부족합니다 alone left it to guess). */
function reason(plan: { cost?: number; message?: string | null }): string {
  if (plan.message !== 'not enough funds' || !plan.cost) return ko(plan.message ?? '');
  // Against the money as it stands: in debt, the debt is paid off first (§300 at −§2,000 is §2,300 short).
  // (The price and 자금 부족 ride in the chip.)
  const funds = city.state.funds;
  return `§${fmt(Math.ceil(plan.cost - funds))} 모자람 (${funds < 0 ? `빚 §${fmt(Math.ceil(-funds))}` : `가진 돈 §${fmt(Math.floor(funds))}`})`;
}

/**
 * The chip by the tile under the pointer: the price or count in bold (a drag's, a facility's),
 * then what the tile is or what the tool would do there. It sits beside the tile, not on it,
 * and moves tile by tile (it follows the map as it pans and zooms: see followTag).
 */
export function placeTag(): void {
  const el = $('#cursor-tag');
  const mouse = !!pointerAt && !pointerAt.touch && !touchFirst();
  // A touch: only a drag's count, above the finger (a facility waits in the confirm bar).
  const touchTag = !!tag && !!pointerAt?.touch && !!drag && !drag.pan;
  const show = !!hover && !drive && (mouse ? !drag?.pan && !!(tag || chipText) : touchTag);
  el.hidden = !show;
  if (!show) return;
  // Looking: what it is in bold, how it is under it ("석탄 발전소" / "4,176 / 5,996 MWh · 수명 100%").
  const cut = !tag && mouse && (tool.kind === 'query' || tool.kind === 'route') ? chipText.indexOf(' · ') : -1;
  const html = cut > 0
    ? `<b>${escapeHtml(chipText.slice(0, cut))}</b><span>${escapeHtml(chipText.slice(cut + 3))}</span>`
    : `${tag ? `<b>${escapeHtml(tag.text)}</b>` : ''}${mouse && chipText ? `<span>${escapeHtml(chipText)}</span>` : ''}`;
  if (el.innerHTML !== html) el.innerHTML = html;
  el.dataset.tone = tag?.tone || chipTone;
  el.classList.toggle('plain', !tag && cut <= 0);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x: number;
  let y: number;
  if (mouse) {
    // Beside the tile (or the facility's footprint): its lower right corner, else wherever there is room.
    const c = renderer.canvas.getBoundingClientRect();
    // Clear of the info card: beside it when it stands at the map's side, above it when it rises from below
    // (where it comes to rest: offsets ignore its slide-in, as keepInView's do).
    const card = $('#info-card');
    const r = { left: c.left, top: c.top, right: c.right, bottom: c.bottom };
    if (!card.hidden) {
      const cardLeft = c.left + card.offsetLeft;
      const cardTop = c.top + card.offsetTop;
      if (cardTop > c.top + c.height / 4) r.bottom = Math.min(r.bottom, cardTop);
      else r.right = Math.min(r.right, cardLeft);
    }
    // Clear of the tool's bar and the menu at the foot (the chip sat under them by the map's lower edge).
    const foot = [$('#tool-chip'), $('#dock')].filter((e) => !e.hidden && e.offsetParent).map((e) => e.getBoundingClientRect().top).filter((t) => t > c.top + c.height / 2); // (at the foot only: the bar at the top is not)
    if (foot.length) r.bottom = Math.min(r.bottom, Math.min(...foot) - 4);
    const [hx, hy] = hover!;
    // (Beside what it speaks of: a facility's footprint, the building looked at, else the tile.)
    const placing = tool.kind === 'structure' && chosen[tool.id];
    const lot = !placing && (tool.kind === 'query' || tool.kind === 'bulldoze') ? lotAt(hx, hy) : null;
    const [fw, fh] = placing ? [STRUCTURES[chosen[tool.id]!].w, STRUCTURES[chosen[tool.id]!].h] : lot ? [lot.w, lot.h] : [1, 1];
    const [sx, sy] = placing ? footprintAt(chosen[tool.id]!, hover!) : lot ? [lot.x, lot.y] : [hx, hy];
    const left = r.left + (sx - cam.x) * cam.scale;
    const top = r.top + (sy - cam.y) * cam.scale;
    const right = left + fw * cam.scale;
    const bottom = top + fh * cam.scale;
    const gap = 10;
    x = right + w + gap <= r.right - 8 ? right + gap : left - w - gap;
    y = bottom + h + gap <= r.bottom - 8 ? bottom + gap : top - h - gap;
    x = Math.max(r.left + 8, Math.min(r.right - w - 8, x));
    y = Math.max(r.top + 8, Math.min(r.bottom - h - 8, y));
  } else {
    x = Math.min(window.innerWidth - w - 8, pointerAt!.x + 18);
    y = pointerAt!.y - 72;
  }
  el.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(Math.max(8, y))}px)`;
}

/** Keeps the chip by its tile while the map moves under it (a wheel zoom, a glide). */
let camSeen = '';
/** The day moved on under a still pointer: the looking chip reads the tile again (its traffic, its people). */
export function refreshTag(): void {
  if (!drag && tool.kind === 'query' && !$('#cursor-tag').hidden) updatePreview();
}

export function followTag(): void {
  // (Only when the camera moved: the map redraws every frame while cars run.)
  const at = `${cam.x},${cam.y},${cam.scale}`;
  if (at === camSeen) return;
  camSeen = at;
  if (!$('#cursor-tag').hidden) placeTag();
}

/**
 * A road dragged to within a couple of tiles of the map's edge, heading for
 * it, ends on the edge: there it joins the neighbour city (a tile short, it
 * doesn't, and at a whole-map view the last tiles are a pixel hunt).
 */
function toEdge(start: readonly [number, number], at: [number, number]): [number, number] {
  const n = city.size;
  // Near the edge counts as at it: more so for the first road out (a drag three tiles short left the town
  // without a neighbour, unexplained) and zoomed out, where a finger covers several tiles.
  const SNAP = Math.max(2, roadLinked() ? 0 : 5, Math.ceil(10 / cam.scale));
  const [x, y] = at;
  const along = Math.abs(x - start[0]) >= Math.abs(y - start[1]);
  if (along && x !== start[0]) {
    if (x < start[0] && x <= SNAP) return [0, y];
    if (x > start[0] && x >= n - 1 - SNAP) return [n - 1, y];
  } else if (!along) {
    if (y < start[1] && y <= SNAP) return [x, 0];
    if (y > start[1] && y >= n - 1 - SNAP) return [x, n - 1];
  }
  return at;
}

/** A facility's top-left tile when the pointer is at `at`: its footprint centred there. */
function footprintAt(kind: StructureKind, at: readonly [number, number]): [number, number] {
  const def = STRUCTURES[kind];
  const x = at[0] - ((def.w - 1) >> 1);
  const y = at[1] - ((def.h - 1) >> 1);
  // A facility that needs a road beside it snaps to one a tile away (most were dropped one tile off the road).
  if (def.garbage > 0 && !city.roadBeside(x, y, def.w, def.h)) {
    for (const [dx, dy] of SNAP) {
      if (city.roadBeside(x + dx, y + dy, def.w, def.h) && city.canPlaceStructure(kind, x + dx, y + dy).ok) return [x + dx, y + dy];
    }
  }
  return [x, y];
}
/** Nudges tried when snapping to a road: sides first, then corners. */
const SNAP = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;

/**
 * Why a facility on a free site at (x, y) wouldn't work yet (' · ⚠ …' each),
 * or ''. Worked out before it is placed: once it stands, the site is taken.
 */
/** How far a facility placed at (x, y) would reach: a fire station no road touches less far (its crews go on foot). */
function reachAt(kind: StructureKind, x: number, y: number): number {
  const def = STRUCTURES[kind];
  const r = coverageRadius(kind);
  return r && def.fire?.needsRoad && !city.roadBeside(x, y, def.w, def.h) ? r * city.cfg.safety.fireNoRoad : r;
}

/** Buildings within the pipes' reach of a pump or tower at (x, y), which it waters on its own: those without water, and all. */
function wateredBy(kind: StructureKind, x: number, y: number, all = false): number {
  const def = STRUCTURES[kind];
  if (!def.pump) return 0;
  const r = city.cfg.services.waterRadius;
  let n = 0;
  for (const b of city.state.buildings.values()) {
    if (!b.type || (b.watered && !all)) continue;
    if (b.x <= x + def.w - 1 + r && b.x + b.w - 1 >= x - r && b.y <= y + def.h - 1 + r && b.y + b.h - 1 >= y - r) n++;
  }
  return n;
}

/** Whether a pump or tower at (x, y) would stand on or beside a pipe (else it feeds only what is within reach of it). */
function pipedAt(kind: StructureKind, x: number, y: number): boolean {
  const def = STRUCTURES[kind];
  for (let yy = y - 1; yy <= y + def.h; yy++) for (let xx = x - 1; xx <= x + def.w; xx++) {
    if (xx >= 0 && yy >= 0 && xx < city.size && yy < city.size && city.state.pipe[yy * city.size + xx]) return true;
  }
  return false;
}

function siteWarnings(kind: StructureKind, x: number, y: number): string {
  const def = STRUCTURES[kind];
  // A plant must reach something to feed; pumps and the like need a powered grid.
  const reachPower = def.plant || def.pump || def.treatment || def.recycling ? city.powerReach(kind, x, y) : 'powered';
  const unlinked = def.plant ? (reachPower === 'none' ? ' · ⚠ 전기를 보낼 곳이 없음 (4칸 안에 구역·송전선이 없음 — 송전선으로 이으세요)' : '')
    : reachPower !== 'powered' ? ' · ⚠ 전기가 닿지 않는 자리 (발전소와 송전선으로 이어야 작동)' : '';
  // Facilities make garbage and send out crews: without a road beside them neither gets anywhere.
  const offRoad = def.garbage > 0 && !city.roadBeside(x, y, def.w, def.h)
    ? def.station ? ' · ⚠ 옆에 도로가 없음 (승객과 버스가 닿지 못함)' : ` · ⚠ 옆에 도로가 없음 (쓰레기 수거${def.police || def.fire || def.health || def.school ? '·출동' : ''} 불가)` : '';
  // A plant that burns explodes: one outside every fire station's reach is a bomb.
  let covered = false;
  if (def.plant) for (let yy = y; yy < y + def.h && !covered; yy++) for (let xx = x; xx < x + def.w; xx++) if (city.fields.fireCover[yy * city.size + xx]! > 0) covered = true;
  const unguarded = def.plant && !covered ? ' · ⚠ 소방서 범위 밖 (불타면 폭발합니다 — 근처에 소방서를)' : '';
  // A pump or tower feeds the pipes on or beside it.
  const piped = !def.pump || pipedAt(kind, x, y);
  // (Alone it still waters what stands within the pipes' reach of it: a warning only with nothing there to water — a
  // tower beside 26 dry buildings was told in red it sent water nowhere, and watered 18 of them.)
  const dry = piped || wateredBy(kind, x, y, true) > 0 ? '' : ' · ⚠ 주변에 물을 쓸 건물이 없음 (수도관을 이어야 멀리 보냄)';
  // A dirty plant (or an incinerator) beside homes: its smoke drives residents away (it is the commonest early mistake).
  // (Coal and oil as far as their smoke stays thick, as the guide sites them: within half its reach, a coal plant 10
  // tiles off was let by unwarned and its homes breathed 80.)
  let homes = false;
  const air = def.plant?.air ?? def.incinerator?.air;
  if (air && air[0] >= 50) {
    const r = air[0] >= 100 ? smokeClear(kind) : Math.ceil(air[1] / 2);
    for (let yy = Math.max(0, y - r); yy < Math.min(city.size, y + def.h + r) && !homes; yy++) {
      for (let xx = Math.max(0, x - r); xx < Math.min(city.size, x + def.w + r); xx++) {
        const z = city.state.zone[yy * city.size + xx]!;
        if (z >= 1 && z <= 3) homes = true;
      }
    }
  }
  // (Coal and oil drive residents away; a gas plant's lighter smoke lowers the homes' appeal.)
  const smoky = homes ? ` · ⚠ 주거 구역이 가까움 (대기 오염 ${air![1]}칸까지: ${air![0] >= 100 ? '주민이 떠납니다' : '쾌적도가 떨어집니다'})` : '';
  return unlinked + dry + smoky + offRoad + unguarded;
}

/**
 * Builds the facility in hand with its middle at (x, y), as a confirmed click there would (the goal
 * screen's suggested site: one press, where finding the target on the map and hitting it took several).
 */
export function placeAt(x: number, y: number): void {
  if (tool.kind !== 'structure') return;
  proposal = { kind: chosen[tool.id]!, at: [x, y] };
  setDrag({ start: [x, y], end: [x, y] });
  confirming = true;
  try {
    applyTool();
  } finally {
    confirming = false;
  }
  setDrag(null);
  updatePreview();
}

/**
 * A facility in hand: a press (or the pointer) inside the ring of a site suggested for it lands on the site. The
 * ring is a finger wide while its tile may be a few pixels: a press just beside the middle built a station off the
 * road, or was told a building stood there. (Within the ring as drawn — 18px across a zoomed-out map, where a
 * finger's 24 reached 5 tiles past it — and no more than a finger's width: zoomed in, that is the tile itself.
 * Not a ring that marks trouble, nor a site for another facility: a park put by the homes short of air jumped
 * onto the homes.)
 */
function snapToSpot(px: number, py: number, t: [number, number]): [number, number] {
  const held = tool.kind === 'structure' ? chosen[tool.id] : undefined;
  if (!held) return t;
  const reach = Math.min(touchFirst() ? 24 : 18, Math.max(18, 2.2 * cam.scale)); // (the ring's radius: see render)
  let best: [number, number] | null = null;
  let near = reach;
  const goal = goalOfStructure(held);
  for (const m of renderer.marks) {
    if (m.tone !== 'spot' || !m.site) continue;
    const d = Math.hypot(px - (m.x + m.w / 2 - cam.x) * cam.scale, py - (m.y + m.h / 2 - cam.y) * cam.scale);
    // (Its own facility's site; or another of the same service's where this one fits too: a large fire station on
    // the small one's site.)
    if (d > near || (m.site !== held && !(goal && goalOfStructure(m.site) === goal && city.canPlaceStructure(held, ...footprintAt(held, [m.x, m.y])).ok))) continue;
    near = d;
    best = [m.x, m.y];
  }
  return best ?? t;
}

/** What a station being bulldozed alone reached (said with the result). */
let lostCover: { n: number; what: string } | null = null;

/** A zone with nothing on it yet (no building or facility, road, track or rubble): where the bulldozer takes the zone
 *  away instead. (Not a landfill still holding garbage: that can't be unzoned.) */
function emptyZone(x: number, y: number): boolean {
  const s = city.state;
  if (x < 0 || y < 0 || x >= s.size || y >= s.size) return false;
  const i = y * s.size + x;
  return s.zone[i]! > 0 && s.occupant[i] === 0 && s.net[i] === 0 && !s.elevated[i] && !s.rubble[i] && !(s.landfill[i]! > 0);
}

/** A finger's tap with the bulldozer, once its question was answered yes (see applyTool's 철거). */
let tapConfirmed = false;

/** Whether the bulldozer's drag unzones: it started on an empty zone (one 철거 for both — the zones a drag across
 *  them takes away, what stands on the land another drag takes down). */
function dezoning(): boolean {
  return tool.kind === 'bulldoze' && !!drag && !drag.pan && emptyZone(drag.start[0], drag.start[1]);
}

/** What a bulldozing that takes facilities (or, tapped, one building) down is asked as: what goes, and its price. */
function bulldozeQuestion(x0: number, y0: number, x1: number, y1: number, buildings: number, cost: number): string {
  const kinds = new Map<StructureKind, number>();
  const seen = new Set<number>();
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    const occ = city.state.occupant[y * city.size + x] ?? 0;
    const st = occ < 0 && !seen.has(-occ) ? city.state.structures.get(-occ) : undefined;
    if (!st) continue;
    seen.add(st.id);
    kinds.set(st.kind, (kinds.get(st.kind) ?? 0) + 1);
  }
  const names = [...kinds].map(([k, n]) => `${STRUCTURE_NAME[k]}${n > 1 ? ` ${n}곳` : ''}`);
  const what = !names.length ? '이 건물' : names.length > 2 ? `${names.slice(0, 2).join('·')} 외 ${names.length - 2}종` : names.join('·');
  const also = names.length && buildings ? ` 건물 ${fmt(buildings)}채와 함께` : '';
  return `${what}${josa(what, '을', '를')}${also} 헐까요? 철거비 §${fmt(cost)} · 되돌릴 수 없습니다.`;
}

export function applyTool(): void {
  if (!drag || drive) return; // no building under the car while driving
  const [x0, y0] = drag.start;
  const [x1, y1] = drag.end;
  const L = lineEnds(drag); // a line's ends, in the order that bends it the way the drag set off
  if (mySimAction) {
    mySimClick(x1, y1);
    return;
  }
  let res: { ok: boolean; cost: number; message?: string } | null = null;
  const usedKind = tool.kind; // (a handed facility puts the tool down below)
  const dz = dezoning(); // (before the drag's tiles change)
  let built: [string, 'bad' | 'info'] | null = null; // a facility's "built" line (what it still needs), said again if the tool goes down
  switch (tool.kind) {
    case 'network': {
      const first = !city.state.net.some((v) => v !== 0);
      res = city.buildNetwork(...L, tool.network, { lowBridge: $<HTMLInputElement>('#low-bridge').checked });
      // A new map opens whole (for the road to its edge); with the first road down, come in close
      // to its inland end, where the town will grow.
      // (Touch screens: a mouse wheel zooms easily, and the move took the next drags elsewhere.)
      if (res.ok && first && cam.scale < 10 && touchFirst()) {
        const inland = (x: number, y: number) => Math.min(x, y, city.size - 1 - x, city.size - 1 - y);
        const [cx, cy] = inland(x0, y0) >= inland(x1, y1) ? [x0, y0] : [x1, y1];
        centerOn(cx, cy, 14);
      }
      break;
    }
    case 'zone': res = city.zone(x0, y0, x1, y1, tool.zone); break;
    case 'bulldoze': {
      if (dz) {
        res = city.zone(x0, y0, x1, y1, 'none');
        break;
      }
      // Asked first when it takes a facility down (what it cost to build is lost, and nothing puts it back), and a
      // finger's single tap on a building too (a tap has no hover to show it beforehand; a drag shows what it takes
      // while it is drawn, and a building grows again on its zone).
      if (!tapConfirmed) {
        const plan = city.previewBulldoze(x0, y0, x1, y1);
        const tap = touchFirst() && x0 === x1 && y0 === y1;
        if (!plan.message && (plan.structures || (tap && plan.buildings))) {
          void ask(bulldozeQuestion(x0, y0, x1, y1, plan.buildings, plan.cost), '철거').then((go) => {
            if (!go || tool.kind !== 'bulldoze') return;
            tapConfirmed = true;
            setDrag({ start: [x0, y0], end: [x1, y1] });
            try {
              applyTool();
            } finally {
              tapConfirmed = false;
              setDrag(null);
            }
          });
          return;
        }
      }
      // (Stations taken down: what only they reached, said with the result — a touch screen has no hover to warn first.)
      city.settle();
      const ids = new Set<number>();
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        const occ = city.state.occupant[y * city.size + x] ?? 0;
        if (occ < 0) ids.add(-occ);
      }
      const alone = [...ids].map((id) => city.state.structures.get(id)).map((st) => (st ? aloneReached(st, ids) : null)).filter((a): a is NonNullable<typeof a> => !!a?.n);
      lostCover = alone.length ? { n: alone.reduce((sum, a) => sum + a.n, 0), what: alone.some((a) => a.what === '건물') ? '건물' : '집' } : null;
      res = city.bulldoze(x0, y0, x1, y1);
      break;
    }
    case 'powerline': res = city.buildPowerLine(...L); break;
    case 'pipe': res = city.buildPipe(...L); break;
    case 'unpipe': res = city.bulldozePipes(x0, y0, x1, y1); break;
    case 'subway': res = city.buildSubway(...L); break;
    case 'level': res = city.levelLandform(x0, y0, x1, y1); break;
    case 'throw': res = city.throwMoney(x1, y1); break;
    case 'trees': res = city.plantTrees(x0, y0, x1, y1); break;
    case 'dispatch': {
      // A fire unit isn't spent where nothing burns (it came back to say so, the last truck gone).
      const here = y1 * city.size + x1;
      const occHere = city.state.occupant[here] ?? 0;
      if (tool.unit === 'fire' && !(occHere !== 0 && city.state.fires.some((f) => f.target === occHere)) && !city.state.treeFires.some((t) => t.i === here)) {
        res = { ok: false, cost: 0, message: 'nothing burns here' };
        break;
      }
      res = city.dispatch(tool.unit, x1, y1);
      // Say it went, and when it gets there (nothing showed but a dot).
      const u = res.ok ? city.state.units.at(-1) : undefined;
      if (u) {
        const riot = tool.unit === 'police' ? riotCars(x1, y1) : undefined;
        flash(`${tool.unit === 'fire' ? (u.air ? '소방 헬기' : '소방차') : '경찰차'} 출동 · ${u.travel > 0 ? `도착 약 ${Math.ceil(u.travel)}일` : '바로 도착'}${riot ? ` · 폭동에 ${riot.cars}/${riot.need}대${riot.cars < riot.need ? ' (더 보내세요)' : ''}` : ''} · 남은 차량 ${city.freeUnits(tool.unit)}대`, 'info');
        refreshToolChip();
      }
      break;
    }
    case 'terraform': res = city.terraform(x0, y0, x1, y1, tool.to); break;
    case 'disaster': {
      const kind = tool.disaster;
      // The view runs past the map's edge; the engine refuses (throws) out there.
      if (x1 < 0 || y1 < 0 || x1 >= city.size || y1 >= city.size) {
        res = { ok: false, cost: 0, message: 'out of bounds' };
        break;
      }
      const strike = () => {
        const r = city.disaster(kind, x1, y1, Number($<HTMLInputElement>('#disaster-intensity').value) / 100);
        // Nothing at all: a fire inside fire cover is put out on the spot; say so rather than "0 · 0 · 0".
        flash(!r.buildings && !r.structures && !r.fires
          ? (kind === 'fire' && city.state.occupant[y1 * city.size + x1] ? '화재: 소방 보호 범위 안이라 번지기 전에 꺼졌습니다' : `${DISASTER_NAME[kind]}: 피해 없음`)
          : `${DISASTER_NAME[kind]}: 건물 ${r.buildings} · 시설 ${r.structures} · 화재 ${r.fires}`);
      };
      // A finger lands on the map for many reasons: on a touch screen a disaster asks first.
      if (touchFirst()) {
        void ask(`(${x1}, ${y1})에 ${DISASTER_NAME[kind]}${josa(DISASTER_NAME[kind], '을', '를')} 일으킬까요? 되돌릴 수 없습니다.`, `${DISASTER_NAME[kind]} 일으키기`).then((go) => {
          if (!go) return;
          strike();
          city.refreshIfDirty();
          redraw();
          updatePanels();
        });
        return;
      }
      strike();
      res = { ok: true, cost: 0 };
      break;
    }
    case 'elevated': res = city.buildElevated(...L, tool.track); break;
    case 'toll': res = city.placeToll(x1, y1); break;
    case 'cloverleaf': res = city.placeCloverleaf(x1, y1); break;
    case 'transition': res = city.placeSubwayTransition(x1, y1); break;
    case 'unsubway': res = city.bulldozeSubway(x0, y0, x1, y1); break;
    case 'structure': {
      const kind = chosen[tool.id]!;
      // Touch: a tap proposes (see `proposal`); only 짓기 builds (a quick
      // second tap built at once, past the warnings in the bar).
      if (touchFirst() && !(confirming && proposal?.kind === kind && proposal.at[0] === x1 && proposal.at[1] === y1)) {
        proposal = { kind, at: [x1, y1] };
        setHover(null); // the finger is gone: the proposal is what shows
        requestAnimationFrame(() => clearOfBar(kind, x1, y1));
        break;
      }
      dropProposal();
      city.settle(); // (the count below reads the cover, which a day part-way is redoing)
      const [sx, sy] = footprintAt(kind, [x1, y1]);
      const placeable = city.canPlaceStructure(kind, sx, sy).ok;
      const warn = placeable ? siteWarnings(kind, sx, sy) : '';
      // (A station: what it now reaches that went without, counted before it stands — the result, said with it.)
      const def = STRUCTURES[kind];
      const goal = placeable ? goalOfStructure(kind) : null;
      const reach = reachAt(kind, sx, sy);
      const gained = reach && (goal === 'police' || goal === 'fire' || goal === 'health' || goal === 'education') ? newlyReached(goal, sx + def.w / 2, sy + def.h / 2, reach) : 0;
      const plants = reach && goal === 'fire' ? plantsReached(sx + def.w / 2, sy + def.h / 2, reach) : 0;
      res = city.placeStructure(kind, sx, sy);
      // Say it stands (the hint over it would now read "has a building"), and what it still needs.
      if (res.ok) {
        justBuilt = { x: sx, y: sy, w: def.w, h: def.h, kind };
        const reached = gained || plants ? ` · 새로 닿는 ${[plants ? `발전소 ${fmt(plants)}곳` : '', gained ? `${goal === 'health' || goal === 'education' ? '집' : '건물'} ${fmt(gained)}채` : ''].filter(Boolean).join(' · ')}` : '';
        // (A subway station with no track to another: the track it needs, said — the tool shows where. Not one laid on a
        // line already, while two stations elsewhere wait for theirs.)
        const placed = city.query(sx, sy)?.structure;
        const track = kind === 'subwayStation' && !warn && placed && subwayAlone(placed.id) && subwayGap() ? ' · 다른 역과 지하철 선로로 이어야 탑니다 (교통 › 지하철)' : '';
        built = [`${STRUCTURE_NAME[kind]}${josa(STRUCTURE_NAME[kind], '을', '를')} 지었습니다 · −§${fmt(res.cost)}${reached}${warn}${track}`, warn ? 'bad' : 'info'];
        flash(...built);
      }
      break;
    }
    case 'query':
      if (x1 < 0 || y1 < 0 || x1 >= city.size || y1 >= city.size) break; // off the map: nothing to look at (an empty card opened)
      {
        // A fingertip zoomed out covers several tiles: off a building by a little (onto its road), it meant the building.
        let [qx, qy] = [x1, y1];
        const s = city.state;
        const reach = pointerAt?.touch && cam.scale < 6 ? Math.min(3, Math.floor(12 / cam.scale)) : 0; // (closer in, a road is big enough to mean)
        const i = y1 * s.size + x1;
        if (reach > 0 && !s.occupant[i] && s.net[i] && !s.zone[i]) { // (an empty lot is itself worth a look: why it isn't growing)
          let best = Infinity;
          for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
            const x = x1 + dx, y = y1 + dy;
            if (x < 0 || y < 0 || x >= s.size || y >= s.size || s.occupant[y * s.size + x]! <= 0) continue;
            const d = dx * dx + dy * dy;
            if (d < best) [best, qx, qy] = [d, x, y];
          }
        }
        showInfo(qx, qy);
      }
      if (selected) keepInView(selected);
      updatePreview();
      break;
    case 'route': showRoutes(x1, y1); break;
    case 'mic': interviewAt(x1, y1); break;
  }
  // What was done where the map shows little of it: a word that it happened, and its cost.
  const lost = tool.kind === 'bulldoze' && lostCover ? ` · ⚠ 혼자 맡던 ${lostCover.what} ${fmt(lostCover.n)}채가 범위 밖이 됨` : '';
  if (res?.ok && !res.message && QUIET_KINDS.has(tool.kind)) flash(`${dz ? '구역 해제' : tool.label} 완료${res.cost ? ` · −§${fmt(res.cost)}` : ''}${lost}`, 'info');
  lostCover = null;
  if (res && !res.ok && res.message) flash(ko(res.message), 'bad');
  // A new city's clock starts with its first zone (the game opened paused).
  // (Not when the player paused it on purpose.)
  if (res?.ok && tool.kind === 'zone' && speed === 0 && city.state.day === 0 && !speedChosen) {
    resumeAfterBuilding(1);
    flash('도구를 내려놓으면 시간이 흐르기 시작합니다', 'info');
  }
  else if (res?.ok && res.message?.includes('Cloverleaf')) flash('고속도로가 입체로 엇갈립니다 · 클로버형 교차로를 놓으면 이어집니다');
  // Feel it land: the area flashes (or raises dust where things came down) and the cost rises from the drag's end.
  if (res?.ok && tool.kind !== 'query' && tool.kind !== 'route' && tool.kind !== 'mic') {
    const bx = Math.min(x0, x1);
    const by = Math.min(y0, y1);
    const area = tool.kind === 'structure' ? null : { w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
    if (area && area.w * area.h <= 4096) {
      const line = tool.kind === 'network' || tool.kind === 'powerline' || tool.kind === 'pipe' || tool.kind === 'subway';
      if (line) for (const [lx, ly] of linePath(...L)) renderer.effect('flash', lx, ly);
      else renderer.effect(tool.kind === 'bulldoze' && !dz && area.w * area.h <= 400 ? 'dust' : 'flash', bx, by, area.w, area.h); // (dust is a few puffs a tile)
    }
    if (res.cost > 0) renderer.effect('cost', x1 + 0.5, y1 - 0.2, 1, 1, `−§${fmt(res.cost)}`);
  }
  // A goal's screen keeps what was done from it (its figures show what came of it).
  if (res?.ok && !res.message && tool.kind !== 'query' && tool.kind !== 'route' && tool.kind !== 'mic') {
    noteAction(`${tool.kind === 'structure' ? STRUCTURE_NAME[chosen[tool.id]!] : dz ? '구역 해제' : toolName(tool)}${res.cost ? ` · −§${fmt(res.cost)}` : ''}`, undefined, tool.id);
  }
  const used = tool; // (before a handed-out facility's tool goes down)
  // A facility a suggestion handed out is one job: placed, the tool goes down and time runs on.
  if (res?.ok && tool.kind === 'structure' && handedPlaced(tool.id)) {
    const held = isHeld();
    selectTool('query'); // (which ends the flash: the built line, with what the site still needs, is said again)
    if (built) flash(`${built[0]}${held ? ' · 시간이 다시 흐릅니다' : ''}`, built[1]);
  }
  if (res?.ok) {
    toolUsed(used);
    // (A drag that laid something: a click or a stroke over what stood there teaches nothing.)
    if (usedKind && res.cost > 0 && (x0 !== x1 || y0 !== y1)) noteDrawn(usedKind);
  }
  // Edits change power grids and coverage; recompute so overlays are current.
  if (res?.ok) {
    city.refreshIfDirty();
    refreshEdgeHint(); // (joined to a neighbour: the edge's outline goes)
  }
  redraw();
  updatePanels();
}

/**
 * A line's ends as the engine takes them: it runs along the first end's row,
 * then down the second's column. A drag that set off up or down goes the
 * other way round, so the bend follows the hand. (Not on-ramps or one-way roads, whose direction is their meaning,
 * nor pipes, laid from where the drag began up to the shore.)
 */
function lineEnds(d: NonNullable<typeof drag>): [number, number, number, number] {
  const flip = d.vertical && LINE_KINDS.has(tool.kind) && tool.kind !== 'pipe' && !(tool.kind === 'network' && (tool.network === 'onramp' || tool.network === 'oneway'));
  return flip ? [d.end[0], d.end[1], d.start[0], d.start[1]] : [d.start[0], d.start[1], d.end[0], d.end[1]];
}

/** Tools drawn as a line (a bend where the drag turns; Shift keeps it straight). */
const LINE_KINDS = new Set(['network', 'powerline', 'pipe', 'subway', 'elevated']);

/** Tools whose work the map barely shows (underground, or things taken away): confirmed in the hint bar. */
const QUIET_KINDS = new Set(['bulldoze', 'pipe', 'unpipe', 'subway', 'unsubway', 'powerline', 'trees', 'toll']);

/** Zooms by `factor`, keeping the map point under (px, py) in place. */
/** As far out as zooming goes: the whole map a little smaller than the view (further, the city was a stamp in a void). */
function minScale(): number {
  const r = renderer.canvas.getBoundingClientRect();
  return Math.max(1, Math.min(r.width, r.height) / city.size * 0.85);
}

/** A Mac's mouse wheel, in Chrome and Safari: its steps come in multiples of this. */
const MAC_NOTCH = 4.000244140625;

/**
 * Whether a wheel event is a touchpad's two fingers rather than a mouse's wheel. Firefox steps a wheel in lines; a
 * Mac's wheel moves in multiples of {@link MAC_NOTCH}; Chrome and Safari count a wheel's notches in the old
 * wheelDelta (120 each, a fine wheel's quarter notches 30) where a touchpad's is three times its delta; failing those,
 * a wheel moves in whole notches of 50 px or more straight up and down, a touchpad by the pixel and sideways too.
 */
function fromTouchpad(e: WheelEvent): boolean {
  if (e.deltaMode !== 0) return false;
  if (e.deltaY !== 0 && e.deltaY % MAC_NOTCH === 0) return false;
  const w = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  if (w) return Math.abs(w + 3 * e.deltaY) <= 1; // (Safari's is rounded)
  if (e.deltaX !== 0) return true;
  return !(Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
}

export function zoomAt(factor: number, px: number, py: number): void {
  const wx = cam.x + px / cam.scale;
  const wy = cam.y + py / cam.scale;
  cam.scale = Math.max(minScale(), Math.min(48, cam.scale * factor));
  cam.x = wx - px / cam.scale;
  cam.y = wy - py / cam.scale;
  redraw();
}

export function setupInput(): void {
  onHintRestore(updatePreview);
  $('#confirm-cancel').onclick = () => {
    dropProposal();
    updatePreview();
    redraw();
  };
  $('#confirm-build').onclick = () => {
    if (!proposal) return;
    // As a tap on the proposed spot, this one meant.
    setDrag({ start: proposal.at, end: proposal.at });
    confirming = true;
    try {
      applyTool();
    } finally {
      confirming = false;
    }
    setDrag(null);
    updatePreview();
  };
  const canvas = renderer.canvas;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') mouseAt = { x: e.clientX, y: e.clientY };
  }, { passive: true });
  window.addEventListener('pointerdown', (e) => (lastPress = e.pointerType), { capture: true, passive: true });
  const pos = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const pointers = new Map<number, [number, number]>();
  /** When an edge arrow was last pressed (its double click's second press and zoom are left alone). */
  let edgePressed = -Infinity;
  let pinch: { dist: number; scale: number } | null = null;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    // An edge marker pressed (a target out of view): the map goes to the target, nothing else.
    if (e.button === 0 && pointers.size === 0) {
      const [ex, ey] = pos(e);
      const edge = renderer.edgeMarks.find((m) => Math.hypot(m.x - ex, m.y - ey) <= m.r + 8);
      if (edge) {
        e.preventDefault();
        edgePressed = performance.now();
        centerOn(Math.floor(edge.tx), Math.floor(edge.ty), 0, mapBand()); // (landing where nothing covers it)
        return;
      }
      // (A double click's second press: the arrow has gone with the flight, and it stopped the flight and opened
      // the card of whatever tile was under it.)
      if (performance.now() - edgePressed < 450) {
        e.preventDefault();
        return;
      }
    }
    pointerAt = { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' };
    { const [qx, qy] = pos(e); pressedAt = [cam.x + qx / cam.scale, cam.y + qy / cam.scale]; }
    stopFlight();
    // Text left selected (a drag from the pane onto the map) made the browser cancel every drag after.
    if (!document.getSelection()?.isCollapsed) document.getSelection()?.removeAllRanges();
    canvas.setPointerCapture(e.pointerId);
    // The press that puts the tools' card away only does that (and pans), with a finger or a mouse: it never builds
    // — the card was being looked through, and nothing undoes a build (it laid a road where the card was clicked off).
    const dismissed = closeTray();
    const [px, py] = pos(e);
    pointers.set(e.pointerId, [px, py]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a![0] - b![0], a![1] - b![1]), scale: cam.scale };
      setDrag({ start: [0, 0], end: [0, 0], pan: { x: cam.x, y: cam.y, cx: (a![0] + b![0]) / 2, cy: (a![1] + b![1]) / 2 } });
      return;
    }
    const t = snapToSpot(px, py, renderer.toTile(cam, px, py));
    const looking = tool.kind === 'query' || tool.kind === 'route' || tool.kind === 'mic';
    // (A looking tool may look at once: only building waits for a second touch.)
    const panning = e.button === 1 || e.button === 2 || !!drive || (dismissed && !looking); // while driving the map only pans
    if (!panning && grabDisaster(t)) return;
    // Looking tools: a drag moves the map, a tap looks (it stays a tap until the pointer moves a few pixels).
    const tap = !panning && looking;
    setDrag({ start: t, end: t, pan: panning || tap ? { x: cam.x, y: cam.y, cx: px, cy: py, tap } : undefined });
    updatePreview();
  });
  /** The map's cursor before the pointer went over an edge arrow (null: not over one). */
  let edgeCursor: string | null = null;
  canvas.addEventListener('pointermove', (e) => {
    pointerAt = { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' };
    const [px, py] = pos(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [px, py]);
    if (pinch && pointers.size === 2 && drag?.pan) {
      const [a, b] = [...pointers.values()];
      const cx = (a![0] + b![0]) / 2;
      const cy = (a![1] + b![1]) / 2;
      const scale = Math.max(minScale(), Math.min(48, pinch.scale * (Math.hypot(a![0] - b![0], a![1] - b![1]) / pinch.dist)));
      const wx = drag.pan.x + drag.pan.cx / pinch.scale;
      const wy = drag.pan.y + drag.pan.cy / pinch.scale;
      cam.scale = scale;
      cam.x = wx - cx / scale;
      cam.y = wy - cy / scale;
      redraw();
      return;
    }
    // A right click during a drag cancels it, as Esc does (the habit from SimCity).
    if (drag && !drag.pan && pointers.size === 1 && e.buttons & 2) {
      setDrag(null);
      updatePreview();
      redraw();
      return;
    }
    const at = snapToSpot(px, py, renderer.toTile(cam, px, py));
    renderer.cursor = null; // the pointer has the map again
    // On to another tile: an informative message gives way to that tile's reading.
    if ((!hover || hover[0] !== at[0] || hover[1] !== at[1]) && flashYields()) endFlash();
    setHover(at);
    if (steering !== null) {
      city.steerDisaster(steering, at[0], at[1]);
      redraw();
      return;
    }
    if (drag?.pan?.tap && Math.hypot(px - drag.pan.cx, py - drag.pan.cy) > 6) drag.pan.tap = false;
    if (drag?.pan && !drag.pan.tap) {
      cam.x = drag.pan.x - (px - drag.pan.cx) / cam.scale;
      cam.y = drag.pan.y - (py - drag.pan.cy) / cam.scale;
    } else if (drag) {
      // Shift keeps a line straight: the end stays on the start's row or column, whichever the drag is nearer.
      const line = LINE_KINDS.has(tool.kind);
      const to: [number, number] = line && e.shiftKey
        ? (Math.abs(at[0] - drag.start[0]) >= Math.abs(at[1] - drag.start[1]) ? [at[0], drag.start[1]] : [drag.start[0], at[1]])
        : at;
      drag.end = tool.kind === 'network' ? toEdge(drag.start, to) : to;
      // The way it first leaves the start tile sets the bend (back on the start, it can be set again).
      if (to[0] === drag.start[0] && to[1] === drag.start[1]) drag.vertical = undefined;
      else drag.vertical ??= Math.abs(to[1] - drag.start[1]) > Math.abs(to[0] - drag.start[0]);
    }
    updatePreview();
    // Over a target's arrow at the map's edge: it is pressed, so it says so, and where it leads.
    const edge = !drag && !pointers.size && e.pointerType !== 'touch' ? renderer.edgeMarks.find((m) => Math.hypot(m.x - px, m.y - py) <= m.r + 8) : undefined;
    if (edge) {
      edgeCursor ??= canvas.style.cursor;
      canvas.style.cursor = 'pointer';
      // (Not the tool's footprint and price under it: pressed, it goes there, it doesn't build.)
      setPreview(null);
      $('#cursor-tag').hidden = true;
      // (Not over a message still showing: a refusal went, and its red stayed on these words.)
      if (!flashing()) $('#hint').textContent = `눌러서 그곳으로 가기${edge.label ? `: ${edge.label}` : ''}`;
    } else if (edgeCursor !== null) {
      canvas.style.cursor = edgeCursor;
      edgeCursor = null;
    }
    redraw();
  });
  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (steering !== null) {
      // Let go: the disaster's own pathfinding takes over again.
      city.releaseDisaster(steering);
      setSteering(null);
      return;
    }
    if (pinch) {
      if (pointers.size === 0) {
        pinch = null;
        setDrag(null);
      } else {
        // One finger still down: it pans on from where the view is now (the
        // pinch's anchor would jump it back), and never builds.
        const [rest] = [...pointers.values()];
        setDrag({ start: [0, 0], end: [0, 0], pan: { x: cam.x, y: cam.y, cx: rest![0], cy: rest![1], tap: false } });
      }
      return;
    }
    // A right click that didn't move the map puts the tool down (back to looking), as in other city builders.
    if (e.button === 2 && drag?.pan && Math.hypot(cam.x - drag.pan.x, cam.y - drag.pan.y) * cam.scale < 4 && tool.kind !== 'query' && !drive) {
      setDrag(null);
      selectTool('query');
      return;
    }
    if (drag && (!drag.pan || drag.pan.tap)) applyTool();
    setDrag(null);
    updatePreview();
    redraw();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
    pinch = null;
    setDrag(null);
    // A gesture the browser took over lets go of a steered disaster too.
    if (steering !== null) {
      city.releaseDisaster(steering);
      setSteering(null);
    }
    updatePreview();
    redraw();
  });
  canvas.addEventListener('pointerleave', () => {
    setHover(null);
    updatePreview();
    redraw();
  });
  // A double click while looking goes in on that spot (as on a map); building tools keep theirs for building.
  canvas.addEventListener('dblclick', (e) => {
    if (tool.kind !== 'query' && tool.kind !== 'route') return;
    if (performance.now() - edgePressed < 700) return; // (on an edge arrow: its press flies, the zoom isn't wanted)
    const [px, py] = pos(e as unknown as PointerEvent);
    const r = canvas.getBoundingClientRect();
    const to = Math.min(48, cam.scale * 2);
    // The spot first pressed (the card the first click opened may have started the map gliding since):
    // it comes to rest under the pointer.
    cancelGlide();
    const [wx, wy] = pressedAt ?? [cam.x + px / cam.scale, cam.y + py / cam.scale];
    glideTo(wx + (r.width / 2 - px) / to, wy + (r.height / 2 - py) / to, to, 240);
  });
  // A touchpad as on a phone: two fingers moving move the map, pinched they zoom it (the browser sends a pinch as a
  // wheel with Ctrl; Safari as gestures, below). A mouse's wheel zooms, and with Ctrl or ⌘ any wheel does. Which it
  // is, is told once for a run of events (a pause of 300 ms ends one): a fast flick of two fingers went on to look
  // like a wheel's notches, and the map began to zoom in the middle of a pan.
  let wheelRun = { pad: false, at: -Infinity };
  canvas.addEventListener('wheel', (e) => {
    stopFlight();
    e.preventDefault();
    const [px, py] = pos(e);
    const now = performance.now();
    if (now - wheelRun.at > 300) wheelRun.pad = fromTouchpad(e);
    wheelRun.at = now;
    if (e.ctrlKey || e.metaKey || !wheelRun.pad) {
      // (Lines and pages in pixels' worth; a Mac's wheel by its notches, each as a notch elsewhere (100 px); a burst
      // of them no more than three notches at once.)
      const step = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : !wheelRun.pad && e.deltaY % MAC_NOTCH === 0 ? 100 / MAC_NOTCH : 1;
      const d = Math.max(-300, Math.min(300, e.deltaY * step));
      zoomAt(Math.exp(-d * (e.ctrlKey && wheelRun.pad ? 0.01 : 0.0015)), px, py);
      return;
    }
    cam.x += e.deltaX / cam.scale;
    cam.y += e.deltaY / cam.scale;
    redraw();
  }, { passive: false });
  // Safari's touchpad pinch, as a gesture (not while fingers are down on a touch screen: those pinch above).
  let gestureScale = 1;
  const gesture = (e: Event) => {
    e.preventDefault();
    // (Each pinch starts from its own 1, even one begun with a press held, which skipped the reset.)
    if (e.type !== 'gesturechange') gestureScale = 1;
    if (pointers.size) return;
    const g = e as Event & { scale?: number; clientX?: number; clientY?: number };
    if (e.type === 'gesturechange' && g.scale && g.clientX !== undefined && g.clientY !== undefined) {
      const r = canvas.getBoundingClientRect();
      stopFlight();
      zoomAt(g.scale / gestureScale, g.clientX - r.left, g.clientY - r.top);
      gestureScale = g.scale;
    }
  };
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) canvas.addEventListener(type, gesture);
  // The map's zoom buttons: about the view's centre.
  const centre = (): [number, number] => [canvas.clientWidth / 2, canvas.clientHeight / 2];
  // Buttons and keys glide (a wheel or a pinch follows the hand as it is) — about the middle of the map that shows
  // (beside the city pane, between the bars), not the canvas's, much of which lies under them. (glideTo places the
  // tile at the canvas's middle: the band's middle tile stays put.)
  const zoomBy = (factor: number) => {
    const [px, py] = centre();
    const b = mapBand();
    const [bx, by] = [(b.left + b.right) / 2, (b.top + b.bottom) / 2];
    const to = Math.max(minScale(), Math.min(48, cam.scale * factor));
    glideTo(cam.x + bx / cam.scale - (bx - px) / to, cam.y + by / cam.scale - (by - py) / to, to);
  };
  const fitGlide = () => {
    const was = { ...cam };
    fitCamera(true);
    const [px, py] = centre();
    const target = { cx: cam.x + px / cam.scale, cy: cam.y + py / cam.scale, scale: cam.scale };
    Object.assign(cam, was);
    glideTo(target.cx, target.cy, target.scale, 300);
  };
  $('#zoom-in').onclick = () => zoomBy(1.4);
  $('#zoom-out').onclick = () => zoomBy(1 / 1.4);
  $('#zoom-fit').onclick = fitGlide;

  /** Asks for a cheat code and says what it did. */
  const cheatConsole = async () => {
    const code = await askText('치트 적용', '치트 코드');
    if (!code) return;
    const res = city.cheat(code);
    if (!res.ok) {
      flash(ko(res.message ?? 'unknown cheat'), 'bad');
      return;
    }
    flash(CHEAT_DONE[res.cheat!] ?? '치트를 적용했습니다');
    updatePanels();
    redraw();
  };
  window.addEventListener('keydown', (e) => {
    // Not while typing, nor behind an open dialog (it has the keys).
    if (keyForControl(e) || document.querySelector('dialog[open]')) return;
    if (e.key >= '0' && e.key <= '3') chooseSpeed(Number(e.key));
    // Space pauses and resumes at the speed it had (while driving, Space is the vehicle's action).
    if (e.key === ' ' && !drive && !(e.target as HTMLElement).closest('button, summary, a, label, [role=button], [role=option]')) {
      e.preventDefault();
      chooseSpeed(speed > 0 ? 0 : runningSpeed);
    }
    // Ctrl+S saves to the browser (the ⋯ menu's 저장; a region saves all its cities), not the page.
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      $<HTMLButtonElement>('#btn-save').click();
      return;
    }
    // Letters by the key's place (with the Korean keyboard on, B arrives as ㅠ).
    // (A Latin letter as typed, so AZERTY's Z is Z; by the key's place only when it types something else.)
    const letter = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
    if (letter === 'n' && !e.ctrlKey && !e.metaKey) toggleNight();
    // G: 개발·수요 on its 개발 막힘 tab (what keeps zones empty), or back. (No key of its own for the map's view: a goal's
    // tab puts it on.)
    if (letter === 'g' && !e.ctrlKey && !e.metaKey) toggleGrowthTab();
    // M: the goal most in need of action (its screen), or back to the overview.
    // (By the key's place, so it works with the Korean keyboard on too; not held down, nor while driving.)
    if (e.code === 'KeyM' && plain0(e) && !e.repeat && !drive) toggleUrgentGoal();
    // [ and ]: the open goal's tab before or after, its map view with it.
    if ((e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey) stepTab(e.key === ']' ? 1 : -1);
    // Home: the whole city in view (like the ⤢ button).
    if (e.key === 'Home') fitGlide();
    // + / − zoom about the view's centre (Ctrl with them is the browser's own zoom).
    if (!e.ctrlKey && !e.metaKey && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_')) {
      zoomBy(e.key === '+' || e.key === '=' ? 1.4 : 1 / 1.4);
    }
    if (e.key === '?') showHelp();
    // /: find a tool or facility by name.
    if (e.key === '/' && plain0(e) && !drag) {
      e.preventDefault();
      openFind();
      return;
    }
    // Enter (not on a control): look at the tile in the middle of the view — arrows move the map to it.
    // (The map itself takes focus now — the skip link, a click on it — and is no control.) The middle of the map that
    // shows: the canvas's lies near the city pane's edge.
    if (e.key === 'Enter' && plain0(e) && tool.kind === 'query' && !(e.target as Element).closest?.('button, a, summary, input, select, textarea, [tabindex]:not(#map)')) {
      const b = mapBand();
      const [cx, cy] = renderer.toTile(cam, (b.left + b.right) / 2, (b.top + b.bottom) / 2);
      if (cx >= 0 && cy >= 0 && cx < city.size && cy < city.size) {
        showInfo(cx, cy);
        redraw();
        // From the keyboard: carry on in the card (it opened beside the map, out of the Tab order's way).
        requestAnimationFrame(() => (document.querySelector<HTMLElement>('#info-card .info-title strong') ?? document.querySelector<HTMLElement>('#info-card h2[tabindex]'))?.focus());
      }
    }
    // The cheat console (Ctrl+Shift+X here; Ctrl+Alt+Shift+X in the game): gameplay cheats.
    if (e.ctrlKey && e.shiftKey && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      cheatConsole();
    }
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    let shortcut = plain ? TOOL_KEYS[letter] : undefined;
    // The zone keys again step through the densities (Z: 저 → 중 → 고밀도).
    const cycle = shortcut && DENSITY_CYCLE.find((c) => c.includes(shortcut!));
    if (cycle && cycle.includes(tool.id)) shortcut = cycle[(cycle.indexOf(tool.id) + 1) % cycle.length];
    if (shortcut && !drag) selectTool(shortcut); // not mid-drag: the new tool would take the old rectangle
    if (plain && (e.key === ',' || e.key === '.') && !drag) stepAlt(e.key === '.' ? 1 : -1);
    // `: back to the tool before (a road, then the bulldozer, then the road again).
    if (plain && e.key === '`' && !drag) selectTool(previousTool);
    // B: the pane's 재정·정책 (or back from it); J: the 지역 sheet (the pane's head, the menu), open or closed.
    if (plain && letter === 'b') toggleFinance();
    if (plain && letter === 'j') toggleSheet('region');
    // S: the cursor onto the recommended spot (the blue target), to build there from the keyboard (driving, S steers).
    if (plain && letter === 's' && !drag && !drive && keySpot()) return;
    // Esc: cancel a drag, else close the topmost card, else put the tool down.
    if (e.key === 'Escape') {
      const menu = document.querySelector<HTMLDetailsElement>('details.dropdown[open]');
      if (proposal) dropProposal();
      else if (drag) setDrag(null);
      else if (menu) menu.open = false; // (opened by a press, which leaves focus outside it: its own Esc didn't hear)
      else if (document.querySelector('.mb-time.open')) closeClock(); // (a phone's speeds' card, first: it is the topmost)
      else if (!closeTray(true) && !closeTopLayer(!wideScreen())) {
        // Then the tool goes down, then the goal's screen gives way to the overview — and wide, where the pane is
        // beside the map rather than a sheet over it, then the pane goes (a screen put away with it ends after).
        if (tool.id !== 'query') selectTool('query');
        else if (wideScreen() && activeGoal && paneShown()) closeGoal();
        else if (!(wideScreen() && dismissPane())) closeGoal();
      }
      updatePreview();
      redraw();
    }
    // Building from the keyboard: with a building tool in hand, the arrows move a cursor
    // tile by tile (Shift: 5) and the map follows it; Enter builds there (a drag's
    // tools take two: the start, then the end; Esc lets go).
    if (keyBuild(e)) return;
    // (Not while a panel has focus: its own arrows scroll or step it.)
    // (The card's title, focused by Enter's look, isn't a control: the arrows go on moving the map from it.)
    const pan = (e.target as Element).closest?.('#pane, #sheet, #info-card, #tray') && !(e.target as Element).matches?.('.info-title strong') ? 0 : 40 / cam.scale;
    if (e.key === 'ArrowLeft') cam.x -= pan;
    if (e.key === 'ArrowRight') cam.x += pan;
    if (e.key === 'ArrowUp') cam.y -= pan;
    if (e.key === 'ArrowDown') cam.y += pan;
    redraw();
  });
  window.addEventListener('resize', () => {
    // Keep the same map point at the centre of the view.
    const before = { width: renderer.canvas.width / renderer.dpr, height: renderer.canvas.height / renderer.dpr };
    const cx = cam.x + before.width / 2 / cam.scale;
    const cy = cam.y + before.height / 2 / cam.scale;
    renderer.resize();
    const after = renderer.canvas.getBoundingClientRect();
    cam.x = cx - after.width / 2 / cam.scale;
    cam.y = cy - after.height / 2 / cam.scale;
    redraw();
  });
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
/** Tools built by dragging: from the keyboard, Enter at the start and again at the end. */
const DRAGGED = new Set(['zone', 'network', 'bulldoze', 'powerline', 'pipe', 'unpipe', 'subway', 'unsubway', 'elevated', 'level', 'trees', 'terraform']);

/**
 * The keyboard cursor onto the held tool's recommended spot — the blue target the mouse can fly to by its edge arrow —
 * with the map flying there: for a zone the block's top-left corner, where its drag starts; for a line the route's
 * start. What to press next is said (and read out). False when nothing is marked.
 */
function keySpot(): boolean {
  if (tool.kind === 'query' || tool.kind === 'route' || tool.kind === 'mic' || steering !== null) return false;
  // (A goal screen's marks are its own, built on by its buttons, which Tab reaches.)
  if (activeGoal) {
    flash('관리 화면의 추천 자리는 화면의 "추천 자리에 짓기"·"여기에 짓기" 버튼이 짓습니다 (Tab으로 이동)');
    return true;
  }
  const spots = renderer.marks.filter((m) => m.tone === 'spot');
  // (A route drawn end to end — a power line, a pipe, the road to the neighbours: its start, and how far the end is.)
  const line = !!renderer.guidePath && spots.length === 2;
  // (Two for a bus stop, its home and work sides: S again goes to the other.)
  const on = line ? -1 : spots.findIndex((m) => renderer.cursor?.x === m.x && renderer.cursor?.y === m.y);
  const spot = spots[(on + 1) % spots.length];
  if (!spot) {
    flash(`지금은 ${toolName(tool)}의 추천 자리가 없습니다`);
    return true;
  }
  const area = tool.kind === 'zone' ? renderer.marks.find((m) => m.tone === 'area') : undefined;
  const at: [number, number] = area ? [area.x, area.y] : [spot.x, spot.y];
  // (Off the button that picked the tool, so Enter builds rather than pressing it again; off a notice too, which Enter
  // would open.)
  if ((document.activeElement as Element | null)?.closest('button, a, summary, [role=button], .toast')) (document.activeElement as HTMLElement).blur();
  setHover(at);
  renderer.cursor = { x: at[0], y: at[1] };
  centerOn(at[0], at[1], undefined, mapBand());
  // (The cost and warnings beside the cursor once the map is there — unless the mouse took over meanwhile.)
  setTimeout(() => {
    if (hover?.[0] !== at[0] || hover?.[1] !== at[1]) return;
    const r = renderer.canvas.getBoundingClientRect();
    pointerAt = { x: r.left + (at[0] + 0.5 - cam.x) * cam.scale, y: r.top + (at[1] + 0.5 - cam.y) * cam.scale, touch: false };
    updatePreview();
    redraw();
  }, 380);
  updatePreview();
  redraw();
  // (Where the far end is, in tiles: the target can't be seen by everyone who builds from the keyboard.)
  const toward = (dx: number, dy: number) => [dx && `${dx > 0 ? '오른쪽' : '왼쪽'} ${fmt(Math.abs(dx))}칸`, dy && `${dy > 0 ? '아래' : '위'} ${fmt(Math.abs(dy))}칸`].filter(Boolean).join('·');
  const end = line ? spots[1] : undefined;
  const next = area ? `구역의 왼쪽 위 모서리입니다 · Enter 뒤 ${toward(area.w - 1, area.h - 1)} 옮겨 다시 Enter`
    : end ? `경로의 시작점입니다 · 끝점은 ${toward(end.x - at[0], end.y - at[1])}`
    : `Enter로 이 자리에 짓습니다${spots.length > 1 ? ' · S를 다시 누르면 다른 추천 자리' : ''}`;
  flash(`${end?.label || spot.label || '추천 자리'} — ${next}`);
  return true;
}

function keyBuild(e: KeyboardEvent): boolean {
  const arrow = ARROWS[e.key];
  if (!arrow && e.key !== 'Enter') return false;
  if (e.ctrlKey || e.metaKey || e.altKey || drive || steering !== null) return false;
  if (tool.kind === 'query' || tool.kind === 'route' || tool.kind === 'mic') return false;
  if ((e.target as Element).closest?.('#pane, #sheet, #info-card, #tray, input, select, textarea, dialog, #find')) return false;
  if (e.key === 'Enter' && (e.shiftKey || (e.target as Element).closest?.('button, a, summary, [role=button]:not(#map)'))) return false;
  if (drag?.pan) return false;
  e.preventDefault();
  if (e.key === 'Enter' && e.repeat) return true; // held down: one build, not one per repeat
  if (arrow) stopFlight(); // the cursor's own following moves the map from here
  const n = city.size;
  // The part of the map that shows — beside the city pane, between the bars (on the canvas's edges the cursor went
  // under the pane and stayed there).
  const b = mapBand();
  const [L, T, R, B] = [b.left / cam.scale, b.top / cam.scale, b.right / cam.scale, b.bottom / cam.scale];
  // The cursor: where the pointer left it if that is in sight, else the middle of the view.
  const seen = (t: readonly [number, number] | null) =>
    !!t && t[0] >= Math.ceil(cam.x + L) && t[1] >= Math.ceil(cam.y + T) && t[0] < Math.floor(cam.x + R) && t[1] < Math.floor(cam.y + B);
  let at: [number, number] = seen(hover) ? [hover![0], hover![1]] : renderer.toTile(cam, (b.left + b.right) / 2, (b.top + b.bottom) / 2);
  if (arrow) {
    // Off the dock button that picked the tool, so the next Enter builds rather than pressing it again (or opening the
    // notice in focus).
    if ((document.activeElement as Element | null)?.closest('button, a, summary, [role=button], .toast')) (document.activeElement as HTMLElement).blur();
    const k = e.shiftKey ? 5 : 1;
    at = [Math.max(0, Math.min(n - 1, at[0] + arrow[0] * k)), Math.max(0, Math.min(n - 1, at[1] + arrow[1] * k))];
    // The map follows, keeping two tiles of room inside the part that shows.
    const m = 2;
    if (at[0] < cam.x + L + m) cam.x = at[0] - m - L;
    if (at[0] + 1 > cam.x + R - m) cam.x = at[0] + 1 + m - R;
    if (at[1] < cam.y + T + m) cam.y = at[1] - m - T;
    if (at[1] + 1 > cam.y + B - m) cam.y = at[1] + 1 + m - B;
    if (drag) {
      drag.end = tool.kind === 'network' ? toEdge(drag.start, at) : at;
      if (at[0] === drag.start[0] && at[1] === drag.start[1]) drag.vertical = undefined;
      else drag.vertical ??= Math.abs(at[1] - drag.start[1]) > Math.abs(at[0] - drag.start[0]);
    }
  }
  setHover(at);
  renderer.cursor = { x: at[0], y: at[1] };
  // The cost and warnings show beside the cursor, as they do beside the pointer.
  const r = renderer.canvas.getBoundingClientRect();
  pointerAt = { x: r.left + (at[0] + 0.5 - cam.x) * cam.scale, y: r.top + (at[1] + 0.5 - cam.y) * cam.scale, touch: false };
  if (e.key === 'Enter') {
    if (!drag) {
      setDrag({ start: at, end: at });
      if (!DRAGGED.has(tool.kind)) {
        applyTool();
        setDrag(null);
      }
    } else {
      applyTool();
      setDrag(null);
    }
  }
  updatePreview();
  redraw();
  const sr = document.getElementById('sr-status');
  if (sr && arrow) sr.textContent = `${at[0]}, ${at[1]} ${describeTile(at[0], at[1])}`;
  if (sr && e.key === 'Enter' && drag) sr.textContent = '시작점을 정했습니다. 방향키로 끝점까지 옮기고 Enter로 짓습니다 (Esc: 취소).';
  return true;
}

/** Where the mouse last was anywhere on the page, and what last pressed (a finger's tap has no mouse to follow). */
let mouseAt: { x: number; y: number } | null = null;
let lastPress = '';

/**
 * The map under a mouse that hasn't moved: a tray closing after a pick
 * leaves the pointer over the map, and the new tool's stamp shows there at
 * once (not where the pointer last crossed the map).
 */
export function hoverUnderMouse(): void {
  if (!mouseAt || drag || touchFirst() || lastPress !== 'mouse') return;
  if (document.elementFromPoint(mouseAt.x, mouseAt.y) !== renderer.canvas) return;
  const r = renderer.canvas.getBoundingClientRect();
  setHover(renderer.toTile(cam, mouseAt.x - r.left, mouseAt.y - r.top));
  pointerAt = { x: mouseAt.x, y: mouseAt.y, touch: false };
  updatePreview();
  redraw();
}

export function setPreview(v: typeof preview): void {
  preview = v;
}
