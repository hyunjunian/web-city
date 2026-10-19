import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity } from '../src';
import { offerMet, unlockMet, type UnlockContext } from '../src/sim/rewards';

const CALM = { safety: { fires: false }, mayor: { riots: false } } as const;

function ctx(city: City, over: Partial<UnlockContext> = {}): UnlockContext {
  return { s: city.state, cfg: city.cfg, census: city.census, powerDemand: 0, hospitals: 0, connections: 0, ...over };
}

/** Grants a reward or deal as if its condition had been met. */
const grant = (city: City, kind: Parameters<City['placeStructure']>[0]) => city.state.unlocked.push(kind);

describe('rewards', () => {
  it('"low pollution" is the air at homes, per resident, not at factories', () => {
    const city = new City({ size: 32, water: false });
    const s = city.state;
    const put = (id: number, x: number, type: 'R$' | 'ID', capacity: number, air: number) => {
      s.buildings.set(id, { id, x, y: 5, w: 1, h: 1, type, origType: type, capacity, occupancy: 1 } as never);
      city.fields.air[5 * s.size + x] = air;
    };
    put(1, 2, 'R$', 30, 10);
    put(2, 4, 'R$', 10, 50);
    put(3, 20, 'ID', 100, 400);
    const ctx = (city as unknown as { unlockContext(): UnlockContext }).unlockContext();
    expect(ctx.meanAir).toBeCloseTo((30 * 10 + 10 * 50) / 40);
  });

  it('reports progress on every reward still to earn', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.state.mayorRating = 50;
    const p = city.rewardProgress();
    const house = p.find((r) => r.kind === 'mayorsHouse')!;
    expect(house.checks.find((c) => c.key === 'mayorRating')).toMatchObject({ have: 50, need: 20, met: true });
    expect(house.checks.find((c) => c.key === 'population')!.met).toBe(false);
    grant(city, 'mayorsHouse');
    expect(city.rewardProgress().some((r) => r.kind === 'mayorsHouse')).toBe(false);
    const worship = city.rewardProgress().find((r) => r.kind === 'houseOfWorship')!;
    grant(city, 'houseOfWorship');
    expect(city.rewardProgress().find((r) => r.kind === 'houseOfWorship')!.description).not.toBe(worship.description); // next tier
  });

  it('service-quality prerequisites: good libraries, city school grade, well-funded services', () => {
    const city = new City({ size: 64, water: false, config: CALM });
    city.state.funds = 1_000_000;
    const u = city.cfg.structures;
    city.state.mayorRating = 60;
    const add = (kind: Parameters<City['placeStructure']>[0], x: number, y: number, effectiveness: number) => {
      expect(city.placeStructure(kind, x, y).ok).toBe(true);
      city.census.residents = [40_000, 0, 0]; // placing re-takes the census
      city.census.population['R$$$'] = 8_000;
      const st = [...city.state.structures.values()].at(-1)!;
      st.effectiveness = effectiveness;
      return st;
    };
    const libs = [0, 1, 2, 3, 4].map((k) => add('localLibrary', 2 + k * 6, 2, 0.9));
    expect(unlockMet(ctx(city), u.mainLibrary.unlock!)).toBe(true);
    libs[0]!.effectiveness = 0.8; // only four good ones now
    expect(unlockMet(ctx(city), u.mainLibrary.unlock!)).toBe(false);

    expect(unlockMet(ctx(city), u.university.unlock!)).toBe(false); // no schools: grade 0
    const school = add('elementarySchool', 2, 20, 0.96);
    expect(unlockMet(ctx(city), u.university.unlock!)).toBe(true);
    expect(unlockMet(ctx(city), u.privateSchool.unlockTiers![0]!)).toBe(false); // schools are good: no call for private ones
    school.effectiveness = 0.7;
    expect(unlockMet(ctx(city), u.privateSchool.unlockTiers![0]!)).toBe(true);

    const school2 = [...city.state.structures.values()].find((x) => x.kind === 'elementarySchool')!;
    city.state.structures.delete(school2.id);
    add('medicalClinic', 40, 40, 1);
    expect(unlockMet(ctx(city), u.bureauOfBureaucracy.unlock!)).toBe(false); // libraries aren't a school system
    city.state.structures.delete([...city.state.structures.values()].find((x) => x.kind === 'medicalClinic')!.id);
    city.state.structures.set(school2.id, school2);
    expect(unlockMet(ctx(city), u.bureauOfBureaucracy.unlock!)).toBe(false); // no hospital
    const clinic = add('medicalClinic', 20, 20, 1);
    expect(unlockMet(ctx(city), u.bureauOfBureaucracy.unlock!)).toBe(true);
    clinic.funding = 80;
    expect(unlockMet(ctx(city), u.bureauOfBureaucracy.unlock!)).toBe(false);
  });

  it('the Large Water Pump opens at 10,000 people or 40,000 m³ of water a month', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    const pump = city.cfg.structures.largeWaterPump.unlock!;
    city.census.residents = [2_000, 0, 0];
    expect(unlockMet(ctx(city, { waterDemand: 39_000 }), pump)).toBe(false);
    expect(unlockMet(ctx(city, { waterDemand: 40_000 }), pump)).toBe(true);
    city.census.residents = [6_000, 0, 0];
    city.census.population.ID = 4_000; // total population, jobs included
    expect(unlockMet(ctx(city), pump)).toBe(true);
  });

  it('checks unlock conditions: population, rating, prerequisites, parks', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    const c = ctx(city);
    const u = city.cfg.structures;
    city.census.residents = [400, 100, 0];
    city.state.mayorRating = 25;
    expect(unlockMet(c, u.mayorsHouse.unlock!)).toBe(true);
    city.state.mayorRating = 10;
    expect(unlockMet(c, u.mayorsHouse.unlock!)).toBe(false);
    // Courthouse needs a City Hall standing in the city.
    city.census.residents = [40_000, 0, 0];
    city.state.mayorRating = 40;
    expect(unlockMet(c, u.courthouse.unlock!)).toBe(false);
    grant(city, 'cityHall');
    city.state.funds = 1_000_000;
    expect(city.placeStructure('cityHall', 2, 2).ok).toBe(true);
    expect(unlockMet(c, u.courthouse.unlock!)).toBe(true);
    // Minor League Stadium needs 16 parks.
    city.census.residents = [30_000, 0, 0];
    expect(unlockMet(c, u.minorLeagueStadium.unlock!)).toBe(false);
    for (let k = 0; k < 16; k++) city.placeStructure('smallParkGreen', 10 + (k % 8), 10 + Math.floor(k / 8));
    expect(unlockMet(c, u.minorLeagueStadium.unlock!)).toBe(true);
  });

  it('allows one copy of a reward, more as tiers are earned', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.state.funds = 1_000_000;
    expect(city.placeStructure('cityHall', 2, 2).ok).toBe(false); // not earned
    grant(city, 'cityHall');
    expect(city.placeStructure('cityHall', 2, 2).ok).toBe(true);
    expect(city.placeStructure('cityHall', 10, 2).ok).toBe(false); // one per city
    grant(city, 'houseOfWorship');
    expect(city.placeStructure('houseOfWorship', 2, 10).ok).toBe(true);
    expect(city.placeStructure('houseOfWorship', 6, 10).ok).toBe(false);
    grant(city, 'houseOfWorship'); // second tier
    expect(city.placeStructure('houseOfWorship', 6, 10).ok).toBe(true);
    // Landmarks: any number, no unlock.
    expect(city.placeStructure('bigBen', 20, 20).ok).toBe(true);
    expect(city.placeStructure('bigBen', 22, 20).ok).toBe(true);
  });

  it('private rewards are free to build but expensive to bulldoze', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.state.funds = 100_000;
    grant(city, 'radioStation');
    expect(city.placeStructure('radioStation', 2, 2).cost).toBe(0);
    expect(city.bulldoze(2, 2, 2, 2).cost).toBe(10_260);
  });

  it('landmarks raise the Mayor Rating around them, less when underfunded', () => {
    const city = new City({ size: 48, seed: 5, difficulty: 'easy', water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 20, 47, 20, 'road');
    city.zone(1, 12, 46, 19, 'R-medium');
    city.zone(1, 21, 46, 30, 'I-medium');
    city.placeStructure('gasPlant', 1, 33);
    city.step(90);
    const home = [...city.state.buildings.values()].find((b) => b.type?.startsWith('R'))!;
    expect(city.mayorAt(home.x, home.y)!.buildings).toBe(0);
    city.placeStructure('greatPyramid', 20, 2);
    const id = [...city.state.structures.values()].find((s) => s.kind === 'greatPyramid')!.id;
    city.refresh();
    const full = city.mayorAt(home.x, home.y)!.buildings;
    expect(full).toBeGreaterThan(0);
    // Funded all together, not one by one.
    expect(city.setFunding(id, 50)).toBe(false);
    city.setDepartmentFunding('landmarks', 50);
    city.refresh();
    expect(city.mayorAt(home.x, home.y)!.buildings).toBeCloseTo(full / 2);
    // A fixed effect across the whole city, wherever it stands.
    city.setDepartmentFunding('landmarks', 100);
    city.refresh();
    const far = [...city.state.buildings.values()].filter((b) => b.type?.startsWith('R')).sort((a, b) => b.x - a.x)[0]!;
    expect(city.mayorAt(far.x, far.y)!.buildings).toBeCloseTo(full);
    expect(full).toBe(city.cfg.structures.greatPyramid.mayor![0]);
  }, 30_000);

  it('adds office and industry cap relief', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.state.funds = 1_000_000;
    const before = { ...city.demand.cap };
    grant(city, 'radioStation');
    city.placeStructure('radioStation', 2, 2);
    expect(city.demand.cap.IM - before.IM).toBeCloseTo(9_000);
    expect(city.demand.cap['R$$'] - before['R$$']).toBeCloseTo(9_000);
  });
});

