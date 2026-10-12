// Reading the city for the goals: each goal's state, figures and forecasts, where its
// trouble gathers on the map, and what would help (no DOM here: the screen is manage.ts).

import { type Building, DEFAULT_CONFIG, DEV_TYPES, isLocalNet, Net, NETWORK_KINDS, type PollTopic, STRUCTURES, Terrain, type Structure, type StructureKind } from '@web-city/engine';
import { noRiders } from './info';
import { ADVICE_TEXT, POLL_NAME, WEALTH_NAME } from './names';
import { crimeKinds, currentAdvice, garbageFill } from './panels';
import { changeKey, city, cityGeneration } from './state';
import { kindsFor, structureStat, TOOLS } from './tools';
import { coverageRadius } from './views';
import { fmt, landfillMonths, landfillSpan, money, short } from './util';
import { type Goal, type GoalId, goalOfAdvice, GOALS, type Metric, type Tone } from './goals';

// ------------------------------------------------------------------ reading the city

export const sum = (v: readonly number[]) => v.reduce((a, b) => a + b, 0);
const avg = (v: readonly number[], w: readonly number[]) => (sum(w) ? sum(v.map((x, i) => x * w[i]!)) / sum(w) : 0);

/** The zone classes in words (the pane says 상업, not SimCity's C). */
export const CLASS_WORD = { R: '주거', C: '상업', I: '산업' } as const;
/** The wealthy's types in words (a figure labelled Cs$$$ read as a code). */
const RICH_WORD = { 'R$$$': '부유층 주거', 'Cs$$$': '고급 상점', 'Co$$$': '고급 오피스' } as const;

/** The goal's facilities, biggest first. */
export function facilities(g: Goal): Structure[] {
  if (!g.facility) return [];
  return [...city.state.structures.values()].filter((s) => g.facility!(s.kind)).sort((a, b) => b.capacity - a.capacity || a.id - b.id);
}

/** Load against capacity over a goal's facilities (patients, students, prisoners…). */
export function loadOf(list: Structure[]): [number, number] {
  return [sum(list.map((s) => s.load)), sum(list.map((s) => s.capacity))];
}

/** The advisors' words for a goal, problems first. */
export function adviceFor(id: GoalId) {
  const rank = { bad: 0, neutral: 1, good: 2 } as const;
  adviceMemo ??= currentAdvice();
  return adviceMemo.filter((a) => goalOfAdvice(a) === id).sort((a, b) => rank[a.level] - rank[b.level]);
}

type Status = { tone: Tone; value: string; note: string; bar?: number };

/** Each goal's state, worked out once per panel update (the list, the switcher and the chip all read it). */
const statusMemo = new Map<GoalId, Status>();
let adviceMemo: ReturnType<typeof currentAdvice> | null = null;

/** A new panel update: the city has moved on since the last readings. */
export function newReadings(): void {
  statusMemo.clear();
  adviceMemo = null;
  statsMemo = null;
}

/** The city's figures, read once per update (each read walks every building). */
let statsMemo: ReturnType<typeof city.stats> | null = null;
export const readStats = () => (statsMemo ??= city.stats());

export function goalStatus(id: GoalId): Status {
  let v = statusMemo.get(id);
  if (!v) statusMemo.set(id, (v = readStatus(id)));
  return v;
}

/** A goal's state in a line for the watch list: tone, headline figure, note, and a bar (0–1) where one fits. */
function readStatus(id: GoalId): Status {
  const st = readStats();
  const s = city.state;
  const advice = adviceFor(id);
  const worst: Tone = advice.some((a) => a.level === 'bad') ? 'bad' : advice.some((a) => a.level === 'neutral') ? 'warn' : '';
  const first = advice.find((a) => a.level !== 'good');
  const said = first ? (ADVICE_TEXT[first.code]?.(first.value ?? 0, first.type) ?? '').split(/[.:]/)[0]! : '';
  const pick = (tone: Tone, value: string, note: string, bar?: number) => {
    const t: Tone = tone === 'bad' || worst === 'bad' ? 'bad' : tone === 'warn' || worst === 'warn' ? 'warn' : tone;
    return { tone: t, value, note: said && t !== '' && t !== 'good' ? said : note, bar };
  };
  switch (id) {
    case 'finance': {
      const b = s.lastBudget;
      const net = b ? b.income - b.expenses : 0;
      // A small deficit on a full treasury is a warning, not an alarm: red when the money runs out within two years.
      const months = net < 0 && st.funds > 0 ? st.funds / -net : Infinity;
      const tone: Tone = st.funds < 0 || months < 24 ? 'bad' : net < 0 ? 'warn' : '';
      const left = months < 120 ? ` · 이대로면 ${months >= 24 ? `${Math.floor(months / 12)}년` : `${Math.floor(months)}개월`} 뒤 바닥` : '';
      return { tone, value: money(st.funds), note: b ? `지난달 ${net < 0 ? '−' : '+'}§${fmt(Math.abs(Math.round(net)))}${left}` : '첫 결산 전' };
    }
    case 'growth': {
      const dem = city.demand.demand;
      const top = (k: string) => Math.max(...DEV_TYPES.filter((t) => t[0] === k && t !== 'IA').map((t) => dem[t]));
      // In words, not SimCity's letters (R·C·I read as a code to most).
      const word = (k: 'R' | 'C' | 'I') => `${CLASS_WORD[k]} ${top(k) >= 1 ? `+${short(top(k))}` : '0'}`;
      // The class most wanted leads; all three read on the line below.
      const lead = (['R', 'C', 'I'] as const).reduce((a, b) => (top(b) > top(a) ? b : a));
      // The headline: the class most wanted (farms when only they are wanted much); a trickle reads as
      // little ("상업 수요 +2" sounded like demand on a ±1,000 scale where it is none).
      const headline = () => {
        const [name, v] = top(lead) < 10 && dem.IA > top(lead) ? ['농업', dem.IA] : [CLASS_WORD[lead], top(lead)];
        return v >= 10 ? `${name} 수요 +${short(v)}` : v >= 1 ? '수요 적음' : '수요 없음';
      };
      const z = unpoweredZones();
      if (z.off >= 10 && z.off >= z.all * 0.1) return pick('warn', headline(), `전기 없는 구역 ${fmt(z.off)}칸 · 개발 안 됨`);
      // Homes without work: jobs are what the town needs (a town of 120 with none was sent to its traffic,
      // which was only the long way to the neighbours' jobs).
      const jobless = sum(st.unemployed);
      if (st.population >= 100 && jobless > st.population * 0.2) {
        const cls = top('I') >= top('C') ? 'I' : 'C';
        return pick('warn', `실업 ${fmt(jobless)}명`, `일자리가 모자랍니다 · ${cls === 'I' ? '산업' : '상업'} 구역을 더 내세요 (${(['R', 'C', 'I'] as const).map(word).join(' · ')})`);
      }
      // The class most wanted has filled its zones: more of them is the whole of what it needs.
      if (top(lead) >= 300 && adviceFor('growth').some((a) => a.code === `zone${lead}`))
        return pick('warn', `${CLASS_WORD[lead]} 수요 +${short(top(lead))}`, `빈 ${CLASS_WORD[lead]} 구역이 없습니다 · 구역을 더 칠하세요`);
      // A class held at its cap leads when nothing else is wanted much (the "농업 +520" headline hid it).
      const cappedCls = (['R', 'C', 'I'] as const).find((k) => DEV_TYPES.some((t) => t[0] === k && t !== 'IA' && capped(t)));
      if (cappedCls && top(lead) < 100) return pick('warn', `${CLASS_WORD[cappedCls]} 상한`, `${(['R', 'C', 'I'] as const).map(word).join(' · ')}${dem.IA >= 1 ? ` · 농업 +${short(dem.IA)}` : ''}`);
      return pick(st.abandoned > 0 ? 'warn' : '', headline(),
        `${(['R', 'C', 'I'] as const).map(word).join(' · ')}${dem.IA >= 1 ? ` · 농업 +${short(dem.IA)}` : ''}${st.abandoned ? ` · 버려짐 ${fmt(st.abandoned)}` : ''}`);
    }
    case 'power': {
      const p = st.power;
      // A new town with nothing on the grid yet: say what is missing, not "0 / 0".
      if (!p.supply && !p.demand) return pick('', '—', list0('발전소'));
      // Plenty made but not reaching the zones (a plant across a road from them): growth stops all the same.
      const z = unpoweredZones();
      if (z.off >= 10 && z.off >= z.all * 0.1) return pick('bad', `${short(p.demand)} / ${short(p.supply)} MWh`, `전기 없는 구역 ${fmt(z.off)}칸 → 송전선으로 이으세요`);
      const r = p.supply > 0 ? p.demand / p.supply : p.demand > 0 ? 2 : 0;
      // (With its unit: a sound row has no line under it, and "9.7k / 14k" said nothing of what.)
      return pick(p.blackedOut > 0 || r > 1 ? 'bad' : r > 0.85 ? 'warn' : '', `${short(p.demand)} / ${short(p.supply)} MWh`,
        p.blackedOut ? `정전 ${fmt(p.blackedOut)}채` : r > 0.85 ? `여유 ${Math.max(0, Math.round((1 - r) * 100))}% · 곧 모자람` : '수요 / 공급', r);
    }
    case 'water': {
      const w = st.water;
      if (!w.supply && !w.demand) return pick('', '—', list0('양수 펌프'));
      // (No water at all while buildings want it: 조치 필요, though no "shortage" is counted before there are pipes.)
      const r = w.supply > 0 ? w.demand / w.supply : w.demand > 0 ? 2 : 0;
      // (A problem from 3,000 people, as the utilities advisor has it: before, low buildings do without, and a
      // new town was stopped on its first day for it.)
      if (!w.supply && w.demand > 0) return pick(st.population > 3000 ? 'bad' : 'warn', `${short(w.demand)} / 0 m³`, '양수 시설이 없어 물을 쓰는 건물에 물이 없습니다', r);
      return pick(w.shortages > 0 ? 'bad' : r > 0.85 ? 'warn' : '', `${short(w.demand)} / ${short(w.supply)} m³`,
        w.shortages ? `단수 ${fmt(w.shortages)}곳` : r > 0.85 ? `여유 ${Math.max(0, Math.round((1 - r) * 100))}% · 곧 모자람` : '수요 / 공급', r);
    }
    case 'garbage': {
      const g = st.garbage;
      const f = garbageFill(g);
      const months = landfillMonths(g);
      if (!g.produced && !g.capacity) return pick('', '—', '아직 쓰레기 없음 · 주민이 들어오면 매립지가 필요');
      return pick(f.tone as Tone, `${short(g.kept || g.produced - g.recycled)} t/월`,
        g.uncollected > 1 ? `못 치움 ${fmt(g.uncollected)} t` : months !== null ? `매립지 ${landfillSpan(months)} 남음` : '매립·소각·재활용', f.ratio);
    }
    case 'police': {
      const c = st.safety.crimes;
      const prev = s.history.at(-2)?.crimes;
      return pick(s.mobs.length ? 'bad' : '', `범죄 ${fmt(c)}`, `체포 ${fmt(st.safety.arrests)}${prev !== undefined && c > prev * 1.2 && c - prev > 5 ? ' · 늘어남' : ''}`);
    }
    case 'fire':
      return pick(st.safety.burning ? 'bad' : '', st.safety.burning ? `불타는 중 ${st.safety.burning}` : `화재 ${fmt(st.safety.fires)}`, `지난달 · 전소 ${fmt(st.safety.burned)}`);
    case 'health': {
      const list = facilities(GOALS.health);
      const [l, c] = loadOf(list);
      return pick(c > 0 && l > c ? 'warn' : '', `건강 지수 ${Math.round(avg(st.hq, st.residents))}`, list.length ? `환자 ${fmt(l)} / 정원 ${fmt(c)}${l > c ? ' · 넘침' : ''}` : '병원 없음', c ? l / c : undefined);
    }
    case 'education': {
      const list = facilities(GOALS.education).filter((f) => classroom(f.kind));
      const [l, c] = loadOf(list);
      // By level: seats at a primary school don't take high-school students (the total hid a full high school).
      const lv = levelShort();
      const over = lv && lv.load > lv.cap;
      return pick(c > 0 && (l > c || over) ? 'warn' : '', `교육 지수 ${Math.round(avg(st.eq, st.residents))}`,
        list.length ? (over && l <= c ? `${LEVEL_NAME[lv.curve]} 학생 ${fmt(lv.load)} / 정원 ${fmt(lv.cap)} · 넘침` : `학생 ${fmt(l)} / 정원 ${fmt(c)}${l > c ? ' · 넘침' : ''}`) : '학교 없음', c ? l / c : undefined);
    }
    case 'traffic': {
      const h = s.history.at(-1)?.commute;
      // A long commute says why it is long: jams, or no transit to share the load, or work far away.
      let why = '평균 통근 시간';
      if (h !== undefined && h > 1) {
        const jams = jammedTiles();
        const trips = s.history.at(-1)?.trips ?? {};
        const transit = ['bus', 'subway', 'passengerTrain', 'monorail', 'ferry'].some((k) => (trips[k] ?? 0) > 0);
        why = jams >= 10 ? `막히는 길 ${fmt(jams)}칸` : !transit ? '대중교통 없음 · 일터가 멀거나 길이 느림' : '일터가 멀거나 길이 느림';
      }
      return pick(h !== undefined && h > 1 ? 'warn' : '', h ? minutes(h) : '—', h ? why : '아직 통근하는 주민 없음');
    }
    case 'wealth': {
      const rich = st.residents[2] / Math.max(1, sum(st.residents));
      const want = city.demand.demand['R$$$'];
      // Worth a look once there is a town and the wealthy aren't coming.
      return pick(st.population > 2000 && want < 1 ? 'warn' : '', `부유층 ${Math.round(rich * 100)}%`, `부유층 주거 수요 ${want >= 1 ? `+${fmt(want)}` : '없음'}${landValue() >= 0.5 ? ` · 땅값 ${landValue().toFixed(0)}` : ''}`);
    }
    case 'environment': {
      const air = s.history.at(-1)?.air;
      if (air === undefined) return pick('', '—', '첫 달이 지나면 기록됩니다');
      // The mean over all land counts the industry's own air too: what wants a hand is homes breathing it.
      const homes = smoggyHomes();
      return pick(air > 40 && homes > 0 ? 'warn' : '', `대기 오염 ${air.toFixed(0)}`,
        homes > 0 ? `공기 나쁜 주거지 ${fmt(homes)}칸 · 낮을수록 좋음` : '낮을수록 좋음 · 주거지 공기는 괜찮음');
    }
  }
}

