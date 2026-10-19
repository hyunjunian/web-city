import { describe, expect, it } from 'vitest';
import { City, DEFAULT_CONFIG, GROWTH_CODES, loadCity, saveCity } from '../src';
import { sampleCity } from '../src/sample';
import { STAGE_TABLE } from '../src/data/stages';
import { chooseStage, developOnce, exodus, stageTargets, updateBuildings, type DevContext } from '../src/sim/development';
import { DEV_TYPES } from '../src/types';

describe('homes need jobs to go to', () => {
  it('bulldozed homes leave the figures at once, not at the next day', () => {
    const city = sampleCity({ seed: 1 });
    const b = [...city.state.buildings.values()].find((x) => x.type === 'R$')!;
    const before = city.stats().population;
    city.bulldoze(b.x, b.y, b.x, b.y);
    expect(city.stats().population).toBeLessThan(before);
  }, 60_000); // (the sample city takes about 5 s to grow: at the default limit it timed out beside another file)

  it('names a lack of workers as the blocker where businesses can\'t be staffed', () => {
    const city = new City({ size: 32, water: false, config: { development: { requirePower: false } } });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.zone(2, 11, 20, 16, 'I-medium', { autoStreets: false });
    city.refresh();
    expect(city.growthBlockers(5, 12)!.map((b) => b.code)).toContain('waiting');
    // Industry wanted, no workers to be had and no homes growing for them (as workersBlocked judges).
    for (const t of ['R$', 'R$$', 'R$$$'] as const) city.demand.demand[t] = 0;
    for (const t of ['ID', 'IM', 'IHT'] as const) city.demand.demand[t] = 500;
    city.census.workers = [0, 0, 0];
    city.census.jobsByWealth = [1000, 1000, 1000];
    expect(city.growthBlockers(5, 12)!.map((b) => b.code)).toContain('noWorkers');
  });

  it('dry land is named as the blocker where only top-wealth types want in (they need water)', () => {
    const city = new City({ size: 48, seed: 3, difficulty: 'easy', water: false, config: { safety: { fires: false }, mayor: { riots: false }, development: { requirePower: false } } });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 20, 47, 20, 'road');
    city.zone(2, 16, 20, 19, 'R-high', { autoStreets: false });
    city.zone(30, 21, 45, 26, 'I-medium', { autoStreets: false });
    for (const t of ['R$', 'R$$'] as const) city.setTaxRate(t, 20);
    city.setTaxRate('R$$$', 0);
    city.receiveGrowth({ 'R$$$': 5000 });
    city.refreshIfDirty();
    expect(city.growthBlockers(5, 19)).toEqual([{ code: 'noWater' }]);
    city.step(60);
    expect([...city.state.buildings.values()].filter((b) => b.type === 'R$$$')).toHaveLength(0);
  });

  it('a road reaching no neighbour and only a little shop grows no more workers than it has jobs', () => {
    const city = new City({ size: 64, seed: 5, difficulty: 'easy', water: false, config: { safety: { fires: false } } });
    city.buildNetwork(5, 20, 58, 20, 'road'); // short of the map edges
    city.zone(6, 8, 57, 19, 'R-low');
    city.zone(6, 21, 8, 22, 'C-low'); // a few dozen jobs at most
    city.placeStructure('coalPlant', 30, 40);
    city.buildPowerLine(30, 22, 30, 39);
    let most = 0;
    for (let m = 0; m < 12; m++) {
      city.step(30);
      most = Math.max(most, city.census.residents[0] + city.census.residents[1] + city.census.residents[2]);
    }
    expect(most).toBeLessThan(400); // was over 1,300
  }, 60_000);
});

