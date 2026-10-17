// The map's controls that are not tools: the clock (its speeds, a touch screen's 시간 card), the city pane's 도시, night
// view, help, the map view's legend card, the top buttons' fit (and the month round the clock) and the tax sliders.

import { DEV_TYPES, type DevType, GROWTH_CODES, NETWORK_KINDS, STRUCTURES } from '@web-city/engine';
import { icon, type IconName } from './icons';
import { openGoal, taxesCutting } from './manage';
import { fillRange } from './widgets';
import { TYPE_NAME, TYPE_SHORT } from './names';
import { updatePanels } from './panels';
import { type Overlay, type VolumeNetwork } from './render';
import { ABANDONED_COLOR, buildingRisk, GROWTH_COLOR, GROWTH_LABEL, growthNow, RISK_COLOR, volumeAt } from './views';
import { centerOn, pingAt, changeKey, city, cityGeneration, overlay, overlayType, redraw, renderer, setOverlay, setOverlayType, setSpeedValue, speed } from './state';
import { selectTool, SPEEDS, TOOL_KEYS, toolName, TOOLS } from './tools';
import { drive } from './udi';
import { revealMap } from './tabs';
import { $, flash, fmt, keyLabel } from './util';
import { choice } from './choices';
import { type GoalId } from './goals';
import { capped, incidents } from './readings';

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
  // (A state, as the menu's other switches say theirs: 밤 풍경 ↔ 낮 풍경 named the action and read as the state.)
  btn.innerHTML = `${icon('moonStar')}<span class="menu-label">밤 풍경: ${renderer.night ? '켬' : '끔'}</span>`;
  btn.setAttribute('aria-pressed', String(renderer.night));
  btn.title = '밤 풍경 켜기·끄기 (N)';
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
  // (Where things are follows the layout, not the pointer: a touch tablet wider than a phone has the wide one.)
  const wide = !matchMedia('(max-width: 860px)').matches;
  // (The building bar along the foot either way; the city, the clock and the menu along the top with the areas' chips
  // under them — in the middle wide, across a phone's top.)
  const build = '아래 막대';
  const menuAt = wide ? '위 가운데의 <b>메뉴</b>(⋯)' : '화면 위 오른쪽의 <b>메뉴</b>(⋯)';
  const cityAt = wide ? '왼쪽 맨 위의 <b>도시 버튼</b>(트로피와 도시 이름·단계·인구)' : '화면 위 왼쪽의 <b>도시 버튼</b>(트로피와 도시 이름·단계)';
  // (The areas' buttons: down the map's left wide, a row of chips under a phone's top buttons.)
  const areasAt = wide ? '왼쪽 줄의 분야 버튼' : '화면 위 둘째 줄의 분야 칩';
  const map = touch
    ? `<dt>끌기</dt><dd>고른 도구로 짓기 (도로·구역·송전선 등)</dd>
      <dt>도구 없이 끌기</dt><dd>지도 이동 · 살짝 누르면 조회</dd>
      <dt>두 손가락 끌기</dt><dd>지도 이동</dd>
      <dt>두 손가락 벌리기·모으기</dt><dd>확대·축소 (끌면서 함께 해도 됨)</dd>
      <dt>끄는 중에 두 번째 손가락</dt><dd>짓기 취소 (지도 이동으로 바뀜)</dd>
      <dt>시설 누르기</dt><dd>자리를 미리 보여 주고 그 카드의 <b>여기에 짓기</b>를 눌러야 지어짐</dd>`
    : `<dt>끌기</dt><dd>고른 도구로 짓기 (도로·구역·송전선 등)</dd>
      <dt>도구 없이 끌기</dt><dd>지도 이동 · 클릭하면 조회</dd>
      <dt>오른쪽 버튼</dt><dd>끌면 지도 이동 · 누르기만 하면 도구 내려놓기</dd>
      <dt>터치패드 두 손가락 끌기</dt><dd>지도 이동</dd>
      <dt>터치패드 벌리기·모으기 · 휠</dt><dd>확대·축소</dd>`;
  // Tips by what they answer: a title to scan, the words under it (fourteen paragraphs in a row went unread).
  const tips: [string, string][] = touch ? [
    ['끄는 동안 보이는 것', '끄는 동안 손가락 위에 칸 수와 비용이, 화면 아래에 자세한 내용이 나오고, 지을 수 없으면 빨갛게 이유를 알려 줍니다(구역은 함께 놓일 골목 자리까지 미리 보임).'],
    ['같은 묶음의 다른 도구', '도구를 든 동안 지도 아래쪽 줄에서 다른 도로 종류·밀도·시설 종류로 바로 바꿀 수 있습니다. 도구 카드 위의 찾기 칸에 이름(예: 소방서)을 쓰면 어느 묶음에 있든 찾아 주고, 최근 쓴 도구도 거기 모여 있습니다.'],
    ['짓기 메뉴와 도구 카드', `${build}에서 교통·개발 구역·에너지 같은 묶음을 누르면 그 위로 도구 카드가 ${wide ? '열리고' : '올라오고'}, 종류를 누르면 됩니다. 카드가 열린 채 지도를 누르면 카드만 접힙니다(그 누름으로는 짓지 않음). 묶음 이름 옆에는 지금 모자란 것(닿지 않는 건물 수, 구역 수요)이 나옵니다. 시설을 고르면 지도에 <b>추천 자리</b> 과녁이(구역은 블록 테두리, 송전선·수도관은 점선 길이) 나오고, 화면 밖이거나 시트 아래면 가장자리의 파란 화살표를 눌러 그곳으로 갑니다. 놓을 자리를 누르면 든 도구의 막대 위 안내에 그 자리에서 새로 닿는 건물 수가 나옵니다.`],
    ['칸 정보 보기', `도구를 들지 않은 채 칸을 살짝 누르면 ${wide ? '오른쪽에 정보 카드가 나옵니다' : '아래에서 정보 카드가 올라옵니다'}. 건물·길을 누르면 그곳을 오가는 길이 지도에 그려지고, 집이면 주민 생각도 함께 나옵니다. 문제가 있는 시설의 카드에는 고치는 버튼(옆에 하나 더 짓기, 예산 100%로 등)이 함께 나옵니다.`],
    ['조언의 보기·+ 버튼', '조언·알림의 <b>보기</b>를 누르면 지도가 그 장소로 옮겨 갑니다. <b>+ 학교</b>처럼 생긴 버튼은 그 문제를 고칠 도구를 바로 골라 줍니다.'],
    ['철거와 구역 해제', `<b>철거</b>(${build}의 맨 끝)를 누르면 바로 손에 들리고, 다시 누르면 내려놓습니다. 끌면 그 안의 건물·시설·도로·송전선·잔해를 헐고, 아직 건물이 들어서지 않은 구역에서 끌기 시작하면 그 구역을 해제합니다(안의 건물은 그대로). 지은 것과 헌 것은 되돌릴 수 없으니 끌 때 나오는 칸 수와 비용을 보고 놓으세요.`],
    ['건물이 안 들어설 때', '건물이 안 들어서면 빈 구역 칸을 눌러 보세요. 전기·도로·일터 연결·수요·쾌적도 중 무엇이 막는지 알려 줍니다.'],
    ['도시 현황', `${cityAt}을 누르면 <b>도시 현황</b>이 ${wide ? '왼쪽에 열리고(다시 누르면 닫히고, 관리 화면이 떠 있으면 도시 현황으로 돌아옴)' : '아래에서 올라오고'}, 맨 위에 도시의 크기와 다음 보상이, 그 아래 도시 상태(재정·시장 평점·개발·전력 등 모든 분야)가 보이고, 누르면 그 관리 화면과 통계가 나옵니다. 도시 버튼 테두리의 금색 선은 다음 단계까지 온 만큼입니다. ${areasAt}${wide ? '(분야마다 지금 수치, 급한 곳은 빨강·주의할 곳은 주황에 이유까지)' : '(급한 곳은 빨강, 주의할 곳은 주황)'}을 누르면 그 관리 화면이 바로 열립니다. 세율·예산·대출·조례는 도시 상태의 <b>재정·정책</b>에서 바꿉니다. 도시 현황 맨 위의 <b>지역 › 도시 이름</b>에서 지역을 누르면 지역 시트가, 도시 이름을 누르면 이름 바꾸기가 열립니다. 저장·불러오기·테마는 ${menuAt}에 있습니다.`],
    ['도시 상태 읽기', `<b>도시 상태</b>에서 조치가 필요한 곳(빨강·주황)을 누르면 그 화면 맨 위에 무엇이 문제인지가, 할 일 맨 앞에 추천 조치가 나오고(어느 탭에서나), 해 보기를 누르면 그 도구가 손에 들리고, <b>추천 자리에 짓기</b>를 누르면 알맞은 빈 땅(서비스가 닿지 않는 곳, 수도관·전력망에 닿는 곳 등)에 바로 지어집니다(매립지·구역은 알맞은 크기로 <b>추천 자리에 N×N 놓기</b>). 과녁이 화면 밖이면 가장자리의 파란 화살표가 그쪽을 가리키고, 누르면 그곳으로 갑니다. 전기·물·도로가 닿지 않는 곳은 지도에 점선으로 그려 둔 가장 짧은 송전선·수도관·도로를 <b>바로 잇기</b>로 한 번에 놓습니다. 예산·조례·대출을 바꾸는 추천은 적용하기·시행하기·빌리기로 바로 바뀝니다(불·폭동은 도시 상태 위에 출동 카드가 먼저 뜹니다). 어느 항목이 조치 필요로 바뀌면 시간이 멈추고(<b>메뉴</b>에서 끄기), 관리 화면에서 한 조치는 3개월 뒤 결과(핵심 수치의 변화)를 알려 줍니다. 도시 상태는 급한 곳(빨강)·살펴볼 곳(주황)이 위에 이유와 함께, 양호한 곳이 아래에 나오고, ▲▼는 지난 3개월의 흐름, "결과 기다리는 중"은 결과를 기다리는 조치입니다. 지나간 알림은 <b>소식</b>에 남고 도시와 함께 저장됩니다.`],
    ['관리 화면과 탭', `${areasAt}이나 도시 현황의 도시 상태(개발·전력·수도·교육 등)에서 항목을 누르면 그 분야의 관리 화면이 열립니다. 맨 위의 탭(교통이면 혼잡·통근·통행량)을 누를 때마다 지도에 알맞은 보기가 켜지고, 그 아래에 점수판(주요 수치·추이 그래프)과 할 일(추천 조치, 지을 것·예산·조례)이 나옵니다. 탭의 빨간 점은 그 부분에 급한 문제가 있다는 뜻입니다.${wide ? ' 그 분야의 버튼을 다시 누르면 도시 현황만 닫히고 버튼은 강조된 채 남아(지도 보기도 그대로), 또 누르면 관리 화면이 다시 열립니다(버튼의 ×는 화면 닫기).' : ' 시설 버튼을 누르면 지도로 넘어가고, 화면 위 둘째 줄의 강조된 칩을 누르면 관리 화면으로 돌아옵니다(칩의 ×는 닫기).'} 지도의 과녁은 서비스가 가장 많이 빠진 곳입니다.`],
    ['불·폭동 출동', '불·폭동은 <b>시민 서비스</b>의 소방 출동·경찰 출동 도구로(또는 도시 상태 위 출동 카드의 출동 준비) 그곳을 누르면 가까운 서에서 차가 갑니다(서의 크기만큼 대수 제한). 불난 건물은 지도에 빨간 원으로, 미니맵에 빨간 점(폭동은 주황 점)으로 보이고, 소방·경찰 범위 보기의 <b>찾아가기</b>가 그곳으로 차례로 데려갑니다. 소방서 반경 안의 불 한두 곳은 소방서가 끄므로 소방 줄이 주황으로만 남고, 반경 밖·세 곳 이상·발전소의 불에는 출동 카드가 뜹니다. 폭동은 경찰차 3대 이상이 모여야 진압되니(막다른 길 제외) 같은 곳을 여러 번 누르세요. 아무것도 짓기 전의 새 도시에서는 지형 편집이 무료입니다.'],
    ['발전소', '발전소는 불타거나 수명이 다하면 폭발합니다: 소방서 반경 안에 두세요.'],
    ['알림·세율·시간', `알림 카드는 누르면 그곳으로 가고, 옆으로 밀면 치워집니다. 재정·정책의 세율은 −·+ 버튼으로 0.5%씩 바꿀 수 있습니다. ${wide ? '시간은 위 가운데 시간 버튼의 멈춤·느리게·보통·빠르게로 바꿉니다(버튼 테두리의 파란 선이 이달이 지나간 만큼).' : '시간은 화면 위의 시간 버튼에서 바꿉니다: 지금 속도를 아이콘으로 보여 주고(테두리의 파란 선은 이달이 지나간 만큼), 누르면 그 아래에 멈춤·느리게·보통·빠르게가 나와 속도를 고릅니다.'} 짓거나 철거하는 도구를 든 동안에는 시간이 잠시 멈춥니다. 제안(해 보기)으로 든 시설은 한 곳에 놓으면 도구가 내려가고 시간이 다시 흐릅니다.`],
  ] : [
    ['키보드로 짓기', '키보드만으로도 지을 수 있습니다: 건설 도구를 들고 방향키로 커서를 옮겨(Shift: 5칸, 지도가 따라감) Enter로 짓습니다. 도로·구역처럼 끌어 짓는 도구는 시작점과 끝점에서 Enter를 한 번씩 누르고, Esc로 취소합니다.'],
    ['끄는 동안 보이는 것', `끄는 동안 그 자리 바로 옆 칩에 칸 수·비용과 걸리는 점이 나오고, 지을 수 없으면 빨갛게 이유를 알려 줍니다(구역은 함께 놓일 골목 자리까지 미리 보임). 도로는 처음 끈 방향으로 먼저 뻗어 꺾이고, Shift를 누르면 곧게 뻗습니다. 짓거나 철거하는 도구를 든 동안에는 시간이 잠시 멈추고, 도구를 내려놓으면 다시 흐릅니다(${wide ? '위 가운데 시간 버튼' : '화면 위 시간 버튼'}에서 속도를 고르거나 Space를 누르면 바로 흐름).`],
    ['같은 묶음의 다른 도구', '도구를 들면 지도 아래쪽에 서는 도구 막대에 그 도구와 같은 묶음의 다른 도구(도로 종류·밀도·시설 종류)가 함께 나와 한 번에 바꿀 수 있습니다(, . 키). 자주 쓰지 않는 도구는 도구 카드의 <b>더 보기</b>에 있습니다. / 키로 도구·시설을 이름으로 찾고 Enter로 바로 고릅니다(세율·대출·범죄처럼 하려는 일을 쓰면 그 관리 화면도 나옵니다).'],
    ['막대와 도구 카드', `${wide ? '지도 왼쪽에는 버튼이 세로로 늘어섭니다: 맨 위 <b>도시 버튼</b>(도시 이름·단계, 인구와 다음 단계까지 온 만큼 — 테두리의 금색 선도 그만큼 · 누르면 도시 현황 열기·닫기), 그 아래 분야마다 버튼(지금 수치와 ▲▼ 지난 3개월, 급한 곳은 빨강·주의할 곳은 주황으로 위에 오고 이유까지). 도시 현황을 열면 이 줄은 아이콘만 남아 그 옆에 섭니다. 위 가운데에는 시간(멈춤·느리게·보통·빠르게 · 0–3, Space; 테두리의 파란 선이 이달이 지나간 만큼, 날짜는 가리키면 나옴)과 <b>메뉴</b>(⋯: 저장·불러오기·조작법·테마)가, 아래 가운데 막대에는 짓기(교통·개발 구역·에너지·서비스·보상·지형·철거)가 있습니다. 조회한 칸은 오른쪽 정보 카드에 나옵니다.' : '화면 위 첫째 줄에는 <b>도시 버튼</b>(도시 이름과 단계 · 테두리의 금색 선이 다음 단계까지 온 만큼 · 누르면 도시 현황), 시간(지금 속도의 아이콘 · 누르면 속도 고르기 · 0–3, Space), <b>메뉴</b>(⋯: 저장·불러오기·조작법·테마) 버튼이, 둘째 줄에는 분야별 상태 칩이, 아래 막대에는 짓기(교통·개발 구역·에너지·서비스·보상·지형·철거)가 있습니다. 시트가 열려 있는 동안에는 위아래가 다 화면 밖으로 들어가고, 그동안 도시 현황 머리의 작은 시계가 달과 속도를 보여 줍니다(누르면 멈춤·이어 하기).'} 도구를 들지 않으면 지도는 그대로 조회입니다. 묶음을 누르면 그 위로 도구 카드가 열리고, 도구를 고르면 아래 막대 위에 든 도구의 막대가 섭니다(카드 안에서는 방향키로 도구를 옮겨 고를 수 있음). 카드의 버튼은 모두 같은 타일로, 아이콘과 이름(시설은 하는 일도) 아래에 <b>짓는 값</b>과 <b>월 유지비</b>가 나옵니다(도로·선·구역은 칸당, 사업 거래는 월 수입 +, 자금이 모자라면 값이 빨강). 시설은 종류의 타일을 바로 누르면 됩니다. 묶음을 누르기만 해서는 도구가 들리지 않고, 카드가 열린 채 지도를 누르면 카드만 접힙니다(그 누름으로는 짓지 않음). 가장 급한 곳의 추천 조치(시작하기가 보이는 동안에는 그다음 단계)가 쓰는 도구의 묶음에는 작은 점이 하나 붙습니다(그 묶음을 열거나 그 도구를 들면, 다음 추천이 바뀔 때까지 꺼짐). 알림은 ${wide ? '지도 오른쪽 아래(아래 막대 위)' : '화면 위 줄들 아래'}에 잠시 떴다가 사라집니다(아랫줄이 남은 시간, 가리키고 있으면 기다림).`],

    ['철거와 구역 해제', `<b>철거</b>(${build}의 맨 끝 · X)를 누르면 바로 손에 들리고, 다시 누르면 내려놓습니다. 끌면 그 안의 건물·시설·도로·송전선·잔해를 헐고, 아직 건물이 들어서지 않은 구역에서 끌기 시작하면 그 구역을 해제합니다(안의 건물은 그대로). 철거를 든 채 마우스를 올리면 그 칸에서 끌면 무엇을 하는지(헐 값, 또는 구역 해제)가 먼저 나옵니다. 지은 것과 헌 것은 되돌릴 수 없으니 끌 때 나오는 칸 수와 비용을 보고 놓으세요.`],
    ['칸 정보 보기', '도구를 들지 않은 채 지도 위에 마우스를 올리면 그 칸이 무엇인지 바로 옆에 나옵니다. 누르면 오른쪽 정보 카드에 자세히 나오고, 두 번 누르면 그곳으로 확대됩니다. 문제가 있는 시설의 카드에는 고치는 버튼(옆에 하나 더 짓기, 예산 100%로 등)이 함께 나옵니다.'],
    ['조언의 보기·+ 버튼', '조언·알림의 <b>보기</b>를 누르면 지도가 그 장소로 옮겨 갑니다. <b>+ 학교</b>처럼 생긴 버튼은 그 문제를 고칠 도구를 바로 골라 줍니다. 오른쪽 위 미니맵을 눌러 이동할 수 있습니다.'],
    ['밀도 올리기 (재개발)', '건물이 선 땅에도 같은 종류의 더 높은 밀도(저 → 중 → 고밀도)를 칠할 수 있습니다. 건물은 그대로 있다가 재개발될 때 새 밀도로 다시 지어집니다.'],
    ['건물이 안 들어설 때', '건물이 안 들어서면 빈 구역 칸을 조회해 보세요. 전기·도로·일터 연결·수요·쾌적도 중 무엇이 막는지 알려 줍니다.'],
    ['지도 보기와 서비스 범위', `지도 보기는 관리 화면의 탭이 켭니다(따로 고르는 목록은 없음): 켜진 보기의 이름과 범례는 ${wide ? '지도 왼쪽 위(왼쪽 줄 옆)의 카드' : '위 두 줄 아래 카드'}에 나오고(이름을 누르면 범례를 접고 펼침), 지도 위에 마우스를 올리면 그 칸의 값이 포인터 바로 옆에 나옵니다. 경찰·소방·병원·학교·발전소·수도 시설을 들면 그 서비스가 닿는 범위 보기가 함께 켜져 빈 곳이 보이고, 놓을 자리에는 반경이 원으로, 포인터 옆에는 그 자리에서 새로 닿는 건물 수가 보입니다. 도구를 들면 지을 만한 땅에 파란 <b>추천 자리</b> 과녁이(구역은 블록 테두리, 송전선·수도관은 점선 길이) 나오고, 시설은 그 원 안 어디를 눌러도 그 자리에 놓입니다. 과녁이 화면 밖이거나 카드에 가리면 가장자리의 화살표를 눌러 그곳으로 갑니다(키보드: <b>S</b>로 커서를 그 자리에). 범례 아래에는 빠진 곳의 수(전기 없는 건물, 막힌 길 등)가 나오고 <b>찾아가기</b>를 누를 때마다 다음 곳으로 옮겨 갑니다.`],
    ['도시 상태 읽기', `<b>도시 상태</b>에서 조치가 필요한 곳(빨강·주황)을 누르면 그 화면 맨 위에 무엇이 문제인지가, 할 일 맨 앞에 추천 조치가 나오고(어느 탭에서나), 해 보기를 누르면 그 도구가 손에 들리고, <b>추천 자리에 짓기</b>를 누르면 알맞은 빈 땅(서비스가 닿지 않는 곳, 수도관·전력망에 닿는 곳 등)에 바로 지어집니다(매립지·구역은 알맞은 크기로 <b>추천 자리에 N×N 놓기</b>). 과녁이 화면 밖이면 가장자리의 파란 화살표가 그쪽을 가리키고, 누르면 그곳으로 갑니다. 전기·물·도로가 닿지 않는 곳은 지도에 점선으로 그려 둔 가장 짧은 송전선·수도관·도로를 <b>바로 잇기</b>로 한 번에 놓습니다. 예산·조례·대출을 바꾸는 추천은 적용하기·시행하기·빌리기로 바로 바뀝니다(불·폭동은 도시 상태 위에 출동 카드가 먼저 뜹니다). 어느 항목이 조치 필요로 바뀌면 시간이 멈추고(${menuAt}에서 끄기), 관리 화면에서 한 조치는 3개월 뒤 결과(핵심 수치의 변화)를 알려 줍니다. 도시 상태는 급한 곳(빨강)·살펴볼 곳(주황)이 위에 이유와 함께, 양호한 곳이 아래에 나오고, ▲▼는 지난 3개월의 흐름, "결과 기다리는 중"은 결과를 기다리는 조치입니다. 지나간 알림은 <b>소식</b>에 남고 도시와 함께 저장됩니다.`],
    ['관리 화면과 탭', `도시 상태(또는 ${areasAt})에서 항목(개발·전력·수도·교육 등)을 누르면 그 분야의 관리 화면이 지금 문제가 있는 탭으로 열립니다. 맨 위의 탭(교통이면 혼잡·통근·통행량)을 누를 때마다, 또는 <b>[</b> <b>]</b> 키로 넘길 때마다 지도에 알맞은 보기가 켜지고, 그 아래에 점수판(주요 수치·추이 그래프)과 할 일(추천 조치, 지을 시설·예산·조례)이 나옵니다. 탭의 빨간 점은 그 부분에 급한 문제가 있다는 뜻이고, 수치 옆 ▲▼는 화면을 연 뒤의 변화입니다. 지도에는 그 분야의 시설이 테두리로, 문제가 가장 많이 모인 곳(서비스가 닿지 않는 곳, 막힌 길, 공기가 나쁜 주거지, 부유층이 살 만한 땅 등)이 과녁으로 표시되고, 짓기 버튼은 지으면 여유가 얼마나 될지 알려 줍니다. ← 또는 Esc로 돌아갑니다(M: 가장 급한 분야).`],
    ['불·폭동 출동', '불·폭동은 <b>시민 서비스</b>의 소방 출동·경찰 출동 도구로(또는 도시 상태 위 출동 카드의 출동 준비) 그곳을 누르면 가까운 서에서 차가 갑니다(서의 크기만큼 대수 제한). 불난 건물은 지도에 빨간 원으로, 미니맵에 빨간 점(폭동은 주황 점)으로 보이고, 소방·경찰 범위 보기의 <b>찾아가기</b>가 그곳으로 차례로 데려갑니다. 소방서 반경 안의 불 한두 곳은 소방서가 끄므로 소방 줄이 주황으로만 남고, 반경 밖·세 곳 이상·발전소의 불에는 출동 카드가 뜹니다. 폭동은 경찰차 3대 이상이 모여야 진압되니(막다른 길 제외) 같은 곳을 여러 번 누르세요. 아무것도 짓기 전의 새 도시에서는 지형 편집이 무료입니다.'],
    ['발전소와 낡은 시설', '발전소는 불타거나 수명이 다하면 폭발합니다: 소방서 반경 안에 두고, 조언자가 수명을 알려 주면 새로 지어 바꾸세요. 송전선·수도관이 낡으면 불꽃·파열이 나니 전력·수도 화면의 <b>노후 송전선</b>·<b>노후 수도관</b> 탭과 부서 예산을 살피세요.'],
    ['재정·지역·저장', `도시 상태의 항목(B: 재정·정책)을 누르면 그 관리 화면과 통계(그래프·보고서)가 나옵니다. 세율·예산·대출·조례는 재정·정책에서 바꿉니다. 도시 현황 맨 위의 <b>지역</b>(J)을 누르면 지역 시트에서 이웃 도시를 보고, 그 옆의 도시 이름(또는 메뉴의 도시 이름 바꾸기)을 눌러 이름을 바꿉니다. ${menuAt}에서 저장·불러오기·테마를 고릅니다.`],
  ];
  // The basic loop in five steps (the getting-started list, in short), then the keys by what they are for.
  // (Each step is also the way to do it: pressed, the help closes on its tool, its screen or the clock.)
  const loop = ([['road', '도로', '지도 가장자리까지 이으면 이웃 도시와 이어짐', 'road'], ['zones', '개발 구역', '길가에 주거·상업·산업을 칠하기', 'R-low'], ['zap', '전기', '발전소를 구역 가까이 (4칸 넘으면 송전선)', 'goal:power'],
    ['droplet', '물', '급수탑이나 양수 펌프, 그리고 수도관 (도시가 커지면)', 'goal:water'], ['play', '시간', wide ? `위 가운데 시간 버튼의 ▶${touch ? '을 눌러' : ' 또는 Space로'} 도시가 자라게` : `화면 위 시간 버튼에서 속도를 ${touch ? '골라' : '고르거나 Space로'} 도시가 자라게`, 'play']] as const)
    .map(([ic, name, what, act], k) => `<li><button type="button" class="loop-step" data-loop="${act}" title="${name}: 눌러서 바로 해 보기">${icon(ic)}<b><span class="loop-n">${k + 1}</span>${name}</b><small>${what}</small></button></li>`).join('');
  const group = (title: string, keys: string, wide = false) => `<section class="key-group${wide ? ' wide' : ''}"><h4>${title}</h4><div class="key-list">${keys}</div></section>`;
  $('#help-body').innerHTML = `
    <h3 class="sub">기본 순서</h3>
    <ol class="help-loop">${loop}</ol>
    <h3 class="sub">지도 다루기</h3>
    <dl class="help-grid">
      ${map}
    </dl>
    <div class="help-keys">
    <h3 class="sub">키보드</h3>
    <div class="key-groups">
      ${group('시간·저장', `${key('Space', '멈춤·이어 하기')}${key('0–3', '속도 (⏸ ▶ ▶▶ ▶▶▶)')}${key(keyLabel('Ctrl+S'), '브라우저에 저장')}`)}
      ${group('화면', `${key('M', '가장 급한 분야의 관리 화면')}${key('[ ]', '열린 분야의 이전·다음 탭 (지도 보기가 함께 바뀜)')}${key('G', '개발·수요의 개발 막힘 탭')}${key('B', '재정·정책 (세율·예산·대출·조례)')}${key('J', '지역 (이웃 도시)')}${key('?', '이 도움말')}${key('Ctrl+Shift+X', '치트 콘솔')}`)}
      ${group('지도', `${key('+ −', '확대·축소')}${key('Home', '도시 전체 보기')}${key('방향키', '지도 이동')}${key('N', '밤 풍경')}`)}
      ${group('도구 다루기', `${key('/', '도구·시설·화면 찾기 (예: 소방서, 세율)')}${key(', .', '같은 묶음의 이전·다음 도구')}${key('`', '직전 도구로 돌아가기')}${key('Shift+끌기', '도로·선로를 곧게')}${key('Enter', '건설 도구: 커서 자리에 짓기 · 그 밖: 가운데 칸 조회')}${key('S', '건설 도구: 커서를 추천 자리(과녁)로')}${key('Esc', '취소 → 카드 닫기 → 도구 내려놓기')}`)}
      ${group('도구 바로 들기', Object.entries(TOOL_KEYS).map(([k, id]) => key(k.toUpperCase(), label(id))).join(''), true)}
    </div>
    <p class="legend">구역 키를 다시 누르면 종류가 바뀝니다(Z·C: 저 → 중 → 고밀도, I: 산업 중밀도 → 고밀도 → 농업). 끄는 중에 오른쪽 버튼을 누르면 취소됩니다.</p>
    </div>
    <h3 class="sub">알아 두면 좋은 것</h3>
    <div class="help-tips">${tips.map(([title, text]) => `<details class="tip"><summary>${title}</summary><p>${text}</p></details>`).join('')}</div>
    <p class="legend">이 창처럼 도움말·저장·새 도시 창이 열려 있는 동안에는 시간이 멈춥니다.</p>
    <p class="legend">처음이라면 ${wide ? '왼쪽 줄의 <b>시작하기</b>를' : '화면 위 둘째 줄의 <b>시작하기</b> 칩을'} 눌러 나오는 순서를 따라 하거나(누르면 그 도구가 골라짐) 예시 도시를 열어 보세요. 도시는 6개월마다, 그리고 탭을 떠날 때 자동 저장됩니다.</p>`;
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

