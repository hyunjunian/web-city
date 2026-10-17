// Small history charts (population, funds, Mayor Rating…) with a crosshair
// tooltip. Most have one series, named by the title; graphs that set
// capacity against usage add a second, dashed line with a key in the
// caption. The Traffic Volume Graph's nine lines are drawn as small multiples.

import type { HistoryPoint, VolumeKind } from '@web-city/engine';

interface GraphDef {
  key: string;
  title: string;
  /** The goal whose screen shows it. */
  goal: string;
  value: (h: HistoryPoint) => number;
  format: (v: number) => string;
  /** Starts a group with this heading. */
  group?: string;
  /** Hidden while the whole history is zero (traffic kinds the city doesn't have yet). */
  optional?: boolean;
  /** Names of the two series when there is a second one. */
  names?: [string, string];
  /** A second series (dashed), e.g. capacity against usage. */
  compare?: (h: HistoryPoint) => number;
  /** The space between the two series shaded by which is ahead (income over spending: the month's surplus or deficit). */
  gap?: true;
  /** Colour tokens for the first and second series. */
  colors?: [string, string];
  /** Which way is better (1 up, −1 down): the change over the period is coloured by it (none: plain). */
  better?: 1 | -1;
}

const fmt = (v: number) => Math.round(v).toLocaleString('en-US');
const money = (v: number) => `${v < 0 ? '−' : ''}§${fmt(Math.abs(v))}`;

