import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity } from '../src';

describe('elevation', () => {
  it('refuses unknown terrain modes without filling water or charging funds', () => {
    const city = new City({ size: 16, water: false });
    expect(city.terraform(2, 2, 4, 4, 'water').ok).toBe(true);
    city.refresh();
    const before = saveCity(city);
    for (const mode of [undefined, null, '', 'dig', 'constructor']) {
      const raw = mode as Parameters<City['terraform']>[4];
      expect(city.previewTerraform(2, 2, 4, 4, raw)).toMatchObject({ ok: false, cost: 0, tiles: 0 });
      expect(city.terraform(2, 2, 4, 4, raw)).toMatchObject({ ok: false, cost: 0 });
      expect(saveCity(city)).toEqual(before);
    }
    expect(city.terraform(2, 2, 4, 4, 'land').ok).toBe(true);
  });

  it('fills excavated land to the same surrounding height in either drag direction', () => {
    const forward = new City({ size: 8, water: false });
    const backward = new City({ size: 8, water: false });
    for (const city of [forward, backward]) {
      for (let i = 0; i < city.state.height.length; i++) city.state.height[i] = 30 + i % 8 * 10;
      city.terraform(2, 2, 4, 4, 'water');
    }
    forward.terraform(2, 2, 4, 4, 'land');
    backward.terraform(4, 4, 2, 2, 'land');
    expect(forward.state.height[3 * 8 + 3]).toBe(60);
    expect(backward.state.height).toEqual(forward.state.height);
  });

  it('rounds zoning endpoints before planning the zones and their automatic streets', () => {
    const exact = new City({ size: 32, water: false });
    const fractional = new City({ size: 32, water: false });
    const plan = exact.previewZone(1, 1, 15, 15, 'R-low');
    expect(plan.streets.length).toBeGreaterThan(0);
    expect(fractional.previewZone(1.25, 1.25, 15.25, 15.25, 'R-low')).toEqual(plan);
    expect(fractional.zone(1.25, 1.25, 15.25, 15.25, 'R-low')).toEqual(exact.zone(1, 1, 15, 15, 'R-low'));
    expect(saveCity(fractional)).toEqual(saveCity(exact));
    // Minimum areas use the tile-rounded rectangle too.
    expect(fractional.previewZone(20.49, 20.49, 23.1, 23.1, 'A').ok).toBe(true);
  });

  it('refuses non-finite rectangular drags without planting trees or creating invalid events', () => {
    const city = new City({ size: 16, water: false });
    const before = saveCity(city);
    const rectangles: [number, number, number, number][] = [[0, 0, Infinity, Infinity], [-Infinity, -Infinity, 5, 5], [0, NaN, 5, 5]];
    for (const coordinates of rectangles) {
      expect(city.previewZone(...coordinates, 'R-low').ok).toBe(false);
      expect(city.zone(...coordinates, 'R-low').ok).toBe(false);
      expect(city.previewTrees(...coordinates).ok).toBe(false);
      expect(city.plantTrees(...coordinates).ok).toBe(false);
      expect(city.terraform(...coordinates, 'water').ok).toBe(false);
      expect(city.bulldoze(...coordinates).ok).toBe(false);
    }
    expect(saveCity(city)).toEqual(before);
  });

  it('centres planting effects on the clipped tile rectangle', () => {
    const clipped = new City({ size: 16, water: false });
    const exact = new City({ size: 16, water: false });
    expect(clipped.plantTrees(-10, -10, 2.25, 2.25)).toEqual(exact.plantTrees(0, 0, 2, 2));
    expect(saveCity(clipped)).toEqual(saveCity(exact));
  });

  it('keeps flat-ground air pollution independent of altitude and restores ridge screening after terrain changes', () => {
    const city = new City({ size: 32, water: false, config: { structures: { coalPlant: { powerUse: 1_000 } } } });
    city.state.funds = 1_000_000;
    city.placeStructure('coalPlant', 3, 3);
    city.state.height.fill(20);
    city.refresh();
    const flat = city.fields.air.slice();
    const target = 5 * city.size + 15;
    expect(flat[target]).toBeGreaterThan(0);
    city.state.height.fill(80);
    city.refresh();
    expect(city.fields.air).toEqual(flat);
    city.state.height.fill(20);
    for (let y = 0; y < city.size; y++) city.state.height[y * city.size + 10] = 100;
    city.refresh();
    expect(city.fields.air[target]).toBe(0);
    city.state.height.fill(20);
    city.refresh();
    expect(city.fields.air).toEqual(flat);
  });

  it('shaping the land is free until the city is founded, then costs', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 1_000;
    expect(city.established()).toBe(false);
    expect(city.terraform(5, 5, 9, 9, 'raise').cost).toBe(0);
    expect(city.terraform(5, 5, 6, 6, 'water').cost).toBe(0);
    expect(city.state.funds).toBe(1_000);
    city.buildNetwork(0, 20, 31, 20, 'road');
    expect(city.established()).toBe(true);
    expect(city.terraform(12, 5, 13, 6, 'raise').cost).toBeGreaterThan(0);
    // Land already at the ceiling can't rise further, and isn't charged for it.
    for (let y = 5; y <= 6; y++) for (let x = 20; x <= 21; x++) city.state.height[y * 32 + x] = 250;
    expect(city.terraform(20, 5, 21, 6, 'raise')).toMatchObject({ ok: false, cost: 0 });
  });

  it('terraform and tree previews count only the tiles the tools change', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 100_000;
    city.buildNetwork(0, 10, 31, 10, 'road'); // founded: shaping costs now, and the road is left alone
    city.zone(0, 12, 9, 15, 'R-low', { autoStreets: false });
    for (const to of ['raise', 'water'] as const) {
      const p = city.previewTerraform(0, 8, 9, 13, to);
      expect(p.tiles).toBeLessThan(60);
      const before = city.state.funds;
      expect(city.terraform(0, 8, 9, 13, to).cost).toBe(p.cost);
      expect(before - city.state.funds).toBe(p.cost);
    }
    const t = city.previewTrees(10, 0, 20, 12);
    expect(t.tiles).toBeLessThan(11 * 13);
    expect(city.plantTrees(10, 0, 20, 12).cost).toBe(t.cost);
  });

  it('zoning lays no street up a cliff the street tool refuses', () => {
    const city = new City({ size: 64, seed: 3, water: false });
    city.state.funds = 10_000_000;
    for (let k = 0; k < 20; k++) city.terraform(20, 30, 40, 45, 'raise'); // a plateau with a cliff edge
    expect(city.previewNetwork(30, 25, 30, 35, 'street').message).toBe('too steep for this network');
    expect(city.zone(28, 24, 32, 36, 'R-low').ok).toBe(true);
    const s = city.state;
    const grade = city.cfg.transport.tunnel.grade;
    for (let i = 0; i < s.net.length; i++) {
      if (!s.net[i]) continue;
      for (const j of [i + 1, i + 64]) {
        if (j < s.net.length && s.net[j] && (j !== i + 1 || j % 64 !== 0)) expect(Math.abs(s.height[i]! - s.height[j]!)).toBeLessThanOrEqual(grade);
      }
    }
  });

  it('generated maps have hills sloping down to the water; flat maps are flat', () => {
    const hilly = new City({ size: 64, seed: 4 });
    const land = [...hilly.state.height].filter((h, i) => hilly.state.terrain[i] === 0);
    expect(Math.max(...land) - Math.min(...land)).toBeGreaterThan(20);
    const flat = new City({ size: 32, water: false });
    expect(new Set(flat.state.height).size).toBe(1);
  });

  it('ground above the average zoned height is worth more, up to a point', () => {
    const city = new City({ size: 48, water: false });
    city.state.funds = 1_000_000;
    city.zone(0, 0, 47, 47, 'R-low', { autoStreets: false });
    city.zone(10, 10, 14, 14, 'none');
    for (let k = 0; k < 5; k++) city.terraform(10, 10, 14, 14, 'raise'); // +20 m
    expect(city.query(12, 12)!.landValue).toBeGreaterThan(city.query(30, 30)!.landValue);
    for (let k = 0; k < 20; k++) city.terraform(10, 10, 14, 14, 'raise'); // +100 m: too high
    expect(city.query(12, 12)!.landValue).toBe(0);
  });

  it('industry prefers flat land, and steep ground caps building size', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 1_000_000;
    const flat = city.query(10, 10)!.desirability.ID.factors.slope!;
    expect(flat).toBeGreaterThan(0);
    city.terraform(10, 10, 10, 10, 'raise'); // a 4 m step: medium slope
    expect(city.query(10, 10)!.desirability.ID.factors.slope).toBeCloseTo(flat / 2);
    for (let k = 0; k < 2; k++) city.terraform(10, 10, 10, 10, 'raise'); // 12 m: beyond steep
    expect(city.query(10, 10)!.desirability.ID.factors.slope ?? 0).toBe(0);
    const copy = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(copy.state.height[10 * 32 + 10]).toBe(city.state.height[10 * 32 + 10]);
  });
});

