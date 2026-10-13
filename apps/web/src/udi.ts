// U-Drive-It: missions panel, driving, special controls.

import { type ActiveMission, type MissionDef, type MissionId, MISSIONS, PARTIAL_UNLOCKS, type StructureKind, type VehicleId, VEHICLES } from '@web-city/engine';
import { setSpeed } from './controls';
import { ko } from './messages';
import { icon } from './icons';
import { CLASS_ICON, DIFFICULTY_NAME, STRUCTURE_NAME, TRAINING_NAME } from './names';
import { pushNotice, updatePanels } from './panels';
import { cam, city, redraw, renderer, speed } from './state';
import { closeTopLayer, showTab } from './tabs';
import { closeTray } from './tools';
import { choice } from './undo';
import { toast } from './toast';
import { updatePreview } from './input';
import { MISSION_NAME_KO, VEHICLE_NAME_KO } from './udi-names';
import { $, endFlash, flash, fmt } from './util';

/** A mission being driven: vehicle position, time left, held directions. */
export let drive: { plan: ActiveMission; x: number; y: number; left: number; held: Set<string>; step: number; speedBefore: number; dir: [number, number]; ammo: number; camBefore: { x: number; y: number; scale: number }; /** the distance last told, and whether the last move took the car away */ was?: number; away?: boolean } | null = null;

export let udiSignature = '';

/** Progress towards a reward that takes several missions: "2/3회". */
const partialCount = (kind: string, got: number) => `${got}/${PARTIAL_UNLOCKS[kind as StructureKind] ?? 1}회`;

export const resultText = (r: MissionDef['success']) => [
  // (The rating moves in the blocks around where it ended: 평점 +110(32칸) left the 32 to guess.)
  r.mr ? `평점 ${r.mr > 0 ? '+' : '−'}${Math.abs(r.mr)} (반경 ${r.radius}칸)` : '', r.cash ? `${r.cash > 0 ? '+' : '−'}§${fmt(Math.abs(r.cash))}` : '',
  ...(r.unlocks ?? []).map((k) => `${STRUCTURE_NAME[k]} 해제`), r.partial ? `${STRUCTURE_NAME[r.partial]} 부분 해제` : '',
].filter(Boolean).join(' · ');

/** A mission's side, as its tag reads (선·악 alone read as nothing). */
const SIDE = { good: '선한 일', evil: '나쁜 일', neutral: '중립' } as const;

/** Training first (it opens the rest), then the good, the neutral and the bad, each easiest first (they came by code name). */
function sortMissions(ids: MissionId[]): MissionId[] {
  const side = { good: 0, neutral: 1, evil: 2 };
  const level = { easy: 0, medium: 1, hard: 2 };
  return [...ids].sort((a, b) => {
    const ma: MissionDef = MISSIONS[a];
    const mb: MissionDef = MISSIONS[b];
    return +!ma.training - +!mb.training || side[ma.alignment] - side[mb.alignment] || level[ma.difficulty] - level[mb.difficulty];
  });
}

