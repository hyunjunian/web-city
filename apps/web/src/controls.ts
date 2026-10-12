// Top-bar controls: speed, night view, help, overlay picker and tax sliders.

import { DEV_TYPES, type DevType, GROWTH_CODES, NETWORK_KINDS, STRUCTURES } from '@web-city/engine';
import { icon, type IconName } from './icons';
import { nextStep, openGoal } from './manage';
import { fillRange } from './widgets';
import { TYPE_NAME, TYPE_SHORT } from './names';
import { updatePanels } from './panels';
import { type Overlay, type VolumeNetwork } from './render';
import { ABANDONED_COLOR, buildingRisk, GROWTH_COLOR, GROWTH_LABEL, growthNow, RISK_COLOR, volumeAt } from './views';
import { blinkAt, centerOn, changeKey, city, cityGeneration, overlay, overlayType, redraw, renderer, setOverlay, setOverlayType, setSpeedValue, speed } from './state';
import { refreshToolChip, selectTool, SPEEDS, TOOL_KEYS, toolName, TOOLS } from './tools';
import { drive } from './udi';
import { closeInfo, closePane, revealMap } from './tabs';
import { $, flash, fmt } from './util';
import { choice } from './undo';
import { type GoalId, GOALS } from './goals';
import { capped } from './readings';

/** Day / night view (cosmetic). */
const NIGHT_KEY = 'web-city:night';

/** Night view as last left (called at start). */
export function restoreNight(): void {
  try {
    if (localStorage.getItem(NIGHT_KEY) === '1' && !renderer.night) toggleNight();
  } catch { /* storage unavailable */ }
}

export function toggleNight(): void {
  renderer.night = !renderer.night;
  const btn = $('#btn-night');
  btn.innerHTML = `${icon(renderer.night ? 'sun' : 'moonStar')}<span class="menu-label">${renderer.night ? '낮 풍경' : '밤 풍경'}</span>`;
  btn.setAttribute('aria-pressed', String(renderer.night));
  btn.title = renderer.night ? '낮 풍경으로 (N)' : '밤 풍경으로 (N)';
  $('#view').classList.toggle('night', renderer.night); // the minimap dims along
  // The margin around the map goes dark too (a night map sat on daylight grey).
  renderer.background = getComputedStyle($('#view')).getPropertyValue('--view-bg').trim() || renderer.background;
  try {
    localStorage.setItem(NIGHT_KEY, renderer.night ? '1' : '0');
  } catch { /* storage unavailable */ }
  redraw();
}

