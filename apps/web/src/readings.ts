// Reading the city for the goals: each goal's state, figures and forecasts, where its
// trouble gathers on the map, and what would help (no DOM here: the screen is manage.ts).

import { type Building, DEV_TYPES, ELEVATED, isLocalNet, linePath, Net, NETWORK_KINDS, type PollTopic, STRUCTURES, Terrain, type Structure, type StructureKind, utilityEmissionShare, ZONES, type ZoneKind, zoneInfo } from '@web-city/engine';
import { noRiders } from './info';
import { ADVICE_TEXT, POLL_NAME, STRUCTURE_NAME, TYPE_NAME, WEALTH_NAME } from './names';
import { capLeads, crimeKinds, currentAdvice, garbageFill } from './panels';
import { changeKey, city, cityGeneration, cityLineage } from './state';
import { kindsFor, structureStat, TOOLS } from './tools';
import { coverageRadius } from './views';
import { fmt, landfillMonths, landfillSpan, money, short, straightRuns } from './util';
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
  // (What burns or riots now is read live below: the advisors' word on it lags — it kept a row red with "불이 2곳에서
  // 타고 있습니다" after the fire was out, and said nothing of a fire lit since.)
  const advice = adviceFor(id).filter((a) => a.code !== 'fires' && a.code !== 'riot');
  const worst: Tone = advice.some((a) => a.level === 'bad') ? 'bad' : advice.some((a) => a.level === 'neutral') ? 'warn' : '';
  // (Homes held at their cap with a park to lift it in hand: the growth row says that, as its screen leads with it.)
  const first = id === 'growth' && capLeads() ? advice.find((a) => a.code === 'capRes') : advice.find((a) => a.level !== 'good');
  const said = first ? fullNote(first, id) || (ADVICE_TEXT[first.code]?.(first.value ?? 0, first.type) ?? '').split(/[.:]/)[0]! : '';
  const pick = (tone: Tone, value: string, note: string, bar?: number) => {
    const t: Tone = tone === 'bad' || worst === 'bad' ? 'bad' : tone === 'warn' || worst === 'warn' ? 'warn' : tone;
    return { tone: t, value, note: said && t !== '' && t !== 'good' ? said : note, bar };
  };
  // Something happening now: its line says what, whatever else the advisors have to say.
  const now = (tone: Tone, value: string, note: string) => ({ ...pick(tone, value, note), note });
  switch (id) {
    case 'finance': {
      const b = s.lastBudget;
      const net = b ? b.income - b.expenses : 0;
      // A small deficit on a full treasury is a warning, not an alarm: red when the money runs out within two years.
      const months = net < 0 && st.funds > 0 ? st.funds / -net : Infinity;
      const tone: Tone = st.funds < 0 || months < 24 ? 'bad' : net < 0 ? 'warn' : '';
      const left = months < 120 ? ` · 이대로면 ${months >= 24 ? `${Math.floor(months / 12)}년` : `${Math.floor(months)}개월`} 뒤 바닥` : '';
      // (Taxes cutting a type's demand are the finance screen's to fix: 주의 with what they cost, where the money alone
      // read 양호 and nobody looked — 71% of the demand for rich homes was going.)
      // (Looked for by name: the rating's alarm, the city's once too, sorted before it and hid it.)
      const tax = advice.find((a) => a.code === 'taxHigh');
      const taxed = !tone && tax ? (ADVICE_TEXT.taxHigh?.(tax.value ?? 0, tax.type) ?? '').split(/[.:]/)[0]! : '';
      // (주의, not 급함, even where the rate stops a type's demand: a tax is changed at leisure, and red stopped the clock.)
      if (taxed) return { tone: 'warn', value: money(st.funds), note: taxed };
      return { tone, value: money(st.funds), note: b ? `지난달 ${net < 0 ? '−' : '+'}§${fmt(Math.abs(Math.round(net)))}${left}` : '첫 결산 전' };
    }
    case 'amenity': {
      // Read by the mayor's rating, its headline (what its parks lack is its 쾌적도 tab's to say).
      const r = st.mayorRating;
      const rated = ratingRated();
      // (Its own tone, not the advisors': a park missing coloured a sound rating amber.)
      return { tone: ratingTone(r), value: rated ? `시장 평점 ${r}` : '—', note: ratingNote(r) || (rated ? '−100~100 · 주민의 불만에서 나옵니다' : '주민이 든 달이 지나면 매겨집니다') };
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
      // A class held at its cap leads when nothing else is wanted much (the "농업 +520" headline hid it), or when the
      // row's word is the cap (a trickle of demand left at it kept "농업 수요 +521" over "주거 … 상한에 닿았습니다").
      const capWord = first?.code === 'capRes' ? 'R' : first?.code === 'capOffice' ? 'C' : first?.code === 'capIndustry' ? 'I' : undefined;
      const cappedCls = capWord ?? (['R', 'C', 'I'] as const).find((k) => DEV_TYPES.some((t) => t[0] === k && t !== 'IA' && capped(t)));
      if (cappedCls && (capWord || top(lead) < 100)) return pick('warn', `${CLASS_WORD[cappedCls]} 상한`, demandWords());
      return pick(st.abandoned > 0 ? 'warn' : '', headline(),
        `${demandWords()}${st.abandoned ? ` · 버려짐 ${fmt(st.abandoned)}` : ''}`);
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
      // (A landfill laid since the month's tally: waiting for it, not red and "못 치움" as if nothing were done.)
      const fresh = freshLandfill();
      const room = (fresh?.joined ? fresh.tiles : 0) * city.cfg.garbage.landfill.tileCapacity;
      if (room >= Math.max(1, (g.kept || g.produced - g.recycled) - g.incinerated) && (g.uncollected > 1 || (months !== null && months < 6))) return now('warn', `${short(g.kept || g.produced - g.recycled)} t/월`, '새 매립지 · 다음 달부터 수거');
      return pick(f.tone as Tone, `${short(g.kept || g.produced - g.recycled)} t/월`,
        (g.routeCutOff ?? 0) > 1 ? `처리장과 끊긴 수거망 ${fmt(g.routeCutOff!)} t` : g.uncollected > 1 ? `못 치움 ${fmt(g.uncollected)} t` : months !== null ? `매립지 ${landfillSpan(months)} 남음` : '매립·소각·재활용', f.ratio);
    }
    case 'police': {
      const c = st.safety.crimes;
      const prev = s.history.at(-2)?.crimes;
      // (A red row says why it is red: under a riot it read "체포 4".)
      if (s.mobs.length) return now('bad', `범죄 ${fmt(c)}`, `폭동 ${fmt(s.mobs.length)}곳 진행 중`);
      if (s.arsonists.length) return now('bad', `범죄 ${fmt(c)}`, `방화범 ${fmt(s.arsonists.length)}명 · ${fmt(Math.min(...s.arsonists.map((a) => a.days)))}일 안에 불을 지름`);
      return pick('', `범죄 ${fmt(c)}`, `체포 ${fmt(st.safety.arrests)}${prev !== undefined && c > prev * 1.2 && c - prev > 5 ? ' · 늘어남' : ''}`);
    }
    case 'fire': {
      // A lone fire inside the stations' cover is theirs to put out: 주의, not 급함 (it had the row red and
      // "급한 일 1" with no card above and "지난달 · 전소 0" for a reason).
      const inc = incidents().find((x) => x.goal === 'fire');
      if (inc) return now(inc.urgent ? 'bad' : 'warn', `불타는 중 ${fmt(inc.places.length)}`, `불 ${fmt(inc.places.length)}곳 · ${inc.why}`);
      return pick('', `화재 ${fmt(st.safety.fires)}`, `지난달 · 전소 ${fmt(st.safety.burned)}`);
    }
    case 'health': {
      const list = facilities(GOALS.health);
      const [l, c] = loadOf(list);
      // (No one to be healthy yet: a dash, as the other rows with nothing to read — "건강 지수 0" read as a sick town.)
      return pick(c > 0 && l > c ? 'warn' : '', sum(st.residents) ? `건강 지수 ${Math.round(avg(st.hq, st.residents))}` : '—', list.length ? `환자 ${fmt(l)} / 정원 ${fmt(c)}${l > c ? ' · 넘침' : ''}` : '병원 없음', c ? l / c : undefined);
    }
    case 'education': {
      const list = facilities(GOALS.education).filter((f) => classroom(f.kind));
      const [l, c] = loadOf(list);
      // By level: seats at a primary school don't take high-school students (the total hid a full high school).
      const lv = levelShort();
      const over = lv && lv.load > lv.cap;
      return pick(c > 0 && (l > c || over) ? 'warn' : '', sum(st.residents) ? `교육 지수 ${Math.round(avg(st.eq, st.residents))}` : '—',
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
        why = jams >= 10 ? `막힌 길 ${fmt(jams)}칸` : !transit ? '대중교통 없음 · 일터가 멀거나 길이 느림' : '일터가 멀거나 길이 느림';
      }
      // (Named, as the other rows' figures are — 건강 지수 23, 대기 오염 73: a bare 1시간 16분 said not of what.)
      return pick(h !== undefined && h > 1 ? 'warn' : '', h ? `통근 ${minutes(h)}` : '—', h ? why : '아직 통근하는 주민 없음');
    }
    case 'environment': {
      const air = s.history.at(-1)?.air;
      if (air === undefined) return pick('', '—', '첫 달이 지나면 기록됩니다');
      // The mean over all land counts the industry's own air too: what wants a hand is homes breathing it.
      const homes = smoggyHomes();
      // (Where it comes from, said with it: most of it from one kind, or the two that bring the most.)
      const [a, b] = airSources().filter((x) => x.key !== 'rest');
      const from = !a ? '낮을수록 좋음' : a.share >= 0.5 || !b ? `주로 ${a.label}` : `${a.label}·${b.label} 등`;
      return pick(air > 40 && homes > 0 ? 'warn' : '', `대기 오염 ${air.toFixed(0)}`,
        homes > 0 ? `공기 나쁜 주거지 ${fmt(homes)}칸 · ${from}` : '낮을수록 좋음 · 주거지 공기는 괜찮음');
    }
    case 'land': {
      // What the ground under the buildings is worth (by the water, above the town's average height): a figure to build
      // by — where the wealthy will want to live — not an alarm.
      // (Written as the rail's graph writes it, to a tenth: "—" beside its "0.3" read as two figures.)
      const v = landUnder().v;
      return pick('', v !== undefined ? `평균 땅값 ${v.toFixed(1)}` : '—', v === undefined ? '건물이 들어서면 그 아래 땅값을 셉니다' : v >= 0.5 ? '물가와 주변보다 높은 땅일수록 높음' : '평지라 차이 없음 · 물가나 높은 땅이 값을 올립니다');
    }
  }
}

/** Each class's demand in words, as 수요's row says it: "주거 +709 · 상업 +172 · 산업 +294 · 농업 +172". */
export function demandWords(): string {
  const dem = city.demand.demand;
  const top = (k: string) => Math.max(...DEV_TYPES.filter((t) => t[0] === k && t !== 'IA').map((t) => dem[t]));
  return `${(['R', 'C', 'I'] as const).map((k) => `${CLASS_WORD[k]} ${top(k) >= 1 ? `+${short(top(k))}` : '0'}`).join(' · ')}${dem.IA >= 1 ? ` · 농업 +${short(dem.IA)}` : ''}`;
}

/**
 * What an area's rail button says beside its own figure, in its tooltip (its face has the graph): the share used of
 * what it has (power, water), how much of the town its service reaches (police, fire), how full its places run
 * (health, education), how long the landfill lasts or how busy the incinerators are, each class's demand and the
 * jobs (수요). '' with nothing to read.
 */
export function railFigure(id: GoalId): string {
  const st = readStats();
  const s = city.state;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  switch (id) {
    case 'growth': return `${demandWords()} · 일자리 ${fmt(st.jobs)}`;
    case 'finance': {
      // (The month's balance, beside the money: its row's graph is what came in and went out.)
      const b = s.lastBudget;
      const net = b ? Math.round(b.income - b.expenses) : 0;
      return b ? `지난달 ${net < 0 ? '−' : '+'}§${fmt(Math.abs(net))}` : '';
    }
    case 'power': case 'water': {
      const { demand, supply } = id === 'power' ? st.power : st.water;
      return supply > 0 ? `사용 ${pct(demand / supply)}` : '';
    }
    case 'garbage': {
      const g = st.garbage;
      const months = landfillMonths(g);
      const room = sum([...s.structures.values()].filter((x) => STRUCTURES[x.kind].incinerator).map((x) => x.capacity));
      return [months !== null && Number.isFinite(months) ? `매립지 ${landfillSpan(months)} 남음` : '', room > 0 ? `소각 ${pct(Math.min(1, g.incinerated / room))}` : ''].filter(Boolean).join(' · ');
    }
    case 'police': case 'fire': {
      const cover = id === 'police' ? city.fields.policeCover : city.fields.fireCover;
      const n = s.size;
      let all = 0;
      let reached = 0;
      for (const b of s.buildings.values()) {
        if (!b.type) continue;
        all++;
        if (cover[(b.y + (b.h >> 1)) * n + b.x + (b.w >> 1)]! > 0) reached++;
      }
      return all ? `범위 안 건물 ${pct(reached / all)}` : '';
    }
    case 'health': case 'education': {
      const [l, c] = loadOf(facilities(GOALS[id]).filter((f) => id === 'health' || classroom(f.kind)));
      return c ? `정원의 ${pct(l / c)} 이용` : '';
    }
    default: return '';
  }
}

/**
 * A full hospital or school as its row says it: which, and the whole beside it ("정원의 181%인 병원·보건소가 있습니다"
 * read against the 114% under it, which is all of them together).
 */
export function fullNote(a: { code: string; value?: number; at?: [number, number] }, id: GoalId): string {
  if ((a.code !== 'hospitalFull' && a.code !== 'schoolFull') || !a.at) return '';
  const v = a.value ?? 0;
  const s = city.state;
  const occ = s.occupant[a.at[1] * s.size + a.at[0]] ?? 0;
  const one = occ < 0 ? s.structures.get(-occ) : undefined;
  if (!one) return '';
  const curve = STRUCTURES[one.kind].school?.curve;
  const [l, c] = loadOf(facilities(GOALS[id]).filter((f) => id !== 'education' || STRUCTURES[f.kind].school?.curve === curve));
  const level = id === 'education' && curve && LEVEL_NAME[curve] ? `${LEVEL_NAME[curve]} ` : '';
  return `${STRUCTURE_NAME[one.kind]} 한 곳이 정원의 ${fmt(v)}%${c ? ` · ${level}전체 ${Math.round((l / c) * 100)}%` : ''}`;
}

