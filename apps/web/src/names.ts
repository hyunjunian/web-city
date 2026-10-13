// Korean names and labels for engine identifiers (structures, types, advisors…).

import {
  type AbandonReason, type AdvisorId, type CitySpan, type DevType, type DisasterKind, type NetworkKind, type OrdinanceId, type PollTopic, type StructureKind,
  type ThoughtSubject, type TripMeans, type ZoneKind,
} from '@web-city/engine';
import { fmt, glue } from './util';

export const STRUCTURE_NAME: Record<StructureKind, string> = {
  smallParkGreen: '작은 공원', mediumParkGreen: '중간 공원', largeParkGreen: '큰 공원',
  smallPlaza: '작은 광장', mediumPlaza: '중간 광장', largePlaza: '큰 광장',
  smallFlowerGarden: '작은 화단', mediumFlowerGarden: '중간 화단', largeFlowerGarden: '큰 화단',
  playground: '놀이터', mediumPlayground: '중간 놀이터', basketballCourt: '농구장', tennisCourt: '테니스장',
  skateboardPark: '스케이트 공원', soccerField: '축구장', softballField: '소프트볼장', gazebo: '정자',
  communityGarden: '공동체 텃밭', openGrass: '잔디밭', openPaved: '포장 공터', rangerStation: '산림 감시소', beach: '해변',
  coalPlant: '석탄 발전소', gasPlant: '천연가스 발전소', oilPlant: '석유 발전소', windPlant: '풍력 발전기',
  solarPlant: '태양광 발전소', nuclearPlant: '원자력 발전소', hydrogenPlant: '수소 발전소',
  waterPump: '양수 펌프', waterTower: '급수탑', largeWaterPump: '대형 양수 펌프', waterTreatmentPlant: '정수장',
  wasteToEnergyPlant: '소각 발전소', recyclingCenter: '재활용 센터',
  policeKiosk: '파출소', smallPoliceStation: '소형 경찰서', largePoliceStation: '대형 경찰서',
  deluxePoliceStation: '경찰 본부', cityJail: '시립 교도소',
  smallFireStation: '소형 소방서', largeFireStation: '대형 소방서', fireLandingStrip: '소방 비행장',
  medicalClinic: '보건소', largeMedicalCenter: '종합병원', diseaseResearchLab: '질병 연구소',
  elementarySchool: '초등학교', highSchool: '고등학교', largeElementarySchool: '대형 초등학교',
  largeHighSchool: '대형 고등학교', localLibrary: '도서관', cityMuseum: '시립 박물관',
  cityCollege: '시립 대학', university: '종합대학',
  busStop: '버스 정류장', subwayStation: '지하철역', trainStation: '여객 철도역', freightStation: '화물 철도역',
  smallLandingStrip: '소형 활주로', mediumLandingStrip: '중형 활주로', largeLandingStrip: '대형 활주로',
  smallMunicipalAirport: '소형 시립 공항', mediumMunicipalAirport: '중형 시립 공항', largeMunicipalAirport: '대형 시립 공항',
  smallInternationalAirport: '소형 국제공항', mediumInternationalAirport: '중형 국제공항', largeInternationalAirport: '대형 국제공항',
  internationalPort: '국제 항구',
  elRailStation: '고가 철도역', monorailStation: '모노레일역', parkingGarage: '공영 주차장',
  passengerFerry: '여객 페리 터미널', carFerry: '차량·여객 페리 터미널',
  // Rewards.
  mayorsHouse: '시장 관저', mayorsStatue: '시장 동상', impressiveMayorsStatue: '멋진 시장 동상',
  magnificentMayorsStatue: '웅장한 시장 동상', colossalMayorsStatue: '거대한 시장 동상', cityHall: '시청', courthouse: '법원',
  bureauOfBureaucracy: '관료청', houseOfWorship: '예배당', cemetery: '묘지', privateSchool: '사립학교',
  farmersMarket: '농산물 시장', stateFair: '주 박람회', touristTrap: '관광 명소', radioStation: '라디오 방송국',
  televisionStudio: 'TV 스튜디오', movieStudio: '영화 스튜디오', minorLeagueStadium: '마이너리그 경기장',
  majorLeagueStadium: '메이저리그 경기장', cityZoo: '시립 동물원', countryClub: '컨트리클럽', resortHotel: '리조트 호텔',
  stockExchange: '증권 거래소', mainLibrary: '중앙 도서관', majorArtMuseum: '미술관', operaHouse: '오페라 하우스',
  advancedResearchCenter: '첨단 연구소', marina: '마리나', spacePort: '우주 공항', grandRailroadStation: '중앙 기차역', cruiseShipPort: '크루즈 항구', conventionCenter: '컨벤션 센터', lighthouse: '등대',
  // Business deals.
  armyBase: '육군 기지', casino: '카지노', federalPrison: '연방 교도소', missileRange: '미사일 시험장',
  toxicWasteDump: '유독성 폐기물 처리장', area51: '51구역',
  // Landmarks.
  alamo: '알라모', alcatraz: '앨커트래즈', amalienborg: '아말리엔보르', bankOfAmerica: '뱅크 오브 아메리카',
  bankOfChinaTower: '중국은행 타워', bigBen: '빅 벤', californiaPlaza: '캘리포니아 플라자', chryslerBuilding: '크라이슬러 빌딩',
  cnTower: 'CN 타워', coitTower: '코잇 타워', empireStateBuilding: '엠파이어 스테이트 빌딩', faneuilHall: '패뉼 홀',
  fernsehturm: '베를린 TV 타워', gatewayArch: '게이트웨이 아치', greatPyramid: '대피라미드', guggenheimMuseum: '구겐하임 미술관',
  hagiaSofia: '아야 소피아', hollywoodSign: '할리우드 사인', independenceHall: '독립기념관', jeffersonMemorial: '제퍼슨 기념관',
  johnHancockCenter: '존 핸콕 센터', lincolnMemorial: '링컨 기념관', livingMall: '리빙 몰', palaceOfFineArts: '예술 궁전',
  palacioReal: '마드리드 왕궁', rotesRathaus: '베를린 시청', smithTower: '스미스 타워', sphinx: '스핑크스',
  stBasils: '성 바실리 대성당', statueOfLiberty: '자유의 여신상', tajMahal: '타지마할', tokyoTower: '도쿄 타워',
  towerOfLondon: '런던 탑', usCapitolBuilding: '미국 국회의사당', washingtonMonument: '워싱턴 기념탑', whiteHouse: '백악관',
  americanMuseumOfNaturalHistory: '미국 자연사 박물관', columbiaSeafirstCenter: '컬럼비아 센터', lincolnCenter: '링컨 센터',
  schlossNeuschwanstein: '노이슈반슈타인 성',
};