/** The help dialog: mouse, touch and keyboard controls. */
export function showHelp(): void {
  const label = (id: string) => toolName(TOOLS.find((t) => t.id === id)!);
  const key = (k: string, what: string) => `<span><kbd>${k}</kbd>${what}</span>`;
  // Touch screens get touch words; the keyboard section is hidden there by CSS.
  const touch = matchMedia('(pointer: coarse) and (hover: none)').matches;
  const map = touch
    ? `<dt>끌기</dt><dd>고른 도구로 짓기 (도로·구역·송전선 등)</dd>
      <dt>도구 없이 끌기</dt><dd>지도 이동 · 살짝 누르면 조회</dd>
      <dt>두 손가락 끌기</dt><dd>지도 이동</dd>
      <dt>두 손가락 벌리기·모으기</dt><dd>확대·축소</dd>
      <dt>끄는 중에 두 번째 손가락</dt><dd>짓기 취소 (지도 이동으로 바뀜)</dd>
      <dt>시설 누르기</dt><dd>자리를 미리 보여 주고 <b>짓기</b>를 눌러야 지어짐</dd>`
    : `<dt>끌기</dt><dd>고른 도구로 짓기 (도로·구역·송전선 등)</dd>
      <dt>도구 없이 끌기</dt><dd>지도 이동 · 클릭하면 조회</dd>
      <dt>오른쪽 버튼</dt><dd>끌면 지도 이동 · 누르기만 하면 도구 내려놓기</dd>
      <dt>휠 · 트랙패드 벌리기</dt><dd>확대·축소</dd>`;
  // Tips by what they answer: a title to scan, the words under it (fourteen paragraphs in a row went unread).
  const tips: [string, string][] = touch ? [
    ['끄는 동안 보이는 것', '끄는 동안 손가락 위에 칸 수와 비용이, 화면 아래에 자세한 내용이 나오고, 지을 수 없으면 빨갛게 이유를 알려 줍니다(구역은 함께 놓일 골목 자리까지 미리 보임).'],
    ['같은 묶음의 다른 도구', '도구를 든 동안 지도 아래쪽 줄에서 다른 도로 종류·밀도·시설 종류로 바로 바꿀 수 있습니다. 도구 카드 위의 찾기 칸에 이름(예: 소방서)을 쓰면 어느 묶음에 있든 찾아 주고, 최근 쓴 도구도 거기 모여 있습니다.'],
    ['짓기 메뉴와 도구 카드', '지도 위쪽 메뉴의 <b>짓기</b>를 누르면 그 아래로 도구 카드가 열립니다. 카드 맨 위에서 교통·구역·공공시설 같은 묶음을 고르고 종류를 누르세요. 지도를 누르기 시작하면 카드는 접힙니다. 묶음 이름 옆에는 지금 모자란 것(닿지 않는 건물 수, 구역 수요)이 나옵니다. 시설을 고르면 지도에 <b>추천 자리</b> 과녁이(구역은 블록 테두리, 송전선·수도관은 점선 길이) 나오고, 화면 밖이거나 시트 아래면 가장자리의 파란 화살표를 눌러 그곳으로 갑니다. 놓을 자리를 누르면 아래 막대에 그 자리에서 새로 닿는 건물 수가 나옵니다.'],
    ['칸 정보 보기', '도구를 들지 않은 채 칸을 살짝 누르면 아래에서 정보 카드가 올라옵니다. 건물·길을 누르면 그곳을 오가는 길이 지도에 그려지고, 집이면 주민 생각도 함께 나옵니다. 문제가 있는 시설의 카드에는 고치는 버튼(옆에 하나 더 짓기, 예산 100%로 등)이 함께 나옵니다.'],
    ['조언의 보기·+ 버튼', '조언·알림의 <b>보기</b>를 누르면 문제를 보여 주는 지도 보기로 바뀌고 그 장소로 옮겨 갑니다. <b>+ 학교</b>처럼 생긴 버튼은 그 문제를 고칠 도구를 바로 골라 줍니다.'],
    ['건물이 안 들어설 때', '건물이 안 들어서면 빈 구역 칸을 눌러 보세요. 전기·도로·일터 연결·수요·쾌적도 중 무엇이 막는지 알려 줍니다.'],
    ['도시 현황', '<b>도시</b>를 열면 위에 도시의 크기와 다음 보상이, 그 아래 도시 상태(재정·시장 평점·개발·전력 등 모든 분야)가 보이고, 누르면 그 관리 화면과 통계가 나옵니다. 세율·예산·대출·조례는 도시 상태의 <b>재정·정책</b>에서 바꿉니다. 위쪽 막대에서 <b>주민</b>·<b>지역</b>을 봅니다. 저장·불러오기·테마는 <b>⋯</b> 메뉴에 있습니다.'],
    ['도시 상태 읽기', '<b>도시 상태</b>에서 조치가 필요한 곳(빨강·주황)을 누르면 그 화면 맨 위에 무엇이 문제인지와 추천 조치가 나오고, 해 보기를 누르면 그 도구가 손에 들리고, <b>추천 자리에 짓기</b>를 누르면 알맞은 빈 땅(서비스가 닿지 않는 곳, 수도관·전력망에 닿는 곳 등)에 바로 지어집니다(매립지·구역은 알맞은 크기로 <b>추천 자리에 N×N 놓기</b>). 과녁이 화면 밖이면 가장자리의 파란 화살표가 그쪽을 가리키고, 누르면 그곳으로 갑니다. 전기·물·도로가 닿지 않는 곳은 지도에 점선으로 그려 둔 가장 짧은 송전선·수도관·도로를 <b>바로 잇기</b>로 한 번에 놓습니다(위쪽 ↶로 되돌리기). 예산·조례·대출을 바꾸는 추천은 적용하기·시행하기·빌리기로 바로 바뀝니다(불·폭동은 도시 상태 위에 출동 카드가 먼저 뜹니다). 어느 항목이 조치 필요로 바뀌면 시간이 멈추고(⋯ 메뉴에서 끄기), 관리 화면에서 한 조치는 3개월 뒤 결과(핵심 수치의 변화)를 알려 줍니다. 도시 상태는 급한 곳(빨강)·살펴볼 곳(주황)이 위에 이유와 함께, 양호한 곳이 아래에 나오고, ▲▼는 지난 3개월의 흐름, "결과 기다리는 중"은 결과를 기다리는 조치입니다. 지나간 알림은 <b>소식</b>에 남고 도시와 함께 저장됩니다.'],
    ['관리 화면', '<b>도시</b>의 도시 상태(개발·전력·수도·교육 등)에서 항목을 누르면 그 분야의 관리 화면이 열립니다: 지도 보기가 맞춰지고, 수치와 변화, 진단, 지을 것·예산·조례가 한곳에 모입니다. 시설 버튼을 누르면 지도로 넘어가고, 지도 위 칩을 누르면 관리 화면으로 돌아옵니다. 지도의 과녁은 서비스가 가장 많이 빠진 곳입니다.'],
    ['불·폭동 출동', '불·폭동은 <b>시민 서비스</b>의 소방 출동·경찰 출동 도구로(또는 도시 상태 위 출동 카드의 출동 준비) 그곳을 누르면 가까운 서에서 차가 갑니다(서의 크기만큼 대수 제한). 폭동은 경찰차 3대 이상이 모여야 진압되니(막다른 길 제외) 같은 곳을 여러 번 누르세요. 아무것도 짓기 전의 새 도시에서는 지형 편집이 무료입니다.'],
    ['발전소', '발전소는 불타거나 수명이 다하면 폭발합니다: 소방서 반경 안에 두세요.'],
    ['알림·세율·시간', '알림 카드는 누르면 그곳으로 가고, 옆으로 밀면 치워집니다. 재정·정책의 세율은 −·+ 버튼으로 0.5%씩 바꿀 수 있습니다. 짓거나 철거하는 도구를 든 동안에는 시간이 잠시 멈춥니다. 제안(해 보기)으로 든 시설은 한 곳에 놓으면 도구가 내려가고 시간이 다시 흐릅니다.'],
  ] : [
    ['키보드로 짓기', '키보드만으로도 지을 수 있습니다: 건설 도구를 들고 방향키로 커서를 옮겨(Shift: 5칸, 지도가 따라감) Enter로 짓습니다. 도로·구역처럼 끌어 짓는 도구는 시작점과 끝점에서 Enter를 한 번씩 누르고, Esc로 취소합니다.'],
    ['끄는 동안 보이는 것', '끄는 동안 그 자리 바로 옆 칩에 칸 수·비용과 걸리는 점이 나오고, 지을 수 없으면 빨갛게 이유를 알려 줍니다(구역은 함께 놓일 골목 자리까지 미리 보임). 도로는 처음 끈 방향으로 먼저 뻗어 꺾이고, Shift를 누르면 곧게 뻗습니다. 짓거나 철거하는 도구를 든 동안에는 시간이 잠시 멈추고, 도구를 내려놓으면 다시 흐릅니다(도구 막대의 멈춤을 누르면 바로 흐름).'],
    ['같은 묶음의 다른 도구', '도구를 들면 지도 위쪽 막대에 그 도구와 같은 묶음의 다른 도구(도로 종류·밀도·시설 종류)가 함께 나와 한 번에 바꿀 수 있습니다(, . 키). 자주 쓰지 않는 도구는 도구 카드의 <b>더 보기</b>에 있습니다. / 키로 도구·시설을 이름으로 찾고 Enter로 바로 고릅니다(세율·대출·범죄처럼 하려는 일을 쓰면 그 관리 화면도 나옵니다).'],
    ['도구 메뉴와 도구 카드', '지도 위쪽 메뉴는 철거, 짓기(교통·구역·공공시설·서비스), 보상·지형 순서입니다(도구를 들지 않으면 지도는 그대로 조회). 묶음을 누르면 그 아래로 도구 카드가 열리고, 도구를 고르면 같은 자리에 든 도구의 막대가 메뉴 대신 섭니다(카드 안에서는 방향키로 도구를 옮겨 고를 수 있음). 시설은 카드에서 종류를 바로 누르면 됩니다. 지도를 누르기 시작하면 카드는 접힙니다. 둘러보기만 하고 ×나 Esc로 닫으면 묶음이 집어 든 도구도 내려놓습니다. 가장 급한 곳의 추천 조치가 쓰는 도구의 묶음에는 작은 점이 하나 붙습니다. 알림은 지도 오른쪽 아래에 잠시 떴다가 사라집니다(아랫줄이 남은 시간, 가리키고 있으면 기다림).'],
    ['칸 정보 보기', '도구를 들지 않은 채 지도 위에 마우스를 올리면 그 칸이 무엇인지 바로 옆에 나옵니다. 누르면 오른쪽 정보 카드에 자세히 나오고, 두 번 누르면 그곳으로 확대됩니다. 문제가 있는 시설의 카드에는 고치는 버튼(옆에 하나 더 짓기, 예산 100%로 등)이 함께 나옵니다.'],
    ['조언의 보기·+ 버튼', '조언·알림의 <b>보기</b>를 누르면 문제를 보여 주는 지도 보기로 바뀌고 그 장소로 옮겨 갑니다. <b>+ 학교</b>처럼 생긴 버튼은 그 문제를 고칠 도구를 바로 골라 줍니다. 오른쪽 위 미니맵을 눌러 이동할 수 있습니다.'],
    ['밀도 올리기 (재개발)', '건물이 선 땅에도 같은 종류의 더 높은 밀도(저 → 중 → 고밀도)를 칠할 수 있습니다. 건물은 그대로 있다가 재개발될 때 새 밀도로 다시 지어집니다.'],
    ['건물이 안 들어설 때', '건물이 안 들어서면 빈 구역 칸을 조회해 보세요. 전기·도로·일터 연결·수요·쾌적도 중 무엇이 막는지 알려 줍니다.'],
    ['지도 보기와 서비스 범위', '지도 보기를 켠 채로 마우스를 올리면 그 칸의 값이 바로 옆에 나옵니다. 경찰·소방·병원·학교·발전소·수도 시설을 들면 그 서비스가 닿는 범위 보기가 함께 켜져 빈 곳이 보이고, 놓을 자리에는 반경이 원으로, 포인터 옆에는 그 자리에서 새로 닿는 건물 수가 보입니다. 도구를 들면 지을 만한 땅에 파란 <b>추천 자리</b> 과녁이(구역은 블록 테두리, 송전선·수도관은 점선 길이) 나오고, 화면 밖이면 가장자리의 화살표를 눌러 그곳으로 갑니다(키보드: <b>S</b>로 커서를 그 자리에). 범례 아래에는 빠진 곳의 수(전기 없는 건물, 막힌 길 등)가 나오고 <b>찾아가기</b>를 누를 때마다 다음 곳으로 옮겨 갑니다. 지도 보기 목록에서 점이 붙은 보기는 가장 급한 곳을 보여 주는 보기입니다.'],
    ['도시 상태 읽기', '<b>도시 상태</b>에서 조치가 필요한 곳(빨강·주황)을 누르면 그 화면 맨 위에 무엇이 문제인지와 추천 조치가 나오고, 해 보기를 누르면 그 도구가 손에 들리고, <b>추천 자리에 짓기</b>를 누르면 알맞은 빈 땅(서비스가 닿지 않는 곳, 수도관·전력망에 닿는 곳 등)에 바로 지어집니다(매립지·구역은 알맞은 크기로 <b>추천 자리에 N×N 놓기</b>). 과녁이 화면 밖이면 가장자리의 파란 화살표가 그쪽을 가리키고, 누르면 그곳으로 갑니다. 전기·물·도로가 닿지 않는 곳은 지도에 점선으로 그려 둔 가장 짧은 송전선·수도관·도로를 <b>바로 잇기</b>로 한 번에 놓습니다(Ctrl+Z로 되돌리기). 예산·조례·대출을 바꾸는 추천은 적용하기·시행하기·빌리기로 바로 바뀝니다(불·폭동은 도시 상태 위에 출동 카드가 먼저 뜹니다). 어느 항목이 조치 필요로 바뀌면 시간이 멈추고(⋯ 메뉴에서 끄기), 관리 화면에서 한 조치는 3개월 뒤 결과(핵심 수치의 변화)를 알려 줍니다. 도시 상태는 급한 곳(빨강)·살펴볼 곳(주황)이 위에 이유와 함께, 양호한 곳이 아래에 나오고, ▲▼는 지난 3개월의 흐름, "결과 기다리는 중"은 결과를 기다리는 조치입니다. 지나간 알림은 <b>소식</b>에 남고 도시와 함께 저장됩니다.'],
    ['관리 화면', '왼쪽 도시 상태에서 항목(개발·전력·수도·교육 등)을 누르면 그 분야의 관리 화면이 열립니다: 지도 보기가 그에 맞게 바뀌고, 수치와 최근 추세, 조언자의 진단, 지을 수 있는 시설·예산·조례가 한곳에 모입니다. 수치 옆 ▲▼는 화면을 연 뒤의 변화입니다. 지도에는 그 분야의 시설이 테두리로, 문제가 가장 많이 모인 곳(서비스가 닿지 않는 곳, 막힌 길, 공기가 나쁜 주거지, 부유층이 살 만한 땅 등)이 과녁으로 표시되고, 짓기 버튼은 지으면 여유가 얼마나 될지 알려 줍니다. ← 또는 Esc로 돌아갑니다(M: 가장 급한 분야).'],
    ['불·폭동 출동', '불·폭동은 <b>시민 서비스</b>의 소방 출동·경찰 출동 도구로(또는 도시 상태 위 출동 카드의 출동 준비) 그곳을 누르면 가까운 서에서 차가 갑니다(서의 크기만큼 대수 제한). 폭동은 경찰차 3대 이상이 모여야 진압되니(막다른 길 제외) 같은 곳을 여러 번 누르세요. 아무것도 짓기 전의 새 도시에서는 지형 편집이 무료입니다.'],
    ['발전소와 낡은 시설', '발전소는 불타거나 수명이 다하면 폭발합니다: 소방서 반경 안에 두고, 조언자가 수명을 알려 주면 새로 지어 바꾸세요. 송전선·수도관이 낡으면 불꽃·파열이 나니 <b>노후 시설</b> 보기와 부서 예산(위생 포함)을 살피세요.'],
    ['재정·주민·지역·저장', '왼쪽 도시 상태의 항목(B: 재정·정책)을 누르면 그 관리 화면과 통계(그래프·보고서)가 나옵니다. 세율·예산·대출·조례는 재정·정책에서 바꿉니다. 위쪽 막대의 <b>주민</b>(U)·<b>지역</b>(J)에서 My Sim·이웃 도시를 봅니다. 도시 이름은 위쪽 막대에서 눌러 바꾸고, <b>⋯</b> 메뉴에서 저장·불러오기·테마를 고릅니다.'],
  ];
  // The basic loop in five steps (the getting-started list, in short), then the keys by what they are for.
  // (Each step is also the way to do it: pressed, the help closes on its tool, its screen or the clock.)
  const loop = ([['road', '도로', '지도 가장자리까지 이으면 이웃 도시와 이어짐', 'road'], ['zones', '구역', '길가에 주거·상업·산업을 칠하기', 'R-low'], ['zap', '전기', '발전소를 구역 가까이 (4칸 넘으면 송전선)', 'goal:power'],
    ['droplet', '물', '양수 펌프와 수도관 (도시가 커지면)', 'goal:water'], ['play', '시간', touch ? '▶를 눌러 도시가 자라게' : '▶ 또는 Space로 도시가 자라게', 'play']] as const)
    .map(([ic, name, what, act], k) => `<li><button type="button" class="loop-step" data-loop="${act}" title="${name}: 눌러서 바로 해 보기">${icon(ic)}<b><span class="loop-n">${k + 1}</span>${name}</b><small>${what}</small></button></li>`).join('');
  const group = (title: string, keys: string, wide = false) => `<section class="key-group${wide ? ' wide' : ''}"><h4>${title}</h4><div class="key-list">${keys}</div></section>`;
  $('#help-body').innerHTML = `
    <h3 class="sub">기본 순서</h3>
    <ol class="help-loop">${loop}</ol>
    <h3 class="sub">지도</h3>
    <dl class="help-grid">
      ${map}
    </dl>
    <div class="help-keys">
    <h3 class="sub">키보드</h3>
    <div class="key-groups">
      ${group('시간·되돌리기', `${key('Space', '멈춤·이어 하기')}${key('0–3', '속도 (⏸ ▶ ▶▶ ▶▶▶)')}${key('Ctrl+Z', '되돌리기 (20개)')}${key('Ctrl+Shift+Z', '다시 하기')}${key('Ctrl+S', '브라우저에 저장')}`)}
      ${group('화면', `${key('M', '가장 급한 분야의 관리 화면')}${key('B', '재정·정책 (세율·예산·대출·조례)')}${key('U', '주민 (My Sim·직접 운전)')}${key('J', '지역 (이웃 도시)')}${key('?', '이 도움말')}${key('Ctrl+Shift+X', '치트 콘솔')}`)}
      ${group('지도', `${key('+ −', '확대·축소')}${key('Home', '도시 전체 보기')}${key('방향키', '지도 이동')}${key('F', '지도만 크게')}${key('O', '지도 보기 켜기·끄기 (영문 O)')}${key('[ ]', '이전·다음 지도 보기')}${key('G', '개발 막힘 보기')}${key('N', '밤 풍경')}`)}
      ${group('도구 다루기', `${key('/', '도구·시설·화면 찾기 (예: 소방서, 세율)')}${key(', .', '같은 묶음의 이전·다음 도구')}${key('`', '직전 도구로 돌아가기')}${key('Shift+끌기', '도로·선로를 곧게')}${key('Enter', '건설 도구: 커서 자리에 짓기 · 그 밖: 가운데 칸 조회')}${key('S', '건설 도구: 커서를 추천 자리(과녁)로')}${key('Esc', '취소 → 카드 닫기 → 도구 내려놓기')}`)}
      ${group('도구 바로 들기', Object.entries(TOOL_KEYS).map(([k, id]) => key(k.toUpperCase(), label(id))).join(''), true)}
    </div>
    <p class="legend">구역 키를 다시 누르면 종류가 바뀝니다(Z·C: 저 → 중 → 고밀도, I: 산업 중밀도 → 고밀도 → 농업). 끄는 중에 오른쪽 버튼을 누르면 취소됩니다.</p>
    <p class="legend">직접 운전(U-Drive-It) 중에는 방향키·WASD로 움직이고 <kbd>Space</kbd>로 물을 뿌리거나 포를 쏩니다.</p>
    </div>
    <h3 class="sub">알아 두면 좋은 것</h3>
    <div class="help-tips">${tips.map(([title, text]) => `<details class="tip"><summary>${title}</summary><p>${text}</p></details>`).join('')}</div>
    <p class="legend">이 창처럼 도움말·저장·새 도시 창이 열려 있는 동안에는 시간이 멈춥니다.</p>
    <p class="legend">처음이라면 ${touch ? '<b>도시</b> 버튼' : '왼쪽 도시 현황'}의 "시작하기" 순서를 따라 하거나(누르면 그 도구가 골라짐) 예시 도시를 열어 보세요. 도시는 6개월마다, 그리고 탭을 떠날 때 자동 저장됩니다.</p>`;
  const dialog = $<HTMLDialogElement>('#help-dialog');
  dialog.querySelectorAll<HTMLButtonElement>('[data-loop]').forEach((b) => (b.onclick = () => {
    const act = b.dataset.loop!;
    dialog.close();
    if (act === 'play') chooseSpeed(runningSpeed || 1);
    else if (act.startsWith('goal:')) openGoal(act.slice(5) as GoalId);
    else selectTool(act);
  }));
  // A tap on the backdrop around it closes it, as the 닫기 button (at the end of a long page on a phone) does.
  dialog.onclick = (e) => {
    const r = dialog.getBoundingClientRect();
    if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
  };
  dialog.showModal();
  // Focus the title, not the close button far below (its focus ring was out of sight); Tab goes on from there.
  const title = dialog.querySelector<HTMLElement>('h2')!;
  title.tabIndex = -1;
  title.focus();
  dialog.scrollTop = 0;
}

