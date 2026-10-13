// The info panel: tile queries, route queries, ordinances and facility funding.

import { type Building, DEFAULT_CONFIG, DEV_TYPES, type DevType, type OrdinanceId, ORDINANCES, serviceRadius, type Structure, type StructureKind, STRUCTURES, type TripMeans } from '@web-city/engine';
import { icon } from './icons';
import { type AirSource, airShareOf, airSourcesAt, budgetMends, facilityLine, waterSourcesOn, hasRoadNow, jamRun, widenTo, type Lay, LAY_WORD, layCost, lineToStructure, powerToSpare, readStats, relieverFor, roadToFacility, siteAwayFromHomes, siteByPlants, siteNear, siteOnPipes } from './readings';
import { ko } from './messages';
import { renderMySims, SIM_NAMES, thoughtChips } from './mysims';
import { ABANDON_NAME, FACTOR_NAME, GROWTH_FIX, MAYOR_NAME, MEANS_NAME, NETWORK_NAME, ORDINANCE_NAME, STRUCTURE_NAME, TYPE_NAME, ZONE_NAME } from './names';
import { updatePanels } from './panels';
import { ROUTE_COLOR, structureColor, TYPE_COLOR, zoneTint } from './render';
import { cam, city, cityGeneration, clampCamera, flightCount, moveCount, overlay, overlayType, redraw, renderer, setSelected, stopFlight } from './state';
import { closeInfo, showTab } from './tabs';
import { $, escapeHtml, flash, fmt, glue, hours, josa, pct, touchFirst } from './util';
import { refreshTaxes } from './controls';
import { toolGlyph, TOOLS } from './tools';
import { choice, remember } from './undo';
import { coverageRadius, overlayReading } from './views';
import { type GoalId, goalOfStructure, GOALS, goalsOfOrdinance } from './goals';
import { active } from './manage';

/** Why a Route Query found no trips here. */
function none(b: Building | null | undefined): string {
  // An occupied home with no trips: its workers found no job they could reach (the census still counts them).
  // Workers who did find work (the building's own commute) but no sampled trip: say that, not that nobody found work.
  if (b?.type?.[0] === 'R' && b.occupancy > 0 && b.commute >= 0 && !b.noJobMonths) return `지난달 이 집의 통근은 경로 표본에 들지 않았습니다(통근 ${hours(b.commute)}). 근처 도로나 일터를 조회하면 오가는 경로가 보입니다.`;
  if (b?.type?.[0] === 'R' && b.occupancy > 0) return '지난달 이 집 주민은 일터를 찾지 못했습니다: 닿는 곳의 일자리가 모두 찼습니다. 상업·산업 구역을 늘리거나 길·대중교통으로 더 멀리 이어 주세요.';
  if (b?.type && b.occupancy > 0) return '지난달 이곳에 출근한 사람이 없습니다: 일할 주민이 닿지 못합니다.';
  return '이곳을 오가는 통행이 없습니다.';
}

/** Route Query: draw the trips from, to or across a tile and list them by means. */
export function showRoutes(x: number, y: number): void {
  showTab('info');
  shown = null;
  const r = city.routeQuery(x, y);
  renderer.routes = r.trips;
  const q = city.query(x, y);
  setSelected(q?.building ?? q?.structure ?? { x, y, w: 1, h: 1 });
  const total = Object.values(r.byMeans).reduce((a, b) => a + b, 0);
  const what = q?.name ? q.name : q?.building?.type ? `${TYPE_NAME[q.building.type]} 건물` : q?.structure ? STRUCTURE_NAME[q.structure.kind] : q?.network ? NETWORK_NAME[q.network] : '빈 땅';
  $('#info').innerHTML = `<p><b>경로 조회</b> · ${escapeHtml(what)}</p>
    ${total ? `<table>${(Object.entries(r.byMeans) as [TripMeans, number][]).sort((a, b) => b[1] - a[1])
      .map(([m, v]) => `<tr><td><span class="swatch" style="background:${ROUTE_COLOR[m]}"></span>${MEANS_NAME[m]}</td><td>${v < 10 ? v.toFixed(1) : fmt(v)}${m === 'freight' ? '/일' : '명'}</td></tr>`).join('')}</table>
      <p class="legend">집은 출근하는 사람들, 일터는 도착하는 사람들, 도로는 그 위를 지나는 통행을 보여 줍니다. 진할수록 많은 통행입니다(가장 많은 ${r.trips.length}개 경로).${q?.network && !q.building && !q.structure ? ' 여기 수는 지난달 이 길로 오간 사람이라, 정보 카드의 하루 통행(차량 수, 몇 달 평균, 저녁 퇴근·화물 포함)과 다릅니다.' : ''}</p>`
    : `<p class="muted">${none(q?.building)}</p>`}`;
  redraw();
}

/** The card now shows something else (an interview): no more refreshing of the last query. */
export function forgetInfo(): void {
  shown = null;
}

/** The tile the info card shows, what stood there, and the city state it showed. */
let shown: { x: number; y: number; occupant: number; key: string } | null = null;
const infoKey = () => `${city.revision}|${Math.floor(city.state.day / 30)}|${city.state.fires.length}`;

/**
 * Keeps the info card current as the city changes: closes it when what it
 * showed is gone (bulldozed, burnt, redeveloped), else redraws it after edits
 * and each month. Not while the player is using a control in it.
 */
/** Redraws the open card at once, after one of its own buttons (refreshInfo waits for the city to change and for focus to leave the card). */
export function redrawInfo(): void {
  if (shown && !$('#info-card').hidden) showInfo(shown.x, shown.y);
}

export function refreshInfo(): void {
  if ($('#info-card').hidden) shown = null; // closed: whatever opens it next starts afresh
  if (!shown) return;
  const { x, y } = shown;
  if (x >= city.size || y >= city.size) return void closeInfo();
  const occupant = city.state.occupant[y * city.size + x]!;
  if (shown.occupant && occupant !== shown.occupant) return void closeInfo();
  if (infoKey() === shown.key || $('#info').contains(document.activeElement)) return;
  showInfo(x, y);
}

/**
 * Pans the map so a tapped spot isn't left under the card that opened for it
 * (a bottom sheet on phones, the right-hand card on wide screens).
 */
export function keepInView(r: { x: number; y: number; w: number; h: number }): void {
  const card = $('#info-card');
  if (card.hidden) return;
  const v = renderer.canvas.getBoundingClientRect();
  // Where the card comes to rest (offsets ignore the slide-in transform, which put it off to the side just now).
  const left = v.left + card.offsetLeft;
  const top = v.top + card.offsetTop;
  const c = { left, top, right: left + card.offsetWidth, bottom: top + card.offsetHeight };
  const sx = v.left + (r.x + r.w / 2 - cam.x) * cam.scale;
  const sy = v.top + (r.y + r.h / 2 - cam.y) * cam.scale;
  // A sheet rising from below: centre the spot in the map above it; else beside the card.
  // The camera glides there (a jump made the next click land somewhere else).
  const below = c.top > v.top + v.height / 4;
  // Clear of the card with room to spare (the zoom buttons sit beside it): the whole lot, not just its middle.
  const margin = 64;
  const far = (r.x + r.w - cam.x) * cam.scale + v.left + margin;
  const low = (r.y + r.h - cam.y) * cam.scale + v.top + margin;
  if (below ? low < c.top || sy > c.bottom : far < c.left || sx > c.right || sy < c.top || sy > c.bottom) return;
  // (To where the map may go: past its edge the frame's clamp moved it back, and it didn't end where it was sent.)
  const [ox, oy] = [cam.x, cam.y];
  cam.x += below ? 0 : (sx - (v.left + (c.left - v.left) / 2)) / cam.scale;
  cam.y += below ? (sy - (v.top + (c.top - v.top) / 2)) / cam.scale : 0;
  clampCamera();
  const [dx, dy] = [cam.x - ox, cam.y - oy];
  [cam.x, cam.y] = [ox, oy];
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) return;
  // (Kept, to give back when the card goes — added to a move it made for the lot before, if nothing moved it since.)
  const was = shiftedFor && untouched(shiftedFor) ? shiftedFor : { dx: 0, dy: 0 };
  glide(dx, dy);
  shiftedFor = { dx: was.dx + dx, dy: was.dy + dy, x: ox + dx, y: oy + dy, scale: cam.scale, moves: moveCount(), city: cityGeneration };
}

/** How far keepInView moved the camera for the card, where it left it, and the game's camera moves and city then. */
let shiftedFor: { dx: number; dy: number; x: number; y: number; scale: number; moves: number; city: number } | null = null;
/** Left where the card put it (or on its way there): not moved since by the player, nor by a flight or framing begun since. */
const untouched = (s: { x: number; y: number; scale: number; moves: number; city: number }) => {
  const at = gliding ?? cam;
  return s.moves === moveCount() && s.city === cityGeneration && Math.abs(at.x - s.x) < 1e-3 && Math.abs(at.y - s.y) < 1e-3 && cam.scale === s.scale;
};

/**
 * The card closing: the camera back where it was before the card moved it, unless the player has moved it since.
 * (On a phone the sheet lifted the town into the top half, and closed it left it there over a black lower half.)
 * Not when another move has begun since — a flight to a site, another city's framing — which it pulled back.
 */
export function giveBackView(): void {
  const s = shiftedFor;
  shiftedFor = null;
  if (s && untouched(s)) glide(s.x - s.dx - cam.x, s.y - s.dy - cam.y);
}