describe('business deals', () => {
  it('lets an indebted city accept a free rescue offer and receive its monthly income', () => {
    const city = new City({ size: 32, water: false, config: { ...CALM, disasters: { simulated: false } } });
    city.placeStructure('smallParkGreen', 1, 1);
    city.state.funds = -5_000;
    city.step(30);
    expect(city.state.lastBudget!.expenses).toBeGreaterThan(city.state.lastBudget!.income);
    expect(city.state.unlocked).toContain('toxicWasteDump');
    expect(city.canPlaceStructure('toxicWasteDump', 10, 10)).toEqual({ ok: true, cost: 0 });
    const funds = city.state.funds;
    expect(city.placeStructure('toxicWasteDump', 10, 10)).toEqual({ ok: true, cost: 0 });
    expect(city.state.funds).toBe(funds);
    expect(city.canPlaceStructure('smallParkGreen', 20, 20)).toMatchObject({ ok: false, message: 'not enough funds' });
    city.step(30);
    expect(city.state.lastBudget!.dealIncome).toBe(400);
  });

  it('are offered when money is short and stay offered', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    const dump = city.cfg.structures.toxicWasteDump.offer!;
    city.state.funds = -5_000;
    city.state.lastBudget = { income: 100, expenses: 500 } as never;
    expect(offerMet(ctx(city), dump)).toBe(true);
    city.state.lastBudget = { income: 500, expenses: 100 } as never;
    expect(offerMet(ctx(city), dump)).toBe(false);
    // Missile Range: funds fell 20% over six months.
    const missile = city.cfg.structures.missileRange.offer!;
    city.census.residents = [600, 0, 0];
    city.state.lastBudget = { income: 100, expenses: 500 } as never;
    city.state.funds = 800;
    city.state.history = Array.from({ length: 6 }, (_, k) => ({ month: k, population: 600, jobs: 0, funds: 2_000 - k * 100, mayorRating: 0, crimes: 0 }));
    expect(offerMet(ctx(city), missile)).toBe(true);
    city.state.history[0]!.funds = 900;
    expect(offerMet(ctx(city), missile)).toBe(false);
  });

  it('pay monthly income; repealing gambling closes the casino', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.state.funds = 100_000;
    grant(city, 'casino');
    expect(city.placeStructure('casino', 2, 2).ok).toBe(false); // needs Legalize Gambling
    city.enactOrdinance('legalizeGambling');
    expect(city.placeStructure('casino', 2, 2).ok).toBe(true);
    city.step(30);
    expect(city.state.lastBudget!.dealIncome).toBe(300);
    city.repealOrdinance('legalizeGambling');
    expect([...city.state.structures.values()].some((s) => s.kind === 'casino')).toBe(false);
  });

  it('casinos weaken police protection around them', () => {
    const city = new City({ size: 48, water: false, config: CALM });
    city.state.funds = 100_000;
    city.placeStructure('largePoliceStation', 20, 20);
    city.refresh();
    const before = city.query(25, 21)!.policeProtection;
    city.enactOrdinance('legalizeGambling');
    grant(city, 'casino');
    city.placeStructure('casino', 24, 22);
    expect(city.query(25, 21)!.policeProtection).toBeLessThan(before * 0.75);
  });

  it('toxic waste dumps irradiate the land, which lingers after removal', () => {
    const city = new City({ size: 48, water: false, config: CALM });
    city.state.funds = 100_000;
    grant(city, 'toxicWasteDump');
    city.placeStructure('toxicWasteDump', 20, 20);
    city.step(30);
    const q = city.query(25, 21)!;
    expect(q.radiation).toBeGreaterThan(0);
    expect(q.desirability['R$'].total).toBe(0);
    city.bulldoze(20, 20, 20, 20);
    city.step(90);
    expect(city.query(25, 21)!.radiation).toBeGreaterThan(0); // still hot
    city.step(120);
    expect(city.query(25, 21)!.radiation).toBe(0);
    const copy = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(copy.state.unlocked).toContain('toxicWasteDump');
  }, 30_000);
});