/** The speed selector in the status bar, beside the date: pause and play buttons (⏸ ▶ ▶▶ ▶▶▶). */
export function buildSpeed(): void {
  for (const el of document.querySelectorAll<HTMLElement>('.gear')) {
    el.innerHTML = '';
    SPEEDS.forEach((s, i) => {
      const b = document.createElement('button');
      b.innerHTML = icon(s.icon);
      b.title = s.title;
      b.setAttribute('aria-label', s.title.replace(/ \(.*\)$/, ''));
      b.onclick = () => chooseSpeed(i);
      el.append(b);
    });
  }
  setSpeed(speed);
}

/** Whether the player has set the speed on this city (then its first zone leaves the clock alone). */
export let speedChosen = false;
export const resetSpeedChoice = (): void => void (speedChosen = false);

/** A speed the player picked (a button or a key). */
export function chooseSpeed(i: number): void {
  speedChosen = true;
  // The player's own choice ends a hold for building: it is theirs from here (another kind or
  // density picked while still building doesn't stop the clock again, until a looking tool comes back).
  if (heldSpeed !== null) {
    heldSpeed = null;
    holdWaived = true;
    markHeld();
  } else if (isBuilding()) holdWaived = true;
  setSpeed(i);
}

/**
 * While a building tool is in hand the clock stands still, so a plan is laid on a city that
 * holds still; the speed it ran at comes back when the tool is put down (null: not holding).
 */
let heldSpeed: number | null = null;
/** The player set the speed while building: no hold until the building tools are put down. */
let holdWaived = false;
/** Whether a building tool is in hand (set by the tools). */
let building = false;
const isBuilding = (): boolean => building;
const HOLD_TIP_KEY = 'web-city:hold-tip';

export function holdForBuilding(on: boolean): void {
  building = on;
  if (!on) holdWaived = false;
  if (on) {
    if (heldSpeed !== null || holdWaived || speed === 0 || drive) return;
    heldSpeed = speed;
    setSpeed(0);
    markHeld();
    // Said the first time; after that the paused clock says it.
    try {
      if (!localStorage.getItem(HOLD_TIP_KEY)) {
        localStorage.setItem(HOLD_TIP_KEY, '1');
        flash('짓는 동안에는 시간이 잠시 멈춥니다 · 도구를 내려놓으면 다시 흐릅니다', 'info');
      }
    } catch { /* storage unavailable */ }
  } else if (heldSpeed !== null) {
    const v = heldSpeed;
    heldSpeed = null;
    markHeld();
    // (Mid-drive the clock is the drive's: the speed comes back when it ends.)
    if (drive) drive.speedBefore = v;
    else if (speed === 0) setSpeed(v);
  }
}