export function renderUdi(force = false): void {
  const ids = city.availableMissions();
  const sig = `${ids.join()}|${JSON.stringify(city.state.udi)}|${drive?.plan.id}`;
  if (!force && sig === udiSignature) return;
  udiSignature = sig;
  const s = city.state;
  const vehicles = city.availableVehicles();
  const progress = Object.entries(s.udi.partial).map(([k, v]) => `${STRUCTURE_NAME[k as StructureKind]} ${city.isUnlocked(k as StructureKind) ? '해제됨' : partialCount(k, v ?? 0)}`).join(' · ');
  $('#udi').innerHTML = `
    ${vehicles.length
      // (Each with what it runs on, as the cards' tiles: a line of names ran on with commas. Words with their sign, not
      // chips, which looked pressable and did nothing.)
      ? `<p class="udi-vehicles"><span class="muted">탈것</span>${vehicles.map((v) => `<span class="udi-veh">${icon(CLASS_ICON[VEHICLES[v].class])}${VEHICLE_NAME_KO[v]}</span>`).join('<span class="udi-sep" aria-hidden="true">·</span>')}</p>`
      : '<p class="legend">탈것: 없음 — 경찰서·소방서·학교·버스 정류장 등을 지으면 생깁니다</p>'}
    ${sortMissions(ids).map((id) => {
      const m: MissionDef = MISSIONS[id];
      // A card a mission: what drives it and how hard, its side, what winning and losing do; 출발 at its end
      // (on a line of its own under each, thirteen missions ran to a long scroll).
      return `<div class="mission ${m.alignment}">
        <span class="ms-i" aria-hidden="true">${icon(CLASS_ICON[VEHICLES[m.vehicle].class])}</span>
        <div class="ms-body">
          <div class="ms-head"><b title="${m.name}">${MISSION_NAME_KO[id]}</b><span class="ms-side" title="임무의 성향 (선한 일·나쁜 일·어느 쪽도 아님)">${SIDE[m.alignment]}</span></div>
          <div class="ms-sub">${m.anyMySim ? 'My Sim 차량 아무거나' : m.training ? `${TRAINING_NAME[m.training]} 탈것 아무거나` : VEHICLE_NAME_KO[m.vehicle]} · 난이도 ${DIFFICULTY_NAME[m.difficulty]}</div>
          <dl class="ms-out"><dt class="win">성공</dt><dd>${resultText(m.success) || (m.training ? `${TRAINING_NAME[m.training]} 탈것 임무가 열립니다` : '없음')}</dd>
            <dt class="lose">실패</dt><dd>${resultText(m.failure) || '없음'}</dd></dl>
        </div>
        <button data-mission="${id}" ${drive ? 'disabled' : ''}>${icon('play')}출발</button></div>`;
    }).join('') || '<p class="muted">지금 할 수 있는 임무가 없습니다.</p>'}
    ${progress ? `<p class="legend">여러 번 해야 하는 보상: ${progress}</p>` : ''}
    <p class="legend">탈것 종류마다 운전 연습을 먼저 통과해야 그 종류의 임무가 열립니다. 출발하면 시뮬레이션이 멈추고, 방향키·WASD(또는 화면의 방향 버튼)로 노란 목표까지 시간 안에 가면 성공입니다. 차는 도로로, 열차는 선로로, 배는 물 위로, 비행기는 어디로든 갑니다.</p>`;
  $('#udi').querySelectorAll<HTMLButtonElement>('button[data-mission]').forEach((btn) => {
    btn.onclick = () => startDrive(btn.dataset.mission as MissionId);
  });
}

export function startDrive(id: MissionId): void {
  const plan = city.startMission(id);
  if (!('target' in plan)) {
    flash(ko(plan.message ?? 'mission not available'), 'bad');
    return;
  }
  const n = city.size;
  drive = { plan, x: plan.start % n, y: Math.floor(plan.start / n), left: plan.seconds, held: new Set(), step: 0, speedBefore: speed, dir: [1, 0], ammo: TANK_AMMO, camBefore: { x: cam.x, y: cam.y, scale: cam.scale } };
  $('#view').classList.add('driving'); // (the building tools wait: drawn back, out of the way of the drive)
  const special = SPECIAL[plan.vehicle];
  const btn = $<HTMLButtonElement>('#drive-special');
  btn.hidden = !special;
  if (special) btn.textContent = special.label;
  setSpeed(0);
  // Close enough to see the car and the road ahead (at 10 it was a dot of a few pixels by a wedge of an arrow).
  cam.scale = Math.max(cam.scale, 20);
  followVehicle();
  $('#drive-hud').hidden = false;
  // The road ahead needs the whole map: cards over it step aside.
  closeTray();
  while (closeTopLayer());
  renderUdi(true);
  updateDriveHud();
}

export function followVehicle(): void {
  if (!drive) return;
  const r = renderer.canvas.getBoundingClientRect();
  cam.x = drive.x + 0.5 - r.width / 2 / cam.scale;
  cam.y = drive.y + 0.5 - r.height / 2 / cam.scale;
  const n = city.size;
  renderer.drive = { x: drive.x, y: drive.y, tx: drive.plan.target % n, ty: Math.floor(drive.plan.target / n), color: MISSIONS[drive.plan.id].alignment === 'evil' ? '#e5484d' : '#3b82f6' };
  redraw();
}

