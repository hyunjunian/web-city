// Phones: the system's back button (or the edge swipe) puts away what is open over the map, as Esc
// does, instead of leaving the game. While anything is out, one history entry stands in front of the
// page for back to take; it is taken back once nothing is.

import { closeClock } from './controls';
import { active } from './manage';
import { tool } from './tools';
import { $ } from './util';

const phone = () => matchMedia('(max-width: 860px)').matches;
/** Our entry is in front of the page. */
let guarded = false;
/** We are taking our entry back ourselves (its popstate is ours to ignore). */
let consuming = false;

/** Whether anything Esc would put away is out: a dialog, the menu or the speeds' card, the tool card, a card, a sheet, the pane, a goal's screen, a tool in hand. */
function anythingOpen(): boolean {
  return !!document.querySelector('dialog[open], details.dropdown[open], .mb-time.open') || !$('#tray').hidden || !$('#info-card').hidden || !$('#sheet').hidden
    || $('#app').classList.contains('pane-open') || active !== null || tool.id !== 'query';
}

/** After a press: an entry in front of the page while something is out, none once nothing is. */
function settle(): void {
  if (!phone() || consuming) return;
  const open = anythingOpen();
  if (open && !guarded) {
    history.pushState({ webCity: 'open' }, '');
    guarded = true;
  } else if (!open && guarded) {
    // (Put away with its own ×: back must not be spent on nothing next time.)
    consuming = true;
    history.back();
  }
}

export function setupBack(): void {
  const later = () => requestAnimationFrame(settle);
  for (const type of ['pointerup', 'click', 'keyup'] as const) window.addEventListener(type, later, true);
  setTimeout(settle, 0); // (a first visit opens the pane by itself, with no press)
  window.addEventListener('popstate', () => {
    if (consuming) {
      consuming = false;
      guarded = false;
      later(); // (something may have opened meanwhile: the ⋯ menu on the press that let the entry go)
      return;
    }
    if (!guarded) return; // (not ours: the page's own history)
    guarded = false;
    // Back is Esc: the topmost thing goes (a dialog first: the map's keys wait while one is open).
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    const menu = document.querySelector<HTMLDetailsElement>('details.dropdown[open]');
    if (dialog) dialog.close();
    else if (menu) menu.open = false;
    else if (document.querySelector('.mb-time.open')) closeClock(); // (the speeds' card under 시간)
    else document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    later();
  });
}