/** A new city's first zone: its clock starts once building is done (it opened paused). */
export function resumeAfterBuilding(v: number): void {
  if (heldSpeed !== null) return;
  heldSpeed = v;
  markHeld();
}

export const isHeld = (): boolean => heldSpeed !== null;

/** The tool bar's 멈춤 pressed: time runs on at the speed it had (the player's choice from here). */
export function releaseHold(): void {
  if (heldSpeed !== null) chooseSpeed(heldSpeed);
}

/** The speed buttons say the clock is only held for building (and comes back by itself); so does the tool chip. */
function markHeld(): void {
  refreshToolChip();
  document.querySelectorAll<HTMLElement>('.gear').forEach((el) => {
    el.classList.toggle('held', heldSpeed !== null);
    el.title = heldSpeed !== null ? '짓는 동안 잠시 멈춤 · 도구를 내려놓으면 다시 흐릅니다' : '';
  });
}

/** The last running speed (Space resumes there, however time was paused). */
export let runningSpeed = 1;

export function setSpeed(i: number): void {
  // U-Drive-It stops the clock for the drive; it restarts when the drive ends.
  if (drive && i > 0) {
    flash('운전하는 동안에는 시간이 멈춥니다', 'bad');
    i = 0;
  }
  setSpeedValue(i);
  if (i > 0) runningSpeed = i;
  window.dispatchEvent(new Event('speedchange')); // (the goal screen's clock)
  document.querySelectorAll<HTMLElement>('.gear').forEach((el) => {
    el.querySelectorAll<HTMLButtonElement>('button').forEach((b, k) => {
      b.classList.toggle('active', k === i);
      b.setAttribute('aria-pressed', String(k === i));
    });
    el.dataset.speed = String(i);
  });
}

/** The data views by theme: [value, chip name, full name in the picker's label]. */
const VIEW_GROUPS: [string, IconName, [string, string, string?][]][] = [
  ['개발', 'zones', [['desirability', '쾌적도', '쾌적도 (개발 유형별)'], ['landValue', '땅값'], ['zones', '구역', '구역 (건물 숨김)'], ['growth', '개발 막힘', '개발 막힘 (빈 구역·버려진 건물)'], ['mayor', '시장 평점']]],
  ['공공시설', 'zap', [['power', '전력망'], ['waterService', '수도', '수도 (지하)'], ['garbage', '쓰레기'], ['wear', '노후 시설', '노후 시설 (송전선·수도관·철로)']]],
  ['안전', 'shield', [['police', '경찰 범위', '경찰 보호 범위'], ['crime', '범죄'], ['fire', '소방 범위', '소방 보호 범위'], ['flammability', '화재 위험도']]],
  ['보건·교육·주민', 'health', [['health', '병원 범위', '병원이 닿는 범위'], ['school', '학교 범위', '학교가 닿는 범위'], ['hq', '건강 지수', '건강 지수 (HQ)'], ['eq', '교육 지수', '교육 지수 (EQ)'], ['age', '평균 나이', '주민 평균 나이'], ['commute', '통근 시간', '통근·화물 시간']]],
  ['환경', 'wind', [['air', '대기 오염'], ['waterPollution', '수질 오염'], ['radiation', '방사능']]],
  ['교통', 'route', [['traffic', '혼잡', '교통 혼잡'],  ['volume:road', '도로 통행량', '통행량: 도로'], ['volume:evening', '저녁 퇴근', '통행량: 도로, 저녁 퇴근길'], ['volume:rail', '철도 통행량', '통행량: 철도'], ['volume:subway', '지하철 통행량', '통행량: 지하철·고가 철도'],
    ['volume:monorail', '모노레일 통행량', '통행량: 모노레일'], ['volume:highway', '고속도로 통행량', '통행량: 고가 고속도로'], ['volume:ferry', '페리 통행량', '통행량: 페리'], ['subway', '지하철 노선', '지하철 (지하)']]],
];
for (const [, , views] of VIEW_GROUPS) for (const v of views) v[2] ??= v[1];