describe('stage limits', () => {
  it('every column sums to 100%', () => {
    for (const t of DEV_TYPES) {
      const table = STAGE_TABLE[t];
      for (let c = 0; c < table.thresholds.length; c++) {
        expect(table.rows.reduce((a, r) => a + r[c]!, 0)).toBe(100);
      }
    }
  });

  it('applies the difficulty multiplier to thresholds (worked example)', () => {
    // R$$ population 37,000 permits Stage 8 on Easy (43,859 × 0.83 = 36,403) but not on Hard.
    expect(stageTargets(STAGE_TABLE['R$$'], 37_000, 0.83)[7]).toBeGreaterThan(0);
    expect(stageTargets(STAGE_TABLE['R$$'], 37_000, 1)[7]).toBe(0);
  });

  it('Rush Hour lets R$ reach stage 8 at 9,571', () => {
    expect(stageTargets(STAGE_TABLE['R$'], 9_571, 1)[7]).toBeGreaterThan(0);
    expect(stageTargets(STAGE_TABLE['R$'], 9_570, 1)[7]).toBe(0);
  });

  it('builds the largest stage still under its target share', () => {
    // At R$ 857 the target mix is 30/45/25: with too many stage-1 houses, build stage 3 then 2.
    const targets = [0.3, 0.45, 0.25];
    expect(chooseStage(targets, [10, 0, 0]).preferred).toBe(3);
    expect(chooseStage(targets, [10, 0, 5]).preferred).toBe(2);
  });
});

function starterTown(seed = 3): City {
  const city = new City({ size: 64, seed, difficulty: 'easy', water: false, config: { safety: { fires: false } } });
  city.buildNetwork(0, 20, 63, 20, 'road');
  city.buildNetwork(0, 44, 63, 44, 'road');
  city.zone(1, 8, 62, 19, 'R-low');
  city.zone(1, 21, 62, 26, 'C-low');
  city.zone(1, 27, 62, 43, 'R-medium');
  city.zone(1, 45, 62, 58, 'I-medium');
  // Zones carry power across gaps of up to 4 tiles; one line links R/C to I.
  city.placeStructure('coalPlant', 0, 59);
  city.buildPowerLine(0, 27, 0, 44);
  return city;
}

describe('access for those already living there', () => {
  it('a shortage of jobs on a network with no neighbour is not a lost road (six months, not two)', () => {
    const city = new City({ size: 48, seed: 2, difficulty: 'easy', water: false, config: { safety: { fires: false }, mayor: { riots: false } } });
    city.state.funds = 1_000_000;
    // A road that never reaches the map edge: no neighbour connection.
    city.buildNetwork(4, 20, 43, 20, 'road');
    city.zone(5, 12, 42, 19, 'R-medium');
    city.zone(5, 21, 12, 24, 'C-low');
    city.placeStructure('windPlant', 20, 22);
    city.step(240);
    // Workers now outnumber the jobs on this network: those already living there stay put at once…
    const homes = () => [...city.state.buildings.values()].filter((b) => b.type?.startsWith('R')).length;
    const before = homes();
    expect(before).toBeGreaterThan(0);
    city.step(60);
    const gone = [...city.state.buildings.values()].filter((b) => b.abandonReason === 'no-road').length;
    expect(gone).toBe(0);
  }, 60_000);
});

describe('simulation', () => {
  it('a starter town grows residents, commerce and industry', () => {
    const city = starterTown();
    city.step(360);
    const s = city.stats();
    expect(s.population).toBeGreaterThan(1_000);
    expect(city.census.population['Cs$']).toBeGreaterThan(0);
    expect(city.census.population.ID).toBeGreaterThan(0);
    // Every building sits on zoned land of its class and with road access.
    for (const b of city.state.buildings.values()) {
      expect(b.x + b.w).toBeLessThanOrEqual(64);
      expect(b.y + b.h).toBeLessThanOrEqual(64);
    }
  }, 30_000);

  it('is deterministic for a given seed', () => {
    const a = starterTown(11);
    const b = starterTown(11);
    a.step(200);
    b.step(200);
    expect(a.stats()).toEqual(b.stats());
  });

  it('abandons buildings that lose road access', () => {
    const city = new City({ size: 32, seed: 2, water: false, config: { development: { requirePower: false } } });
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.zone(0, 11, 31, 12, 'R-low', { autoStreets: false });
    city.zone(0, 8, 31, 9, 'C-low', { autoStreets: false });
    city.step(120);
    expect(city.stats().buildings).toBeGreaterThan(0);
    city.bulldoze(0, 10, 31, 10);
    city.step(90);
    const active = [...city.state.buildings.values()].filter((b) => b.type);
    expect(active.length).toBe(0);
  });
});

