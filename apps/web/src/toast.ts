// Toasts: short notices over the map for events worth seeing at once (rewards,
// disasters, My Sims news); the full list stays in the city pane.

import { chooseSpeed, runningSpeed } from './controls';
import { icon } from './icons';
import { centerOn, redraw, renderer, speed } from './state';
import { paneShown, revealMap } from './tabs';
import { glue } from './util';

/** Toasts at once: three over a wide map, one on a phone (more covered the town being built). */
const max = () => (matchMedia('(max-width: 860px)').matches ? 1 : 3);

/** Puts away the toasts whose words begin so (a newer one says it better: the checklist's last step told). */
export function dropToasts(prefix: string): void {
  for (const t of document.querySelectorAll<HTMLElement>('#toasts .toast-text')) {
    const el = t.closest<HTMLElement>('.toast');
    if (!el || el.classList.contains('leaving') || !(t.dataset.text ?? '').startsWith(prefix)) continue;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  }
}

/** Puts away the notices about a goal (whatever their words begin with): its screen is open now. */
export function dropGoalToasts(goal: string): void {
  for (const el of document.querySelectorAll<HTMLElement>('#toasts .toast')) {
    if (el.dataset.goal !== goal || el.classList.contains('leaving')) continue;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  }
}

/**
 * Phones: the notices just under what hangs from the top — the two rows of buttons and chips, the view's card, whose
 * height goes with its count and 찾아가기. (At set heights, the card's count left while a tool is in hand ran under the
 * notice, its 찾아가기 sticking out below.) Wide, they keep to their corner.
 */