/** A speed's name, as its button says it (멈춤 · 느리게 · 보통 · 빠르게). */
const speedName = (i: number): string => SPEEDS[i]?.title.replace(/ \(.*\)$/, '') ?? '';

/** The speed selector in the clock at the top (on a phone, the card under its one button): ⏸ ▶ ▶▶ ▶▶▶. */
export function buildSpeed(): void {
  for (const el of document.querySelectorAll<HTMLElement>('.gear')) {
    el.innerHTML = '';
    // One choice of four: a radio group, a single Tab stop whose arrows move the speed (four stops before, and no arrows).
    el.setAttribute('role', 'radiogroup');
    SPEEDS.forEach((s, i) => {
      const b = document.createElement('button');
      // (Its name under the icon where the speeds stand in a card — a phone's — and only the icon in the bar.)
      b.innerHTML = `${icon(s.icon)}<span class="speed-label">${speedName(i)}</span>`;
      b.title = s.title;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', speedName(i));
      b.onclick = () => {
        chooseSpeed(i);
        closeClock(); // (a phone's card goes once a speed is picked)
      };
      b.onkeydown = (e) => {
        // (Up and down a row where the speeds stand in rows, and to the next in a single row — the bar's, a phone's card.)
        const cols = getComputedStyle(el).display === 'grid' ? getComputedStyle(el).gridTemplateColumns.split(' ').length : SPEEDS.length;
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? (cols < SPEEDS.length ? cols : 1) : e.key === 'ArrowUp' ? (cols < SPEEDS.length ? -cols : -1) : 0;
        if (!d) return;
        e.preventDefault();
        e.stopPropagation(); // (not the map's arrows as well)
        const j = Math.max(0, Math.min(SPEEDS.length - 1, i + d));
        chooseSpeed(j);
        (el.children[j] as HTMLElement | undefined)?.focus();
      };
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

/** The speed buttons say the clock is only held for building (and comes back by itself). */
function markHeld(): void {
  document.querySelectorAll<HTMLElement>('.gear').forEach((el) => {
    el.classList.toggle('held', heldSpeed !== null);
    el.title = heldSpeed !== null ? '짓는 동안 잠시 멈춤 · 도구를 내려놓으면 다시 흐릅니다' : '';
  });
  markClock();
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
  window.dispatchEvent(new Event('speedchange')); // (a notice that stopped the clock goes when it runs again)
  document.querySelectorAll<HTMLElement>('.gear').forEach((el) => {
    el.querySelectorAll<HTMLButtonElement>('button').forEach((b, k) => {
      b.classList.toggle('active', k === i);
      b.setAttribute('aria-checked', String(k === i));
      b.tabIndex = k === i ? 0 : -1;
    });
    el.dataset.speed = String(i);
  });
  markClock();
}

/** The game's date in words (the engine's months are 30 days, from 2000년 1월). */
export function dateWords(): string {
  if (!city) return '';
  const d = city.state.day;
  const m = Math.floor(d / 30);
  return `${2000 + Math.floor(m / 12)}년 ${(m % 12) + 1}월 ${(d % 30) + 1}일`;
}

/** A phone's clock button, at the top: the speed now by its icon alone (held for building, or stopped), the date and
 *  the speed's name in its title. And the month's ring round the clock, greyed while it is stopped. */
function markClock(): void {
  const btn = document.getElementById('btn-time');
  if (!btn) return;
  const i = Math.max(0, Math.min(SPEEDS.length - 1, speed));
  const held = heldSpeed !== null;
  document.getElementById('clock')?.classList.toggle('stopped', i === 0);
  btn.querySelector('.time-glyph')!.innerHTML = icon(SPEEDS[i]!.icon);
  btn.classList.toggle('stopped', i === 0);
  btn.classList.toggle('held', held);
  markDate();
  markPaneClock();
}

/** The date where the clock tells it, now that it isn't written on it: a phone's clock button's name and title, the
 *  speeds' tooltips and their group's name (wide). */
export function markDate(): void {
  const btn = document.getElementById('btn-time');
  if (!btn || !city) return;
  const i = Math.max(0, Math.min(SPEEDS.length - 1, speed));
  const now = heldSpeed !== null ? '짓는 동안 잠시 멈춤' : i === 0 ? '멈춤' : speedName(i);
  const date = dateWords();
  const label = `시간: ${date}, ${now} · 눌러서 속도 고르기`;
  if (btn.title !== label) {
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
  const gear = document.getElementById('speed');
  if (gear && gear.getAttribute('aria-label') !== `시뮬레이션 속도 · ${date}`) {
    gear.setAttribute('aria-label', `시뮬레이션 속도 · ${date}`);
    // (Each speed's tooltip says the day under its name: the ring round them shows how far the month has gone.)
    gear.querySelectorAll<HTMLButtonElement>('button').forEach((b, k) => (b.title = SPEEDS[k]!.title.replace(/ \(/, ` · ${date}, 테두리의 파란 선이 이달이 지나간 만큼 (`)));
  }
}

/** A phone's clock in the city pane's head (the top buttons are away under it): the month and the speed; pressed, it
 *  stops the clock or lets it go on (as Space does) — the speeds are picked from the top button. */
export function markPaneClock(): void {
  const el = document.getElementById('pane-clock');
  if (!el || !city) return;
  const i = Math.max(0, Math.min(SPEEDS.length - 1, speed));
  const held = heldSpeed !== null;
  const now = held ? '잠시 멈춤' : i === 0 ? '멈춤' : speedName(i);
  const m = Math.floor(city.state.day / 30); // (the engine's months: 30 days, from 2000년 1월)
  const [year, month] = [2000 + Math.floor(m / 12), (m % 12) + 1];
  const html = `${icon(SPEEDS[i]!.icon)}${month}월 · ${now}`;
  if (el.innerHTML !== html) el.innerHTML = html;
  el.classList.toggle('stopped', i === 0);
  const label = `시간: ${year}년 ${month}월, ${now} · 눌러서 ${i === 0 ? `계속 (${speedName(runningSpeed || 1)})` : '멈추기'} — 속도는 화면 위 시간 버튼에서`;
  el.title = label;
  el.setAttribute('aria-label', label);
}

/** A phone's card of the four speeds, under the clock button: open (closed by a pick, a press elsewhere or on the
 *  button again, Esc or back). */
function openClock(open: boolean, keyboard = false): void {
  const box = document.querySelector<HTMLElement>('.mb-time');
  const btn = document.getElementById('btn-time');
  if (!box || !btn) return;
  // (Put away with the keyboard in it — a speed picked with Enter — the focus goes back to the button, not the page.)
  if (!open && box.querySelector('#speed')?.contains(document.activeElement)) btn.focus({ preventScroll: true });
  box.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
  // (Into the card at the speed now, from the keyboard: its arrows move the speed there as in the bar.)
  if (open && keyboard) document.querySelector<HTMLElement>('#speed button.active')?.focus({ preventScroll: true });
}
export const closeClock = (): void => {
  if (document.querySelector('.mb-time.open')) openClock(false);
};

/** The clock button (a phone's): wired once. */
export function setupClock(): void {
  const btn = document.getElementById('btn-time');
  if (!btn) return;
  // A press brings down the four speeds to pick from, and changes nothing itself (a press that also stopped the clock
  // changed the speed before one was chosen); pressed again, they go.
  btn.onclick = (e) => openClock(!document.querySelector('.mb-time.open'), e.detail === 0);
  const inPane = document.getElementById('pane-clock');
  if (inPane) inPane.onclick = () => chooseSpeed(speed > 0 ? 0 : runningSpeed || 1);
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target as Element).closest?.('.mb-time')) closeClock();
  });
  document.querySelector('.mb-time')!.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key !== 'Escape' || !document.querySelector('.mb-time.open')) return;
    e.stopPropagation(); // (Esc puts the card away, not the tool too)
    openClock(false);
    btn.focus();
  });
  markClock();
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

