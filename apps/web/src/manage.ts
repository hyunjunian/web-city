// Goals: the city pane's watch list and, for the goal picked from it, one
// screen set up for that goal. A goal (전력, 교육, 재정…) brings its own map
// view, what to read (the figures, their trend, the advisors' word, each
// facility), and what can be done about it (build, budget, ordinances),
// all on the same panel; the map, tool and info card follow from it.

import { placeAt } from './input';
import { DEV_TYPES, type DevType, Net, NETWORK_KINDS, ORDINANCES, POWER_DISPATCHES, STRUCTURES, type HistoryPoint, type OrdinanceId, type PowerDispatch, type RepairDepartment, type Structure, type StructureKind, type ZoneKind } from '@web-city/engine';
import { icon, type IconName } from './icons';
import { chooseSpeed, refreshTaxes, resumeAfterBuilding, setSpeed, showOverlay, speedChosen, viewEmpty, viewName } from './controls';
import { redrawInfo, refreshInfo, riotNear, showInfo } from './info';
import { ko } from './messages';
import { ADVICE_TEXT, ADVICE_TOOL, ADVISOR_NAME, EDGE_NAME, ORDINANCE_NAME, RESOURCE_NAME, RESOURCE_UNIT, STRUCTURE_NAME, TYPE_NAME, ZONE_NAME } from './names';
import { whyNoDeals } from './region';
import { journal } from './journal';
import { abandonHint, capBest, capHint, capLeads, jobHint, pushNotice, rciMini, updatePanels } from './panels';
import { checklist } from './onboarding';
import { builtArea, cam, centerOn, changeKey, city, cityLineage, fitScale, flightCount, glideTo, graphs, mapBand, pingAt, redraw, renderer, setHover, speed, stopFlight, takeBandFraming } from './state';
import { GRAPH_KEYS } from './graphs';
import { closeInfo, closePane, closeSheet, dismissPane, markCity, openPane, paneShown, showTab } from './tabs';
import { categoryOf, chosen, edgeFade, kindsFor, openTray, panTipAt, pickStructure, restView, selectTool, structureStat, tool, toolPicks, TOOLS, toolGlyph, toolName } from './tools';
import { dropGoalToasts, dropToasts, toast } from './toast';
import { choice } from './choices';
import { $, escapeHtml, firstSentence, flash, flashing, fmt, glue, josa, short, stoppedNote, straightRuns, touchFirst } from './util';
import { AREA_ORDER, type Dept, type Goal, GOAL_ORDER, goalOfStructure, type GoalId, GOALS, type GoalTab, type Metric, type TabPart, type Tone } from './goals';
import { type AirSource, airSources, fullNote, edgeRoad, fillSpan, ratingRated, smokeClear, adviceFor, budgetMends, deptEmpty, cheapestOf, classroom, deptFunded, facilities, facilityLine, forecast, FUNDING_MAX, goalStatus, incidents, levelShort, loadOf, metrics, readStats, SPOT_WORD, relieverFor, forgetSites, freshLandfill, hasRoadNow, bestJamRun, jammedTiles, stormHolds, subwayGap, widenTo, landfillSite, powerToSpare, zoneSite, lineFromPlant, lineToDark, lineToStructure, pipeToDry, plantSite, roadToFacility, siteAwayFromHomes, siteByPlants, siteNear, siteNearHomes, siteOnPipes, smokyPlant, spotKind, stopPair, suggestSpot, sum, unpoweredZones, waterApart, type Lay, LAY_WORD, layCost } from './readings';

// ------------------------------------------------------------------ the overview: problems and qualities

/** The pane's watch list: one row per goal, problems marked; a row opens its goal. */
/** Each goal's figure over time (its direction on the watch list), and whether up is better: the figure its row
 *  shows — power and water their use of what is made (92k / 100k m³ with a red ▼ beside it, for its 여유 shrinking,
 *  read as demand falling); 보건 none, its 건강 지수 having no record (its arrow was 기대 수명's). */
const DRIFT: Partial<Record<GoalId | 'rating', [(p: HistoryPoint) => number | undefined, 1 | -1, string]>> = {
  finance: [(p) => p.funds, 1, '자금'], // (the money itself: a falling balance on rising funds read ▼)
  rating: [(p) => p.mayorRating, 1, '시장 평점'],
  growth: [(p) => p.population, 1, '인구'],
  power: [(p) => (p.powerSupply && p.powerDemand !== undefined ? p.powerDemand / p.powerSupply : undefined), -1, '전력 사용률'],
  water: [(p) => (p.waterSupply && p.waterDemand !== undefined ? p.waterDemand / p.waterSupply : undefined), -1, '물 사용률'],
  police: [(p) => p.crimes, -1, '범죄'],
  education: [(p) => p.eq, 1, '교육 지수'],
  traffic: [(p) => p.commute, -1, '통근 시간'],
  environment: [(p) => p.air, -1, '대기 오염'],
};
/** Which way a goal went over the last three months (null when flat or not yet known): up or down, whether that is
 *  better, and the words for it. */
function driftOf(id: GoalId | 'rating'): { up: boolean; good: boolean; said: string } | null {
  const d = DRIFT[id];
  const h = city.state.history;
  if (!d || h.length < 4) return null;
  const now = d[0](h.at(-1)!);
  const then = d[0](h.at(-4)!);
  if (now === undefined || then === undefined) return null;
  const change = now - then;
  if (Math.abs(change) <= Math.max(Math.abs(then), Math.abs(now)) * 0.03) return null;
  const good = Math.sign(change) === d[1];
  return { up: change > 0, good, said: `${d[2]}: 3개월 전보다 ${change > 0 ? '늘었습니다' : '줄었습니다'} (${good ? '좋아지는 중' : '나빠지는 중'})` };
}
/** {@link driftOf} as the pane's rows show it: ▲ or ▼, toned by whether that is better (nothing when flat). */
function drift(id: GoalId): string {
  const d = driftOf(id);
  return d ? `<small class="w-drift ${d.good ? 'up' : 'down'}" title="${d.said}">${d.up ? '▲' : '▼'}</small>` : '';
}

/** The goals watched (재정 included: money is watched with the rest, the most in need of which M opens). */
const WATCHED = GOAL_ORDER;

/**
 * 해결할 문제: what is wrong, the most serious first with the one thing to do about it,
 * the rest a row each (their goal's screen says more); an emergency (a fire, a riot, a
 * blackout) above them all. With nothing wrong, one quiet line.
 */
/** A figure the pane reads that is no goal of its own: jobs (on 개발·수요's row). */
export interface PaneFigs { jobs: number; jobsTrend: string }

/**
 * The mayor's rating as a row's tone: below 0 urgent, below 20 a look — not before a month has closed with
 * residents (it is worked out at the month's end, and until then its 0 said 주민 만족이 낮음 of a town nobody had rated).
 */
const ratingTone = (rating: number): Tone => (!ratingRated() ? '' : rating < 0 ? 'bad' : rating < 20 ? 'warn' : '');

export function problemsHtml(alerts: string, figs: PaneFigs): string {
  const step = nextStep();
  const inc = new Set(incidents().map((x) => x.goal as GoalId));
  // (The areas: money and the mayor's rating are the city's own, on its scoreboard and its tabs.)
  const all = AREA_ORDER.map((id) => ({ id, s: goalStatus(id) })).filter(({ id, s }) => s.tone === 'bad' || s.tone === 'warn' || inc.has(id));
  const bad = all.filter(({ s }) => s.tone === 'bad').length;
  const warn = all.length - bad;
  // (Said by colour too: the counts are the red and the amber rows below.)
  const look = warn ? `<span class="sec-note" title="주황으로 표시된 항목: 두면 나빠질 수 있는 분야">살펴볼 것 ${warn}</span>` : '';
  const counts = bad ? `<span class="chip bad" title="빨강으로 표시된 항목: 지금 손봐야 할 분야">급한 일 ${bad}</span>${look}` : look || '<span class="sec-note">모두 양호</span>';
  // No separate "what to do": 도시 상태 shows what needs a hand, and each area's screen says what to do.
  // Only what cannot wait (a fire, a riot, a blackout, impeachment) stands above it.
  return qualityGrid(counts, `${alerts}${step.urgent ? step.html : ''}`, figs);
}

/**
 * The city's money and the mayor's rating under its scoreboard (the city's own, not areas): each its figure, coloured
 * when it wants a look; pressed, its tab of the city's screen.
 */
export function cityStats(): string {
  const st = readStats();
  const fin = goalStatus('finance');
  const rTone = ratingTone(st.mayorRating);
  const rated = ratingRated();
  const fig = monthNet();
  const stat = (key: 'finance' | 'rating', tone: Tone, glyph: IconName, name: string, value: string, sub: string, title: string) =>
    `<button type="button" class="cs ${tone || 'ok'}" data-city-row="${key}" title="${escapeHtml(`${title} · 눌러서 ${name} 탭`)}"><span class="cs-ic">${icon(glyph)}</span><span class="cs-name">${name}</span><b class="cs-val">${escapeHtml(value)}</b>${sub ? `<small class="cs-sub">${escapeHtml(sub)}</small>` : ''}</button>`;
  return `<div class="city-stats">${stat('finance', fin.tone, 'wallet', '재정', fin.value, fig, `재정: ${fin.value} · ${glue(fin.note)}`)}${stat('rating', rTone, 'approval', '시장 평점', rated ? String(st.mayorRating) : '—', '', rated ? `시장 평점 ${st.mayorRating} (−100~100)` : '시장 평점: 주민이 든 달이 지나면 매겨집니다')}</div>`;
}

/** The month's balance in a word ('' before the first books close). */
function monthNet(): string {
  const b = city.state.lastBudget;
  if (!b) return '';
  const net = Math.round(b.income - b.expenses);
  return `${net < 0 ? '−' : '+'}§${short(Math.abs(net))}/월`;
}

/** Wide, the pane's overview without the areas' list (they stand down the map's left with their figures): only what
 *  cannot wait — a fire or a riot to send units to, a blackout, impeachment — in a card of its own, if any. */
export function urgentHtml(alerts: string): string {
  const step = nextStep();
  const top = `${alerts}${step.urgent ? step.html : ''}`;
  return top ? `<section class="card quality urgent-only" aria-label="기다릴 수 없는 일">${top}</section>` : '';
}

/**
 * 도시 상태 (with how many need a hand): every goal's figure as a tile, in a fixed place (the scoreboard's makings:
 * what draws people, jobs and a good rating); a tile tinted when it needs looking at.
 */
function qualityGrid(counts: string, top: string, figs: PaneFigs): string {
  // One column, worst first: a troubled area is a row with its icon on a red or amber badge, its
  // figure and why in a line; the sound ones follow as plain rows, in their usual order.
  const rank = (t: Tone) => (t === 'bad' ? 0 : t === 'warn' ? 1 : 2);
  const rows = AREA_ORDER.map((id) => ({ id, s: goalStatus(id) }))
    .sort((a, b) => rank(a.s.tone) - rank(b.s.tone) || (a.s.tone ? WEIGHT[b.id] - WEIGHT[a.id] : 0));
  const row = ({ id, s }: (typeof rows)[number]) => {
    const g = GOALS[id];
    const wait = journal().pending[id] ? '<small class="s-wait" title="한 조치의 결과를 기다리는 중 (석 달 뒤 알려 드립니다)">결과 기다리는 중</small>' : '';
    // (A row with a line under it lays that line across the row: has-note.)
    return `<button type="button" class="s-row ${s.tone || 'ok'}${s.tone || id === 'growth' ? ' has-note' : ''}${active === id ? ' on' : ''}" data-goal="${id}" title="${g.name}: ${escapeHtml(glue(s.note))} · 눌러서 자세히" aria-label="${g.name}${s.tone === 'bad' ? ', 조치 필요' : s.tone === 'warn' ? ', 주의' : ''}: ${s.value}">
      <span class="s-ic">${icon(g.icon)}</span><span class="s-main"><span class="s-name">${g.name}${wait}</span>${id === 'growth'
        ? `<small class="s-note"><span class="s-sub">일자리 ${fmt(figs.jobs)}${figs.jobsTrend}</span>${s.tone ? ` · ${escapeHtml(glue(s.note))}` : ''}</small>`
        : s.tone ? `<small class="s-note">${escapeHtml(glue(s.note))}</small>` : ''}</span><b class="s-val">${drift(id)}${id === 'growth' ? `${rciMini()}${s.value.replace(' 수요 ', ' ')}` : s.value}</b>${icon('chevronRight', 's-go')}</button>`;
  };
  let off = rows.filter(({ s }) => s.tone).map((r) => ({ key: r.id as string, html: row(r) }));
  let sound = rows.filter(({ s }) => !s.tone).map((r) => ({ key: r.id as string, html: row(r) }));
  // Under a pointer the rows keep their places (their figures still move): a row sorted up as the month
  // turned took the click meant for the one that had been there. They sort again once it leaves.
  const byKey = new Map([...off, ...sound].map((e) => [e.key, e]));
  if (listOrder && hoverable() && document.querySelector('#status .s-list:hover') && listOrder.keys.length === byKey.size && listOrder.keys.every((k) => byKey.has(k))) {
    const held = listOrder.keys.map((k) => byKey.get(k)!);
    [off, sound] = [held.slice(0, listOrder.split), held.slice(listOrder.split)];
  }
  listOrder = { keys: [...off, ...sound].map((e) => e.key), split: off.length };
  // What the arrows mean, said once under the list while any shows (a red ▼ by 90k / 100k read as a puzzle).
  const arrows = [...off, ...sound].some((r) => r.html.includes('w-drift'));
  // (The arrows themselves uncoloured here: a green ▲ and a red ▼ said up is good, beside a red ▲ for crime.)
  const key = arrows ? '<p class="s-legend">▲▼ 지난 3개월 흐름 · <span class="s-good">초록 좋아짐</span> · <span class="s-bad">빨강 나빠짐</span></p>' : '';
  return `<section class="card quality" aria-label="도시 상태"><div class="sec-head"><h2>도시 상태</h2>${counts}</div>${top}<div class="s-list">${off.map((e) => e.html).join('')}${off.length && sound.length ? `<p class="s-split">양호 ${sound.length}</p>` : ''}${sound.map((e) => e.html).join('')}</div>${key}</section>`;
}

/** The order 도시 상태 was last drawn in, and where its 양호 began (held while the pointer is over the list). */
let listOrder: { keys: string[]; split: number } | null = null;
const hoverable = () => matchMedia('(hover: hover)').matches;

/**
 * Each area's state, a button each — 시작하기 first while its checklist shows (pressed, the city pane, which holds it);
 * the area whose screen is open lit, its × beside it. (The areas: growth, the utilities, and what makes a place pleasant
 * to live in; money and the mayor's rating are the city's own — {@link refreshCityRows}.) Wide, down the map's left
 * under the city's card (the rail), in an order that never changes: each its name, its figure (▲▼ the last three
 * months) and how it stands drawn under them — no words of why, its colour saying it needs a hand (the why in its
 * tooltip and on its screen). A phone, a row of chips under its top buttons: the areas needing a hand first (anything
 * burning first), compact, the urgent by name, the rest by their icons alone, the open screen's first. What either
 * can't show scrolls in, its cut edge faded.
 */
export function refreshStrip(): void {
  const el = $('#goal-strip');
  const wide = !phone();
  // (A lone fire the stations are putting out is its row's amber, not red.)
  const inc = new Set(incidents().filter((x) => x.urgent).map((x) => x.goal as GoalId));
  const rank = (t: Tone) => (t === 'bad' ? 0 : t === 'warn' ? 1 : 2);
  // (One stop for Tab in the row, the chip last in hand; the arrows go along it: a toolbar.)
  const tab = (k: string) => `tabindex="${k === stripAt ? 0 : -1}" data-tk="${k}"`;
  type Chip = { key: string; tone: Tone; weight: number; html: (on: boolean) => string };
  const chips: Chip[] = AREA_ORDER.map((id) => {
    const g = GOALS[id];
    const s = goalStatus(id);
    const fire = inc.has(id);
    const tone: Tone = fire ? 'bad' : s.tone;
    const glyph = icon(fire ? (id === 'fire' ? 'flame' : 'megaphone') : g.icon);
    const said = tone === 'bad' ? ', 조치 필요' : tone === 'warn' ? ', 주의' : '';
    const note = tone ? glue(s.note) : '';
    const d = wide ? driftOf(id) : null;
    // (개발·수요's figure as the pane's row has it: "주거 상한", "상업 +540".)
    const value = id === 'growth' ? s.value.replace(' 수요 ', ' ') : s.value;
    // (개발·수요's classes in words, sound — "주거 +709" alone said nothing of the other two — and the jobs, watched here
    // as the pane's row has them.)
    const fig = id === 'growth' ? `${tone ? '' : `${glue(s.note)} · `}일자리 ${fmt(readStats().jobs)}` : '';
    // (The classes said, the class most wanted among them is said: "주거 +709 · 주거 +709 · 상업 …" read twice.)
    const head = id === 'growth' && !tone ? fig : `${value}${fig ? ` · ${fig}` : ''}`;
    const graph = wide ? railSpark(id) : null;
    const words = `${head}${note ? ` · ${note}` : ''}${d ? ` · ${d.said}` : ''}${graph?.said ? ` · 그래프: ${graph.said}` : ''}`;
    return {
      key: id, tone, weight: WEIGHT[id],
      html: (on: boolean) => wide
        ? `<button type="button" class="${tone || 'ok'}"${on ? '' : ` data-k="${id}"`} ${tab(id)} data-strip-goal="${id}" title="${escapeHtml(`${g.name}: ${words} · ${on ? '눌러서 도시 현황 닫기·열기 (×는 화면 닫기)' : `눌러서 ${g.name} 화면`}`)}" aria-label="${escapeHtml(`${g.name}${said}: ${head}${note ? `, ${note}` : ''}`)}"${on ? ' aria-pressed="true"' : ''}>${glyph}<span class="r-name">${g.name}</span>${graph!.svg}</button>`
        : `<button type="button" class="${tone || 'ok'}${tone === 'bad' || on ? '' : ' bare'}"${on ? '' : ` data-k="${id}"`} ${tab(id)} data-strip-goal="${id}" title="${g.name}: ${escapeHtml(s.value)}${tone ? ` · ${escapeHtml(note)}` : ''} · 눌러서 ${g.name} 화면" aria-label="${g.name}${said}: ${escapeHtml(s.value)}"${on ? ' aria-pressed="true"' : ''}>${glyph}${tone === 'bad' || on ? g.name : ''}</button>`,
    };
  });
  // Wide, one order for good, the areas as their screens go (a button moved up as an area turned red left another under
  // the pointer, and the eye looked for each in a new place). A phone's chips, the troubled first.
  const sorted = wide ? chips : chips.map((c, k) => ({ c, k }))
    .sort((a, b) => rank(a.c.tone) - rank(b.c.tone) || (a.c.tone ? b.c.weight - a.c.weight : a.k - b.k)).map(({ c }) => c);
  refreshCityRows(wide);
  refreshCityTabs();
  // 시작하기 and how far along, while its checklist shows (the city pane holds it).
  const start = !checklist ? ''
    : wide ? `<button type="button" class="strip-start" data-k="start" ${tab('start')} data-strip-start title="시작하기: ${checklist.done}/${checklist.of} 완료 · 눌러서 도시 현황의 시작하기 목록" aria-label="시작하기: ${checklist.done}/${checklist.of} 완료 · 도시 현황">${icon('sparkles')}<span class="r-name">시작하기</span><span class="r-val">${checklist.done}/${checklist.of}</span></button>`
    : `<button type="button" class="strip-start" data-k="start" ${tab('start')} data-strip-start title="시작하기: ${checklist.done}/${checklist.of} 완료 · 눌러서 도시 현황의 시작하기 목록" aria-label="시작하기: ${checklist.done}/${checklist.of} 완료 · 도시 현황">${icon('sparkles')}<span>시작하기 <small>${checklist.done}/${checklist.of}</small></span></button>`;
  // The open screen's lit, with its × — a phone's first after 시작하기; wide, in its place (a button that jumped to
  // the top as it was pressed left another under the pointer).
  const on = active ? sorted.find((c) => c.key === active) : undefined;
  const lit = on && active ? `<span class="strip-on" data-k="on" role="group" aria-label="열린 화면: ${GOALS[active].name}">${on.html(true)}<button type="button" ${tab('end')} data-strip-end title="${GOALS[active].name} 화면 닫기 (지도 보기도 꺼짐)" aria-label="${GOALS[active].name} 화면 닫기">${icon('close')}</button></span>` : '';
  const html = start + (wide
    ? sorted.map((c) => (c === on ? lit : c.html(false))).join('')
    : lit + sorted.filter((c) => c !== on).map((c) => c.html(false)).join(''));
  el.hidden = false;
  if (html !== stripSeen) {
    stripSeen = html;
    const had = el.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.tk : undefined;
    patchRow(el, html);
    keepStop(el);
    // (Moved, a chip lets go of the focus: back on it — or on the row's stop, its chip gone.)
    if (had !== undefined && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>(`[data-tk="${had}"]`) ?? el.querySelector<HTMLElement>('[tabindex="0"]'))?.focus({ preventScroll: true });
  }
  fadeStrip(el);
}
/** The city's card's rows as last drawn. */
let cityRowsSeen = '';
/**
 * The city's own figures beside its name and size: 재정 (the money, the month's balance) and 시장 평점 — wide, two rows
 * of its card under the city button, drawn as the areas' are (pressed, that tab of the city's screen, lit while it
 * shows; pressed again, put away); on a phone, a mark on the city button for each that wants a look.
 */
function refreshCityRows(wide: boolean): void {
  const st = readStats();
  const fin = goalStatus('finance');
  const rTone = ratingTone(st.mayorRating);
  const rated = ratingRated();
  const rNote = !rTone ? '' : st.mayorRating < 0 ? '주민 대다수가 불만 · 계속되면 탄핵될 수 있음' : '주민 만족이 낮음 · 여론을 살펴보세요';
  const said = (t: Tone) => (t === 'bad' ? '조치 필요' : t === 'warn' ? '주의' : '');
  markCity();
  const btn = $('#btn-city');
  const flag = $('#city-flag');
  if (!wide) {
    const marks: [IconName, Tone, string][] = [];
    if (fin.tone) marks.push(['wallet', fin.tone, `재정 ${said(fin.tone)}`]);
    if (rTone) marks.push(['approval', rTone, `시장 평점 ${said(rTone)}`]);
    const key = marks.map((m) => m.join()).join('|');
    if (flag.dataset.key !== key) {
      flag.dataset.key = key;
      flag.innerHTML = marks.map(([glyph, tone]) => `<span class="cf ${tone}">${icon(glyph)}</span>`).join('');
    }
    flag.hidden = !marks.length;
    if (marks.length) btn.setAttribute('aria-description', marks.map((m) => m[2]).join(', '));
    else btn.removeAttribute('aria-description');
    return;
  }
  flag.hidden = true;
  btn.removeAttribute('aria-description');
  // (Lit, the one whose tab shows.)
  const lit = active === 'finance' && paneShown() ? (tabNow('finance').label === '시장 평점' ? 'rating' : 'finance') : '';
  const row = (key: 'finance' | 'rating', tone: Tone, glyph: IconName, name: string, words: string) => {
    const d = driftOf(key);
    const on = lit === key;
    const graph = railSpark(key);
    return `<button type="button" class="strip-city ${tone || 'ok'}${on ? ' on' : ''}" data-k="${key}" data-city-row="${key}" aria-pressed="${on}" title="${escapeHtml(`${name}: ${words}${d ? ` · ${d.said}` : ''}${graph.said ? ` · 그래프: ${graph.said}` : ''} · ${on ? '눌러서 닫기' : `눌러서 도시 화면의 ${name} 탭`}`)}" aria-label="${escapeHtml(`${name}${tone ? `, ${said(tone)}` : ''}: ${words}`)}">${icon(glyph)}<span class="r-name">${name}</span>${graph.svg}</button>`;
  };
  // (The month's balance once: its own, or the line that says it with how long the money lasts.)
  const html = row('finance', fin.tone, 'wallet', '재정', `${fin.value}${fin.tone ? ` · ${glue(fin.note)}` : monthNet() ? ` · ${monthNet()}` : ''}`)
    + row('rating', rTone, 'approval', '시장 평점', `${rated ? `${st.mayorRating} (−100~100)` : '아직 없음 (주민이 든 달이 지나면 매겨짐)'}${rNote ? ` · ${rNote}` : ''}`);
  if (html === cityRowsSeen) return;
  cityRowsSeen = html;
  patchRow($('#city-rows'), html);
}

