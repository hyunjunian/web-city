// Monthly budget: taxes, department and building upkeep,
// ordinances, loans, fares, business deals and Neighbor Deals.

import type { SimConfig } from '../config';
import type { OrdinanceId } from '../data/ordinances';
import { interp } from '../data/services';
import { perType } from '../types';
import { capacityOf } from './development';
import { LANDFILL_ZONE } from './garbage';
import { ordinanceCost as ordinanceCostOf } from './mayor';
import { settleDeals } from './region';
import { DAYS_PER_MONTH, ELEVATED, ELEVATED_KINDS, INTERCHANGE, Net, overNet, structureFunding, NETWORK_KINDS, type Building, type BudgetReport, type CityState, type DealResource, type NeighbourDeal, type Structure } from './state';
import { drain } from './steps';

export interface BudgetContext {
  residents: number;
  /** Transit fares and tolls collected this month. */
  fares: number;
  /** Could the city deliver what it sold to neighbours this month? */
  delivered: Record<DealResource, boolean>;
  month: number;
  /** Days each ordinance was in effect this month; without it (a preview) those in effect now count the full month. */
  ordinanceDays?: Partial<Record<OrdinanceId, number>>;
}

/**
 * Taxable value per occupant. A building keeps the value it was built with:
 * taken over by a poorer occupant it loses 25% per wealth level, however
 * many more of them move in.
 */
export function valuePerOccupant(cfg: SimConfig, b: Building): number {
  const w = cfg.demand.wealthOf;
  const stage = 1 + 0.08 * (b.stage - 1);
  const drop = b.type && (b.type[0] === 'R' || b.type[0] === 'C') ? w[b.origType] - w[b.type!] : 0;
  if (drop <= 0) return cfg.economy.valuePerCapacity[w[b.type!]] / stage;
  const built = capacityOf(cfg, b.origType, b.stage, b.origType, b);
  return (built / b.capacity) * cfg.economy.valuePerCapacity[w[b.origType]] * (1 - 0.25 * drop) / stage;
}

/**
 * A facility's monthly cost as the budget charges it: running costs (by its
 * funding, or its department's for parks and stations; old plants and pumps
 * cost more to keep up), its vehicles, and a jail's overcrowding.
 */
export function structureUpkeep(s: CityState, cfg: SimConfig, st: Structure): { running: number; vehicles: number; overcapacity: number; total: number } {
  const def = cfg.structures[st.kind];
  const age = def.plant
    ? interp(cfg.services.plantMaintenanceByAge, st.life)
    : def.pump || def.incinerator || def.recycling || def.treatment ? interp(cfg.services.waterMaintenanceByAge, st.life) : 1;
  const running = def.upkeep * (structureFunding(s, def, st) / 100) * age;
  const v = (def.health ?? def.school)?.vehicles;
  const vehicles = v ? v * ((st.vehicleFunding ?? 100) / 100) : 0;
  const overcapacity = def.police?.overcapacityCost ? Math.max(0, st.load - st.capacity) * def.police.overcapacityCost : 0;
  return { running, vehicles, overcapacity, total: running + vehicles + overcapacity };
}

/** Settles the month and returns the report (funds and loans are updated in place). */
export function collectBudget(s: CityState, cfg: SimConfig, ctx: BudgetContext): { report: BudgetReport; ended: NeighbourDeal[] } {
  return drain(collectBudgetSteps(s, cfg, ctx));
}

