// The bars' own tooltips — the building bar across the map's foot, the top buttons (the city with its stage, the
// clock's speeds with the date, the menu), the areas' chips under them, 전체 and the zoom: a control's name, what it
// does and its keys, by it once the pointer rests there, at once along the bar. (The browser's came after a second, small and plain, the keys run into the
// words.) Elsewhere titles stay the browser's.

// (Not the view's card under the top buttons: its name and 찾아가기 keep the browser's.)
const SCOPE = '#dock-col button, #mapbar > button, #mapbar .mb-time button, #mapbar > #menu > summary, #goal-strip button, #map-controls button';

/** A key as a title ends with one: "(Ctrl+Z)" (on a Mac "(⌘Z)", "(⇧⌘Z)"), "(R·T·V·H)", "(0 · Space)" — words in
 *  brackets are not keys. */
const KEY = /^(?:(?:(?:Ctrl|Shift|Alt)\+)*|⇧?⌘)(?:[A-Z0-9?/`,.+=−-]|Space|Esc|Home|Enter|\[|\])$/;

/** A title read as a name, what it does (after its first ": " or " · ") and the keys it gives in brackets. */
export function readTitle(title: string): { name: string; desc: string; keys: string[] } {
  let text = title.trim();
  let keys: string[] = [];
  for (const m of [...text.matchAll(/\s*\(([^()]+)\)/g)].reverse()) {
    const ks = m[1]!.split(/\s*[·,/]\s*/).filter(Boolean);
    if (!ks.length || !ks.every((k) => KEY.test(k))) continue;
    keys = ks;
    text = (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).trim();
    break;
  }
  const cut = text.search(/: | · /);
  return cut > 0 ? { name: text.slice(0, cut), desc: text.slice(cut + (text[cut] === ':' ? 2 : 3)), keys } : { name: text, desc: '', keys };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** What the dot on a build category means: its title says it after the rest (tools.ts), the tooltip by a dot. */
export const SUGGEST_NOTE = '다음에 지을 것이 여기 있음';

let tip: HTMLElement | null = null;
/** The control pointed at or focused, its title kept aside from the moment the pointer is on it (kept aside only
 *  once the tooltip showed, the browser had read it already and showed its own beside ours). */
let kept: HTMLElement | null = null;
/** Whether the tooltip shows for it yet (it waits a moment for a pointer just arrived). */
let shown = false;
let timer = 0;
/** Until when the next shows at once: moving down the bar, tile to tile. */
let warmUntil = 0;

function render(el: HTMLElement, title: string): void {
  if (!tip) return;
  const t = readTitle(title);
  if (!t.name) return release();
  // Keys each by the tool it picks, where a tile holds several (data-keys: "도로 R · 골목 T"), else by the name.
  const named = (el.dataset.keys ?? '').split(' · ').map((k) => k.match(/^(.+) (\S+)$/)).filter((m) => !!m);
  const kbd = (k: string) => `<kbd>${esc(k)}</kbd>`;
  const note = el.classList.contains('suggest') && t.desc.endsWith(SUGGEST_NOTE);
  const desc = note ? t.desc.slice(0, -SUGGEST_NOTE.length).replace(/\s*·\s*$/, '') : t.desc;
  tip.innerHTML = `<span class="tip-head"><b>${esc(t.name)}</b>${named.length ? '' : t.keys.map(kbd).join('')}</span>`
    + (desc ? `<span class="tip-desc">${esc(desc)}</span>` : '')
    + (named.length ? `<span class="tip-keys">${named.map((m) => `<span>${esc(m[1]!)} ${kbd(m[2]!)}</span>`).join('')}</span>` : '')
    + (note ? `<span class="tip-note">${SUGGEST_NOTE}</span>` : '');
  shown = true;
  place(el);
}

/** Above the building bar across the foot; under the top buttons and the corner's controls (beside a bar standing
 *  down the map, were there one). */
function place(el: HTMLElement): void {
  if (!tip) return;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const dock = el.closest<HTMLElement>('#dock-col');
  const across = dock && dock.offsetWidth > dock.offsetHeight;
  const clampX = (x: number) => Math.max(8, Math.min(innerWidth - w - 8, x));
  const clampY = (y: number) => Math.max(8, Math.min(innerHeight - h - 8, y));
  let x: number;
  let y: number;
  if (dock && !across) {
    x = dock.getBoundingClientRect().right + 8;
    y = clampY(r.top + r.height / 2 - h / 2);
    tip.dataset.side = 'right';
  } else if (across) {
    x = clampX(r.left + r.width / 2 - w / 2);
    y = r.top - h - 8;
    tip.dataset.side = 'top';
  } else {
    x = clampX(r.left + r.width / 2 - w / 2);
    y = r.bottom + 8;
    tip.dataset.side = 'bottom';
  }
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

/** Its title aside: read and written as before (a new one shows at once). Left empty, not taken away — taken away,
 *  the browser showed the title of what holds it (the speeds' when held). */
function keep(el: HTMLElement): void {
  let text = el.getAttribute('title') ?? '';
  el.setAttribute('title', '');
  Object.defineProperty(el, 'title', {
    configurable: true,
    get: () => text,
    set: (v: string) => {
      const next = String(v);
      if (next === text) return; // (the date and 도시 상태 say theirs again each update)
      text = next;
      if (kept === el && shown) render(el, text);
    },
  });
  el.setAttribute('aria-describedby', 'tip');
  kept = el;
  shown = false;
}

function giveBack(el: HTMLElement): void {
  const text = el.title;
  delete (el as { title?: string }).title; // (back to the element's own)
  if (text) el.setAttribute('title', text);
  else el.removeAttribute('title');
  if (el.getAttribute('aria-describedby') === 'tip') el.removeAttribute('aria-describedby');
}

/** Whether a control has a tooltip to show now (not the menu's button while its menu is out beside it). */
const tipped = (el: HTMLElement) => el.isConnected && !!el.offsetParent && !el.closest('details[open]') && !!el.getAttribute('title');

/** The tooltip for a control: at once, or after a moment (a pointer just arrived, not moving along the bar). */
function take(el: HTMLElement, wait: boolean): void {
  if (kept === el) {
    if (!wait && !shown) {
      clearTimeout(timer);
      render(el, el.title);
    }
    return;
  }
  release(false);
  if (!tipped(el)) return;
  keep(el);
  if (!wait) return render(el, el.title);
  timer = window.setTimeout(() => {
    if (kept === el) render(el, el.title);
  }, 380);
}

/** Away with the tooltip, and the title back. */
export function release(cool = true): void {
  clearTimeout(timer);
  if (kept) {
    giveBack(kept);
    if (cool && shown) warmUntil = performance.now() + 500;
    kept = null;
  }
  shown = false;
  if (tip) tip.hidden = true;
}

export function setupTips(): void {
  tip = document.createElement('div');
  tip.id = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as Element).closest?.<HTMLElement>(SCOPE);
    if (el) take(el, !shown && performance.now() >= warmUntil);
  });
  document.addEventListener('pointerout', (e) => {
    const to = e.relatedTarget as Node | null;
    const el = (e.target as Element).closest?.<HTMLElement>(SCOPE);
    if (el && el === kept && !(to && el.contains(to))) release();
  });
  // The keyboard's way along the bar shows each control's keys as well (a press of the mouse puts it away). Focus
  // moved by the page (a pane redrawn hands it back) leaves a tooltip under the pointer be.
  document.addEventListener('focusin', (e) => {
    const el = (e.target as Element).closest?.<HTMLElement>(SCOPE);
    if (el && el.matches(':focus-visible')) take(el, false);
    else if (kept && !kept.contains(e.target as Node) && !kept.matches(':hover')) release(false);
  });
  document.addEventListener('focusout', (e) => {
    if (kept && e.target === kept && !kept.matches(':hover')) release(false);
  });
  // (The menu opened from the keyboard, its button keeping focus: the tooltip went on over the menu.) Only a
  // <details> holding the control: the panels rebuild theirs open (유형별 수요, 다른 선택) every update, and each fired
  // a toggle that put the tooltip away before it showed.
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d instanceof HTMLDetailsElement && d.open && kept && d.contains(kept)) release(false);
  }, true);
  document.addEventListener('pointerdown', () => release(false), true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') release(false);
  }, true);
  addEventListener('scroll', () => release(false), true);
  addEventListener('resize', () => release(false));
  addEventListener('blur', () => release(false));
}
