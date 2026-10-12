// The side panel refresh: demand, budget, departments, loans and advisor notices.

import { DEV_TYPES, GROWTH_CODES, STRUCTURES, ZONES, type PollTopic, type StructureKind } from '@web-city/engine';
import { icon } from './icons';
import { chooseSpeed, refreshTaxes, showOverlay } from './controls';
import { goalOfAdvice, type GoalId, GOALS } from './goals';
import { capped as atCap, deptEmpty, deptFunded, newReadings, readStats } from './readings';
import { active, autoPause, openGoal, goalToldAt, paneHeld, problemsHtml, refreshStrip, renderGoal, watchGoals } from './manage';
import { buildOrdinances, ordinanceMonth, ordinanceSignature, refreshInfo, setOrdinanceMonth } from './info';
import { ko } from './messages';
import { renderMySims } from './mysims';
import { ABANDON_NAME, ADVICE_TEXT, plainCodes, ADVISOR_NAME, CRIME_NAME, EDGE_NAME, ORDINANCE_NAME, POLL_NAME, REPORT_NAME, RESOURCE_NAME, STRUCTURE_NAME, TYPE_NAME, WEALTH_NAME, TYPE_SHORT } from './names';
import { renderOnboarding } from './onboarding';
import { renderNeighbours } from './region';
import { TYPE_COLOR } from './render';
import { GROWTH_LABEL } from './views';
import { checkLeft, checkText, renderAges, renderPolls, renderRewards, rewardShare } from './reports';
import { centerOn, changeKey, city, cityGeneration, graphs, redraw, speed } from './state';
import { categoryOf, chosen, openTray, pickStructure, refreshStructureLists, selectTool, structureStat, TOOLS } from './tools';
import { renderUdi, watchMissions } from './udi';
import { journal, type Notice } from './journal';
import { toast } from './toast';
import { closeSheet, paneShown, revealMap, sheetShown, showTab, type Tab } from './tabs';
import { $, escapeHtml, firstSentence, flash, fmt, josa, landfillMonths, landfillSpan, stoppedNote, touchFirst } from './util';
import { choice } from './undo';

/** Last month's crimes by kind, for a tooltip. */
export function crimeKinds(byType: Record<string, number> | undefined): string {
  const rows = Object.entries(byType ?? {}).sort((a, b) => b[1] - a[1]);
  return rows.length ? '\n' + rows.map(([k, v]) => `${CRIME_NAME[k] ?? k} ${v}`).join(' · ') : '';
}

// The panel is rebuilt often, so one listener serves every 보기 button.
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.advice-view');
  if (!b) return;
  // A reward or deal from the news: its building in hand.
  if (b.dataset.build) {
    revealMap();
    pickStructure(b.dataset.build as StructureKind);
    return;
  }
  if (b.dataset.tool) {
    // Pick the tool (a 'tool:kind' names the facility too), and open its cards for the kinds to choose from.
    const [id, kind] = b.dataset.tool.split(':') as [string, StructureKind | undefined];
    if (kind && city.isUnlocked(kind)) chosen[id] = kind;
    revealMap(); // the map is where it's used (on a phone the pane over it took the next drag)
    selectTool(id);
    // A facility's kinds are chosen on its cards; a road, pipe or zone is drawn at once (the tray would cover the map).
    if (TOOLS.find((t) => t.id === id)?.kind === 'structure' && !kind) openTray(categoryOf(id));
    return;
  }
  if (b.dataset.sheet) {
    showTab(b.dataset.sheet as Tab);
    return;
  }
  if (b.dataset.clearRubble !== undefined) {
    const res = choice('잔해 치우기', () => city.clearRubble());
    flash(res.ok ? `잔해 ${fmt(res.tiles)}칸을 치웠습니다 · −§${fmt(res.cost)}` : ko(res.message ?? ''), res.ok ? 'info' : 'bad');
    city.refreshIfDirty();
    redraw();
    updatePanels();
    return;
  }
  revealMap();
  if (b.dataset.overlay) showOverlay(b.dataset.overlay);
  if (b.dataset.at) {
    const [x, y] = b.dataset.at.split(',').map(Number);
    centerOn(x!, y!);
  }
});

/** A notice's offer still to take up: unlocked, with a placement left (a reward built once says only what it was). */
const buildable = (n: Notice): boolean => !!n.build && city.isUnlocked(n.build) && city.placementsLeft(n.build) > 0;

/** Whether the advice list shows every message, not the first few. */
let adviceAll = false;
/** Advice shown before 더 보기 (the card sits near the top of the pane, above the RCI meter). */
const ADVICE_SHOWN = 5;
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest?.('.advice-more')) return;
  adviceAll = !adviceAll;
  updatePanels();
});

/** Whether the per-type demand list is open (the panel is rebuilt often). */
let demandOpen = false;
document.addEventListener('toggle', (e) => {
  // (The growth screen shows a copy: its toggle counts too.)
  if ((e.target as HTMLElement).id === 'demand-detail' || (e.target as HTMLElement).classList?.contains('demand-detail-mg')) demandOpen = (e.target as HTMLDetailsElement).open;
}, true);

/** The per-type demand row spelled out under it (its tooltip, which touch screens never show). */
let demandRow: string | null = null;

// An RCI bar opens (or closes) the per-type list under it; a type's row its details.
const toggleDemand = (e: Event) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('.demand-row');
  if (row) {
    demandRow = demandRow === row.dataset.type ? null : row.dataset.type!;
    updatePanels();
    return;
  }
  if (!(e.target as HTMLElement).closest('.rci-col')) return;
  const d = document.querySelector<HTMLDetailsElement>('#demand-detail');
  if (d) d.open = demandOpen = !d.open; // remembered now: the panel may rebuild before 'toggle' fires
};
document.addEventListener('click', toggleDemand);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    if ((e.target as HTMLElement).closest?.('.rci-col, .demand-row')) {
      e.preventDefault();
      e.stopPropagation(); // not the map's Space (pause)
      toggleDemand(e);
    }
  }
});

/** The city's stages by residents, as far as it has come (the scoreboard's headline). */
const STAGES: [number, string][] = [
  [0, '마을'], [1_000, '작은 읍'], [5_000, '읍'], [10_000, '소도시'], [25_000, '도시'],
  [50_000, '중견 도시'], [100_000, '대도시'], [250_000, '광역 도시'], [500_000, '거대 도시'], [1_000_000, '메트로폴리스'],
];

/** Population milestones announced as they are passed (not for the level a city opens at): the city's stages. */
let milestoneCity: unknown = null;
let milestone = 0;

function checkMilestone(population: number): void {
  const reached = STAGES.filter(([m]) => population >= m).at(-1)?.[0] ?? 0;
  if (milestoneCity !== city) {
    milestoneCity = city;
    milestone = reached;
    return;
  }
  if (reached > milestone) {
    const text = `인구 ${fmt(reached)}명을 넘어 ${city.state.name}${josa(city.state.name, '이', '가')} '${STAGES.find(([m]) => m === reached)![1]}'${josa(STAGES.find(([m]) => m === reached)![1], '이', '가')} 되었습니다!`;
    pushNotice({ text, until: city.state.day + 90 });
    toast(text, 'gold'); // (in the stage's gold, with its trophy: the reward the pane's headline counts toward)
  }
  milestone = Math.max(milestone, reached);
}

/** A short report on the year just ended, when a new one starts. */
let yearCity: unknown = null;
let lastYear = 0;

