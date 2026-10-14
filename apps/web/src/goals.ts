// The goals the city pane is organised around: what each one watches, the map views,
// tools, budgets and ordinances that bear on it, and which goal an advisor's word or a
// facility belongs to.

import { STRUCTURES, type OrdinanceId, type StructureKind } from '@web-city/engine';
import { type IconName } from './icons';
import { city } from './state';

export type GoalId = 'finance' | 'growth' | 'power' | 'water' | 'garbage' | 'police' | 'fire' | 'health' | 'education' | 'traffic' | 'environment' | 'wealth';

export type Dept = keyof typeof city.state.departments;
export type Tone = '' | 'warn' | 'bad' | 'good';

/** A figure on the goal's screen: its name, value, and how it reads. */
/** A figure on the goal's screen: name, value, tone, the number behind it (to show how it moved), whether up is better (1), worse (−1) or neither (0), and a tooltip. */
export type Metric = [label: string, value: string, tone?: Tone, n?: number, better?: 1 | -1 | 0, title?: string];

/**
 * A part of a goal's screen, under its tab at the top: the data view it puts on the map, and the figures, graphs and
 * actions that are about it. (What none of a goal's tabs names is on its first, so nothing is left out.)
 */
export interface GoalTab {
  label: string;
  /** The data view it puts on the map ('none': the city as it is — money has no map). */
  view: string;
  /** Other views of the same thing, picked under the tabs (traffic's networks). */
  views?: [value: string, label: string][];
  /** Its figures, by the start of their names ('poll': the residents' poll on the goal's subject). */
  figs?: string[];
  /** Its graphs (their keys) and reports (the ids of the statistics' report boxes). */
  graphs?: string[];
  reports?: string[];
  /** Its tools, budgets and ordinances (some of the goal's). A department's budget brings its network's repair. */
  tools?: string[];
  depts?: Dept[];
  ordinances?: OrdinanceId[];
  /** Advisors' words about it: the screen opens on it when one of them is the trouble, and its tab is marked. */
  codes?: string[];
  /** Its own sections: the facilities' list, the usage bar, the air's sources, the demand bars, the deals, the spot
   *  to build or look at, the outlook (a forecast as things stand), the plants' dispatch, and 재정's levers (the
   *  deficit's fix, taxes, departments and loans, ordinances). */
  parts?: TabPart[];
  /** Shown only while its view has something to show (radiation). */
  optional?: true;
}
export type TabPart = 'facilities' | 'usage' | 'air' | 'rci' | 'deals' | 'spot' | 'fix' | 'taxes' | 'depts' | 'ords' | 'outlook' | 'dispatch';

export interface Goal {
  name: string;
  icon: IconName;
  /** What the screen is for, in a line. */
  aim: string;
  /** Its parts, each under a tab with its own map view (the screen opens on the one about the trouble, else the first). */
  tabs: GoalTab[];
  /** Tools that act on it: a tool id (a facility tool lists its kinds). */
  tools: string[];
  ordinances: OrdinanceId[];
  /** Department budgets that bear on it. */
  depts: [Dept, string][];
  /** Its facilities (listed with their figures and a budget for them all). */
  facility?: (k: StructureKind) => boolean;
  /** Other screens with more of it. */
  links?: ['budget' | 'region', string][];
}

const isKind = (pred: (d: (typeof STRUCTURES)[StructureKind]) => unknown) => (k: StructureKind) => !!pred(STRUCTURES[k]);