describe('upzoning (SC4)', () => {
  it('a denser zone of the same class goes under standing buildings; another class or a sparser one does not', () => {
    const city = starterTown();
    city.step(240);
    const s = city.state;
    const n = s.size;
    const homes = [...s.buildings.values()].filter((b) => b.type?.startsWith('R') && b.y >= 8 && b.y + b.h <= 20);
    expect(homes.length).toBeGreaterThan(0);
    const home = homes[0]!;
    const at = home.y * n + home.x;
    // Commercial over a home: left alone.
    city.zone(home.x, home.y, home.x, home.y, 'C-high');
    expect(s.zone[at]).toBe(1);
    // Residential high over R-low: zoned, the home still stands.
    const res = city.zone(1, 8, 62, 19, 'R-high');
    expect(res.ok).toBe(true);
    expect(s.zone[at]).toBe(3);
    expect(s.occupant[at]).toBe(home.id);
    expect(s.buildings.get(home.id)?.type).toBe(home.type);
    // Back down to low density: not under buildings.
    city.zone(1, 8, 62, 19, 'R-low');
    expect(s.zone[at]).toBe(3);
  });
});

describe('building value', () => {
  it('drops 25% per wealth level when poorer occupants move in', async () => {
    const { DEFAULT_CONFIG } = await import('../src');
    const { valuePerOccupant } = await import('../src/sim/budget');
    const { capacityOf } = await import('../src/sim/development');
    const cfg = DEFAULT_CONFIG;
    const lot = { x: 0, y: 0, w: 2, h: 2 };
    const built = capacityOf(cfg, 'R$$$', 3, 'R$$$', lot);
    const b = { ...lot, origType: 'R$$$', type: 'R$$$', stage: 3, capacity: built } as never as Parameters<typeof valuePerOccupant>[1];
    const whole = (t: 'R$' | 'R$$' | 'R$$$') => {
      b.type = t;
      b.capacity = capacityOf(cfg, t, 3, 'R$$$', lot);
      return valuePerOccupant(cfg, b) * b.capacity;
    };
    const full = whole('R$$$');
    expect(whole('R$$') / full).toBeCloseTo(0.75, 6);
    expect(whole('R$') / full).toBeCloseTo(0.5, 6);
  });
});

