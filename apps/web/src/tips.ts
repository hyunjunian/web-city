// The bars' own tooltips — the bar down the map (on a phone-wide window, across its foot), the date and the weather
// over the map, its 전체 and zoom: a control's name, what it does and its keys, by it once the pointer rests there,
// at once along the bar. (The browser's came after a second, small and plain, the keys run into the words.)
// Elsewhere titles stay the browser's.

const SCOPE = '#dock :is(button, summary), #sb-date, #sb-wind, #map-controls button';

/** A key as a title ends with one: "(Ctrl+Z)", "(R·T·V·H)", "(0 · Space)" — words in brackets are not keys. */
const KEY = /^(?:(?:Ctrl|Shift|Alt)\+)*(?:[A-Z0-9?/`,.+=−-]|Space|Esc|Home|Enter|\[|\])$/;

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

let tip: HTMLElement | null = null;
/** The control the tooltip speaks for (its title kept aside meanwhile, so the browser's doesn't show as well). */
let owner: HTMLElement | null = null;
let timer = 0;
/** Until when the next shows at once: moving down the bar, tile to tile. */
let warmUntil = 0;

function render(el: HTMLElement, title: string): void {
  if (!tip) return;
  const t = readTitle(title);
  if (!t.name) return hide();
  // Keys each by the tool it picks, where a tile holds several (data-keys: "도로 R · 골목 T"), else by the name.
  const named = (el.dataset.keys ?? '').split(' · ').map((k) => k.match(/^(.+) (\S+)$/)).filter((m) => !!m);
  const kbd = (k: string) => `<kbd>${esc(k)}</kbd>`;
  tip.innerHTML = `<span class="tip-head"><b>${esc(t.name)}</b>${named.length ? '' : t.keys.map(kbd).join('')}</span>`
    + (t.desc ? `<span class="tip-desc">${esc(t.desc)}</span>` : '')
    + (named.length ? `<span class="tip-keys">${named.map((m) => `<span>${esc(m[1]!)} ${kbd(m[2]!)}</span>`).join('')}</span>` : '');
  place(el);
}

/** Beside the bar down the map; above a bar across the foot; under the top bar's and the corner's controls. */
function place(el: HTMLElement): void {
  if (!tip) return;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const dock = el.closest<HTMLElement>('#dock');
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

/** Its title aside while the tooltip shows: read and written as before (a title set meanwhile shows at once). Left
 *  empty, not taken away — taken away, the browser showed the title of what holds it (the speeds' when held). */
function keep(el: HTMLElement): void {
  let text = el.getAttribute('title') ?? '';
  el.setAttribute('title', '');
  Object.defineProperty(el, 'title', {
    configurable: true,
    get: () => text,
    set: (v: string) => {
      text = String(v);
      if (owner === el) render(el, text);
    },
  });
  el.setAttribute('aria-describedby', 'tip');
}

function giveBack(el: HTMLElement): void {
  const text = el.title;
  delete (el as { title?: string }).title; // (back to the element's own)
  if (text) el.setAttribute('title', text);
  else el.removeAttribute('title');
  if (el.getAttribute('aria-describedby') === 'tip') el.removeAttribute('aria-describedby');
}

function show(el: HTMLElement): void {
  clearTimeout(timer);
  if (owner === el) return;
  hide(false);
  // (Not for the menu's button while its menu is out beside it, nor for a control gone from sight.)
  if (!el.isConnected || !el.offsetParent || el.closest('details[open]')) return;
  const title = el.getAttribute('title');
  if (!title) return;
  owner = el;
  keep(el);
  render(el, title);
}

export function hide(cool = true): void {
  clearTimeout(timer);
  if (owner) {
    giveBack(owner);
    owner = null;
    if (cool) warmUntil = performance.now() + 500;
  }
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
    if (!el || el === owner) return;
    clearTimeout(timer);
    if (owner || performance.now() < warmUntil) show(el);
    else timer = window.setTimeout(() => show(el), 380);
  });
  document.addEventListener('pointerout', (e) => {
    const to = e.relatedTarget as Node | null;
    const el = (e.target as Element).closest?.<HTMLElement>(SCOPE);
    if (!el || (to && el.contains(to))) return;
    if (el === owner) hide();
    else clearTimeout(timer);
  });
  // The keyboard's way along the bar shows each control's keys as well (a press of the mouse puts it away).
  document.addEventListener('focusin', (e) => {
    const el = (e.target as Element).closest?.<HTMLElement>(SCOPE);
    if (el && el.matches(':focus-visible')) show(el);
    else if (owner && !owner.contains(e.target as Node)) hide(false);
  });
  document.addEventListener('focusout', (e) => {
    if (owner && e.target === owner && !owner.matches(':hover')) hide(false);
  });
  document.addEventListener('pointerdown', () => hide(false), true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide(false);
  }, true);
  addEventListener('scroll', () => hide(false), true);
  addEventListener('resize', () => hide(false));
  addEventListener('blur', () => hide(false));
}