export const GOALS: Record<GoalId, Goal> = {
  finance: {
    name: '재정·정책', icon: 'wallet', aim: '수입과 지출을 맞추고 자금을 지킵니다: 세율, 부서 예산, 대출, 조례.',
    tabs: [
      { label: '수입·지출', view: 'none', figs: ['자금', '지난달 수지', '수입', '지출', '바닥까지', '다음 달 예상', '대출'], graphs: ['funds', 'budget'], reports: ['budget'], parts: ['fix', 'depts', 'outlook'], codes: ['broke', 'deficit', 'surplus'] },
      { label: '세율', view: 'mayor', figs: ['poll'], parts: ['taxes'], codes: ['taxHigh', 'taxEasing'] },
      { label: '조례', view: 'mayor', parts: ['ords'] },
    ],
    tools: [], ordinances: ['legalizeGambling', 'tourismPromotion'],
    depts: [],
  },
  growth: {
    name: '개발·수요', icon: 'zones', aim: '수요가 있는 곳에 구역을 내고, 빈 구역이 왜 비었는지 찾아 풉니다. 더 높은 밀도로 다시 칠하면 재개발됩니다.',
    tabs: [
      { label: '개발 막힘', view: 'growth', figs: ['인구', '일자리', '실업', '버려진 건물'], graphs: ['population', 'jobs', 'abandoned'], reports: ['buildings'], tools: ['road', 'bulldoze', 'dezone'], codes: ['noGrowth', 'abandoned', 'atRisk', 'rubble', 'unemployment', 'understaffed'] },
      { label: '수요', view: 'zones', figs: ['주거 수요', '상업 수요', '산업 수요', '농업 수요'], parts: ['rci'], tools: ['R-low', 'R-medium', 'R-high', 'C-low', 'C-medium', 'C-high', 'I-medium', 'I-high', 'A', 'park'], ordinances: ['tourismPromotion'], codes: ['capRes', 'capOffice', 'capIndustry', 'zoneR', 'zoneC', 'zoneI', 'zoneA'] },
    ],
    // (Bulldozing and dezoning too: reshaping the city is part of growing it.)
    tools: ['R-low', 'R-medium', 'R-high', 'C-low', 'C-medium', 'C-high', 'I-medium', 'I-high', 'A', 'road', 'park', 'bulldoze', 'dezone'],
    ordinances: ['tourismPromotion'], depts: [],
  },
  power: {
    name: '전력', icon: 'zap', aim: '수요보다 넉넉한 발전, 도시 전체에 닿는 전력망, 늙은 발전소 교체.',
    tabs: [
      { label: '전력망', view: 'power', figs: ['수요', '공급', '여유', '정전', '발전소'], graphs: ['power'], tools: ['power', 'powerline'], ordinances: ['powerConservation', 'nuclearFreeZone', 'landfillGas'], parts: ['usage', 'outlook', 'deals', 'dispatch', 'facilities', 'spot'], codes: ['noPower', 'powerShort', 'powerCutOff', 'powerSurplus', 'plantOld', 'idlePlant'] },
      { label: '노후 송전선', view: 'wear', figs: ['낡은 송전선'], depts: ['power'], codes: ['linesWorn'] },
    ],
    tools: ['power', 'powerline'], ordinances: ['powerConservation', 'nuclearFreeZone', 'landfillGas'],
    depts: [['power', '송전선 유지']], facility: isKind((d) => d.plant),
  },
  water: {
    name: '수도', icon: 'droplet', aim: '펌프·급수탑으로 수요를 채우고 수도관으로 건물에 닿게 합니다.',
    tabs: [
      { label: '급수', view: 'waterService', figs: ['수요', '공급', '여유', '단수', '물 없는 건물', '수도 시설'], graphs: ['water'], tools: ['water', 'pipe'], ordinances: ['waterConservation'], parts: ['usage', 'outlook', 'deals', 'facilities', 'spot'], codes: ['noWater', 'waterShort', 'pumpsOff', 'pipesNoSource', 'pumpOld', 'idlePump', 'dryBuildings'] },
      { label: '수질', view: 'waterPollution', figs: ['수질 오염', '오염으로 멈춘 펌프'], graphs: ['waterPollution'] },
      { label: '노후 수도관', view: 'wear', figs: ['낡은 수도관'], depts: ['water'], codes: ['pipesWorn'] },
    ],
    tools: ['water', 'pipe'], ordinances: ['waterConservation'],
    depts: [['water', '수도 (펌프·관)']], facility: isKind((d) => d.pump || d.treatment),
  },
  garbage: {
    name: '쓰레기', icon: 'trash', aim: '나오는 쓰레기를 매립·소각·재활용하고, 쌓이지 않게 수거합니다.',
    tabs: [
      { label: '수거·처리', view: 'garbage' },
    ],
    tools: ['landfill', 'garbage'], ordinances: ['paperWaste', 'trashPresort', 'tireRecycling', 'landfillGas'],
    depts: [['sanitation', '위생']], facility: isKind((d) => d.incinerator || d.recycling),
  },
  police: {
    name: '치안', icon: 'shield', aim: '경찰이 닿지 않는 곳과 범죄가 많은 곳을 찾아 경찰서와 조례로 줄입니다.',
    tabs: [
      { label: '범죄', view: 'crime', figs: ['범죄', '체포', '예방', '폭동', 'poll'], graphs: ['crimes'], tools: ['send-police'], ordinances: ['neighborhoodWatch', 'juniorSports', 'youthCurfew', 'legalizeGambling'], codes: ['riot'] },
      { label: '경찰 범위', view: 'police', figs: ['경찰서', '수감', '풀려남'], tools: ['police'], depts: ['corrections'], parts: ['facilities', 'spot'], codes: ['noPolice', 'policeReach', 'cellsFull', 'policeStrike'] },
    ],
    tools: ['police', 'send-police'], ordinances: ['neighborhoodWatch', 'juniorSports', 'youthCurfew', 'legalizeGambling'],
    depts: [['corrections', '교도소']], facility: isKind((d) => d.police),
  },
  fire: {
    name: '소방', icon: 'flame', aim: '불이 잘 나는 곳과 발전소를 소방서 반경 안에 둡니다.',
    tabs: [
      { label: '소방 범위', view: 'fire', figs: ['지금 불', '소방서', '출동 가능'], tools: ['fire', 'send-fire'], parts: ['facilities', 'spot'], codes: ['noFire', 'fires', 'plantUnprotected', 'fireStrike'] },
      { label: '화재 위험', view: 'flammability', figs: ['지난달 화재', '전소'], ordinances: ['smokeDetector'] },
    ],
    tools: ['fire', 'send-fire'], ordinances: ['smokeDetector'],
    depts: [], facility: isKind((d) => d.fire),
  },
  health: {
    name: '보건', icon: 'health', aim: '병원 정원과 반경을 넉넉히 해 건강 지수(HQ)와 수명을 올립니다.',
    tabs: [
      { label: '병원 범위', view: 'health', figs: ['환자', '병원'], tools: ['health'], parts: ['facilities', 'spot'], codes: ['noHospital', 'hospitalFull', 'hospitalStrike'] },
      { label: '건강 지수', view: 'hq', figs: ['건강 지수', '기대 수명', 'poll'], graphs: ['life'], ordinances: ['freeClinic', 'communityCpr'], codes: ['hqLow'] },
    ],
    tools: ['health'], ordinances: ['freeClinic', 'communityCpr'],
    depts: [], facility: isKind((d) => d.health),
  },
  education: {
    name: '교육', icon: 'school', aim: '학교 정원과 반경을 넉넉히 해 교육 지수(EQ)를 올립니다: 고급 일자리와 부유층의 바탕.',
    tabs: [
      { label: '학교 범위', view: 'school', figs: ['학생', '학교'], tools: ['education'], parts: ['facilities', 'spot'], codes: ['noSchool', 'schoolFull', 'schoolStrike'] },
      { label: '교육 지수', view: 'eq', figs: ['교육 지수', 'poll'], graphs: ['eq'], ordinances: ['proReading'], codes: ['eqLow'] },
      { label: '나이', view: 'age', reports: ['ages'] },
    ],
    tools: ['education'], ordinances: ['proReading'],
    depts: [], facility: isKind((d) => d.school),
  },
  traffic: {
    name: '교통', icon: 'route', aim: '막힌 길을 넓히거나 대중교통으로 나눠, 통근 시간을 줄입니다.',
    tabs: [
      { label: '혼잡', view: 'traffic', figs: ['평균 통근', '막힌 길', '하루 통행'], graphs: ['commute'], tools: ['road', 'avenue', 'highway', 'onramp'], depts: ['roads'], parts: ['spot'], codes: ['congestion', 'potholes', 'facilityNoRoad'] },
      { label: '통근', view: 'commute', figs: ['평균 통근', '대중교통 비중', '정류장·역', 'poll'], graphs: ['commute'], tools: ['transport', 'subway', 'rail'], depts: ['transit'], ordinances: ['carpool', 'commuterShuttle'], parts: ['facilities'], codes: ['noCommute', 'stationFull'] },
      { label: '통행량', view: 'volume:road', figs: ['하루 통행'], graphs: ['trips'],
        views: [['volume:road', '도로'], ['volume:evening', '저녁 퇴근'], ['volume:highway', '고속도로'], ['volume:rail', '철도'], ['volume:subway', '지하철'], ['subway', '지하철 노선'], ['volume:monorail', '모노레일'], ['volume:ferry', '페리']] },
    ],
    tools: ['road', 'avenue', 'highway', 'onramp', 'rail', 'subway', 'transport'], ordinances: ['carpool', 'commuterShuttle'],
    depts: [['roads', '도로 유지'], ['transit', '대중교통']], facility: isKind((d) => d.station || d.parking || d.airport || d.seaport),
  },
  environment: {
    name: '환경·쾌적', icon: 'trees', aim: '공기와 물을 맑게, 공원으로 쾌적도와 시장 평점을 올립니다.',
    tabs: [
      { label: '대기', view: 'air', figs: ['대기 오염', '공기 나쁜 주거지', 'poll'], graphs: ['air'], tools: ['trees'], ordinances: ['cleanAir', 'automobileEmission'], parts: ['air', 'spot'], codes: ['smog'] },
      { label: '수질', view: 'waterPollution', figs: ['수질 오염'], graphs: ['waterPollution'] },
      { label: '쾌적도', view: 'desirability', figs: ['공원'], tools: ['park'], depts: ['parks'], codes: ['noParks'] },
      { label: '시장 평점', view: 'mayor', figs: ['시장 평점'], graphs: ['mayorRating'], reports: ['polls'], codes: ['mayorLow', 'mayorHigh'] },
      { label: '방사능', view: 'radiation', codes: ['radiation'], optional: true },
    ],
    tools: ['park', 'trees'], ordinances: ['cleanAir', 'automobileEmission'],
    depts: [['parks', '공원 미화']],
  },
  // Not a problem to fix but a direction to take: the wealthy come for high land value, clean air, schools and landmarks.
  wealth: {
    name: '부유층·고급화', icon: 'gem', aim: '쾌적도를 올려(공원·랜드마크, 맑은 공기, 좋은 학교; 물가와 높은 땅은 땅값도) 부유층 주거와 고급 상업·오피스를 끌어옵니다.',
    tabs: [
      { label: '쾌적도', view: 'desirability', figs: ['부유층 주민', '중산층 주민', '부유층 주거 수요', '고급 상점 수요', '고급 오피스 수요'], reports: ['wealth', 'rewards'], tools: ['park', 'landmark', 'reward', 'R-high', 'C-high'], depts: ['parks', 'landmarks'], ordinances: ['tourismPromotion', 'cleanAir'] },
      { label: '땅값', view: 'landValue', figs: ['평균 땅값', 'poll'] },
      { label: '교육', view: 'eq', figs: ['교육 지수'], tools: ['education'], ordinances: ['proReading'] },
    ],
    tools: ['park', 'landmark', 'reward', 'education', 'R-high', 'C-high'], ordinances: ['cleanAir', 'proReading', 'tourismPromotion'],
    depts: [['parks', '공원 미화'], ['landmarks', '랜드마크']],
  },
};

