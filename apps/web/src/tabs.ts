// What floats over the map besides tools: the city pane along its left (the city's state, 재정·정책, each goal's
// screen with its statistics — there when called for: the city button at the top brings it and puts it away), the
// sheet (지역, from the pane's head), the info card along its right (what the query tool found) and, on small screens,
// the pane as a bottom sheet. Esc closes the topmost.
// (주민 — My Sim, 직접 운전 — is not on the web screen for now: its sheet type stays for its unwired modules.)

import { closeGoal, openFinance, paneClosed } from './manage';
import { fitMapbar } from './controls';
import { redraw, renderer, setSelected } from './state';
import { closeTray } from './tools';
import { cancelMySimAction } from './mysims';
import { giveBackView } from './info';
import { $, flash } from './util';

/** 'budget': the pane's 재정·정책 (taxes, budgets, loans, ordinances and the books). */
export type Tab = 'city' | 'info' | 'budget' | SheetTab;
/** The sheets: 지역 (the city's name, neighbours, deals; the city pane's head, J) — and 주민 (My Sim, U-Drive-It), off the screen for now. */
export type SheetTab = 'sims' | 'region';

const SHEET_TITLE: Record<SheetTab, string> = { sims: '주민', region: '지역' };

/** The sheet open, if any. */
let sheetTab: SheetTab | null = null;
/** What had the keyboard when the sheet opened (J pressed on the map, the pane's 지역): it gets it back. */
let sheetOpener: HTMLElement | null = null;

/** Phones: the city pane and a sheet are both bottom sheets, one at a time. */
const phone = () => matchMedia('(max-width: 860px)').matches;

/** Whether the city pane is in sight (beside the map on wide screens, a sheet over it on a phone). */
export const paneShown = () => $('#app').classList.contains('pane-open');

/** Whether this sheet is on screen now (the panels skip rendering hidden ones). */
export function sheetShown(tab: SheetTab): boolean {
  return sheetTab === tab;
}

/** Shows a panel: the info card, the city pane, its 재정·정책, or one of the sheets (주민, 지역). */
export function showTab(tab: Tab): void {
  if (tab === 'info') openInfo();
  else if (tab === 'city') openPane();
  else if (tab === 'budget') openFinance();
  else openSheet(tab);
}

