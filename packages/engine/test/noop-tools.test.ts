import { describe, expect, it } from 'vitest';
import { City, loadCity, sampleCity, saveCity, type ToolResult } from '../src';

const config = { safety: { fires: false }, disasters: { simulated: false }, mayor: { riots: false } };
const outside = [-10, -10, -8, -8] as const;
const existing = (city: City, layer: Uint8Array): [number, number] => {
  const i = layer.findIndex(Boolean);
  expect(i).toBeGreaterThanOrEqual(0);
  return [i % city.size, Math.floor(i / city.size)];
};
const operations: [string, (city: City) => ToolResult | boolean][] = [
  ['cancel an absent contract', city => city.cancelDeal(-1)],
  ['zone outside the map', city => city.zone(...outside, 'R-low')],
  ['redraw an existing zone', city => city.zone(29, 29, 29, 29, 'R-low', { autoStreets: false })],
  ['build a road outside the map', city => city.buildNetwork(...outside, 'road')],
  ['demolish outside the map', city => city.bulldoze(...outside)],
  ['demolish an empty tile', city => city.bulldoze(0, 0, 0, 0)],
  ['build a power line outside the map', city => city.buildPowerLine(...outside)],
  ['redraw an existing power line', city => { const [x, y] = existing(city, city.state.power); return city.buildPowerLine(x, y, x, y); }],
  ['build a pipe outside the map', city => city.buildPipe(...outside)],
  ['redraw an existing pipe', city => { const [x, y] = existing(city, city.state.pipe); return city.buildPipe(x, y, x, y); }],
  ['build a subway outside the map', city => city.buildSubway(...outside)],
  ['build elevated rail outside the map', city => city.buildElevated(...outside, 'elrail')],
  ['remove pipes outside the map', city => city.bulldozePipes(...outside)],
  ['remove subway outside the map', city => city.bulldozeSubway(...outside)],
  ['fill land outside the map', city => city.terraform(...outside, 'land')],
  ['fill an existing land tile', city => city.terraform(0, 0, 0, 0, 'land')],
  ['raise land outside the map', city => city.terraform(...outside, 'raise')],
  ['plant trees outside the map', city => city.plantTrees(...outside)],
  ['level land outside the map', city => city.levelLandform(...outside)],
  ['level an unscarred tile', city => city.levelLandform(0, 0, 0, 0)],
];

describe('ineffective tools', () => {
  const initial = saveCity(sampleCity({ seed: 2701, days: 0 }));
  it.each(operations)('does not change later growth when asked to %s', (_name, apply) => {
    const observed = loadCity(initial, { config }), control = loadCity(initial, { config });
    // New construction since the last weekly refresh makes an unintended refresh observable.
    observed.step(4);
    control.step(4);
    const result = apply(observed);
    if (typeof result === 'boolean') expect(result).toBe(false);
    else expect(result).toMatchObject({ ok: false, cost: 0 });
    expect(saveCity(observed)).toEqual(saveCity(control));
    observed.step(5);
    control.step(5);
    expect(saveCity(observed)).toEqual(saveCity(control));
  });
});
