// Region play: the region map, neighbours and Neighbor Deals.

import { type City, type CitySpan, Region, type SavedRegion } from '@web-city/engine';
import { icon } from './icons';
import { ko } from './messages';
import { EDGE_NAME, KIND_NAME, RESOURCE_NAME, RESOURCE_UNIT, SPAN_NAME } from './names';
import { updatePanels } from './panels';
import { changeKey, city, setCity } from './state';
import { $, ask, escapeHtml, flash, fmt } from './util';
import { choice } from './undo';

export let neighbourSignature = '';
/** When the city last changed as renderNeighbours saw it (offers need a map scan). */
let neighbourKey = '';

/** Free cells around the first city of a new region: a large city (4×4 cells) fits on any side. */
const REGION_MARGIN = 4;

export let region: Region | null = null;

export let regionPos: [number, number] = [0, 0];

export const REGION_KEY = 'web-city-region';

/** Writes the region to the browser; false (and says so) when it could not. */
export function storeRegion(): boolean {
  if (!region) return false;
  try {
    localStorage.setItem(REGION_KEY, JSON.stringify(region.save()));
    return true;
  } catch {
    flash('지역을 브라우저에 저장할 수 없습니다', 'bad');
    return false;
  }
}

/**
 * Leaves the region for a city of its own (a save, a file, a new city, the
 * sample): the open square goes back into the region first, which is stored.
 */
export function leaveRegion(): void {
  if (!region) return;
  try {
    region.close(regionPos[0], regionPos[1], city);
  } catch { /* nothing to keep */ }
  storeRegion();
  setRegion(null);
}

/** Size of the next city founded in the region (cells per side). */
export let foundSpan: CitySpan = 1;

/** Switches to another square of the region, saving the current city first. */
export async function goToSquare(x: number, y: number): Promise<void> {
  if (!region) return;
  if (!region.has(x, y) && !region.canFound(x, y, foundSpan)) {
    flash(`${SPAN_NAME[foundSpan]} 도시는 이 칸에서 오른쪽·아래로 ${foundSpan}×${foundSpan}칸이 비어 있어야 합니다`, 'bad');
    return;
  }
  // A new city stays in the region for good: ask before founding one.
  if (!region.has(x, y) && !(await ask(`(${x + 1}, ${y + 1})에 ${SPAN_NAME[foundSpan]} 새 도시를 세우고 그 도시로 옮겨 갈까요? 지금 도시는 저장됩니다.`, '새 도시 세우기'))) return;
  if (!region) return;
  region.close(regionPos[0], regionPos[1], city);
  const next = region.has(x, y) ? region.open(x, y) : region.found(x, y, { difficulty: city.state.difficulty, water: true, name: `새 도시 (${x + 1}, ${y + 1})` }, foundSpan);
  const at = region.footprintAt(x, y);
  regionPos = at ? [at.x, at.y] : [x, y];
  storeRegion();
  neighbourSignature = '';
  neighbourKey = '';
  setCity(next);
}