export const DISASTER_NAME: Record<DisasterKind, string> = {
  fire: '화재', lightning: '번개', meteor: '운석', tornado: '토네이도', earthquake: '지진', volcano: '화산',
  robot: '로봇 습격', autosaurus: '오토사우루스', ufo: 'UFO',
};

export const REPORT_NAME: Record<string, string> = {
  ...DISASTER_NAME, explosion: '발전소 폭발', meltdown: '원자로 멜트다운', sinkhole: '수도관 파열(싱크홀)', spill: '유독물 유출',
};

export const NETWORK_NAME: Record<NetworkKind | 'crossing', string> = {
  street: '골목', road: '도로', avenue: '대로', highway: '고속도로', onramp: '진입로', rail: '철도', crossing: '건널목', oneway: '일방통행',
};

/** Zone kinds in Korean ('' for no zone). */
export const ZONE_NAME: Record<ZoneKind, string> = {
  none: '', 'R-low': '주거 저밀도', 'R-medium': '주거 중밀도', 'R-high': '주거 고밀도',
  'C-low': '상업 저밀도', 'C-medium': '상업 중밀도', 'C-high': '상업 고밀도',
  'I-medium': '산업 중밀도', 'I-high': '산업 고밀도', A: '농업', landfill: '매립지',
};

