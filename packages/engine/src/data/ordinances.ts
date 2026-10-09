// Ordinances. Percentage changes to demand are applied to the size of that
// demand.

import type { DevType } from '../types';

export interface OrdinanceDef {
  name: string;
  description: string;
  /** Monthly cost: base + perResident × residents (+ per-unit terms below). */
  base: number;
  perResident: number;
  /** Cost per § of a budget line (Free Clinic: clinics, Pro Reading: libraries, Junior Sports: parks). */
  perBudget?: { line: 'clinics' | 'libraries' | 'parks' | 'landmarks'; rate: number };
  perLandfillTile?: number;
  /** Trash Presort: §26 with one recycling center, plus §1 for each extra one. */
  perRecyclingCenter?: { first: number; more: number };
  /** Monthly income instead of a cost. */
  income?: number;
  mayorRating?: number;
  /** Multipliers on simulation quantities while enacted. */
  air?: number;
  traffic?: number;
  /** Share of commuters moved onto mass transit (Commuter Shuttle: +5 points). */
  transitShare?: number;
  hq?: number;
  eq?: number;
  crime?: number;
  garbage?: number;
  flammability?: number;
  power?: number;
  water?: number;
  gasPlantOutput?: number;
  /** Power plants' aging and the price of power bought from neighbours (Power Conservation Act). */
  plantWear?: number;
  powerDealCost?: number;
  /** Demand change per developer type (−0.05 = −5%). */
  demand?: Partial<Record<DevType, number>>;
  /** Needed before it can be enacted. */
  requires?: 'park' | 'police' | 'clinic' | 'library' | 'recycling' | 'landfillAndGas' | 'transit';
  /** Nuclear Free Zone: no nuclear plants (existing ones are decommissioned). */
  banNuclear?: boolean;
}

const I5 = { IA: -0.05, ID: -0.05, IM: -0.05, IHT: -0.05 } as const;

export const ORDINANCES = {
  legalizeGambling: {
    name: 'Legalize Gambling', description: '월 §100 수입, 범죄 +20%',
    base: 0, perResident: 0, income: 100, crime: 1.2,
  },
  automobileEmission: {
    name: 'Automobile Emission Reduction Act', description: '대기 오염 −10%, 시장 평점 −5',
    base: 20, perResident: 0.05, air: 0.9, mayorRating: -5,
  },
  carpool: {
    name: 'Carpool Incentive Program', description: '교통량 −20%',
    base: 50, perResident: 0.01, traffic: 0.8,
  },
  commuterShuttle: {
    name: 'Commuter Shuttle Service', description: '대중교통 이용 +5%, 대기 오염 −2%',
    base: 20, perResident: 0.005, transitShare: 0.05, air: 0.98,
  },
  cleanAir: {
    name: 'Clean Air Act', description: '대기 오염 −10%, 공해 산업 수요 −5%',
    base: 20, perResident: 0.005, air: 0.9, demand: { ID: -0.05 },
  },
  communityCpr: {
    name: 'Community CPR Training Program', description: '건강 지수 +10%',
    base: 50, perResident: 0.005, hq: 1.1,
  },
  freeClinic: {
    name: 'Free Clinic Program', description: '건강 지수 +10%',
    base: 50, perResident: 0, perBudget: { line: 'clinics', rate: 0.005 }, hq: 1.1,
  },
  juniorSports: {
    name: 'Junior Sports Programs', description: '범죄 −5%',
    base: 100, perResident: 0, perBudget: { line: 'parks', rate: 0.005 }, crime: 0.95, requires: 'park',
  },
  landfillGas: {
    name: 'Landfill Gas Recovery Program', description: '천연가스 발전소 효율 향상',
    base: 20, perResident: 0, perLandfillTile: 50, gasPlantOutput: 1.1, requires: 'landfillAndGas',
  },
  neighborhoodWatch: {
    name: 'Neighborhood Watch', description: '범죄 −5%',
    base: 10, perResident: 0.001, crime: 0.95, requires: 'police',
  },
  nuclearFreeZone: {
    name: 'Nuclear Free Zone', description: '시장 평점 +5, 원자력 발전소 금지(기존 발전소 해체)',
    base: 50, perResident: 0.002, mayorRating: 5, banNuclear: true,
  },
  paperWaste: {
    name: 'Paper Waste Reduction Program', description: '쓰레기 −10%, 상업 수요 −5%',
    base: 20, perResident: 0.005, garbage: 0.9,
    demand: { 'Cs$': -0.05, 'Cs$$': -0.05, 'Cs$$$': -0.05, 'Co$$': -0.05, 'Co$$$': -0.05 },
  },
  powerConservation: {
    name: 'Power Conservation Act', description: '전력 소비·발전소 노후·이웃 전력 구매 비용 −10%, 산업 수요 −5%, 시장 평점 −10',
    base: 0, perResident: 0.005, power: 0.9, plantWear: 0.9, powerDealCost: 0.9, demand: I5, mayorRating: -10,
  },
  proReading: {
    name: 'Pro Reading Campaign', description: '교육 지수 +10%',
    base: 50, perResident: 0, perBudget: { line: 'libraries', rate: 0.005 }, eq: 1.1,
  },
  smokeDetector: {
    name: 'Smoke Detector Program', description: '화재 위험 −5%',
    base: 0, perResident: 0.001, flammability: 0.95,
  },
  tireRecycling: {
    name: 'Tire Recycling Program', description: '쓰레기 −3%',
    base: 20, perResident: 0.001, garbage: 0.97,
  },
  tourismPromotion: {
    name: 'Tourism Promotion Program', description: '상업 서비스 수요 +2% (수요가 있을 때)',
    base: 50, perResident: 0, perBudget: { line: 'landmarks', rate: 0.005 },
    demand: { 'Cs$': 0.02, 'Cs$$': 0.02, 'Cs$$$': 0.02 },
  },
  trashPresort: {
    name: 'Trash Presort Requirement', description: '쓰레기 −3%',
    base: 0, perResident: 0, perRecyclingCenter: { first: 26, more: 1 }, garbage: 0.97, requires: 'recycling',
  },
  waterConservation: {
    name: 'Water Conservation Program', description: '물 소비 −10%, 농업 수요 −10%, 다른 산업 수요 −5%',
    base: 50, perResident: 0.005, water: 0.9, demand: { IA: -0.1, ID: -0.05, IM: -0.05, IHT: -0.05 },
  },
  youthCurfew: {
    name: 'Youth Curfew Act', description: '범죄 −5%, 시장 평점 −10',
    base: 40, perResident: 0.002, crime: 0.95, mayorRating: -10,
  },
} as const satisfies Record<string, OrdinanceDef>;

export type OrdinanceId = keyof typeof ORDINANCES;
