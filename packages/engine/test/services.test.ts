import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity, type CityOptions } from '../src';
import { interp, PLANT_OUTPUT_BY_AGE } from '../src/data/services';
import { STRUCTURES } from '../src/data/structures';

/** A gas plant below the industrial zone, far enough that its smog misses the homes. */
const powerUp = (c: City) => c.placeStructure('gasPlant', 1, 33);

/** Residential block on a road with an industrial block for jobs; no power yet. */
function town(opts: { size?: number; config?: CityOptions['config'] } = {}): City {
  const n = opts.size ?? 48;
  // Random fires could burn down the plant mid-test; these tests are about services.
  const config = { ...opts.config, safety: { fires: false, ...opts.config?.safety } };
  const city = new City({ size: n, seed: 5, difficulty: 'easy', water: false, config });
  city.state.funds = 5_000_000;
  city.buildNetwork(0, 20, n - 1, 20, 'road');
  city.zone(1, 12, n - 2, 19, 'R-low');
  city.zone(1, 21, n - 2, 30, 'I-medium');
  return city;
}

const structures = (c: City, kind: string) => [...c.state.structures.values()].filter((s) => s.kind === kind);

describe('monthly operating history', () => {
  it('records settled supply after equipment ages at the month boundary', () => {
    const city = new City({ size: 32, water: false, config: {
      safety: { fires: false }, disasters: { simulated: false }, mayor: { riots: false },
      structures: { coalPlant: { powerUse: 1_000 } },
    } });
    city.state.funds = 1_000_000;
    city.placeStructure('coalPlant', 3, 3);
    [...city.state.structures.values()][0]!.life = 90;
    city.refresh();
    city.step(30);
    const now = city.stats(), last = city.state.history.at(-1)!;
    expect(last.powerSupply).toBe(Math.round(now.power.supply));
    expect(last.powerDemand).toBe(Math.round(now.power.demand));
    expect(last.population).toBe(now.population);
  });
});