/** {@link collectBudget} in steps (see ./steps): it pauses along the map and the facilities. */
export function* collectBudgetSteps(s: CityState, cfg: SimConfig, ctx: BudgetContext): Generator<void, { report: BudgetReport; ended: NeighbourDeal[] }> {
  const ec = cfg.economy;
  const mult = cfg.difficulty[s.difficulty].taxIncomeMult;
  const taxByType = perType(() => 0);
  let piece = 0;
  for (const b of s.buildings.values()) {
    if ((++piece & 0x3ff) === 0) yield;
    if (!b.type) continue;
    const people = b.type[0] === 'R' ? b.capacity * b.occupancy : b.filled;
    taxByType[b.type] += people * valuePerOccupant(cfg, b) * (s.taxRates[b.type] / 100) * ec.taxScale * mult;
  }
  let roadUpkeep = 0;
  let transitUpkeep = 0;
  yield;
  for (let i = 0; i < s.net.length; i++) {
    if ((i & 0x3fff) === 0x3fff) yield;
    const code = s.net[i]!;
    if (code === Net.RailCrossing) {
      roadUpkeep += ec.networkCost.road.upkeep;
      transitUpkeep += ec.networkCost.rail.upkeep;
    } else if (code === Net.Rail) transitUpkeep += ec.networkCost.rail.upkeep;
    else if (code !== Net.None) roadUpkeep += ec.networkCost[NETWORK_KINDS[code]!].upkeep;
    if (s.subway[i]) transitUpkeep += ec.networkCost.subway.upkeep;
    if (s.elevated[i] === ELEVATED.highway) roadUpkeep += ec.networkCost.elevatedHighway.upkeep;
    else if (s.elevated[i]) transitUpkeep += ec.networkCost[ELEVATED_KINDS[s.elevated[i]!]!].upkeep;
    if (s.tolls[i]) roadUpkeep += cfg.transport.toll.upkeep;
    if (s.interchange[i] === INTERCHANGE.cloverleaf) roadUpkeep += cfg.transport.cloverleaf.upkeep;
    const up = overNet(s, i);
    if (up) roadUpkeep += ec.networkCost[NETWORK_KINDS[up]!].upkeep;
  }
  transitUpkeep += s.transitions.length * cfg.transport.subwayTransition.upkeep;
  // Road maintenance and mass transit are funded as departments.
  roadUpkeep *= s.departments.roads / 100;
  transitUpkeep *= s.departments.transit / 100;
  const upkeep = {
    park: 0, power: 0, water: 0, garbage: 0, health: 0, education: 0, safety: 0, transport: 0, reward: 0, deal: 0, landmark: 0,
  };
  let dealIncome = 0;
  yield;
  for (const st of s.structures.values()) {
    if ((++piece & 0x3f) === 0) yield;
    const def = cfg.structures[st.kind];
    const u = structureUpkeep(s, cfg, st);
    upkeep[def.category] += u.running + u.vehicles;
    upkeep.safety += u.overcapacity;
    dealIncome += def.income ?? 0;
  }
  yield;
  for (let i = 0; i < s.power.length; i++) {
    if ((i & 0x3fff) === 0x3fff) yield;
    if (s.power[i]) upkeep.power += cfg.services.powerLineCost.upkeep * (s.departments.power / 100);
    if (s.pipe[i]) upkeep.water += cfg.services.pipeCost.upkeep * (s.departments.water / 100);
    if (s.zone[i] === LANDFILL_ZONE) upkeep.garbage += cfg.garbage.landfill.upkeep * (s.departments.sanitation / 100);
  }
  const gs = s.garbageStats;
  // Pickup and delivery (the Sanitation department's): per ton picked up, and
  // funding already sets how many tons the trucks carry.
  // (What our trucks picked up: sent to a neighbour too, not what a neighbour brought in.)
  upkeep.garbage += Math.max(0, gs.incinerated + gs.landfilled - (gs.imported ?? 0) + (gs.exported ?? 0)) * cfg.garbage.pickupCost;
  const residents = ctx.residents;
  let ordinanceCost = 0;
  let ordinanceIncome = 0;
  // (Billed by the days in effect: one enacted late in the month, or repealed before its end, pays its share.)
  const days = ctx.ordinanceDays;
  const billed = days ? (Object.keys(days) as OrdinanceId[]) : s.ordinances;
  for (const id of billed) {
    const v = ordinanceCostOf(s, cfg, id, residents) * (days ? Math.min(1, days[id]! / DAYS_PER_MONTH) : 1);
    if (v < 0) ordinanceIncome -= v;
    else ordinanceCost += v;
  }
  transitUpkeep += upkeep.transport;
  // Business-deal facilities are reward buildings in the budget (they earn, and any upkeep is charged with rewards).
  upkeep.reward += upkeep.deal;
  const fares = ctx.fares;
  // Neighbor Deals settle on the month's last day.
  const deals = settleDeals(s, cfg, ctx.delivered);
  const income = Object.values(taxByType).reduce((a, b) => a + b, 0) + ordinanceIncome + fares + dealIncome + deals.income;
  let loanPayments = 0;
  for (const loan of s.loans) {
    loanPayments += loan.payment;
    loan.monthsLeft--;
  }
  s.loans = s.loans.filter((l) => l.monthsLeft > 0);
  const expenses = roadUpkeep + upkeep.park + upkeep.power + upkeep.water + upkeep.garbage + upkeep.health
    + upkeep.education + upkeep.safety + transitUpkeep + upkeep.reward + upkeep.landmark + ordinanceCost + loanPayments
    + deals.expense;
  s.funds += income - expenses;
  const report: BudgetReport = {
    month: ctx.month, income, taxByType, expenses, roadUpkeep,
    parkUpkeep: upkeep.park, powerUpkeep: upkeep.power, waterUpkeep: upkeep.water, safetyUpkeep: upkeep.safety, garbageUpkeep: upkeep.garbage,
    ordinanceCost, ordinanceIncome, loanPayments, healthUpkeep: upkeep.health, educationUpkeep: upkeep.education,
    transitUpkeep, fares, rewardUpkeep: upkeep.reward, landmarkUpkeep: upkeep.landmark, dealIncome,
    neighbourIncome: deals.income, neighbourExpense: deals.expense,
  };
  return { report, ended: deals.ended };
}