function checkNewYear(year: number): void {
  if (yearCity !== city) {
    yearCity = city;
    lastYear = year;
    return;
  }
  if (year <= lastYear) return;
  lastYear = year;
  const h = city.state.history;
  const now = h.at(-1);
  // A year back; in a city's first year, its start (no buildings, the starting funds).
  // (A city that began empty: the sample city's first record already has its scripted town.)
  const fresh = h[0]?.month === 1 && h.length < 13 && h[0].population < 100;
  const then = h.at(-13) ?? (fresh ? { population: 0, funds: city.cfg.difficulty[city.state.difficulty].startingFunds } : h[0]);
  if (!now || !then) return;
  const sign = (v: number, unit = '') => `${v >= 0 ? '+' : '−'}${unit}${fmt(Math.abs(v))}`;
  // The rating's move over the year, and what residents mind most now (the year's report said a number, not why).
  // (Only against a record a year back: a first year's start is an empty town's rating.)
  const yearAgo = h.at(-13);
  const mr = yearAgo ? Math.round(now.mayorRating) - Math.round(yearAgo.mayorRating) : 0;
  const polls = now.population > 0 ? Object.entries(city.opinionPolls()) as [PollTopic, { approve: number }][] : [];
  const sore = polls.length ? polls.reduce((a, b) => (b[1].approve < a[1].approve ? b : a)) : null;
  const text = `${year - 1}년 결산: 인구 ${sign(now.population - then.population)} · 자금 ${sign(now.funds - then.funds, '§')} · 시장 평점 ${Math.round(now.mayorRating)}${mr ? ` (${sign(mr)})` : ''}${
    sore && sore[1].approve < 0.6 ? ` · 가장 큰 불만 ${POLL_NAME[sore[0]]} (만족 ${Math.round(sore[1].approve * 100)}%)` : ''}`;
  // A year the city shrank or lost money is no good news; a little spent from a deep purse is only worth noting.
  const worse = now.population < then.population * 0.99 || now.funds < 0 || now.funds < then.funds - Math.max(1000, Math.abs(then.funds) * 0.1);
  const mild = !worse && (now.population < then.population || now.funds < then.funds);
  pushNotice({ text, until: city.state.day + 60, ...(worse ? { warn: true } : mild ? { info: true } : {}) });
  toast(text, worse ? 'bad' : mild ? 'info' : 'good');
}

/**
 * The reward nearest to being earned, under the city's headline figures: what it is,
 * how far along (each condition counted by how much of it is met), what is left.
 * A goal further off than the next month's problems, worked out once a month.
 */
let rewardSeen: { key: string; html: string } | null = null;
function nextReward(): string {
  const key = `${cityGeneration}|${Math.floor(city.state.day / 30)}|${city.state.unlocked.length}`;
  if (rewardSeen?.key === key) return rewardSeen.html;
  const best = city.rewardProgress()
    .filter((r) => r.checks.length && !r.checks.every((c) => c.met))
    .map((r) => ({ ...r, share: rewardShare(r.checks) }))
    .sort((a, b) => b.share - a.share)[0];
  // What is still missing, in a line (all of it in the tooltip).
  const left = best ? best.checks.filter((c) => !c.met).map(checkLeft) : [];
  const leftFull = best ? best.checks.filter((c) => !c.met).map(checkText) : [];
  // What it gives, for wanting it (its figure, as the tray shows it).
  const gives = best ? structureStat(best.kind) : '';
  const html = !best || !city.state.buildings.size ? '' : `<button type="button" class="reward sum-next" title="${escapeHtml(`보상 ${STRUCTURE_NAME[best.kind]}: ${plainCodes(best.description)}${leftFull.length ? ` · 지금 ${leftFull.join(' · ')}` : ''} · 눌러서 보상 진행 모두 보기`)}">
    <span class="rw-icon">${icon('award')}</span>
    <span class="rw-name"><small class="rw-label">다음 보상</small><b>${STRUCTURE_NAME[best.kind]}${city.isUnlocked(best.kind) ? ' (다음 단계)' : ''}</b>${gives ? `<small>${gives}</small>` : ''}</span><span class="rw-pct">${Math.round(best.share * 100)}%${icon('chevronRight', 'rw-go')}</span>
    <span class="rw-bar"><i style="width:${(best.share * 100).toFixed(1)}%"></i></span>
    <span class="rw-left">${left.length ? `<span>열리려면</span> ${escapeHtml(left.join(' · '))}` : '이번 달에 열립니다'}</span></button>`;
  rewardSeen = { key, html };
  return html;
}

/**
 * 점수판: what the city has become — its stage by name, the residents that earned it,
 * and how close the next stage is (a bar that fills toward it).
 */
function scoreboard(population: number, trend: string): string {
  const i = STAGES.filter(([n]) => population >= n).length - 1;
  const [from, name] = STAGES[i]!;
  const next = STAGES[i + 1];
  const share = next ? (population - from) / (next[0] - from) : 1;
  return `<div class="summary score" title="도시 단계는 주거 인구로 매깁니다: ${STAGES.map(([n, t]) => `${t} ${fmt(n)}`).join(' · ')}">
    <p class="score-stage">${icon('trophy')}<b>${name}</b><span>${i + 1}단계</span></p>
    <p class="score-main"><span class="sum-value">${fmt(population)}</span><span class="score-unit">명</span>${trend}</p>
    <span class="score-bar"><i style="width:${(share * 100).toFixed(1)}%"></i></span>
    <p class="score-next">${next ? `<span>다음 단계 <b>${next[1]}</b>까지 ${fmt(next[0] - population)}명</span><span class="score-pct">${Math.floor(share * 100)}%</span>` : '<span>가장 높은 단계에 올랐습니다</span>'}</p></div>`;
}

/** Residents, workers, jobs and the jobless by wealth (from the census). */
function renderWealth(): void {
  const c = city.census;
  const sig = [c.residents, c.workers, c.jobsByWealth, c.unemployed, ...c.workersByEq].map((v) => v.map(Math.round).join()).join('|');
  const el = $('#wealth');
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  const rows = WEALTH_NAME.map((w, k) => {
    const jobless = c.unemployed[k]!;
    return `<tr><td>${w}</td><td>${fmt(c.residents[k]!)}</td><td>${fmt(c.workers[k]!)}</td><td>${fmt(c.jobsByWealth[k]!)}</td>
      <td class="${jobless > c.workers[k]! * 0.1 ? 'neg' : ''}">${fmt(jobless)}</td></tr>`;
  }).join('');
  // (The notes fold under 설명: two paragraphs under the table every time; kept open across redraws.)
  const open = el.querySelector<HTMLDetailsElement>('details.legend-more')?.open ? ' open' : '';
  el.innerHTML = `<table class="wealth-table"><thead><tr><th>소득</th><th>주민</th><th>일하는 사람</th><th>일자리</th><th>실업</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <details class="legend-more"${open}><summary>설명 · 학력</summary>
    <p class="legend">일자리는 그 소득 수준의 일꾼을 원하는 자리로, 공공시설(학교·병원 등) 일자리도 셉니다(위쪽 '일자리'는 상업·산업만). 실업이 많으면 그 소득에 맞는 상업·산업이 필요합니다(이웃 도시로 통근하는 사람은 실업이 아님).</p>
    ${eqMix(c.workersByEq)}</details>`;
}

/** The workforce's schooling by wealth (EQ bands 1–4): offices and high-tech want the upper bands. */
function eqMix(byEq: readonly (readonly number[])[]): string {
  const rows = WEALTH_NAME.map((w, k) => {
    const row = byEq[k]!;
    const total = row.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return '';
    const bands = row.map((v, b) => [b + 1, Math.round((v / total) * 100)] as const).filter(([, p]) => p > 0);
    return `<b>${w}</b> ${bands.map(([b, p]) => `${b}단계 ${p}%`).join(', ')}`;
  }).filter(Boolean);
  return rows.length ? `<p class="legend">일하는 사람의 학력(1~4단계, 4가 가장 높음): ${rows.join(' · ')}<br>오피스와 첨단 산업은 높은 단계의 일꾼을 원합니다(학교·도서관으로 올라감).</p>` : '';
}

/** Buildings by class: how many, how tall, how many abandoned, and the zone land around them. */
let buildingsKey = '';