describe('service funding refreshes', () => {
  it('keeps overlapping clinic coverage at its true average beyond 255 facilities', () => {
    const city = new City({ size: 64, water: false });
    city.state.funds = 1_000_000;
    city.batch(() => {
      for (let k = 0; k < 255; k++) expect(city.placeStructure('medicalClinic', 24 + k % 16, 16 + 2 * Math.floor(k / 16)).ok).toBe(true);
    });
    const i = 32 * city.size + 32;
    expect(city.fields.healthQuality[i]).toBe(1);
    expect(city.placeStructure('medicalClinic', 39, 46).ok).toBe(true);
    city.refreshIfDirty();
    expect(city.fields.healthQuality[i]).toBe(1);
    expect(city.fields.hospitalCover[i]).toBe(1);
    expect(city.fields.hqBoost[i]).toBeCloseTo(city.cfg.structures.medicalClinic.health!.boost, 5);
    const loaded = loadCity(saveCity(city));
    expect(loaded.fields.healthQuality[i]).toBe(1);
    // Closing one clinic leaves the operating capacity to provide almost all care.
    const clinic = [...city.state.structures.values()][0]!;
    expect(city.setFunding(clinic.id, 0)).toBe(true);
    city.refreshIfDirty();
    expect(city.fields.healthQuality[i]).toBeCloseTo(255 * 500 / (255 * 500 + 1), 6);
  });

  it.each([
    ['busStop', 'transit'], ['smallParkGreen', 'parks'], ['waterTower', 'water'],
    ['wasteToEnergyPlant', 'sanitation'],
  ] as const)('refuses individual funding for the department-funded %s', (kind, dept) => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 1_000_000;
    expect(city.placeStructure(kind, 3, 3).ok).toBe(true);
    city.refresh();
    const st = [...city.state.structures.values()][0]!;
    const before = saveCity(city);
    expect(city.setFunding(st.id, 50)).toBe(false);
    expect(saveCity(city)).toEqual(before);
    const upkeep = city.structureUpkeep(st.id)!.running;
    expect(upkeep).toBeGreaterThan(0);
    city.setDepartmentFunding(dept, 50);
    expect(city.structureUpkeep(st.id)!.running).toBeCloseTo(upkeep / 2, 5);
  });

  it.each(['power', 'water', 'parks', 'sanitation', 'landmarks', 'corrections'] as const)('%s funding retains the route plan while updating the full utility and effect model', (dept) => {
    const config = { safety: { fires: false }, disasters: { simulated: false } };
    const start = town({ config });
    powerUp(start);
    start.placeStructure('waterPump', 20, 33);
    start.buildPipe(20, 16, 46, 16);
    start.buildPipe(20, 16, 20, 33);
    start.step(60);
    const saved = saveCity(start);
    const a = loadCity(saved, { config }), b = loadCity(saved, { config });
    const plan = a.fields.travel;
    a.setDepartmentFunding(dept, 50);
    a.refreshIfDirty();
    b.setDepartmentFunding(dept, 50);
    b.refresh({ travel: false });
    expect(a.fields.travel).toBe(plan);
    expect(a.stats()).toEqual(b.stats());
    expect(a.demand).toEqual(b.demand);
    expect(saveCity(a)).toEqual(saveCity(b));
  });

  it('updates same-day clinic coverage exactly like a full refresh while retaining unchanged utility results', () => {
    const config = { safety: { fires: false }, disasters: { simulated: false } };
    const start = town({ config });
    powerUp(start);
    start.placeStructure('medicalClinic', 20, 8);
    start.step(90);
    const saved = saveCity(start);
    const a = loadCity(saved, { config }), b = loadCity(saved, { config });
    const clinic = [...a.state.structures.values()].find((st) => st.kind === 'medicalClinic')!;
    const power = a.power, water = a.water;
    a.setFunding(clinic.id, 40);
    a.setVehicleFunding(clinic.id, 180);
    a.refreshIfDirty();
    b.setFunding(clinic.id, 40);
    b.setVehicleFunding(clinic.id, 180);
    b.refresh({ travel: false });
    expect(a.power).toBe(power);
    expect(a.water).toBe(water);
    for (const key of ['air', 'waterPollution', 'nimbyRes', 'nimbyCom', 'healthQuality', 'hqBoost', 'schoolQuality'] as const) expect(a.fields[key]).toEqual(b.fields[key]);
    expect(a.stats()).toEqual(b.stats());
    expect(a.demand).toEqual(b.demand);
    expect(saveCity(a)).toEqual(saveCity(b));
    a.step(1);
    const previous = a.power;
    a.setFunding(clinic.id, 80);
    a.refreshIfDirty();
    expect(a.power).not.toBe(previous); // new development and loads may have arrived since the last full refresh
  });

  it('recomputes source effects when a modded clinic has funding-dependent civic bonuses', () => {
    const city = town({ config: { structures: { medicalClinic: { com: [40, 12] } } } });
    powerUp(city);
    city.placeStructure('medicalClinic', 20, 8);
    const clinic = [...city.state.structures.values()].find((st) => st.kind === 'medicalClinic')!;
    const at = 8 * city.size + 20;
    const before = city.fields.nimbyCom[at]!;
    city.setFunding(clinic.id, 50);
    city.refreshIfDirty();
    expect(city.fields.nimbyCom[at]).toBeCloseTo(before / 2, 5);
  });

  it('updates service capacity and coverage while keeping the unchanged route plan', () => {
    const city = town();
    powerUp(city);
    expect(city.placeStructure('medicalClinic', 20, 8).ok).toBe(true);
    const clinic = structures(city, 'medicalClinic')[0]!;
    const capacity = clinic.capacity;
    const plan = city.fields.travel;
    const commute = [...city.fields.commute];
    city.setFunding(clinic.id, 50);
    city.query(20, 8);
    expect(clinic.capacity).toBeLessThan(capacity);
    expect([...city.fields.commute]).toEqual(commute);
    expect(city.fields.travel).toBe(plan);
    const health = [...city.fields.healthQuality];
    city.setVehicleFunding(clinic.id, 200);
    city.query(20, 8);
    expect(city.fields.healthQuality.some((v, i) => v !== health[i])).toBe(true);
    expect(city.fields.travel).toBe(plan);
    city.setDepartmentFunding('transit', 80);
    city.query(20, 8);
    expect(city.fields.travel).not.toBe(plan);
  });
});