export function updateDriveHud(): void {
  if (!drive) return;
  const n = city.size;
  const dx = (drive.plan.target % n) - drive.x;
  const dy = Math.floor(drive.plan.target / n) - drive.y;
  const dist = Math.abs(dx) + Math.abs(dy);
  // Going the wrong way said as it happens (the count rose from 30 to 47 with nothing to say so).
  if (drive.was !== undefined && dist !== drive.was) drive.away = dist > drive.was;
  drive.was = dist;
  // Which way the goal lies (screen y grows downward): an arrow and a compass word.
  const angle = Math.atan2(dy, dx);
  const compass = ['동', '남동', '남', '남서', '서', '북서', '북', '북동'][((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8];
  const arrow = dist ? `<span class="goal-arrow" style="transform: rotate(${angle.toFixed(2)}rad)" aria-hidden="true">➜</span> ${compass}쪽 ` : '';
  $('#drive-info').innerHTML = `<div><b>${MISSION_NAME_KO[drive.plan.id]}</b> · ${VEHICLE_NAME_KO[drive.plan.vehicle]}</div>
    <div class="time ${drive.left < 10 ? 'low' : ''}">${Math.max(0, drive.left).toFixed(1)}초</div>
    <div class="muted">${arrow}목표까지 ${dist}칸${drive.away && dist ? ' <b class="drive-away">· 멀어지는 중</b>' : ''}${drive.plan.fire !== undefined && MISSIONS[drive.plan.id].alignment === 'good' ? ' · 불 옆에서 Space로 끄세요' : ''}${drive.plan.vehicle === 'tank' ? ` · 포탄 ${drive.ammo}` : ''}</div>`;
}

/** Leaves a drive without a result (another city opened: the mission was the old city's). */
export function abandonDrive(): void {
  if (!drive) return;
  const before = drive.speedBefore;
  drive = null;
  renderer.drive = null;
  $('#drive-hud').hidden = true;
  $('#view').classList.remove('driving');
  setSpeed(before);
  updatePreview();
}

export function endDrive(success: boolean, quit = false): void {
  if (!drive) return;
  const { plan, x, y, speedBefore, camBefore } = drive;
  // Given up: back to the view it was started from (it was left wherever the car stopped).
  if (quit) Object.assign(cam, camBefore);
  drive = null;
  renderer.drive = null;
  $('#drive-hud').hidden = true;
  $('#view').classList.remove('driving');
  // Given up: no result either way (giving up spares the failure penalty).
  if (quit) {
    city.abortMission();
    const text = `${MISSION_NAME_KO[plan.id]} 포기 · 성공도 실패도 아닙니다`;
    pushNotice({ text });
    toast(text, 'info');
    setSpeed(speedBefore);
    endFlash();
    updatePreview();
    renderUdi(true);
    updatePanels();
    redraw();
    return;
  }
  const before = new Set(city.availableMissions());
  // A mission's result (cash, rating, unlocks) isn't undone with the edits before it.
  const r = choice('임무', () => city.finishMission(plan.id, success, x, y));
  const def: MissionDef = MISSIONS[plan.id];
  const partial = success ? def.success.partial : undefined;
  const opened = city.availableMissions().filter((id) => !before.has(id)).length;
  const result = [
    resultText({ mr: r.mr, radius: (success ? def.success : def.failure).radius, cash: r.cash, unlocks: r.unlocked }),
    partial && !city.isUnlocked(partial) ? `${STRUCTURE_NAME[partial]} 해제까지 ${partialCount(partial, city.state.udi.partial[partial] ?? 0)}` : '',
    opened ? `새 임무 ${opened}개` : '',
  ].filter(Boolean).join(' · ');
  const text = `${MISSION_NAME_KO[plan.id]} ${success ? '성공' : '실패'}${result ? `: ${result}` : ''}`;
  pushNotice({ text, warn: !success });
  toast(text, success ? 'good' : 'bad');
  setSpeed(speedBefore);
  endFlash(); // "운전하는 동안에는 시간이 멈춥니다" stayed up after the drive
  updatePreview(); // the hint still said the map can't be edited
  city.refreshIfDirty();
  renderUdi(true);
  updatePanels();
  redraw();
}

export const DIRS: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export const KEY_DIR: Record<string, string> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
};

/** Advances the drive by `dt` seconds: the clock, and a tile per step while a direction is held. */
export function tickDrive(dt: number): void {
  if (!drive) return;
  drive.left -= dt;
  const cls = VEHICLES[drive.plan.vehicle].class;
  const interval = cls === 'air' ? 0.07 : cls === 'rail' ? 0.06 : 0.09;
  drive.step += dt;
  while (drive.step >= interval) {
    drive.step -= interval;
    for (const dir of drive.held) {
      const [dx, dy] = DIRS[dir]!;
      if (city.canDrive(drive.plan.vehicle, drive.x + dx, drive.y + dy)) {
        drive.x += dx;
        drive.y += dy;
        drive.dir = [dx, dy];
        break;
      }
    }
  }
  followVehicle();
  updateDriveHud();
  const n = city.size;
  const tx = drive.plan.target % n;
  const ty = Math.floor(drive.plan.target / n);
  const near = cls === 'air' ? Math.max(Math.abs(drive.x - tx), Math.abs(drive.y - ty)) <= 1 : drive.x === tx && drive.y === ty;
  // Putting out a fire (spray it): won once it's out and the building stands, lost if it burns down.
  const fire = drive.plan.fire;
  if (fire !== undefined && MISSIONS[drive.plan.id].alignment === 'good') {
    const standing = fire > 0 ? city.state.buildings.has(fire) : city.state.structures.has(-fire);
    if (!standing) endDrive(false);
    else if (!city.state.fires.some((f) => f.target === fire)) endDrive(true);
    else if (drive.left <= 0) endDrive(false);
    return;
  }
  if (near) endDrive(true);
  else if (drive.left <= 0) endDrive(false);
}

/** U-Drive-It special controls that change the city (fire crew, water drop, tank cannon). */
export const TANK_AMMO = 10;

export const SPECIAL: Partial<Record<VehicleId, { label: string; action: 'spray' | 'shoot' }>> = {
  fireEngine: { label: '물 뿌리기 (Space)', action: 'spray' },
  firePlane: { label: '물 투하 (Space)', action: 'spray' },
  tank: { label: '포 쏘기 (Space)', action: 'shoot' },
};

/** Uses the vehicle's special control: water where it stands, or a shell two tiles ahead. */
export function useSpecial(): void {
  if (!drive) return;
  const special = SPECIAL[drive.plan.vehicle];
  if (!special) return;
  if (special.action === 'shoot' && drive.ammo <= 0) return flash('포탄이 떨어졌습니다', 'bad');
  const [tx, ty] = special.action === 'shoot' ? [drive.x + 2 * drive.dir[0], drive.y + 2 * drive.dir[1]] : [drive.x, drive.y];
  if (special.action === 'shoot') drive.ammo--;
  const res = city.vehicleAction(drive.plan.vehicle, special.action, tx, ty);
  if (res.ok) {
    flash(special.action === 'shoot' ? `명중! (남은 포탄 ${drive.ammo})` : `불 ${res.hits}곳을 껐습니다`);
    redraw();
  } else flash(ko(res.message ?? '') + (special.action === 'shoot' ? ` (남은 포탄 ${drive.ammo})` : ''), 'bad');
}

export function setupDriving(): void {
  window.addEventListener('keydown', (e) => {
    // A dialog over the drive (a name to type, a question) has the keys: W, A, S, D and Space are letters there.
    if (!drive || document.querySelector('dialog[open]')) return;
    if (e.key === ' ') {
      if (!e.repeat) useSpecial(); // once a press: holding Space would empty the tank in a second
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (!KEY_DIR[e.key]) return;
    drive.held.add(KEY_DIR[e.key]!);
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true });
  window.addEventListener('keyup', (e) => {
    if (drive && KEY_DIR[e.key]) drive.held.delete(KEY_DIR[e.key]!);
  });
  // Keys released while the window was elsewhere never send keyup.
  window.addEventListener('blur', () => drive?.held.clear());
  document.querySelectorAll<HTMLButtonElement>('#drive-pad button').forEach((btn) => {
    const dir = btn.dataset.dir!;
    btn.addEventListener('pointerdown', (e) => {
      drive?.held.add(dir);
      btn.setPointerCapture(e.pointerId);
    });
    const up = () => drive?.held.delete(dir);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
  });
  $('#drive-quit').onclick = () => endDrive(false, true);
  $('#drive-special').onclick = useSpecial;
}

/**
 * Missions open as the city changes (a fire station, a landfill, a population): each new
 * one is told once, with what it gives, and leads to 마이 심 where it starts. Checked once
 * a month; a city just opened announces nothing (its missions are where it starts).
 */
let missionsSeen: { city: object | null; month: number; ids: Set<MissionId> } = { city: null, month: -1, ids: new Set() };
export function watchMissions(): void {
  const month = Math.floor(city.state.day / 30);
  if (missionsSeen.city === city.state && missionsSeen.month === month) return;
  const ids = city.availableMissions();
  const fresh = missionsSeen.city === city.state ? ids.filter((id) => !missionsSeen.ids.has(id) && !(MISSIONS[id] as MissionDef).training) : [];
  missionsSeen = { city: city.state, month, ids: new Set(ids) };
  for (const id of fresh.slice(0, 2)) {
    const m: MissionDef = MISSIONS[id];
    const gives = resultText(m.success);
    const text = `새 임무: ${MISSION_NAME_KO[id]} (${VEHICLE_NAME_KO[m.vehicle]})${gives ? ` · 성공하면 ${gives}` : ''}`;
    pushNotice({ text });
    toast(text, 'info', undefined, () => showTab('sims'));
  }
}
