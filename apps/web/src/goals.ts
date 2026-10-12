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

export interface Goal {
  name: string;
  icon: IconName;
  /** What the screen is for, in a line. */
  aim: string;
  /** The map views that answer its questions (the first comes on with it). */
  views: [value: string, label: string][];
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
    views: [['mayor', '시장 평점'], ['landValue', '땅값']],
    tools: [], ordinances: ['legalizeGambling', 'tourismPromotion'],
    depts: [],
  },
  growth: {
    name: '개발·수요', icon: 'zones', aim: '수요가 있는 곳에 구역을 내고, 빈 구역이 왜 비었는지 찾아 풉니다. 더 높은 밀도로 다시 칠하면 재개발됩니다.',
    views: [['growth', '개발 막힘'], ['zones', '구역'], ['desirability', '쾌적도'], ['landValue', '땅값']],
    // (Bulldozing and dezoning too: reshaping the city is part of growing it.)
    tools: ['R-low', 'R-medium', 'R-high', 'C-low', 'C-medium', 'C-high', 'I-medium', 'I-high', 'A', 'road', 'park', 'bulldoze', 'dezone'],
    ordinances: ['tourismPromotion'], depts: [],
  },
  power: {
    name: '전력', icon: 'zap', aim: '수요보다 넉넉한 발전, 도시 전체에 닿는 전력망, 늙은 발전소 교체.',
    views: [['power', '전력망'], ['wear', '노후 시설']],
    tools: ['power', 'powerline'], ordinances: ['powerConservation', 'nuclearFreeZone', 'landfillGas'],
    depts: [['power', '송전선 유지']], facility: isKind((d) => d.plant),
  },
  water: {
    name: '수도', icon: 'droplet', aim: '펌프·급수탑으로 수요를 채우고 수도관으로 건물에 닿게 합니다.',
    views: [['waterService', '수도'], ['waterPollution', '수질 오염'], ['wear', '노후 시설']],
    tools: ['water', 'pipe'], ordinances: ['waterConservation'],
    depts: [['water', '수도 (펌프·관)']], facility: isKind((d) => d.pump || d.treatment),
  },
  garbage: {
    name: '쓰레기', icon: 'trash', aim: '나오는 쓰레기를 매립·소각·재활용하고, 쌓이지 않게 수거합니다.',
    views: [['garbage', '쓰레기']],
    tools: ['landfill', 'garbage'], ordinances: ['paperWaste', 'trashPresort', 'tireRecycling', 'landfillGas'],
    depts: [['sanitation', '위생']], facility: isKind((d) => d.incinerator || d.recycling),
  },
  police: {
    name: '치안', icon: 'shield', aim: '경찰이 닿지 않는 곳과 범죄가 많은 곳을 찾아 경찰서와 조례로 줄입니다.',
    views: [['crime', '범죄'], ['police', '경찰 범위']],
    tools: ['police', 'send-police'], ordinances: ['neighborhoodWatch', 'juniorSports', 'youthCurfew', 'legalizeGambling'],
    depts: [['corrections', '교도소']], facility: isKind((d) => d.police),
  },
  fire: {
    name: '소방', icon: 'flame', aim: '불이 잘 나는 곳과 발전소를 소방서 반경 안에 둡니다.',
    views: [['fire', '소방 범위'], ['flammability', '화재 위험도']],
    tools: ['fire', 'send-fire'], ordinances: ['smokeDetector'],
    depts: [], facility: isKind((d) => d.fire),
  },
  health: {
    name: '보건', icon: 'health', aim: '병원 정원과 반경을 넉넉히 해 건강 지수(HQ)와 수명을 올립니다.',
    views: [['health', '병원 범위'], ['hq', '건강 지수'], ['air', '대기 오염']],
    tools: ['health'], ordinances: ['freeClinic', 'communityCpr'],
    depts: [], facility: isKind((d) => d.health),
  },
  education: {
    name: '교육', icon: 'school', aim: '학교 정원과 반경을 넉넉히 해 교육 지수(EQ)를 올립니다: 고급 일자리와 부유층의 바탕.',
    views: [['school', '학교 범위'], ['eq', '교육 지수'], ['age', '평균 나이']],
    tools: ['education'], ordinances: ['proReading'],
    depts: [], facility: isKind((d) => d.school),
  },
  traffic: {
    name: '교통', icon: 'route', aim: '막히는 길을 넓히거나 대중교통으로 나눠, 통근 시간을 줄입니다.',
    views: [['traffic', '혼잡'], ['commute', '통근 시간'], ['volume:road', '도로 통행량']],
    tools: ['road', 'avenue', 'highway', 'onramp', 'rail', 'subway', 'transport'], ordinances: ['carpool', 'commuterShuttle'],
    depts: [['roads', '도로 유지'], ['transit', '대중교통']], facility: isKind((d) => d.station || d.parking || d.airport || d.seaport),
  },
  environment: {
    name: '환경·쾌적', icon: 'trees', aim: '공기와 물을 맑게, 공원으로 쾌적도와 시장 평점을 올립니다.',
    views: [['air', '대기 오염'], ['waterPollution', '수질 오염'], ['desirability', '쾌적도'], ['mayor', '시장 평점']],
    tools: ['park', 'trees'], ordinances: ['cleanAir', 'automobileEmission'],
    depts: [['parks', '공원 미화']],
  },
  // Not a problem to fix but a direction to take: the wealthy come for high land value, clean air, schools and landmarks.
  wealth: {
    name: '부유층·고급화', icon: 'gem', aim: '쾌적도를 올려(공원·랜드마크, 맑은 공기, 좋은 학교; 물가와 높은 땅은 땅값도) 부유층 주거와 고급 상업·오피스를 끌어옵니다.',
    views: [['desirability', '쾌적도'], ['landValue', '땅값'], ['air', '대기 오염'], ['school', '학교 범위']],
    tools: ['park', 'landmark', 'reward', 'education', 'R-high', 'C-high'], ordinances: ['cleanAir', 'proReading', 'tourismPromotion'],
    depts: [['parks', '공원 미화'], ['landmarks', '랜드마크']],
  },
};

export const GOAL_ORDER = Object.keys(GOALS) as GoalId[];

/** Which goal each advisor's word belongs to (else the advisor's own). */
const ADVICE_GOAL: Record<string, GoalId> = {
  broke: 'finance', deficit: 'finance', taxHigh: 'finance', surplus: 'finance',
  noPower: 'power', powerShort: 'power', powerCutOff: 'power', powerSurplus: 'power', plantOld: 'power', idlePlant: 'power',
  noWater: 'water', waterShort: 'water', pumpsOff: 'water', pipesNoSource: 'water', pumpOld: 'water', idlePump: 'water', dryBuildings: 'water',
  landfillFull: 'garbage', landfillSoon: 'garbage', garbagePiling: 'garbage', landfillNoRoad: 'garbage',
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
