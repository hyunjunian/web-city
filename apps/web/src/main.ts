// Web viewer entry: wires the modules together, runs the frame loop and boots the first city.

import { setupGoals } from './manage';
import { setupBack } from './back';
import { City, sampleCity } from '@web-city/engine';
import { buildOverlay, buildSpeed, markCity, resetSpeedChoice, restoreNight, setSpeed, setupClock } from './controls';
import { followTag, preview, refreshTag, setupInput } from './input';
import { tickDisasters } from './live';
import { setupMenu } from './menu';
import { drawMinimap, setupMinimap } from './minimap';
import { cancelMySimAction } from './mysims';
import { updatePanels } from './panels';
import { freshLandfill } from './readings';
import { leaveRegion } from './region';
import { cam, city, cityLineage, clampCamera, dirty, fitCamera, mapBand, mapCovers, onCityChange, overlay, redraw, renderer, selected, setCity, setDirty, setSaveSlotId, speed } from './state';
import { autosave, autosaveSlot, autosaveSteps, lastAutosave, resumeAutosave } from './storage';
import { buildTools, closeTray, forgetPreviousTool, refreshEdgeHint, selectTool, SPEEDS } from './tools';
import { abandonDrive, drive, setupDriving, tickDrive } from './udi';
import { setupUndo } from './undo';
import { $, flash, onCoveredFlash } from './util';
import { toast } from './toast';
import { closeInfo, closePane, closeSheet, openPane, setupTabs } from './tabs';
import { setupTheme } from './theme';
import { paintIcons } from './icons';
import { setupPointerBlur, setupRangeFill, setupSwipeDown, setupTouchTitles } from './widgets';
import { setupTips } from './tips';

export let last = performance.now();

export let carry = 0;

export let panelTimer = 0;

/** Whether the whole city was on screen at the last draw (see whole-view). */
let wholeShown = false;

/** An autosave waiting for an idle moment. */
let saving = false;
/** An autosave part-way written: no day starts until it is done (its pieces must see one city). */
let holdDays = false;
const later = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 50));

/** How long drawing the map takes, smoothed (ms): the simulation gets what's left of a frame. */
let drawCost = 8;

/** When the uncovered part of the map was last measured (see mapBand). */
let bandAt = -Infinity;

export function frame(now: number): void {
  // Asked for first: one exception (a panel, the draw) must not stop the city for good.
  requestAnimationFrame(frame);
  try {
    frameBody(now);
  } catch (err) {
    if (!frameFailed) {
      frameFailed = true;
      console.error(err);
      flash('화면을 그리다 오류가 났습니다. 저장 후 새로 고침하면 나아질 수 있습니다.', 'bad');
    }
  }
}
let frameFailed = false;