export function buildOverlay(): void {
  const el = $('#overlay');
  const groups = VIEW_GROUPS.map(([label, ic, views]) => `
      <div class="vg"><div class="vg-head">${icon(ic)}${label}</div><div class="vg-chips">${views.map(([v, name]) =>
        `<button type="button" class="vchip" data-v="${v}" aria-pressed="false">${name}</button>`).join('')}</div></div>`).join('');
  el.innerHTML = `
    <div class="view-current">
      <button type="button" id="view-pick" aria-expanded="false" aria-controls="view-grid" title="지도에 보여 줄 데이터 고르기 (O 켜기·끄기, [ ] 앞뒤로 넘기기)">${icon('layers')}<span id="view-name">지도 보기</span>${icon('chevronDown')}</button>
      <button type="button" class="icon-btn" id="view-off" title="지도 보기 끄기 (O)" aria-label="지도 보기 끄기" hidden>${icon('close')}</button>
    </div>
    <div id="view-grid" hidden>${groups}</div>
    <select id="overlay-kind" hidden aria-hidden="true" tabindex="-1">
      <option value="none">없음</option>
      ${VIEW_GROUPS.map(([label, , views]) => `<optgroup label="${label}">${views.map(([v, , full]) => `<option value="${v}">${full ?? ''}</option>`).join('')}</optgroup>`).join('')}
    </select>
    <select id="overlay-type" aria-label="개발 유형">${(['R', 'C', 'I'] as const).map((k) => `<optgroup label="${({ R: '주거', C: '상업', I: '산업·농업' })[k]}">${DEV_TYPES.filter((t) => t[0] === k).map((t) => `<option value="${t}">${TYPE_NAME[t]}</option>`).join('')}</optgroup>`).join('')}</select>
    <div class="overlay-scale" id="overlay-scale" hidden><div class="scale-bar"></div><div class="ends"><span></span><span></span></div></div>
    <div class="legend" id="overlay-legend"></div>
    <p class="overlay-sum" id="overlay-sum" hidden></p>`;
  const kind = $<HTMLSelectElement>('#overlay-kind');
  const type = $<HTMLSelectElement>('#overlay-type');
  const title = $<HTMLButtonElement>('#layer-title');
  $('#overlay-legend').addEventListener('click', legendGo);
  $('#overlay-legend').addEventListener('keydown', legendGo);
  title.onclick = () => {
    const open = $('#map-layer').classList.toggle('open');
    title.setAttribute('aria-expanded', String(open));
  };
  const apply = () => {
    if (kind.value !== 'none') lastView = kind.value; // O brings back whatever was shown last, however it was picked
    setOverlayType(type.value as DevType);
    setOverlay(kind.value === 'desirability'
      ? { kind: 'desirability', type: overlayType }
      : kind.value.startsWith('volume:')
        ? { kind: 'volume', network: kind.value.slice(7) as VolumeNetwork }
        : ({ kind: kind.value } as Overlay));
    type.style.display = kind.value === 'desirability' ? '' : 'none';
    const off = kind.value === 'none';
    // The chip's short name on the card; the full one as its tooltip.
    const chip = el.querySelector<HTMLButtonElement>(`.vchip[data-v="${kind.value}"]`);
    // The chip's name in the card's head; what it leaves out (보건 → 병원이 닿는 범위; 개발 막힘 → 빈 구역·버려진 건물)
    // as a quiet line over the legend, not the name said again.
    $('#view-name').textContent = off ? '지도 보기' : chip?.textContent ?? '';
    const full = kind.selectedOptions[0]?.textContent ?? '';
    const aside = /^.+? \((.+)\)$/.exec(full)?.[1] ?? (full !== chip?.textContent ? full : '');
    const legendEl = $('#overlay-legend');
    if (!off && aside) legendEl.dataset.title = aside;
    else delete legendEl.dataset.title;
    $('#view-name').title = off ? '' : kind.selectedOptions[0]?.textContent ?? '';
    $('#map-layer').classList.toggle('off', off);
    $('#view-off').hidden = kind.value === 'none';
    el.querySelectorAll<HTMLButtonElement>('.vchip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.v === kind.value)));
    $('#overlay-legend').textContent = ({
      desirability: '빨강 = 낮음, 노랑 = 50 (이 이상이어야 개발됨), 초록 = 150 이상.',
      power: '노랑 = 전력망에 연결됨, 빨강 = 전기가 없는 구역·건물.',
      police: '파랑이 진할수록 경찰 보호가 강함(겹치면 더해짐). 보호값 20 초과면 범인이 체포됩니다. 연빨강 = 보호 없는 구역·건물.',
      mayor: '주거 건물별 시장 평점. 빨강 = 낮음(−50 이하가 모이면 폭동), 초록 = 높음.',
      garbage: '갈색 = 매립지(진할수록 가득), 빨강 = 수거되지 않고 쌓인 쓰레기.',
      crime: '최근 범죄가 일어난 곳(진할수록 많음). 점 = 지난달 범죄(빨강 = 방화·강도·폭행, 노랑 = 그 밖).',
      commute: '주거: 일하는 주민의 평균 통근 시간, 산업: 화물이 도시 밖까지 가는 시간. 주거는 2.5시간을 넘거나 길이 없으면(진빨강) 6개월 뒤 버려집니다(산업은 화물만 못 나감).',
      age: '주거 건물별 가구 평균 나이: 연노랑일수록 젊고 파랑일수록 나이 많음. 학교마다 맞는 나이대가 있습니다.',
      zones: '건물을 감추고 구역만 보여 줍니다(초록 주거·파랑 상업·노랑 산업·갈색 매립지).',
      radiation: '연두 = 방사능이 남은 땅(진할수록 오래 남음). 그 위에는 아무것도 자라지 않습니다.',
      wear: '송전선·수도관 노후도(50부터 불꽃·파열 위험)와 망가진 철로(진빨강). 부서 예산 100% 이상이면 고쳐집니다(철로는 대중교통 100% 초과).',
      fire: '파랑이 진할수록 소방 보호가 강함. 보호 안의 작은 불은 번지기 전에 꺼집니다. 연빨강 = 보호 없는 구역·건물.',
      flammability: '빨강 = 불이 잘 붙음(물 없는 곳·빈 건물·공장·발전소). 54 이상이 모이면 화재 다발 지역.',
      waterService: '진파랑 = 수도관, 파랑 = 급수 범위, 주황 = 관은 있지만 공급 없음, 빨강 = 물 없음.',
      health: '병원 반경 안의 효과(등급 반영): 파랑이 진할수록 좋음. 연빨강 = 병원이 닿지 않는 구역·건물.',
      school: '학교 종류별 효과의 평균: 파랑이 진할수록 좋음. 연빨강 = 학교가 닿지 않는 구역·건물.',
      hq: '주거 건물의 건강 지수 0–200.',
      eq: '주거 건물의 교육 지수 0–200.',
      traffic: '도로·철도의 교통량 대비 용량. 초록 = 원활, 빨강 = 용량의 2배(속도 −35%).',
      ...Object.fromEntries(['road', 'rail', 'subway', 'monorail', 'highway', 'ferry'].map((k) => [`volume:${k}`,
        '이 교통망의 통행량: 흰색 = 적음, 진파랑 = 도시에서 가장 많은 곳.'])),
      'volume:evening': '지난달 저녁 퇴근길의 차량(화물 제외): 일방통행로에서는 아침과 다른 길로 돌아갑니다. 흰색 = 적음, 진파랑 = 도시에서 가장 많은 곳.',
      subway: '지하철 선로: 파랑 = 한산, 빨강 = 용량만큼 혼잡.',
      air: '대기 오염(공장·발전소·교통): 진할수록 심함. 견딜 수 있는 정도를 넘으면 주거·상업·첨단 산업·농업의 쾌적도와 시장 평점이 떨어지고 건강을 해칩니다. 어디서 오는지는 환경·쾌적 화면의 오염원 막대가, 집 한 채는 그 정보 카드가 알려 줍니다.',
      waterPollution: '수질 오염(공장·농장·발전소·소각장): 진할수록 심함. 건강과 시장 평점을 낮추고, 너무 오염된 땅의 양수 펌프는 멈춥니다. 정수장 반경 안에서 줄어듭니다. 펌프의 물을 무엇이 더럽히는지는 그 펌프의 정보 카드가 알려 줍니다.',
      landValue: '진할수록 비쌈(물가, 주변 구역보다 높은 땅). 부유층은 비싼 땅을 찾습니다.',
    } as Record<string, string>)[kind.value] ?? '';
    // A view of something the city doesn't have would show a blank map: say so.
    const network = kind.value.startsWith('volume:') ? kind.value.slice(7) as VolumeNetwork : null;
    const anyTile = (test: (i: number) => boolean) => {
      for (let i = 0; i < city.size * city.size; i++) if (test(i)) return true;
      return false;
    };
    const none = network ? !anyTile((i) => volumeAt(city.state, city.fields, network, i) >= 0)
      : kind.value === 'subway' ? !city.state.subway.some((v) => v > 0)
      : kind.value === 'radiation' ? !city.state.radiation.some((v) => v > 0) : false;
    if (none) $('#overlay-legend').textContent += kind.value === 'radiation' ? ' 지금은 방사능이 남은 땅이 없습니다.' : ' 이 도시에는 아직 이 교통망이 없습니다.';
    // Land value comes from water and height alone: a flat, dry town shows nothing, so say why.
    const flat = kind.value === 'landValue' && !city.fields.landValue.some((v) => v >= 1);
    if (flat) $('#overlay-legend').textContent = '땅값은 물가와 주변보다 높은 땅에서 오릅니다. 이 지도에는 그런 땅이 없어 어디나 0입니다.';
    // A colour scale for the graded views (the same ramps the map paints).
    const heat = 'linear-gradient(90deg, rgb(220,60,60), rgb(220,220,60), rgb(50,220,60))';
    // The coverage views' blue (render.ts coverage).
    const cover = 'linear-gradient(90deg, rgba(40,110,230,0.12), rgba(40,110,230,0.65))';
    const scale = ({
      desirability: [heat, '0', '150+'], mayor: [heat, '−60', '+60'], health: [cover, '없음', '좋음'], school: [cover, '없음', '좋음'],
      hq: [heat, '0', '200'], commute: ['linear-gradient(90deg, rgb(50,220,60), rgb(220,220,60), rgb(220,60,60))', '빠름', '2.5시간'], eq: [heat, '0', '200'], flammability: ['linear-gradient(90deg, rgb(50,220,60), rgb(220,220,60), rgb(220,60,60))', '안전', '위험'],
      traffic: ['linear-gradient(90deg, rgb(80,200,60), rgb(255,30,60))', '원활', '용량 2배'],
      landValue: ['linear-gradient(90deg, rgba(120,40,160,0.05), rgba(120,40,160,0.7))', '0', '50'],
      air: ['linear-gradient(90deg, rgba(90,70,40,0.05), rgba(90,70,40,0.75))', '깨끗', '오염'],
      waterPollution: ['linear-gradient(90deg, rgba(120,85,45,0.05), rgba(120,85,45,0.75))', '깨끗', '오염'],
      police: [cover, '약함', '강함'], fire: [cover, '약함', '강함'],
      crime: ['linear-gradient(90deg, rgba(220,30,30,0.05), rgba(220,30,30,0.75))', '적음', '많음'],
      age: ['linear-gradient(90deg, rgb(250,235,160), rgb(30,70,220))', '18세', '80세'],
      subway: ['linear-gradient(90deg, rgb(60,150,220), rgb(250,90,60))', '한산', '혼잡'],
      wear: ['linear-gradient(90deg, rgb(50,220,60), rgb(220,220,60), rgb(220,60,60))', '0 멀쩡함', '50+ 위험'],
    } as Record<string, [string, string, string]>)[kind.value];
    const box = $('#overlay-scale');
    box.hidden = !scale || flat; // (an even map: the note, not a scale nothing on it reaches)
    if (scale) {
      // (Over the map's ground, as the map paints it: over the dark legend, a translucent 적음 end read as black.)
      (box.querySelector('.scale-bar') as HTMLElement).style.backgroundImage = scale[0];
      const [lo, hi] = box.querySelectorAll('.ends span');
      lo!.textContent = scale[1];
      hi!.textContent = scale[2];
    }
    // Categorical views: a swatch per colour the map paints (same colours as render.ts).
    const swatches = ({
      power: [['rgba(255,214,0,0.35)', '전력망에 연결됨'], ['rgba(230,40,40,0.45)', '전기 없는 구역·건물']],
      waterService: [['rgba(20,90,200,0.95)', '수도관'], ['rgba(70,150,255,0.35)', '급수 범위'], ['rgba(255,150,40,0.4)', '관은 있지만 공급 없음'], ['rgba(230,40,40,0.3)', '물 없음']],
      garbage: [['rgba(120,80,30,0.8)', '매립지 (진할수록 가득)'], ['rgba(200,40,40,0.7)', '수거 안 된 쓰레기']],
      zones: [['rgb(80,180,80)', '주거'], ['rgb(70,130,220)', '상업'], ['rgb(220,150,40)', '산업'], ['rgb(190,160,90)', '농업'], ['rgb(130,95,55)', '매립지']],
    } as Record<string, [string, string][]>)[kind.value];
    if (swatches) {
      const note = { zones: '건물을 감추고 구역만 보여 줍니다.', garbage: '처리 여력이 모자라면 쓰레기가 쌓입니다.' }[kind.value as 'zones'] ?? '';
      $('#overlay-legend').innerHTML = swatches.map(([c, label]) => `<span class="swatch-item"><i style="background:${c}"></i>${label}</span>`).join('');
      $('#overlay-legend').title = note;
    }
    if (kind.value === 'growth') {
      // Categorical: one swatch per blocker.
      const seen = new Set<string>();
      // The cap beside plain no-demand, its kin (the engine appends new codes at the end).
      const order = GROWTH_CODES.flatMap((c) => (c === 'capped' ? [] : c === 'noDemand' ? [c, 'capped' as const] : [c]));
      // (Each keyed by its colour: the summary counts the map's tiles by it, so what is not on the map reads faint.)
      $('#overlay-legend').innerHTML = order.filter((c) => !seen.has(GROWTH_COLOR[c]) && seen.add(GROWTH_COLOR[c]))
        .map((c) => `<span class="swatch-item" data-color="${GROWTH_COLOR[c]}"><i style="background:${GROWTH_COLOR[c]}"></i>${c === 'unbuildable' ? '지을 수 없음·가파름' : GROWTH_LABEL[c]}</span>`).join('')
        + `<span class="swatch-item" data-color="${ABANDONED_COLOR}"><i style="background:${ABANDONED_COLOR}"></i>버려진 건물</span>`
        + `<span class="swatch-item" data-color="${RISK_COLOR}"><i style="background:${RISK_COLOR}"></i>버려질 위험</span>`;
      sumSeen = ''; // (the counts go on the new swatches)
    }
    // With a colour scale beside it, the explanation is the legend's tooltip: the scale is what's read.
    const legend = $('#overlay-legend');
    if (!swatches) legend.title = '';
    if (scale && !none && !flat && legend.textContent) {
      legend.title = legend.textContent;
      legend.textContent = '';
    }
    redraw();
    refreshViewSummary();
  };
  kind.onchange = apply;
  const pick = $<HTMLButtonElement>('#view-pick');
  const showGrid = (on: boolean) => {
    // Phones: the bottom cards step aside for the list (it opened behind the city pane).
    if (on && matchMedia('(max-width: 860px)').matches) {
      closePane();
      closeInfo();
    }
    // The views that show what needs a look now (a goal in trouble): a small dot, as the dock marks a 추천.
    if (on) {
      // (Only the view of the one goal the next step is for: a dot on every troubled goal's view said nothing.)
      const hint = new Map<string, string>();
      const lead = nextStep();
      const v = lead.problem && lead.goal ? GOALS[lead.goal].views[0]?.[0] : undefined;
      if (v) hint.set(v, GOALS[lead.goal!].name);
      el.querySelectorAll<HTMLButtonElement>('.vchip').forEach((c) => {
        const g = hint.get(c.dataset.v!);
        c.classList.toggle('hint', !!g);
        c.title = g ? `${g}: 지금 살펴볼 만한 보기` : '';
      });
      let note = el.querySelector<HTMLElement>('.vg-note');
      if (!note) {
        note = document.createElement('p');
        note.className = 'vg-note';
        note.innerHTML = '<i></i>지금 살펴볼 만한 보기';
        $('#view-grid').prepend(note);
      }
      note.hidden = !hint.size;
    }
    $('#view-grid').hidden = !on;
    pick.setAttribute('aria-expanded', String(on));
    $('#map-layer').classList.toggle('picking', on);
  };
  pick.onclick = () => showGrid(pick.getAttribute('aria-expanded') !== 'true');
  $('#view-off').onclick = () => showOverlay('none');
  document.addEventListener('pointerdown', (e) => {
    if (!$('#map-layer').contains(e.target as Node)) showGrid(false);
  }, true); // capture: the map handles its own presses
  el.querySelectorAll<HTMLButtonElement>('.vchip').forEach((c) => (c.onclick = (e) => {
    // A second tap on the view showing turns it off.
    showOverlay(c.dataset.v === kind.value ? 'none' : c.dataset.v!);
    showGrid(false);
    // The keyboard carries on at the picker; after a click, Space is the game's (pause), not the picker's.
    if (e.detail === 0) pick.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  }));
  el.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && pick.getAttribute('aria-expanded') === 'true') {
      showGrid(false);
      pick.focus();
      e.stopPropagation();
    }
  });
  type.onchange = () => {
    apply();
    type.blur();
  };
  apply();
}

