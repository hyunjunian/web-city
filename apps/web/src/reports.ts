// Monthly reports: opinion polls, age bar graphs and reward progress.

import { type DevType, type PollTopic, type StructureKind, type UnlockCheck } from '@web-city/engine';
import { CHECK_NAME, plainCodes, POLL_NAME, STRUCTURE_NAME, TYPE_NAME } from './names';
import { city } from './state';
import { $, escapeHtml, fmt } from './util';

export let pollMonth = -1;

/** City Opinion Polls: share of residents approving each topic, refreshed monthly. */
export function renderPolls(): void {
  const month = Math.floor(city.state.day / 30);
  if (month === pollMonth) return;
  pollMonth = month;
  const polls = city.opinionPolls();
  const people = city.stats().population;
  $('#polls').innerHTML = people ? `${(Object.keys(POLL_NAME) as PollTopic[]).map((t) => {
    const p = Math.round(polls[t].approve * 100);
    // Neutral bars; a topic most residents are unhappy about stands out.
    return `<div class="poll-row${p < 25 ? ' bad' : p < 50 ? ' warn' : ''}" title="평균 시장 평점 요인 ${polls[t].score.toFixed(1)}">
      <span class="label">${POLL_NAME[t]}</span>
      <div class="bar"><div class="fill" style="width:${p}%"></div></div>
      <span class="value">${p}%</span></div>`;
  }).join('')}<p class="legend">각 주제에 불만이 없는 주민 비율(시장 평점 요인이 0 이상인 가구, 인구 가중). 정밀하지 않은 여론의 흐름입니다.</p>`
    : '<p class="muted">주민이 생기면 조사합니다.</p>';
}

export let ageMonth = -1;

/** Population by Age and Education by Age (bar graphs), by 10-year group. */
export function renderAges(): void {
  const month = Math.floor(city.state.day / 30);
  if (month === ageMonth) return;
  ageMonth = month;
  const groups = city.ageProfile();
  if (!groups.length) {
    $('#ages').innerHTML = '';
    return;
  }
  const top = Math.max(...groups.map((g) => g.residents));
  const bars = (value: (g: (typeof groups)[number]) => number, max: number, text: (g: (typeof groups)[number]) => string) => groups.map((g) => `
    <div class="poll-row wide"><span class="label">${g.from}대</span>
      <div class="bar"><div class="fill" style="width:${Math.round((100 * value(g)) / max)}%"></div></div>
      <span class="value">${text(g)}</span></div>`).join('');
  $('#ages').innerHTML = `<h3 class="sub">나이별 인구 (막대 끝 = 가장 많은 나이대)</h3>${bars((g) => g.residents, top, (g) => fmt(g.residents))}
    <h3 class="sub">나이별 교육 지수 (막대 끝 = 200)</h3>${bars((g) => g.eq, 200, (g) => String(g.eq))}
    <p class="legend">가구 평균 나이 기준 10년 단위. 학교마다 효과가 큰 나이대가 다릅니다.</p>`;
}

export let rewardMonth = -1;

/** One condition, e.g. "시장 평점 32/40" or "등급 85 넘는 도서관 3/5". */
export function checkText(c: UnlockCheck): string {
  const [field, sub] = c.key.startsWith('regional.') ? [c.key, undefined] : c.key.split('.') as [string, string | undefined];
  const subName = sub ? (STRUCTURE_NAME[sub as StructureKind] ?? TYPE_NAME[sub as DevType] ?? sub) : '';
  // A type's population is its residents (R) or its jobs (businesses): "주거 저소득 인구", "농업 일자리".
  const what = field === 'typePopulation' && sub ? `${subName} ${sub[0] === 'R' ? '인구' : '일자리'}`
    : sub ? `${CHECK_NAME[field] ?? field} ${subName}` : CHECK_NAME[field] ?? field;
  if (field === 'wellFunded' || field === 'difficulty' || field === 'anyOf' || field === 'requires') return what;
  const v = (x: number) => (field === 'waterShare' || field === 'busyStation' ? `${Math.round(x * 100)}%` : fmt(Math.round(x)));
  return `${what} ${v(c.have)}${c.below ? ' (< ' : '/'}${v(c.need)}${c.below ? ')' : ''}`;
}