/**
 * Has the mayor's rating been worked out yet: a month closed with residents? (It is worked out at the month's end; until
 * then its 0 is no one's verdict, and the pane and the polls say —.)
 */
export const ratingRated = (): boolean => (city.state.history.at(-1)?.population ?? 0) > 0;
/**
 * The mayor's rating as a row's tone: below 0 urgent, below 20 a look — not before a month has closed with
 * residents (it is worked out at the month's end, and until then its 0 said 주민 만족이 낮음 of a town nobody had rated).
 */
export const ratingTone = (rating: number): Tone => (!ratingRated() ? '' : rating < 0 ? 'bad' : rating < 20 ? 'warn' : '');
/** The rating's word beside its figure, when it wants a look ('' else). */
export const ratingNote = (rating: number): string => (!ratingTone(rating) ? '' : rating < 0 ? '주민 대다수가 불만 · 아주 낮은 곳이 모이면 폭동' : '주민 만족이 낮음 · 여론을 살펴보세요');

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

/**
 * The land under the buildings (worked out again only after an edit or a week): the mean value of their tiles, as the
 * record keeps it (none while nothing is built), and the share of buildings on ground with any value at all — by the
 * water or above the town's average height — counted by building (by tile, a tower counted nine times).
 */
let landMemo: { key: string; v?: number; share?: number } | null = null;
function landUnder(): { v?: number; share?: number } {
  const key = changeKey();
  if (landMemo?.key === key) return landMemo;
  const s = city.state;
  const lv = city.fields.landValue;
  let total = 0;
  let count = 0;
  for (let i = 0; i < s.occupant.length; i++) {
    if (s.occupant[i]! <= 0) continue;
    total += lv[i]!;
    count++;
  }
  let all = 0;
  let valued = 0;
  for (const b of s.buildings.values()) {
    all++;
    if (lv[(b.y + (b.h >> 1)) * s.size + b.x + (b.w >> 1)]! >= 1) valued++;
  }
  landMemo = { key, v: count ? total / count : undefined, share: all ? Math.round((valued / all) * 100) : undefined };
  return landMemo;
}

/** The figures that size up a goal. */
/** What the residents say about a goal's subject (the opinion poll), as a figure on its screen. */
const POLL_OF: Partial<Record<GoalId, PollTopic[]>> = { police: ['safety'], environment: ['environment'], land: ['landValue'], traffic: ['traffic'], health: ['health'], education: ['education'], finance: ['taxes'] };
let pollMemo: { key: string; polls: ReturnType<typeof city.opinionPolls> } | null = null;
function pollMetric(id: GoalId): Metric[] {
  const topics = POLL_OF[id];
  if (!topics || !readStats().population) return [];
  const key = `${changeKey()}|${Math.floor(city.state.day / 30)}`;
  if (pollMemo?.key !== key) pollMemo = { key, polls: city.opinionPolls() };
  return topics.map((topic) => pollOn(topic, pollMemo!.polls[topic].approve));
}
/** One topic's poll as a figure. */
function pollOn(topic: PollTopic, approve: number): Metric {
  const p = Math.round(approve * 100);
  // (Named by its topic: "주민 만족 100%" on the money screen read as the whole town's mood.)
  // (The environment's: complaints start far past the 40 that spoils homes — 100% beside 공기 나쁜 주거지 110칸
  // read as a contradiction.)
  const mr = city.cfg.mayor?.pollution?.zero;
  const why = topic === 'environment' && mr ? ` · 오염이 ${fmt(mr)}을 넘어야 불만이 되지만, 40만 넘어도 쾌적도와 건강은 떨어집니다` : '';
  // (Said as what it counts, those living here with no complaint: "주민 만족 (세금) 100%" under "세율이 높아 수요가 71%
  // 깎이고" read as a contradiction — those it keeps out aren't asked.)
  // (Nobody minding yet, said as that: "불만 없는 주민 100%" stood beside the screen's 주의 like a contradiction.)
  const none = p >= 95;
  // (Up to 5% minding is "거의", not "아직 없음".)
  return [none ? `${POLL_NAME[topic]}에 대한 주민 불만` : `${POLL_NAME[topic]}에 불만 없는 주민`, none ? (p >= 100 ? '아직 없음' : '거의 없음') : `${p}%`, p < 25 ? 'bad' : p < 50 ? 'warn' : '', p, 1, `지금 사는 주민 가운데 ${POLL_NAME[topic]}에 불만이 없는 비율 ${p}% (여론 조사: 시장 평점을 움직입니다 · 들어오지 못한 사람은 셈에 없음)${why}`];
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
    case 'amenity':
      return [
        // (Its headline, for its 시장 평점 tab.)
        ratingRated() ? ['시장 평점', String(st.mayorRating), ratingTone(st.mayorRating), st.mayorRating, 1, '−100~100 · 주민의 불만에서 나옵니다'] : ['시장 평점', '—', '', undefined, 1, '주민이 든 달이 지나면 매겨집니다'],
        // (For its 쾌적도 tab: those a pleasant place draws, and what they want built — the wealthy come where it is high.)
        ...amenityMetrics(),
      ];
    // (Its figure is its table, each kind of zone by wealth — demandGrid; its people, the city's own.)
    case 'growth': return [];
    case 'power': {
      const p = st.power;
      const spare = p.supply - p.demand;
      return [['수요', `${fmt(p.demand)} MWh`, '', p.demand, 0], ['공급', `${fmt(p.supply)} MWh`, '', p.supply, 1],
        ['여유', `${spare < 0 ? '−' : ''}${fmt(Math.abs(spare))} MWh`, spare < 0 ? 'bad' : spare < p.demand * 0.15 ? 'warn' : 'good', spare, 1],
        ['정전', p.blackedOut ? `${fmt(p.blackedOut)}채` : '없음', p.blackedOut ? 'bad' : '', p.blackedOut, -1], ['발전소', `${list.length}곳`, '', list.length, 0],
        wornMetric('낡은 송전선', 'power')];
    }
    case 'water': {
      const w = st.water;
      let dryCount = -1;
      const dry = () => {
        if (dryCount < 0) {
          dryCount = 0;
          // (By the building's own state, as the water view counts it: its corner tile's said 26 where the view said 27.)
          for (const b of s.buildings.values()) if (b.type && !b.watered) dryCount++;
        }
        return dryCount;
      };
      const thirsty = () => [...s.buildings.values()].some((b) => b.type && !b.watered && b.stage > city.cfg.services.waterStageCap[b.type]);
      const spare = w.supply - w.demand;
      return [['수요', `${fmt(w.demand)} m³`, '', w.demand, 0], ['공급', `${fmt(w.supply)} m³`, '', w.supply, 1],
        ['여유', `${spare < 0 ? '−' : ''}${fmt(Math.abs(spare))} m³`, spare < 0 ? 'bad' : spare < w.demand * 0.15 ? 'warn' : 'good', spare, 1],
        // (With no water at all there are no "shortages" yet: the buildings going without are the count.)
        // (Red as the row is, from 3,000 people — or with some past the stage that needs water; amber before: a small
        // town's red figure stood beside the view's 아직은 물 없이 자라는 단계.)
        ...(w.supply <= 0 && dry() ? [['물 없는 건물', `${fmt(dry())}채`, st.population > 3000 || thirsty() ? 'bad' : 'warn', dry(), -1] as Metric] : [['단수', w.shortages ? `${fmt(w.shortages)}곳` : '없음', w.shortages ? 'bad' : '', w.shortages, -1] as Metric]), ['수도 시설', `${list.length}곳`, '', list.length, 0],
        // (For its 수질 tab: how foul the water runs, and the pumps it has stopped.)
        ...((h) => (h?.waterPollution !== undefined ? [['수질 오염', h.waterPollution.toFixed(0), '', Math.round(h.waterPollution), -1, '도시 평균 · 주거지에서 100을 넘으면 건강과 시장 평점이 떨어집니다'] as Metric] : []))(s.history.at(-1)),
        ['오염으로 멈춘 펌프', fouledPumps() ? `${fmt(fouledPumps())}곳` : '없음', fouledPumps() ? 'bad' : '', fouledPumps(), -1, `땅의 수질 오염이 ${fmt(city.cfg.services.pumpPollutionLimit)}을 넘은 양수 펌프는 물을 뽑지 못합니다`],
        wornMetric('낡은 수도관', 'pipe')];
    }
    case 'garbage': {
      const g = st.garbage;
      const months = landfillMonths(g);
      const now = g.kept || g.produced - g.recycled;
      // (A landfill laid since the month's tally: the room it brings, from next month — the figures beside the screen's
      // "다음 달까지 기다리면 됩니다" read 0 t, — and 못 치움 in red.)
      const fresh = freshLandfill();
      const toCome = fresh?.joined ? fresh.tiles * city.cfg.garbage.landfill.tileCapacity : 0;
      const comeSpan = toCome ? landfillSpan(Math.floor(toCome / Math.max(1, now - g.incinerated))) : '';
      return [['처리할 쓰레기', `${fmt(now)} t`, '', now, -1, '이번 달, 재활용·조례로 줄인 뒤'], ['처리 여유 (소각·매립)', `${fmt(g.capacity)} t${toCome ? ` · 다음 달부터 +${fmt(toCome)} t` : ''}`, '', g.capacity, 1, '소각장이 태울 수 있는 양과 매립지에 남은 자리'],
        ['매립지 남은 기간', toCome && (months === null || months < 6) ? `다음 달부터 약 ${comeSpan}` : months === null ? '—' : landfillSpan(months), toCome ? '' : months !== null && months < 6 ? 'bad' : months !== null && months < 18 ? 'warn' : ''],
        // (Each its own figure: "재활용·소각 197 · 788 t" left which number was which to guess.)
        ['재활용', `${fmt(g.recycled)} t`, '', Math.round(g.recycled), 1, '이번 달 재활용으로 줄인 양'], ['소각', `${fmt(g.incinerated)} t`, '', Math.round(g.incinerated), 0, '이번 달 소각 발전소가 태운 양'], ['못 치움', g.uncollected > 1 ? `${fmt(g.uncollected)} t` : '없음', g.uncollected > 1 && !toCome ? 'bad' : '', g.uncollected, -1],
        ...((g.routeCutOff ?? 0) > 1 ? [['처리장과 끊긴 수거망', `${fmt(g.routeCutOff!)} t`, 'bad', g.routeCutOff!, -1, '같은 도로망의 처리장 또는 계약한 반출 도로로 이어 주세요'] as Metric] : [])];
    }
    case 'police': {
      const stations = list.filter((f) => (STRUCTURES[f.kind].police?.radius ?? 0) > 0).length;
      return [['범죄 (지난달)', fmt(st.safety.crimes), '', st.safety.crimes, -1, crimeKinds(st.safety.byType)], ['체포', fmt(st.safety.arrests), '', st.safety.arrests, 1], ['예방', fmt(st.safety.prevented), '', st.safety.prevented, 1],
        ['경찰서', `${stations}곳`, '', stations, 0], ['수감', c ? `${fmt(l)} / ${fmt(c)}` : '—', c && l >= c ? 'bad' : ''], ['풀려남 (감방 부족)', fmt(st.safety.paroled), st.safety.paroled ? 'warn' : '', st.safety.paroled, -1], ['폭동', s.mobs.length ? `${s.mobs.length} 진행 중` : '없음', s.mobs.length ? 'bad' : '']];
    }
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
      const jams = jammedTiles();
      return [['평균 통근', h?.commute ? minutes(h.commute) : '—', h?.commute && h.commute > 1 ? 'warn' : '', h?.commute ? Math.round(h.commute * 60) : undefined, -1],
        ['막힌 길', jams ? `${fmt(jams)}칸` : '없음', jams >= 10 ? 'warn' : '', jams, -1, '용량을 넘어 차가 몰린 도로·철도 칸 · 넓히거나 대중교통으로 나누면 줄어듭니다'], ['하루 통행', total ? fmt(total) : '—'],
        ['대중교통 비중', share !== undefined ? `${share}%` : '—', '', share, 1],
        // Long commutes with no stop at all: transit is the step not yet taken.
        ['정류장·역', `${list.length}곳`, !list.length && (h?.commute ?? 0) > 1 ? 'warn' : '', list.length, 0, !list.length && (h?.commute ?? 0) > 1 ? '통근이 깁니다: 버스 정류장부터 놓아 보세요' : undefined]];
    }
    case 'land': {
      const { v, share } = landUnder();
      return [['평균 땅값', v !== undefined ? v.toFixed(1) : '—', '', v !== undefined ? Math.round(v) : undefined, 1, '건물이 선 칸의 평균: 물가와 주변보다 높은 땅이 올립니다 (모두 평평한 내륙이면 0)'],
        ['땅값이 붙은 건물', share !== undefined ? `${share}%` : '—', '', share, 1, '물가나 도시 평균보다 높은 땅에 선 건물의 비율']];
    }
    case 'environment': {
      const h = s.history.at(-1);
      const homes = smoggyHomes();
      return [['대기 오염', h?.air !== undefined ? h.air.toFixed(0) : '—', (h?.air ?? 0) > 40 && homes > 0 ? 'warn' : '', h?.air !== undefined ? Math.round(h.air) : undefined, -1],
        ['공기 나쁜 주거지', `${fmt(homes)}칸`, homes > 0 && (h?.air ?? 0) > 40 ? 'warn' : '', homes, -1, '대기 오염이 40을 넘는 주거 구역 칸 · 공장·발전소·차가 많은 길 가까이에서 생깁니다']];
    }
  }
}

/**
 * The city's own figures, on its residents' screen (the city button's): those who live and work here, those without
 * work, and the buildings left empty — what 수요's 개발 막힘 tab read before it was the city's.
 */
export function cityMetrics(): Metric[] {
  const st = readStats();
  const jobless = sum(st.unemployed);
  const workers = sum(city.census.workers);
  return [['인구', fmt(st.population), '', st.population, 1], ['일자리', fmt(st.jobs), '', st.jobs, 1],
    ['일하는 사람', fmt(workers), '', workers, 1, '일할 나이의 주민 (소득별로는 아래 표)'],
    ['실업', fmt(jobless), jobless > st.population * 0.1 ? 'warn' : '', jobless, -1, workers ? `일하는 사람 가운데 ${Math.round((jobless / workers) * 100)}%가 일자리를 못 구했습니다` : undefined],
    ['버려진 건물', fmt(st.abandoned), st.abandoned ? 'warn' : '', st.abandoned, -1]];
}