/** Whether the per-type tax rates are shown (the classes are always). */
let taxDetail = false;

/** Each tax row's redraw (rate and its demand effect, which moves month to month). */
const rows = new Map<string, () => void>();

/** Refreshes the tax rows: the per-type demand effect changes with the city and the 90-day rate memory. */
export function refreshTaxes(): void {
  rows.forEach((f) => f());
  const note = document.getElementById('tax-note');
  if (note) note.textContent = taxNote();
}

// (One line; the rest is its tooltip: a paragraph under the rates said it every time the screen opened.)
const taxNote = () => `중립 세율 ${city.demand.neutralTax.toFixed(1)}% (막대의 눈금) · 낮추면 수요↑, 올리면 수요↓`;
const TAX_DETAIL = '중립 세율보다 낮으면 수요가 최대 35% 커지고, 높으면 줄어들며, 많이 올리면 수요가 마이너스로 돌아섭니다(영향 −100% 넘음). 올린 세율은 90일간 기억됩니다.';

export function buildTaxes(): void {
  const el = $('#taxes');
  el.innerHTML = '';
  rows.clear();
  const row = (label: string, title: string, get: () => number, set: (v: number) => void, income?: () => number, effect?: () => number) => {
    const div = document.createElement('div');
    div.className = 'tax-row';
    // − and + step half a point (touch screens show them: a drag on a short slider jumped by points).
    div.innerHTML = `<span>${label}</span><input type="range" min="0" max="20" step="0.5" aria-label="${title} 세율"><span class="tax-out"><button type="button" class="tax-step" data-d="-0.5" aria-label="${title} 세율 0.5%p 내리기">−</button><span></span><button type="button" class="tax-step" data-d="0.5" aria-label="${title} 세율 0.5%p 올리기">+</button></span><small class="tax-effect"></small>`;
    const input = div.querySelector('input')!;
    const out = div.querySelector('.tax-out > span')!;
    div.querySelectorAll<HTMLButtonElement>('.tax-step').forEach((b) => (b.onclick = () => {
      input.value = String(Math.max(0, Math.min(20, Math.round((get() + Number(b.dataset.d)) * 2) / 2)));
      input.dispatchEvent(new Event('input'));
    }));
    const fx = div.querySelector<HTMLElement>('.tax-effect')!;
    const show = () => {
      const v = get();
      input.value = String(v);
      // The neutral rate as a tick on the track: left of it demand grows, right of it it shrinks.
      input.dataset.mark = city.demand.neutralTax.toFixed(1);
      input.title = `눈금: 중립 세율 ${city.demand.neutralTax.toFixed(1)}% (이보다 낮으면 수요가 늘고, 높으면 줄어듭니다)`;
      fillRange(input);
      out.textContent = `${v.toFixed(1)}%`;
      // What the rate does to this type's demand (SC4's tax effect, +35% to −350%).
      const e = effect ? Math.round(effect() * 100) : 0;
      // Under the slider, the row's full width (in the label column it wrapped).
      // (Red only past −100%, where demand turns round: a usual rate's dent reads as plain fact.)
      fx.className = `tax-effect ${e <= -100 ? 'neg' : e > 0 ? 'pos' : ''}`;
      fx.title = '세율 때문에 수요가 그 크기의 몇 %만큼 늘거나 줄어드는지(−100%를 넘으면 수요가 마이너스로 돌아섬)';
      fx.textContent = e ? `수요 영향 ${e > 0 ? '+' : '−'}${Math.abs(e)}%` : '';
    };
    // Last month's take, and roughly what one point more would add (same tax base); read on hover.
    if (income) div.onpointerenter = () => {
      const take = income();
      const v = get();
      div.title = take > 0 && v > 0 ? `지난달 §${fmt(take)} · 1%p 올리면 월 약 +§${fmt(take / v)} (수요가 줄 수 있음)` : '';
    };
    input.oninput = () => {
      set(Number(input.value));
      rows.forEach((f) => f());
      updatePanels();
    };
    show();
    rows.set(title, show);
    return div;
  };
  // One slider per class sets all its wealth levels (SC4's R / C / I sliders); the average shows.
  for (const [k, name] of [['R', '주거'], ['C', '상업'], ['I', '산업']] as const) {
    const types = DEV_TYPES.filter((t) => t[0] === k);
    el.append(row(`<b>${name}</b>`, name,
      () => types.reduce((a, t) => a + city.state.taxRates[t], 0) / types.length,
      (v) => types.forEach((t) => choice('세율', () => city.setTaxRate(t, v))),
      () => types.reduce((a, t) => a + (city.state.lastBudget?.taxByType[t] ?? 0), 0),
      // The class's strongest effect (most negative, else most positive).
      () => {
        const fx = types.map((t) => city.demand.taxEffect[t]);
        return Math.min(...fx) < 0 ? Math.min(...fx) : Math.max(...fx);
      }));
  }
  const detail = document.createElement('details');
  detail.open = taxDetail;
  detail.ontoggle = () => (taxDetail = detail.open);
  detail.innerHTML = '<summary>소득·유형별 세율</summary>';
  // (In words, as the demand bars name them: the codes R$, Cs$$ led each row with the words small under them.)
  for (const t of DEV_TYPES) detail.append(row(TYPE_SHORT[t], TYPE_NAME[t], () => city.state.taxRates[t], (v) => choice('세율', () => city.setTaxRate(t, v)), undefined, () => city.demand.taxEffect[t]));
  el.append(detail);
  const note = document.createElement('p');
  note.className = 'legend';
  note.id = 'tax-note';
  note.title = TAX_DETAIL;
  note.textContent = taxNote();
  el.append(note);
}