describe('power', () => {
  it('a mayor query outside the map cannot wrap onto a home on another row', () => {
    const city = town();
    powerUp(city);
    city.step(60);
    const home = [...city.state.buildings.values()].find((b) => b.type?.startsWith('R'))!;
    expect(home).toBeDefined();
    expect(city.mayorAt(home.x, home.y)).not.toBeNull();
    expect(city.mayorAt(home.x + city.size, home.y - 1)).toBeNull();
    expect(city.mayorAt(home.x - city.size, home.y + 1)).toBeNull();
  });

  it('says whether a site would join a grid', () => {
    const city = town();
    expect(city.powerReach('gasPlant', 1, 35)).toBe('none'); // 6 tiles from the industrial zone (rows 21–29)
    expect(city.powerReach('gasPlant', 1, 34)).toBe('linked'); // 5: across a 4-tile gap
    powerUp(city);
    city.refresh();
    expect(city.powerReach('waterPump', 20, 33)).toBe('powered');
  });

  it('nothing develops without power', () => {
    const city = town();
    city.step(120);
    expect(city.stats().buildings).toBe(0);
  });

  it('zones next to a plant get power and develop', () => {
    const city = town();
    expect(city.placeStructure('coalPlant', 1, 31).ok).toBe(true);
    expect(city.query(10, 15)!.powered).toBe(true);
    city.step(120);
    expect(city.stats().buildings).toBeGreaterThan(10);
    expect(city.stats().power.supply).toBeCloseTo(6_000, -2);
  });

  it('power jumps gaps of up to four tiles but not more', () => {
    const city = new City({ size: 40, water: false });
    city.zone(10, 10, 12, 12, 'R-low', { autoStreets: false });
    city.placeStructure('windPlant', 17, 10); // gap of 4 empty tiles (13–16)
    expect(city.query(11, 11)!.powered).toBe(true);
    city.zone(30, 30, 32, 32, 'R-low', { autoStreets: false });
    expect(city.query(31, 31)!.powered).toBe(false);
    // A power line bridges the rest of the way.
    city.buildPowerLine(19, 10, 19, 26);
    city.buildPowerLine(19, 26, 29, 26);
    expect(city.query(31, 31)!.powered).toBe(true);
  });

  it('zoning over a power line removes it', () => {
    const city = new City({ size: 24, water: false });
    city.buildPowerLine(2, 5, 20, 5);
    expect(city.query(10, 5)!.powerLine).toBe(true);
    city.zone(8, 4, 12, 6, 'R-low', { autoStreets: false });
    expect(city.query(10, 5)!.powerLine).toBe(false);
  });

  it('overloaded grids get rolling blackouts and unpowered buildings are abandoned', () => {
    const city = town();
    city.placeStructure('windPlant', 1, 31); // 200 MWh: not enough for long
    city.step(360);
    const s = city.stats();
    expect(s.power.demand).toBeGreaterThan(s.power.supply);
    const reasons = [...city.state.buildings.values()].map((b) => b.abandonReason);
    expect(city.power.blackedOut > 0 || reasons.includes('no-power')).toBe(true);
  });

  it('losing the only plant abandons buildings after six months', () => {
    const city = town();
    city.placeStructure('coalPlant', 1, 31);
    city.step(150);
    expect(city.stats().buildings).toBeGreaterThan(0);
    const plant = structures(city, 'coalPlant')[0]!;
    city.bulldoze(plant.x, plant.y, plant.x, plant.y);
    city.step(200);
    const active = [...city.state.buildings.values()].filter((b) => b.type);
    expect(active.length).toBe(0);
    expect([...city.state.buildings.values()].some((b) => b.abandonReason === 'no-power')).toBe(true);
  });

  it('plants age, lose output and explode at the end of their life', () => {
    const city = town();
    city.placeStructure('coalPlant', 1, 31);
    const plant = structures(city, 'coalPlant')[0]!;
    city.step(30);
    expect(plant.life).toBeGreaterThan(0);
    expect(interp(PLANT_OUTPUT_BY_AGE, 90)).toBe(0.35);
    plant.life = 99.99;
    city.step(30);
    expect(structures(city, 'coalPlant').length).toBe(0);
  });

  it('underfunding a plant costs less and shortens its life, but not its output', () => {
    const city = town();
    city.placeStructure('coalPlant', 1, 31);
    const plant = structures(city, 'coalPlant')[0]!;
    city.setFunding(plant.id, 50);
    city.refresh();
    expect(city.power.supply).toBeCloseTo(6_000, -2);
    city.step(30);
    expect(city.state.lastBudget!.powerUpkeep).toBeGreaterThanOrEqual(250 * 0.65 * 0.5);
    expect(city.state.lastBudget!.powerUpkeep).toBeLessThan(125); // fuel follows the small actual load
    const half = plant.life;
    const full = town();
    full.placeStructure('coalPlant', 1, 31);
    full.step(30);
    expect(half).toBeGreaterThan(structures(full, 'coalPlant')[0]!.life);
  });
});