/** 쾌적도's own figures (its 쾌적도 tab): its parks, those a pleasant place draws, and what they want built. */
function amenityMetrics(): Metric[] {
  const st = readStats();
  const parks = [...city.state.structures.values()].filter((x) => STRUCTURES[x.kind].category === 'park').length;
  const total = Math.max(1, sum(st.residents));
  const dem = city.demand.demand;
  const d = (t: 'R$$$' | 'Cs$$$' | 'Co$$$'): Metric => [`${RICH_WORD[t]} 수요`, dem[t] >= 1 ? `+${fmt(dem[t])}` : dem[t] <= -1 ? `−${fmt(-dem[t])}` : '0', dem[t] >= 100 ? 'good' : dem[t] < 0 ? 'warn' : ''];
  return [['공원', `${parks}곳`, '', parks, 1],
    ['부유층 주민', `${fmt(st.residents[2])}명 · ${Math.round((st.residents[2] / total) * 100)}%`, '', st.residents[2], 1],
    ['중산층 주민', `${fmt(st.residents[1])}명`, '', st.residents[1], 1], d('R$$$'), d('Cs$$$'), d('Co$$$')];
}

/**
 * Lines or pipes worn to where they spark or burst (50 and up, as the wear view marks them), as a figure: their
 * department's budget at 100% or more mends them. Counted once a week or after an edit.
 */
function wornMetric(label: string, what: 'power' | 'pipe'): Metric {
  const key = `${what}|${changeKey()}`;
  let n = wornMemo.get(what)?.key === key ? wornMemo.get(what)!.n : -1;
  if (n < 0) {
    const s = city.state;
    const [on, wear] = what === 'power' ? [s.power, s.lineWear] : [s.pipe, s.pipeWear];
    n = 0;
    for (let i = 0; i < on.length; i++) if (on[i] && wear[i]! >= 50) n++;
    wornMemo.set(what, { key, n });
  }
  return [label, n ? `${fmt(n)}칸` : '없음', n ? 'warn' : '', n, -1, `노후도 50을 넘어 ${what === 'power' ? '불꽃이 튈' : '터질'} 수 있는 칸 · ${what === 'power' ? '송전선 유지' : '수도'} 예산이 100% 이상이면 고쳐집니다`];
}
const wornMemo = new Map<string, { key: string; n: number }>();

/** Pumps standing on ground too foul to draw from (any tile of their lot past the engine's limit). */
function fouledPumps(): number {
  const f = city.fields;
  const n = city.size;
  const limit = city.cfg.services.pumpPollutionLimit;
  let k = 0;
  for (const st of city.state.structures.values()) {
    if (!STRUCTURES[st.kind].pump) continue;
    let over = false;
    for (let y = st.y; y < st.y + st.h && !over; y++) for (let x = st.x; x < st.x + st.w; x++) if (f.waterPollution[y * n + x]! > limit) over = true;
    if (over) k++;
  }
  return k;
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
  // (No riders: why, in short, as its info card says it: alone of its kind, no road, or nowhere worth going. Unless its
  // riders get off there: the stop by work, which none board.)
  if (d.station) {
    if (f.load >= 1) return [`승차 ${fmt(f.load)} / ${fmt(d.station.capacity)}`, ''];
    const off = alighted(f);
    return off >= 1 ? [`하차 ${fmt(off)} · 일터 쪽`, ''] : [`승차 0 · ${noRiders(f).split(/[.:]/)[0]}`, 'warn'];
  }
  return [structureStat(f.kind), ''];
}

/**
 * Riders who got off at a passenger stop last month: commuters board by their homes and get off by their work, so the
 * pair's stop by work counted no one ("승차 0", flagged as a stop that carries nobody, while the pair's riders all came
 * to it). Every station's at once, kept for the week (and new with each month's figures). Not redone part-way through
 * a day: reading the routes finishes the day there and then, a stall each time a card was drawn — the figure before
 * it stands till the day is done.
 */
export function alighted(f: Structure): number {
  const key = `${changeKey()}|${Math.floor(city.state.day / 30)}`;
  if (offMemo?.key !== key && !(city.stepping && offMemo?.gen === cityGeneration)) offMemo = { key, gen: cityGeneration, by: city.alightings() };
  return offMemo!.by.get(f.id) ?? 0;
}
let offMemo: { key: string; gen: number; by: Map<number, number> } | null = null;

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
    // (In buildings, as the view counts what is missed and the build says what it reached: 닿지 않던 곳 116칸 here was
    // 새로 닿는 건물 82채 once built.)
    const spot = suggestSpot(id);
    const gain = spot ? newlyReached(id, spot.x + 0.5, spot.y + 0.5, coverageRadius(k)) : 0;
    // (And the plants it takes in, which the fire spot is weighed for.)
    const plants = spot && id === 'fire' ? plantsReached(spot.x + 0.5, spot.y + 0.5, coverageRadius(k)) : 0;
    const what = [plants ? `발전소 ${fmt(plants)}곳` : '', gain ? `건물 ${fmt(gain)}채` : ''].filter(Boolean).join(' · ');
    return what ? `과녁에 지으면 새로 닿는 ${what}` : '';
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


/** What a goal looks for on the map: the tiles that need it, and whether each has it. */
function need(id: GoalId): ((i: number) => number) | null {
  const s = city.state;
  const f = city.fields;
  const home = (i: number) => s.zone[i]! >= 1 && s.zone[i]! <= 3;
  // (The stations' gaps as their views count them: a building — a home, for a hospital or a school — when its middle
  // tile is out of reach. Not empty zoned land: 모든 집이 학교 범위 안입니다 stood over a spot of empty lots "where no
  // school reaches", with 여기에 짓기. Each building once, spread over its tiles: by area, three big factories
  // outweighed twenty homes, and the spot said 3채 beside a view of 23.)
  const n = city.size;
  const gap = (cover: ArrayLike<number>, homes = false) => (i: number) => {
    const o = s.occupant[i]!;
    const b = o > 0 ? s.buildings.get(o) : undefined;
    if (!b?.type || (homes && b.type[0] !== 'R')) return 0;
    return cover[(b.y + (b.h >> 1)) * n + b.x + (b.w >> 1)]! > 0 ? 0 : 1 / (b.w * b.h);
  };
  // How much a tile counts (0: it doesn't need it, or has it).
  switch (id) {
    case 'police': return gap(f.policeCover);
    // (A power plant outside cover ahead of any block of buildings — a block holds 144 at most: one that burns explodes,
    // and the screen leads with it.)
    case 'fire': {
      const building = gap(f.fireCover);
      return (i) => {
        const occ = s.occupant[i]!;
        const st = occ < 0 ? s.structures.get(-occ) : undefined;
        if (st && STRUCTURES[st.kind].plant) return unprotected(st) ? 1000 / (st.w * st.h) : 0;
        return building(i);
      };
    }
    case 'health': return gap(f.hospitalCover, true);
    case 'education': return gap(f.schoolQuality, true);
    case 'power': return (i) => (s.zone[i]! > 0 && s.zone[i] !== 10 && !f.powered[i] ? 1 : 0);
    // (A building's own water, as the view and the metric count it: one cut by rationing on a covered tile is dry, and
    // one with a corner in reach is not.)
    case 'water': return (i) => {
      const o = s.occupant[i]!;
      const b = o > 0 ? s.buildings.get(o) : undefined;
      return b?.type && !b.watered ? 1 / (b.w * b.h) : 0;
    };
    // Homes in air past what people put up with (parks and trees beside them help); rubbish left lying.
    case 'environment': return (i) => (home(i) && f.air[i]! > 40 ? Math.min(2, (f.air[i]! - 40) / 40) : 0);
    case 'garbage': return (i) => (s.zone[i] !== 10 && s.garbage[i]! > 2 ? 1 : 0);
    // Road over its capacity, by how far (rail and the rest have views of their own).
    // (Past capacity, as the congestion view counts it and its legend says: past 1.2 times it here, the screen said 116
    // where the view beside it said 139.)
    case 'traffic': return (i) => {
      const code = s.net[i]!;
      if (code === Net.None || code === Net.Rail) return 0;
      const cap = city.cfg.transport.speed[NETWORK_KINDS[code]!]?.capacity;
      const u = cap ? f.traffic[i]! / cap : 0;
      return u > 1 ? u - 1 : 0;
    };
    default: return null;
  }
}

/**
 * How many buildings a station of `goal` would newly reach from its ring (centre, radius): those whose middle lies in
 * it and that its service misses now, counted as the service's view counts them (homes only, for a hospital or
 * school) — so the view's count falls by what the pointer said. For the pointer, as a station is moved about.
 */
/** A power plant no fire station reaches (by its middle tile, as buildings are counted). */
function unprotected(st: Structure): boolean {
  // (Any tile of it in reach, as the engine's advisor and its fires count a plant covered: by its middle alone, one
  // with a corner in reach was "소방이 닿지 않는 발전소" beside an advisor who said nothing.)
  const n = city.size;
  const cover = city.fields.fireCover;
  for (let y = st.y; y < st.y + st.h; y++) for (let x = st.x; x < st.x + st.w; x++) if (cover[y * n + x]! > 0) return false;
  return true;
}

/** The power plants out of fire cover that a fire station's reach r at (cx, cy) would take in (by their nearest tile). */
export function plantsReached(cx: number, cy: number, r: number): number {
  let count = 0;
  for (const st of city.state.structures.values()) {
    if (!STRUCTURES[st.kind].plant || !unprotected(st)) continue;
    const dx = Math.max(0, Math.abs(cx - (st.x + st.w / 2)) - st.w / 2 + 0.5);
    const dy = Math.max(0, Math.abs(cy - (st.y + st.h / 2)) - st.h / 2 + 0.5);
    if (dx * dx + dy * dy <= r * r) count++;
  }
  return count;
}

export function newlyReached(goal: GoalId, cx: number, cy: number, r: number): number {
  const f = city.fields;
  const n = city.size;
  const lacks = goal === 'police' ? (i: number) => !(f.policeCover[i]! > 0) : goal === 'fire' ? (i: number) => !(f.fireCover[i]! > 0)
    : goal === 'health' ? (i: number) => !(f.hospitalCover[i]! > 0) : goal === 'education' ? (i: number) => !(f.schoolQuality[i]! > 0) : null;
  if (!lacks || r <= 0) return 0;
  const homesOnly = goal === 'health' || goal === 'education';
  let count = 0;
  for (const b of city.state.buildings.values()) {
    if (!b.type || (homesOnly && b.type[0] !== 'R')) continue;
    const [mx, my] = [b.x + (b.w >> 1), b.y + (b.h >> 1)];
    if ((mx + 0.5 - cx) ** 2 + (my + 0.5 - cy) ** 2 <= r * r && lacks(my * n + mx)) count++;
  }
  return count;
}

export const SPOT_WORD: Partial<Record<GoalId, string>> = {
  police: '경찰이 닿지 않는 건물', fire: '소방이 닿지 않는 건물', health: '병원이 닿지 않는 집', education: '학교가 닿지 않는 집',
  power: '발전소 자리', water: '양수 시설 자리', traffic: '막힌 길', environment: '공기가 나쁜 주거지', garbage: '쓰레기가 쌓인 곳',
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

/**
 * The two subway stations nearest each other that no track joins, and the track between them as the subway tool draws
 * it from one to the other, with its price; null with fewer than two, or all joined. (Placed at their pair of sites,
 * the two stations stood with no word of the track they need.) As the engine's trains go: a station of the subway's
 * (an elevated rail station too) boards from track on or beside it, not at its corners, subway or elevated rail, and
 * the two kinds of track meet where a transition (or a tile with both) takes the trains from one to the other — a line
 * run up onto elevated rail and down again was marked as two to join. Kept for the week; short of money by today's
 * funds.
 */
export function subwayGap(): { path: [number, number][]; cost: number; short: boolean } | null {
  const key = changeKey();
  if (gapMemo?.key !== key) gapMemo = { key, ...findSubwayGap() };
  const gap = gapMemo.gap;
  // (A week's income or a loan since: "자금 부족" stayed on a track the treasury could now pay for.)
  return gap && { ...gap, short: gap.cost > city.state.funds };
}
let gapMemo: { key: string; gap: { path: [number, number][]; cost: number } | null; alone: ReadonlySet<number> } | null = null;

/** Whether a subway station shares no track with another (it carries no one until one does). */
export function subwayAlone(id: number): boolean {
  subwayGap();
  return gapMemo!.alone.has(id);
}

function findSubwayGap(): { gap: { path: [number, number][]; cost: number } | null; alone: ReadonlySet<number> } {
  const s = city.state;
  const n = city.size;
  const stations = [...s.structures.values()].filter((st) => STRUCTURES[st.kind].station?.mode === 'subway');
  const alone = new Set<number>();
  if (stations.length < 2) return { gap: null, alone };
  // Track pieces, by flood over the subway's tiles and the elevated rail's: the two meet only through a transition or
  // a tile carrying both (the engine's rule for its trains).
  const level = (i: number) => (s.subway[i] ? 1 : 0) | (s.elevated[i] === ELEVATED.rail ? 2 : 0);
  const joins = new Set(s.transitions);
  const meet = (a: number, b: number) => {
    const [la, lb] = [level(a), level(b)];
    return la === lb || la === 3 || lb === 3 || joins.has(a) || joins.has(b);
  };
  const part = new Int32Array(n * n).fill(-1);
  let parts = 0;
  for (let i = 0; i < n * n; i++) {
    if (!level(i) || part[i]! >= 0) continue;
    const todo = [i];
    part[i] = parts;
    while (todo.length) {
      const j = todo.pop()!;
      const [x, y] = [j % n, Math.floor(j / n)];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const [u, v] = [x + dx, y + dy];
        const k = v * n + u;
        if (u < 0 || v < 0 || u >= n || v >= n || !level(k) || part[k]! >= 0 || !meet(j, k)) continue;
        part[k] = parts;
        todo.push(k);
      }
    }
    parts++;
  }
  // The pieces each station stands on or beside (not at its corners: the engine's trains don't stop there).
  const on = stations.map((st) => {
    const set = new Set<number>();
    for (let y = st.y - 1; y <= st.y + st.h; y++) for (let x = st.x - 1; x <= st.x + st.w; x++) {
      const corner = (x === st.x - 1 || x === st.x + st.w) && (y === st.y - 1 || y === st.y + st.h);
      if (!corner && x >= 0 && y >= 0 && x < n && y < n && part[y * n + x]! >= 0) set.add(part[y * n + x]!);
    }
    return set;
  });
  stations.forEach((st, a) => {
    if (!stations.some((_, b) => b !== a && [...on[a]!].some((p) => on[b]!.has(p)))) alone.add(st.id);
  });
  let gap: { path: [number, number][]; cost: number } | null = null;
  let best = Infinity;
  for (let a = 0; a < stations.length; a++) for (let b = a + 1; b < stations.length; b++) {
    if ([...on[a]!].some((p) => on[b]!.has(p))) continue;
    const [p, q] = [stations[a]!, stations[b]!];
    // (Subway track for a subway station to take: two elevated rail stations wait for elevated rail, not this.)
    if (p.kind !== 'subwayStation' && q.kind !== 'subwayStation') continue;
    const d = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
    if (d >= best) continue;
    const plan = city.previewLine('subway', p.x, p.y, q.x, q.y);
    if (!plan.ok && plan.message !== 'not enough funds') continue;
    best = d;
    gap = { path: linePath(p.x, p.y, q.x, q.y), cost: plan.cost };
  }
  return { gap, alone };
}

