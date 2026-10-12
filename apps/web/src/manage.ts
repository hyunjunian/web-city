// Goals: the city pane's watch list and, for the goal picked from it, one
// screen set up for that goal. A goal (전력, 교육, 재정…) brings its own map
// view, what to read (the figures, their trend, the advisors' word, each
// facility), and what can be done about it (build, budget, ordinances),
// all on the same panel; the map, tool and info card follow from it.

import { placeAt } from './input';
import { DEV_TYPES, Net, ORDINANCES, STRUCTURES, type HistoryPoint, type OrdinanceId, type Structure, type StructureKind } from '@web-city/engine';
import { icon } from './icons';
import { chooseSpeed, runningSpeed, showOverlay, toggleFocus } from './controls';
import { refreshInfo, showInfo } from './info';
import { ko } from './messages';
import { ADVICE_TEXT, ADVICE_TOOL, ADVISOR_NAME, EDGE_NAME, ORDINANCE_NAME, RESOURCE_NAME, RESOURCE_UNIT, STRUCTURE_NAME } from './names';
import { whyNoDeals } from './region';
import { journal } from './journal';
import { abandonHint, capBest, capHint, jobHint, pushNotice, rciMini, updatePanels } from './panels';
import { builtArea, cam, centerOn, changeKey, city, cityLineage, flightCount, glideTo, graphs, redraw, renderer, setHover, speed, stopFlight } from './state';
import { closeInfo, closePane, closeSheet, openPane, showTab } from './tabs';
import { categoryOf, chosen, kindsFor, openTray, pickStructure, selectTool, structureStat, tool, toolPicks, TOOLS, toolGlyph, toolName } from './tools';
import { toast } from './toast';
import { choice } from './undo';
import { $, escapeHtml, firstSentence, flash, fmt, josa, stoppedNote } from './util';
import { type Dept, type Goal, GOAL_ORDER, type GoalId, GOALS, type Metric, type Tone } from './goals';
import { type Incident, adviceFor, deptEmpty, cheapestOf, classroom, deptFunded, facilities, facilityLine, forecast, FUNDING_MAX, goalStatus, incidents, levelShort, loadOf, metrics, readStats, SPOT_WORD, relieverFor, forgetSites, siteAwayFromHomes, siteByPlants, siteNear, siteNearHomes, siteOnPipes, stopPair, suggestSpot, sum, unpoweredZones, waterApart } from './readings';

// ------------------------------------------------------------------ the overview: problems and qualities

/** Phones: the list is behind the 도시 button, which carries the count of goals needing action. */
function refreshBadge(bad = GOAL_ORDER.filter((id) => goalStatus(id).tone === 'bad').length): void {
  const dock = document.querySelector<HTMLElement>('.dock-city');
  if (!dock) return;
  if (bad) dock.dataset.alerts = String(bad);
  else delete dock.dataset.alerts;
  // (The count is drawn by CSS: the button's name carries it for screen readers.)
  dock.setAttribute('aria-label', bad ? `도시 현황, 조치 필요 ${bad}` : '도시 현황');
}

/** The pane's watch list: one row per goal, problems marked; a row opens its goal. */
/** Each goal's figure over time (its direction on the watch list), and whether up is better. */
const DRIFT: Partial<Record<GoalId, [(p: HistoryPoint) => number | undefined, 1 | -1, string]>> = {
  finance: [(p) => p.funds, 1, '자금'], // (the money itself: a falling balance on rising funds read ▼)
  growth: [(p) => p.population, 1, '인구'],
  power: [(p) => (p.powerSupply !== undefined && p.powerDemand !== undefined ? p.powerSupply - p.powerDemand : undefined), 1, '전력 여유'],
  water: [(p) => (p.waterSupply !== undefined && p.waterDemand !== undefined ? p.waterSupply - p.waterDemand : undefined), 1, '물 여유'],
  police: [(p) => p.crimes, -1, '범죄'],
  health: [(p) => p.lifeExpectancy, 1, '기대 수명'],
  education: [(p) => p.eq, 1, '교육 지수'],
  traffic: [(p) => p.commute, -1, '통근 시간'],
  environment: [(p) => p.air, -1, '대기 오염'],
};
/** Which way a goal went over the last three months: ▲ or ▼, toned by whether that is better (nothing when flat). */
function drift(id: GoalId): string {
  const d = DRIFT[id];
  const h = city.state.history;
  if (!d || h.length < 4) return '';
  const now = d[0](h.at(-1)!);
  const then = d[0](h.at(-4)!);
  if (now === undefined || then === undefined) return '';
  const change = now - then;
  if (Math.abs(change) <= Math.max(Math.abs(then), Math.abs(now)) * 0.03) return '';
  const good = Math.sign(change) === d[1];
  return `<small class="w-drift ${good ? 'up' : 'down'}" title="${d[2]}: 3개월 전보다 ${change > 0 ? '늘었습니다' : '줄었습니다'} (${good ? '좋아지는 중' : '나빠지는 중'})">${change > 0 ? '▲' : '▼'}</small>`;
}

/** The goals shown as the city's qualities (재정 has a card of its own, with the policy). */
const WATCHED = GOAL_ORDER; // (재정 included: money is watched with the rest)

const emptyCity = () => !readStats().population && !city.state.buildings.size;

/**
 * 해결할 문제: what is wrong, the most serious first with the one thing to do about it,
 * the rest a row each (their goal's screen says more); an emergency (a fire, a riot, a
 * blackout) above them all. With nothing wrong, one quiet line.
 */
/** Figures the pane reads that are no goal of their own: jobs (on 개발·수요's row) and the mayor's rating. */
export interface PaneFigs { jobs: number; jobsTrend: string; rating: number; ratingTrend: string }

export function problemsHtml(alerts: string, figs: PaneFigs): string {
  if (emptyCity()) return '';
  const step = nextStep();
  const inc = new Set(incidents().map((x) => x.goal as GoalId));
  const all = GOAL_ORDER.map((id) => ({ id, s: goalStatus(id) })).filter(({ id, s }) => s.tone === 'bad' || s.tone === 'warn' || inc.has(id));
  // (The mayor's rating counts with them: below 0 urgent, below 20 a look.)
  const bad = all.filter(({ s }) => s.tone === 'bad').length + (figs.rating < 0 ? 1 : 0);
  const warn = all.length - all.filter(({ s }) => s.tone === 'bad').length + (figs.rating >= 0 && figs.rating < 20 ? 1 : 0);
  refreshBadge(bad);
  // (Said by colour too: the counts are the red and the amber rows below.)
  const look = warn ? `<span class="sec-note" title="주황으로 표시된 항목: 두면 나빠질 수 있는 분야">살펴볼 것 ${warn}</span>` : '';
  const counts = bad ? `<span class="chip bad" title="빨강으로 표시된 항목: 지금 손봐야 할 분야">급한 일 ${bad}</span>${look}` : look || '<span class="sec-note">모두 양호</span>';
  // No separate "what to do": 도시 상태 shows what needs a hand, and each area's screen says what to do.
  // Only what cannot wait (a fire, a riot, a blackout, impeachment) stands above it.
  return qualityGrid(counts, `${alerts}${step.urgent ? step.html : ''}`, figs);
}

/**
 * 도시 상태 (with how many need a hand): every goal's figure as a tile, in a fixed place (the scoreboard's makings:
 * what draws people, jobs and a good rating); a tile tinted when it needs looking at.
 */
