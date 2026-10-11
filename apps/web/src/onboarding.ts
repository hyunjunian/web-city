// The getting-started checklist for a new mayor.

import { STRUCTURES, type StructureKind } from '@web-city/engine';
import { icon } from './icons';
import { openSample } from './main';
import { region } from './region';
import { changeKey, city } from './state';
import { markSuggested, selectTool } from './tools';
import { closePane, showTab, type Tab } from './tabs';
import { $, ask, fmt, touchFirst } from './util';
import { STRUCTURE_NAME } from './names';
import { toast } from './toast';
import { type GoalId } from './goals';
import { unpoweredZones } from './readings';
import { openGoal } from './manage';
import { showOverlay } from './controls';

let shownTip = false;
export const ONBOARDING_KEY = 'web-city-onboarding-done';

/** First steps for a new mayor, ticked off from the city itself (hidden once all are done or dismissed). */
let onboardingKey = '';

export function renderOnboarding(): void {
  const el = $('#onboarding');
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch { /* storage unavailable */ }
  const key = `${changeKey()}|${dismissed}|${!!region}`;
  if (key === onboardingKey) return;
  onboardingKey = key;
  // (Put away: nothing to work out.)
  if (dismissed) {
    el.hidden = true;
    if (firstStepTool) {
      firstStepTool = null;
      markSuggested();
    }
    return;
  }
  const s = city.state;
  const st = city.stats();
  const kinds = [...s.structures.values()].map((x) => STRUCTURES[x.kind]);
  // A service counts once it can work: crews and garbage trucks need a road beside it.
  const served = [...s.structures.values()].filter((x) => city.roadBeside(x.x, x.y, x.w, x.h)).map((x) => STRUCTURES[x.kind]);
  // Built but off the road: say what's missing rather than leave the step looking undone.
  const offRoad = (k: 'fire' | 'school' | 'health' | 'police') =>
    kinds.some((d) => d[k]) && !served.some((d) => d[k]) ? ' · ⚠ 지었지만 옆에 도로가 없어 출동 못 함' : '';
  const zoned = (pred: (code: number) => boolean) => s.zone.some(pred);
  let reached: boolean | undefined;
  const landfillReached = () => (reached ??= s.zone.some((z, i) => z === 10 && city.roadBeside(i % city.size, Math.floor(i / city.size), 1, 1)));
  const darkZones = () => {
    const z = unpoweredZones();
    return z.off >= 10 && z.off >= z.all * 0.1;
  };
  const inBlack = (!!s.lastBudget && s.lastBudget.income >= s.lastBudget.expenses) || s.history.some((h) => h.income !== undefined && h.expenses !== undefined && h.income >= h.expenses && h.income > 0);
  // When a service is worth its upkeep: from about 1,000 residents, with the smallest kind's monthly cost.
  const later = (k: StructureKind) => `${st.population < 1000 ? '인구 1,000명쯤부터 · ' : ''}${STRUCTURE_NAME[k]} 월 §${fmt(STRUCTURES[k].upkeep)}`;
  const jobZone = Math.max(city.demand.demand.ID, city.demand.demand.IM, city.demand.demand.IHT) > 0 || city.demand.demand['Cs$'] <= 0 ? 'I-medium' : 'C-low';
  const d = city.demand.demand;
  const jobWant = jobZone === 'I-medium' ? Math.max(d.ID, d.IM, d.IHT) : Math.max(d['Cs$'], d['Cs$$'], d['Co$$'], d['Co$$$']);
  // [done, text, the tool that does it]
  const steps: [boolean, string, string | null][] = [
    [city.fields.connections.length > 0, '이웃 도시로 가는 도로 (맵 가장자리까지)', 'road'],
    [zoned((z) => z >= 1 && z <= 3), '주거 구역 (도로 옆에)', 'R-low'],
    // The tool for whichever kind of job is wanted (an industrial zone with only farm demand stays empty).
    // (Which of the two the button picks, said: the step read as either.)
    [zoned((z) => z >= 4 && z <= 8), `상업·산업 구역 (일자리)${jobWant > 0 ? ` · 지금은 ${jobZone === 'I-medium' ? '산업' : '상업'} 수요가 큼` : ''}`, jobZone],
    // Done when the zones have power, not when a plant stands (one across a road from them powered nothing).
    [kinds.some((d) => d.plant) && !darkZones(), `발전소 (도로 옆, 구역에서 4칸 안 · 석탄·석유는 주거에서 멀리)${kinds.some((d) => d.plant) && darkZones() ? ` · ⚠ 전기 없는 구역 ${fmt(unpoweredZones().off)}칸: 송전선으로 이으세요` : ''}`, 'goal:power'],
    // A young town's monthly fire nearly always picks the plant, and a burned plant explodes.
    [served.some((d) => d.fire), '소방서 (발전소가 반경 안에 — 불타면 폭발합니다)' + offRoad('fire'), 'goal:fire'],
    [st.population > 0, zoned((z) => z >= 1 && z <= 3) && city.state.day > 60 ? '첫 주민 입주 · 안 들어오면 개발 막힘 보기로 원인 확인' : '첫 주민 입주 (시간이 멈춰 있으면 위쪽 ▶)', zoned((z) => z >= 1 && z <= 3) ? 'view:growth' : null],
    // Spending runs ahead of a young town's taxes: the step that keeps the books in the black.
    // (Always listed, so the count doesn't change under the player; ticked by a month in the black.)
    // (Ticked once a month closes in the black: it doesn't flip back and forth with the months.)
    // (With years of money in hand the deficit is a young town's roads before its taxes: no hurry, it says so.)
    [inBlack, inBlack || !s.lastBudget ? '재정 흑자 유지 (첫 결산부터)' : deficitStep(s.lastBudget.expenses - s.lastBudget.income, s.funds), 'goal:finance'],
    // Garbage piles up from the first month (the rating falls with it), so the landfill comes early.
    // (A landfill counts once trucks can reach it: a road beside one of its tiles.)
    [landfillReached() || kinds.some((d) => d.incinerator),
      `매립지 구역 (도로 옆에 · 쓰레기는 첫 달부터 쌓입니다)${zoned((z) => z === 10) && !landfillReached() ? ' · ⚠ 도로와 닿지 않음' : ''}`, 'goal:garbage'],
    [st.water.supply > 0 && city.state.pipe.some((v) => v > 0), '양수 펌프와 수도관 (부유층과 큰 건물에 필요)', 'goal:water'],
    // Services cost every month: a town of a few hundred can't carry them yet (following the list went bankrupt).
    [served.some((d) => d.school), `학교 — ${later('elementarySchool')}` + offRoad('school'), 'goal:education'],
    [served.some((d) => d.health), `병원 — ${later('medicalClinic')}` + offRoad('health'), 'goal:health'],
    [served.some((d) => d.police), `경찰서 — ${later('smallPoliceStation')}` + offRoad('police'), 'goal:police'],
    [kinds.some((d) => d.category === 'park'), '공원 (주거 상한 완화)', 'park'],
  ];
  const done = steps.filter(([ok]) => ok).length;
  el.hidden = dismissed || done === steps.length;
  // On a town not yet founded, the first step's tool: the dock dots its category (where to start, on the map's side too).
  const first = steps.find(([ok]) => !ok)?.[2];
  const was = firstStepTool;
  firstStepTool = !el.hidden && !city.established() && first && !first.includes(':') ? first : null;
  if (firstStepTool !== was) markSuggested();
  // Before anyone lives here the gauges all read 0: the checklist leads the pane instead.
  $('#pane').classList.toggle('fresh', st.population === 0);
  // (In the document too, so Tab meets it first, as the eye does.)
  const status = $('#status');
  // (Above the city's state until it is done: below the watch list it dropped out of sight just as the later steps came up.)
  if (el.nextElementSibling !== status) status.before(el);
  if (el.hidden) return;
  const fresh = !city.established();
  const sig = steps.map(([ok, text, tool]) => `${+ok}${tool ?? ''}${text}`).join('|') + (region ? 'r' : '') + (fresh ? 'f' : '');
  if (el.dataset.sig === sig) return;
  // Phones: the checklist sits in the city pane, so its dock button gets a dot until opened.
  if (!el.dataset.sig && !$('#app').classList.contains('pane-open')) document.querySelector('.dock-city')?.classList.add('unread');
  el.dataset.sig = sig;
  // The next three steps; the rest fold away (the whole list pushed the RCI meter off the pane).
  const todo = steps.filter(([ok]) => !ok);
  // A row per step: done ones ticked, the rest pick the tool that does them.
  // (The first step to do stands out on a bare map; once anything is built the next-step card below says what
  // comes first, and two highlights disagreed.)
  const row = ([ok, text, tool]: (typeof steps)[number], i = -1) => {
    const body = `<span class="step-dot">${ok ? icon('check') : ''}</span><span class="step-text">${text}</span>`;
    return `<li class="${ok ? 'done' : i === 0 && fresh ? 'next' : ''}">${!ok && tool
      ? `<button type="button" class="step" data-step-tool="${tool}" title="${tool.startsWith('goal:') ? '관리 화면 열기 (지도 보기·지을 곳·추천 시설)' : tool.startsWith('view:') ? '지도 보기 켜기' : '이 도구 고르기'}">${body}${icon('chevronRight', 'step-go')}</button>`
      : `<div class="step">${body}</div>`}</li>`;
  };
  // In a region the sample would replace this square's city: no offer there.
  $('#onboarding-steps').innerHTML = `${st.population === 0 && !region ? `<div class="sample"><button id="onboarding-sample" title="길·구역·공공시설을 갖춘 도시를 9개월 키워 지금의 빈 도시 대신 엽니다">${icon('play')}예시 도시 둘러보기</button></div>` : ''}
    ${done ? `<details class="steps-done"><summary>${icon('check')}${done}개 완료</summary><ol class="steps">${steps.filter(([ok]) => ok).map((t) => row(t)).join('')}</ol></details>` : ''}
    <ol class="steps">${todo.slice(0, 3).map((t, i) => row(t, i)).join('')}</ol>
    ${todo.length > 3 ? `<details class="steps-later"><summary>그다음 ${todo.length - 3}개</summary><ol class="steps">${todo.slice(3).map((t) => row(t)).join('')}</ol></details>` : ''}
    ${fresh ? `<p class="legend">처음 짓기 전에는 <button type="button" class="link" data-step-tool="raise" title="높이기·낮추기·물 파기·메우기: 도로·구역·시설을 하나라도 지으면 칸당 돈이 듭니다">지형 편집</button>이 무료입니다.</p>` : `<p class="legend">건물이 안 들어서면 <button type="button" class="link advice-view" data-overlay="growth">개발 막힘 보기${touchFirst() ? '' : ' (G)'}</button>로 무엇이 막는지 확인하세요.</p>`}
    <p class="legend step-foot"><span class="step-progress" role="img" aria-label="${done}/${steps.length} 완료"><i style="width:${((done / steps.length) * 100).toFixed(1)}%"></i></span><span>${done}/${steps.length} 완료</span><button id="onboarding-hide" class="link">그만 보기</button></p>`;
  // A step's text picks the tool that does it.
  $('#onboarding-steps').querySelectorAll<HTMLButtonElement>('[data-step-tool]').forEach((b) => (b.onclick = () => {
    const step = b.dataset.stepTool!;
    // A service's step opens its goal's screen: the view, the spot it's missing from, the kind to build.
    if (step.startsWith('goal:')) {
      openGoal(step.slice(5) as GoalId);
      return;
    }
    if (step.startsWith('view:')) {
      showOverlay(step.slice(5));
      closePane();
      return;
    }
    // The tool alone, the map left clear to build on; the chip on the map opens its kinds.
    if (step.startsWith('sheet:')) {
      showTab(step.slice(6) as Tab);
      return;
    }
    selectTool(b.dataset.stepTool!);
    // (Said once: the bar under the map repeats the tool's own reading, and two banners covered the drag.)
    const tipShown = shownTip;
    shownTip = true;
    closePane(); // phones: the pane holding the checklist steps aside for the map
    // (On a touch screen it replaces the one-finger tip selectTool just gave, so it says it too.)
    // A toast, not the hint: the hint is where the tool's own reading (cost, ⚠ no road) must show at once.
    if (!tipShown) toast(touchFirst() ? '한 손가락으로 끌어 지으세요 · 지도 이동은 두 손가락. 다른 종류는 지도 위 도구 이름을 눌러 고릅니다.' : '지도에서 바로 지으세요. 다른 종류는 지도 위 도구 이름을 눌러 고릅니다.', 'info');
  }));
  const sample = document.querySelector<HTMLButtonElement>('#onboarding-sample');
  if (sample) sample.onclick = async () => {
    // Something built is lost without a save (as the menu's way to the sample asks).
    const s = city.state;
    const played = s.structures.size > 0 || s.buildings.size > 0 || s.zone.some((z) => z !== 0) || s.net.some((v) => v !== 0);
    if (played && !(await ask('지금 도시에서 저장하지 않은 진행은 사라집니다. 예시 도시를 열까요?', '예시 도시 열기'))) return;
    openSample();
  };
  $('#onboarding-hide').onclick = async () => {
    if (!(await ask('시작하기 목록을 숨길까요? 다시 볼 수 없습니다.', '숨기기'))) return;
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch { /* storage unavailable */ }
    el.hidden = true;
  };
}

/** The checklist's deficit step: to be closed soon, or (years of money left) as the town grows. */
function deficitStep(deficit: number, funds: number): string {
  const years = deficit > 0 ? Math.floor(funds / deficit / 12) : 0;
  return years >= 5
    ? `재정 흑자 만들기 (지난달 −§${fmt(deficit)} · 자금은 ${years >= 100 ? '100년' : `${years}년`} 넘게 버팀: 주민이 늘면 세금이 메웁니다)`
    : `재정 적자 메우기 (지난달 −§${fmt(deficit)}: 세율·부서 예산)`;
}

/** The tool of the checklist's first open step on an unfounded town (null otherwise). */
export let firstStepTool: string | null = null;
