// Garbage: production, recycling, Waste to Energy plants,
// landfill zones, and garbage that piles up when disposal falls short.

import type { SimConfig } from '../config';
import { interp } from '../data/services';
import type { Rng } from '../rng';
import { buildingAccess, footprint, frontage, type Fields } from './fields';
import { ordinanceEffects } from './mayor';
import { edgeReach, edgeTiles } from './region';
import { atGrade, ELEVATED, isLocalNet, Net, structureOnline, type CityState, type GarbageStats, type Structure } from './state';
import { drain } from './steps';
import { allocateDisposalSteps, type DisposalOutlet } from './disposal';
import { truckNetworksSteps } from './transport';

export const LANDFILL_ZONE = 10;

/** Tons a building produces a month (abandoned buildings produce none). */
export function garbageOf(cfg: SimConfig, b: { type: import('../types').DevType | null; capacity: number; occupancy: number }): number {
  if (!b.type) return 0;
  return Math.max(1, b.capacity * b.occupancy) * cfg.garbage.perCapita[b.type];
}

/**
 * Incinerator intake this month: age and the Sanitation department's funding. Like a power plant it needs
 * no outside power: it feeds its own grid, so requiring power would only stop
 * a plant that is its grid's sole supply from ever starting.
 */
export function incineratorCapacity(s: CityState, cfg: SimConfig, st: Structure): number {
  const inc = cfg.structures[st.kind].incinerator;
  if (!inc || !structureOnline(s, st) || !frontage(s, st).length) return 0;
  return inc.capacity * interp(cfg.services.waterOutputByAge, st.life) * Math.min(1.2, s.departments.sanitation / 100);
}

/** Waste energy uses the recent burn rate, bounded by the machinery's current funded intake and availability. */
export function incineratorPower(s: CityState, cfg: SimConfig, st: Structure): number {
  const incinerator = cfg.structures[st.kind].incinerator;
  return incinerator ? Math.max(0, Math.min(st.load, incineratorCapacity(s, cfg, st))) * incinerator.powerPerTon : 0;
}

interface Landfill {
  tiles: number[];
  connected: boolean;
  components: number[];
}

/**
 * Landfill regions: 4-connected landfill tiles; connected when one touches a
 * road of a network the garbage comes from (a landfill must be joined to the
 * city by road; a road stub of its own is not enough).
 */
export function landfillRegions(s: CityState, f: Fields, served: ReadonlySet<number>): Landfill[] {
  return drain(landfillRegionsSteps(s, f, served));
}

/** {@link landfillRegions} in steps: even a single large landfill pauses during its flood fill. */
export function* landfillRegionsSteps(s: CityState, f: Fields, served: ReadonlySet<number>, components = f.component): Generator<void, Landfill[]> {
  const n = s.size;
  const seen = new Uint8Array(n * n);
  const out: Landfill[] = [];
  let piece = 0;
  for (let start = 0; start < n * n; start++) {
    if ((++piece & 0x1ff) === 0) yield;
    if (s.zone[start] !== LANDFILL_ZONE || seen[start]) continue;
    const roadSide: number[] = [];
    const interior: number[] = [];
    const queue = [start];
    const roads = new Set<number>();
    seen[start] = 1;
    let connected = false;
    for (let h = 0; h < queue.length; h++) {
      if ((++piece & 0x1ff) === 0) yield;
      const i = queue[h]!;
      let touchesRoad = false;
      const x = i % n;
      const y = (i - x) / n;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (isLocalNet(s.net[j]!) && atGrade(s, j)) {
          touchesRoad = true;
          if (components[j]! >= 0) roads.add(components[j]!);
          if (served.has(components[j]!)) connected = true;
        }
        if (s.zone[j] === LANDFILL_ZONE && !seen[j]) {
          seen[j] = 1;
          queue.push(j);
        }
      }
      (touchesRoad ? roadSide : interior).push(i);
    }
    // Stable partition: road-side first, BFS order within each group. Reuse
    // the adjacency scan instead of sorting with repeated neighbour searches.
    out.push({ tiles: roadSide.concat(interior), connected, components: [...roads] });
  }
  return out;
}

/** A landfill that garbage trucks can reach from a producing lot or an existing pile. */
export function hasOperatingLandfill(s: CityState, f: Fields, cfg: SimConfig): boolean {
  return drain(hasOperatingLandfillSteps(s, f, cfg));
}

