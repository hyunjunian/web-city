// Reproducible operating-query and refresh benchmarks, separate from correctness tests.
// Usage: npm run benchmark -- [128|256|512] [trials=9]
import assert from 'node:assert/strict';
import { City, loadCity, sampleCity, saveCity } from '../src';

const size = Number(process.argv[2] ?? 128);
const trials = Number(process.argv[3] ?? 9);
if (![128, 256, 512].includes(size) || !Number.isInteger(trials) || trials < 3 || trials > 100) {
  throw new Error('usage: npm run benchmark -- [128|256|512] [trials: 3..100]');
}
const calm = { safety: { fires: false }, disasters: { simulated: false }, mayor: { riots: false } };
const template = sampleCity({ seed: 3, days: 270 });
const city = new City({ size, water: false, difficulty: 'easy', config: calm });
type Layer = Uint8Array | Uint16Array | Uint32Array | Int32Array | Float32Array | Float64Array;
const layers = city.state as unknown as Record<string, Layer>;
// Repeat the same grown neighbourhood at each map size, so density stays constant.
for (let by = 0; by < size / 128; by++) for (let bx = 0; bx < size / 128; bx++) {
  for (const [key, source] of Object.entries(template.state)) {
    if (!ArrayBuffer.isView(source) || !('length' in source) || source.length !== 128 * 128) continue;
    const from = source as Layer;
    for (let y = 0; y < 128; y++) layers[key]!.set(from.subarray(y * 128, (y + 1) * 128), (by * 128 + y) * size + bx * 128);
  }
  for (const old of template.state.buildings.values()) {
    const b = { ...structuredClone(old), id: city.state.nextId++, x: old.x + bx * 128, y: old.y + by * 128 };
    delete b.jobs;
    city.state.buildings.set(b.id, b);
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) city.state.occupant[y * size + x] = b.id;
  }
  for (const old of template.state.structures.values()) {
    const st = { ...structuredClone(old), id: city.state.nextId++, x: old.x + bx * 128, y: old.y + by * 128 };
    city.state.structures.set(st.id, st);
    for (let y = st.y; y < st.y + st.h; y++) for (let x = st.x; x < st.x + st.w; x++) city.state.occupant[y * size + x] = -st.id;
  }
}
city.state.day = template.state.day;
city.state.funds = 10_000_000;
city.state.taxRates = { ...template.state.taxRates };
city.refresh();
const saved = saveCity(city);
const clinic = [...city.state.structures.values()].find((st) => st.kind === 'medicalClinic')!;
const utility = [...city.state.structures.values()].find((st) => st.kind === 'coalPlant')!;

function measure(run: () => unknown, iterations: number) {
  for (let i = 0; i < 3; i++) run();
  const samples: number[] = [];
  for (let trial = 0; trial < trials; trial++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) run();
    samples.push((performance.now() - start) / iterations);
  }
  samples.sort((a, b) => a - b);
  return { medianMs: samples[Math.floor(samples.length / 2)], p90Ms: samples[Math.ceil(samples.length * 0.9) - 1], iterations };
}

const reports = {
  forecast120Months: measure(() => city.budgetForecast(120), 10),
  infrastructure: measure(() => city.infrastructureReport(), 10),
  cleanDispatchComparison: measure(() => city.energyReport('clean'), 20),
  maintenanceImpact: measure(() => city.maintenanceImpact(utility.id), 20),
};
assert.deepEqual(saveCity(city), saved, 'reports changed the city');
const refreshWithoutTravel = measure(() => city.refresh({ travel: false }), 3);
const clinicFundingAndRadius = measure(() => {
  city.setFunding(clinic.id, 70);
  city.setVehicleFunding(clinic.id, 60);
  city.refreshIfDirty();
  city.setFunding(clinic.id, 100);
  city.setVehicleFunding(clinic.id, 100);
  city.refreshIfDirty();
}, 3);
// Each month starts from the same save; loading is outside the timed interval.
const monthSamples: number[] = [];
for (let trial = 0; trial < trials; trial++) {
  const copy = loadCity(saved, { config: calm });
  const start = performance.now();
  copy.step(30);
  monthSamples.push(performance.now() - start);
}
monthSamples.sort((a, b) => a - b);
console.log(JSON.stringify({ size, trials, seed: 3, population: city.stats().population,
  buildings: city.state.buildings.size, structures: city.state.structures.size,
  ...reports, refreshWithoutTravel, clinicFundingAndRadius,
  month: { medianMs: monthSamples[Math.floor(trials / 2)], p90Ms: monthSamples[Math.ceil(trials * 0.9) - 1] },
  rssMiB: process.memoryUsage().rss / 1048576,
}, null, 2));
