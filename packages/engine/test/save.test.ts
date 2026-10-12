import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity } from '../src';
import { rleDecode, rleEncode } from '../src/save';

describe('setters', () => {
  it('ignore values that are not numbers (NaN would poison the budget)', () => {
    const city = new City({ size: 32, seed: 1, water: false });
    city.setTaxRate('R$', NaN);
    city.setDepartmentFunding('roads', NaN);
    city.step(60);
    expect(Number.isFinite(city.state.funds)).toBe(true);
    expect(city.state.taxRates['R$']).toBeGreaterThan(0);
    expect(city.state.departments.roads).toBe(100);
  });

  it('bad coordinates and amounts are refused quickly, not run away with', () => {
    const city = new City({ size: 32, seed: 1, water: false });
    const t = Date.now();
    for (const v of [NaN, Infinity, 1e9, 3.5]) {
      city.buildNetwork(0, v, 10, 5, 'road');
      city.buildPipe(0, 5, v, 5);
      city.zone(v, 1, 5, 5, 'R-low');
      city.placeStructure('coalPlant', v, 3);
      city.takeLoan(v);
    }
    city.step(NaN);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(Number.isFinite(city.state.funds)).toBe(true);
    expect(city.state.structures.size).toBe(0);
  });

  it('loans, vehicle funding and networks refuse keys and numbers that are not theirs', () => {
    const city = new City({ size: 32, seed: 1, water: false });
    city.state.funds = 1e6;
    city.buildNetwork(0, 10, 31, 10, 'road');
    expect(city.placeStructure('medicalClinic', 5, 11).ok).toBe(true);
    expect(city.takeLoan(50_000).ok).toBe(true);
    const any = city as unknown as Record<string, (...a: unknown[]) => { ok: boolean } | boolean>;
    for (const k of ['length', 'toString', '__proto__', 1.5, -1]) expect((any.repayLoan!(k) as { ok: boolean }).ok).toBe(false);
    expect(city.state.loans).toHaveLength(1);
    const clinic = [...city.state.structures.keys()][0]!;
    expect(city.setVehicleFunding(clinic, NaN)).toBe(false);
    for (const k of ['toString', 'constructor']) expect((any.buildNetwork!(0, 5, 10, 5, k) as { ok: boolean }).ok).toBe(false);
    city.step(60);
    expect(Number.isFinite(city.state.funds)).toBe(true);
  });

  it('a city of an impossible size or unknown difficulty is refused with a clear error', () => {
    for (const size of [NaN, 1.5, -3, 4, 1e9]) expect(() => new City({ size })).toThrow(RangeError);
    expect(() => new City({ size: 32, difficulty: 'nope' as 'easy' })).toThrow(/difficulty/);
  });

  it('names that are Object.prototype keys are unknown, not placed (a client can send any string)', () => {
    const city = new City({ size: 32, seed: 1, water: false });
    const any = city as unknown as Record<string, (...a: unknown[]) => { ok: boolean }>;
    for (const name of ['toString', 'constructor', '__proto__']) {
      expect(any.placeStructure!(name, 3, 3).ok).toBe(false);
      expect(any.startMission!(name).ok).toBe(false);
      expect(any.vehicleAction!(name, 'shoot', 3, 3).ok).toBe(false);
      expect(any.canDrive!(name, 3, 3)).toBe(false);
    }
    expect(city.state.structures.size).toBe(0);
    city.step(30);
  });
});