function qualityGrid(counts: string, top: string, figs: PaneFigs): string {
  // One column, worst first: a troubled area is a row with its icon on a red or amber badge, its
  // figure and why in a line; the sound ones follow as plain rows, in their usual order.
  const rank = (t: Tone) => (t === 'bad' ? 0 : t === 'warn' ? 1 : 2);
  const rows = WATCHED.map((id) => ({ id, s: goalStatus(id) }))
    .sort((a, b) => rank(a.s.tone) - rank(b.s.tone) || (a.s.tone ? WEIGHT[b.id] - WEIGHT[a.id] : 0));
  const row = ({ id, s }: (typeof rows)[number]) => {
    const g = GOALS[id];
    const wait = journal().pending[id] ? '<small class="s-wait" title="한 조치의 결과를 기다리는 중 (석 달 뒤 알려 드립니다)">결과 기다리는 중</small>' : '';
    // (A row with a line under it lays that line across the row: has-note.)
    return `<button type="button" class="s-row ${s.tone || 'ok'}${s.tone || id === 'growth' ? ' has-note' : ''}${active === id ? ' on' : ''}" data-goal="${id}" title="${g.name}: ${escapeHtml(s.note)} · 눌러서 자세히" aria-label="${g.name}${s.tone === 'bad' ? ', 조치 필요' : s.tone === 'warn' ? ', 주의' : ''}: ${s.value}">
      <span class="s-ic">${icon(g.icon)}</span><span class="s-main"><span class="s-name">${g.name}${wait}</span>${id === 'growth'
        ? `<small class="s-note"><span class="s-sub">일자리 ${fmt(figs.jobs)}${figs.jobsTrend}</span>${s.tone ? ` · ${escapeHtml(s.note)}` : ''}</small>`
        : s.tone ? `<small class="s-note">${escapeHtml(s.note)}</small>` : ''}</span><b class="s-val">${drift(id)}${id === 'growth' ? `${rciMini()}${s.value.replace(' 수요 ', ' ')}` : s.value}</b>${icon('chevronRight', 's-go')}</button>`;
  };
  // 시장 평점: no goal of its own, a row all the same (below 0 it is a problem); pressed, the polls.
  const rTone: Tone = figs.rating < 0 ? 'bad' : figs.rating < 20 ? 'warn' : '';
  const rating = `<button type="button" class="s-row ${rTone || 'ok'}${rTone ? ' has-note' : ''}" data-open-polls title="시장 평점 (주거 구역 블록별 평균, −100~100) · 눌러서 주제별 여론 보기" aria-label="시장 평점: ${figs.rating}">
      <span class="s-ic">${icon('approval')}</span><span class="s-main"><span class="s-name">시장 평점</span>${rTone ? `<small class="s-note">${figs.rating < 0 ? '주민 대다수가 불만 · 계속되면 탄핵될 수 있음' : '주민 만족이 낮음 · 여론을 살펴보세요'}</small>` : ''}</span><b class="s-val">${figs.ratingTrend}${figs.rating}</b>${icon('chevronRight', 's-go')}</button>`;
  let off = rows.filter(({ s }) => s.tone).map((r) => ({ key: r.id as string, html: row(r) }));
  let sound = rows.filter(({ s }) => !s.tone).map((r) => ({ key: r.id as string, html: row(r) }));
  (rTone ? off : sound).splice(rTone ? off.length : 1, 0, { key: 'rating', html: rating }); // (a sound rating second, after 재정)
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
  const key = arrows ? '<p class="s-legend"><span class="w-drift up">▲</span><span class="w-drift down">▼</span> 지난 3개월 흐름 · 초록 좋아짐 · 빨강 나빠짐</p>' : '';
  return `<section class="card quality" aria-label="도시 상태"><div class="sec-head"><h2>도시 상태</h2>${counts}</div>${top}<div class="s-list">${off.map((e) => e.html).join('')}${off.length && sound.length ? `<p class="s-split">양호 ${sound.length}</p>` : ''}${sound.map((e) => e.html).join('')}</div>${key}</section>`;
}

/** The order 도시 상태 was last drawn in, and where its 양호 began (held while the pointer is over the list). */
let listOrder: { keys: string[]; split: number } | null = null;
const hoverable = () => matchMedia('(hover: hover)').matches;

/**
 * Phones: the goals in trouble (and anything burning) as chips over the map while the
 * pane is down, worst first, so the city's state is in sight while working on the map.
 */
export function refreshStrip(): void {
  const el = $('#goal-strip');
  const tones = GOAL_ORDER.map((id) => [id, goalStatus(id).tone] as const);
  const inc = new Set(incidents().map((x) => x.goal));
  // In the city pane's order (the worst, then the weightiest): the chip names the list's top row.
  const byWeight = (a: (typeof tones)[number], b: (typeof tones)[number]) => WEIGHT[b[0]] - WEIGHT[a[0]];
  const worst = [...tones.filter(([id, t]) => t === 'bad' || inc.has(id as 'fire')).sort(byWeight), ...tones.filter(([id, t]) => t === 'warn' && !inc.has(id as 'fire')).sort(byWeight)].slice(0, 3);
  // The worst one over the map, and how many more (three chips were a row of noise over a small map); the
  // count opens the city pane, where they are listed.
  const more = tones.filter(([id, t]) => t === 'bad' || t === 'warn' || inc.has(id as 'fire')).length - 1;
  const html = active || !phone() || !worst.length ? '' : worst.slice(0, 1).map(([id, t]) => `<button type="button" class="${inc.has(id as 'fire') ? 'bad' : t}" data-strip-goal="${id}" title="${GOALS[id].name} 화면">${icon(inc.has(id as 'fire') ? (id === 'fire' ? 'flame' : 'megaphone') : GOALS[id].icon)}${GOALS[id].name}</button>`).join('')
    + (more > 0 ? `<button type="button" class="strip-more" data-strip-more title="다른 항목 ${more}개 · 도시 현황 열기">+${more}</button>` : '');
  if (el.innerHTML !== html) el.innerHTML = html;
  el.hidden = !html;
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
  const key = `${changeKey()}|${tones.join()}|${active}|${incidents().map((x) => x.title).join()}|${city.freeUnits('fire')}|${city.freeUnits('police')}`;
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
  environment: '오염은 건강과 시장 평점을 떨어뜨립니다',
  wealth: '부유층이 오지 않아 세수가 늘지 않습니다',
};

/** How much each goal's trouble weighs, for what leads: no power or water, money running out, a fire, before traffic or wealth. */
const WEIGHT: Record<GoalId, number> = { finance: 6, growth: 5, power: 9, water: 8, garbage: 5, police: 5, fire: 7, health: 5, education: 4, traffic: 3, environment: 3, wealth: 2 };

/** An advisor's line in words (as the 진단 list says it). */
const adviceText = (a: ReturnType<typeof adviceFor>[number]) => (a.code === 'waterShort' && waterApart() ? APART : ADVICE_TEXT[a.code]?.(a.value ?? 0, a.type) ?? '');
/** Two lines the same but for punctuation and spacing (an advisor's fix often repeats the problem). */
const same = (a: string, b: string) => a.replace(/[\s.·,]/g, '') === b.replace(/[\s.·,]/g, '');

/** The advisor's word a troubled goal's 추천 조치 leads with (its first sentence), and that word; none for a sound goal or one on fire. */
function guideSaid(id: GoalId): { said: string; worst?: ReturnType<typeof adviceFor>[number] } {
  if (!goalStatus(id).tone || incidents().some((x) => x.goal === id)) return { said: '' };
  const advice = adviceFor(id);
  const worst = advice.find((x) => x.level === 'bad') ?? advice.find((x) => x.level !== 'good');
  return { said: worst && adviceText(worst) ? firstSentence(adviceText(worst)) : '', worst };
}

/**
 * 추천 조치, at the top of a troubled goal's screen, read top down: what is wrong (as its advisor
 * says it), what it costs if left, then the action in a box of its own — the facility or tool with
 * its price and upkeep, what it would do, 해 보기 to take it up and, where the screen has a site
 * for it, 추천 자리에 짓기. Once something was done here, when its result will be told.
 * (A fire or a riot has its banner instead; a sound goal shows nothing here.)
 */