function placeToasts(): void {
  const box = document.getElementById('toasts');
  const view = document.getElementById('view');
  if (!box || !view) return;
  if (!watching) {
    watching = true;
    const again = () => placeToasts();
    const sizes = new ResizeObserver(again);
    for (const id of ['mapbar', 'map-layer']) {
      const part = document.getElementById(id);
      if (part) sizes.observe(part);
    }
    // (What shows of them goes with the states set on these: a tool in hand, the pane or a sheet open.)
    const states = new MutationObserver(again);
    for (const part of [view, document.getElementById('app')]) if (part) states.observe(part, { attributes: true, attributeFilter: ['class'] });
    const tray = document.getElementById('tray'); // (the tools' card is up by its own hidden, not by a class)
    if (tray) states.observe(tray, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('resize', again);
  }
  // While a sheet is up on a phone held upright, the notices the clock didn't stop for wait under it, their time held.
  holdUnder(box, matchMedia('(max-width: 860px) and (orientation: portrait)').matches && sheetUp());
  if (!matchMedia('(max-width: 860px)').matches) return void box.style.removeProperty('--toasts-top');
  const v = view.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  let low = 0;
  // (Not the top rows while a sheet is up: they are away then, sliding off — measured as they went, the notices sat a
  // row lower than they needed to.)
  const away = sheetUp();
  for (const part of [away ? null : document.getElementById('mapbar'), document.getElementById('map-layer')]) {
    if (!part || part.hidden) continue;
    const cs = getComputedStyle(part);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = part.getBoundingClientRect();
    // (Above the map's middle, over the notices' column: not the strip beside it.)
    if (!r.width || !r.height || r.top - v.top > v.height / 2 || r.right <= b.left || r.left >= b.right) continue;
    low = Math.max(low, r.bottom - v.top);
  }
  const at = `${Math.round(low + 8)}px`;
  if (box.style.getPropertyValue('--toasts-top') !== at) box.style.setProperty('--toasts-top', at);
}
let watching = false;

/** Whether a sheet is up (on a phone the top buttons are away under it). By the classes and the tray's hidden, not by
 *  :has() in a selector: where the browser has no :has(), matches() threw, and every notice with it. */
function sheetUp(): boolean {
  return !!document.querySelector('#app.pane-open, #view.info-open, #view.sheet-open') || document.getElementById('tray')?.hidden === false;
}

/** Each shown notice's timer, to hold while it waits under a sheet and to run on (a little) once it shows again. */
const lives = new WeakMap<HTMLElement, { hold: () => void; wait: (ms: number) => void }>();
function holdUnder(box: HTMLElement, held: boolean): void {
  if (box.classList.contains('held') === held) return;
  box.classList.toggle('held', held);
  for (const el of box.querySelectorAll<HTMLElement>('.toast:not(.sticky):not(.leaving)')) {
    const life = lives.get(el);
    if (held) life?.hold();
    else life?.wait(4000);
  }
}

/** `at`: a tile the notice is about; clicking the notice then shows it. `goal`: the screen it opens, to put it away when that opens. */
export function toast(text: string, tone: 'good' | 'bad' | 'info' | 'gold' = 'good', at?: [number, number], open?: () => void, sticky = false, label?: string, goal?: string, unread = true): void {
  const box = document.querySelector('#toasts');
  if (!box) return;
  // The same words about the same place already showing: not again (picking two checklist steps stacked two of
  // them). About another place they are another notice (two sinkholes with no damage read alike).
  const where = at ? at.join(',') : '';
  if ([...box.querySelectorAll<HTMLElement>('.toast-text')].some((t) => t.dataset.text === text && (t.dataset.at ?? '') === where && !t.closest('.leaving'))) return;
  // (Not a button: the clock's 계속 sits inside it.)
  const el = document.createElement('div');
  el.tabIndex = 0;
  // (A group, not a button: a button's insides are lost to a screen reader, and 계속 and 닫기 sit inside it.)
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', text.replace(/ · 멈춤 \(.*\)$/, ''));
  el.className = `toast ${tone}`;
  if (goal) el.dataset.goal = goal;
  el.title = label ?? (open ? '눌러서 관리 화면 열기' : at ? '눌러서 그곳 보기' : '닫기');
  // A tone badge, the text (its subject in bold: "개발·수요: …"), and a chevron when it leads somewhere.
  const badge = document.createElement('span');
  badge.className = 'toast-badge';
  // (gold: a milestone the city reached, with the stage's trophy; news that is neither good nor bad: no award)
  badge.innerHTML = icon(tone === 'bad' ? 'alert' : tone === 'info' ? 'info' : tone === 'gold' ? 'trophy' : 'award');
  const body = document.createElement('span');
  body.className = 'toast-text';
  // (The stopped clock is said by the 계속 button, not in words at the end.)
  const words = sticky ? text.replace(/ · 멈춤 \(.*\)$/, '') : text;
  const head = /^([^:]{1,16}): (.+)$/s.exec(words);
  if (head) {
    const b = document.createElement('b');
    b.textContent = glue(head[1]!);
    body.append(b, document.createTextNode(glue(head[2]!)));
  } else body.textContent = glue(words);
  body.dataset.text = text;
  body.dataset.at = where;
  el.append(badge, body);
  // (One the clock stopped for, said at once by #sr-alert below: not a second time by the notices' polite region.)
  if (sticky && tone === 'bad') el.setAttribute('aria-live', 'off');
  if (sticky) {
    // The clock stopped for it: the two ways on, side by side under what it says — look into it, or go on.
    const acts = document.createElement('span');
    acts.className = 'toast-acts';
    if (open || at) {
      const look = document.createElement('button');
      look.type = 'button';
      look.className = 'toast-look';
      look.title = open ? '관리 화면에서 원인과 할 일 보기' : '지도에서 그곳 보기';
      look.innerHTML = `${icon(open ? 'search' : 'target')}살펴보기`;
      look.onclick = (e) => {
        e.stopPropagation();
        el.click();
      };
      acts.append(look);
    }
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'toast-resume';
    go.title = '시간 다시 흐르게 (Space)';
    go.innerHTML = `${icon('play')}계속`;
    go.onclick = (e) => {
      e.stopPropagation();
      chooseSpeed(runningSpeed || 1);
    };
    acts.append(go);
    el.append(acts);
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
    e.stopPropagation(); // (its Space opens it; the page's would pause the clock as well)
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
  placeToasts();
  // (Not one the clock stopped for: on a phone, where one fits, a refusal pushed out the alarm being read.)
  const spare = () => [...box.children].find((c) => c !== el && !c.classList.contains('sticky'));
  while (box.children.length > max() && spare()) spare()!.remove();
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
  if (!sticky) {
    lives.set(el, { hold, wait });
    if (box.classList.contains('held')) hold(); // (it waits under the sheet up now)
    else wait(7000);
  }
  if (sticky) {
    el.classList.add('sticky');
    // (The clock stopped for it — a fire, a blackout: said at once to a screen reader, not after what it is reading.)
    if (tone === 'bad') {
      const alert = document.getElementById('sr-alert');
      if (alert) alert.textContent = text.replace(/ · 멈춤 \(.*\)$/, '');
    }
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
  // Small screens: a dot on the score chip at the top, which opens the city pane, until it is opened (wide, the pane
  // is always shown).
  if (unread && !paneShown()) document.getElementById('goal-strip')?.classList.add('unread');
}