/** Moves the camera by (dx, dy) tiles over 220ms, easing out; any other camera move after it stops it. */
let glideId = 0;
/** Where a glide under way is taking the camera (null when none is). */
let gliding: { x: number; y: number } | null = null;
/** Stops a glide under way (another camera move takes over: a double click's zoom). */
export function cancelGlide(): void {
  glideId++;
  gliding = null;
}
function glide(dx: number, dy: number): void {
  const from = { x: cam.x, y: cam.y };
  const start = performance.now();
  const id = ++glideId;
  stopFlight(); // (a flight under way gives way to it, as it gives way to one begun after it)
  const flight = flightCount();
  gliding = { x: from.x + dx, y: from.y + dy };
  const step = (now: number) => {
    if (id !== glideId) return;
    if (flight !== flightCount()) return void (gliding = null);
    const k = Math.min(1, (now - start) / 220);
    const e = 1 - (1 - k) ** 3;
    cam.x = from.x + dx * e;
    cam.y = from.y + dy * e;
    redraw();
    if (k < 1) requestAnimationFrame(step);
    else gliding = null;
  };
  requestAnimationFrame(step);
}

/**
 * How long trips from this tile take: what its zone cares about (homes the
 * commute to the nearest workplace, industry freight out of town), both on
 * land not zoned for either.
 */
function tripRow(zone: string, commute: number | null, freight: number | null): string {
  const r = zone.startsWith('R');
  const i = zone.startsWith('I');
  const parts = [!i && `<span class="nw">통근 ${hours(commute)}</span>`, !r && `<span class="nw">화물 ${hours(freight)}</span>`].filter(Boolean).join(' · ');
  return `<tr><td title="통근은 가장 가까운 일터까지, 화물은 도시 밖까지">${r ? '가까운 일터까지' : i ? '도시 밖까지 (화물)' : '걸리는 시간'}</td><td>${parts}</td></tr>`;
}

/**
 * Whose desirability an empty lot shows: the type that may grow there (its
 * zone's class) most wanted now, or the data view's type when it is one of
 * them; unzoned land, the data view's.
 */
function lotType(zone: string): DevType {
  const cls = zone.startsWith('R') ? 'R' : zone.startsWith('C') ? 'C' : zone.startsWith('I') ? 'I' : zone === 'A' ? 'A' : null;
  if (!cls) return overlayType;
  const types = DEV_TYPES.filter((t) => (cls === 'A' ? t === 'IA' : t[0] === cls && t !== 'IA'));
  if (types.includes(overlayType) && overlay.kind === 'desirability') return overlayType;
  return types.reduce((best, t) => (city.demand.demand[t] > city.demand.demand[best] ? t : best), types[0]!);
}

/** The My Sims who live or work in a building, named under its meter. */
function simsHere(id: number): string {
  const live = city.state.mySims.filter((m) => m.home === id).map((m) => escapeHtml(m.name));
  const work = city.state.mySims.filter((m) => m.job === id).map((m) => escapeHtml(m.name));
  const parts = [live.length && `${live.join(' · ')}의 집`, work.length && `${work.join(' · ')}의 일터`].filter(Boolean);
  return parts.length ? `<p class="info-sims">${icon('users')}My Sim: ${parts.join(' · ')}</p>` : '';
}

/** Whether the info card's 자세히 part was left open (kept from card to card). */
let infoMoreOpen = false;