/**
 * How far a reward's conditions are along, by the one furthest from met (each part by how near): the bar of 다음 보상
 * and of the list. (By the average, a resort at 216 residents of the 20,000 it wants read 57%, beside a chapel 784
 * residents away.)
 */
export function rewardShare(checks: readonly UnlockCheck[]): number {
  return checks.length ? Math.min(...checks.map(checkPart)) : 0;
}

const checkPart = (c: UnlockCheck) => (c.met ? 1 : c.below || c.need <= 0 ? 0 : Math.max(0, Math.min(1, c.have / c.need)));

/** The order rewards are listed in: the nearest first, by {@link rewardShare}, and of those as near, the furthest along in all. */
export const rewardRank = (checks: readonly UnlockCheck[]) => rewardShare(checks) + (checks.length ? checks.reduce((a, c) => a + checkPart(c), 0) / checks.length / 1000 : 0);

/** What a condition still wants, as an amount to go: "총인구 3,816 더", "범죄 40 아래로". */
export function checkLeft(c: UnlockCheck): string {
  const [field, sub] = c.key.startsWith('regional.') ? [c.key, undefined] : c.key.split('.') as [string, string | undefined];
  const subName = sub ? (STRUCTURE_NAME[sub as StructureKind] ?? TYPE_NAME[sub as DevType] ?? sub) : '';
  const what = field === 'typePopulation' && sub ? `${subName} ${sub[0] === 'R' ? '인구' : '일자리'}`
    : sub ? `${CHECK_NAME[field] ?? field} ${subName}` : CHECK_NAME[field] ?? field;
  if (field === 'wellFunded' || field === 'difficulty' || field === 'anyOf' || field === 'requires') return what;
  const pct = field === 'waterShare' || field === 'busyStation';
  const v = (x: number) => (pct ? `${Math.round(x * 100)}%p` : fmt(Math.round(x)));
  // (What is left, rounded up: half a point to go read "시장 평점 0 더".)
  const left = Math.max(0, c.need - c.have);
  return c.below ? `${what} ${v(c.need)} 아래로` : `${what} ${pct ? `${Math.max(1, Math.ceil(left * 100 - 1e-9))}%p` : fmt(Math.max(1, Math.ceil(left - 1e-9)))} 더`;
}

export function renderRewards(): void {
  const month = Math.floor(city.state.day / 30);
  if (month === rewardMonth) return;
  rewardMonth = month;
  const rows = city.rewardProgress()
    .filter((r) => r.checks.length)
    .map((r) => ({ ...r, share: rewardShare(r.checks), rank: rewardRank(r.checks) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 12);
  $('#rewards').innerHTML = rows.length ? rows.map((r) => {
    const missing = r.checks.filter((c) => !c.met);
    // One earned in tiers (already in the tray): this row is its next tier.
    const name = city.isUnlocked(r.kind) ? `${STRUCTURE_NAME[r.kind]} (다음 단계)` : STRUCTURE_NAME[r.kind];
    // (What it still wants inside its own row, said as the summary's 다음 보상 says it: under the row it read
    // as the next reward's. The bar and the order are the summary's too, so its 다음 보상 leads the list.)
    return `<div class="rw-item" title="${escapeHtml(`${name}: ${plainCodes(r.description)}${missing.length ? ` · 지금 ${missing.map(checkText).join(' · ')}` : ''}`)}"><div class="poll-row">
      <span class="label">${name}</span>
      <div class="bar"><div class="fill" style="width:${(r.share * 100).toFixed(1)}%"></div></div>
      <span class="value">${Math.round(r.share * 100)}%</span></div>
      <p class="rw-need">${missing.length ? `열리려면 ${missing.map(checkLeft).join(' · ')}` : '이번 달에 열립니다'}</p></div>`;
  }).join('') + '<p class="legend">아직 얻지 못한 보상 중 열리기에 가까운 순서: 가장 덜 찬 조건이 많이 찬 것부터(매달 갱신).</p>'
    : '<p class="muted">남은 보상이 없습니다.</p>';
}

export function setAgeMonth(v: typeof ageMonth): void {
  ageMonth = v;
}

export function setPollMonth(v: typeof pollMonth): void {
  pollMonth = v;
}

export function setRewardMonth(v: typeof rewardMonth): void {
  rewardMonth = v;
}
