// My Sims panel and the microphone tool.

import { type Thought } from '@web-city/engine';
import { icon } from './icons';
import { ko } from './messages';
import { THOUGHT } from './names';
import { pushNotice, updatePanels } from './panels';
import { centerOn, city, redraw, setSelected } from './state';
import { forgetInfo, showInfo } from './info';
import { closeSheet, revealMap, showTab } from './tabs';
import { $, escapeHtml, flash, hours, josa } from './util';
import { choice } from './undo';

/** A place on the map as a link that goes there, named (집, 일터) rather than by its coordinates. */
const goto = (x: number, y: number, label: string) => `<button type="button" class="link" data-goto="${x},${y}" title="지도에서 보기 (${x}, ${y})">${label}</button>`;
/** A Sim's wealth in a word (R$ read as a code). */
const WEALTH_WORD = ['저소득층', '중산층', '부유층'] as const;

/** Names a new My Sim is given (the info card's form starts with the same). */
export const SIM_NAMES = ['민지', '서준', '하은', '도윤', '지우'];

/** Microphone tool (Rush Hour): a passer-by's view of the street they live on. */
export function interviewAt(x: number, y: number): void {
  showTab('info');
  forgetInfo();
  const r = city.interview(x, y);
  const el = $('#info');
  if (!r) {
    el.innerHTML = '<p class="muted">근처에 사는 사람이 없습니다. 주거 지역 가까이에 마이크를 대 보세요.</p>';
    return;
  }
  setSelected(r.home);
  redraw();
  el.innerHTML = `<p><b>${icon('mic', 'inline-i')}지나가던 ${WEALTH_WORD[r.wealth]} 주민</b> <span class="muted">(지도에 표시한 집 근처에 삶)</span></p>
    <p>${r.thoughts.length ? thoughtChips(r.thoughts) : '<span class="muted">딱히 할 말이 없답니다.</span>'}</p>
    <p class="legend">빨강 = 불만, 회색 = 좋아함. 집 주변의 건강·교육·치안·오염·통근 등에 대한 생각입니다.</p>`;
}

// Complaints first and in red; what they like, quietly after (a row of coloured emoji chips had no first thing to read).
export const thoughtChips = (ts: Thought[]) => [...ts].sort((a, b) => Number(a.approve) - Number(b.approve))
  .map((t) => `<span class="thought ${t.approve ? 'pos' : 'neg'}" title="${t.approve ? '좋아함' : '불만'}">${THOUGHT[t.subject][1]}</span>`).join('');

const PICK_HINT = { job: '지도에서 같은 소득층이 일하는 일터를 누르세요', move: '지도에서 같은 소득층의 집을 누르세요', dispatch: '지도에서 보낼 곳을 누르세요' } as const;

/** A pending My Sim action: the next map click picks its job, new home or destination. */
export let mySimAction: { id: number; kind: 'job' | 'move' | 'dispatch' } | null = null;

export let mySimSignature = '';