export function showInfo(x: number, y: number): void {
  showTab('info');
  const q = city.query(x, y);
  const el = $('#info');
  // Another tile opens at its top (the last one's scroll hid the new title).
  if (shown?.x !== x || shown?.y !== y) {
    el.scrollTop = 0;
    $('#info-card').scrollTop = 0;
  }
  shown = null;
  if (!q) return;
  shown = { x, y, occupant: city.state.occupant[y * city.size + x]!, key: infoKey() };
  const b = q.building;
  setSelected(b ?? q.structure ?? { x, y, w: 1, h: 1 });
  const type = b?.type ?? b?.origType ?? lotType(q.zone);
  const d = q.desirability[type];
  const rows = factorRows(d.factors, FACTOR_NAME);
  const def = q.structure ? STRUCTURES[q.structure.kind] : null;
  const waterNeeded = !!b?.type && b.stage > city.cfg.services.waterStageCap[b.type];
  const where = [
    q.terrain === 'water' ? '물' : null,
    q.network ? NETWORK_NAME[q.network] : null,
    q.subway ? '지하철 선로' : null,
    q.elevated ? ({ elrail: '고가 철도', monorail: '모노레일', highway: '고가 고속도로' } as const)[q.elevated] : null,
    q.toll ? '톨게이트' : null,
    q.interchange ? (q.interchange === 'overpass' ? '입체 교차(연결 안 됨)' : '클로버형 교차로') : null,
    q.over ? `위로 ${{ street: '골목이', road: '도로가', avenue: '대로가', oneway: '일방통행로가' }[q.over]} 지나감(진입로로 연결)` : null,
    q.tunnel ? '터널' : null,
    q.bridge ? '다리' : null,
    q.lowBridge ? '낮은 다리(페리 통과 불가)' : null,
    q.subwayTransition ? '지하철↔고가 전환' : null,
  ].filter(Boolean).join(' · ');
  // The data view's value here (on a touch screen the hover hint that shows it never appears).
  const reading = overlay.kind !== 'none' ? overlayReading(city, overlay, x, y) : '';
  // Header: what is here, at a glance.
  const title = q.name
    ?? (b ? (b.type ? TYPE_NAME[b.type] : '버려진 건물') : q.structure ? STRUCTURE_NAME[q.structure.kind] : where || (ZONE_NAME[q.zone] || '빈 땅'));
  const swatch = b?.type ? TYPE_COLOR[b.type] : b ? '#5b5550' : q.structure ? structureColor(q.structure.kind) : q.network ? '#55565a' : q.terrain === 'water' ? '#5d8fc7'
    : q.zone !== 'none' ? zoneTint(q.zone) : '#cfd8b8';
  // What has no building colour of its own says what it is with a glyph (a bare grey square looked like a placeholder).
  const glyph = b ? null : q.structure ? null : q.network ? 'road' as const : q.terrain === 'water' ? 'waves' as const : q.zone !== 'none' ? 'zones' as const : 'terrain' as const;
  // A facility shows its tool's icon (a plain grey block vanished on the dark card).
  const facilityTool = q.structure ? TOOLS.find((t) => t.kind === 'structure' && t.category === def?.category
    && (!('only' in t) || !t.only || !!STRUCTURES[q.structure!.kind][t.only])) : undefined;
  const sub = b
    ? `${b.type && q.name ? `${TYPE_NAME[b.type]} · ` : ''}${b.stage}단계 · ${b.w}×${b.h}${b.origType !== b.type ? ` · 원래 ${TYPE_NAME[b.origType]}` : ''}`
    : q.structure ? `${q.name ? `${STRUCTURE_NAME[q.structure.kind]} · ` : ''}${q.structure.w}×${q.structure.h}${def?.upkeep && (def.category === 'park' || def.station) ? ` · 월 §${fmt(city.structureUpkeep(q.structure.id)?.total ?? 0)}` : ''}`
    : q.zone === 'landfill' ? '쓰레기 매립 구역'
    : ZONE_NAME[q.zone] ? (title === ZONE_NAME[q.zone] ? '빈 구역' : `${ZONE_NAME[q.zone]} 구역`) : '';
  // Roads and water: services and desirability don't apply, only the environment.
  const land = !!(b || q.structure) || (!q.network && q.terrain !== 'water');
  // A chip or glance item that belongs to a goal: pressed, its screen opens on this spot (as the table's rows do).
  const go = (goal: GoalId) => ` data-row-goal="${goal}" data-row-at="${x},${y}"`;
  // Over its places: past what it takes at full funding, one more beside it is the fix; within it, the budget is.
  const places = q.structure ? (def?.health ?? def?.school)?.capacity ?? 0 : 0;
  const over = q.structure && places > 0 && q.structure.load > q.structure.capacity && q.structure.capacity > 0 ? q.structure : null;
  const full = over && over.load > places ? over : null;
  // (Full funding mends it, as the guide judges: back within its places, or a strike's grade reached, then
  // beside one more if it is still over; a strike for want of funds alone has the budget too.)
  const fundable = q.structure && places > 0 && q.structure.capacity > 0 && (over || q.structure.strike) ? q.structure : null;
  const shortFunded = fundable && budgetMends(fundable, !!fundable.strike) ? fundable : null;
  const relieveKind = full ? relieverFor([full.x, full.y]) : null;
  const relieveAt = full && relieveKind ? siteNear(relieveKind, full.x + (full.w >> 1), full.y + (full.h >> 1)) : null;
  // A station's cells full and criminals let go for want of a jail (with room in one, arrests go there).
  const paroled = q.structure && def?.police?.radius && q.structure.capacity > 0 && q.structure.load >= q.structure.capacity ? city.state.safety.paroled ?? 0 : 0;
  const jail = paroled > 0 ? (Object.keys(STRUCTURES) as StructureKind[]).find((k) => STRUCTURES[k].police?.radius === 0 && city.isUnlocked(k) && city.placementsLeft(k) > 0) : undefined;
  const jailAt = jail ? siteAwayFromHomes(jail) : null;
  // A plant or pump while the city runs short of what it makes (under a tenth to spare): one more of it, where it
  // joins the grid or the pipes.
  const stats = q.structure && (def?.plant || def?.pump) ? readStats() : null;
  const spare = !stats ? null : def!.plant ? { have: stats.power.supply, need: stats.power.demand, goal: 'power' as const, what: '전력' }
    : { have: stats.water.supply, need: stats.water.demand, goal: 'water' as const, what: '물' };
  // (Tight as the pane says it: demand past 85% of supply, 여유 10% · 곧 모자람.)
  const tight = spare && spare.need > 0 && spare.need > spare.have * 0.85 ? spare : null;
  const moreAt = tight && q.structure ? (def!.plant ? siteByPlants(q.structure.kind) : siteOnPipes(q.structure.kind)) : null;
  const relieve = relieveKind && relieveAt ? { kind: relieveKind, at: relieveAt, text: `옆에 ${STRUCTURE_NAME[relieveKind]} 짓기`, where: '가장 가까운 길가 빈 땅에' }
    : jail && jailAt ? { kind: jail, at: jailAt, text: `${STRUCTURE_NAME[jail]} 짓기`, where: '주거지에서 떨어진 길가 빈 땅에' }
    : moreAt && q.structure ? { kind: q.structure.kind, at: moreAt, text: `${STRUCTURE_NAME[q.structure.kind]} 하나 더 짓기`, where: def!.plant ? '발전소 옆, 전력망에 닿는 길가 빈 땅에' : '수도관에 닿고 전기가 들어오는 빈 땅에' } : null;
  const offRoad = !!q.structure && !!def && def.garbage > 0 && !city.roadBeside(q.structure.x, q.structure.y, q.structure.w, q.structure.h);
  const roadPath = offRoad ? roadToFacility(q.structure!) : null;
  const roadCost = roadPath ? layCost('road', roadPath) : null;
  // A building counting down without power or a road: the line or road to it, in one press, as a facility's.
  // (The road first: without one the other countdowns stand still. Each only while lacking now, and power only with
  // some to spare: into a grid in blackouts it only cuts another building.)
  const lay: { kind: Lay; path: [number, number][]; goal: GoalId } | null = !b?.type ? null
    : b.noRoadMonths && !hasRoadNow(b) ? (() => { const path = roadToFacility(b, 'b'); return path ? { kind: 'road' as const, path, goal: 'growth' as const } : null; })()
    : !b.powered && powerToSpare() ? (() => { const path = lineToStructure(b, 'b'); return path ? { kind: 'powerline' as const, path, goal: 'power' as const } : null; })() : null;
  const layPrice = lay ? layCost(lay.kind, lay.path) : null;
  const chips = [
    b && !b.powered ? `<button type="button" class="chip bad"${go('power')} title="${city.cfg.services.noPowerMonths}개월이 되면 버려집니다 · 눌러서 전력 화면">${icon('zap')}전기 끊김 ${b.noPowerMonths}/${city.cfg.services.noPowerMonths}개월</button>` : '',
    b?.type && !b.watered && waterNeeded ? `<button type="button" class="chip bad"${go('water')} title="${city.cfg.services.noWaterMonths}개월이 되면 버려집니다 · 눌러서 수도 화면">${icon('droplet')}물 끊김 ${b.noWaterMonths}/${city.cfg.services.noWaterMonths}개월</button>` : '',
    b?.type && b.noRoadMonths ? `<span class="chip bad" title="도로가 다시 이어지지 않으면 버려집니다">${icon('road')}도로 끊김 ${b.noRoadMonths}/${city.cfg.development.noRoadMonths}개월</span>` : '',
    b?.type && b.noJobMonths ? `<button type="button" class="chip bad"${go('growth')} title="2.5시간 안에 닿는 일터가 없거나 닿는 일자리가 모두 찼으면 버려집니다 · 눌러서 개발·수요 화면">${icon('briefcase')}일자리 못 구함 ${b.noJobMonths}/${city.cfg.transport.noJobMonths}개월</button>` : '',
    b?.type && b.distressMonths ? (city.understaffed(b.id)
      ? `<span class="chip warn" title="일자리의 절반도 못 채우는데 그 소득층 주민이 더 들어올 수 없으면(수요 상한·수요 없음) 버려집니다">${icon('trendDown')}일할 사람 부족 ${b.distressMonths}/${city.cfg.development.distressMonths}개월</span>`
      : `<span class="chip warn" title="쾌적도가 계속 낮으면 더 낮은 소득층이 들어오거나 버려집니다">${icon('trendDown')}쾌적도 낮음 ${b.distressMonths}/${city.cfg.development.distressMonths}개월</span>`) : '',
    b && !b.type ? `<span class="chip bad">버려짐${b.abandonReason ? `: ${ABANDON_NAME[b.abandonReason]}` : ''}</span>` : '',
    b?.historical ? '<span class="chip gold">역사 건물</span>' : '',
    q.burning ? `<span class="chip bad">${icon('flame')}불타는 중</span>` : '',
    offRoad ? `<span class="chip bad" title="쓰레기를 거둘 수 없어 쌓입니다${def!.police || def!.fire || def!.health || def!.school ? '. 경찰차·소방차·구급차·통학버스도 나가지 못합니다' : ''}">${icon('road')}도로에 닿지 않음</span>` : '',
    // (The road to it, laid in one press: the chip above only said what was missing.)
    roadPath && roadCost !== null ? `<button type="button" class="chip" data-lay-path="${roadPath.map((p) => p.join(',')).join(';')}" data-lay-kind="road" data-lay-goal="${goalOfStructure(q.structure!.kind) ?? ''}" title="가장 가까운 도로까지 ${fmt(roadPath.length)}칸, 빈 땅으로 바로 잇기 (§${fmt(roadCost)})">${icon('road')}도로 ${fmt(roadPath.length)}칸 잇기</button>` : '',
    lay && layPrice !== null ? `<button type="button" class="chip" data-lay-path="${lay.path.map((p) => p.join(',')).join(';')}" data-lay-kind="${lay.kind}" data-lay-goal="${lay.goal}" title="${lay.kind === 'road' ? '가장 가까운 도로까지' : '전력망에서 이 건물까지'} ${fmt(lay.path.length)}칸 바로 잇기 (§${fmt(layPrice)})">${icon(lay.kind === 'road' ? 'road' : 'cable')}${LAY_WORD[lay.kind]} ${fmt(lay.path.length)}칸 잇기</button>` : '',
    q.structure && (def?.health || def?.school) && q.structure.load > q.structure.capacity && q.structure.capacity > 0
      ? `<button type="button" class="chip ${q.structure.strike ? 'bad' : 'warn'}"${go(def!.health ? 'health' : 'education')} title="정원을 넘으면 등급이 떨어지고 파업할 수 있습니다. ${shortFunded && !full ? '예산이 모자라 정원이 줄었으니 예산을 올리세요' : '근처에 하나 더 지으세요'} · 눌러서 ${def!.health ? '보건' : '교육'} 화면">${q.structure.strike ? `${icon('alert')}파업 중 · ` : ''}정원 초과 ${Math.round((q.structure.load / q.structure.capacity - 1) * 100)}%</button>` : '',
    // Over its places: one more of its level beside it, built in one press (the chip above only showed where).
    tight ? `<button type="button" class="chip ${tight.have < tight.need ? 'bad' : 'warn'}"${go(tight.goal)} title="도시 전체의 ${tight.what} 공급 / 수요 · 눌러서 ${GOALS[tight.goal].name} 화면">${icon(tight.goal === 'power' ? 'zap' : 'droplet')}${tight.have < tight.need ? `${tight.what} 모자람` : `${tight.what} 여유 ${Math.max(0, Math.round((1 - tight.need / tight.have) * 100))}%`}</button>` : '',
    paroled > 0 ? `<button type="button" class="chip warn"${go('police')} title="감방이 차면 잡은 범인을 풀어 주고, 풀려난 범인은 다시 범죄를 저지릅니다 · 눌러서 치안 화면">${icon('alert')}감방 가득 · 지난달 ${fmt(paroled)}명 풀려남</button>` : '',
    relieve ? `<button type="button" class="chip" data-relieve="${relieve.at.join(',')}" data-relieve-kind="${relieve.kind}" title="${relieve.where} ${STRUCTURE_NAME[relieve.kind]}${josa(STRUCTURE_NAME[relieve.kind], '을', '를')} 바로 짓기 (§${fmt(STRUCTURES[relieve.kind].cost)})">${icon('plus')}${relieve.text}</button>` : '',
    q.structure && (def?.fire || def?.police?.radius) && q.structure.strike ? `<span class="chip bad" title="예산이 100%보다 낮으면 파업할 수 있습니다. 90%보다 높게(95% 이상) 올리면 다음 달 끝납니다.">${icon('alert')}파업 중 (효과 20%)</span>` : '',
    q.structure && (def?.fire || def?.police?.radius) && q.structure.strike && q.structure.funding < 100
      ? `<button type="button" class="chip" data-fund-full="${q.structure.id}" title="예산을 100%로 올리면 다음 달 파업이 끝납니다">${icon('wallet')}예산 100%로</button>` : '',
    shortFunded ? `<button type="button" class="chip" data-fund-full="${shortFunded.id}" title="${shortFunded.strike ? '예산을 100%로 올리면 다음 달 파업이 끝납니다' : `예산을 100%로 올리면 정원이 ${fmt(places)}명으로 늘어납니다`}">${icon('wallet')}예산 100%로</button>` : '',
    q.garbage > 0.1 ? `<span class="chip warn">${icon('trash')}쓰레기 ${q.garbage.toFixed(1)} t</span>` : '',
  ].join('');
  // Who comes and goes here, drawn on the map whenever a building or road is looked at (no separate tool);
  // the card names the means, coloured as the lines are.
  const r = b?.type || q.structure || (q.network && q.network !== 'crossing') ? city.routeQuery(x, y) : null;
  renderer.routes = r?.trips.length ? r.trips : null;
  const means = r ? (Object.entries(r.byMeans) as [TripMeans, number][]).filter(([, v]) => v > 0).sort((m, n) => n[1] - m[1]) : [];
  const paths = means.length ? `<p class="info-paths" title="지도의 선: 진할수록 많은 통행 (지난달, 가장 많은 ${r!.trips.length}개 경로)">${icon('route')}<span>오가는 길</span>${means.slice(0, 4)
    .map(([m, v]) => `<span class="info-path"><i style="background:${ROUTE_COLOR[m]}"></i>${MEANS_NAME[m]} ${m === 'freight' ? `${v < 10 ? v.toFixed(1) : fmt(v)}/일` : v < 1 ? '1명 미만' : `${fmt(Math.round(v))}명`}</span>`).join('')}</p>` : '';
  // What its residents think of living here (what the microphone heard): a line of chips.
  const heard = b?.type?.[0] === 'R' && b.occupancy > 0 ? city.interview(b.x, b.y, 0) : null;
  const voice = heard?.thoughts.length ? `<p class="info-voice" title="이 집 주민이 사는 곳을 어떻게 생각하는지">${icon('mic')}<span>주민 생각</span>${thoughtChips(heard.thoughts)}</p>` : '';
  const occupied = b?.type ? `
      <div class="info-meter" title="${b.type[0] === 'R' ? '주민' : '영업 중인 일자리'} ${fmt(b.capacity * b.occupancy)} / ${fmt(b.capacity)}">
        <div class="fill" style="width:${Math.round(b.occupancy * 100)}%;background:${TYPE_COLOR[b.type]}"></div>
      </div>
      <div class="info-meter-label"><span>${b.type[0] === 'R' ? '주민' : '영업 중 일자리'} ${fmt(b.capacity * b.occupancy)} / ${fmt(b.capacity)}${b.type[0] !== 'R' ? ` · 일하는 사람 ${fmt(b.filled)}` : ''}</span><span>${pct(b.capacity ? Math.round(b.capacity * b.occupancy) / b.capacity : 0)}</span></div>${simsHere(b.id)}` : '';
  // On a road: how full it is (traffic against capacity, like the congestion view).
  const cap = !b && !q.structure && q.network && q.network !== 'crossing' ? DEFAULT_CONFIG.transport.speed[q.network]?.capacity : undefined;
  // Rail's meter is its trains (q.traffic is the nearest road's cars).
  const onRail = q.network === 'rail';
  const flow = onRail ? q.railTraffic : q.traffic;
  const load = cap ? flow / cap : 0;
  const roadMeter = cap ? `
      <div class="info-meter" title="하루 통행 ${fmt(flow)} / 용량 ${fmt(cap)}">
        <div class="fill" style="width:${Math.min(100, Math.round(load * 100))}%;background:${load > 1 ? 'var(--danger)' : load > 0.7 ? 'var(--warn)' : 'var(--data)'}"></div>
      </div>
      <div class="info-meter-label"><span>하루 통행 ${fmt(flow)} / 용량 ${fmt(cap)}</span><span>${pct(load)}</span></div>
      ${load > 1 && !onRail ? `<p class="legend">막힙니다. 버스·지하철로 일터까지 이어 주면 차가 줄어듭니다.</p>${q.network === 'street' || q.network === 'road' ? `<div class="chips">${widenButton(x, y)}</div>` : ''}` : ''}` : '';
  // Road traffic is in the meter above when there is one; other modes always list here.
  const traffic = [
    cap ? null : fmt(q.traffic), q.railTraffic && !onRail ? `열차 ${fmt(q.railTraffic)}` : null, q.subwayTraffic ? `지하철 ${fmt(q.subwayTraffic)}` : null,
    q.monorailTraffic ? `모노레일 ${fmt(q.monorailTraffic)}` : null, q.ferryTraffic ? `페리 ${fmt(q.ferryTraffic)}` : null,
    q.highwayTraffic ? `고가 ${fmt(q.highwayTraffic)}` : null,
  ].filter(Boolean).join(' · ');
  // A facility's load against what it can take, as a building's occupancy is: its gauge at the top (and not again in its table).
  const fst = q.structure;
  const gauged = !!fst && fst.capacity > 0 && !!(def!.plant || def!.pump || def!.incinerator || def!.health || def!.school || def!.police);
  const fLoad = gauged ? fst!.load / fst!.capacity : 0;
  const [, fTone] = gauged ? facilityLine(fst!) : ['', ''];
  const fLine = !gauged ? '' : `${def!.plant ? '발전' : def!.pump ? '급수' : def!.incinerator ? '소각' : def!.health ? '환자' : def!.school ? '학생' : '수감'} ${fmt(fst!.load)} / ${fmt(fst!.capacity)}${def!.plant ? ' MWh' : def!.pump ? ' m³' : def!.incinerator ? ' t' : '명'}`;
  const facMeter = gauged ? `
      <div class="info-meter" title="${escapeHtml(fLine)}">
        <div class="fill" style="width:${Math.min(100, Math.round(fLoad * 100))}%;background:${fTone === 'bad' ? 'var(--danger)' : fLoad > 1 || fTone === 'warn' ? 'var(--warn)' : structureColor(fst!.kind)}"></div>
      </div>
      <div class="info-meter-label"><span>${escapeHtml(fLine)}</span><span>${pct(fLoad)}</span></div>` : '';
  const stRows = q.structure ? structureRows(q.structure, !gauged) : '';
  // Under a building, facility or empty lot's own story, the area's readings fold away (opened, they stay open).
  const growth = growthSection(x, y);
  // (Open land too: its few facts at a glance, the rest — services, environment, the desirability sums — on asking.)
  const fold = !!(b || q.structure || growth || land || q.network); // (a road's environment too: its gauge and its traffic are what it says)
  // Removing what is selected, from its card (it took the bulldozer tool and a drag over the same spot).
  const bz = b || q.structure ? city.previewBulldoze(x, y, x, y) : null;
  const demolish = bz?.ok ? `<button type="button" id="info-bulldoze" class="info-bulldoze" title="이 ${b ? '건물' : '시설'}을 헐기 (되돌리기 가능)">${icon('eraser')}철거 · §${fmt(bz.cost)}</button>` : '';
  // The way to its goal's screen and the way to take it down: the card's foot, after what it says.
  const goal = goalLink(q.structure?.kind, b ? 'built' : q.zone, !b && !q.structure && !!q.network);
  // A reading here belongs to a goal: pressed, its screen opens on this spot (the view, the figures, what to do).
  const row = (goal: GoalId) => ` class="row-goal" data-row-goal="${goal}" data-row-at="${x},${y}" title="${GOALS[goal].name} 화면에서 보기"`;
  el.innerHTML = `
    <div class="info-head">
      <span class="info-swatch" style="background:${swatch}">${glyph ? icon(glyph) : facilityTool ? toolGlyph(facilityTool) : ''}</span>
      <div class="info-title">
        <strong tabindex="-1" title="${b ? `${b.x}, ${b.y}` : q.structure ? `${q.structure.x}, ${q.structure.y}` : `${x}, ${y}`}">${escapeHtml(title)}</strong>
        ${sub ? `<span class="muted">${sub}</span>` : ''}
      </div>
    </div>
    ${reading ? `<p class="info-reading">${icon('layers')}${escapeHtml(reading)}</p>` : ''}
    ${occupied}${roadMeter}${facMeter}
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    ${b?.type ? `<div class="info-glance">
      <span class="${b.powered ? 'ok' : 'neg'}"${go('power')} role="button" tabindex="0">${icon('zap')}${b.powered ? '전기' : '전기 끊김'}</span>
      <span class="${b.watered || !waterNeeded ? 'ok' : 'neg'}"${go('water')} role="button" tabindex="0">${icon('droplet')}${b.watered ? '물' : waterNeeded ? '물 끊김' : '우물물'}</span>
      ${b.type[0] === 'R' || b.type[0] === 'I' ? `<span class="${b.commute < 0 || b.commute > city.cfg.transport.tripLimit ? 'neg' : ''}"${go('traffic')} role="button" tabindex="0" title="${b.type[0] === 'I' ? '화물이 도시 밖까지 가는 시간' : '일하는 주민의 평균 통근 시간'}">${icon('route')}${b.type[0] === 'I' ? '화물' : '통근'} ${b.commute < 0 ? '경로 없음' : hours(b.commute)}</span>` : ''}
      <span class="${d.total < 50 ? 'neg' : ''}"${go('growth')} role="button" tabindex="0" title="${TYPE_NAME[b.type]} 쾌적도 (기본 ${d.baseline}) · 50 아래면 사람이 떠나고 높을수록 더 높은 단계로 자랍니다 · 자세히에 항목별로">${icon('sparkles')}쾌적도 ${d.total.toFixed(0)}</span>
    </div>` : ''}
${paths}${voice}
    ${b || stRows ? `<h3 class="sub">${b ? '건물' : '시설'}</h3><table>
      ${b?.type ? stageRow(b.type, b.stage, q.zone) : ''}
      ${b && !b.powered ? `<tr${row('power')}><td>전력</td><td class="neg">끊김 (${b.noPowerMonths}개월째)</td></tr>` : ''}
      ${b?.type && !b.watered && waterNeeded ? `<tr${row('water')}><td>수도</td><td class="neg">끊김 (${b.noWaterMonths}개월째)</td></tr>` : ''}
      ${b?.type?.[0] === 'R' ? `
        <tr><td>평균 나이</td><td>${b.age.toFixed(0)}세</td></tr>
        <tr${row('education')}><td>교육 지수</td><td>${b.eq.toFixed(0)}</td></tr>
        <tr${row('health')}><td>건강 지수</td><td>${b.hq.toFixed(0)}</td></tr>${smogRow(x, y, q.airPollution)}` : ''}
      ${stRows}${smokeRow(b ? b.id : q.structure ? -q.structure.id : 0, row('environment'))}
    </table>` : ''}
    ${q.structure && def!.category !== 'park' && def!.category !== 'garbage' && def!.category !== 'water' && def!.category !== 'landmark' && !(def!.category === 'safety' && def!.police?.radius === 0) && !def!.station ? fundingSlider(q.structure) : q.structure ? `<p class="muted">예산은 재정의 부서 예산 "${def!.category === 'garbage' ? '위생' : def!.category === 'water' ? '수도' : def!.station ? '대중교통' : def!.category === 'landmark' ? '랜드마크' : def!.category === 'safety' ? '교도소' : '공원 미화'}"${def!.category === 'garbage' ? '으로' : '로'} 정합니다.</p>` : ''}
    ${growth}
    ${land && !b && !q.structure ? `<div class="info-glance">
      <span class="${q.powered ? '' : q.zone !== 'none' ? 'neg' : 'muted'}">${icon('zap')}${q.powered ? '전기 있음' : '전기 없음'}</span>
      <span class="${q.watered ? '' : 'muted'}">${icon('droplet')}${q.watered ? '물 있음' : '물 없음'}</span>
      ${q.zone !== 'landfill' ? `<span title="${TYPE_NAME[type]} 쾌적도 (기본 ${d.baseline})">${icon('sparkles')}쾌적도 ${d.total.toFixed(0)}</span>` : ''}
    </div>` : ''}
    ${goal || demolish ? `<div class="info-own">${goal}${demolish}</div>` : ''}
    ${fold ? `<details class="info-more"${infoMoreOpen ? ' open' : ''}><summary>자세히${b || q.structure ? ' · 이름·서비스·환경' : land ? ' · 서비스·환경' : ' · 환경·교통'}</summary>` : ''}
    ${b || q.structure ? `<input id="bname" maxlength="40" placeholder="이름 붙이기 (${b ? (b.type ? TYPE_NAME[b.type] : '버려진 건물') : STRUCTURE_NAME[q.structure!.kind]})" value="${escapeHtml(q.name ?? '')}">` : ''}
    ${b?.type || (b?.type?.[0] === 'R' && b.occupancy > 0) ? `<div class="info-actions">
      ${b?.type ? `<label class="check" title="역사 건물은 재개발되거나 다른 계층으로 바뀌지 않지만, 버려지거나 불타거나 재해로 무너질 수는 있습니다"><input type="checkbox" id="historical" ${b.historical ? 'checked' : ''}> 역사 건물로 지정</label>` : ''}
      ${b?.type?.[0] === 'R' && b.occupancy > 0 ? '<button id="mysim-add">My Sim 입주</button>' : ''}
    </div>` : ''}

    ${land ? `<h3 class="sub">서비스와 안전</h3>
    <table>
      ${b ? '' : `<tr${row('power')}><td>전력</td><td>${q.powered ? '연결됨' : '없음'}${q.powerLine ? ' · 송전선' : ''}</td></tr>
      <tr${row('water')}><td>수도</td><td>${q.watered ? '급수 범위' : '없음'}${q.pipe ? ' · 수도관' : ''}</td></tr>`}
      ${q.landfill !== null ? `<tr${row('garbage')}><td>매립지</td><td>${fmt(q.landfill)} / 300 t</td></tr>` : ''}
      ${q.structure ? '' : `<tr${row('police')}><td>치안 보호 · 범죄</td><td>보호 ${fmt(q.policeProtection)} · 범죄 ${q.crime.toFixed(1)}</td></tr>`}
      <tr${row('fire')}><td>소방 보호 · 화재 위험</td><td>보호 ${fmt(q.fireProtection)} · 위험 ${fmt(q.flammability)}${q.rubble ? ' · 잔해' : ''}</td></tr>
      ${q.structure ? '' : `<tr><td>보건 · 교육</td><td>보건 ${pct(q.healthQuality)} · 교육 ${pct(q.schoolQuality)}</td></tr>`}
    </table>` : ''}
    <h3 class="sub">환경과 교통</h3>
    <table>
      ${where && where !== title ? `<tr><td>지형</td><td>${where}</td></tr>` : ''}
      ${land ? `<tr${row('wealth')}><td title="물가에 가깝거나 평균보다 높은 땅일수록 올라갑니다">땅값 보너스 (물가·고지대)</td><td>${q.landValue.toFixed(0)}</td></tr>` : ''}
      <tr><td>고도 · 경사</td><td>${q.height} m · ${q.slope} m</td></tr>
      <tr${row('environment')}><td>오염</td><td>대기 ${q.airPollution.toFixed(0)} · 수질 ${q.waterPollution.toFixed(0)}</td></tr>
      ${traffic ? `<tr${row('traffic')}><td>교통량</td><td>${traffic}</td></tr>` : ''}
      ${q.powerLine || q.pipe || q.railDamaged ? `<tr><td title="50을 넘으면 송전선은 불꽃, 수도관은 파열 위험">노후도</td><td>${[
        q.powerLine ? `<span class="${q.lineWear >= 50 ? 'neg' : ''}">송전선 ${q.lineWear}</span>` : '',
        q.pipe ? `<span class="${q.pipeWear >= 50 ? 'neg' : ''}">수도관 ${q.pipeWear}</span>` : '',
        q.railDamaged ? '<span class="neg">망가진 철로</span>' : ''].filter(Boolean).join(' · ')}</td></tr>` : ''}
      ${land && !q.structure ? tripRow(q.zone, q.commute, q.freight) : ''}
    </table>
    ${mayorRows(x, y)}
    ${land && !q.structure && q.zone !== 'landfill' ? `<h3 class="sub">${TYPE_NAME[type]} 쾌적도 <b class="score">${d.total.toFixed(0)}</b> <span class="muted">(기본 ${d.baseline})</span></h3>
    <table class="factors">${rows}</table>` : ''}
    ${fold ? '</details>' : ''}`;
  const more = el.querySelector<HTMLDetailsElement>('.info-more');
  if (more) more.ontoggle = () => (infoMoreOpen = more.open);
  // Each reading's name is a button to its goal (the row stays a table row to a screen reader).
  // (The glance's items are spans that act as buttons: Enter and Space press them.)
  el.querySelectorAll<HTMLElement>('.info-glance [role="button"]').forEach((sp) => {
    sp.onkeydown = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      sp.click();
    };
  });
  el.querySelectorAll<HTMLTableRowElement>('tr.row-goal').forEach((tr) => {
    const td = tr.cells[0]!;
    td.innerHTML = `<button type="button" class="row-goal-btn" title="${tr.title}">${td.innerHTML}</button>`;
  });
  const bname = el.querySelector<HTMLInputElement>('#bname');
  if (bname) bname.onchange = () => {
    choice('건물 이름', () => city.renameBuilding(x, y, bname.value));
    flash(bname.value.trim() ? `이름을 "${bname.value.trim()}"${josa(bname.value, '으로', '로')} 바꿨습니다` : '이름을 지웠습니다');
  };
  const demolishBtn = el.querySelector<HTMLButtonElement>('#info-bulldoze');
  if (demolishBtn) demolishBtn.onclick = () => {
    const what = title;
    // (Undone like the bulldozer's own: a snapshot before, dropped if nothing went.)
    const forget = remember(`철거: ${what}`);
    const res = city.bulldoze(x, y, x, y);
    if (!res.ok) {
      forget();
      flash(ko(res.message ?? ''), 'bad');
      return;
    }
    closeInfo();
    setSelected(null);
    city.refreshIfDirty();
    redraw();
    updatePanels();
    flash(`${what} 철거 · −§${fmt(res.cost)} · ${touchFirst() ? '위쪽 ↶' : 'Ctrl+Z'}로 되돌리기`, 'info');
  };
  const historical = el.querySelector<HTMLInputElement>('#historical');
  if (historical) historical.onchange = () => {
    choice('역사 건물', () => city.markHistorical(x, y, historical.checked));
    showInfo(x, y);
  };
  const add = el.querySelector<HTMLButtonElement>('#mysim-add');
  if (add) {
    // The name is asked for in place (a browser prompt looks foreign, worse on phones).
    add.onclick = () => {
      const form = document.createElement('form');
      form.className = 'mysim-form';
      form.innerHTML = `<input id="mysim-name" maxlength="20" aria-label="My Sim 이름" value="${SIM_NAMES[city.state.mySims.length % SIM_NAMES.length]}"><button class="primary">입주</button>`;
      add.replaceWith(form);
      const input = form.querySelector('input')!;
      input.focus();
      input.select();
      input.onkeydown = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          showInfo(x, y);
        }
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        const res = choice('My Sim', () => city.addMySim(input.value, x, y));
        if (!res.ok) {
          flash(ko(res.message ?? 'pick a lived-in home'), 'bad');
          return;
        }
        // (주민 is on the top bar, or in its ⋯ menu when the bar is short of room.)
        const sims = document.getElementById('btn-sims')?.offsetParent ? "위쪽 막대의 '주민'" : "위쪽 ⋯ 메뉴의 '주민'";
        flash(`${res.sim!.name}${josa(res.sim!.name, '이', '가')} 입주했습니다 — ${sims}에서 생각을 들어 보세요`);
        renderMySims(true);
        showInfo(x, y);
      };
    };
  }
  const bus = el.querySelector<HTMLInputElement>('#vehicle-funding');
  if (bus && q.structure) {
    const id = q.structure.id;
    // While dragging only the figures change (rebuilding the card would drop the drag); on release, the rest.
    bus.oninput = () => {
      choice('시설 예산', () => city.setVehicleFunding(id, Number(bus.value)));
      const st = city.state.structures.get(id);
      const def = st && STRUCTURES[st.kind];
      const vehicles = def && (def.health ?? def.school)?.vehicles;
      if (st && vehicles) bus.nextElementSibling!.textContent = `${bus.value}% · 월 §${fmt(city.structureUpkeep(id)?.vehicles ?? 0)} · 반경 ${serviceRadius(city.cfg, def, st).toFixed(0)}칸`;
    };
    bus.onchange = () => {
      city.refreshIfDirty();
      showInfo(x, y);
      updatePanels();
    };
  }

  const slider = el.querySelector<HTMLInputElement>('#funding');
  if (slider && q.structure) {
    const id = q.structure.id;
    slider.oninput = () => {
      choice('시설 예산', () => city.setFunding(id, Number(slider.value)));
      const st = city.state.structures.get(id);
      const u = city.structureUpkeep(id);
      if (st && u) slider.nextElementSibling!.textContent = `${slider.value}% · 월 §${fmt(u.running + u.overcapacity)}`;
    };
    slider.onchange = () => {
      city.refreshIfDirty();
      showInfo(x, y);
      updatePanels();
    };
  }
  redraw();
}