/** Map-only view: hides the tool column and side panel (desktop), and back. */
export function toggleFocus(): void {
  const app = $('#app');
  const on = app.classList.toggle('focus');
  $('#btn-focus').setAttribute('aria-pressed', String(on));
  $('#btn-focus').innerHTML = icon(on ? 'minimize' : 'maximize');
  const label = on ? '원래 화면으로 (F)' : '지도만 크게 보기 (F)';
  $('#btn-focus').title = label;
  $('#btn-focus').setAttribute('aria-label', label);
  // The map's size changed: let it fit the new space.
  window.dispatchEvent(new Event('resize'));
}

/** Switches the map to a data view by its menu value (from an advisor's 보기). */
export function showOverlay(value: string): void {
  const kind = $<HTMLSelectElement>('#overlay-kind');
  // (A name no view has, from a caller out of date, left the select empty and every frame failed to paint.)
  if (![...kind.options].some((o) => o.value === value)) return;
  kind.value = value;
  kind.dispatchEvent(new Event('change'));
}

/** The data view O brings back (the last one shown). */
let lastView = 'desirability';

/** O: shows the last data view, or hides the one showing. */
export function toggleOverlay(): void {
  const kind = $<HTMLSelectElement>('#overlay-kind');
  if (kind.value !== 'none') lastView = kind.value;
  showOverlay(kind.value === 'none' ? lastView : 'none');
}