function renderBuildings(): void {
  const key = changeKey();
  if (key === buildingsKey) return;
  buildingsKey = key;
  const s = city.state;
  const cls = { R: '주거', C: '상업', I: '산업', A: '농업' } as const;
  const acc = Object.fromEntries(Object.keys(cls).map((k) => [k, { n: 0, stages: 0, top: 0, empty: 0, zoned: 0, free: 0 }])) as Record<keyof typeof cls, { n: number; stages: number; top: number; empty: number; zoned: number; free: number }>;
  for (const b of s.buildings.values()) {
    const t = b.type ?? b.origType;
    const k = (t === 'IA' ? 'A' : t[0]) as keyof typeof cls;
    const a = acc[k];
    a.n++;
    a.stages += b.stage;
    a.top = Math.max(a.top, b.stage);
    if (!b.type) a.empty++;
  }
  const growth = growthForPane();
  for (let i = 0; i < s.zone.length; i++) {
    const z = ZONES[s.zone[i]!]!;
    const k = (z === 'A' ? 'A' : z[0]) as keyof typeof cls;
    if (!(k in cls) || s.net[i]) continue;
    acc[k].zoned++;
    if (growth[i] && !s.occupant[i]) acc[k].free++;
  }
  const sig = JSON.stringify(acc);
  const el = $('#buildings');
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  const rows = (Object.keys(cls) as (keyof typeof cls)[]).filter((k) => acc[k].n || acc[k].zoned).map((k) => {
    const a = acc[k];
    return `<tr><td>${cls[k]}</td><td>${fmt(a.n)}</td><td>${a.n ? (a.stages / a.n).toFixed(1) : '—'}</td><td>${a.top || '—'}</td>
      <td class="${a.empty ? 'neg' : ''}">${fmt(a.empty)}</td><td>${fmt(a.zoned)} / ${fmt(a.free)}</td></tr>`;
  }).join('');
  el.innerHTML = rows ? `<table class="wealth-table"><thead><tr><th></th><th>건물</th><th>평균 단계</th><th>최고</th><th>버려짐</th><th>구역 칸 / 빈 칸</th></tr></thead>
    <tbody>${rows}</tbody></table>` : '<p class="muted">구역을 지정하면 표시됩니다.</p>';
}

/** The RCI meter's classes: letter, name and zone colour. */
const RCI_CLASSES = [['R', '주거', 'var(--zone-r)'], ['C', '상업', 'var(--zone-c)'], ['I', '산업', 'var(--zone-i)']] as const;

/**
 * SC4's RCI meter for one class: its strongest demand (or weakest, when none is positive),
 * whether its cap holds Sims back, and for industry whether farms are what is wanted.
 */
export function classDemand(k: 'R' | 'C' | 'I'): { v: number; capped: boolean; farms: boolean; factories: number } {
  const dem = city.demand;
  const vals = DEV_TYPES.filter((t) => t[0] === k).map((t) => dem.demand[t]);
  // Sims want in but the class's cap holds them back (the bar alone would read as no demand).
  // (By the cap test the rest of the pane uses.)
  const capped = DEV_TYPES.some((t) => t[0] === k && t !== 'IA' && atCap(t) && dem.raw[t] > 0);
  // Strongest demand, else weakest; a capped class reads 0 rather than another type's surplus.
  const v = Math.max(...vals) > 0 ? Math.max(...vals) : capped ? 0 : Math.min(...vals);
  // The I bar counts farms too: say when they are what's wanted.
  const farms = k === 'I' && v > 0 && dem.demand.IA >= v;
  // Only farms: an industrial zone would stay empty (farms grow on 농업 zones).
  const factories = Math.max(dem.demand.ID, dem.demand.IM, dem.demand.IHT);
  return { v, capped, farms, factories };
}

/** The RCI meter in small, beside 개발·수요's figure on the watch list: three bars up (wanted) or down (surplus). */
export function rciMini(): string {
  const bars = RCI_CLASSES.map(([k, label]) => {
    const { v, capped } = classDemand(k);
    const h = Math.min(1, Math.sqrt(Math.abs(v) / 1000)); // (the RCI card's scale: full at ±1,000)
    return `<i class="k-${k.toLowerCase()}${v < 0 ? ' neg' : ''}${capped ? ' cap' : ''}" style="--h:${(h * 100).toFixed(0)}%" title="${label} ${v >= 1 ? `+${fmt(Math.round(v))}` : fmt(Math.round(v))}${capped ? ' · 상한' : ''}"></i>`;
  }).join('');
  return `<span class="rci-mini" aria-hidden="true">${bars}</span>`;
}

/** Impeachment stops the game: say so once, with what to do. */
let impeachedCity: unknown = null;