describe('health', () => {
  it('Community CPR raises HQ on every block, clinic or not', () => {
    const run = (cpr: boolean) => {
      const city = town();
      powerUp(city);
      city.step(60);
      if (cpr) expect(city.enactOrdinance('communityCpr').ok).toBe(true);
      // The same households in both runs (new homes start afresh and differ between runs).
      const ids = new Set([...city.state.buildings.values()].filter((b) => b.type?.[0] === 'R').map((b) => b.id));
      city.step(360);
      return new Map([...city.state.buildings.values()].filter((b) => b.type?.[0] === 'R' && ids.has(b.id)).map((b) => [b.id, b.hq]));
    };
    const [yes, no] = [run(true), run(false)];
    const both = [...yes.keys()].filter((id) => no.has(id));
    expect(both.length).toBeGreaterThan(10);
    // Per household (a home emptied and moved into again starts afresh, so the typical change, not the mean).
    const diffs = both.map((id) => yes.get(id)! - no.get(id)!).sort((a, b) => a - b);
    expect(diffs[diffs.length >> 1]!).toBeGreaterThan(0.4); // 10% of a clinic's boost, a year long
  }, 60_000);

  it('a clinic raises HQ of households in its radius', () => {
    // Homes here sit next to heavy industry; switch pollution off to isolate the clinic.
    const city = town({ size: 64, config: { services: { hqPerPollution: 0 } } });
    powerUp(city);
    city.placeStructure('medicalClinic', 10, 10);
    city.step(360 * 5);
    const near: number[] = [];
    const far: number[] = [];
    for (const b of city.state.buildings.values()) {
      if (b.type !== 'R$') continue;
      (Math.hypot(b.x - 10, b.y - 11) < 20 ? near : far).push(b.hq);
    }
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    expect(avg(near)).toBeGreaterThan(30);
    expect(avg(far)).toBeLessThan(20);
  }, 60_000);

  it('rolling blackouts move round the town, even one using a corner of the map', () => {
    const n = 64;
    const city = new City({ size: n, seed: 5, difficulty: 'easy', water: false, config: { safety: { fires: false } } });
    city.state.funds = 5_000_000;
    city.buildNetwork(0, 8, n - 1, 8, 'road');
    city.zone(1, 1, n - 2, 7, 'R-medium');
    city.zone(1, 9, n - 2, 14, 'I-medium');
    for (let k = 0; k < 9; k++) city.placeStructure('windPlant', 1 + 2 * k, 16);
    const dark = new Map<number, number>();
    let longest = 0;
    let cuts = 0;
    for (let m = 0; m < 8; m++) {
      city.step(30);
      cuts += city.power.blackedOut;
      for (const b of city.state.buildings.values()) {
        const run = b.type && !b.powered ? (dark.get(b.id) ?? 0) + 1 : 0;
        dark.set(b.id, run);
        longest = Math.max(longest, run);
      }
    }
    expect(cuts).toBeGreaterThan(0); // short of power, so blackouts did fall
    expect(longest).toBeLessThanOrEqual(2); // a different section each month
    expect([...city.state.buildings.values()].filter((b) => b.abandonReason === 'no-power')).toHaveLength(0);
  }, 60_000);

  it('homes covered by a clinic and a big hospital split their patients by capacity', () => {
    const city = town({ size: 64 });
    powerUp(city);
    city.step(180);
    expect(city.placeStructure('medicalClinic', 20, 8).ok).toBe(true);
    expect(city.placeStructure('largeMedicalCenter', 24, 6).ok).toBe(true);
    city.refresh();
    const clinic = structures(city, 'medicalClinic')[0]!;
    const center = structures(city, 'largeMedicalCenter')[0]!;
    expect(clinic.load).toBeGreaterThan(0);
    // (The center reaches a little further, but most of its homes are the clinic's: split by count, it took about as many.)
    expect(center.load / clinic.load).toBeGreaterThan(4);
  }, 60_000);

  it('pollution wears HQ down', () => {
    const clean = town({ size: 64, config: { services: { hqPerPollution: 0 } } });
    const dirty = town({ size: 64 });
    for (const c of [clean, dirty]) {
      powerUp(c);
      c.step(360 * 2);
    }
    expect(dirty.stats().hq[0]).toBeLessThan(clean.stats().hq[0]);
  }, 60_000);

  it('healthcare coverage turns residential desirability from penalty to bonus', () => {
    const city = town({ size: 64 });
    powerUp(city);
    expect(city.query(10, 15)!.desirability['R$$'].factors.health).toBe(-8);
    city.placeStructure('medicalClinic', 10, 10);
    expect(city.query(10, 15)!.desirability['R$$'].factors.health).toBeCloseTo(8);
    expect(city.query(60, 15)!.desirability['R$$'].factors.health).toBe(-8);
  });

  it('ambulance funding widens or shrinks the radius and costs money', () => {
    const city = town({ size: 64 });
    powerUp(city);
    city.placeStructure('medicalClinic', 10, 10);
    const clinic = structures(city, 'medicalClinic')[0]!;
    const health = (x: number, y: number) => city.query(x, y)!.desirability['R$$'].factors.health;
    expect(health(40, 15)).toBe(-8);
    expect(city.setVehicleFunding(clinic.id, 200)).toBe(true);
    city.refreshIfDirty();
    expect(health(40, 15)).toBeGreaterThan(0);
    city.setVehicleFunding(clinic.id, 0);
    city.refreshIfDirty();
    expect(health(10, 27)).toBe(-8);
    // Upkeep follows the vehicle budget; buildings without vehicles refuse it.
    city.step(30);
    const none = city.state.lastBudget!.healthUpkeep;
    city.setVehicleFunding(clinic.id, 100);
    city.step(30);
    expect(city.state.lastBudget!.healthUpkeep - none).toBeCloseTo(STRUCTURES.medicalClinic.health!.vehicles!, 0);
    city.placeStructure('localLibrary', 40, 6);
    expect(city.setVehicleFunding(structures(city, 'localLibrary')[0]!.id, 150)).toBe(false);
  });
});