/** A service the town has none of yet (its row says so, and when it will be wanted). */
const list0 = (what: string) => `${what} 없음 · ${readStats().population || city.state.buildings.size || unpoweredZones().all > 0 ? '지금 필요' : '구역이 생기면 필요'}`;

const minutes = (v: number) => {
  const m = Math.round(v * 60);
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${String(m % 60).padStart(2, '0')}분`;
};


/** Next month's balance at the settings now (taxes on last month's base), worked out again only when a setting changes. */
let nextMemo: { key: string; v: number | null } | null = null;
function nextMonth(): number | null {
  const s = city.state;
  const key = `${changeKey()}|${s.loans.length}|${s.ordinances.join()}`;
  if (nextMemo?.key !== key) {
    const r = s.lastBudget ? city.previewBudget() : null;
    nextMemo = { key, v: r ? Math.round(r.income - r.expenses) : null };
  }
  return nextMemo.v;
}

/** Zoned tiles without power, and all zoned tiles (worked out again after an edit or a week). */
let dark: { key: string; off: number; all: number } | null = null;
export function unpoweredZones(): { off: number; all: number } {
  const key = changeKey();
  if (dark?.key === key) return dark;
  const s = city.state;
  const p = city.fields.powered;
  let off = 0;
  let all = 0;
  for (let i = 0; i < s.zone.length; i++) {
    const z = s.zone[i]!;
    if (z === 0 || z === 10) continue;
    all++;
    if (!p[i]) off++;
  }
  dark = { key, off, all };
  return dark;
}

/** The mean land value under buildings (worked out again only after an edit or a week). */
let landMemo: { key: string; v: number } | null = null;
function landValue(): number {
  const key = changeKey();
  if (landMemo?.key === key) return landMemo.v;
  const s = city.state;
  const lv = city.fields.landValue;
  let total = 0;
  let count = 0;
  for (let i = 0; i < s.occupant.length; i++) {
    if (s.occupant[i]! <= 0) continue;
    total += lv[i]!;
    count++;
  }
  landMemo = { key, v: count ? total / count : 0 };
  return landMemo.v;
}

/** The figures that size up a goal. */
/** What the residents say about a goal's subject (the opinion poll), as a figure on its screen. */
const POLL_OF: Partial<Record<GoalId, PollTopic>> = { police: 'safety', environment: 'environment', traffic: 'traffic', health: 'health', education: 'education', finance: 'taxes', wealth: 'landValue' };
let pollMemo: { key: string; polls: ReturnType<typeof city.opinionPolls> } | null = null;
function pollMetric(id: GoalId): Metric[] {
  const topic = POLL_OF[id];
  if (!topic || !readStats().population) return [];
  const key = `${changeKey()}|${Math.floor(city.state.day / 30)}`;
  if (pollMemo?.key !== key) pollMemo = { key, polls: city.opinionPolls() };
  const p = Math.round(pollMemo.polls[topic].approve * 100);
  // (Named by its topic: "주민 만족 100%" on the money screen read as the whole town's mood.)
  return [[`주민 만족 (${POLL_NAME[topic]})`, `${p}%`, p < 25 ? 'bad' : p < 50 ? 'warn' : '', p, 1, `${POLL_NAME[topic]}에 불만이 없는 주민 비율 (여론 조사: 시장 평점을 움직입니다)`]];
}

export function metrics(id: GoalId): Metric[] {
  return [...goalMetrics(id), ...pollMetric(id)];
}

function goalMetrics(id: GoalId): Metric[] {
  const st = readStats();
  const s = city.state;
  const list = GOALS[id].facility ? facilities(GOALS[id]) : [];
  // (School places: classroom schools only; a library's readers would hide a full school.)
  const [l, c] = loadOf(id === 'education' ? list.filter((f) => classroom(f.kind)) : list);
  const signed = (v: number, unit = '') => `${v < 0 ? '−' : '+'}${unit}${fmt(Math.abs(v))}`;
  switch (id) {
    case 'finance': {
      const b = s.lastBudget;
      const net = b ? b.income - b.expenses : 0;
      const runwayMonths = net < 0 && st.funds > 0 ? Math.floor(st.funds / -net) : null;
      return [
        ['자금', money(st.funds), st.funds < 0 ? 'bad' : '', st.funds, 1],
        ['지난달 수지', b ? signed(net, '§') : '—', net < 0 ? 'bad' : 'good', b ? net : undefined, 1],
        ['수입', b ? `§${fmt(b.income)}` : '—', '', b?.income, 1],
        ['지출', b ? `§${fmt(b.expenses)}` : '—', '', b?.expenses, -1],
        ...(runwayMonths !== null && runwayMonths < 120 ? [['바닥까지', runwayMonths >= 24 ? `약 ${Math.floor(runwayMonths / 12)}년` : `약 ${runwayMonths}개월`, runwayMonths < 12 ? 'bad' : 'warn'] as Metric] : []),
        ...(nextMonth() === null || Math.abs(nextMonth()! - net) < 1 ? [] : [['다음 달 예상', signed(nextMonth()!, '§'), (nextMonth() ?? 0) < 0 ? 'bad' : 'good', nextMonth() ?? undefined, 1, '지금 세율·예산·조례·대출로 정산하면 (지난달 세금 기반)'] as Metric]),
        ['대출', s.loans.length ? `${s.loans.length}건 · 월 §${fmt(sum(s.loans.map((x) => x.payment)))}` : '없음'],
      ];
    }
    case 'growth': {
      const dem = city.demand.demand;
      const cls = (k: string, n: string): Metric => {
        const v = Math.max(...DEV_TYPES.filter((t) => (k === 'A' ? t === 'IA' : t[0] === k && t !== 'IA')).map((t) => dem[t]));
        // (Held at its cap, "0" hid why: the cap says what to do about it.)
        // (A trickle beside the cap is the cap too: "+1" read as wanted.)
        const atCap = v < 10 && DEV_TYPES.some((t) => (k === 'A' ? t === 'IA' : t[0] === k && t !== 'IA') && capped(t));
        if (atCap) return [`${n} 수요`, '상한', 'warn', undefined, undefined, '인구가 수요 상한에 닿았습니다: 공원·광장과 보상 건물이 상한을 올립니다'];
        return [`${n} 수요`, v >= 1 ? `+${fmt(v)}` : v <= -1 ? `−${fmt(-v)}` : '0', v >= 100 ? 'good' : v < 0 ? 'warn' : ''];
      };
      const jobless = sum(st.unemployed);
      return [['인구', fmt(st.population), '', st.population, 1], ['일자리', fmt(st.jobs), '', st.jobs, 1], cls('R', '주거'), cls('C', '상업'), cls('I', '산업'), cls('A', '농업'),
        ['실업', fmt(jobless), jobless > st.population * 0.1 ? 'warn' : '', jobless, -1], ['버려진 건물', fmt(st.abandoned), st.abandoned ? 'warn' : '', st.abandoned, -1]];
    }
    case 'power': {
      const p = st.power;
      const spare = p.supply - p.demand;
      return [['수요', `${fmt(p.demand)} MWh`, '', p.demand, 0], ['공급', `${fmt(p.supply)} MWh`, '', p.supply, 1],
        ['여유', `${spare < 0 ? '−' : ''}${fmt(Math.abs(spare))} MWh`, spare < 0 ? 'bad' : spare < p.demand * 0.15 ? 'warn' : 'good', spare, 1],
        ['정전', p.blackedOut ? `${fmt(p.blackedOut)}채` : '없음', p.blackedOut ? 'bad' : '', p.blackedOut, -1], ['발전소', `${list.length}곳`, '', list.length, 0]];
    }
    case 'water': {
      const w = st.water;
      let dryCount = -1;
      const dry = () => {
        if (dryCount < 0) {
          dryCount = 0;
          for (const b of s.buildings.values()) if (b.type && !city.fields.watered[b.y * s.size + b.x]) dryCount++;
        }
        return dryCount;
      };
      const spare = w.supply - w.demand;
      return [['수요', `${fmt(w.demand)} m³`, '', w.demand, 0], ['공급', `${fmt(w.supply)} m³`, '', w.supply, 1],
        ['여유', `${spare < 0 ? '−' : ''}${fmt(Math.abs(spare))} m³`, spare < 0 ? 'bad' : spare < w.demand * 0.15 ? 'warn' : 'good', spare, 1],
        // (With no water at all there are no "shortages" yet: the buildings going without are the count.)
        ...(w.supply <= 0 && dry() ? [['물 없는 건물', `${fmt(dry())}채`, 'bad', dry(), -1] as Metric] : [['단수', w.shortages ? `${fmt(w.shortages)}곳` : '없음', w.shortages ? 'bad' : '', w.shortages, -1] as Metric]), ['수도 시설', `${list.length}곳`, '', list.length, 0]];
    }
    case 'garbage': {
      const g = st.garbage;
      const months = landfillMonths(g);
      const now = g.kept || g.produced - g.recycled;
      return [['처리할 쓰레기', `${fmt(now)} t`, '', now, -1, '이번 달, 재활용·조례로 줄인 뒤'], ['처리 여유 (소각·매립)', `${fmt(g.capacity)} t`, '', g.capacity, 1, '소각장이 태울 수 있는 양과 매립지에 남은 자리'],
        ['매립지 남은 기간', months === null ? '—' : landfillSpan(months), months !== null && months < 6 ? 'bad' : months !== null && months < 18 ? 'warn' : ''],
        // (Each its own figure: "재활용·소각 197 · 788 t" left which number was which to guess.)
        ['재활용', `${fmt(g.recycled)} t`, '', Math.round(g.recycled), 1, '이번 달 재활용으로 줄인 양'], ['소각', `${fmt(g.incinerated)} t`, '', Math.round(g.incinerated), 0, '이번 달 소각 발전소가 태운 양'], ['못 치움', g.uncollected > 1 ? `${fmt(g.uncollected)} t` : '없음', g.uncollected > 1 ? 'bad' : '', g.uncollected, -1]];
    }
    case 'police':
      return [['범죄 (지난달)', fmt(st.safety.crimes), '', st.safety.crimes, -1, crimeKinds(st.safety.byType)], ['체포', fmt(st.safety.arrests), '', st.safety.arrests, 1], ['예방', fmt(st.safety.prevented), '', st.safety.prevented, 1],
        ['수감', c ? `${fmt(l)} / ${fmt(c)}` : '—', c && l >= c ? 'bad' : ''], ['풀려남 (감방 부족)', fmt(st.safety.paroled), st.safety.paroled ? 'warn' : '', st.safety.paroled, -1], ['폭동', s.mobs.length ? `${s.mobs.length} 진행 중` : '없음', s.mobs.length ? 'bad' : '']];
    case 'fire':
      return [['지금 불', st.safety.burning ? `${st.safety.burning}곳` : '없음', st.safety.burning ? 'bad' : ''], ['지난달 화재', fmt(st.safety.fires), '', st.safety.fires, -1], ['전소', fmt(st.safety.burned), '', st.safety.burned, -1], ['소방서', `${list.length}곳`, '', list.length, 0],
        ['출동 가능', `${city.freeUnits('fire')}대`]];
    case 'health': {
      const hq = avg(st.hq, st.residents);
      const life = s.history.at(-1)?.lifeExpectancy;
      return [['건강 지수 평균 (0–200)', hq.toFixed(0), '', Math.round(hq), 1, WEALTH_NAME.map((w, k) => `${w} ${Math.round(st.hq[k]!)}`).join(' · ')], ['기대 수명', life ? `${life.toFixed(0)}세` : '—', '', life ? Math.round(life) : undefined, 1],
        ['환자 / 정원', c ? `${fmt(l)} / ${fmt(c)}` : '—', c && l > c ? 'warn' : ''], ['병원', `${list.length}곳`, '', list.length, 0]];
    }
    case 'education': {
      const eq = avg(st.eq, st.residents);
      return [['교육 지수 평균 (0–200)', eq.toFixed(0), '', Math.round(eq), 1, WEALTH_NAME.map((w, k) => `${w} ${Math.round(st.eq[k]!)}`).join(' · ')], ['학생 / 정원', c ? `${fmt(l)} / ${fmt(c)}` : '—', c && l > c ? 'warn' : ''], ['학교', `${list.length}곳`, '', list.length, 0]];
    }
    case 'traffic': {
      const h = s.history.at(-1);
      const trips = h?.trips ?? {};
      const total = sum(Object.values(trips).map((v) => v ?? 0));
      const transit = sum(['bus', 'subway', 'passengerTrain', 'monorail', 'ferry'].map((k) => trips[k] ?? 0));
      const share = total ? Math.round((transit / total) * 100) : undefined;
      return [['평균 통근', h?.commute ? minutes(h.commute) : '—', h?.commute && h.commute > 1 ? 'warn' : '', h?.commute ? Math.round(h.commute * 60) : undefined, -1], ['하루 통행', total ? fmt(total) : '—'],
        ['대중교통 비중', share !== undefined ? `${share}%` : '—', '', share, 1],
        // Long commutes with no stop at all: transit is the step not yet taken.
        ['정류장·역', `${list.length}곳`, !list.length && (h?.commute ?? 0) > 1 ? 'warn' : '', list.length, 0, !list.length && (h?.commute ?? 0) > 1 ? '통근이 깁니다: 버스 정류장부터 놓아 보세요' : undefined]];
    }
    case 'wealth': {
      const total = Math.max(1, sum(st.residents));
      const dem = city.demand.demand;
      const d = (t: 'R$$$' | 'Cs$$$' | 'Co$$$'): Metric => [`${RICH_WORD[t]} 수요`, dem[t] >= 1 ? `+${fmt(dem[t])}` : dem[t] <= -1 ? `−${fmt(-dem[t])}` : '0', dem[t] >= 100 ? 'good' : dem[t] < 0 ? 'warn' : ''];
      return [['부유층 주민', `${fmt(st.residents[2])}명 · ${Math.round((st.residents[2] / total) * 100)}%`, '', st.residents[2], 1],
        ['중산층 주민', `${fmt(st.residents[1])}명`, '', st.residents[1], 1], ['평균 땅값', landValue() >= 0.5 ? landValue().toFixed(1) : '차이 없음', '', Math.round(landValue()), 1, '건물이 선 칸의 평균: 물가와 주변보다 높은 땅이 올립니다 (모두 평평한 내륙이면 0)'],
        d('R$$$'), d('Cs$$$'), d('Co$$$'), ['교육 지수 평균 (0–200)', avg(st.eq, st.residents).toFixed(0), '', Math.round(avg(st.eq, st.residents)), 1]];
    }
    case 'environment': {
      const h = s.history.at(-1);
      const parks = [...s.structures.values()].filter((x) => STRUCTURES[x.kind].category === 'park').length;
      const homes = smoggyHomes();
      return [['대기 오염', h?.air !== undefined ? h.air.toFixed(0) : '—', (h?.air ?? 0) > 40 && homes > 0 ? 'warn' : '', h?.air !== undefined ? Math.round(h.air) : undefined, -1],
        ['공기 나쁜 주거지', `${fmt(homes)}칸`, homes > 0 && (h?.air ?? 0) > 40 ? 'warn' : '', homes, -1, '대기 오염이 40을 넘는 주거 구역 칸 · 공장·발전소·막히는 길 가까이에서 생깁니다'],
        ['수질 오염', h?.waterPollution !== undefined ? h.waterPollution.toFixed(0) : '—', '', h?.waterPollution !== undefined ? Math.round(h.waterPollution) : undefined, -1],
        ['공원', `${parks}곳`, '', parks, 1], ['시장 평점', String(st.mayorRating), st.mayorRating < 0 ? 'bad' : '', st.mayorRating, 1]];
    }
  }
}

/** A facility's line: its figure and anything wrong with it. */
export function facilityLine(f: Structure): [string, Tone] {
  const d = STRUCTURES[f.kind];
  const strike = f.strike ? ' · 파업' : '';
  // (Its life said once half is gone: "수명 100%" on every new plant pushed the output out of the line.)
  if (d.plant) return [`${fmt(f.load)} / ${fmt(f.capacity)} MWh${f.life >= 50 ? ` · 수명 ${Math.round(100 - f.life)}% 남음` : ''}`, f.life >= 85 ? 'bad' : f.life >= 70 ? 'warn' : ''];
  if (d.pump) return [`${fmt(f.load)} / ${fmt(f.capacity)} m³${f.capacity === 0 ? ' · 가동 안 함' : ''}`, f.capacity === 0 ? 'bad' : f.life >= 90 ? 'warn' : ''];
  if (d.incinerator) return [`${fmt(f.load)} / ${fmt(f.capacity)} t 소각`, ''];
  if (d.health || d.school) return [`${d.health ? '환자' : '학생'} ${fmt(f.load)} / ${fmt(f.capacity)}${strike}`, f.strike ? 'bad' : f.load > f.capacity ? 'warn' : ''];
  // (Its effect said when off the full: "효과 100% · 수감 28 / 50" was cut where the pane is narrow.)
  if (d.police) return [`${d.police.radius && Math.round(f.effectiveness * 100) !== 100 ? `효과 ${Math.round(f.effectiveness * 100)}% · ` : ''}수감 ${fmt(f.load)} / ${fmt(f.capacity)}${strike}`, f.strike ? 'bad' : f.capacity && f.load >= f.capacity ? 'warn' : ''];
  if (d.fire) return [`효과 ${Math.round(f.effectiveness * 100)}%${strike}`, f.strike ? 'bad' : ''];
  // (No riders: why, in short, as its info card says it: alone of its kind, no road, or nowhere worth going.)
  if (d.station) return f.load < 1 ? [`승차 0 · ${noRiders(f).split(/[.:]/)[0]}`, 'warn'] : [`승차 ${fmt(f.load)} / ${fmt(d.station.capacity)}`, ''];
  return [structureStat(f.kind), ''];
}

/** Kinds funded through their department as one (the engine ignores their own budget): stations, parks, garbage, water. */
/** How long a landfill lasts, in words: months, years, or past any horizon (a landfill all but unused). */

/** Departments with nothing to fund yet (no landmark, no jail): their slider waits, as a service's does. */
export function deptEmpty(k: string): boolean {
  if (k !== 'landmarks' && k !== 'corrections') return false;
  for (const st of city.state.structures.values()) {
    const def = STRUCTURES[st.kind];
    if (k === 'landmarks' ? def.category === 'landmark' : def.category === 'safety' && def.police?.radius === 0) return false;
  }
  return true;
}

export const deptFunded = (k: StructureKind) => !!STRUCTURES[k].station || ['park', 'garbage', 'water', 'landmark'].includes(STRUCTURES[k].category)
  || (STRUCTURES[k].category === 'safety' && STRUCTURES[k].police?.radius === 0);

export const FUNDING_MAX = (k: StructureKind) => (STRUCTURES[k].health || STRUCTURES[k].school ? 150 : 120);

/** A school with classrooms (a library, museum or college serves other ages and adds no school places). */
export const classroom = (k: StructureKind) => ['elementary', 'highSchool', 'privateSchool'].includes(STRUCTURES[k].school?.curve ?? '');

/** What one more of a kind would make of the goal's figure: spare power or water after, places at school or hospital. */
export function forecast(k: StructureKind): string {
  const d = STRUCTURES[k];
  const st = readStats();
  // The margin it would leave, as an amount (지으면 여유 +12,216 m³ beside 급수 2,400 m³ read as the gain);
  // still short, by how much.
  const after = (spare: number, add: number, unit: string) => {
    const v = Math.round(spare + add); // (short by a fraction read 지어도 0 MWh 모자람)
    return v < 0 ? `지어도 ${fmt(-v)} ${unit} 모자람` : `지으면 여유 ${fmt(v)} ${unit}`;
  };
  if (d.plant) return after(st.power.supply - st.power.demand, d.plant.output, 'MWh');
  if (d.pump) return after(st.water.supply - st.water.demand, d.pump.output, 'm³');
  // A station: of the area its goal finds uncovered, how much one at the target would reach.
  if (d.police || d.fire) {
    const id: GoalId = d.police ? 'police' : 'fire';
    const gain = reachAtSpot(id, k);
    return gain ? `과녁에 지으면 닿지 않던 곳 ${fmt(gain)}칸 해결` : '';
  }
  if (d.school && !classroom(k)) return '';
  if (d.health || d.school) {
    // (A school: places at its own level, which is what its students need.)
    const list = facilities(GOALS[d.health ? 'health' : 'education']).filter((f) => (d.health ? !!STRUCTURES[f.kind].health : STRUCTURES[f.kind].school?.curve === d.school!.curve));
    const [l, c] = loadOf(list);
    const room = c + (d.health ?? d.school)!.capacity - l;
    const what = d.health ? '병상' : `${LEVEL_NAME[d.school!.curve] ?? ''} 자리`;
    return room < 0 ? `지어도 ${what} ${fmt(-room)} 모자람` : `지으면 ${what} 여유 ${fmt(room)}`;
  }
  return '';
}

/** Tiles the goal finds uncovered within a facility's radius of its target (none without one). */
let reachMemo: { key: string; n: number } | null = null;
function reachAtSpot(id: GoalId, k: StructureKind): number {
  const key = `${id}|${k}|${changeKey()}`;
  if (reachMemo?.key === key) return reachMemo.n;
  const spot = suggestSpot(id);
  const want = need(id);
  const r = coverageRadius(k);
  let n = 0;
  if (spot && want && r) {
    const size = city.size;
    for (let y = Math.max(0, spot.y - r); y <= Math.min(size - 1, spot.y + r); y++) {
      for (let x = Math.max(0, spot.x - r); x <= Math.min(size - 1, spot.x + r); x++) {
        if ((x - spot.x) ** 2 + (y - spot.y) ** 2 <= r * r && want(y * size + x) > 0) n++;
      }
    }
  }
  reachMemo = { key, n };
  return n;
}

/** What a goal looks for on the map: the tiles that need it, and whether each has it. */
function need(id: GoalId): ((i: number) => number) | null {
  const s = city.state;
  const f = city.fields;
  const used = (i: number) => (s.zone[i]! > 0 && s.zone[i] !== 10) || s.occupant[i]! > 0;
  const home = (i: number) => s.zone[i]! >= 1 && s.zone[i]! <= 3;
  // How much a tile counts (0: it doesn't need it, or has it).
  switch (id) {
    case 'police': return (i) => (used(i) && f.policeCover[i]! <= 0 ? 1 : 0);
    // (A power plant outside cover counts many times over: one that burns explodes.)
    case 'fire': return (i) => {
      if (f.fireCover[i]! > 0) return 0;
      const occ = s.occupant[i]!;
      const st = occ < 0 ? s.structures.get(-occ) : undefined;
      if (st && STRUCTURES[st.kind].plant) return 12;
      return used(i) ? 1 : 0;
    };
    case 'health': return (i) => (home(i) && f.healthQuality[i]! <= 0.05 ? 1 : 0);
    case 'education': return (i) => (home(i) && f.schoolQuality[i]! <= 0.05 ? 1 : 0);
    case 'power': return (i) => (s.zone[i]! > 0 && s.zone[i] !== 10 && !f.powered[i] ? 1 : 0);
    case 'water': return (i) => (s.occupant[i]! > 0 && !f.watered[i] && s.buildings.get(s.occupant[i]!)?.type ? 1 : 0);
    // Open land the well-off would take (zoned for homes, or not yet zoned): where to zone, and keep fine.
    case 'wealth': {
      const d = city.desirabilityMap('R$$$');
      return (i) => (!s.occupant[i] && !s.net[i] && s.terrain[i] !== Terrain.Water && (s.zone[i] === 0 || home(i)) && f.accessDist[i] === 1 && d[i]! >= 80 ? 1 : 0); // (beside a road: open country far off is no place to start)
    }
    // Homes in air past what people put up with (parks and trees beside them help); rubbish left lying.
    case 'environment': return (i) => (home(i) && f.air[i]! > 40 ? Math.min(2, (f.air[i]! - 40) / 40) : 0);
    case 'garbage': return (i) => (s.zone[i] !== 10 && s.garbage[i]! > 2 ? 1 : 0);
    // Road over its capacity, by how far (rail and the rest have views of their own).
    case 'traffic': return (i) => {
      const code = s.net[i]!;
      if (code === Net.None || code === Net.Rail) return 0;
      const cap = DEFAULT_CONFIG.transport.speed[NETWORK_KINDS[code]!]?.capacity;
      const u = cap ? f.traffic[i]! / cap : 0;
      return u > 1.2 ? u - 1 : 0;
    };
    default: return null;
  }
}

export const SPOT_WORD: Partial<Record<GoalId, string>> = {
  police: '경찰이 닿지 않는 곳', fire: '소방이 닿지 않는 곳', health: '병원이 닿지 않는 주거지', education: '학교가 닿지 않는 주거지',
  power: '발전소 자리', water: '양수 시설 자리', traffic: '막히는 길', environment: '공기가 나쁜 주거지', garbage: '쓰레기가 쌓인 곳', wealth: '부유층이 살 만한 길가 빈 땅',
};

const LEVEL_NAME: Record<string, string> = { elementary: '초등', highSchool: '고등' };
/** The school level most short of places (its load and seats), or null with none built. */
export function levelShort(): { curve: string; load: number; cap: number } | null {
  let worst: { curve: string; load: number; cap: number } | null = null;
  for (const curve of ['elementary', 'highSchool']) {
    const [load, cap] = loadOf(facilities(GOALS.education).filter((f) => STRUCTURES[f.kind].school?.curve === curve));
    if (!cap) continue;
    if (!worst || load / cap > worst.load / worst.cap) worst = { curve, load, cap };
  }
  return worst;
}

/** A development type held at its cap (no demand however low the tax): parks and rewards raise it. */
export const capped = (t: (typeof DEV_TYPES)[number]) => {
  const d = city.demand;
  return Number.isFinite(d.cap[t]) && d.capPopulation[t] >= d.cap[t] * 0.98 && d.demand[t] < 1;
};

/** Road tiles past capacity (counted once a week of game time or after an edit). */
let jamMemo: { key: string; n: number } | null = null;
function jammedTiles(): number {
  const key = changeKey();
  if (jamMemo?.key === key) return jamMemo.n;
  const want = need('traffic')!;
  let n = 0;
  const net = city.state.net; // (once: \`city\` is a proxy, read per tile it cost more than the count)
  for (let i = 0; i < net.length; i++) if (net[i] && want(i) > 0) n++;
  jamMemo = { key, n };
  return n;
}

/** Homes in air past what people put up with (counted once a week of game time or after an edit). */
let smogMemo: { key: string; n: number } | null = null;
function smoggyHomes(): number {
  const key = changeKey();
  if (smogMemo?.key === key) return smogMemo.n;
  const want = need('environment')!;
  let n = 0;
  const zone = city.state.zone;
  for (let i = 0; i < zone.length; i++) if (zone[i] && want(i) > 0) n++;
  smogMemo = { key, n };
  return n;
}

/** The plant or pump a site is looked for: gas (clean enough, mid-sized) if open, else the cheapest. */
function siteKind(id: 'power' | 'water'): StructureKind | null {
  if (id === 'power' && city.isUnlocked('gasPlant')) return 'gasPlant';
  return cheapestOf(GOALS[id]);
}

/** The facility a goal's mark was found for (suggestSpot checks the site against it): what its 여기에 짓기 builds without the guide. */
export function spotKind(id: GoalId): StructureKind | null {
  return SERVICE.has(id) ? cheapestOf(GOALS[id]) : id === 'power' ? siteKind('power') : id === 'water' ? siteKind('water') : null;
}

/** Goals whose facility serves a radius: their target is a place to build one. */
const SERVICE = new Set<GoalId>(['police', 'fire', 'health', 'education']);

/** The goal's cheapest facility that can be built now (for police, a station rather than the prison). */
export function cheapestOf(g: Goal): StructureKind | null {
  let best: StructureKind | null = null;
  const short = g === GOALS.education ? levelShort() : null;
  const lv = short && short.load > short.cap * 0.9 ? short : null;
  for (const id of g.tools) {
    const t = TOOLS.find((x) => x.id === id);
    if (t?.kind !== 'structure') continue;
    for (const k of kindsFor(t)) {
      if (!city.isUnlocked(k) || city.placementsLeft(k) <= 0 || (g.facility && !g.facility(k))) continue;
      if (g === GOALS.education && !classroom(k)) continue; // (a library adds no school places)
      if (g === GOALS.education && lv && STRUCTURES[k].school?.curve !== lv.curve) continue; // the level that is short
      if (!best || STRUCTURES[k].cost < STRUCTURES[best].cost) best = k;
    }
  }
  return best;
}

/** Forgets the sites found since the city last changed (a building grew on one: growth moves no revision). */
export function forgetSites(): void {
  siteMemo = pipeMemo = plantMemo = awayMemo = pairMemo = spotMemo = lineMemo = roadMemo = pipeLineMemo = fillMemo = null;
  nearMemo = new Map();
}

/** Whether `count` of a kind could be built now at all (unlocked, placements left, the money): else no site is worth a search. */
function buildable(kind: StructureKind, count = 1): boolean {
  return city.isUnlocked(kind) && city.placementsLeft(kind) >= count && STRUCTURES[kind].cost * count <= city.state.funds;
}

/**
 * When the sites are found again: an edit, or a month (by the week, as the panels go, a big map's search ran
 * four times a second at top speed; a site taken meanwhile is found again on the press, see forgetSites).
 */
const siteKey = () => `${cityGeneration}|${city.revision}|${Math.floor(city.state.day / 30)}`;

/** Visits the offsets on the square ring of radius r around a point (r = 0: the point), until `visit` says done. */
function onRing(r: number, visit: (dx: number, dy: number) => boolean): boolean {
  if (r === 0) return visit(0, 0);
  for (let d = -r; d <= r; d++) if (visit(d, -r) || visit(d, r)) return true;
  for (let d = -r + 1; d < r; d++) if (visit(-r, d) || visit(r, d)) return true;
  return false;
}

/** A footprint on the map with no building, facility or road on it: worth asking the engine about (that costs more). */
function footprintOpen(lx: number, ly: number, w: number, h: number): boolean {
  const n = city.size;
  if (lx < 0 || ly < 0 || lx + w > n || ly + h > n) return false;
  const s = city.state;
  for (let y = ly; y < ly + h; y++) for (let x = lx; x < lx + w; x++) if (s.occupant[y * n + x] || s.net[y * n + x]) return false;
  return true;
}

/** The nearest spot to (ax, ay) within `reach` rings where a footprint of `kind` passes `fits` (given its corner): its middle tile. */
function nearestFit(kind: StructureKind, ax: number, ay: number, reach: number, fits: (lx: number, ly: number) => boolean): [number, number] | null {
  const d = STRUCTURES[kind];
  let at: [number, number] | null = null;
  for (let r = 0; r <= reach && !at; r++) {
    onRing(r, (dx, dy) => {
      const [lx, ly] = [ax + dx - ((d.w - 1) >> 1), ay + dy - ((d.h - 1) >> 1)]; // (a spot is the site's middle, as suggestSpot's)
      if (!footprintOpen(lx, ly, d.w, d.h) || !city.canPlaceStructure(kind, lx, ly).ok || !fits(lx, ly)) return false;
      at = [ax + dx, ay + dy];
      return true;
    });
  }
  return at;
}

/**
 * The free site nearest the homes, beside a road, for a facility whose place doesn't matter to what it is
 * built for (a park lifting the cap does it anywhere; by the homes it pleases them too). Its middle tile, or null.
 */
export function siteNearHomes(kind: StructureKind): [number, number] | null {
  if (!buildable(kind)) return null;
  const key = `homes|${kind}|${siteKey()}`;
  if (siteMemo?.key === key) return siteMemo.at;
  const d = STRUCTURES[kind];
  const [ax, ay] = homesMiddle();
  const at = nearestFit(kind, ax, ay, city.size, (lx, ly) => city.roadBeside(lx, ly, d.w, d.h));
  siteMemo = { key, at };
  return at;
}
let siteMemo: { key: string; at: [number, number] | null } | null = null;

/**
 * The shortest power line from the grid to the nearest dark zone — from a powered conductor or a plant (one
 * standing alone, its grid powering nobody), round buildings (lines cross roads and water, as the tool lays
 * them): the tiles to lay, in order, or null. Found again on an edit or a new month.
 */
export function lineToDark(): [number, number][] | null {
  const key = `line|${siteKey()}`;
  if (lineMemo?.key === key) return lineMemo.path;
  const s = city.state;
  const f = city.fields;
  const n = city.size;
  const N = n * n;
  const seen = new Int32Array(N).fill(-2); // -2 unseen, -1 a source, else the tile it was reached from
  const queue: number[] = [];
  for (let i = 0; i < N; i++) if (f.powered[i] && (s.power[i] || s.occupant[i] || (s.zone[i] && s.zone[i] !== 10))) { seen[i] = -1; queue.push(i); }
  for (const st of s.structures.values()) {
    if (!STRUCTURES[st.kind].plant) continue;
    for (let y = st.y; y < st.y + st.h; y++) for (let x = st.x; x < st.x + st.w; x++) if (seen[y * n + x] === -2) { seen[y * n + x] = -1; queue.push(y * n + x); }
  }
  let hit = -1;
  for (let h = 0; h < queue.length && hit < 0; h++) {
    const i = queue[h]!;
    const x = i % n;
    for (const j of [x < n - 1 ? i + 1 : -1, x > 0 ? i - 1 : -1, i + n < N ? i + n : -1, i - n]) {
      if (j < 0 || seen[j] !== -2) continue;
      if (s.zone[j] && s.zone[j] !== 10 && !f.powered[j]) {
        seen[j] = i;
        hit = j;
        break;
      }
      if (s.occupant[j]) continue; // (a building stands in a line's way)
      seen[j] = i;
      queue.push(j);
    }
  }
  const path: [number, number][] = [];
  for (let i = hit >= 0 ? seen[hit]! : -1; i >= 0 && seen[i] !== -1; i = seen[i]!) path.push([i % n, Math.floor(i / n)]);
  path.reverse();
  const at = path.length ? path : null;
  lineMemo = { key, path: at };
  return at;
}
let lineMemo: { key: string; path: [number, number][] | null } | null = null;

/**
 * The shortest road from a facility's side to the nearest street, road or avenue at grade, over open dry land only
 * (no building, zone or other network on the way: nothing torn up or rezoned, no bridge), up to 40 tiles; null if none.
 * (What its 도로에 닿지 않음 wants: garbage trucks, and a station's crews, leave by a road beside it.)
 */
export function roadToFacility(f: Structure): [number, number][] | null {
  const key = `road|${f.id}|${siteKey()}`;
  if (roadMemo?.key === key) return roadMemo.path;
  const s = city.state;
  const n = city.size;
  const open = (i: number) => !s.occupant[i] && !s.zone[i] && !s.net[i] && s.terrain[i] !== Terrain.Water && s.landform[i] !== 2; // (2: a volcano's cone)
  const road = (i: number) => isLocalNet(s.net[i]!) && !s.tunnel[i];
  const from = new Int32Array(n * n).fill(-2); // -2 unseen, -1 beside the facility, else the tile it was reached from
  const depth = new Uint8Array(n * n);
  const queue: number[] = [];
  // From the tiles along its sides (not its corners: a road there doesn't front it).
  for (let y = f.y - 1; y <= f.y + f.h; y++) {
    for (let x = f.x - 1; x <= f.x + f.w; x++) {
      const side = (x === f.x - 1 || x === f.x + f.w) !== (y === f.y - 1 || y === f.y + f.h);
      if (!side || x < 0 || y < 0 || x >= n || y >= n || !open(y * n + x)) continue;
      from[y * n + x] = -1;
      queue.push(y * n + x);
    }
  }
  let hit = -1;
  for (let h = 0; h < queue.length && hit < 0; h++) {
    const i = queue[h]!;
    const x = i % n;
    for (const j of [x < n - 1 ? i + 1 : -1, x > 0 ? i - 1 : -1, i + n < n * n ? i + n : -1, i - n]) {
      if (j < 0) continue;
      if (road(j)) { hit = i; break; }
      if (from[j] !== -2 || !open(j) || depth[i]! >= 40) continue;
      from[j] = i;
      depth[j] = depth[i]! + 1;
      queue.push(j);
    }
  }
  const path: [number, number][] = [];
  for (let i = hit; i >= 0; i = from[i]!) path.push([i % n, Math.floor(i / n)]);
  path.reverse();
  const at = path.length ? path : null;
  roadMemo = { key, path: at };
  return at;
}
let roadMemo: { key: string; path: [number, number][] | null } | null = null;

/**
 * The shortest pipe from a network with water to spare to where buildings go dry: to a network running short or with
 * no water (joining it), or to within reach of a building no network covers, over land only (pipes stop at open
 * water), up to 60 tiles; null if none. (What 수도망이 나뉘어… 수도관으로 망을 이어 left to be found.)
 */
export function pipeToDry(): [number, number][] | null {
  const key = `pipe|${siteKey()}`;
  if (pipeLineMemo?.key === key) return pipeLineMemo.path;
  const s = city.state;
  const f = city.fields;
  const n = city.size;
  const N = n * n;
  const r = city.cfg.services.waterRadius;
  const node = new Uint8Array(N); // pipes and pumps: the water networks (f.waterNet names each)
  for (let i = 0; i < N; i++) if (s.pipe[i]) node[i] = 1;
  const spare = new Set<number>();
  for (const st of s.structures.values()) {
    if (!STRUCTURES[st.kind].pump) continue;
    for (let y = st.y; y < st.y + st.h; y++) for (let x = st.x; x < st.x + st.w; x++) node[y * n + x] = 1;
    if (st.capacity - st.load > 0.05 * st.capacity) spare.add(f.waterNet[st.y * n + st.x]!);
  }
  // Networks with buildings dry on them (rationing, or with no source), and tiles within reach of a building none
  // covers. (Only those: a stub of pipe with nobody on it was joined first, and the 444 dry stayed dry.)
  const wants = new Map<number, number>(); // network → its dry buildings
  const near = new Uint16Array(N); // how many uncovered dry buildings a pipe here would reach
  let dry = false;
  for (const b of s.buildings.values()) {
    if (!b.type || b.watered) continue;
    const g = f.waterNet[b.y * n + b.x]!;
    dry = true;
    if (g >= 0) { wants.set(g, (wants.get(g) ?? 0) + 1); continue; }
    for (let y = Math.max(0, b.y - r); y < Math.min(n, b.y + b.h + r); y++) for (let x = Math.max(0, b.x - r); x < Math.min(n, b.x + b.w + r); x++) near[y * n + x]!++;
  }
  const short = wants;
  for (const g of short.keys()) spare.delete(g);
  let path: [number, number][] | null = null;
  if (dry && spare.size) {
    const from = new Int32Array(N).fill(-2); // -2 unseen, -1 a network with water to spare, else the tile it was reached from
    const depth = new Uint8Array(N);
    const queue: number[] = [];
    for (let i = 0; i < N; i++) if (node[i] && spare.has(f.waterNet[i]!)) { from[i] = -1; queue.push(i); }
    // Layer by layer: of the shortest, the one that waters the most (cutting a long pipe left several stubs dry,
    // and the first found joined twenty buildings while hundreds waited).
    let hit = -1;
    let gain = 0;
    for (let layer = queue; layer.length && hit < 0;) {
      const next: number[] = [];
      for (const i of layer) {
        const x = i % n;
        for (const j of [x < n - 1 ? i + 1 : -1, x > 0 ? i - 1 : -1, i + n < N ? i + n : -1, i - n]) {
          if (j < 0 || from[j] !== -2 || s.terrain[j] === Terrain.Water) continue;
          // A pipe of a network with dry buildings beside it joins the two; a tile within reach of the uncovered waters them.
          const joins = node[j] ? wants.get(f.waterNet[j]!) ?? 0 : 0;
          if (joins) {
            if (joins > gain) [hit, gain] = [i, joins];
            continue;
          }
          if (depth[i]! >= 60) continue;
          from[j] = i;
          depth[j] = depth[i]! + 1;
          if (near[j]) {
            if (near[j]! > gain) [hit, gain] = [j, near[j]!];
            continue;
          }
          next.push(j);
        }
      }
      layer = next;
    }
    const at: [number, number][] = [];
    for (let i = hit; i >= 0 && from[i] !== -1; i = from[i]!) at.push([i % n, Math.floor(i / n)]);
    path = at.length ? at.reverse() : null;
  }
  pipeLineMemo = { key, path };
  return path;
}
let pipeLineMemo: { key: string; path: [number, number][] | null } | null = null;

/** What a one-press path lays (the guide's 바로 잇기, the info card's 도로 잇기). */
export type Lay = 'powerline' | 'road' | 'pipe';
export const LAY_WORD: Record<Lay, string> = { powerline: '송전선', road: '도로', pipe: '수도관' };

/**
 * What laying a path costs now, or null if it can't be laid as it is: a line's tiles a line or zone already covers
 * are free (the tool skips them), as a pipe's already piped; a road goes only over open land (a zone or a network
 * there since: found again).
 */
export function layCost(lay: Lay, line: readonly [number, number][]): number | null {
  const s = city.state;
  const n = city.size;
  // (Pipes run under anything on land.)
  if (lay === 'pipe') return line.some(([x, y]) => s.terrain[y * n + x] === Terrain.Water) ? null : line.filter(([x, y]) => !s.pipe[y * n + x]).length * city.cfg.services.pipeCost.build;
  if (line.some(([x, y]) => s.occupant[y * n + x] !== 0)) return null;
  if (lay === 'powerline') return line.filter(([x, y]) => !s.power[y * n + x] && !s.zone[y * n + x]).length * city.cfg.services.powerLineCost.build;
  if (line.some(([x, y]) => s.zone[y * n + x] || s.net[y * n + x])) return null;
  let cost = 0;
  for (const [x0, y0, x1, y1] of straightRuns(line)) {
    const p = city.previewNetwork(x0, y0, x1, y1, 'road');
    if (!p.ok && p.message !== 'not enough funds') return null;
    cost += p.cost;
  }
  return cost;
}

/** A path tile by tile as its straight runs, end to end (a line or road tool lays one run at a time). */
export function straightRuns(path: readonly [number, number][]): [number, number, number, number][] {
  const runs: [number, number, number, number][] = [];
  let from = path[0]!;
  for (let k = 2; k < path.length; k++) {
    const [a, b, c] = [path[k - 2]!, path[k - 1]!, path[k]!];
    if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1]) {
      runs.push([from[0], from[1], b[0], b[1]]);
      from = b;
    }
  }
  if (path.length) runs.push([from[0], from[1], path.at(-1)![0], path.at(-1)![1]]);
  return runs;
}

/** The middle of the city's homes (the map's middle while there are none). */
function homesMiddle(): [number, number] {
  let [sx, sy, count] = [0, 0, 0];
  for (const b of city.state.buildings.values()) {
    if (b.type?.[0] !== 'R') continue;
    sx += b.x + b.w / 2;
    sy += b.y + b.h / 2;
    count++;
  }
  return count ? [Math.round(sx / count), Math.round(sy / count)] : [city.size >> 1, city.size >> 1];
}

/**
 * A site for one more water source where its water counts: touching a pipe (a pump or tower joins the
 * network of the pipe beside it; one standing alone waters only what is around it), in reach of power
 * (a pump without it gives nothing) and on clean water, nearest the homes. Its middle tile, or null.
 */
export function siteOnPipes(kind: StructureKind): [number, number] | null {
  if (!buildable(kind)) return null;
  const key = `pipes|${kind}|${siteKey()}`;
  if (pipeMemo?.key === key) return pipeMemo.at;
  const s = city.state;
  const n = city.size;
  const d = STRUCTURES[kind];
  const limit = city.cfg.services.pumpPollutionLimit;
  const [ax, ay] = homesMiddle();
  const clean = (lx: number, ly: number) => {
    for (let y = ly; y < ly + d.h; y++) for (let x = lx; x < lx + d.w; x++) if (city.fields.waterPollution[y * n + x]! > limit) return false;
    return true;
  };
  // Every open footprint against a pipe tile (on each side of it), nearest the homes first; the engine is
  // asked about them in that order, until one will do (asking about all of them took 60 ms on a big map).
  const cands: [number, number, number][] = [];
  for (let i = 0; i < n * n; i++) {
    if (!s.pipe[i]) continue;
    const x = i % n;
    const y = (i - x) / n;
    for (const [lx, ly] of [[x + 1, y], [x - d.w, y], [x, y + 1], [x, y - d.h]] as const) {
      if (footprintOpen(lx, ly, d.w, d.h) && clean(lx, ly)) cands.push([(lx + d.w / 2 - ax) ** 2 + (ly + d.h / 2 - ay) ** 2, lx, ly]);
    }
  }
  cands.sort((a, b) => a[0] - b[0]);
  const fit = cands.find(([, lx, ly]) => city.canPlaceStructure(kind, lx, ly).ok && city.powerReach(kind, lx, ly) === 'powered');
  const at: [number, number] | null = fit ? [fit[1] + ((d.w - 1) >> 1), fit[2] + ((d.h - 1) >> 1)] : null;
  pipeMemo = { key, at };
  return at;
}
let pipeMemo: { key: string; at: [number, number] | null } | null = null;

/**
 * The nearest spot to (x, y), within `reach` tiles, where `kind` fits with a road beside it (as suggestSpot's
 * sites do): its middle tile, or null. (Beside an overfull hospital: the spot was found for the facility that
 * would relieve it, and the one recommended may be bigger.)
 */
export function siteNear(kind: StructureKind, x: number, y: number, reach = 12): [number, number] | null {
  if (!buildable(kind)) return null;
  const key = `${kind}|${x},${y}|${reach}|${siteKey()}`;
  if (nearMemo.has(key)) return nearMemo.get(key)!;
  const d = STRUCTURES[kind];
  // (A smoky plant clear of homes, as suggestSpot sites one: the nearest open lot beside a mark among the
  // dark zones was a zoned lot among the homes.)
  const smoky = smokyPlant(kind);
  const at = nearestFit(kind, x, y, reach, (lx, ly) => city.roadBeside(lx, ly, d.w, d.h) && !(smoky && homesNear(lx, ly, d.w, d.h)));
  // (A few kept: the mark's own check and its nearest fit, a full school's card, ran by turns and found again each time.)
  if (nearMemo.size >= 8) nearMemo.delete(nearMemo.keys().next().value!);
  nearMemo.set(key, at);
  return at;
}
let nearMemo = new Map<string, [number, number] | null>();

/**
 * A plant whose smoke homes shouldn't have beside them: coal and oil (as the getting-started list says it). A gas
 * plant smokes a third as much; held to the same rule it was sited out of reach of a town of homes alone, and
 * its 추천 자리 powered nothing.
 */
export const smokyPlant = (kind: StructureKind): boolean => (STRUCTURES[kind].plant?.air[0] ?? 0) >= 100;

/** Homes (a residential zone) within 6 tiles of a rectangle: no place for a smoky plant. */
function homesNear(lx: number, ly: number, w: number, h: number): boolean {
  const s = city.state;
  const n = city.size;
  const R = 6;
  for (let y = Math.max(0, ly - R); y < Math.min(n, ly + h + R); y++) for (let x = Math.max(0, lx - R); x < Math.min(n, lx + w + R); x++) {
    const z = s.zone[y * n + x]!;
    if (z >= 1 && z <= 3) return true;
  }
  return false;
}

/**
 * A site for one more power plant while nothing is dark yet (only the margin is short, so the map has no
 * mark): beside a plant the city has (clear of homes and on the grid already), with a road beside it, in
 * reach of the powered grid and, for a smoky one, away from homes. Its middle tile, or null.
 */
export function siteByPlants(kind: StructureKind): [number, number] | null {
  if (!buildable(kind)) return null;
  const key = `plants|${kind}|${siteKey()}`;
  if (plantMemo?.key === key) return plantMemo.at;
  const d = STRUCTURES[kind];
  const smoky = smokyPlant(kind);
  const fits = (lx: number, ly: number) => city.roadBeside(lx, ly, d.w, d.h) && city.powerReach(kind, lx, ly) === 'powered' && !(smoky && homesNear(lx, ly, d.w, d.h));
  let at: [number, number] | null = null;
  let near = Infinity;
  for (const p of city.state.structures.values()) {
    if (!STRUCTURES[p.kind].plant) continue;
    const [cx, cy] = [p.x + (p.w >> 1), p.y + (p.h >> 1)];
    // (Nearest of all the plants': each looked at no further than the best found so far.)
    const found = nearestFit(kind, cx, cy, Math.min(16, near - 1), fits);
    if (!found) continue;
    const r = Math.max(Math.abs(found[0] - cx), Math.abs(found[1] - cy));
    if (r < near) [near, at] = [r, found];
  }
  plantMemo = { key, at };
  return at;
}
let plantMemo: { key: string; at: [number, number] | null } | null = null;

/**
 * A site for a facility that serves no area and that homes would rather not have beside them (a jail):
 * beside a road, no residential zone within 6 tiles, nearest the industry (else the map's middle).
 * Its middle tile, or null.
 */
export function siteAwayFromHomes(kind: StructureKind): [number, number] | null {
  if (!buildable(kind)) return null;
  const key = `away|${kind}|${siteKey()}`;
  if (awayMemo?.key === key) return awayMemo.at;
  const n = city.size;
  const d = STRUCTURES[kind];
  let [sx, sy, count] = [0, 0, 0];
  for (const b of city.state.buildings.values()) {
    if (b.type?.[0] !== 'I') continue;
    sx += b.x + b.w / 2;
    sy += b.y + b.h / 2;
    count++;
  }
  const [ax, ay] = count ? [Math.round(sx / count), Math.round(sy / count)] : [n >> 1, n >> 1];
  const at = nearestFit(kind, ax, ay, n, (lx, ly) => city.roadBeside(lx, ly, d.w, d.h) && !homesNear(lx, ly, d.w, d.h));
  awayMemo = { key, at };
  return at;
}
let awayMemo: { key: string; at: [number, number] | null } | null = null;

/**
 * A landfill to zone now: square, sized to hold about a year of the city's garbage (4×4 to 10×10), on open dry land
 * (no building, network or zone) with a road along it, near the industry and with no homes or shops within 10
 * tiles (its smell carries; within 6 if nothing is that far); its corners, tiles and price, or null if none.
 */
export function landfillSite(): { x0: number; y0: number; x1: number; y1: number; side: number; cost: number } | null {
  const key = `landfill|${siteKey()}`;
  if (fillMemo?.key === key) return fillMemo.at;
  const s = city.state;
  const n = city.size;
  const lf = city.cfg.garbage.landfill;
  const side = Math.max(4, Math.min(10, Math.ceil(Math.sqrt((readStats().garbage.produced * 12) / lf.tileCapacity))));
  const cost = side * side * lf.zoneCost;
  let at: { x0: number; y0: number; x1: number; y1: number; side: number; cost: number } | null = null;
  if (cost <= s.funds) {
    // Sums over rectangles in O(1): tiles in the way, and homes or shops.
    const W = n + 1;
    const busy = new Int32Array(W * W);
    const homes = new Int32Array(W * W);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const z = s.zone[i]!;
        const b = s.occupant[i] || s.net[i] || z || s.terrain[i] === Terrain.Water || s.landform[i] === 2 ? 1 : 0; // (2: a volcano's cone)
        const h = z >= 1 && z <= 6 ? 1 : 0; // (homes and shops: R and C zones)
        const k = (y + 1) * W + x + 1;
        busy[k] = b + busy[k - 1]! + busy[k - W]! - busy[k - W - 1]!;
        homes[k] = h + homes[k - 1]! + homes[k - W]! - homes[k - W - 1]!;
      }
    }
    const sum = (t: Int32Array, x0: number, y0: number, x1: number, y1: number) => {
      [x0, y0, x1, y1] = [Math.max(0, x0), Math.max(0, y0), Math.min(n, x1), Math.min(n, y1)];
      return t[y1 * W + x1]! - t[y0 * W + x1]! - t[y1 * W + x0]! + t[y0 * W + x0]!;
    };
    let [sx, sy, count] = [0, 0, 0];
    for (const b of s.buildings.values()) {
      if (b.type?.[0] !== 'I') continue;
      sx += b.x + b.w / 2;
      sy += b.y + b.h / 2;
      count++;
    }
    const [ax, ay] = count ? [Math.round(sx / count), Math.round(sy / count)] : [n >> 1, n >> 1];
    for (const R of [10, 6]) {
      for (let r = 0; r <= n && !at; r++) {
        onRing(r, (dx, dy) => {
          const [lx, ly] = [ax + dx - (side >> 1), ay + dy - (side >> 1)];
          if (lx < 0 || ly < 0 || lx + side > n || ly + side > n) return false;
          if (sum(busy, lx, ly, lx + side, ly + side) || sum(homes, lx - R, ly - R, lx + side + R, ly + side + R)) return false;
          if (!city.roadBeside(lx, ly, side, side)) return false;
          at = { x0: lx, y0: ly, x1: lx + side - 1, y1: ly + side - 1, side, cost };
          return true;
        });
      }
      if (at) break;
    }
  }
  fillMemo = { key, at };
  return at;
}
let fillMemo: { key: string; at: ReturnType<typeof landfillSite> } | null = null;

/**
 * Sites for a pair of bus stops: one where the most people live, one where the most work (a stop alone carries
 * no one: a trip rides from a stop near home to one near work), each beside a road and within 8 tiles of the
 * middle of its block (blocks of 12 tiles). Their middle tiles, or null.
 */
export function stopPair(kind: StructureKind): [[number, number], [number, number]] | null {
  if (!buildable(kind, 2)) return null;
  const key = `stops|${kind}|${siteKey()}`;
  if (pairMemo?.key === key) return pairMemo.at;
  const n = city.size;
  const B = 12;
  const per = Math.ceil(n / B);
  const busiest = (weigh: (b: Building) => number): [number, number] | null => {
    const sum = new Float64Array(per * per);
    const sx = new Float64Array(per * per);
    const sy = new Float64Array(per * per);
    for (const b of city.state.buildings.values()) {
      const v = weigh(b);
      if (v <= 0) continue;
      const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
      const k = Math.min(per - 1, Math.floor(cy / B)) * per + Math.min(per - 1, Math.floor(cx / B));
      sum[k] = sum[k]! + v;
      sx[k] = sx[k]! + cx * v;
      sy[k] = sy[k]! + cy * v;
    }
    let best = -1;
    for (let k = 0; k < sum.length; k++) if (sum[k]! > 0 && (best < 0 || sum[k]! > sum[best]!)) best = k;
    return best < 0 ? null : [Math.floor(sx[best]! / sum[best]!), Math.floor(sy[best]! / sum[best]!)];
  };
  const home = busiest((b) => (b.type?.[0] === 'R' ? b.capacity * b.occupancy : 0));
  const work = busiest((b) => (b.type && b.type[0] !== 'R' ? b.capacity * b.occupancy : 0));
  let at: [[number, number], [number, number]] | null = null;
  // (Home and work in one block: a bus between them would save no one a trip.)
  if (home && work && Math.max(Math.abs(home[0] - work[0]), Math.abs(home[1] - work[1])) >= 8) {
    const a = siteNear(kind, home[0], home[1], 8);
    const b = a && siteNear(kind, work[0], work[1], 8);
    // (Home and work 8 to 16 tiles apart could land on the same free tile: one stop, not a pair.)
    if (a && b && (a[0] !== b[0] || a[1] !== b[1])) at = [a, b];
  }
  pairMemo = { key, at };
  return at;
}
let pairMemo: { key: string; at: [[number, number], [number, number]] | null } | null = null;

/** The biggest patch the goal's service doesn't reach (worked out once a week of game time or after an edit). */
let spotMemo: { key: string; spot: { x: number; y: number; tiles: number; crowded?: true } | null } | null = null;
/** Buildings go without water though the pumps make enough for all: their networks aren't joined. */
export function waterApart(): boolean {
  const w = readStats().water;
  return w.shortages > 0 && w.supply >= w.demand * 1.1;
}

/**
 * For a school or hospital at (x, y) that is over its places: the cheapest unlocked kind of the same
 * level (an elementary school took nothing from a striking high school, and the strike went on).
 */
/**
 * Would full funding mend a school or hospital's trouble (the info card's 예산 100%로 and the guide's say the same)?
 * Back within its places at 100%, or, on strike, its grade there reaching the strike's end; past that, one more
 * beside it is the fix. (Police and fire stations have no places: their budget alone ends a strike.)
 */
export function budgetMends(f: Structure, strike: boolean): boolean {
  const svc = STRUCTURES[f.kind].health ?? STRUCTURES[f.kind].school;
  if (f.funding >= 100) return false;
  return !svc || f.load * (strike ? city.cfg.services.strikeEndGrade : 1) <= svc.capacity;
}

export function relieverFor(at: readonly [number, number]): StructureKind | null {
  const kind = city.query(at[0], at[1])?.structure?.kind;
  if (!kind) return null;
  const d = STRUCTURES[kind];
  // (Health by its class as the engine splits patients: a clinic takes none of a full research lab's.)
  const healthClass = (k: StructureKind) => { const h = STRUCTURES[k].health; return !h ? null : h.radius < 300 ? 'hospital' : h.boost >= 1 ? 'research' : 'market'; };
  const same = (k: StructureKind) => (d.school ? STRUCTURES[k].school?.curve === d.school.curve : !!d.health && healthClass(k) === healthClass(kind));
  const kinds = (Object.keys(STRUCTURES) as StructureKind[]).filter((k) => same(k) && city.isUnlocked(k) && city.placementsLeft(k) > 0);
  return kinds.reduce<StructureKind | null>((a, k) => (!a || STRUCTURES[k].cost < STRUCTURES[a].cost ? k : a), null);
}

export function suggestSpot(id: GoalId): { x: number; y: number; tiles: number; crowded?: true } | null {
  const key = `${id}|${changeKey()}`;
  if (spotMemo?.key === key) return spotMemo.spot;
  // A school or hospital on strike or far over its places: the new one goes beside it, to take some of
  // its load (built where homes were out of reach, a school a month went up and the strike went on).
  const over = id === 'education' || id === 'health'
    ? adviceFor(id).find((a) => a.at && ['schoolStrike', 'hospitalStrike', 'schoolFull', 'hospitalFull'].includes(a.code)) : undefined;
  const kind = over ? relieverFor(over.at!) ?? cheapestOf(GOALS[id]) : null;
  if (over && kind) {
    const d = STRUCTURES[kind];
    const [ax, ay] = over.at!;
    for (let r = 1; r <= 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const [x, y] = [ax + dx, ay + dy];
      const [lx, ly] = [x - ((d.w - 1) >> 1), y - ((d.h - 1) >> 1)]; // (a spot is the site's middle)
      if (!city.canPlaceStructure(kind, lx, ly).ok || !city.roadBeside(lx, ly, d.w, d.h)) continue;
      const spot = { x, y, tiles: 0, crowded: true as const };
      spotMemo = { key, spot };
      return spot;
    }
  }
  const want = need(id);
  let spot: { x: number; y: number; tiles: number } | null = null;
  if (want) {
    // Counted in blocks of 12 tiles; the fullest block's middle of its needing tiles.
    const n = city.size;
    const B = 12;
    const per = Math.ceil(n / B);
    const count = new Float64Array(per * per);
    const sx = new Float64Array(per * per);
    const sy = new Float64Array(per * per);
    const hits = new Uint32Array(per * per);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = want(y * n + x);
      if (!v) continue;
      const b = Math.floor(y / B) * per + Math.floor(x / B);
      count[b] = count[b]! + v;
      hits[b] = hits[b]! + 1;
      sx[b] = sx[b]! + x * v;
      sy[b] = sy[b]! + y * v;
    }
    let best = -1;
    for (let b = 0; b < count.length; b++) if (count[b]! > (best < 0 ? 0 : count[best]!)) best = b;
    // A handful of tiles is noise at the edge of a zone, not a gap worth a building.
    if (best >= 0 && hits[best]! >= 6) {
      // The middle of them, moved to the nearest open ground (a building's tile can't take a new one).
      const cx = Math.round(sx[best]! / count[best]!);
      const cy = Math.round(sy[best]! / count[best]!);
      const s = city.state;
      const open = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && s.occupant[y * n + x] === 0 && !s.net[y * n + x] && s.terrain[y * n + x] !== Terrain.Water;
      let at: [number, number] = [cx, cy];
      // A jam is marked on the road itself (the worst of it): widening it, or a stop beside it, is the fix.
      if (id === 'traffic') {
        let top = 0;
        const bx = (best % per) * B;
        const by = Math.floor(best / per) * B;
        for (let y = by; y < Math.min(n, by + B); y++) for (let x = bx; x < Math.min(n, bx + B); x++) {
          const v = want(y * n + x);
          if (v > top) [top, at] = [v, [x, y]];
        }
      } else if (id === 'water' && waterApart()) {
        // Networks apart: the dry buildings are the place (to pipe to), not a site for one more pump.
      } else if (id === 'garbage') {
        // Where the rubbish lies, not where to put a landfill (among the homes was the wrong idea).
      } else {
        // A service's smallest station: the nearest place it fits with a road beside it (open ground alone
        // was rubble, or a tile with no road, where the station can't go out). Power and water: a site for
        // a plant or a pump near the trouble, and a smoky plant clear of homes (the target was tapped to
        // build, and put a gas plant on top of a zone, or on a crossroads).
        const kind = SERVICE.has(id) ? cheapestOf(GOALS[id]) : id === 'power' ? siteKind('power') : id === 'water' ? siteKind('water') : null;
        // Smoke and homes: any plant that smokes (as the placement warning counts it) is best clear of them;
        // coal and oil must be (see smokyPlant).
        const dirty = !!kind && (STRUCTURES[kind].plant?.air[0] ?? 0) >= 50;
        const smoky = !!kind && smokyPlant(kind);
        const fits = (x: number, y: number, clear: boolean) => {
          if (!open(x, y)) return false;
          if (!kind) return true;
          const d = STRUCTURES[kind];
          const [lx, ly] = [x - ((d.w - 1) >> 1), y - ((d.h - 1) >> 1)];
          return city.canPlaceStructure(kind, lx, ly).ok && city.roadBeside(lx, ly, d.w, d.h) && !(clear && homesNear(lx, ly, d.w, d.h));
        };
        const reach = id === 'power' || id === 'water' ? 3 * B : B;
        // A plant first where it feeds a zone at once (within its reach, beside the industry as a rule):
        // one clear of homes but with nothing in reach was built from the screen and still needed a line.
        const feeds = (x: number, y: number) => {
          if (id !== 'power' || !kind) return true;
          const d = STRUCTURES[kind];
          return city.powerReach(kind, x - ((d.w - 1) >> 1), y - ((d.h - 1) >> 1)) !== 'none';
        };
        // Passes, best first: feeding and clear of homes; feeding, near homes if it isn't coal or oil (a town
        // of homes alone had no site both, and its gas plant went out of reach and powered nothing — the
        // placement still warns of the smoke); clear of homes, a line still to lay.
        // (The second pass only where it differs from the first: for coal, oil or a clean plant it was the same scan again.)
  const passes = id === 'power' ? [{ feed: true, clear: dirty }, ...(smoky !== dirty ? [{ feed: true, clear: smoky }] : []), { feed: false, clear: dirty }] : [{ feed: false, clear: false }];
        search: for (const { feed, clear } of passes) {
          for (let r = 0; r <= reach; r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !fits(cx + dx, cy + dy, clear) || (feed && !feeds(cx + dx, cy + dy))) continue;
              at = [cx + dx, cy + dy];
              break search;
            }
          }
        }
      }
      spot = { x: at[0], y: at[1], tiles: hits[best]! };
    }
  }
  spotMemo = { key, spot };
  return spot;
}

/**
 * What is happening right now and can't wait for a plan: buildings and trees burning
 * (소방), mobs in the streets (치안). Each with where it is and the unit to send.
 */
export type Incident = { goal: 'fire' | 'police'; title: string; at: [number, number]; places: [number, number][]; tool: 'send-fire' | 'send-police'; urgent: boolean; riot?: boolean };
let incidentMemo: { key: string; list: Incident[] } | null = null;
export function incidents(): Incident[] {
  const s = city.state;
  const key = `${changeKey()}|${s.day}|${s.fires.length}|${s.treeFires.length}|${s.mobs.length}|${s.arsonists.length}`;
  if (incidentMemo?.key === key) return incidentMemo.list;
  const list: Incident[] = [];
  const fire: [number, number][] = [];
  for (const f of s.fires) {
    const where = f.target > 0 ? s.buildings.get(f.target) : s.structures.get(-f.target);
    if (where) fire.push([where.x, where.y]);
  }
  for (const t of s.treeFires) fire.push([t.i % s.size, Math.floor(t.i / s.size)]);
  // Urgent (stop the clock, lead 지금 할 일): several fires, or one beyond the fire stations' reach,
  // or on a plant; a lone fire inside cover is the stations' to put out (it took over the card for years).
  const cover = city.fields.fireCover;
  const onPlant = s.fires.some((f) => f.target < 0 && !!STRUCTURES[s.structures.get(-f.target)?.kind ?? 'park' as StructureKind]?.plant);
  const fireUrgent = fire.length >= 3 || onPlant || fire.some(([x, y]) => (cover[y * s.size + x] ?? 0) <= 0);
  if (fire.length) list.push({ goal: 'fire', title: `불이 났습니다: ${fmt(fire.length)}곳`, at: fire[0]!, places: fire, tool: 'send-fire', urgent: fireUrgent });
  if (s.mobs.length) list.push({ goal: 'police', title: `폭동이 일어났습니다: ${fmt(s.mobs.length)}곳`, at: [s.mobs[0]!.x, s.mobs[0]!.y], places: s.mobs.map((m) => [m.x, m.y]), tool: 'send-police', urgent: true, riot: true });
  // Arsonists show up before they strike: police on the spot lock them up.
  if (s.arsonists.length) {
    const days = Math.min(...s.arsonists.map((a) => a.days));
    list.push({ goal: 'police', title: `방화범이 보입니다: ${fmt(s.arsonists.length)}명 — ${fmt(days)}일 안에 경찰을 보내면 막습니다`, at: [s.arsonists[0]!.x, s.arsonists[0]!.y], places: s.arsonists.map((a) => [a.x, a.y]), tool: 'send-police', urgent: true });
  }
  incidentMemo = { key, list };
  return list;
}
