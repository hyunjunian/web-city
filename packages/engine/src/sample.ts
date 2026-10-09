// A ready-made town to start from: roads, zones, utilities and services laid
// out on a 128-tile map and grown for a while, so a first look at the viewer
// (or a Worker demo) shows a living city. Pure engine code.

import { City } from './city';

/** Builds the sample town and runs it for `days` (default nine months, when it has filled in). */
/** Placements that failed (for tests of the layout). */
export const sampleFailures: string[] = [];

export function sampleCity(opts: { seed?: number; days?: number; name?: string } = {}): City {
  const n = 128;
  const city = new City({ size: n, seed: opts.seed ?? 3, difficulty: 'easy', water: false, name: opts.name ?? '예시 도시' });
  const c = 64;
  sampleFailures.length = 0;
  const ok = (what: string, r: { ok: boolean; message?: string }) => {
    if (!r.ok) sampleFailures.push(`${what}: ${r.message ?? ''}`);
  };
  // Laid out in one batch: the fields are worked out once, after the last edit.
  city.batch(() => {
    // Arteries: an avenue east–west and a road north–south, both reaching neighbours.
    city.buildNetwork(0, c, n - 1, c, 'avenue');
    city.buildNetwork(c, 0, c, n - 1, 'road');
    // A grid of streets every 8 tiles around the centre.
    for (let k = -32; k <= 32; k += 8) {
      if (k === 0) continue;
      city.buildNetwork(c - 36, c + k, c + 36, c + k, 'road');
      city.buildNetwork(c + k, c - 36, c + k, c + 36, 'road');
    }
    // Services first (zoned land isn't free for them), in the blocks' corners.
    ok('largePoliceStation', city.placeStructure('largePoliceStation', c - 3, c - 12));
    ok('smallFireStation', city.placeStructure('smallFireStation', c + 2, c - 12));
    ok('largeFireStation', city.placeStructure('largeFireStation', c + 20, c + 9));
    ok('elementarySchool', city.placeStructure('elementarySchool', c - 22, c - 30));
    ok('highSchool', city.placeStructure('highSchool', c - 6, c - 22));
    ok('medicalClinic', city.placeStructure('medicalClinic', c - 12, c - 14));
    ok('smallPoliceStation', city.placeStructure('smallPoliceStation', c - 20, c + 12));
    ok('elementarySchool', city.placeStructure('elementarySchool', c + 17, c - 31));
    ok('elementarySchool', city.placeStructure('elementarySchool', c - 22, c + 9));
    ok('medicalClinic', city.placeStructure('medicalClinic', c + 12, c - 14));
    ok('medicalClinic', city.placeStructure('medicalClinic', c - 12, c + 12));
    // Recycling stretches the landfill's life (−20% garbage for 25,000 residents).
    ok('recyclingCenter', city.placeStructure('recyclingCenter', c - 35, c + 25));
    for (const [x, y] of [[c - 30, c - 20], [c + 28, c - 20], [c - 14, c + 4], [c - 28, c + 18], [c + 20, c + 4], [c + 30, c + 4]] as const) ok('smallParkGreen', city.placeStructure('smallParkGreen', x, y));
    // Homes north, shops along the avenue, offices at the crossing, industry south-east, farms south-west.
    city.zone(c - 35, c - 35, c - 1, c - 9, 'R-low');
    city.zone(c + 1, c - 35, c + 35, c - 9, 'R-medium');
    // Shops face the avenue; the rows behind them are homes (more shops than the town can keep stand empty).
    city.zone(c - 35, c - 4, c + 35, c - 1, 'C-medium');
    city.zone(c - 35, c - 7, c + 35, c - 5, 'R-medium');
    city.zone(c - 35, c + 1, c - 1, c + 7, 'R-medium');
    city.zone(c + 1, c + 1, c + 15, c + 7, 'C-high');
    city.zone(c + 17, c + 1, c + 35, c + 7, 'C-medium');
    city.zone(c - 35, c + 9, c - 1, c + 23, 'R-low');
    city.zone(c + 1, c + 9, c + 35, c + 35, 'I-medium');
    city.zone(c - 35, c + 25, c - 1, c + 35, 'A');
    // Utilities: a coal plant out east with a line in, pumps and pipes under the streets.
    ok('coalPlant', city.placeStructure('coalPlant', c + 44, c + 20));
    // Garbage is burned for power next door: two plants take about all a town
    // this size throws away, so the landfill only catches the overflow.
    ok('wasteToEnergyPlant', city.placeStructure('wasteToEnergyPlant', c + 44, c + 26));
    ok('wasteToEnergyPlant', city.placeStructure('wasteToEnergyPlant', c + 44, c + 31));
    city.buildPowerLine(c + 37, c + 22, c + 43, c + 22);
    // A service road so the plants' garbage gets collected.
    city.buildNetwork(c + 37, c + 16, c + 43, c + 16, 'road');
    city.buildNetwork(c + 43, c + 17, c + 43, c + 21, 'road');
    city.buildNetwork(c + 43, c + 23, c + 43, c + 35, 'road');
    // The pumps sit west of town: a line takes power out to them.
    city.buildPowerLine(c - 39, c - 21, c - 39, c - 7);
    city.buildPowerLine(c - 38, c - 14, c - 36, c - 14);
    for (let k = -32; k <= 32; k += 8) city.buildPipe(c - 36, c + k + 1, c + 36, c + k + 1);
    city.buildPipe(c - 36, c - 31, c - 36, c + 33);
    for (let k = 0; k < 5; k++) ok('waterPump', city.placeStructure('waterPump', c - 40, c - 20 + 3 * k));
    city.buildPipe(c - 41, c - 20, c - 41, c - 8);
    city.buildPipe(c - 41, c - 14, c - 36, c - 14);
    // Garbage out west.
    city.buildNetwork(c - 50, c + 8, c - 37, c + 8, 'road'); // joins the grid's row at c + 8
    city.zone(c - 50, c + 9, c - 39, c + 14, 'landfill');
    // Taxes two points above neutral pay for the services without stalling growth.
    for (const t of ['R$', 'R$$', 'R$$$', 'Cs$', 'Cs$$', 'Cs$$$', 'Co$$', 'Co$$$', 'IA', 'ID', 'IM', 'IHT'] as const) city.setTaxRate(t, 11);
    // Homes fill to their cap regardless, so residential tax can be a point higher.
    for (const t of ['R$', 'R$$', 'R$$$'] as const) city.setTaxRate(t, 12.5);
  });
  city.step(opts.days ?? 270);
  return city;
}
