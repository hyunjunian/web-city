import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity } from '../src';

describe('clearing and rebuilding', () => {
  it('removes civic jobs from the census as soon as a facility is demolished', () => {
    const city = new City({ size: 32, water: false });
    city.buildNetwork(2, 3, 2, 8, 'road');
    city.placeStructure('smallPoliceStation', 3, 3);
    expect(city.stats().jobs).toBe(22);
    expect(city.bulldoze(3, 3, 3, 3).ok).toBe(true);
    expect(city.stats().jobs).toBe(0);
    expect(city.census.civicJobs).toEqual([0, 0, 0]);
    expect(loadCity(saveCity(city)).stats()).toEqual(city.stats());
  });

  it.each(['coalPlant', 'smallPoliceStation'] as const)('finishes a day without the jobs of a burned-down %s', (kind) => {
    const config = { safety: { fires: false, maxBurnDays: 1 }, disasters: { simulated: false }, mayor: { riots: false } };
    const city = new City({ size: 32, water: false, config });
    city.buildNetwork(2, 3, 2, 8, 'road');
    city.placeStructure(kind, 3, 3);
    expect(city.stats().jobs).toBeGreaterThan(0);
    expect(city.igniteAt(3, 3)).toBe(true);
    city.step(1);
    expect(city.state.structures.size).toBe(0);
    expect(city.stats().jobs).toBe(0);
    expect(loadCity(saveCity(city), { config }).stats().jobs).toBe(city.stats().jobs);
  });

  it.each(['road', 'facility', 'water'] as const)('clears only the tree-fire markers replaced by %s', (kind) => {
    const city = new City({ size: 32, water: false });
    city.plantTrees(2, 2, 12, 12);
    city.disaster('lightning', 4, 4);
    city.disaster('lightning', 10, 10);
    expect(city.stats().safety.burning).toBe(2);
    const result = kind === 'road' ? city.buildNetwork(3, 4, 5, 4, 'road')
      : kind === 'facility' ? city.placeStructure('smallParkGreen', 4, 4)
      : city.terraform(4, 4, 4, 4, 'water');
    expect(result.ok).toBe(true);
    expect(city.state.treeFires.map((fire) => fire.i)).toEqual([10 * 32 + 10]);
    expect(city.stats().safety.burning).toBe(1);
  });

  it('does not carry potholes from a demolished elevated highway onto a new segment', () => {
    const city = new City({ size: 32, water: false });
    city.buildElevated(2, 8, 20, 8, 'highway');
    const tile = 8 * 32 + 10;
    city.state.potholes[tile] = city.state.potholes[tile + 1] = 1;
    expect(city.bulldoze(10, 8, 10, 8).ok).toBe(true);
    expect(city.state.potholes[tile]).toBe(0);
    expect(city.buildElevated(10, 8, 10, 8, 'highway').ok).toBe(true);
    expect(city.state.potholes[tile]).toBe(0);
    expect(city.state.potholes[tile + 1]).toBe(1);
  });

  it('acknowledges a free tree-only demolition and removes its burning-tree markers at once', () => {
    const city = new City({ size: 16, water: false });
    city.plantTrees(2, 2, 4, 4);
    city.disaster('lightning', 3, 3);
    expect(city.stats().safety.burning).toBe(1);
    expect(city.previewBulldoze(2, 2, 4, 4)).toMatchObject({ ok: true, cost: 0 });
    const before = city.state.funds;
    expect(city.bulldoze(2, 2, 4, 4)).toEqual({ ok: true, cost: 0 });
    expect(city.state.funds).toBe(before);
    expect(city.state.trees.some(Boolean)).toBe(false);
    expect(city.stats().safety.burning).toBe(0);
    expect(city.previewBulldoze(2, 2, 4, 4).ok).toBe(false);
  });

  it('new utility segments start without the demolished line or pipe wear', () => {
    const city = new City({ size: 32, water: false });
    city.buildPowerLine(2, 4, 20, 4);
    city.buildPipe(2, 8, 20, 8);
    const line = 4 * 32 + 10, pipe = 8 * 32 + 10;
    city.state.lineWear[line] = city.state.lineWear[line + 1] = 200;
    city.state.pipeWear[pipe] = city.state.pipeWear[pipe + 1] = 200;
    city.bulldoze(10, 4, 10, 4);
    city.bulldozePipes(10, 8, 10, 8);
    expect(city.query(10, 4)!.lineWear).toBe(0);
    expect(city.query(10, 8)!.pipeWear).toBe(0);
    expect(city.buildPowerLine(10, 4, 10, 4).ok).toBe(true);
    expect(city.buildPipe(10, 8, 10, 8).ok).toBe(true);
    expect(city.query(10, 4)!.lineWear).toBe(0);
    expect(city.query(10, 8)!.pipeWear).toBe(0);
    expect(city.query(11, 4)!.lineWear).toBe(200);
    expect(city.query(11, 8)!.pipeWear).toBe(200);
  });

  it('new rail starts intact while adding a road crossing preserves existing rail damage', () => {
    const city = new City({ size: 32, water: false });
    city.buildNetwork(2, 10, 20, 10, 'rail');
    city.state.railDamage[10 * 32 + 10] = city.state.railDamage[10 * 32 + 11] = 1;
    expect(city.buildNetwork(11, 5, 11, 15, 'road').ok).toBe(true);
    expect(city.query(11, 10)!.railDamaged).toBe(true);
    expect(city.bulldoze(10, 10, 10, 10).ok).toBe(true);
    expect(city.query(10, 10)!.railDamaged).toBe(false);
    expect(city.buildNetwork(10, 10, 10, 10, 'rail').ok).toBe(true);
    expect(city.query(10, 10)!.railDamaged).toBe(false);
    expect(city.query(11, 10)!.railDamaged).toBe(true);
  });
});
