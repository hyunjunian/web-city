// Shared viewer state: the open city, the renderer, camera, overlay, speed and selection.
// Other modules read these live bindings and change them through the setters.

import { City, type DevType, type Rect } from '@web-city/engine';
import { buildTaxes } from './controls';
import { Graphs } from './graphs';
import { buildOrdinances } from './info';
import { updatePanels } from './panels';
import { type Camera, type Overlay, Renderer } from './render';
import { setAgeMonth, setPollMonth, setRewardMonth } from './reports';
import { setLastAutosave } from './storage';
import { $ } from './util';

export let city: City;

export const renderer = new Renderer($<HTMLCanvasElement>('#map'));

export const graphs = new Graphs($('#graphs'));

export const cam: Camera = { x: 0, y: 0, scale: 8 };

export let overlay: Overlay = { kind: 'none' };

export let overlayType: DevType = 'R$';

export let speed = 1;

export let dirty = true;


export let selected: Rect | null = null;

export let hover: [number, number] | null = null;

export let drag: { start: [number, number]; end: [number, number]; /** A line drag that set off up or down bends there first. */ vertical?: boolean; pan?: { x: number; y: number; cx: number; cy: number; tap?: boolean } } | null = null;

/** The built-up part (zones, buildings, facilities) with a margin: its centre and span in tiles (the whole map while there is none). */
export function builtArea(whole = false): { cx: number; cy: number; span: number } {
  const s = city.state;
  const n = s.size;
  let [x0, y0, x1, y1] = [n, n, -1, -1];
  for (let i = 0; i < n * n && !whole; i++) {
    if (!s.zone[i] && !s.occupant[i]) continue;
    const x = i % n;
    const y = (i - x) / n;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const span = x1 < 0 ? n : Math.min(n, Math.max(32, x1 - x0 + 13, y1 - y0 + 13));
  const [cx, cy] = x1 < 0 ? [n / 2, n / 2] : [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2];
  return { cx, cy, span };
}

/** A part of the map, in CSS pixels from the map's own top left corner. */
export type Band = { left: number; top: number; right: number; bottom: number };

/**
 * The part of the map nothing covers: below the top bar, right of the build bar down the left, and on a phone above
 * the city sheet when it is up — or beside it, where a phone held sideways has it as a side panel. Framing on a
 * phone, the edge arrows and their flights keep to it (an arrow under the sheet, a target landing there).
 */
export function mapBand(): Band {
  const r = renderer.canvas.getBoundingClientRect();
  let [left, top, right, bottom] = [0, 0, r.width, r.height];
  const bar = document.getElementById('mapbar')?.getBoundingClientRect();
  if (bar?.height) top = Math.max(top, Math.min(r.height / 3, bar.bottom - r.top));
  // (The build bar takes the left edge from the top down: the band starts beside it, where it doesn't step back.)
  const dock = document.getElementById('dock');
  const d = dock && getComputedStyle(dock).visibility !== 'hidden' ? dock.getBoundingClientRect() : null;
  if (d?.width) left = Math.max(left, Math.min(r.width / 3, d.right - r.left));
  const pane = document.getElementById('pane');
  const app = document.getElementById('app');
  if (pane && app?.classList.contains('pane-open') && matchMedia('(max-width: 860px)').matches) {
    // (Where the sheet comes to rest, not where its slide-in has got to: offsets leave the transform out.)
    const at = app.getBoundingClientRect();
    if (matchMedia('(orientation: landscape) and (max-height: 520px)').matches) left = Math.max(left, Math.min(r.width / 2, at.left + pane.offsetLeft + pane.offsetWidth - r.left));
    else bottom = Math.min(bottom, Math.max(top + r.height / 3, at.top + pane.offsetTop - r.top));
  }
  return { left, top, right: Math.max(left + 1, right), bottom: Math.max(top + 1, bottom) };
}

/** The cards over the map's top corners — the view's legend under the top bar, 전체 보기 and the minimap (not while
 *  they fade, the whole city in sight) — in CSS px from its top left: a target under one is out of sight. */
export function mapCovers(): Band[] {
  const r = renderer.canvas.getBoundingClientRect();
  const faded = document.getElementById('view')?.classList.contains('whole-view');
  return ['map-layer', ...(faded ? [] : ['map-zoom', 'minimap'])].flatMap((id) => {
    const el = document.getElementById(id);
    const c = el && !el.classList.contains('off') ? el.getBoundingClientRect() : null;
    return c?.width && c.height ? [{ left: c.left - r.left, top: c.top - r.top, right: c.right - r.left, bottom: c.bottom - r.top }] : [];
  });
}

export function fitCamera(whole = false): void {
  // (A glide under way doesn't carry on over the new framing: closing the phone's pane started one toward the town
  // being left, and the sample city opened framed where it had been.)
  flights++;
  const r = renderer.canvas.getBoundingClientRect();
  // The built-up part with a margin, or the whole map while there is none (or when asked: 전체 보기).
  const { cx, cy, span } = builtArea(whole);
  // On a phone, in the part of the screen nothing covers: below the tool bar, above the city sheet when it is up
  // (framed on the whole screen, the town sat half under the sheet with a dark band over it), beside it held sideways.
  const b = matchMedia('(max-width: 860px)').matches ? mapBand() : { left: 0, top: 0, right: r.width, bottom: r.height };
  const [w, h] = [b.right - b.left, b.bottom - b.top];
  cam.scale = Math.max(whole ? 1 : 2, Math.min(w, h) / span); // (zooming out stops at 1)
  cam.x = cx - (b.left + w / 2) / cam.scale;
  cam.y = cy - (b.top + h / 2) / cam.scale;
  bandFraming = b.bottom < r.height - 1 || b.left > 1 ? { x: cam.x, y: cam.y, scale: cam.scale } : null;
}

/**
 * The framing fitCamera made beside a phone's open pane (null: on the whole map): the pane closing frames the town
 * again on the whole screen while the view is still that one (a first visit's town stayed in the top half).
 */
let bandFraming: { x: number; y: number; scale: number } | null = null;
export function takeBandFraming(): { x: number; y: number; scale: number } | null {
  const f = bandFraming;
  bandFraming = null;
  return f;
}

/**
 * Moves the view to centre a tile, zooming in to at least `minScale` pixels per tile — in the middle of `band`
 * when given (the part nothing covers), else of the map.
 */
export function centerOn(x: number, y: number, minScale = 8, band?: Band): void {
  const r = renderer.canvas.getBoundingClientRect();
  const [mx, my] = band ? [(band.left + band.right) / 2, (band.top + band.bottom) / 2] : [r.width / 2, r.height / 2];
  // Flies there (350ms, zoom eased in proportion), so the eye follows where it went.
  const from = { x: cam.x, y: cam.y, scale: cam.scale };
  const scale = Math.max(cam.scale, minScale);
  const to = { x: x + 0.5 - mx / scale, y: y + 0.5 - my / scale };
  const fromCx = from.x + mx / from.scale;
  const fromCy = from.y + my / from.scale;
  const start = performance.now();
  const flight = ++flights;
  const step = (now: number) => {
    if (flight !== flights) return; // another flight took over
    const k = Math.min(1, (now - start) / 350);
    const e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
    cam.scale = from.scale * (scale / from.scale) ** e;
    // The view's centre moves straight to the target's.
    const cx = fromCx + (x + 0.5 - fromCx) * e;
    const cy = fromCy + (y + 0.5 - fromCy) * e;
    cam.x = cx - mx / cam.scale;
    cam.y = cy - my / cam.scale;
    if (k >= 1) {
      cam.x = to.x;
      cam.y = to.y;
    }
    redraw();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
let flights = 0;

/**
 * Blinks a rectangle twice once the map has flown there (centerOn takes 350ms): a flash at the press was over before
 * the flight ended, and what was found went unmarked.
 */
export function blinkAt(x: number, y: number, w = 1, h = 1): void {
  for (const t of [380, 720]) setTimeout(() => {
    renderer.effect('flash', x, y, w, h);
    redraw();
  }, t);
}
/** 찾아가기's mark on what it found: a ring closing in on it, twice, once the map has flown there. */
export function pingAt(x: number, y: number): void {
  for (const t of [380, 1000]) setTimeout(() => {
    renderer.effect('ping', x, y);
    redraw();
  }, t);
}
/** Counts camera flights (one started since another reads a different number). */
export const flightCount = (): number => flights;

/** Glides the view's centre to (cx, cy) at `scale` over `ms` (the zoom buttons and 전체 보기; they used to jump). */
export function glideTo(cx: number, cy: number, scale: number, ms = 220): void {
  // Asked for less motion: there at once.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 1;
  const r = renderer.canvas.getBoundingClientRect();
  const from = { cx: cam.x + r.width / cam.scale / 2, cy: cam.y + r.height / cam.scale / 2, scale: cam.scale };
  const start = performance.now();
  const flight = ++flights;
  const step = (now: number) => {
    if (flight !== flights) return;
    const k = Math.min(1, (now - start) / ms);
    const e = 1 - (1 - k) ** 3;
    cam.scale = from.scale * (scale / from.scale) ** e;
    cam.x = from.cx + (cx - from.cx) * e - r.width / cam.scale / 2;
    cam.y = from.cy + (cy - from.cy) * e - r.height / cam.scale / 2;
    redraw();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Stops a flight under way (the player took the map). */
export function stopFlight(): void {
  flights++;
}

/** Keeps the middle of the view over the map, however far it is dragged or zoomed. */
export function clampCamera(): void {
  const w = renderer.canvas.width / renderer.dpr / cam.scale;
  const h = renderer.canvas.height / renderer.dpr / cam.scale;
  const n = city.size;
  // The view's centre stays on the map; a map smaller than the view may also sit anywhere inside it
  // (a phone's goal screen moves the city into the strip above the pane, which the centre rule undid).
  cam.x = Math.min(Math.max(n - w / 2, 0), Math.max(Math.min(-w / 2, n - w), cam.x));
  cam.y = Math.min(Math.max(n - h / 2, 0), Math.max(Math.min(-h / 2, n - h), cam.y));
}

/** Per-city UI state elsewhere resets itself here (registered by each module; `undo` keeps the view). */
const cityHooks: ((undo: boolean) => void)[] = [];
export function onCityChange(fn: (undo: boolean) => void): void {
  cityHooks.push(fn);
}

/** Bumped whenever another city opens, so slow work started for an earlier one can tell. */
export let cityGeneration = 0;
/** Bumped for another city, not for undo's restored copy of the same one (what was done in it carries on). */
export let cityLineage = 0;

/**
 * Changes when the city may have: a new week, or an edit (the city's
 * revision). Panels that scan the whole map redo it only when this moves.
 */
export function changeKey(): string {
  const s = city.state;
  // By the week, not the day: the panels it keys (advice, building counts, the
  // budget forecast, deal offers) are costly on a big map, and an edit
  // (the revision) still shows at once.
  return `${cityGeneration}|${city.revision}|${Math.floor(s.day / 7)}|${s.name}|${s.ordinances.length}|${s.neighbourDeals.length}|${Object.values(s.departments).join()}|${Object.values(s.taxRates).join()}`;
}

/**
 * The browser save slot the open city belongs to (loaded from or saved to),
 * so saving updates it; any other city opened starts without one.
 */
export let saveSlotId: string | null = null;

export function setSaveSlotId(id: string | null): void {
  saveSlotId = id;
}

/**
 * City methods that only read what a day part-way through leaves consistent
 * (previews under the pointer, the map views, the stepping itself): they may
 * run while the frame loop has a day under way. Every other method finishes
 * that day first (see `guard`).
 */
const MID_DAY = new Set<string | symbol>([
  'beginSteps', 'resume', 'settle', 'steps', 'stats', 'desirabilityMap', 'canPlaceStructure', 'previewLine', 'previewNetwork',
  'previewZone', 'previewBulldoze', 'powerReach', 'roadBeside', 'isUnlocked', 'placementsLeft', 'structureUpkeep',
]);

/**
 * The open city as the viewer uses it. The frame loop runs days a piece at a
 * time (City.beginSteps) so a month's end doesn't freeze the page; a tool,
 * panel or query calling the city in between gets the day finished first.
 */
function guard(c: City): City {
  return new Proxy(c, {
    get(target, key) {
      const v = Reflect.get(target, key, target) as unknown;
      if (typeof v !== 'function') return v;
      const fn = v as (...args: unknown[]) => unknown;
      if (MID_DAY.has(key)) return fn.bind(target);
      return (...args: unknown[]) => {
        target.settle();
        return fn.apply(target, args);
      };
    },
  });
}

/** Opens a city. `keepSlot`: the same city again (undo), still saved to the same slot. */
export function setCity(c: City, opts: { keepCamera?: boolean; keepSlot?: boolean; sameCity?: boolean } = {}): void {
  if (!opts.keepSlot) saveSlotId = null;
  city?.settle(); // the old one finishes its day (a region keeps it)
  c.realTimeDisasters = true; // live.ts moves them about eight steps a second, at any game speed
  city = guard(c);
  cityGeneration++;
  if (!opts.sameCity) cityLineage++;
  selected = null;
  drag = null; // a drag (or a keyboard build's start) belongs to the old map
  renderer.cursor = null;
  renderer.routes = null; // a route query's lines belong to the old map
  for (const fn of cityHooks) fn(!!opts.keepCamera);
  graphs.invalidate(); // the same number of months would otherwise keep the old city's lines
  setPollMonth(-1);
  setAgeMonth(-1);
  setRewardMonth(-1);
  setLastAutosave(Math.floor(c.state.day / 30));
  if (!opts.keepCamera) fitCamera();
  buildTaxes();
  buildOrdinances();
  dirty = true;
  updatePanels();
}

/** Asks for the map to be drawn again on the next frame. */
export function redraw(): void {
  dirty = true;
}

export function setDirty(v: boolean): void {
  dirty = v;
}

export function setDrag(v: typeof drag): void {
  drag = v;
}

export function setHover(v: typeof hover): void {
  hover = v;
}

export function setOverlayType(v: typeof overlayType): void {
  overlayType = v;
}

export function setSelected(v: typeof selected): void {
  selected = v;
}

export function setSpeedValue(v: typeof speed): void {
  speed = v;
}

export function setOverlay(v: typeof overlay): void {
  overlay = v;
}
