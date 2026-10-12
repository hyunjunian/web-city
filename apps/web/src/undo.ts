// Undo: a snapshot of the city before each map edit, restored with Ctrl+Z or the ↶ button.

import { City, loadCity, saveCity, type SavedCity } from '@web-city/engine';
import { updatePanels } from './panels';
import { setSpeed } from './controls';
import { city, setCity, speed } from './state';
import { drive } from './udi';
import { $, ask, flash, josa, keyForControl } from './util';

const LIMIT = 20;

interface Entry {
  snap: SavedCity;
  label: string;
  day: number;
  /** The city the snapshot belongs to: opening another city drops the history. */
  owner: City;
}

/**
 * Undo restores a whole snapshot, so it must not reach behind a choice that
 * isn't a map edit (an ordinance, a loan, deals, neighbours, names, My Sims,
 * a finished mission): it would quietly undo that too. (Taxes and funding
 * levels are carried over instead.) Such
 * a choice ends the history; `barrier` says which, for the message.
 */
let barrier: { label: string; owner: City } | null = null;

/** How many choices have been made (taxes, loans, names, My Sims…): they change the city without a map edit (see unsavedProgress). */
export let choicesMade = 0;

/**
 * Makes a player's choice and, if it took (a setter, true, ok, or a result without ok), ends the
 * undo history. A refused or empty choice leaves the history alone.
 */
export function choice<T>(label: string, make: () => T): T {
  const owner = city;
  const res = make();
  const took = res === undefined || res === true || (typeof res === 'object' && res !== null && (!('ok' in res) || (res as { ok: boolean }).ok));
  if (took) choicesMade++; // (a refused one changed nothing: no progress to lose)
  // Taxes and funding levels don't end it: undo carries them over (see `open`).
  if (SETTINGS.has(label)) return res;
  if (took && (stack.some((e) => e.owner === owner) || redoStack.some((e) => e.owner === owner))) {
    stack = [];
    redoStack = [];
    barrier = { label, owner };
    refreshUndo();
  }
  return res;
}

/** Choices that are settings: an undo or redo keeps them as they are now instead of taking them back. */
const SETTINGS = new Set(['세율', '부서 예산', '시설 예산']);

let stack: Entry[] = [];
/** What undo took back, newest last: redo puts it back (a new edit forgets it). */
let redoStack: Entry[] = [];

/** Takes a snapshot before an edit; returns a function that drops it again if the edit fails. */
export function remember(label: string): () => void {
  stack = stack.filter((e) => e.owner === city);
  const before = barrier;
  barrier = null;
  const entry: Entry = { snap: saveCity(city), label, day: city.state.day, owner: city };
  stack.push(entry);
  const redone = redoStack;
  redoStack = [];
  if (stack.length > LIMIT) stack.shift();
  refreshUndo();
  return () => {
    stack = stack.filter((e) => e !== entry);
    redoStack = redone; // nothing changed: what could be redone still can
    barrier = before; // the edit didn't happen: the history ends where it did
    refreshUndo();
  };
}

export async function undo(): Promise<void> {
  // A mission drives on this city; undoing would swap it out from under the car.
  if (drive) {
    flash('운전 중에는 되돌릴 수 없습니다', 'bad');
    return;
  }
  stack = stack.filter((e) => e.owner === city);
  const entry = stack.at(-1);
  // Time ran on since the edit: undoing takes that time back too. Past a month, ask first.
  // (Time stands still while it asks: the days it names are the days undone.)
  if (entry && city.state.day - entry.day > 30) {
    const was = speed;
    if (was) setSpeed(0);
    const sure = await ask(`"${entry.label}"${josa(entry.label, '을', '를')} 되돌리면 그 뒤 진행된 ${elapsed(city.state.day - entry.day)}도 함께 사라집니다. 되돌릴까요?`, '되돌리기');
    if (was) setSpeed(was);
    if (!sure || stack.at(-1) !== entry) return;
  }
  stack.pop();
  if (!entry) {
    const why = barrier?.owner === city ? barrier.label : null;
    flash(why ? `${why}${josa(why, '을', '를')} ${why === '임무' ? '마쳐서' : '바꿔서'} 그 전 작업은 되돌릴 수 없습니다` : '되돌릴 작업이 없습니다', 'bad');
    refreshUndo();
    return;
  }
  const days = city.state.day - entry.day;
  redoStack.push({ snap: saveCity(city), label: entry.label, day: city.state.day, owner: city });
  open(entry.snap);
  flash(`되돌렸습니다: ${entry.label}${days > 0 ? ` (그 뒤 진행된 ${days}일도 함께 되돌렸습니다)` : ''}`);
}