export const GOAL_ORDER = Object.keys(GOALS) as GoalId[];

/** Which goal each advisor's word belongs to (else the advisor's own). */
const ADVICE_GOAL: Record<string, GoalId> = {
  broke: 'finance', deficit: 'finance', taxHigh: 'finance', taxEasing: 'finance', surplus: 'finance',
  noPower: 'power', powerShort: 'power', powerCutOff: 'power', powerSurplus: 'power', plantOld: 'power', idlePlant: 'power',
  noWater: 'water', waterShort: 'water', pumpsOff: 'water', pipesNoSource: 'water', pumpOld: 'water', idlePump: 'water', dryBuildings: 'water',
  landfillFull: 'garbage', landfillSoon: 'garbage', garbagePiling: 'garbage', landfillNoRoad: 'garbage', garbageNoRoute: 'garbage', landfillNew: 'garbage', landfillNewNoRoad: 'garbage',
  noPolice: 'police', policeReach: 'police', cellsFull: 'police', riot: 'police', policeStrike: 'police', linesWorn: 'power', pipesWorn: 'water',
  noFire: 'fire', fires: 'fire', plantUnprotected: 'fire', fireStrike: 'fire',
  noHospital: 'health', hospitalFull: 'health', hospitalStrike: 'health', hqLow: 'health',
  noSchool: 'education', schoolFull: 'education', schoolStrike: 'education', eqLow: 'education',
  congestion: 'traffic', stationFull: 'traffic', noCommute: 'traffic', potholes: 'traffic', facilityNoRoad: 'traffic',
  smog: 'environment', radiation: 'environment', noParks: 'environment', mayorLow: 'environment',
};
const ADVISOR_GOAL: Record<string, GoalId> = {
  planner: 'growth', finance: 'finance', utilities: 'power', safety: 'police', healthEducation: 'health', transportation: 'traffic', environment: 'environment',
};