/**
 * A disaster on the move (a tornado, meteors, a robot, a monster, a UFO) that the alarms wait for, for its first 30
 * days at most: it runs on the real clock, and at full speed one monster's walk spanned years of days in which nothing,
 * not even the treasury running dry, was told.
 */
export function stormHolds(): boolean {
  if (!city.state.liveDisasters.length) {
    stormFrom = null;
    return false;
  }
  const day = city.state.day;
  if (!stormFrom || stormFrom.lineage !== cityLineage || day < stormFrom.day) stormFrom = { lineage: cityLineage, day };
  return day - stormFrom.day < 30;
}
let stormFrom: { lineage: number; day: number } | null = null;

/** Road tiles past capacity (counted once a week of game time or after an edit). */
let jamMemo: { key: string; n: number } | null = null;
export function jammedTiles(): number {
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

/**
 * The road the town wants to its neighbours while it has none (no road, avenue or highway at a map edge): a straight
 * run of the tool's kind to a map edge — from the town's roads if it has some, else from the edge to the middle of the
 * map — the cheapest the tool lays (a bridge costs what it costs). At least two tiles, the last two road (a lone edge
 * tile with a street inside is no link to the engine). Its tiles from the town's end to the edge, and whether the money
 * is short; or null.
 */
export function edgeRoad(kind: 'road' | 'avenue' = 'road'): { path: [number, number][]; short: boolean; cost: number } | null {
  const key = `${kind}|${changeKey()}|${borderKey()}`;
  if (edgeMemo?.key !== key) edgeMemo = { key, at: findEdgeRoad(kind) };
  // (Short of money said against the funds now: kept with the route, 자금 부족 stayed up a week after it was there.)
  const at = edgeMemo.at;
  return at ? { ...at, short: at.cost > city.state.funds } : null;
}
let edgeMemo: { key: string; at: { path: [number, number][]; cost: number } | null } | null = null;

/**
 * The map's sides with a city beyond them (in a region, the sides where one was founded), or null when every side or
 * none has one: a road to a side with no city brings no commuters, demand or deals from those that do.
 */
export function citySides(): number[] | null {
  const sides = city.state.neighbours.filter((nb) => nb.kind !== 'simnation').map((nb) => nb.edge);
  return sides.length && sides.length < city.state.neighbours.length ? sides : null;
}

/** The side of the map an edge tile is on (0 west, 1 east, 2 north, 3 south), as the neighbours number them. */
const sideOf = (i: number, n: number): number => {
  const x = i % n;
  const y = (i - x) / n;
  return x === 0 ? 0 : x === n - 1 ? 1 : y === 0 ? 2 : 3;
};

/**
 * The stretches of the map's edge with a city across them, as [side, from, to) along it (sides numbered as the
 * neighbours are); null when the whole edge has, or none of it (a road anywhere on it is as good). In a region a side
 * may face a city along only part of it: a big city beside a small one.
 */
export function cityEdges(): [number, number, number][] | null {
  const n = city.size;
  const sides = citySides();
  const out: [number, number, number][] = [];
  for (const nb of city.state.neighbours) {
    if (nb.kind === 'simnation' || (sides && !sides.includes(nb.edge))) continue;
    if (nb.shared?.length) for (const [a, b] of nb.shared) out.push([nb.edge, Math.max(0, a), Math.min(n, b)]);
    else out.push([nb.edge, 0, n]);
  }
  return !out.length || (out.length === 4 && out.every(([, a, b]) => a === 0 && b === n)) ? null : out;
}

/** The neighbours as the links to them are read: their kinds and the stretches of border played cities share. */
const borderKey = () => city.state.neighbours.map((nb) => `${nb.kind}${nb.shared?.map(([a, b]) => `:${a}-${b}`).join('') ?? ''}`).join();

/**
 * Whether an edge tile faces a city across it: on a side with one (when only some have), and on the stretch of that
 * side a played city borders (a big city beside a small one shares part of its side: the engine joins them only
 * there, and a road met the edge past it, was ticked, and joined nobody).
 */
const facesCity = (i: number, n: number, sides: number[] | null): boolean => {
  const side = sideOf(i, n);
  if (sides && !sides.includes(side)) return false;
  const nb = city.state.neighbours.find((b) => b.edge === side && b.kind !== 'simnation');
  if (!nb?.shared?.length) return true;
  const x = i % n;
  const p = side < 2 ? (i - x) / n : x;
  return nb.shared.some(([a, b]) => p >= a && p < b);
};

/**
 * Is the town's own road network joined to a neighbour: a road or avenue at the map's edge, or a highway there that a
 * ramp joins to them? (Not a highway with no ramp, which joins none of the town's roads, nor rail: 이웃 도시로 가는 도로
 * was ticked by either, and the route to the edge went for good. A street or a one-way at the edge links nothing.)
 * In a region, on a side with a city (a road to an empty side ticked it while the city beside went unjoined).
 */
export function roadLinked(): boolean {
  const key = `${cityGeneration}|${city.revision}|${borderKey()}`;
  if (linkMemo?.key === key) return linkMemo.on;
  const s = city.state;
  const f = city.fields;
  const n = city.size;
  const roadKind = (c: number) => c === Net.Road || c === Net.Avenue || c === Net.RailCrossing;
  const sides = citySides();
  let on = false;
  let local: Set<number> | null = null;
  for (const i of f.connections) {
    if (!facesCity(i, n, sides)) continue;
    const code = s.net[i]!;
    if (code === Net.Road || code === Net.Avenue) {
      // (As the engine counts a link: two along the edge, or one going on inward — a lone edge tile with a street
      // inside joins nothing.)
      const x = i % n;
      const y = (i - x) / n;
      const side = x === 0 || x === n - 1;
      const inward = x === 0 ? i + 1 : x === n - 1 ? i - 1 : y === 0 ? i + n : i - n;
      const ix = inward % n;
      const iy = (inward - ix) / n;
      const inside = ix > 0 && iy > 0 && ix < n - 1 && iy < n - 1 && roadKind(s.net[inward]!);
      const along = (side ? [y > 0 ? i - n : -1, y < n - 1 ? i + n : -1] : [x > 1 ? i - 1 : -1, x < n - 2 ? i + 1 : -1]).some((j) => j >= 0 && roadKind(s.net[j]!));
      if (inside || along) {
        on = true;
        break;
      }
      continue;
    }
    if (code !== Net.Highway) continue;
    // (The networks a local road is part of, found once: a ramp puts the highway in one of them.)
    if (!local) {
      local = new Set();
      for (let j = 0; j < s.net.length; j++) if (f.component[j]! >= 0 && isLocalNet(s.net[j]!)) local.add(f.component[j]!);
    }
    if (local.has(f.component[i]!)) {
      on = true;
      break;
    }
  }
  linkMemo = { key, on };
  return on;
}
let linkMemo: { key: string; on: boolean } | null = null;

function findEdgeRoad(kind: 'road' | 'avenue'): { path: [number, number][]; cost: number } | null {
  if (roadLinked()) return null;
  const n = city.size;
  const net = city.state.net;
  // (rank: how far it runs from the town's roads — or, on a new map, how far off the middle row or column it lies.)
  type Try = { from: [number, number]; to: [number, number]; rank: number; edge: number };
  const tries: Try[] = [];
  // (A run that would start on the edge itself starts a tile in: the inward tile becomes road too.)
  const run = (x: number, y: number, edge: 0 | 1 | 2 | 3, rank?: number): Try => {
    const to: [number, number] = edge === 0 ? [0, y] : edge === 1 ? [n - 1, y] : edge === 2 ? [x, 0] : [x, n - 1];
    const d = Math.abs(to[0] - x) + Math.abs(to[1] - y);
    const from: [number, number] = d > 0 ? [x, y] : edge === 0 ? [1, y] : edge === 1 ? [n - 2, y] : edge === 2 ? [x, 1] : [x, n - 2];
    return { from, to, rank: rank ?? Math.max(1, d), edge };
  };
  // The town's outermost road tile in each row and column, toward each of the four edges.
  const minX = new Int32Array(n).fill(-1), maxX = new Int32Array(n).fill(-1), minY = new Int32Array(n).fill(-1), maxY = new Int32Array(n).fill(-1);
  let roads = false;
  for (let i = 0; i < net.length; i++) {
    if (!isLocalNet(net[i]!)) continue;
    roads = true;
    const x = i % n;
    const y = (i - x) / n;
    if (minX[y]! < 0 || x < minX[y]!) minX[y] = x;
    if (x > maxX[y]!) maxX[y] = x;
    if (minY[x]! < 0 || y < minY[x]!) minY[x] = y;
    if (y > maxY[x]!) maxY[x] = y;
  }
  if (roads) {
    for (let c = 0; c < n; c++) {
      if (minX[c]! >= 0) tries.push(run(minX[c]!, c, 0), run(maxX[c]!, c, 1));
      if (minY[c]! >= 0) tries.push(run(c, minY[c]!, 2), run(c, maxY[c]!, 3));
    }
  } else {
    // From the middle out to each edge, the middle row or column first, then either side of it (as far as the ends:
    // a small city may border only a big one's far stretch).
    const mid = n >> 1;
    for (let o = 0; o <= n >> 1; o += 2) {
      for (const c of o ? [mid - o, mid + o] : [mid]) if (c > 0 && c < n - 1) tries.push(run(mid, c, 0, o), run(mid, c, 1, o), run(c, mid, 2, o), run(c, mid, 3, o));
    }
  }
  // (In a region, toward a city: one toward an empty side, or the empty part of a side, was laid, ticked, and joined
  // nobody.)
  const sides = citySides();
  for (let k = tries.length - 1; k >= 0; k--) if (!facesCity(tries[k]!.to[1] * n + tries[k]!.to[0], n, sides)) tries.splice(k, 1);
  // The cheapest the tool takes, money short or not (it is said); the nearest few dozen asked, nearest first.
  tries.sort((a, b) => a.rank - b.rank);
  let best: { t: Try; cost: number } | null = null;
  let asked = 0;
  for (const t of tries) {
    if (asked >= 60 || (best && t.rank > best.t.rank * 2 + 8)) break;
    asked++;
    const p = city.previewNetwork(t.from[0], t.from[1], t.to[0], t.to[1], kind);
    const short = !p.ok && p.message === 'not enough funds';
    if (!p.ok && !short) continue;
    if (!best || p.cost < best.cost) best = { t, cost: p.cost };
  }
  // The tiles from one point to another in a straight line, both ends in.
  const line = (from: [number, number], to: [number, number]): [number, number][] => {
    const [dx, dy] = [Math.sign(to[0] - from[0]), Math.sign(to[1] - from[1])];
    const out: [number, number][] = [];
    for (let [x, y] = from; ; x += dx, y += dy) {
      out.push([x, y]);
      if (x === to[0] && y === to[1]) break;
    }
    return out;
  };
  if (best) return { path: line(best.t.from, best.t.to), cost: best.cost };
  return roads ? bentEdgeRoad(kind, line) : null;
}

/**
 * Where no straight run from the town's roads meets a stretch of edge a city lies across (a small city beside part of a
 * big map's side, past the rows the town has reached): one bend — from the town's road nearest that stretch, along
 * the side to it, then straight out to the edge. The nearest few asked, the cheapest kept; its tiles and price, or
 * null. (Clear of buildings and other networks all the way, as a laid road must be.)
 */
function bentEdgeRoad(kind: 'road' | 'avenue', line: (a: [number, number], b: [number, number]) => [number, number][]): { path: [number, number][]; cost: number } | null {
  const spans = cityEdges();
  if (!spans) return null;
  const s = city.state;
  const n = city.size;
  type Bend = { from: [number, number]; bend: [number, number]; to: [number, number]; rank: number };
  const bends: Bend[] = [];
  for (let i = 0; i < s.net.length; i++) {
    if (!isLocalNet(s.net[i]!)) continue;
    const x = i % n;
    const y = (i - x) / n;
    for (const [e, a, b] of spans) {
      if (b - a < 3) continue;
      const along = e < 2 ? y : x;
      const depth = e === 0 ? x : e === 1 ? n - 1 - x : e === 2 ? y : n - 1 - y;
      // (A tile in from the stretch's ends; level with it already, a straight run was tried. Not from a road on the edge
      // itself: there the bend would be the edge's tile.)
      const near = Math.min(b - 2, Math.max(a + 1, along));
      if (near === along || depth < 1) continue;
      // (And a few rows further in, to go round a lake the nearest row crosses.)
      const inward = near === a + 1 ? 1 : -1;
      for (let k = 0; k < 4; k++) {
        const p = near + inward * 4 * k;
        if (p < a + 1 || p > b - 2) break;
        const bend: [number, number] = e < 2 ? [x, p] : [p, y];
        const to: [number, number] = e === 0 ? [0, p] : e === 1 ? [n - 1, p] : e === 2 ? [p, 0] : [p, n - 1];
        bends.push({ from: [x, y], bend, to, rank: Math.abs(along - p) + depth });
      }
    }
  }
  bends.sort((u, v) => u.rank - v.rank);
  let best: { path: [number, number][]; cost: number } | null = null;
  let asked = 0;
  for (const t of bends) {
    if (asked >= 24 || (best && t.rank > best.path.length * 2 + 8)) break;
    const path = [...line(t.from, t.bend), ...line(t.bend, t.to).slice(1)];
    if (path.some(([x, y], k) => s.occupant[y * n + x] || (k > 0 && s.net[y * n + x]))) continue;
    asked++;
    // (The second run from the tile past the bend: the bend's tile is the first run's.)
    const step: [number, number] = [t.bend[0] + Math.sign(t.to[0] - t.bend[0]), t.bend[1] + Math.sign(t.to[1] - t.bend[1])];
    const p1 = city.previewNetwork(t.from[0], t.from[1], t.bend[0], t.bend[1], kind);
    const p2 = city.previewNetwork(step[0], step[1], t.to[0], t.to[1], kind);
    if ([p1, p2].some((p) => !p.ok && p.message !== 'not enough funds')) continue;
    if (!best || p1.cost + p2.cost < best.cost) best = { path, cost: p1.cost + p2.cost };
  }
  return best;
}

/** A kind of source of the air over the smoggy homes: its share of it, how many there are, and the worst one (to go to). */
export type AirSource = { key: string; label: string; share: number; count: number; at: [number, number] | null; lot: { x: number; y: number; w: number; h: number } | null };

/**
 * Where the air over the homes past 40 comes from: each kind of source's share of the pollution reaching them (each
 * tile weighed by how far past 40 it is, as the screen's spot weighs it), with the worst one of each kind. The engine's
 * own spread, worked again source by source (trees and parks only take away: they are left out; an emission
 * ordinance cuts every source alike). Worked out once a game week or after an edit.
 */
export function airSources(): AirSource[] {
  const key = changeKey();
  if (airMemo?.key === key) return airMemo.list;
  const n = city.size;
  const want = need('environment')!;
  const w = new Float32Array(n * n);
  // (The targets' bounds: a source whose reach misses them all is passed over.)
  const b = { x0: n, y0: n, x1: -1, y1: -1 };
  for (let i = 0; i < w.length; i++) {
    const v = want(i);
    if (!(v > 0)) continue;
    w[i] = v;
    const x = i % n;
    const y = (i - x) / n;
    b.x0 = Math.min(b.x0, x);
    b.x1 = Math.max(b.x1, x);
    b.y0 = Math.min(b.y0, y);
    b.y1 = Math.max(b.y1, y);
  }
  const { list, own, total } = pollutionFrom('air', w, b);
  airMemo = { key, list, own, total };
  return list;
}

/** What fouls the air of one tile, by kind of source as on the environment screen (a home's card says it). */
export function airSourcesAt(x: number, y: number): AirSource[] {
  const key = `${x},${y}|${changeKey()}`;
  if (atMemo?.key === key) return atMemo.list;
  const n = city.size;
  const w = new Float32Array(n * n);
  w[y * n + x] = 1;
  const list = pollutionFrom('air', w, { x0: x, y0: y, x1: x, y1: y }).list;
  atMemo = { key, list };
  return list;
}
let atMemo: { key: string; list: AirSource[] } | null = null;

/**
 * What fouls the water under a pump: each kind of source's part over its lot (any tile of it past the limit stops it,
 * as the engine counts it), for its card.
 */
export function waterSourcesOn(st: { id: number; x: number; y: number; w: number; h: number }): AirSource[] {
  const key = `${st.id}|${changeKey()}`;
  if (waterMemo?.key === key) return waterMemo.list;
  const n = city.size;
  const w = new Float32Array(n * n);
  for (let y = st.y; y < st.y + st.h; y++) for (let x = st.x; x < st.x + st.w; x++) w[y * n + x] = 1;
  const list = pollutionFrom('water', w, { x0: st.x, y0: st.y, x1: st.x + st.w - 1, y1: st.y + st.h - 1 }).list;
  waterMemo = { key, list };
  return list;
}
let waterMemo: { key: string; list: AirSource[] } | null = null;

/**
 * Each kind of source's part in the air (or the water) over the weighed tiles `w` (all within `b`), and each source's
 * own — the engine's spread of each, worked again source by source.
 */
function pollutionFrom(of: 'air' | 'water', w: Float32Array, b: { x0: number; y0: number; x1: number; y1: number }): { list: AirSource[]; own: Map<number, number>; total: number } {
  const s = city.state;
  const f = city.fields;
  const n = city.size;
  const kinds = new Map<string, { label: string; sum: number; count: number; top: number; lot: { x: number; y: number; w: number; h: number } }>();
  // (Each building's and structure's own part, by its occupant code: its card says it.)
  const own = new Map<number, number>();
  const add = (k: string, label: string, v: number, lot: { x: number; y: number; w: number; h: number }, code = 0) => {
    if (!(v > 0)) return;
    if (code) own.set(code, v);
    const e = kinds.get(k);
    if (!e) kinds.set(k, { label, sum: v, count: 1, top: v, lot: { x: lot.x, y: lot.y, w: lot.w, h: lot.h } });
    else {
      e.sum += v;
      e.count++;
      if (v > e.top) [e.top, e.lot] = [v, { x: lot.x, y: lot.y, w: lot.w, h: lot.h }];
    }
  };
  if (b.x1 >= 0) {
    const air = of === 'air';
    // (Hills hold back the air's spread, not the water's.)
    const h = air ? s.height : undefined;
    // Factories (dirty industry, manufacturing, high tech apart: what an ordinance or zoning changes differs) and farms,
    // by their stage, as the engine has them (a farm's water from each of its tiles).
    const dev = air ? city.cfg.development.airPollution : city.cfg.development.waterPollution;
    for (const bd of s.buildings.values()) {
      const p: { perStage: number; radius: number; perTile?: boolean } | undefined = bd.type ? dev[bd.type] : undefined;
      if (!p) continue;
      let v = 0;
      if (p.perTile) for (let y = bd.y; y < bd.y + bd.h; y++) for (let x = bd.x; x < bd.x + bd.w; x++) v += coneReach(n, w, x + 0.5, y + 0.5, p.perStage * bd.occupancy, p.radius + 0.5, b);
      else v = lotReach(n, w, bd, p.perStage * bd.stage * Math.sqrt(bd.occupancy), p.radius, h, b);
      add(bd.type!, TYPE_NAME[bd.type!], v, bd, bd.id);
    }
    // Plants and incinerators by kind, and anything else that fouls the air or the water (an airport, a landmark).
    for (const st of s.structures.values()) {
      const def = STRUCTURES[st.kind];
      const burns = def.plant ?? def.incinerator;
      const [own0, ownR] = def.pollution ? (air ? [def.pollution[0], def.pollution[1]] : [def.pollution[2], def.pollution[3]]) : [0, 0];
      const v = (burns ? lotReach(n, w, st, (air ? burns.air[0] : burns.water[0]) * utilityEmissionShare(city.cfg, st), air ? burns.air[1] : burns.water[1], h, b) : 0) + (own0 > 0 ? lotReach(n, w, st, own0, ownR, h, b) : 0);
      add(`st:${st.kind}`, STRUCTURE_NAME[st.kind], v, st, -st.id);
    }
    // Cars and trucks (trains a quarter): the engine's cone of 2.5 tiles about each road tile. (Air only.)
    const tp = air ? city.cfg.development.trafficPollution : 0;
    const [cars, trucks, trains] = [f.traffic, f.highTraffic, f.railTraffic];
    for (let y = Math.max(0, b.y0 - 2); y <= Math.min(n - 1, b.y1 + 2); y++) {
      for (let x = Math.max(0, b.x0 - 2); x <= Math.min(n - 1, b.x1 + 2); x++) {
        const i = y * n + x;
        const t = cars[i]! + trucks[i]! + trains[i]! * 0.25;
        if (!(t > 0) || !tp) continue;
        let v = 0;
        for (let k = 0; k < CAR_CONE.length; k += 3) {
          const nx = x + CAR_CONE[k]!;
          const ny = y + CAR_CONE[k + 1]!;
          if (nx >= 0 && ny >= 0 && nx < n && ny < n) v += w[ny * n + nx]! * t * tp * CAR_CONE[k + 2]!;
        }
        add('traffic', '교통', v, { x, y, w: 1, h: 1 });
      }
    }
    // Toxic spills not yet cleaned up.
    const sp = city.cfg.disasters.spill;
    for (const spill of s.spills) {
      const x = spill.i % n;
      const y = (spill.i - x) / n;
      add('spill', '유독 물질 유출', coneReach(n, w, x + 0.5, y + 0.5, air ? sp.air : sp.water, sp.radius, b), { x, y, w: 1, h: 1 });
    }
  }
  const total = [...kinds.values()].reduce((a, k) => a + k.sum, 0);
  const list: AirSource[] = [];
  if (total > 0) {
    const ranked = [...kinds.entries()].sort((p, q) => q[1].sum - p[1].sum);
    // (The few that matter, the rest as one: a fifth kind at 2% said nothing.)
    const main = ranked.filter(([, k], i) => i < 4 && k.sum / total >= 0.03);
    for (const [k, e] of main) list.push({ key: k, label: e.label, share: e.sum / total, count: e.count, at: [e.lot.x + ((e.lot.w - 1) >> 1), e.lot.y + ((e.lot.h - 1) >> 1)], lot: e.lot });
    const rest = 1 - list.reduce((a, x) => a + x.share, 0);
    if (rest >= 0.01) list.push({ key: 'rest', label: '그 밖', share: rest, count: ranked.length - main.length, at: null, lot: null });
  }
  return { list, own, total };
}
let airMemo: { key: string; list: AirSource[]; own: Map<number, number>; total: number } | null = null;

/** A building's (its id) or structure's (minus its id) share of the air over the smoggy homes: 0 for none. */
export function airShareOf(code: number): number {
  airSources();
  return airMemo && airMemo.total > 0 ? (airMemo.own.get(code) ?? 0) / airMemo.total : 0;
}

/** (dx, dy, weight) of the engine's cone of 2.5 tiles about a road tile's traffic. */
const CAR_CONE: number[] = [];
for (let dy = -2; dy <= 2; dy++) {
  for (let dx = -2; dx <= 2; dx++) {
    const d = Math.hypot(dx, dy);
    if (d < 2.5) CAR_CONE.push(dx, dy, 1 - d / 2.5);
  }
}
/** A ridge this many metres above both ends stops air pollution altogether (the engine's). */
const HILL_BLOCKS_AT = 30;

/**
 * How much of a lot's pollution reaches the weighed tiles — the engine's spread from a lot: full over it, fading from
 * its edges to nothing at `radius` tiles, held back by a ridge in between. Only the tiles within `b` are summed.
 */
function lotReach(n: number, w: Float32Array, lot: { x: number; y: number; w: number; h: number }, strength: number, radius: number, height: Uint8Array | undefined, b: { x0: number; y0: number; x1: number; y1: number }): number {
  if (!(strength > 0)) return 0;
  const reach = radius + 1;
  const fy0 = Math.max(0, lot.y - radius);
  const fy1 = Math.min(n - 1, lot.y + lot.h - 1 + radius);
  const fx0 = Math.max(0, lot.x - radius);
  const fx1 = Math.min(n - 1, lot.x + lot.w - 1 + radius);
  const [y0, y1, x0, x1] = [Math.max(fy0, b.y0), Math.min(fy1, b.y1), Math.max(fx0, b.x0), Math.min(fx1, b.x1)];
  if (x0 > x1 || y0 > y1) return 0;
  const cx = lot.x + (lot.w - 1) / 2;
  const cy = lot.y + (lot.h - 1) / 2;
  const hs = height ? height[Math.round(cy) * n + Math.round(cx)]! : 0;
  // (As the engine: a ridge is looked for only when something in the whole reach stands above the source.)
  let hills = false;
  if (height) for (let y = fy0; y <= fy1 && !hills; y++) for (let x = fx0; x <= fx1; x++) if (height[y * n + x]! > hs) { hills = true; break; }
  let sum = 0;
  for (let y = y0; y <= y1; y++) {
    const dy = y < lot.y ? lot.y - y : y >= lot.y + lot.h ? y - (lot.y + lot.h - 1) : 0;
    for (let x = x0; x <= x1; x++) {
      const wt = w[y * n + x]!;
      if (!wt) continue;
      const dx = x < lot.x ? lot.x - x : x >= lot.x + lot.w ? x - (lot.x + lot.w - 1) : 0;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= reach) continue;
      let v = strength * (1 - d / reach);
      if (hills && height && d > 1) {
        const ends = Math.max(hs, height[y * n + x]!);
        let ridge = 0;
        const steps = Math.ceil(Math.max(Math.abs(x - cx), Math.abs(y - cy)));
        for (let k = 1; k < steps; k++) {
          const hk = height[Math.round(cy + ((y - cy) * k) / steps) * n + Math.round(cx + ((x - cx) * k) / steps)]!;
          if (hk - ends > ridge) ridge = hk - ends;
        }
        if (ridge > 0) v *= Math.max(0, 1 - ridge / HILL_BLOCKS_AT);
      }
      sum += wt * v;
    }
  }
  return sum;
}

