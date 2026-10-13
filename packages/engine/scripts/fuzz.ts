// Fuzz run: random tool use, disasters and deals over many years, checking
// invariants every month. Usage: npx tsx scripts/fuzz.ts [years] [size] [seed]
import { City, DISASTER_KINDS, ORDINANCES, POWER_DISPATCHES, REPAIR_DEPARTMENTS, STRUCTURES, loadCity, saveCity, type StructureKind, type ZoneKind } from '../src';
import { Rng } from '../src/rng';
import { DAYS_PER_MONTH } from '../src/sim/state';

const years = Number(process.argv[2] ?? 20);
const n = Number(process.argv[3] ?? 64);
const seed = Number(process.argv[4] ?? 1);
const rng = new Rng(seed);
/**
 * A working town to start from, so the random edits hit a living city. Some
 * seeds put a lake where the town goes; then the same seed without water.
 */
function startingTown(water: boolean): City | null {
  const city = new City({ size: n, seed, difficulty: 'medium', water });
  city.state.funds = 2_000_000;
  const m = Math.floor(n / 2);
  city.buildNetwork(0, m, n - 1, m, 'road');
  city.buildNetwork(m, 0, m, n - 1, 'road');
  city.zone(1, m - 12, n - 2, m - 1, 'R-medium');
  city.zone(1, m + 1, m - 1, m + 6, 'C-medium');
  city.zone(m + 1, m + 1, n - 2, m + 12, 'I-medium');
  // The plant sits right under the commercial zone so power reaches the town
  // (and through it the water pump); a fire station keeps it from burning down.
  if (!city.placeStructure('coalPlant', 2, m + 7).ok) return null;
  city.placeStructure('smallFireStation', 7, m + 7);
  city.buildPipe(0, m - 6, n - 1, m - 6);
  city.placeStructure('waterPump', 0, m - 5);
  city.zone(m + 2, m + 14, m + 8, m + 20, 'landfill');
  city.buildNetwork(m + 1, m + 13, m + 1, m + 20, 'road');
  city.step(360);
  return city;
}
const city = startingTown(true) ?? startingTown(false) ?? (() => { throw new Error('fuzz setup: plant'); })();
if (city.stats().population === 0) throw new Error('fuzz setup: the starting town did not grow');

const pick = <T>(a: readonly T[]): T => a[rng.int(a.length)]!;
const xy = () => [rng.int(n), rng.int(n)] as const;
const zones: ZoneKind[] = ['R-low', 'R-medium', 'R-high', 'C-low', 'C-medium', 'C-high', 'I-medium', 'I-high', 'A', 'landfill', 'none'];
const nets = ['street', 'road', 'avenue', 'oneway', 'highway', 'onramp', 'rail'] as const;
const kinds = Object.keys(STRUCTURES) as StructureKind[];

function fail(msg: string): never {
  console.error(`FAIL day ${city.state.day}: ${msg}`);
  process.exit(1);
}

/** A preview and the edit that followed it must agree on success and cost. */
function agree(what: string, preview: { ok: boolean; cost: number; message?: string }, done: { ok: boolean; cost: number; message?: string }): void {
  if (preview.ok !== done.ok) fail(`${what}: preview ok=${preview.ok} (${preview.message}) but edit ok=${done.ok} (${done.message})`);
  if (done.ok && Math.abs(done.cost - preview.cost) > 1e-6) fail(`${what}: preview cost ${preview.cost}, edit cost ${done.cost}`);
}