/** Puts back what the last undo took (Ctrl+Shift+Z, Ctrl+Y). */
export function redo(): void {
  if (drive) return;
  redoStack = redoStack.filter((e) => e.owner === city);
  const entry = redoStack.pop();
  if (!entry) {
    flash('다시 할 작업이 없습니다', 'bad');
    refreshUndo();
    return;
  }
  stack.push({ snap: saveCity(city), label: entry.label, day: city.state.day, owner: city });
  open(entry.snap);
  flash(`다시 했습니다: ${entry.label}`);
}

/** Opens a snapshot in place of the city (undo, redo): the camera and save slot stay. */
function open(snap: SavedCity): void {
  const now = city.state;
  const restored = loadCity(snap);
  // Settings stay as they are now: taxes, department budgets, each facility's funding.
  for (const [t, v] of Object.entries(now.taxRates) as [keyof typeof now.taxRates, number][]) restored.setTaxRate(t, v);
  restored.state.taxLog = now.taxLog.map((e) => [...e] as typeof e);
  // The record goes on too (a tax changed after the snapshot stays changed, and so does its line and its result to come).
  if (now.journal !== undefined) restored.state.journal = JSON.parse(JSON.stringify(now.journal)) as unknown;
  for (const [d, v] of Object.entries(now.departments)) restored.setDepartmentFunding(d as Parameters<City['setDepartmentFunding']>[0], v);
  for (const [id, st] of now.structures) {
    const there = restored.state.structures.get(id);
    if (there?.kind !== st.kind) continue;
    if (there.funding !== st.funding) restored.setFunding(id, st.funding);
    if (st.vehicleFunding !== undefined && there.vehicleFunding !== st.vehicleFunding) restored.setVehicleFunding(id, st.vehicleFunding);
  }
  setCity(restored, { keepCamera: true, keepSlot: true, sameCity: true });
  // The open city is the guarded one setCity made (not the loaded one itself): entries compare with it.
  for (const e of stack) e.owner = city;
  for (const e of redoStack) e.owner = city;
  if (barrier) barrier.owner = city;
  refreshUndo();
  updatePanels();
}

/** Game time in words: "45일", "약 2년 3개월". */
function elapsed(days: number): string {
  if (days < 60) return `${days}일`;
  const months = Math.round(days / 30);
  return months < 12 ? `약 ${months}개월` : `약 ${Math.floor(months / 12)}년${months % 12 ? ` ${months % 12}개월` : ''}`;
}

/** Enables the ↶ button only when there is something to undo. */
export function refreshUndo(): void {
  const btn = document.querySelector<HTMLButtonElement>('#btn-undo');
  if (!btn) return;
  const top = [...stack].reverse().find((e) => e.owner === city);
  btn.disabled = !top;
  btn.title = top ? `되돌리기: ${top.label}${city.state.day > top.day ? ` (그 뒤 ${elapsed(city.state.day - top.day)}도 함께)` : ''} (Ctrl+Z)` : '되돌리기 (Ctrl+Z)';
  // Redo shows only while there is something to redo (it is rare, and the bar is busy).
  const again = document.querySelector<HTMLButtonElement>('#btn-redo');
  const next = [...redoStack].reverse().find((e) => e.owner === city);
  if (again) {
    again.hidden = !next;
    again.title = next ? `다시 하기: ${next.label} (Ctrl+Shift+Z)` : '다시 하기 (Ctrl+Shift+Z)';
  }
}

export function setupUndo(): void {
  $('#btn-undo').onclick = undo;
  $('#btn-redo').onclick = redo;
  $('#btn-undo').onpointerenter = refreshUndo; // its title counts the days run since
  window.addEventListener('keydown', (e) => {
    if (keyForControl(e) || document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      redo();
    }
  });
  refreshUndo();
}