/** How much of a cone about a point (the engine's spread of a spill, or of a farm's tile in water) reaches the weighed tiles within `b`. */
function coneReach(n: number, w: Float32Array, cx: number, cy: number, strength: number, radius: number, b: { x0: number; y0: number; x1: number; y1: number }): number {
  if (!(strength > 0) || radius <= 0) return 0;
  let sum = 0;
  for (let y = Math.max(0, b.y0, Math.floor(cy - radius)); y <= Math.min(n - 1, b.y1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, b.x0, Math.floor(cx - radius)); x <= Math.min(n - 1, b.x1, Math.ceil(cx + radius)); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < radius) sum += w[y * n + x]! * strength * (1 - d / radius);
    }
  }
  return sum;
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
  siteMemo = pipeMemo = plantMemo = awayMemo = pairMemo = spotMemo = pipeLineMemo = fillMemo = zoneMemo = plantSiteMemo = null;
  nearMemo = new Map();
  lineMemo = new Map();
  roadMemo = new Map();
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

/**
 * The nearest spot to (ax, ay) within `reach` rings where a footprint of `kind` passes `fits` (given its corner): its
 * middle tile. `pre` is checked before the engine is asked (its rectangle sums cost nothing; the engine's check grows
 * with the city, and a search of a big map that found nothing asked it 14,000 times).
 */