function frameBody(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (!saving && Math.floor(city.state.day / 30) - lastAutosave >= 6) {
    // Written a few milliseconds at a time when the page is idle (a big
    // city's save is a few frames' work), from the end of a day; the next
    // day waits until it is written (see holdDays).
    saving = true;
    const owner = city;
    let steps = autosaveSteps();
    let revision = city.revision;
    const write = () => {
      if (city !== owner) {
        saving = holdDays = false;
        return;
      }
      if (city.stepping) return later(write);
      // An edit part-way through (a tool used meanwhile): start again.
      if (city.revision !== revision) {
        steps = autosaveSteps();
        revision = city.revision;
      }
      holdDays = true;
      const end = performance.now() + 4;
      do {
        if (steps.next().done) {
          saving = holdDays = false;
          return;
        }
      } while (performance.now() < end);
      later(write);
    };
    later(write);
  }
  // A dialog over the game (help, saves, a new city, a question) holds the clock, as the game's menus do
  // (live disasters too: a tornado went on wrecking behind an undo question; and a drive's countdown).
  const held = !!document.querySelector('dialog[open]');
  if (drive && !held) tickDrive(dt);
  if (!held) tickDisasters(dt);
  if (!city.state.liveDisasters.length && renderer.live.length) {
    renderer.live = [];
    redraw();
  }
  const daysPerSec = SPEEDS[speed]!.days;
  // Days run a piece at a time within the frame's budget: a month's end (the
  // commute, route planning) spreads over a few frames instead of freezing
  // the page. A day under way finishes even if time is paused meanwhile.
  if (daysPerSec > 0 && !city.state.impeached && !held) carry += dt * daysPerSec;
  panelTimer += dt;
  // Panels read the whole city: not while a day is part-way through. A frame
  // does the panels or a share of the simulation, not both, and the share is
  // what drawing leaves of a frame (a big map takes long to draw).
  const panelsDue = panelTimer > 0.25 && daysPerSec > 0 && !city.stepping;
  const budget = performance.now() + (panelsDue ? 0 : Math.max(3, Math.min(10, 14 - drawCost)));
  while (performance.now() < budget) {
    if (!city.stepping) {
      // Panels overdue: no new day until they've had their frame (on a big map a day was always
      // under way when a frame began, and the date and funds froze for seconds).
      if (carry < 1 || daysPerSec <= 0 || city.state.impeached || holdDays || panelTimer > 0.25) break;
      city.beginSteps(1);
      carry -= 1;
    }
    if (!city.resume()) {
      redraw(); // the day is done: show it
      freshLandfill(); // (the landfill the month's tally counted, noted before anything else can be zoned)
    }
  }
  carry = Math.min(carry, 3);
  if (panelsDue) {
    panelTimer = 0;
    updatePanels();
    refreshTag();
  }
  if (city.state.fires.length || city.state.treeFires.length) setDirty(true); // animate flames
  if (daysPerSec > 0 && !city.state.impeached) {
    renderer.clock += dt;
    if (renderer.animating) redraw(); // moving cars
  }
  if (city.state.units.some((u) => u.travel > 0)) {
    renderer.dayFraction = carry;
    redraw(); // units on the way
  }
  if (renderer.pendingStill || renderer.effects.length) setDirty(true); // the zoomed-out image is still being repainted; build feedback fading
  if (dirty) {
    const t0 = performance.now();
    clampCamera();
    // (The edge arrows keep to the part nothing covers: measured now and then, not each frame — it reads the layout.)
    if (renderer.marks.length && (t0 - bandAt > 300 || !renderer.band)) {
      renderer.band = mapBand();
      renderer.covers = mapCovers();
      bandAt = t0;
    }
    renderer.draw(city, cam, overlay, preview, selected);
    followTag();
    // With the whole city on screen, the minimap and 전체 보기 have nothing to add: they fade out until zoomed in.
    const vw = renderer.canvas.width / renderer.dpr / cam.scale;
    const vh = renderer.canvas.height / renderer.dpr / cam.scale;
    const whole = cam.x <= 0.5 && cam.y <= 0.5 && cam.x + vw >= city.size - 0.5 && cam.y + vh >= city.size - 0.5;
    if (whole !== wholeShown) document.getElementById('view')?.classList.toggle('whole-view', (wholeShown = whole));
    drawMinimap();
    setDirty(false);
    drawCost = drawCost * 0.8 + (performance.now() - t0) * 0.2;
  }
}