describe('terraforming', () => {
  it('digging water clears the trees there', () => {
    const city = new City({ size: 32, seed: 2, difficulty: 'easy', water: false });
    city.state.funds = 100_000;
    expect(city.plantTrees(10, 10, 10, 10).ok).toBe(true);
    const i = 10 * 32 + 10;
    expect(city.state.trees[i]).toBeGreaterThan(0);
    expect(city.terraform(10, 10, 10, 10, 'water').ok).toBe(true);
    expect(city.state.trees[i]).toBe(0);
  });
});

describe('grayscale topographical maps', () => {
  // Ocean on the left (0), land rising from sea level (83) to white (255) on the right.
  const W = 65;
  const ramp = { width: W, height: W, data: Array.from({ length: W * W }, (_, i) => (i % W < 20 ? 0 : 83 + Math.round(((i % W) - 20) * (172 / 44)))) };

  it('below 83 is water, above it land rising with the shade', () => {
    const city = new City({ size: 32, heightmap: ramp });
    const q = (x: number) => city.query(x, 16)!;
    expect(q(2).terrain).toBe('water');
    expect(q(30).terrain).toBe('land');
    expect(q(30).height).toBeGreaterThan(q(14).height);
    expect(q(31).height).toBeGreaterThan(150);
  });

  it('a region shares one image between its cities, edge to edge', async () => {
    const { Region } = await import('../src');
    const region = new Region({ width: 2, height: 1, citySize: 32, heightmap: ramp });
    const west = region.found(0, 0);
    region.close(0, 0, west);
    const east = region.found(1, 0);
    expect(west.query(2, 16)!.terrain).toBe('water');
    expect(east.query(30, 16)!.height).toBeGreaterThan(150);
    // Heights carry on across the border.
    expect(Math.abs(east.query(0, 16)!.height - west.query(31, 16)!.height)).toBeLessThanOrEqual(6);
  });
});
