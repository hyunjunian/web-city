// Garbage: production, recycling, Waste to Energy plants,
// landfill zones, and garbage that piles up when disposal falls short.

import type { SimConfig } from '../config';
import { interp } from '../data/services';
import type { Rng } from '../rng';
import { buildingAccess, footprint, frontage, type Fields } from './fields';
import { ordinanceEffects } from './mayor';
import { activeDeals } from './region';
import { atGrade, isLocalNet, structureOnline, type CityState, type GarbageStats, type Structure } from './state';
import { drain } from './steps';

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
  if (!inc || !structureOnline(s, st)) return 0;
  return inc.capacity * interp(cfg.services.waterOutputByAge, st.life) * Math.min(1.2, s.departments.sanitation / 100);
}

interface Landfill {
  tiles: number[];
  connected: boolean;
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
export function* landfillRegionsSteps(s: CityState, f: Fields, served: ReadonlySet<number>): Generator<void, Landfill[]> {
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
          if (served.has(f.component[j]!)) connected = true;
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
    out.push({ tiles: roadSide.concat(interior), connected });
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
  const networks = new Set<number>();
  const hasPile = (lot: { x: number; y: number; w: number; h: number }) => footprint(s, lot).some((i) => s.garbage[i]! > 0);
  let piece = 0;
  for (const b of s.buildings.values()) {
    if ((++piece & 0x1ff) === 0) yield;
    if (garbageOf(cfg, b) <= 0 && !hasPile(b)) continue;
    const road = buildingAccess(s, f, b).road;
    if (road >= 0) networks.add(f.component[road]!);
  }
  for (const st of s.structures.values()) {
    if ((++piece & 0x1ff) === 0) yield;
    if (cfg.structures[st.kind].garbage <= 0 && !hasPile(st)) continue;
    for (const road of frontage(s, st)) networks.add(f.component[road]!);
  }
  for (let i = 0; i < s.garbage.length; i++) {
    if ((i & 0x7fff) === 0x7fff) yield;
    if (s.garbage[i]! > 0 && s.occupant[i] === 0 && f.access[i]! >= 0) networks.add(f.component[f.access[i]!]!);
  }
  if (!networks.size) return false;
  const landfills = yield* landfillRegionsSteps(s, f, networks);
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
  type Producer = { tiles: number[]; tons: number };
  const collectable: Producer[] = [];
  const networks = new Set<number>(); // road networks garbage is collected on
  const stranded: Producer[] = [];
  const piledTiles: number[] = [];
  let reachablePiled = 0;
  // The whole lot uses its access road, including deep industrial lots and
  // abandoned buildings. No new garbage is needed to collect an old pile.
  const oldPiles = (tiles: readonly number[], roads: readonly number[]) => {
    let any = false;
    for (const i of tiles) {
      if (s.garbage[i]! <= 0) continue;
      piledTiles.push(i);
      reachablePiled += s.garbage[i]!;
      any = true;
    }
    if (any) for (const road of roads) networks.add(f.component[road]!);
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
    const p = { tiles, tons: tons * keep };
    if (road >= 0) {
      collectable.push(p);
      networks.add(f.component[road]!);
    } else stranded.push(p);
  }
  for (const st of s.structures.values()) {
    if ((++piece & 0x1ff) === 0) yield;
    const tons = cfg.structures[st.kind].garbage;
    const tiles = footprint(s, st);
    const front = frontage(s, st);
    if (front.length) oldPiles(tiles, front);
    if (tons <= 0) continue;
    gross += tons;
    const p = { tiles, tons: tons * keep };
    if (front.length) {
      collectable.push(p);
      for (const t of front) networks.add(f.component[t]!);
    } else stranded.push(p);
  }
  // Piles can remain after demolition. Vacant tiles use the same driveway
  // reach as a new lot; occupied tiles were handled as whole lots above.
  for (let i = 0; i < s.garbage.length; i++) {
    if ((++piece & 0x1ff) === 0) yield;
    if (s.garbage[i]! <= 0 || s.occupant[i] !== 0 || f.access[i]! < 0) continue;
    oldPiles([i], [f.access[i]!]);
  }

  yield;
  // Disposal room: incinerators first (they make power), then landfills.
  const burners = [...s.structures.values()].filter((st) => cfg.structures[st.kind].incinerator);
  let burnRoom = 0;
  for (const st of burners) {
    st.capacity = incineratorCapacity(s, cfg, st);
    st.load = 0;
    burnRoom += st.capacity;
  }
  const regions = yield* landfillRegionsSteps(s, f, networks);
  let landRoom = 0;
  let landSpace = 0;
  for (const r of regions) {
    for (const i of r.tiles) {
      const free = g.landfill.tileCapacity - s.landfill[i]!;
      landSpace += free;
      if (r.connected) landRoom += free;
    }
  }

  yield;
  // Neighbor Deals: garbage we pay to send away is disposed of first; garbage
  // we take in for pay must fit in our own incinerators and landfills.
  let exportRoom = 0;
  let importTons = 0;
  for (const d of activeDeals(s, 'garbage')) {
    if (d.direction === 'buy') exportRoom += d.amount;
    else {
      // A neighbour sends what it makes, up to the contract (paid in full either way).
      const made = s.neighbours[d.edge]?.usage.garbage ?? 0;
      importTons += made > 0 ? Math.min(d.amount, made) : d.amount;
    }
  }
  const local = collectable.reduce((a, p) => a + p.tons, 0);
  const exported = Math.min(local, exportRoom);
  const wanted = local - exported;
  // Sanitation funding: below 100% the trucks carry only that share of what
  // they'd pick up (the month's garbage and the piles' share); above it they
  // clear piles faster.
  const sanitation = s.departments.sanitation / 100;
  const trucks = sanitation >= 1 ? Infinity : (local + reachablePiled * g.backlogPickup) * sanitation;
  let room = burnRoom + landRoom;
  const taken = Math.min(wanted, room, trucks);
  room -= taken;
  const imported = Math.min(importTons, room);
  room -= imported;
  // Piles get picked up with what room is left.
  const backlog = Math.min(room, trucks - taken, reachablePiled * g.backlogPickup * Math.max(1, sanitation));
  if (backlog > 0 && reachablePiled > 0) {
    const k = 1 - backlog / reachablePiled;
    for (const i of piledTiles) s.garbage[i]! *= k;
  }
  let toDispose = taken + backlog + imported;

  yield;
  // Burn, then fill landfill tiles in order.
  let incinerated = 0;
  for (const st of burners) {
    const t = Math.min(st.capacity, toDispose);
    st.load = t;
    st.effectiveness = st.capacity > 0 ? t / st.capacity : 0;
    incinerated += t;
    toDispose -= t;
  }
  let landfilled = 0;
  for (const r of regions) {
    if (!r.connected) continue;
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
  const short = local > 0 ? (wanted - taken) / local : 0;
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
  if (short > 0) for (const p of collectable) pile(p, p.tons * short);

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
    capacity: burnRoom + landRoom,
    // (Space only trucks can reach: a landfill no road joins to the city fills no further.)
    landfillSpace: landRoom - landfilled,
    landfillCutOff: landSpace - landRoom,
    exported,
    imported,
    importShort: importTons - imported,
    stranded: strandedTons,
  };
}
