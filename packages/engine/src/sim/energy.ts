import type { SimConfig } from '../config';
import { interp } from '../data/services';
import { structureFunding, type CityState, type Structure } from './state';

/** Upkeep at a given load: maintenance follows its budget, generation costs follow output. */
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
  const def = cfg.structures[st.kind];
  return def.plant ? plantEmissionShare(cfg, st)
    : def.incinerator && st.capacity > 0 ? Math.max(0, Math.min(1, st.load / st.capacity)) : 0;
}