export function mayorRows(x: number, y: number): string {
  const m = city.mayorAt(x, y);
  if (!m) return '';
  const { total, ...factors } = m;
  return `<h3 class="sub">시장 평점 <b class="score ${total < 0 ? 'neg' : ''}">${total.toFixed(0)}</b></h3><table class="factors">${factorRows(factors, MAYOR_NAME)}</table>`;
}

/** Factor rows with a bar each, longest first; bars scale to the largest factor. */
function factorRows(factors: Record<string, number>, names: Record<string, string>): string {
  const list = Object.entries(factors).filter(([, v]) => Math.abs(v) >= 0.05).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const max = Math.max(1, ...list.map(([, v]) => Math.abs(v)));
  return list.map(([k, v]) => `<tr><td>${names[k] ?? k}</td>
    <td class="bar-cell"><span class="fbar ${v >= 0 ? 'pos' : 'neg'}" style="width:${Math.round((Math.abs(v) / max) * 100)}%"></span></td>
    <td class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}</td></tr>`).join('');
}


/** What the ordinance list last showed: each one's availability and cost (rebuilt when any changes). */
export let ordinanceMonth = '';

/** What an unavailable ordinance waits for (engine's `requires`). */
const ORDINANCE_NEEDS: Record<string, string> = {
  park: '공원', police: '경찰서', clinic: '보건소', library: '도서관', recycling: '재활용 센터',
  landfillAndGas: '매립지와 천연가스 발전소', transit: '대중교통 정류장·역',
};