export const TYPE_NAME: Record<DevType, string> = {
  'R$': '주거 저소득', 'R$$': '주거 중소득', 'R$$$': '주거 고소득',
  'Cs$': '상업 서비스 저소득', 'Cs$$': '상업 서비스 중소득', 'Cs$$$': '상업 서비스 고소득',
  'Co$$': '상업 오피스 중소득', 'Co$$$': '상업 오피스 고소득',
  IA: '농업', ID: '공해 산업', IM: '제조업', IHT: '첨단 산업',
};

/** Development-type codes in an engine text (a reward's conditions) in words: R$$$ 인구 → 주거 고소득 인구. */
export const plainCodes = (text: string): string => text
  .replace(/R\$\$\+R\$\$\$/g, '중·고소득 주거')
  .replace(/(?:R|Cs|Co)\$+|\bI(?:HT|D|M|A)\b/g, (c) => TYPE_NAME[c as DevType] ?? c);

/** A type in a word and its wealth, for narrow lists (the demand bars): 상점 중소득, not Cs$$ (nor 상점 $$). */
export const TYPE_SHORT: Record<DevType, string> = {
  'R$': '주거 저소득', 'R$$': '주거 중소득', 'R$$$': '주거 고소득',
  'Cs$': '상점 저소득', 'Cs$$': '상점 중소득', 'Cs$$$': '상점 고소득',
  'Co$$': '오피스 중소득', 'Co$$$': '오피스 고소득',
  IA: '농업', ID: '공해 산업', IM: '제조업', IHT: '첨단 산업',
};

export const FACTOR_NAME: Record<string, string> = {
  // Named as qualities, so a plus reads as good whichever way the factor points.
  air: '공기 질', landValue: '땅값', rProx1: '저소득 주거 근접', rProx2: '중소득 주거 근접', rProx3: '고소득 주거 근접',
  coProx2: '중소득 오피스 근접', coProx3: '고소득 오피스 근접', resNimby: '주거 님비/임비', comNimby: '상업 님비/임비',
  slope: '평지', traffic: '교통량', trip: '통근/화물 시간', health: '보건', school: '교육', crime: '치안', events: '최근 사건(화재 등)', garbage: '청결 (쓰레기)',
};

export const CRIME_NAME: Record<string, string> = {
  arson: '방화', bankRobbery: '은행 강도', assault: '폭행', stickUp: '노상강도', drugs: '마약', carTheft: '차량 절도', fighting: '싸움',
  purseSnatching: '날치기', solicitation: '호객 행위', flashing: '노출', pieThrowing: '파이 던지기', graffiti: '낙서', tping: '휴지 테러',
};

export const POLL_NAME: Record<PollTopic, string> = {
  safety: '치안·소방', environment: '환경', traffic: '교통', health: '보건', education: '교육', taxes: '세금', landValue: '땅값',
};

export const CHECK_NAME: Record<string, string> = {
  population: '총인구 (주민+일자리)', residents: '주거 인구', powerDemand: '전력 수요', waterDemand: '물 수요', healthBuildings: '병원 수', mayorRating: '시장 평점',
  parks: '공원 수', schoolGrade: '도시 학교 등급', wellFunded: '보건·교육 예산 100%', anyOf: '필요 건물', combined: '합계 인구', connections: '이웃 연결',
  waterShare: '물 비율', busyStation: '기차역 이용률', difficulty: '난이도', typePopulation: '인구', requires: '선행 건물', buildings: '건물 수', goodBuildings: '등급 85 넘는', workingBuildings: '운영 중인',
  'regional.population': '지역 인구', 'regional.highWealth': '지역 부유층', 'regional.cities': '지역 도시 수', 'regional.connected': '연결된 이웃', 'regional.mayorRating': '시장 평점', 'regional.linkedCities': '다른 도시와 이어진 지역 도시', lowPollution: '주거지 대기 오염',
};