function nearestFit(kind: StructureKind, ax: number, ay: number, reach: number, fits: (lx: number, ly: number) => boolean, pre?: (lx: number, ly: number) => boolean): [number, number] | null {
  const d = STRUCTURES[kind];
  let at: [number, number] | null = null;
  for (let r = 0; r <= reach && !at; r++) {
    onRing(r, (dx, dy) => {
      const [lx, ly] = [ax + dx - ((d.w - 1) >> 1), ay + dy - ((d.h - 1) >> 1)]; // (a spot is the site's middle, as suggestSpot's)
      if (!footprintOpen(lx, ly, d.w, d.h) || (pre && !pre(lx, ly)) || !city.canPlaceStructure(kind, lx, ly).ok || !fits(lx, ly)) return false;
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
export function lineToDark(buildings = false): [number, number][] | null {
  const s = city.state;
  const f = city.fields;
  // (Buildings cut off, the advisor's count, aim at a dark building, not the nearest empty zone tile.)
  return powerPath(`line|${buildings ? 'b' : 'z'}|${siteKey()}`, buildings ? (j) => s.occupant[j]! > 0 && !f.powered[j] : (j) => !!s.zone[j] && s.zone[j] !== 10 && !f.powered[j]);
}

/**
 * The shortest power line from a plant that powers nobody to the city's grid or zones in the dark: from its own
 * footprint (from the nearest powered tile, the main grid was joined to the dark zones and the plant stayed idle).
 */
export function lineFromPlant(st: Structure): [number, number][] | null {
  const s = city.state;
  const f = city.fields;
  const n = city.size;
  const g0 = f.powerGrid[st.y * n + st.x]!;
  const own: number[] = [];
  for (let y = st.y; y < st.y + st.h; y++) for (let x = st.x; x < st.x + st.w; x++) own.push(y * n + x);
  const conductor = (j: number) => !!(s.power[j] || s.occupant[j] || (s.zone[j] && s.zone[j] !== 10));
  return powerPath(`line|p${st.id}|${siteKey()}`, (j) => (!!s.zone[j] && s.zone[j] !== 10 && !f.powered[j]) || (conductor(j) && f.powered[j] === 1 && f.powerGrid[j] !== g0), own);
}

/** The shortest power line from the grid to a facility or building without power (a pump that stopped for it), as lineToDark. */
export function lineToStructure(st: { id: number; x: number; y: number; w: number; h: number }, of: 'f' | 'b' = 'f'): [number, number][] | null {
  const n = city.size;
  // (Buildings and facilities number apart: 'f' or 'b' keeps one's memo from answering for the other.)
  return powerPath(`line|${of}${st.id}|${siteKey()}`, (j) => { const x = j % n; const y = (j - x) / n; return x >= st.x && x < st.x + st.w && y >= st.y && y < st.y + st.h; });
}

/**
 * The shortest power line from what has power (or from `from`'s tiles) to the first tile `target` takes, round
 * buildings; null if none. (A dead plant is no source: a line from it powered nothing.)
 */
function powerPath(key: string, target: (j: number) => boolean, from?: number[]): [number, number][] | null {
  const hit0 = lineMemo.get(key);
  if (hit0 !== undefined) return hit0;
  const s = city.state;
  const f = city.fields;
  const n = city.size;
  const N = n * n;
  const seen = new Int32Array(N).fill(-2); // -2 unseen, -1 a source, else the tile it was reached from
  const queue: number[] = [];
  if (from) for (const i of from) { seen[i] = -1; queue.push(i); }
  else for (let i = 0; i < N; i++) if (f.powered[i] && (s.power[i] || s.occupant[i] || (s.zone[i] && s.zone[i] !== 10))) { seen[i] = -1; queue.push(i); }
  let hit = -1;
  for (let h = 0; h < queue.length && hit < 0; h++) {
    const i = queue[h]!;
    const x = i % n;
    for (const j of [x < n - 1 ? i + 1 : -1, x > 0 ? i - 1 : -1, i + n < N ? i + n : -1, i - n]) {
      if (j < 0 || seen[j] !== -2) continue;
      if (target(j)) {
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
  remember8(lineMemo, key, at);
  return at;
}

/** Keeps a search's answer under its key, the oldest of eight let go (one entry was redone every refresh by two askers). */
function remember8<T>(memo: Map<string, T>, key: string, value: T): void {
  memo.set(key, value);
  if (memo.size > 8) memo.delete(memo.keys().next().value!);
}
let lineMemo = new Map<string, [number, number][] | null>();

/**
 * The shortest road from a facility's side to the nearest street, road or avenue at grade, over open dry land only
 * (no building, zone or other network on the way: nothing torn up or rezoned, no bridge), up to 40 tiles; null if none.
 * (What its 도로에 닿지 않음 wants: garbage trucks, and a station's crews, leave by a road beside it.)
 */
export function roadToFacility(f: { id: number; x: number; y: number; w: number; h: number }, of: 'f' | 'b' = 'f'): [number, number][] | null {
  const key = `road|${of}${f.id}|${siteKey()}`;
  const known = roadMemo.get(key);
  if (known !== undefined) return known;
  const s = city.state;
  const n = city.size;
  // (A building's lot sits in its zone: its road may cross the zone's empty tiles, as a road drawn there would.)
  const open = (i: number) => !s.occupant[i] && (of === 'b' || !s.zone[i]) && !s.net[i] && s.terrain[i] !== Terrain.Water && s.landform[i] !== 2; // (2: a volcano's cone)
  // A road network first, not a stub of road on its own (joined to one, the warning went quiet and the crews still
  // couldn't reach the town): a piece of 10 tiles or more (or the largest, in a town smaller than that). Any road,
  // if none is in reach. (Not the largest only: a district not yet joined to the rest has a network of its own.)
  const comp = city.fields.component;
  const sizes = new Map<number, number>();
  for (let i = 0; i < n * n; i++) if (comp[i]! >= 0) sizes.set(comp[i]!, (sizes.get(comp[i]!) ?? 0) + 1);
  const most = Math.max(0, ...sizes.values());
  let at: [number, number][] | null = null;
  for (const whole of most > 0 ? [true, false] : [false]) {
    const road = (i: number) => isLocalNet(s.net[i]!) && !s.tunnel[i] && (!whole || (sizes.get(comp[i]!) ?? 0) >= Math.min(10, most));
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
    if (path.length) { at = path; break; }
  }
  remember8(roadMemo, key, at);
  return at;
}
let roadMemo = new Map<string, [number, number][] | null>();

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
    // (Only those past the stage that needs water, as the advisor and the water view count: small homes beyond the
    // pipes drew a pipe that only added demand to a tight supply.)
    if (!b.type || b.watered || b.stage <= city.cfg.services.waterStageCap[b.type]) continue;
    const g = f.waterNet[b.y * n + b.x]!;
    dry = true;
    if (g >= 0) { wants.set(g, (wants.get(g) ?? 0) + 1); continue; }
    for (let y = Math.max(0, b.y - r); y < Math.min(n, b.y + b.h + r); y++) for (let x = Math.max(0, b.x - r); x < Math.min(n, b.x + b.w + r); x++) near[y * n + x]!++;
  }
  for (const g of wants.keys()) spare.delete(g);
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

/**
 * The straight stretch of jammed street or road through (x, y), along the axis it runs further: each tile the same
 * kind, at grade, past 90% of its capacity; its ends, or null. (What 대로로 넓히기 widens in one press.)
 */
export function jamRun(x: number, y: number): [number, number, number, number] | null {
  const s = city.state;
  const f = city.fields;
  const n = city.size;
  const kind = NETWORK_KINDS[s.net[y * n + x]!];
  if (kind !== 'street' && kind !== 'road') return null;
  const cap = city.cfg.transport.speed[kind].capacity;
  const jammed = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < n && ty < n && NETWORK_KINDS[s.net[ty * n + tx]!] === kind
    && !s.tunnel[ty * n + tx] && f.traffic[ty * n + tx]! > cap * 0.9;
  if (!jammed(x, y)) return null;
  const reach = (dx: number, dy: number) => { let k = 0; while (k < 64 && jammed(x + (k + 1) * dx, y + (k + 1) * dy)) k++; return k; };
  const [w, e, nn, sth] = [reach(-1, 0), reach(1, 0), reach(0, -1), reach(0, 1)];
  return w + e >= nn + sth ? [x - w, y, x + e, y] : [x, y - nn, x, y + sth];
}

/**
 * What a jammed stretch is widened to: a street whose busiest tile a road would carry with room to spare (a faster
 * road draws more cars), a road — a third of an avenue's price for each tile; else an avenue.
 */
export function widenTo(run: [number, number, number, number]): 'road' | 'avenue' {
  const n = city.size;
  const [x0, y0, x1, y1] = run;
  let top = 0;
  let streets = true;
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    top = Math.max(top, city.fields.traffic[y * n + x]!);
    if (NETWORK_KINDS[city.state.net[y * n + x]!] !== 'street') streets = false;
  }
  return streets && top <= city.cfg.transport.speed.road.capacity * 0.6 ? 'road' : 'avenue';
}

/**
 * The jammed stretch whose widening relieves the most: of every jammed street or road's stretch (jamRun), the one with
 * the most traffic over its capacity along it, or null. (By the worst tile alone it was often a 1-tile alley, and the
 * 166 jammed tiles went to 165.) Kept for the week.
 */
export function bestJamRun(): [number, number, number, number] | null {
  const key = changeKey();
  if (bestRunMemo?.key === key) return bestRunMemo.run;
  const s = city.state;
  const f = city.fields;
  const n = city.size;
  const cap = { street: city.cfg.transport.speed.street.capacity, road: city.cfg.transport.speed.road.capacity };
  const seen = new Set<string>();
  let best: [number, number, number, number] | null = null;
  let most = 0;
  for (let i = 0; i < n * n; i++) {
    const kind = NETWORK_KINDS[s.net[i]!];
    if ((kind !== 'street' && kind !== 'road') || s.tunnel[i] || f.traffic[i]! <= cap[kind]) continue;
    const run = jamRun(i % n, Math.floor(i / n));
    if (!run || seen.has(run.join())) continue;
    seen.add(run.join());
    let over = 0;
    for (let y = run[1]; y <= run[3]; y++) for (let x = run[0]; x <= run[2]; x++) over += Math.max(0, f.traffic[y * n + x]! - cap[kind]);
    if (over > most) [best, most] = [run, over];
  }
  bestRunMemo = { key, run: best };
  return best;
}
let bestRunMemo: { key: string; run: [number, number, number, number] | null } | null = null;

/** Does a building reach a road now (homes and shops fronting one, industry and farms within reach of one)? Its
 * countdown resets only at the month's end: without this, a road laid to it was offered again at once. */
export function hasRoadNow(b: Building): boolean {
  if (city.roadBeside(b.x, b.y, b.w, b.h)) return true;
  const n = city.size;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (city.fields.industrialAccess[y * n + x]) return true;
  return false;
}

/** Is there power to spare for one more building (the plants not past 85%, as the power screen judges)? */
export function powerToSpare(): boolean {
  const pw = readStats().power;
  return pw.supply > 0 && pw.demand <= pw.supply * 0.85;
}

/** What a one-press path lays (the guide's 바로 잇기, the info card's 도로 잇기). */
export type Lay = 'powerline' | 'road' | 'pipe';
export const LAY_WORD: Record<Lay, string> = { powerline: '송전선', road: '도로', pipe: '수도관' };

/**
 * What laying a path costs now, or null if it can't be laid as it is: a line's tiles a line or zone already covers
 * are free (the tool skips them), as a pipe's already piped; a road goes over no building or network (one there
 * since: found again).
 */
export function layCost(lay: Lay, line: readonly [number, number][]): number | null {
  const s = city.state;
  const n = city.size;
  // (Pipes run under anything on land.)
  if (lay === 'pipe') return line.some(([x, y]) => s.terrain[y * n + x] === Terrain.Water) ? null : line.filter(([x, y]) => !s.pipe[y * n + x]).length * city.cfg.services.pipeCost.build;
  if (line.some(([x, y]) => s.occupant[y * n + x] !== 0)) return null;
  if (lay === 'powerline') return line.filter(([x, y]) => !s.power[y * n + x] && !s.zone[y * n + x]).length * city.cfg.services.powerLineCost.build;
  // (But its first tile may be the town's own road it runs out from: the road to the neighbours starts there, and
  // 추천 길 바로 놓기 said "그사이 막혀서…" on every town with a road and laid nothing.)
  if (line.some(([x, y], k) => s.net[y * n + x] && !(k === 0 && isLocalNet(s.net[y * n + x]!)))) return null;
  let cost = 0;
  // (Each run after the first from the tile past its corner: priced twice, an L showed §60 for §50 and refused.)
  straightRuns(line).forEach(([x0, y0, x1, y1], k) => {
    if (cost < 0) return;
    const [sx, sy] = k ? [x0 + Math.sign(x1 - x0), y0 + Math.sign(y1 - y0)] : [x0, y0];
    const p = city.previewNetwork(sx, sy, x1, y1, 'road');
    if (!p.ok && p.message !== 'not enough funds') cost = -1;
    else cost += p.cost;
  });
  return cost < 0 ? null : cost;
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
  // (Nor a plant on a zone: the mark among dark zones put a coal plant on the shops just zoned.)
  const clear = smoky ? smokeClear(kind) : 0;
  const at = nearestFit(kind, x, y, reach, (lx, ly) => city.roadBeside(lx, ly, d.w, d.h),
    (lx, ly) => !(d.plant && zonedUnder(lx, ly, d.w, d.h)) && !(clear && homesNear(lx, ly, d.w, d.h, clear)));
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

/**
 * How far homes must keep from a facility for its own smoke to fall under the bad-air line (40, as the views count
 * it), 6 tiles at least: its smoke thins evenly to nothing a tile past its reach (coal: 14 tiles; within 6, as
 * before, homes beside a coal plant breathed 120).
 */
export function smokeClear(kind: StructureKind): number {
  const d = STRUCTURES[kind];
  const [amount, reach] = d.plant?.air ?? d.incinerator?.air ?? [0, 0];
  return Math.max(6, Math.ceil((reach + 1) * (1 - 40 / Math.max(40, amount))));
}

/** Homes (a residential zone) within R tiles of a rectangle (6, or a smoky facility's smokeClear). */
function homesNear(lx: number, ly: number, w: number, h: number, R = 6): boolean {
  return rectCount(homeTiles(), lx - R, ly - R, lx + w + R, ly + h + R) > 0;
}

/** Any zone under a rectangle (a plant or an incinerator put on one undid the player's zoning). */
function zonedUnder(lx: number, ly: number, w: number, h: number): boolean {
  return rectCount(zonedTiles(), lx, ly, lx + w, ly + h) > 0;
}

/** Residential and all zoned tiles, as rectangle sums (kept by the site key): each check above in O(1). */
const homeTiles = () => tileSums('homes', (z) => z >= 1 && z <= 3);
const zonedTiles = () => tileSums('zoned', (z) => z > 0);
const sums = new Map<string, { key: string; t: Int32Array }>();
function tileSums(name: string, counts: (zone: number) => boolean): Int32Array {
  const key = siteKey();
  const had = sums.get(name);
  if (had?.key === key) return had.t;
  const n = city.size;
  const W = n + 1;
  const z = city.state.zone;
  const t = new Int32Array(W * W);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = (y + 1) * W + x + 1;
    t[k] = (counts(z[y * n + x]!) ? 1 : 0) + t[k - 1]! + t[k - W]! - t[k - W - 1]!;
  }
  sums.set(name, { key, t });
  return t;
}
function rectCount(t: Int32Array, x0: number, y0: number, x1: number, y1: number): number {
  const n = city.size;
  const W = n + 1;
  [x0, y0, x1, y1] = [Math.max(0, x0), Math.max(0, y0), Math.min(n, x1), Math.min(n, y1)];
  return x1 <= x0 || y1 <= y0 ? 0 : t[y1 * W + x1]! - t[y0 * W + x1]! - t[y1 * W + x0]! + t[y0 * W + x0]!;
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
  const clear = smoky ? smokeClear(kind) : 0;
  const pre = (lx: number, ly: number) => !zonedUnder(lx, ly, d.w, d.h) && !(clear && homesNear(lx, ly, d.w, d.h, clear));
  const fits = (lx: number, ly: number) => city.roadBeside(lx, ly, d.w, d.h) && city.powerReach(kind, lx, ly) === 'powered';
  let at: [number, number] | null = null;
  let near = Infinity;
  for (const p of city.state.structures.values()) {
    if (!STRUCTURES[p.kind].plant) continue;
    const [cx, cy] = [p.x + (p.w >> 1), p.y + (p.h >> 1)];
    // (Nearest of all the plants': each looked at no further than the best found so far.)
    const found = nearestFit(kind, cx, cy, Math.min(16, near - 1), fits, pre);
    if (!found) continue;
    const r = Math.max(Math.abs(found[0] - cx), Math.abs(found[1] - cy));
    if (r < near) [near, at] = [r, found];
  }
  plantMemo = { key, at };
  return at;
}
let plantMemo: { key: string; at: [number, number] | null } | null = null;

/** The middle of the industry's buildings, or null with none. */
function industryMiddle(): [number, number] | null {
  let [sx, sy, count] = [0, 0, 0];
  for (const b of city.state.buildings.values()) {
    if (b.type?.[0] !== 'I') continue;
    sx += b.x + b.w / 2;
    sy += b.y + b.h / 2;
    count++;
  }
  return count ? [Math.round(sx / count), Math.round(sy / count)] : null;
}

/**
 * A site for a plant where none beside the plants or by the mark will do (a town's first coal plant, its smoke
 * reaching far; its last plant gone): the nearest to (ax, ay) — by default the industry, which minds the smoke
 * least — off the zones, beside a road, its smoke clear of the homes, feeding a zone or a line at once where it can
 * (else a line is still to lay). Its middle tile, or null.
 */
export function plantSite(kind: StructureKind, ax?: number, ay?: number): [number, number] | null {
  if (!buildable(kind) || !STRUCTURES[kind].plant) return null;
  if (ax === undefined || ay === undefined) [ax, ay] = industryMiddle() ?? homesMiddle();
  const key = `plant|${kind}|${ax},${ay}|${siteKey()}`;
  if (plantSiteMemo?.key === key) return plantSiteMemo.at;
  const d = STRUCTURES[kind];
  const clear = smokyPlant(kind) ? smokeClear(kind) : 0;
  const pre = (lx: number, ly: number) => !zonedUnder(lx, ly, d.w, d.h) && !(clear && homesNear(lx, ly, d.w, d.h, clear));
  const road = (lx: number, ly: number) => city.roadBeside(lx, ly, d.w, d.h);
  const at = nearestFit(kind, ax, ay, 40, (lx, ly) => road(lx, ly) && city.powerReach(kind, lx, ly) !== 'none', pre) ?? nearestFit(kind, ax, ay, 40, road, pre);
  plantSiteMemo = { key, at };
  return at;
}
let plantSiteMemo: { key: string; at: [number, number] | null } | null = null;

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
  const [ax, ay] = industryMiddle() ?? [n >> 1, n >> 1];
  // (An incinerator as far as its smoke carries; none of them on a zone.)
  const clear = smokeClear(kind);
  const at = nearestFit(kind, ax, ay, n, (lx, ly) => city.roadBeside(lx, ly, d.w, d.h), (lx, ly) => !zonedUnder(lx, ly, d.w, d.h) && !homesNear(lx, ly, d.w, d.h, clear));
  awayMemo = { key, at };
  return at;
}
let awayMemo: { key: string; at: [number, number] | null } | null = null;

/**
 * The landfill tiles at each month's garbage tally (a new tally, a new record), to tell a landfill laid since from a
 * full one. (The last few months: a save loaded from before a month's end brings back a month whose landfills were
 * noted then, where noting them again would count one laid that month as tallied.)
 */
const talliedLandfill = new Map<string, Set<number>>();
let freshMemo: { key: string; fresh: { tiles: number; joined: boolean } | null } | null = null;

/**
 * Landfill zoned since the month's garbage tally: its tiles, and whether a road runs beside one. The tally's figures
 * are last month's, so a landfill laid a moment ago read "가득 차" (full) and asked for a second one until the month's
 * end. (A city just opened counts what it has as tallied.)
 */
export function freshLandfill(): { tiles: number; joined: boolean } | null {
  const s = city.state;
  // (By the city and the tally's month, not the record itself: a load brings back a copy of the same tally.)
  const tally = `${cityLineage}|${s.history.at(-1)?.month ?? -1}`;
  let counted = talliedLandfill.get(tally);
  if (!counted) {
    counted = new Set<number>();
    for (let i = 0; i < s.zone.length; i++) if (s.zone[i] === 10) counted.add(i);
    talliedLandfill.set(tally, counted);
    if (talliedLandfill.size > 3) talliedLandfill.delete(talliedLandfill.keys().next().value!);
    freshMemo = null;
  }
  const key = `${tally}|${city.revision}|${cityGeneration}`;
  if (freshMemo?.key === key) return freshMemo.fresh;
  const n = city.size;
  const laid: number[] = [];
  for (let i = 0; i < s.zone.length; i++) if (s.zone[i] === 10 && !counted.has(i)) laid.push(i);
  // Joined as the trucks find it: anywhere along the landfill it is part of (a strip laid onto a full one away from its
  // road read "새 매립지 옆에 도로가 없습니다", and took 1,176 t at the tally).
  const seen = new Set(laid);
  const queue = [...laid];
  let joined = false;
  for (let h = 0; h < queue.length && !joined; h++) {
    const i = queue[h]!;
    const x = i % n;
    const y = (i - x) / n;
    if (city.roadBeside(x, y, 1, 1)) joined = true;
    for (const j of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1]) {
      if (j >= 0 && s.zone[j] === 10 && !seen.has(j)) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  freshMemo = { key, fresh: laid.length ? { tiles: laid.length, joined } : null };
  return freshMemo.fresh;
}

/**
 * A landfill to zone now: square, sized to hold about a year of the city's garbage (4×4 to 10×10), on open dry land
 * (no building, network or zone) with a road along it, near the industry and with no homes or shops within 10
 * tiles (its smell carries; within 6 if nothing is that far); its corners, tiles and price, or null if none.
 */
export function landfillSite(): { x0: number; y0: number; x1: number; y1: number; side: number; cost: number; months: number } | null {
  const key = `landfill|${siteKey()}`;
  if (fillMemo?.key === key) return fillMemo.at;
  const lf = city.cfg.garbage.landfill;
  // (Sized from what goes into landfills, as the guide's own test counts it: with an incinerator burning most of it,
  // the whole of the rubbish laid a 10×10 where a 5×5 did.)
  const g = readStats().garbage;
  const buried = Math.max(0, (g.kept || g.produced - g.recycled) - g.incinerated - (g.exported ?? 0));
  const side = Math.max(4, Math.min(10, Math.ceil(Math.sqrt((buried * 12) / lf.tileCapacity))));
  const cost = side * side * lf.zoneCost; // (the caller checks it against the funds: a loan since would not show here)
  // (How long it holds, said as that: kept from 4×4 to 10×10, a big city's square held six months under 1년치.)
  // (Under a ton a month — an incinerator burning the rest — it holds for good: said as nothing, not as a trillion years.)
  const months = buried >= 1 ? Math.floor((side * side * lf.tileCapacity) / buried) : 0;
  const [ax, ay] = centroid((b) => b.type?.[0] === 'I' && b.type !== 'IA');
  const sq = squareSite(side, ax, ay, (z) => z >= 1 && z <= 6, [10, 6]); // (homes and shops: R and C zones)
  const at = sq ? { ...sq, side, cost, months } : null;
  fillMemo = { key, at };
  return at;
}

/**
 * Where to zone a block of the kind the growth screen says is wanted next, 8×8 (6×6 if none fits): open dry land
 * with a road along it, shops by the homes, homes and factories each kept 6 tiles from the other's zones, nearest
 * to where that kind (or, for a first one, the homes) already is; its corners, or null.
 * (Any density: only low density takes a volcano's slope.)
 */
/** How long a landfill holds, in words: N년치 or N개월치 ('' with nothing buried, or past ten years: then it doesn't matter). */
export function fillSpan(months: number): string {
  return months > 120 ? '' : months >= 24 ? `${Math.floor(months / 12)}년치` : months >= 12 ? '1년치' : months > 0 ? `${months}개월치` : '';
}

export function zoneSite(zone: Exclude<ZoneKind, 'none' | 'landfill'>, near?: readonly [number, number]): { x0: number; y0: number; x1: number; y1: number; side: number } | null {
  const key = `zone|${zone}|${near?.join(',') ?? ''}|${siteKey()}`;
  if (zoneMemo?.key === key) return zoneMemo.at;
  const cls = zone[0]!;
  // (Farms by the farms: their type is IA, apart from industry.)
  const has = (c: string) => (b: Building) => (c === 'A' ? b.type === 'IA' : b.type?.[0] === c && b.type !== 'IA');
  const homes = [...city.state.buildings.values()].some(has('R'));
  // (Near a given place when there is one: work for homes about to be left for want of it.)
  const [ax, ay] = near ?? centroid(cls === 'C' || !([...city.state.buildings.values()].some(has(cls))) ? (homes ? has('R') : has(cls)) : has(cls));
  // (Homes and shops clear of a landfill too: it spoils them out to 32 tiles.)
  const avoid = cls === 'I' ? (z: number) => z >= 1 && z <= 3 : cls === 'R' ? (z: number) => z === 7 || z === 8 || z === 10 : (z: number) => z === 10;
  // (Homes and industry apart past where dirty industry's smoke reaches, where there is room near at hand: 6 tiles let
  // a block of factories foul the homes beside it from the day it grew. Only a few rings past the nearest block 6 tiles
  // clear, though — the nearest clear of the smoke anywhere sent work for homes about to be left to the outskirts — and
  // not for work beside a given place at all.)
  const smoke = (city.cfg.development.airPollution.ID?.radius ?? 5) + 1;
  const apart = (cls === 'I' || cls === 'R') && !near && smoke > 6;
  const low = zoneInfo(ZONES.indexOf(zone)).density === 'low';
  let at: { x0: number; y0: number; x1: number; y1: number; side: number } | null = null;
  for (const side of [8, 6]) {
    const sq6 = squareSite(side, ax, ay, avoid, [6], low);
    if (!sq6) continue;
    const r6 = Math.max(Math.abs(sq6.x0 + (side >> 1) - ax), Math.abs(sq6.y0 + (side >> 1) - ay));
    const sq = (apart ? squareSite(side, ax, ay, avoid, [smoke], low, r6 + 8) : null) ?? sq6;
    if (sq) { at = { ...sq, side }; break; }
  }
  zoneMemo = { key, at };
  return at;
}
let zoneMemo: { key: string; at: ReturnType<typeof zoneSite> } | null = null;

/** The middle of the buildings `test` takes (the map's middle when none does). */
function centroid(test: (b: Building) => boolean): [number, number] {
  const n = city.size;
  let [sx, sy, count] = [0, 0, 0];
  for (const b of city.state.buildings.values()) {
    if (!test(b)) continue;
    sx += b.x + b.w / 2;
    sy += b.y + b.h / 2;
    count++;
  }
  return count ? [Math.round(sx / count), Math.round(sy / count)] : [n >> 1, n >> 1];
}

/**
 * The nearest square of `side` to (ax, ay), ring by ring, on open dry land (no building, network or zone) with a road
 * along it and no zone `avoid` takes within R tiles (each R of `reach` in turn, the first that finds one); its
 * corners, or null. (Rectangle sums keep each try O(1): a few milliseconds on a large map.)
 */
function squareSite(side: number, ax: number, ay: number, avoid: (zone: number) => boolean, reach: number[], low = false, rings = Infinity): { x0: number; y0: number; x1: number; y1: number } | null {
  const s = city.state;
  const n = city.size;
  const W = n + 1;
  const busy = new Int32Array(W * W);
  const near = new Int32Array(W * W);
  const road = new Int32Array(W * W);
  // (A road network, not a stub on its own, as the one-press road wants: a landfill there fills nothing, a zone never grows.)
  const comp = city.fields.component;
  const sizes = new Map<number, number>();
  for (let i = 0; i < n * n; i++) if (comp[i]! >= 0) sizes.set(comp[i]!, (sizes.get(comp[i]!) ?? 0) + 1);
  const enough = Math.min(10, Math.max(0, ...sizes.values()));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const z = s.zone[i]!;
      // (Nor under elevated track, nor on a slope for more than low density: the zone tool skips those tiles, and a
      // site with them was refused on every press and found again.)
      const b = s.occupant[i] || s.net[i] || z || s.elevated[i] || s.terrain[i] === Terrain.Water || s.landform[i] === 2 || (!low && s.landform[i] === 3) ? 1 : 0; // (2: a volcano's cone; 3: its slope)
      const k = (y + 1) * W + x + 1;
      busy[k] = b + busy[k - 1]! + busy[k - W]! - busy[k - W - 1]!;
      near[k] = (avoid(z) ? 1 : 0) + near[k - 1]! + near[k - W]! - near[k - W - 1]!;
      road[k] = (isLocalNet(s.net[i]!) && !s.tunnel[i] && (sizes.get(comp[i]!) ?? 0) >= enough ? 1 : 0) + road[k - 1]! + road[k - W]! - road[k - W - 1]!;
    }
  }
  const sum = (t: Int32Array, x0: number, y0: number, x1: number, y1: number) => {
    [x0, y0, x1, y1] = [Math.max(0, x0), Math.max(0, y0), Math.min(n, x1), Math.min(n, y1)];
    return t[y1 * W + x1]! - t[y0 * W + x1]! - t[y1 * W + x0]! + t[y0 * W + x0]!;
  };
  let at: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (const R of reach) {
    for (let r = 0; r <= Math.min(n, rings) && !at; r++) {
      onRing(r, (dx, dy) => {
        const [lx, ly] = [ax + dx - (side >> 1), ay + dy - (side >> 1)];
        if (lx < 0 || ly < 0 || lx + side > n || ly + side > n) return false;
        if (sum(busy, lx, ly, lx + side, ly + side) || sum(near, lx - R, ly - R, lx + side + R, ly + side + R)) return false;
        // A road along a whole side (one gap allowed), not one tile at a corner: an 8×8 block touching a road at its
        // corner left 18 of its tiles out of reach of it, undeveloped.
        const front = Math.max(sum(road, lx, ly - 1, lx + side, ly), sum(road, lx, ly + side, lx + side, ly + side + 1),
          sum(road, lx - 1, ly, lx, ly + side), sum(road, lx + side, ly, lx + side + 1, ly + side));
        if (front < side - 1) return false;
        at = { x0: lx, y0: ly, x1: lx + side - 1, y1: ly + side - 1 };
        return true;
      });
    }
    if (at) break;
  }
  return at;
}
let fillMemo: { key: string; at: ReturnType<typeof landfillSite> } | null = null;

/**
 * Sites for a pair of bus stops: one where the most people live, one where the most work (a stop alone carries
 * no one: a trip rides from a stop near home to one near work), each beside a road and within 8 tiles of the
 * middle of its block (blocks of 12 tiles). Their middle tiles, or null.
 */
export function stopPair(kind: StructureKind, afford = 2): [[number, number], [number, number]] | null {
  // (The money for both, as the guide builds them together; for one where a stop already stands on the other side.)
  if (!buildable(kind, afford)) return null;
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
 * Would full funding mend a school or hospital's trouble (the info card's 예산 100%로 and the guide's say the same)?
 * Back within its places at 100%, or, on strike, its grade there reaching the strike's end; past that, one more
 * beside it is the fix. (Police and fire stations have no places: their budget alone ends a strike.)
 */
export function budgetMends(f: Structure, strike: boolean): boolean {
  const svc = STRUCTURES[f.kind].health ?? STRUCTURES[f.kind].school;
  if (f.funding >= 100) return false;
  return !svc || f.load * (strike ? city.cfg.services.strikeEndGrade : 1) <= svc.capacity;
}

/**
 * For a school or hospital at (x, y) that is over its places: the cheapest unlocked kind of the same
 * level (an elementary school took nothing from a striking high school, and the strike went on).
 */
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

/** The dark zone tiles of each power grid (by the engine's grid id), and of all of them. */
function darkGrids(): { per: Map<number, number>; total: number } {
  const zone = city.state.zone;
  const { powered, powerGrid } = city.fields;
  const per = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < zone.length; i++) {
    const z = zone[i]!;
    if (!z || z === 10 || powered[i]) continue;
    total++;
    const g = powerGrid[i]!;
    if (g >= 0) per.set(g, (per.get(g) ?? 0) + 1);
  }
  return { per, total };
}

/** The dark zone tiles a plant with its middle at (x, y) would light: all of every dark grid within its reach (the engine's). */
function litBy(kind: StructureKind, x: number, y: number, dark: { per: Map<number, number> }): number {
  const d = STRUCTURES[kind];
  const n = city.size;
  const reach = city.cfg.services.powerGap + 1;
  const [lx, ly] = [x - ((d.w - 1) >> 1), y - ((d.h - 1) >> 1)];
  const { powered, powerGrid } = city.fields;
  const seen = new Set<number>();
  let sum = 0;
  for (let ty = Math.max(0, ly - reach); ty <= Math.min(n - 1, ly + d.h - 1 + reach); ty++) {
    for (let tx = Math.max(0, lx - reach); tx <= Math.min(n - 1, lx + d.w - 1 + reach); tx++) {
      const i = ty * n + tx;
      const g = powerGrid[i]!;
      if (g < 0 || powered[i] || seen.has(g)) continue;
      seen.add(g);
      sum += dark.per.get(g) ?? 0;
    }
  }
  return sum;
}

export function suggestSpot(id: GoalId): { x: number; y: number; tiles: number; crowded?: true; of?: [number, number]; lit?: number; blds?: number; plants?: number } | null {
  const key = `${id}|${changeKey()}`;
  if (spotMemo?.key === key) return spotMemo.spot;
  // A school or hospital on strike or far over its places: the new one goes beside it, to take some of
  // its load (built where homes were out of reach, a school a month went up and the strike went on).
  // (Still standing there and still over, read from the map: the advice can be a week behind an edit, and a school
  // pulled down left its "beside the full school" over empty ground.)
  const stillOver = (at: readonly [number, number]) => {
    const occ = city.state.occupant[at[1] * city.size + at[0]]!;
    const st = occ < 0 ? city.state.structures.get(-occ) : undefined;
    const d = st ? STRUCTURES[st.kind] : undefined;
    return !!st && !!(d?.school || d?.health) && (!!st.strike || st.load > st.capacity);
  };
  const over = id === 'education' || id === 'health'
    ? adviceFor(id).find((a) => a.at && ['schoolStrike', 'hospitalStrike', 'schoolFull', 'hospitalFull'].includes(a.code) && stillOver(a.at)) : undefined;
  const kind = over ? relieverFor(over.at!) ?? cheapestOf(GOALS[id]) : null;
  // (The nearest site beside a full one where its reliever fits, with a road.)
  // (With where the full one stands, so a site for another level or class is not put beside it.)
  const beside = (at: readonly [number, number], k: StructureKind) => {
    const d = STRUCTURES[k];
    const [ax, ay] = at;
    for (let r = 1; r <= 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const [x, y] = [ax + dx, ay + dy];
      const [lx, ly] = [x - ((d.w - 1) >> 1), y - ((d.h - 1) >> 1)]; // (a spot is the site's middle)
      if (!city.canPlaceStructure(k, lx, ly).ok || !city.roadBeside(lx, ly, d.w, d.h)) continue;
      return { x, y, tiles: 0, crowded: true as const, of: [ax, ay] as [number, number] };
    }
    return null;
  };
  if (over && kind) {
    const spot = beside(over.at!, kind);
    if (spot) {
      spotMemo = { key, spot };
      return spot;
    }
  }
  const want = need(id);
  let spot: { x: number; y: number; tiles: number; crowded?: true; of?: [number, number]; lit?: number; blds?: number; plants?: number } | null = null;
  let lit = 0;
  if (want) {
    // Counted in blocks of 12 tiles; the fullest block's middle of its needing tiles.
    const n = city.size;
    const B = 12;
    const per = Math.ceil(n / B);
    const count = new Float64Array(per * per);
    const sx = new Float64Array(per * per);
    const sy = new Float64Array(per * per);
    const hits = new Uint32Array(per * per);
    const vip = new Uint8Array(per * per); // (a plant out of fire cover: a building's tiles weigh 1 at most, a plant's more)
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = want(y * n + x);
      if (!v) continue;
      const b = Math.floor(y / B) * per + Math.floor(x / B);
      count[b] = count[b]! + v;
      hits[b] = hits[b]! + 1;
      if (id === 'fire' && v > 1) vip[b] = 1;
      sx[b] = sx[b]! + x * v;
      sy[b] = sy[b]! + y * v;
    }
    // A handful of tiles is noise at the edge of a zone, not a gap worth a building — passed over in the choosing, not
    // after it (the block it won stood alone and was then thrown out, and with it every other): save for a plant out of
    // fire cover, small as a wind plant's two tiles are.
    let best = -1;
    for (let b = 0; b < count.length; b++) if ((hits[b]! >= 6 || vip[b]) && count[b]! > (best < 0 ? 0 : count[best]!)) best = b;
    if (best >= 0) {
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
          // (The rectangle sums first: the engine's check grows with the city.)
          return !(d.plant && zonedUnder(lx, ly, d.w, d.h)) && !(clear && homesNear(lx, ly, d.w, d.h, smokeClear(kind)))
            && city.canPlaceStructure(kind, lx, ly).ok && city.roadBeside(lx, ly, d.w, d.h);
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
        // (A plant that feeds: of those near the first found, the one whose reach takes in the most dark zone tiles —
        // homes and work a gap apart are both lit by a plant set in the gap, where the first site found lit one and
        // left a line to lay.)
        const dark = id === 'power' && kind ? darkGrids() : null;
        search: for (const { feed, clear } of passes) {
          let top: { at: [number, number]; lit: number } | null = null;
          let until = reach;
          rings: for (let r = 0; r <= until; r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !fits(cx + dx, cy + dy, clear) || (feed && !feeds(cx + dx, cy + dy))) continue;
              if (!feed || !dark || !kind) {
                at = [cx + dx, cy + dy];
                break search;
              }
              const got = litBy(kind, cx + dx, cy + dy, dark);
              if (!top) until = Math.min(reach, r + 8);
              if (!top || got > top.lit) top = { at: [cx + dx, cy + dy], lit: got };
              if (got >= dark.total) break rings; // (every dark tile in reach: none does better)
            }
          }
          if (top) {
            at = top.at;
            lit = top.lit;
            break search;
          }
        }
      }
      // (For a station: the buildings among them, in the unit its view counts — and the plants out of fire cover, apart.)
      let blds = 0;
      let plants = 0;
      if (SERVICE.has(id) || id === 'water') {
        const seen = new Set<number>();
        const bx = (best % per) * B;
        const by = Math.floor(best / per) * B;
        for (let y = by; y < Math.min(n, by + B); y++) for (let x = bx; x < Math.min(n, bx + B); x++) {
          const i = y * n + x;
          if (want(i) > 0 && s.occupant[i]) seen.add(s.occupant[i]!);
        }
        for (const o of seen) o > 0 ? blds++ : plants++;
      }
      spot = { x: at[0], y: at[1], tiles: hits[best]!, ...(lit ? { lit } : {}), ...(blds ? { blds } : {}), ...(plants ? { plants } : {}) };
    }
  }
  // Every home in reach but the places short (a school, or a hospital, past its places): beside the fullest of them,
  // as a full one the advisor names is (학교 정원의 104% · 넘침 had nowhere to build). Of any level, a new one of its
  // own beside it: only the level shortest of places overall missed a primary school at 120% beside half-empty ones.
  if (!spot && (id === 'education' || id === 'health')) {
    const ward = (k: StructureKind) => ((id === 'education' ? STRUCTURES[k].school?.radius : STRUCTURES[k].health?.radius) ?? Infinity) < 300;
    const full = facilities(GOALS[id]).filter((f) => f.capacity > 0 && f.load > f.capacity && ward(f.kind)).sort((a, b) => b.load / b.capacity - a.load / a.capacity)[0];
    const k = full ? relieverFor([full.x, full.y]) : null;
    if (full && k) spot = beside([full.x, full.y], k);
  }
  spotMemo = { key, spot };
  return spot;
}

