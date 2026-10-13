import type { SimConfig } from '../config';
import type { Fields } from './fields';
import type { PowerReport, WaterReport } from './services';
import { activeDeals, edgeTile } from './region';
import type { CityState } from './state';
import { assetOutlook, networkRepairCost, REPAIR_DEPARTMENTS, type AssetOutlook, type RepairDepartment } from './infrastructure';

export interface UtilitySource {
  kind: 'plant' | 'pump' | 'incinerator' | 'import';
  /** Facility id, or deal id for an import. */
  id: number;
  capacity: number;
  x: number;
  y: number;
  edge?: 0 | 1 | 2 | 3;
}

export interface UtilityNetwork {
  id: number;
  resource: 'power' | 'water';
  supply: number;
  demand: number;
  importCapacity: number;
  sources: UtilitySource[];
  buildings: number;
  residents: number;
  /** A source or consumer that locates this network on the map. */
  x: number;
  y: number;
}

export interface UtilityRisk extends UtilityNetwork {
  reserve: number;
  /** Spare capacity divided by demand; null when no load is connected. */
  reserveRatio: number | null;
  largestSource: UtilitySource | null;
  /** Capacity remaining if the largest single source fails at current consumer assignments; network damage, alternate coverage and shared causes are not modelled. */
  contingencySupply: number;
  contingencyShortfall: number;
  status: 'idle' | 'shortage' | 'fragile' | 'lowReserve' | 'secure';
}

export interface InfrastructureReport {
  assets: AssetOutlook[];
  /** Overhaul quotes for eligible equipment reaching retirement within the planning horizon at current utilisation. */
  capitalNeeded: number;
  dueAssets: number;
  repairs: Record<RepairDepartment, { tiles: number; cost: number }>;
  power: UtilityRisk[];
  water: UtilityRisk[];
}

function assess(network: UtilityNetwork, reserveTarget: number): UtilityRisk {
  const sources = network.sources.map((source) => ({ ...source }));
  let largest: UtilitySource | null = null;
  for (const source of sources) if (!largest || source.capacity > largest.capacity || source.capacity === largest.capacity
    && (source.kind < largest.kind || source.kind === largest.kind && source.id < largest.id)) largest = source;
  const reserve = network.supply - network.demand;
  const reserveRatio = network.demand > 0 ? reserve / network.demand : null;
  const contingencySupply = Math.max(0, network.supply - (largest?.capacity ?? 0));
  const contingencyShortfall = Math.max(0, network.demand - contingencySupply);
  return {
    ...network, sources, reserve, reserveRatio, largestSource: largest ? { ...largest } : null, contingencySupply, contingencyShortfall,
    status: network.demand <= 0 ? 'idle' : reserve < 0 ? 'shortage' : contingencyShortfall > 0 ? 'fragile'
      : reserveRatio! < reserveTarget ? 'lowReserve' : 'secure',
  };
}

/** Capital planning and per-network capacity resilience. Computed only when requested, never during normal stepping. */
export function infrastructureReport(s: CityState, cfg: SimConfig, f: Fields, power: PowerReport, water: WaterReport): InfrastructureReport {
  const assets: AssetOutlook[] = [];
  const networks = new Map<number, UtilityNetwork>();
  power.grids.forEach((grid, id) => {
    if (grid.supply > 0 || grid.demand > 0) networks.set(id, {
      id, resource: 'power', supply: grid.supply, demand: grid.demand, importCapacity: grid.importCapacity,
      sources: [], buildings: 0, residents: 0, x: 0, y: 0,
    });
  });
  for (const st of s.structures.values()) {
    const outlook = assetOutlook(s, cfg, st);
    if (outlook) assets.push(outlook);
    const def = cfg.structures[st.kind];
    const capacity = def.plant ? st.capacity : def.incinerator ? st.load * def.incinerator.powerPerTon : 0;
    const network = networks.get(f.powerGrid[st.y * s.size + st.x]!);
    if (capacity > 0 && network) {
      network.sources.push({ kind: def.plant ? 'plant' : 'incinerator', id: st.id, capacity, x: st.x, y: st.y });
      network.x = st.x;
      network.y = st.y;
    }
  }
  for (const b of s.buildings.values()) {
    if (!b.type) continue;
    const network = networks.get(f.powerGrid[b.y * s.size + b.x]!);
    if (!network) continue;
    network.buildings++;
    if (b.type[0] === 'R') network.residents += b.capacity * b.occupancy;
    if (!network.sources.length) { network.x = b.x; network.y = b.y; }
  }
  for (const deal of activeDeals(s, 'power')) {
    if (deal.direction !== 'buy') continue;
    const tile = edgeTile(s, deal.edge, (i) => s.power[i] === 1 && f.powerGrid[i]! >= 0);
    const network = tile >= 0 ? networks.get(f.powerGrid[tile]!) : undefined;
    if (!network) continue;
    const source: UtilitySource = { kind: 'import', id: deal.id, capacity: deal.amount, x: tile % s.size, y: Math.floor(tile / s.size), edge: deal.edge };
    network.sources.push(source);
    if (network.sources.length === 1) { network.x = source.x; network.y = source.y; }
  }
  assets.sort((a, b) => (a.monthsLeft ?? Infinity) - (b.monthsLeft ?? Infinity) || a.id - b.id);
  const due = assets.filter((asset) => asset.refurbishment.eligible && asset.monthsLeft !== null && asset.monthsLeft <= cfg.infrastructure.planning.lookAheadMonths);
  const repairs = Object.fromEntries(REPAIR_DEPARTMENTS.map((dept) => [dept, { tiles: 0, cost: 0 }])) as InfrastructureReport['repairs'];
  for (let i = 0; i < s.net.length; i++) {
    for (const dept of REPAIR_DEPARTMENTS) {
      const damaged = dept === 'roads' ? s.potholes[i] : dept === 'power' ? s.lineWear[i] : dept === 'water' ? s.pipeWear[i] : s.railDamage[i];
      if (!damaged) continue;
      const cost = networkRepairCost(s, cfg, dept, i);
      if (cost === null) continue;
      repairs[dept].tiles++;
      repairs[dept].cost += cost;
    }
  }
  for (const dept of REPAIR_DEPARTMENTS) repairs[dept].cost = Math.ceil(repairs[dept].cost);
  const target = cfg.infrastructure.planning.reserveRatio;
  return {
    assets, dueAssets: due.length, capitalNeeded: due.reduce((sum, asset) => sum + asset.refurbishment.cost, 0), repairs,
    power: [...networks.values()].map((network) => assess(network, target)),
    water: water.networks.map((network) => assess(network, target)),
  };
}