export function updatePanels(): void {
  newReadings();
  refreshInfo();
  const st = city.stats();
  if (st.impeached && impeachedCity !== city) {
    impeachedCity = city;
    toast(`시장이 탄핵되어 시뮬레이션이 멈췄습니다. 되돌리기${touchFirst() ? '' : '(Ctrl+Z)'}·저장 불러오기·새 도시로 다시 시작하세요.`, 'bad');
  }
  // The sheets' sections and a goal's statistics render only while shown (on a big map
  // they are costly); opening one brings it up to date (the 'sheet-open' event).
  const goal = paneShown() ? active : null;
  const budget = goal === 'finance';
  if (goal === 'wealth') renderWealth();
  if (goal === 'growth') renderBuildings();
  // Milestones by the monthly record (the live count swings within a month: a passing peak isn't a milestone).
  checkMilestone(city.state.history.at(-1)?.population ?? 0);
  checkNewYear(st.date.year);
  const d = st.date;
  // Change since the last monthly record (the end of last month), shown when there is one.
  const trend = (key: 'population' | 'jobs' | 'mayorRating', now: number) => {
    const prev = city.state.history.at(-1)?.[key];
    const delta = prev === undefined ? 0 : now - prev;
    return Math.abs(delta) >= 1 ? `<span class="k-sub ${delta < 0 ? 'neg' : 'pos'}">${delta < 0 ? '▼' : '▲'}${fmt(Math.abs(delta))}</span>` : '';
  };
  // Always a word with the arrow (a bare ≋ → read as a glyph puzzle).
  const wind = `바람 ${'→↘↓↙←↖↑↗'[city.state.wind.dir]}${city.state.wind.strength > 0.5 ? ' 강풍' : ''}`;
  $('#city-title').textContent = city.state.name;
  const dateEl = $('#sb-date');
  const label = `${d.year}년 ${d.month}월`;
  // A new month eases in; a hairline under the date fills as the month goes by (time otherwise jumped month to month).
  if (dateEl.textContent !== label) {
    dateEl.textContent = label;
    dateEl.classList.remove('turned');
    void dateEl.offsetWidth;
    dateEl.classList.add('turned');
  }
  dateEl.style.setProperty('--month-pct', `${((city.state.day % 30) / 30) * 100}%`);
  $('#sb-wind').innerHTML = `${icon('wind')}<span>${wind}</span>`;
  // The wind matters where fire spreads: in sight in a gale or while something burns, else out of the way.
  $('#sb-wind').hidden = !(city.state.wind.strength > 0.5 || city.state.fires.length || city.state.treeFires.length);
  // (The status bar keeps the date and the clock: population and money are read in the city pane.)
  // The advisors first: the watch list reads their latest word (a row lagged an update behind).
  const adv = advice();
  watchGoals(); // a goal turning to 조치 필요 may stop the clock; an action's result is told
  flushAlarms(); // then the advisors' own alarms, those whose goal wasn't just told
  watchMissions(); // a mission newly open is told (and kept in 소식)
  // The pane is redrawn often: keep keyboard focus on the row it was on.
  const focused = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>('#status [data-goal]')?.dataset.goal;
  // Only when it changed, not under a press (a row rebuilt between press and release lost the click),
  // and not while a goal's screen hides it.
  // (A fire or a riot has its own card under 해결할 문제, with the unit to send: no chip says it again.)
  const alerts = st.impeached || st.power.blackedOut ? `<div class="chips alerts">
      ${st.power.blackedOut ? `<button type="button" class="chip bad" data-goal="power" title="전력이 모자라 돌아가며 끊기는 건물 · 눌러서 전력 화면">${icon('zap')}정전 ${fmt(st.power.blackedOut)}채${icon('chevronRight', 'chip-go')}</button>` : ''}
      ${st.impeached ? `<span class="chip bad">${icon('alert')}탄핵되었습니다</span>` : ''}</div>` : '';
  // (Fixed role, see CLAUDE.md: the pane's overview motivates — the reward ahead, the losses to avoid —
  // and monitors; what to do is told on each area's screen.)
  // The city (its size with the next reward under it, then money, jobs and rating), the one thing
  // to do now, and how every area stands (the troubled ones marked and counted).
  const bare = !city.state.buildings.size && !st.jobs; // (a bare map: no 0s to read)
  const statusHtml = active ? '' : `
    <section class="card city-sum" aria-label="도시">${scoreboard(st.population, trend('population', st.population))}${bare ? '' : nextReward()}</section>
    ${problemsHtml(alerts, { jobs: st.jobs, jobsTrend: trend('jobs', st.jobs), rating: st.mayorRating, ratingTrend: trend('mayorRating', st.mayorRating) })}`;
  if (statusHtml && statusHtml !== lastStatus && !paneHeld()) {
    lastStatus = statusHtml;
    $('#status').innerHTML = statusHtml;
    if (focused) $('#status').querySelector<HTMLElement>(`[data-goal="${focused}"]`)?.focus({ preventScroll: true });
  }
  renderGoal();
  refreshStrip();
  const dem = city.demand;
  // SC4's RCI meter: each class shows its strongest demand (or weakest, when none is positive).
  const summary = RCI_CLASSES.map(([k, label, color]) => {
    const { v, capped, farms, factories } = classDemand(k);
    const h = Math.min(50, Math.sqrt(Math.abs(v) / 1000) * 50); // full at the ±1,000 cap
    return `<div class="rci-col" role="button" tabindex="0" title="${label}: 가장 큰 수요 지수 ${fmt(Math.round(v))} (−1,000~+1,000)${capped ? ' · 수요 상한에 막힘' : ''} · 눌러서 유형별 수요 보기">
      <div class="rci-bar"><div class="rci-fill" style="${v >= 0 ? `bottom:50%` : `top:50%`};height:${h}%;background:${color}"></div></div>
      <span class="rci-label">${label}</span><span class="rci-value">${signed(v)}</span>${capped ? `<span class="rci-cap">${icon('lock')}상한</span>` : farms ? `<span class="rci-note" title="${factories > 0 ? `공장 수요 지수 ${fmt(Math.round(factories))}` : '공장 수요 없음: 산업 구역은 비어 있게 됩니다. 농업 구역을 지정하세요'}">${factories > 0 ? '농업' : '농업만'}</span>` : ''}</div>`;
  }).join('');
  const demandHtml = `<div class="rci">${summary}</div>
    <details id="demand-detail" ${demandOpen ? 'open' : ''}><summary>유형별 수요·실업·교육·건강</summary>` + DEV_TYPES.map((t) => {
    const v = dem.demand[t];
    const w = (Math.abs(v) / 1000) * 50;
    const left = v >= 0 ? 50 : 50 - w;
    const capText = Number.isFinite(dem.cap[t]) ? `상한 ${fmt(dem.capPopulation[t])} / ${fmt(dem.cap[t])}` : '상한 없음';
    const unit = t[0] === 'R' ? '명' : '개 일자리';
    const gap = dem.raw[t] >= 0 ? `모자람 ${fmt(dem.raw[t])}${unit}` : `남음 ${fmt(-dem.raw[t])}${unit}`;
    const detail = `${TYPE_NAME[t]} · 수요 지수 ${fmt(Math.round(v))} · ${gap} · ${capText}`;
    return `<div class="demand-row" role="button" tabindex="0" data-type="${t}" aria-expanded="${demandRow === t}" title="${detail}">
      <span class="label">${TYPE_SHORT[t]}</span>
      <div class="bar"><div class="fill" style="left:${left}%;width:${w}%;background:${TYPE_COLOR[t]}"></div></div>
      <span class="value">${signed(v)}</span></div>${demandRow === t ? `<p class="legend g-detail">${detail}</p>` : ''}`;
  }).join('') + `<p class="legend">중립 세율 ${dem.neutralTax.toFixed(1)}% · 실업 ${byWealth(city.census.unemployed.map(fmt))}<br>
    평균 교육 지수 ${byWealth(st.eq)} · 건강 지수 ${byWealth(st.hq)} · 노동 인구 ${Math.round(st.workforceFraction * 100)}%<br>
    ${capRelief()}</p></details>
    ${emptyZones()}`;
  if (demandHtml !== lastDemand && !paneHeld()) {
    lastDemand = demandHtml;
    $('#demand').innerHTML = demandHtml;
  }
  // Advice has a card of its own near the top (below the RCI meter it sat 1,800px down the pane).
  if (!paneHeld() && adv !== lastAdvice) {
    lastAdvice = adv;
    $('#advice').innerHTML = adv;
    $('#advice-card').hidden = !adv;
  }
  refreshStructureLists();
  if (goal) graphs.update(city.state.history);
  // Ordinances' costs and requirements change with the city (population, a
  // new police station): rebuild the list when either does, paused or not.
  const ordinanceSig = ordinanceSignature();
  if (budget && ordinanceSig !== ordinanceMonth) {
    setOrdinanceMonth(ordinanceSig);
    buildOrdinances();
  }

  // Last month's books are read under 재정; what changes them is in the policy sheet.
  if (goal === 'finance') {
    const b = city.state.lastBudget;
    $('#budget').innerHTML = b ? budgetTable(b) : '<p class="muted">첫 달이 지나면 표시됩니다.</p>';
  }
  if (budget) {
    // (The ordinances fold under one line: thirty switches, mostly off, between the rates and the books.)
    const on = city.state.ordinances.length;
    $('#ord-count').textContent = on ? `${on}개 시행 중` : '';
    renderTaxMood();
    renderLoans();
    renderDepartments();
  }
  if (sheetShown('region')) renderNeighbours();
  if (sheetShown('sims')) {
    renderMySims();
    renderUdi();
  }
  if (goal === 'environment') renderPolls();
  if (goal === 'wealth') renderRewards();
  if (goal === 'growth' || goal === 'education') renderAges();
  renderOnboarding();
}
document.addEventListener('sheet-open', () => updatePanels());

type Budget = NonNullable<typeof city.state.lastBudget>;

/** Last month's budget: income and spending lines, each with a bar of its share. */
function budgetTable(b: Budget): string {
  // [label, signed amount, sub-line of income, tooltip, shown even at 0]
  const rows: [string, number, boolean, string, boolean][] = [];
  const add = (label: string, v: number | undefined, always = false, sub = false, title = '') => {
    if (always || Math.abs(v ?? 0) >= 0.5) rows.push([label, v ?? 0, sub, title, always]);
  };
  add('수입 합계', b.income, true);
  for (const [k, name] of [['R', '주거'], ['C', '상업'], ['I', '산업']] as const) {
    const types = DEV_TYPES.filter((t) => t[0] === k);
    const sum = types.reduce((a, t) => a + b.taxByType[t], 0);
    const parts = types.filter((t) => b.taxByType[t] > 0.5).map((t) => `${TYPE_NAME[t]} §${fmt(b.taxByType[t])}`).join(' · ');
    add(`${name}세`, sum, false, true, parts);
  }
  add('대중교통 요금·통행료', b.fares, false, true);
  add('사업 거래 수입', b.dealIncome, false, true);
  add('이웃 거래 수입', b.neighbourIncome, false, true);
  add('조례 수입 (도박)', b.ordinanceIncome, false, true);
  add('지출 합계', -b.expenses, true);
  add('도로 유지비', -b.roadUpkeep, true, true);
  add('대중교통 (선로·역)', -b.transitUpkeep, false, true);
  add('전력 (발전소·송전선)', -(b.powerUpkeep ?? 0), true, true);
  add('수도 (펌프·관)', -(b.waterUpkeep ?? 0), true, true);
  add('위생 (매립·수거)', -(b.garbageUpkeep ?? 0), true, true);
  add('치안·소방', -(b.safetyUpkeep ?? 0), true, true);
  add('보건', -(b.healthUpkeep ?? 0), true, true);
  add('교육', -(b.educationUpkeep ?? 0), true, true);
  add('공원', -b.parkUpkeep, true, true);
  add('보상 건물', -b.rewardUpkeep, false, true);
  add('랜드마크', -b.landmarkUpkeep, false, true);
  add('조례', -b.ordinanceCost, false, true);
  add('이웃 거래 지출', -b.neighbourExpense, false, true);
  add('대출 상환', -b.loanPayments, false, true);
  const scale = Math.max(b.income, b.expenses, 1);
  const net = b.income - b.expenses;
  return `<table class="budget-table">${rows.map(([label, v, sub, title]) => {
    const w = Math.min(100, (Math.abs(v) / scale) * 100);
    return `<tr class="${sub ? 'muted sub' : 'head'}"${title ? ` title="${title}"` : ''}>
      <td>${label}${w >= 3 ? `<span class="share ${v >= 0 ? 'in' : 'out'}" style="width:${w.toFixed(1)}%"></span>` : ''}</td>
      <td>${v < 0 ? '−' : ''}§${fmt(Math.abs(v))}</td></tr>`;
  }).join('')}
    <tr class="total"><td><b>지난달 수지</b></td><td><b class="${net < 0 ? 'bad' : 'good'}">${net < 0 ? '−' : '+'}§${fmt(Math.abs(net))}</b></td></tr>
    ${forecastRow(net)}
  </table><p class="legend">막대: 수입·지출 가운데 차지하는 몫 (지난달)</p>${runway(net)}`;
}