/** A data view's full name, as its legend card heads it ('' for none). */
export const viewName = (v: string): string => VIEW_GROUPS.flatMap(([, , views]) => views).find(([x]) => x === v)?.[2] ?? '';

/**
 * The map's data view, as a goal's tab puts it on (no list of views of its own: each goal's tabs choose theirs, a tool
 * in hand its own): its legend and count in the card under the top buttons, headed by its name.
 */
export function buildOverlay(): void {
  const el = $('#overlay');
  el.innerHTML = `
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
  // Its name folds the legend away and back: a phone's card starts folded (`open` unfolds it), a wider screen's
  // unfolded (`tucked` folds it: with the view's × gone, the way to get the legend off the map).
  title.onclick = () => {
    const card = $('#map-layer');
    const folds = $('#view').classList.contains('fit4');
    const shown = folds ? card.classList.toggle('open') : !card.classList.toggle('tucked');
    title.setAttribute('aria-expanded', String(shown));
  };
  const apply = () => {
    setOverlayType(type.value as DevType);
    setOverlay(kind.value === 'desirability'
      ? { kind: 'desirability', type: overlayType }
      : kind.value.startsWith('volume:')
        ? { kind: 'volume', network: kind.value.slice(7) as VolumeNetwork }
        : ({ kind: kind.value } as Overlay));
    type.style.display = kind.value === 'desirability' ? '' : 'none';
    const off = kind.value === 'none';
    // The view's short name heads the card; what it leaves out (보건 → 병원이 닿는 범위; 개발 막힘 → 빈 구역·버려진 건물)
    // as a quiet line over the legend, not the name said again.
    const short = VIEW_GROUPS.flatMap(([, , views]) => views).find(([v]) => v === kind.value)?.[1] ?? '';
    $('#layer-name').textContent = off ? '' : short;
    const full = kind.selectedOptions[0]?.textContent ?? '';
    // (Only what the name leaves out, in brackets: "통행량: 도로" under 도로 통행량 said it again.)
    const aside = /^.+? \((.+)\)$/.exec(full)?.[1] ?? '';
    const legendEl = $('#overlay-legend');
    if (!off && aside) legendEl.dataset.title = aside;
    else delete legendEl.dataset.title;
    $('#layer-title').title = off ? '' : `지도 보기: ${full} · 범례 펼치기·접기`;
    $('#map-layer').classList.toggle('off', off);
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
      health: '병원 반경 안의 효과(등급 반영): 파랑이 진할수록 좋음. 연빨강 = 병원이 닿지 않는 집(주거 구역·건물; 병원은 집에만 듦).',
      school: '학교 종류별 효과의 평균: 파랑이 진할수록 좋음. 연빨강 = 학교가 닿지 않는 집(주거 구역·건물; 학교는 집에만 듦).',
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
    const none = kind.value !== 'landValue' && viewEmpty(kind.value);
    if (none) $('#overlay-legend').textContent += kind.value === 'radiation' ? ' 지금은 방사능이 남은 땅이 없습니다.' : ' 이 도시에는 아직 이 교통망이 없습니다.';
    // Land value comes from water and height alone: a flat, dry town shows nothing, so say why.
    const flat = kind.value === 'landValue' && !city.fields.landValue.some((v) => v >= 1);
    if (flat) $('#overlay-legend').textContent = '땅값은 물가와 주변보다 높은 땅에서 오릅니다. 이 지도에는 그런 땅이 없어 어디나 0입니다.';
    // A colour scale for the graded views (the same ramps the map paints).
    const heat = 'linear-gradient(90deg, rgb(220,60,60), rgb(220,220,60), rgb(50,220,60))';
    // The coverage views' blue (render.ts coverage).
    const cover = 'linear-gradient(90deg, rgba(40,110,230,0.12), rgba(40,110,230,0.65))';
    // (Its ends in words too where a bare number said nothing of which way is good: −60 · +60 for the mayor's rating.)
    const scale = ({
      desirability: [heat, '0 낮음', '150+ 높음'], mayor: [heat, '−60 불만', '+60 만족'], health: [cover, '없음', '좋음'], school: [cover, '없음', '좋음'],
      hq: [heat, '0 낮음', '200 높음'], commute: ['linear-gradient(90deg, rgb(50,220,60), rgb(220,220,60), rgb(220,60,60))', '빠름', '2.5시간'], eq: [heat, '0 낮음', '200 높음'], flammability: ['linear-gradient(90deg, rgb(50,220,60), rgb(220,220,60), rgb(220,60,60))', '안전', '위험'],
      traffic: ['linear-gradient(90deg, rgb(80,200,60), rgb(255,30,60))', '원활', '용량 2배'],
      landValue: ['linear-gradient(90deg, rgba(120,40,160,0.05), rgba(120,40,160,0.7))', '0 낮음', '50 높음'],
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
    // The coverage views paint a faint red where none reaches — where people live or work, or for hospitals and
    // schools (which are for homes) where people live: said under the scale (it was only in the tooltip).
    const unreached = ({ police: '경찰이', fire: '소방이', health: '병원이', school: '학교가' } as Record<string, string>)[kind.value];
    const where = kind.value === 'health' || kind.value === 'school' ? '집' : '구역·건물';
    if (unreached) legend.innerHTML = `<span class="swatch-item"><i style="background:rgba(230,60,60,0.3)"></i>${unreached} 닿지 않는 ${where}</span>`;
    redraw();
    refreshViewSummary();
    fitMapbar(); // (a longer name may want the room)
  };
  kind.onchange = apply;
  type.onchange = () => {
    apply();
    type.blur();
  };
  apply();
  // The bars fit themselves again when the map's size changes (the window) and when the top buttons' or the chips' do
  // (a longer name, a stage reached, an area turned red): a frame later, so their own change is not a loop.
  let queued = 0;
  const refit = () => (queued ||= requestAnimationFrame(() => {
    queued = 0;
    fitMapbar();
  }));
  const watch = new ResizeObserver(refit);
  for (const part of [$('#view'), $('#mapbar'), $('#rail'), $('#btn-city'), $('#goal-strip')]) watch.observe(part);
  // Across a phone's width the city button and the areas' row change places: down the map's left, or the top rows.
  placeRail();
  matchMedia('(max-width: 860px)').addEventListener('change', () => {
    placeRail();
    refit();
  });
  // (The rings are drawn for their buttons' sizes: again when those change — a phone's one clock button, a new name.)
  const rings = new ResizeObserver((all) => all.forEach((e) => drawRing(e.target as HTMLElement)));
  for (const part of [$('#clock'), $('#btn-city')]) rings.observe(part);
}

/** How far the month has gone, round the clock's edge from its top middle, clockwise (0–100): set every frame from
 *  the days gone and the part of the day under way (main.ts), so it fills as time runs, stops the moment the clock
 *  does, and closes the circle as the month turns. (Eased from the day's whole numbers, it lagged a beat behind
 *  every start and stop, and a fast month turned before the ring had gone round.) */
let monthAt = '';
export function markMonth(pct: number): void {
  const path = document.querySelector<SVGPathElement>('#clock .month-ring path');
  const at = `${Math.max(0, Math.min(100, pct)).toFixed(1)} 100`;
  if (!path || at === monthAt) return;
  monthAt = at;
  path.style.strokeDasharray = at;
}

/** How near the city is to its next stage, round the city button's edge from its top middle, clockwise (0–100): the
 *  residents gained since this stage began, of those it takes (full at the last stage). */
let stageAt = '';
export function markStage(pct: number): void {
  const path = document.querySelector<SVGPathElement>('#btn-city .stage-ring path');
  const at = `${Math.max(0, Math.min(100, pct)).toFixed(1)} 100`;
  if (!path || at === stageAt) return;
  stageAt = at;
  path.style.strokeDasharray = at;
}

/** A button's ring (the clock's month, the city's stage): a path along its rounded edge (on its border line), from the
 *  top middle clockwise; its length counted as 100, so a share is its dash. */
function drawRing(host: HTMLElement): void {
  const svg = host.querySelector<SVGSVGElement>(':scope > .edge-ring');
  const path = svg?.querySelector('path');
  if (!svg || !path) return;
  const [w, h] = [host.offsetWidth, host.offsetHeight];
  if (!w || !h) return;
  const s = 1; // (half the ring's width in from the edge: over the border, and as far inside it)
  const r = Math.max(s, Math.min(parseFloat(getComputedStyle(host).borderTopLeftRadius) || 0, w / 2, h / 2));
  const a = r - s;
  const f = (n: number) => +n.toFixed(2);
  path.setAttribute('d', `M${f(w / 2)} ${s}H${f(w - r)}A${f(a)} ${f(a)} 0 0 1 ${f(w - s)} ${f(r)}V${f(h - r)}A${f(a)} ${f(a)} 0 0 1 ${f(w - r)} ${f(h - s)}`
    + `H${f(r)}A${f(a)} ${f(a)} 0 0 1 ${s} ${f(h - r)}V${f(r)}A${f(a)} ${f(a)} 0 0 1 ${f(r)} ${s}Z`);
}

/** Whether the per-type tax rates are shown (the classes are always). */
let taxDetail = false;
/** The types whose rates cut their demand when the player last folded the per-type rates away: they open by
 *  themselves again only for others. */
let taxShutFor = '';

/** Each tax row's redraw (rate and its demand effect, which moves month to month). */
const rows = new Map<string, () => void>();

/** Refreshes the tax rows: the per-type demand effect changes with the city and the 90-day rate memory. */
export function refreshTaxes(): void {
  rows.forEach((f) => f());
  const note = document.getElementById('tax-note');
  if (note) note.textContent = taxNote();
  // A type's own rate cutting its demand (the problem and its 추천 name 농업 세율): its row in sight and marked,
  // under the classes (folded away, the screen named a rate that wasn't on it).
  const detail = document.querySelector<HTMLDetailsElement>('#taxes > details');
  if (!detail) return;
  const cutting = taxesCutting();
  if (cutting.length && !detail.open && cutting.join() !== taxShutFor) detail.open = true;
  detail.querySelectorAll<HTMLElement>('.tax-row[data-type]').forEach((r) => r.classList.toggle('cutting', cutting.includes(r.dataset.type as DevType)));
}

// (One line; the rest is its tooltip: a paragraph under the rates said it every time the screen opened.)
const taxNote = () => `중립 세율 ${city.demand.neutralTax.toFixed(1)}% (막대의 눈금) · 낮추면 수요↑, 올리면 수요↓`;
const TAX_DETAIL = '중립 세율보다 낮으면 수요가 최대 35% 커지고, 높으면 줄어들며, 많이 올리면 수요가 마이너스로 돌아섭니다(영향 −100% 넘음). 올린 세율은 90일간 기억됩니다.';

export function buildTaxes(): void {
  const el = $('#taxes');
  el.innerHTML = '';
  rows.clear();
  // (`types`: the types it sets — whether they differ, so its figure is an average, and whether all are cut to
  // neutral already, so a dent left is the old rate remembered.)
  const row = (label: string, title: string, get: () => number, set: (v: number) => void, income?: () => number, effect?: () => number, types: readonly DevType[] = []) => {
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
      // (A class whose levels differ shows their average, said as one: "10.2%" read as a rate set somewhere.)
      const mixed = types.length > 1 && types.some((t) => city.state.taxRates[t] !== city.state.taxRates[types[0]!]);
      out.textContent = `${mixed ? '평균 ' : ''}${v.toFixed(1)}%`;
      // What the rate does to this type's demand (SC4's tax effect, +35% to −350%).
      const e = effect ? Math.round(effect() * 100) : 0;
      // (Cut to neutral or below, a dent left is the old rate the sims remember for 90 days: on its way back, not a
      // rate still too high — the screen read 양호 beside "−71%".)
      const easing = e < 0 && types.length > 0 && types.every((t) => city.state.taxRates[t] <= city.demand.neutralTax);
      // Under the slider, the row's full width (in the label column it wrapped).
      // (Red only past −100%, where demand turns round: a usual rate's dent reads as plain fact.)
      fx.className = `tax-effect ${e <= -100 && !easing ? 'neg' : e > 0 ? 'pos' : ''}`;
      fx.title = easing ? '내린 세율: 주민·기업이 높았던 세율을 90일 동안 기억해, 그동안 수요 영향이 남았다가 사라집니다'
        : '세율 때문에 수요가 그 크기의 몇 %만큼 늘거나 줄어드는지(−100%를 넘으면 수요가 마이너스로 돌아섬)';
      fx.textContent = e ? `수요 영향 ${e > 0 ? '+' : '−'}${Math.abs(e)}%${easing ? ' · 되돌아오는 중' : ''}` : '';
    };
    // Last month's take, and roughly what one point more would add (same tax base); read on hover.
    if (income) div.onpointerenter = () => {
      const take = income();
      const v = get();
      div.title = take > 0 && v > 0 ? `지난달 §${fmt(take)} · 1%p 올리면 월 약 +§${fmt(take / v)} (수요가 줄 수 있음)` : '';
    };
    input.oninput = () => {
      set(Number(input.value));
      refreshTaxes(); // (and the per-type rows' marks: a rate lowered by hand left its row marked)
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
      }, types));
  }
  const detail = document.createElement('details');
  detail.open = taxDetail;
  detail.ontoggle = () => {
    taxDetail = detail.open;
    if (!detail.open) taxShutFor = taxesCutting().join();
  };
  detail.innerHTML = '<summary>소득·유형별 세율</summary>';
  // (In words, as the demand bars name them: the codes R$, Cs$$ led each row with the words small under them.)
  for (const t of DEV_TYPES) {
    const r = row(TYPE_SHORT[t], TYPE_NAME[t], () => city.state.taxRates[t], (v) => choice('세율', () => city.setTaxRate(t, v)), undefined, () => city.demand.taxEffect[t], [t]);
    r.dataset.type = t;
    detail.append(r);
  }
  el.append(detail);
  const note = document.createElement('p');
  note.className = 'legend';
  note.id = 'tax-note';
  note.title = TAX_DETAIL;
  note.textContent = taxNote();
  el.append(note);
  refreshTaxes(); // (the marks and the opening at once: a load rebuilt them unmarked until the month turned)
}

/**
 * Wide, the city button and the areas' row stand down the map's left (the rail), each button with its figures; a phone
 * has them in its two top rows. Moved, not copied: one city button and one row, whatever the width (their handlers and
 * the keyboard's place go with them).
 */
export function placeRail(): void {
  const rail = document.getElementById('rail');
  const bar = document.getElementById('mapbar');
  const city = document.getElementById('btn-city');
  const strip = document.getElementById('goal-strip');
  if (!rail || !bar || !city || !strip) return;
  const wide = !matchMedia('(max-width: 860px)').matches;
  // (Moved, a button lets go of the focus: the keyboard's place given back — a tablet turned across 860px.)
  const at = document.activeElement;
  const had = at instanceof HTMLElement && (city.contains(at) || strip.contains(at)) ? at : null;
  if (wide && city.parentElement !== rail) rail.append(city, strip);
  else if (!wide && city.parentElement !== bar) {
    bar.prepend(city);
    bar.append(strip);
  }
  if (had && had.isConnected && document.activeElement !== had) had.focus({ preventScroll: true });
  strip.setAttribute('aria-orientation', wide ? 'vertical' : 'horizontal');
  bar.setAttribute('aria-label', wide ? '시간·메뉴' : '도시·시간·메뉴');
}

/** The tools' card at its widest (style.css's #tray too): two columns of five tiles, each with its figures and costs. */
const TRAY_MAX = 960;

/** The map's bars as the window has them. A phone held upright folds the view's card to its name (`fit4`); wide,
 *  전체 보기 and the minimap go under the top buttons' row where it reaches their corner (`controls-low`). */
export function fitMapbar(): void {
  const bar = document.getElementById('mapbar');
  const view = document.getElementById('view');
  if (!bar || !view) return;
  const card = document.getElementById('map-layer');
  const folded = matchMedia('(max-width: 639px) and (orientation: portrait)').matches;
  view.classList.toggle('fit4', folded);
  // (Whether its legend shows, as the card's name says it: folded on a phone unless opened, else unless tucked.)
  document.getElementById('layer-title')?.setAttribute('aria-expanded', String(folded ? !!card?.classList.contains('open') : !card?.classList.contains('tucked')));
  const narrow = matchMedia('(max-width: 860px)').matches;
  // Wide, the top buttons and the building bar stand in the middle of the screen, one above the other — moved right
  // only as far as they must to clear what stands down the map's left (the rail of the city and its areas, the city
  // pane while it is open): what rises from the bar (the tool in hand, the hint) and the 지역 sheet under the buttons
  // keep to the same line. The tools' card rises over the bar's middle where it has the room there, else in the middle
  // of the map the left leaves (--tray-x, --tray-w).
  let right = 0;
  if (narrow) {
    for (const k of ['--bar-x', '--tray-x', '--tray-w']) view.style.removeProperty(k);
  } else {
    const v = view.getBoundingClientRect();
    const app = document.getElementById('app');
    const pane = document.getElementById('pane');
    const rail = document.getElementById('rail');
    // (Where the pane comes to rest, not where its slide has got to: offsets leave the transform out.)
    const cover = pane && app?.classList.contains('pane-open') ? pane.offsetLeft + pane.offsetWidth : rail?.offsetWidth ? rail.offsetLeft + rail.offsetWidth : 0;
    const from = cover + 14;
    const to = v.width - 14;
    const half = Math.max(bar.offsetWidth, document.getElementById('dock-col')?.offsetWidth ?? 0) / 2;
    const x = Math.round(Math.max(from + half, Math.min(v.width / 2, to - half)));
    const set = (k: string, val: string) => view.style.getPropertyValue(k) !== val && view.style.setProperty(k, val);
    set('--bar-x', `${x}px`);
    const full = Math.min(TRAY_MAX, to - from);
    const over = Math.min(TRAY_MAX, 2 * Math.min(x - from, to - x));
    const centred = over >= Math.min(full, 720);
    set('--tray-x', `${Math.round(centred ? x : (from + to) / 2)}px`);
    set('--tray-w', `${Math.round(centred ? over : full)}px`);
    right = v.left + x + bar.offsetWidth / 2;
  }
  // 전체 보기 and the minimap keep the map's top right corner unless the top buttons reach it (a narrow window, a pane
  // open): then they go under the row. (Measured by the minimap's width, shown or not: the corner stays put as it comes
  // and goes.)
  let low = false;
  if (!narrow) {
    const v = view.getBoundingClientRect();
    low = right + 10 > v.right - 14 - Math.max(148, document.getElementById('map-controls')?.offsetWidth ?? 0);
  }
  view.classList.toggle('controls-low', low);
  // (A card for the speeds left open where its button has gone — a phone turned into a wide window — would take the
  // next Esc unseen.)
  if (getComputedStyle($('#btn-time')).display === 'none') closeClock();
}

/** Switches the map to a data view by its menu value (from an advisor's 보기). */
export function showOverlay(value: string): void {
  const kind = $<HTMLSelectElement>('#overlay-kind');
  // (A name no view has, from a caller out of date, left the select empty and every frame failed to paint.)
  if (![...kind.options].some((o) => o.value === value)) return;
  kind.value = value;
  kind.dispatchEvent(new Event('change'));
}

/** A view with nothing on the map to show: a network the city hasn't built, or radiation where there is none. */
export function viewEmpty(v: string): boolean {
  const network = v.startsWith('volume:') ? v.slice(7) as VolumeNetwork : null;
  if (network) {
    for (let i = 0; i < city.size * city.size; i++) if (volumeAt(city.state, city.fields, network, i) >= 0) return false;
    return true;
  }
  return v === 'subway' ? !city.state.subway.some((x) => x > 0) : v === 'radiation' ? !city.state.radiation.some((x) => x > 0)
    : v === 'landValue' ? !city.fields.landValue.some((x) => x >= 1) : false;
}

/** What the view on shows, counted in a line under its legend (how many go without, how much is jammed). */
let sumSeen = '';
export function refreshViewSummary(): void {
  const box = document.getElementById('overlay-sum');
  if (!box || !city || city.stepping) return; // (built before the first city opens; mid-day the fields are half redone)
  const v = overlay.kind === 'volume' ? '' : overlay.kind;
  const [text, tone, spots] = viewSummary(v);
  sumSpots = spots;
  // (What it counts — the gaps, or a fire or riot now — goes with the view: either changing starts 찾아가기 at the first.)
  const led = (v === 'fire' || v === 'police' || v === 'crime') && incidents().some((x) => x.goal === (v === 'fire' ? 'fire' : 'police'));
  const what = `${v}:${led ? 'now' : 'gaps'}`;
  const key = `${what}|${text}|${tone}`;
  if (key === sumSeen) return;
  if (!sumSeen.startsWith(`${what}|`)) sumNext = 0; // (a count moving as the days go doesn't send 찾아가기 back to the first)
  sumSeen = key;
  box.hidden = !text;
  box.className = `overlay-sum${tone ? ` ${tone}` : ''}`;
  // Where some go without: a way to each of them in turn.
  box.innerHTML = `<span>${text}</span>${spots.length ? '<button type="button" class="link sum-go" title="하나씩 차례로 지도에서 보기">찾아가기</button>' : ''}`;
  box.querySelector<HTMLButtonElement>('.sum-go')?.addEventListener('click', (e) => {
    if (!sumSpots.length) return;
    const k = sumNext++ % sumSpots.length;
    const i = sumSpots[k]!;
    revealMap();
    const [x, y] = [i % city.size, Math.floor(i / city.size)];
    // (Close enough to see the tile, and ringed once the map lands: at the usual zoom it only panned, and a faint
    // flash marked it. Which one of how many, on the button.)
    centerOn(x, y, 14);
    pingAt(x, y);
    (e.currentTarget as HTMLButtonElement).textContent = `찾아가기 ${k + 1}/${sumSpots.length}곳`; // (places: beside 막힌 길 139칸, 1/18 read as tiles)
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
  const [text, tone] = viewSummaryNow(v, false);
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

function viewSummaryNow(v: string, live = true): [string, '' | 'bad' | 'good', number[]] {
  const s = city.state;
  const f = city.fields;
  const n = s.size;
  // While a fire burns or a riot runs, the reach view leads with it, and 찾아가기 goes there: with the trucks out it
  // went to buildings beyond reach. (Not on a build card's heading, which is about reach.)
  // (The crime view too: the police screen opens on it, and during a riot its 찾아가기 went to the hot spots.)
  const now = live && (v === 'fire' || v === 'police' || v === 'crime') ? incidents().filter((x) => x.goal === (v === 'fire' ? 'fire' : 'police')) : [];
  if (now.length) {
    const what = now.map((x) => x.goal === 'fire' ? `불난 곳 ${fmt(x.places.length)}곳` : x.riot ? `폭동 ${fmt(x.places.length)}곳` : `방화범 ${fmt(x.places.length)}명`).join(' · ');
    return [what, 'bad', now.flatMap((x) => x.places.map(([px, py]) => py * n + px))];
  }
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
      const key = `${cityGeneration}|${city.revision}|${Math.floor(s.day / 30)}`; // (the generation: another city opened restarts the revision)
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
  const legend = $('#overlay-legend');
  const items = [...legend.querySelectorAll<HTMLElement>('.swatch-item[data-color]')];
  for (const item of items) {
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
  // The colours on the map first, the most first; the rest folded under 나머지 N개 (thirteen small entries, most
  // of them greyed to nothing, crowded the card). With none on the map at all, all are shown as the key.
  const count = (el: HTMLElement) => byColor.get(el.dataset.color!) ?? 0;
  const sorted = [...items].sort((a, b) => count(b) - count(a));
  // (Not under the keyboard: moving the focused entry dropped focus to the page as the counts swapped places.)
  if (sorted.some((el, k) => el !== items[k]) && !legend.contains(document.activeElement)) legend.prepend(...sorted);
  const absent = items.filter((el) => !count(el)).length;
  let rest = legend.querySelector<HTMLButtonElement>('.legend-rest');
  if (absent && absent < items.length) {
    if (!rest) {
      rest = document.createElement('button');
      rest.type = 'button';
      rest.className = 'link legend-rest';
      rest.onclick = () => {
        legend.classList.toggle('show-rest');
        markLegend(growthSum.byColor); // (the counts as they are now, not as when the button was made)
      };
      legend.append(rest);
    }
    rest.textContent = legend.classList.contains('show-rest') ? '접기' : `나머지 ${absent}개`;
  } else rest?.remove();
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
  centerOn(x, y, 14);
  pingAt(x, y); // (as 찾아가기 marks what it found)
}

