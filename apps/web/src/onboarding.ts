// The getting-started checklist for a new mayor.

import { STRUCTURES, type StructureKind, type ZoneKind } from '@web-city/engine';
import { icon } from './icons';
import { openSample } from './main';
import { region } from './region';
import { changeKey, city, cityLineage } from './state';
import { markSuggested, panTipAt, selectTool } from './tools';
import { closePane, paneShown, showTab, type Tab } from './tabs';
import { $, ask, escapeHtml, flash, fmt, touchFirst } from './util';
import { EDGE_NAME, STRUCTURE_NAME } from './names';
import { dropToasts, toast } from './toast';
import { GOALS, type GoalId } from './goals';
import { cheapestOf, cityEdges, citySides, edgeRoad, fillSpan, landfillSite, layCost, lineToDark, plantSite, powerToSpare, roadLinked, siteNear, siteOnPipes, suggestSpot, unpoweredZones, smokeClear, zoneSite } from './readings';
import { bestBuild, buildAtSite, layPath, layZone, openGoal } from './manage';
import { updatePanels } from './panels';
import { showOverlay } from './controls';
import { unsavedProgress } from './saves';

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
  // (And the funds: a loan taken while paused moves neither the week nor the revision, and the one-press links waited
  // on the next edit to show.)
  const key = `${changeKey()}|${dismissed}|${!!region}|${Math.floor(city.state.funds / 10)}`;
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
  const pumps = [...s.structures.values()].filter((x) => STRUCTURES[x.kind].pump);
  const watered = st.water.supply > 0 && [...s.buildings.values()].some((b) => b.watered);
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
  // A zone counts once one of its tiles touches a road (a block painted off the roads was ticked as done, and nothing
  // ever grew on it).
  const n = city.size;
  const zonedByRoad = (pred: (code: number) => boolean) => s.zone.some((z, i) => pred(z) && city.roadBeside(i % n, Math.floor(i / n), 1, 1));
  const homeZone = (z: number) => z >= 1 && z <= 3;
  const jobZoneCode = (z: number) => z >= 4 && z <= 8;
  const offRoadZone = (pred: (code: number) => boolean) => (zoned(pred) && !zonedByRoad(pred) ? ' · ⚠ 도로와 닿지 않음' : '');
  // Homes all built with people wanting in: growth waits on more homes (the list sat at 216 residents for years,
  // pointing at the books, which only residents could mend).
  let emptyHomes = 0;
  for (let i = 0; i < s.zone.length && emptyHomes < 4; i++) if (homeZone(s.zone[i]!) && !s.occupant[i]) emptyHomes++;
  const homesFull = st.population > 0 && emptyHomes < 4 && Math.max(d['R$'], d['R$$'], d['R$$$']) > 0;
  // A deficit with years of money in hand mends as residents come: last in the list, and never "다음은".
  const deficit = s.lastBudget ? s.lastBudget.expenses - s.lastBudget.income : 0;
  const patient = deficit > 0 && s.funds / deficit / 12 >= 5;
  // [done, text, the tool that does it, (put after the rest: it waits on growth)]
  const steps: [boolean, string, string | null, boolean?][] = [
    // (In a region, the side with the city named: a road to an empty side joined nobody. And where a city lies across
    // only part of it — a small one beside a big map — that part: a road reaching the rest joined nobody either.)
    [roadLinked(), ((sides, edges) => {
      const part = (e: number) => !!edges?.some(([side, a, b]) => side === e && (a > 0 || b < s.size));
      const where = (some: boolean) => (some ? '가장자리의 이웃과 맞닿은 곳까지' : '가장자리까지');
      return !sides ? `이웃 도시로 가는 도로 (지도 ${where(!!edges)})`
        : sides.length === 1 ? `${EDGE_NAME[sides[0]!]} 이웃 도시(${s.neighbours[sides[0]!]!.name})로 가는 도로 (그쪽 ${where(part(sides[0]!))})`
        : `이웃 도시로 가는 도로 (${sides.map((e) => EDGE_NAME[e]).join('·')} ${where(sides.some(part))})`;
    })(citySides(), cityEdges()), 'road'],
    [zonedByRoad(homeZone), `주거 구역 (도로 옆에)${offRoadZone(homeZone)}`, 'R-low'],
    // The tool for whichever kind of job is wanted (an industrial zone with only farm demand stays empty).
    // (Which of the two the button picks, said: the step read as either.)
    [zonedByRoad(jobZoneCode), `상업·산업 구역 (일자리)${jobWant > 0 ? ` · 지금은 ${jobZone === 'I-medium' ? '산업' : '상업'} 수요가 큼` : ''}${offRoadZone(jobZoneCode)}`, jobZone],
    // Done when the zones have power, not when a plant stands (one across a road from them powered nothing).
    [kinds.some((d) => d.plant) && !darkZones(), `발전소 (도로 옆, 구역에서 4칸 안 · 석탄·석유는 주거에서 ${smokeClear('coalPlant')}칸 넘게)${kinds.some((d) => d.plant) && darkZones() ? ` · ⚠ 전기 없는 구역 ${fmt(unpoweredZones().off)}칸: 송전선으로 이으세요` : ''}`, 'goal:power'],
    // A young town's monthly fire nearly always picks the plant, and a burned plant explodes.
    [served.some((d) => d.fire), '소방서 (발전소가 반경 안에 — 불타면 폭발합니다)' + offRoad('fire'), 'goal:fire'],
    // The first residents, then the town to a thousand (where the services start to be worth their upkeep), with more
    // homes once those there are all built.
    st.population === 0
      ? [false, zoned(homeZone) && city.state.day > 60 ? '첫 주민 입주 · 안 들어오면 개발 막힘 보기로 원인 확인' : '첫 주민 입주 (시간이 멈춰 있으면 위쪽 ▶)', zoned(homeZone) ? 'view:growth' : null]
      : [st.population >= 1000, `주민 1,000명 (지금 ${fmt(st.population)}명)${homesFull ? ' · 주거 구역이 다 찼습니다: 더 칠하면 늘어납니다' : ''}`, homesFull ? 'R-low' : 'view:growth'],
    // Spending runs ahead of a young town's taxes: the step that keeps the books in the black.
    // (Always listed, so the count doesn't change under the player; ticked by a month in the black.)
    // (Ticked once a month closes in the black: it doesn't flip back and forth with the months.)
    // (With years of money in hand the deficit is a young town's roads before its taxes: no hurry, it says so.)
    [inBlack, inBlack || !s.lastBudget ? '재정 흑자 유지 (첫 결산부터)' : deficitStep(s.lastBudget.expenses - s.lastBudget.income, s.funds), 'goal:finance', !inBlack && patient],
    // Garbage piles up from the first month (the rating falls with it), so the landfill comes early.
    // (A landfill counts once trucks can reach it: a road beside one of its tiles.)
    [landfillReached() || kinds.some((d) => d.incinerator),
      `매립지 구역 (도로 옆에 · 쓰레기는 첫 달부터 쌓입니다)${zoned((z) => z === 10) && !landfillReached() ? ' · ⚠ 도로와 닿지 않음' : ''}`, 'goal:garbage'],
    // (Ticked once water reaches buildings: a tower waters what is near it with no pipe, and the step that also asked
    // for a pipe stayed open under a 수도 screen reading 양호.)
    // (By a building watered, not the supply: with nothing wanting water anywhere, a tower's idle output counts as supply.)
    [watered, `급수 시설 (양수 펌프·급수탑 · 부유층과 큰 건물에 필요)${watered || !pumps.length ? ''
      : pumps.some((p) => p.powered) ? ' · ⚠ 물이 닿는 건물 없음: 수도관으로 이으세요' : ' · ⚠ 전기 없음: 송전선으로 이으세요'}`, 'goal:water'],
    // Services cost every month: a town of a few hundred can't carry them yet (following the list went bankrupt).
    [served.some((d) => d.school), `학교 — ${later('elementarySchool')}` + offRoad('school'), 'goal:education'],
    [served.some((d) => d.health), `병원 — ${later('medicalClinic')}` + offRoad('health'), 'goal:health'],
    [served.some((d) => d.police), `경찰서 — ${later('smallPoliceStation')}` + offRoad('police'), 'goal:police'],
    [kinds.some((d) => d.category === 'park'), '공원 (주거 상한 완화)', 'park'],
  ];
  const done = steps.filter(([ok]) => ok).length;
  cheer(steps);
  // Done once, put away for this city: a plant pulled down later is for 도시 상태 to flag in red, not for the
  // whole list to come back over the city at 12/13.
  if (done === steps.length) doneLineage = cityLineage;
  el.hidden = dismissed || done === steps.length || doneLineage === cityLineage;
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
  // (The road to the neighbours, laid in one press from the first step: its route and price.)
  const way = steps[0] && !steps[0][0] ? edgeRoad('road') : null;
  // (And the zone steps' blocks, where the guide's 추천 자리 would put them: by the road, homes and factories apart.)
  // (The residents' step too, once the homes there are full: one more block of them.)
  const blocks = new Map([...steps.slice(1, 3), steps[5]!].flatMap(([ok, , tool]) => {
    const at = !ok && (tool === 'R-low' || tool === 'C-low' || tool === 'I-medium') ? zoneSite(tool) : null;
    const cost = at ? city.previewZone(at.x0, at.y0, at.x1, at.y1, tool as ZoneKind).cost : 0;
    return at && cost <= s.funds ? [[tool!, { ...at, cost }] as const] : [];
  }));
  // (And before any plant, the one the power screen recommends, where its 추천 자리에 짓기 would put it. Then a plant's
  // zones left in the dark: the guide's shortest line to them, with power to spare for them.)
  const plant = steps[3] && !steps[3][0] && !kinds.some((d) => d.plant) ? plantStepSite() : null;
  const wire0 = steps[3] && !steps[3][0] && kinds.some((d) => d.plant) && powerToSpare() ? lineToDark() : null;
  const wireCost = wire0 ? layCost('powerline', wire0) : null;
  const wire = wire0 && wireCost !== null && wireCost <= s.funds ? { path: wire0, cost: wireCost } : null;
  // (And the fire station the fire screen would put up, where its mark is: by a plant out of reach first.)
  // (Not beside one already built off the road: the fire screen lays it its road instead.)
  const station = steps[4] && !steps[4][0] && !kinds.some((d) => d.fire) ? fireSite() : null;
  // (And the pump or tower the water screen would put up, by the buildings going without: the one service step
  // that only opened its screen.)
  const tower = steps[8] && !steps[8][0] && !pumps.length ? waterSite() : null;
  // (And the landfill the garbage screen would lay: sized to the rubbish, by a road, clear of homes and shops.)
  // (Once there are homes or shops to keep it from: before them it went where the first homes would.)
  const fill0 = steps[7] && !steps[7][0] && !zoned((z) => z === 10) && zoned((z) => z >= 1 && z <= 6) ? landfillSite() : null;
  const fill = fill0 && fill0.cost <= s.funds ? fill0 : null;
  const sig = steps.map(([ok, text, tool]) => `${+ok}${tool ?? ''}${text}`).join('|') + (region ? 'r' : '') + (fresh ? 'f' : '') + (way ? `w${way.path[0]}${way.cost}${+way.short}` : '')
    + [...blocks].map(([k, b]) => `${k}${b.x0},${b.y0},${b.side}${b.cost}`).join('') + (wire ? `p${wire.path[0]}${wire.path.length}${wire.cost}` : '')
    + (plant ? `g${plant.kind}${plant.at.join(',')}` : '')
    + (station ? `s${station.kind}${station.at.join(',')}` : '') + (tower ? `t${tower.kind}${tower.at.join(',')}` : '') + (fill ? `l${fill.x0},${fill.y0},${fill.side}${fillSpan(fill.months)}` : '');
  if (el.dataset.sig === sig) return;
  // Phones: the checklist sits in the city pane, so its dock button gets a dot until opened.
  if (!el.dataset.sig && !paneShown()) document.querySelector('.dock-city')?.classList.add('unread');
  el.dataset.sig = sig;
  // The next three steps; the rest fold away (the whole list pushed the RCI meter off the pane). One that waits on growth
  // goes last.
  const todo = [...steps.filter(([ok, , , last]) => !ok && !last), ...steps.filter(([ok, , , last]) => !ok && last)];
  // A row per step: done ones ticked, the rest pick the tool that does them.
  // (The first step to do stands out until the first residents come: from then the city's state below leads the
  // pane. It went out with the first road, and nothing said what came next.)
  const row = ([ok, text, tool]: (typeof steps)[number], i = -1) => {
    // (Plain words, escaped where they are drawn: a neighbour city's name, which a player gives, is among them.)
    const body = `<span class="step-dot">${ok ? icon('check') : ''}</span><span class="step-text">${escapeHtml(text)}</span>`;
    // (The first road: drawn along the dashed route the tool shows, or laid at once. The first zones likewise.)
    const block = !ok && tool ? blocks.get(tool) : undefined;
    const lay = !ok && tool === 'road' && way && !way.short
      ? `<button type="button" class="link step-lay" data-lay="road" title="지도 가장자리까지 가장 싼 곧은 길을 바로 놓기 (도로를 들면 지도에 점선으로 보이는 그 길 · Ctrl+Z로 되돌리기)">추천 길 바로 놓기 · ${fmt(way.path.length)}칸 §${fmt(way.cost)}</button>`
      : block ? `<button type="button" class="link step-lay" data-lay="${tool}" title="도로에 닿는 빈 땅에 바로 놓기${tool === 'I-medium' ? ' (주거에서 떨어진 곳)' : tool === 'C-low' ? ' (주거 가까이)' : ''} · Ctrl+Z로 되돌리기">추천 자리에 ${tool === 'I-medium' ? '산업' : tool === 'C-low' ? '상업' : '주거'} ${block.side}×${block.side} 바로 놓기 · §${fmt(block.cost)}</button>`
      : !ok && tool === 'goal:power' && plant ? `<button type="button" class="link step-lay" data-lay="plant" title="전력 화면이 권하는 발전소를 전기 없는 구역 가까이 도로 옆(연기가 주거에 닿지 않는 곳)에 바로 짓기 · 월 §${fmt(STRUCTURES[plant.kind].upkeep)} · Ctrl+Z로 되돌리기">추천 자리에 ${STRUCTURE_NAME[plant.kind]} 바로 짓기 · §${fmt(STRUCTURES[plant.kind].cost)}</button>`
      : !ok && tool === 'goal:power' && wire ? `<button type="button" class="link step-lay" data-lay="powerline" title="전력망에서 전기 없는 가장 가까운 구역까지 가장 짧은 송전선을 바로 잇기 (송전선을 들면 지도에 보이는 그 길 · Ctrl+Z로 되돌리기)">송전선 ${fmt(wire.path.length)}칸 바로 잇기 · §${fmt(wire.cost)}</button>`
      : !ok && tool === 'goal:garbage' && fill ? `<button type="button" class="link step-lay" data-lay="landfill" title="${fillSpan(fill.months) ? `${fillSpan(fill.months)}의 쓰레기를 묻을 크기로, ` : ''}도로에 닿고 주거·상업에서 떨어진 빈 땅에 바로 놓기 · 월 §${fmt(fill.side * fill.side * city.cfg.garbage.landfill.upkeep)} · Ctrl+Z로 되돌리기">추천 자리에 매립지 ${fill.side}×${fill.side} 바로 놓기 · §${fmt(fill.cost)}</button>`
      : !ok && tool === 'goal:water' && tower ? `<button type="button" class="link step-lay" data-lay="water" title="수도 화면의 과녁 자리(물 없는 건물이 모인 곳 가까이 도로 옆)에 바로 짓기 · 월 §${fmt(STRUCTURES[tower.kind].upkeep)} · Ctrl+Z로 되돌리기">추천 자리에 ${STRUCTURE_NAME[tower.kind]} 바로 짓기 · §${fmt(STRUCTURES[tower.kind].cost)}</button>`
      : !ok && tool === 'goal:fire' && station ? `<button type="button" class="link step-lay" data-lay="fire" title="소방 화면의 과녁 자리(소방이 닿지 않는 발전소·건물 가까이 도로 옆)에 바로 짓기 · Ctrl+Z로 되돌리기">추천 자리에 ${STRUCTURE_NAME[station.kind]} 바로 짓기 · §${fmt(STRUCTURES[station.kind].cost)}</button>` : '';
    return `<li class="${ok ? 'done' : i === 0 && st.population === 0 ? 'next' : ''}">${!ok && tool
      ? `<button type="button" class="step" data-step-tool="${tool}" title="${tool.startsWith('goal:') ? '관리 화면 열기 (지도 보기·지을 곳·추천 시설)' : tool.startsWith('view:') ? '지도 보기 켜기' : '이 도구 고르기'}">${body}${icon('chevronRight', 'step-go')}</button>`
      : `<div class="step">${body}</div>`}${lay}</li>`;
  };
  // In a region the sample would replace this square's city: no offer there.
  $('#onboarding-steps').innerHTML = `${st.population === 0 && !region ? `<div class="sample"><button id="onboarding-sample" title="길·구역·공공시설을 갖춘 도시를 9개월 키워 지금의 빈 도시 대신 엽니다">${icon('play')}예시 도시 둘러보기</button></div>` : ''}
    ${done ? `<details class="steps-done"><summary>${icon('check')}${done}개 완료</summary><ol class="steps">${steps.filter(([ok]) => ok).map((t) => row(t)).join('')}</ol></details>` : ''}
    <ol class="steps">${todo.slice(0, 3).map((t, i) => row(t, i)).join('')}</ol>
    ${todo.length > 3 ? `<details class="steps-later"><summary>그다음 ${todo.length - 3}개</summary><ol class="steps">${todo.slice(3).map((t) => row(t)).join('')}</ol></details>` : ''}
    ${fresh ? `<p class="legend">처음 짓기 전에는 <button type="button" class="link" data-step-tool="raise" title="높이기·낮추기·물 파기·메우기: 도로·구역·시설을 하나라도 지으면 칸당 돈이 듭니다">지형 편집</button>이 무료입니다.</p>` : `<p class="legend">건물이 안 들어서면 <button type="button" class="link advice-view" data-overlay="growth">개발 막힘 보기${touchFirst() ? '' : ' (G)'}</button>로 무엇이 막는지 확인하세요.</p>`}
    <p class="legend step-foot"><span class="step-progress" role="img" aria-label="${done}/${steps.length} 완료"><i style="width:${((done / steps.length) * 100).toFixed(1)}%"></i></span><span>${done}/${steps.length} 완료</span><button id="onboarding-hide" class="link">그만 보기</button></p>`;
  // A step's text picks the tool that does it.
  $('#onboarding-steps').querySelectorAll<HTMLButtonElement>('[data-step-tool]').forEach((b) => (b.onclick = () => takeStep(b.dataset.stepTool!)));
  // (Found again on the press: the town may have changed since the list was drawn.)
  $('#onboarding-steps').querySelectorAll<HTMLButtonElement>('.step-lay').forEach((b) => (b.onclick = () => {
    const kind = b.dataset.lay!;
    // (Nothing found any more — a month turned, the land taken — said, not a press that did nothing; and where the
    // step goes from there: a tool for the road and the zones, the screen for the rest.)
    const gone = () => {
      flash(`그사이 자리가 없어졌습니다 · 단계를 눌러 ${kind === 'road' || kind.includes('-') ? '도구로 놓으세요' : '관리 화면에서 고르세요'}`, 'bad');
      onboardingKey = ''; // (drawn again: the link goes)
      updatePanels();
    };
    if (kind === 'landfill') {
      const now = landfillSite();
      if (!now) return gone();
      layZone('landfill', now.x0, now.y0, now.x1, now.y1);
      return;
    }
    if (kind === 'fire') {
      // (Short of money since it was drawn: said as that.)
      const k = cheapestOf(GOALS.fire);
      if (k && STRUCTURES[k].cost > city.state.funds) return flash(`§${fmt(Math.ceil(STRUCTURES[k].cost - city.state.funds))} 모자랍니다`, 'bad');
      const now = fireSite();
      if (!now) return gone();
      buildAtSite(now.kind, now.at[0], now.at[1]);
      return;
    }
    if (kind === 'water') {
      const now = waterSite();
      if (!now) return gone();
      buildAtSite(now.kind, now.at[0], now.at[1]);
      return;
    }
    if (kind === 'plant') {
      const now = plantStepSite(true);
      if (now && STRUCTURES[now.kind].cost > city.state.funds) return flash(`§${fmt(Math.ceil(STRUCTURES[now.kind].cost - city.state.funds))} 모자랍니다`, 'bad');
      if (!now) return gone();
      buildAtSite(now.kind, now.at[0], now.at[1]);
      return;
    }
    if (kind === 'powerline') {
      const now = lineToDark();
      if (!now) return gone();
      if (layPath('powerline', now, null)) {
        closePane();
        updatePanels();
      }
      return;
    }
    if (kind !== 'road') {
      const at = zoneSite(kind as 'R-low' | 'C-low' | 'I-medium');
      if (!at) return gone();
      layZone(kind as ZoneKind, at.x0, at.y0, at.x1, at.y1);
      return;
    }
    const now = edgeRoad('road');
    if (!now) return gone();
    if (!layPath('road', now.path, null)) return;
    closePane(); // phones: the road laid, seen
    updatePanels();
  }));
  const sample = document.querySelector<HTMLButtonElement>('#onboarding-sample');
  if (sample) sample.onclick = async () => {
    // Something built is lost without a save (as the menu's way to the sample asks).
    if (unsavedProgress() && !(await ask('지금 도시에서 저장하지 않은 진행은 사라집니다. 예시 도시를 열까요?', '예시 도시 열기'))) return;
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

/** The plant the power screen recommends first and where its 추천 자리에 짓기 would put it — by the zones in the dark,
 *  a smoky plant's smoke clear of the homes — with the money for it (or, `any`, without: said as short on the press). */
function plantStepSite(any = false): { kind: StructureKind; at: [number, number] } | null {
  const kind = bestBuild('power');
  if (!kind || !STRUCTURES[kind].plant || !city.isUnlocked(kind) || city.placementsLeft(kind) <= 0 || (!any && STRUCTURES[kind].cost > city.state.funds)) return null;
  const spot = suggestSpot('power');
  const at = spot ? siteNear(kind, spot.x, spot.y, 0) ?? siteNear(kind, spot.x, spot.y, 6) ?? plantSite(kind, spot.x, spot.y) : plantSite(kind);
  return at ? { kind, at } : null;
}

/** The pump or tower the water screen recommends and where its 추천 자리에 짓기 would put it (by the buildings going without), with the money for it. */
function waterSite(): { kind: StructureKind; at: [number, number] } | null {
  const kind = bestBuild('water');
  if (!kind || !STRUCTURES[kind].pump || !city.isUnlocked(kind) || city.placementsLeft(kind) <= 0 || STRUCTURES[kind].cost > city.state.funds) return null;
  const spot = suggestSpot('water');
  const at = (spot ? siteNear(kind, spot.x, spot.y, 0) ?? siteNear(kind, spot.x, spot.y, 6) : null) ?? siteOnPipes(kind);
  return at ? { kind, at } : null;
}

/** The cheapest fire station and where the fire screen's 추천 자리에 짓기 would put it (at its mark), with the money for it. */
function fireSite(): { kind: StructureKind; at: [number, number] } | null {
  const kind = cheapestOf(GOALS.fire);
  if (!kind || !city.isUnlocked(kind) || city.placementsLeft(kind) <= 0 || STRUCTURES[kind].cost > city.state.funds) return null;
  const spot = suggestSpot('fire');
  const at = spot && !spot.crowded ? siteNear(kind, spot.x, spot.y, 0) ?? siteNear(kind, spot.x, spot.y, 6) : null;
  return at ? { kind, at } : null;
}

/** Does a step: a service's opens its goal's screen, a view comes on, else its tool is picked (the map left clear). */
function takeStep(step: string): void {
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
  selectTool(step);
  // (Said once: the bar under the map repeats the tool's own reading, and two banners covered the drag.)
  const tipShown = shownTip;
  shownTip = true;
  closePane(); // phones: the pane holding the checklist steps aside for the map
  // A toast, not the hint: the hint is where the tool's own reading (cost, ⚠ no road) must show at once.
  // (Not the one-finger tip again when the bar under the map has just said it.)
  const panTold = performance.now() - panTipAt < 1000;
  if (!tipShown) toast(touchFirst() ? `${panTold ? '' : '한 손가락으로 끌어 지으세요 · 지도 이동은 두 손가락. '}다른 종류는 지도 위 도구 이름을 눌러 고릅니다.` : '지도에서 바로 지으세요. 다른 종류는 지도 위 도구 이름을 눌러 고릅니다.', 'info');
}

/**
 * A step ticked off says so, and what comes next (pressed, it takes that step): on a phone the list is
 * behind the 도시 button while a tool is in hand, and the next step went unseen. The whole list done, a cheer.
 */
let ticked: { owner: typeof city | null; told: Set<number> } = { owner: null, told: new Set() };
function cheer(steps: [boolean, string, string | null, boolean?][]): void {
  const now = new Set(steps.flatMap(([ok], i) => (ok ? [i] : [])));
  // (Each step once a city: one that comes and goes — power cut from a new zone, then back — is told the first time.)
  const fresh = ticked.owner === city ? [...now].filter((i) => !ticked.told.has(i)) : [];
  ticked = { owner: city, told: ticked.owner === city ? new Set([...ticked.told, ...now]) : now };
  if (!fresh.length) return; // (a city just opened says nothing)
  dropToasts('시작하기'); // (the last one's 다음은 … is done now: two stacked, the older one wrong)
  const short = (t: string) => t.split(/ \(| — | · /)[0]!;
  // (Not one that waits on growth: "다음은 재정 흑자 만들기" at 216 residents led nowhere.)
  const next = steps.find(([ok, , , last]) => !ok && !last) ?? steps.find(([ok]) => !ok);
  if (!next) {
    toast(`시작하기를 모두 마쳤습니다! 이제 도시 상태를 보며 도시를 키워 보세요.`);
    return;
  }
  const what = fresh.map((i) => short(steps[i]![1])).join(' · ');
  const tool = next[2];
  // (Once the list is drawn: a next step it lays in one press, the notice lays too — on a phone the list is behind 도시,
  // and the notice only picked up the tool for a drag over the dashed block.)
  queueMicrotask(() => {
    const lay = document.querySelector<HTMLButtonElement>('#onboarding-steps > ol.steps > li:first-child .step-lay');
    const kind = lay?.dataset.lay;
    // (Found again on the press, as the list's own link is: the list may have been drawn anew since.)
    const press = kind ? () => {
      const now = document.querySelector<HTMLButtonElement>(`#onboarding-steps .step-lay[data-lay="${kind}"]`);
      if (now) now.click();
      else if (tool) takeStep(tool);
    } : tool ? () => takeStep(tool) : undefined;
    // (Said in the notice itself, what and for how much: a press that builds isn't left to a tooltip a phone never
    // shows. "바로 놓기 §500" kept together, and each "·" at a line's end: a phone's narrow notice began a line with
    // "· 다음은" and split "눌러서 / 바로 짓기".)
    const said = lay?.textContent?.trim() ?? '';
    const act = said.replace(/^추천 자리에 /, '').replace(' · ', ' ').replace(/(바로) (놓기|짓기|잇기) (.*§[\d,]+)$/, '$1\u00a0$2\u00a0$3');
    toast(`시작하기 ${now.size}/${steps.length}: ${what} 완료\u00a0· 다음은 ${short(next[1])}${lay ? `\u00a0· 눌러서 ${act}` : ''}`, 'good', undefined,
      press, false, lay ? `눌러서 ${said}` : tool ? `눌러서 다음 단계: ${short(next[1])}` : undefined);
  });
}

/** The checklist's deficit step: to be closed soon, or (years of money left) as the town grows. */
function deficitStep(deficit: number, funds: number): string {
  const years = deficit > 0 ? Math.floor(funds / deficit / 12) : 0;
  return years >= 5
    ? `재정 흑자 만들기 (지난달 −§${fmt(deficit)} · 자금은 ${years >= 100 ? '100년' : `${years}년`} 넘게 버팀: 주민이 늘면 세금이 메웁니다)`
    : `재정 적자 메우기 (지난달 −§${fmt(deficit)}: 세율·부서 예산)`;
}

/** The city (by lineage: undo's restored copy is the same city) whose checklist was once all done. */
let doneLineage = -1;

/** The tool of the checklist's first open step on an unfounded town (null otherwise). */
export let firstStepTool: string | null = null;