describe('transport rewards', () => {
  it('the Lighthouse needs a seaport, the Convention Center a major airport', () => {
    const city = new City({ size: 48, water: false, config: CALM });
    city.state.funds = 1_000_000;
    const u = city.cfg.structures;
    expect(unlockMet(ctx(city), u.lighthouse.unlock!)).toBe(false);
    for (let y = 0; y < 48; y++) for (let x = 40; x < 48; x++) city.state.terrain[y * 48 + x] = 1;
    expect(city.placeStructure('internationalPort', 36, 10).ok).toBe(true);
    // The seaport has to work: shipping freight, not just built.
    expect(unlockMet(ctx(city), u.lighthouse.unlock!)).toBe(false);
    [...city.state.structures.values()].find((st) => st.kind === 'internationalPort')!.load = 40;
    expect(unlockMet(ctx(city), u.lighthouse.unlock!)).toBe(true);
    city.state.mayorRating = 50;
    city.census.population['Cs$'] = 30_000;
    expect(unlockMet(ctx(city), u.conventionCenter.unlock!)).toBe(false);
    city.placeStructure('smallMunicipalAirport', 2, 2);
    city.census.population['Cs$'] = 30_000; // placing refreshed the census
    expect(unlockMet(ctx(city), u.conventionCenter.unlock!)).toBe(true);
  });
});