export function renderMySims(force = false): void {
  const s = city.state;
  const sig = `${JSON.stringify(s.mySims)}|${Math.floor(s.day / 30)}|${mySimAction?.id}${mySimAction?.kind}`;
  if (!force && sig === mySimSignature) return;
  mySimSignature = sig;
  const el = $('#mysims');
  const rows = s.mySims.map((sim) => {
    const home = s.buildings.get(sim.home);
    const job = sim.job > 0 ? s.buildings.get(sim.job) : sim.job < 0 ? s.structures.get(-sim.job) : undefined;
    const trip = city.mySimCommute(sim.id);
    const pending = mySimAction?.id === sim.id ? mySimAction.kind : null;
    return `<div class="mysim">
      <div><b>${escapeHtml(sim.name)}</b>${(sim.generation ?? 1) > 1 ? ` <span class="chip">${sim.generation}대째</span>` : ''} <span class="muted">${WEALTH_WORD[sim.wealth]} · ${home ? goto(home.x, home.y, '집') : '<span class="neg">집 찾는 중</span>'} · ${job ? goto(job.x, job.y, '일터') : '일터 자동'}${trip ? ` · 통근 ${trip.time < 0 ? '<span class="neg">못 감</span>' : hours(trip.time)}` : ''}</span></div>
      <div class="thoughts">${thoughtChips(city.mySimThoughts(sim.id))}</div>
      <div class="mysim-buttons">
        <button data-sim="${sim.id}" data-act="job" class="${pending === 'job' ? 'active' : ''}">일터 지정</button>
        <button data-sim="${sim.id}" data-act="move" class="${pending === 'move' ? 'active' : ''}">이사</button>
        <button data-sim="${sim.id}" data-act="dispatch" class="${pending === 'dispatch' ? 'active' : ''}">보내기</button>
        <button data-sim="${sim.id}" data-act="remove">떠나보내기</button>
      </div></div>`;
  }).join('');
  const homes = city.state.mySims.length < city.cfg.mySims.max ? [...city.state.buildings.values()].filter((b) => b.type?.[0] === 'R' && b.occupancy > 0) : [];
  const anyHome = homes.length ? `<button id="mysim-any" class="${rows ? '' : 'primary'}">${icon('users')}아무 집에나 입주</button>` : '';
  el.innerHTML = `${rows || `<p class="muted">지도에서 집을 눌러 My Sim을 입주시키세요${homes.length ? ', 또는 아래에서 바로 입주시키세요' : ' (아직 사람이 사는 집이 없습니다)'}.</p>`}${anyHome}
    <p class="legend">빨강은 불만, 회색은 좋아함입니다. 일터 지정·이사·보내기를 누른 뒤 지도를 누르세요. 보내기는 그곳에 대한 의견을 들려줍니다. My Sim은 최대 ${city.cfg.mySims.max}명까지 둘 수 있습니다.</p>`;
  // A home or workplace's place: the map goes there, with its card.
  el.querySelectorAll<HTMLButtonElement>('button[data-goto]').forEach((btn) => {
    btn.onclick = () => {
      const [x, y] = btn.dataset.goto!.split(',').map(Number) as [number, number];
      revealMap();
      centerOn(x, y);
      showInfo(x, y);
    };
  });
  const any = el.querySelector<HTMLButtonElement>('#mysim-any');
  if (any) any.onclick = () => {
    // A lived-in home picked at random (one no My Sim lives in, if there is one), named like the info card's.
    const taken = new Set(city.state.mySims.map((m) => m.home));
    const free = homes.filter((b) => !taken.has(b.id));
    const pool = free.length ? free : homes;
    const h = pool[Math.floor(Math.random() * pool.length)]!;
    const res = choice('My Sim', () => city.addMySim(SIM_NAMES[city.state.mySims.length % SIM_NAMES.length]!, h.x, h.y));
    if (!res.ok) flash(ko(res.message ?? 'pick a lived-in home'), 'bad');
    else flash(`${res.sim!.name}${josa(res.sim!.name, '이', '가')} ${WEALTH_WORD[res.sim!.wealth]} 집에 입주했습니다`);
    renderMySims(true);
    updatePanels();
  };
  el.querySelectorAll<HTMLButtonElement>('button[data-sim]').forEach((btn) => {
    btn.onclick = () => {
      const id = Number(btn.dataset.sim);
      const act = btn.dataset.act as 'job' | 'move' | 'dispatch' | 'remove';
      if (act === 'remove') {
        choice('My Sim', () => city.removeMySim(id));
        mySimAction = null;
      } else mySimAction = mySimAction?.id === id && mySimAction.kind === act ? null : { id, kind: act };
      renderMySims(true);
      if (mySimAction) {
        // The pick is made on the map: clear the way and say what to pick.
        closeSheet();
        const name = city.state.mySims.find((m) => m.id === id)?.name ?? 'My Sim';
        flash(`${name}: ${PICK_HINT[mySimAction.kind]} (Esc로 취소)`);
      }
    };
  });
}

/** Drops a pending My Sim action (another city opened, another tool picked, Esc); true if one was pending. */
export function cancelMySimAction(): boolean {
  if (!mySimAction) return false;
  mySimAction = null;
  if ($('#mysims').isConnected) renderMySims(true);
  return true;
}

/** Handles a map click while a My Sim action is pending. */
export function mySimClick(x: number, y: number): void {
  const a = mySimAction!;
  mySimAction = null;
  const sim = city.state.mySims.find((m) => m.id === a.id);
  if (!sim) return;
  if (a.kind === 'dispatch') {
    const ts = city.dispatchMySim(a.id, x, y);
    pushNotice({ text: `${sim.name}의 의견: ${ts.map((t) => `${THOUGHT[t.subject][0]}${t.approve ? '👍' : '👎'}`).join(' ')}`, until: city.state.day + 60, at: [x, y] });
  } else {
    const res = a.kind === 'job' ? choice('My Sim', () => city.setMySimJob(a.id, x, y)) : choice('My Sim', () => city.moveMySim(a.id, x, y));
    if (!res.ok) flash(ko(res.message ?? 'pick a lived-in home'), 'bad');
  }
  renderMySims(true);
  updatePanels();
}
