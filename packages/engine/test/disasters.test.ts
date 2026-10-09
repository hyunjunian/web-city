import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity } from '../src';
import { SPAN } from '../src/sim/state';

const CALM = { mayor: { riots: false } } as const;

/** A developed town: homes north of a road, industry south, a gas plant. */
function town(): City {
  const n = 48;
  const city = new City({ size: n, seed: 5, difficulty: 'easy', water: false, config: CALM });
  city.state.funds = 5_000_000;
  city.buildNetwork(0, 20, n - 1, 20, 'road');
  city.zone(1, 12, n - 2, 19, 'R-medium');
  city.zone(1, 21, n - 2, 30, 'I-medium');
  city.placeStructure('gasPlant', 1, 33);
  city.buildPipe(1, 16, 46, 16);
  city.state.funds = 5_000_000;
  city.step(180);
  return city;
}

const buildingsNear = (c: City, x: number, y: number, r: number) =>
  [...c.state.buildings.values()].filter((b) => Math.abs(b.x - x) <= r && Math.abs(b.y - y) <= r).length;

describe('God Mode disasters', () => {
  it('a meteor leaves a crater of rubble, above and below ground', () => {
    const city = town();
    expect(buildingsNear(city, 24, 16, 3)).toBeGreaterThan(0);
    city.takeReports(); // whatever happened while the town grew
    const r = city.disaster('meteor', 24, 16, 1);
    expect(r.buildings).toBeGreaterThan(0);
    expect(city.query(24, 16)!.rubble).toBe(true);
    expect(city.query(24, 16)!.pipe).toBe(false);
    expect(city.query(24, 16)!.landform).toBe('crater');
    expect(city.takeReports()).toHaveLength(1);
  }, 30_000);

  it('earthquakes follow the first fault line', () => {
    const city = town();
    city.disaster('earthquake', 24, 16, 0.5);
    const angle = city.state.faultAngle;
    expect(angle).not.toBeNull();
    city.disaster('earthquake', 10, 25, 0.5);
    expect(city.state.faultAngle).toBe(angle);
  }, 30_000);

  it('a plant flattened by a meteor is rubble; it explodes only at the end of its life or burned down', () => {
    const city = new City({ size: 48, water: false, config: { safety: { fires: false } } });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 20, 47, 20, 'road');
    expect(city.placeStructure('gasPlant', 20, 21).ok).toBe(true);
    city.takeReports();
    city.disaster('meteor', 21, 22, 1);
    expect([...city.state.structures.values()].some((st) => st.kind === 'gasPlant')).toBe(false);
    expect(city.takeReports().some((r) => r.kind === 'explosion')).toBe(false);
  });

  it('tornadoes die over water and turn back from big buildings', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    for (let x = 0; x < 32; x++) for (let y = 0; y < 32; y++) if (x > 10) city.state.terrain[y * 32 + x] = 1;
    const r = city.disaster('tornado', 11, 10, 1); // starts on water
    expect(r.buildings + r.structures).toBe(0);
    // A big plant is not destroyed by a tornado.
    const land = new City({ size: 32, water: false, config: CALM });
    land.state.funds = 1_000_000;
    land.placeStructure('coalPlant', 14, 14);
    land.disaster('tornado', 15, 15, 1);
    expect([...land.state.structures.values()].some((s) => s.kind === 'coalPlant')).toBe(true);
  });

  it('a volcano raises an unbuildable cone with slopes for low density only', () => {
    const city = new City({ size: 48, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.disaster('volcano', 24, 24, 0);
    expect(city.query(24, 24)!.landform).toBe('cone');
    expect(city.query(24 + 5, 24)!.landform).toBe('slope');
    city.zone(20, 20, 28, 28, 'R-high', { autoStreets: false });
    expect(city.query(24, 24)!.zone).toBe('none');
    city.zone(29, 24, 29, 24, 'R-low', { autoStreets: false });
    expect(city.query(29, 24)!.zone).toBe('R-low');
    expect(city.placeStructure('smallParkGreen', 24, 24).ok).toBe(false);
    const h = city.state.height;
    expect(h[24 * 48 + 24]!).toBeGreaterThan(h[5 * 48 + 5]! + 20);
    const res = city.levelLandform(20, 20, 28, 28);
    expect(res.cost).toBeGreaterThan(0);
    expect(city.placeStructure('smallParkGreen', 24, 24).ok).toBe(true);
    // Levelled whole, the mountain comes down to the land around it (and so can be built up again).
    city.bulldoze(24, 24, 24, 24);
    city.levelLandform(10, 10, 38, 38);
    expect(h[24 * 48 + 24]).toBe(h[24 * 48 + 9]);
  });

  it('lightning and God Mode fires start fires; robots and UFOs wreck lots', () => {
    const city = town();
    const b = [...city.state.buildings.values()].find((x) => x.type)!;
    const l = city.disaster('lightning', b.x, b.y);
    expect(l.fires).toBe(1); // no fire station anywhere: the blaze catches
    expect(city.state.fires.some((fi) => fi.target === b.id && fi.stage === 2)).toBe(true);
    const before = city.state.buildings.size;
    const r = city.disaster('robot', 24, 16, 1);
    expect(r.buildings).toBeGreaterThan(0);
    expect(city.state.buildings.size).toBeLessThan(before);
    const u = city.disaster('ufo', 30, 25, 1);
    expect(u.buildings + u.structures).toBeGreaterThan(0);
  }, 30_000);
});