export function buildOrdinances(): void {
  const el = $('#ordinances');
  el.innerHTML = (Object.keys(ORDINANCES) as OrdinanceId[]).map((id) => {
    const on = city.state.ordinances.includes(id);
    const avail = on || city.ordinanceAvailable(id);
    const cost = city.ordinanceCost(id);
    const price = cost < 0 ? `+§${fmt(-cost)}` : `§${fmt(cost)}`;
    return `<label class="ordinance ${avail ? '' : 'muted'}">
      <input type="checkbox" data-ord="${id}" ${on ? 'checked' : ''} ${avail ? '' : 'disabled'}>
      <span><b>${ORDINANCE_NAME[id]}</b> <span class="muted">월 ${price}</span>${goalsOfOrdinance(id).map((g) => ` <button type="button" class="goal-tag" data-goal-open="${g}" title="${GOALS[g].name} 화면에서 보기 (이 조례가 돕는 분야)">${icon(GOALS[g].icon)}${GOALS[g].name}</button>`).join('')}<br><small>${ORDINANCES[id].description}</small>${avail ? '' : `<br><small class="needs">필요: ${ORDINANCE_NEEDS[(ORDINANCES[id] as { requires?: string }).requires ?? ''] ?? '조건 미충족'}</small>`}</span>
    </label>`;
  }).join('');
  el.querySelectorAll<HTMLInputElement>('input[data-ord]').forEach((box) => {
    box.onchange = () => {
      const id = box.dataset.ord as OrdinanceId;
      const res = box.checked ? choice('조례', () => city.enactOrdinance(id)) : choice('조례', () => city.repealOrdinance(id));
      if (!res.ok && res.message) flash(ko(res.message), 'bad');
      buildOrdinances();
      refreshTaxes(); // some ordinances move demand, and so the tax effects
      updatePanels();
      redraw();
    };
  });
}