function check(): void {
  const s = city.state;
  if (!Number.isFinite(s.funds)) fail('funds not finite');
  const st = city.stats();
  for (const [k, v] of Object.entries(st)) if (typeof v === 'number' && !Number.isFinite(v)) fail(`stat ${k} = ${v}`);
  for (const t of Object.keys(city.demand.demand) as (keyof typeof city.demand.demand)[]) {
    if (!Number.isFinite(city.demand.demand[t])) fail(`demand ${t} not finite`);
  }
  // Lots, followed Sims, crews, mobs and disasters share one signed-grid id space.
  const ids = new Set<number>();
  let maxId = 0;
  for (const object of [...s.buildings.values(), ...s.structures.values(), ...s.mySims, ...s.units, ...s.mobs, ...s.liveDisasters]) {
    const id = object.id;
    if (!Number.isInteger(id) || id <= 0 || id > 0x7fffffff || ids.has(id)) fail(`invalid or duplicate object id ${id}`);
    ids.add(id);
    maxId = Math.max(maxId, id);
  }
  if (!Number.isInteger(s.nextId) || s.nextId <= maxId || s.nextId > 0x7fffffff) fail(`next id ${s.nextId} does not follow ${maxId}`);
  // Occupancy grid matches buildings and structures.
  const seen = new Int32Array(n * n);
  for (const b of s.buildings.values()) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      if (s.occupant[y * n + x] !== b.id) fail(`building ${b.id} tile ${x},${y} occupant ${s.occupant[y * n + x]}`);
      seen[y * n + x] = 1;
    }
    if (b.type && !(b.occupancy >= 0 && b.occupancy <= 1)) fail(`occupancy ${b.occupancy}`);
  }
  for (const t of s.structures.values()) {
    if (t.offlineUntilDay !== undefined && (!Number.isSafeInteger(t.offlineUntilDay) || t.offlineUntilDay <= s.day)) fail(`invalid or expired overhaul deadline for ${t.id}`);
    for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) {
      if (s.occupant[y * n + x] !== -t.id) fail(`structure ${t.id} tile ${x},${y}`);
      seen[y * n + x] = 1;
    }
  }
  for (let i = 0; i < n * n; i++) if (s.occupant[i] !== 0 && !seen[i]) fail(`stray occupant ${s.occupant[i]} at ${i}`);
  for (const f of s.fires) if (!(f.target > 0 ? s.buildings.has(f.target) : s.structures.has(-f.target))) fail('fire on nothing');
  for (const m of s.mySims) if (!s.buildings.has(m.home)) {
    // A displaced Sim may search for a replacement home for two months.
    const since = m.homelessSince;
    if (since === undefined || !Number.isSafeInteger(since) || since < 0 || since > s.day || s.day - since >= 2 * DAYS_PER_MONTH) {
      fail(`My Sim ${m.id} without a home or a valid search period`);
    }
  }
}

