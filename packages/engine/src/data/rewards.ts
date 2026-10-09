// Rewards, business deals and landmarks, with Rush Hour revisions. Mayor
// Rating radii are in tiles: a fixed effect on every tile within them (radius
// 440 reaches across even a large city). Crime radii are the original values
// ÷ 16 (Rush Hour: Area 5.1's crime radius 128 is 8 tiles). Where figures
// conflict or are missing, the choice is noted next to the entry.

import type { StructureCategory, StructureDef } from './structures';

/**
 * Low pollution (Resort Hotel): the city's residents breathe (on average) less air
 * pollution than this, half the medium level My Sims complain at (an assumed threshold).
 */
export const LOW_POLLUTION = 50;

const ZERO3 = [0, 0, 0] as const;
const NONE = [0, 0] as const;

type Extra = Partial<Omit<StructureDef, 'name' | 'category' | 'w' | 'h' | 'cost' | 'upkeep'>>;
const def = (
  name: string, category: StructureCategory, w: number, h: number, cost: number, upkeep: number, extra: Extra = {},
): StructureDef => ({ name, category, w, h, cost, upkeep, relief: ZERO3, com: NONE, res: NONE, jobs: ZERO3, powerUse: 0, waterUse: 0, garbage: 0, ...extra });

/**
 * Rewards, landmarks and business deals are highly flammable (the Toxic Waste Dump ranks above the
 * Recycling Center): without water (×1.25) they reach the hotspot level.
 */
const HIGH_FLAMMABILITY = 48;

/** power / water / garbage use. */
const util = (powerUse: number, waterUse: number, garbage: number) => ({ powerUse, waterUse, garbage });

/** One-per-city reward with an unlock condition. */
const reward = (name: string, w: number, h: number, cost: number, upkeep: number, bulldoze: number, extra: Extra) =>
  def(name, 'reward', w, h, cost, upkeep, { bulldoze, limit: 1, flammability: HIGH_FLAMMABILITY, ...extra });

