// What clients may ask of a city: a fixed list of City methods (tools and
// queries, nothing that reaches outside the city), and a stats summary.

import { DEV_TYPES, type City, type CityOptions } from '@web-city/engine';

export const ACTIONS = [
  'zone', 'buildNetwork', 'buildPowerLine', 'buildPipe', 'buildSubway', 'buildElevated', 'bulldoze', 'bulldozePipes', 'bulldozeSubway',
  'placeStructure', 'placeToll', 'placeCloverleaf', 'plantTrees', 'terraform', 'levelLandform', 'setFunding', 'setVehicleFunding',
  'setDepartmentFunding', 'setTaxRate', 'enactOrdinance', 'repealOrdinance', 'takeLoan', 'dispatch', 'throwMoney', 'makeDeal', 'cancelDeal',
  'setNeighbour', 'addMySim', 'moveMySim', 'setMySimJob', 'removeMySim', 'mySimThoughts', 'dispatchMySim', 'availableMissions',
  'startMission', 'finishMission', 'query', 'mayorAt', 'dealOffers', 'utility', 'advisors', 'opinionPolls', 'routeQuery', 'availableVehicles',
  'unleash', 'steerDisaster', 'releaseDisaster', 'advanceDisasters', 'markHistorical', 'rewardProgress', 'ageProfile', 'placeSubwayTransition', 'vehicleAction', 'interview', 'renameBuilding',
  'rename', 'previewZone', 'previewNetwork', 'previewLine', 'previewBulldoze', 'canPlaceStructure', 'growthBlockers', 'stageOutlook',
  'repayLoan', 'loanPayment', 'loanBalance', 'powerReach', 'ordinanceAvailable', 'ordinanceCost', 'isUnlocked', 'placementsLeft',
  'structureUpkeep', 'understaffed', 'mySimCommute', 'canDrive', 'connectionsPerEdge', 'powerDemand', 'waterDemand',
  'infrastructureReport', 'previewGarbage',
  'budgetForecast',
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * The options a client may found a city with: size (16–256, default 64), seed,
 * difficulty, water and name. Anything else (config overrides, heightmaps) is
 * dropped, and values of the wrong kind fall back to the defaults.
 */
export function cityOptions(o: unknown): CityOptions {
  const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const size = typeof r.size === 'number' && Number.isFinite(r.size) ? Math.round(r.size) : 64;
  return {
    size: Math.min(256, Math.max(16, size)),
    ...(typeof r.seed === 'number' && Number.isFinite(r.seed) ? { seed: r.seed } : {}),
    ...(r.difficulty === 'easy' || r.difficulty === 'medium' || r.difficulty === 'hard' ? { difficulty: r.difficulty } : {}),
    ...(typeof r.water === 'boolean' ? { water: r.water } : {}),
    ...(typeof r.name === 'string' ? { name: r.name.slice(0, 40) } : {}),
  };
}

/** Stats, demand and last month's budget, as routes return them. */
export function summary(city: City) {
  const demand = Object.fromEntries(DEV_TYPES.map((t) => [t, Math.round(city.demand.demand[t])]));
  return { ...city.stats(), demand, budget: city.state.lastBudget };
}