let forecast: { key: string; net: number } | null = null;

/**
 * Next month at today's tax rates, budgets and loans (on last month's tax
 * base): the table above is last month's, so a change shows here at once.
 */
function forecastRow(last: number): string {
  const s = city.state;
  const key = `${changeKey()}|${Object.values(s.taxRates).join()}|${Object.values(s.departments).join()}|${s.ordinances.join()}|${s.loans.length}`;
  if (forecast?.key !== key) {
    const r = city.previewBudget();
    forecast = { key, net: r.income - r.expenses };
  }
  const v = forecast.net;
  if (Math.abs(v - last) < 0.5) return '';
  return `<tr class="muted" title="지금 세율·부서 예산·대출로 정산하면 (지난달 세금 기반)"><td>다음 달 예상 (지금 설정)</td><td class="${v < 0 ? 'bad' : 'good'}">${v < 0 ? '−' : '+'}§${fmt(Math.abs(v))}</td></tr>`;
}

/** At a deficit: how long the treasury lasts at this rate. */
export function runway(net: number): string {
  const funds = city.state.funds;
  if (net >= 0 || funds <= 0 || funds / -net >= 120) return ''; // a decade away: not worth a warning
  const months = Math.floor(funds / -net);
  const when = months >= 24 ? `${Math.floor(months / 12)}년` : `${months}개월`;
  return `<p class="legend ${months < 12 ? 'neg' : ''}">이대로면 약 ${when} 뒤 자금이 바닥납니다. 세율을 올리거나 예산을 줄이세요.</p>`;
}

/** The garbage gauge's figure: tons a month, and how long the landfill lasts at that rate. */
export function garbageValue(g: ReturnType<typeof city.stats>['garbage']): string {
  const month = `<b>${fmt(g.kept || g.produced - g.recycled)}</b> t/월`;
  const months = landfillMonths(g);
  if (months === null) return month;
  return `${month} · 매립지 ${landfillSpan(months)}`;
}

/** A whole number with a true minus (the funds use one; demand read -70). */
const signed = (v: number) => `${Math.round(v) < 0 ? '−' : ''}${fmt(Math.abs(Math.round(v)))}`;

/** Three values by wealth, labelled (저소득층 · 중산층 · 부유층). */
const byWealth = (v: readonly (number | string)[]) => v.map((x, w) => `<span class="nw">${WEALTH_NAME[w as 0 | 1 | 2]} ${x}</span>`).join(' · ');

/** The garbage gauge's tooltip: where last month's garbage went, and how long the landfill lasts. */
export function garbageTitle(g: ReturnType<typeof city.stats>['garbage']): string {
  const parts = [`재활용 ${fmt(g.recycled)} t`, `소각 ${fmt(g.incinerated)} t`, `매립 ${fmt(g.landfilled)} t`];
  if (g.exported) parts.push(`이웃에 보냄 ${fmt(g.exported)} t`);
  if (g.imported) parts.push(`받아 옴 ${fmt(g.imported)} t`);
  if (g.uncollected > 1) parts.push(`못 치움 ${fmt(g.uncollected)} t`);
  if (g.piled > 1) parts.push(`쌓인 쓰레기 ${fmt(g.piled)} t`);
  const months = landfillMonths(g);
  const lf = months !== null ? ` · 매립지 남은 기간 약 ${landfillSpan(months)}` : '';
  const short = (g.importShort ?? 0) > 0 ? ` · 받기로 한 쓰레기 ${fmt(g.importShort ?? 0)}t을 못 받음(거래 위험)` : '';
  return `이번 달 쓰레기 (재활용·조례로 줄인 뒤, t) · 막대: 매립지가 찰 때가 가까울수록 길어짐 · ${parts.join(' · ')}${lf}${short}`;
}

/**
 * The garbage gauge's bar: how soon the landfill fills (its free room is a
 * stock, the month's garbage a flow, so one over the other means nothing).
 * Full and red when garbage piles up or under 6 months are left, amber under 18.
 */
export function garbageFill(g: ReturnType<typeof city.stats>['garbage']): { ratio: number; tone: string } {
  // Rubbish left lying: bad when it is a real share of the month's (15 t of 1,000 is a few roadless lots: a warning).
  const made = Math.max(1, g.kept || g.produced - g.recycled);
  if (g.uncollected > 1) return { ratio: 1, tone: g.uncollected > made * 0.05 ? 'bad' : 'warn' };
  const months = landfillMonths(g);
  if (months === null) return { ratio: 0, tone: '' };
  return { ratio: Math.max(0, Math.min(1, 1 - months / 60)), tone: months < 6 ? 'bad' : months < 18 ? 'warn' : '' };
}

/** How recent residential tax changes still weigh on the Mayor Rating, by wealth (they fade over months). */
let taxMonth = -1;

function renderTaxMood(): void {
  // The per-type demand effects move with the city and the 90-day rate memory: once a month.
  const month = Math.floor(city.state.day / 30);
  if (month !== taxMonth) {
    taxMonth = month;
    refreshTaxes();
  }
  const months = city.cfg.mayor.eventMonths;
  const by = ([0, 1, 2] as const).map((w) => city.taxMoodOf(w));
  let left = 0;
  for (const m of city.state.taxMood) left = Math.max(left, months - m.age);
  const parts = by.map((v, w) => [Math.round(Math.max(-25, Math.min(25, v))), WEALTH_NAME[w as 0 | 1 | 2]] as const).filter(([v]) => v !== 0);
  const el = $('#tax-mood');
  el.hidden = !parts.length;
  if (parts.length) el.innerHTML = `최근 주거 세율 변경이 시장 평점에 주는 영향: ${parts.map(([v, name]) => `주거 ${name} <b class="${v < 0 ? 'neg' : 'pos'}">${v > 0 ? '+' : '−'}${Math.abs(v)}</b>`).join(' · ')} (약 ${left}개월에 걸쳐 사라짐)`;
}

/** What lifts the demand caps: neighbour connections by kind (first of each kind lifts offices) and freight that reached one. */
function capRelief(): string {
  const per = city.connectionsPerEdge();
  const NAMES = { road: '도로', highway: '고속도로', rail: '철도', subway: '지하철' } as const;
  const kinds = (Object.keys(NAMES) as (keyof typeof NAMES)[]).map((k) => [NAMES[k], per[k].reduce((a, b) => a + b, 0)] as const).filter(([, v]) => v > 0);
  const dem = city.demand;
  const held = DEV_TYPES.filter((t) => t !== 'IA' && atCap(t) && dem.raw[t] > 0);
  const capped = held.length ? `상한에 막힌 유형: ${held.map((t) => `${TYPE_SHORT[t]} ${fmt(dem.capPopulation[t])}/${fmt(dem.cap[t])}`).join(' · ')}<br>` : '';
  return `${capped}상한 완화: 이웃 연결 ${kinds.length ? kinds.map(([k, v]) => `${k} ${v}`).join(' · ') : '없음'} · 지난달 도시 밖으로 나간 화물 ${fmt(city.state.freightTrips)}건 (산업 상한에 반영)`;
}

/** The city pane's gauge whose details are open (tap to toggle). */

let adviceKey = '';
/** The city the advice was worked out for (another city's is never shown while its own is pending). */
let adviceCity: typeof city | null = null;
/** What the overview and advice last showed (rebuilt only when that changes). */
let lastStatus = '';
let lastAdvice = '';
let lastDemand = '';
let adviceCache: ReturnType<typeof city.advisors> = [];
/** The advisors' last reading (the manage panel sorts it by goal). */
export const currentAdvice = () => (adviceCity === city ? adviceCache : []);
/** Advisor problems already announced (a toast when one turns bad), for the city they belong to. */
let alarmed: { owner: typeof city | null; codes: Set<string>; last: Map<string, number> } = { owner: null, codes: new Set(), last: new Map() };

export let departmentSignature = '';
/** The last department slider's effect, kept across rebuilds. */
let deptHint = '';

/** Department funding sliders, and one per civic service (all its buildings). */
const deptSig = (d: typeof city.state.departments) => `${d.roads}|${d.transit}|${d.power}|${d.water}|${d.parks}|${d.sanitation}|${d.landmarks}|${d.corrections}|${deptEmpty('landmarks')}${deptEmpty('corrections')}|${SERVICE_GROUPS.map(([k]) => serviceFunding(k)?.join(':')).join('|')}`;