describe('Rush Hour transportation rewards', () => {
  it('the Grand Railroad Station needs 172,000 R and C and a busy passenger station', () => {
    const city = new City({ size: 48, water: false });
    city.state.funds = 100_000;
    city.buildNetwork(0, 10, 47, 10, 'rail');
    city.buildNetwork(0, 14, 47, 14, 'road');
    expect(city.placeStructure('trainStation', 20, 11).ok).toBe(true);
    const u = city.cfg.structures.grandRailroadStation.unlock!;
    const ctx: UnlockContext = { s: city.state, cfg: city.cfg, census: city.census, powerDemand: 0, hospitals: 0, connections: 0 };
    city.census.population['R$'] = 120_000;
    city.census.population['Cs$'] = 60_000;
    const station = [...city.state.structures.values()].find((s) => s.kind === 'trainStation')!;
    station.load = 500;
    expect(unlockMet(ctx, u)).toBe(false); // the station is quiet
    station.load = 1_900;
    expect(unlockMet(ctx, u)).toBe(true);
    city.census.population['Cs$'] = 40_000;
    expect(unlockMet(ctx, u)).toBe(false);
  });

  it('the Cruise Ship Port goes on the shore', () => {
    const city = new City({ size: 40, water: false });
    city.state.funds = 100_000;
    city.state.unlocked.push('cruiseShipPort');
    expect(city.placeStructure('cruiseShipPort', 5, 5).ok).toBe(false);
    city.terraform(0, 0, 39, 2, 'water');
    expect(city.placeStructure('cruiseShipPort', 5, 1).ok).toBe(true);
  });
});