/** Hours as "18분" or "1시간 05분". */
const minutes = (v: number) => {
  const m = Math.round(v * 60);
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${String(m % 60).padStart(2, '0')}분`;
};

const TRAFFIC: [VolumeKind, string][] = [
  ['pedestrian', '걷기'], ['car', '자동차'], ['bus', '버스'], ['subway', '지하철·고가 철도'], ['passengerTrain', '여객 열차'],
  ['freightTrain', '화물 열차'], ['freightTruck', '화물 트럭'], ['ferry', '페리'], ['monorail', '모노레일'],
];

const GRAPHS: GraphDef[] = [
  { key: 'population', goal: 'growth', title: '인구', value: (h) => h.population, format: fmt, better: 1 },
  { key: 'jobs', goal: 'growth', title: '일자리', value: (h) => h.jobs, format: fmt, better: 1 },
  { key: 'funds', goal: 'finance', title: '자금', value: (h) => h.funds, format: money, better: 1 },
  { key: 'mayorRating', goal: 'finance', title: '시장 평점', value: (h) => h.mayorRating, format: fmt, better: 1 },
  { key: 'crimes', goal: 'police', title: '범죄와 체포', better: -1, value: (h) => h.crimes, compare: (h) => h.arrests ?? 0, names: ['범죄', '체포'], colors: ['--danger', '--accent'], format: fmt },
  { key: 'budget', goal: 'finance', title: '수입과 지출 (월)', value: (h) => h.income ?? 0, compare: (h) => h.expenses ?? 0, names: ['수입', '지출'], colors: ['--good', '--danger'], format: (v) => `§${fmt(v)}`, optional: true, gap: true },
  { key: 'abandoned', goal: 'growth', title: '버려진 건물', value: (h) => h.abandoned ?? 0, format: (v) => `${fmt(v)}채`, optional: true, better: -1 },
  { key: 'commute', goal: 'traffic', title: '평균 통근 시간', value: (h) => h.commute ?? 0, format: minutes, optional: true, better: -1 },
  { key: 'power', goal: 'power', title: '전력 (수요 대 공급)', value: (h) => h.powerDemand ?? 0, compare: (h) => h.powerSupply ?? 0, names: ['수요', '공급'], format: (v) => `${fmt(v)} MWh`, optional: true },
  { key: 'water', goal: 'water', title: '수도 (수요 대 공급)', value: (h) => h.waterDemand ?? 0, compare: (h) => h.waterSupply ?? 0, names: ['수요', '공급'], format: (v) => `${fmt(v)} m³`, optional: true },
  { key: 'garbage', goal: 'garbage', title: '쓰레기 발생 (월, 재활용·조례 감축 전)', value: (h) => h.garbageProduced ?? 0, format: (v) => `${fmt(v)} t`, optional: true },
  { key: 'air', goal: 'environment', title: '대기 오염 (도시 평균)', value: (h) => h.air ?? 0, format: (v) => dec(v), optional: true, better: -1 },
  { key: 'waterPollution', goal: 'environment', title: '수질 오염 (도시 평균)', value: (h) => h.waterPollution ?? 0, format: (v) => dec(v), optional: true, better: -1 },
  { key: 'eq', goal: 'education', title: '교육 지수 (평균)', value: (h) => h.eq ?? 0, format: (v) => v.toFixed(0), optional: true, better: 1 },
  { key: 'life', goal: 'health', title: '기대 수명', value: (h) => h.lifeExpectancy ?? 0, format: (v) => `${v.toFixed(0)}세`, optional: true, better: 1 },
  ...TRAFFIC.map(([k, title], i): GraphDef => ({
    key: `trips-${k}`, goal: 'traffic', title, value: (h) => h.trips?.[k] ?? 0, format: (v) => `${v < 10 ? dec(v) : fmt(v)}회/일`, group: i === 0 ? '교통량 (하루 통행)' : undefined, optional: true,
  })),
];

/** Each graph's key and the goal it is of (a goal's tabs share them out). */
export const GRAPH_KEYS = GRAPHS.map(({ key, goal }) => ({ key, goal }));

const RANGE_KEY = 'web-city:graph-range';

/** One decimal, but a plain 0 (axes read 0.0 beside whole numbers). */
function dec(v: number): string {
  return v === 0 ? '0' : v.toFixed(1);
}

/** Graph periods in months (0: all). */
const RANGES: [number, string][] = [[12, '1년'], [120, '10년'], [0, '전체']];

/** Drawing width while the graph isn't laid out (it otherwise takes its box's width). */
const W = 260;
const H = 64;
const PAD = 7; // the end dot (radius 4) and peaks stay inside

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// A point is recorded as a month ends (the date has just turned): it holds the month before.
const date = (month: number) => `${2000 + Math.floor((month - 1) / 12)}년 ${((month - 1) % 12) + 1}월`;
/** The months a span covers, short: 2000년 1–10월 within a year, else 2000년 1월 – 2003년 6월. */
const spanText = (from: number, to: number) => {
  const y = (m: number) => 2000 + Math.floor((m - 1) / 12);
  const mo = (m: number) => ((m - 1) % 12) + 1;
  return y(from) === y(to) ? `${y(from)}년 ${mo(from)}–${mo(to)}월` : `${date(from)} – ${date(to)}`;
};

export class Graphs {
  private hover: { key: string; index: number } | null = null;
  private lastLength = -1;
  private history: readonly HistoryPoint[] = [];

  /** Months shown (0: the whole history), remembered per browser. */
  private range = (() => {
    try {
      return Number(localStorage.getItem(RANGE_KEY) ?? 0) || 0;
    } catch {
      return 0;
    }
  })();

  /** The span's buttons and the months shown, moved to the section's heading. */
  private readonly rangeEl: HTMLElement;
  private readonly spanEl: HTMLElement;

  constructor(private readonly el: HTMLElement) {
    el.innerHTML = `<div class="segmented graph-range" role="group" aria-label="기간">
      ${RANGES.map(([m, label]) => `<button type="button" data-range="${m}" class="${m === this.range ? 'active' : ''}">${label}</button>`).join('')}
    </div><small class="sec-note graph-span"></small>` + GRAPHS.map((g) => `${g.group ? `<h3 class="sub" data-goal="${g.goal}" data-stem="${g.key.split('-')[0]}">${g.group}</h3>` : ''}
      <figure class="graph" data-key="${g.key}" data-goal="${g.goal}">
        <figcaption><span>${g.title}${g.names ? ` <span class="graph-key"><i style="background:var(${(g.colors ?? ['--accent', '--muted'])[0]})"></i>${g.names[0]} <i class="dash" style="border-color:var(${(g.colors ?? ['--accent', '--muted'])[1]})"></i>${g.names[1]}</span>` : ''}</span><span class="graph-value"></span></figcaption>
        <canvas width="${W}" height="${H}" aria-label="${g.title} 추이"></canvas>
      </figure>`).join('');
    this.rangeEl = el.querySelector<HTMLElement>('.graph-range')!;
    this.spanEl = el.querySelector<HTMLElement>('.graph-span')!;
    el.querySelectorAll<HTMLButtonElement>('[data-range]').forEach((b) => {
      b.onclick = () => {
        this.range = Number(b.dataset.range);
        try {
          localStorage.setItem(RANGE_KEY, String(this.range));
        } catch { /* storage unavailable */ }
        this.rangeEl.querySelectorAll('[data-range]').forEach((o) => o.classList.toggle('active', o === b));
        this.lastLength = -1;
        this.update(this.history);
      };
    });
    // The span's buttons and its months on the section's heading row (추이 · 2000년 1–10월 · 1년 10년 전체), not two rows
    // of their own over the first graph, which put the screen's 추천 조치 under the fold.
    const head = el.closest('.mg-sec')?.querySelector<HTMLElement>(':scope > h3');
    if (head) head.append(this.spanEl, this.rangeEl);
    // Opening a goal or resizing the window changes the graphs' width.
    let width = 0;
    // Redrawn in the next frame: drawing shows or hides graphs, which changes the
    // size being observed (inside the callback that is a ResizeObserver loop error).
    let queued = 0;
    new ResizeObserver(() => {
      if (el.clientWidth === width || queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        width = el.clientWidth;
        this.redraw();
      });
    }).observe(el);
    el.querySelectorAll<HTMLCanvasElement>('canvas').forEach((c) => {
      const key = (c.parentElement as HTMLElement).dataset.key!;
      const scrub = (e: PointerEvent) => {
        const r = c.getBoundingClientRect();
        this.hover = { key, index: (e.clientX - r.left) / r.width };
        this.lastLength = -1;
        this.update(this.history);
      };
      c.addEventListener('pointermove', scrub);
      // A tap or a sideways drag reads a month on a touch screen (the sheet still scrolls up and down).
      c.style.touchAction = 'pan-y';
      c.addEventListener('pointerdown', scrub);
      c.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'touch') return; // a lifted finger leaves the reading up
        this.hover = null;
        this.lastLength = -1;
        this.update(this.history);
      });
    });
  }

  /** Shows only the graphs of this goal (a goal's screen) — or of these keys, its tab's — or none. */
  setGoal(goal: string | null, keys: readonly string[] | null = null): void {
    let any = false;
    const on = (f: HTMLElement) => (keys ? (f.dataset.key ? keys.includes(f.dataset.key) : keys.some((k) => k.startsWith(`${f.dataset.stem}-`))) : f.dataset.goal === goal);
    this.el.querySelectorAll<HTMLElement>('[data-goal]').forEach((f) => {
      const shown = !!goal && on(f);
      f.classList.toggle('off', !shown);
      any ||= shown;
    });
    this.el.hidden = !any;
    this.rangeEl.hidden = this.spanEl.hidden = !any;
    this.redraw();
  }

  /** Forgets what was drawn, so the next update draws (another city's history may be as long). */
  invalidate(): void {
    this.lastLength = -1;
  }

  /** Redraws now (after a theme change or a resize). */
  redraw(): void {
    this.lastLength = -1;
    this.update(this.history);
  }

  /** Redraws when the history grows or the pointer moves. */
  update(all: readonly HistoryPoint[]): void {
    this.history = all;
    if (all.length === this.lastLength && !this.hover) return;
    // Out of sight (no goal's screen open): drawn at the first update once
    // it shows (noting the length here left it blank when opened while paused).
    if (!this.el.offsetParent) {
      this.lastLength = -1;
      return;
    }
    this.lastLength = all.length;
    const history = this.range ? all.slice(-this.range) : all;
    // A span no shorter than the record shows the same as 전체: not offered until there is more (10년 beside 전체 drew
    // the same lines for a city of 35 months), and 전체 lit while it is so.
    const span = this.range && all.length > this.range ? this.range : 0;
    for (const b of this.rangeEl.querySelectorAll<HTMLButtonElement>('[data-range]')) {
      const m = Number(b.dataset.range);
      b.disabled = m > 0 && all.length <= m;
      b.title = b.disabled ? `기록이 ${all.length}개월이라 전체와 같습니다` : '';
      b.classList.toggle('active', m === span);
    }
    // The months every graph below spans (they share one time axis).
    this.spanEl.textContent = history.length >= 2 ? spanText(history[0]!.month, history.at(-1)!.month) : '';
    this.spanEl.title = history.length >= 2 ? `아래 그래프가 보여 주는 ${history.length}개월` : '';
    const ink = css('--muted') || '#9aa1ad';
    const line = css('--accent') || '#5fb0ff';
    const grid = css('--border') || '#363b46';
    const chip = css('--surface-2') || '#f0f0f2'; // the plot's own background (style.css .graph canvas)
    // Which optional graphs show is settled first, then every width is read,
    // then everything is drawn: a figure shown in this pass must be measured
    // visible, and interleaving reads and writes made the browser lay the
    // page out again for each graph.
    for (const g of GRAPHS) {
      if (!g.optional || history.length < 2) continue;
      const fig = this.el.querySelector<HTMLElement>(`figure[data-key="${g.key}"]`)!;
      fig.hidden = history.every((h) => g.value(h) === 0 && (!g.compare || g.compare(h) === 0));
    }
    const figs = GRAPHS.map((g) => {
      const fig = this.el.querySelector<HTMLElement>(`figure[data-key="${g.key}"]`)!;
      const canvas = fig.querySelector('canvas')!;
      return { fig, canvas, label: fig.querySelector<HTMLElement>('.graph-value')!, w: canvas.clientWidth || W };
    });
    const dpr = window.devicePixelRatio || 1;
    for (const [gi, g] of GRAPHS.entries()) {
      const { fig, canvas, label, w } = figs[gi]!;
      // Drawn at its displayed width, so marks aren't stretched.
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== H * dpr) canvas.height = H * dpr;
      canvas.style.width = '100%';
      canvas.style.height = `${H}px`;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, H);
      if (history.length < 2) {
        label.textContent = '데이터 없음';
        continue;
      }
      const vals = history.map((h) => g.value(h));
      const other = g.compare ? history.map((h) => g.compare!(h)) : null;
      if (fig.hidden || fig.classList.contains('off')) continue;
      const min = Math.min(...vals, ...(other ?? []));
      const max = Math.max(...vals, ...(other ?? []));
      // From zero, unless the values keep well away from it: then the axis fits
      // them (funds falling from §330k to §261k read as flat against zero) and
      // its ends are labelled.
      const fit = (min > 0 && max - min < 0.5 * max) || (max < 0 && max - min < -0.5 * min);
      // A fitted axis spans at least a tenth of the values: 57→58세 is not a cliff.
      const pad = Math.max((max - min) * 0.1, (0.1 * Math.max(Math.abs(max), Math.abs(min)) - (max - min)) / 2);
      let lo = fit ? min - pad : Math.min(min, 0);
      let hi = fit ? max + pad : Math.max(max, 0);
      if (hi === lo) hi = lo + 1;
      const x = (k: number) => PAD + (k / (vals.length - 1)) * (w - 2 * PAD);
      const y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      // The axis' ends, labelled over the lines on a chip of the card's colour (drawn last).
      let ends: [string, string] = ['', ''];
      if (fit) {
        ends = [g.format(hi), g.format(lo)];
      } else {
        // Zero baseline (recessive), and the top labelled as on a fitted axis.
        ctx.beginPath();
        ctx.moveTo(PAD, Math.round(y(0)) + 0.5);
        ctx.lineTo(w - PAD, Math.round(y(0)) + 0.5);
        ctx.stroke();
        ends = [g.format(hi), g.format(lo)];
      }
      const [c1, c2] = g.colors ? g.colors.map((c) => css(c) || line) : [line, ink];
      // (Two lines a few percent apart from zero up overlapped: §10,189 against §9,717 read as one. The gap between them,
      // green where income leads and red where spending does, is the month's balance at a glance.)
      if (other && g.gap) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        for (let k = 0; k < vals.length - 1; k++) {
          ctx.fillStyle = vals[k]! + vals[k + 1]! >= other[k]! + other[k + 1]! ? c1! : c2!;
          ctx.beginPath();
          ctx.moveTo(x(k), y(vals[k]!));
          ctx.lineTo(x(k + 1), y(vals[k + 1]!));
          ctx.lineTo(x(k + 1), y(other[k + 1]!));
          ctx.lineTo(x(k), y(other[k]!));
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      if (other) {
        ctx.strokeStyle = c2!;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        other.forEach((v, k) => (k ? ctx.lineTo(x(k), y(v)) : ctx.moveTo(x(k), y(v))));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // A soft wash under the main line, fading to zero: the shape of the change reads before the numbers.
      // (Not on a fitted axis: an area down to a bottom that isn't zero would overstate the change.)
      if (!fit && !g.gap) {
        const base = y(0);
        const wash = ctx.createLinearGradient(0, Math.min(...vals.map(y)), 0, base);
        wash.addColorStop(0, c1!);
        wash.addColorStop(1, 'transparent');
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = wash;
        ctx.beginPath();
        ctx.moveTo(x(0), base);
        vals.forEach((v, k) => ctx.lineTo(x(k), y(v)));
        ctx.lineTo(x(vals.length - 1), base);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = c1!;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      vals.forEach((v, k) => (k ? ctx.lineTo(x(k), y(v)) : ctx.moveTo(x(k), y(v))));
      ctx.stroke();
      ctx.font = '10px system-ui, sans-serif';
      for (const [text, top] of [[ends[0], true], [ends[1], false]] as const) {
        const wText = ctx.measureText(text).width;
        const ty = top ? 1 : H - 14;
        ctx.fillStyle = chip;
        ctx.fillRect(PAD, ty, wText + 6, 13);
        ctx.fillStyle = ink;
        ctx.textBaseline = 'top';
        ctx.fillText(text, PAD + 3, ty + 1);
      }

      let k = vals.length - 1;
      if (this.hover?.key === g.key) {
        k = Math.max(0, Math.min(vals.length - 1, Math.round(this.hover.index * (vals.length - 1))));
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(x(k)) + 0.5, PAD);
        ctx.lineTo(Math.round(x(k)) + 0.5, H - PAD);
        ctx.stroke();
      }
      // The month read: a dot ringed in the plot's colour, clear of the line under it.
      ctx.fillStyle = chip;
      ctx.beginPath();
      ctx.arc(x(k), y(vals[k]!), 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c1!;
      ctx.beginPath();
      ctx.arc(x(k), y(vals[k]!), 4, 0, Math.PI * 2);
      ctx.fill();
      // The month read, said (the latest by its month: beside the screen's live figures, 92,110 / 99,919 read as now's).
      const hovered = this.hover?.key === g.key;
      const when = ` · ${hovered ? date(history[k]!.month) : `${((history[k]!.month - 1) % 12) + 1}월`}`;
      label.textContent = other ? `${g.format(vals[k]!)} / ${g.format(other[k]!)}${when}` : `${g.format(vals[k]!)}${when}`;
      // Not pointed at: how far it moved over the months shown, coloured by which way is better
      // (the line's shape said rising or falling; the size of it took reading the axis).
      const change = vals.at(-1)! - vals[0]!;
      const size = g.format(Math.abs(change));
      // (Not where two lines share the graph: a change of one of them, beside both values, read as the gap.)
      if (!hovered && !other && size !== g.format(0) && Math.abs(change) >= 0.005 * Math.max(...vals.map(Math.abs))) {
        const tone = g.better ? (Math.sign(change) === g.better ? 'up' : 'down') : '';
        const delta = document.createElement('small');
        delta.className = `graph-delta${tone ? ` ${tone}` : ''}`;
        delta.textContent = `${change > 0 ? '▲' : '▼'}${size}`;
        delta.title = `보이는 기간(${history.length}개월) 동안 ${change > 0 ? '늘었습니다' : '줄었습니다'}`;
        label.append(delta);
      }
    }
  }
}