function openSheet(tab: SheetTab): void {
  closeInfo(); // the sheet would cover it
  closeTray();
  if (phone()) closePane();
  const changed = sheetTab !== tab;
  sheetTab = tab;
  $('#sheet').hidden = false;
  $('#sheet').dataset.tab = tab;
  document.querySelectorAll<HTMLElement>('#sheet [data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== tab));
  $('#view').classList.add('sheet-open');
  $('#sheet-title').textContent = SHEET_TITLE[tab];
  $('#sheet-close').setAttribute('aria-label', `${SHEET_TITLE[tab]} 닫기`);
  if (changed) $('#sheet .panes').scrollTop = 0;
  markOpen();
  document.dispatchEvent(new CustomEvent('sheet-open'));
  // Into the sheet, so the keyboard carries on there.
  if (!$('#sheet').contains(document.activeElement)) {
    sheetOpener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const title = $('#sheet-title');
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }
}

export function closeSheet(): boolean {
  if (!sheetTab) return false;
  const hadFocus = $('#sheet').contains(document.activeElement);
  const was = sheetTab;
  sheetTab = null;
  $('#sheet').hidden = true;
  // (First: a phone's top buttons come back with it — still away, the city button took no focus.)
  $('#view').classList.remove('sheet-open');
  markOpen();
  // Back to the button that opened it, if it is in sight (지역 in a closed pane is not), else to what had the keyboard
  // when it opened (the map, for J), else to the city button at the top. (The menu's was the way back once: it no
  // longer holds 지역, and Space there opened the menu instead of stopping the clock.)
  const opener = sheetOpener;
  sheetOpener = null;
  if (hadFocus) {
    const seen = (b: HTMLElement) => b.isConnected && (b.checkVisibility ? b.checkVisibility({ checkVisibilityCSS: true }) : !!b.offsetParent && getComputedStyle(b).visibility !== 'hidden');
    const shown = [...document.querySelectorAll<HTMLElement>(`[data-sheet-btn="${was}"]`)].find(seen);
    (shown ?? (opener && seen(opener) && !$('#sheet').contains(opener) ? opener : null) ?? document.getElementById('btn-city'))?.focus();
  }
  return true;
}

function openInfo(): void {
  closeTray(); // they overlap
  const card = $('#info-card');
  // A touch that opened the card is followed by its click, which landed on the card rising
  // under the finger (the name field took focus and the keyboard came up): not for a moment.
  if (card.hidden && matchMedia('(pointer: coarse)').matches) {
    card.style.pointerEvents = 'none';
    setTimeout(() => (card.style.pointerEvents = ''), 400);
  }
  card.hidden = false;
  $('#view').classList.add('info-open');
}

/** Closes the info card and lets go of what it showed (selection, routes). */
export function closeInfo(): boolean {
  if ($('#info-card').hidden) return false;
  $('#info-card').hidden = true;
  $('#view').classList.remove('info-open');
  giveBackView();
  setSelected(null);
  renderer.routes = null;
  redraw();
  return true;
}

/** The city pane: in beside the map on wide screens (from the left), up over it on a phone. */
export function openPane(): void {
  if (phone()) {
    closeTray(); // both rise from the bottom
    closeSheet();
  }
  const was = paneShown();
  // (It comes at its head — the region › city, the stage — not wherever it was last left scrolled.)
  if (!was && !$('#pane').classList.contains('managing')) $('#pane').scrollTop = 0;
  $('#app').classList.add('pane-open');
  document.getElementById('btn-city')?.classList.remove('unread'); // (news unread: read now)
  markOpen();
  if (!was) {
    fitMapbar(); // (wide, the bars' middle clears it)
    document.dispatchEvent(new CustomEvent('sheet-open'));
  }
}

export function closePane(): boolean {
  if (!$('#app').classList.contains('pane-open')) return false;
  $('#app').classList.remove('pane-open');
  markOpen();
  fitMapbar();
  paneClosed();
  return true;
}

/** The city button: the city pane comes, on its overview (an area's screen left open ends), or goes. */
export function togglePane(): void {
  if (dismissPane()) return;
  closeGoal();
  openPane();
}

/** Something to look at on the map: the sheet goes, and on phones the city pane (both cover it). */
export function revealMap(): void {
  closeSheet();
  if (phone()) closePane();
}

/** Esc: drops a pending My Sim pick, else closes the info card, else the sheet, else the city pane (`pane`: on a
 *  phone, where it is a sheet over the map; wide, a tool in hand goes down first and an area's screen gives way to the
 *  overview — input.ts). */
export function closeTopLayer(pane = true): boolean {
  if (cancelMySimAction()) {
    flash('My Sim 지정을 취소했습니다');
    return true;
  }
  return closeInfo() || closeSheet() || (pane && dismissPane());
}

/** The city pane put away by the player (its ×, Esc, the city button): the keyboard goes back to the city button at
 *  the top, which opens it (it was left on the hidden pane, and the next Tab went to the map's corner). */
export function dismissPane(): boolean {
  const had = $('#pane').contains(document.activeElement);
  if (!closePane()) return false;
  if (had) document.getElementById('btn-city')?.focus({ preventScroll: true });
  return true;
}

/** The buttons for the pane and the sheets light up while theirs is open. */
function markOpen(): void {
  const pane = $('#app').classList.contains('pane-open');
  // (The tool in hand's tile is not lit as well meanwhile: the open card is what is on.)
  $('#dock').classList.toggle('sheet-open', !!sheetTab || (phone() && pane));
  document.getElementById('btn-city')?.setAttribute('aria-expanded', String(pane));
  document.querySelectorAll<HTMLButtonElement>('[data-sheet-btn]').forEach((b) => {
    const on = b.dataset.sheetBtn === sheetTab;
    b.classList.toggle('open', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

/** Opens a sheet, or closes it when it is the one open (지역: the pane's head; J). */
export function toggleSheet(tab: SheetTab): void {
  if (sheetTab === tab) closeSheet();
  else openSheet(tab);
}

export function setupTabs(): void {
  // The pane's foot fades only while there is more below it (always faded, the last line of a short or
  // scrolled-to-the-end pane read as cut off).
  const pane = $('#pane');
  const below = () => pane.classList.toggle('more-below', pane.scrollHeight - pane.scrollTop - pane.clientHeight > 2);
  pane.addEventListener('scroll', below, { passive: true });
  if (typeof ResizeObserver === 'function') {
    const watch = new ResizeObserver(below);
    watch.observe(pane);
    for (const part of pane.children) watch.observe(part);
  }
  document.querySelectorAll<HTMLButtonElement>('[data-sheet-btn]').forEach((b) => (b.onclick = () => toggleSheet(b.dataset.sheetBtn as SheetTab)));
  $('#sheet-close').onclick = closeSheet;
  // Tab keeps to the sheet while it is open, round from its last control to its ×: it ran on into the page behind,
  // and Esc then closed it with the keyboard left there (on the city's name), not back where it was opened.
  $('#sheet').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    const all = [...$('#sheet').querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.matches(':disabled') && el.getClientRects().length > 0);
    const first = all[0];
    const last = all.at(-1);
    if (!first || !last) return;
    const at = document.activeElement;
    if (!e.shiftKey && at === last) first.focus();
    else if (e.shiftKey && (at === first || at === $('#sheet-title'))) last.focus();
    else return;
    e.preventDefault();
  });
  $('#info-close').onclick = closeInfo;
  $('#pane-close').onclick = () => dismissPane();
  // (From the keyboard, on into the pane it opened: on a phone the button goes away with the bars; wide, the pane comes
  // before the map in the page, and Tab went on to the clock.)
  $('#btn-city').onclick = (e) => {
    togglePane();
    if (e.detail === 0 && paneShown()) $('#pane-close').focus({ preventScroll: true });
  };
  markOpen();
}
