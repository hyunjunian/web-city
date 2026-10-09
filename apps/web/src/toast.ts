// Toasts: short notices over the map for events worth seeing at once (rewards,
// disasters, My Sims news); the full list stays in the city pane.

import { chooseSpeed, runningSpeed } from './controls';
import { icon } from './icons';
import { centerOn, redraw, renderer, speed } from './state';
import { revealMap } from './tabs';

/** Toasts at once: three over a wide map, one on a phone (more covered the town being built). */
const max = () => (matchMedia('(max-width: 860px)').matches ? 1 : 3);

/** `at`: a tile the notice is about; clicking the notice then shows it. */
export function toast(text: string, tone: 'good' | 'bad' | 'info' = 'good', at?: [number, number], open?: () => void, sticky = false): void {
  const box = document.querySelector('#toasts');
  if (!box) return;
  // The same words already showing: not again (picking two checklist steps stacked two of them).
  if ([...box.querySelectorAll<HTMLElement>('.toast-text')].some((t) => t.dataset.text === text && !t.closest('.leaving'))) return;
  // (Not a button: the clock's 계속 sits inside it.)
  const el = document.createElement('div');
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.className = `toast ${tone}`;
  el.title = open ? '눌러서 관리 화면 열기' : at ? '눌러서 그곳 보기' : '닫기';
  // A tone badge, the text (its subject in bold: "개발·수요: …"), and a chevron when it leads somewhere.
  const badge = document.createElement('span');
  badge.className = 'toast-badge';
  badge.innerHTML = icon(tone === 'bad' ? 'alert' : tone === 'info' ? 'info' : 'award'); // news that is neither: no award
  const body = document.createElement('span');
  body.className = 'toast-text';
  // (The stopped clock is said by the 계속 button, not in words at the end.)
  const words = sticky ? text.replace(/ · 멈춤 \(.*\)$/, '') : text;
  const head = /^([^:]{1,16}): (.+)$/s.exec(words);
  if (head) {
    const b = document.createElement('b');
    b.textContent = head[1]!;
    body.append(b, document.createTextNode(head[2]!));
  } else body.textContent = words;
  body.dataset.text = text;
  el.append(badge, body);
  if (sticky) {
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'toast-resume';
    go.title = '시간 다시 흐르게 (Space)';
    go.innerHTML = `${icon('play')}계속`;
    go.onclick = (e) => {
      e.stopPropagation();
      chooseSpeed(runningSpeed || 1);
    };
    el.append(go);
  } else if (at || open) el.insertAdjacentHTML('beforeend', icon('chevronRight', 'toast-go'));
  // Put away without going to it.
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'toast-x';
  x.title = '닫기';
  x.setAttribute('aria-label', '알림 닫기');
  x.innerHTML = icon('close');
  x.onclick = (e) => {
    e.stopPropagation();
    close();
  };
  el.append(x);
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  };
  // A swipe across it puts it away (a drag meant for the map under it did nothing at all).
  let from: [number, number] | null = null;
  let swiped = false;
  el.onpointerdown = (e) => (from = [e.clientX, e.clientY]);
  el.onpointermove = (e) => {
    if (!from || Math.hypot(e.clientX - from[0], e.clientY - from[1]) < 12) return;
    from = null;
    swiped = true;
    close();
  };
  // (Its own keys only: Enter on its 계속 is that button's.)
  el.onkeydown = (e) => {
    if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    el.click();
  };
  el.onclick = () => {
    if (swiped) return;
    // A problem's toast opens its goal's screen (the view, the figures and the fixes), at the place if it has one.
    if (open) open();
    else if (at) {
      revealMap();
      centerOn(...at);
      renderer.effect('flash', at[0] - 1, at[1] - 1, 3, 3); // (where it happened, marked)
      redraw();
    }
    close();
  };
  box.append(el);
  while (box.children.length > max()) box.firstElementChild!.remove();
  // It stays while the pointer rests on it (being read), and goes a little after it leaves.
  // (Sticky — the clock stopped for it: it waits for time to go on, or to be pressed.)
  // (The time left runs out as a line along its foot.)
  let timer = 0;
  const wait = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(close, ms);
    el.style.setProperty('--life', `${ms}ms`);
    el.classList.remove('timed');
    void el.offsetWidth; // (the line starts over)
    el.classList.add('timed');
  };
  const hold = () => {
    clearTimeout(timer);
    el.classList.remove('timed');
  };
  if (!sticky) wait(7000);
  if (sticky) {
    el.classList.add('sticky');
    window.addEventListener('speedchange', function gone() {
      if (speed === 0) return;
      window.removeEventListener('speedchange', gone);
      close();
    });
  }
  el.onpointerenter = (e) => {
    if (e.pointerType === 'mouse' && !sticky) hold();
  };
  // Focused (from the keyboard), it waits too, and gives focus back if it goes anyway.
  el.addEventListener('focusin', () => !sticky && hold());
  el.addEventListener('focusout', () => !sticky && wait(2500));
  el.onpointerleave = (e) => {
    if (e.pointerType === 'mouse' && !sticky) wait(2500);
  };
  // Small screens: a dot on the dock's 도시 button until the city pane is opened.
  if (!document.querySelector('#app')?.classList.contains('pane-open')) document.querySelector('.dock-city')?.classList.add('unread');
}