export const REWARDS = {
  mayorsHouse: reward("Mayor's House", 2, 3, 1_800, 10, 160, {
    com: [100, 48], res: [100, 48], mayor: [2, 220], ...util(5, 7, 4), pollution: [1, 2, 1, 3], flammability: 30,
    unlock: { description: '총인구 500 · 시장 평점 20', population: 500, mayorRating: 20 },
  }),
  // Statue costs: where figures conflict, the lower monthly costs are used.
  mayorsStatue: reward("Mayor's Statue", 1, 1, 3_700, 30, 330, {
    com: [25, 17], res: [25, 17], mayor: [3, 110], ...util(1, 0, 1), flammability: 5,
    unlock: { description: '주거 인구 5,000 · 시장 평점 60', residents: 5_000, mayorRating: 60 },
  }),
  impressiveMayorsStatue: reward("Impressive Mayor's Statue", 1, 1, 6_400, 40, 580, {
    com: [50, 14], res: [50, 22], mayor: [3, 220], ...util(1, 0, 1), flammability: 5,
    unlock: { description: '주거 인구 30,000 · 시장 평점 60', residents: 30_000, mayorRating: 60 },
  }),
  magnificentMayorsStatue: reward("Magnificent Mayor's Statue", 2, 2, 22_000, 150, 1_980, {
    com: [75, 27], res: [75, 27], mayor: [3, 330], ...util(1, 0, 1), flammability: 5,
    unlock: { description: '주거 인구 60,000 · 시장 평점 60', residents: 60_000, mayorRating: 60 },
  }),
  colossalMayorsStatue: reward("Colossal Mayor's Statue", 3, 3, 57_000, 400, 5_130, {
    com: [100, 48], res: [100, 48], mayor: [3, 440], ...util(1, 0, 1), flammability: 5,
    unlock: { description: '주거 인구 120,000 · 시장 평점 60', residents: 120_000, mayorRating: 60 },
  }),
  cityHall: reward('City Hall', 3, 4, 40_000, 280, 2_700, {
    jobs: [0, 30, 0], com: [50, 22], ...util(25, 60, 10), pollution: [1, 2, 1, 3],
    unlock: { description: '총인구 12,500 · 시장 평점 20', population: 12_500, mayorRating: 20 },
  }),
  // Relief of 15 read as 15,000.
  courthouse: reward('Courthouse', 3, 3, 44_000, 310, 2_960, {
    relief: [0, 15_000, 15_000], com: [70, 26], ...util(38, 70, 11), pollution: [2, 2, 1, 3],
    unlock: { description: '총인구 40,000 · 시장 평점 33 · 시청', population: 40_000, mayorRating: 33, requires: ['cityHall'] },
  }),
  bureauOfBureaucracy: reward('Bureau of Bureaucracy', 4, 4, 46_000, 320, 7_440, {
    jobs: [0, 100, 0], com: [25, 17], res: [-50, 22], ...util(100, 200, 50), pollution: [2, 3, 2, 4],
    unlock: { description: '총인구 39,000 · 시장 평점 30 · 예산이 충분한 보건·교육', population: 39_000, mayorRating: 30, wellFunded: true },
  }),
  // Private rewards (Rush Hour): free to build and run, costly to bulldoze.
  houseOfWorship: def('House of Worship', 'reward', 3, 3, 0, 0, {
    bulldoze: 3_500, res: [80, 28], mayor: [4, 110], ...util(5, 5, 6), pollution: [1, 2, 1, 3], flammability: 32,
    unlockTiers: [
      { description: '주거 인구 1,000 · 시장 평점 40', residents: 1_000, mayorRating: 40 },
      { description: '주거 인구 5,000 · 시장 평점 44', residents: 5_000, mayorRating: 44 },
      { description: '주거 인구 30,000 · 시장 평점 48', residents: 30_000, mayorRating: 48 },
      { description: '주거 인구 120,000 · 시장 평점 52', residents: 120_000, mayorRating: 52 },
    ],
  }),
  cemetery: def('Cemetery', 'reward', 5, 5, 0, 0, {
    bulldoze: 1_200, res: [40, 20], mayor: [2, 220], ...util(1, 100, 1), pollution: [-15, 3, 4, 3], flammability: 10,
    unlockTiers: [
      { description: '주거 인구 2,000 · 시장 평점 42', residents: 2_000, mayorRating: 42 },
      { description: '주거 인구 15,000 · 시장 평점 46', residents: 15_000, mayorRating: 46 },
      { description: '주거 인구 60,000 · 시장 평점 50', residents: 60_000, mayorRating: 50 },
    ],
  }),
  privateSchool: def('Private School', 'education', 3, 4, 0, 0, {
    bulldoze: 3_220, relief: [0, 0, 6_000], jobs: [10, 19, 4], res: [60, 24], ...util(8, 25, 6), pollution: [1, 2, 1, 3],
    school: { radius: 32, capacity: 1_000, boost: 5, curve: 'privateSchool' },
    unlockTiers: [
      { description: 'R$$$ 인구 750 · 평균 학교 등급 85 미만', typePopulation: { 'R$$$': 750 }, schoolGrade: { below: 85 } },
      { description: 'R$$$ 인구 3,750 · 평균 학교 등급 85 미만', typePopulation: { 'R$$$': 3_750 }, schoolGrade: { below: 85 } },
      { description: 'R$$$ 인구 7,500 · 평균 학교 등급 85 미만', typePopulation: { 'R$$$': 7_500 }, schoolGrade: { below: 85 } },
    ],
  }),
  farmersMarket: def("Farmer's Market", 'health', 3, 3, 4_900, 30, {
    bulldoze: 440, limit: 1, relief: [20_000, 150_000, 0], com: [50, 22], res: [75, 27], ...util(3, 10, 9), pollution: [1, 1, 1, 2],
    health: { radius: 363, capacity: 200_000, boost: 0.1 },
    unlock: { description: '총인구 3,000 · 시장 평점 34 · 농업 600명', population: 3_000, mayorRating: 34, typePopulation: { IA: 600 } },
  }),
  stateFair: reward('State Fair', 8, 12, 0, 0, 990, {
    com: [50, 14], res: [-25, 17], mayor: [5, 440], crimeEffect: [20, 1.25], ...util(50, 180, 23), pollution: [2, 2, 2, 3],
    unlock: { description: '총인구 3,500 · 시장 평점 48 · 농업 1,200명', population: 3_500, mayorRating: 48, typePopulation: { IA: 1_200 } },
  }),
  // Regional conditions become city ones: population and neighbour connections.
  touristTrap: reward('Tourist Trap', 3, 2, 10_000, 210, 9_000, {
    relief: [100_000, 0, 0], com: [50, 36], res: [-25, 17], ...util(2, 4, 11), pollution: [1, 2, 1, 2],
    unlock: {
      description: '총인구 40,000 · 이웃 연결 2개 (지역: 지역 인구 40,000 · 연결된 이웃 도시 4곳 · 다른 도시와 이어진 지역 도시 6곳)', population: 40_000, connections: 2,
      regional: { population: 40_000, connected: 4, linkedCities: 6 },
    },
  }),
  radioStation: reward('Radio Station', 3, 3, 0, 0, 10_260, {
    relief: [0, 9_000, 0], industryRelief: { IM: 9_000 }, com: [25, 17], mayor: [2, 440], ...util(150, 90, 11), pollution: [4, 3, 3, 4],
    unlock: { description: '총인구 18,000 · 시장 평점 30', population: 18_000, mayorRating: 30 },
  }),
  televisionStudio: reward('Television Studio', 3, 3, 0, 0, 13_060, {
    relief: [0, 3_000, 0], officeRelief: [10_000, 0], com: [50, 22], res: [-25, 17], ...util(175, 250, 19), pollution: [6, 3, 4, 4],
    unlock: { description: '총인구 65,000 · 시장 평점 50 · 라디오 방송국', population: 65_000, mayorRating: 50, requires: ['radioStation'] },
  }),
  movieStudio: reward('Movie Studio', 8, 6, 0, 0, 21_590, {
    jobs: [0, 0, 34], com: [50, 14], ...util(150, 200, 15), pollution: [4, 4, 3, 5],
    unlock: { description: '총인구 110,000 · 시장 평점 52 · TV 스튜디오', population: 110_000, mayorRating: 52, requires: ['televisionStudio'] },
  }),
  minorLeagueStadium: reward('Minor League Stadium', 7, 7, 17_000, 120, 9_530, {
    relief: [200_000, 200_000, 0], com: [50, 22], res: [-20, 16], mayor: [3, 440], ...util(20, 70, 9), pollution: [-10, 4, 5, 5],
    unlock: { description: '총인구 22,500 · 시장 평점 20 · 공원 16곳', population: 22_500, mayorRating: 20, parks: 16 },
  }),
  majorLeagueStadium: reward('Major League Stadium', 9, 8, 48_000, 340, 24_320, {
    relief: [300_000, 300_000, 0], com: [75, 27], res: [-50, 20], mayor: [5, 440], ...util(50, 85, 50), pollution: [-10, 4, 7, 5],
    unlock: { description: '총인구 85,000 · 시장 평점 30 · 마이너리그 경기장', population: 85_000, mayorRating: 30, requires: ['minorLeagueStadium'] },
  }),
  // Relief: 8,000/16,000 rather than a conflicting 0.
  cityZoo: reward('City Zoo', 8, 8, 37_000, 260, 3_330, {
    relief: [8_000, 16_000, 0], com: [50, 14], res: [25, 17], mayor: [5, 440], ...util(55, 190, 20), pollution: [-5, 3, 5, 4],
    flammability: 30, unlock: { description: '총인구 80,000 · 시장 평점 68 · 공원 25곳', population: 80_000, mayorRating: 68, parks: 25 },
  }),
  countryClub: reward('Country Club', 12, 12, 0, 0, 18_730, {
    relief: [0, 0, 8_000], res: [75, 27], mayor: [-5, 220], ...util(17, 750, 5), pollution: [-22, 4, 8, 3], flammability: 20,
    unlock: { description: 'R$$$ 인구 2,000 · 시장 평점 55', typePopulation: { 'R$$$': 2_000 }, mayorRating: 55 },
  }),
  resortHotel: reward('Resort Hotel', 4, 4, 0, 0, 23_780, {
    relief: [0, 5_000, 5_000], jobs: [0, 37, 0], com: [25, 17], mayor: [4, 440], ...util(70, 100, 21), pollution: [2, 3, 3, 4],
    unlock: {
      description: 'R$$+R$$$ 인구 20,000 · 시장 평점 52 · 낮은 오염 (지역: 지역 R$$+R$$$ 50,000 · 도시 4곳)',
      combined: { types: ['R$$', 'R$$$'], population: 20_000 }, mayorRating: 52, lowPollution: true,
      regional: { highWealth: 50_000, cities: 4, mayorRating: 52, lowPollution: true },
    },
  }),
  stockExchange: reward('Stock Exchange', 3, 4, 0, 0, 35_760, {
    relief: [0, 0, 125_000], jobs: [0, 0, 15], com: [70, 26], ...util(55, 90, 19), pollution: [2, 3, 2, 4],
    unlock: { description: '오피스 일자리 25,000 · 시장 평점 45', combined: { types: ['Co$$', 'Co$$$'], population: 25_000 }, mayorRating: 45 },
  }),
  mainLibrary: def('Main Library', 'education', 3, 4, 19_000, 130, {
    bulldoze: 2_750, limit: 1, com: [50, 22], res: [50, 22], ...util(18, 30, 9), pollution: [1, 2, 1, 3],
    school: { radius: 363, capacity: 25_000, boost: 30, curve: 'mainLibrary' },
    unlock: { description: '주거 인구 34,000 · 시장 평점 37 · 등급 85 넘는 도서관 5곳', residents: 34_000, mayorRating: 37, goodBuildings: { localLibrary: 5 } },
  }),
  majorArtMuseum: def('Major Art Museum', 'education', 3, 3, 13_000, 90, {
    bulldoze: 10_070, limit: 1, relief: [0, 6_000, 6_000], com: [70, 26], res: [50, 22], mayor: [5, 440], ...util(60, 100, 8),
    pollution: [1, 2, 1, 3], school: { radius: 363, capacity: 24_000, boost: 3, curve: 'artMuseum' },
    unlock: {
      description: 'R$$+R$$$ 인구 12,000 · 시장 평점 45 · 등급 85 넘는 시립 박물관 4곳',
      combined: { types: ['R$$', 'R$$$'], population: 12_000 }, mayorRating: 45, goodBuildings: { cityMuseum: 4 },
    },
  }),
  operaHouse: def('Opera House', 'education', 3, 4, 28_000, 200, {
    bulldoze: 1_520, limit: 1, relief: [0, 0, 5_000], com: [50, 22], ...util(25, 60, 15), pollution: [1, 2, 1, 15],
    school: { radius: 363, capacity: 1_200, boost: 3, curve: 'opera' },
    unlock: {
      description: 'R$$+R$$$ 인구 48,000 · 시장 평점 52 · 미술관',
      combined: { types: ['R$$', 'R$$$'], population: 48_000 }, mayorRating: 52, requires: ['majorArtMuseum'],
    },
  }),
  advancedResearchCenter: reward('Advanced Research Center', 6, 7, 0, 0, 6_300, {
    industryRelief: { IHT: 150_000 }, jobs: [0, 92, 31], com: [50, 22], res: [-50, 22], mayor: [-3, 220], ...util(65, 150, 15),
    pollution: [3, 2, 4, 3], flammability: 34,
    unlock: { description: '첨단 산업 2,000명 · 시장 평점 54 · 종합대학', typePopulation: { IHT: 2_000 }, mayorRating: 54, requires: ['university'] },
  }),
  // Major airport: a municipal or international one.
  conventionCenter: reward('Convention Center', 6, 9, 32_000, 220, 2_880, {
    officeRelief: [100_000, 100_000], jobs: [15, 0, 0], com: [100, 32], res: [-50, 22], crimeEffect: [20, 0.625],
    ...util(125, 175, 23), pollution: [3, 4, 2, 5],
    unlock: {
      description: '상업 일자리 25,000 · 시장 평점 40 · 시립/국제공항',
      combined: { types: ['Cs$', 'Cs$$', 'Cs$$$', 'Co$$', 'Co$$$'], population: 25_000 }, mayorRating: 40,
      anyOf: [
        'smallMunicipalAirport', 'mediumMunicipalAirport', 'largeMunicipalAirport',
        'smallInternationalAirport', 'mediumInternationalAirport', 'largeInternationalAirport',
      ],
    },
  }),
  // Rush Hour.
  lighthouse: reward('Lighthouse', 3, 3, 6_500, 100, 210, {
    industryRelief: { ID: 3_000, IM: 3_000 }, jobs: [1, 0, 0], com: [50, 22], res: [-50, 22], mayor: [3, 220],
    ...util(65, 0, 1), pollution: [1, 2, 1, 3], flammability: 36,
    unlock: { description: '운영 중인 국제 항구', workingBuildings: { internationalPort: 1 } },
  }),
  // Rush Hour. The Marina's jobs and relief figures appear copied from another entry; 2 R$ jobs used.
  marina: def('Marina', 'reward', 1, 6, 4_000, 90, {
    bulldoze: 180, jobs: [2, 0, 0], com: [15, 12], res: [25, 22], mayor: [2, 120], ...util(15, 50, 15), pollution: [3, 2, 4, 3],
    flammability: 36,
    unlock: {
      // Mayor Rating over 53 (the rating is fractional: just above 53).
      description: 'R$$+R$$$ 인구 18,000 · 시장 평점 53 초과 · 물 25% 이상',
      combined: { types: ['R$$', 'R$$$'], population: 18_000 }, mayorRating: 53.01, waterShare: 0.25,
    },
  }),
  // Rush Hour transportation rewards.
  grandRailroadStation: reward('Grand Railroad Station', 10, 6, 24_000, 300, 2_160, {
    station: { mode: 'rail', capacity: 10_000, switchCost: 5 }, jobs: [4, 0, 0], ...util(42, 15, 10), pollution: [6, 4, 4, 2], flammability: 37, maxFire: 3,
    unlock: {
      description: '주거+상업 인구 172,000 · 거의 가득 찬 여객 기차역',
      combined: { types: ['R$', 'R$$', 'R$$$', 'Cs$', 'Cs$$', 'Cs$$$', 'Co$$', 'Co$$$'], population: 172_000 },
      busyStation: { kind: 'trainStation', share: 0.9 },
    },
  }),
  cruiseShipPort: reward('Cruise Ship Port', 4, 5, 28_000, 180, 2_580, {
    onWater: true, jobs: [0, 45, 0], com: [60, 24], ...util(28, 75, 13), pollution: [2, 2, 22, 4], flammability: 33,
    unlock: {
      // More than 15 park structures.
      description: '상업 일자리 15,000 · 공원 16곳 · 물 35% 이상',
      combined: { types: ['Cs$', 'Cs$$', 'Cs$$$', 'Co$$', 'Co$$$'], population: 15_000 }, parks: 16, waterShare: 0.35,
    },
  }),
  spacePort: reward('Space Port', 7, 6, 96_000, 400, 4_200, {
    jobs: [0, 100, 0], com: [25, 17], res: [-50, 22], ...util(700, 360, 10), pollution: [10, 3, 5, 4], flammability: 38,
    unlock: {
      description: '첨단 산업 25,000명 · 첨단 연구소 · 보통 이상 난이도',
      typePopulation: { IHT: 25_000 }, requires: ['advancedResearchCenter'], difficulty: ['medium', 'hard'],
    },
  }),
} as const satisfies Record<string, StructureDef>;

