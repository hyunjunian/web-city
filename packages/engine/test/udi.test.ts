import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity, type ActiveMission } from '../src';

/** Finishes a mission as if it had been driven (the engine only pays for the one under way). */
const finish = (c: City, id: Parameters<City['finishMission']>[0], success: boolean, x: number, y: number) => {
  c.state.udi.active = id;
  return c.finishMission(id, success, x, y);
};

function town(): City {
  const n = 48;
  const city = new City({ size: n, seed: 5, difficulty: 'easy', water: false, config: { safety: { fires: false }, mayor: { riots: false } } });
  city.state.funds = 5_000_000;
  city.buildNetwork(0, 20, n - 1, 20, 'road');
  city.zone(1, 12, n - 2, 19, 'R-low');
  city.zone(1, 21, n - 2, 30, 'I-medium');
  city.placeStructure('gasPlant', 1, 33);
  // A road for the stations, joined to the town's.
  city.buildNetwork(0, 32, n - 1, 32, 'road');
  city.buildNetwork(n - 1, 20, n - 1, 32, 'road');
  city.step(180);
  return city;
}

const isPlan = (p: ActiveMission | { ok: boolean }): p is ActiveMission => 'target' in p;

describe('U-Drive-It', () => {
  it('a police station makes the police car and its missions available', () => {
    const city = town();
    expect(city.availableVehicles()).not.toContain('policeCar');
    expect(city.availableMissions()).not.toContain('disturbanceReported');
    expect(city.placeStructure('smallPoliceStation', 30, 33).ok).toBe(true);
    expect(city.availableVehicles()).toContain('policeCar');
    expect(city.availableVehicles()).toContain('iceCreamTruck'); // any homes
    // Road training comes first; then the police missions open.
    expect(city.availableMissions()).toContain('trainingRoad');
    expect(city.availableMissions()).not.toContain('disturbanceReported');
    const practice = city.startMission('trainingRoad');
    expect(isPlan(practice)).toBe(true);
    finish(city, 'trainingRoad', false, 20, 15);
    expect(city.availableMissions()).not.toContain('disturbanceReported'); // failing it doesn't count
    const funds = city.state.funds;
    finish(city, 'trainingRoad', true, 20, 15);
    expect(city.state.funds).toBe(funds); // no prize for practice
    expect(city.availableMissions()).toContain('disturbanceReported');
    expect(city.availableMissions()).not.toContain('trainingRoad');
  }, 30_000);

  it('plans a drive along the roads, from the station to somewhere else', () => {
    const city = town();
    city.placeStructure('smallPoliceStation', 30, 33);
    finish(city, 'trainingRoad', true, 0, 0);
    const plan = city.startMission('disturbanceReported');
    expect(isPlan(plan)).toBe(true);
    if (!isPlan(plan)) return;
    const n = city.size;
    expect(plan.start).not.toBe(plan.target);
    expect(city.canDrive('policeCar', plan.start % n, Math.floor(plan.start / n))).toBe(true);
    expect(city.canDrive('policeCar', plan.target % n, Math.floor(plan.target / n))).toBe(true);
    expect(city.canDrive('policeCar', 5, 40)).toBe(false); // off-road
    expect(city.canDrive('cropDuster', 5, 40)).toBe(true); // aircraft fly anywhere
  }, 30_000);

  it('a mission given up has no result either way (quitting spares the failure penalty)', () => {
    const city = town();
    city.placeStructure('smallPoliceStation', 30, 33);
    finish(city, 'trainingRoad', true, 0, 0);
    expect(isPlan(city.startMission('disturbanceReported'))).toBe(true);
    const [funds, events] = [city.state.funds, city.state.events.length];
    expect(city.abortMission()).toBe(true);
    expect(city.state.udi.active).toBeUndefined();
    expect([city.state.funds, city.state.events.length]).toEqual([funds, events]);
    expect(city.availableMissions()).toContain('disturbanceReported'); // still there to try
  }, 30_000);

  it('success pays and cheers the spot; failure costs; won missions are not offered again', () => {
    const city = town();
    city.placeStructure('smallPoliceStation', 30, 33);
    const funds = city.state.funds;
    const won = finish(city, 'disturbanceReported', true, 20, 15);
    expect(won.cash).toBe(5_000);
    expect(city.state.funds).toBe(funds + 5_000);
    expect(city.state.events.at(-1)).toMatchObject({ x: 20, y: 15, amount: 50, radius: 8 });
    expect(city.availableMissions()).not.toContain('disturbanceReported');
    const lost = finish(city, 'disturbanceReported', false, 20, 15);
    expect(lost.cash).toBe(-2_000);
    expect(city.state.events.at(-1)!.amount).toBe(-30);
  }, 30_000);

  it('rewards that take several missions unlock on the last one, and progress is saved', () => {
    const city = town();
    city.placeStructure('smallFireStation', 30, 33);
    for (let k = 0; k < 2; k++) expect(finish(city, 'fire', true, 10, 15).unlocked).toEqual([]);
    const copy = loadCity(saveCity(city));
    expect(copy.state.udi.partial.fireLandingStrip).toBe(2);
    expect(finish(copy, 'fire', true, 10, 15).unlocked).toEqual(['fireLandingStrip']);
    expect(copy.isUnlocked('fireLandingStrip')).toBe(true);
    expect(copy.takeNewUnlocks()).toContain('fireLandingStrip');
  }, 30_000);

  it('some missions need several buildings or lengths of track', () => {
    const city = town();
    city.placeStructure('busStop', 10, 33);
    city.placeStructure('busStop', 20, 33);
    finish(city, 'trainingRoad', true, 0, 0);
    expect(city.availableMissions()).not.toContain('sickBusDriver');
    city.placeStructure('busStop', 40, 33);
    expect(city.availableMissions()).toContain('sickBusDriver');
  }, 30_000);

  it('rail training uses a train that has track to run on', () => {
    const city = town();
    city.state.unlocked.push('monorailStation');
    city.placeStructure('freightStation', 2, 40); // no rail track anywhere
    city.buildElevated(5, 44, 40, 44, 'monorail');
    expect(city.placeStructure('monorailStation', 10, 45).ok).toBe(true);
    const plan = city.startMission('trainingRail');
    expect('target' in plan && plan.vehicle).toBe('monorailEngine');
  }, 30_000);
});