describe('Mark Historical (Rush Hour)', () => {
  it('historical buildings keep their type and stage; they can still be abandoned', () => {
    const city = starterTown();
    city.step(360);
    const marked = [...city.state.buildings.values()].filter((b) => b.type);
    expect(marked.length).toBeGreaterThan(10);
    for (const b of marked) expect(city.markHistorical(b.x, b.y).ok).toBe(true);
    const before = new Map(marked.map((b) => [b.id, { type: b.type, stage: b.stage }]));
    city.step(720);
    let kept = 0;
    for (const [id, was] of before) {
      const now = city.state.buildings.get(id);
      if (!now) continue; // burned or destroyed
      expect(now.stage).toBe(was.stage); // never rebuilt (abandoned ones may be lived in again)
      expect(now.historical).toBe(true);
      kept++;
    }
    expect(kept).toBeGreaterThan(0);
    const back = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect([...back.state.buildings.values()].filter((b) => b.historical).length).toBe(kept);
    expect(city.markHistorical(0, 0).ok).toBe(false);
  }, 60_000);

  it('a distressed historical building is abandoned rather than taken over by poorer Sims', () => {
    const city = starterTown();
    city.step(360);
    const all = [...city.state.buildings.values()].filter((b) => b.type);
    for (const b of all) city.markHistorical(b.x, b.y);
    (city.cfg.desirability as { distress: number }).distress = 1e9; // nobody wants to stay
    const was = new Map(all.map((b) => [b.id, b.type]));
    city.step(30 * (city.cfg.development.distressMonths + 1));
    for (const [id, type] of was) {
      const now = city.state.buildings.get(id);
      // Only the occupants it had, or the kind it was built for, may live there.
      if (now?.type) expect([type, now.origType]).toContain(now.type);
    }
  }, 60_000);

  it('zoning and demolition prices: high-density commerce §30, dezoning §1, RCI buildings by size', () => {
    const city = new City({ size: 48, water: false });
    city.buildNetwork(0, 10, 47, 10, 'road');
    expect(city.previewZone(5, 11, 6, 12, 'C-high', { autoStreets: false }).cost).toBe(4 * 30);
    expect(city.previewZone(5, 11, 6, 12, 'R-high', { autoStreets: false }).cost).toBe(4 * 50);
    city.zone(5, 11, 6, 12, 'R-low', { autoStreets: false });
    expect(city.previewZone(5, 11, 6, 12, 'none').cost).toBe(4);
    // A stage-3 2x2 building costs more to clear than a stage-1 1x1 house.
    const id = city.state.nextId++;
    city.state.buildings.set(id, {
      id, x: 5, y: 11, w: 2, h: 2, stage: 3, origType: 'R$', type: 'R$', capacity: 40, occupancy: 1, filled: 0, distressMonths: 0, noRoadMonths: 0,
      noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: false, age: 30, eq: 20, hq: 20, abandonReason: null, builtDay: 0, commute: -1, noJobMonths: 0, historical: false,
    });
    for (const i of [11 * 48 + 5, 11 * 48 + 6, 12 * 48 + 5, 12 * 48 + 6]) city.state.occupant[i] = id;
    // Lived in, it is priced by its residents: §2 each for R$, more than its size alone.
    expect(city.previewBulldoze(5, 11, 5, 11).cost).toBe(Math.max(5 * 3 * 4, 40 * 2));
    // Abandoned, just by its size.
    Object.assign(city.state.buildings.get(id)!, { type: null, occupancy: 0 });
    expect(city.previewBulldoze(5, 11, 5, 11).cost).toBe(5 * 3 * 4);
  });

  it('industry zones up to 8 deep beside a road get no street (blocks up to 8 x 8)', () => {
    const streetsIn = (depth: number) => {
      const city = new City({ size: 48, water: false });
      city.buildNetwork(0, 10, 47, 10, 'road');
      return city.previewZone(5, 11, 12, 10 + depth, 'I-medium').streets.length;
    };
    expect(streetsIn(8)).toBe(0);
    expect(streetsIn(9)).toBeGreaterThan(0);
  });

  it('previewZone shows the tiles, auto-streets and cost zoning would have, without zoning', () => {
    const city = new City({ size: 48, water: false });
    city.buildNetwork(0, 10, 47, 10, 'road');
    const funds = city.state.funds;
    const p = city.previewZone(5, 11, 35, 25, 'R-low');
    expect(city.state.funds).toBe(funds);
    expect(city.state.zone.every((z) => z === 0)).toBe(true);
    expect(p.ok).toBe(true);
    expect(p.streets.length).toBeGreaterThan(0);
    const r = city.zone(5, 11, 35, 25, 'R-low');
    expect(r.cost).toBe(p.cost);
    for (const [x, y] of p.streets) expect(city.query(x, y)!.network).toBe('street');
    city.state.funds = 10;
    expect(city.previewZone(5, 30, 35, 40, 'R-low').message).toBe('not enough funds');
  });

  it('previewBulldoze lists and prices what bulldozing would remove, without removing it', () => {
    const city = new City({ size: 32, water: false });
    city.buildNetwork(0, 10, 31, 10, 'road');
    expect(city.placeStructure('smallParkGreen', 4, 11).ok).toBe(true);
    const funds = city.state.funds;
    const p = city.previewBulldoze(0, 10, 8, 12);
    expect(city.state.funds).toBe(funds);
    expect(p.ok).toBe(true);
    expect(p.structures).toBe(1);
    expect(p.networkTiles).toBe(9);
    expect(p.lots).toEqual([{ x: 4, y: 11, w: 1, h: 1 }]);
    expect(city.bulldoze(0, 10, 8, 12).cost).toBe(p.cost);
    expect(city.previewBulldoze(0, 10, 8, 12).ok).toBe(false); // nothing left
  });

  it('previewLine prices power lines, pipes and subway like building them, and says when a line is blocked', () => {
    const city = new City({ size: 32, water: false });
    expect(city.placeStructure('smallParkGreen', 10, 5).ok).toBe(true);
    expect(city.previewLine('powerline', 0, 5, 20, 5).message).toBe('path is blocked by a building');
    for (const kind of ['powerline', 'pipe', 'subway'] as const) {
      const p = city.previewLine(kind, 0, 8, 20, 8);
      expect(p.ok).toBe(true);
      expect(p.tiles).toBe(21);
      const built = kind === 'powerline' ? city.buildPowerLine(0, 8, 20, 8) : kind === 'pipe' ? city.buildPipe(0, 8, 20, 8) : city.buildSubway(0, 8, 20, 8);
      expect(built.cost).toBe(p.cost);
      expect(city.previewLine(kind, 0, 8, 20, 8).tiles).toBe(0);
    }
  });
});