describe('save/load', () => {
  it('saved and loaded budget reports are independent of the live city', () => {
    const city = new City({ size: 32, water: false });
    city.step(30);
    const saved = saveCity(city);
    const copy = loadCity(saved);
    const originalTax = city.state.lastBudget!.taxByType['R$'];
    copy.state.lastBudget!.taxByType['R$'] = 1234;
    expect(saved.lastBudget!.taxByType['R$']).toBe(originalTax);
    expect(city.state.lastBudget!.taxByType['R$']).toBe(originalTax);
    saved.lastBudget!.taxByType['R$'] = 5678;
    expect(city.state.lastBudget!.taxByType['R$']).toBe(originalTax);
    expect(copy.state.lastBudget!.taxByType['R$']).toBe(1234);
  });

  it('does not share saved commute jobs, dispatch routes or traffic history', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.zone(1, 5, 15, 9, 'R-low');
    city.placeStructure('gasPlant', 1, 12);
    city.step(60);
    const home = [...city.state.buildings.values()].find((b) => b.type?.startsWith('R'))!;
    expect(home).toBeDefined();
    home.jobs = [77, 88];
    city.state.history[0]!.trips = { car: 12 };
    city.state.safety.byType = { robbery: 1 };
    city.state.safety.spots = [[123, 'robbery']];
    city.state.units.push({ id: 900, kind: 'fire', air: false, station: 1, x: 2, y: 10, travel: 1, onSite: 3, competence: 1, path: [322, 323] });
    const saved = saveCity(city);
    const copy = loadCity(saved);
    copy.state.buildings.get(home.id)!.jobs![0] = 99;
    copy.state.units[0]!.path![0] = 400;
    copy.state.history[0]!.trips!.car = 99;
    copy.state.safety.byType!.robbery = 99;
    copy.state.safety.spots![0]![0] = 400;
    expect(home.jobs).toEqual([77, 88]);
    expect(city.state.units[0]!.path).toEqual([322, 323]);
    expect(saved.units![0]!.path).toEqual([322, 323]);
    expect(city.state.history[0]!.trips).toEqual({ car: 12 });
    expect(saved.history![0]!.trips).toEqual({ car: 12 });
    expect(city.state.safety.byType).toEqual({ robbery: 1 });
    expect(saved.safety!.spots).toEqual([[123, 'robbery']]);
    expect(loadCity(saved).state.buildings.get(home.id)!.jobs).toEqual([77, 88]);
  });

  it('a save with an impossible size or footprint is refused, not run with', () => {
    const save = saveCity(new City({ size: 32, seed: 1, water: false }));
    expect(() => loadCity({ ...save, size: 1e6 })).toThrow(/corrupt/);
    const city = new City({ size: 32, seed: 1, water: false });
    city.state.funds = 1e6;
    city.buildNetwork(0, 10, 31, 10, 'road');
    expect(city.placeStructure('smallPoliceStation', 5, 11).ok).toBe(true);
    const good = saveCity(city);
    const huge = { ...good, structures: good.structures.map((st) => ({ ...st, w: 1e9 })) };
    expect(() => loadCity(huge)).toThrow(/corrupt/);
    expect(loadCity(good).state.structures.size).toBe(1);
    // Fields of the wrong kind (a hand-edited file) are refused, not run with.
    for (const bad of [{ funds: '1000' }, { day: 'x' }, { name: { x: 1 } }, { difficulty: 'nope' }, { seed: -1 }, { funds: NaN }]) {
      expect(() => loadCity({ ...good, ...bad } as unknown as typeof good)).toThrow(/corrupt/);
    }
  });

  it('run-length encoding round-trips', () => {
    const a = new Uint8Array([0, 0, 0, 1, 1, 2, 0, 0]);
    expect([...rleDecode(rleEncode(a), a.length)]).toEqual([...a]);
  });

  it('rejects map values that would wrap, truncate or become non-finite', () => {
    for (const value of [null, undefined, '1', NaN, Infinity, -1, 256, 1.5]) {
      expect(() => rleDecode([value, 4] as number[], 4)).toThrow(/corrupt save/);
    }
    for (const value of [NaN, Infinity, -1, 1e100]) {
      expect(() => rleDecode([value, 4], 4, new Float32Array(4))).toThrow(/corrupt save/);
    }
    expect([...rleDecode([1.25, 2, 0, 2], 4, new Float32Array(4))]).toEqual([1.25, 1.25, 0, 0]);
    expect(() => rleDecode([0, 0, 1, 4], 4)).toThrow(/corrupt save/);
  });

  it('refuses unknown network and zone codes before running a corrupt city', () => {
    const saved = saveCity(new City({ size: 16, water: false }));
    for (const [key, value] of [['terrain', 2], ['net', 9], ['zone', 11], ['elevated', 4], ['oneway', 5], ['pipe', 2]] as const) {
      expect(() => loadCity({ ...saved, [key]: [value, 256] })).toThrow(/corrupt save/);
    }
    for (const key of ['terrain', 'net', 'zone'] as const) {
      expect(() => loadCity({ ...saved, [key]: undefined } as unknown as typeof saved)).toThrow(/corrupt save/);
    }
  });

  it('rejects duplicate, empty and overflowing ids and overlapping lots', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 100_000;
    city.placeStructure('smallPoliceStation', 3, 3);
    const saved = saveCity(city);
    for (const id of [0, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
      const bad = { ...saved, structures: saved.structures.map((st) => ({ ...st, id })) };
      expect(() => loadCity(bad)).toThrow(/corrupt save/);
    }
    const facility = saved.structures[0]!;
    expect(() => loadCity({ ...saved, structures: [facility, { ...facility, x: 15 }] })).toThrow(/corrupt save/);
    expect(() => loadCity({ ...saved, structures: [facility, { ...facility, id: facility.id + 1, x: facility.x + 1 }] })).toThrow(/corrupt save/);
  });

  it.each(['mySims', 'units', 'mobs', 'liveDisasters'] as const)('rejects invalid and duplicate %s ids before they affect the next object', (key) => {
    const city = new City({ size: 32, water: false });
    city.placeStructure('smallPoliceStation', 3, 3);
    const saved = saveCity(city);
    for (const id of [undefined, null, 0, -1, 1.5, '2', NaN, Infinity, 2 ** 31, saved.structures[0]!.id]) {
      expect(() => loadCity({ ...saved, [key]: [{ id }] } as unknown as typeof saved)).toThrow(/corrupt save/);
    }
    expect(() => loadCity({ ...saved, [key]: [{ id: 700 }, { id: 700 }] } as unknown as typeof saved)).toThrow(/corrupt save/);
    expect(() => loadCity({ ...saved, [key]: {} } as unknown as typeof saved)).toThrow(/corrupt save/);
  });

  it('a stale counter also reserves dispatched units and active disasters', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 100_000;
    city.placeStructure('smallPoliceStation', 3, 3);
    const station = [...city.state.structures.values()][0]!;
    city.state.units.push({ id: 700, kind: 'police', air: false, station: station.id, x: 4, y: 4, travel: 1, onSite: 3, competence: 1 });
    city.state.nextId = 800;
    expect('id' in city.unleash('tornado', 24, 24, 0.1)).toBe(true);
    const saved = saveCity(city);
    saved.nextId = 1;
    const copy = loadCity(saved);
    expect(copy.state.nextId).toBe(801);
    expect(copy.placeStructure('smallFireStation', 12, 3).ok).toBe(true);
    const facility = [...copy.state.structures.values()].find(st => st.kind === 'smallFireStation')!;
    expect(facility.id).toBe(801);
    expect(copy.state.occupant[facility.y * copy.size + facility.x]).toBe(-facility.id);
  });

  it('refuses a counter that would overflow the signed occupancy grid', () => {
    const saved = saveCity(new City({ size: 32, water: false }));
    for (const nextId of [2 ** 31, Number.MAX_SAFE_INTEGER]) expect(() => loadCity({ ...saved, nextId })).toThrow(/corrupt save/);
  });

  it('rejects loan records that would corrupt funds or never finish', () => {
    const city = new City({ size: 32, water: false });
    city.takeLoan(50_000);
    const saved = saveCity(city);
    for (const bad of [{ amount: null }, { payment: null }, { payment: '100' }, { payment: Infinity }, { monthsLeft: 1.5 }, { monthsLeft: 1e100 }]) {
      expect(() => loadCity({ ...saved, loans: [{ ...saved.loans![0]!, ...bad }] } as unknown as typeof saved)).toThrow(/corrupt save/);
    }
    expect(() => loadCity({ ...saved, day: 1e100 })).toThrow(/corrupt save/);
    const good = loadCity(saved);
    good.step(30);
    expect(Number.isFinite(good.state.funds)).toBe(true);
    expect(good.state.loans[0]!.monthsLeft).toBe(119);
  });

  it('rejects malformed saves up front, and never reuses an id', () => {
    const city = new City({ size: 32, seed: 5, water: false });
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.placeStructure('coalPlant', 2, 12);
    const good = JSON.parse(JSON.stringify(saveCity(city)));
    const bad = (change: (s: Record<string, any>) => void) => {
      const s = JSON.parse(JSON.stringify(good));
      change(s);
      return () => loadCity(s);
    };
    expect(bad((s) => delete s.taxRates['R$'])).toThrow(/tax rates/);
    expect(bad((s) => { s.structures[0].kind = 'bogus'; })).toThrow(/no known kind/);
    expect(bad((s) => { s.net = [0, -1, 0, 32 * 32 + 1]; })).toThrow(/bad run/);
    expect(bad((s) => delete s.structures)).toThrow(/no structures/);
    // A stale id count: the next facility still gets an id of its own.
    const stale = JSON.parse(JSON.stringify(good));
    stale.nextId = 1;
    const copy = loadCity(stale);
    expect(copy.placeStructure('smallPoliceStation', 20, 12).ok).toBe(true);
    expect([...copy.state.structures.values()].map((st) => st.kind).sort()).toEqual(['coalPlant', 'smallPoliceStation']);
  });

  it('a loaded city keeps its state and keeps growing like the original', () => {
    const city = new City({ size: 48, seed: 5, difficulty: 'medium' });
    city.buildNetwork(0, 20, 47, 20, 'road');
    city.zone(1, 10, 46, 19, 'R-low');
    city.zone(1, 21, 46, 30, 'I-medium');
    city.placeStructure('coalPlant', 1, 31);
    city.buildPowerLine(30, 35, 46, 35);
    city.step(100);
    const json = JSON.parse(JSON.stringify(saveCity(city)));
    const copy = loadCity(json);
    expect(copy.stats()).toEqual(city.stats());
    // Load, capacity and effectiveness are recomputed from the map on load.
    const strip = (save: ReturnType<typeof saveCity>) => ({
      ...save,
      structures: save.structures.map(({ load, capacity, effectiveness, ...rest }) => rest),
    });
    expect(strip(saveCity(copy))).toEqual(strip(json));
    // Spatial fields are rebuilt on load rather than saved, so the futures
    // may drift slightly but must stay close.
    city.step(100);
    copy.step(100);
    const a = city.stats().population;
    const b = copy.stats().population;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(50, a * 0.1));
  });

  it('saves buildings as a compact table, and still reads the old one-object-per-building saves', () => {
    const city = new City({ size: 48, seed: 5, difficulty: 'easy', water: false });
    city.buildNetwork(0, 20, 47, 20, 'road');
    city.zone(1, 10, 46, 19, 'R-low');
    city.placeStructure('coalPlant', 1, 22);
    city.step(120);
    const save = JSON.parse(JSON.stringify(saveCity(city)));
    expect(save.version).toBe(8);
    expect(save.buildings).toBeUndefined();
    expect(save.buildingTable.rows.length).toBe(city.state.buildings.size);
    // Rewritten the old way (version 7), it loads to the same city.
    const { columns, rows } = save.buildingTable as { columns: string[]; rows: unknown[][] };
    const old = { ...save, version: 7, buildingTable: undefined, buildings: rows.map((r) => Object.fromEntries(columns.map((k, j) => [k, r[j]]))) };
    expect(saveCity(loadCity(old))).toEqual(saveCity(loadCity(save)));
  });

  it('keeps ferry congestion', () => {
    const city = new City({ size: 32, seed: 2 });
    city.fields.ferryTraffic[40] = 321;
    const back = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(back.fields.ferryTraffic[40]).toBe(321);
  });
});