/** Builds the ready-made sample town and opens it: nine months of growth, run in slices so the page stays live. */
let building = false;
export function openSample(): void {
  if (building) return;
  building = true;
  document.body.style.cursor = 'progress';
  const DAYS = 270;
  // Opening another city meanwhile (a save, a new city, a region square) wins.
  const lineage = cityLineage;
  let town: City | null = null;
  let done = 0;
  // The progress shows on the button too (on a phone the hint bar is behind the pane).
  const button = document.querySelector<HTMLButtonElement>('#onboarding-sample');
  const label = button?.textContent ?? '';
  const progress = (msg: string, pct?: number) => {
    flash(msg);
    if (button) {
      button.disabled = true;
      button.textContent = pct === undefined ? '만드는 중…' : `만드는 중… ${pct}%`;
      // (The button fills as the town grows: a bar to watch, not only a number.)
      button.style.setProperty('--pct', `${pct ?? 0}%`);
      button.classList.add('making');
    }
  };
  const finish = () => {
    building = false;
    document.body.style.cursor = '';
    if (button) {
      button.disabled = false;
      button.textContent = label;
      button.classList.remove('making');
    }
  };
  const slice = () => {
    if (cityLineage !== lineage) return finish();
    try {
      town ??= sampleCity({ days: 0 });
      const until = performance.now() + 40;
      while (done < DAYS && performance.now() < until) {
        town.step(1);
        done++;
      }
      if (done < DAYS) {
        progress(`예시 도시를 만드는 중입니다… ${Math.round((done / DAYS) * 100)}%`, Math.round((done / DAYS) * 100));
        setTimeout(slice, 0);
        return;
      }
      leaveRegion(); // the sample is a city of its own, not a region square
      // Rewards earned while it grew: one line instead of a toast each.
      const earned = town.takeNewUnlocks().length;
      town.takeReports();
      // (Phones: the pane it was opened from steps aside for the city first, so the city is framed on the whole
      // screen — framed under the pane, it sat in the top half once the pane went.)
      closePane();
      setCity(town);
      // (One thing to do, and what it already earned: the keys are in 도움말.)
      // (Where they are: under 짓기 on a phone, the bar's own 보상 on a wide screen.)
      const where = matchMedia('(max-width: 860px)').matches ? '짓기 › 보상' : '왼쪽 막대의 보상';
      flash(`예시 도시입니다 · 건물을 눌러 살펴보세요${earned ? ` · 보상 ${earned}종을 지을 수 있습니다 (${where})` : ''}`);
      finish();
    } catch (e) {
      finish();
      throw e;
    }
  };
  progress('예시 도시를 만드는 중입니다…');
  // Let the message paint before the first slice.
  setTimeout(slice, 50);
}

export function starterCity(): City {
  // A fresh map each first visit (everyone got seed 1's).
  return new City({ name: '새 도시', size: 128, difficulty: 'medium', seed: 1 + Math.floor(Math.random() * 99_999) });
}

paintIcons();
// What belongs to one city is dropped when another opens (its news and journal travel with its save).
onCityChange((undo) => {
  closeInfo();
  cancelMySimAction();
  abandonDrive();
  if (!undo) resetSpeedChoice();
  // Another city opens with the query tool in hand (not a disaster or a reward left armed); an undo keeps the tool.
  if (!undo) {
    selectTool('query');
    forgetPreviousTool();
  }
  refreshEdgeHint(); // (an undo keeps the road in hand: its edge outline follows the restored town)
});
setupRangeFill();
setupTouchTitles((text) => flash(text, 'info'));
onCoveredFlash((msg, tone) => toast(msg, tone, undefined, undefined, false, undefined, undefined, false)); // (nothing for 도시 to mark unread)
setupSwipeDown($('#pane'), closePane);
setupSwipeDown($('#info-card'), closeInfo);
setupSwipeDown($('#tray'), closeTray);
setupSwipeDown($('#sheet'), closeSheet);
setupPointerBlur();
setupTips();
renderer.resize();
buildTools();
buildSpeed();
setupClock();
buildOverlay();
setupInput();
setupGoals();
setupMenu();
setupDriving();
setupTabs();
markCity();
// (The skip link's jump: a fragment alone scrolls, it doesn't hand the canvas the keys.)
document.querySelector<HTMLAnchorElement>('.skip-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  $('#map').focus();
});
setupBack();
setupUndo();
setupMinimap();
setupTheme();
restoreNight();
const resumed = resumeAutosave();
setCity(resumed ?? starterCity());
// The game opens paused: a blank map has nothing to run, and a resumed city waits for its player.
// (The first zone laid on a new map starts the clock: see input.ts.)
setSpeed(0);
if (resumed) setSaveSlotId(autosaveSlot());
// Phones keep the getting-started list behind the 도시 button: on a first visit, show it.
// (The map framed again for it: framed first on the whole screen, the town sat half under the sheet.)
if (!resumed && !$('#onboarding').hidden && matchMedia('(max-width: 860px)').matches) {
  openPane();
  fitCamera();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') autosave();
});
requestAnimationFrame(frame);