/** How tall this type may build: the city-wide stage limit and the zone's density cap. */
function stageRow(type: DevType, stage: number, zone: string): string {
  const o = city.stageOutlook(type);
  const cls = type[0] === 'I' ? 'I' : type[0] === 'R' ? 'R' : 'C';
  const density = (['low', 'medium', 'high'] as const).find((d) => zone.endsWith(`-${d}`));
  const top = city.cfg.development.stageTable[type].rows.length;
  const cap = density && type !== 'IA' ? city.cfg.development.densityMaxStage[cls][density] : top;
  const max = Math.min(o.maxStage, cap);
  // A business type's "population" is its jobs.
  const pop = type[0] === 'R' ? '인구' : '일자리';
  const unit = type[0] === 'R' ? '명' : '개';
  const why = `도시(와 지역)의 같은 유형 ${pop}가 늘면 더 높은 건물이 허용됩니다`;
  const next = o.next && o.next.stage <= cap
    ? `<tr><td title="${why}">다음 단계</td><td>${TYPE_NAME[type]} ${pop} ${fmt(o.next.at)}${unit}이면 ${o.next.stage}단계</td></tr>` : '';
  // At the top: say which limit holds it (the zone's density or the city's population).
  const at = stage >= max ? `최고 (${max === cap && cap < top ? '구역 밀도 한도' : `지금 ${pop}로는`})` : `지금 최대 ${max}단계`;
  return `<tr><td title="${why}">단계</td><td>${stage}단계 · ${at}</td></tr>${next}`;
}

const abandonedHere = (x: number, y: number) => {
  const occ = city.state.occupant[y * city.size + x]!;
  return occ > 0 && !city.state.buildings.get(occ)?.type;
};

/** For an empty zoned tile or an abandoned building: what keeps a developer away (engine's growth blockers). */
function growthSection(x: number, y: number): string {
  const blockers = city.growthBlockers(x, y);
  if (!blockers) return '';
  const items = blockers.map((b): [string, string] => {
    switch (b.code) {
      case 'unbuildable': return ['bad', '이 칸에는 지을 수 없습니다 (물·도로·고가·화산)'];
      case 'rubble': return ['bad', `재해 잔해가 남아 있습니다. 철거 도구로 치우면 다시 지어집니다 (칸당 §${city.cfg.safety.rubbleBulldoze})`];
      case 'tooSteep': return ['bad', '너무 가파릅니다 — 높이기·낮추기로 이웃 칸과 높이를 맞추세요'];
      case 'noPower': return ['bad', '전기가 없습니다 — 발전소나 송전선을 4칸 안으로'];
      case 'noRoad': return ['bad', '도로에 닿지 않습니다 (산업·농업은 도로에서 몇 칸 안)'];
      case 'noJobs': return ['bad', '이 길로 2시간 30분 안에 닿는 일자리가 없거나 사는 사람보다 적습니다. 가까이에 상업·산업 구역을 짓거나, 더 빠른 길(도로·대로)이나 길을 지도 가장자리(이웃 도시)까지 이으세요'];
      case 'noDemand': return ['bad', '이 구역 종류의 수요가 없습니다 (개발·수요의 구역별 수요·세율 확인)'];
      case 'noWorkers': return ['bad', '일할 사람이 모자라 새 사업체가 들어서지 않습니다 — 주거 구역을 늘리거나 주거지가 자랄 수 있게 하세요'];
      case 'noWater': return ['bad', '이 단계 건물은 수도가 필요합니다 — 수도관을 6칸 안으로'];
      case 'lowDesirability': return ['bad', `쾌적도가 낮습니다: ${TYPE_NAME[b.type]} ${b.value.toFixed(0)} / 필요 ${b.need} (아래 요인 확인)`];
      case 'waterCap': return ['warn', `물이 없어 ${b.value ? `${b.value}단계까지만` : '일부 유형은'} 지어집니다`];
      case 'capped': return ['bad', `${TYPE_NAME[b.type]} 수요가 상한(${fmt(b.value)})에 막혔습니다 — ${CAP_RELIEF[b.type[0] === 'R' ? 'R' : b.type[0] === 'I' ? 'I' : b.type.startsWith('Co') ? 'Co' : 'Cs']}`];
      case 'interior': return ['warn', `길에서 ${b.value}칸 안쪽이라 그만큼 깊은 필지(큰 건물)가 들어서야 채워집니다`];
      case 'waiting': return ['good', abandonedHere(x, y) ? '조건은 갖췄습니다 — 수요에 따라 곧 다시 입주합니다' : '조건은 갖췄습니다 — 수요에 따라 곧 개발됩니다'];
    }
  });
  // The tool for the fix, where one tool is the fix (the same buttons as the advisors').
  const fix = (b: (typeof blockers)[number]) => {
    const f = b.code === 'capped' ? (b.type[0] === 'R' ? ['park', '공원·광장'] : null) : GROWTH_FIX[b.code];
    return f ? ` <button type="button" class="advice-view" data-tool="${f[0]}" title="${f[1]} 도구 고르기">${icon('plus')}${f[1]}</button>` : '';
  };
  const abandoned = abandonedHere(x, y);
  return `<h3 class="sub">${abandoned ? '다시 입주하려면' : '개발 조건'}</h3><ul class="growth">${items.map(([tone, text], i) => `<li class="${tone}">${glue(text)}${fix(blockers[i]!)}</li>`).join('')}</ul>`;
}