export const THOUGHT: Record<ThoughtSubject, [string, string]> = {
  health: ['❤', '건강'], education: ['✏', '교육'], crime: ['🚓', '치안'], pollution: ['🏭', '공기·물'], commute: ['🚗', '출퇴근'],
  transit: ['🚌', '대중교통 통근'], bus: ['🚏', '버스 정류장'], landmark: ['🗽', '랜드마크'], sailboat: ['⛵', '마리나'], rat: ['🐀', '방사능 쥐'],
  airport: ['✈', '공항'], farm: ['🌾', '농장'], jail: ['🔒', '교도소'], landfill: ['🗑', '매립지'], park: ['🌳', '공원'], recycling: ['♻', '재활용'],
  reward: ['🏆', '보상 건물'], shop: ['🛍', '상점'], restaurant: ['🍴', '식당'], hotel: ['🏨', '호텔'], car: ['🔧', '정비소'], friend: ['🙂', '친구'],
};

/** The three incomes in words (SimCity's $, $$, $$$ read as prices). */
export const WEALTH_NAME = ['저소득층', '중산층', '부유층'] as const;

export const EDGE_NAME = ['서쪽', '동쪽', '북쪽', '남쪽'] as const;

export const RESOURCE_NAME = { power: '전력', water: '물', garbage: '쓰레기 처리' } as const;

export const RESOURCE_UNIT = { power: 'MWh', water: 'm³', garbage: 't' } as const;

export const KIND_NAME = { simnation: '도시 없음 (심네이션)', established: '이웃 도시 (미개발)', developed: '이웃 도시 (개발됨)' } as const;

export const SPAN_NAME: Record<CitySpan, string> = { 1: '작은', 2: '중간', 4: '큰' };

export const ADVISOR_NAME: Record<AdvisorId, string> = {
  planner: '도시 계획', finance: '재정', utilities: '공공시설', safety: '치안·소방', healthEducation: '보건·교육', transportation: '교통', environment: '환경',
};

/** The tool that fixes an advisor's problem, and its button's label. */
export const ADVICE_TOOL: Record<string, [string, string]> = {
  noPower: ['power', '발전소'], powerShort: ['power', '발전소'], powerCutOff: ['powerline', '송전선'], plantOld: ['power', '발전소'], noWater: ['water', '수도 시설'], pumpOld: ['water', '수도 시설'], waterShort: ['water', '수도 시설'], pipesNoSource: ['pipe', '수도관'],
  landfillFull: ['landfill', '매립지'], landfillSoon: ['landfill', '매립지'], garbagePiling: ['landfill', '매립지'], landfillNoRoad: ['landfill', '매립지'], landfillNewNoRoad: ['road', '도로'], facilityNoRoad: ['road', '도로'], understaffed: ['R-medium', '주거 구역'],
  noPolice: ['police', '경찰서'], policeReach: ['police', '경찰서'], cellsFull: ['police:cityJail', '교도소'], noFire: ['fire', '소방서'], plantUnprotected: ['fire', '소방서'], noHospital: ['health', '병원'], noSchool: ['education', '학교'],
  schoolFull: ['education', '학교'], hospitalFull: ['health', '병원'], eqLow: ['education', '학교'], hqLow: ['health', '병원'], schoolStrike: ['education', '학교'], hospitalStrike: ['health', '병원'],
  capRes: ['park', '공원·광장'], noParks: ['park', '공원'], zoneR: ['R-low', '주거 구역'], zoneC: ['C-low', '상업 구역'], zoneI: ['I-medium', '산업 구역'], zoneA: ['A', '농업 구역'],
};

/** Growth blockers one tool fixes: the tool and its button's label (a capped R class gets parks). */
export const GROWTH_FIX: Partial<Record<string, [string, string]>> = {
  rubble: ['bulldoze', '철거'],
  tooSteep: ['raise', '높이기'], noPower: ['power', '발전소'], noRoad: ['road', '도로'], noWater: ['pipe', '수도관'], waterCap: ['pipe', '수도관'],
};