/** Business deal: free to place, pays monthly even without utilities, offered in hard times. */
const deal = (name: string, w: number, h: number, income: number, bulldoze: number, extra: Extra) =>
  def(name, 'deal', w, h, 0, 0, { income, bulldoze, limit: 1, flammability: HIGH_FLAMMABILITY, ...extra });

export const DEALS = {
  // The funds condition read as a 40% drop over 36 months.
  armyBase: deal('Army Base', 12, 12, 350, 17_500, {
    industryRelief: { IM: 100_000 }, jobs: [45, 0, 0], com: [25, 9], res: [-90, 30], mayor: [-7, 440], crimeEffect: [30, 4],
    ...util(135, 250, 13), pollution: [4, 4, 5, 5],
    offer: { description: '자금 §7,000 미만 · 3년 새 40% 감소 · 적자 · 총인구 2,000', fundsBelow: 7_000, drop: { months: 36, fraction: 0.4 }, deficit: true, population: 2_000 },
  }),
  casino: deal('Casino', 6, 3, 300, 15_000, {
    serviceDemand: [45, 21, 10], com: [50, 22], res: [-65, 25], mayor: [-7, 440], crimeEffect: [50, 8], ...util(300, 550, 30), pollution: [3, 4, 3, 5],
    offer: { description: '도박 합법화 조례 · 총인구 24,000', ordinance: 'legalizeGambling', population: 24_000 },
  }),
  // A super jail: 3,000 inmates, never overcrowded; §10 a month per inmate over that.
  federalPrison: deal('Federal Prison', 4, 4, 250, 12_500, {
    police: { radius: 0, center: 0, cells: 3_000, overcapacityCost: 10 }, jobs: [35, 0, 0], com: [-70, 26], res: [-90, 30], mayor: [-7, 440], crimeEffect: [15, 8], ...util(125, 300, 17), pollution: [4, 4, 4, 5],
    offer: { description: '자금 §7,000 미만 · 2년 새 50% 감소 · 적자 · 총인구 5,000', fundsBelow: 7_000, drop: { months: 24, fraction: 0.5 }, deficit: true, population: 5_000 },
  }),
  // Launch rate assumed: one a month, 3.5% of them misfiring.
  missileRange: deal('Missile Range', 4, 4, 450, 22_500, {
    com: [-50, 22], res: [-100, 48], mayor: [-5, 440], ...util(0, 0, 50), pollution: [9, 6, 10, 7], flammability: 0,
    missile: { misfire: 0.035, radius: 8, fires: [3, 6] },
    offer: { description: '자금 §1,000 미만 · 6개월 새 20% 감소 · 적자 · 총인구 500', fundsBelow: 1_000, drop: { months: 6, fraction: 0.2 }, deficit: true, population: 500 },
  }),
  // Radiation clears within months (6 used).
  toxicWasteDump: deal('Toxic Waste Dump', 4, 4, 400, 20_000, {
    com: [-60, 24], res: [-100, 48], mayor: [-10, 440], ...util(80, 200, 35), pollution: [44, 8, 75, 10], flammability: 68,
    radiation: { radius: 5, months: 6 },
    offer: { description: '자금 −§1,000 미만 · 적자', fundsBelow: -1_000, deficit: true },
  }),
  // Rush Hour, hard difficulty only; radiation lingers for years (5 used).
  area51: deal('Area 5.1', 20, 9, 380, 45_000, {
    industryRelief: { IM: 100_000 }, jobs: [45, 0, 0], com: [-80, 30], res: [-90, 36], mayor: [-7, 440], crimeEffect: [45, 8],
    ...util(300, 150, 10), pollution: [12, 3, 18, 4], radiation: { radius: 7, months: 60 }, maxFire: 5,
    offer: { description: '어려움 난이도 · 자금 §20,000 미만 · 4개월 새 §3,000 감소 · 총인구 15,500', difficulty: 'hard', fundsBelow: 20_000, drop: { months: 4, amount: 3_000 }, population: 15_500 },
  }),
} as const satisfies Record<string, StructureDef>;