describe('mission integrity', () => {
  it('pays only for a mission that was started, once', () => {
    const city = new City({ size: 32, seed: 1, water: false });
    const funds = city.state.funds;
    expect(city.finishMission('aSpecialLoadOfGarbage', true, 1, 1).cash).toBe(0);
    expect(city.state.funds).toBe(funds);
    city.state.udi.active = 'trainingRoad';
    city.finishMission('trainingRoad', true, 1, 1);
    expect(city.finishMission('trainingRoad', true, 1, 1).cash).toBe(0); // not twice
    expect(city.state.udi.done.trainingRoad).toBe(1);
  });
});

describe('special controls', () => {
  it('the Fire Engine puts out fires and toxic spills; the Tank demolishes', () => {
    const city = town();
    // As if a mission with this vehicle were under way.
    const driving = (vehicle: string) => Object.assign(city.state.udi, { active: 'trainingRoad', vehicle });
    const b = [...city.state.buildings.values()].find((x) => x.type)!;
    city.state.fires.push({ target: b.id, stage: 4, days: 0, daysAtMax: 0 });
    driving('fireEngine');
    expect(city.vehicleAction('fireEngine', 'spray', b.x, b.y).ok).toBe(false); // no fire station yet
    expect(city.placeStructure('smallFireStation', 10, 33).ok).toBe(true);
    city.state.fires.push({ target: b.id, stage: 4, days: 0, daysAtMax: 0 });
    const spill = (b.y + 1) * city.size + b.x;
    city.state.spills.push({ i: spill, months: 0 });
    city.state.spills.push({ i: 40 * city.size + 40, months: 0 }); // far away
    const r = city.vehicleAction('fireEngine', 'spray', b.x, b.y);
    expect(r.ok).toBe(true);
    expect(city.state.fires.filter((f) => f.target === b.id)).toHaveLength(0);
    expect(city.state.spills.map((s) => s.i)).toEqual([40 * city.size + 40]);
    expect(city.vehicleAction('fireEngine', 'shoot', b.x, b.y).ok).toBe(false);

    city.state.unlocked.push('armyBase');
    expect(city.placeStructure('armyBase', 20, 36).ok).toBe(true);
    expect(city.vehicleAction('tank', 'shoot', b.x, b.y).ok).toBe(false); // not the mission's vehicle
    driving('tank');
    expect(city.vehicleAction('tank', 'shoot', b.x, b.y).ok).toBe(true);
    expect(city.state.buildings.has(b.id)).toBe(false);
    expect(city.query(b.x, b.y)!.rubble).toBe(true);
    expect(city.vehicleAction('tank', 'shoot', 0, 0).ok).toBe(false);
    // A Fire! mission names the fire to put out.
    const other = [...city.state.buildings.values()].find((x) => x.type)!;
    city.state.fires.push({ target: other.id, stage: 3, days: 0, daysAtMax: 0 });
    delete city.state.udi.active;
    finish(city, 'trainingRoad', true, 0, 0);
    const plan = city.startMission('fire');
    expect('fire' in plan && plan.fire).toBe(other.id);
    // Ending it with the fire still burning is no success.
    const funds = city.state.funds;
    expect(city.finishMission('fire', true, 0, 0).cash).toBeLessThan(0);
    expect(city.state.funds).toBeLessThan(funds);
    // Nor is one whose building burned down (the fire is gone with it).
    const next = [...city.state.buildings.values()].find((x) => x.type)!;
    city.state.fires.push({ target: next.id, stage: 5, days: 0, daysAtMax: 0 });
    const plan2 = city.startMission('fire');
    expect('fire' in plan2 && plan2.fire).toBe(next.id);
    (city as unknown as { burnDown(id: number): void }).burnDown(next.id);
    city.state.fires = city.state.fires.filter((f) => f.target !== next.id);
    expect(city.finishMission('fire', true, 0, 0).cash).toBeLessThan(0);
    // With no mission under way the controls do nothing.
    expect(city.vehicleAction('fireEngine', 'spray', other.x, other.y).message).toBe('no mission with this vehicle');
  }, 60_000);
});