export const ADVICE_TEXT: Record<string, (v: number, type?: DevType) => string> = {
  noPower: () => '전력이 없어 아무것도 개발되지 않습니다. 발전소를 지으세요.',
  eqLow: (v) => `주민 교육 지수가 처음보다 ${v <= -0.5 ? `${fmt(-v)} 떨어졌습니다` : v < 0.5 ? '오르지 않았습니다' : `${fmt(v)}밖에 오르지 않았습니다`}. 학교·도서관 범위 밖 주거지가 없는지, 학교가 넘치거나 예산이 모자라지 않은지 보세요. 초·중등 학교만으로는 조금씩만 오르니 대학·박물관도 지으세요.`,
  hqLow: (v) => `주민 건강 지수가 처음보다 ${v <= -0.5 ? `${fmt(-v)} 떨어졌습니다` : v < 0.5 ? '오르지 않았습니다' : `${fmt(v)}밖에 오르지 않았습니다`}. 병원 범위 밖 주거지가 없는지, 병원이 넘치거나 대기·수질 오염이 심하지 않은지 보세요.`,
  stationFull: (v) => `이용객이 수용량의 ${fmt(v)}%인 정류장·역이 있습니다. 기다리는 시간이 길어져 차로 돌아가는 사람이 생기니 근처에 하나 더 지으세요.`,
  powerCutOff: (v) => `발전소와 전선으로 이어지지 않은 건물이 ${fmt(v)}곳 있습니다. 전기가 남는데도 닿지 않으니 송전선을 이으세요.`,
  powerShort: () => '전력이 부족해 순환 정전이 일어납니다. 6개월간 정전된 건물은 버려집니다.',
  powerSurplus: () => '발전량이 수요의 두 배가 넘습니다. 이웃에 팔거나 발전소 예산을 줄여도 됩니다.',
  waterShort: () => '물이 부족해 수원에서 먼 건물부터 단수됩니다. 펌프나 급수탑을 더 지으세요.',
  pumpsOff: (v) => `펌프·급수탑이 모두 멈춰 건물 ${v}곳에 물이 없습니다. 전기가 끊겼거나 물이 오염됐거나 예산이 0%입니다: 시설을 조회해 원인을 고치세요.`,
  pipesNoSource: (v) => `건물 ${v}곳이 펌프와 이어지지 않은 수도관에 있어 물이 없습니다. 그 수도관을 펌프가 있는 수도망에 이으세요.`,
  plantOld: (v) => `수명이 다해 가는 발전소가 있습니다(약 ${fmt(v)}개월 남음). 수명이 다하면 폭발하니 새 발전소를 지은 뒤 헐어 주세요.`,
  pumpOld: (v) => `낡아서 곧 멈출 양수 시설이 ${fmt(v)}곳 있습니다. 새로 지어 바꿔 주세요.`,
  idlePlant: (v) => `발전소 ${v}곳이 아무 곳에도 전기를 보내지 못합니다. 송전선이나 구역으로 도시 전력망에 이으세요.`,
  idlePump: (v) => `양수 시설 ${v}곳이 아무 곳에도 물을 보내지 못합니다. 수도관으로 도시 수도망에 이으세요.`,
  dryBuildings: () => '물이 끊긴 큰 건물이 있습니다. 6개월 안에 수도를 연결하지 않으면 버려집니다.',
  noWater: () => '수도가 없어 건물이 낮게만 지어집니다. 부유층·첨단 산업은 들어오지 않고, 공해·제조 산업은 1단계, 나머지는 3단계까지만 올라갑니다.',
  garbagePiling: (v) => v ? '매립지가 가득 차 쓰레기가 쌓이고 있습니다. 도로 옆에 매립지를 더 지정하거나 소각 발전소·재활용 센터를 지으세요.' : '쓰레기가 수거되지 않고 쌓이고 있습니다. 도로와 이어진 매립지나 소각 발전소가 필요합니다.',
  rubble: (v) => `구역 ${v}칸이 재해 잔해로 덮여 있습니다. 치워야 다시 지어집니다.`,
  facilityNoRoad: (v) => `도로에 닿지 않은 시설이 ${v}곳 있습니다. 쓰레기를 거둘 수 없어 쌓이고, 경찰서·소방서·병원·학교라면 출동도 못 합니다. 시설 옆까지 도로를 이으세요.`,
  landfillFull: (v) => `매립지가 ${v ? `${v}개월` : '한 달'} 안에 가득 찹니다.`,
  landfillNew: (v) => `새 매립지 ${fmt(v)}칸이 다음 달부터 쓰레기를 받고, 그동안 쌓인 쓰레기도 남는 자리로 차차 치웁니다.`,
  landfillNewNoRoad: () => '새 매립지 옆에 도로가 없습니다. 도시와 이어진 도로가 닿아야 쓰레기 수거차가 쓰레기를 가져옵니다.',
  capRes: (v, t) => `${t ? TYPE_NAME[t] : '주거'} 인구가 상한(${fmt(v)}명)에 닿았습니다. 더는 들어오지 못하니 공원·광장과 보상 건물로 상한을 올리세요.`,
  capOffice: () => '오피스 수요가 상한에 막혔습니다. 이웃 도시로 나가는 도로·철도·고속도로 연결과 공항이 상한을 올립니다.',
  capIndustry: () => '산업 수요가 상한에 막혔습니다. 화물이 이웃으로 나가는 철도·고속도로 연결과 항구가 상한을 올립니다.',
  landfillNoRoad: (v) => `도로가 닿지 않은 매립지에 수거차가 갈 수 없습니다. 빈 자리 약 ${fmt(v)}톤이 놀고 있으니 매립지 옆까지 도로를 이으세요.`,
  landfillSoon: (v) => `이대로면 매립지가 약 ${v}개월 뒤 가득 찹니다. 매립지 구역을 늘리거나 소각 발전소를 준비하세요.`,
  fires: (v) => `불이 ${v}곳에서 타고 있습니다. 소방서 반경 밖이면 번질 수 있습니다.`,
  riot: (v) => `폭동이 ${v}곳에서 일어났습니다. 경찰을 보내세요.`,
  noPolice: () => '경찰서가 없어 범죄자가 잡히지 않습니다.',
  policeReach: () => '경찰서가 범죄 현장에 닿지 않아 범죄자가 잡히지 않습니다. 범죄가 잦은 곳 가까이에 경찰서를 지으세요.',
  cellsFull: (v) => `감방이 가득 차 지난달 범인 ${fmt(v)}명이 풀려났습니다. 이들은 다시 범죄를 저지릅니다 — 교도소를 지으세요.`,
  noFire: () => '소방서가 없습니다. 불이 나면 크게 번집니다.',
  plantUnprotected: (v) => `발전소 ${v}곳이 소방서 반경 밖에 있습니다. 불타 버리면 폭발해 주변까지 부숩니다.`,
  noHospital: () => '병원이 없어 주거 쾌적도와 건강 지수가 떨어집니다.',
  noSchool: () => '학교가 없어 주거 쾌적도와 교육 지수가 떨어집니다.',
  schoolFull: (v) => `학생 수가 정원의 ${v}%(${v - 100}% 초과)인 학교가 있습니다. 등급이 떨어져 교육 효과가 줄고 파업할 수 있으니 근처에 학교를 더 지으세요.`,
  hospitalFull: (v) => `환자 수가 정원의 ${v}%(${v - 100}% 초과)인 병원·보건소가 있습니다. 등급이 떨어져 보건 효과가 줄고 파업할 수 있으니 근처에 병원을 더 지으세요.`,
  schoolStrike: () => '학교 선생님들이 파업 중입니다. 정원을 넘었거나(학교를 더 지으세요) 예산이 모자랍니다. 그 학교를 찾아(알림이나 조언을 누르면 그곳으로 감) 등급을 확인하세요.',
  hospitalStrike: () => '병원 의료진이 파업 중입니다. 정원을 넘었거나(병원을 더 지으세요) 예산이 모자랍니다. 그 병원을 찾아(알림이나 조언을 누르면 그곳으로 감) 등급을 확인하세요.',
  congestion: (v) => `도로의 ${v}%가 용량을 넘었습니다. 대로나 대중교통을 놓으세요.`,
  understaffed: (v) => `일할 사람을 못 구하는 사업체가 ${fmt(v)}곳입니다. 맞는 소득층 주민이 더 들어오지 못해(주거 상한·수요 없음) 이대로면 버려집니다 — 주거 구역이나 공원 같은 상한 완화 시설을 늘리세요.`,
  noCommute: (v) => `일자리를 못 구하는 집이 ${fmt(v)}채입니다(2.5시간 안에 일터가 없거나 빈 일자리가 없음). 6개월이 지나면 버려집니다 — 상업·산업 구역을 늘리거나 길을 이으세요.`,
  potholes: () => '도로 유지 예산이 모자라 포트홀이 생기고 있습니다.',
  policeStrike: () => '경찰서가 파업 중입니다(예산 부족). 순찰과 체포가 크게 줄었습니다. 치안 예산을 90% 이상으로 올려야 끝납니다.',
  fireStrike: () => '소방서가 파업 중입니다(예산 부족). 불을 끄는 힘이 크게 줄었습니다. 소방 예산을 90% 이상으로 올려야 끝납니다.',
  linesWorn: () => '송전선 예산이 모자라 낡은 송전선이 있습니다. 예산이 50% 아래로 내려가면 불꽃이 튀어 불이 납니다 — 송전선 예산을 100%로 올리세요.',
  pipesWorn: () => '수도 예산이 50% 아래라 수도관이 낡아 가고 있습니다. 그대로 두면 터져 싱크홀이 생깁니다 — 수도 예산을 50% 넘게(가능하면 100%로) 올리세요.',
  smog: () => '주거 지역의 대기 오염이 심합니다. 공장과 떨어뜨리거나 나무·공원을 늘리세요.',
  radiation: () => '방사능 오염 지역이 있습니다. 그곳에는 아무것도 개발되지 않습니다.',
  noParks: () => '공원이 하나도 없습니다. 공원은 주거 상한을 풀고 쾌적도를 높입니다.',
  broke: () => '자금이 바닥났습니다. 지출을 줄이거나 대출을 받으세요.',
  deficit: (v) => `지난달 §${fmt(v)} 적자였습니다.`,
  taxEasing: (v, t) => `${t ? `${TYPE_NAME[t]} ` : ''}세율은 이미 내렸습니다. 심들이 지난 90일 동안 가장 높았던 세율을 기억해, 깎인 수요 ${fmt(v)}%는 그 기간이 지나면 돌아옵니다.`,
  taxHigh: (v, t) => `세율이 높아 ${t ? TYPE_NAME[t] : ''} 수요가 ${fmt(v)}% 깎이고 있습니다. 들어오려는 심이 있는데 세금이 막고 있으니, 세율을 조금 내려 보세요.`,
  surplus: (v) => `지난달 §${fmt(v)} 흑자였습니다.`,
  zoneR: () => '주거 수요가 높은데 빈 주거 구역이 거의 없습니다. 구역을 더 칠하세요.',
  zoneC: () => '상업 수요가 높은데 빈 상업 구역이 거의 없습니다. 구역을 더 칠하세요.',
  zoneI: () => '산업 수요가 높은데 빈 산업 구역이 거의 없습니다. 구역을 더 칠하세요.',
  zoneA: () => '농업 수요가 높은데 빈 농업 구역이 거의 없습니다. 구역을 더 칠하세요.',
  atRisk: (v) => `건물 ${fmt(v)}채가 버려질 위기입니다: 전기·물·도로·일자리가 끊긴 채 유예 기간의 절반을 넘겼습니다. 조언의 보기로 찾아 다시 이어 주세요.`,
  abandoned: (v) => `버려진 건물이 ${fmt(v)}채 있습니다.`,
  noGrowth: () => '구역을 지정했는데 아직 아무것도 들어서지 않았습니다. 빈 구역 칸을 조회하거나 보기를 눌러 무엇이 막는지(전기·도로·수요) 확인하세요.',
  unemployment: (v) => `노동 인구의 ${v}%가 실업 상태입니다. 상업·산업 구역을 늘리거나 일터까지 가는 길을 놓으세요.`,
  mayorLow: (v) => `시장 평점이 ${v}입니다. 평점이 아주 낮은 곳이 모이면 폭동이 일어날 수 있습니다.`,
  mayorHigh: (v) => `시민들이 시장을 좋아합니다(평점 ${v}).`,
};
// (Wherever the advisors' words are shown — a toast, a screen's headline, its diagnosis — they break between words.)
for (const [code, say] of Object.entries(ADVICE_TEXT)) ADVICE_TEXT[code] = (v, type) => glue(say(v, type));

