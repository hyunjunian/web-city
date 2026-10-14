// New / save / load / export / import, and heightmap images.

import { City, type Difficulty, type Heightmap, type HistoryPoint, loadCity, saveCity, type SavedCity, Terrain } from '@web-city/engine';
import { showHelp, toggleNight } from './controls';
import { openSample } from './main';
import { autoPause, setAutoPause } from './manage';
import { ko } from './messages';
import { updatePanels } from './panels';
import { leaveRegion, region, regionPos, storeRegion } from './region';
import { cam, city, overlay, redraw, renderer, setCity } from './state';
import { saveSlot, showSaves, unsavedProgress } from './saves';
import { lastAutosave } from './storage';
import { $, ask, askText, flash, josa, touchFirst } from './util';
import { choice } from './undo';

export function setupMenu(): void {
  // The 도시 menu closes once an item is picked, or on a click elsewhere.
  const dropdown = document.querySelector<HTMLDetailsElement>('.dropdown')!;
  dropdown.querySelector('.dropdown-menu')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) dropdown.open = false;
  });
  // When the menu opens, say when the game is next saved automatically (every six game months).
  dropdown.addEventListener('toggle', () => {
    if (!dropdown.open) return;
    const m = lastAutosave + 6;
    $('#autosave-note').textContent = `다음 자동 저장: ${2000 + Math.floor(m / 12)}년 ${(m % 12) + 1}월 (탭을\u00a0떠날\u00a0때도\u00a0저장)`;
    // It rises from its button (the bar's foot, wide or on a phone): no taller than the room up to the window's top —
    // on a phone, to the top bar's foot — scrolling the rest (on a short window its first lines were off the top).
    const menu = dropdown.querySelector<HTMLElement>('.dropdown-menu')!;
    menu.style.maxHeight = '';
    const r = menu.getBoundingClientRect();
    const roof = matchMedia('(max-width: 860px)').matches ? $('#mapbar').getBoundingClientRect().bottom + 8 : 8;
    if (r.top < roof) menu.style.maxHeight = `${Math.max(160, r.bottom - roof)}px`;
  });
  document.addEventListener('pointerdown', (e) => {
    if (dropdown.open && !dropdown.contains(e.target as Node)) dropdown.open = false;
  });
  // Esc closes it, back on its button; a dialog opened from it hands focus back there too.
  dropdown.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !dropdown.open) return;
    dropdown.open = false;
    dropdown.querySelector<HTMLElement>('summary')?.focus();
    e.stopPropagation();
  });
  for (const d of document.querySelectorAll<HTMLDialogElement>('#new-dialog, #saves-dialog, #help-dialog')) {
    // (After the browser has tried, and failed, to give focus back to the hidden menu item.)
    d.addEventListener('close', () => requestAnimationFrame(() => {
      if (document.activeElement === document.body || d.contains(document.activeElement)) dropdown.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
    }));
  }
  $('#btn-help-menu').onclick = showHelp;
  // Stopping the clock when a goal comes to need action (on unless turned off; kept per browser).
  const pauseBtn = $('#btn-autopause');
  const showPause = () => {
    pauseBtn.setAttribute('aria-pressed', String(autoPause));
    pauseBtn.querySelector('.menu-label')!.textContent = `문제가 생기면 멈춤: ${autoPause ? '켬' : '끔'}`;
  };
  showPause();
  pauseBtn.onclick = () => {
    setAutoPause(!autoPause);
    showPause();
    flash(autoPause ? "어느 항목이 '조치 필요'로 바뀌면 시간을 멈춥니다" : '문제가 생겨도 시간은 그대로 흐릅니다 (알림만)');
  };
  const rename = async () => {
    const name = await askText('이름 바꾸기', '도시 이름', city.state.name);
    if (name === null) return;
    const res = choice('도시 이름', () => city.rename(name));
    if (!res.ok) flash(ko(res.message ?? ''), 'bad');
    updatePanels();
  };
  $('#city-title').onclick = rename;
  $('#btn-rename').onclick = rename;
  const hm = document.querySelector<HTMLInputElement>('#new-dialog input[name="heightmap"]')!;
  hm.onchange = async () => {
    const file = hm.files?.[0];
    $('#heightmap-name').textContent = file?.name ?? '선택 안 함';
    try {
      previewMap = file ? await readHeightmap(file) : undefined;
    } catch {
      previewMap = undefined; // (said when the city is made: 이미지를 읽을 수 없습니다)
    }
    schedulePreview(0);
  };
  $('#seed-random').onclick = () => {
    const seed = document.querySelector<HTMLInputElement>('#new-dialog input[name="seed"]')!;
    seed.value = String(1 + Math.floor(Math.random() * 99_999));
    schedulePreview(0);
  };
  // The map as it will be, redrawn as its settings change (the seed typed waits for a pause).
  $('#seed-reroll').onclick = () => $('#seed-random').click();
  const form = $('#new-dialog form');
  form.querySelector('input[name="seed"]')!.addEventListener('input', () => schedulePreview(300));
  for (const name of ['size', 'water']) form.querySelector(`[name="${name}"]`)!.addEventListener('change', () => schedulePreview(0));
  $('#btn-photo').onclick = () => {
    renderer.draw(city, cam, overlay, null, null); // without the pointer's preview or selection
    const d = city.stats().date;
    download(renderer.canvas.toDataURL('image/png'), `${fileName()}-${d.year}-${String(d.month).padStart(2, '0')}.png`);
    redraw();
  };
  $('#btn-save').onclick = () => {
    if (region) {
      region.close(regionPos[0], regionPos[1], city);
      if (storeRegion()) flash('지역(모든 도시)을 브라우저에 저장했습니다');
      return;
    }
    saveSlot();
  };
  $('#btn-load').onclick = showSaves;
  $('#btn-export').onclick = () => {
    download(new Blob([JSON.stringify(saveCity(city))], { type: 'application/json' }), `${fileName()}.json`);
    flash(`"${fileName()}.json" 파일로 내보냈습니다 · 메뉴의 파일 가져오기로 다시 엽니다`);
  };
  $('#btn-csv').onclick = () => {
    // Monthly history as CSV (UTF-8 with BOM so spreadsheet apps read Korean).
    // A point is recorded as its month ends (the date has just turned): it holds the month before.
    const cols: [string, (h: HistoryPoint) => number | string | undefined][] = [
      ['월', (h) => `${2000 + Math.floor((h.month - 1) / 12)}-${String(((h.month - 1) % 12) + 1).padStart(2, '0')}`], ['인구', (h) => h.population], ['일자리', (h) => h.jobs], ['자금', (h) => h.funds],
      ['시장 평점', (h) => h.mayorRating], ['범죄', (h) => h.crimes], ['체포', (h) => h.arrests], ['수입', (h) => h.income],
      ['지출', (h) => h.expenses], ['통근(시간)', (h) => h.commute], ['전력 수요', (h) => h.powerDemand], ['전력 공급', (h) => h.powerSupply],
      ['물 수요', (h) => h.waterDemand], ['물 공급', (h) => h.waterSupply], ['쓰레기 발생(재활용 전)', (h) => h.garbageProduced], ['쓰레기 남은 처리 여력', (h) => h.garbageCapacity],
      ['대기 오염', (h) => h.air], ['수질 오염', (h) => h.waterPollution], ['교육 지수', (h) => h.eq], ['기대 수명', (h) => h.lifeExpectancy], ['버려진 건물', (h) => h.abandoned],
    ];
    const rows = [cols.map(([k]) => k).join(','), ...city.state.history.map((h) => cols.map(([, f]) => f(h) ?? '').join(','))];
    download(new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv' }), `${fileName()}-기록.csv`);
  };
  $<HTMLInputElement>('#file-import').onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const loaded = loadCity(JSON.parse(await file.text()) as SavedCity);
      // (As every other way to open a city asks: a wrong file replaced the city and its unsaved months unasked.)
      if (unsavedProgress() && !(await ask(`지금 도시에서 저장하지 않은 진행은 사라집니다(자동 저장은 6개월마다, 저장은 ${touchFirst() ? '' : 'Ctrl+S 또는 '}⋯ 메뉴). "${loaded.state.name}" 파일을 열까요?`, '파일 열기'))) {
        (e.target as HTMLInputElement).value = '';
        return;
      }
      leaveRegion();
      setCity(loaded);
      flash(`"${loaded.state.name}"${josa(loaded.state.name, '을', '를')} 파일에서 불러왔습니다`);
    } catch {
      flash('올바른 도시 파일이 아닙니다', 'bad');
    }
    (e.target as HTMLInputElement).value = ''; // the same file again fires change
  };
  $('#btn-night').onclick = toggleNight;
  const dialog = $<HTMLDialogElement>('#new-dialog');
  $('#btn-new').onclick = () => {
    $('#seed-random').click(); // a new map unless a seed is typed in
    dialog.showModal();
    // A phone's keyboard would rise over the dialog for a name most keep. Elsewhere the name is selected, typed over as
    // the rename dialog's is ("강변" typed made "강변새 도시").
    const name = dialog.querySelector<HTMLInputElement>('input[name="name"]');
    if (touchFirst()) (document.activeElement as HTMLElement | null)?.blur();
    else if (name) {
      name.focus();
      name.select();
    }
  };
  $('#btn-help').onclick = showHelp;
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'sample' && dialog.returnValue !== 'ok') return;
    // The city on screen gives way: its progress since the last save goes with it.
    if (unsavedProgress() && !(await ask(`지금 도시에서 저장하지 않은 진행은 사라집니다(자동 저장은 6개월마다, 저장은 ${touchFirst() ? '' : 'Ctrl+S 또는 '}⋯ 메뉴). 다른 도시를 열까요?`, dialog.returnValue === 'sample' ? '예시 도시 열기' : '새 도시 만들기'))) return;
    if (dialog.returnValue === 'sample') return openSample();
    const f = new FormData(dialog.querySelector('form')!);
    const image = f.get('heightmap');
    let heightmap: Heightmap | undefined;
    if (image instanceof File && image.size > 0) {
      try {
        heightmap = await readHeightmap(image);
      } catch {
        flash('이미지를 읽을 수 없습니다', 'bad');
        return;
      }
    }
    leaveRegion();
    setCity(new City({
      name: String(f.get('name') || '새 도시'),
      size: Number(f.get('size')),
      difficulty: f.get('difficulty') as Difficulty,
      seed: Number(f.get('seed')) || 1,
      water: f.get('water') === 'on',
      heightmap,
    }));
  });
}