describe('building names', () => {
  it('any building can be renamed (saved; an empty name clears it)', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 100_000;
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.placeStructure('smallPoliceStation', 4, 11);
    expect(city.renameBuilding(4, 11, '  고양이 경찰서  ').ok).toBe(true);
    expect(city.query(5, 12)!.name).toBe('고양이 경찰서');
    expect(city.renameBuilding(20, 20, 'x').ok).toBe(false);
    const back = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(back.query(4, 11)!.name).toBe('고양이 경찰서');
    back.renameBuilding(4, 11, '');
    expect(back.query(4, 11)!.name).toBeNull();
  });
});

describe('reloading', () => {
  it('a reloaded city carries on exactly like the original', () => {
    const n = 64;
    const a = new City({ size: n, seed: 7, difficulty: 'easy' });
    a.state.funds = 1_000_000;
    a.buildNetwork(0, 20, n - 1, 20, 'road');
    a.buildNetwork(0, 44, n - 1, 44, 'road');
    a.buildNetwork(32, 0, 32, n - 1, 'road');
    a.zone(1, 8, 62, 19, 'R-low');
    a.zone(1, 21, 62, 26, 'C-low');
    a.zone(1, 27, 62, 43, 'R-medium');
    a.zone(1, 45, 62, 58, 'I-medium');
    a.placeStructure('coalPlant', 0, 59);
    a.buildPowerLine(0, 27, 0, 44);
    a.placeStructure('waterPump', 40, 59);
    a.buildPipe(2, 16, 60, 16);
    a.buildPipe(2, 30, 60, 30);
    a.buildPipe(2, 50, 60, 50);
    a.buildPipe(2, 16, 2, 50);
    a.buildPipe(40, 50, 40, 59);
    a.placeStructure('smallPoliceStation', 20, 21);
    a.placeStructure('smallFireStation', 40, 21);
    // Saved at a month's end: the reloaded city plans its routes from the same
    // workplaces the original planned from on the 1st. (Mid-month, workplaces
    // redeveloped since the 1st are gone from the save, and routes may differ.)
    a.step(390);
    const b = loadCity(JSON.parse(JSON.stringify(saveCity(a))));
    a.step(240);
    b.step(240);
    const sa = a.stats();
    const sb = b.stats();
    expect(sb).toEqual(sa);
    const canon = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x));
    expect(canon(saveCity(b))).toBe(canon(saveCity(a)));
  }, 120_000);

  it('a renamed city keeps its new name through a save', () => {
    const city = new City({ size: 32, water: false, name: 'Old' });
    expect(city.rename('  ').ok).toBe(false);
    expect(city.rename('  새 도시  ').ok).toBe(true);
    expect(loadCity(JSON.parse(JSON.stringify(saveCity(city)))).state.name).toBe('새 도시');
  });

  it('a save right after a God Mode disaster carries on like the original', () => {
    const a = new City({ size: 48, seed: 5, difficulty: 'easy', water: false });
    a.state.funds = 5_000_000;
    a.buildNetwork(0, 20, 47, 20, 'road');
    a.zone(1, 12, 46, 19, 'R-low');
    a.zone(1, 21, 46, 30, 'I-medium');
    a.placeStructure('gasPlant', 1, 33);
    a.step(200);
    a.disaster('earthquake', 20, 25); // draws from the generator between days
    const b = loadCity(JSON.parse(JSON.stringify(saveCity(a))));
    a.step(60);
    b.step(60);
    expect(b.state.rngState).toBe(a.state.rngState);
    expect(b.state.funds).toBe(a.state.funds);
    expect(b.stats().population).toBe(a.stats().population);
  });
});