/** The goal a facility serves (its info card links to that goal's screen); null for none. */
export function goalOfStructure(k: StructureKind): GoalId | null {
  const d = STRUCTURES[k];
  if (d.plant) return 'power';
  if (d.pump || d.treatment) return 'water';
  if (d.incinerator || d.recycling) return 'garbage';
  if (d.police) return 'police';
  if (d.fire) return 'fire';
  if (d.health) return 'health';
  if (d.school) return 'education';
  if (d.station || d.parking || d.airport || d.seaport) return 'traffic';
  if (d.category === 'park') return 'environment';
  if (d.category === 'reward' || d.category === 'landmark') return 'wealth';
  return null;
}

export const goalOfAdvice = (a: { code: string; advisor: string; at?: readonly [number, number] }): GoalId => {
  // A facility cut off from the roads belongs with its own kind (a fire station under 소방), not with traffic.
  if (a.code === 'facilityNoRoad' && a.at) {
    const kind = city.query(a.at[0], a.at[1])?.structure?.kind;
    const g = kind ? goalOfStructure(kind) : null;
    if (g) return g;
  }
  return ADVICE_GOAL[a.code] ?? (a.code.startsWith('zone') || a.code.startsWith('cap') ? 'growth' : ADVISOR_GOAL[a.advisor] ?? 'growth');
};


/** The goals an ordinance is offered on (the budget sheet names them beside it). */
export function goalsOfOrdinance(id: OrdinanceId): GoalId[] {
  return GOAL_ORDER.filter((g) => GOALS[g].ordinances.includes(id));
}