/** The operational check in pieces for monthly simulation work. */
export function* hasOperatingLandfillSteps(s: CityState, f: Fields, cfg: SimConfig): Generator<void, boolean> {
  if (!s.zone.includes(LANDFILL_ZONE)) return false;
  const truck = yield* truckNetworksSteps(s, f);
  const networks = new Set<number>();
  const hasPile = (lot: { x: number; y: number; w: number; h: number }) => footprint(s, lot).some((i) => s.garbage[i]! > 0);
  let piece = 0;
  for (const b of s.buildings.values()) {
    if ((++piece & 0x1ff) === 0) yield;
    if (garbageOf(cfg, b) <= 0 && !hasPile(b)) continue;
    const road = buildingAccess(s, f, b).road;
    if (road >= 0) networks.add(truck.ground[road]!);
  }
  for (const st of s.structures.values()) {
    if ((++piece & 0x1ff) === 0) yield;
    if (cfg.structures[st.kind].garbage <= 0 && !hasPile(st)) continue;
    for (const road of frontage(s, st)) networks.add(truck.ground[road]!);
  }
  for (let i = 0; i < s.garbage.length; i++) {
    if ((i & 0x7fff) === 0x7fff) yield;
    if (s.garbage[i]! > 0 && s.occupant[i] === 0 && f.access[i]! >= 0) networks.add(truck.ground[f.access[i]!]!);
  }
  if (!networks.size) return false;
  const landfills = yield* landfillRegionsSteps(s, f, networks, truck.ground);
  return landfills.some((landfill) => landfill.connected);
}

/**
 * Monthly garbage: producers' garbage (less recycling) goes to Waste to
 * Energy plants, then to road-connected landfill tiles (300 t each). What
 * cannot be taken piles up on the producers' lots, spilling to random lots
 * when full; spare room later collects the piles.
 */
export function runGarbage(s: CityState, f: Fields, cfg: SimConfig, rng: Rng, residents: number): GarbageStats {
  return drain(runGarbageSteps(s, f, cfg, rng, residents));
}