/** What lifts each demand cap. */
const CAP_RELIEF = {
  R: '공원·광장과 보상 건물이 상한을 올립니다',
  Cs: '이웃 도시와의 연결이 상한을 올립니다',
  Co: '이웃으로 나가는 도로·철도·고속도로 연결과 공항이 상한을 올립니다',
  I: '화물이 나가는 철도·고속도로 연결과 항구가 상한을 올립니다',
} as const;

/** The goal's screen this lot belongs to: a facility's service, or growth for zones and buildings. */
function goalLink(kind: Structure['kind'] | undefined, zone: string, way = false): string {
  // (A road, rail or the like: the traffic screen, its jams and what to build against them.)
  const id: GoalId | null = kind ? goalOfStructure(kind) : way ? 'traffic' : zone === 'landfill' ? 'garbage' : zone !== 'none' ? 'growth' : null;
  if (!id || active === id) return ''; // (its screen is already open)
  return `<button type="button" class="info-goal" data-goal="${id}" title="${GOALS[id].name}의 관리 화면: 같은 종류의 시설 모두, 지도 보기, 예산과 조례">${icon(GOALS[id].icon)}${GOALS[id].name} 관리${icon('chevronRight')}</button>`;
}

/**
 * How many buildings this station alone reaches (homes, for a hospital or school): their middle in its radius and in
 * no other station's of its service, as the views count reach — what clearing it or cutting its budget leaves out.
 * Null for one that serves no area, or where a city-wide one of its service reaches all.
 */
export function aloneReached(st: Structure, gone: ReadonlySet<number> = new Set()): { n: number; what: string } | null {
  // (Schools by their level: a high school takes none of a primary school's pupils. Of health, the hospitals and the
  // research lab give the cover the views count; a farmer's market only lifts health, reaching no one.)
  const service = (k: StructureKind) => {
    const d = STRUCTURES[k];
    return d.police?.radius ? 'police' : d.fire?.radius ? 'fire' : d.health ? (d.health.radius < 300 || d.health.boost >= 1 ? 'health' : null) : d.school ? `school:${d.school.curve}` : null;
  };
  // (How far each reaches now, as the engine draws it: a police or fire station by its funding, a strike, a missing road.)
  const reach = (s: Structure) => {
    const d = STRUCTURES[s.kind];
    const r = d.police?.radius ?? d.fire?.radius;
    return r ? r * Math.min(1.1, s.effectiveness) : coverageRadius(s.kind, s);
  };
  const mine = service(st.kind);
  const r = reach(st);
  if (!mine || !r) return null;
  // (Others of its service; those being taken down with it don't count: two stations bulldozed together left out
  // what they shared.)
  const others = [...city.state.structures.values()].filter((o) => o.id !== st.id && !gone.has(o.id) && service(o.kind) === mine);
  // (One reaching the whole city — a research lab, a university — leaves none to this one alone.)
  if (others.some((o) => !STRUCTURES[o.kind].police && !STRUCTURES[o.kind].fire && !coverageRadius(o.kind, o))) return null;
  const rings = others.map((o) => [o.x + o.w / 2, o.y + o.h / 2, reach(o)] as const);
  const homes = mine === 'health' || mine.startsWith('school');
  const [cx, cy] = [st.x + st.w / 2, st.y + st.h / 2];
  let n = 0;
  for (const b of city.state.buildings.values()) {
    if (!b.type || (homes && b.type[0] !== 'R')) continue;
    const [mx, my] = [b.x + (b.w >> 1) + 0.5, b.y + (b.h >> 1) + 0.5];
    if ((mx - cx) ** 2 + (my - cy) ** 2 > r * r || rings.some(([ox, oy, or]) => (mx - ox) ** 2 + (my - oy) ** 2 <= or * or)) continue;
    n++;
  }
  return { n, what: homes ? '집' : '건물' };
}
/**
 * A home in air past 40: how bad, what fouls it most, and a way to the worst of that on the map (the card's figures
 * said 대기 81 and nothing of where it came from).
 */
const smogRow = (x: number, y: number, air: number): string => {
  if (!(air > 40)) return '';
  const [a, b] = airSourcesAt(x, y).filter((s) => s.key !== 'rest');
  if (!a) return '';
  const what = a.key === 'traffic' ? '교통' : a.key.startsWith('st:') || a.key === 'spill' ? a.label : a.key === 'IA' ? '농장' : `${a.label} 공장`;
  const from = a.share >= 0.6 || !b ? `주로 ${what}` : `${what}·${b.key === 'traffic' ? '교통' : b.label}`;
  const go = a.at && a.lot ? ` <button type="button" class="advice-view" data-at="${a.at.join(',')}" data-flash="${[a.lot.x, a.lot.y, a.lot.w, a.lot.h].join(',')}" title="이 집의 공기를 가장 더럽히는 ${a.key === 'traffic' ? '길' : '곳'} 보기">보기</button>` : '';
  return `<tr><td title="대기 오염이 40을 넘으면 이 집의 쾌적도와 주민 건강이 떨어집니다 (부유할수록 더 일찍) · 주민이 불만으로 꼽는 것은 ${fmt(city.cfg.mayor.pollution.zero)}부터라 주민 생각에는 아직 안 나올 수 있습니다">공기</td><td class="neg">나쁨 ${air.toFixed(0)} · ${escapeHtml(from)}${go}</td></tr>`;
};

/** The worst water pollution under a pump (it stops past the limit on any of its tiles). */
const pumpWater = (st: Structure): number => {
  const n = city.size;
  const wp = city.fields.waterPollution;
  let worst = 0;
  for (let y = st.y; y < st.y + st.h; y++) for (let x = st.x; x < st.x + st.w; x++) worst = Math.max(worst, wp[y * n + x]!);
  return worst;
};

/**
 * Why a pump has stopped, in the engine's order: no power, its water fouled past the limit, the water budget at 0%, or
 * worn out. (물이 오염됨 was said of every stop with power, beside a 수질 row well under the limit.)
 */
const pumpStop = (st: Structure): string =>
  !st.powered ? '전기가 닿지 않음: 발전소·송전선으로 이으세요'
    : pumpWater(st) > city.cfg.services.pumpPollutionLimit ? '물이 오염됨: 오염원을 치우거나 정수장을 지으세요'
      : city.state.departments.water <= 0 ? '수도 예산 0%: 재정에서 수도 예산을 올리세요' : '수명이 다함: 헐고 새로 지으세요';

/**
 * The water under a pump once it is half way to the limit past which the pump stops (any tile of its lot, as the
 * engine counts it): how foul against the limit, what fouls it most, and a way to that on the map.
 */
const pumpWaterRow = (st: Structure): string => {
  const limit = city.cfg.services.pumpPollutionLimit;
  const worst = pumpWater(st);
  if (!(worst > limit * 0.5)) return '';
  const [a, b] = waterSourcesOn(st).filter((x) => x.key !== 'rest');
  const name = (x: AirSource) => (x.key.startsWith('st:') || x.key === 'spill' ? x.label : x.key === 'IA' ? '농장' : `${x.label} 공장`);
  // (주로 only for most of it, as the home's air row has it: farms at 34% beside industry and coal at 33% each were
  // "주로 농장".)
  const what = !a ? '' : a.share >= 0.6 || !b ? `주로 ${name(a)}` : `${name(a)}·${name(b)}`;
  const go = a?.at && a.lot ? ` <button type="button" class="advice-view" data-at="${a.at.join(',')}" data-flash="${[a.lot.x, a.lot.y, a.lot.w, a.lot.h].join(',')}" title="이 펌프의 물을 가장 더럽히는 곳 보기">보기</button>` : '';
  return `<tr><td title="이 펌프 자리의 수질 오염 · 한도를 넘으면 펌프가 멈춥니다">수질</td><td class="${worst > limit ? 'neg' : ''}">${fmt(worst)} / 한도 ${fmt(limit)}${what ? ` · ${escapeHtml(what)}` : ''}${go}</td></tr>`;
};

/** A factory's, farm's or plant's part in the air over the smoggy homes, where it has one worth saying. */
const smokeRow = (code: number, row: string): string => {
  const share = code ? airShareOf(code) : 0;
  if (share < 0.005) return '';
  return `<tr${row}><td title="대기 오염이 40을 넘는 주거 구역에 이곳의 연기가 보태는 몫">공기 나쁜 주거지 오염</td><td class="${share >= 0.2 ? 'neg' : ''}">${share >= 0.995 ? '모두가' : share < 0.01 ? '1% 미만이' : `${Math.round(share * 100)}%가`} 이곳에서</td></tr>`;
};

const aloneRow = (st: Structure) => {
  const a = aloneReached(st);
  return a ? `<tr><td title="다른 곳이 닿지 않아 여기만 맡는 ${a.what}: 헐거나 예산을 줄이면 범위 밖이 됩니다">혼자 맡는 ${a.what}</td><td>${fmt(a.n)}채</td></tr>` : '';
};

