// Autosave and resume (localStorage), and the keys saves live under.

import { City, loadCity, Region, saveCitySteps, type SavedCity, type SavedRegion } from '@web-city/engine';
import { region, REGION_KEY, regionPos, setRegion, setRegionPos, storeRegion } from './region';
import { city as current, saveSlotId } from './state';
import { flash } from './util';

export const SAVE_KEY = 'web-city:save';

/** Written every six game months and when the tab is hidden; picked up again on the next visit. */
export const AUTO_KEY = 'web-city:autosave';

/** The save slot the autosaved city belongs to, so saving after a reload updates it. */
const AUTO_SLOT_KEY = 'web-city:autosave-slot';

export let lastAutosave = 0;

/** Keeps the game in the browser: the region if one is open, else the city. */
export function autosave(): void {
  for (const _ of autosaveSteps());
}

/**
 * {@link autosave} in pieces (a big city's save is a few frames' work): start
 * it between days and run no day until it is done.
 */
export function* autosaveSteps(): Generator<void, void> {
  const city = current;
  // Due again in six months whether or not this one is written (a full
  // storage or an untouched map would otherwise try every frame).
  lastAutosave = Math.floor(city.state.day / 30);
  // A map nobody has touched yet (nothing built, nothing spent) isn't worth
  // resuming; it replaces whatever was saved, so a reload starts fresh.
  const s = city.state;
  const untouched = !s.structures.size && !s.net.some((v) => v !== 0) && !s.zone.some((v) => v !== 0)
    && s.funds === city.cfg.difficulty[s.difficulty].startingFunds;
  if (!region && untouched) {
    try {
      localStorage.removeItem(AUTO_KEY);
    } catch { /* storage unavailable */ }
    return;
  }
  try {
    if (region) {
      region.close(regionPos[0], regionPos[1], city);
      if (!storeRegion()) throw new Error('region not stored'); // (the pointer would lead to an older region)
      localStorage.setItem(AUTO_KEY, JSON.stringify({ regionAt: regionPos }));
    } else {
      const saved = yield* saveCitySteps(city);
      yield;
      localStorage.setItem(AUTO_KEY, JSON.stringify(saved));
    }
    if (!region && saveSlotId) localStorage.setItem(AUTO_SLOT_KEY, saveSlotId);
    else localStorage.removeItem(AUTO_SLOT_KEY);
  } catch {
    // Storage full or unavailable: keep playing, but say so once.
    if (!warned) flash('자동 저장에 실패했습니다(브라우저 저장 공간 부족). ⋯ 메뉴의 파일로 내보내기로 보관하세요.', 'bad');
    warned = true;
  }
}

let warned = false;

export function resumeAutosave(): City | null {
  try {
    const raw = localStorage.getItem(AUTO_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedCity | { regionAt: [number, number] };
    let c: City;
    if ('regionAt' in saved) {
      const r = Region.load(JSON.parse(localStorage.getItem(REGION_KEY)!) as SavedRegion);
      setRegion(r);
      setRegionPos(saved.regionAt);
      c = r.open(saved.regionAt[0], saved.regionAt[1]);
    } else c = loadCity(saved);
    setTimeout(() => flash(`자동 저장한 ${c.state.name}에서 이어 합니다 · 처음부터 하려면 '새 도시'`), 300);
    return c;
  } catch {
    setRegion(null);
    return null;
  }
}

export function setLastAutosave(v: typeof lastAutosave): void {
  lastAutosave = v;
}

/** The save slot of the city resumeAutosave brought back, if it had one. */
export function autosaveSlot(): string | null {
  try {
    return localStorage.getItem(AUTO_SLOT_KEY);
  } catch {
    return null;
  }
}