describe('education', () => {
  it('schools raise EQ, and higher EQ shifts business demand', () => {
    const city = town({ size: 64 });
    powerUp(city);
    for (const [k, x] of [['elementarySchool', 4], ['highSchool', 20], ['localLibrary', 40], ['elementarySchool', 56]] as const) {
      expect(city.placeStructure(k, x, 6).ok).toBe(true);
    }
    expect(city.placeStructure('cityCollege', 30, 0).ok).toBe(true);
    city.step(360 * 10);
    expect(city.stats().eq[0]).toBeGreaterThan(25);
    // Workers above EQ1 demand manufacturing and offices, not only dirty industry.
    expect(city.census.workersByEq[0][1] + city.census.workersByEq[0][2]).toBeGreaterThan(0);
  }, 60_000);

  it('elementary schools do nothing for old households', () => {
    const c = STRUCTURES.elementarySchool.school?.curve;
    expect(c).toBe('elementary');
    const city = town();
    expect(interp(city.cfg.services.eduCurves.elementary, 25)).toBe(5);
    expect(interp(city.cfg.services.eduCurves.elementary, 60)).toBe(0);
  });

  it('overcrowded schools lose grade, and strikes cut effectiveness to 20%', () => {
    const city = town({ size: 64 });
    powerUp(city);
    city.placeStructure('elementarySchool', 30, 6);
    const school = structures(city, 'elementarySchool')[0]!;
    city.setFunding(school.id, 5);
    city.step(360);
    expect(school.load).toBeGreaterThan(school.capacity);
    school.strike = 1;
    city.refresh();
    expect(school.effectiveness).toBeLessThanOrEqual(0.2);
  });
});