/** [ and ]: the view before or after the one showing, in the picker's order. */
export function stepOverlay(by: number): void {
  const views = [...document.querySelectorAll<HTMLButtonElement>('#view-grid .vchip')].map((c) => c.dataset.v!);
  if (!views.length) return;
  const at = views.indexOf($<HTMLSelectElement>('#overlay-kind').value);
  const next = views[at < 0 ? (by > 0 ? 0 : views.length - 1) : (at + by + views.length) % views.length]!;
  showOverlay(next);
  flash(`지도 보기: ${document.querySelector(`#view-grid .vchip[data-v="${next}"]`)?.textContent ?? next}`, 'info');
}

/** G: the growth view (what keeps zones empty), or back to no view. */
export function toggleGrowth(): void {
  const kind = $<HTMLSelectElement>('#overlay-kind');
  showOverlay(kind.value === 'growth' ? 'none' : 'growth');
}

/** What the view on shows, counted in a line under its legend (how many go without, how much is jammed). */
let sumSeen = '';
export function refreshViewSummary(): void {
  const box = document.getElementById('overlay-sum');
  if (!box || !city || city.stepping) return; // (built before the first city opens; mid-day the fields are half redone)
  const v = overlay.kind === 'volume' ? '' : overlay.kind;
  const [text, tone, spots] = viewSummary(v);
  sumSpots = spots;
  const key = `${v}|${text}|${tone}`;
  if (key === sumSeen) return;
  if (!sumSeen.startsWith(`${v}|`)) sumNext = 0; // (a count moving as the days go doesn't send 찾아가기 back to the first)
  sumSeen = key;
  box.hidden = !text;
  box.className = `overlay-sum${tone ? ` ${tone}` : ''}`;
  // Where some go without: a way to each of them in turn.
  box.innerHTML = `<span>${text}</span>${spots.length ? '<button type="button" class="link sum-go" title="하나씩 차례로 지도에서 보기">찾아가기</button>' : ''}`;
  box.querySelector<HTMLButtonElement>('.sum-go')?.addEventListener('click', () => {
    if (!sumSpots.length) return;
    const i = sumSpots[sumNext++ % sumSpots.length]!;
    revealMap();
    const [x, y] = [i % city.size, Math.floor(i / city.size)];
    centerOn(x, y);
    blinkAt(x - 1, y - 1, 3, 3); // (what was found, marked once the map lands)
  });
}
let sumSpots: number[] = [];
let sumNext = 0;

/** The summary of a view that scans the whole map, kept for a week of game time or until the city changes. */
const SCANNED = new Set(['crime', 'air', 'waterPollution', 'garbage', 'commute', 'wear']);
let scanMemo: { key: string; out: [string, '' | 'bad' | 'good', number[]] } | null = null;

/**
 * What a view finds wrong now, in words ('' when nothing is): the build cards' service headings say it too. Kept per
 * view for the week or until the city changes (the headings are redone with every panel update, and shared the
 * legend's one kept count, so both scanned the map each time), and not worked out while a day is part-way.
 */
export function viewProblem(v: string): string {
  const key = changeKey();
  const had = problemMemo.get(v);
  if (had && (had.key === key || city.stepping)) return had.text;
  if (city.stepping) return '';
  const [text, tone] = viewSummaryNow(v);
  const out = tone === 'bad' ? text : '';
  problemMemo.set(v, { key, text: out });
  return out;
}
const problemMemo = new Map<string, { key: string; text: string }>();

function viewSummary(v: string): [string, '' | 'bad' | 'good', number[]] {
  if (!SCANNED.has(v)) return viewSummaryNow(v);
  const key = `${v}|${cityGeneration}|${city.revision}|${Math.floor(city.state.day / 7)}`;
  if (scanMemo?.key !== key) scanMemo = { key, out: viewSummaryNow(v) };
  return scanMemo.out;
}

function viewSummaryNow(v: string): [string, '' | 'bad' | 'good', number[]] {
  const s = city.state;
  const f = city.fields;
  const n = s.size;
  const blds = [...s.buildings.values()].filter((b) => b.type);
  // (Not the growth view: zones painted and nothing grown yet is when it is wanted most.)
  if (!blds.length && v !== 'growth') return ['', '', []];
  const mid = (b: { x: number; y: number; w: number; h: number }) => (b.y + (b.h >> 1)) * n + b.x + (b.w >> 1);
  const lacking = (list: { x: number; y: number; w: number; h: number }[], what: string, all: string): [string, '' | 'bad' | 'good', number[]] =>
    (list.length ? [`${what} ${fmt(list.length)}채`, 'bad', list.map(mid)] : [all, 'good', []]);
  const homes = blds.filter((b) => b.type![0] === 'R');
  switch (v) {
    case 'power': return lacking(blds.filter((b) => !b.powered), '전기 없는 건물', '모든 건물에 전기가 들어옵니다');
    case 'waterService': {
      // (Only those past the stage that needs water count against it: the advisor's count is every building cut off.)
      const dry = blds.filter((b) => !b.watered);
      const need = dry.filter((b) => b.stage > city.cfg.services.waterStageCap[b.type!]);
      // (Dry, none of them past that stage yet: said as that, not as all well — beside the screen's 물 없는 건물 26채 and
      // its 양수 시설이 없어…, 물이 필요한 건물 모두에 닿습니다 read as though there were water.)
      if (!need.length && dry.length) return [`물 없는 건물 ${fmt(dry.length)}채 · 아직은 물 없이 자라는 단계 (더 크려면 물이 필요)`, '', dry.map(mid)];
      return lacking(need, '물이 필요한데 끊긴 건물', '물이 필요한 건물 모두에 닿습니다');
    }
    case 'police': return lacking(blds.filter((b) => !(f.policeCover[mid(b)]! > 0)), '경찰이 닿지 않는 건물', '모든 건물이 경찰 범위 안입니다');
    case 'fire': return lacking(blds.filter((b) => !(f.fireCover[mid(b)]! > 0)), '소방이 닿지 않는 건물', '모든 건물이 소방 범위 안입니다');
    case 'health': return lacking(homes.filter((b) => !(f.hospitalCover[mid(b)]! > 0)), '병원이 닿지 않는 집', '모든 집이 병원 범위 안입니다');
    case 'school': return lacking(homes.filter((b) => !(f.schoolQuality[mid(b)]! > 0)), '학교가 닿지 않는 집', '모든 집이 학교 범위 안입니다');
    // (The worst first for 찾아가기, one spot a neighbourhood: a jam of red tiles was a press per tile.)
    case 'crime': {
      const hot = worstSpots(n, (i) => s.crime[i]!, 2);
      return hot.count ? [`범죄가 잦은 곳 ${fmt(hot.count)}칸`, 'bad', hot.spots] : ['범죄가 잦은 곳이 없습니다', 'good', []];
    }
    case 'air': {
      const hot = worstSpots(n, (i) => (s.zone[i]! >= 1 && s.zone[i]! <= 3 ? f.air[i]! : 0), 40);
      return hot.count ? [`공기 나쁜 주거지 ${fmt(hot.count)}칸 (대기 오염 40 넘음)`, 'bad', hot.spots] : ['주거지 공기는 괜찮습니다', 'good', []];
    }
    case 'waterPollution': {
      // (Homes where it hurts: past 100, residents count it against their health and the mayor. Pumps stop only past
      // the engine's far higher limit, said apart.)
      const hot = worstSpots(n, (i) => (s.zone[i]! >= 1 && s.zone[i]! <= 3 ? f.waterPollution[i]! : 0), 100);
      const limit = city.cfg.services.pumpPollutionLimit;
      // (Any tile of its lot past the limit stops it, as the engine counts it.)
      const over = (st: { x: number; y: number; w: number; h: number }) => {
        for (let y = st.y; y < st.y + st.h; y++) for (let x = st.x; x < st.x + st.w; x++) if (f.waterPollution[y * n + x]! > limit) return true;
        return false;
      };
      const fouled = [...s.structures.values()].filter((st) => STRUCTURES[st.kind].pump && over(st)).length;
      const pumps = fouled ? ` · 오염으로 멈춘 펌프 ${fmt(fouled)}곳` : '';
      return hot.count || fouled ? [`수질 오염이 심한 주거지 ${fmt(hot.count)}칸 (100 넘음)${pumps}`, 'bad', hot.spots] : ['주거지 수질은 괜찮습니다', 'good', []];
    }
    case 'garbage': {
      let tons = 0;
      const hot = worstSpots(n, (i) => (s.zone[i] === 10 ? 0 : (tons += s.garbage[i]! > 0.1 ? s.garbage[i]! : 0, s.garbage[i]!)), 0.1);
      return hot.count ? [`쓰레기가 쌓인 곳 ${fmt(hot.count)}칸 · 모두 ${fmt(tons)} t`, 'bad', hot.spots] : ['쌓인 쓰레기가 없습니다', 'good', []];
    }
    case 'commute': {
      const limit = city.cfg.transport.tripLimit;
      const far = blds.filter((b) => (b.type![0] === 'R' || b.type![0] === 'I') && (b.commute < 0 || b.commute > limit));
      return lacking(far, '2.5시간 안에 일터·목적지가 없는 건물', '모든 집과 공장이 2.5시간 안에 닿습니다');
    }
    case 'wear': {
      const hot = worstSpots(n, (i) => Math.max(s.power[i] ? s.lineWear[i]! : 0, s.pipe[i] ? s.pipeWear[i]! : 0), 50);
      return hot.count ? [`낡은 송전선·수도관 ${fmt(hot.count)}칸 (불꽃·파열 위험)`, 'bad', hot.spots] : ['낡은 송전선·수도관이 없습니다', 'good', []];
    }
    case 'traffic': {
      const jams: number[] = [];
      for (let i = 0; i < n * n; i++) {
        const k = NETWORK_KINDS[s.net[i]!];
        const cap = k ? city.cfg.transport.speed[k]?.capacity : 0;
        if (cap && f.traffic[i]! > cap) jams.push(i);
      }
      // (A stretch a stop: every eighth jammed tile, so the next press moves on along the jam.)
      return jams.length ? [`용량을 넘어 막힌 길 ${fmt(jams.length)}칸`, 'bad', jams.filter((_, k) => k % 8 === 0)] : ['막힌 길이 없습니다', 'good', []];
    }
    case 'growth': {
      // (Worked out once a month or edit: the growth map is the whole map's.)
      const key = `${cityGeneration}|${city.revision}|${Math.floor(s.day / 30)}`; // (the generation: an undo or another save restarts the revision)
      if (growthSum.key !== key) {
        const map = growthNow(city);
        if (!map) return ['', '', []]; // (not worked out yet: nothing rather than a wrong all-clear)
        const held: number[] = [];
        // Tiles by the colour the map paints them (the legend's key), and the blockers by how many they hold.
        const byColor = new Map<string, number>();
        const byCode = new Map<string, number>();
        const add = <K,>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
        for (let i = 0; i < map.length; i++) {
          if (!map[i] || s.occupant[i]) continue;
          const code = GROWTH_CODES[map[i]! - 1]!;
          add(byColor, GROWTH_COLOR[code]);
          if (code === 'waiting') continue;
          held.push(i);
          add(byCode, code);
        }
        for (const b of s.buildings.values()) {
          if (!b.type) add(byColor, ABANDONED_COLOR);
          else if (buildingRisk(b)) add(byColor, RISK_COLOR);
        }
        // The blockers that hold the most, in words: what to fix first (two at most).
        const ranked = [...byCode].sort((a, b) => b[1] - a[1]);
        const name = (c: string) => GROWTH_LABEL[c as (typeof GROWTH_CODES)[number]];
        const top = ranked.length === 1 ? [`모두 ${name(ranked[0]![0])}`] : ranked.slice(0, 2).map(([c, k]) => `${name(c)} ${fmt(k)}`);
        growthSum = { key, held, byColor, top };
      }
      markLegend(growthSum.byColor);
      const h = growthSum.held;
      if (!h.length && !growthSum.byColor.size) return ['', '', []]; // (no zones at all: no all-clear to give)
      if (h.length) return [`개발이 막힌 빈 구역 ${fmt(h.length)}칸 · ${growthSum.top.join(' · ')}`, 'bad', h.filter((_, k) => k % 8 === 0)];
      // A cap holds a class back city-wide while its zones still take the others: no tile reads as held, and
      // 막힌 빈 구역이 없습니다 sat beside 주거 상한 in red. (The farms' cap counts other jobs: not one to lift.)
      // (Held at the cap as the pane and the growth screen say it, with people waiting to come.)
      const held = DEV_TYPES.filter((t) => t !== 'IA' && capped(t) && city.demand.raw[t] > 0);
      return held.length ? [`${held.map((t) => TYPE_NAME[t]).join('·')} 인구가 상한에 닿아 빈 구역이 더 차지 않습니다`, 'bad', []] : ['막힌 빈 구역이 없습니다', 'good', []];
    }
    default: return ['', '', []];
  }
}
let growthSum: { key: string; held: number[]; byColor: Map<string, number>; top: string[] } = { key: '', held: [], byColor: new Map(), top: [] };

/**
 * Tiles where `value` reaches `at`: how many, and up to 24 places to go to, the worst first, each at least 6 tiles
 * from the ones before (one a neighbourhood).
 */
function worstSpots(n: number, value: (i: number) => number, at: number): { count: number; spots: number[] } {
  const over: [number, number][] = [];
  for (let i = 0; i < n * n; i++) {
    const v = value(i);
    if (v >= at) over.push([i, v]);
  }
  over.sort((a, b) => b[1] - a[1]);
  const spots: number[] = [];
  for (const [i] of over) {
    if (spots.length >= 24) break;
    const [x, y] = [i % n, Math.floor(i / n)];
    if (spots.some((j) => Math.max(Math.abs((j % n) - x), Math.abs(Math.floor(j / n) - y)) < 6)) continue;
    spots.push(i);
  }
  return { count: over.length, spots };
}

/** A categorical legend against the map: each swatch with how many tiles show it, faint where none do. */
function markLegend(byColor: Map<string, number>): void {
  for (const item of document.querySelectorAll<HTMLElement>('#overlay-legend .swatch-item[data-color]')) {
    const k = byColor.get(item.dataset.color!) ?? 0;
    item.classList.toggle('absent', !k);
    let count = item.querySelector('small');
    if (k && !count) item.append((count = document.createElement('small')));
    if (count) count.textContent = k ? fmt(k) : '';
    // A colour on the map is a way to its tiles: pressed, the map goes to the next one of them.
    if (k) {
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      item.title = `${item.textContent?.replace(/\d[\d,]*$/, '').trim()}: 눌러서 이런 곳 하나씩 찾아가기`;
    } else {
      item.removeAttribute('role');
      item.removeAttribute('tabindex');
      item.title = '';
    }
  }
}

/** The tiles the growth view paints a colour (a blocker's empty zone tiles; abandoned or failing buildings), for 찾아가기. */
function tilesOfColor(color: string): number[] {
  const s = city.state;
  const n = s.size;
  if (color === ABANDONED_COLOR || color === RISK_COLOR) {
    return [...s.buildings.values()].filter((b) => (color === ABANDONED_COLOR ? !b.type : !!b.type && !!buildingRisk(b)))
      .map((b) => (b.y + (b.h >> 1)) * n + b.x + (b.w >> 1));
  }
  const map = growthNow(city);
  if (!map) return [];
  const out: number[] = [];
  for (let i = 0; i < map.length; i++) if (map[i] && !s.occupant[i] && GROWTH_COLOR[GROWTH_CODES[map[i]! - 1]!] === color) out.push(i);
  // (A stretch a stop: every eighth tile, so the next press moves on along a run of them, as 찾아가기 does.)
  return out.filter((_, k) => k % 8 === 0);
}
const legendNext = new Map<string, number>();

/** A press on a counted swatch of the growth view's legend: the map goes to the next tile of its colour. */
function legendGo(e: Event): void {
  const item = (e.target as HTMLElement).closest<HTMLElement>('#overlay-legend .swatch-item[data-color][role="button"]');
  if (!item) return;
  if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  const color = item.dataset.color!;
  const tiles = tilesOfColor(color);
  if (!tiles.length) return;
  const k = legendNext.get(color) ?? 0;
  legendNext.set(color, k + 1);
  const i = tiles[k % tiles.length]!;
  const [x, y] = [i % city.size, Math.floor(i / city.size)];
  revealMap();
  centerOn(x, y);
  blinkAt(x - 1, y - 1, 3, 3);
}

