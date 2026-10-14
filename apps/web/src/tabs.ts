// What sits beside and over the map besides tools: the city pane on the left (the
// city's state, 재정·정책, each goal's screen with its statistics — always beside the map on a wide screen), the sheet
// (지역, from the pane's head and the menu), the info card (what the query tool found) and, on small
// screens, the pane as a bottom sheet. Esc closes the topmost.
// (주민 — My Sim, 직접 운전 — is not on the web screen for now: its sheet type stays for its unwired modules.)

import { markCity } from './controls';
import { closeGoal, openFinance, paneClosed } from './manage';
import { redraw, renderer, setSelected } from './state';
import { closeTray } from './tools';
import { cancelMySimAction } from './mysims';
import { giveBackView } from './info';
import { $, flash } from './util';

/** 'budget': the pane's 재정·정책 (taxes, budgets, loans, ordinances and the books). */
export type Tab = 'city' | 'info' | 'budget' | SheetTab;
/** The sheets: 지역 (neighbours, deals; the pane's head, the menu) — and 주민 (My Sim, U-Drive-It), off the screen for now. */
export type SheetTab = 'sims' | 'region';

const SHEET_TITLE: Record<SheetTab, string> = { sims: '주민', region: '지역' };

/** The sheet open, if any. */
let sheetTab: SheetTab | null = null;

/** Phones: the city pane and a sheet are both bottom sheets, one at a time. */
const phone = () => matchMedia('(max-width: 860px)').matches;

/** Whether the city pane is in sight (always beside the map on wide screens). */
export const paneShown = () => (phone() ? $('#app').classList.contains('pane-open') : true);

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
  // Back to the button that opened it, if it is in sight (지역 in a closed or busy pane, or the menu's line while it
  // is shut): else the menu's.
  if (hadFocus) {
    // (checkVisibility also rules out the menu's lines while it is shut.)
    const seen = (b: HTMLElement) => (b.checkVisibility ? b.checkVisibility({ checkVisibilityCSS: true }) : !!b.offsetParent && getComputedStyle(b).visibility !== 'hidden');
    const shown = [...document.querySelectorAll<HTMLElement>(`[data-sheet-btn="${was}"]`)].find(seen);
    (shown ?? document.querySelector<HTMLElement>('#menu > summary'))?.focus();
  }
  $('#view').classList.remove('sheet-open');
  markOpen();
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

/** Small screens: the city pane slides up over the map (wide screens always show it). */
export function openPane(): void {
  if (phone()) {
    closeTray(); // both rise from the bottom
    closeSheet();
  }
  const was = paneShown();
  // (It rises at its head — the region › city, the stage — not wherever it was last left scrolled.)
  if (!was && phone() && !$('#pane').classList.contains('managing')) $('#pane').scrollTop = 0;
  $('#app').classList.add('pane-open');
  document.querySelector('.mb-city')?.classList.remove('unread');
  markOpen();
  if (!was) document.dispatchEvent(new CustomEvent('sheet-open'));
}

export function closePane(): boolean {
  if (!$('#app').classList.contains('pane-open')) return false;
  $('#app').classList.remove('pane-open');
  markOpen();
  paneClosed();
  return true;
}

/** Something to look at on the map: the sheet goes, and on phones the city pane (both cover it). */
export function revealMap(): void {
  closeSheet();
  if (phone()) closePane();
}

/** Esc: drops a pending My Sim pick, else closes the info card, else the sheet, else the city pane. */
export function closeTopLayer(): boolean {
  if (cancelMySimAction()) {
    flash('My Sim 지정을 취소했습니다');
    return true;
  }
  return closeInfo() || closeSheet() || closePane();
}

/** The buttons for the pane and the sheets light up while theirs is open. */
function markOpen(): void {
  const pane = $('#app').classList.contains('pane-open');
  // (The tool in hand's tile is not lit as well meanwhile: the open card is what is on.)
  $('#dock').classList.toggle('sheet-open', !!sheetTab || (phone() && pane));
  markCity();
  document.querySelectorAll<HTMLButtonElement>('[data-sheet-btn]').forEach((b) => {
    const on = b.dataset.sheetBtn === sheetTab;
    b.classList.toggle('open', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

/** Opens a sheet, or closes it when it is the one open (지역: the pane's head, the menu; J). */
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
  // A phone's 도시 상태 (the top bar's first): it opens the pane's sheet on its overview, and again, the sheet goes.
  // (Wide, the pane is always beside the map: the button isn't shown.)
  const city = document.querySelector<HTMLButtonElement>('#mapbar [data-app="city"]');
  if (city) city.onclick = () => {
    if (!closePane()) {
      closeGoal();
      openPane();
    }
  };
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
  $('#pane-close').onclick = closePane;
  markOpen();
}