/** The new city's heightmap image as read for the preview (the city itself reads it again when made). */
let previewMap: Heightmap | undefined;
let previewTimer = 0;
const schedulePreview = (ms: number) => {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(drawPreview, ms);
};

/** The new map in small: water, woods and the lie of the land, in the minimap's colours (a city made just to look). */
function drawPreview(): void {
  const f = new FormData($<HTMLFormElement>('#new-dialog form'));
  const size = Number(f.get('size')) || 128;
  const s = new City({ name: '', size, difficulty: 'easy', seed: Number(f.get('seed')) || 1, water: f.get('water') === 'on', heightmap: previewMap }).state;
  const canvas = $<HTMLCanvasElement>('#new-preview');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const t = Math.min(1, s.height[i]! / 120);
    const c = s.terrain[i] === Terrain.Water ? [93, 143, 199] : s.trees[i] ? [76, 122, 78] : [207 - 40 * t, 216 - 30 * t, 184 - 50 * t];
    img.data.set([c[0]!, c[1]!, c[2]!, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
}

/** Decodes an image file to grayscale pixels (luminance) for a topographical map. */
export async function readHeightmap(file: File): Promise<Heightmap> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const rgba = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const data = new Uint8Array(bmp.width * bmp.height);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(0.299 * rgba[4 * i]! + 0.587 * rgba[4 * i + 1]! + 0.114 * rgba[4 * i + 2]!);
  bmp.close();
  return { width: canvas.width, height: canvas.height, data };
}

/** The city's name as a file name (letters and digits of any script kept). */
function fileName(): string {
  return city.state.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'city';
}

/** Saves a file: a blob or a data URL under a name (the link is attached so every browser keeps the name). */
function download(data: Blob | string, name: string): void {
  const a = document.createElement('a');
  a.href = typeof data === 'string' ? data : URL.createObjectURL(data);
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