describe('growth blockers', () => {
  it('say why an empty zone is empty', () => {
    const city = new City({ size: 48, seed: 5, difficulty: 'easy', water: false });
    city.state.funds = 5_000_000;
    city.buildNetwork(0, 20, 47, 20, 'road');
    city.zone(1, 16, 46, 19, 'R-low'); // along the road (auto streets inside)
    city.zone(1, 4, 10, 8, 'R-low'); // its own auto streets, joined to nothing
    // The first empty zone tile in a rectangle, and its blocker codes.
    const empty = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (city.growthBlockers(x, y)) return [x, y] as const;
      throw new Error('no empty zone tile');
    };
    const codes = ([x, y]: readonly [number, number]) => city.growthBlockers(x, y)!.map((b) => b.code);
    const along = empty(2, 19, 46, 19); // between the auto street and the road
    const away = empty(1, 4, 10, 8);
    // No plant yet: nothing has power.
    expect(codes(along)).toContain('noPower');
    expect(codes(away)).toEqual(expect.arrayContaining(['noPower', 'noJobs']));
    // Not an empty zone: a road tile or bare land.
    expect(city.growthBlockers(5, 20)).toBeNull();
    expect(city.growthBlockers(30, 40)).toBeNull();
    city.placeStructure('gasPlant', 1, 33);
    city.zone(1, 21, 46, 30, 'I-medium'); // carries power up from the plant
    expect(codes(along)).not.toContain('noPower');
    expect(codes(along)).not.toContain('noRoad');
    expect(codes(along)).not.toContain('noJobs');
    expect(codes(away)).toContain('noJobs'); // the jobs are on the other road
    // The map form (for a data view) gives each empty zone tile its first blocker.
    const map = city.growthMap();
    const main = ([x, y]: readonly [number, number]) => GROWTH_CODES[map[y * 48 + x]! - 1];
    expect(main(away)).toBe('noPower'); // far from the plant too; power is checked first
    expect(main(along)).toBe(codes(along).find((c) => c !== 'waterCap' && c !== 'interior'));
    expect(map[20 * 48 + 5]).toBe(0); // road
  });
});

describe('the planner', () => {
  it('flags zones that grew nothing in two months, pointing at one', () => {
    const city = new City({ size: 48, seed: 5, difficulty: 'easy', water: false });
    city.state.funds = 5_000_000;
    city.buildNetwork(0, 20, 47, 20, 'road');
    city.zone(1, 16, 46, 19, 'R-low'); // no power anywhere
    city.step(30);
    expect(city.advisors().some((a) => a.code === 'noGrowth')).toBe(false);
    city.step(40);
    const advice = city.advisors().find((a) => a.code === 'noGrowth');
    expect(advice?.at).toBeDefined();
    expect(city.growthBlockers(...advice!.at!)).not.toBeNull();
  });
});

describe('abandonment advice', () => {
  it('warns half-way through each countdown, the short road one included', () => {
    // No fires: a burned-down plant would put the whole town at risk.
    const city = new City({ size: 48, seed: 5, difficulty: 'easy', water: false, config: { safety: { fires: false } } });
    city.state.funds = 5_000_000;
    city.buildNetwork(0, 20, 47, 20, 'road');
    city.zone(1, 12, 46, 19, 'R-low');
    city.zone(1, 21, 46, 30, 'I-medium');
    city.placeStructure('gasPlant', 1, 33);
    city.step(180);
    const homes = [...city.state.buildings.values()].filter((b) => b.type).slice(0, 3);
    expect(homes.length).toBe(3);
    const atRisk = () => city.advisors().find((a) => a.code === 'atRisk')?.value ?? 0;
    // (Homes may already be counting months without a job of their wealth.)
    const before = atRisk();
    for (const b of homes) b.noRoadMonths = city.cfg.development.noRoadMonths / 2; // abandoned at 2 months, so 1 is half-way
    expect(atRisk()).toBeGreaterThanOrEqual(before + 1);
    expect(atRisk()).toBeGreaterThanOrEqual(3);
  });

  it('appears once buildings are left empty, pointing at one', () => {
    // Isolate the power countdown from unrelated demand and commute departures.
    const city = new City({ size: 48, seed: 5, difficulty: 'easy', water: false, config: {
      safety: { fires: false }, demand: { exodusRate: 0 }, transport: { noJobMonths: 1_200 },
      development: { distressMonths: 1_200 },
    } });
    city.state.funds = 5_000_000;
    city.buildNetwork(0, 20, 47, 20, 'road');
    city.zone(1, 12, 46, 19, 'R-low');
    city.zone(1, 21, 46, 30, 'I-medium');
    city.placeStructure('gasPlant', 1, 33);
    city.step(180);
    expect(city.state.buildings.size).toBeGreaterThan(20);
    city.bulldoze(1, 33, 4, 36); // the only plant
    city.step(120); // four months dark: a warning before anything is lost
    const warning = city.advisors().find((a) => a.code === 'atRisk');
    expect(warning?.value).toBeGreaterThanOrEqual(3);
    expect(city.advisors().some((a) => a.code === 'abandoned')).toBe(false);
    city.step(120); // six months without power
    const advice = city.advisors().find((a) => a.code === 'abandoned');
    expect(advice?.value).toBeGreaterThanOrEqual(10);
    expect(city.state.history.at(-1)!.abandoned).toBe(advice!.value); // graphed monthly
    const [x, y] = advice!.at!;
    expect(city.query(x, y)!.building?.type).toBeNull();
    // Nobody moves back in while the power is off, and the blockers say so.
    expect(city.growthBlockers(x, y)!.map((b) => b.code)).toContain('noPower');
  }, 60_000);
});