const t0 = Date.now();
let reports = 0;
let actions = 0;
for (let month = 0; month < years * 12; month++) {
  for (let k = 0; k < 3; k++) {
    const [x, y] = xy();
    const [x2, y2] = [Math.min(n - 1, x + rng.int(12)), Math.min(n - 1, y + rng.int(12))];
    const r = rng.next();
    actions++;
    // Each edit is previewed first: the preview must agree with what the edit then does
    // (cost exactly, including ramps automatically added by highways and avenues).
    if (r < 0.3) {
      const z = pick(zones);
      agree('zone', city.previewZone(x, y, x2, y2, z), city.zone(x, y, x2, y2, z));
    } else if (r < 0.5) {
      const [ex, ey, kind] = [rng.next() < 0.5 ? x2 : x, rng.next() < 0.5 ? y : y2, pick(nets)];
      agree(`network ${kind}`, city.previewNetwork(x, y, ex, ey, kind), city.buildNetwork(x, y, ex, ey, kind));
    } else if (r < 0.62) {
      const kind = pick(kinds);
      const can = city.canPlaceStructure(kind, x, y);
      const done = city.placeStructure(kind, x, y);
      if (can.ok !== done.ok) fail(`canPlaceStructure ${kind} said ${can.ok}, placing gave ${done.ok} (${done.message})`);
    } else if (r < 0.68) {
      const [bx, by] = [Math.min(n - 1, x + 2), Math.min(n - 1, y + 2)];
      agree('bulldoze', city.previewBulldoze(x, y, bx, by), city.bulldoze(x, y, bx, by));
    } else if (r < 0.72) agree('pipe', city.previewLine('pipe', x, y, x2, y), city.buildPipe(x, y, x2, y));
    else if (r < 0.76) agree('powerline', city.previewLine('powerline', x, y, x, y2), city.buildPowerLine(x, y, x, y2));
    else if (r < 0.78) agree('subway', city.previewLine('subway', x, y, x2, y), city.buildSubway(x, y, x2, y));
    else if (r < 0.8) {
      const kind = pick(['elrail', 'monorail', 'highway'] as const);
      const preview = city.previewLine(kind, x, y, x2, y);
      const done = city.buildElevated(x, y, x2, y, kind);
      agree(`elevated ${kind}`, preview, done);
      // Give elevated tolls a real straight site, so saves exercise their distinct code too.
      if (done.ok && kind === 'highway' && x2 - x >= 4) city.placeToll(Math.floor((x + x2) / 2), y);
    }
    else if (r < 0.81) {
      // Instant disasters, or a moving one steered somewhere and walked a few steps.
      if (rng.next() < 0.5) city.disaster(pick(DISASTER_KINDS), x, y, rng.next());
      else {
        const live = city.unleash(pick(['tornado', 'robot', 'autosaurus'] as const), x, y, rng.next());
        if ('id' in live) city.steerDisaster(live.id, rng.int(n), rng.int(n));
        city.advanceDisasters(rng.int(30));
      }
    }
    else if (r < 0.83) {
      const [ex, ey] = [Math.min(n - 1, x + 3), Math.min(n - 1, y + 3)];
      const kind = pick(['water', 'land', 'raise', 'lower'] as const);
      agree(`terrain ${kind}`, city.previewTerraform(x, y, ex, ey, kind), city.terraform(x, y, ex, ey, kind));
    }
    else if (r < 0.85) {
      const id = pick(Object.keys(ORDINANCES) as (keyof typeof ORDINANCES)[]);
      if (rng.next() < 0.5) city.enactOrdinance(id);
      else city.repealOrdinance(id);
    } else if (r < 0.87) city.setDepartmentFunding(pick(['roads', 'transit', 'power', 'water', 'parks'] as const), rng.int(121));
    else if (r < 0.88) city.setNeighbour(rng.int(4) as 0 | 1 | 2 | 3, pick(['simnation', 'established', 'developed'] as const), 0.5 + rng.next() * 2);
    else if (r < 0.9) {
      const offers = city.dealOffers().filter((o) => o.ok);
      if (offers.length) {
        const o = pick(offers);
        city.makeDeal(o.edge, o.resource, o.direction);
      }
    } else if (r < 0.91 && city.state.neighbourDeals.length) city.cancelDeal(pick(city.state.neighbourDeals).id);
    else if (r < 0.92) city.placeToll(x, y);
    else if (r < 0.93) {
      // Highways crossing (overpasses), cloverleafs, and per-building vehicle budgets.
      if (rng.next() < 0.5) city.buildNetwork(x, 0, x, n - 1, 'highway');
      else city.placeCloverleaf(x, y);
      const civic = [...city.state.structures.values()];
      if (civic.length) city.setVehicleFunding(pick(civic).id, rng.int(201));
    }
    else if (r < 0.935) {
      // My Sims: move in, change job or home, get their thoughts, send them out.
      const sims = city.state.mySims;
      if (!sims.length || rng.next() < 0.3) city.addMySim('fuzz', x, y);
      else {
        const sim = pick(sims);
        const k = rng.int(4);
        if (k === 0) city.setMySimJob(sim.id, x, y);
        else if (k === 1) city.moveMySim(sim.id, x, y);
        else if (k === 2) city.dispatchMySim(sim.id, x, y);
        else city.mySimThoughts(sim.id);
      }
    }
    else if (r < 0.95) city.setTaxRate(pick(['R$', 'Cs$', 'ID', 'IHT', 'Co$$$'] as const), rng.int(21));
    else if (r < 0.96 && city.state.funds < 100_000) city.takeLoan(100_000);
    else if (r < 0.98) {
      const operation = rng.int(3);
      if (operation === 0) {
        const department = pick(REPAIR_DEPARTMENTS);
        agree(`repair ${department}`, city.previewRepairNetworks(department, x, y, x2, y2), city.repairNetworks(department, x, y, x2, y2));
      } else if (operation === 1) {
        const facilities = [...city.state.structures.values()];
        if (facilities.length) {
          const id = pick(facilities).id;
          agree('overhaul', city.refurbishStructure(id, true), city.refurbishStructure(id));
        }
      } else city.setPowerDispatch(pick(POWER_DISPATCHES));
    }
    else if (r < 0.99) city.query(x, y);
    else agree('trees', city.previewTrees(x, y, x2, y2), city.plantTrees(x, y, x2, y2));
    city.refreshIfDirty();
    reports += city.takeReports().length;
  }
  if (city.state.funds < 50_000) city.state.funds += 500_000; // keep the fuzzer building
  const before = city.state.funds;
  city.step(30);
  const readBefore = JSON.stringify(saveCity(city));
  const energy = city.energyReport()!;
  for (const plant of energy.plants) {
    if (!(plant.generation >= 0 && plant.generation <= plant.capacity + 1e-7) || !Number.isFinite(plant.generationCost)) fail(`bad dispatched load or cost for ${plant.id}`);
    const actual = city.state.structures.get(plant.id)!;
    if (Math.abs(actual.load - plant.generation) > 1e-7 * Math.max(1, plant.generation)) fail(`energy report differs from dispatched load for ${plant.id}`);
  }
  const infrastructure = city.infrastructureReport();
  for (const network of [...infrastructure.power, ...infrastructure.water]) {
    const sources = network.sources.reduce((sum, source) => sum + source.capacity, 0);
    if (Math.abs(sources - network.supply) > 1e-7 * Math.max(1, network.supply)) fail(`sources do not sum to ${network.resource} network ${network.id} supply`);
    if (!(network.contingencySupply >= 0 && network.contingencySupply <= network.supply + 1e-7)) fail('invalid contingency supply');
  }
  const forecast = city.budgetForecast(12, { capitalSpend: 1_000 });
  if (forecast.points.some((point) => !Number.isFinite(point.funds) || !Number.isFinite(point.debt) || point.debt < 0)) fail('invalid financial projection');
  if (month % 6 === 0) {
    const garbage = city.previewGarbage();
    for (const value of Object.values(garbage)) if (typeof value === 'number' && (!Number.isFinite(value) || value < -1e-6)) fail('invalid collection preview');
    const asset = infrastructure.assets[0];
    if (asset) {
      const maintenance = city.maintenanceImpact(asset.id)!;
      if (maintenance.interruptions.some((part) => part.supplyDuring < 0 || part.shortfall < 0 || part.capacityRemoved > part.supplyBefore + 1e-6)) fail('invalid maintenance interruption');
    }
  }
  if (JSON.stringify(saveCity(city)) !== readBefore) fail('operating reports changed the saved city');
  // The month's only money is its budget: funds move by exactly income − expenses.
  const lb = city.state.lastBudget;
  if (lb && !city.state.impeached && Math.abs(city.state.funds - before - (lb.income - lb.expenses)) > 1e-6 * Math.max(1, Math.abs(before))) {
    fail(`funds moved ${city.state.funds - before} but the budget says ${lb.income - lb.expenses}`);
  }
  // The report's lines add up to its totals.
  if (lb) {
    const taxes = Object.values(lb.taxByType).reduce((a, v) => a + v, 0);
    const inc = taxes + lb.ordinanceIncome + lb.fares + lb.dealIncome + lb.neighbourIncome;
    const exp = lb.roadUpkeep + lb.parkUpkeep + lb.powerUpkeep + lb.waterUpkeep + lb.garbageUpkeep + lb.safetyUpkeep + lb.healthUpkeep
      + lb.educationUpkeep + lb.transitUpkeep + lb.rewardUpkeep + lb.landmarkUpkeep + lb.ordinanceCost + lb.loanPayments + lb.neighbourExpense;
    if (Math.abs(inc - lb.income) > 1e-6 * Math.max(1, lb.income)) fail(`budget income ${lb.income} but its lines sum to ${inc}`);
    if (Math.abs(exp - lb.expenses) > 1e-6 * Math.max(1, lb.expenses)) fail(`budget expenses ${lb.expenses} but its lines sum to ${exp}`);
  }
  if (city.state.impeached) city.state.impeached = false;
  check();
  if (month % 24 === 23) {
    const copy = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    const a = city.stats();
    const b = copy.stats();
    if (a.population !== b.population || a.buildings !== b.buildings) fail(`save round trip: ${a.population}/${b.population}`);
    const beforeQuery = JSON.stringify(saveCity(copy));
    copy.routeQuery(Math.floor(n / 2), Math.floor(n / 2));
    if (JSON.stringify(saveCity(copy)) !== beforeQuery) fail('route query changed saved data');
    // A save made at a month's end reloads into a city that carries on exactly like the original.
    city.step(60);
    copy.step(60);
    const p = JSON.stringify(city.stats());
    const q = JSON.stringify(copy.stats());
    if (p !== q) fail(`reload diverges: ${p.slice(0, 200)} vs ${q.slice(0, 200)}`);
  }
}
const st = city.stats();
console.log(`ok: ${years} years, ${actions} actions, pop ${st.population}, buildings ${st.buildings}, power ${Math.round(st.power.supply)}, reports ${reports}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
