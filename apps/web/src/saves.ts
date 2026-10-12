// Saved cities in the browser: one slot per city, listed in the load dialog.

import { loadCity, saveCity, type SavedCity } from '@web-city/engine';
import { icon } from './icons';
import { thumbnail } from './minimap';
import { leaveRegion } from './region';
import { city, saveSlotId, setCity, setSaveSlotId } from './state';
import { SAVE_KEY } from './storage';
import { $, ask, escapeHtml, flash, fmt, josa } from './util';

const INDEX_KEY = 'web-city:saves';
const slotKey = (id: string) => `web-city:save:${id}`;

interface Slot {
  id: string;
  name: string;
  population: number;
  year: number;
  month: number;
  savedAt: number;
  /** A minimap image of the city when saved. */
  thumb?: string;
}

function readIndex(): Slot[] {
  let list: Slot[] = [];
  try {
    list = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as Slot[];
  } catch { /* unreadable index: start a new one */ }
  // The single save of older versions becomes a slot of its own.
  try {
    const old = localStorage.getItem(SAVE_KEY);
    if (old) {
      localStorage.removeItem(SAVE_KEY);
      const slot = describe(loadCity(JSON.parse(old) as SavedCity), 'legacy', Date.now());
      localStorage.setItem(slotKey(slot.id), old);
      list = [...list.filter((s) => s.id !== slot.id), slot];
      localStorage.setItem(INDEX_KEY, JSON.stringify(list));
    }
  } catch { /* an unreadable old save is dropped */ }
  return list;
}

function describe(c: typeof city, id: string, savedAt: number): Slot {
  const st = c.stats();
  return { id, name: c.state.name, population: st.population, year: st.date.year, month: st.date.month, savedAt };
}

/**
 * Saves the open city in its own slot: the one it was loaded from or saved to
 * before (through undo and reloads too). Any other city gets a new slot, even
 * one that shares the name (every new city starts as "새 도시").
 */
/** When a save was made, in full: 2026-10-04 15:47 (the short form's two-digit year sat beside game years). */
function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** How long ago a save was made, as one says it (방금, 12분 전, 어제 21:05); older ones in full. */
function ago(ms: number, now = Date.now()): string {
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const d = new Date(ms);
  const p = (v: number) => String(v).padStart(2, '0');
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (ms >= today.getTime()) return `${Math.floor(min / 60)}시간 전`;
  if (ms >= today.getTime() - 86_400_000) return `어제 ${p(d.getHours())}:${p(d.getMinutes())}`;
  return stamp(ms);
}

/** The open city as it was when last saved to a slot or opened from one: nothing since is progress to lose. */
let savedMark: { city: typeof city; revision: number; day: number } | null = null;
const markSaved = () => (savedMark = { city, revision: city.revision, day: city.state.day });

/**
 * Whether leaving the open city loses anything: something built (time alone on a bare map loses nothing),
 * changed or played on since it was last saved or opened from the list. (Opening a city just saved asked
 * all the same whether to give up its unsaved progress.)
 */
export function unsavedProgress(): boolean {
  const s = city.state;
  const built = s.structures.size > 0 || s.buildings.size > 0 || s.zone.some((z) => z !== 0) || s.net.some((v) => v !== 0);
  return built && !(savedMark?.city === city && savedMark.revision === city.revision && savedMark.day === s.day);
}

export function saveSlot(): void {
  const list = readIndex();
  const existing = list.find((s) => s.id === saveSlotId);
  const id = existing?.id ?? Date.now().toString(36);
  try {
    localStorage.setItem(slotKey(id), JSON.stringify(saveCity(city)));
  } catch {
    flash('저장할 수 없습니다 (브라우저 저장 공간이 부족하거나 사용할 수 없음) · 파일로 내보내기를 쓰세요', 'bad');
    return;
  }
  const plain = describe(city, id, Date.now());
  const rest = list.filter((s) => s.id !== id);
  // The thumbnail is the first thing to give up when space runs short.
  const slot = [{ ...plain, thumb: thumbnail() }, plain].find((entry) => {
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify([entry, ...rest]));
      return true;
    } catch {
      return false;
    }
  });
  if (!slot) {
    try {
      if (!existing) localStorage.removeItem(slotKey(id)); // a save nobody can list
    } catch { /* storage unavailable */ }
    flash('저장 목록을 쓸 수 없습니다 (브라우저 저장 공간 부족) · 파일로 내보내기를 쓰세요', 'bad');
    return;
  }
  setSaveSlotId(id);
  markSaved();
  flash(existing ? `"${slot.name}" 저장을 새로 고쳤습니다` : `"${slot.name}"${josa(slot.name, '을', '를')} 브라우저에 저장했습니다`);
}

/** Opens the list of saved cities. */
export function showSaves(): void {
  const list = readIndex().sort((a, b) => b.savedAt - a.savedAt);
  const body = $('#saves-body');
  if (!list.length) {
    body.innerHTML = '<p class="muted">저장된 도시가 없습니다. 메뉴의 "저장"으로 지금 도시를 저장하세요.</p>';
  } else {
    body.innerHTML = `<ul class="saves">${list.map((s) => `
      <li>
        ${s.thumb ? `<img class="save-thumb" src="${s.thumb}" alt="">` : '<span class="save-thumb"></span>'}
        <div>
          <strong>${escapeHtml(s.name)}</strong>
          <span class="muted">인구 ${fmt(s.population)} · ${s.year}년 ${s.month}월 · <time datetime="${new Date(s.savedAt).toISOString()}" title="${stamp(s.savedAt)}">${ago(s.savedAt)}</time> 저장</span>
        </div>
        <button type="button" class="primary" data-load="${s.id}">열기</button>
        <button type="button" data-delete="${s.id}" aria-label="${escapeHtml(s.name)} 삭제" title="삭제">${icon('trash')}</button>
      </li>`).join('')}</ul>`;
  }
  const dialog = $<HTMLDialogElement>('#saves-dialog');
  body.querySelectorAll<HTMLButtonElement>('[data-load]').forEach((btn) => {
    btn.onclick = async () => {
      // The city on screen gives way: ask when something of it would be lost (as 새 도시 does).
      if (unsavedProgress() && !(await ask('지금 도시에서 저장하지 않은 진행은 사라집니다. 이 저장을 열까요?', '열기'))) return;
      try {
        const raw = localStorage.getItem(slotKey(btn.dataset.load!));
        if (!raw) throw new Error('missing');
        const loaded = loadCity(JSON.parse(raw) as SavedCity);
        leaveRegion();
        setCity(loaded);
        setSaveSlotId(btn.dataset.load!);
        markSaved();
        dialog.close();
        flash(`"${city.state.name}"${josa(city.state.name, '을', '를')} 불러왔습니다`);
      } catch {
        flash('불러올 수 없습니다', 'bad');
      }
    };
  });
  body.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((btn) => {
    btn.onclick = async () => {
      const slot = list.find((s) => s.id === btn.dataset.delete);
      if (!slot || !(await ask(`"${slot.name}" 저장을 지울까요?`, '지우기'))) return;
      try {
        // The list first: a save that's listed but gone is worse than one left over.
        localStorage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((s) => s.id !== slot.id)));
        localStorage.removeItem(slotKey(slot.id));
      } catch {
        flash('지울 수 없습니다 (브라우저 저장 공간을 쓸 수 없음)', 'bad');
      }
      showSaves();
    };
  });
  if (!dialog.open) dialog.showModal();
}