/**
 * What is happening right now and can't wait for a plan: buildings and trees burning
 * (소방), mobs in the streets (치안). Each with where it is and the unit to send.
 */
export type Incident = { goal: 'fire' | 'police'; title: string; at: [number, number]; places: [number, number][]; tool: 'send-fire' | 'send-police'; urgent: boolean; riot?: boolean; /** (a fire) why it is or isn't urgent, for its row */ why?: string; /** (a fire) a power plant is alight: it may blow up */ plant?: boolean };
let incidentMemo: { key: string; list: Incident[] } | null = null;
export function incidents(): Incident[] {
  const s = city.state;
  const key = `${changeKey()}|${s.day}|${s.fires.length}|${s.treeFires.length}|${s.mobs.length}|${s.arsonists.length}|${s.units.length}`;
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
  const n = s.size;
  const onPlant = s.fires.some((f) => f.target < 0 && !!STRUCTURES[s.structures.get(-f.target)?.kind ?? 'park' as StructureKind]?.plant);
  const outside = fire.some(([x, y]) => (cover[y * n + x] ?? 0) <= 0);
  // Being put out: the cover over it beats its stage (it burns down a stage a day), or a crew is there or on its way;
  // on its first day, a free crew will be sent tomorrow. Else nobody is coming — an underfunded or striking station,
  // every truck out, woods (no crew is sent to trees) — and it was "소방서가 끄는 중" while the farm burned down.
  const pps = city.cfg.safety.protectionPerStage;
  const reach = city.cfg.safety.dispatch.fire.radius;
  const crewAt = (x: number, y: number) => s.units.some((u) => u.kind === 'fire' && Math.hypot(u.x - x, u.y - y) <= reach);
  // (Crews automatic dispatch sends: an unfunded station's fumble, and none goes.)
  const free = city.freeUnits('fire', true) > 0;
  let unfought = false;
  let pending = false;
  let alone: [number, number] | undefined; // the first fire nobody is putting out
  for (const f of s.fires) {
    const r = f.target > 0 ? s.buildings.get(f.target) : s.structures.get(-f.target);
    if (!r) continue;
    let best = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) best = Math.max(best, cover[y * n + x] ?? 0);
    if (best >= pps * f.stage || crewAt(r.x + r.w / 2, r.y + r.h / 2)) continue;
    // (A crew goes out to a fire in the step after its first day is counted: one reading 1 day is still to be met.)
    if (f.days <= 1 && free) pending = true;
    else {
      unfought = true;
      alone ??= [r.x, r.y];
    }
  }
  unfought ||= s.treeFires.some((t) => (cover[t.i] ?? 0) < pps && !crewAt((t.i % n) + 0.5, Math.floor(t.i / n) + 0.5));
  const fireUrgent = fire.length >= 3 || onPlant || outside || unfought;
  // (Said as what it costs if left, as the rows say it: what to do is the card's above them.)
  const why = onPlant ? '발전소가 타는 중 · 폭발할 수 있음' : outside ? '소방서 반경 밖 · 번질 수 있음' : unfought ? '끄러 가는 소방차가 없음 · 번질 수 있음'
    : fireUrgent ? '번지는 중' : pending ? '소방서가 곧 출동' : '소방서가 끄는 중';
  // Where it is worst, first (where 보기 and 바로 보내기 go): a plant alight, then a fire beyond reach, then one nobody
  // is putting out (the card said no truck was coming and sent the next one to the fire that had its crew).
  const plantLot = s.fires.map((f) => (f.target < 0 ? s.structures.get(-f.target) : undefined)).find((st) => !!st && !!STRUCTURES[st.kind].plant);
  const worst: [number, number] | undefined = plantLot ? [plantLot.x, plantLot.y] : fire.find(([x, y]) => (cover[y * s.size + x] ?? 0) <= 0) ?? alone;
  if (fire.length) list.push({ goal: 'fire', title: `불이 났습니다 · ${fmt(fire.length)}곳`, at: worst ?? fire[0]!, places: fire, tool: 'send-fire', urgent: fireUrgent, why, plant: onPlant });
  if (s.mobs.length) list.push({ goal: 'police', title: `폭동이 일어났습니다 · ${fmt(s.mobs.length)}곳`, at: [s.mobs[0]!.x, s.mobs[0]!.y], places: s.mobs.map((m) => [m.x, m.y]), tool: 'send-police', urgent: true, riot: true });
  // Arsonists show up before they strike: police on the spot lock them up.
  if (s.arsonists.length) {
    const days = Math.min(...s.arsonists.map((a) => a.days));
    const soonest = s.arsonists.find((a) => a.days === days)!;
    list.push({ goal: 'police', title: `방화범이 보입니다 · ${fmt(s.arsonists.length)}명 — ${fmt(days)}일 안에 경찰을 보내면 막습니다`, at: [soonest.x, soonest.y], places: s.arsonists.map((a) => [a.x, a.y]), tool: 'send-police', urgent: true });
  }
  incidentMemo = { key, list };
  return list;
}