/** Landmark: no unlock, any number, no jobs or relief; works without utilities. */
const landmark = (
  name: string, w: number, h: number, cost: number, upkeep: number, bulldoze: number,
  com: readonly [number, number], mayor: number, u: readonly [number, number, number], pollution: readonly [number, number, number, number] = [0, 0, 0, 0],
  flammability = HIGH_FLAMMABILITY,
) => def(name, 'landmark', w, h, cost, upkeep, {
  bulldoze, com, mayor: [mayor, 256], ...util(...u), pollution, flammability,
});

export const LANDMARKS = {
  alamo: landmark('The Alamo', 2, 3, 65_000, 130, 5_850, [40, 20], 7, [2, 5, 2], [0, 1, 1, 2]),
  alcatraz: landmark('Alcatraz', 10, 5, 50_000, 100, 4_500, [10, 24], -2, [1, 5, 2], [1, 1, 1, 1]),
  amalienborg: landmark('Amalienborg', 12, 12, 70_000, 120, 4_950, [30, 18], 5, [15, 65, 5], [1, 2, 1, 3]),
  bankOfAmerica: landmark('Bank of America', 5, 3, 110_000, 210, 9_900, [80, 28], 6, [600, 1_300, 39], [5, 6, 5, 7]),
  bankOfChinaTower: landmark('Bank of China Tower', 4, 4, 180_000, 300, 4_950, [100, 48], 5, [250, 1_350, 15], [4, 4, 4, 5]),
  bigBen: landmark('Big Ben', 1, 1, 75_000, 150, 6_750, [40, 20], 7, [20, 25, 2], [1, 1, 1, 2]),
  californiaPlaza: landmark('California Plaza', 8, 6, 50_000, 100, 4_500, [30, 18], 0, [125, 350, 10], [2, 2, 2, 3]),
  chryslerBuilding: landmark('Chrysler Building', 4, 4, 170_000, 330, 15_300, [100, 48], 9, [250, 1_300, 12], [3, 4, 4, 5]),
  cnTower: landmark('CN Tower', 6, 7, 225_000, 440, 20_250, [80, 28], 7, [20, 25, 4], [0, 0, 1, 2]),
  coitTower: landmark('Coit Tower', 3, 3, 55_000, 110, 4_950, [30, 18], 5, [1, 7, 3], [0, 0, 1, 2]),
  empireStateBuilding: landmark('Empire State Building', 8, 4, 240_000, 470, 21_600, [100, 48], 9, [375, 1_100, 20], [5, 5, 6, 6]),
  faneuilHall: landmark('Faneuil Hall', 2, 2, 50_000, 100, 4_500, [20, 16], 5, [50, 200, 9], [1, 2, 1, 3]),
  fernsehturm: landmark('Fernsehturm', 3, 3, 85_000, 170, 7_650, [50, 22], 5, [15, 60, 5], [1, 1, 1, 1]),
  gatewayArch: landmark('Gateway Arch', 10, 2, 90_000, 180, 8_100, [50, 22], 8, [1, 0, 2]),
  greatPyramid: landmark('Great Pyramid', 8, 8, 160_000, 310, 14_400, [70, 26], 10, [1, 0, 2]),
  guggenheimMuseum: landmark('Guggenheim Museum', 6, 4, 95_000, 180, 8_550, [70, 26], 8, [90, 450, 9], [1, 1, 1, 2]),
  hagiaSofia: landmark('Hagia Sofia', 6, 6, 80_000, 160, 7_200, [40, 20], 7, [8, 20, 3], [1, 1, 1, 2]),
  hollywoodSign: landmark('Hollywood Sign', 7, 1, 30_000, 60, 2_700, [20, 16], 2, [1, 0, 0]),
  independenceHall: landmark('Independence Hall', 2, 2, 60_000, 120, 5_400, [30, 18], 7, [3, 7, 3], [1, 1, 1, 2]),
  jeffersonMemorial: landmark('Jefferson Memorial', 6, 7, 80_000, 160, 7_200, [50, 22], 8, [1, 0, 3]),
  johnHancockCenter: landmark('John Hancock Center', 6, 4, 165_000, 320, 14_850, [90, 30], 8, [650, 1_500, 43], [6, 6, 5, 7]),
  lincolnMemorial: landmark('Lincoln Memorial', 5, 4, 85_000, 170, 7_650, [50, 22], 8, [1, 0, 3]),
  livingMall: landmark('Living Mall', 6, 6, 55_000, 110, 4_950, [80, 20], 5, [800, 850, 11], [10, 4, 12, 5]),
  palaceOfFineArts: landmark('Palace of Fine Arts', 10, 11, 90_000, 180, 8_100, [30, 18], 6, [20, 150, 4], [1, 1, 1, 2]),
  palacioReal: landmark('Palacio Real', 6, 6, 65_000, 130, 5_850, [30, 18], 6, [25, 60, 4], [1, 2, 1, 3]),
  rotesRathaus: landmark('Rotes Rathaus', 4, 4, 65_000, 130, 5_850, [30, 18], 5, [50, 250, 9], [2, 2, 2, 3]),
  smithTower: landmark('Smith Tower', 3, 3, 55_000, 110, 4_950, [40, 20], 5, [215, 900, 11], [3, 4, 4, 5]),
  sphinx: landmark('The Sphinx', 2, 4, 50_000, 100, 4_500, [20, 16], 7, [0, 0, 2]),
  stBasils: landmark("St. Basil's", 4, 4, 90_000, 180, 8_100, [60, 24], 7, [10, 9, 3], [1, 1, 1, 2]),
  statueOfLiberty: landmark('Statue of Liberty', 4, 4, 85_000, 170, 7_650, [60, 24], 9, [5, 5, 3], [0, 0, 1, 2]),
  tajMahal: landmark('Taj Mahal', 6, 6, 105_000, 200, 9_450, [60, 24], 8, [10, 10, 4], [0, 0, 2, 2]),
  tokyoTower: landmark('Tokyo Tower', 6, 6, 175_000, 340, 15_750, [80, 28], 7, [25, 45, 8], [1, 1, 1, 2]),
  towerOfLondon: landmark('Tower of London', 3, 3, 55_000, 90, 4_950, [30, 18], 6, [15, 65, 5], [1, 2, 2, 3]),
  usCapitolBuilding: landmark('U.S. Capitol Building', 6, 5, 135_000, 260, 12_150, [80, 28], 9, [90, 450, 13], [1, 2, 2, 3]),
  washingtonMonument: landmark('Washington Monument', 3, 3, 70_000, 140, 6_300, [40, 20], 7, [1, 0, 3]),
  whiteHouse: landmark('White House', 6, 6, 70_000, 140, 6_300, [40, 20], 6, [60, 300, 15], [1, 1, 1, 2]),
  // Rush Hour.
  americanMuseumOfNaturalHistory: landmark('American Museum of Natural History', 9, 8, 110_000, 220, 7_900, [40, 20], 6, [60, 300, 15], [1, 1, 1, 2]),
  columbiaSeafirstCenter: landmark('Columbia Seafirst Center', 6, 6, 110_000, 210, 6_300, [40, 20], 6, [60, 300, 15], [1, 1, 1, 2]),
  lincolnCenter: landmark('Lincoln Center', 9, 9, 125_000, 275, 15_750, [80, 28], 8, [45, 45, 8], [1, 1, 1, 2], 25),
  schlossNeuschwanstein: landmark('Schloss Neuschwanstein', 9, 11, 90_000, 180, 6_300, [40, 20], 6, [22, 90, 15], [1, 1, 1, 2]),
} as const satisfies Record<string, StructureDef>;