/** Civic services funded building by building: one slider sets them all (the info card still sets one). */
const SERVICE_GROUPS = [
  ['police', '치안', 120, '경찰서 모두(교도소는 부서 예산 "교도소"): 줄이면 순찰 반경과 체포가 줄고, 낮게 두면 파업할 수 있습니다'],
  ['fire', '소방', 120, '소방서 모두: 줄이면 화재 진압 반경이 줄고, 낮게 두면 파업할 수 있습니다'],
  ['health', '보건', 150, '보건소·종합병원 등 모두: 줄이면 받을 수 있는 환자가 줄어 건강 지수가 떨어집니다'],
  ['school', '교육', 150, '학교·대학·도서관·박물관 모두: 줄이면 받을 수 있는 학생이 줄어 교육 지수가 떨어집니다'],
] as const;
type ServiceGroup = (typeof SERVICE_GROUPS)[number][0];

/** The group's buildings and their mean funding (rounded), or null when there are none. */
function serviceFunding(k: ServiceGroup): [number, number] | null {
  let sum = 0;
  let count = 0;
  for (const st of city.state.structures.values()) {
    if (!STRUCTURES[st.kind][k] || deptFunded(st.kind)) continue;
    sum += st.funding;
    count++;
  }
  return count ? [count, Math.round(sum / count)] : null;
}

export function renderDepartments(): void {
  const d = city.state.departments;
  const sig = deptSig(d);
  if (sig === departmentSignature) return;
  departmentSignature = sig;
  const el = $('#departments');
  const DEPTS = [
    ['roads', '도로 유지', '100% 아래면 포트홀이 생겨 차가 느려집니다'],
    ['transit', '대중교통', '줄이면 갈아타는 시간이 늘고 철로가 망가져 탈선이 납니다(복구는 100% 초과, 110%가 최적)'],
    ['power', '송전선', '줄이면 송전선이 낡아 불꽃이 튀어 불이 납니다'],
    ['water', '수도 (펌프·관)', '펌프·급수탑의 급수량과 수도관 유지: 줄이면 급수량이 줄고 관이 낡아, 50% 아래에서는 터집니다(싱크홀)'],
    ['sanitation', '위생', '쓰레기 수거비·매립지·소각 발전소·재활용 센터: 100% 아래면 그만큼 수거하지 못하고 시설이 빨리 낡으며, 넘기면 쌓인 쓰레기를 더 빨리 치웁니다'],
    ['parks', '공원 미화', '줄이면 공원의 쾌적도·상한 완화·공기 정화가 줄고 60% 아래에선 낡아 보입니다(100% 넘게는 못 줌)'],
    ['corrections', '교도소', '모든 교도소를 함께: 줄이면 감방이 줄어 범죄자가 풀려납니다'],
    ['landmarks', '랜드마크', '모든 랜드마크를 함께: 줄인 만큼 시장 지지도·상업 유인 효과가 줄어듭니다(100% 넘게는 못 줌)'],
  ] as const;
  el.innerHTML = `
    <h3 class="sub">부서 예산</h3>
    ${DEPTS.map(([k, name, hint]) => `<label class="funding dept" title="${hint}">${name} <input data-dept="${k}" type="range" min="0" max="${k === 'parks' || k === 'landmarks' ? 100 : 120}" step="5" value="${d[k]}" data-mark="100"${deptEmpty(k) ? ' disabled' : ''}><span>${deptEmpty(k) ? '없음' : `${d[k]}%`}</span></label>`).join('')}
    <h3 class="sub">시설 예산 (종류별 모두)</h3>
    ${SERVICE_GROUPS.map(([k, name, max, hint]) => {
      const f = serviceFunding(k);
      return `<label class="funding dept" title="${hint}">${name} <input data-service="${k}" type="range" min="0" max="${max}" step="5" value="${f?.[1] ?? 100}" data-mark="100"${f ? '' : ' disabled'}><span>${f ? `${f[1]}%` : '없음'}</span></label>`;
    }).join('')}
    <p class="legend" id="dept-hint">${deptHint || '예산을 움직이면 그 효과가 여기 나옵니다.'}</p>`;
  const hintFor = (k: string) => DEPTS.find(([d]) => d === k)?.[2] ?? '';
  el.querySelectorAll<HTMLInputElement>('input[data-dept]').forEach((input) => {
    input.oninput = () => {
      const dept = input.dataset.dept as keyof typeof city.state.departments;
      deptHint = hintFor(dept);
      $('#dept-hint').textContent = deptHint;
      choice('부서 예산', () => city.setDepartmentFunding(dept, Number(input.value)));
      // The engine caps some (city beautification at 100%): show what it took.
      input.value = String(city.state.departments[dept]);
      (input.nextElementSibling as HTMLElement).textContent = `${city.state.departments[dept]}%`;
      departmentSignature = deptSig(city.state.departments); // already shown: no rebuild under the pointer
    };
    input.onpointerenter = () => {
      deptHint = hintFor(input.dataset.dept!);
      $('#dept-hint').textContent = deptHint;
    };
    // The sliders already show what was set: refresh the rest without rebuilding them under the pointer or keys.
    input.onchange = () => updatePanels();
  });
  el.querySelectorAll<HTMLInputElement>('input[data-service]').forEach((input) => {
    const k = input.dataset.service as ServiceGroup;
    const [, , max, hint] = SERVICE_GROUPS.find(([g]) => g === k)!;
    input.oninput = () => {
      deptHint = hint;
      $('#dept-hint').textContent = deptHint;
      // Each moves by the same step from where it is (as on the goal screens: a school set apart keeps its difference).
      const step = Number(input.value) - (serviceFunding(k)?.[1] ?? Number(input.value));
      choice('시설 예산', () => {
        for (const st of city.state.structures.values()) if (STRUCTURES[st.kind][k] && !deptFunded(st.kind)) city.setFunding(st.id, Math.max(0, Math.min(max, st.funding + step)));
      });
      const f = serviceFunding(k);
      (input.nextElementSibling as HTMLElement).textContent = f ? `${f[1]}%` : '없음';
      departmentSignature = deptSig(city.state.departments);
      refreshInfo();
    };
    input.onpointerenter = () => {
      deptHint = hint;
      $('#dept-hint').textContent = deptHint;
    };
    input.onchange = () => updatePanels();
  });
}

export let loanSignature = '';

/** Loans: up to §200,000 each, 10 at most, 10 years at 8.5%. */
export function renderLoans(): void {
  const s = city.state;
  const sig = s.loans.map((l) => `${l.amount}:${l.monthsLeft}`).join(',') + `|${s.loans.length}`;
  if (sig === loanSignature) return;
  loanSignature = sig;
  const el = $('#loans');
  // Keep the amount the player chose across rebuilds (after each loan, every month).
  const chosenAmount = Number(el.querySelector<HTMLSelectElement>('#loan-amount')?.value ?? 50_000);
  // A handful of amounts (forty, every §5,000, made a long list to scroll).
  const options = [10_000, 25_000, 50_000, 75_000, 100_000, 150_000, 200_000]
    .map((a) => `<option value="${a}" ${a === chosenAmount ? 'selected' : ''}>§${fmt(a)} (월 §${fmt(city.loanPayment(a))})</option>`).join('');
  el.innerHTML = `
    <h3 class="sub">대출</h3>
    <div class="loan-row"><select id="loan-amount" aria-label="대출 금액">${options}</select><button id="loan-take">빌리기</button></div>
    ${s.loans.map((l, i) => `<div class="loan-row"><span>§${fmt(l.amount)} · 월 §${fmt(l.payment)} · ${l.monthsLeft}개월 남음</span>
      <button data-repay="${i}">상환 §${fmt(city.loanBalance(l))}</button></div>`).join('')}
    <p class="legend">최대 10건, 총 §2,000,000까지. 10년 동안 연 8.5%로 갚습니다.</p>`;
  $('#loan-take').onclick = () => {
    const amount = Number($<HTMLSelectElement>('#loan-amount').value);
    const res = choice('대출', () => city.takeLoan(amount));
    if (!res.ok && res.message) flash(ko(res.message), 'bad');
    else if (res.ok) flash(`§${fmt(amount)}을 빌렸습니다 · 10년간 월 §${fmt(city.loanPayment(amount))} 상환`, 'info');
    loanSignature = '';
    updatePanels();
  };
  el.querySelectorAll<HTMLButtonElement>('button[data-repay]').forEach((btn) => {
    btn.onclick = () => {
      const res = choice('대출', () => city.repayLoan(Number(btn.dataset.repay)));
      if (!res.ok && res.message) flash(ko(res.message), 'bad');
      else if (res.ok) flash('대출을 갚았습니다', 'info');
      loanSignature = '';
      updatePanels();
    };
  });
}