function guideHtml(id: GoalId): string {
  guideSite = null;
  markSite = null;
  const s = goalStatus(id);
  if (!s.tone || incidents().some((x) => x.goal === id)) return '';
  const st = goalStep(id);
  // What is wrong as its advisor says it; with no advisor's word, the figure itself and its note.
  const { said, worst } = guideSaid(id);
  const problem = said || s.note;
  const title = said ? `<b>${escapeHtml(said)}</b>` : `<b>${escapeHtml(s.value)}</b> <span class="g-note">${escapeHtml(s.note)}</span>`;
  const spot = suggestSpot(id);
  let action: string;
  if (st.kind === 'open') {
    // Nothing to build or press for it: where it is worst, and the views that show why.
    const at = worst?.at ?? (spot ? [spot.x, spot.y] : null);
    action = `<div class="g-act"><p class="g-act-head">${icon('search')}<b>원인부터 살펴보세요</b></p>
      <p class="g-act-why">아래 진단과 지도 보기(${GOALS[id].views.map(([, label]) => label).join(' · ')})에서 원인이 보입니다</p>
      ${at ? `<div class="g-act-btns"><button type="button" class="primary" data-spot="${at.join(',')}">${icon('target')}가장 심한 곳 보기</button></div>` : ''}</div>`;
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
    const over = spot?.crowded ? adviceFor(id).find((a) => a.at && ['schoolStrike', 'hospitalStrike', 'schoolFull', 'hospitalFull'].includes(a.code)) : undefined;
    const overKind = over?.at ? city.query(over.at[0], over.at[1])?.structure?.kind : undefined;
    const relieves = !!st.build && (!overKind || !STRUCTURES[overKind].school || STRUCTURES[overKind].school!.curve === STRUCTURES[st.build].school?.curve);
    const own = site || !st.build ? null
      : mark ? one(siteNear(st.build, spot.x, spot.y, 6), `지도의 과녁(${SPOT_WORD[id] ?? ''}) 가까이, 길가 빈 땅에 바로 짓기`)
      : arealess ? one(siteAwayFromHomes(st.build), '주거지에서 떨어진 길가 빈 땅에 바로 짓기')
      : spot?.crowded && st.kind === 'best' ? (relieves ? one(siteNear(st.build, spot.x, spot.y), `넘치는 ${what} 가까이, 길가 빈 땅에 바로 짓기`) : null)
      : st.anywhere ? one(siteNearHomes(st.build), '주거지에서 가장 가까운 길가 빈 땅에 바로 짓기')
      : id === 'water' && STRUCTURES[st.build].pump ? one(siteOnPipes(st.build), '수도관에 닿고 전기가 들어오는 빈 땅에 바로 짓기')
      : id === 'power' && STRUCTURES[st.build].plant ? one(siteByPlants(st.build), '있는 발전소 옆, 전력망에 닿는 길가 빈 땅에 바로 짓기')
      // (An incinerator smokes and a recycling centre is a works: clear of the homes, by the industry.)
      : id === 'garbage' && (STRUCTURES[st.build].incinerator || STRUCTURES[st.build].recycling) ? one(siteAwayFromHomes(st.build), '주거지에서 떨어진 길가 빈 땅에 바로 짓기')
      : STRUCTURES[st.build].station?.mode === 'bus' ? (() => {
        const pair = stopPair(st.build!);
        return pair ? { at: pair, title: '주민이 가장 많은 곳과 일자리가 가장 많은 곳의 길가에 하나씩 바로 짓기', labels: ['집 쪽', '일터 쪽'] } : null;
      })() : null;
    const siteTitle = `지도의 과녁(${SPOT_WORD[id] ?? ''})에 바로 짓기`;
    // What the press does: an ordinance or a finance lever takes effect at once (해 보기 sounded like a tool to try).
    const go = st.kind === 'ord' ? '시행하기' : st.fin === 'loan' ? '빌리기' : st.fin || st.kind === 'budget' ? '적용하기' : '해 보기';
    if (own) guideSite = { id, sites: own.at.map((at, k) => ({ at, label: `추천 자리 · ${STRUCTURE_NAME[st.build!]}${own.labels[k] ? ` (${own.labels[k]})` : ''}` })) };
    if (mark) markSite = { id, at: site ? [spot.x, spot.y] : own?.at[0] ?? null };
    // (A jail recommended: the mark's 여기에 짓기 puts up a station on the gap in cover, and says so.)
    const station = arealess ? cheapestOf(GOALS.police) : null;
    if (station && spot) markSite = { id, at: [spot.x, spot.y], name: STRUCTURE_NAME[station] };
    action = `<div class="g-act"><p class="g-act-head">${st.glyph}<b>${escapeHtml(st.what)}</b>${st.sub ? `<small class="${short ? 'neg' : ''}">${escapeHtml(st.sub)}</small>` : ''}</p>
      ${why ? `<p class="${st.fx ? `g-act-fx${/−|모자람/.test(st.fx) ? ' neg' : ''}` : 'g-act-why'}">${escapeHtml(why)}</p>` : ''}
      <div class="g-act-btns"><button type="button" class="primary mg-guide-go" data-guide-kind="${st.kind}"${st.fixAct ? ` data-guide-act="${st.fixAct}"` : ''}>${go}</button>${site ? `<button type="button" class="g-site" data-spot-build="${spot.x},${spot.y}" title="${escapeHtml(siteTitle)}">${icon('target')}추천 자리에 짓기</button>`
        : own ? `<button type="button" class="g-site" data-spot-build="${own.at.map((at) => at.join(',')).join(';')}" data-build-kind="${st.build}" title="${own.title}">${icon('target')}추천 자리에 ${own.at.length > 1 ? `${own.at.length}곳 ` : ''}짓기</button>` : ''}</div></div>`;
  }
  const p = journal().pending[id];
  const wait = p ? `<p class="g-wait">${icon('check')}<span>${escapeHtml(p.text)} · ${Math.max(1, FOLLOW_DAYS - (city.state.day - p.day))}일 뒤 결과를 알려 드립니다</span></p>` : '';
  // (The screen's head names the goal: the card starts with what is wrong.)
  return `<section class="lead ${s.tone} mg-guide" aria-label="추천 조치"><p class="lead-title">${icon('alert')}<span>${title}</span></p>
    <p class="lead-risk">${(worst && RISK_OF[worst.code]) ?? RISK[id]}</p><p class="g-label">추천 조치</p>${action}${wait}</section>`;
}

/** The sites (x,y) of the build button under the pointer or focused: their marks light up on the map. */
let hotSites: string[] = [];

/** The guide's own site (one the map's mark isn't), marked on the map as the 과녁 is: where 추천 자리에 짓기 will build. */
let guideSite: { id: GoalId; sites: { at: [number, number]; label: string }[] } | null = null;
/** Where the screen's mark is built on (the mark, or the nearest fit for the facility recommended; null: none now), for its line's 여기에 짓기. */
let markSite: { id: GoalId; at: [number, number] | null; name?: string } | null = null;

/**
 * A goal's recommendation: what it is, why, the act behind 해 보기; `build` the facility it puts up
 * (`anywhere`: its place doesn't matter to what it is for, as a park lifting the cap).
 */
interface GuideStep {
  kind: 'best' | 'fix' | 'budget' | 'ord' | 'open';
  what: string; why: string; fixAct: string; act: string; glyph: string; sub: string; fx: string; site: boolean;
  build?: StructureKind; anywhere?: true;
  /** A finance lever the step pulls at once (a loan, a budget change), as its button says. */
  fin?: string;
}