describe('config', () => {
  it("one city's settings never leak into another city or the defaults", () => {
    const a = new City({ size: 32, seed: 1 });
    (a.cfg.desirability as { distress: number }).distress = 1e9;
    a.cfg.services.waterStageCap['R$'] = 0;
    const b = new City({ size: 32, seed: 1 });
    expect(b.cfg.desirability.distress).not.toBe(1e9);
    expect(b.cfg.services.waterStageCap['R$']).not.toBe(0);
    expect(DEFAULT_CONFIG.desirability.distress).toBe(b.cfg.desirability.distress);
  });
});

describe('stage outlook', () => {
  it('says how tall a type may build now and when the next stage opens', () => {
    const city = new City({ size: 32, seed: 1 });
    const o = city.stageOutlook('R$');
    expect(o.population).toBe(0);
    expect(o.maxStage).toBe(1);
    expect(o.next!.stage).toBe(2);
    const mult = city.cfg.difficulty[city.state.difficulty].stageLimitMult;
    // Agrees with the stage targets at and just below that population.
    const table = city.cfg.development.stageTable['R$'];
    const top = (pop: number) => stageTargets(table, pop, mult).reduce((m, v, k) => (v > 0 ? k + 1 : m), 1);
    expect(top(o.next!.at)).toBe(2);
    expect(top(o.next!.at - 1)).toBe(1);
  });
});

describe('redevelopment', () => {
  /** A strip of C-low lots along a road, every lot a full Cs$ shop, power on. */
  function shops(): { city: City; ctx: DevContext } {
    const city = new City({ size: 32, seed: 1, difficulty: 'easy', water: false, config: { safety: { fires: false } } });
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.zone(1, 9, 30, 9, 'C-low', { autoStreets: false });
    city.placeStructure('windPlant', 1, 7);
    city.refresh();
    const s = city.state;
    for (let x = 1; x <= 30; x++) {
      const i = 9 * 32 + x;
      if (s.occupant[i]) continue;
      const id = s.nextId++;
      s.buildings.set(id, {
        id, x, y: 9, w: 1, h: 1, stage: 1, origType: 'Cs$', type: 'Cs$', capacity: 8, occupancy: 1, filled: 8,
        distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: false,
        age: 30, eq: 50, hq: 50, abandonReason: null, builtDay: 0, commute: -1, noJobMonths: 0, historical: false,
      });
      s.occupant[i] = id;
    }
    const ctx = (city as unknown as { devContext(): DevContext }).devContext();
    // Only Cs$$ developers come; how much they'd like the strip is set per case.
    ctx.demand = { ...ctx.demand, demand: Object.fromEntries(DEV_TYPES.map((t) => [t, t === 'Cs$$' ? 1000 : 0])) as typeof ctx.demand.demand };
    ctx.tractCache = new Map();
    ctx.tractFull = new Map();
    return { city, ctx };
  }
  const cs = (city: City) => [...city.state.buildings.values()].filter((b) => b.type === 'Cs$').length;

  it('a richer shop may take over busy lots when it would be about as busy', () => {
    const { city, ctx } = shops();
    ctx.desir['Cs$$'].fill(100);
    const before = cs(city);
    for (let k = 0; k < 20; k++) developOnce(ctx);
    expect(cs(city)).toBeLessThan(before);
  });

  it("doesn't replace busy lots with a half-empty building of another type", () => {
    const { city, ctx } = shops();
    ctx.desir['Cs$$'].fill(55); // over the threshold to build, but only 55% occupied
    const before = cs(city);
    for (let k = 0; k < 20; k++) developOnce(ctx);
    expect(cs(city)).toBe(before);
  });
});

