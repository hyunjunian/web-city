import type { SimConfig } from '../config';
import type { StructureKind } from '../data/structures';
import { interp } from '../data/services';
import { structureUpkeep } from './budget';
import { utilityLifeYears, utilityWear } from './services';
import { ordinanceEffects } from './mayor';
import { ELEVATED, isAsphalt, isRail, NETWORK_KINDS, overNet, type CityState, type Structure } from './state';

export const REPAIR_DEPARTMENTS = ['roads', 'power', 'water', 'transit'] as const;
export type RepairDepartment = (typeof REPAIR_DEPARTMENTS)[number];

export interface RepairPreview {
  ok: boolean;
  cost: number;
  /** Damaged or worn tiles that will be repaired, counting a tile once. */
  tiles: number;
  message?: string;
}

export interface AssetOutlook {
  id: number;
  kind: StructureKind;
  x: number;
  y: number;
  life: number;
  /** Nominal life percentage at retirement: 100 for power, 110 for other utilities. */
  retirementLife: number;
  wearPerMonth: number;
  /** At constant utilisation and funding; null when ageing is stopped or output is temporarily suspended. */
  monthsLeft: number | null;
  /** Available output as a share of new equipment, before outages and funding reductions. */
  outputShare: number;
  upkeep: number;
  offlineUntilDay: number | null;
  refurbishment: {
    eligible: boolean;
    cost: number;
    lifeAfter: number;
    outputShareAfter: number;
    upkeepAfter: number;
    downtimeDays: number;
  };
}

/** A utility's capital outlook. It never changes loads, loans, random state or the asset. */
export function assetOutlook(s: CityState, cfg: SimConfig, st: Structure): AssetOutlook | null {
  const def = cfg.structures[st.kind];
  if (!utilityLifeYears(def)) return null;
  const retirementLife = def.plant ? 100 : 110;
  const wear = utilityWear(s, cfg, st);
  const curve = def.plant ? cfg.services.plantOutputByAge : cfg.services.waterOutputByAge;
  const refit = cfg.infrastructure.refurbishment;
  const lifeAfter = Math.min(st.life, Math.max(0, refit.targetLife));
  const recovered = st.life - lifeAfter;
  const eligible = st.offlineUntilDay === undefined && recovered > 0 && recovered >= refit.minRecovery;
  const cost = eligible ? Math.ceil(Math.max(0, def.cost) * Math.min(1,
    Math.max(0, refit.fixedCostShare + refit.recoveredLifeCostShare * recovered / retirementLife))) : 0;
  const capacityAfter = def.plant ? def.plant.output * interp(curve, lifeAfter)
    * (st.kind === 'gasPlant' ? ordinanceEffects(s).gasPlantOutput : 1) : st.capacity;
  return {
    id: st.id, kind: st.kind, x: st.x, y: st.y, life: st.life, retirementLife,
    wearPerMonth: wear,
    monthsLeft: st.offlineUntilDay !== undefined ? null : st.life >= retirementLife ? 0 : wear > 0 ? Math.ceil((retirementLife - st.life) / wear) : null,
    outputShare: interp(curve, st.life),
    upkeep: structureUpkeep(s, cfg, st).total,
    offlineUntilDay: st.offlineUntilDay ?? null,
    refurbishment: {
      eligible, cost, lifeAfter, outputShareAfter: interp(curve, lifeAfter),
      upkeepAfter: structureUpkeep(s, cfg, { ...st, life: lifeAfter, capacity: capacityAfter }).total,
      downtimeDays: Math.max(0, Math.min(365, Math.round(refit.downtimeDays))),
    },
  };
}

/** Price of mending an existing tile; null means no repair is needed (a mod may make repairs free). */
export function networkRepairCost(s: CityState, cfg: SimConfig, dept: RepairDepartment, i: number): number | null {
  const prices = cfg.economy.networkCost;
  const repair = cfg.infrastructure.networkRepair;
  if (dept === 'power' || dept === 'water') {
    const has = dept === 'power' ? s.power[i] : s.pipe[i];
    const wear = (dept === 'power' ? s.lineWear[i] : s.pipeWear[i])!;
    if (!has || wear <= 0) return null;
    const replacement = (dept === 'power' ? cfg.services.powerLineCost : cfg.services.pipeCost).build;
    return replacement * Math.max(0, repair.fixedCostShare + repair.wearCostShare * wear / 255);
  }
  if (dept === 'transit') return s.railDamage[i] && isRail(s.net[i]!) ? prices.rail.build * Math.max(0, repair.damageCostShare) : null;
  if (!s.potholes[i]) return null;
  let replacement = 0;
  const code = s.net[i]!;
  if (isAsphalt(code)) replacement += prices[NETWORK_KINDS[code]!].build;
  if (s.elevated[i] === ELEVATED.highway) replacement += prices.elevatedHighway.build;
  const deck = overNet(s, i);
  if (deck) replacement += prices[NETWORK_KINDS[deck]!].build;
  return isAsphalt(code) || s.elevated[i] === ELEVATED.highway || deck
    ? replacement * Math.max(0, repair.damageCostShare) : null;
}