describe('air pollution and hills', () => {
  it('a ridge between a plant and the homes holds its smog back', () => {
    const n = 48;
    const city = new City({ size: n, seed: 5, water: false, config: { safety: { fires: false } } });
    city.state.funds = 1_000_000;
    city.state.height.fill(20);
    city.buildNetwork(0, 20, n - 1, 20, 'road');
    expect(city.placeStructure('coalPlant', 10, 21).ok).toBe(true);
    city.refresh();
    const at = () => city.fields.air[24 * n + 25]!;
    const flat = at();
    expect(flat).toBeGreaterThan(0);
    for (let y = 0; y < n; y++) for (const x of [19, 20]) if (y !== 20) city.state.height[y * n + x] = 60;
    city.refresh();
    expect(at()).toBeLessThan(flat * 0.5);
  });
});

describe('school desirability', () => {
  it('one school gives most of it; higher education the rest (the full bonus needs a whole school system)', () => {
    const city = town({ size: 64 });
    powerUp(city);
    expect(city.placeStructure('elementarySchool', 30, 6).ok).toBe(true);
    city.refresh();
    const q = () => city.fields.schoolQuality[10 * 64 + 31]!;
    const basic = q();
    expect(basic).toBeGreaterThan(0.5);
    expect(basic).toBeLessThan(0.8);
    city.state.unlocked.push('cityCollege');
    expect(city.placeStructure('cityCollege', 36, 5).ok).toBe(true);
    city.refresh();
    expect(q()).toBeGreaterThan(basic + 0.2);
  });
});

describe('rewards and budget', () => {
  it('reward buildings stay locked until their condition is met', () => {
    const city = town();
    const r = city.placeStructure('nuclearPlant', 1, 31);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/locked/);
    city.state.unlocked.push('nuclearPlant');
    expect(city.placeStructure('nuclearPlant', 1, 31).ok).toBe(true);
  });

  it('charges monthly upkeep by department', () => {
    const city = town();
    city.placeStructure('coalPlant', 1, 31);
    city.placeStructure('medicalClinic', 10, 5);
    city.placeStructure('elementarySchool', 20, 5);
    city.buildPowerLine(40, 0, 40, 10);
    city.step(30);
    const b = city.state.lastBudget!;
    expect(b.powerUpkeep).toBeGreaterThanOrEqual(250 * 0.65 + 11 * 0.1);
    expect(b.powerUpkeep).toBeLessThan(250 + 11 * 0.1); // the plant isn't at full load yet
    expect(b.healthUpkeep).toBe(400 + 50); // + ambulances
    expect(b.educationUpkeep).toBe(400 + 50); // + school buses
  });

  it('saves power lines, funding, households and unlocks', () => {
    const city = town();
    city.placeStructure('coalPlant', 1, 31);
    city.placeStructure('medicalClinic', 10, 5);
    city.buildPowerLine(40, 0, 40, 10);
    city.state.unlocked.push('solarPlant');
    const clinic = structures(city, 'medicalClinic')[0]!;
    city.setFunding(clinic.id, 80);
    city.step(90);
    const copy = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(copy.query(40, 5)!.powerLine).toBe(true);
    expect(structures(copy, 'medicalClinic')[0]!.funding).toBe(80);
    expect(copy.state.unlocked).toContain('solarPlant');
    const b = [...city.state.buildings.values()][0]!;
    expect(copy.state.buildings.get(b.id)!.hq).toBe(b.hq);
  });

  it('loads version 1 saves', () => {
    const city = town();
    city.placeStructure('smallParkGreen', 2, 2);
    const v2 = saveCity(city);
    const v1 = {
      ...v2,
      version: 1 as const,
      power: undefined,
      unlocked: undefined,
      blackoutRotation: undefined,
      structures: v2.structures.map(({ id, kind, x, y }) => ({ id, kind, x, y, size: 1 })),
    };
    const copy = loadCity(JSON.parse(JSON.stringify(v1)));
    expect(copy.state.structures.size).toBe(1);
    expect(copy.state.power.length).toBe(48 * 48);
  });
});