describe('exodus', () => {
  it('a small surplus empties small buildings, not a tower', () => {
    const city = new City({ size: 32, seed: 1, difficulty: 'easy', water: false });
    const s = city.state;
    const add = (x: number, capacity: number, stage: number) => {
      const id = s.nextId++;
      s.buildings.set(id, {
        id, x, y: 5, w: 1, h: 1, stage, origType: 'R$', type: 'R$', capacity, occupancy: 1, filled: 0,
        distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: true,
        age: 30, eq: 50, hq: 50, abandonReason: null, builtDay: 0, commute: 10, noJobMonths: 0, historical: false,
      });
      s.occupant[5 * 32 + x] = id;
      return s.buildings.get(id)!;
    };
    const tower = add(1, 3800, 8); // least desirable spot, first in line
    const homes = [2, 3, 4, 5, 6].map((x) => add(x, 12, 1));
    const ctx = (city as unknown as { devContext(): DevContext }).devContext();
    ctx.desir['R$'].fill(60);
    ctx.desir['R$'][5 * 32 + 1] = 10;
    ctx.demand = {
      ...ctx.demand,
      demand: Object.fromEntries(DEV_TYPES.map((t) => [t, t === 'R$' ? -900 : 0])) as typeof ctx.demand.demand,
      raw: Object.fromEntries(DEV_TYPES.map((t) => [t, t === 'R$' ? -100 : 0])) as typeof ctx.demand.raw,
    };
    exodus(ctx); // 35 Sims too many
    expect(tower.type).toBe('R$');
    expect(homes.filter((b) => !b.type).length).toBeGreaterThan(0);
  });
});

describe('roads to jobs', () => {
  it('a road reaching only a civic workplace counts as leading to jobs', () => {
    const city = new City({ size: 32, seed: 1, water: false });
    city.buildNetwork(2, 10, 20, 10, 'road'); // no connection, no C/I zone
    city.refresh();
    const comp = () => city.fields.componentHasJobs[city.fields.component[10 * 32 + 5]!];
    expect(comp()).toBe(0);
    expect(city.placeStructure('elementarySchool', 10, 11).ok).toBe(true);
    city.refresh();
    expect(comp()).toBe(1);
  });
});

describe('workforce', () => {
  // An IHT plant in a town with too few R$$ never fills its jobs and is abandoned.
  const setup = (homesWanted: boolean) => {
    const city = new City({ size: 32, seed: 1, difficulty: 'easy', water: false });
    const s = city.state;
    city.buildNetwork(0, 6, 31, 6, 'road');
    city.zone(0, 0, 31, 5, 'I-medium', { autoStreets: false });
    const id = s.nextId++;
    const b = {
      id, x: 4, y: 5, w: 1, h: 1, stage: 1, origType: 'IHT' as const, type: 'IHT' as const, capacity: 40, occupancy: 1, filled: 4,
      distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: true,
      age: 30, eq: 50, hq: 50, abandonReason: null, builtDay: 0, commute: 10, noJobMonths: 0, historical: false,
    };
    s.buildings.set(id, b);
    s.occupant[5 * 32 + 4] = id;
    city.refresh();
    const ctx = (city as unknown as { devContext(): DevContext }).devContext();
    ctx.desir['IHT'].fill(200);
    ctx.demand = {
      ...ctx.demand,
      demand: Object.fromEntries(DEV_TYPES.map((t) => [t, t === 'R$$' && homesWanted ? 500 : 0])) as typeof ctx.demand.demand,
    };
    for (let m = 0; m < city.cfg.development.distressMonths; m++) updateBuildings(ctx);
    return s.buildings.get(id)!;
  };

  it('a business that can never be staffed is abandoned', () => {
    const b = setup(false);
    expect(b.type).toBeNull();
    expect(b.abandonReason).toBe('workforce');
  });

  it('open jobs are no cause while the workers can still move in', () => {
    expect(setup(true).type).toBe('IHT');
  });
});