/** {@link runGarbage} in steps (see ./steps). */
export function* runGarbageSteps(s: CityState, f: Fields, cfg: SimConfig, rng: Rng, residents: number): Generator<void, GarbageStats> {
  const g = cfg.garbage;
  const n = s.size;
  const truck = yield* truckNetworksSteps(s, f);

  // Recycling: each powered center covers 25,000 residents (20% cut).
  let served = 0;
  let reduction = 0;
  for (const st of s.structures.values()) {
    const rc = cfg.structures[st.kind].recycling;
    if (!rc || !st.powered || !structureOnline(s, st)) continue;
    served += rc.residents * interp(cfg.services.waterOutputByAge, st.life) * Math.min(1.1, s.departments.sanitation / 100);
    reduction = rc.reduction;
  }
  const recycleShare = reduction * (residents > 0 ? Math.min(1, served / residents) : served > 0 ? 1 : 0);
  const keep = (1 - recycleShare) * ordinanceEffects(s).garbage;

  // Producers. Lots without road access can't be collected.
  type Producer = { tiles: number[]; tons: number; component: number };
  const collectable: Producer[] = [];
  const networks = new Set<number>(); // road networks garbage is collected on
  const stranded: Producer[] = [];
  const pilesByNetwork = new Map<number, { tiles: number[]; tons: number }>();
  const localByNetwork = new Map<number, number>();
  // The whole lot uses its access road, including deep industrial lots and
  // abandoned buildings. No new garbage is needed to collect an old pile.
  const oldPiles = (tiles: readonly number[], roads: readonly number[]) => {
    const component = roads.length ? truck.ground[roads[0]!]! : -1;
    if (component < 0) return;
    let piles = pilesByNetwork.get(component);
    let any = false;
    for (const i of tiles) {
      if (s.garbage[i]! <= 0) continue;
      if (!piles) { piles = { tiles: [], tons: 0 }; pilesByNetwork.set(component, piles); }
      piles.tiles.push(i);
      piles.tons += s.garbage[i]!;
      any = true;
    }
    if (any) networks.add(component);
  };
  const addProducer = (p: Producer) => {
    if (p.component < 0) stranded.push(p);
    else {
      collectable.push(p);
      networks.add(p.component);
      localByNetwork.set(p.component, (localByNetwork.get(p.component) ?? 0) + p.tons);
    }
  };
  let gross = 0;
  let piece = 0;
  yield;
  for (const b of s.buildings.values()) {
    if ((++piece & 0x1ff) === 0) yield;
    const tons = garbageOf(cfg, b);
    const tiles = footprint(s, b);
    const road = buildingAccess(s, f, b).road;
    if (road >= 0) oldPiles(tiles, [road]);
    if (tons <= 0) continue;
    gross += tons;
    addProducer({ tiles, tons: tons * keep, component: road >= 0 ? truck.ground[road]! : -1 });
  }
  for (const st of s.structures.values()) {
    if ((++piece & 0x1ff) === 0) yield;
    const tons = cfg.structures[st.kind].garbage;
    const tiles = footprint(s, st);
    const front = frontage(s, st);
    if (front.length) oldPiles(tiles, front);
    if (tons <= 0) continue;
    gross += tons;
    addProducer({ tiles, tons: tons * keep, component: front.length ? truck.ground[front[0]!]! : -1 });
  }
  // Piles can remain after demolition. Vacant tiles use the same driveway
  // reach as a new lot; occupied tiles were handled as whole lots above.
  for (let i = 0; i < s.garbage.length; i++) {
    if ((++piece & 0x1ff) === 0) yield;
    if (s.garbage[i]! <= 0 || s.occupant[i] !== 0 || f.access[i]! < 0) continue;
    oldPiles([i], [f.access[i]!]);
  }

  yield;
  // Contracts enter or leave through an actual shared-border road, not any road anywhere in the city.
  const exports: DisposalOutlet[] = [];
  const importsByContract = new Map<number, number>();
  const pendingImports = new Map<number, number>();
  const importAccess = new Map<number, number[]>();
  let importTons = 0;
  for (const d of s.neighbourDeals) {
    if (d.resource !== 'garbage' || d.direction === 'buy' && d.status === 'grace') continue;
    const eligible = new Set(edgeReach(s, 'garbage', d.edge));
    const ports = [...edgeTiles(s, d.edge, (i) => eligible.has(d.edge < 2 ? Math.floor(i / n) : i % n), 'garbage')];
    const components = [...new Set(ports.flatMap((i) => {
      const networks: number[] = [];
      const code = s.net[i]!;
      if ((code === Net.Road || code === Net.Avenue || code === Net.Highway || code === Net.RailCrossing) && truck.ground[i]! >= 0) networks.push(truck.ground[i]!);
      if (s.elevated[i] === ELEVATED.highway && truck.high[i] !== undefined && truck.high[i]! >= 0) networks.push(truck.high[i]!);
      return networks;
    }))];
    if (d.direction === 'buy') exports.push({ components, capacity: d.amount });
    else {
      const made = s.neighbours[d.edge]?.usage.garbage ?? 0;
      const tons = made > 0 ? Math.min(d.amount, made) : d.amount;
      if (d.status === 'grace') pendingImports.set(-d.id, tons);
      else { importTons += tons; importsByContract.set(-d.id, tons); }
      importAccess.set(-d.id, components);
      for (const component of components) networks.add(component);
    }
  }
  // Shared machinery and landfill space remain single capacity constraints even when several roads reach them.
  const burners = [...s.structures.values()].filter((st) => cfg.structures[st.kind].incinerator);
  let burnRoom = 0;
  const outlets: DisposalOutlet[] = [...exports];
  for (const st of burners) {
    st.capacity = incineratorCapacity(s, cfg, st);
    st.load = 0;
    const components = [...new Set(frontage(s, st).map((road) => truck.ground[road]!).filter((component) => component >= 0))];
    outlets.push({ components, capacity: st.capacity });
    if (components.some((component) => networks.has(component))) burnRoom += st.capacity;
  }
  const regions = yield* landfillRegionsSteps(s, f, networks, truck.ground);
  let landRoom = 0;
  let landOperatingRoom = 0;
  let landSpace = 0;
  for (const r of regions) {
    let capacity = 0;
    for (const i of r.tiles) {
      const free = g.landfill.tileCapacity - s.landfill[i]!;
      landSpace += free;
      capacity += free;
    }
    const operating = capacity * Math.max(0, Math.min(1, s.departments.sanitation / 100));
    outlets.push({ components: r.components, capacity: operating });
    if (r.connected) { landRoom += capacity; landOperatingRoom += operating; }
  }

  yield;
  const reachable = new Set(outlets.flatMap((outlet) => outlet.components));
  let routeCutOff = 0;
  for (const [component, tons] of localByNetwork) if (!reachable.has(component)) routeCutOff += tons;
  const sanitation = s.departments.sanitation / 100;
  const truckRoom = new Map<number, number>();
  for (const component of networks) truckRoom.set(component, sanitation >= 1 ? Infinity
    : ((localByNetwork.get(component) ?? 0) + (pilesByNetwork.get(component)?.tons ?? 0) * g.backlogPickup) * sanitation);
  const localDemand = new Map([...localByNetwork].map(([component, tons]) => [component, Math.min(tons, truckRoom.get(component) ?? 0)]));
  const local = yield* allocateDisposalSteps(localDemand, outlets);
  const used = [...local.used];
  const exported = used.slice(0, exports.length).reduce((a, b) => a + b, 0);
  // Imported waste has its own delivery trucks; local pickup takes priority over imported waste and old piles.
  const remaining = () => outlets.map((outlet, i) => ({ components: outlet.components,
    capacity: i < exports.length ? 0 : Math.max(0, outlet.capacity - used[i]!) }));
  const importOutlets = () => remaining().map((outlet) => ({ ...outlet, components: [...importAccess]
    .filter(([, ports]) => ports.some((component) => outlet.components.includes(component))).map(([id]) => id) }));
  const imports = yield* allocateDisposalSteps(importsByContract, importOutlets());
  imports.used.forEach((tons, i) => { used[i]! += tons; });
  const imported = [...imports.collected.values()].reduce((a, b) => a + b, 0);
  // A suspended import reserves no room and receives no waste. Test its ability to
  // resume against spare capacity once, before the lower-priority backlog.
  const pending = yield* allocateDisposalSteps(pendingImports, importOutlets());
  const failedImports: number[] = [];
  for (const [id, tons] of importsByContract) if ((imports.collected.get(id) ?? 0) + 1e-6 < tons) failedImports.push(-id);
  for (const [id, tons] of pendingImports) if ((pending.collected.get(id) ?? 0) + 1e-6 < tons) failedImports.push(-id);
  failedImports.sort((a, b) => a - b);
  const backlogDemand = new Map([...pilesByNetwork].map(([component, piles]) => [component,
    Math.max(0, Math.min(piles.tons * g.backlogPickup * Math.max(1, sanitation), (truckRoom.get(component) ?? 0) - (local.collected.get(component) ?? 0)))]));
  const backlog = yield* allocateDisposalSteps(backlogDemand, remaining());
  backlog.used.forEach((tons, i) => { used[i]! += tons; });
  for (const [component, tons] of backlog.collected) {
    const piles = pilesByNetwork.get(component)!;
    if (!(tons > 0) || !(piles.tons > 0)) continue;
    const keepPile = Math.max(0, 1 - tons / piles.tons);
    for (const i of piles.tiles) s.garbage[i]! *= keepPile;
  }

  yield;
  let incinerated = 0;
  for (let k = 0; k < burners.length; k++) {
    const st = burners[k]!;
    const t = used[exports.length + k]!;
    st.load = t;
    st.effectiveness = st.capacity > 0 ? t / st.capacity : 0;
    incinerated += t;
  }
  let landfilled = 0;
  for (let k = 0; k < regions.length; k++) {
    const r = regions[k]!;
    let toDispose = used[exports.length + burners.length + k]!;
    for (const i of r.tiles) {
      if (toDispose <= 0) break;
      const t = Math.min(g.landfill.tileCapacity - s.landfill[i]!, toDispose);
      s.landfill[i]! += t;
      landfilled += t;
      toDispose -= t;
    }
  }
  // Decommissioned landfills (no road) slowly decompose.
  for (const r of regions) {
    if (r.connected) continue;
    for (const i of r.tiles) {
      const v = s.landfill[i]!;
      s.landfill[i] = Math.max(0, v - Math.min(v * g.landfill.decayRate, g.landfill.decayCap));
      if (s.landfill[i]! < 1) s.landfill[i] = 0;
    }
  }

  yield;
  // What was not taken piles up on its lot, then spills to random lots.
  let uncollected = 0;
  const lots = [...s.buildings.values()];
  const pile = (p: Producer, tons: number) => {
    if (!g.piles || tons <= 0) return;
    uncollected += tons;
    let left = tons;
    const per = left / p.tiles.length;
    for (const i of p.tiles) {
      const add = Math.min(per, g.pileCap - s.garbage[i]!);
      if (add > 0) {
        s.garbage[i]! += add;
        left -= add;
      }
    }
    for (let tries = 0; left > 0.01 && lots.length && tries < 8; tries++) {
      const b = lots[rng.int(lots.length)]!;
      const i = (b.y + rng.int(b.h)) * n + b.x + rng.int(b.w);
      const add = Math.min(left, g.pileCap - s.garbage[i]!);
      if (add > 0) {
        s.garbage[i]! += add;
        left -= add;
      }
    }
  };
  for (const p of stranded) pile(p, p.tons);
  const strandedTons = uncollected;
  for (const p of collectable) {
    const total = localByNetwork.get(p.component)!;
    const short = total > 0 ? Math.max(0, 1 - (local.collected.get(p.component) ?? 0) / total) : 0;
    if (short > 0) pile(p, p.tons * short);
  }

  let piled = 0;
  for (let i = 0; i < s.garbage.length; i++) piled += s.garbage[i]!;
  return {
    produced: gross,
    recycled: gross * recycleShare,
    kept: gross * keep,
    incinerated,
    landfilled,
    uncollected,
    piled,
    capacity: burnRoom + landOperatingRoom,
    // (Space only trucks can reach: a landfill no road joins to the city fills no further.)
    landfillSpace: landRoom - landfilled,
    landfillCutOff: landSpace - landRoom,
    exported,
    imported,
    importShort: Math.max(0, importTons - imported),
    stranded: strandedTons,
    routeCutOff,
    failedImports,
  };
}