describe('civic pollution (base game and Rush Hour tables)', () => {
  it.each([[31, 0, 0], [31, 7, 9], [32, 0, 0], [32, 7, 9]] as const)(
    'keeps fractional pollution radii on the tile grid (size %i, source %i,%i)', (size, x, y) => {
      const city = new City({ size, water: false, config: {
        structures: { medicalClinic: { pollution: [10, 2.5, 5, 1.5] } },
      } });
      expect(city.placeStructure('medicalClinic', x, y).ok).toBe(true);
      const at = y * size + x;
      expect(city.fields.air[at]).toBe(10);
      expect(city.fields.air[at + 3]).toBeCloseTo(10 * (1 - 3 / 3.5), 5);
      expect(city.fields.air[at + 4]).toBe(0);
      expect(city.fields.waterPollution[at]).toBe(5);
      expect(city.fields.waterPollution[at + 2]).toBeCloseTo(1, 5);
      expect(city.fields.waterPollution[at + 3]).toBe(0);
    },
  );

  it('civic, utility and transit buildings carry their listed figures', () => {
    expect(STRUCTURES.cityJail.pollution).toEqual([7, 2, 5, 3]);
    expect(STRUCTURES.largeWaterPump.pollution).toEqual([12, 2, 0, 0]);
    expect(STRUCTURES.largeMedicalCenter.pollution).toEqual([2, 3, 2, 4]);
    expect(STRUCTURES.freightStation.pollution).toEqual([1, 1, 4, 2]);
  });
});

describe('bulldoze cost tables', () => {
  it('demolishing a civic structure costs its listed price', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 100_000;
    expect(city.placeStructure('coalPlant', 4, 4).ok).toBe(true);
    const before = city.state.funds;
    expect(city.bulldoze(4, 4, 4, 4).cost).toBe(450);
    expect(before - city.state.funds).toBe(450);
    expect(STRUCTURES.cityJail.bulldoze).toBe(230);
    expect(STRUCTURES.waterTreatmentPlant.bulldoze).toBe(1_350);
  });
});

describe('age profile (bar graphs)', () => {
  it('groups residents and their EQ by 10-year household age', () => {
    const city = new City({ size: 32, water: false });
    const mk = (id: number, age: number, eq: number) => city.state.buildings.set(id, {
      id, x: 0, y: id, w: 1, h: 1, stage: 1, origType: 'R$', type: 'R$', capacity: 10, occupancy: 1, filled: 0, distressMonths: 0, noRoadMonths: 0,
      noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: true, age, eq, hq: 0, abandonReason: null, builtDay: 0, commute: -1, noJobMonths: 0, historical: false,
    });
    mk(1, 23, 40);
    mk(2, 27, 80);
    mk(3, 61, 10);
    expect(city.ageProfile()).toEqual([{ from: 20, residents: 20, eq: 60 }, { from: 60, residents: 10, eq: 10 }]);
  });
});