/** A goal's own recommendation, read from what its screen would show (one source of truth). */
function goalStep(id: GoalId): GuideStep {
  // The trouble the card leads with ends with a budget (worn lines, a strike for want of funds): that first, before
  // anything to build (a striking station's card said 예산 부족 and recommended a kiosk).
  const { worst } = guideSaid(id);
  const due = worst && BUDGET_FIX[worst.code] ? budgetStep(id, worst) : null;
  if (due) return due;
  const tpl = document.createElement('template');
  tpl.innerHTML = (id === 'finance' ? financeActions() : '') + buildActions(GOALS[id]);
  const best = tpl.content.querySelector<HTMLElement>('.act.best');
  if (best) {
    best.querySelector('.act-best')?.remove();
    const name = best.querySelector<HTMLElement>('.act-name');
    const sub = best.querySelector('.act-sub')?.textContent?.trim() ?? '';
    const fx = best.querySelector('.act-fx')?.textContent?.trim() ?? '';
    return { kind: 'best' as const, fixAct: '', act: best.dataset.act ?? '', what: name?.textContent?.trim() ?? '',
      why: fx || sub, glyph: name?.querySelector('.i, .swatch, .pick-swatch')?.outerHTML ?? '', sub, fx, site: !!best.dataset.kind,
      build: best.dataset.kind as StructureKind | undefined, fin: best.dataset.mgFin };
  }
  // A budget that ends the trouble (worn lines, a strike) before a tool for something said after it.
  const lead = adviceFor(id).find((x) => x.level !== 'good' && (adviceTool(x.code) || BUDGET_FIX[x.code]));
  const owed = lead && BUDGET_FIX[lead.code] ? budgetStep(id, lead) : null;
  if (owed) return owed;
  const a = adviceFor(id).find((x) => x.level !== 'good' && adviceTool(x.code));
  if (a) {
    const act = adviceTool(a.code)![0].split(':')[0]!;
    const t = TOOLS.find((x) => x.id === act);
    // The cap's fix is the park its 해 보기 hands over, with its price and how far it lifts the cap
    // (the card said 공원·광장 and no more).
    const park = a.code === 'capRes' ? capBest() : undefined;
    if (park) {
      const d = STRUCTURES[park];
      return { kind: 'fix' as const, what: STRUCTURE_NAME[park], why: adviceText(a), fixAct: act, act, glyph: t ? toolGlyph(t) : '',
        sub: `§${fmt(d.cost)} · 월 §${fmt(d.upkeep)}`, fx: `주거 상한 +${fmt(d.relief[0])}명`, site: false, build: park, anywhere: true };
    }
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

/** Ordinances that fix what a goal's screen is about, to recommend (by what each does: less crime, cleaner air…). */
const ORD_FIX: Partial<Record<GoalId, readonly OrdinanceId[]>> = {
  power: ['landfillGas', 'powerConservation'], water: ['waterConservation'], garbage: ['paperWaste', 'trashPresort', 'tireRecycling'],
  police: ['neighborhoodWatch', 'juniorSports', 'youthCurfew'], fire: ['smokeDetector'], health: ['freeClinic', 'communityCpr'],
  education: ['proReading'], traffic: ['carpool', 'commuterShuttle'], environment: ['cleanAir', 'automobileEmission'], wealth: ['cleanAir', 'proReading'],
};

/** Advice whose fix is a budget, not something to build or an ordinance: the department it names, or the striking facility's own. */
const BUDGET_FIX: Record<string, Dept | 'facility'> = {
  linesWorn: 'power', pipesWorn: 'water', potholes: 'roads',
  policeStrike: 'facility', fireStrike: 'facility', hospitalStrike: 'facility', schoolStrike: 'facility',
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
  const crowded = !!f && !!(STRUCTURES[f.kind].health || STRUCTURES[f.kind].school) && f.load > f.capacity;
  return f && f.funding < 100 && !crowded ? { ...base, what: `${STRUCTURE_NAME[f.kind]} 예산 100%로`, fixAct: `fac:${f.id}`, sub: `시설 예산 · 지금 ${f.funding}%` } : null;
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
      <p class="lead-risk">${inc.goal === 'fire' ? '두면 번져 건물을 잃습니다' : '두면 번져 건물이 부서지고 평점이 떨어집니다'}</p>
      <p class="lead-do">${free ? `출동 가능 ${free}대 · 출동시켜 ${inc.goal === 'fire' ? '불을 끄세요' : inc.riot ? '진압하세요' : '체포하세요'}${riotHint(inc, free)}` : `보낼 ${inc.goal === 'fire' ? '소방차' : '경찰'}가 없습니다 · ${inc.goal === 'fire' ? '소방서' : '경찰서'}부터`}</p>
      <div class="next-acts"><button type="button" class="primary next-do" data-next="${inc.goal}" data-next-kind="incident" data-next-at="${inc.at.join(',')}">${free ? '출동 준비' : '화면 열기'}</button></div></div>` };
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
    ? `<p class="lead-title">${icon(g.icon)}<span><b>${g.name}</b> ${escapeHtml(goalStatus(id).note)}</span>${tone === 'bad' ? '<em>급함</em>' : ''}</p><p class="lead-risk">${RISK[id]}</p>`
    : `<p class="lead-title">${icon('check')}<span>지금은 모두 순조롭습니다</span></p>`;
  return { goal: id, problem: !!tone, act: tone ? step.act : '', html: `<div class="lead ${tone || 'calm'}">${head}
    <p class="lead-do" title="${escapeHtml(why)}"><span>${tone ? '제안' : '다음 성장'}</span>${escapeHtml(what)}${why ? `<small> — ${escapeHtml(firstSentence(why))}</small>` : ''}</p>
    <div class="next-acts"><button type="button" class="primary next-do" data-next="${id}" data-next-kind="${kind}"${fixAct ? ` data-next-act="${fixAct}"` : ''} title="${g.name} 화면을 열고 ${kind === 'open' ? '' : '이 조치를 도구로 들기'}">${verb}</button>${kind !== 'open' ? `<button type="button" class="link next-open" data-goal="${id}">다른 방법</button>` : ''}</div></div>` };
}

// ------------------------------------------------------------------ the goal's screen

/** The goal on screen (null: the overview). */
export let active: GoalId | null = null;
/** The view before a goal put its own on, to put back after (unless the player changed it meanwhile). */
let viewBefore = 'none';
let viewSet = '';
/** Each figure's number when the screen opened (its tile shows how far it has moved since). */
const baseline = new Map<string, number>();
let baselineCity = -1;
/** What was done from this screen, newest first: when, and what. */

/** A step taken while a goal is open (a build, a budget, an ordinance), kept on its screen. */
export function noteAction(text: string, merge?: string, toolId?: string): void {
  if (!active) return;
  // A build counts here only with a tool of this goal (a road laid while the budget is open isn't the budget's doing).
  if (toolId && !GOALS[active].tools.includes(toolId) && toolId !== handed) return;
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
  health: '건강 지수 평균 (0–200)', education: '교육 지수 평균 (0–200)', traffic: '평균 통근', environment: '대기 오염', wealth: '부유층 주민',
};
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
  pending[id] = { text, key: merge, count: 1, day: city.state.day, label: m[0], value: m[1], n: m[3], better: m[4] ?? 0 };
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
    if (!running || active === id || day - (pausedFor.get(key) ?? -Infinity) < 180) continue;
    // (A lone fire inside the stations' reach is theirs to put out: not a pause.)
    const inc = incidents().find((x) => x.goal === id);
    if (inc && !inc.urgent && (!fresh || fresh === 'fires')) continue;
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
    toast(`${inc ? inc.title : `${GOALS[id].name}: ${why ? firstSentence(why) : '조치가 필요해졌습니다'}`}${stop ? stoppedNote() : ''}`, 'bad', inc?.at ?? word?.at, () => openGoal(id, inc?.at ?? word?.at), stop);
    if (inc && stop) centerOn(inc.at[0], inc.at[1]); // a fire or a riot: the map goes to it
  }
  const j = journal();
  for (const id of Object.keys(j.pending) as GoalId[]) {
    const p = j.pending[id]!;
    if (day - p.day < FOLLOW_DAYS) continue;
    delete j.pending[id];
    const m = keyFigure(id);
    if (!m || m[3] === undefined) continue;
    // (By what is shown: a figure that reads the same hasn't moved.)
    const d = m[1] === p.value ? 0 : Math.round(m[3]) - Math.round(p.n);
    const better = p.better ? Math.sign(d) === p.better : null;
    const line = `${p.label.replace(/ \([^)]*\)$/, '')} ${p.value} → ${m[1]}`; // (its scale, "(0–200)", is for the tile)
    // Told on the goal's log too, under what was done.
    j.done.unshift({ goal: id, day, text: `└ 3개월 뒤: ${line}`, key: 'result' });
    pushNotice({ text: `${GOALS[id].name} · ${p.text}${p.count > 1 ? ` 외 ${p.count - 1}건` : ''} → 3개월 뒤 ${line}`, warn: better === false, goal: id, until: day + 360 });
    toast(`${GOALS[id].name} · ${p.text}${p.count > 1 ? ` 외 ${p.count - 1}건` : ''} 3개월 뒤: ${line}`, !d ? 'info' : better === false ? 'bad' : 'good', undefined, () => openGoal(id));
  }
}

/** The tool the goal's panel put in hand (put down again when the goal closes). */
let handed = '';
let handedPick = 0;

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

/** Puts a goal's view on the map (the wealth goal's desirability is the wealthy's), and the info card's reading follows. */
function showGoalView(id: GoalId, view: string): void {
  if (view === 'desirability') {
    const type = $<HTMLSelectElement>('#overlay-type');
    const want = id === 'wealth' ? 'R$$$' : null;
    if (want && type.value !== want) type.value = want;
  }
  showOverlay(view);
  viewSet = view;
  refreshInfo();
}

/** Opens a goal's screen: its view on the map, its panel in the pane. */
export function openGoal(id: GoalId, at?: [number, number], fromMap = false): void {
  const fresh = !active;
  const changed = active !== id;
  if (changed) {
    if (!active) {
      viewBefore = currentView();
      overviewScroll = $('#pane').scrollTop;
      byKeyboard = !!document.activeElement?.closest('#pane') && document.activeElement!.matches(':focus-visible');
    }
    active = id;
    allFacilities = false;
    baseline.clear();
    baselineCity = cityLineage;
    for (const [label, , , n] of metrics(id)) if (n !== undefined) baseline.set(label, n);
    showGoalView(id, GOALS[id].views[0]![0]);
  }
  $('#pane').classList.add('managing');
  showGoalStats(id);
  // Phones: the pane rises with it. (Not on wide screens, where it is always there:
  // marked open, the first Esc went on closing what never was.)
  // (From an alert about a place: on a phone the place shows, the goal's chip brings its screen.)
  if (phone() && !fromMap) {
    // The goal's view is on the map: the city moves into the strip above the risen pane (it was under it).
    // (Also when the pane comes back up on a goal still open: it had gone down, and the city with it.)
    if ((fresh || !$('#app').classList.contains('pane-open')) && !at) setTimeout(cityAbovePane, 320);
    openPane();
  }
  renderGoal(true);
  $('#pane').scrollTop = 0;
  // From the keyboard, carry on in the panel (the row that was focused is hidden now).
  if (byKeyboard || $('#manage').contains(document.activeElement)) $('#manage').querySelector<HTMLElement>('.mg-back')?.focus({ preventScroll: true });
  $('#manage-chip').hidden = false;
  refreshChip();
  if (at) centerOn(at[0], at[1]);
  // Its policy and statistics are drawn only while shown.
  if (fresh || changed) updatePanels();
  redraw();
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

/** B: 재정·정책, or back to the overview from it. */
export function toggleFinance(): void {
  if (active === 'finance' && ($('#app').classList.contains('pane-open') || !phone())) closeGoal();
  else openFinance();
}

/** Under a goal's screen, its statistics: graphs of its figures and the reports that go with it (filled by the panels while shown). */
function showGoalStats(id: GoalId | null): void {
  $('#policy').hidden = id !== 'finance';
  const el = $('#goal-stats');
  let any = false;
  el.querySelectorAll<HTMLElement>('.gs[data-goals]').forEach((s) => {
    s.hidden = !id || !s.dataset.goals!.split(' ').includes(id);
    any ||= !s.hidden;
  });
  graphs.setGoal(id);
  el.hidden = !any && $('#graphs').hidden;
}

/** Opens a goal's screen and brings one of its reports into sight (the summary's 시장 평점 and 다음 보상), on a view of its own. */
function openGoalAt(id: GoalId, part: string, view?: string): void {
  openGoal(id);
  if (view && currentView() !== view) {
    showGoalView(id, view);
    renderGoal(true);
  }
  requestAnimationFrame(() => $(part).closest<HTMLElement>('.gs')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
}

/** Phones: the built-up city glided into the map left above the pane. */
function cityAbovePane(): void {
  if (!active) return;
  const v = renderer.canvas.getBoundingClientRect();
  const pane = $('#pane').getBoundingClientRect();
  // Beside the pane (landscape: it stands at the left) or between the view's card at the top and the pane.
  const side = pane.top < v.top + v.height * 0.2 && pane.right < v.right - 200;
  const box = side
    ? { left: Math.max(v.left, pane.right + 6), right: v.right - 60, top: v.top + 6, bottom: v.bottom - 6 }
    : { left: v.left, right: v.right, top: Math.max(v.top, $('#map-layer').getBoundingClientRect().bottom + 6), bottom: Math.min(v.bottom, pane.top - 6) };
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
  if (!was || was.flight !== flightCount() || Math.abs(cam.scale - was.scale) > 1e-6) return;
  const v = renderer.canvas.getBoundingClientRect();
  const { cx, cy, span } = builtArea();
  glideTo(cx, cy, Math.max(2, Math.min(v.width, v.height) / span), 300);
}

/** Back to the overview: the view the goal put on goes, and a tool it handed out is put down. */
export function closeGoal(): boolean {
  if (!active) return false;
  const was = active;
  const inPanel = $('#manage').contains(document.activeElement);
  active = null;
  $('#pane').classList.remove('managing');
  $('#mg-body').innerHTML = '';
  showGoalStats(null);
  drawn = '';
  $('#manage-chip').hidden = true;
  renderer.marks = [];
  marksSig = '';
  hotSites = []; // (the button that lit them went with the screen)
  if (currentView() === viewSet) showOverlay(viewBefore);
  if (handed && tool.id === handed) selectTool('query');
  handed = '';
  updatePanels();
  // Back where the overview was, focus on the goal's row if the keyboard was in the panel.
  $('#pane').scrollTop = overviewScroll;
  if (inPanel) $('#status').querySelector<HTMLElement>(`[data-goal="${was}"]`)?.focus({ preventScroll: true });
  redraw();
  return true;
}

/** The map's chip while a goal is open: its name and state, a way back to its panel, and out. */
function refreshChip(): void {
  if (!active) return;
  const s = goalStatus(active);
  const html = `${icon(GOALS[active].icon)}<span><b>${GOALS[active].name}</b> ${s.value}</span>`;
  const label = $('#manage-chip-label');
  if (label.innerHTML !== html) label.innerHTML = html;
  $('#manage-chip').className = `floating ${s.tone}`;
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
  suggestMemo = { key, map };
  return map;
}

/** The goal's build actions: each kind of facility it may place, and its other tools. */
function buildActions(g: Goal): string {
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
  // Zones without power while the plants make plenty: the line is the fix.
  const lineFirst = g === GOALS.power && (!short_ || !!connect) && (unpoweredZones().off >= 10 || !!connect);
  const candidates = g.tools.flatMap((id) => {
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
  if (g === GOALS.traffic && (city.state.history.at(-1)?.commute ?? 0) > 1) {
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
  let order = lineFirst ? ['powerline', ...g.tools.filter((x) => x !== 'powerline')] : connect === 'pipe' ? ['pipe', ...g.tools.filter((x) => x !== 'pipe')] : g.tools;
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
      zoneWhy = jobless ? `실업 ${Math.round((sum(st.unemployed) / st.population) * 100)}%: 일터부터 내 주세요` : `수요가 가장 높습니다: 낮은 밀도부터`;
    }
  }
  const g2 = st.garbage;
  const landfillFirst = g === GOALS.garbage && g2.produced > 0 && (g2.capacity <= 0 || (g2.landfillSpace >= 0 && g2.landfillSpace < Math.max(0, (g2.kept || g2.produced - g2.recycled) - g2.incinerated) * 6));
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
        // A first stop carries no one: riders need one near home and one near work, on the same network.
        const fx = forecast(k) || (k === best && d.station ? '둘 이상 놓기: 집 근처 하나, 일터 근처 하나 (같은 노선으로 이어져야 탑니다)' : '');
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
      // Nothing to say beside its name (roads, rail, trees): a compact chip, three to a row.
      // (A zone nobody wants just now says so in its title.)
      const chip = (want === null || want < 1) && !line && t.kind !== 'dispatch';
      items.push(`<button type="button" class="act${chip ? ' act-chip' : ''}${want !== null && want >= 100 ? ' wanted' : ''}${line ? ' best' : ''}" data-act="${t.id}" title="${toolName(t)}${want !== null && want < 1 ? ' · 지금 수요 없음' : ''}">
        <span class="act-name">${toolGlyph(t)}${toolName(t)}${line ? `<em class="act-best">추천</em>` : ''}</span>${line ? `<span class="act-fx">${t.id === 'road' ? '먼저 도로부터: 구역은 도로에 닿아야 개발됩니다 · 지도 가장자리까지 이으면 이웃 도시와 오갑니다'
          : t.id === 'landfill' ? '쓰레기를 묻을 곳: 도로 옆, 주거에서 먼 곳에'
          : zoneNext === t.id ? zoneWhy
          : connect ? `${STRUCTURE_NAME[idle[0]!.kind]}${idle.length > 1 ? ` 외 ${idle.length - 1}곳` : ''}이 아직 ${connect === 'pipe' ? '수도망' : '전력망'}에 이어지지 않아 아무 데도 보내지 못합니다: 먼저 이으세요`
          : `전기 없는 구역 ${fmt(unpoweredZones().off)}칸에 이어 주기 · 칸당 §2`}</span>` : ''}<span class="act-sub">${want !== null ? (want >= 1 ? `수요 +${fmt(want)}` : '수요 없음') : t.kind === 'dispatch' ? `출동 가능 ${city.freeUnits(t.unit)}대` : ''}</span></button>`);
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
function budgetActions(g: Goal, list: Structure[]): string {

  const d = city.state.departments;
  const rows = g.depts.map(([k, name]) => `<label class="funding dept">${name} <input data-mg-dept="${k}" type="range" min="0" max="${k === 'parks' || k === 'landmarks' ? 100 : 120}" step="5" value="${d[k]}" data-mark="100"${deptEmpty(k) ? ' disabled' : ''}><span>${deptEmpty(k) ? '없음' : `${d[k]}%`}</span></label>`);
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

/** The goal's ordinances: what each does, its cost, and whether it can be enacted. */
function ordinanceActions(g: Goal): string {
  if (!g.ordinances.length) return '';
  const row = (id: OrdinanceId) => {
    const on = city.state.ordinances.includes(id);
    const avail = on || city.ordinanceAvailable(id);
    const cost = city.ordinanceCost(id);
    return `<label class="ordinance ${avail ? '' : 'muted'}"><input type="checkbox" data-mg-ord="${id}" ${on ? 'checked' : ''} ${avail ? '' : 'disabled'}>
      <span><b>${ORDINANCE_NAME[id]}</b> <span class="muted">월 ${cost < 0 ? `+§${fmt(-cost)}` : `§${fmt(cost)}`}</span><br><small>${ORDINANCES[id].description}${avail ? '' : ' · 아직 조건이 안 됨'}</small></span></label>`;
  };
  // Those in force in sight; the others to enact fold under one line (a column of switches, mostly off).
  const on = g.ordinances.filter((id) => city.state.ordinances.includes(id));
  const off = g.ordinances.filter((id) => !on.includes(id));
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
  return `<section class="mg-sec"><h3>${icon('plus')}${fix?.kind === 'loan' ? '자금 메우기' : '적자 줄이기'}</h3><div class="acts">${fix
    ? `<button type="button" class="act best" data-mg-fin="${fix.kind}"><span class="act-name">${icon('wallet')}${fix.what}<em class="act-best">추천</em></span><span class="act-fx">${fix.why}</span></button>`
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


function fixButton(a: { code: string; level: string; at?: readonly [number, number] }): string {
  // Rubble: one press clears it all; money trouble: the budget sheet (taxes, departments, loans).
  if (a.code === 'rubble') return ` <button type="button" class="advice-view" data-clear-rubble title="도시의 잔해만 모두 치웁니다">${icon('eraser')}잔해 모두 치우기 §${fmt(city.clearRubble(true).cost)}</button>`;
  if (a.level !== 'good' && (a.code === 'deficit' || a.code === 'broke')) return ` <button type="button" class="advice-view" data-sheet="budget" title="세율·부서 예산·대출">재정 열기</button>`
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
  const label = spot?.crowded ? `넘치는 ${id === 'education' ? '학교' : '병원'} 옆` : id === 'water' && spot && waterApart() ? '물이 끊긴 건물' : SPOT_WORD[id];
  // The guide's own site too, so 추천 자리에 짓기 shows where before it builds (beside a full hospital it takes
  // the place of the mark it was found near).
  const own = guideSite?.id === id ? guideSite : null;
  // (Nor where a site of the guide's is within 4 tiles of it: the two labels ran into each other.)
  const crowdedOut = !!spot && !!own?.sites.some((o) => Math.max(Math.abs(o.at[0] - spot.x), Math.abs(o.at[1] - spot.y)) <= 4);
  if (spot && !(spot.crowded && own) && !crowdedOut) marks.push({ x: spot.x, y: spot.y, w: 1, h: 1, tone: 'spot', label });
  for (const o of own?.sites ?? []) marks.push({ x: o.at[0], y: o.at[1], w: 1, h: 1, tone: 'spot', label: o.label });
  // (Lit while the button that builds there is under the pointer or focused.)
  for (const m of marks) if (m.tone === 'spot' && hotSites.includes(`${m.x},${m.y}`)) m.hot = true;
  const sig = JSON.stringify(marks);
  if (sig === marksSig) return;
  marksSig = sig;
  renderer.marks = marks;
  redraw();
}

/** The suggested spot as a line on the panel, with a way to go there. */
function spotLine(id: GoalId): string {
  const spot = incidents().some((x) => x.goal === id) ? null : suggestSpot(id);
  if (!spot) return '';
  // (Power and water: a site to build on, near where it is missing; the others: where the trouble gathers.)
  if (spot.crowded) {
    const what = id === 'education' ? '학교' : '병원';
    return `<p class="mg-spot">${icon('target')}<span><b>넘치는 ${what} 옆</b> 빈 땅: 새 ${what}${josa(what, '이', '가')} 그곳의 ${id === 'education' ? '학생을' : '환자를'} 나눠 받습니다 (지도의 과녁)</span>
    <button type="button" class="advice-view" data-spot="${spot.x},${spot.y}" title="지도에서 그곳 보기">보기</button></p>`;
  }
  // (Water short only for want of pipes between networks: where the dry ones are, to pipe to.)
  if (id === 'water' && waterApart()) {
    return `<p class="mg-spot">${icon('target')}<span><b>물이 끊긴 건물</b>이 가장 많이 모인 곳 · ${fmt(spot.tiles)}칸: 물이 남는 수도망에서 수도관을 이어 오세요 (지도의 과녁)</span>
    <button type="button" class="advice-view" data-spot="${spot.x},${spot.y}" title="지도에서 그곳 보기">보기</button></p>`;
  }
  const site = id === 'power' || id === 'water';
  // (A site for the facility the screen recommends: built there in one press — where the guide found it fits.)
  const fit = markSite?.id === id ? markSite.at : [spot.x, spot.y];
  const named = markSite?.id === id ? markSite.name : undefined;
  const build = (SERVICE_SITE.has(id) || site) && fit ? `<button type="button" class="advice-view spot-build" data-spot-build="${fit.join(',')}" title="${named ? `${named}${josa(named, '을', '를')} 이 자리에 짓기` : '추천 시설을 이 자리에 짓기'}">${icon('plus')}여기에 짓기</button>` : '';
  return `<p class="mg-spot">${icon('target')}<span>${site
    ? `<b>${SPOT_WORD[id]}</b>: ${id === 'power' ? '전기 없는 구역' : '물이 없는 건물'} ${fmt(spot.tiles)}칸 가까이, 도로 옆${id === 'power' ? ' · 주거에서 떨어진' : ''} 빈 땅 (지도의 과녁)`
    : `<b>${SPOT_WORD[id]}</b>${josa(SPOT_WORD[id]!, '이', '가')} 가장 많이 모인 곳 · ${fmt(spot.tiles)}칸 (지도의 과녁)`}</span>
    <span class="advice-acts"><button type="button" class="advice-view" data-spot="${spot.x},${spot.y}" title="지도에서 그곳 보기">보기</button>${build}</span></p>`;
}

/** Goals whose suggested spot is a site for one of their stations (not where a trouble gathers). */
const SERVICE_SITE = new Set<GoalId>(['police', 'fire', 'health', 'education']);

/**
 * Time going by, beside the goal's name: a fast clock spent a year or two while a screen
 * was being read. One press pauses it to think (and again goes on at the speed it had).
 */
function timeButton(): string {
  const on = speed > 0;
  const name = ['', '느리게', '보통', '빠르게'][speed] ?? '';
  return `<button type="button" class="mg-time${on ? ' on' : ''}" aria-pressed="${!on}" title="${on ? `시간이 ${name} 흐르는 중 · 눌러서 멈추고 살펴보기 (Space)` : '멈춤 · 눌러서 이어 가기 (Space)'}">${icon(on ? (speed >= 3 ? 'play3' : speed === 2 ? 'play2' : 'play') : 'pause')}<span>${on ? '진행 중' : '멈춤'}</span></button>`;
}

/**
 * A riot takes three police units or more unless it is on a dead-end street (an engine rule):
 * each press of the map sends one, so say so, and warn when the city has fewer to send.
 */
function riotHint(inc: Incident, free: number): string {
  if (!inc.riot) return '';
  return free < 3
    ? ` · 폭동은 경찰차 3대 이상이 있어야 진압됩니다(막다른 길 제외). 지금은 ${free}대뿐이라 경찰서를 더 지어야 합니다`
    : ' · 폭동은 3대 이상 보내야 진압됩니다(막다른 길 제외): 지도에서 그곳을 세 번 누르세요';
}

/** What is happening now on this goal's watch (a fire, a riot): where, and the unit to send, before any plan. */
function incidentBanner(id: GoalId): string {
  const inc = incidents().find((x) => x.goal === id);
  if (!inc) return '';
  const free = city.freeUnits(inc.goal);
  return `<section class="mg-alert">${icon(inc.goal === 'fire' ? 'flame' : 'megaphone')}<span><b>${inc.title}</b>
    <small>${free ? `출동 가능 ${free}대: 출동을 누르고 지도에서 그곳을 누르세요${riotHint(inc, free)}` : `보낼 ${inc.goal === 'fire' ? '소방차' : '경찰'}가 없습니다: ${inc.goal === 'fire' ? '소방서' : '경찰서'}부터 지으세요`}</small></span>
    <span class="advice-acts"><button type="button" class="advice-view" data-spot="${inc.at.join(',')}" title="지도에서 그곳 보기">보기</button>${free ? `<button type="button" class="advice-view act-now" data-act="${inc.tool}" title="출동 도구 들기">${icon(inc.goal === 'fire' ? 'flame' : 'shield')}출동</button>` : ''}</span></section>`;
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

/**
 * One advisor's word under 진단, with its 보기 and fix buttons. The word 추천 조치 already leads with
 * is not said twice: its first sentence stands at the top of the screen, so only the rest is read here.
 */
function diagnosis(a: ReturnType<typeof adviceFor>[number], lead: ReturnType<typeof guideSaid>): string {
  let text = a.code === 'waterShort' && waterApart() ? APART : ADVICE_TEXT[a.code]?.(a.value ?? 0, a.type) ?? a.code;
  const echo = a === lead.worst && !!lead.said && text.startsWith(lead.said);
  if (echo) text = text.slice(lead.said.length).trim();
  const more = a.code === 'unemployment' ? jobHint() : a.code === 'abandoned' ? abandonHint() : a.code === 'capRes' ? capHint() : '';
  const acts = a.at || fixButton(a) ? `<span class="advice-acts">${a.at ? `<button type="button" class="advice-view" data-at="${a.at.join(',')}" title="지도에서 그곳 보기">보기</button>` : ''}${fixButton(a)}</span>` : '';
  if (echo && !text && !more && !acts) return '';
  const level = a.level === 'bad' ? 'bad' : a.level === 'good' ? 'good' : 'neutral';
  return `<p class="advice ${level}${echo ? ' echo' : ''}">${icon(a.level === 'bad' ? 'alert' : a.level === 'good' ? 'award' : 'info', 'adv-i')}<b class="adv-who">${ADVISOR_NAME[a.advisor]}</b> ${echo ? `<span class="adv-echo" title="${escapeHtml(lead.said)}">위의 문제:</span> ` : ''}${text}${more}${acts}</p>`;
}

/** The goal's panel. */
function goalHtml(id: GoalId): string {
  const g = GOALS[id];
  const s = goalStatus(id);
  const list = facilities(g);
  const view = currentView();
  const advice = adviceFor(id).filter((a) => a.level !== 'good' || adviceFor(id).every((x) => x.level === 'good'));
  const lead = guideSaid(id);
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
  return `<header class="mg-head">
      <button type="button" class="icon-btn mg-back" title="도시로 돌아가기 (Esc)" aria-label="도시로 돌아가기">${icon('back')}</button>
      <h2 title="${g.aim}">${icon(g.icon)}${g.name}</h2>${timeButton()}${!s.tone && !readStats().population && !city.state.buildings.size
      ? '<span class="chip" title="아직 사는 사람이 없습니다: 판단은 도시가 생긴 뒤에">시작 전</span>' // (an empty map isn't "good")
      : `<span class="chip ${s.tone || 'good'}">${s.tone === 'bad' ? '조치 필요' : s.tone === 'warn' ? '주의' : '양호'}</span>`}
    </header>
    ${incidentBanner(id)}
    ${guideHtml(id)}
    <div class="mg-metrics">${metrics(id).map(([label, value, tone, n, better, title]) => {
      // How it moved since this screen opened: the result of what was done here, read where it was done.
      const was = baseline.get(label);
      const d = n !== undefined && was !== undefined ? Math.round(n - was) : 0;
      const dir = d && better ? (Math.sign(d) === better ? 'up' : 'down') : '';
      const delta = d ? `<small class="delta ${dir}" title="이 화면을 연 뒤의 변화 (조치 말고도 도시가 저절로 바뀐 몫 포함)">${d > 0 ? '▲' : '▼'} ${withUnit(Math.abs(d), value, label)}</small>` : '';
      return `<div class="mg-m ${tone ?? ''}"${title ? ` title="${escapeHtml(title.trim())}"` : ''}><span>${label}</span><b>${value}</b>${delta}</div>`;
    }).join('')}</div>
    ${usageBar(id)}
    <div class="mg-views" role="group" aria-label="지도 보기">${icon('layers')}${g.views.map(([v, label]) => `<button type="button" class="vchip" data-mg-view="${v}" aria-pressed="${view === v}">${label}</button>`).join('')}</div>
    ${advice.length ? `<section class="mg-sec"><h3>${icon('info')}진단</h3>${advice.map((a) => diagnosis(a, lead)).join('')}</section>` : ''}
    ${id === 'finance' ? financeActions() : ''}
    ${spotLine(id)}
    ${id === 'growth' && $('#demand').innerHTML.trim() ? `<section class="mg-sec mg-rci"><h3>${icon('zones')}구역별 수요 <span class="sec-note">막대가 위로 길수록 수요가 큼</span></h3>${$('#demand').innerHTML.replace('id="demand-detail"', 'class="demand-detail-mg"')}</section>` : ''}
    ${buildActions(g)}
    ${dealActions(id)}
    ${budgetActions(g, list)}
    ${id === 'finance' ? '' : ordinanceActions(g)}
    ${log(id)}
    ${list.length ? `<section class="mg-sec"><h3>${icon('landmark')}시설 ${list.length}곳${allDept ? '<small class="sec-note">부서 예산으로 운영</small>' : ''}</h3><div class="mg-facs">${shown.map((f) => {
      const [line, tone] = facilityLine(f);
      // Each its own budget, a step either way, and what it costs a month (per-building funding).
      const u = city.structureUpkeep(f.id);
      const cost = u ? u.running + u.overcapacity : 0;
      return `<div class="fac ${tone}"><button type="button" class="fac-main" data-fac="${f.id}" title="지도에서 보고 정보 카드 열기"><span class="fac-name">${facName(f)}</span><span class="fac-line">${line}</span>${facBar(f)}</button>
        ${allDept ? '' : deptFunded(f.kind) ? `<span class="fac-fund dept-note" title="이 시설은 부서 예산으로 운영됩니다">부서 예산</span>` : `<span class="fac-fund" title="이 시설의 예산 · 월 §${fmt(cost)}"><button type="button" class="tax-step" data-fund="${f.id}" data-d="-10" aria-label="${STRUCTURE_NAME[f.kind]} 예산 줄이기"${f.funding <= 0 ? ' disabled' : ''}>−</button><span><b>${f.funding}%</b><small>월 §${fmt(cost)}</small></span><button type="button" class="tax-step" data-fund="${f.id}" data-d="10" aria-label="${STRUCTURE_NAME[f.kind]} 예산 늘리기"${f.funding >= FUNDING_MAX(f.kind) ? ' disabled' : ''}>+</button></span>`}</div>`;
    }).join('')}</div>${list.length > 6 ? `<button type="button" class="link mg-more">${allFacilities ? '줄여 보기' : `${list.length - 6}곳 더 보기`}</button>` : ''}</section>` : ''}
    ${g.links?.length ? `<section class="mg-sec mg-links">${g.links.map(([tab, label]) => `<button type="button" class="link" data-mg-tab="${tab}">${label} ${icon('chevronRight')}</button>`).join('')}</section>` : ''}
    `;
}

/** The open goal's tone at the last update (to tell when it comes good). */
let toneSeen: { goal: GoalId | null; lineage: number; tone: Tone } = { goal: null, lineage: -1, tone: '' };
const saidGood = new Map<GoalId, number>();
let saidGoodLineage = -1;

/** What the panel last drew (redrawn only when it would change, and never under a press). */
let drawn = '';
let holding = false;
/** Whether a press in the pane is under way (its panels wait to be redrawn). */
export const paneHeld = () => holding;

/** Redraws the goal's panel with the city as it is now (from updatePanels). */
export function renderGoal(force = false): void {
  if (!active) return;
  refreshBadge();
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
  refreshChip();
  const el = $('#mg-body');
  // A slider in hand (or focused for the arrow keys) is never rebuilt under the player.
  if (!force && (holding || (document.activeElement as HTMLElement | null)?.matches?.('#mg-body input[type=range]'))) return;
  const html = goalHtml(active);
  refreshMarks(active, facilities(GOALS[active])); // (after the screen: its guide picks the site to mark)
  if (!force && html === drawn) return;
  const sel = el.contains(document.activeElement) ? focusKey(document.activeElement) : '';
  drawn = html;
  el.innerHTML = html; // (the policy and the statistics below it are kept: a slider in hand, a graph's pointer)
  if (sel) el.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
}

/** Attributes that pick out a control again after the panel is redrawn. */
const KEYS = ['data-spot', 'data-spot-build', 'data-tray', 'data-act', 'data-kind', 'data-fac', 'data-fund', 'data-d', 'data-mg-ord', 'data-mg-dept', 'data-mg-group', 'data-mg-view', 'data-goal', 'data-mg-tab', 'data-at'];

/** A selector for the focused control inside the goal panel, to give focus back after a redraw ('' if none). */
function focusKey(el: Element | null): string {
  if (!el || !$('#manage').contains(el) || el === $('#manage')) return '';
  const own = KEYS.filter((a) => el.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(el.getAttribute(a)!)}"]`).join('');
  if (own) return `${el.tagName.toLowerCase()}${own}`;
  const cls = ['mg-back', 'mg-more'].find((c) => el.classList.contains(c));
  return cls ? `.${cls}` : '';
}

/** Phones: the pane is a sheet over the map (the same test as the stylesheet's). */
const phone = () => matchMedia('(max-width: 860px)').matches;

/** M: the goal most in need (else the first), or back to the overview when one is open. */
export function toggleUrgentGoal(): void {
  if (active) {
    closeGoal();
    return;
  }
  const rank = { bad: 0, warn: 1, '': 2, good: 2 } as const;
  const id = [...GOAL_ORDER].sort((a, b) => rank[goalStatus(a).tone] - rank[goalStatus(b).tone])[0]!;
  openGoal(id);
}

/** Wires the pane's goal rows and the goal panel (once). */
export function setupGoals(): void {
  // A problem's row, a quality's tile (or an advisor's 해결) opens its goal.
  $('#pane').addEventListener('click', (e) => {
    // 시장 평점: what the residents think, topic by topic (each topic's goal shows its share too).
    // (The polls are kept with 환경·쾌적, the goal that watches the rating.)
    if ((e.target as HTMLElement).closest('[data-open-polls]')) {
      openGoalAt('environment', '#polls', 'mayor'); // (with the rating's own map, not the screen's first view: dirty air)
      return;
    }
    // 다음 보상: the full list of rewards and how far along each is (under 부유층·고급화, with the landmarks).
    if ((e.target as HTMLElement).closest('.sum-next')) {
      openGoalAt('wealth', '#rewards');
      return;
    }
    // A goal screen's 추천 조치: the action it names, taken up (as if pressed below).
    const guide = (e.target as HTMLElement).closest<HTMLElement>('.mg-guide-go');
    if (guide?.dataset.guideKind === 'budget') {
      // A budget raised to 100% (undoable as the sliders are, logged for the result).
      const [what, key] = guide.dataset.guideAct!.split(':') as [string, string];
      if (what === 'dept') {
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
      // An ordinance, enacted as its switch below would (undoable, logged).
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
      const btn = guide.dataset.guideKind === 'best' ? $('#manage').querySelector<HTMLElement>('.act.best')
        : $('#manage').querySelector<HTMLElement>(`.advice-acts [data-act="${guide.dataset.guideAct}"]`);
      btn?.click();
      return;
    }
    // An emergency's card: its goal's screen, with the units ready (as pressed there).
    const next = (e.target as HTMLElement).closest<HTMLElement>('.next-do');
    if (next) {
      const where = next.dataset.nextAt?.split(',').map(Number) as [number, number] | undefined;
      openGoal(next.dataset.next as GoalId, where);
      const kind = next.dataset.nextKind;
      if (kind === 'incident') $('#manage').querySelector<HTMLElement>('.mg-alert [data-act]')?.click();
      const btn = kind === 'best' ? $('#manage').querySelector<HTMLElement>('.act.best')
        : kind === 'fix' ? $('#manage').querySelector<HTMLElement>(`.advice-acts [data-act="${next.dataset.nextAct}"]`) : null;
      btn?.click();
      return;
    }
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-goal]');
    if (row) openGoal(row.dataset.goal as GoalId);
  });
  // A goal from the phone's strip over the map.
  $('#goal-strip').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-strip-more]')) {
      openPane();
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-strip-goal]');
    if (!b) return;
    const id = b.dataset.stripGoal as GoalId;
    openGoal(id, incidents().find((x) => x.goal === id)?.at);
  });
  // A goal named beside a lever elsewhere (an ordinance in the budget sheet): its screen.
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-goal-open]');
    if (!b) return;
    e.preventDefault(); // (inside a label: not its checkbox)
    closeSheet();
    openGoal(b.dataset.goalOpen as GoalId);
  });
  // (The mayor rating answers Enter and Space, as a button does.)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const r = (e.target as HTMLElement).closest?.<HTMLElement>('[data-open-polls]');
    if (!r) return;
    e.preventDefault();
    r.click();
  });
  // The info card's link to the goal a facility or lot belongs to.
  document.addEventListener('click', (e) => {
    // A striking facility's 예산 100%로 (the strike ends with the month).
    const fund = (e.target as HTMLElement).closest<HTMLElement>('#info [data-fund-full]');
    if (fund) {
      const f = city.state.structures.get(Number(fund.dataset.fundFull));
      if (!f) return;
      choice('시설 예산', () => city.setFunding(f.id, 100));
      noteAction(`시설 예산: ${STRUCTURE_NAME[f.kind]} 100%`, `fund:${f.id}`);
      flash(`${STRUCTURE_NAME[f.kind]} 예산을 100%로 올렸습니다 · 다음 달 파업이 끝납니다`, 'info');
      refreshInfo();
      updatePanels();
      return;
    }
    // A full school or hospital's 옆에 … 짓기: one more of its level on the site found beside it.
    const relieve = (e.target as HTMLElement).closest<HTMLElement>('#info [data-relieve]');
    if (relieve) {
      const kind = relieve.dataset.relieveKind as StructureKind;
      const [x, y] = relieve.dataset.relieve!.split(',').map(Number) as [number, number];
      const d = STRUCTURES[kind];
      if (!city.canPlaceStructure(kind, x - ((d.w - 1) >> 1), y - ((d.h - 1) >> 1)).ok) {
        // (Taken meanwhile, or the money ran short: the card finds again, or says why.)
        const short = d.cost - city.state.funds;
        forgetSites();
        refreshInfo();
        flash(short > 0 ? `§${fmt(Math.ceil(short))} 모자랍니다` : '그사이 그 자리에 건물이 들어서 자리를 새로 찾았습니다', 'bad');
        return;
      }
      if (!pickStructure(kind)) return;
      centerOn(x, y, Math.max(6, 24 / Math.max(d.w, d.h)));
      placeAt(x, y);
      refreshInfo();
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
    const b = (e.target as HTMLElement).closest?.<HTMLElement>('[data-spot-build]');
    // (Moving between the button's icon and its words is still on the button: no flicker.)
    const to = (e as PointerEvent | FocusEvent).relatedTarget as Node | null;
    if ((e.type === 'pointerout' || e.type === 'focusout') && b && to && b.contains(to)) return;
    const next = e.type === 'pointerover' || e.type === 'focusin' ? b?.dataset.spotBuild?.split(';') ?? [] : [];
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
  // The clock in the header follows the speed however it was set (Space, the status bar, a dialog).
  window.addEventListener('speedchange', () => {
    const b = el.querySelector('.mg-time');
    if (!b) return;
    const focused = document.activeElement === b;
    b.outerHTML = timeButton();
    if (focused) el.querySelector<HTMLElement>('.mg-time')?.focus();
  });
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.mg-back')) {
      closeGoal();
      return;
    }
    if (t.closest('.mg-time')) {
      chooseSpeed(speed > 0 ? 0 : runningSpeed);
      return;
    }
    const view = t.closest<HTMLElement>('[data-mg-view]');
    if (view) {
      showGoalView(active!, view.dataset.mgView!);
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
      // Phones: the pane steps aside for the map; the goal's chip brings it back.
      if (phone()) {
        closePane();
        flash(`${kind ? STRUCTURE_NAME[kind] : toolName(TOOLS.find((x) => x.id === act.dataset.act)!)}: 지도에서 놓을 곳을 고르세요 · 위의 ${GOALS[active!].name} 칩으로 돌아옵니다`, 'info');
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
      const d = STRUCTURES[kind];
      const free = sites.every(([sx, sy]) => city.canPlaceStructure(kind, sx - ((d.w - 1) >> 1), sy - ((d.h - 1) >> 1)).ok);
      const short = d.cost * sites.length - city.state.funds;
      if (!free || short > 0) {
        forgetSites();
        renderGoal(true);
        flash(short > 0 ? `§${fmt(Math.ceil(short))} 모자랍니다` : '그사이 그 자리에 건물이 들어서 추천 자리를 새로 찾았습니다', 'bad');
        return;
      }
      if (!pickStructure(kind)) return;
      // Close enough to see what went up: a plant's 4×4 at 6px a tile, a 1×1 park nearer (at 6 it was a dot).
      centerOn(x, y, Math.max(6, 24 / Math.max(d.w, d.h)));
      placeAt(x, y);
      // (A facility handed out by a suggestion goes down once placed: taken up again for the next site.)
      for (const [sx, sy] of sites.slice(1)) if (pickStructure(kind)) placeAt(sx, sy);
      if (phone()) closePane();
      updatePanels();
      return;
    }
    const spot = t.closest<HTMLElement>('[data-spot]');
    if (spot) {
      const [x, y] = spot.dataset.spot!.split(',').map(Number);
      if (phone()) closePane();
      centerOn(x!, y!, 6);
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
    // 적자 줄이기: the lever applied (undoable, logged).
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
    const tab = t.closest<HTMLElement>('[data-mg-tab]');
    if (tab) {
      showTab(tab.dataset.mgTab as 'budget' | 'region');
      return;
    }
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
  // The map's chip: back to the goal's panel, or out of it.
  // (Map-only on a wide screen: the pane comes back by leaving that view.)
  $('#manage-chip-label').onclick = () => ($('#app').classList.contains('focus') && !phone() ? toggleFocus() : openPane());
  $('#manage-chip-close').onclick = () => closeGoal();
}