/** The most common reason buildings were abandoned. */
export function abandonHint(): string {
  const counts = new Map<string, number>();
  for (const b of city.state.buildings.values()) if (!b.type && b.abandonReason) counts.set(b.abandonReason, (counts.get(b.abandonReason) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  return top ? ` 가장 많은 이유: ${ABANDON_NAME[top[0] as keyof typeof ABANDON_NAME]} (${fmt(top[1])}채).` : '';
}

/** Who is out of work, and which job types (of their wealth) have demand to build. */
export function jobHint(): string {
  const idle = city.census.unemployed;
  const w = idle.indexOf(Math.max(...idle)) as 0 | 1 | 2;
  if (!idle[w]) return '';
  const dem = city.demand;
  const open = DEV_TYPES.filter((t) => t[0] !== 'R' && city.cfg.demand.wealthOf[t] === w && dem.demand[t] > 0)
    .sort((a, b) => dem.demand[b] - dem.demand[a]).map((t) => TYPE_NAME[t]);
  return ` 가장 많은 쪽은 ${WEALTH_NAME[w]} ${fmt(idle[w])}명${open.length ? ` — 지금 수요가 있는 ${WEALTH_NAME[w]} 일자리: ${open.join(', ')}` : ''}.`;
}

/**
 * The growth map for the pane's summaries: while time runs, worked out once
 * a game month (on a big map it costs as much as a refresh, which comes
 * several times a second at full speed); paused, always current.
 */
let paneGrowth: { city: typeof city; month: number; map: Uint8Array } | null = null;
function growthForPane(): Uint8Array {
  const month = Math.floor(city.state.day / 30);
  if (speed > 0 && paneGrowth && paneGrowth.city === city && paneGrowth.month === month) return paneGrowth.map;
  // While time runs, a new month's map is worked out in a task of its own (on
  // a big map it is a frame's worth of work); the pane shows last month's meanwhile.
  if (speed > 0 && paneGrowth?.city === city) {
    later('growth', function* (c) {
      const map = yield* c.growthMapSteps();
      paneGrowth = { city: c, month: Math.floor(c.state.day / 30), map };
    });
    return paneGrowth.map;
  }
  paneGrowth = { city, month, map: city.growthMap() };
  return paneGrowth.map;
}

const pending = new Set<string>();

/**
 * Works `work` out a few milliseconds at a time between frames, and never
 * part-way through a day (resuming then would finish the day first; a day
 * that ends meanwhile is fine), then refreshes the panels once. Dropped if
 * another city is opened meanwhile.
 */
function later(key: string, work: (c: typeof city) => Generator<void, void>): void {
  if (pending.has(key)) return;
  pending.add(key);
  const owner = city;
  const steps = work(owner);
  const run = () => {
    if (city !== owner) {
      pending.delete(key);
      return;
    }
    if (city.stepping) {
      setTimeout(run, 16);
      return;
    }
    const end = performance.now() + 4;
    do {
      if (steps.next().done) {
        pending.delete(key);
        if (!pending.size) setTimeout(refresh, 0);
        return;
      }
    } while (performance.now() < end);
    setTimeout(run, 0);
  };
  // The panels call the city all over: likewise not part-way through a day.
  const refresh = () => (city !== owner ? undefined : city.stepping ? setTimeout(refresh, 16) : updatePanels());
  setTimeout(run, 0);
}

/** Empty zone tiles by what keeps them empty, with a button to the growth view. */
let emptyZonesCache: { map: Uint8Array; revision: number; html: string } | null = null;

function emptyZones(): string {
  const map = growthForPane();
  // A pass over every tile: once per growth map (a month) or edit, not every panel update.
  if (emptyZonesCache?.map === map && emptyZonesCache.revision === city.revision) return emptyZonesCache.html;
  const html = countEmptyZones(map);
  emptyZonesCache = { map, revision: city.revision, html };
  return html;
}

function countEmptyZones(map: Uint8Array): string {
  const counts = new Map<string, number>();
  let total = 0;
  const occupant = city.state.occupant;
  for (let i = 0; i < map.length; i++) {
    if (!map[i] || occupant[i]) continue;
    const label = GROWTH_LABEL[GROWTH_CODES[map[i]! - 1]!];
    counts.set(label, (counts.get(label) ?? 0) + 1);
    total++;
  }
  if (!total) return '';
  const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="nw">${k} ${fmt(n)}</span>`).join(' · ');
  return `<p class="legend">빈 구역 ${fmt(total)}칸: ${parts} <button type="button" class="advice-view" data-overlay="growth" title="빈 구역을 막는 것을 지도에서 보기">보기</button></p>`;
}

/** One-line advisor hints for the most pressing problem. */
/** Rewards and deals earned recently, announced for three months. */
/**
 * The city's news (소식): rewards and deals offered, damage reports, My Sims, deals ended or
 * repriced, ordinances repealed, a year's summary, an action's result. Newest last, the
 * last 40 kept (a toast is gone in seconds; this is where to find what happened).
 */
export function pushNotice(n: Omit<Notice, 'until' | 'day'> & { until?: number }): void {
  const notices = journal().notices;
  notices.push({ ...n, until: n.until ?? city.state.day + 90, day: city.state.day });
  if (notices.length > 40) notices.splice(0, notices.length - 40);
}

/** For a residential cap: how many want in, and the park that lifts the cap most for its price. */
/** The park that lifts the residential cap most for its price (the one the advice names, and its fix arms). */
export function capBest(): StructureKind | undefined {
  const parks = (Object.keys(STRUCTURES) as StructureKind[])
    .filter((k) => STRUCTURES[k].category === 'park' && STRUCTURES[k].relief[0] > 0 && city.isUnlocked(k) && city.placementsLeft(k) > 0);
  return parks.sort((a, b) => STRUCTURES[b].relief[0] / Math.max(1, STRUCTURES[b].cost) - STRUCTURES[a].relief[0] / Math.max(1, STRUCTURES[a].cost))[0];
}

export function capHint(): string {
  const waiting = (['R$', 'R$$', 'R$$$'] as const).reduce((s, t) => s + Math.max(0, city.demand.raw[t]), 0);
  const best = capBest();
  return `${waiting >= 1 ? ` 약 ${fmt(waiting)}명이 들어오려고 기다립니다.` : ''}${best ? ` ${STRUCTURE_NAME[best]}(§${fmt(STRUCTURES[best].cost)}) 하나가 +${fmt(STRUCTURES[best].relief[0])}명.` : ''} 세율을 낮춰도 상한은 그대로입니다.`;
}

/** The advisors' alarms of this update, waiting for the goals' own word (see flushAlarms). */
const alarms: { goal: GoalId; text: string; at?: [number, number] }[] = [];
export function flushAlarms(): void {
  for (const a of alarms.splice(0)) {
    if (goalToldAt(a.goal) === city.state.day) continue;
    toast(firstSentence(a.text), 'bad', a.at, () => {
      closeSheet(); // the place is on the map: the sheet over it goes
      openGoal(a.goal, a.at, true);
    });
  }
}

export function advice(): string {
  const unlocked = city.takeNewUnlocks();
  for (const k of unlocked) {
    const d = STRUCTURES[k];
    const text = d.category === 'deal' ? `사업 거래 제안: ${STRUCTURE_NAME[k]} (월 §${fmt(d.income ?? 0)})` : `새 보상: ${STRUCTURE_NAME[k]}${josa(STRUCTURE_NAME[k], '을', '를')} 지을 수 있습니다.`;
    pushNotice({ text, until: city.state.day + 90, build: k });
    // (Pressed, it hands over the building to place: a reward was told and then had to be looked for in the tray.)
    if (unlocked.length === 1) toast(text, 'good', undefined, () => {
      closeSheet();
      pickStructure(k);
    }, false, `눌러서 ${STRUCTURE_NAME[k]} 짓기`);
  }
  // Several at once (a milestone opens a few): one toast, the pane lists them.
  if (unlocked.length > 1) toast(`새 보상·거래 ${unlocked.length}개: ${unlocked.map((k) => STRUCTURE_NAME[k]).join(', ')}`);
  for (const r of city.takeReports()) {
    const parts = [r.buildings && `건물 ${r.buildings}`, r.structures && `시설 ${r.structures}`, r.networkTiles && `도로·선로 ${r.networkTiles}칸`,
      r.undergroundTiles && `지하 ${r.undergroundTiles}칸`, r.fires && `화재 ${r.fires}`].filter(Boolean).join(' · ');
    const text = `피해 보고 — ${REPORT_NAME[r.kind]}: ${parts || '피해 없음'}${r.rebuildCost ? ` · 복구비 약 §${fmt(r.rebuildCost)}` : ''}${r.kind === 'meltdown' ? ' · 방사능은 사라지지 않습니다' : ''}`;
    pushNotice({ text, until: city.state.day + 90, warn: true, at: [r.x, r.y] });
    // A power plant gone up takes the city's power with it: stopped and told like a fire, to the power screen.
    if (r.kind === 'explosion' || r.kind === 'meltdown') {
      const at: [number, number] = [r.x, r.y];
      const stop = autoPause && speed > 0;
      if (stop) chooseSpeed(0);
      const none = ![...city.state.structures.values()].some((st) => STRUCTURES[st.kind].plant);
      toast(`${text}${none ? ' · 남은 발전소가 없습니다' : ''}${stop ? stoppedNote() : ''}`, 'bad', at, () => openGoal('power', at), stop);
    } else toast(text, 'bad', [r.x, r.y]);
  }
  for (const m of city.takeMySimNews()) {
    const why = {
      jobGone: '일터가 없어져 새 일을 찾습니다', newJob: '가까운 일터에 일자리를 구했습니다', moved: '살던 집을 떠나 가까운 같은 소득 수준의 집으로 이사했습니다',
      noJob: '두 달 동안 일자리를 못 구해 도시를 떠났습니다', abandoned: '집이 버려지고 갈 집이 없어 도시를 떠났습니다', homeGone: '집을 잃고 갈 집이 없어 도시를 떠났습니다',
      outclassed: '집이 다른 소득층의 집으로 바뀌었는데 맞는 집을 못 찾아 도시를 떠났습니다',
      searching: '집을 잃어 같은 소득 수준의 집을 찾는 중입니다 (두 달 안에 못 찾으면 떠납니다)',
      died: '세상을 떠났습니다 (범죄나 오염이 심한 동네였습니다)',
      heir: `천수를 누리고 세상을 떠나, ${m.sim.generation ?? 2}대째 자손이 집을 물려받았습니다`,
      promoted: '교육 수준이 올라 승진했습니다: 더 부유한 집과 일자리로 옮깁니다',
    }[m.kind];
    const left = m.kind === 'noJob' || m.kind === 'abandoned' || m.kind === 'homeGone' || m.kind === 'outclassed' || m.kind === 'died';
    const at: [number, number] = [m.sim.homeTile % city.size, Math.floor(m.sim.homeTile / city.size)];
    pushNotice({ text: `My Sim ${m.sim.name}: ${why}`, until: city.state.day + 90, warn: left, at });
    toast(`My Sim ${m.sim.name}: ${why}`, left ? 'bad' : 'info', at);
  }
  for (const d of city.takeEndedDeals()) {
    pushNotice({ text: `이웃 거래 종료: ${EDGE_NAME[d.edge]} ${RESOURCE_NAME[d.resource]} (유예 기간 안에 조건을 지키지 못함)`, until: city.state.day + 90, warn: true });
    toast(`이웃 거래 종료: ${EDGE_NAME[d.edge]} ${RESOURCE_NAME[d.resource]}`, 'bad');
  }
  for (const { deal: d, was } of city.takeRepricedDeals()) {
    // Terms are reevaluated after a year; the player may reject them (cancel in 지역).
    const worse = d.direction === 'buy' ? d.price > was : d.price < was;
    pushNotice({ text: `이웃 거래 1년 재계약: ${EDGE_NAME[d.edge]} ${RESOURCE_NAME[d.resource]} ${d.direction === 'buy' ? '구매' : '판매'} 단가 §${was.toFixed(3)} → §${d.price.toFixed(3)} (싫으면 지역에서 취소)`, until: city.state.day + 90, warn: worse });
  }
  for (const id of city.takeRepealedOrdinances()) {
    pushNotice({ text: `조례 폐지: ${ORDINANCE_NAME[id]} (필요한 시설이 없어짐)`, until: city.state.day + 90, warn: true });
    toast(`조례 폐지: ${ORDINANCE_NAME[id]}`, 'bad');
  }
  const rank = { bad: 0, neutral: 1, good: 2 } as const;
  // Problems first; of the good news, one line is enough.
  const key = changeKey();
  if (adviceKey !== key) {
    adviceKey = key;
    // The advisors look at the whole city: in a task of their own while time runs (see later).
    if (speed > 0 && adviceCity === city) later('advice', function* (c) {
      adviceCache = yield* c.advisorsSteps();
    });
    else adviceCache = city.advisors();
    adviceCity = city;
  }
  const sorted = [...adviceCache].sort((a, b) => rank[a.level] - rank[b.level]);
  // A problem that turns bad (a water shortage, a deficit, homes about to be
  // abandoned) is announced once, like the damage reports; the pane alone was
  // easy to miss below the fold. A city just opened announces nothing.
  const bad = new Set(sorted.filter((a) => a.level === 'bad').map((a) => a.code));
  // Not in a new city's first month, nor before anyone lives here: its problems are the checklist's
  // next steps (a toast that no power means no growth came the moment the first zone was laid).
  const settling = city.state.day < 30 || !readStats().population;
  if (alarmed.owner === city && !settling) {
    for (const a of sorted) {
      if (a.level !== 'bad' || alarmed.codes.has(a.code)) continue;
      // One coming and going month to month is announced at most twice a year.
      if (city.state.day - (alarmed.last.get(a.code) ?? -Infinity) < 180) continue;
      // A deficit with years of money in hand is the finance goal's warning, not an alarm (a town of 150
      // with §188,000 was told in red every half year of the §500 its roads cost).
      if (a.code === 'deficit' && city.state.funds > (a.value ?? 0) * 24) continue;
      const text = ADVICE_TEXT[a.code]?.(a.value ?? 0, a.type);
      if (!text) continue;
      // Told after the goals have been looked at (one whose goal was just told, with this word, isn't told twice).
      alarms.push({ goal: goalOfAdvice(a), text: `${ADVISOR_NAME[a.advisor]}: ${text}`, at: a.at });
      alarmed.last.set(a.code, city.state.day);
    }
  }
  alarmed = { owner: city, codes: settling ? new Set() : bad, last: alarmed.owner === city ? alarmed.last : new Map() };
  // The advisors' word is on each goal's screen (and 도시 상태); here is the news.
  void sorted;
  const news = [...journal().notices].reverse();
  const shown = adviceAll ? news : news.slice(0, ADVICE_SHOWN);
  const when = (day: number) => `${2000 + Math.floor(day / 360)}.${Math.floor((day % 360) / 30) + 1}`;
  const more = news.length > ADVICE_SHOWN ? `<button type="button" class="link advice-more" aria-expanded="${adviceAll}">${adviceAll ? '줄여 보기' : `소식 ${news.length - ADVICE_SHOWN}개 더 보기`}</button>` : '';
  return shown.map((n) => `<p class="advice news ${n.warn ? 'bad' : n.info ? 'neutral' : 'good'}">${icon(n.warn ? 'alert' : n.info ? 'info' : 'award', 'adv-i')}<span class="news-when">${when(n.day ?? n.until - 90)}</span>${escapeHtml(n.text)}${n.at || n.goal || buildable(n) ? `<span class="advice-acts">${n.at ? `<button type="button" class="advice-view" data-at="${n.at.join(',')}" title="지도에서 그곳 보기">보기</button>` : ''}${buildable(n) ? `<button type="button" class="advice-view" data-build="${n.build}" title="${STRUCTURE_NAME[n.build!]} 도구 들기">${icon('plus')}짓기</button>` : ''}${n.goal ? `<button type="button" class="advice-goal" data-goal="${n.goal}">${GOALS[n.goal].name} 화면 ${icon('chevronRight')}</button>` : ''}</span>` : ''}</p>`).join('') + more;
}