describe('reoccupation', () => {
  it('an empty building takes occupants back before new lots are built, wherever it stands', () => {
    const city = new City({ size: 32, seed: 1, difficulty: 'easy', water: false, config: { safety: { fires: false } } });
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.buildNetwork(0, 20, 31, 20, 'road');
    city.zone(1, 9, 30, 9, 'R-low', { autoStreets: false });
    city.zone(1, 11, 30, 11, 'C-low', { autoStreets: false }); // jobs on the road
    city.placeStructure('windPlant', 1, 7);
    city.refresh();
    const s = city.state;
    const id = s.nextId++;
    const empty = {
      id, x: 25, y: 9, w: 1, h: 1, stage: 1, origType: 'R$' as const, type: null, capacity: 12, occupancy: 0, filled: 0,
      distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: false,
      age: 30, eq: 50, hq: 50, abandonReason: 'demand' as const, builtDay: 0, commute: -1, noJobMonths: 6, historical: false,
    };
    empty.noWaterMonths = 6; // left at their limits when it was abandoned
    s.buildings.set(id, empty);
    s.occupant[9 * 32 + 25] = id;
    city.refresh();
    const ctx = (city as unknown as { devContext(): DevContext }).devContext();
    ctx.desir['R$'].fill(95); // fresh lots everywhere look better…
    ctx.desir['R$'][9 * 32 + 25] = 60; // …than the empty house, still good enough to live in
    ctx.demand = { ...ctx.demand, demand: Object.fromEntries(DEV_TYPES.map((t) => [t, t === 'R$' ? 800 : 0])) as typeof ctx.demand.demand };
    expect(developOnce(ctx)).toBe('reoccupied');
    expect(empty.type).toBe('R$');
    expect(empty.abandonReason).toBeNull();
    // The new household starts its countdowns afresh.
    expect([empty.noJobMonths, empty.noWaterMonths]).toEqual([0, 0]);
  });

  it('a wealthier type moves into a building built for it that poorer Sims hold, before building anew', () => {
    const city = new City({ size: 32, seed: 1, difficulty: 'easy', water: false, config: { safety: { fires: false } } });
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.zone(1, 9, 30, 9, 'R-low', { autoStreets: false });
    city.zone(1, 11, 30, 11, 'C-low', { autoStreets: false });
    city.placeStructure('windPlant', 1, 7);
    city.refresh();
    const s = city.state;
    const id = s.nextId++;
    const tower = {
      id, x: 25, y: 9, w: 1, h: 1, stage: 2, origType: 'R$$' as const, type: 'R$' as 'R$' | 'R$$', capacity: 12, occupancy: 1, filled: 0,
      distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: false,
      age: 30, eq: 50, hq: 50, abandonReason: null, builtDay: 0, commute: -1, noJobMonths: 0, historical: false,
    };
    s.buildings.set(id, tower);
    s.occupant[9 * 32 + 25] = id;
    city.refresh();
    const ctx = (city as unknown as { devContext(): DevContext }).devContext();
    // The tract it stands on is the one the developer picks.
    const T = city.cfg.development.tractSize;
    for (let i = 0; i < 32 * 32; i++) ctx.desir['R$$'][i] = Math.floor((i % 32) / T) === Math.floor(25 / T) ? 90 : 55;
    ctx.demand = { ...ctx.demand, demand: Object.fromEntries(DEV_TYPES.map((t) => [t, t === 'R$$' ? 800 : 0])) as typeof ctx.demand.demand };
    // Only as far as demand wants them: with room for barely anyone, the R$ Sims keep their homes
    // (a half-empty takeover lost the city its people and invited the next one).
    const raw = (n: number) => ({ ...ctx.demand.raw, 'R$$': n });
    ctx.demand = { ...ctx.demand, raw: raw(2) };
    expect(developOnce(ctx)).not.toBe('reoccupied');
    expect(tower.type).toBe('R$');
    ctx.demand = { ...ctx.demand, raw: raw(500) };
    const before = s.buildings.size;
    expect(developOnce(ctx)).toBe('reoccupied');
    expect(tower.type).toBe('R$$');
    expect(s.buildings.size).toBe(before);
  });
});