export function regionHtml(): string {
  if (!region) {
    let stored = false;
    try {
      stored = !!localStorage.getItem(REGION_KEY);
    } catch { /* storage unavailable */ }
    return `<h3 class="sub">지역</h3>
      <div class="loan-row"><span>여러 도시를 이웃으로 두고 번갈아 플레이합니다.</span></div>
      <div class="loan-row"><button id="region-new">이 도시로 지역 만들기</button>${stored ? '<button id="region-load">저장된 지역 열기</button>' : ''}</div>`;
  }
  // One button per city at its size, one per empty cell.
  const cells: string[] = [];
  const seen = new Set<string>();
  // The open city may not be saved into the region yet (just founded).
  const mine = { x: regionPos[0], y: regionPos[1], span: Math.max(1, Math.round(city.size / region.citySize)) as CitySpan };
  const inMine = (x: number, y: number) => x >= mine.x && y >= mine.y && x < mine.x + mine.span && y < mine.y + mine.span;
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      const fp = region.footprintAt(x, y) ?? (inMine(x, y) ? mine : null);
      const place = (cx: number, cy: number, span: number) => `grid-column: ${cx + 1} / span ${span}; grid-row: ${cy + 1} / span ${span}`;
      if (!fp) {
        // Cells along the open city's sides: a city there becomes its neighbour.
        const beside = (x >= mine.x && x < mine.x + mine.span && (y === mine.y - 1 || y === mine.y + mine.span))
          || (y >= mine.y && y < mine.y + mine.span && (x === mine.x - 1 || x === mine.x + mine.span));
        cells.push(`<button class="square empty${beside ? ' beside' : ''}" data-sq="${x},${y}" style="${place(x, y, 1)}" title="이 칸에 새 도시 세우기${beside ? ' (지금 도시의 이웃)' : ''}"><span aria-hidden="true">＋</span><small>${beside ? '이웃 칸' : '빈 땅'}</small></button>`);
        continue;
      }
      const id = `${fp.x},${fp.y}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const here = fp.x === regionPos[0] && fp.y === regionPos[1];
      const snap = here ? null : region.snapshotAt(x, y);
      const pop = snap ? snap.population['R$'] + snap.population['R$$'] + snap.population['R$$$'] : 0;
      const label = here
        ? `${escapeHtml(city.state.name)}<br><small>지금 연 도시 · ${fmt(city.stats().population)}명</small>`
        : `${escapeHtml(snap!.name)}<br><small>${fmt(pop)}명</small>`;
      cells.push(`<button class="square ${here ? 'active' : ''}" data-sq="${id}" style="${place(fp.x, fp.y, fp.span)}" ${here ? 'disabled' : ''}>${label}</button>`);
    }
  }
  return `<h3 class="sub">지역 (${seen.size}개 도시)</h3>
    <div class="region-grid${region.width > 6 ? ' dense' : ''}" style="grid-template-columns: repeat(${region.width}, minmax(0, 1fr)); grid-template-rows: repeat(${region.height}, ${region.width > 6 ? 30 : 44}px)">${cells.join('')}</div>
    <label class="funding">새 도시 크기 <select id="found-span">${([1, 2, 4] as const).map((k) => `<option value="${k}" ${k === foundSpan ? 'selected' : ''}>${SPAN_NAME[k]} (${k}×${k}칸, ${region!.citySize * k}×${region!.citySize * k})</option>`).join('')}</select></label>
    <p class="legend">다른 칸을 누르면 이 도시를 저장하고 그 도시를 엽니다(빈 칸이면 그 칸을 왼쪽 위로 새로 세움). 옆 도시들은 마지막 저장 상태로 이웃이 되고, 한 변에 여러 도시가 있으면 합쳐서 하나의 이웃으로 봅니다.</p>`;
}

/** Neighbours on each edge, Neighbor Deals on offer and in effect. */
/** An offer's price beside what the city pays to make the same unit itself. */
function ownCost(o: { resource: Parameters<typeof city.utility>[0]; direction: 'buy' | 'sell'; price: number }): string {
  const own = city.utility(o.resource).cost;
  const good = o.direction === 'buy' ? o.price < own : o.price > own;
  return ` <span class="${good ? 'pos' : 'muted'}" title="이 도시가 직접 만드는(처리하는) 단가">(자체 §${own.toFixed(3)}${good ? (o.direction === 'buy' ? ' · 더 쌈' : ' · 이익') : ''})</span>`;
}

/** The kinds of neighbour in a word or two (the compass's cells are narrow). */
const KIND_SHORT = { simnation: '도시 없음', established: '미개발', developed: '개발됨' } as const;

/** What reaches an edge from this city (roads, rail…): a neighbour is only met where something does. */
function edgeLinks(edge: 0 | 1 | 2 | 3): string {
  const per = city.connectionsPerEdge();
  const NAMES = { road: '도로', highway: '고속도로', rail: '철도', subway: '지하철' } as const;
  const parts = (Object.keys(NAMES) as (keyof typeof NAMES)[]).filter((k) => per[k][edge] > 0).map((k) => `${NAMES[k]} ${per[k][edge]}`);
  return `<small class="nb-links${parts.length ? '' : ' none'}">${parts.length ? `연결 ${parts.join(' · ')}` : '연결 없음'}</small>`;
}

export function renderNeighbours(): void {
  const s = city.state;
  // Offers need a scan of the map's edges: only when the city may have changed.
  const key = `${changeKey()}|${region ? regionPos.join() : '-'}|${s.neighbours.map((nb) => nb.kind).join()}`;
  if (key === neighbourKey) return;
  neighbourKey = key;
  const month = Math.floor(s.day / 30);
  const offers = city.dealOffers();
  const sig = `${month}|${s.name}|${region ? regionPos.join() : '-'}|${s.neighbours.map((nb) => nb.kind).join()}|${s.neighbourDeals.map((d) => `${d.id}${d.status}`).join()}|${offers.map((o) => +o.ok).join('')}`;
  if (sig === neighbourSignature) return;
  neighbourSignature = sig;
  const el = $('#neighbours');
  const dealRows = s.neighbourDeals.map((d) => `<div class="loan-row"><span>${EDGE_NAME[d.edge]} · ${RESOURCE_NAME[d.resource]} ${d.direction === 'buy' ? '구매' : '판매'}
    ${fmt(d.amount)} ${RESOURCE_UNIT[d.resource]} · 월 ${d.direction === 'buy' ? '−' : ''}§${fmt(city.dealMonthly(d))}${d.status !== 'active' ? ` <span class="neg">(${d.status === 'grace' ? '유예' : '보호관찰'} ${d.monthsLeft}개월)</span>` : ''}</span>
    <button data-cancel="${d.id}">취소</button></div>`).join('');
  const open = offers.filter((o) => o.ok);
  el.innerHTML = `
    ${regionHtml()}
    <div class="nb-compass" role="group" aria-label="네 변의 이웃">${s.neighbours.map((nb) => `<label class="nb-edge ${'wens'[nb.edge]}"><span class="nb-dir">${EDGE_NAME[nb.edge]}</span><select data-edge="${nb.edge}" ${region ? 'disabled' : ''} aria-label="${EDGE_NAME[nb.edge]} 이웃">
      ${(['simnation', 'established', 'developed'] as const).map((k) => `<option value="${k}" ${nb.kind === k ? 'selected' : ''} title="${KIND_NAME[k]}">${KIND_SHORT[k]}</option>`).join('')}
    </select>${edgeLinks(nb.edge)}</label>`).join('')}<div class="nb-me">${icon('zones')}<b>${escapeHtml(s.name)}</b><small>이 도시</small></div></div>
    <dl class="nb-kinds" aria-label="이웃의 종류">
      <dt>도시 없음</dt><dd>화물 출구와 연결 종류별 첫 오피스 상한 완화만 줍니다 (심네이션)</dd>
      <dt>미개발</dt><dd>주민이 오가며 통근합니다</dd>
      <dt>개발됨</dt><dd>송전선·수도관·도로로 이으면 전력·물·쓰레기를 사고팔고, 성장 수요(인구의 10%)를 보내옵니다</dd>
    </dl>
    <h3 class="sub">거래</h3>
    ${dealRows || '<p class="muted">진행 중인 거래 없음</p>'}
    ${open.length ? open.map((o, k) => `<div class="loan-row"><span>${EDGE_NAME[o.edge]} · ${RESOURCE_NAME[o.resource]} ${o.direction === 'buy' ? '구매' : '판매'} · 단가 §${o.price.toFixed(3)}${ownCost(o)}</span>
      ${dealAmounts(o.maxAmount).length > 1 ? `<select data-amount="${k}" aria-label="거래량">${dealAmounts(o.maxAmount).map((a) => `<option value="${a}">${fmt(a)} ${RESOURCE_UNIT[o.resource]} · 월 §${fmt(city.dealMonthly({ ...o, amount: a, price: city.dealPriceFor(o.edge, o.resource, o.direction, a) ?? o.price }))}</option>`).join('')}</select>`
        : `<span class="muted">${fmt(o.maxAmount)} ${RESOURCE_UNIT[o.resource]} · 월 §${fmt(city.dealMonthly({ ...o, amount: o.maxAmount }))}</span>`}
      <button data-offer="${k}">${o.direction === 'buy' ? '사기' : '팔기'}</button></div>`).join('')
      : `<p class="legend">지금 맺을 수 있는 거래가 없습니다.${whyNoDeals(offers)}</p>`}`;
  el.querySelector<HTMLButtonElement>('#region-new')?.addEventListener('click', async () => {
    // One region is kept in the browser: say so before replacing it.
    let stored = false;
    try {
      stored = !!localStorage.getItem(REGION_KEY);
    } catch { /* storage unavailable */ }
    if (stored && !(await ask('저장된 지역이 이 도시로 만든 새 지역으로 바뀝니다(되돌릴 수 없음). 계속할까요?', '새 지역 만들기'))) return;
    // Cells are small-city sized; this city covers as many as its size needs, with a margin of
    // REGION_MARGIN cells around it (room for medium 2×2 and large 4×4 cities on every side).
    const cell = Math.min(64, city.size);
    const span = Math.max(1, Math.round(city.size / cell));
    const side = span + 2 * REGION_MARGIN;
    region = new Region({ name: `${city.state.name} 지역`, width: side, height: side, citySize: cell });
    regionPos = [REGION_MARGIN, REGION_MARGIN];
    region.close(REGION_MARGIN, REGION_MARGIN, city);
    storeRegion();
    neighbourSignature = '';
    neighbourKey = '';
    setCity(region.open(REGION_MARGIN, REGION_MARGIN));
  });
  el.querySelector<HTMLButtonElement>('#region-load')?.addEventListener('click', async () => {
    // The city on screen isn't in that region: what wasn't saved of it goes.
    const s = city.state;
    const played = s.structures.size > 0 || s.buildings.size > 0 || s.zone.some((z) => z !== 0) || s.net.some((v) => v !== 0);
    if (!region && played && !(await ask('지금 도시에서 저장하지 않은 진행은 사라집니다. 저장된 지역을 열까요?', '지역 열기'))) return;
    try {
      const saved = JSON.parse(localStorage.getItem(REGION_KEY)!) as SavedRegion;
      region = Region.load(saved);
      let first: [number, number] | null = null;
      for (let y = 0; y < region.height && !first; y++) for (let x = 0; x < region.width && !first; x++) if (region.has(x, y)) first = [x, y];
      if (!first) throw new Error('empty region');
      regionPos = first;
      neighbourSignature = '';
      neighbourKey = '';
      setCity(region.open(first[0], first[1]));
    } catch {
      region = null;
      flash('저장된 지역을 열 수 없습니다', 'bad');
    }
  });
  el.querySelectorAll<HTMLButtonElement>('button[data-sq]').forEach((btn) => {
    btn.onclick = () => {
      const [x, y] = btn.dataset.sq!.split(',').map(Number) as [number, number];
      goToSquare(x, y);
    };
  });
  const spanSel = el.querySelector<HTMLSelectElement>('#found-span');
  if (spanSel) spanSel.onchange = () => (foundSpan = Number(spanSel.value) as CitySpan);
  el.querySelectorAll<HTMLSelectElement>('select[data-edge]').forEach((sel) => {
    sel.onchange = async () => {
      const edge = Number(sel.dataset.edge) as 0 | 1 | 2 | 3;
      // Only a developed neighbour trades: other kinds end the edge's deals (say so first).
      const deals = city.state.neighbourDeals.filter((d) => d.edge === edge).length;
      if (sel.value !== 'developed' && deals && !(await ask(`${EDGE_NAME[edge]} 이웃과의 거래 ${deals}건이 취소됩니다. 바꿀까요?`, '거래 취소하고 바꾸기'))) {
        sel.value = city.state.neighbours[edge]!.kind;
        return;
      }
      choice('이웃', () => city.setNeighbour(edge, sel.value as 'simnation' | 'established' | 'developed'));
      if (deals && sel.value !== 'developed') flash(`${EDGE_NAME[edge]} 이웃과의 거래 ${deals}건을 취소했습니다`);
      city.refreshIfDirty();
      neighbourSignature = '';
      neighbourKey = '';
      updatePanels();
    };
  });
  el.querySelectorAll<HTMLButtonElement>('button[data-offer]').forEach((btn) => {
    btn.onclick = () => {
      const o = open[Number(btn.dataset.offer)]!;
      const amount = Number(el.querySelector<HTMLSelectElement>(`select[data-amount="${btn.dataset.offer}"]`)?.value ?? o.maxAmount);
      const res = choice('거래', () => city.makeDeal(o.edge, o.resource, o.direction, amount));
      if (!res.ok && res.message) flash(ko(res.message), 'bad');
      else if (res.ok) flash(`${EDGE_NAME[o.edge]} 이웃과 ${RESOURCE_NAME[o.resource]} ${fmt(amount)} ${RESOURCE_UNIT[o.resource]} ${o.direction === 'buy' ? '구매' : '판매'} 거래를 맺었습니다 · 월 ${o.direction === 'buy' ? '−' : '+'}§${fmt(city.dealMonthly(city.state.neighbourDeals.at(-1) ?? { ...o, amount }))}`, 'info');
      city.refreshIfDirty();
      neighbourSignature = '';
      neighbourKey = '';
      updatePanels();
    };
  });
  el.querySelectorAll<HTMLButtonElement>('button[data-cancel]').forEach((btn) => {
    btn.onclick = () => {
      choice('거래', () => city.cancelDeal(Number(btn.dataset.cancel)));
      city.refreshIfDirty();
      neighbourSignature = '';
      neighbourKey = '';
      updatePanels();
    };
  });
}

export function setRegion(v: typeof region): void {
  region = v;
}

export function setRegionPos(v: typeof regionPos): void {
  regionPos = v;
}

/** Why nothing can be traded with the developed neighbours (each utility once per edge). */
/** Amounts a deal can be struck for: the full offer by default, or a quarter, half or three quarters of it. */
function dealAmounts(max: number): number[] {
  const min = city.cfg.region.deals.minAmount;
  return [...new Set([1, 0.75, 0.5, 0.25].map((f) => (f === 1 ? max : Math.round((max * f) / 1000) * 1000)).filter((a) => a >= min))];
}

export function whyNoDeals(offers: ReturnType<City['dealOffers']>): string {
  const lines: string[] = [];
  for (const nb of city.state.neighbours) {
    if (nb.kind !== 'developed') continue;
    for (const resource of ['power', 'water', 'garbage'] as const) {
      if (city.state.neighbourDeals.some((d) => d.edge === nb.edge && d.resource === resource)) continue;
      // Buying and selling have reasons of their own: name which is which (joined bare they read as a contradiction).
      const why = [...new Set(offers.filter((o) => o.edge === nb.edge && o.resource === resource && !o.ok && o.reason)
        .map((o) => `${o.direction === 'buy' ? '구매' : '판매'}: ${ko(o.reason!)}`))];
      if (why.length) lines.push(`${EDGE_NAME[nb.edge]} ${RESOURCE_NAME[resource]}: ${why.join(' / ')}`);
    }
  }
  if (lines.length) return `<br>${lines.map(escapeHtml).join('<br>')}`; // every edge (six lines hid the last neighbours)
  if (city.state.neighbours.some((nb) => nb.kind === 'developed')) return ' 개발된 이웃과는 모든 자원을 이미 거래하고 있습니다.';
  return region ? ' 개발된 이웃 도시와만 거래할 수 있습니다.' : ' 개발된 이웃(위에서 고르기)과만 거래할 수 있습니다.';
}