describe('simulation disasters', () => {
  it('nuclear plants that explode irradiate the land for good', () => {
    const city = new City({ size: 64, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.state.unlocked.push('nuclearPlant');
    city.placeStructure('nuclearPlant', 30, 30);
    const plant = [...city.state.structures.values()].find((s) => s.kind === 'nuclearPlant')!;
    plant.life = 100;
    city.step(30);
    expect(city.state.structures.has(plant.id)).toBe(false);
    expect(city.query(31, 31)!.radiation).toBe(255);
    expect(city.query(31, 31 + 20)!.radiation).toBe(255);
    city.step(30 * 12);
    expect(city.query(31, 31)!.radiation).toBe(255);
    expect(city.takeReports().some((r) => r.kind === 'meltdown')).toBe(true);
  });

  it('underfunded water pipes wear out and burst into sinkholes', () => {
    const city = town();
    city.setDepartmentFunding('water', 20);
    city.step(30 * 18);
    expect(city.state.pipeWear.some((w) => w >= 50) || city.takeReports().some((r) => r.kind === 'sinkhole')).toBe(true);
    city.setDepartmentFunding('water', 100);
    city.step(30 * 12);
    expect(city.state.pipeWear.every((w) => w < 50)).toBe(true);
  }, 60_000);

  it('underfunded power lines spark fires', () => {
    const city = new City({ size: 48, seed: 2, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.state.departments.power = 20;
    for (let x = 0; x < 48; x++) city.state.power[10 * 48 + x] = 1;
    for (let k = 0; k < 12; k++) city.placeStructure('smallParkGreen', 2 + k * 3, 11);
    city.step(30 * 24);
    expect(city.state.lineWear.some((w) => w >= 50)).toBe(true);
  }, 60_000);

  it('underfunded mass transit damages rail; trains derail on it', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.buildNetwork(0, 10, 31, 10, 'rail');
    city.setDepartmentFunding('transit', 0);
    city.step(30 * 12);
    expect(city.state.railDamage.some((d) => d === 1)).toBe(true);
    city.setDepartmentFunding('transit', 110);
    city.step(30 * 12);
    expect(city.state.railDamage.every((d) => d === 0)).toBe(true);
  });

  it('can be switched off, and the state survives a save', () => {
    const city = new City({ size: 32, water: false, config: { ...CALM, disasters: { simulated: false } } });
    city.buildNetwork(0, 10, 31, 10, 'rail');
    city.setDepartmentFunding('transit', 0);
    city.step(30 * 6);
    expect(city.state.railDamage.every((d) => d === 0)).toBe(true);
    const other = new City({ size: 32, water: false, config: CALM });
    other.disaster('volcano', 16, 16, 0);
    const copy = loadCity(JSON.parse(JSON.stringify(saveCity(other))));
    expect(copy.query(16, 16)!.landform).toBe('cone');
  });
});

describe('terrain tools', () => {
  it('digs and fills water on open tiles only', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 100_000;
    city.buildNetwork(0, 5, 31, 5, 'road');
    const r = city.terraform(0, 4, 3, 6, 'water');
    expect(r.cost).toBe(8 * 50); // the road row is left alone
    expect(city.query(0, 4)!.terrain).toBe('water');
    expect(city.query(0, 5)!.terrain).toBe('land');
    city.terraform(0, 4, 3, 4, 'land');
    expect(city.query(0, 4)!.terrain).toBe('land');
  });
});

describe('trees', () => {
  it('planting costs §3 a sapling, cleans the air and cheers the area', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 100_000;
    city.placeStructure('coalPlant', 2, 2);
    city.refresh();
    const before = city.query(10, 4)!.airPollution;
    const r = city.plantTrees(8, 2, 12, 6);
    expect(r.cost).toBe(25 * 3);
    city.refreshIfDirty();
    expect(city.query(10, 4)!.airPollution).toBeLessThan(before);
    expect(city.state.events.some((e) => e.amount === 3)).toBe(true);
    city.bulldoze(8, 2, 12, 6);
    expect(city.state.trees.some((t) => t > 0)).toBe(false);
  });

  it('new maps with water come with some woods', () => {
    const city = new City({ size: 64, seed: 3 });
    expect(city.state.trees.some((t) => t > 0)).toBe(true);
  });
});

describe('toxic spills', () => {
  it('fire engines are sent to a spill and neutralise it; left alone it leaves radiation', () => {
    const n = 32;
    const city = new City({ size: n, seed: 3, water: false, config: CALM });
    city.buildNetwork(0, 10, n - 1, 10, 'road');
    expect(city.placeStructure('smallFireStation', 4, 11).ok).toBe(true);
    const road = 10 * n + 25;
    city.state.spills.push({ i: road, months: 0 });
    city.step(10);
    expect(city.state.spills).toHaveLength(0);
    expect(city.state.radiation[road]).toBe(0);

    const bare = new City({ size: 32, seed: 3, water: false });
    bare.state.spills.push({ i: 5 * 32 + 5, months: 0 });
    bare.step(70);
    expect(bare.state.spills).toHaveLength(0);
    expect(bare.state.radiation[5 * 32 + 5]).toBeGreaterThan(0); // no fire station: it lingers
  });
});

describe('rubble', () => {
  it('blocks growth as rubble (not just unbuildable) and the planner asks to clear it', () => {
    const city = town();
    const n = city.size;
    const zoned: number[] = [];
    for (let i = 0; i < n * n && zoned.length < 6; i++) if (city.state.zone[i] && !city.state.occupant[i] && !city.state.net[i]) zoned.push(i);
    for (const i of zoned) city.state.rubble[i] = 1;
    city.refresh();
    expect(city.growthBlockers(zoned[0]! % n, Math.floor(zoned[0]! / n))).toEqual([{ code: 'rubble' }]);
    expect(city.advisors().some((a) => a.code === 'rubble')).toBe(true);
  });
});

describe('moving disasters (real time, steerable)', () => {
  it('step() leaves them to a viewer that moves them in real time', () => {
    const city = town();
    city.realTimeDisasters = true;
    const live = city.unleash('tornado', 5, 15, 1);
    if (!('id' in live)) throw new Error('not unleashed');
    city.step(5);
    expect(city.state.liveDisasters[0]).toMatchObject({ x: 5, y: 15 });
    city.realTimeDisasters = false;
    city.step(1);
    expect(city.state.liveDisasters[0]?.x ?? -1).not.toBe(5);
  });

  it("a meteor shower costs the Mayor Rating once, not twice (runDisaster already leaves it)", () => {
    const city = new City({ size: 48, water: false, config: { ...CALM, safety: { fires: false } } });
    const live = city.unleash('meteor', 20, 20, 1);
    if (!('id' in live)) throw new Error('not unleashed');
    for (let k = 0; k < 200 && city.state.liveDisasters.length; k++) city.advanceDisasters(1);
    expect(city.state.liveDisasters).toHaveLength(0);
    expect(city.state.events).toHaveLength(1);
  });

  it('mini-UFOs pick off lots where the player holds the pointer', () => {
    const city = town();
    const ufo = city.unleash('ufo', 4, 14, 1);
    if (!('id' in ufo)) throw new Error('not unleashed');
    const target: [number, number] = [40, 15];
    const near = () => buildingsNear(city, target[0], target[1], 3);
    const before = near();
    expect(before).toBeGreaterThan(0);
    city.steerDisaster(ufo.id, target[0], target[1]);
    for (let k = 0; k < 100 && city.state.liveDisasters.length; k++) city.advanceDisasters(1);
    expect(city.state.liveDisasters).toHaveLength(0);
    expect(near()).toBeLessThan(before);
    expect(city.state.events.some((e) => e.amount === city.cfg.disasters.godMode.ufoEvent.amount)).toBe(true);
  });

  it('a tornado moves a step at a time and can be steered', () => {
    const city = town();
    const live = city.unleash('tornado', 5, 15, 1);
    expect('id' in live).toBe(true);
    if (!('id' in live)) return;
    expect('id' in city.unleash('earthquake', 5, 15)).toBe(false);
    city.steerDisaster(live.id, 40, 15);
    const before = buildingsNear(city, 22, 15, 4);
    city.advanceDisasters(3);
    const d = city.state.liveDisasters[0]!;
    expect(d.x).toBe(8); // a step at a time east, pulled along the row
    expect(d.y).toBe(15);
    city.advanceDisasters(7);
    expect(d.x).toBeGreaterThan(15); // held on one point, it hurries there
    expect(d.y).toBe(15);
    city.advanceDisasters(10);
    expect(buildingsNear(city, 22, 15, 4)).toBeLessThan(before);
    // Released, it roams; a save keeps it; it dies down and files a report.
    city.releaseDisaster(live.id);
    const copy = loadCity(saveCity(city));
    expect(copy.state.liveDisasters).toHaveLength(1);
    copy.advanceDisasters(500);
    expect(copy.state.liveDisasters).toHaveLength(0);
    const report = copy.takeReports().find((r) => r.kind === 'tornado')!;
    expect(report.buildings).toBeGreaterThan(0);
  }, 30_000);

  it('a falling meteor can be pulled to land elsewhere, harder', () => {
    const city = town();
    const m = city.unleash('meteor', 5, 15, 0.3);
    if (!('id' in m)) throw new Error('meteor should fall');
    city.steerDisaster(m.id, 24, 16);
    city.advanceDisasters(4);
    const d = city.state.liveDisasters[0]!;
    expect(d.x).toBe(9); // drifting towards the pointer
    expect(d.k!).toBeGreaterThan(0.3);
    city.advanceDisasters(50);
    expect(city.state.liveDisasters).toHaveLength(0);
    const r = city.takeReports().find((x) => x.kind === 'meteor')!;
    expect(r.x).toBeGreaterThan(5);
    expect(city.query(r.x, r.y)!.rubble || city.query(r.x, r.y)!.landform === 'crater').toBe(true);
  }, 30_000);

  it('simulated days move them on too, so they always finish', () => {
    const city = town();
    city.unleash('robot', 24, 15, 0.5);
    city.step(10);
    expect(city.state.liveDisasters).toHaveLength(0);
    expect(city.takeReports().some((r) => r.kind === 'robot')).toBe(true);
  }, 30_000);
});

describe('monsters on the surface', () => {
  it('a robot or Autosaurus tread leaves a road tunnel below alone; a quake does not', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 100_000;
    city.buildNetwork(0, 10, 31, 10, 'road');
    const i = 10 * 32 + 15;
    city.state.tunnel[i] = SPAN.tunnel;
    const ctx = (city as unknown as { damageContext(k: string, x: number, y: number): { destroyTile(i: number, n: boolean, surface?: boolean): void } })
      .damageContext('robot', 15, 10);
    ctx.destroyTile(i, true, true);
    expect(city.state.net[i]).not.toBe(0);
    ctx.destroyTile(i, true);
    expect(city.state.net[i]).toBe(0);
  });
});