export const MEANS_NAME: Record<TripMeans, string> = {
  walk: '걷기', car: '자동차', bus: '버스', train: '열차', subway: '지하철·고가 철도', monorail: '모노레일', ferry: '페리', freight: '화물',
};

export const MAYOR_NAME: Record<string, string> = {
  crime: '치안', air: '공기 질', water: '물 맑음', garbage: '청결 (쓰레기)', nimby: '주변 시설', school: '학교',
  hospital: '병원', commute: '통근', noise: '교통 소음', valueWealth: '땅값 대 소득', ordinances: '조례', taxes: '세율 변화',
  events: '최근 사건', buildings: '보상·랜드마크·거래', radiation: '방사능',
};

export const ORDINANCE_NAME: Record<OrdinanceId, string> = {
  legalizeGambling: '도박 합법화', automobileEmission: '자동차 배출 가스 감축법', carpool: '카풀 장려', cleanAir: '대기 정화법',
  communityCpr: '지역 심폐소생술 교육', freeClinic: '무료 진료소', juniorSports: '청소년 스포츠', landfillGas: '매립지 가스 회수',
  neighborhoodWatch: '자율 방범대', nuclearFreeZone: '비핵 지대', paperWaste: '종이 쓰레기 감축', powerConservation: '전력 절약법',
  proReading: '독서 장려', smokeDetector: '화재 감지기 보급', tireRecycling: '타이어 재활용', trashPresort: '쓰레기 분리 배출',
  waterConservation: '물 절약', youthCurfew: '청소년 통행 금지', commuterShuttle: '통근 셔틀', tourismPromotion: '관광 진흥',
};

export const CLASS_ICON = { land: 'car', air: 'plane', water: 'ship', rail: 'train' } as const;

export const DIFFICULTY_NAME = { easy: '쉬움', medium: '보통', hard: '어려움' } as const;

export const TRAINING_NAME = { road: '도로', rail: '철도', tank: '탱크', plane: '비행기', helicopter: '헬리콥터', boat: '배' } as const;

export const ALIGNMENT_NAME = { good: '선', evil: '악', neutral: '중립' } as const;

export const LIVE_ICON: Record<string, string> = { tornado: '🌪', robot: '🤖', autosaurus: '🦖', meteor: '☄', ufo: '🛸' };

/** Why a building was abandoned (engine AbandonReason). */
export const ABANDON_NAME: Record<AbandonReason, string> = {
  desirability: '쾌적도가 낮아서',
  'no-road': '도로가 끊겨서',
  demand: '수요가 없어서',
  'no-power': '전기가 끊겨서',
  'no-water': '물이 끊겨서',
  explosion: '폭발 피해',
  fire: '화재 피해',
  commute: '통근할 수 없어서',
  workforce: '일할 사람이 없어서',
};