export function structureRows(st: Structure, withLoad = true): string {
  const def = STRUCTURES[st.kind];
  let rows = '';
  if (def.incinerator) {
    rows += `
      ${withLoad ? `<tr><td>소각량</td><td>${fmt(st.load)} / ${fmt(st.capacity)} t</td></tr>` : ''}
      <tr><td title="태운 쓰레기만큼 전력망에 내놓는 전력">발전 능력</td><td>${fmt(st.load * def.incinerator.powerPerTon)} MWh</td></tr>
      <tr><td>상태 (수명)</td><td>${Math.max(0, Math.round((1 - st.life / 110) * 100))}%</td></tr>`;
  } else if (def.recycling) {
    rows += `<tr><td>전력</td><td class="${st.powered ? '' : 'neg'}">${st.powered ? '공급 중' : '없음 (작동 안 함)'}</td></tr>`;
  } else if (def.police) {
    rows += `
      ${withLoad ? `<tr><td>수감자</td><td>${fmt(st.load)} / ${fmt(st.capacity)}</td></tr>` : ''}
      ${def.police.radius ? `<tr><td>효과</td><td>${pct(st.effectiveness)}${st.strike ? ' <span class="neg">· 파업 중</span>' : ''}</td></tr>
      <tr><td>보호 반경</td><td>${Math.round(def.police.radius)}칸</td></tr>` : ''}${aloneRow(st)}`;
  } else if (def.fire) {
    rows += `<tr><td>효과</td><td>${pct(st.effectiveness)}${st.strike ? ' <span class="neg">· 파업 중</span>' : ''}</td></tr>
      ${def.fire.radius ? `<tr><td>보호 반경</td><td>${Math.round(def.fire.radius)}칸</td></tr>` : ''}${aloneRow(st)}`;
  } else if (def.pump) {
    rows += `
      ${withLoad ? `<tr><td>급수량</td><td>${fmt(st.load)} / ${fmt(st.capacity)} m³</td></tr>` : ''}
      <tr><td>가동률</td><td>${pct(st.effectiveness)}${st.capacity === 0 ? ` <span class="neg">· 정지 (${pumpStop(st)})</span>` : ''}</td></tr>
      <tr><td>상태 (수명)</td><td class="${st.life >= 90 ? 'neg' : ''}">${Math.max(0, Math.round((1 - st.life / 110) * 100))}%</td></tr>${pumpWaterRow(st)}`;
  } else if (def.plant) {
    rows += `
      ${withLoad ? `<tr><td title="전력망 수요 가운데 이 발전소가 맡은 몫 / 발전 능력">발전량 / 능력</td><td>${fmt(st.load)} / ${fmt(st.capacity)} MWh</td></tr>` : ''}
      ${withLoad ? `<tr><td>가동률</td><td>${pct(st.effectiveness)}</td></tr>` : ''}
      <tr><td title="예산·가동률에 따라 빨라지거나 느려집니다">상태 (수명)</td><td class="${st.life >= 85 ? 'neg' : ''}">${Math.round(100 - st.life)}% · 약 ${lifeLeft(st.life, def.plant.lifeYears)} 남음${st.life >= 90 ? ' · 폭발 위험' : ''}</td></tr>`;
  } else if (def.health || def.school) {
    const grade = st.load > 0 ? Math.min(1, st.capacity / st.load) : 1;
    const n = Math.max(1, Math.ceil(grade * 5));
    rows += `
      ${withLoad ? `<tr><td>${def.health ? '환자' : '학생'}</td><td>${fmt(st.load)} / ${fmt(st.capacity)}</td></tr>` : ''}
      <tr><td>등급</td><td><span class="grade" role="img" aria-label="5등급 중 ${n}" title="정원을 넘으면 등급이 떨어집니다">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(5 - n)}</span></td></tr>
      <tr><td>반경</td><td>${Math.round(serviceRadius(city.cfg, def, st))}칸</td></tr>
      <tr><td>효과</td><td>${pct(st.effectiveness)}${st.strike ? ' <span class="neg">· 파업 중</span>' : ''}</td></tr>${aloneRow(st)}`;
  } else if (def.station) {
    rows += `<tr><td>지난달 승차</td><td class="${st.load > def.station.capacity ? 'neg' : ''}">${fmt(st.load)} / ${fmt(def.station.capacity)}</td></tr>`;
    if (st.load < 1 && def.station.mode !== 'freight') rows += `<tr><td colspan="2" class="muted">${noRiders(st)}</td></tr>`;
  } else if (def.airport) {
    rows += `<tr><td>닿는 오피스 일자리</td><td>${fmt(st.load)} / 용량 ${fmt(st.capacity)}</td></tr>`;
  } else if (def.seaport) {
    rows += `<tr><td>화물 운행</td><td>${fmt(st.load)} · 상한 완화 ${fmt(Math.min(def.seaport.relief, def.seaport.perTrip * st.load))}</td></tr>`;
  } else if (def.income) {
    rows += `<tr><td>월 수입</td><td class="pos">§${fmt(def.income)}</td></tr>`;
  }
  return rows;
}

/** Why a passenger stop had nobody board last month, as far as the map shows. */
export function noRiders(st: Structure): string {
  const mode = STRUCTURES[st.kind].station!.mode;
  if (!city.roadBeside(st.x, st.y, st.w, st.h)) return '옆에 도로가 없어 걸어서도 차로도 닿지 못합니다.';
  const same = [...city.state.structures.values()].filter((o) => STRUCTURES[o.kind].station?.mode === mode).length;
  if (same < 2) return '같은 종류의 정류장·역이 하나뿐이라 갈 곳이 없습니다. 일터 근처에도 지으세요.';
  return '사람들은 집 근처에서 타고 일터 근처에서 내립니다: 일터 쪽 정류장이 같은 노선(버스는 도로)으로 이어져 있고, 차보다 빠르거나 비슷해야 탑니다. 막 지었다면 다음 달부터 셉니다.';
}

export function fundingSlider(st: Structure): string {
  const def = STRUCTURES[st.kind];
  const max = def.health || def.school ? 150 : def.plant || def.police || def.fire || def.incinerator || def.recycling || def.airport || def.seaport ? 120 : 100;
  // What the budget charges: department funding, wear on old plants and pumps, a jail's overcrowding.
  const u = city.structureUpkeep(st.id);
  const cost = u ? u.running + u.overcapacity : 0;
  const vehicles = (def.health ?? def.school)?.vehicles;
  const vf = st.vehicleFunding ?? 100;
  const bus = vehicles
    ? `<label class="funding">${def.health ? '구급차' : '스쿨버스'} <input id="vehicle-funding" type="range" min="0" max="200" step="5" value="${vf}" data-mark="100">
    <span>${vf}% · 월 §${fmt(u?.vehicles ?? 0)} · 반경 ${serviceRadius(city.cfg, def, st).toFixed(0)}칸</span></label>`
    : '';
  return `<label class="funding">예산 <input id="funding" type="range" min="0" max="${max}" step="5" value="${st.funding}" data-mark="100">
    <span>${st.funding}% · 월 §${fmt(cost)}</span></label>${bus}`;
}

export function setOrdinanceMonth(v: typeof ordinanceMonth): void {
  ordinanceMonth = v;
}

/** The ordinance list's signature: availability and cost of each (a new police station, a bigger population). */
export function ordinanceSignature(): string {
  return (Object.keys(ORDINANCES) as OrdinanceId[]).map((id) => `${+city.ordinanceAvailable(id)}${Math.round(city.ordinanceCost(id))}${+city.state.ordinances.includes(id)}`).join('|');
}

/** Time left before a plant's life runs out, at its nominal aging rate (funding and load change it). */
function lifeLeft(life: number, years: number): string {
  const months = Math.max(0, Math.round((100 - life) / (100 / (years * 12))));
  return months >= 24 ? `${Math.floor(months / 12)}년` : `${months}개월`;
}

/**
 * A jammed street or road's 대로로 넓히기: the jammed straight stretch through it widened in one press, with its
 * length and price, else (nothing jammed beyond it, a bridge refused) the avenue tool to draw it by hand.
 */
function widenButton(x: number, y: number): string {
  const run = jamRun(x, y);
  // (A street a road would carry becomes a road: an avenue for it was three times the price.)
  const to = run ? widenTo(run) : 'avenue';
  const word = to === 'road' ? '도로' : '대로';
  const p = run ? city.previewNetwork(run[0], run[1], run[2], run[3], to) : null;
  const cap = fmt(DEFAULT_CONFIG.transport.speed[to].capacity);
  if (run && p && (p.ok || p.message === 'not enough funds')) {
    const tiles = Math.abs(run[2] - run[0]) + Math.abs(run[3] - run[1]) + 1;
    return `<button type="button" class="chip" data-widen="${run.join(',')}" data-widen-kind="${to}" title="막힌 구간 ${fmt(tiles)}칸을 ${word}(용량 ${cap})로 바로 넓히기 · §${fmt(p.cost)}${p.ok ? '' : ' · 자금 부족'}">${icon('plus')}이 구간 ${word}로 넓히기 · ${fmt(tiles)}칸 §${fmt(p.cost)}${p.ok ? '' : ' · 자금 부족'}</button> `;
  }
  return `<button type="button" class="advice-view" data-tool="avenue" title="대로 도구 고르기: 기존 길 위로 그으면 넓어집니다">${icon('plus')}대로로 넓히기 (용량 ${cap})</button> `;
}
