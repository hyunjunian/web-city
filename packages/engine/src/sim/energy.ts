import type { SimConfig } from '../config';
import type { StructureKind } from '../data/structures';
import { interp } from '../data/services';
import { structureFunding, type CityState, type Structure } from './state';
import type { Fields } from './fields';
import type { PowerReport } from './services';

export const POWER_DISPATCHES = ['balanced', 'economical', 'clean'] as const;
export type PowerDispatch = (typeof POWER_DISPATCHES)[number];

/** Upkeep at a given dispatched load: maintenance follows its budget, generation costs follow output. */
export function generationCost(s: CityState, cfg: SimConfig, st: Structure, load = st.load): { maintenance: number; generation: number; total: number } {
  const def = cfg.structures[st.kind];
  if (!def.plant) return { maintenance: 0, generation: 0, total: 0 };
  const share = Math.max(0, Math.min(1, cfg.energy.generationCostShare[st.kind] ?? 0.35));
  const ageCost = def.upkeep * interp(cfg.services.plantMaintenanceByAge, st.life);
  const maintenance = ageCost * (1 - share) * structureFunding(s, def, st) / 100;
  const usage = st.capacity > 0 ? Math.max(0, Math.min(1, load / st.capacity)) : 0;
  const generation = ageCost * share * usage;
  return { maintenance, generation, total: maintenance + generation };
}

/** Source emission multiplier at a given load (full load equals the source table). */
export function plantEmissionShare(cfg: SimConfig, st: Structure, load = st.load): number {
  if (st.capacity <= 0) return 0;
  const idle = Math.max(0, Math.min(1, cfg.energy.idleEmissionShare));
  return idle + (1 - idle) * Math.max(0, Math.min(1, load / st.capacity));
}

/** Actual source-strength share of a plant or incinerator, for fields and clients explaining pollution. */
export function utilityEmissionShare(cfg: SimConfig, st: Structure): number {
  // The city's refresh clears expired overhaul markers before computing fields.
  if (st.offlineUntilDay !== undefined) return 0;
  const def = cfg.structures[st.kind];
  return def.plant ? plantEmissionShare(cfg, st)
    : def.incinerator && st.capacity > 0 ? Math.max(0, Math.min(1, st.load / st.capacity)) : 0;
}

/** Pure dispatch of a grid's remaining demand, after imports and waste energy. Returned loads correspond to the input order. */
export function powerDispatchLoads(s: CityState, cfg: SimConfig, plants: readonly Structure[], demand: number, strategy: PowerDispatch): number[] {
  const available = plants.reduce((total, st) => total + Math.max(0, st.capacity), 0);
  const needed = Math.max(0, Math.min(available, demand));
  if (strategy === 'balanced') return plants.map((st) => available > 0 ? needed * Math.max(0, st.capacity) / available : 0);
  const loads = new Array<number>(plants.length).fill(0);
  const ranked = plants.map((st, index) => {
    const p = cfg.structures[st.kind].plant!;
    const cost = st.capacity > 0 ? generationCost(s, cfg, st, st.capacity).generation / st.capacity : Infinity;
    // Cone strength × area is a source burden index, not tonnes of emissions.
    const pollution = st.capacity > 0 ? (Math.max(0, p.air[0]) * p.air[1] ** 2
      + cfg.energy.waterEmissionWeight * Math.max(0, p.water[0]) * p.water[1] ** 2) / st.capacity : Infinity;
    return { st, index, cost, pollution };
  });
  ranked.sort((a, b) => strategy === 'clean'
    ? a.pollution - b.pollution || a.cost - b.cost || a.st.id - b.st.id
    : a.cost - b.cost || a.pollution - b.pollution || a.st.id - b.st.id);
  let remaining = needed;
  for (const { st, index } of ranked) {
    if (remaining <= 0) break;
    const load = Math.min(remaining, Math.max(0, st.capacity));
    loads[index] = load;
    remaining -= load;
  }
  return loads;
}

export interface EnergyPlant {
  id: number;
  kind: StructureKind;
  grid: number;
  capacity: number;
  generation: number;
  utilisation: number;
  maintenanceCost: number;
  generationCost: number;
  /** Emitted source strengths in the map's pollution scale, before ordinances, trees and terrain. */
  air: number;
  water: number;
}

export interface EnergyReport {
  strategy: PowerDispatch;
  supply: number;
  demand: number;
  /** Dispatched local power-plant output (MWh/month), excluding waste energy. */
  generation: number;
  /** Electricity produced while burning waste, including surplus that cannot be used. */
  wasteGeneration: number;
  wasteUsed: number;
  /** Surplus waste-energy generation; unused plant capacity is reserve, not generated energy. */
  curtailed: number;
  /** Imported electricity used against this grid's demand; contract charges still apply to its agreed amount. */
  imported: number;
  maintenanceCost: number;
  generationCost: number;
  plants: EnergyPlant[];
}

/** Current-capacity comparison; building health, growth, future wear and pollution fields are not advanced. */
export function energyReport(s: CityState, cfg: SimConfig, f: Fields, power: PowerReport, strategy: PowerDispatch): EnergyReport {
  const groups: Structure[][] = Array.from({ length: power.grids.length }, () => []);
  for (const st of s.structures.values()) {
    if (!cfg.structures[st.kind].plant) continue;
    const grid = f.powerGrid[st.y * s.size + st.x]!;
    if (grid >= 0) groups[grid]!.push(st);
  }
  const result: EnergyReport = {
    strategy, supply: power.supply, demand: power.demand, generation: 0, wasteGeneration: 0, wasteUsed: 0, curtailed: 0, imported: 0,
    maintenanceCost: 0, generationCost: 0, plants: [],
  };
  for (let grid = 0; grid < groups.length; grid++) {
    const g = power.grids[grid]!;
    const plants = groups[grid]!;
    const imports = Math.min(g.importCapacity, g.demand);
    const waste = Math.min(g.wastePower, Math.max(0, g.demand - imports));
    const loads = powerDispatchLoads(s, cfg, plants, Math.max(0, g.demand - imports - waste), strategy);
    result.imported += imports;
    result.wasteGeneration += g.wastePower;
    result.wasteUsed += waste;
    result.curtailed += g.wastePower - waste;
    plants.forEach((st, index) => {
      const generation = loads[index]!;
      const costs = generationCost(s, cfg, st, generation);
      const emission = plantEmissionShare(cfg, st, generation);
      const p = cfg.structures[st.kind].plant!;
      result.generation += generation;
      result.maintenanceCost += costs.maintenance;
      result.generationCost += costs.generation;
      result.plants.push({
        id: st.id, kind: st.kind, grid, capacity: st.capacity, generation,
        utilisation: st.capacity > 0 ? generation / st.capacity : 0,
        maintenanceCost: costs.maintenance, generationCost: costs.generation,
        air: p.air[0] * emission, water: p.water[0] * emission,
      });
    });
  }
  result.plants.sort((a, b) => a.id - b.id);
  return result;
}