/** The row's cut edges faded where it scrolls: sideways on a phone, up and down in the rail. */
function fadeStrip(el: HTMLElement): void {
  if (phone()) {
    el.classList.remove('more-up', 'more-down');
    edgeFade(el);
  } else {
    el.classList.remove('more-left', 'more-right');
    el.classList.toggle('more-down', el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    el.classList.toggle('more-up', el.scrollTop > 2);
  }
  markHidden(el);
}

/**
 * Wide, the areas needing a hand that the rail's scroll hides (a short window: its fixed order put four amber ones out
 * of sight, with only the fade to hint at them): how many, at the edge they are beyond; pressed, the first of them.
 */
function markHidden(el: HTMLElement): void {
  for (const edge of ['up', 'down'] as const) {
    let mark = document.getElementById(`rail-${edge}`) as HTMLButtonElement | null;
    const box = el.getBoundingClientRect();
    const hid = phone() || !el.getClientRects().length ? [] : [...el.querySelectorAll<HTMLElement>('button.warn, button.bad')].filter((b) => {
      const r = b.getBoundingClientRect();
      return edge === 'down' ? r.top + r.height / 2 > box.bottom : r.bottom - r.height / 2 < box.top;
    });
    if (!hid.length) {
      if (mark) mark.hidden = true;
      continue;
    }
    if (!mark) {
      mark = document.createElement('button');
      mark.type = 'button';
      mark.id = `rail-${edge}`;
      mark.className = `rail-hidden ${edge}`;
      mark.tabIndex = -1; // (the rows themselves are in the Tab order; this only points)
      $('#rail').append(mark);
    }
    const bad = hid.filter((b) => b.classList.contains('bad')).length;
    const parts = [bad && `급함 ${bad}`, hid.length - bad && `주의 ${hid.length - bad}`].filter(Boolean).join(' · ');
    mark.innerHTML = `${edge === 'down' ? '▼' : '▲'} ${parts}`;
    mark.title = `${edge === 'down' ? '아래' : '위'}에 가려진 분야: ${hid.map((b) => b.querySelector('.r-name')?.textContent ?? '').join(', ')} · 눌러서 보기`;
    mark.className = `rail-hidden ${edge}${bad ? ' bad' : ''}`;
    if (edge === 'up') mark.style.top = `${el.offsetTop + 4}px`; // (under the city's card, at the list's own top)
    mark.hidden = false;
    const first = edge === 'down' ? hid[0]! : hid.at(-1)!;
    mark.onclick = () => first.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}
/**
 * The row's one Tab stop: the chip last in hand — gone (an area sound again, a screen closed), the first; out of sight
 * (the open screen's ×, which the rail's narrow column beside the pane leaves out), the open area's own. (Left on the
 * hidden ×, Tab went past the whole row.)
 */
function keepStop(el: HTMLElement): void {
  const seen = (b: HTMLElement) => b.getClientRects().length > 0;
  const stop = el.querySelector<HTMLElement>('[tabindex="0"]');
  if (stop && (seen(stop) || !seen(el))) return;
  const all = [...el.querySelectorAll<HTMLElement>('button')];
  const to = (stop && el.querySelector<HTMLElement>('.strip-on [data-strip-goal]')) || all.find(seen) || all[0];
  if (!to) return;
  stop?.setAttribute('tabindex', '-1');
  to.setAttribute('tabindex', '0');
  stripAt = to.dataset.tk ?? 'start';
}
/** A series an item's rail graph draws from the city's monthly record: its name, and its value in a month. */
type Series = [label: string, value: (h: HistoryPoint) => number | undefined];
/**
 * What each item's graph on the rail draws: its line, and — dashed, in the same unit and on one scale — what to read it
 * against (the load and what meets it: demand and supply, money out and in, crimes and arrests). A line the record
 * doesn't hold yet (an older save's) gives way to the one after it.
 */
const SPARK: Record<GoalId | 'rating', { a: Series; b?: Series; alt?: Series }> = {
  finance: { a: ['지출', (h) => h.expenses], b: ['수입', (h) => h.income] },
  rating: { a: ['시장 평점', (h) => h.mayorRating] },
  growth: { a: ['인구', (h) => h.population], b: ['일자리', (h) => h.jobs] },
  power: { a: ['수요', (h) => h.powerDemand], b: ['공급', (h) => h.powerSupply] },
  water: { a: ['수요', (h) => h.waterDemand], b: ['공급', (h) => h.waterSupply] },
  garbage: { a: ['발생', (h) => h.garbageProduced], b: ['못 치움', (h) => h.garbageUncollected] },
  police: { a: ['범죄', (h) => h.crimes], b: ['체포', (h) => h.arrests] },
  fire: { a: ['화재', (h) => h.fires], b: ['전소', (h) => h.burned] },
  health: { a: ['건강 지수', (h) => h.hq], alt: ['기대 수명', (h) => h.lifeExpectancy] },
  education: { a: ['교육 지수', (h) => h.eq] },
  traffic: { a: ['평균 통근', (h) => h.commute] },
  environment: { a: ['대기 오염', (h) => h.air], b: ['수질 오염', (h) => h.waterPollution] },
};
/** The months a rail graph covers. */
const SPARK_SPAN = 24;

/**
 * An item's graph on the rail, over its last months, from nothing up (its line as the item stands — amber or red when
 * it wants a hand — over a faint fill; the second dashed; a line at nothing when it goes below), and the words for it.
 * Under two months to draw, a dotted line in its room (nothing read yet, as a figure's "—": not a line at nothing).
 */
function railSpark(key: GoalId | 'rating'): { svg: string; said: string } {
  const def = SPARK[key];
  const months = city.state.history.slice(-SPARK_SPAN);
  const read = (series: Series) => months.map((h) => {
    const v = series[1](h);
    return v === undefined || !Number.isFinite(v) ? null : v;
  });
  const count = (vs: (number | null)[]) => vs.filter((v) => v !== null).length;
  let a = def.a;
  let va = read(a);
  if (def.alt && count(va) < 2) va = read((a = def.alt));
  const vb = def.b ? read(def.b) : [];
  const open = '<svg class="r-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">';
  if (count(va) < 2) return { svg: `${open}<path class="sn" d="M0 12H100"/></svg>`, said: '' };
  const all = [...va, ...vb].filter((v): v is number => v !== null);
  const lo = Math.min(0, ...all);
  const hi = Math.max(lo + 1e-6, ...all);
  const n = months.length;
  const x = (i: number) => ((i / (n - 1)) * 100).toFixed(1);
  const y = (v: number) => (22 - ((v - lo) / (hi - lo)) * 20).toFixed(1);
  const line = (vs: (number | null)[]) => {
    let d = '';
    let pen = false;
    vs.forEach((v, i) => {
      if (v === null) pen = false;
      else {
        d += `${pen ? 'L' : 'M'}${x(i)} ${y(v)}`;
        pen = true;
      }
    });
    return d;
  };
  // (The fill only under an unbroken line: across a gap it closed over nothing.)
  const first = va.findIndex((v) => v !== null);
  const last = va.length - 1 - [...va].reverse().findIndex((v) => v !== null);
  const whole = va.slice(first, last + 1).every((v) => v !== null);
  const fill = whole ? `<path class="sa" d="${line(va)}L${x(last)} 24L${x(first)} 24Z"/>` : '';
  const zero = lo < 0 ? `<path class="s0" d="M0 ${y(0)}H100"/>` : '';
  const second = def.b && count(vb) >= 2 ? `<path class="s2" d="${line(vb)}"/>` : '';
  return { svg: `${open}${zero}${fill}${second}<path class="s1" d="${line(va)}"/></svg>`, said: `지난 ${n}개월 ${a[0]}${second ? `(실선)·${def.b![0]}(점선)` : ''}` };
}
/** The chips' markup as last drawn (what the row shows, unless it changed). */
let stripSeen = '';
/** The chip the row's Tab stop is on (its data-tk): the one last focused or arrowed to. */
let stripAt = 'start';

/**
 * Brings a row of keyed chips (data-k) to `html` in place: a chip kept is the same element, brought to its new look
 * (its words, its title) rather than made anew, and moved only if its place changed. (Rebuilt whole every update,
 * the row lost a press between its down and its up, and the keyboard's place with it.)
 */
function patchRow(row: HTMLElement, html: string): void {
  const t = document.createElement('template');
  t.innerHTML = html;
  const old = new Map([...row.children].map((c) => [(c as HTMLElement).dataset.k ?? '', c]));
  let prev: Element | null = null;
  for (const n of [...t.content.children]) {
    const k = (n as HTMLElement).dataset.k ?? '';
    const o = old.get(k);
    let node = n;
    if (o && o.tagName === n.tagName) {
      morph(o, n);
      old.delete(k);
      node = o;
    }
    if ((prev ? prev.nextElementSibling : row.firstElementChild) !== node) {
      if (prev) prev.after(node);
      else row.prepend(node);
    }
    prev = node;
  }
  for (const o of old.values()) o.remove();
}

/** `old` made to look like `next`, keeping its nodes where they line up (only their attributes and words change).
 *  (A title by its property: a chip under the pointer has its title kept aside by its tooltip, tips.ts, which shows
 *  the new one — set as an attribute, the browser's own came up beside it.) */
function morph(old: Element, next: Element): void {
  for (const a of [...old.attributes]) if (!next.hasAttribute(a.name) && a.name !== 'aria-describedby') old.removeAttribute(a.name);
  for (const a of [...next.attributes]) {
    if (a.name === 'title' && old instanceof HTMLElement) {
      if (old.title !== a.value) old.title = a.value;
    }
    else if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
  }
  const [oc, nc] = [[...old.childNodes], [...next.childNodes]];
  if (oc.length !== nc.length || oc.some((c, i) => c.nodeName !== nc[i]!.nodeName)) {
    old.replaceChildren(...nc);
    return;
  }
  oc.forEach((c, i) => {
    const n = nc[i]!;
    if (c.nodeType === Node.ELEMENT_NODE) morph(c as Element, n as Element);
    else if (c.nodeValue !== n.nodeValue) c.nodeValue = n.nodeValue;
  });
}

// ------------------------------------------------------------------ the next step

/**
 * The next step: the goal most in need (조치 필요 before 주의) and the one thing its
 * screen recommends (its 추천 build, else its advisor's fix): the bar's and view list's
 * single dot follow it, and a fire or riot's card stands over 도시 상태. Worked out
 * again when the city or a goal's state changes.
 */
/** The next step: a problem's (its goal, tone and lead), or with nothing wrong the next way to grow. */
interface Step { goal: GoalId | null; problem: boolean; html: string; /** a fire or riot to answer now */ urgent?: boolean; /** the tool its 해 보기 picks up, if any */ act?: string }
const NO_STEP: Step = { goal: null, problem: false, html: '' };
let stepMemo: { key: string; step: Step } | null = null;
export function nextStep(): Step {
  const tones = GOAL_ORDER.map((id) => goalStatus(id).tone);
  const key = `${changeKey()}|${tones.join()}|${active}|${incidents().map((x) => `${x.title}${x.urgent ? '!' : ''}`).join()}|${city.freeUnits('fire')}|${city.freeUnits('police')}`;
  if (stepMemo?.key === key) return stepMemo.step;
  const step = nextHtml(tones);
  stepMemo = { key, step };
  return step;
}

/** What a goal's trouble costs if it is left (a problem's second line: the reason to act now). */
/** What it costs if left, for a trouble whose cost isn't its goal's (worn lines spark fires rather than cut power). */
const RISK_OF: Record<string, string> = {
  linesWorn: '예산이 50% 아래로 내려가면 낡은 송전선에서 불꽃이 튀어 불이 납니다',
  pipesWorn: '낡은 수도관은 터져 싱크홀이 생깁니다',
  potholes: '포트홀이 늘면 길이 느려지고 통근이 길어집니다',
  policeStrike: '파업 중에는 순찰과 체포가 크게 줄어 범죄가 늘어납니다',
  fireStrike: '파업 중에는 불을 끄는 힘이 크게 줄어 불이 번집니다',
  plantOld: '수명이 다한 발전소는 폭발해 둘레를 태웁니다',
  plantUnprotected: '불이 나면 발전소가 폭발해 둘레까지 부숩니다',
  facilityNoRoad: '쓰레기가 쌓이고, 경찰서·소방서·병원·학교라면 불이나 범죄에 출동하지 못합니다',
  atRisk: '두면 그 건물들이 비어 인구와 세입이 줄고, 빈 건물은 범죄를 부릅니다',
  taxHigh: '두면 들어오려는 주민·기업이 막혀 인구도 세입도 더 늘지 않습니다',
};

const RISK: Record<GoalId, string> = {
  finance: '자금이 바닥나면 아무것도 지을 수 없고 시장이 탄핵될 수 있습니다',
  growth: '두면 빈 구역이 늘고 인구가 더 늘지 않습니다',
  power: '전기가 끊긴 건물은 비고 성장이 멈춥니다',
  water: '물이 모자라면 건물이 비고 성장이 멈춥니다',
  garbage: '쌓인 쓰레기는 땅값과 건강을 떨어뜨립니다',
  police: '범죄가 늘면 땅값과 시장 평점이 떨어집니다',
  fire: '불이 나면 번져 건물을 잃습니다',
  health: '건강과 수명이 떨어지고 부유층이 떠납니다',
  education: '교육이 낮으면 고급 일자리와 부유층이 오지 않습니다',
  traffic: '통근이 길면 주민이 떠나고 개발이 막힙니다',
  environment: '오염은 건강과 시장 평점을 떨어뜨리고, 쾌적하지 않으면 부유층이 오지 않습니다',
};

/** How much each goal's trouble weighs, for what leads: no power or water, money running out, a fire, before traffic or the air. */
const WEIGHT: Record<GoalId, number> = { finance: 6, growth: 5, power: 9, water: 8, garbage: 5, police: 5, fire: 7, health: 5, education: 4, traffic: 3, environment: 3 };

/** An advisor's line in words (as the 진단 list says it). */
const adviceText = (a: ReturnType<typeof adviceFor>[number]) => (a.code === 'waterShort' && waterApart() ? APART : ADVICE_TEXT[a.code]?.(a.value ?? 0, a.type) ?? '');
/** Two lines the same but for punctuation and spacing (an advisor's fix often repeats the problem). */
const same = (a: string, b: string) => a.replace(/[\s.·,]/g, '') === b.replace(/[\s.·,]/g, '');

/** The advisor's word a troubled goal's 추천 조치 leads with (its first sentence), and that word; none for a sound goal or one on fire. */
function guideSaid(id: GoalId): { said: string; worst?: ReturnType<typeof adviceFor>[number] } {
  if (!goalStatus(id).tone || incidents().some((x) => x.goal === id)) return { said: '' };
  const advice = adviceFor(id);
  const worst = advice.find((x) => x.level === 'bad') ?? advice.find((x) => x.level !== 'good');
  // (A full hospital or school named, as its row has it, and all of them beside it: the figures under it are the whole.)
  return { said: worst ? fullNote(worst, id) || (adviceText(worst) ? firstSentence(adviceText(worst)) : '') : '', worst };
}

/**
 * 추천 조치, at the top of a troubled goal's screen, read top down: what is wrong (as its advisor
 * says it), what it costs if left, then the action in a box of its own — the facility or tool with
 * its price and upkeep, what it would do, 해 보기 to take it up and, where the screen has a site
 * for it, 추천 자리에 짓기. Once something was done here, when its result will be told.
 * (A fire or a riot has its banner instead; a sound goal shows nothing here.)
 */
/**
 * The guide's card in two: what is wrong and what it costs (the head of the screen's scoreboard, on every tab), and the
 * step to take for it (the first of its actions, on every tab: the goal's next step whichever part is being looked at).
 */
function guideHtml(id: GoalId): { head: string; act: string } {
  guideSite = null;
  markSite = null;
  const s = goalStatus(id);
  if (!s.tone || incidents().some((x) => x.goal === id)) return { head: '', act: '' };
  const st = goalStep(id);
  // What is wrong as its advisor says it; with no advisor's word, the figure itself and its note.
  const { said: told, worst } = guideSaid(id);
  // (A line to lay while the card leads with something else, a plant off the road: what the line mends instead.)
  const offGrid = id === 'power' && st.kind === 'line' && st.lay === 'powerline' && !['noPower', 'powerCutOff', 'idlePlant', 'powerShort'].includes(worst?.code ?? '');
  const said = st.said ?? (offGrid ? `전기 없는 구역이 ${fmt(unpoweredZones().off)}칸 있습니다` : told);
  const problem = said || s.note;
  const title = said ? `<b>${escapeHtml(glue(said))}</b>` : `<b>${escapeHtml(s.value)}</b> <span class="g-note">${escapeHtml(glue(s.note))}</span>`;
  const spot = suggestSpot(id);
  let action: string;
  if (st.wait) {
    action = `<div class="g-act"><p class="g-act-head">${icon('check')}<b>다음 달까지 기다리면 됩니다</b></p>
      <p class="g-act-why">${escapeHtml(st.wait)}</p></div>`;
  } else if (st.kind === 'open') {
    // Nothing to build or press for it: where it is worst, and the views that show why.
    const at = worst?.at ?? (spot ? [spot.x, spot.y] : null);
    action = `<div class="g-act"><p class="g-act-head">${icon('search')}<b>원인부터 살펴보세요</b></p>
      <p class="g-act-why">${goalTabs(id).length > 1 ? `위의 탭(${goalTabs(id).map((t) => t.label).join(' · ')})을 차례로 눌러 지도와 ` : '지도와 '}아래 진단에서 원인을 찾으세요</p>
      ${at ? `<div class="g-act-btns"><button type="button" class="primary" data-spot="${at.join(',')}">${icon('target')}가장 심한 곳 보기</button></div>` : ''}</div>`;
  } else if (st.widen) {
    // A stretch to widen, shown on the map from end to end before it is widened.
    const { run, to } = st.widen;
    const path: [number, number][] = [];
    for (let y = Math.min(run[1], run[3]); y <= Math.max(run[1], run[3]); y++) for (let x = Math.min(run[0], run[2]); x <= Math.max(run[0], run[2]); x++) path.push([x, y]);
    guideSite = { id, sites: [{ at: [run[0], run[1]], label: '' }, { at: [run[2], run[3]], label: `${to === 'road' ? '도로' : '대로'} ${fmt(path.length)}칸` }], path };
    const short = st.sub.includes('자금 부족');
    action = `<div class="g-act"><p class="g-act-head">${st.glyph}<b>${escapeHtml(st.what)}</b><small class="${short ? 'neg' : ''}">${escapeHtml(st.sub)}</small></p>
      <p class="g-act-why">${escapeHtml(st.why)}</p>
      <div class="g-act-btns"><button type="button" class="primary" data-widen="${run.join(',')}" data-widen-kind="${to}" title="지도의 두 과녁 사이 구간을 ${to === 'road' ? '도로' : '대로'}로 바로 넓히기">${icon('plus')}바로 넓히기</button></div></div>`;
  } else if (st.kind === 'line' && st.line && st.lay) {
    // A line or road to lay, shown on the map from end to end before it is laid.
    const [a, b] = [st.line[0]!, st.line.at(-1)!];
    const word = LAY_WORD[st.lay];
    // (One label, at the far end: two ran into each other on a short line.)
    guideSite = { id, sites: [{ at: a, label: '' }, { at: b, label: `${word} ${fmt(st.line.length)}칸` }], path: st.line, lay: st.lay };
    const short = st.sub.includes('자금 부족');
    action = `<div class="g-act"><p class="g-act-head">${st.glyph}<b>${escapeHtml(st.what)}</b><small class="${short ? 'neg' : ''}">${escapeHtml(st.sub)}</small></p>
      <p class="g-act-why">${escapeHtml(st.why)}</p>
      <div class="g-act-btns"><button type="button" class="primary" data-line-path="${st.line.map((p) => p.join(',')).join(';')}" data-line-kind="${st.lay}" title="지도의 두 과녁 사이에 ${word} 바로 놓기">${icon(LAY_ICON[st.lay])}바로 잇기</button></div></div>`;
  } else {
    // (With no forecast the step's why is its price line, already under its name: not twice.)
    const why = st.fx || (st.why && st.why !== st.sub && !same(firstSentence(st.why), problem) ? firstSentence(st.why) : '');
    const short = st.sub.startsWith('자금 부족');
    // A jail serves no area: the mark (a gap in police cover) is a station's place, not its.
    const arealess = !!st.build && STRUCTURES[st.build].police?.radius === 0;
    const mark = st.kind === 'best' && st.site && spot && !spot.crowded && !arealess && (SERVICE_SITE.has(id) || id === 'power' || id === 'water');
    // The mark was checked for the goal's cheapest facility: the one recommended may be bigger. Where it doesn't
    // fit (or can't be built now), the nearest place it does, within 6 tiles.
    const site = mark && (!st.build || !!siteNear(st.build, spot.x, spot.y, 0));
    // No site on the map's mark: one of the facility's own. Beside a school or hospital over its places, room
    // for the one recommended (the mark was found for the one that would relieve it, often smaller); a park
    // for the cap does anywhere, so the free ground nearest the homes (the land was all zoned, and 해 보기 left
    // the player to hunt for a gap); a water source where its water counts, touching the pipes (one standing
    // alone added nothing to the shortage); a plant beside the plants (only the margin short: nothing to mark).
    // (Bus stops come in pairs, as the card says: one where the most people live, one where the most work.)
    const what = id === 'education' ? '학교' : '병원';
    const one = (at: [number, number] | null, title: string) => (at ? { at: [at], title, labels: [] as string[] } : null);
    // (Beside a full school only one of its level takes its students: a primary school by a full high school
    // relieved nothing.)
    const overKind = spot?.crowded && spot.of ? city.query(spot.of[0], spot.of[1])?.structure?.kind : undefined;
    const relieves = !!st.build && (!overKind || !STRUCTURES[overKind].school || STRUCTURES[overKind].school!.curve === STRUCTURES[st.build].school?.curve);
    const own = site || !st.build ? null
      : mark ? ((near) => near ? one(near, `지도의 과녁(${SPOT_WORD[id] ?? ''}) 가까이, 길가 빈 땅에 바로 짓기`)
        // (None by the mark, a plant's smoke keeping it off: the nearest ground clear of homes, which may be far — not "가까이".)
        : one(plantSite(st.build!, spot.x, spot.y), `구역 밖${smokyPlant(st.build!) ? ', 연기가 주거지에 닿지 않는' : ''} 가장 가까운 길가 빈 땅에 바로 짓기`))(siteNear(st.build, spot.x, spot.y, 6))
      : arealess ? one(siteAwayFromHomes(st.build), '주거지에서 떨어진 길가 빈 땅에 바로 짓기')
      : spot?.crowded && st.kind === 'best' ? (relieves ? one(siteNear(st.build, spot.x, spot.y), `넘치는 ${what} 가까이, 길가 빈 땅에 바로 짓기`) : null)
      : st.anywhere ? one(siteNearHomes(st.build), '주거지에서 가장 가까운 길가 빈 땅에 바로 짓기')
      : id === 'water' && STRUCTURES[st.build].pump ? one(siteOnPipes(st.build), '수도관에 닿고 전기가 들어오는 빈 땅에 바로 짓기')
      : id === 'power' && STRUCTURES[st.build].plant ? (one(siteByPlants(st.build), '있는 발전소 옆, 전력망에 닿는 길가 빈 땅에 바로 짓기')
        ?? one(plantSite(st.build), `구역 밖${smokyPlant(st.build) ? ', 연기가 주거지에 닿지 않는' : ''} 길가 빈 땅에 바로 짓기`))
      // (An incinerator smokes and a recycling centre is a works: clear of the homes, by the industry.)
      : id === 'garbage' && (STRUCTURES[st.build].incinerator || STRUCTURES[st.build].recycling) ? one(siteAwayFromHomes(st.build), '주거지에서 떨어진 길가 빈 땅에 바로 짓기')
      : STRUCTURES[st.build].station?.mode === 'bus' ? (() => {
        const pair = stopPair(st.build!);
        return pair ? { at: pair, title: '주민이 가장 많은 곳과 일자리가 가장 많은 곳의 길가에 하나씩 바로 짓기', labels: ['집 쪽', '일터 쪽'] } : null;
      })() : null;
    // (A station's spot is where those it misses gather, not on them: "과녁(경찰이 닿지 않는 건물)에 짓기" read as building
    // on the buildings.)
    const siteTitle = spot?.plants ? '지도의 과녁에 바로 짓기: 소방이 닿지 않는 발전소 가까이'
      : SERVICE_SITE.has(id) ? `지도의 과녁에 바로 짓기: ${SPOT_WORD[id]}${josa(SPOT_WORD[id]!, '이', '가')} 가장 많이 모인 곳 가까이` : `지도의 과녁(${SPOT_WORD[id] ?? ''})에 바로 짓기`;
    // What the press does: an ordinance or a finance lever takes effect at once (해 보기 sounded like a tool to try).
    const go = st.kind === 'ord' ? '시행하기' : st.fin === 'loan' ? '빌리기' : st.fixAct === 'rubble:all' ? '치우기' : st.fin || st.kind === 'budget' ? '적용하기' : '해 보기';
    if (own) guideSite = { id, build: st.build!, sites: own.at.map((at, k) => ({ at, label: `추천 자리 · ${STRUCTURE_NAME[st.build!]}${own.labels[k] ? ` (${own.labels[k]})` : ''}` })) };
    // A landfill handed out as a zone tool: where, and how big, zoned in one press (해 보기 left a spot "by a road,
    // far from homes" to be found, and a size to be guessed).
    // (Not again the month one was laid: the figures that ask for it change at the month's end, and a second press
    // laid a second landfill. Nor beyond the funds.)
    const month = Math.floor(city.state.day / 30);
    const fill0 = !own && !site && (st.kind === 'best' || st.kind === 'fix') && st.act === 'landfill' && placedMonth.get('landfill') !== month ? landfillSite() : null;
    const fill = fill0 && fill0.cost <= city.state.funds ? fill0 : null;
    if (fill) guideSite = { id, sites: [{ at: [fill.x0 + (fill.side >> 1), fill.y0 + (fill.side >> 1)], label: `추천 자리 · 매립지 ${fill.side}×${fill.side}` }], rect: [fill.x0, fill.y0, fill.side, fill.side] };
    // The zone the growth screen wants next (homes, shops, or work for the jobless): a block where it can go, laid in
    // one press (해 보기 handed the zone tool and left the block to be found).
    // (A farm zone too, and from the advisor's own word: 농업 수요가 높은데 빈 농업 구역이 거의 없습니다.)
    const zone = !own && !site && !fill && (st.kind === 'best' || st.kind === 'fix') && (st.act === 'R-low' || st.act === 'C-low' || st.act === 'I-medium' || st.act === 'A')
      && placedMonth.get(st.act) !== month ? st.act : null;
    const block0 = zone ? zoneSite(zone, st.near) : null;
    const blockCost = block0 && zone ? city.previewZone(block0.x0, block0.y0, block0.x1, block0.y1, zone).cost : 0;
    const block = block0 && blockCost <= city.state.funds ? block0 : null;
    if (block) guideSite = { id, sites: [{ at: [block.x0 + (block.side >> 1), block.y0 + (block.side >> 1)], label: `추천 자리 · ${st.what} ${block.side}×${block.side}` }], rect: [block.x0, block.y0, block.side, block.side] };
    if (mark) markSite = { id, at: site ? [spot.x, spot.y] : own?.at[0] ?? null, kind: st.build };
    // (A jail recommended: the mark's 여기에 짓기 puts up a station on the gap in cover, and says so.)
    const station = arealess ? cheapestOf(GOALS.police) : null;
    // (Where it fits, as the mark's own line finds it: the gap's middle was often a building, and each press
    // was refused with "taken meanwhile".)
    if (station && spot) markSite = { id, at: siteNear(station, spot.x, spot.y, 0) ?? siteNear(station, spot.x, spot.y, 6), kind: station, name: STRUCTURE_NAME[station] };
    action = `<div class="g-act"><p class="g-act-head">${st.glyph}<b>${escapeHtml(st.what)}</b>${st.sub ? `<small class="${short ? 'neg' : ''}">${escapeHtml(st.sub)}</small>` : ''}</p>
      ${why ? `<p class="${st.fx ? `g-act-fx${/−|모자람/.test(st.fx) ? ' neg' : ''}` : 'g-act-why'}">${escapeHtml(why)}</p>` : ''}
      <div class="g-act-btns"><button type="button" class="primary mg-guide-go" data-guide-kind="${st.kind}"${st.fixAct ? ` data-guide-act="${st.fixAct}"` : ''}${st.kind === 'best' && st.act ? ` data-guide-tool="${st.act}"` : ''}>${go}</button>${site ? `<button type="button" class="g-site" data-spot-build="${spot.x},${spot.y}"${st.build ? ` data-build-kind="${st.build}"` : ''} title="${escapeHtml(siteTitle)}">${icon('target')}추천 자리에 짓기</button>`
        : own ? `<button type="button" class="g-site" data-spot-build="${own.at.map((at) => at.join(',')).join(';')}" data-build-kind="${st.build}" title="${own.title}">${icon('target')}추천 자리에 ${own.at.length > 1 ? `${own.at.length}곳 ` : ''}짓기</button>`
        : block && zone ? `<button type="button" class="g-site" data-zone="${block.x0},${block.y0},${block.x1},${block.y1}" data-zone-kind="${zone}" title="${escapeHtml(st.what)} 구역 ${block.side}×${block.side}을 도로에 닿는 빈 땅에 바로 놓기 · §${fmt(blockCost)}">${icon('target')}추천 자리에 ${block.side}×${block.side} 놓기</button>`
        : fill ? `<button type="button" class="g-site" data-landfill="${fill.x0},${fill.y0},${fill.x1},${fill.y1}" title="${fillSpan(fill.months) ? `${fillSpan(fill.months)}의 쓰레기를 묻을 크기로, ` : ''}도로에 닿고 주거·상업에서 떨어진 빈 땅에 바로 놓기 · §${fmt(fill.cost)} · 월 §${fmt(fill.side * fill.side * city.cfg.garbage.landfill.upkeep)}">${icon('target')}추천 자리에 ${fill.side}×${fill.side} 놓기</button>` : ''}</div></div>`;
  }
  const p = journal().pending[id];
  const wait = p ? `<p class="g-wait">${icon('check')}<span>${escapeHtml(p.text)} · ${Math.max(1, FOLLOW_DAYS - (city.state.day - p.day))}일 뒤 결과를 알려 드립니다</span></p>` : '';
  // (The screen's head names the goal: the card starts with what is wrong.)
  return {
    // (With the way down to what to do about it: under a tab's figures and graphs it was often out of sight.)
    head: `<section class="lead ${s.tone} mg-lead" aria-label="지금 문제"><p class="lead-title">${icon('alert')}<span>${title}</span></p>
      <p class="lead-risk">${(st.riskCode && RISK_OF[st.riskCode]) || (!offGrid && !st.said && worst && RISK_OF[worst.code]) || RISK[id]}${action ? ' <button type="button" class="link mg-jump" data-jump-guide>추천 조치 ↓</button>' : ''}</p></section>`,
    act: `<section class="mg-sec mg-guide ${s.tone}" aria-label="추천 조치"><h3>${icon('target')}추천 조치</h3>${action}${wait}</section>`,
  };
}

/**
 * A facility put up in one press on a site (x, y: its middle), as the guide's 추천 자리에 짓기 does — the getting
 * started list's fire station: refused, and the sites found again, if taken or short of money.
 */
export function buildAtSite(kind: StructureKind, x: number, y: number): boolean {
  city.settle();
  const d = STRUCTURES[kind];
  const r = city.canPlaceStructure(kind, x - ((d.w - 1) >> 1), y - ((d.h - 1) >> 1));
  const short = d.cost - city.state.funds;
  if (!r.ok || short > 0) {
    forgetSites();
    flash(short > 0 ? `§${fmt(Math.ceil(short))} 모자랍니다` : r.message === 'site has a building on it'
      ? '그사이 그 자리에 건물이 들어서 추천 자리를 새로 찾았습니다' : ko(r.message ?? ''), 'bad');
    return false;
  }
  if (!pickStructure(kind)) return false;
  // (Phones: the pane goes first, so what the build says is read once, in the hint bar it no longer covers — it was
  // toasted over the pane and then said again below — and the flight to the site comes after any reframing it starts.)
  if (phone()) closePane();
  centerOn(x, y, Math.max(6, 24 / Math.max(d.w, d.h)));
  // (Handed out as the guide's are: placed, it goes down and time runs on.)
  handed = tool.id;
  handedPick = toolPicks;
  handedBy = active;
  placeAt(x, y);
  updatePanels();
  return true;
}

/**
 * A zone or landfill block laid in one press — the guide's 추천 자리에 N×N 놓기 and the getting started list's —
 * refused, and found again, if it was taken or the money is short.
 */
export function layZone(kind: ZoneKind, x0: number, y0: number, x1: number, y1: number): boolean {
  const name = kind === 'landfill' ? '매립지' : `${ZONE_NAME[kind] ?? kind} 구역`;
  city.settle();
  const p = city.previewZone(x0, y0, x1, y1, kind);
  const area = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (!p.ok || p.tiles + p.streets.length < area || p.cost > city.state.funds) {
    forgetSites();
    flash(p.cost > city.state.funds ? `§${fmt(Math.ceil(p.cost - city.state.funds))} 모자랍니다` : `그사이 그 자리가 막혀 ${name} 자리를 새로 찾았습니다`, 'bad');
    return false;
  }
  const res = city.zone(x0, y0, x1, y1, kind);
  if (!res.ok) {
    flash(ko(res.message ?? ''), 'bad');
    return false;
  }
  city.refreshIfDirty();
  placedMonth.set(kind, Math.floor(city.state.day / 30));
  noteAction(`${name} ${x1 - x0 + 1}×${y1 - y0 + 1} · −§${fmt(res.cost)}`);
  // A new city's clock starts with its first zone, laid with a press as with a drag (the quick start left it at
  // 1월, stopped): at once, or when the building tool in hand goes down. (Not when the player stopped it.)
  const starts = kind !== 'landfill' && speed === 0 && city.state.day === 0 && !speedChosen;
  if (starts) {
    if (tool.kind === 'query') setSpeed(1);
    else resumeAfterBuilding(1);
  }
  flash(`${name} ${x1 - x0 + 1}×${y1 - y0 + 1}칸을 놓았습니다 · −§${fmt(res.cost)}${starts ? ` · ${tool.kind === 'query' ? '시간이 흐르기 시작합니다' : '도구를 내려놓으면 시간이 흐릅니다'}` : ''}`, 'info');
  renderer.effect('flash', x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  centerOn(x0 + ((x1 - x0) >> 1), y0 + ((y1 - y0) >> 1), 8);
  redraw();
  if (phone()) closePane();
  updatePanels();
  return true;
}

/** The sites (x,y) of the build button under the pointer or focused: their marks light up on the map. */
let hotSites: string[] = [];

/** The month a landfill or a zone block was laid from the guide, by kind (its site waits for the next month's figures). */
const placedMonth = new Map<string, number>();
/** The guide's own site (one the map's mark isn't), marked on the map as the 과녁 is: where 추천 자리에 짓기 will build. */
let guideSite: { id: GoalId; sites: { at: [number, number]; label: string }[]; build?: StructureKind; path?: [number, number][]; lay?: Lay; rect?: [number, number, number, number] } | null = null;
/** Where the screen's mark is built on (the mark, or the nearest fit for the facility recommended; null: none now), for its line's 여기에 짓기. */
let markSite: { id: GoalId; at: [number, number] | null; kind?: StructureKind; name?: string } | null = null;

/**
 * A goal's recommendation: what it is, why, the act behind 해 보기; `build` the facility it puts up
 * (`anywhere`: its place doesn't matter to what it is for, as a park lifting the cap).
 */
interface GuideStep {
  kind: 'best' | 'fix' | 'budget' | 'line' | 'ord' | 'open';
  what: string; why: string; fixAct: string; act: string; glyph: string; sub: string; fx: string; site: boolean;
  build?: StructureKind; anywhere?: true;
  /** A finance lever the step pulls at once (a loan, a budget change), as its button says. */
  fin?: string;
  /** A path to lay, tile by tile: a power line (see lineToDark) or a road (see roadToFacility). */
  line?: [number, number][];
  lay?: Lay;
  /** The trouble it mends, when not the card's worst (buildings about to be lost): the headline, and its risk line. */
  said?: string;
  riskCode?: string;
  /** Where its block is wanted (beside the homes it is for), when not where its kind already is. */
  near?: [number, number];
  /** Nothing to do but wait for what was done (a landfill laid since the month's tally): what is coming. */
  wait?: string;
  /** A jammed stretch to widen in one press (see bestJamRun): its ends, and to what. */
  widen?: { run: [number, number, number, number]; to: 'road' | 'avenue' };
}


/**
 * The types whose tax is over neutral and eats their demand, as the finance advisor judges it (demand wanted, the cut
 * past 30%, not held at a cap anyway).
 */
export function taxesCutting(): DevType[] {
  const d = city.demand;
  return DEV_TYPES.filter((t) => city.state.taxRates[t] > d.neutralTax && d.raw[t]! > 0 && d.taxEffect[t]! <= -0.3
    && !(Number.isFinite(d.cap[t]) && d.capPopulation[t]! >= 0.95 * d.cap[t]!));
}

/** A goal's own recommendation, read from what its screen would show (one source of truth). */
/** The ordinances the troubled goals' guides put forward now (the policy list marks them 추천 and puts them first). */
export function guideOrdinances(): Set<OrdinanceId> {
  const out = new Set<OrdinanceId>();
  for (const id of GOAL_ORDER) {
    if (!goalStatus(id).tone) continue;
    const st = goalStep(id);
    if (st.kind === 'ord') out.add(st.fixAct as OrdinanceId);
  }
  return out;
}

/**
 * People waiting at the homes' cap, with a park to lift it in hand: its advice, the growth card's lead before any zone
 * (it offered a farm block while 4,579 people waited on a §130 tennis court, the town 1,441 short of its next stage).
 */
function capFirst(id: GoalId): ReturnType<typeof adviceFor>[number] | undefined {
  return id === 'growth' && capLeads() ? adviceFor('growth').find((a) => a.code === 'capRes' && a.level !== 'good') : undefined;
}

/**
 * The cap's fix: the park its 해 보기 hands over, with its price and how far it lifts the cap (the card said 공원·광장
 * and no more), built near the homes.
 */
function capStep(a: ReturnType<typeof adviceFor>[number]): GuideStep | null {
  const park = capBest();
  const tool = adviceTool(a.code);
  if (!park || !tool) return null;
  const act = tool[0].split(':')[0]!;
  const t = TOOLS.find((x) => x.id === act);
  const d = STRUCTURES[park];
  return { kind: 'fix' as const, what: STRUCTURE_NAME[park], why: adviceText(a), fixAct: act, act, glyph: t ? toolGlyph(t) : '',
    sub: `§${fmt(d.cost)} · 월 §${fmt(d.upkeep)}`, fx: `주거 상한 +${fmt(d.relief[0])}명`, site: false, build: park, anywhere: true };
}

function goalStep(id: GoalId): GuideStep {
  // The trouble the card leads with ends with a budget (worn lines, a strike for want of funds): that first, before
  // anything to build (a striking station's card said 예산 부족 and recommended a kiosk).
  const { worst } = guideSaid(id);
  const due = worst && BUDGET_FIX[worst.code] ? budgetStep(id, worst) : null;
  if (due) return due;
  // Taxes eating demand: every such type's tax to neutral, applied at once (one press a type took three presses, the
  // screen turning 양호 between them with 주거 still at −71%).
  if (worst?.code === 'taxHigh' && worst.type && city.state.taxRates[worst.type] > city.demand.neutralTax) {
    const to = city.demand.neutralTax;
    const cut = taxesCutting();
    if (cut.length > 1) {
      return { kind: 'budget', what: `세율 ${cut.length}가지 ${to.toFixed(1)}%로`, why: adviceText(worst), fixAct: 'tax:all', act: '', glyph: icon('wallet'),
        sub: `${cut.map((t) => `${TYPE_NAME[t]} ${city.state.taxRates[t].toFixed(1)}%`).join(' · ')} · 세입은 줄어듭니다`, fx: '', site: false };
    }
    return { kind: 'budget', what: `${TYPE_NAME[worst.type]} 세율 ${to.toFixed(1)}%로`, why: adviceText(worst), fixAct: `tax:${worst.type}`, act: '', glyph: icon('wallet'),
      sub: `세율 · 지금 ${city.state.taxRates[worst.type].toFixed(1)}% · 세입은 줄어듭니다`, fx: '', site: false };
  }
  // Power that is there but doesn't reach (a plant on a grid of its own powering nobody, or buildings off the
  // lines): a line, not one more plant (a lone plant's 전력이 없어… recommended another plant).
  // (Not while the plants run short: a line adds load to a grid in blackouts, and the plant the list picks hid. A
  // plant powering nobody comes through the list, with the line from it.)
  const pw = readStats().power;
  const cut = id === 'power' && pw.supply > 0 && pw.demand <= pw.supply * 0.85 && adviceFor('power').some((a) => a.code === 'powerCutOff');
  const laid = cut ? lineStep(undefined, true) : null;
  if (laid) return laid;
  // Buildings about to be abandoned (bad advice, wherever it stands in the list): what the first one lacks, mended in
  // one press (power, water or road), and the card then leads with them. (Not otherwise: it led with them and offered
  // a park.)
  const risk = adviceFor(id).find((a) => a.code === 'atRisk' && a.level === 'bad');
  const rescue = risk ? rescueStep(risk) : null;
  if (rescue) return { ...rescue, said: firstSentence(adviceText(risk!)), riskCode: 'atRisk' };
  // Every pump on a network stopped: why, mended in one press where it can be (a line from the grid, the water budget).
  const pumps = worst?.code === 'pumpsOff' ? pumpStep(worst) : null;
  if (pumps) return pumps;
  // Buildings dry, beyond the pipes or on a network with no source or running short, while another has water to
  // spare (a pump watering nobody among them): the pipe between, laid at once, not one more pump. (Only for those
  // troubles: on a tight supply or an old pump it drew a pipe that added demand while the pump the list picked hid.)
  const piped = id === 'water' && adviceFor('water').some((a) => a.level !== 'good'
    && (a.code === 'pipesNoSource' || a.code === 'dryBuildings' || a.code === 'idlePump' || (a.code === 'waterShort' && waterApart())));
  const apart = piped ? pipeStep() : null;
  if (apart) return apart;
  // A landfill laid since the month's tally: nothing more to lay until it takes its first month (the list, reading
  // last month's figures, offered a second one beside it).
  if (worst?.code === 'landfillNew') return { kind: 'open', what: '', why: '', fixAct: '', act: '', glyph: '', sub: '', fx: '', site: false, wait: '쓰레기 수치는 매달 말에 다시 셉니다. 그때부터 새 매립지가 쓰레기를 받습니다' };
  // (One no road reaches: the road to it, not one more landfill beside it.)
  if (worst?.code === 'landfillNewNoRoad') {
    const t = TOOLS.find((x) => x.id === 'road');
    return { kind: 'fix', what: '도로', why: '새 매립지 옆까지 도시의 도로를 이으면 다음 달부터 쓰레기를 받습니다', fixAct: 'road', act: 'road', glyph: t ? toolGlyph(t) : '', sub: '', fx: '', site: false };
  }
  // A station cut off from the roads that the card leads with (its crews can't leave): the road to it, laid at once.
  // (Only garbage piling at a plant waits behind what the list puts first: the line to the dark zones.)
  const road = worst?.code === 'facilityNoRoad' && worst.level === 'bad' ? roadStep(worst) : null;
  if (road) return road;
  // Rubble from a disaster over the zones: cleared in one press before anything else (the card offered a park for the cap
  // while 333 tiles lay under rubble, and the clearing was down in 진단).
  if (id === 'growth') {
    const rub = adviceFor('growth').find((a) => a.code === 'rubble');
    const clear = rub && (rub.value ?? 0) >= 16 ? city.clearRubble(true) : null;
    if (clear?.ok && clear.cost <= city.state.funds) {
      return { kind: 'budget', what: '잔해 모두 치우기', why: '잔해를 치운 구역에 건물이 다시 들어섭니다', fixAct: 'rubble:all', act: '', glyph: icon('eraser'),
        sub: `§${fmt(clear.cost)} · ${fmt(clear.tiles)}칸`, fx: '', site: false, said: firstSentence(adviceText(rub!)) };
    }
  }
  const held = capFirst(id);
  const lift = held ? capStep(held) : null;
  if (lift) return { ...lift, said: firstSentence(adviceText(held!)) };
  // Jams, which the commute's row names as why it is long: the stretch whose widening relieves the most, widened in one
  // press. (A bus pair came first and moved some 3% of the trips; a month on, the card offered the same pair again.)
  const wide = id === 'traffic' && jammedTiles() >= 10 ? widenStep() : null;
  if (wide) return wide;
  const tpl = document.createElement('template');
  tpl.innerHTML = (id === 'finance' ? financeActions() : '') + buildActions(GOALS[id]);
  const best = tpl.content.querySelector<HTMLElement>('.act.best');
  // (The list's own reason for a line, a plant off the grid or zones in the dark beside plenty: the line itself,
  // to lay at once, where 해 보기 only handed the tool and left the way to find.)
  const fx = best?.querySelector('.act-fx')?.textContent?.trim();
  // (A plant the list says powers nobody: the line from it, so it is the one joined.)
  const idlePlant = best?.dataset.act === 'powerline' ? facilities(GOALS.power).find((f) => STRUCTURES[f.kind].plant && f.capacity > 0 && f.load < 1) : undefined;
  const fromPlant = idlePlant ? lineFromPlant(idlePlant) : null;
  const line = fromPlant ? layStep('powerline', fromPlant, fx || '발전소의 전기가 구역까지 닿지 않습니다: 송전선으로 이으면 됩니다')
    : best?.dataset.act === 'powerline' ? lineStep(fx) : best?.dataset.act === 'pipe' ? pipeStep(fx) : null;
  if (line) return line;
  if (best) {
    best.querySelector('.act-best')?.remove();
    const name = best.querySelector<HTMLElement>('.act-name');
    const sub = best.querySelector('.act-sub')?.textContent?.trim() ?? '';
    const fx = best.querySelector('.act-fx')?.textContent?.trim() ?? '';
    const step: GuideStep = { kind: 'best' as const, fixAct: '', act: best.dataset.act ?? '', what: name?.textContent?.trim() ?? '',
      why: fx || sub, glyph: name?.querySelector('.i, .swatch, .pick-swatch')?.outerHTML ?? '', sub, fx, site: !!best.dataset.kind,
      build: best.dataset.kind as StructureKind | undefined, fin: best.dataset.mgFin };
    // Homes about to be left for want of work, when work is the list's own pick: said as that, the block beside them.
    const jobs = risk && (step.act === 'C-low' || step.act === 'I-medium') ? jobRisk(risk) : null;
    // (Its own why, not the zone's demand line: the card prints a forecast before a why.)
    return jobs ? { ...step, said: firstSentence(adviceText(risk!)), riskCode: 'atRisk', near: jobs.at, fx: '', why: `일자리를 못 구한 집이 ${jobs.left}: 가까이에 일터 구역을 내면 됩니다` } : step;
  }
  // A budget that ends the trouble (worn lines, a strike) before a tool for something said after it.
  const lead = adviceFor(id).find((x) => x.level !== 'good' && (adviceTool(x.code) || BUDGET_FIX[x.code]));
  const owed = lead && BUDGET_FIX[lead.code] ? budgetStep(id, lead) : null;
  if (owed) return owed;
  const a = adviceFor(id).find((x) => x.level !== 'good' && adviceTool(x.code));
  if (a) {
    const act = adviceTool(a.code)![0].split(':')[0]!;
    const t = TOOLS.find((x) => x.id === act);
    const park = a.code === 'capRes' ? capStep(a) : null;
    if (park) return park;
    const road = a.code === 'facilityNoRoad' ? roadStep(a) : null;
    if (road) return road;
    return { kind: 'fix' as const, what: adviceTool(a.code)![1], why: adviceText(a), fixAct: act, act, glyph: t ? toolGlyph(t) : '', sub: '', fx: '', site: false };
  }
  // Nothing to build: an ordinance that fixes what the goal is about, enactable now (dirty air had only
  // 원인부터 살펴보세요, with 대기 정화법 folded away below). Not any of the goal's list: that has related ones
  // that cost (비핵 지대 shuts the nuclear plants, 도박 합법화 raises crime).
  // (Not one that costs the mayor's rating, and not a second while the first's result is awaited.)
  // (Nor while the card leads with a budget trouble whose budget is already full: it mends on its own.)
  const ord = journal().pending[id] || (worst && BUDGET_FIX[worst.code]) ? undefined : (ORD_FIX[id] ?? []).find((o) => !city.state.ordinances.includes(o) && city.ordinanceAvailable(o)
    && ((ORDINANCES[o] as { mayorRating?: number }).mayorRating ?? 0) >= 0);
  if (ord) {
    const cost = city.ordinanceCost(ord);
    return { kind: 'ord' as const, what: `${ORDINANCE_NAME[ord]} 시행`, why: ORDINANCES[ord].description, fixAct: ord, act: '', glyph: icon('civic'),
      sub: `조례 · 월 ${cost < 0 ? `+§${fmt(-cost)}` : `§${fmt(cost)}`}`, fx: '', site: false }; // (its effects plain, not a gain's green: some cost)
  }
  return { kind: 'open' as const, what: '', why: '', fixAct: '', act: '', glyph: '', sub: '', fx: '', site: false };
}

/** The guide's step laying the shortest power line from the grid to the nearest zone in the dark, or null if there is none. */
function lineStep(why?: string, buildings = false): GuideStep | null {
  const line = lineToDark(buildings);
  return line ? layStep('powerline', line, why || (buildings ? '전기가 끊긴 건물이 있습니다: 전력망에서 송전선을 이으면 됩니다' : '발전소의 전기가 구역까지 닿지 않습니다: 송전선으로 이으면 됩니다')) : null;
}

const LAY_ICON = { powerline: 'cable', road: 'road', pipe: 'droplet' } as const;

/** The guide's step laying the shortest pipe from water to spare to the dry buildings, or null if there is none. */
function pipeStep(why?: string): GuideStep | null {
  const line = pipeToDry();
  return line ? layStep('pipe', line, why || '물이 남는 수도망과 물이 끊긴 건물이 이어지지 않았습니다: 가장 짧은 길로 수도관을 이으면 됩니다') : null;
}

/**
 * Buildings half-way to abandonment (the advice names one): the countdown furthest along on it, if it is its
 * power, water or road, laid in one press (조언의 보기로 찾아 다시 이어 주세요 left the finding and the fixing); its
 * jobs are the growth screen's zones.
 */
function rescueStep(a: ReturnType<typeof adviceFor>[number]): GuideStep | null {
  const b = a.at ? city.query(a.at[0], a.at[1])?.building : undefined;
  if (!b?.type) return null;
  const c = city.cfg;
  // (The countdown that ends soonest, of those half-way: 4 of 6 months without power waited behind 1 of 2 without
  // a road, which loses the building next month. Each only while still lacking now: its count resets monthly.)
  const counts = ([['power', b.noPowerMonths, c.services.noPowerMonths, !b.powered], ['water', b.noWaterMonths, c.services.noWaterMonths, !b.watered],
    ['road', b.noRoadMonths, c.development.noRoadMonths, !hasRoadNow(b)]] as const).filter(([, m, lim, now]) => now && m >= lim * 0.5);
  if (!counts.length) return null;
  const [lack, m0, lim0] = counts.reduce((x, y) => (y[2] - y[1] < x[2] - x[1] ? y : x));
  const left = `${lim0 - m0}개월 뒤 버려집니다`;
  if (lack === 'power') {
    if (!powerToSpare()) return null; // (into a grid in blackouts, another building is only cut in turn)
    const line = lineToStructure(b, 'b');
    return line ? layStep('powerline', line, `전기가 끊긴 건물이 ${left}: 전력망에서 송전선을 이으면 됩니다`) : null;
  }
  if (lack === 'water') {
    const line = pipeToDry();
    return line ? layStep('pipe', line, `물이 끊긴 건물이 ${left}: 물이 남는 수도망에서 수도관을 이으면 됩니다`) : null;
  }
  const road = roadToFacility(b, 'b');
  return road ? layStep('road', road, `도로가 끊긴 건물이 ${left}: 가장 가까운 도로까지 이으면 됩니다`) : null;
}

/** The building at risk the advice names, when its countdown furthest along is for want of work: where, and months left. */
function jobRisk(a: ReturnType<typeof adviceFor>[number]): { at: [number, number]; left: string } | null {
  const b = a.at ? city.query(a.at[0], a.at[1])?.building : undefined;
  if (!b?.type || !b.noJobMonths) return null;
  const c = city.cfg;
  const lim = c.transport.noJobMonths;
  if (b.noJobMonths < lim * 0.5) return null;
  // (Only when work is what ends it soonest: power, water or a road have their own rescue.)
  const sooner = ([[b.noPowerMonths, c.services.noPowerMonths], [b.noWaterMonths, c.services.noWaterMonths], [b.noRoadMonths, c.development.noRoadMonths]] as const)
    .some(([m, l]) => m > 0 && l - m < lim - b.noJobMonths);
  return sooner ? null : { at: [b.x, b.y], left: `${lim - b.noJobMonths}개월 뒤 버려집니다` };
}

/**
 * Pumps stopped (the advice names one): with no power, the line to it from the grid; with the water budget at 0%,
 * that budget; else null (its water fouled, or past its life: the screen's views and its card say which).
 */
function pumpStep(a: ReturnType<typeof adviceFor>[number]): GuideStep | null {
  const f = a.at ? city.query(a.at[0], a.at[1])?.structure : undefined;
  if (!f) return null;
  const name = STRUCTURE_NAME[f.kind];
  if (!f.powered) {
    const line = lineToStructure(f);
    return line ? layStep('powerline', line, `${name}${josa(name, '이', '가')} 전기가 끊겨 멈췄습니다: 전력망에서 송전선을 이으면 다시 물을 퍼 올립니다`) : null;
  }
  const level = city.state.departments.water;
  return level > 0 ? null : { kind: 'budget', what: '수도 예산 100%로', why: `수도 예산이 0%라 ${name}${josa(name, '이', '가')} 멈췄습니다`, fixAct: 'dept:water',
    act: '', glyph: icon('wallet'), sub: `부서 예산 · 지금 ${level}%`, fx: '', site: false };
}

/** The traffic guide's step: the jammed stretch that relieves the most (bestJamRun) widened in one press, or null. */
function widenStep(): GuideStep | null {
  const run = bestJamRun();
  if (!run) return null;
  const to = widenTo(run);
  const p = city.previewNetwork(run[0], run[1], run[2], run[3], to);
  if (!p.ok && p.message !== 'not enough funds') return null;
  const tiles = Math.abs(run[2] - run[0]) + Math.abs(run[3] - run[1]) + 1;
  const was = NETWORK_KINDS[city.state.net[run[1] * city.size + run[0]]!] === 'street' ? '골목' : '도로';
  return { kind: 'line', what: `${was} ${fmt(tiles)}칸을 ${to === 'road' ? '도로' : '대로'}로`, why: '넘치는 차가 가장 많은 구간입니다: 넓히면 그 길의 막힘이 풀리고 통근이 빨라집니다',
    fixAct: '', act: '', glyph: icon('road'), sub: `${p.ok ? '' : '자금 부족 · '}§${fmt(p.cost)}`, fx: '', site: false, widen: { run, to } };
}

/** The guide's step laying the road from a facility cut off (the advice's) to the nearest road, or null if none can go. */
function roadStep(a: ReturnType<typeof adviceFor>[number]): GuideStep | null {
  const f = a.at ? city.query(a.at[0], a.at[1])?.structure : undefined;
  const path = f ? roadToFacility(f) : null;
  if (!f || !path) return null;
  const d = STRUCTURES[f.kind];
  const name = STRUCTURE_NAME[f.kind];
  return layStep('road', path, `${name}${josa(name, '이', '가')} 도로에 닿지 않아 쓰레기를 거둘 수 없습니다${d.police || d.fire || d.health || d.school ? '. 출동도 못 합니다' : ''}: 가장 가까운 도로까지 이으면 됩니다`);
}

/** A path laid in one press, with its price now, or null when the road can't go that way any more. */
function layStep(lay: Lay, line: [number, number][], why: string): GuideStep | null {
  const cost = layCost(lay, line);
  if (cost === null) return null;
  const t = TOOLS.find((x) => x.id === lay);
  return { kind: 'line', what: `${LAY_WORD[lay]} ${fmt(line.length)}칸 잇기`, why, fixAct: lay, act: lay, glyph: t ? toolGlyph(t) : icon(LAY_ICON[lay]),
    sub: `§${fmt(cost)}${cost > city.state.funds ? ' · 자금 부족' : ''}`, fx: '', site: false, line, lay };
}

/**
 * Lays a path the guide or the info card offered, at once; false (and why, said) when it can't be now.
 * (Kept in the log of the screen it is for only: a road laid from the info card while 재정 is open is not 재정's doing.)
 */
export function layPath(lay: Lay, path: [number, number][], owner: GoalId | null): boolean {
  city.settle();
  const cost = layCost(lay, path);
  if (cost === null || cost > city.state.funds) {
    forgetSites();
    flash(cost === null ? `그사이 막혀서 ${LAY_WORD[lay]}${josa(LAY_WORD[lay], '을', '를')} 놓을 곳을 새로 찾았습니다` : `§${fmt(Math.ceil(cost - city.state.funds))} 모자랍니다`, 'bad');
    return false;
  }
  let laid = 0;
  for (const [x0, y0, x1, y1] of straightRuns(path)) {
    const res = lay === 'road' ? city.buildNetwork(x0, y0, x1, y1, 'road') : lay === 'pipe' ? city.buildPipe(x0, y0, x1, y1) : city.buildPowerLine(x0, y0, x1, y1);
    if (res.ok) laid += res.cost;
  }
  // (A road joins another only where a drag runs into it: one beside the last tile, not ahead of it, stayed apart,
  // and the station it was laid for still couldn't send its crews. The last tile once more, alone, joins all four sides.)
  if (lay === 'road' && laid) city.buildNetwork(path.at(-1)![0], path.at(-1)![1], path.at(-1)![0], path.at(-1)![1], 'road');
  if (!laid) return false;
  city.refreshIfDirty();
  if (owner && owner === active) noteAction(`${LAY_WORD[lay]} ${fmt(path.length)}칸 · −§${fmt(laid)}`);
  flash(`${LAY_WORD[lay]} ${fmt(path.length)}칸을 이었습니다 · −§${fmt(laid)}`, 'info');
  for (const [x, y] of path) renderer.effect('flash', x, y);
  // (Laid out of sight — off the screen, or under the city pane or a bar — the map goes to it, at the zoom it had: what
  // was laid is seen.)
  const [mx, my] = path[path.length >> 1]!;
  const b = mapBand();
  const [sx, sy] = [(mx + 0.5 - cam.x) * cam.scale, (my + 0.5 - cam.y) * cam.scale];
  if (sx < b.left || sy < b.top || sx > b.right || sy > b.bottom) centerOn(mx, my, 0, b);
  redraw();
  updatePanels();
  return true;
}

/** Ordinances that fix what a goal's screen is about, to recommend (by what each does: less crime, cleaner air…). */
const ORD_FIX: Partial<Record<GoalId, readonly OrdinanceId[]>> = {
  power: ['landfillGas', 'powerConservation'], water: ['waterConservation'], garbage: ['paperWaste', 'trashPresort', 'tireRecycling'],
  police: ['neighborhoodWatch', 'juniorSports', 'youthCurfew'], fire: ['smokeDetector'], health: ['freeClinic', 'communityCpr'],
  education: ['proReading'], traffic: ['carpool', 'commuterShuttle'], environment: ['cleanAir', 'automobileEmission'],
};

/** Advice whose fix is a budget, not something to build or an ordinance: the department it names, or the striking facility's own. */
const BUDGET_FIX: Record<string, Dept | 'facility'> = {
  linesWorn: 'power', pipesWorn: 'water', potholes: 'roads',
  policeStrike: 'facility', fireStrike: 'facility', hospitalStrike: 'facility', schoolStrike: 'facility',
  // (Over its places for want of funds: the budget too, where full funding brings it back within them.)
  schoolFull: 'facility', hospitalFull: 'facility',
};

/** The budget step for advice that a budget ends, while that budget is under 100% (else nothing: the cause is elsewhere). */
function budgetStep(id: GoalId, a: ReturnType<typeof adviceFor>[number]): GuideStep | null {
  const fix = BUDGET_FIX[a.code]!;
  const base = { kind: 'budget' as const, why: adviceText(a), act: '', glyph: icon('wallet'), fx: '', site: false };
  if (fix !== 'facility') {
    const level = city.state.departments[fix];
    const name = Object.values(GOALS).flatMap((g) => g.depts).find(([k]) => k === fix)?.[1] ?? fix;
    return level < 100 ? { ...base, what: `${name} 예산 100%로`, fixAct: `dept:${fix}`, sub: `부서 예산 · 지금 ${level}%` } : null;
  }
  const f = a.at ? city.query(a.at[0], a.at[1])?.structure : undefined;
  // (A school or hospital over its places strikes for that too: then one more beside it is the fix, not the budget.)
  // (Over by what even full funding wouldn't cover: at 100% the grade must reach the strike's end.)
  return f && budgetMends(f, a.code.endsWith('Strike')) ? { ...base, what: `${STRUCTURE_NAME[f.kind]} 예산 100%로`, fixAct: `fac:${f.id}`, sub: `시설 예산 · 지금 ${f.funding}%` } : null;
}

function nextHtml(tones: Tone[]): Step {
  if (!readStats().population && !city.state.buildings.size && !city.state.net.some((v) => v !== 0)) return NO_STEP; // (the getting-started list leads a new map)
  // Something burning or a riot comes before any plan.
  const inc = incidents().find((x) => x.urgent);
  if (inc) {
    const free = city.freeUnits(inc.goal);
    const g = GOALS[inc.goal];
    return { goal: inc.goal, problem: true, urgent: true, html: `<div class="lead bad urgent">
      <p class="lead-title">${icon(g.icon)}<span>${escapeHtml(inc.title)}</span><em>긴급</em></p>
      <p class="lead-risk">${inc.goal !== 'fire' ? (inc.riot ? '두면 번져 건물이 부서지고 평점이 떨어집니다' : '두면 노리는 건물에 불을 지릅니다') : inc.plant ? '두면 발전소가 폭발해 둘레를 태웁니다' : '두면 번져 건물을 잃습니다'}</p>
      <p class="lead-do">${free ? (inc.riot ? riotHint(free) : inc.goal === 'fire' ? '소방차를 보내 불을 끄세요' : '경찰을 보내 체포하세요') : `보낼 ${unitName(inc.goal)}가 없습니다 · ${inc.goal === 'fire' ? '소방서' : '경찰서'}부터`}</p>
      <div class="next-acts"><button type="button" class="primary next-do" data-next="${inc.goal}" data-next-kind="incident" data-next-at="${inc.at.join(',')}"${free ? ` aria-label="출동 준비, 출동 가능 ${free}대"` : ''}>${free ? `출동 준비<small class="next-count">${free}대 가능</small>` : '화면 열기'}</button>${free
        // (Or one unit at once to where it is worst, without hunting for it on the map: a press a unit, as the map's.)
        ? `<button type="button" class="link next-send" data-send="${inc.goal}" data-send-at="${inc.at.join(',')}" title="${inc.goal === 'fire' ? '가장 급한 불(발전소, 소방서 반경 밖, 끄러 가는 차가 없는 불 순)에 소방차 한 대를' : inc.riot ? '폭동에 경찰차 한 대를' : '가장 먼저 불을 지를 방화범에게 경찰차 한 대를'} 지금 보냅니다">바로 보내기</button>` : ''}</div></div>` };
  }
  // The most serious, not the first in the list: no power or water, money running out, a fire, before
  // traffic or wealth (rubbish on two roadless lots led the card while the jail let criminals go).
  const money = city.state.funds < 0 ? 5 : 0;
  // Before anyone lives here the roads' upkeep is the only spending: homes, not the budget, come first
  // (a new map with its first streets was sent to the finance screen month after month).
  // Nor does a deficit with five years' money in hand lead (a town of 120 with no jobs was sent to the budget
  // for three years instead of zoning the jobs it lacked); it comes back as the money runs down, red within two.
  const b = city.state.lastBudget;
  const net = b ? b.income - b.expenses : 0;
  const runway = net < 0 && city.state.funds > 0 ? city.state.funds / -net : Infinity;
  const empty = (!readStats().population && city.state.funds >= 0) || (tones[GOAL_ORDER.indexOf('finance')] === 'warn' && runway >= 60);
  // A town whose most wanted zones are full has stopped growing for want of them: that leads a warning
  // about water a town of 150 could do without (the card sent it to a water tower, its homes all built).
  const zonesFull = readStats().population < 5000 && adviceFor('growth').some((a) => a.code.startsWith('zone'));
  const weight = (id: GoalId) => (id === 'growth' && zonesFull ? 9 : WEIGHT[id]);
  const score = (k: number) => (empty && GOAL_ORDER[k] === 'finance' ? 0 : (tones[k] === 'bad' ? 10 : tones[k] === 'warn' ? 4 : 0) * weight(GOAL_ORDER[k]!) + (GOAL_ORDER[k] === 'finance' ? money * 10 : 0));
  const stepFor = goalStep;

  // The most serious goal with something to do; one with nothing to offer gives way, even red (dirty air,
  // with nothing to build for it, held the card for a year and more over the zones the town wanted). It
  // still shows when no goal has anything to do, and its own row on the watch list stays red.
  const ranked = GOAL_ORDER.map((_, k) => k).filter((k) => score(k) > 0).sort((a, b) => score(b) - score(a));
  let pickK = -1;
  let step: ReturnType<typeof stepFor> | null = null;
  for (const k of ranked) {
    const st = stepFor(GOAL_ORDER[k]!);
    if (st.kind !== 'open') {
      [pickK, step] = [k, st];
      break;
    }
  }
  if (!step) {
    const grow = stepFor('growth');
    if (grow.kind !== 'open' || !ranked.length) [pickK, step] = [GOAL_ORDER.indexOf('growth'), grow];
    else [pickK, step] = [ranked[0]!, stepFor(GOAL_ORDER[ranked[0]!]!)];
  }
  const id: GoalId = GOAL_ORDER[pickK]!;
  const tone = tones[pickK]!;
  const g = GOALS[id];
  let { what, why } = step;
  const { kind, fixAct } = step;
  if (!tone && kind === 'open') return NO_STEP; // nothing wrong and nothing to suggest
  if (kind === 'open') {
    what = `${g.name} 살펴보기`;
    why = goalStatus(id).note;
  }
  // (The player decides: the card offers a way to try and the other ways, it does not instruct.)
  const verb = kind === 'open' ? '살펴보기' : '해 보기';
  // A problem reads as what is wrong, what it will cost if left, and the one thing to do;
  // with nothing wrong, the way to grow (under 지금 할 일, after the all-clear).
  const head = tone
    ? `<p class="lead-title">${icon(g.icon)}<span><b>${g.name}</b> ${escapeHtml(glue(goalStatus(id).note))}</span>${tone === 'bad' ? '<em>급함</em>' : ''}</p><p class="lead-risk">${RISK[id]}</p>`
    : `<p class="lead-title">${icon('check')}<span>지금은 모두 순조롭습니다</span></p>`;
  // (A step laid in one press from the screen leaves the dock's 추천 dot off: its tool isn't the way.)
  return { goal: id, problem: !!tone, act: tone && kind !== 'line' ? step.act : '', html: `<div class="lead ${tone || 'calm'}">${head}
    <p class="lead-do" title="${escapeHtml(why)}"><span>${tone ? '제안' : '다음 성장'}</span>${escapeHtml(what)}${why ? `<small> — ${escapeHtml(firstSentence(why))}</small>` : ''}</p>
    <div class="next-acts"><button type="button" class="primary next-do" data-next="${id}" data-next-kind="${kind}"${fixAct ? ` data-next-act="${fixAct}"` : ''} title="${g.name} 화면을 열고 ${kind === 'best' || kind === 'fix' ? '이 조치를 도구로 들기' : '추천 조치 보기'}">${verb}</button>${kind !== 'open' ? `<button type="button" class="link next-open" data-goal="${id}">다른 방법</button>` : ''}</div></div>` };
}

// ------------------------------------------------------------------ the goal's screen

/** The goal on screen (null: the overview). */
export let active: GoalId | null = null;
/** Each figure's number when the screen opened (its tile shows how far it has moved since). */
const baseline = new Map<string, number>();
let baselineCity = -1;
/** What was done from this screen, newest first: when, and what. */

/** A step taken while a goal is open (a build, a budget, an ordinance), kept on its screen. */
export function noteAction(text: string, merge?: string, toolId?: string): void {
  if (!active) return;
  // A build counts here only with a tool of this goal (a road laid while the budget is open isn't the budget's doing).
  // (Nor one handed out elsewhere: a school built from the info card while 재정 was open is not 재정's doing.)
  if (toolId && !GOALS[active].tools.includes(toolId) && !(toolId === handed && handedBy === active)) return;
  const done = journal().done;
  // The same slider moved again replaces its line.
  const last = done[0];
  // The same build again (five bus stops) counts on one line.
  if (!merge && last && last.goal === active && (last.base ?? last.text) === text && city.state.day - last.day < 90) {
    last.n = (last.n ?? 1) + 1;
    last.base = text;
    last.text = `${text} ×${last.n}`;
    last.day = city.state.day;
    return;
  }
  if (merge && last && last.goal === active && last.key === merge && city.state.day - last.day < 30) done.shift();
  done.unshift({ goal: active, day: city.state.day, text, key: merge });
  if (done.length > 40) done.length = 40;
  followUp(active, text, merge);
}

// ------------------------------------------------------------------ watching while time runs

/** The figure each goal is judged by, to report what an action came to (label, as `metrics` names it). */
const KEY_FIGURE: Record<GoalId, string> = {
  finance: '지난달 수지', growth: '인구', power: '여유', water: '여유', garbage: '못 치움', police: '범죄 (지난달)', fire: '지난달 화재',
  health: '건강 지수 평균 (0–200)', education: '교육 지수 평균 (0–200)', traffic: '평균 통근', environment: '대기 오염',
};
/**
 * A second figure told with the first, where an action works on it more than on the first: a bus pair moves riders
 * onto transit and leaves the average commute much as it was (its result read only "1시간 07분 → 1시간 08분", in red).
 */
const ALSO_FIGURE: Partial<Record<GoalId, string>> = { traffic: '대중교통 비중' };
/** A change in the key figure too small to call better or worse (a commute's minute either way). */
const STEADY: Partial<Record<GoalId, number>> = { traffic: 1 };
/** Days after an action its result is told (a quarter: demand, crime and schooling take that long to move). */
const FOLLOW_DAYS = 90;
/** Per goal, the latest action awaiting its result: what was done, when, and the key figure then. */

function keyFigure(id: GoalId): Metric | undefined {
  return metrics(id).find((m) => m[0] === KEY_FIGURE[id]);
}

/** Remembers an action to report on; another on the same goal before the result joins it (measured from the first). */
function followUp(id: GoalId, text: string, merge?: string): void {
  const pending = journal().pending;
  const was = pending[id];
  if (was && city.state.day - was.day < FOLLOW_DAYS) {
    // (The same slider or step again is one change, at its last value: thirty-five steps read "외 34건".)
    if (merge && was.key === merge) {
      was.text = text;
      return;
    }
    was.count++;
    was.day = city.state.day;
    return;
  }
  const m = keyFigure(id);
  if (!m || m[3] === undefined) return;
  const also = ALSO_FIGURE[id] ? metrics(id).find((x) => x[0] === ALSO_FIGURE[id]) : undefined;
  pending[id] = { text, key: merge, count: 1, day: city.state.day, label: m[0], value: m[1], n: m[3], better: m[4] ?? 0, ...(also ? { also: { label: also[0], value: also[1] } } : {}) };
}

/** Goals' tones at the last look (to notice one turning to 조치 필요), for this city. */
let tonesSeen: { lineage: number; tones: Map<GoalId, Tone>; codes: Map<GoalId, Set<string>> } = { lineage: -1, tones: new Map(), codes: new Map() };
/** The advisors' 'bad' codes on a goal now (a new one in an already bad goal is news too). */
const badCodes = (id: GoalId) => new Set(adviceFor(id).filter((a) => a.level === 'bad').map((a) => a.code));
/** The day each goal was last told as needing action (the advisors' own toast for it then gives way). */
const toldAt = new Map<GoalId, number>();
export const goalToldAt = (id: GoalId) => toldAt.get(id);
/** When time last stopped for each goal (once a half-year at most: a figure hovering at the line). */
const pausedFor = new Map<string, number>();
const AUTOPAUSE_KEY = 'webcity.autoPause';
export let autoPause = (() => {
  try {
    return localStorage.getItem(AUTOPAUSE_KEY) !== '0';
  } catch {
    return true;
  }
})();
export function setAutoPause(on: boolean): void {
  autoPause = on;
  try {
    localStorage.setItem(AUTOPAUSE_KEY, on ? '1' : '0');
  } catch { /* storage unavailable */ }
}

/**
 * Called with every panel update: a goal newly needing action stops the clock (if
 * the player keeps that on) with a word that opens its screen; an action's result
 * is told a quarter after it, against the figure it was meant to move.
 */
export function watchGoals(): void {
  const day = city.state.day;
  if (tonesSeen.lineage !== cityLineage) {
    // Another city: what is wrong in it now is where it starts, not news.
    tonesSeen = { lineage: cityLineage, tones: new Map(GOAL_ORDER.map((id) => [id, goalStatus(id).tone])), codes: new Map(GOAL_ORDER.map((id) => [id, badCodes(id)])) };
    pausedFor.clear();
    // (Nor what was told in the last: a city at day 700 told of its power kept another at day 200 from hearing of its own.)
    toldAt.clear();
    return;
  }
  // (Several turning at once are each told: the clock stopped for the first doesn't silence the rest.)
  const running = speed > 0;
  for (const id of GOAL_ORDER) {
    const tone = goalStatus(id).tone;
    const was = tonesSeen.tones.get(id);
    tonesSeen.tones.set(id, tone);
    // A goal already in trouble that finds a new trouble (a landfill filling on top of rubbish left lying)
    // is told too: the pause went quiet just as a failing city got worse.
    const codes = badCodes(id);
    const seen = tonesSeen.codes.get(id) ?? new Set<string>();
    tonesSeen.codes.set(id, codes);
    const fresh = [...codes].find((c) => !seen.has(c));
    if (tone !== 'bad' || was === undefined || (was === 'bad' && !fresh)) continue;
    const key = was === 'bad' ? `${id}:${fresh}` : id;
    // (Days since, counted only forward: a city loaded from before it is not "lately".)
    const ago = day - (pausedFor.get(key) ?? -Infinity);
    if (!running || active === id || (ago >= 0 && ago < 180)) continue;
    // (A lone fire inside the stations' reach is theirs to put out: not a pause.)
    const inc = incidents().find((x) => x.goal === id);
    if (inc && !inc.urgent && (!fresh || fresh === 'fires')) continue;
    // A tornado, a monster or meteors under way: anything but its fires and riots waits for it to pass (30 days at most),
    // and is told then (the clock stopped mid-storm for a cap already red before it).
    if (!inc && stormHolds()) {
      tonesSeen.tones.set(id, was);
      tonesSeen.codes.set(id, seen);
      continue;
    }
    pausedFor.set(key, day);
    toldAt.set(id, day);
    // (Turned off: said, and time goes on. So too before anyone lives here: a first power plant
    // without a fire station yet stopped a city of nobody in its first month; a fire or riot still does.)
    const settled = !!inc || readStats().population > 0;
    const stop = autoPause && settled;
    if (stop) chooseSpeed(0);
    // (Nor a toast then: the next-step card and the getting-started list already say it, and a red one
    // came the moment the first zone was laid.)
    if (!settled) continue;
    // (A fire or a riot: the toast says so and opens the screen on it; else the advisor's word for it.)
    const word = adviceFor(id).find((a) => a.level === 'bad' && (!fresh || a.code === fresh)) ?? adviceFor(id).find((a) => a.level === 'bad');
    // (No advisor's word for it: the goal's own reading says what is wrong — "조치가 필요해졌습니다" said nothing.)
    const why = (word ? ADVICE_TEXT[word.code]?.(word.value ?? 0, word.type) : undefined) ?? (goalStatus(id).note || undefined);
    // (Paused, the toast stays until it is read or time goes on: one that left in seconds left only a badge.)
    // (An advisor's alarm about it still showing goes: one notice for one trouble.)
    for (const el of document.querySelectorAll<HTMLElement>(`#toasts .toast.bad[data-goal="${id}"]:not(.sticky)`)) el.remove();
    toast(`${inc ? inc.title : `${GOALS[id].name}: ${why ? firstSentence(why) : '조치가 필요해졌습니다'}`}${stop ? stoppedNote() : ''}`, 'bad', inc?.at ?? word?.at, () => openGoal(id, inc?.at ?? word?.at), stop, undefined, id);
    if (inc && stop) centerOn(inc.at[0], inc.at[1]); // a fire or a riot: the map goes to it
  }
  const j = journal();
  for (const id of Object.keys(j.pending) as GoalId[]) {
    const p = j.pending[id]!;
    if (day - p.day < FOLLOW_DAYS) continue;
    delete j.pending[id];
    const m = keyFigure(id);
    if (!m || m[3] === undefined) continue;
    // (By what is shown: a figure that reads the same hasn't moved; nor one within its steady range.)
    const d0 = m[1] === p.value ? 0 : Math.round(m[3]) - Math.round(p.n);
    const d = Math.abs(d0) <= (STEADY[id] ?? 0) ? 0 : d0;
    const better = p.better ? Math.sign(d) === p.better : null;
    const also = p.also ? metrics(id).find((x) => x[0] === p.also!.label) : undefined;
    const alsoLine = also && p.also && also[1] !== p.also.value ? ` · ${p.also.label} ${p.also.value} → ${also[1]}` : '';
    // (A figure that reads the same, said so: "1시간 11분 → 1시간 11분" read as a slip.)
    const line = `${p.label.replace(/ \([^)]*\)$/, '')} ${m[1] === p.value ? `${p.value} 그대로` : `${p.value} → ${m[1]}`}${alsoLine}`; // (its scale, "(0–200)", is for the tile)
    // Told on the goal's log too, under what was done.
    j.done.unshift({ goal: id, day, text: `└ 3개월 뒤: ${line}`, key: 'result' });
    // (Toned as its toast is: a figure that held — "변화 없음" — came as a red warning in the news, the toast grey.)
    pushNotice({ text: `${GOALS[id].name} · ${p.text}${p.count > 1 ? ` 외 ${p.count - 1}건` : ''} → 3개월 뒤 ${line}`, warn: !!d && better === false, info: !d, goal: id, until: day + 360 });
    toast(`${GOALS[id].name} · ${p.text}${p.count > 1 ? ` 외 ${p.count - 1}건` : ''} 3개월 뒤: ${line}`, !d ? 'info' : better === false ? 'bad' : 'good', undefined, () => openGoal(id), false, undefined, id);
  }
}

/** The tool the goal's panel (or the info card) put in hand (put down again when the goal closes), and whose screen it was. */
let handed = '';
let handedPick = 0;
let handedBy: GoalId | null = null;

/** A facility handed out by a suggestion has been placed: its job is done (true once; the tool is then put down). */
export function handedPlaced(toolId: string): boolean {
  if (!handed || handed !== toolId || toolPicks !== handedPick) return false; // (picked again since, it is the player's own)
  handed = '';
  return true;
}
/** Where the overview was scrolled to, and whether the keyboard opened the goal (both come back on closing). */
let overviewScroll = 0;
let byKeyboard = false;

/** Facilities listed in full, not the first few. */
let allFacilities = false;

const currentView = () => $<HTMLSelectElement>('#overlay-kind').value;

/** The open goal's name and tools (tool ids, a facility tool standing for its kinds), for the tray. */
export function goalTools(): { name: string; keys: string[] } | null {
  return active ? { name: GOALS[active].name, keys: GOALS[active].tools } : null;
}

/** Puts a goal's view on the map, and the info card's reading follows. */
function showGoalView(view: string): void {
  showOverlay(view);
  refreshInfo();
}

/** The view the map rests on: the open goal's tab's, else the city as it is (a tool in hand may put its own over it). */
export function baseView(): string {
  return active ? tabView(active, tabNow(active)) : 'none';
}

// ------------------------------------------------------------------ a goal's tabs

/** The open goal's tab (among those shown), and the view picked under a tab of several (traffic's networks). */
let tabAt = 0;
const subView = new Map<string, string>();

/** A goal's tabs as they stand: one whose view has nothing to show yet (radiation where there is none) left out. */
export function goalTabs(id: GoalId): GoalTab[] {
  return GOALS[id].tabs.filter((t) => !t.optional || !viewEmpty(t.view));
}

/** The open goal's tab now (the first, if the one picked has gone). */
function tabNow(id: GoalId): GoalTab {
  const tabs = goalTabs(id);
  return tabs[Math.min(tabAt, tabs.length - 1)] ?? GOALS[id].tabs[0]!;
}

/** The view a tab puts on: its own, or the one picked under it. */
function tabView(id: GoalId, t: GoalTab): string {
  const picked = subView.get(`${id}:${t.label}`);
  return picked && t.views?.some(([v]) => v === picked) ? picked : t.view;
}

/**
 * Whether an item of the goal's is on this tab: named by it, or named by none of the goal's tabs and this the first
 * (so nothing the goal has is left off its screen).
 */
function onTab<T>(id: GoalId, t: GoalTab, item: T, list: (x: GoalTab) => readonly T[] | undefined, match: (named: T, item: T) => boolean = (a, b) => a === b): boolean {
  const named = (x: GoalTab) => !!list(x)?.some((v) => match(v, item));
  return named(t) || (t === GOALS[id].tabs[0] && !GOALS[id].tabs.some(named));
}
/** The residents' poll among a goal's figures (named so at its end). */
const isPoll = (label: string) => /주민 불만$|불만 없는 주민$/.test(label);
const figOn = (id: GoalId, t: GoalTab, label: string) => onTab(id, t, label, (x) => x.figs, (p, l) => (p === 'poll' ? isPoll(l) : l.startsWith(p)));
const partOn = (id: GoalId, t: GoalTab, part: TabPart) => onTab(id, t, part, (x) => x.parts);
const codeOn = (id: GoalId, t: GoalTab, code: string) => onTab(id, t, code, (x) => x.codes);

/** The code an incident is read by (a fire: 'fires'; a riot or an arsonist: 'riot'). */
const incidentCode = (x: { goal: string }) => (x.goal === 'fire' ? 'fires' : 'riot');

/** A tab's mark: red where an advisor's alarm about its part stands, or a fire or a riot it shows. */
function tabTone(id: GoalId, t: GoalTab): '' | 'bad' {
  if (incidents().some((x) => x.goal === id && codeOn(id, t, incidentCode(x)))) return 'bad';
  return adviceFor(id).some((a) => a.level === 'bad' && codeOn(id, t, a.code)) ? 'bad' : '';
}

/**
 * The tab a goal's screen opens on, by what is the matter now: a fire or a riot, then the trouble its card leads with,
 * then the worst said; else the first. (The map's view comes with it: what the trouble is seen in.)
 */
function openingTab(id: GoalId): number {
  const tabs = goalTabs(id);
  // (A code no tab names is the first tab's, as 진단 has it: by the names alone, a card led by an unnamed code opened
  // on another tab's trouble, its own on the first.)
  const by = (code: string | undefined) => (code ? tabs.findIndex((t) => codeOn(id, t, code)) : -1);
  const inc = incidents().find((x) => x.goal === id);
  const lead = inc ? incidentCode(inc) : (capFirst(id) ?? guideSaid(id).worst)?.code;
  const k = by(lead);
  if (k >= 0) return k;
  const bad = adviceFor(id).find((a) => a.level === 'bad' && by(a.code) >= 0);
  return bad ? by(bad.code) : 0;
}

/** Puts a tab of the open goal on: its view on the map, its figures, graphs and actions on the screen. */
function selectTab(k: number, focus = false): void {
  if (!active) return;
  const tabs = goalTabs(active);
  if (k < 0 || k >= tabs.length) return;
  tabAt = k;
  showGoalView(tabView(active, tabs[k]!));
  showGoalStats(active);
  renderGoal(true);
  refreshCityTabs();
  if (active === 'finance') refreshCityRows(!phone()); // (its row lit: 시장 평점's, or 재정's for the money's tabs)
  // (Back in sight if the screen was scrolled down: its new part starts under the tabs, which stay at the top.)
  $('#pane').scrollTop = 0;
  if (focus) document.getElementById(`mg-tab-${k}`)?.focus({ preventScroll: true });
  redraw();
}

/** [ and ]: the open goal's tab before or after (the map's view goes with it); with none open, how to get one. */
/**
 * The open goal's tab whose screen has a control, the one on first (−1: none has it). 추천 조치 stands on every tab,
 * but what its 해 보기 presses — the build card, the advisor's row with its tool — only on its own tab.
 */
function tabWith(sel: string): number {
  if (!active) return -1;
  if ($('#manage').querySelector(sel)) return tabAt;
  const was = tabAt;
  const tpl = document.createElement('template');
  try {
    for (let k = 0; k < goalTabs(active).length; k++) {
      if (k === was) continue;
      tabAt = k;
      const parts = goalParts(active);
      tpl.innerHTML = parts.acts + parts.more;
      if (tpl.content.querySelector(sel)) return k;
    }
  } finally {
    tabAt = was;
  }
  return -1;
}

/** Presses a control of the open screen's on the tab that has it, put on first (its view with it) if another shows. */
function pressOnTab(sel: string): void {
  const k = tabWith(sel);
  if (k < 0) return;
  if (k !== tabAt) selectTab(k);
  $('#manage').querySelector<HTMLElement>(sel)?.click();
}

export function stepTab(by: number): void {
  // The city's screen: its overview and 재정·정책's tabs, round.
  if (active === 'finance' || (!active && paneShown())) {
    const n = goalTabs('finance').length + 1;
    const to = ((active === 'finance' ? Math.min(tabAt, n - 2) + 1 : 0) + by + n) % n;
    cityTab(to - 1, !!document.activeElement?.closest('#city-tabs'));
    flash(`도시 › ${to ? goalTabs('finance')[to - 1]!.label : '도시'}`, 'info');
    return;
  }
  if (!active) {
    flash('분야를 열면 [ ]로 그 탭을 넘깁니다 · 탭마다 알맞은 지도 보기가 켜집니다', 'info');
    return;
  }
  const n = goalTabs(active).length;
  // (Focus on a tab goes on to the new one: given back to the old, it sat on a tab out of the Tab order.)
  if (n > 1) selectTab((Math.min(tabAt, n - 1) + by + n) % n, !!document.activeElement?.closest('.mg-tabs'));
  flash(`${GOALS[active].name} › ${tabNow(active).label}`, 'info');
}

/**
 * Opens a goal on the tab that shows a view (an advisor's or a legend's 보기, the getting-started list's 개발 막힘, the
 * summary's 시장 평점): the goal's own tab with it, among its kinds if need be.
 */
export function openGoalView(id: GoalId, view: string): void {
  openGoal(id);
  const tabs = goalTabs(id);
  const k = tabs.findIndex((t) => t.view === view || t.views?.some(([v]) => v === view));
  if (k < 0) return;
  if (tabs[k]!.view !== view) subView.set(`${id}:${tabs[k]!.label}`, view);
  if (k !== tabAt || currentView() !== view) selectTab(k);
}

/**
 * A view asked for by a 보기 (a legend's, the getting-started list's): the open goal's tab with it, else the first
 * goal's that has one.
 */
export function openViewTab(view: string): void {
  const holds = (g: GoalId) => GOALS[g].tabs.some((t) => t.view === view || t.views?.some(([v]) => v === view));
  const id = active && holds(active) ? active : GOAL_ORDER.find(holds);
  if (id) openGoalView(id, view);
}

/** G: 개발·수요 on its 개발 막힘 tab, or put away from there. */
export function toggleGrowthTab(): void {
  if (active === 'growth' && tabNow('growth').view === 'growth' && $('#app').classList.contains('pane-open')) closeScreen();
  else openGoalView('growth', 'growth');
}

/** A screen put away whole (a key that opened it, pressed again): the pane goes, and the screen ends with its view. */
function closeScreen(): void {
  dismissPane();
  closeGoal();
}

// ------------------------------------------------------------------ the city's screen

/** The city's tabs as last drawn. */
let cityTabsSeen = '';
/**
 * The city's screen's tabs, over the pane under its region › name: 도시 (its size, the next reward) and 재정·정책's
 * (the money, taxes, ordinances, the mayor's rating) — each putting its map view on, as an area's tabs do.
 */
export function refreshCityTabs(): void {
  const el = $('#city-tabs');
  const on = active === 'finance' ? Math.min(tabAt, goalTabs('finance').length - 1) : -1;
  const tab = (k: number, label: string, tone: string, title: string) => `<button type="button" role="tab" class="mg-tab${k === on ? ' on' : ''}" data-city-tab="${k}" aria-selected="${k === on}" tabindex="${k === on ? 0 : -1}" title="${escapeHtml(title)}">${escapeHtml(label)}${tone ? '<i class="mg-tab-dot" aria-hidden="true"></i>' : ''}</button>`;
  const html = tab(-1, '도시', '', '도시의 크기와 다음 보상 · 지도 보기 없음') + goalTabs('finance').map((t, k) => {
    const tone = tabTone('finance', t);
    return tab(k, t.label, tone, `${t.view === 'none' ? '지도 보기 없음 (도시 그대로)' : `지도: ${viewName(t.view) || t.label}`}${tone ? ' · 문제 있음' : ''}`);
  }).join('');
  if (html === cityTabsSeen) return;
  cityTabsSeen = html;
  const had = el.contains(document.activeElement);
  el.innerHTML = html;
  if (had) el.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
}

/** A tab of the city's screen (−1: its overview), the pane with it. */
function cityTab(k: number, focus = false): void {
  if (k < 0) {
    closeGoal();
    openPane();
  } else {
    if (active !== 'finance') openGoal('finance');
    if (k !== tabAt) selectTab(k);
    openPane(); // (a phone's too: from a row of the city's, not the map)
  }
  refreshCityTabs();
  if (focus) $('#city-tabs').querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
}

/** 재정 or 시장 평점 pressed (a row of the city's card, its scoreboard's): that tab of the city's screen — or, showing,
 *  the pane put away. */
function toggleCityRow(key: string): void {
  const label = key === 'rating' ? '시장 평점' : '재정';
  if (active === 'finance' && paneShown() && tabNow('finance').label === label) {
    dismissPane();
    return;
  }
  cityTab(goalTabs('finance').findIndex((t) => t.label === label));
}

/** Where the keyboard goes into an open screen: its tab showing, else the pane's ×. */
function screenStart(): HTMLElement {
  return $('#pane').querySelector<HTMLElement>(active === 'finance' ? '#city-tabs [aria-selected="true"]' : '#manage .mg-tab.on') ?? $('#pane-close');
}

/** Opens a goal's screen: its view on the map, its panel in the pane. */
export function openGoal(id: GoalId, at?: [number, number], fromMap = false): void {
  const fresh = !active;
  const changed = active !== id;
  // Its notice ("수도: 단수 69곳 · 살펴보기") has done its job once the screen is open: on a phone it stayed over the
  // map where the fix was then laid. (The clock's own buttons, and the screen's 멈춤, still start time again.)
  dropToasts(`${GOALS[id].name}: `);
  dropGoalToasts(id); // (an advisor's alarm too, worded with the advisor's name: 공공시설: …)
  if (changed) {
    if (!active) {
      overviewScroll = $('#pane').scrollTop;
      byKeyboard = !!document.activeElement?.closest('#pane') && document.activeElement!.matches(':focus-visible');
    }
    active = id;
    allFacilities = false;
    baseline.clear();
    baselineCity = cityLineage;
    for (const [label, , , n] of metrics(id)) if (n !== undefined) baseline.set(label, n);
    // On the tab about what is the matter (the first when nothing is), its view on the map.
    tabAt = openingTab(id);
    showGoalView(tabView(id, tabNow(id)));
  }
  $('#pane').classList.add('managing');
  $('#pane').classList.toggle('city-screen', id === 'finance');
  showGoalStats(id);
  // The pane comes with it: wide, beside the map (from an alert about a place too, which the map then shows); on a
  // phone it rises over the map — not from an alert about a place: there the place shows, the goal's chip in the row
  // at the top brings its screen.
  if (!phone()) openPane();
  else if (!fromMap) {
    // The goal's view is on the map: the city moves into the strip above the risen pane (it was under it).
    // (Also when the pane comes back up on a goal still open: it had gone down, and the city with it.)
    if ((fresh || !$('#app').classList.contains('pane-open')) && !at) setTimeout(cityAbovePane, 320);
    openPane();
  }
  renderGoal(true);
  $('#pane').scrollTop = 0;
  // From the keyboard, carry on in the panel (the row that was focused is hidden now).
  if (byKeyboard || $('#manage').contains(document.activeElement)) screenStart().focus({ preventScroll: true });
  refreshStrip(); // (a phone's: the open screen's chip, lit)
  if (at) centerOn(at[0], at[1]);
  else if (changed && !phone()) requestAnimationFrame(clearOfCards); // (once the view's summary has filled the legend: updatePanels below)
  // Its policy and statistics are drawn only while shown.
  if (fresh || changed) updatePanels();
  redraw();
}

/**
 * The screen's first target, on the map but under something floating on it (the top buttons and the view's card under
 * them, the building bar, the minimap, the city pane, a building's card): the map moves it out from under, at the zoom
 * it has. (The 개발 막힘 legend hid the 추천 자리's label just beside it.)
 */
function clearOfCards(): void {
  const spot = renderer.marks.find((m) => m.tone === 'spot');
  if (!spot) return;
  const r = renderer.canvas.getBoundingClientRect();
  const [sx, sy] = [(spot.x + spot.w / 2 - cam.x) * cam.scale + r.left, (spot.y + spot.h / 2 - cam.y) * cam.scale + r.top];
  if (sx < r.left || sx > r.right || sy < r.top || sy > r.bottom) return; // (off the map: its edge arrow points there)
  const cards = ['mapbar', 'rail', 'map-layer', 'dock-col', 'map-zoom', 'minimap', 'pane', 'info-card'].flatMap((k) => {
    const el = document.getElementById(k);
    let c = el && !el.hidden && el.offsetParent && getComputedStyle(el).visibility !== 'hidden' ? el.getBoundingClientRect() : null;
    // (The pane where it comes to rest: it is sliding in with the screen just opened.)
    if (c && k === 'pane') {
      const at = $('#app').getBoundingClientRect();
      c = new DOMRect(at.left + el!.offsetLeft, at.top + el!.offsetTop, el!.offsetWidth, el!.offsetHeight);
    }
    return c && c.width > 0 ? [c] : [];
  });
  // (Its label runs beside it and above: some room around.)
  if (!cards.some((c) => sx > c.left - 80 && sx < c.right + 80 && sy > c.top - 16 && sy < c.bottom + 28)) return;
  // A card across the middle keeps the target below it (the top buttons, the view's card) or above it (the building
  // bar across the foot); one to a side, beside it (the city pane, a building's card).
  const middle = (c: DOMRect) => c.left - r.left < r.width / 2 && c.right - r.left > r.width / 2;
  const low = (c: DOMRect) => c.top - r.top > r.height / 2;
  const top = Math.max(0, ...cards.filter((c) => middle(c) && !low(c)).map((c) => c.bottom - r.top));
  const bottom = Math.min(r.height, ...cards.filter((c) => middle(c) && low(c)).map((c) => c.top - r.top));
  const left = Math.max(0, ...cards.filter((c) => !middle(c) && c.left - r.left < r.width / 2).map((c) => c.right - r.left));
  const right = Math.min(r.width, ...cards.filter((c) => !middle(c) && c.left - r.left >= r.width / 2).map((c) => c.left - r.left));
  const top0 = Math.min(top, r.height / 2);
  centerOn(spot.x + (spot.w >> 1), spot.y + (spot.h >> 1), cam.scale, { left, top: top0, right: Math.max(left + 1, right), bottom: Math.max(top0 + 1, bottom) });
}

/** 재정·정책: opens it, or on it already brings its policy into sight (an advisor's "재정 열기", the policy links). */
export function openFinance(): void {
  if (active !== 'finance') openGoal('finance');
  else {
    openPane();
    // (Its first part: #policy itself draws no box, and asked to come into sight it never moved.)
    ($('#policy').querySelector<HTMLElement>(':scope > :not([hidden])') ?? $('#policy')).scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

/** B: 재정·정책 (the city's screen, on its tab about the money), or put away from it. */
export function toggleFinance(): void {
  if (active === 'finance' && $('#app').classList.contains('pane-open')) closeScreen();
  else openFinance();
}

/** Under a goal's screen, its statistics: graphs of its figures and the reports that go with it (filled by the panels while shown). */
function showGoalStats(id: GoalId | null): void {
  const t = id ? tabNow(id) : null;
  // 재정's levers, each on its own tab (taxes; departments and loans; ordinances).
  const policy = $('#policy');
  policy.hidden = id !== 'finance';
  const [taxes, depts, ords] = policy.querySelectorAll<HTMLElement>(':scope > .mg-sec');
  if (id === 'finance' && t) for (const [sec, part] of [[taxes, 'taxes'], [depts, 'depts'], [ords, 'ords']] as const) if (sec) sec.hidden = !partOn(id, t, part);
  const el = $('#goal-stats');
  let any = false;
  el.querySelectorAll<HTMLElement>('.gs[data-goals]').forEach((s) => {
    // (A report the tab names, or the goal's own that no tab names, on its first.)
    const rid = s.querySelector('[id]')?.id ?? '';
    const own = !!id && s.dataset.goals!.split(' ').includes(id);
    s.hidden = !id || !t || !(t.reports?.includes(rid) || (own && onTab(id, t, rid, (x) => x.reports)));
    any ||= !s.hidden;
  });
  graphs.setGoal(id, id && t ? tabGraphs(id, t) : null);
  el.hidden = !any && $('#graphs').hidden;
}

/** The graphs on a tab: those it names (a family by its stem: 'trips' for each kind of trip), and the goal's own that no tab names, on its first. */
function tabGraphs(id: GoalId, t: GoalTab): string[] {
  const named = (x: GoalTab, key: string) => !!x.graphs?.some((g) => key === g || key.startsWith(`${g}-`));
  return GRAPH_KEYS.filter(({ key, goal }) => named(t, key) || (goal === id && t === GOALS[id].tabs[0] && !GOALS[id].tabs.some((x) => named(x, key)))).map((g) => g.key);
}

/** Opens a goal's screen and brings one of its reports into sight (the summary's 시장 평점 and 다음 보상), on a view of its own. */
function openGoalAt(id: GoalId, part: string, view?: string): void {
  if (view) openGoalView(id, view);
  else {
    openGoal(id);
    // (On the tab that holds it.)
    const rid = part.replace(/^#/, '');
    const k = goalTabs(id).findIndex((t) => t.reports?.includes(rid) || onTab(id, t, rid, (x) => x.reports));
    if (k >= 0 && k !== tabAt) selectTab(k);
  }
  requestAnimationFrame(() => $(part).closest<HTMLElement>('.gs')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
}

/** Phones: the built-up city glided into the map left above the pane. */
function cityAbovePane(): void {
  // (Not once the pane has gone down again: a view's 보기 opens its goal and then shows the map, and the city moved for
  // a pane that was no longer there.)
  if (!active || !$('#app').classList.contains('pane-open')) return;
  const v = renderer.canvas.getBoundingClientRect();
  const pane = $('#pane').getBoundingClientRect();
  // Beside the pane (landscape: it stands at the left) or between the top rows (or the view's card under them, when
  // shown) and the pane.
  const card = $('#map-layer').getBoundingClientRect();
  const side = pane.top < v.top + v.height * 0.2 && pane.right < v.right - 200;
  // (Between the bars: sideways the top row and the foot bar take the band's top and foot, which the box ignored.)
  const band = mapBand(false);
  const box = side
    ? { left: Math.max(v.left, pane.right + 6), right: v.right - 60, top: Math.max(v.top + band.top + 6, card.height && card.right > pane.right + 6 ? card.bottom + 6 : 0), bottom: v.top + band.bottom - 6 } // (under the view's card beside the pane: it hid the sites' labels)
    : { left: v.left, right: v.right, top: Math.max(v.top + band.top + 6, card.height ? card.bottom + 6 : 0), bottom: Math.min(v.top + band.bottom, pane.top - 6) };
  // (Sideways, an unfolded legend left too little under it: framed beside it as if it weren't there, not left where
  // the last screen had it.)
  if (side && box.bottom - box.top < 100) box.top = v.top + band.top + 6;
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  if (w < 100 || h < 100) return;
  const { cx, cy, span } = builtArea();
  // (Down to 1 pixel a tile if need be: at 2 a phone's strip showed only the city's top edge.)
  const scale = Math.max(1, Math.min(w, h) / span);
  // The box's middle is off the view's: the camera's centre goes that much the other way.
  glideTo(cx + (v.left + v.width / 2 - (box.left + box.right) / 2) / scale, cy + (v.top + v.height / 2 - (box.top + box.bottom) / 2) / scale, scale, 300);
  shrunk = { flight: flightCount(), scale };
}
/** The view {@link cityAbovePane} set, while nothing else has moved the camera since. */
let shrunk: { flight: number; scale: number } | null = null;

/** Phones: the pane went down. A city still shrunk into the strip above it fills the map again (it was left a stamp to build on). */
export function paneClosed(): void {
  const was = shrunk;
  shrunk = null;
  // (Framed beside the pane when it opened, and not moved since: the town framed again on the whole screen.)
  const framed = takeBandFraming();
  const still = !!framed && framed.x === cam.x && framed.y === cam.y && framed.scale === cam.scale;
  if (!still && (!was || was.flight !== flightCount() || Math.abs(cam.scale - was.scale) > 1e-6)) return;
  // (In the band the bars leave, as fitCamera frames it: on the whole canvas the town ran under both.)
  const v = renderer.canvas.getBoundingClientRect();
  const b = mapBand();
  const { cx, cy, span } = builtArea();
  const scale = fitScale(b.right - b.left, b.bottom - b.top, span);
  glideTo(cx + (v.width / 2 - (b.left + b.right) / 2) / scale, cy + (v.height / 2 - (b.top + b.bottom) / 2) / scale, scale, 300);
}

/** Back to the overview: the view the goal put on goes, and a tool it handed out is put down. */
export function closeGoal(): boolean {
  if (!active) return false;
  const was = active;
  const inPanel = $('#manage').contains(document.activeElement);
  active = null;
  $('#pane').classList.remove('managing', 'city-screen');
  for (const sel of ['#mg-body', '#mg-acts', '#mg-more']) $(sel).innerHTML = '';
  showGoalStats(null);
  drawn.top = drawn.acts = drawn.more = '';
  renderer.marks = [];
  renderer.guidePath = null;
  marksSig = '';
  hotSites = []; // (the button that lit them went with the screen)
  if (handed && tool.id === handed) selectTool('query');
  handed = '';
  // The screen's view goes with it: the city as it is, or the view of a tool still in hand. (Putting back the view from
  // before it opened brought back a tool's — a station held then — with nothing left to take it off.)
  restView();
  updatePanels();
  // Back where the overview was, focus on the goal's row if the keyboard was in the panel.
  $('#pane').scrollTop = overviewScroll;
  if (inPanel) $('#status').querySelector<HTMLElement>(`[data-goal="${was}"]`)?.focus({ preventScroll: true });
  redraw();
  return true;
}

/**
 * For the tool tray: the facility each goal needing a look would build (its screen's 추천),
 * by tool. Worked out again when the city or a goal's state changes.
 */
let suggestMemo: { key: string; map: Map<string, StructureKind> } | null = null;
export function suggestedKinds(): Map<string, StructureKind> {
  const tones = GOAL_ORDER.map((id) => goalStatus(id).tone);
  const key = `${changeKey()}|${tones.join()}|${city.state.funds > 0}`;
  if (suggestMemo?.key === key) return suggestMemo.map;
  const map = new Map<string, StructureKind>();
  GOAL_ORDER.forEach((id, i) => {
    if (id === 'finance' || (tones[i] !== 'warn' && tones[i] !== 'bad')) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = buildActions(GOALS[id]);
    tpl.content.querySelectorAll<HTMLElement>('.act.best[data-kind]').forEach((b) => {
      if (!map.has(b.dataset.act!)) map.set(b.dataset.act!, b.dataset.kind as StructureKind);
    });
  });
  // (Homes held at their cap: the park the growth screen's guide builds for it, as the cards' 추천 — its list's
  // best is a zone, and the cards marked no park while their heading said people waited.)
  // (Before a park another screen would pick: homes stopped at the cap is the more urgent.)
  const cap = adviceFor('growth').some((a) => a.code === 'capRes' && a.level === 'bad') ? capBest() : undefined;
  if (cap) map.set('park', cap);
  suggestMemo = { key, map };
  return map;
}

/** The facility a goal's build list marks 추천 (the one its guide recommends building), for the getting-started list. */
export function bestBuild(id: GoalId): StructureKind | null {
  const tpl = document.createElement('template');
  tpl.innerHTML = buildActions(GOALS[id]);
  return (tpl.content.querySelector<HTMLElement>('.act.best[data-kind]')?.dataset.kind as StructureKind | undefined) ?? null;
}

/** A passenger station's note in the build list: one alone carries no one, and each kind joins its pair its own way. */
const PAIR_NOTE: Partial<Record<string, string>> = {
  bus: '둘 이상 놓기: 집 근처 하나, 일터 근처 하나 (도로로 이어져 있어야 탑니다)',
  subway: '둘 이상 놓기: 집 근처 하나, 일터 근처 하나 · 두 역 사이를 지하철 선로로 이어야 탑니다',
  rail: '둘 이상 놓기: 집 쪽 하나, 일터 쪽 하나 · 철도로 이어져 있어야 탑니다 (차로 와서도 탐)',
  monorail: '둘 이상 놓기: 집 쪽 하나, 일터 쪽 하나 · 모노레일 선로로 이어야 탑니다',
  ferry: '둘 이상 놓기: 물가의 집 쪽 하나, 일터 쪽 하나',
};

/** Transit begun: a pair of stops or stations of one kind (as the guide builds them), or one that riders board. */
function transitBegun(): boolean {
  const by = new Map<string, number>();
  for (const st of city.state.structures.values()) {
    const m = STRUCTURES[st.kind].station?.mode;
    if (!m || m === 'freight' || m === 'carFerry') continue;
    if (st.load >= 1) return true;
    by.set(m, (by.get(m) ?? 0) + 1);
  }
  return [...by.values()].some((v) => v >= 2);
}

/** The goal's build actions: each kind of facility it may place, and its other tools. */
/** What to build for a goal (the tools of the tab showing, `tools`; the goal's own by default). */
function buildActions(g: Goal, tools: readonly string[] = g.tools): string {
  const items: string[] = [];
  const dem = city.demand.demand;
  // The kind that gives the most for its price among those the funds cover (output, water, patients or students).
  const worth = (k: StructureKind) => {
    const d = STRUCTURES[k];
    const amount = d.plant?.output ?? d.pump?.output ?? d.health?.capacity ?? (classroom(k) ? d.school!.capacity : 0);
    // Not one whose upkeep would tip the month into the red with little in the bank (following the list once went bankrupt).
    const net = city.state.lastBudget ? city.state.lastBudget.income - city.state.lastBudget.expenses : 0;
    if (city.state.lastBudget && net - d.upkeep < 0 && city.state.funds < 60 * d.upkeep) return 0;
    return amount && d.cost > 0 && d.cost <= city.state.funds ? amount / (d.cost + 24 * d.upkeep) : 0;
  };
  // More of it is wanted only when what there is runs short (a second plant was recommended with 98% spare).
  const st = readStats();
  const [load, cap] = loadOf(g.facility ? facilities(g).filter((f) => !STRUCTURES[f.kind].school || classroom(f.kind)) : []);
  const short_ = g === GOALS.power ? st.power.demand > st.power.supply * 0.85 || !st.power.supply
    : g === GOALS.water ? (st.water.demand > st.water.supply * 0.85 || !st.water.supply) && !waterApart() // (apart: pipes, not more water)
    : g === GOALS.health ? !cap || load > cap * 0.9
    : g === GOALS.education ? !cap || load > cap * 0.9 || (levelShort()?.load ?? 0) > (levelShort()?.cap ?? Infinity) * 0.9 : true;
  // A plant or pump that sends nothing anywhere (just built off the network): connecting it is the fix,
  // not another one (following the list built three large pumps nothing was piped to, and went bankrupt).
  // (Also while nothing uses power yet but zones wait in the dark: a new town's plant, set apart from the
  // homes for its smoke, reached none of them, and the list built a second plant, then a third.)
  const idle = (g === GOALS.power && (st.power.demand > 0 || unpoweredZones().off > 0)) || (g === GOALS.water && st.water.demand > 0)
    ? facilities(g).filter((f) => (STRUCTURES[f.kind].plant || STRUCTURES[f.kind].pump) && f.capacity > 0 && f.load < 1) : [];
  const connect = idle.length ? (g === GOALS.power ? 'powerline' : 'pipe') : null;
  const idleName = idle.length ? `${STRUCTURE_NAME[idle[0]!.kind]}${idle.length > 1 ? ` 외 ${idle.length - 1}곳` : ''}` : '';
  // Zones without power while the plants make plenty: the line is the fix.
  const lineFirst = g === GOALS.power && (!short_ || !!connect) && (unpoweredZones().off >= 10 || !!connect);
  const candidates = tools.flatMap((id) => {
    const t = TOOLS.find((x) => x.id === id);
    return t?.kind === 'structure' ? kindsFor(t).filter((k) => city.isUnlocked(k) && city.placementsLeft(k) > 0) : [];
  });
  // ("Most for its price" is the measure for power, water, beds and school places only: a school on the
  // 부유층 screen was "recommended" for its seats.)
  const ownMeasure = g === GOALS.power || g === GOALS.water || g === GOALS.health || g === GOALS.education;
  let best = short_ && ownMeasure && !connect ? candidates.reduce<StructureKind | null>((a, k) => (worth(k) > (a ? worth(a) : 0) ? k : a), null) : null;
  // Power and water: the cheapest (over two years) that covers the demand with a third to spare, not the
  // biggest per § (a 6,000 MWh coal plant for a town with none was then "twice the demand").
  if (best && (g === GOALS.power || g === GOALS.water)) {
    const [dem, sup] = g === GOALS.power ? [st.power.demand, st.power.supply] : [st.water.demand, st.water.supply];
    // (A town with none yet: enough for its first few thousand, which a 200 MWh turbine is not.)
    // (The shortfall with a margin, not a third again of all demand: a 200,000 m³ pump was picked for a 3,000 m³ gap.)
    // (Power to 30% spare: to 15%, the gap was so small a 200 MWh turbine won, month after month. Water
    // stays at 15%: at 30% the gap outgrew three pumps and a large one, §3,150 a month, was picked.)
    const want = Math.max(!sup && g === GOALS.power ? 2000 : 1, dem * (g === GOALS.power ? 1.3 : 1.15) - sup);
    // Two years' cost, counting smoke against it (the coal plant's air spoils homes for blocks around).
    const cost = (k: StructureKind) => (STRUCTURES[k].cost + 24 * STRUCTURES[k].upkeep) * (1 + (STRUCTURES[k].plant?.air[0] ?? 0) / 400); // (smoke counts, but not so much that oil at nearly twice the price beat coal)
    // As many as it takes (up to three): two small pumps for a gap one doesn't cover cost a fifth of one
    // large pump with 197,000 m³ to spare (a year's funds went on one).
    const out = (k: StructureKind) => STRUCTURES[k].plant?.output ?? STRUCTURES[k].pump?.output ?? 0;
    const copies = (k: StructureKind) => Math.ceil(want / Math.max(1, out(k)));
    const enough = candidates.filter((k) => worth(k) > 0 && out(k) > 0 && copies(k) <= 3);
    if (enough.length) best = enough.reduce((a, k) => (cost(k) * copies(k) < cost(a) * copies(a) ? k : a));
  }
  // Hospitals and schools: the smallest that covers the shortfall with a third to spare (a 3,000-seat school
  // for 61 students was "the most per §"); schools of the level that is short.
  if (best && (g === GOALS.health || g === GOALS.education)) {
    const lv = g === GOALS.education ? levelShort() : null;
    const [l2, c2] = lv ? [lv.load, lv.cap] : [load, cap];
    const want = Math.max(100, (l2 - c2 * 0.9) * 1.3);
    const fits = candidates.filter((k) => worth(k) > 0 && (!lv || STRUCTURES[k].school?.curve === lv.curve));
    const size = (k: StructureKind) => (STRUCTURES[k].health ?? STRUCTURES[k].school)!.capacity;
    const cost = (k: StructureKind) => STRUCTURES[k].cost + 24 * STRUCTURES[k].upkeep;
    const enough = fits.filter((k) => size(k) >= want);
    if (enough.length) best = enough.reduce((a, k) => (cost(k) < cost(a) ? k : a));
    else if (fits.length) best = fits.reduce((a, k) => (size(k) > size(a) ? k : a));
  }
  // Fire and police: the smallest station first.
  if ((g === GOALS.fire && suggestSpot('fire')) || (g === GOALS.police && suggestSpot('police'))) best = cheapestOf(g);
  // Criminals let go for want of cells: a building with cells (a kiosk has none).
  if (g === GOALS.police && adviceFor('police').some((a) => a.code === 'cellsFull')) {
    // (The most cells for two years' cost: a station of 25 cells a time was built month after month.)
    const perCell = (k: StructureKind) => (STRUCTURES[k].cost + 24 * STRUCTURES[k].upkeep) / (STRUCTURES[k].police?.cells ?? 0);
    best = candidates.filter((k) => (STRUCTURES[k].police?.cells ?? 0) > 0 && STRUCTURES[k].cost <= city.state.funds)
      .reduce<StructureKind | null>((a, k) => (!a || perCell(k) < perCell(a) ? k : a), null) ?? best;
  }
  // Long commutes: the cheapest stop that can be paid for (riders off the roads where they take it).
  // (Only until transit has begun: once a pair stood, the card offered the same pair again, beside the first.)
  if (g === GOALS.traffic && (city.state.history.at(-1)?.commute ?? 0) > 1 && !transitBegun()) {
    // (Only a stop on a network there is: a rail station without track carries no one.)
    const s = city.state;
    const ready = (mode: string) => (mode === 'bus' ? s.net.some((v) => v !== Net.None && v !== Net.Rail) : mode === 'subway' ? s.subway.some((v) => v) : mode === 'rail' ? s.net.includes(Net.Rail) : false);
    best = candidates.filter((k) => STRUCTURES[k].station && ready(STRUCTURES[k].station!.mode) && STRUCTURES[k].cost <= city.state.funds)
      .reduce<StructureKind | null>((a, k) => (!a || STRUCTURES[k].cost < STRUCTURES[a].cost ? k : a), null);
  }
  // Zones say how much their class is wanted (the best place to start is where it's highest).
  const wantOf = (t: (typeof TOOLS)[number] | undefined): number | null => {
    const cls = t?.kind === 'zone' && t.zone !== 'landfill' && t.zone !== 'none' ? (t.zone === 'A' ? 'IA' : t.zone[0]) : null;
    return cls ? Math.max(...DEV_TYPES.filter((x) => (cls === 'IA' ? x === 'IA' : cls === 'I' ? x[0] === 'I' && x !== 'IA' : x[0] === cls)).map((x) => dem[x])) : null;
  };
  let order = lineFirst && tools.includes('powerline') ? ['powerline', ...tools.filter((x) => x !== 'powerline')] : connect === 'pipe' && tools.includes('pipe') ? ['pipe', ...tools.filter((x) => x !== 'pipe')] : [...tools];
  // The zones most wanted first (a list of "수요 없음" buried the one that was).
  // With no road yet the road comes before them all: nothing develops off one.
  const roadFirst = g === GOALS.growth && !city.state.net.some((v) => v !== 0);
  if (g === GOALS.growth) {
    // (Farms trail the town's own zones unless they alone are wanted: a new player was led to farming.)
    const w = (id: string) => (roadFirst && id === 'road' ? Infinity : (wantOf(TOOLS.find((x) => x.id === id)) ?? -Infinity) * (id === 'A' ? 0.25 : 1));
    order = [...order].sort((a, b) => (w(b) >= 1 ? w(b) : 0) - (w(a) >= 1 ? w(a) : 0));
  }
  // The zone to lay next: many out of work → workplaces (the lowest density of C or I, whichever is wanted more);
  // else the lowest density of the class wanted most. A landfill when there is nowhere for rubbish to go.
  let zoneNext: string | null = null;
  let zoneWhy = '';
  if (g === GOALS.growth && !roadFirst) {
    const want = (id: string) => wantOf(TOOLS.find((x) => x.id === id)) ?? 0;
    // (Its own diagnosis said jobs: then jobs, not the homes the demand figures favour.)
    const jobless = st.population > 200 && (sum(st.unemployed) > st.population * 0.15 || adviceFor('growth').some((a) => a.code === 'unemployment' && a.level !== 'good'));
    const pool = jobless ? ['C-low', 'I-medium'] : ['R-low', 'C-low', 'I-medium'];
    const top = pool.reduce((a, b) => (want(b) > want(a) ? b : a));
    if (want(top) >= 100) {
      zoneNext = top;
      // (A share of those who work, as the advisor counts it: of all residents it said 5% under its 10%.)
      const labour = sum(city.census.workers);
      const rate = labour > 0 ? sum(city.census.unemployed) / labour : sum(st.unemployed) / Math.max(1, st.population);
      zoneWhy = jobless ? `실업 ${Math.round(rate * 100)}%: 일터부터 내 주세요` : `수요가 가장 높습니다: 낮은 밀도부터`;
    }
  }
  const g2 = st.garbage;
  // (Not with a landfill laid since the month's tally, which these figures don't know yet: one no road reaches wants
  // the road, which the screen leads with.)
  const landfillFirst = g === GOALS.garbage && g2.produced > 0 && !freshLandfill() && (g2.capacity <= 0 || (g2.landfillSpace >= 0 && g2.landfillSpace < Math.max(0, (g2.kept || g2.produced - g2.recycled) - g2.incinerated) * 6));
  for (const id of order) {
    const t = TOOLS.find((x) => x.id === id);
    if (!t) continue;
    if (t.kind === 'structure') {
      // A long list (parks, rewards) shows the few that serve most for their price; the rest are in the tray.
      const open = kindsFor(t).filter((k) => city.isUnlocked(k) && city.placementsLeft(k) > 0);
      const value = (k: StructureKind) => (worth(k) || (STRUCTURES[k].relief[0] + (STRUCTURES[k].mayor?.[0] ?? 0) * 100) / Math.max(1, STRUCTURES[k].cost + 24 * STRUCTURES[k].upkeep));
      // (Not schools and hospitals: each kind there answers a different need, none stands for the others.)
      const few = open.length > 4 && t.id !== 'education' && t.id !== 'health' ? [...open].sort((a, b) => value(b) - value(a)).slice(0, 3) : open;
      for (const k of few) {
        if (!city.isUnlocked(k) || city.placementsLeft(k) <= 0) continue;
        const d = STRUCTURES[k];
        const shortOf = d.cost > city.state.funds;
        // A first stop carries no one: riders need one near home and one near work, on the same network (each kind its
        // own: a subway station had no word of the track between).
        const fx = forecast(k) || (d.station ? PAIR_NOTE[d.station.mode] ?? '' : '');
        items.push(`<button type="button" class="act${shortOf ? ' short' : ''}${k === best ? ' best' : ''}" data-act="${t.id}" data-kind="${k}" title="${STRUCTURE_NAME[k]} · ${d.w}×${d.h}칸 · 건설 §${fmt(d.cost)} · 유지 월 §${fmt(d.upkeep)}${k === best ? (d.station ? ' · 통근이 길 때 가장 싸게 시작하는 대중교통' : d.plant || d.pump ? ' · 수요를 넉넉히 감당하는 것 중 가장 쌈 (2년 비용)' : d.police || d.fire ? ' · 닿지 않는 곳에 가장 작은 서부터' : ' · 2년 비용 대비 가장 많이 감당') : ''}">
          <span class="act-name">${toolGlyph(t)}${STRUCTURE_NAME[k]}${k === best ? '<em class="act-best">추천</em>' : ''}</span><span class="act-sub">${shortOf ? '자금 부족 · ' : ''}§${fmt(d.cost)} · 월 §${fmt(d.upkeep)} · ${structureStat(k)}</span>${fx ? `<span class="act-fx${/−|모자람/.test(fx) ? ' neg' : ''}">${fx}</span>` : ''}</button>`);
      }
      if (open.length > few.length) {
        items.push(`<button type="button" class="act act-more" data-act="${t.id}" data-tray="1" title="${toolName(t)}의 다른 종류를 도구 카드에서 고르기">
          <span class="act-name">${toolGlyph(t)}${toolName(t)} ${open.length - few.length}종 더</span><span class="act-sub">도구 카드에서 고르기</span></button>`);
      }
    } else {
      const want = wantOf(t);
      const line = (lineFirst && t.id === 'powerline') || (connect === 'pipe' && t.id === 'pipe') || (roadFirst && t.id === 'road') || zoneNext === t.id || (landfillFirst && t.id === 'landfill');
      // (A landfill's price and the size a year of the town's rubbish takes: a bare chip of its name sat beside the
      // incinerator's and recycling centre's priced cards.)
      const lf = city.cfg.garbage.landfill;
      const fill = t.id === 'landfill' ? landfillSite() : null;
      const fillSub = t.id === 'landfill' ? `§${fmt(lf.zoneCost)}/칸 · 월 §${fmt(lf.upkeep)}/칸${fill ? ` · ${fillSpan(fill.months) ? `${fillSpan(fill.months)} ` : ''}${fill.side}×${fill.side}` : ''}` : '';
      // Nothing to say beside its name (roads, rail, trees): a compact chip, three to a row.
      // (A zone nobody wants just now says so in its title.)
      const chip = (want === null || want < 1) && !line && t.kind !== 'dispatch' && !fillSub;
      items.push(`<button type="button" class="act${chip ? ' act-chip' : ''}${want !== null && want >= 100 ? ' wanted' : ''}${line ? ' best' : ''}" data-act="${t.id}" title="${toolName(t)}${want !== null && want < 1 ? ' · 지금 수요 없음' : ''}">
        <span class="act-name">${toolGlyph(t)}${toolName(t)}${line ? `<em class="act-best">추천</em>` : ''}</span>${line ? `<span class="act-fx">${t.id === 'road' ? '먼저 도로부터: 구역은 도로에 닿아야 개발됩니다 · 지도 가장자리까지 이으면 이웃 도시와 오갑니다'
          : t.id === 'landfill' ? '쓰레기를 묻을 곳: 도로 옆, 주거에서 먼 곳에'
          : zoneNext === t.id ? zoneWhy
          : connect ? `${idleName}${josa(idleName, '이', '가')} 아직 ${connect === 'pipe' ? '수도망' : '전력망'}에 이어지지 않아 아무 데도 보내지 못합니다: 먼저 이으세요`
          : `전기 없는 구역 ${fmt(unpoweredZones().off)}칸에 이어 주기 · 칸당 §2`}</span>` : ''}<span class="act-sub">${fillSub || (want !== null ? (want >= 1 ? `수요 +${fmt(want)}` : '수요 없음') : t.kind === 'dispatch' ? `출동 가능 ${city.freeUnits(t.unit)}대` : '')}</span></button>`);
    }
  }
  // The recommended choice in sight, the other choices folded (four or five cards read as a catalogue).
  const isBest = (h: string) => /class="act[^"]*\bbest\b/.test(h);
  const lead = items.some(isBest) ? items.filter(isBest) : items.slice(0, 2);
  const rest = items.filter((h) => !lead.includes(h));
  const open = document.querySelector<HTMLDetailsElement>('#manage .acts-more')?.open ? ' open' : '';
  const more = rest.length >= 2 ? `<details class="acts-more"${open}><summary>다른 선택 ${rest.length}개</summary><div class="acts">${rest.join('')}</div></details>` : `<div class="acts">${rest.join('')}</div>`;
  return items.length ? `<section class="mg-sec"><h3>${icon('plus')}짓기</h3><div class="acts">${lead.join('')}</div>${rest.length ? more : ''}</section>` : '';
}

/**
 * Power, water and garbage can also be bought from (or sold to) a developed neighbour: the
 * deals running, the ones open now (one press to sign the full amount), or why there are none.
 */
let dealMemo: { key: string; offers: ReturnType<typeof city.dealOffers> } | null = null;
function dealActions(id: GoalId): string {
  const resource = id === 'power' ? 'power' : id === 'water' ? 'water' : id === 'garbage' ? 'garbage' : null;
  if (!resource) return '';
  const s = city.state;
  const running = s.neighbourDeals.filter((d) => d.resource === resource);
  const key = `${changeKey()}|${Math.round(s.funds / 1000)}`;
  if (dealMemo?.key !== key) dealMemo = { key, offers: city.dealOffers() };
  const offers = dealMemo.offers;
  const open = offers.filter((o) => o.resource === resource && o.ok);
  const verb = (o: { direction: 'buy' | 'sell' }) => (resource === 'garbage' ? (o.direction === 'buy' ? '보내기' : '받기') : o.direction === 'buy' ? '사기' : '팔기');
  const rows = running.map((d) => `<p class="mg-deal">${EDGE_NAME[d.edge]} · ${verb(d)} ${fmt(d.amount)} ${RESOURCE_UNIT[d.resource]} · 월 ${d.direction === 'buy' ? '−' : '+'}§${fmt(city.dealMonthly(d))}${d.status !== 'active' ? ' <span class="neg">(조건 미달)</span>' : ''}</p>`);
  const acts = open.slice(0, 3).map((o) => `<button type="button" class="act" data-mg-deal="${offers.indexOf(o)}" title="${EDGE_NAME[o.edge]} 이웃과 ${RESOURCE_NAME[o.resource]} 거래 맺기 (지역 화면에서 양을 고르거나 취소)">
    <span class="act-name">${icon('globe')}${EDGE_NAME[o.edge]} 이웃에서 ${verb(o)}</span><span class="act-sub">${fmt(o.maxAmount)} ${RESOURCE_UNIT[o.resource]} · 월 ${o.direction === 'buy' ? '−' : '+'}§${fmt(o.maxAmount * o.price)}</span></button>`);
  // No developed neighbour at all: one line under the heading (a paragraph saying so on every resource's screen was clutter).
  if (!rows.length && !open.length && !s.neighbours.some((nb) => nb.kind === 'developed')) {
    return `<section class="mg-sec"><h3>${icon('globe')}이웃과 거래<small class="sec-note">개발된 이웃이 있어야 합니다</small></h3>
    <button type="button" class="link" data-mg-tab="region">지역에서 이웃 고르기 ${icon('chevronRight')}</button></section>`;
  }
  const none = !open.length ? `<p class="legend">지금 맺을 수 있는 거래가 없습니다.${whyNoDeals(offers.filter((o) => o.resource === resource))}</p>` : '';
  return `<section class="mg-sec"><h3>${icon('globe')}이웃과 거래</h3>${rows.join('')}${acts.length ? `<div class="acts">${acts.join('')}</div>` : none}
    <button type="button" class="link" data-mg-tab="region">지역에서 이웃·거래 고르기 ${icon('chevronRight')}</button></section>`;
}

/** Budgets that bear on the goal: its departments, and one slider for all its facilities. */
function budgetActions(g: Goal, list: Structure[], depts: Goal['depts'] = g.depts): string {

  const d = city.state.departments;
  // A department with nothing to fund yet (no jail): said so, with the way to build one, not a slider that can't move.
  const empty = (k: string, name: string) => `<div class="funding dept">${name} <em class="dept-none">아직 없음</em>${k === 'corrections' && city.isUnlocked('cityJail')
    ? `<button type="button" class="link" data-act="police" data-kind="cityJail" title="${STRUCTURE_NAME.cityJail} 짓기">짓기</button>` : '<span></span>'}</div>`;
  const rows = depts.map(([k, name]) => deptEmpty(k) ? empty(k, name) : `<label class="funding dept">${name} <input data-mg-dept="${k}" type="range" min="0" max="${k === 'parks' || k === 'landmarks' ? 100 : 120}" step="5" value="${d[k]}" data-mark="100"><span>${d[k]}%</span></label>`);
  // (Water, garbage and transit buildings go by their department's budget above; only the rest have their own.)
  list = list.filter((f) => !deptFunded(f.kind));
  if (list.length) {
    const mean = Math.round(sum(list.map((f) => f.funding)) / list.length);
    const max = Math.max(...list.map((f) => FUNDING_MAX(f.kind)));
    const cost = sum(list.map((f) => { const u = city.structureUpkeep(f.id); return u ? u.running + u.overcapacity : 0; }));
    rows.push(`<label class="funding mg-group" title="아래 시설 ${list.length}곳의 예산을 한 번에, 저마다 같은 폭으로 (스쿨버스·구급차 제외)">시설 예산 <input data-mg-group type="range" min="0" max="${max}" step="5" value="${mean}" data-mark="100"><span>${mean}%</span><span class="note">${list.length}곳 · 월 §${fmt(cost)}</span></label>`);
  }
  return rows.length ? `<section class="mg-sec"><h3>${icon('wallet')}예산</h3>${rows.join('')}</section>` : '';
}

/** The ordinances on a goal's tab: what each does, its cost, and whether it can be enacted. */
function ordinanceActions(list: readonly OrdinanceId[]): string {
  if (!list.length) return '';
  const row = (id: OrdinanceId) => {
    const on = city.state.ordinances.includes(id);
    const avail = on || city.ordinanceAvailable(id);
    const cost = city.ordinanceCost(id);
    return `<label class="ordinance ${avail ? '' : 'muted'}"><input type="checkbox" data-mg-ord="${id}" ${on ? 'checked' : ''} ${avail ? '' : 'disabled'}>
      <span><b>${ORDINANCE_NAME[id]}</b> <span class="muted">월 ${cost < 0 ? `+§${fmt(-cost)}` : `§${fmt(cost)}`}</span><br><small>${ORDINANCES[id].description}${avail ? '' : ' · 아직 조건이 안 됨'}</small></span></label>`;
  };
  // Those in force in sight; the others to enact fold under one line (a column of switches, mostly off).
  const on = list.filter((id) => city.state.ordinances.includes(id));
  const off = list.filter((id) => !on.includes(id));
  const open = document.querySelector<HTMLDetailsElement>('#manage .ord-more')?.open ? ' open' : '';
  return `<section class="mg-sec"><h3>${icon('civic')}조례${on.length ? ` <span class="muted">${on.length}개 시행 중</span>` : ''}</h3>${on.map(row).join('')}
    ${off.length ? `<details class="acts-more ord-more"${open}><summary>${on.length ? '다른 조례' : '시행할 수 있는 조례'} ${off.length}개</summary>${off.map(row).join('')}</details>` : ''}</section>`;
}

/** A loan that lifts the treasury back over zero with a few months' spending to spare (null: none can be had). */
function rescueLoan(): number | null {
  const s = city.state;
  if (s.funds >= 0 || s.impeached) return null;
  const l = city.cfg.economy.loans;
  const owed = s.loans.reduce((a, x) => a + city.loanBalance(x), 0);
  const want = -s.funds + Math.max(5_000, 3 * (s.lastBudget?.expenses ?? 0));
  const amount = [10_000, 25_000, 50_000, 75_000, 100_000, 150_000, 200_000].find((a) => a >= want) ?? l.max;
  return s.loans.length < l.count && owed + amount <= l.totalMax ? amount : null;
}

/**
 * Money running out: the one lever that helps most, ready in one press — plants and pumps that send
 * nothing anywhere (their upkeep for nothing), budgets above 100%, taxes below neutral; else a loan.
 * (Following the recommendations once ran a city into the red with nothing offered to stop it.)
 */
type FinanceFix = { kind: 'loan' | 'idle' | 'spare' | 'over' | 'under' | 'tax'; what: string; why: string; save: number };
function financeFix(): FinanceFix | null {
  const b = city.state.lastBudget;
  // Below zero nothing can be built at all: a loan to get going again comes first (with a monthly surplus
  // the screen offered nothing, only 원인부터 살펴보세요).
  const loan = rescueLoan();
  if (loan) return { kind: 'loan', what: `§${fmt(loan)} 빌려 자금 메우기`, why: `자금이 §${fmt(-Math.round(city.state.funds))} 모자라 아무것도 지을 수 없습니다 · 10년간 월 §${fmt(city.loanPayment(loan))} 상환`, save: 0 };
  if (!b || b.income >= b.expenses) return null;
  const upkeep = (f: Structure) => { const u = city.structureUpkeep(f.id); return u ? u.running + u.overcapacity : 0; };
  const idle = [...city.state.structures.values()].filter((f) => STRUCTURES[f.kind].plant && f.capacity > 0 && f.load < 1 && f.funding > 0); // (plants: a pump's budget is the water department's)
  const idleCost = sum(idle.map(upkeep));
  if (idle.length && idleCost >= 50) return { kind: 'idle', what: `쓰이지 않는 ${STRUCTURE_NAME[idle[0]!.kind]}${idle.length > 1 ? ` 외 ${idle.length - 1}곳` : ''} 예산 0%로`, why: `아무 데도 보내지 못하면서 월 §${fmt(idleCost)}를 씁니다 (이은 뒤 다시 올리세요)`, save: idleCost };
  // Pumps sending a fraction of what they could (a 200,000 m³ pump for 1,300 m³): their output and upkeep follow
  // the water department's budget, so it can come down to the busiest pump's load with a third to spare.
  const water = city.state.departments.water;
  const target = spareWater();
  const pumpCost = sum([...city.state.structures.values()].filter((f) => STRUCTURES[f.kind].pump).map(upkeep));
  const spareCost = pumpCost * (1 - target / Math.max(1, water));
  if (target <= water - 20 && spareCost >= 100) return { kind: 'spare', what: `수도 예산 ${water}% → ${target}%`, why: `가장 바쁜 펌프도 ${Math.round((target / 1.3 / 100) * 100)}%쯤만 씁니다 · 월 약 §${fmt(spareCost)} 절약 (수요가 늘면 다시 올리세요)`, save: spareCost };
  // (Not those a department funds: their own setting no longer counts, nor can be changed.)
  const over = [...city.state.structures.values()].filter((f) => f.funding > 100 && !deptFunded(f.kind));
  const overCost = sum(over.map((f) => upkeep(f) * (1 - 100 / f.funding)));
  if (over.length && overCost >= 50) return { kind: 'over', what: `100% 넘게 준 시설 ${over.length}곳 예산을 100%로`, why: `월 약 §${fmt(overCost)} 절약`, save: overCost };
  // Schools and hospitals far from full at a full budget (9,750 seats for 3,000 students cost §7,850 a month).
  const under = [...city.state.structures.values()].filter((f) => (STRUCTURES[f.kind].health || (STRUCTURES[f.kind].school && classroom(f.kind))) && f.funding > 80 && f.capacity > 0 && f.load < f.capacity * 0.4);
  const underCost = sum(under.map((f) => upkeep(f) * (1 - 80 / f.funding)));
  if (under.length && underCost >= 100) return { kind: 'under', what: `자리가 많이 남는 학교·병원 ${under.length}곳 예산을 80%로`, why: `정원의 40%도 차지 않았습니다 · 월 약 §${fmt(underCost)} 절약 (70% 아래면 파업)`, save: underCost };
  const neutral = city.demand.neutralTax;
  const low = DEV_TYPES.filter((t) => city.state.taxRates[t] < neutral - 0.01);
  const gain = sum(low.map((t) => (b.taxByType[t] ?? 0) * (neutral / Math.max(0.5, city.state.taxRates[t]) - 1)));
  if (low.length && gain >= 50) return { kind: 'tax', what: `낮은 세율을 중립 ${neutral.toFixed(1)}%까지 올리기`, why: `월 약 +§${fmt(gain)} · 수요는 거의 그대로`, save: gain };
  return null;
}

/** The water budget that leaves the busiest pump a third to spare (output follows it up to 100%), in steps of 10%. */
function spareWater(): number {
  const water = city.state.departments.water;
  let busiest = 0;
  for (const f of city.state.structures.values()) {
    if (!STRUCTURES[f.kind].pump || f.capacity <= 0) continue;
    busiest = Math.max(busiest, f.load / (f.capacity / Math.min(1, Math.max(0.01, water / 100))));
  }
  return busiest > 0 ? Math.min(100, Math.max(40, Math.ceil(busiest * 1.3 * 10) * 10)) : water;
}

function financeActions(): string {
  const b = city.state.lastBudget;
  const fix = financeFix();
  if (fix?.kind !== 'loan' && (!b || b.income >= b.expenses)) return '';
  // (Years of money in hand: no loan to take — a young town's roads run ahead of its taxes, as the getting started list
  // says. A deficit of §195 on §157,267 was told to borrow.)
  const years = b && b.income < b.expenses ? Math.floor(city.state.funds / (b.expenses - b.income) / 12) : 0;
  return `<section class="mg-sec"><h3>${icon('plus')}${fix?.kind === 'loan' ? '자금 메우기' : '적자 줄이기'}</h3><div class="acts">${fix
    ? `<button type="button" class="act best" data-mg-fin="${fix.kind}"><span class="act-name">${icon('wallet')}${fix.what}<em class="act-best">추천</em></span><span class="act-fx">${fix.why}</span></button>`
    : years >= 5 ? `<button type="button" class="act best" data-sheet="budget"><span class="act-name">${icon('wallet')}부서 예산 살피기<em class="act-best">추천</em></span><span class="act-fx">자금으로 ${years >= 100 ? '100년' : `${years}년`} 넘게 버팁니다 · 서두를 것 없이 주민이 늘면 세금이 메웁니다</span></button>`
    : `<button type="button" class="act best" data-sheet="budget"><span class="act-name">${icon('wallet')}대출·부서 예산 살피기<em class="act-best">추천</em></span><span class="act-fx">줄일 곳이 마땅치 않으면 대출로 버티며 세입을 늘리세요</span></button>`}</div></section>`;
}

/** An advisor's fix as a button on its line: the tool (and kind) that answers it. */
const APART = '물은 넉넉한데 수도망이 나뉘어 몇몇 망에서 모자랍니다. 펌프를 더 짓기보다 수도관으로 망을 이어 남는 물을 나누세요.';

/** The tool that answers an advisor's word, and its label (homes with no work to reach: the job zone most wanted). */
function adviceTool(code: string): [string, string] | undefined {
  if (code === 'noCommute') {
    const d = city.demand.demand;
    return Math.max(d['Cs$'], d['Cs$$'], d['Co$$'], d['Co$$$']) > Math.max(d.ID, d.IM, d.IHT) ? ['C-low', '상업 구역 (일자리)'] : ['I-medium', '산업 구역 (일자리)'];
  }
  // Short on some networks while the city makes plenty: the networks are apart (a pump a month was built,
  // 13 of them, 260,000 m³ for 22,000 used, and the town went into the red).
  if (code === 'waterShort' && waterApart()) return ['pipe', '수도관 (수도망 잇기)'];
  return ADVICE_TOOL[code];
}


function fixButton(a: { code: string; level: string; at?: readonly [number, number]; type?: DevType }): string {
  // Taxes eating a type's demand: that type's tax down to neutral, in one press (it said 세율을 조금 내려 보세요
  // and left the slider to be found).
  if (a.code === 'taxHigh' && a.type && city.state.taxRates[a.type] > city.demand.neutralTax) {
    const to = city.demand.neutralTax;
    return ` <button type="button" class="advice-view" data-tax-to="${a.type}" title="${TYPE_NAME[a.type]} 세율을 중립 세율로 내리기 (수요를 깎지 않는 세율 · 세입은 줄어듭니다)">${icon('wallet')}${TYPE_NAME[a.type]} 세율 ${to.toFixed(1)}%로</button>`;
  }
  // A trouble a budget ends (worn lines, a strike…): that budget at 100%, as the guide's own step does it.
  const due = a.level !== 'good' && BUDGET_FIX[a.code] ? budgetStep('finance', a as ReturnType<typeof adviceFor>[number]) : null;
  if (due) return ` <button type="button" class="advice-view mg-guide-go" data-guide-kind="budget" data-guide-act="${due.fixAct}" title="${escapeHtml(due.sub)}">${icon('wallet')}${due.what}</button>`;
  // Rubble: one press clears it all; money trouble: the budget sheet (taxes, departments, loans).
  if (a.code === 'rubble') return ` <button type="button" class="advice-view" data-clear-rubble title="도시의 잔해만 모두 치웁니다">${icon('eraser')}잔해 모두 치우기 §${fmt(city.clearRubble(true).cost)}</button>`;
  if (a.level !== 'good' && (a.code === 'deficit' || a.code === 'broke')) return ` <button type="button" class="advice-view" data-sheet="budget" title="세율·부서 예산·대출">재정 열기</button>`
  // A facility off the road: the road to it, laid at once (the road tool left the way to be found).
  const road = a.code === 'facilityNoRoad' && a.level !== 'good' ? roadStep(a as ReturnType<typeof adviceFor>[number]) : null;
  if (road?.line) return ` <button type="button" class="advice-view" data-line-path="${road.line.map((p) => p.join(',')).join(';')}" data-line-kind="road" title="가장 가까운 도로까지 빈 땅으로 바로 잇기 (${escapeHtml(road.sub)})">${icon('road')}${road.what}</button>`;
  const fix = a.level !== 'good' ? adviceTool(a.code) : undefined;
  if (!fix) return '';
  const [id, named] = fix[0].split(':');
  // (The cap's advice names a park: the button hands that one, not the tool's last pick.)
  // (A crowded or striking school or hospital: one of its own level.)
  const crowded = ['schoolStrike', 'hospitalStrike', 'schoolFull', 'hospitalFull'].includes(a.code) && a.at ? relieverFor(a.at) : null;
  const kind = named ?? crowded ?? (a.code === 'capRes' ? capBest() : undefined);
  return ` <button type="button" class="advice-view" data-act="${id}"${kind ? ` data-kind="${kind}"` : ''} title="${fix[1]} 도구 고르기">${icon('plus')}${fix[1]}</button>`;
}

/** A change in a figure's own units (§ for money, minutes for a commute, MWh, 곳, 채…). */
function withUnit(v: number, value: string, label: string): string {
  if (label.includes('통근')) return `${fmt(v)}분`;
  const unit = value.match(/[\d,.]\s*([^\d\s/·,.]+)$/)?.[1] ?? '';
  return `${value.includes('§') ? '§' : ''}${fmt(v)}${unit && unit !== '—' ? (unit.length > 1 && /[a-zA-Z³]/.test(unit) ? ` ${unit}` : unit) : ''}`;
}

/** What was done here lately, with when (the figures above show what came of it). */
function log(id: GoalId): string {
  const mine = journal().done.filter((d) => d.goal === id).slice(0, 3);
  if (!mine.length) return '';
  const when = (day: number) => `${2000 + Math.floor(day / 360)}년 ${Math.floor((day % 360) / 30) + 1}월`;
  return `<section class="mg-sec"><h3>${icon('check')}이 화면에서 한 조치</h3><ul class="mg-log">${mine.map((d) => `<li><span>${when(d.day)}</span>${escapeHtml(d.text)}</li>`).join('')}</ul>
    <p class="legend">위 수치의 ▲▼는 이 화면을 연 뒤의 변화입니다: 한 조치 말고 도시가 저절로 바뀐 몫도 들어 있습니다. 시간이 흘러야 반영되는 것(수요, 범죄, 교육)도 있습니다.</p></section>`;
}

/** The map's marks for the goal: its facilities (toned by their state), its advisors' places, the suggested spot. */
let marksSig = '';
function refreshMarks(id: GoalId, list: Structure[]): void {
  const marks: typeof renderer.marks = list.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, tone: facilityLine(f)[1] as '' | 'warn' | 'bad' }));
  for (const a of adviceFor(id)) if (a.at && a.level === 'bad') marks.push({ x: a.at[0], y: a.at[1], w: 1, h: 1, tone: 'bad' });
  for (const inc of incidents()) if (inc.goal === id) for (const [x, y] of inc.places) marks.push({ x, y, w: 1, h: 1, tone: 'bad' });
  // (While something burns, the fire is the place to look, not the gap in cover.)
  const spot = incidents().some((x) => x.goal === id) ? null : suggestSpot(id);
  // (Its label says what the panel's line says: next to a full hospital or school, the dry buildings, or the gap.)
  // (A fire spot weighed for a plant out of cover says so, as its line does.)
  const label = spot?.crowded ? `넘치는 ${id === 'education' ? '학교' : '병원'} 옆` : id === 'water' && spot && waterApart() ? '물이 끊긴 건물'
    : spot?.plants ? '소방이 닿지 않는 발전소' : SPOT_WORD[id];
  // The guide's own site too, so 추천 자리에 짓기 shows where before it builds (beside a full hospital it takes
  // the place of the mark it was found near).
  // (Not while another kind of facility is in hand: the bus stops' rings stayed over the map as a subway station was
  // being placed, where they marked nothing it could use.)
  const holding = tool.kind === 'structure' ? chosen[tool.id] : undefined;
  // (Nor a line or stretch of the guide's: a bus stop in hand on the traffic screen showed the stretch to widen.)
  // (Subway track in hand: the track two stations wait for, as with no screen open — the guide's stretch to widen
  // stayed, which the track can't do.)
  const track = tool.kind === 'subway' ? trackMarks() : null;
  const own = !track && guideSite?.id === id && !(holding && holding !== guideSite.build) ? guideSite : null;
  // (On the site its 여기에 짓기 builds, where that is off the spot: what lights up is where it goes.)
  const at: [number, number] | null = spot ? (spotFit?.id === id ? spotFit.at : [spot.x, spot.y]) : null;
  // (Nor where a site of the guide's is within 4 tiles of it: the two labels ran into each other.)
  // (Nor a plant's site while the guide lays a line instead: the power is there, it only has to reach.)
  const crowdedOut = !!at && (own?.lay === 'powerline' || own?.lay === 'pipe' || !!own?.sites.some((o) => Math.max(Math.abs(o.at[0] - at[0]), Math.abs(o.at[1] - at[1])) <= 4));
  // (A site for the facility its 여기에 짓기 builds, where the mark stands on it; else the place of the trouble.)
  const site = spotBuild?.id === id && at && spotBuild.at[0] === at[0] && spotBuild.at[1] === at[1] ? spotBuild.kind : undefined;
  if (spot && at && !(spot.crowded && own) && !crowdedOut) marks.push({ x: at[0], y: at[1], w: 1, h: 1, tone: 'spot', label, site });
  for (const o of own?.sites ?? []) marks.push({ x: o.at[0], y: o.at[1], w: 1, h: 1, tone: 'spot', label: o.label, site: own!.build });
  // (A stop or station in hand that the guide isn't building: its own pair, as it gets with no screen open.)
  if (holding && !own) marks.push(...pairMarks(holding));
  if (track) marks.push(...track.marks);
  // (An area to zone: its outline too, dashed, so its size shows before it is laid.)
  if (own?.rect) marks.push({ x: own.rect[0], y: own.rect[1], w: own.rect[2], h: own.rect[3], tone: 'area' });
  // (Lit while the button that builds there is under the pointer or focused.)
  for (const m of marks) if (m.tone === 'spot' && hotSites.includes(`${m.x},${m.y}`)) m.hot = true;
  const path = track?.path ?? own?.path ?? null;
  const sig = JSON.stringify([marks, path]);
  if (sig === marksSig) return;
  marksSig = sig;
  renderer.marks = marks;
  renderer.guidePath = path;
  redraw();
}

/** Where the spot line's 여기에 짓기 builds, when that is off the spot itself (its mark moves there: see refreshMarks). */
let spotFit: { id: GoalId; at: [number, number] } | null = null;
/** What the spot line's 여기에 짓기 builds and where (its mark there is a site for that facility). */
let spotBuild: { id: GoalId; at: [number, number]; kind: StructureKind } | null = null;

/** The suggested spot as a line on the panel, with a way to go there. */
function spotLine(id: GoalId): string {
  spotFit = null;
  spotBuild = null;
  const spot = incidents().some((x) => x.goal === id) ? null : suggestSpot(id);
  // (Not a plant's site while the guide lays a line: the power is there, it only has to reach.)
  if (!spot || (guideSite?.id === id && (guideSite.lay === 'powerline' || guideSite.lay === 'pipe'))) return '';
  // (Power and water: a site to build on, near where it is missing; the others: where the trouble gathers.)
  if (spot.crowded) {
    const what = id === 'education' ? '학교' : '병원';
    return `<p class="mg-spot">${icon('target')}<span><b>넘치는 ${what} 옆</b> 빈 땅: 새 ${what}${josa(what, '이', '가')} 그곳의 ${id === 'education' ? '학생을' : '환자를'} 나눠 받습니다</span>
    <button type="button" class="advice-view" data-spot="${spot.x},${spot.y}" title="지도에서 그곳 보기">보기</button></p>`;
  }
  // (Water short only for want of pipes between networks: where the dry ones are, to pipe to.)
  if (id === 'water' && waterApart()) {
    return `<p class="mg-spot">${icon('target')}<span><b>물이 끊긴 건물</b>이 가장 많이 모인 곳 · ${spot.blds ? `${fmt(spot.blds)}채` : `${fmt(spot.tiles)}칸`}: 물이 남는 수도망에서 수도관을 이어 오세요</span>
    <button type="button" class="advice-view" data-spot="${spot.x},${spot.y}" title="지도에서 그곳 보기">보기</button></p>`;
  }
  // (Traffic: the worst-jammed stretch, widened to an avenue in one press, beside 보기.)
  if (id === 'traffic') {
    const run = bestJamRun();
    const to = run ? widenTo(run) : 'avenue';
    const word = to === 'road' ? '도로' : '대로';
    const p = run ? city.previewNetwork(run[0], run[1], run[2], run[3], to) : null;
    const tiles = run ? Math.abs(run[2] - run[0]) + Math.abs(run[3] - run[1]) + 1 : 0;
    // (Said as what becomes what: "가장 막힌 구간 도로로 · 1칸" didn't say it was a 골목.)
    const was = run && NETWORK_KINDS[city.state.net[run[1] * city.size + run[0]]!] === 'street' ? '골목' : '도로';
    // (Not when the guide above widens it already: the same button twice.)
    const widen = run && p && (p.ok || p.message === 'not enough funds') && !(guideSite?.id === id && guideSite.path)
      ? `<button type="button" class="advice-view spot-build" data-widen="${run.join(',')}" data-widen-kind="${to}" title="가장 많이 막힌 구간: ${was} ${fmt(tiles)}칸을 ${word}로 바로 넓히기 · §${fmt(p.cost)}">${icon('plus')}${was} ${fmt(tiles)}칸 → ${word} · §${fmt(p.cost)}${p.ok ? '' : ' · 자금 부족'}</button>` : '';
    return `<p class="mg-spot">${icon('target')}<span><b>${SPOT_WORD[id]}</b>${josa(SPOT_WORD[id]!, '이', '가')} 가장 많이 모인 곳 · ${fmt(spot.tiles)}칸</span>
    <span class="advice-acts"><button type="button" class="advice-view" data-spot="${spot.x},${spot.y}" title="지도에서 그곳 보기">보기</button>${widen}</span></p>`;
  }
  const site = id === 'power' || id === 'water';
  // (A site for a facility, built there in one press: what the guide settled on and where it found it fits, else
  // the facility the mark was found for — on a sound goal's screen it built the screen's pick, often bigger than
  // the mark was checked for, and failed over and over.)
  const settled = markSite?.id === id ? markSite : null;
  const kind = settled?.kind ?? spotKind(id);
  const fit = settled ? settled.at : kind ? siteNear(kind, spot.x, spot.y, 0) ?? siteNear(kind, spot.x, spot.y, 6) ?? plantSite(kind, spot.x, spot.y) : null;
  // (A plant's site well off the mark, its smoke kept from the homes: not said to be by the dark zones.)
  const far = !!fit && Math.max(Math.abs(fit[0] - spot.x), Math.abs(fit[1] - spot.y)) > 8;
  // (How many dark tiles it lights at once: only for the plant the spot was weighed for, built on the spot itself.)
  const lit = id === 'power' && spot.lit && fit && fit[0] === spot.x && fit[1] === spot.y && kind === spotKind(id) ? spot.lit : 0;
  // (Built off the mark, up to 6 tiles away, the press put it where nothing showed: the mark goes there, unless
  // the guide's own site already stands on it.)
  if ((SERVICE_SITE.has(id) || site) && fit && kind && (fit[0] !== spot.x || fit[1] !== spot.y)
    && !(guideSite?.id === id && guideSite.sites.some((o) => o.at[0] === fit[0] && o.at[1] === fit[1]))) spotFit = { id, at: fit };
  if ((SERVICE_SITE.has(id) || site) && fit && kind) spotBuild = { id, at: fit, kind };
  const build = (SERVICE_SITE.has(id) || site) && fit && kind
    ? `<button type="button" class="advice-view spot-build" data-spot-build="${fit.join(',')}" data-build-kind="${kind}" title="${STRUCTURE_NAME[kind]}${josa(STRUCTURE_NAME[kind], '을', '를')} 이 자리에 짓기">${icon('plus')}여기에 짓기</button>` : '';
  return `<p class="mg-spot">${icon('target')}<span>${site
    ? `<b>${SPOT_WORD[id]}</b>: ${id === 'power' ? '전기 없는 구역' : '물이 없는 건물'} ${id === 'water' && spot.blds ? `${fmt(spot.blds)}채` : `${fmt(lit || spot.tiles)}칸`}${far ? (kind && smokyPlant(kind) ? '에서 연기가 주거에 닿지 않을 만큼 떨어진' : '에서 가장 가까운') : lit ? '에 한 번에 닿는,' : ' 가까이,'} 도로 옆${!far && id === 'power' && kind && smokyPlant(kind) ? ' · 주거에서 떨어진' : ''} 빈 땅`
    // (A plant out of fire cover, which the spot is weighed for, named as one: "건물 1채" was the plant.)
    : spot.plants ? `<b>소방이 닿지 않는 발전소</b> ${fmt(spot.plants)}곳${spot.blds ? ` · 건물 ${fmt(spot.blds)}채가` : '이'} 있는 곳 · 불타면 폭발합니다`
    : `<b>${SPOT_WORD[id]}</b>${josa(SPOT_WORD[id]!, '이', '가')} 가장 많이 모인 곳 · ${spot.blds ? `${fmt(spot.blds)}채` : `${fmt(spot.tiles)}칸`}`}</span>
    <span class="advice-acts"><button type="button" class="advice-view" data-spot="${spot.x},${spot.y}" title="지도에서 그곳 보기">보기</button>${build}</span></p>`;
}

/** Goals whose suggested spot is a site for one of their stations (not where a trouble gathers). */
const SERVICE_SITE = new Set<GoalId>(['police', 'fire', 'health', 'education']);

/**
 * A facility picked from the build cards, no screen open: the map marks the site the guide would build it on — a
 * station where it fills the biggest gap in its service (the view that comes on with it shows every gap; the mark
 * says which to fill, on ground it fits), a plant beside the plants on the grid, a pump touching the pipes with
 * power, an incinerator or recycling centre clear of the homes, bus stops by the homes and by the work, a park, a
 * reward or a deal by the homes or clear of them as they take to it; a zone whose class is wanted, the block to draw
 * over — and its arrow at the screen's edge leads there.
 */
export function markToolSite(): void {
  // (A moment later: a site search can take a big map tens of milliseconds, and the pick shows first.)
  if (!toolSiteDue) toolSiteDue = window.setTimeout(placeToolMark, 16);
}
let toolSiteDue = 0;

/**
 * The held tool's marks (and route) on the map. The first ever shown says, once, what the blue target is — unless
 * another word is up (the touch screen's own first tip comes with the same pick).
 */
function showToolMarks(marks: typeof renderer.marks, path: [number, number][] | null = null): void {
  if (JSON.stringify([marks, path]) === JSON.stringify([renderer.marks, renderer.guidePath])) return;
  renderer.marks = marks;
  renderer.guidePath = path;
  redraw();
  // (Read out once for each facility or tool picked — not everyone sees the target — with the key that goes to it.)
  const held = `${tool.id}|${tool.kind === 'structure' ? chosen[tool.id] : ''}`;
  const label = marks.find((m) => m.tone === 'spot' && m.label)?.label;
  const sr = document.getElementById('sr-status');
  if (!marks.length) saidFor = '';
  else if (label && sr && held !== saidFor && !touchFirst()) {
    saidFor = held;
    sr.textContent = `${flashing() && sr.textContent ? `${sr.textContent} · ` : ''}${label} · S로 커서를 그 자리에`;
  }
  if (!marks.length || flashing() || performance.now() - panTipAt < 6000) return;
  try {
    if (localStorage.getItem(SITE_TIP_KEY)) return;
    localStorage.setItem(SITE_TIP_KEY, '1');
  } catch {
    return; // (storage unavailable: no tip, rather than one each time)
  }
  flash(`파란 과녁이 추천 자리입니다 · 화면 밖이면 가장자리의 화살표가 그쪽을 가리킵니다${touchFirst() ? '' : ' · 키보드: S로 커서를 그 자리에'}`, 'info');
}
const SITE_TIP_KEY = 'web-city:site-tip';
/** The tool (and facility) whose recommended spot was last read out. */
let saidFor = '';

function placeToolMark(): void {
  toolSiteDue = 0;
  // (Not while a day is part-way: its service cover is being redone, and a spot found in a gap that wasn't one was
  // kept until the next edit.)
  if (city.stepping) {
    toolSiteDue = window.setTimeout(placeToolMark, 50);
    return;
  }
  // (A screen marks its own: again now, so its guide's rings go while another kind of facility is in hand.)
  if (active) {
    refreshMarks(active, facilities(GOALS[active]));
    return;
  }
  // A power line or a pipe in hand: the guide's route where one is wanted — from the grid to the nearest dark zone (with
  // power to spare: into a grid in blackouts another building is only cut in turn), from water to spare to the dry
  // buildings — dashed end to end, to draw along.
  if (tool.kind === 'powerline' || tool.kind === 'pipe') {
    const line = tool.kind === 'pipe' ? pipeToDry() : powerToSpare() ? lineToDark() : null;
    const [a, b] = line ? [line[0]!, line.at(-1)!] : [null, null];
    const marks: typeof renderer.marks = a && b && line ? [
      { x: a[0], y: a[1], w: 1, h: 1, tone: 'spot', label: '' },
      { x: b[0], y: b[1], w: 1, h: 1, tone: 'spot', label: `추천 · ${tool.kind === 'pipe' ? '수도관' : '송전선'} ${fmt(line.length)}칸` },
    ] : [];
    showToolMarks(marks, line);
    return;
  }
  // Subway track in hand while two stations stand with no track between them: that track, dashed end to end, to draw
  // along from one to the other.
  if (tool.kind === 'subway') {
    const { marks, path } = trackMarks();
    showToolMarks(marks, path);
    return;
  }
  // A road or avenue in hand while nothing joins the town to its neighbours (no settlers nor trade come without): the
  // straight run to the nearest map edge, dashed end to end, labelled at the town's end (the edge's is often off the
  // screen; its arrow points there). (Not a highway: without ramps it joins none of the town's roads.)
  if (tool.kind === 'network' && (tool.network === 'road' || tool.network === 'avenue')) {
    const way = edgeRoad(tool.network);
    const path = way?.path;
    const [a, b] = path ? [path[0]!, path.at(-1)!] : [];
    const marks: typeof renderer.marks = a && b && path ? [
      { x: a[0], y: a[1], w: 1, h: 1, tone: 'spot', label: `추천 · 이웃 도시까지 ${fmt(path.length)}칸 · §${fmt(way.cost)}${way.short ? ' · 자금 부족' : ''}` },
      { x: b[0], y: b[1], w: 1, h: 1, tone: 'spot', label: '' },
    ] : [];
    showToolMarks(marks, marks.length && path ? path : null);
    return;
  }
  // (The landfill zone: the square the garbage screen would lay, sized to a year of the city's rubbish, clear of the
  // homes and shops.)
  if (tool.kind === 'zone' && tool.zone === 'landfill') {
    const fill = landfillSite();
    const marks: typeof renderer.marks = fill ? [
      { x: fill.x0 + (fill.side >> 1), y: fill.y0 + (fill.side >> 1), w: 1, h: 1, tone: 'spot', label: `추천 자리 · 매립지 ${fill.side}×${fill.side}` },
      { x: fill.x0, y: fill.y0, w: fill.side, h: fill.side, tone: 'area' },
    ] : [];
    showToolMarks(marks);
    return;
  }
  // A zone in hand whose class is wanted: the block the growth screen would lay, outlined — a road along a whole
  // side, clear of what spoils it — to draw over.
  if (tool.kind === 'zone' && tool.zone && tool.zone !== 'none' && tool.zone !== 'landfill') {
    const z = tool.zone;
    const cls = z === 'A' ? 'A' : z[0]!;
    const types = DEV_TYPES.filter((t) => (cls === 'A' ? t === 'IA' : cls === 'I' ? t[0] === 'I' && t !== 'IA' : t[0] === cls));
    const wanted = Math.max(...types.map((t) => city.demand.demand[t])) >= 10;
    // (The density in hand: a medium or high zone skips a volcano's slope, which a low one takes.)
    const block = wanted ? zoneSite(z) : null;
    const marks: typeof renderer.marks = block ? [
      { x: block.x0 + (block.side >> 1), y: block.y0 + (block.side >> 1), w: 1, h: 1, tone: 'spot', label: `추천 자리 · ${toolName(tool)} ${block.side}×${block.side}` },
      { x: block.x0, y: block.y0, w: block.side, h: block.side, tone: 'area' },
    ] : [];
    showToolMarks(marks);
    return;
  }
  const held = tool.kind === 'structure' ? chosen[tool.id] : undefined;
  const kind = held && city.isUnlocked(held) && city.placementsLeft(held) > 0 ? held : null;
  const d = kind ? STRUCTURES[kind] : null;
  const id = kind ? goalOfStructure(kind) : null;
  // Near the goal's own mark (not while something burns: then the fire is the place to look).
  const nearSpot = (goal: GoalId) => {
    const spot = kind && !incidents().some((x) => x.goal === goal) ? suggestSpot(goal) : null;
    if (!kind || !spot) return null;
    // (Beside a full school only one of its level takes its students: a primary school by a full high school relieved nothing.)
    const full = spot.crowded && spot.of ? city.query(spot.of[0], spot.of[1])?.structure?.kind : undefined;
    if (full && STRUCTURES[full].school && STRUCTURES[full].school.curve !== d?.school?.curve) return null;
    return siteNear(kind, spot.x, spot.y, 0) ?? siteNear(kind, spot.x, spot.y, 6);
  };
  // (A plant whose smoke keeps it from the mark: the nearest ground clear of the homes, as the guide's.)
  const plantNear = (k: StructureKind) => {
    const spot = suggestSpot('power');
    return spot ? plantSite(k, spot.x, spot.y) : plantSite(k);
  };
  // (Not a jail, nor a library, university or research lab that reaches the whole city: where it stands changes nothing.)
  const local = !!d && (d.police ? d.police.radius > 0 : d.school ? d.school.radius < 300 : d.health ? d.health.radius < 300 : !!d.fire);
  // (A deal has no goal of its own: only a station's search needs one.)
  const at = !kind || !d ? null
    : id && SERVICE_SITE.has(id) ? (local ? nearSpot(id) : null)
    : d.plant ? siteByPlants(kind) ?? nearSpot('power') ?? plantNear(kind)
    : d.pump ? siteOnPipes(kind) ?? nearSpot('water')
    : d.incinerator || d.recycling ? siteAwayFromHomes(kind)
    // (A park: by the homes, where it pleases the most, as the guide puts the one that lifts the cap.)
    : d.category === 'park' ? siteNearHomes(kind)
    // (A reward, a landmark or a deal by what it does to the homes around it: welcome by them (or pleasing those near it
    // with the mayor), a casino or an army base clear of them; one that does neither, anywhere.)
    : d.category === 'reward' || d.category === 'landmark' || d.category === 'deal'
      ? (d.res[0] < 0 ? siteAwayFromHomes(kind) : d.res[0] > 0 || ((d.mayor?.[0] ?? 0) > 0 && (d.mayor?.[1] ?? 0) < city.size) ? siteNearHomes(kind) : null)
    : null;
  const marks: typeof renderer.marks = at && kind ? [{ x: at[0], y: at[1], w: 1, h: 1, tone: 'spot', label: `추천 자리 · ${STRUCTURE_NAME[kind]}`, site: kind }] : [];
  if (kind) marks.push(...pairMarks(kind));
  showToolMarks(marks);
}

/** The subway track two stations wait for, its ends marked (labelled at the far one), and its path. */
function trackMarks(): { marks: typeof renderer.marks; path: [number, number][] | null } {
  const gap = subwayGap();
  if (!gap) return { marks: [], path: null };
  const [a, b] = [gap.path[0]!, gap.path.at(-1)!];
  return {
    marks: [
      { x: a[0], y: a[1], w: 1, h: 1, tone: 'spot', label: '' },
      { x: b[0], y: b[1], w: 1, h: 1, tone: 'spot', label: `추천 · 지하철 선로 ${fmt(gap.path.length)}칸 · §${fmt(gap.cost)}${gap.short ? ' · 자금 부족' : ''}` },
    ],
    path: gap.path,
  };
}

/**
 * A bus stop in hand: the pair the traffic screen builds, one where the most live and one where the most work (a stop
 * alone carries no one) — a side already with a stop within 8 tiles left out, so the next goes to the other side. A
 * subway station likewise, the track between to be drawn (one in hand found no free tile under the cursor in a built
 * town). None for another kind.
 */
function pairMarks(kind: StructureKind): typeof renderer.marks {
  const mode = STRUCTURES[kind].station?.mode;
  if (mode !== 'bus' && mode !== 'subway') return [];
  const stops = [...city.state.structures.values()].filter((st) => STRUCTURES[st.kind].station?.mode === mode);
  const pair = stopPair(kind, 1);
  // (A side is served by a stop within 8 tiles of it and nearer it than the other side: home and work 8 to 16 tiles
  // apart, the new home stop also stood within 8 of the work side, and both went.)
  const near = (p: readonly [number, number], q: readonly [number, number]) => stops.some((st) => {
    const dp = Math.max(Math.abs(st.x - p[0]), Math.abs(st.y - p[1]));
    return dp <= 8 && dp < Math.max(Math.abs(st.x - q[0]), Math.abs(st.y - q[1]));
  });
  const out: typeof renderer.marks = [];
  pair?.forEach((p, k) => {
    if (near(p, pair[1 - k]!)) return;
    out.push({ x: p[0], y: p[1], w: 1, h: 1, tone: 'spot', label: `추천 자리 · ${STRUCTURE_NAME[kind]} (${k ? '일터 쪽' : '집 쪽'})`, site: kind });
  });
  return out;
}

/**
 * A riot takes three police units or more unless it is on a dead-end street (an engine rule):
 * each press of the map sends one, so say so, and warn when the city has fewer to send.
 */
/**
 * What a riot asks of the police, in a line: fewer cars than it takes do little (but in a dead end). (Four clauses in
 * bold — the cars free, the order, the rule and the presses — ran to four lines; the count is on the button now.)
 */
function riotHint(free: number): string {
  const need = city.cfg.mayor.riotMob.minUnits;
  return free < need ? `경찰차가 ${free}대뿐입니다 · ${need}대가 모여야 진압되니 경찰서를 더 지으세요` : `경찰차 ${need}대가 모여야 진압됩니다 · 지도에서 그곳을 세 번 누르세요`;
}
/** Which of several places a 보기 went to last (the next press goes on to the next). */
let spotTurn = { key: '', k: 0 };
/** The unit sent to an incident, in words. */
const unitName = (goal: 'fire' | 'police') => (goal === 'fire' ? '소방차' : '경찰차');

/** What is happening now on this goal's watch (a fire, a riot): where, and the unit to send, before any plan. */
function incidentBanner(id: GoalId): string {
  const inc = incidents().find((x) => x.goal === id);
  if (!inc) return '';
  const free = city.freeUnits(inc.goal);
  return `<section class="mg-alert">${icon(inc.goal === 'fire' ? 'flame' : 'megaphone')}<span><b>${inc.title}</b>
    <small>${free ? `출동 가능 ${free}대 · ${inc.riot ? riotHint(free) : `출동을 누르고 지도에서 ${inc.goal === 'fire' ? '불난 곳' : '그곳'}을 누르세요`}` : `보낼 ${unitName(inc.goal)}가 없습니다: ${inc.goal === 'fire' ? '소방서' : '경찰서'}부터 지으세요`}</small></span>
    <span class="advice-acts"><button type="button" class="advice-view" data-spot="${inc.at.join(',')}"${inc.places.length > 1 ? ` data-spots="${inc.places.map((p) => p.join(',')).join(';')}"` : ''} title="${inc.places.length > 1 ? `지도에서 그곳들을 차례로 보기 (${fmt(inc.places.length)}곳)` : '지도에서 그곳 보기'}">보기</button>${free ? `<button type="button" class="advice-view act-now" data-act="${inc.tool}" title="출동 도구 들기">${icon(inc.goal === 'fire' ? 'flame' : 'shield')}출동</button>` : ''}</span></section>`;
}

/** A facility's load against what it takes (power, water, rubbish, patients, pupils, prisoners, riders), as a thin bar under its line. */
function facBar(f: Structure): string {
  const d = STRUCTURES[f.kind];
  const cap = d.station ? d.station.capacity : f.capacity;
  if (!cap || !(d.plant || d.pump || d.incinerator || d.health || d.school || d.police || d.station)) return '';
  const r = f.load / cap;
  // (Past full in the line's own amber: a crowded school reads as its figures do, not as an emergency.)
  return `<span class="fac-bar${r > 1 ? ' over' : ''}" aria-hidden="true"><i style="width:${Math.min(100, r * 100).toFixed(0)}%"></i></span>`;
}

/** How much of a goal's capacity is in use (power, water, beds, seats), as a bar under its figures: read at a glance. */
function usageBar(id: GoalId): string {
  const st = readStats();
  const of = { power: st.power.supply > 0 ? '발전량' : '', water: st.water.supply > 0 ? '급수량' : '', health: '병원 정원', education: '학교 정원' }[id as 'power'];
  const r = goalStatus(id).bar;
  if (!of || r === undefined || !Number.isFinite(r)) return '';
  const pct = Math.round(r * 100);
  // Past the whole: a cut for power and water, a crowded school or hospital otherwise; near it, a warning for the grids.
  const utility = id === 'power' || id === 'water';
  const tone = r > 1 ? (utility ? 'bad' : 'warn') : utility && r > 0.85 ? 'warn' : '';
  const tail = utility ? ' 사용 중' : r > 1 ? ' · 넘침' : '';
  return `<div class="mg-usage ${tone}" role="img" aria-label="${of}의 ${pct}%${tail}"><span class="mg-usage-bar"><i style="width:${Math.min(100, pct)}%"></i></span><span class="mg-usage-text">${of}의 <b>${pct}%</b>${tail}</span></div>`;
}

/** Each kind of source's colour in the bar (theme tokens, a hue each; the plants' kinds apart). */
const CAUSE_TONE: Record<string, string> = { ID: 'var(--src-id)', IM: 'var(--src-im)', IHT: 'var(--src-iht)', IA: 'var(--src-ia)', traffic: 'var(--src-traffic)', spill: 'var(--src-spill)', rest: 'var(--src-rest)',
  'st:coalPlant': 'var(--src-coal)', 'st:oilPlant': 'var(--src-oil)', 'st:gasPlant': 'var(--src-gas)' };
const causeTone = (key: string): string => {
  if (CAUSE_TONE[key]) return CAUSE_TONE[key];
  const def = key.startsWith('st:') ? STRUCTURES[key.slice(3) as StructureKind] : undefined;
  return def?.plant ? 'var(--src-coal)' : def?.incinerator ? 'var(--src-burn)' : 'var(--src-other)';
};

/**
 * The environment screen: where the air over the smoggy homes comes from, as one bar, each part's name a way to the
 * worst one of its kind on the map (a factory, a plant, the busiest road by the homes).
 */
function airCauses(id: GoalId): string {
  if (id !== 'environment') return '';
  const list = airSources();
  if (!list.length) return '';
  const pct = (v: number) => (v >= 0.995 ? '100%' : v < 0.01 ? '1% 미만' : `${Math.round(v * 100)}%`);
  const unit = (x: AirSource) => (x.key === 'traffic' ? `길 ${fmt(x.count)}칸` : x.key.startsWith('st:') || x.key === 'spill' ? `${fmt(x.count)}곳` : `건물 ${fmt(x.count)}채`);
  // (Each part grows by its share, the gaps between taken out first: widths in % ran past the end.)
  const bar = list.map((x) => `<i style="flex-grow:${x.share.toFixed(3)};background:${causeTone(x.key)}"></i>`).join('');
  const items = list.map((x) => {
    const dot = `<i style="background:${causeTone(x.key)}"></i>`;
    if (!x.at || !x.lot) return `<span class="mg-cause">${dot}${escapeHtml(x.label)} <b>${pct(x.share)}</b></span>`;
    const worst = x.key === 'traffic' ? '오염을 가장 많이 보태는 길' : x.count > 1 ? '가장 많이 보태는 곳' : '그곳';
    return `<button type="button" class="advice-view mg-cause" data-at="${x.at.join(',')}" data-flash="${[x.lot.x, x.lot.y, x.lot.w, x.lot.h].join(',')}" title="${escapeHtml(`${x.label} ${unit(x)} · 지도에서 ${worst} 보기`)}">${dot}${escapeHtml(x.label)} <b>${pct(x.share)}</b></button>`;
  }).join('');
  const said = list.map((x) => `${x.label} ${pct(x.share)}`).join(', ');
  // What takes the biggest away, in the engine's distances: beyond its smoke's reach (a factory's), or past where a
  // plant's falls under 40.
  const top = list[0]!;
  const kind = top.key.startsWith('st:') ? (top.key.slice(3) as StructureKind) : null;
  const reach = (DEV_TYPES as readonly string[]).includes(top.key) ? city.cfg.development.airPollution[top.key as DevType]?.radius : undefined;
  const tip = top.share < 0.3 ? ''
    : reach !== undefined ? `${top.key === 'IA' ? '농장의 먼지' : `${top.label} 공장의 연기`}가 가장 큽니다 · 주거 구역을 ${fmt(reach + 1)}칸 넘게 떼어 두면 닿지 않습니다`
    : kind && (STRUCTURES[kind].plant || STRUCTURES[kind].incinerator) ? `${top.label}의 연기가 가장 큽니다 · 주거지에서 ${fmt(smokeClear(kind))}칸 넘게 떨어진 곳으로 옮기면 그 연기로는 공기가 나빠지지 않습니다`
    // (Not widening: the engine's traffic smoke is the volume on a road, and a wider one draws more of it.)
    : top.key === 'traffic' ? '교통이 가장 큽니다 · 버스·지하철로 차를 줄이면 줄어듭니다 (길을 넓히면 차가 더 몰립니다)'
    : top.key === 'spill' ? '쏟아진 유독 물질이 가장 큽니다 · 소방서가 닿으면 치워집니다' : '';
  return `<div class="mg-causes"><p class="mg-causes-title">공기 나쁜 주거지의 오염원<small>눌러서 지도에서 보기</small></p><span class="mg-causes-bar" role="img" aria-label="${escapeHtml(said)}">${bar}</span><div class="mg-causes-list">${items}</div>${tip ? `<p class="mg-causes-tip">${escapeHtml(glue(tip))}</p>` : ''}</div>`;
}

/**
 * One advisor's word under 진단, with its 보기 and fix buttons. The word 추천 조치 already leads with
 * is not said twice: its first sentence stands at the top of the screen, so only the rest is read here.
 */
function diagnosis(a: ReturnType<typeof adviceFor>[number], lead: ReturnType<typeof guideSaid>, id: GoalId): string {
  let text = a.code === 'waterShort' && waterApart() ? APART : ADVICE_TEXT[a.code]?.(a.value ?? 0, a.type) ?? a.code;
  // (The card may name it its own way — a full hospital, which one and all of them — over the same first sentence.)
  const echo = a === lead.worst && !!lead.said && (text.startsWith(lead.said) || lead.said === fullNote(a, id));
  // (The trouble the top card leads with and mends in one press itself — a tax to neutral, a budget to 100% — is
  // not offered again here: the same advice and the same button twice on one screen. Only then: a budget already at
  // 100% leaves the card a build, and this line its 보기 and its own button.)
  const mended = a.code === 'taxHigh' ? !!fixButton(a) : a.level !== 'good' && !!BUDGET_FIX[a.code] && !!budgetStep('finance', a);
  if (echo && mended) return '';
  if (echo) text = text.slice((text.startsWith(lead.said) ? lead.said : firstSentence(text)).length).trim();
  const more = a.code === 'unemployment' ? jobHint() : a.code === 'abandoned' ? abandonHint() : a.code === 'capRes' ? capHint() : '';
  const acts = a.at || fixButton(a) ? `<span class="advice-acts">${a.at ? `<button type="button" class="advice-view" data-at="${a.at.join(',')}" title="지도에서 그곳 보기">보기</button>` : ''}${fixButton(a)}</span>` : '';
  if (echo && !text && !more && !acts) return '';
  const level = a.level === 'bad' ? 'bad' : a.level === 'good' ? 'good' : 'neutral';
  return `<p class="advice ${level}${echo ? ' echo' : ''}">${icon(a.level === 'bad' ? 'alert' : a.level === 'good' ? 'award' : 'info', 'adv-i')}<b class="adv-who">${ADVISOR_NAME[a.advisor]}</b> ${echo ? `<span class="adv-echo" title="${escapeHtml(lead.said)}">위의 문제:</span> ` : ''}${text}${more}${acts}</p>`;
}

/** The ways of running the plants, and the networks a repair mends, in words. */
const DISPATCH_NAME: Record<PowerDispatch, string> = { balanced: '가동률 균등', economical: '발전비 우선', clean: '저오염 우선' };
const REPAIR_NAME: Record<RepairDepartment, string> = { roads: '도로', transit: '철로', power: '송전선', water: '수도관' };

/**
 * A goal's operating sections: its outlook (for the scoreboard: what the month ahead holds as things stand) and its
 * running choices (for the actions: the plants' dispatch, and a repair for each department's damaged network).
 */
type Operations = { outlook: string; dispatch: string; repairs: Partial<Record<RepairDepartment, string>> };
const NO_OPERATIONS: Operations = { outlook: '', dispatch: '', repairs: {} };
let operationsMemo: { key: string; goal: GoalId; ops: Operations } | null = null;

/** Operating decisions are read only for the open management screen and cached between city changes. */
function operations(id: GoalId): Operations {
  if (!['power', 'water', 'traffic', 'finance', 'garbage'].includes(id)) return NO_OPERATIONS;
  if (city.stepping) return operationsMemo?.goal === id ? operationsMemo.ops : NO_OPERATIONS;
  const key = `${changeKey()}|${id}|${city.state.funds}|${city.state.powerDispatch}`;
  if (operationsMemo?.key === key) return operationsMemo.ops;
  const ops: Operations = { outlook: '', dispatch: '', repairs: {} };
  if (id === 'garbage') {
    const preview = city.previewGarbage();
    ops.outlook = `<section class="mg-sec"><h3>${icon('trash')}지금 조건의 수거 전망</h3>
      <p>소각 ${fmt(preview.incinerated)} t · 매립 ${fmt(preview.landfilled)} t · 반출 ${fmt(preview.exported ?? 0)} t</p>
      <p class="${preview.uncollected > 1 ? 'neg' : 'pos'}">못 치울 새 쓰레기 ${fmt(preview.uncollected)} t · 수거 후 쌓인 양 ${fmt(preview.piled)} t</p>
      ${(preview.routeCutOff ?? 0) > 1 ? `<p class="muted">${fmt(preview.routeCutOff!)} t의 수거망이 처리장·반출 도로와 끊겨 있습니다. 같은 망에 처리장을 마련하거나 도로를 이으세요.</p>` : ''}
      <small class="muted">현재 인구와 설비 상태 기준입니다. 공사가 끝나거나 도시가 자라면 바뀝니다.</small></section>`;
    operationsMemo = { key, goal: id, ops };
    return ops;
  }
  const infrastructure = city.infrastructureReport();
  if (id === 'power' && infrastructure.power.some((network) => network.sources.length)) {
    const reports = POWER_DISPATCHES.map((strategy) => city.energyReport(strategy)!);
    ops.dispatch = `<section class="mg-sec"><h3>${icon('zap')}발전 운영</h3><div class="mg-chips" role="group" aria-label="발전 운영 전략">${reports.map((report) =>
      `<button type="button" class="vchip" data-power-dispatch="${report.strategy}" aria-pressed="${(city.state.powerDispatch ?? 'balanced') === report.strategy}" title="지금 전력 수요에서의 발전비 · 정비비는 별도">${DISPATCH_NAME[report.strategy]} · 발전비 월 §${fmt(report.generationCost)}</button>`).join('')}</div>
      <p class="muted">부하를 맡은 발전소는 더 빨리 늙습니다. 저오염 운전은 오염을 줄이는 대신 발전비가 늘 수 있습니다.</p></section>`;
  }
  if (id === 'power' || id === 'water') {
    const networks = infrastructure[id];
    const fragile = networks.filter((network) => network.demand > 0 && network.contingencyShortfall > 0);
    const worst = [...fragile].sort((a, b) => b.contingencyShortfall - a.contingencyShortfall)[0];
    if (networks.length) ops.outlook = `<section class="mg-sec"><h3>${icon('info')}공급 여유와 예비 시설</h3><p class="${fragile.length ? 'muted' : 'pos'}">${fragile.length ? `가장 큰 공급원 하나가 멈추면 부족해지는 망 ${fmt(fragile.length)}개` : '현재 수요에서 최대 공급원 하나가 멈춰도 용량이 충분합니다'}</p>${worst ?
      `<p>가장 취약한 망: ${fmt(worst.contingencyShortfall)} ${id === 'power' ? 'MWh' : 'm³'} 부족 <button type="button" class="advice-view" data-at="${worst.x},${worst.y}">망 보기</button></p>` : ''}<small class="muted">현재 수요·이용 배정 기준입니다.</small></section>`;
  }
  const departments: RepairDepartment[] = id === 'power' ? ['power'] : id === 'water' ? ['water'] : id === 'traffic' ? ['roads', 'transit'] : [];
  for (const dept of departments) {
    const repair = infrastructure.repairs[dept];
    if (repair.tiles > 0) ops.repairs[dept] = `<button type="button" class="vchip" data-repair-network="${dept}"${repair.cost > city.state.funds ? ' disabled' : ''}>${REPAIR_NAME[dept]} ${fmt(repair.tiles)}칸 · §${fmt(repair.cost)}</button>`;
  }
  if (id === 'finance') {
    const current = city.budgetForecast(12);
    const stress = city.budgetForecast(12, { taxIncomeMultiplier: 0.8 });
    const capital = infrastructure.capitalNeeded;
    ops.outlook = `<section class="mg-sec"><h3>${icon('wallet')}12개월 자금 전망</h3><p>최저 자금 <b class="${current.minimumFunds < 0 ? 'neg' : ''}">§${fmt(current.minimumFunds)}</b>${current.firstNegativeMonth !== null ? ` · ${current.firstNegativeMonth === 0 ? '지금' : `${current.firstNegativeMonth}개월 후`} 자금 부족` : ''}</p>
      <p class="muted">세입이 20% 줄면 최저 §${fmt(stress.minimumFunds)} · 1년 안에 수명이 끝날 시설의 개보수 비용 §${fmt(capital)}</p>
      <small class="muted">지금 세입·운영비·거래 가격을 유지한 전망입니다. 대출 만기는 반영하고 성장·노후화·재해는 제외합니다.</small></section>`;
  }
  operationsMemo = { key, goal: id, ops };
  return ops;
}

/** The repairs of a tab's departments (the damaged stretches of their networks, each mended in one press). */
function repairActions(ops: Operations, depts: readonly Dept[]): string {
  const chips = depts.map((k) => ops.repairs[k as RepairDepartment] ?? '').join('');
  return chips ? `<section class="mg-sec"><h3>${icon('road')}손상 구간 수리</h3><div class="mg-chips">${chips}</div><p class="muted">손상된 구간만 고칩니다. 부서 예산이 부족하면 다시 닳습니다.</p></section>` : '';
}

/**
 * The goal's tabs under its name: each a part of it with the map's view for it (marked red where its part is in
 * trouble); under a tab of several views, its kinds.
 */
function tabsHtml(id: GoalId): string {
  const tabs = goalTabs(id);
  const now = tabNow(id);
  // (One part, no row of tabs: a lone tab named only what the screen already says.)
  if (tabs.length < 2) return '';
  const view = currentView();
  const row = tabs.map((x, k) => {
    const on = x === now;
    const tone = tabTone(id, x);
    const shows = x.view === 'none' ? '지도 보기 없음 (도시 그대로)' : `지도: ${viewName(tabView(id, x)) || x.label}`;
    return `<button type="button" role="tab" class="mg-tab${on ? ' on' : ''}" id="mg-tab-${k}" data-mg-tabk="${k}" aria-selected="${on}" tabindex="${on ? 0 : -1}" title="${escapeHtml(shows)}${tone ? ' · 문제 있음' : ''}">${escapeHtml(x.label)}${tone ? '<i class="mg-tab-dot" aria-hidden="true"></i>' : ''}</button>`;
  }).join('');
  // (Only the kinds the city has, and the one showing: six networks opened on a blank map and "아직 없습니다".)
  const kinds = now.views?.filter(([v]) => v === now.view || v === view || !viewEmpty(v)) ?? [];
  const sub = kinds.length > 1 ? `<div class="mg-kinds" role="group" aria-label="${escapeHtml(now.label)} 종류">${kinds.map(([v, label]) => `<button type="button" class="vchip" data-mg-view="${v}" aria-pressed="${view === v}">${label}</button>`).join('')}</div>` : '';
  return `<div class="mg-tabs" role="tablist" aria-label="${GOALS[id].name}: 탭마다 지도 보기가 바뀝니다">${row}</div>${sub}`;
}

/**
 * The goal's screen, top down: its name and tabs; the tab's scoreboard (what is wrong, its figures; the graphs and
 * reports follow, kept apart); what can be done about it (the guide's step, then building, deals, budgets,
 * ordinances, the facilities); and the rest (the advisors' words on it, what was done here).
 */
function goalParts(id: GoalId): { top: string; acts: string; more: string } {
  const g = GOALS[id];
  const t = tabNow(id);
  const s = goalStatus(id);
  const list = facilities(g);
  const guide = guideHtml(id);
  const has = (part: TabPart) => partOn(id, t, part);
  // The advisors' words about this tab's part (all good: the good ones).
  const own = adviceFor(id).filter((a) => codeOn(id, t, a.code));
  const advice = own.filter((a) => a.level !== 'good' || own.every((x) => x.level === 'good'));
  // (What the card leads with, which 진단 then gives as 위의 문제: the cap's word when its park comes first.)
  const capped = capFirst(id);
  const lead = capped ? { said: firstSentence(adviceText(capped)), worst: capped } : guideSaid(id);
  // Several of a kind are numbered in the order they were built (five rows of 양수 펌프 could not be told apart).
  const ofKind = new Map<string, number>();
  for (const f of list) ofKind.set(f.kind, (ofKind.get(f.kind) ?? 0) + 1);
  const nth = new Map<string, number>();
  const named = new Map<number, string>();
  for (const f of list) {
    const k = (nth.get(f.kind) ?? 0) + 1;
    nth.set(f.kind, k);
    named.set(f.id, (ofKind.get(f.kind) ?? 0) > 1 ? `${STRUCTURE_NAME[f.kind]} ${k}` : STRUCTURE_NAME[f.kind]);
  }
  const facName = (f: Structure) => named.get(f.id) ?? STRUCTURE_NAME[f.kind];
  // The ones in trouble first (red, then amber): the seventh, overcrowded, was folded under N곳 더 보기.
  const rank = (f: Structure) => ({ bad: 0, warn: 1 } as Record<string, number>)[facilityLine(f)[1]] ?? 2;
  const shown = [...list].sort((a, b) => rank(a) - rank(b)).slice(0, allFacilities ? list.length : 6);
  // (All run on the department's budget: said once by the heading, not as the same pill on every row.)
  const allDept = list.length > 0 && list.every((f) => deptFunded(f.kind));
  // The tab's own share of the goal's tools, budgets and ordinances (and any it names besides).
  const tools = [...new Set([...g.tools.filter((x) => onTab(id, t, x, (y) => y.tools)), ...(t.tools ?? [])])];
  const depts = g.depts.filter(([k]) => onTab(id, t, k, (y) => y.depts));
  const ords = [...new Set([...g.ordinances.filter((o) => onTab(id, t, o, (y) => y.ordinances)), ...(t.ordinances ?? [])])];
  const figs = metrics(id).filter(([label]) => figOn(id, t, label));
  const ops = operations(id);
  // (No way back: each area's screen is one of the city's, the city's own its button's; the pane's × puts it away.
  // 재정·정책's head is the city's — region › name and its tabs over the pane.)
  const top = `${id === 'finance' ? '' : `<header class="mg-head">
      <h2 title="${g.aim}">${icon(g.icon)}<span>${g.name}</span></h2>${!s.tone && !readStats().population && !city.state.buildings.size
      ? '<span class="chip" title="아직 사는 사람이 없습니다: 판단은 도시가 생긴 뒤에">시작 전</span>' // (an empty map isn't "good")
      : `<span class="chip ${s.tone || 'good'}">${s.tone === 'bad' ? '조치 필요' : s.tone === 'warn' ? '주의' : '양호'}</span>`}
      ${tabsHtml(id)}
    </header>`}
    ${incidentBanner(id)}
    ${guide.head}
    ${figs.length ? `<div class="mg-metrics">${figs.map(([label, value, tone, n, better, title]) => {
      // How it moved since this screen opened: the result of what was done here, read where it was done.
      const was = baseline.get(label);
      const d = n !== undefined && was !== undefined ? Math.round(n - was) : 0;
      const dir = d && better ? (Math.sign(d) === better ? 'up' : 'down') : '';
      const delta = d ? `<small class="delta ${dir}" title="이 화면을 연 뒤의 변화 (조치 말고도 도시가 저절로 바뀐 몫 포함)">${d > 0 ? '▲' : '▼'} ${withUnit(Math.abs(d), value, label)}</small>` : '';
      return `<div class="mg-m ${tone ?? ''}"${title ? ` title="${escapeHtml(title.trim())}"` : ''}><span>${label}</span><b>${value}</b>${delta}</div>`;
    }).join('')}</div>` : ''}
    ${has('usage') ? usageBar(id) : ''}
    ${has('air') ? airCauses(id) : ''}
    ${has('rci') && id === 'growth' && $('#demand').innerHTML.trim() ? `<section class="mg-sec mg-rci"><h3>${icon('zones')}구역별 수요 <span class="sec-note">막대가 위로 길수록 수요가 큼</span></h3>${$('#demand').innerHTML.replace('id="demand-detail"', 'class="demand-detail-mg"')}</section>` : ''}
    ${has('outlook') ? ops.outlook : ''}`;
  const facs = has('facilities') && list.length ? `<section class="mg-sec"><h3>${icon('landmark')}시설 ${list.length}곳${allDept ? '<small class="sec-note">부서 예산으로 운영</small>' : ''}</h3><div class="mg-facs">${shown.map((f) => {
      const [line, tone] = facilityLine(f);
      // Each its own budget, a step either way, and what it costs a month (per-building funding).
      const u = city.structureUpkeep(f.id);
      const cost = u ? u.running + u.overcapacity : 0;
      return `<div class="fac ${tone}"><button type="button" class="fac-main" data-fac="${f.id}" title="지도에서 보고 정보 카드 열기"><span class="fac-name">${facName(f)}</span><span class="fac-line">${line}</span>${facBar(f)}</button>
        ${allDept ? '' : deptFunded(f.kind) ? `<span class="fac-fund dept-note" title="이 시설은 부서 예산으로 운영됩니다">부서 예산</span>` : `<span class="fac-fund" title="이 시설의 예산 · 월 §${fmt(cost)}"><button type="button" class="tax-step" data-fund="${f.id}" data-d="-10" aria-label="${STRUCTURE_NAME[f.kind]} 예산 줄이기"${f.funding <= 0 ? ' disabled' : ''}>−</button><span><b>${f.funding}%</b><small>월 §${fmt(cost)}</small></span><button type="button" class="tax-step" data-fund="${f.id}" data-d="10" aria-label="${STRUCTURE_NAME[f.kind]} 예산 늘리기"${f.funding >= FUNDING_MAX(f.kind) ? ' disabled' : ''}>+</button></span>`}</div>`;
    }).join('')}</div>${list.length > 6 ? `<button type="button" class="link mg-more">${allFacilities ? '줄여 보기' : `${list.length - 6}곳 더 보기`}</button>` : ''}</section>` : '';
  const acts = `${guide.act}
    ${has('spot') ? spotLine(id) : ''}
    ${id === 'finance' && has('fix') ? financeActions() : ''}
    ${buildActions(g, tools)}
    ${has('deals') ? dealActions(id) : ''}
    ${budgetActions(g, has('facilities') ? list : [], depts)}
    ${repairActions(ops, depts.map(([k]) => k))}
    ${has('dispatch') ? ops.dispatch : ''}
    ${id === 'finance' ? '' : ordinanceActions(ords)}
    ${facs}`;
  const more = `${((said) => (said ? `<section class="mg-sec"><h3>${icon('info')}진단</h3>${said}</section>` : ''))(advice.map((a) => diagnosis(a, lead, id)).join(''))}
    ${log(id)}
    ${g.links?.length ? `<section class="mg-sec mg-links">${g.links.map(([tab, label]) => `<button type="button" class="link" data-mg-tab="${tab}">${label} ${icon('chevronRight')}</button>`).join('')}</section>` : ''}`;
  return { top, acts, more };
}

/** The open goal's tone at the last update (to tell when it comes good). */
let toneSeen: { goal: GoalId | null; lineage: number; tone: Tone } = { goal: null, lineage: -1, tone: '' };
const saidGood = new Map<GoalId, number>();
let saidGoodLineage = -1;

/** What each part of the panel last drew (redrawn only when it would change, and never under a press). */
const drawn = { top: '', acts: '', more: '' };
let holding = false;
/** Whether a press in the pane is under way (its panels wait to be redrawn). */
export const paneHeld = () => holding;

/** Redraws the goal's panel with the city as it is now (from updatePanels). */
export function renderGoal(force = false): void {
  if (!active) return;
  // A tab gone from under the player (radiation cleared while its tab was on): the last one stands, and its view with
  // it (the list showed it chosen over the old tab's map).
  const tabs = goalTabs(active);
  if (tabAt >= tabs.length) {
    tabAt = tabs.length - 1;
    showGoalView(tabView(active, tabs[tabAt]!));
    showGoalStats(active);
    force = true;
  }
  // The result of the work: the goal turning good while its screen is open is said once.
  const tone = goalStatus(active).tone;
  if (toneSeen.goal === active && toneSeen.lineage === cityLineage && (toneSeen.tone === 'bad' || toneSeen.tone === 'warn') && tone === ''
    && (saidGoodLineage !== cityLineage || city.state.day - (saidGood.get(active) ?? -Infinity) > 60)) {
    if (saidGoodLineage !== cityLineage) saidGood.clear();
    saidGoodLineage = cityLineage; // (a figure hovering at the line says it once a season)
    saidGood.set(active, city.state.day);
    toast(`${GOALS[active].name}: 이제 양호합니다`, 'good');
  }
  toneSeen = { goal: active, lineage: cityLineage, tone };
  // Another city opened: its figures start from here (not from the last city's).
  if (baselineCity !== cityLineage) {
    baselineCity = cityLineage;
    baseline.clear();
    for (const [label, , , n] of metrics(active)) if (n !== undefined) baseline.set(label, n);
  }
  // A slider in hand (or focused for the arrow keys) is never rebuilt under the player.
  if (!force && (holding || (document.activeElement as HTMLElement | null)?.matches?.('#manage :is(#mg-body, #mg-acts, #mg-more) input[type=range]'))) return;
  const parts = goalParts(active);
  refreshMarks(active, facilities(GOALS[active])); // (after the screen: its guide picks the site to mark)
  // Each part redrawn only when it changed (the policy and the statistics between them are kept: a slider in hand, a
  // graph's pointer).
  for (const [key, el] of [['top', $('#mg-body')], ['acts', $('#mg-acts')], ['more', $('#mg-more')]] as const) {
    if (!force && parts[key] === drawn[key]) continue;
    const sel = el.contains(document.activeElement) ? focusKey(document.activeElement) : '';
    drawn[key] = parts[key];
    el.innerHTML = parts[key];
    if (sel) el.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
  }
}

/** Attributes that pick out a control again after the panel is redrawn. */
const KEYS = ['data-jump-guide', 'data-spot', 'data-spot-build', 'data-widen', 'data-line-path', 'data-landfill', 'data-zone', 'data-tray', 'data-act', 'data-kind', 'data-fac', 'data-fund', 'data-d', 'data-mg-ord', 'data-mg-dept', 'data-mg-group', 'data-mg-view', 'data-mg-tabk', 'data-goal', 'data-mg-tab', 'data-at', 'data-power-dispatch', 'data-repair-network'];

/** A selector for the focused control inside the goal panel, to give focus back after a redraw ('' if none). */
function focusKey(el: Element | null): string {
  if (!el || !$('#manage').contains(el) || el === $('#manage')) return '';
  const own = KEYS.filter((a) => el.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(el.getAttribute(a)!)}"]`).join('');
  if (own) return `${el.tagName.toLowerCase()}${own}`;
  const cls = ['mg-more'].find((c) => el.classList.contains(c));
  return cls ? `.${cls}` : '';
}

/** Phones: the pane is a sheet over the map (the same test as the stylesheet's). */
const phone = () => matchMedia('(max-width: 860px)').matches;

/** M: the goal most in need (else the first), or the one open put away (its screen ends) — or, one open but put away
 *  with the pane, the pane back on it (it ended unseen). */
export function toggleUrgentGoal(): void {
  if (active) {
    if ($('#app').classList.contains('pane-open')) closeScreen();
    else openPane();
    return;
  }
  // (The first row of 도시 상태, as the list orders them: by GOAL_ORDER alone, M opened 재정·정책 under a list that
  // began with 수도.)
  const rank = { bad: 0, warn: 1, '': 2, good: 2 } as const;
  const id = [...WATCHED].sort((a, b) => {
    const [ta, tb] = [goalStatus(a).tone, goalStatus(b).tone];
    return rank[ta] - rank[tb] || (ta ? WEIGHT[b] - WEIGHT[a] : 0);
  })[0]!;
  openGoal(id);
}

/** Wires the pane's goal rows and the goal panel (once). */
export function setupGoals(): void {
  // A problem's row, a quality's tile (or an advisor's 해결) opens its goal.
  $('#pane').addEventListener('click', (e) => {
    // 다음 보상: the full list of rewards and how far along each is (under 환경·쾌적's 쾌적도, with the landmarks).
    if ((e.target as HTMLElement).closest('.sum-next')) {
      openGoalAt('environment', '#rewards');
      return;
    }
    // A goal screen's 추천 조치: the action it names, taken up (as if pressed below).
    const guide = (e.target as HTMLElement).closest<HTMLElement>('.mg-guide-go');
    if (guide?.dataset.guideKind === 'budget') {
      // A budget raised to 100% (as the sliders do, logged for the result).
      const [what, key] = guide.dataset.guideAct!.split(':') as [string, string];
      if (what === 'rubble') {
        const res = choice('잔해 치우기', () => city.clearRubble());
        if (res.ok) noteAction(`잔해 치우기 ${fmt(res.tiles)}칸 · −§${fmt(res.cost)}`);
        flash(res.ok ? `잔해 ${fmt(res.tiles)}칸을 치웠습니다 · −§${fmt(res.cost)}` : ko(res.message ?? ''), res.ok ? 'info' : 'bad');
        city.refreshIfDirty();
        redraw();
      } else if (what === 'tax' && key === 'all') {
        const to = city.demand.neutralTax;
        const cut = taxesCutting();
        choice('세율', () => {
          for (const t of cut) city.setTaxRate(t, to);
        });
        noteAction(`세율: ${cut.map((t) => TYPE_NAME[t]).join(' · ')} ${to.toFixed(1)}%`);
        flash(`세율 ${cut.length}가지를 ${to.toFixed(1)}%로 내렸습니다 · 높았던 세율을 주민·기업이 90일 동안 기억해, 수요는 그 뒤에 돌아옵니다`, 'info');
        refreshTaxes();
      } else if (what === 'tax') {
        const to = city.demand.neutralTax;
        choice('세율', () => city.setTaxRate(key as DevType, to));
        noteAction(`세율: ${TYPE_NAME[key as DevType]} ${to.toFixed(1)}%`);
        flash(`${TYPE_NAME[key as DevType]} 세율을 ${to.toFixed(1)}%로 내렸습니다 · 높았던 세율을 주민·기업이 90일 동안 기억해, 수요는 그 뒤에 돌아옵니다`, 'info');
        refreshTaxes();
      } else if (what === 'dept') {
        const name = Object.values(GOALS).flatMap((g) => g.depts).find(([k]) => k === key)?.[1] ?? key;
        choice('부서 예산', () => city.setDepartmentFunding(key as Dept, 100));
        noteAction(`부서 예산: ${name} 100%`);
        flash(`${name} 예산을 100%로 올렸습니다`, 'info');
      } else {
        const f = city.state.structures.get(Number(key));
        if (f) {
          choice('시설 예산', () => city.setFunding(f.id, 100));
          noteAction(`시설 예산: ${STRUCTURE_NAME[f.kind]} 100%`, `fund:${f.id}`);
          flash(`${STRUCTURE_NAME[f.kind]} 예산을 100%로 올렸습니다`, 'info');
        }
      }
      updatePanels();
      renderGoal(true);
      return;
    }
    if (guide?.dataset.guideKind === 'ord') {
      // An ordinance, enacted as its switch below would (logged).
      const ordId = guide.dataset.guideAct as OrdinanceId;
      const res = choice('조례', () => city.enactOrdinance(ordId));
      if (!res.ok) flash(ko(res.message ?? ''), 'bad');
      else {
        noteAction(`조례 시행: ${ORDINANCE_NAME[ordId]}`);
        flash(`${ORDINANCE_NAME[ordId]}${josa(ORDINANCE_NAME[ordId], '을', '를')} 시행합니다`, 'info');
      }
      updatePanels();
      renderGoal(true);
      return;
    }
    if (guide) {
      // (On the tab with the card or the advisor's row it presses: on 화재 위험, 해 보기 for a fire station did nothing.)
      const named = guide.dataset.guideTool;
      pressOnTab(guide.dataset.guideKind === 'best' ? `.act.best${named ? `[data-act="${CSS.escape(named)}"]` : ''}`
        : `.advice-acts [data-act="${CSS.escape(guide.dataset.guideAct ?? '')}"]`);
      return;
    }
    // An emergency's card: its goal's screen, with the units ready (as pressed there).
    const next = (e.target as HTMLElement).closest<HTMLElement>('.next-do');
    if (next) {
      const where = next.dataset.nextAt?.split(',').map(Number) as [number, number] | undefined;
      openGoal(next.dataset.next as GoalId, where);
      const kind = next.dataset.nextKind;
      if (kind === 'incident') $('#manage').querySelector<HTMLElement>('.mg-alert [data-act]')?.click();
      // (The screen opens on the tab about its trouble, which may not be the one with the card to press.)
      if (kind === 'best') pressOnTab('.act.best');
      else if (kind === 'fix') pressOnTab(`.advice-acts [data-act="${CSS.escape(next.dataset.nextAct ?? '')}"]`);
      return;
    }
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-goal]');
    if (row) openGoal(row.dataset.goal as GoalId);
  });
  // The row of chips under the top buttons: 시작하기 opens the city pane on its overview (an open screen put away ends),
  // an area its screen (the open one's back up), its × ends it, the rating the polls. (Scrolled, its cut edges fade.)
  const strip = $('#goal-strip');
  strip.addEventListener('scroll', () => fadeStrip(strip), { passive: true });
  // (Its size changed — the rail narrowed beside the pane or widened again, the window — its fades and its Tab stop
  // again: the cut edge of a list put back at its full width with the clock stopped was left unfaded.)
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      fadeStrip(strip);
      keepStop(strip);
    }).observe(strip);
  }
  strip.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    // (From the keyboard, on into what opened: the chips go away with the bars, and the focus fell to the page.)
    const keyboard = (e as MouseEvent).detail === 0;
    const intoScreen = () => keyboard && screenStart().focus({ preventScroll: true });
    if (t.closest('[data-strip-start]')) {
      closeGoal();
      openPane();
      $('#pane').scrollTop = 0; // (the checklist heads the overview)
      if (keyboard) $('#onboarding').querySelector<HTMLElement>('button, a[href]')?.focus({ preventScroll: true });
      return;
    }
    if (t.closest('[data-strip-end]')) {
      // (From the keyboard, on to the area just closed — wide, still in its place — not the top of the row.)
      const was = active;
      if (was) stripAt = was;
      closeGoal();
      if (keyboard) (strip.querySelector<HTMLElement>(`[data-tk="${was}"]`) ?? strip.querySelector<HTMLElement>('button') ?? $('#btn-city')).focus({ preventScroll: true });
      return;
    }
    const b = t.closest<HTMLElement>('[data-strip-goal]');
    if (!b) return;
    const id = b.dataset.stripGoal as GoalId;
    // (Wide, the open area's button again puts the pane away, the screen kept on the map, as the city button's does.)
    if (!phone() && id === active && $('#app').classList.contains('pane-open')) {
      dismissPane();
      return;
    }
    openGoal(id, incidents().find((x) => x.goal === id)?.at);
    intoScreen();
  });
  // A toolbar: one Tab stop, the chip last in hand; the arrows (Home, End) go along the row. (Not the map's arrows
  // too: they panned it, or moved a building tool's cursor, under the chip being stepped through.)
  strip.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const all = [...strip.querySelectorAll<HTMLElement>('button')].filter((b) => b.getClientRects().length > 0); // (not the open area's ×, hidden in the rail's narrow column)
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const to = all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : Math.max(0, Math.min(all.length - 1, at + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1)))]!;
    to.focus();
    to.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  strip.addEventListener('focusin', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tk]');
    if (!b) return;
    stripAt = b.dataset.tk!;
    for (const x of strip.querySelectorAll<HTMLElement>('[data-tk]')) x.tabIndex = x === b ? 0 : -1;
  });
  // Across a phone's width the row changes its place: fitted again at once, not at the next month.
  matchMedia('(max-width: 860px)').addEventListener('change', () => refreshStrip());
  // A goal named beside a lever elsewhere (an ordinance in the budget sheet): its screen.
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-goal-open]');
    if (!b) return;
    e.preventDefault(); // (inside a label: not its checkbox)
    closeSheet();
    openGoal(b.dataset.goalOpen as GoalId);
  });
  // The city's screen's tabs: its overview, then 재정·정책's (← → along them, Home and End to the ends, as an area's).
  const cityTabs = $('#city-tabs');
  cityTabs.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-city-tab]');
    if (b) cityTab(Number(b.dataset.cityTab), (e as MouseEvent).detail === 0);
  });
  cityTabs.addEventListener('keydown', (e) => {
    const b = (e.target as HTMLElement).closest?.<HTMLElement>('[data-city-tab]');
    if (!b) return;
    const n = goalTabs('finance').length + 1;
    const k = Number(b.dataset.cityTab) + 1;
    const to = e.key === 'ArrowRight' ? (k + 1) % n : e.key === 'ArrowLeft' ? (k - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    e.stopPropagation(); // (not the map's arrows)
    cityTab(to - 1, true);
  });
  // 재정 and 시장 평점: the rows of the city's card down the map's left, and its scoreboard's.
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-city-row]');
    if (!b) return;
    toggleCityRow(b.dataset.cityRow!);
    if ((e as MouseEvent).detail === 0 && paneShown()) screenStart().focus({ preventScroll: true });
  });
  // The info card's link to the goal a facility or lot belongs to.
  document.addEventListener('click', (e) => {
    // A striking facility's 예산 100%로 (the strike ends with the month).
    const fund = (e.target as HTMLElement).closest<HTMLElement>('#info [data-fund-full]');
    const dispatch = (e.target as HTMLElement).closest<HTMLElement>('#manage [data-power-dispatch]');
    if (dispatch) {
      const strategy = dispatch.dataset.powerDispatch as PowerDispatch;
      const result = choice('발전 운영', () => city.setPowerDispatch(strategy));
      if (result.ok) {
        noteAction(`발전 운영: ${DISPATCH_NAME[strategy]}`);
        flash(`발전 운영을 ${DISPATCH_NAME[strategy]}으로 바꿨습니다`, 'info');
      } else flash(ko(result.message ?? ''), 'bad');
      updatePanels();
      renderGoal(true);
      redraw();
      return;
    }
    const repair = (e.target as HTMLElement).closest<HTMLElement>('#manage [data-repair-network]');
    if (repair) {
      const department = repair.dataset.repairNetwork as RepairDepartment;
      const result = city.repairNetworks(department, 0, 0, city.size - 1, city.size - 1);
      if (!result.ok) { flash(ko(result.message ?? '수리할 손상 구간이 없습니다'), 'bad'); }
      else {
        noteAction(`${REPAIR_NAME[department]} 수리 ${fmt(result.tiles)}칸 · −§${fmt(result.cost)}`);
        flash(`${REPAIR_NAME[department]} ${fmt(result.tiles)}칸을 수리했습니다 · −§${fmt(result.cost)}`, 'info');
      }
      city.refreshIfDirty();
      updatePanels();
      renderGoal(true);
      redrawInfo();
      redraw();
      return;
    }
    const overhaul = (e.target as HTMLElement).closest<HTMLElement>('#info [data-overhaul]');
    if (overhaul) {
      const id = Number(overhaul.dataset.overhaul);
      const facility = city.state.structures.get(id);
      const result = choice('시설 개보수', () => city.refurbishStructure(id));
      if (!result.ok) flash(ko(result.message ?? ''), 'bad');
      else {
        const days = Math.max(0, (result.offlineUntilDay ?? city.state.day) - city.state.day);
        const message = `${facility ? STRUCTURE_NAME[facility.kind] : '시설'} 개보수 · −§${fmt(result.cost)}${days ? ` · ${days}일 뒤 재가동` : ''}`;
        noteAction(message);
        flash(message, 'info');
      }
      updatePanels();
      renderGoal(true);
      redrawInfo();
      redraw();
      return;
    }
    if (fund) {
      const f = city.state.structures.get(Number(fund.dataset.fundFull));
      if (!f) return;
      choice('시설 예산', () => city.setFunding(f.id, 100));
      // (Logged under its own goal's screen only: another one open would wait 90 days for a result not its own.)
      if (active && active === goalOfStructure(f.kind)) noteAction(`시설 예산: ${STRUCTURE_NAME[f.kind]} 100%`, `fund:${f.id}`);
      flash(`${STRUCTURE_NAME[f.kind]} 예산을 100%로 올렸습니다 · ${f.strike ? '다음 달 파업이 끝납니다' : '정원이 늘어납니다'}`, 'info');
      redrawInfo();
      updatePanels();
      return;
    }
    // A jammed road's 이 구간 대로로 넓히기: the stretch upgraded at once.
    const widen = (e.target as HTMLElement).closest<HTMLElement>('#info [data-widen], #manage [data-widen]');
    if (widen) {
      const [x0, y0, x1, y1] = widen.dataset.widen!.split(',').map(Number) as [number, number, number, number];
      const to = widen.dataset.widenKind === 'road' ? 'road' : 'avenue';
      const word = to === 'road' ? '도로' : '대로';
      city.settle();
      const p = city.previewNetwork(x0, y0, x1, y1, to);
      if (!p.ok) {
        flash(p.message === 'not enough funds' ? `§${fmt(Math.ceil(p.cost - city.state.funds))} 모자랍니다` : ko(p.message ?? ''), 'bad');
        redrawInfo();
        return;
      }
      const res = city.buildNetwork(x0, y0, x1, y1, to);
      if (!res.ok) {
        flash(ko(res.message ?? ''), 'bad');
        return;
      }
      city.refreshIfDirty();
      const tiles = Math.abs(x1 - x0) + Math.abs(y1 - y0) + 1;
      if (active === 'traffic') noteAction(`${word} ${fmt(tiles)}칸 · −§${fmt(res.cost)}`);
      flash(`막힌 구간 ${fmt(tiles)}칸을 ${word}로 넓혔습니다 · −§${fmt(res.cost)}`, 'info');
      renderer.effect('flash', Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1);
      // (From the traffic screen: the map shows the stretch widened, near enough to see, as a site built from it does.)
      if ($('#manage').contains(widen)) {
        centerOn((x0 + x1) >> 1, (y0 + y1) >> 1, Math.max(8, Math.min(16, 240 / tiles)));
        if (phone()) closePane();
      }
      redraw();
      redrawInfo();
      updatePanels();
      renderGoal(true);
      return;
    }
    // A burning building's 소방차 보내기, a riot's 경찰차 보내기: the nearest free unit sent there, as the dispatch tool would.
    const send = (e.target as HTMLElement).closest<HTMLElement>('#info [data-send], #status [data-send]');
    if (send) {
      const unit = send.dataset.send === 'police' ? 'police' : 'fire';
      const [x, y] = send.dataset.sendAt!.split(',').map(Number) as [number, number];
      const res = city.dispatch(unit, x, y);
      const u = res.ok ? city.state.units.at(-1) : undefined;
      const riot = unit === 'police' ? riotNear(x, y) : null;
      if (u) flash(`${unit === 'police' ? '경찰차' : u.air ? '소방 헬기' : '소방차'} 출동 · ${u.travel > 0 ? `도착 약 ${Math.ceil(u.travel)}일` : '바로 도착'}${riot ? ` · 폭동에 ${riot.cars}/${riot.need}대${riot.cars < riot.need ? ' (더 보내세요)' : ''}` : ''} · 남은 차량 ${fmt(city.freeUnits(unit))}대`, 'info');
      else flash(ko(res.message ?? 'no unit'), 'bad');
      redraw();
      redrawInfo();
      updatePanels();
      return;
    }
    // The card's 도로·송전선 잇기 (a facility off the road, a building counting down): laid at once, logged under
    // its own goal's screen only.
    const layTo = (e.target as HTMLElement).closest<HTMLElement>('#info [data-lay-path]');
    if (layTo) {
      const path = layTo.dataset.layPath!.split(';').map((p) => p.split(',').map(Number) as [number, number]);
      layPath(layTo.dataset.layKind === 'road' ? 'road' : 'powerline', path, (layTo.dataset.layGoal || null) as GoalId | null);
      redrawInfo();
      return;
    }
    // A full school or hospital's 옆에 … 짓기: one more of its level on the site found beside it.
    const relieve = (e.target as HTMLElement).closest<HTMLElement>('#info [data-relieve]');
    if (relieve) {
      const kind = relieve.dataset.relieveKind as StructureKind;
      const [x, y] = relieve.dataset.relieve!.split(',').map(Number) as [number, number];
      const d = STRUCTURES[kind];
      city.settle();
      const refused = city.canPlaceStructure(kind, x - ((d.w - 1) >> 1), y - ((d.h - 1) >> 1));
      if (!refused.ok) {
        // (Taken meanwhile, or the money ran short: the card finds again, or says why.)
        const short = d.cost - city.state.funds;
        forgetSites();
        redrawInfo();
        flash(short > 0 ? `§${fmt(Math.ceil(short))} 모자랍니다` : refused.message === 'site has a building on it'
          ? '그사이 그 자리에 건물이 들어서 자리를 새로 찾았습니다' : ko(refused.message ?? ''), 'bad');
        return;
      }
      if (!pickStructure(kind)) return;
      handed = tool.id; // (placed, the facility goes down and time runs on, as a handed-out one does)
      handedPick = toolPicks;
      handedBy = goalOfStructure(kind); // (its log is its own goal's, if that is the screen open)
      centerOn(x, y, Math.max(6, 24 / Math.max(d.w, d.h)));
      placeAt(x, y);
      redrawInfo();
      updatePanels();
      return;
    }
    // A reading in the card (EQ, commute, power…): its goal's screen, on this spot.
    const r = (e.target as HTMLElement).closest<HTMLElement>('#info [data-row-goal]'); // (a table row, a chip, a glance item)
    if (r) {
      if (phone()) closeInfo();
      openGoal(r.dataset.rowGoal as GoalId, r.dataset.rowAt!.split(',').map(Number) as [number, number]);
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>('.info-goal[data-goal]');
    if (!b) return;
    if (phone()) closeInfo(); // one sheet at a time there
    openGoal(b.dataset.goal as GoalId);
  });
  const el = $('#manage');
  // A build button under the pointer (or focused) lights its target on the map: where it will build, before it does.
  const light = (e: Event) => {
    const b = (e.target as HTMLElement).closest?.<HTMLElement>('[data-spot-build], [data-line-path], [data-landfill], [data-zone]');
    // (Moving between the button's icon and its words is still on the button: no flicker.)
    const to = (e as PointerEvent | FocusEvent).relatedTarget as Node | null;
    if ((e.type === 'pointerout' || e.type === 'focusout') && b && to && b.contains(to)) return;
    // (A line lights both its ends.)
    const ends = (p: string) => { const t = p.split(';'); return [t[0]!, t.at(-1)!]; };
    // (An area lights its middle, where its target stands.)
    const middle = (r: string) => { const [x0, y0, x1, y1] = r.split(',').map(Number) as [number, number, number, number]; return [`${x0 + ((x1 - x0 + 1) >> 1)},${y0 + ((y1 - y0 + 1) >> 1)}`]; };
    const next = e.type === 'pointerover' || e.type === 'focusin' ? (b?.dataset.spotBuild?.split(';') ?? (b?.dataset.linePath ? ends(b.dataset.linePath) : b?.dataset.landfill ? middle(b.dataset.landfill) : b?.dataset.zone ? middle(b.dataset.zone) : [])) : [];
    if (next.join(';') === hotSites.join(';') || !active) return;
    hotSites = next;
    refreshMarks(active, facilities(GOALS[active]));
  };
  for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout']) el.addEventListener(type, light);
  // A press anywhere in the pane holds its redraws until let go (a row rebuilt between
  // the press and the release lost the click while time ran).
  $('#pane').addEventListener('pointerdown', () => (holding = true));
  const release = () => {
    if (!holding) return;
    holding = false;
    requestAnimationFrame(() => updatePanels()); // after the click has landed
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.mg-back')) {
      closeGoal();
      return;
    }
    if (t.closest('[data-jump-guide]')) {
      el.querySelector('.mg-guide')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return;
    }
    // A tab: its part of the goal, and its view on the map.
    const tab = t.closest<HTMLElement>('[data-mg-tabk]');
    if (tab) {
      selectTab(Number(tab.dataset.mgTabk));
      return;
    }
    // A kind under a tab of several (traffic's networks): its view, kept for the tab.
    const view = t.closest<HTMLElement>('[data-mg-view]');
    if (view) {
      subView.set(`${active!}:${tabNow(active!).label}`, view.dataset.mgView!);
      showGoalView(view.dataset.mgView!);
      renderGoal(true);
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]');
    if (act) {
      // The rest of a long list: the tool's cards in the tray, to pick the kind from (nothing armed until one is).
      if (act.dataset.tray) {
        openTray(categoryOf(act.dataset.act!));
        return;
      }
      const kind = act.dataset.kind as StructureKind | undefined;
      if (kind && city.isUnlocked(kind) && city.placementsLeft(kind) > 0) chosen[act.dataset.act!] = kind;
      selectTool(act.dataset.act!);
      handed = act.dataset.act!;
      handedPick = toolPicks;
      handedBy = active;
      // Phones: the pane steps aside for the map; the goal's chip at the top brings it back.
      if (phone()) {
        closePane();
        // (A unit to send isn't a thing to place: it said "지도에서 놓을 곳을 고르세요" for a fire truck.)
        const tool = TOOLS.find((x) => x.id === act.dataset.act)!;
        const now = incidents().filter((x) => x.goal === active);
        const free = city.freeUnits(tool.kind === 'dispatch' ? tool.unit : 'fire');
        const need = city.cfg.mayor.riotMob.minUnits;
        // (As things are: the ring is on burning buildings only, and a riot pressed three times wants three cars.)
        const where = tool.kind !== 'dispatch' ? '' : tool.unit === 'fire'
          ? (city.state.fires.length ? '불난 곳(빨간 원)을 누르세요' : city.state.treeFires.length ? '불붙은 숲을 누르세요' : '지금 불난 곳이 없습니다')
          : now.some((x) => x.riot) ? (free >= need ? '폭동 자리를 세 번 누르세요' : `폭동 자리를 누르세요 (진압에는 ${need}대, 지금 ${fmt(free)}대)`)
          : now.length ? '방화범이 있는 곳을 누르세요' : '보낼 곳을 누르세요';
        const what = tool.kind !== 'dispatch' ? '지도에서 놓을 곳을 고르세요' : `${where} · 출동 가능 ${fmt(free)}대`;
        flash(`${kind ? STRUCTURE_NAME[kind] : toolName(tool)}: ${what} · 위의 ${GOALS[active!].name} 칩으로 돌아옵니다`, 'info');
      }
      // Pressed from the keyboard: on to the map, where the arrows move the build cursor and Enter builds.
      else if ((e as MouseEvent).detail === 0 && act.matches(':focus-visible')) {
        act.blur();
        // The cursor starts on the goal's target, if it has one.
        const spot = suggestSpot(active!);
        if (spot) {
          // There at once (a glide under way would leave it off screen for the first arrow, which then starts from the middle).
          stopFlight();
          cam.x = spot.x + 0.5 - renderer.canvas.width / renderer.dpr / cam.scale / 2;
          cam.y = spot.y + 0.5 - renderer.canvas.height / renderer.dpr / cam.scale / 2;
          setHover([spot.x, spot.y]);
          redraw();
        }
        flash(`${kind ? STRUCTURE_NAME[kind] : toolName(TOOLS.find((x) => x.id === act.dataset.act)!)}: 방향키로 자리를 옮기고 Enter로 짓습니다 · Esc로 내려놓기`, 'info');
      }
      renderGoal(true);
      return;
    }
    const fac = t.closest<HTMLElement>('[data-fac]');
    if (fac) {
      const f = city.state.structures.get(Number(fac.dataset.fac));
      if (!f) return;
      if (phone()) closePane();
      centerOn(f.x + f.w / 2, f.y + f.h / 2, 10);
      showInfo(f.x, f.y);
      redraw();
      return;
    }
    // 추천 자리에 … 놓기: the landfill, or the zone the growth screen wants, laid where the guide found room.
    const fillBtn = t.closest<HTMLElement>('[data-landfill], [data-zone]');
    if (fillBtn) {
      const kind = (fillBtn.dataset.zoneKind ?? 'landfill') as ZoneKind;
      const [x0, y0, x1, y1] = (fillBtn.dataset.landfill ?? fillBtn.dataset.zone)!.split(',').map(Number) as [number, number, number, number];
      layZone(kind, x0, y0, x1, y1);
      renderGoal(true);
      return;
    }
    // 바로 잇기: the guide's line or road laid in straight runs.
    const lineBtn = t.closest<HTMLElement>('[data-line-path]');
    if (lineBtn) {
      const path = lineBtn.dataset.linePath!.split(';').map((p) => p.split(',').map(Number) as [number, number]);
      const kind = lineBtn.dataset.lineKind;
      if (layPath(kind === 'road' || kind === 'pipe' ? kind : 'powerline', path, active) && phone()) closePane();
      renderGoal(true);
      return;
    }
    const tax = t.closest<HTMLElement>('[data-tax-to]');
    if (tax) {
      const type = tax.dataset.taxTo as DevType;
      const to = city.demand.neutralTax;
      choice('세율', () => city.setTaxRate(type, to));
      noteAction(`세율: ${TYPE_NAME[type]} ${to.toFixed(1)}%`);
      // (Demand goes by the highest rate of the last 90 days: it comes back once the old rate is forgotten.)
      flash(`${TYPE_NAME[type]} 세율을 ${to.toFixed(1)}%로 내렸습니다 · 높았던 세율을 주민·기업이 90일 동안 기억해, 수요는 그 뒤에 돌아옵니다`, 'info');
      refreshTaxes();
      updatePanels();
      renderGoal(true);
      return;
    }
    const site = t.closest<HTMLElement>('[data-spot-build]');
    if (site) {
      // One site, or several (x,y;x,y: a pair of bus stops), each its facility.
      const sites = site.dataset.spotBuild!.split(';').map((p) => p.split(',').map(Number) as [number, number]);
      const [x, y] = sites[0]!;
      // The facility the screen recommends (not whatever is in hand: a school held from before went up on
      // the power plant's site); without one, a facility of this screen's already in hand.
      const best = $('#manage').querySelector<HTMLElement>('.act.best[data-kind]');
      // (The mark's 여기에 짓기 where the screen recommends a jail: the mark is a gap in police cover, a station's place.)
      const station = best && STRUCTURES[best.dataset.kind as StructureKind].police?.radius === 0 ? cheapestOf(GOALS.police) : null;
      const kind = (site.dataset.buildKind as StructureKind | undefined) ?? station ?? (best?.dataset.kind as StructureKind | undefined)
        ?? (tool.kind === 'structure' && $('#manage').querySelector(`[data-act="${tool.id}"]`) ? chosen[tool.id] : undefined);
      if (!kind) return;
      // All of it or none (a pair of stops went up as one): each site still free — a building may have grown on
      // one since it was found (growth moves no revision) — and the money for all. Else the sites are found again.
      city.settle(); // (as placing does first: a day under way may still grow on a site)
      const d = STRUCTURES[kind];
      const refused = sites.map(([sx, sy]) => city.canPlaceStructure(kind, sx - ((d.w - 1) >> 1), sy - ((d.h - 1) >> 1))).find((r) => !r.ok);
      const short = d.cost * sites.length - city.state.funds;
      if (refused || short > 0) {
        forgetSites();
        renderGoal(true);
        flash(short > 0 ? `§${fmt(Math.ceil(short))} 모자랍니다` : refused!.message === 'site has a building on it'
          ? '그사이 그 자리에 건물이 들어서 추천 자리를 새로 찾았습니다' : ko(refused!.message ?? ''), 'bad');
        return;
      }
      // Close enough to see what went up: a plant's 4×4 at 6px a tile, a 1×1 park nearer (at 6 it was a dot).
      centerOn(x, y, Math.max(6, 24 / Math.max(d.w, d.h)));
      // Each site with the facility in hand as a handed-out one: placed, it goes down and time runs on.
      for (const [sx, sy] of sites) {
        if (!pickStructure(kind)) break;
        handed = tool.id;
        handedPick = toolPicks;
        handedBy = active;
        placeAt(sx, sy);
      }
      if (phone()) closePane();
      updatePanels();
      return;
    }
    const spot = t.closest<HTMLElement>('[data-spot]');
    if (spot) {
      // (Several places — the fires burning — one after another at each press, as 찾아가기 goes: it went to the first.)
      const all = spot.dataset.spots?.split(';') ?? [spot.dataset.spot!];
      const k = all.length > 1 && spotTurn.key === spot.dataset.spots ? (spotTurn.k + 1) % all.length : 0;
      spotTurn = { key: spot.dataset.spots ?? '', k };
      const [x, y] = all[k]!.split(',').map(Number);
      if (phone()) closePane();
      centerOn(x!, y!, 6);
      if (all.length > 1) {
        pingAt(x!, y!);
        spot.textContent = `보기 ${k + 1}/${all.length}`;
      }
      redraw();
      return;
    }
    const fund = t.closest<HTMLElement>('[data-fund]');
    if (fund) {
      const f = city.state.structures.get(Number(fund.dataset.fund));
      if (!f) return;
      const to = Math.max(0, Math.min(FUNDING_MAX(f.kind), f.funding + Number(fund.dataset.d)));
      choice('시설 예산', () => city.setFunding(f.id, to));
      noteAction(`시설 예산: ${STRUCTURE_NAME[f.kind]} ${to}%`, `fund:${f.id}`);
      updatePanels();
      renderGoal(true);
      return;
    }
    if (t.closest('.mg-more')) {
      allFacilities = !allFacilities;
      renderGoal(true);
      return;
    }
    const sheet = t.closest<HTMLElement>('[data-sheet]');
    if (sheet && !sheet.classList.contains('advice-view')) {
      showTab(sheet.dataset.sheet as 'budget');
      return;
    }
    // 적자 줄이기: the lever applied (logged).
    const fin = t.closest<HTMLElement>('[data-mg-fin]');
    if (fin) {
      const kind = fin.dataset.mgFin;
      const fix = financeFix();
      if (!fix || fix.kind !== kind) return;
      if (kind === 'loan') {
        const amount = rescueLoan();
        const res = amount ? choice('대출', () => city.takeLoan(amount)) : null;
        if (!res?.ok) {
          flash(ko(res?.message ?? 'too much debt outstanding'), 'bad');
          return;
        }
        flash(`§${fmt(amount!)}을 빌렸습니다 · 10년간 월 §${fmt(city.loanPayment(amount!))} 상환`, 'info');
        noteAction(fix.what);
        updatePanels();
        renderGoal(true);
        return;
      }
      choice('적자 줄이기', () => {
        if (kind === 'idle') for (const f of [...city.state.structures.values()]) { if (STRUCTURES[f.kind].plant && f.capacity > 0 && f.load < 1) city.setFunding(f.id, 0); }
        if (kind === 'spare') city.setDepartmentFunding('water', spareWater());
        if (kind === 'over') for (const f of [...city.state.structures.values()]) { if (f.funding > 100 && !deptFunded(f.kind)) city.setFunding(f.id, 100); }
        if (kind === 'under') for (const f of [...city.state.structures.values()]) { if ((STRUCTURES[f.kind].health || (STRUCTURES[f.kind].school && classroom(f.kind))) && f.funding > 80 && f.capacity > 0 && f.load < f.capacity * 0.4) city.setFunding(f.id, 80); }
        if (kind === 'tax') for (const t2 of DEV_TYPES) { if (city.state.taxRates[t2] < city.demand.neutralTax) city.setTaxRate(t2, city.demand.neutralTax); }
        return { ok: true };
      });
      noteAction(fix.what);
      updatePanels();
      renderGoal(true);
      return;
    }
    // A neighbour's deal, signed for the full amount offered.
    const deal = t.closest<HTMLElement>('[data-mg-deal]');
    if (deal) {
      const o = city.dealOffers()[Number(deal.dataset.mgDeal)];
      if (!o?.ok) return;
      const res = choice('거래', () => city.makeDeal(o.edge, o.resource, o.direction, o.maxAmount));
      if (!res.ok) flash(ko(res.message ?? ''), 'bad');
      else noteAction(`이웃 거래: ${EDGE_NAME[o.edge]} ${RESOURCE_NAME[o.resource]} ${fmt(o.maxAmount)} ${RESOURCE_UNIT[o.resource]}`);
      city.refreshIfDirty();
      updatePanels();
      renderGoal(true);
      return;
    }
    const link = t.closest<HTMLElement>('[data-mg-tab]');
    if (link) {
      showTab(link.dataset.mgTab as 'budget' | 'region');
      return;
    }
  });
  // The tabs as one control: ← → move along them (each putting its view on), Home and End to the ends.
  el.addEventListener('keydown', (e) => {
    const tab = (e.target as HTMLElement).closest?.<HTMLElement>('[data-mg-tabk]');
    if (!tab || !active) return;
    const n = goalTabs(active).length;
    const k = Number(tab.dataset.mgTabk);
    const to = e.key === 'ArrowRight' ? (k + 1) % n : e.key === 'ArrowLeft' ? (k - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    e.stopPropagation(); // (not the map's arrows)
    selectTab(to, true);
  });
  el.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.mgDept) {
      const dept = input.dataset.mgDept as Dept;
      choice('부서 예산', () => city.setDepartmentFunding(dept, Number(input.value)));
      input.value = String(city.state.departments[dept]);
      (input.nextElementSibling as HTMLElement).textContent = `${city.state.departments[dept]}%`;
    } else if (input.dataset.mgGroup !== undefined && active) {
      // Each moves by the same step from where it was (a budget set for one facility keeps its difference).
      const list = facilities(GOALS[active]).filter((f) => !deptFunded(f.kind));
      const step = Number(input.value) - Math.round(sum(list.map((f) => f.funding)) / list.length);
      choice('시설 예산', () => {
        for (const f of list) city.setFunding(f.id, Math.max(0, Math.min(FUNDING_MAX(f.kind), f.funding + step)));
      });
      (input.nextElementSibling as HTMLElement).textContent = `${input.value}%`;
    }
  });
  el.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.mgOrd) {
      const id = input.dataset.mgOrd as OrdinanceId;
      const res = input.checked ? choice('조례', () => city.enactOrdinance(id)) : choice('조례', () => city.repealOrdinance(id));
      if (!res.ok && res.message) flash(ko(res.message), 'bad');
      else if (res.ok) noteAction(`조례 ${input.checked ? '시행' : '폐지'}: ${ORDINANCE_NAME[id]}`);
    } else if (input.dataset.mgDept) {
      const label = input.closest('label')?.firstChild?.textContent?.trim() ?? '';
      noteAction(`부서 예산: ${label} ${input.value}%`, `dept:${input.dataset.mgDept}`);
    } else if (input.dataset.mgGroup !== undefined) {
      noteAction(`시설 예산 (모두): 평균 ${input.value}%`, `group:${active}`);
    }
    // A slider let go, a box ticked: the whole city moves with it.
    updatePanels();
    renderGoal(true);
  });
}