describe('console cheats', () => {
  it('make every reward available, lift power and water, add money and rename', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    expect(city.canPlaceStructure('mayorsHouse', 2, 2).ok).toBe(false);
    expect(city.cheat('you don’t deserve it').ok).toBe(true);
    expect(city.state.unlocked).toContain('mayorsHouse');
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.zone(1, 4, 30, 9, 'R-low');
    city.step(60);
    expect(city.state.buildings.size).toBe(0); // no power, no growth
    expect(city.cheat('fightthepower').cheat).toBe('powerOff');
    city.step(60);
    expect(city.state.buildings.size).toBeGreaterThan(0);
    expect(loadCity(saveCity(city)).state.cheats.power).toBe(true);
    expect(city.cheat('howdryiam').cheat).toBe('waterOff');
    const funds = city.state.funds;
    city.cheat('weaknesspays');
    expect(city.state.funds).toBe(funds + 1000);
    expect(city.cheat('whererufrom Simtopia').ok).toBe(true);
    expect(city.state.name).toBe('Simtopia');
    expect(city.cheat('tastyzots').ok).toBe(false);
    expect(city.cheat('fightthepower').cheat).toBe('powerOn');
  }, 30_000);

  it("a business deal can be bulldozed even if the fee puts the city in the red", () => {
    const city = new City({ size: 32, water: false });
    city.buildNetwork(0, 10, 31, 10, 'road');
    grant(city, 'toxicWasteDump');
    expect(city.placeStructure('toxicWasteDump', 4, 11).ok).toBe(true);
    city.state.funds = 100;
    const dump = [...city.state.structures.values()].find((st) => st.kind === 'toxicWasteDump')!;
    expect(city.bulldoze(dump.x, dump.y, dump.x, dump.y).ok).toBe(true);
    expect(city.state.funds).toBeLessThan(0);
  });

  it('a business deal can be bulldozed when the city is already in the red', () => {
    const city = new City({ size: 32, water: false });
    city.buildNetwork(0, 10, 31, 10, 'road');
    grant(city, 'toxicWasteDump');
    expect(city.placeStructure('toxicWasteDump', 4, 11).ok).toBe(true);
    city.state.funds = -5_000;
    const dump = [...city.state.structures.values()].find((st) => st.kind === 'toxicWasteDump')!;
    expect(city.bulldoze(dump.x, dump.y, dump.x, dump.y).ok).toBe(true);
    expect([...city.state.structures.values()].some((st) => st.kind === 'toxicWasteDump')).toBe(false);
  });
});
