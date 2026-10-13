import type { SimConfig } from '../config';
import type { Fields } from './fields';
import type { PowerReport, WaterReport } from './services';
import { activeDeals, edgeTile } from './region';
import type { CityState, Structure } from './state';
import { incineratorPower } from './garbage';
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

export interface MaintenanceInterruption {
  resource: 'power' | 'water';
  networkId: number;
  demand: number;
  supplyBefore: number;
  capacityRemoved: number;
  supplyDuring: number;
  shortfall: number;
  /** Consumers assigned to the affected network, not a prediction that every consumer loses service. */
  buildings: number;
  residents: number;
  /** Working pumps on a power network with insufficient remaining supply; their exact blackout order is not predicted. */
  waterPumpsAtRisk: number;
  waterCapacityAtRisk: number;
}

export interface MaintenanceImpact {
  id: number;
  downtimeDays: number;
  interruptions: MaintenanceInterruption[];
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

/** Current power consumers and sources, without scanning map wear or pricing capital work. */
function powerNetworks(s: CityState, cfg: SimConfig, f: Fields, power: PowerReport): UtilityNetwork[] {
  const networks = new Map<number, UtilityNetwork>();
  power.grids.forEach((grid, id) => {
    if (grid.supply > 0 || grid.demand > 0) networks.set(id, {
      id, resource: 'power', supply: grid.supply, demand: grid.demand, importCapacity: grid.importCapacity,
      sources: [], buildings: 0, residents: 0, x: 0, y: 0,
    });
  });
  for (const st of s.structures.values()) {
    const def = cfg.structures[st.kind];
    const capacity = def.plant ? st.capacity : def.incinerator ? incineratorPower(s, cfg, st) : 0;
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
    const tile = edgeTile(s, deal.edge, (i) => s.power[i] === 1 && f.powerGrid[i]! >= 0, 'power');
    const network = tile >= 0 ? networks.get(f.powerGrid[tile]!) : undefined;
    if (!network) continue;
    const source: UtilitySource = { kind: 'import', id: deal.id, capacity: deal.amount, x: tile % s.size, y: Math.floor(tile / s.size), edge: deal.edge };
    network.sources.push(source);
    if (network.sources.length === 1) { network.x = source.x; network.y = source.y; }
  }
  return [...networks.values()];
}

/** A capacity-only preflight for one overhaul at today's consumer assignments and contracts. No simulation or random draws. */
export function maintenanceImpact(s: CityState, cfg: SimConfig, f: Fields, power: PowerReport, water: WaterReport, st: Structure): MaintenanceImpact | null {
  const asset = assetOutlook(s, cfg, st);
  if (!asset) return null;
  const downtimeDays = asset.offlineUntilDay === null ? asset.refurbishment.downtimeDays : Math.max(0, asset.offlineUntilDay - s.day);
  const interruptions: MaintenanceInterruption[] = [];
  if (downtimeDays === 0) return { id: st.id, downtimeDays, interruptions };
  const def = cfg.structures[st.kind];
  const affected = [...(def.plant || def.incinerator ? powerNetworks(s, cfg, f, power) : []), ...(def.pump ? water.networks : [])];
  for (const network of affected) {
    const capacityRemoved = network.sources.reduce((sum, source) => sum + (source.kind !== 'import' && source.id === st.id ? source.capacity : 0), 0);
    if (!(capacityRemoved > 0)) continue;
    const supplyDuring = Math.max(0, network.supply - capacityRemoved);
    const shortfall = Math.max(0, network.demand - supplyDuring);
    let waterPumpsAtRisk = 0, waterCapacityAtRisk = 0;
    if (network.resource === 'power' && shortfall > 0) for (const pump of s.structures.values()) {
      if (cfg.structures[pump.kind].pump && pump.capacity > 0 && f.powerGrid[pump.y * s.size + pump.x] === network.id) {
        waterPumpsAtRisk++;
        waterCapacityAtRisk += pump.capacity;
      }
    }
    interruptions.push({ resource: network.resource, networkId: network.id, demand: network.demand,
      supplyBefore: network.supply, capacityRemoved, supplyDuring, shortfall, buildings: network.buildings,
      residents: network.residents, waterPumpsAtRisk, waterCapacityAtRisk });
  }
  return { id: st.id, downtimeDays, interruptions };
}

/** Capital planning and per-network capacity resilience. Computed only when requested, never during normal stepping. */
export function infrastructureReport(s: CityState, cfg: SimConfig, f: Fields, power: PowerReport, water: WaterReport): InfrastructureReport {
  const assets: AssetOutlook[] = [];
  for (const st of s.structures.values()) {
    const outlook = assetOutlook(s, cfg, st);
    if (outlook) assets.push(outlook);
  }
  assets.sort((a, b) => (a.monthsLeft ?? Infinity) - (b.monthsLeft ?? Infinity) || a.id - b.id);
  const due = assets.filter((asset) => asset.refurbishment.eligible && asset.monthsLeft !== null && asset.monthsLeft <= cfg.infrastructure.planning.lookAheadMonths);
  const repairs = Object.fromEntries(REPAIR_DEPARTMENTS.map((dept) => [dept, { tiles: 0, cost: 0 }])) as InfrastructureReport['repairs'];
  const addRepair = (dept: RepairDepartment, i: number) => {
    const cost = networkRepairCost(s, cfg, dept, i);
    if (cost === null) return;
    repairs[dept].tiles++;
    repairs[dept].cost += cost;
  };
  for (let i = 0; i < s.net.length; i++) {
    // The usual healthy map only reads four byte flags: no per-tile iterator,
    // department dispatch or price calculation until something needs work.
    if (s.potholes[i]) addRepair('roads', i);
    if (s.lineWear[i]) addRepair('power', i);
    if (s.pipeWear[i]) addRepair('water', i);
    if (s.railDamage[i]) addRepair('transit', i);
  }
  for (const dept of REPAIR_DEPARTMENTS) repairs[dept].cost = Math.ceil(repairs[dept].cost);
  const target = cfg.infrastructure.planning.reserveRatio;
  return {
    assets, dueAssets: due.length, capitalNeeded: due.reduce((sum, asset) => sum + asset.refurbishment.cost, 0), repairs,
    power: powerNetworks(s, cfg, f, power).map((network) => assess(network, target)),
    water: water.networks.map((network) => assess(network, target)),
  };
}
