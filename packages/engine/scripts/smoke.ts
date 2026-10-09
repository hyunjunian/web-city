// Headless run: lays out a starter town and prints yearly stats.
// Usage: npx tsx scripts/smoke.ts [years] [size] [-q] [-probe=TYPE] [-spikes]
import { City, DEV_TYPES } from '../src';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const years = Number(positional[0] ?? 10);
const quiet = process.argv.includes('-q');
// -probe=IA prints why a developer type does or doesn't grow at the end.
const probe = process.argv.find((a) => a.startsWith('-probe='))?.slice(7) as (typeof DEV_TYPES)[number] | undefined;
const n = Number(positional[1] ?? 64);
const city = new City({ size: n, seed: 7, difficulty: 'easy', water: false });
const m = Math.floor(n / 2);
// Two roads across the map (each end is a neighbour connection) and a spine.
city.buildNetwork(0, m - 12, n - 1, m - 12, 'road');
city.buildNetwork(0, m + 8, n - 1, m + 8, 'road');
city.buildNetwork(m, 0, m, n - 1, 'road');
// Services before zoning (zoned land, with its auto-streets, isn't free for them).
city.placeStructure('medicalClinic', m - 3, m - 5);
city.placeStructure('largePoliceStation', m + 2, m - 5);
city.placeStructure('largeFireStation', m - 6, m + 9);
city.placeStructure('smallFireStation', 6, m + 21);
city.placeStructure('elementarySchool', m - 4, m + 2);
city.placeStructure('elementarySchool', m + 10, m - 4);
city.placeStructure('highSchool', m + 6, m + 1);
city.zone(1, m - 24, m - 1, m - 13, 'R-low');
city.zone(m + 1, m - 24, n - 2, m - 13, 'R-medium');
city.zone(1, m - 11, m - 1, m - 6, 'C-low');
city.zone(m + 1, m - 11, n - 2, m - 6, 'C-medium');
city.zone(1, m - 5, m - 1, m + 7, 'R-medium');
city.zone(m + 1, m - 5, n - 2, m + 7, 'R-high');
city.zone(1, m + 9, m - 1, m + 22, 'I-medium');
city.zone(m + 1, m + 9, n - 2, m + 22, 'A');

// Power: coal plants south of the industrial zone (zones conduct power).
city.placeStructure('coalPlant', 2, m + 24);
city.placeStructure('coalPlant', 8, m + 24);
// Garbage: a landfill on the road beside the farms.
city.buildNetwork(n - 12, m + 22, n - 12, m + 34, 'road');
city.zone(n - 11, m + 24, n - 2, m + 43, 'landfill');
city.buildNetwork(n - 12, m + 34, n - 12, m + 44, 'road');
// Water: pumps beside a pipe grid (pipes water six tiles each way).
for (const y of [m - 18, m - 6, m + 4, m + 16]) {
  city.buildPipe(0, y, n - 1, y);
  city.placeStructure('waterPump', 0, y + 1);
  city.placeStructure('waterPump', n - 1, y + 1);
}
city.buildPipe(1, m - 18, 1, m + 16);

// Parks relieve the residential demand caps (and make neighbourhoods nicer).
for (let k = 0; k < 6; k++) city.placeStructure('largePlaza', 4 + k * 9, m - 30);
for (let k = 0; k < 6; k++) city.placeStructure('softballField', m + 4 + k * 9, m - 30);

function avgCommute(): number {
  let sum = 0;
  let k = 0;
  for (const b of city.state.buildings.values()) if (b.type?.[0] === 'R' && b.commute >= 0) { sum += b.commute; k++; }
  return k ? sum / k : -1;
}

const t0 = Date.now();
for (let year = 1; year <= years; year++) {
  city.step(360);
  const s = city.stats();
  const d = DEV_TYPES.map((t) => `${t}:${Math.round(city.demand.demand[t])}`).join(' ');
  console.log(`y${year} pop=${s.population} res=${s.residents} jobs=${s.jobs} bld=${s.buildings} aband=${s.abandoned} funds=${Math.round(s.funds)} unemp=${s.unemployed}`);
  console.log(`    mayor ${s.mayorRating} garbage ${Math.round(s.garbage.produced)}t piled ${Math.round(s.garbage.piled)} space ${Math.round(s.garbage.landfillSpace)}`);
  console.log(`    crime ${s.safety.crimes} arrests ${s.safety.arrests} fires ${s.safety.fires} burned ${s.safety.burned}`);
  console.log(`    water ${Math.round(s.water.demand)}/${Math.round(s.water.supply)} dry=${s.water.shortages}`);
  const reasons: Record<string, number> = {};
  for (const b of city.state.buildings.values()) if (!b.type && b.abandonReason) reasons[b.abandonReason] = (reasons[b.abandonReason] ?? 0) + 1;
  console.log(`    abandoned by reason ${JSON.stringify(reasons)} commute(avg R) ${Math.round(avgCommute())}`);
  console.log(`    power ${Math.round(s.power.demand)}/${Math.round(s.power.supply)} blackout=${s.power.blackedOut} eq=${s.eq} hq=${s.hq} wf=${s.workforceFraction.toFixed(3)}`);
  if (!quiet) console.log('   ', d);
  if (!quiet) console.log('    stages R$', city.census.stageCounts['R$'].join(','), 'Cs$', city.census.stageCounts['Cs$'].join(','), 'ID', city.census.stageCounts.ID.join(','));
}
console.log(JSON.stringify(city.state.lastBudget));
console.log('ms/day', ((Date.now() - t0) / (years * 360)).toFixed(2));

if (probe) {
  const s = city.state;
  const zoneCls = probe === 'IA' ? 'A' : probe[0];
  let tiles = 0;
  let sum = 0;
  let best = -1;
  let bestI = -1;
  for (let i = 0; i < s.zone.length; i++) {
    const z = s.zone[i]!;
    const cls = z >= 1 && z <= 3 ? 'R' : z >= 4 && z <= 6 ? 'C' : z === 7 || z === 8 ? 'I' : z === 9 ? 'A' : null;
    if (cls !== zoneCls) continue;
    tiles++;
    const d = city.desirability[probe][i]!;
    sum += d;
    if (s.occupant[i] === 0 && d > best) {
      best = d;
      bestI = i;
    }
  }
  console.log(`probe ${probe}: ${city.census.population[probe]} pop, ${tiles} zone tiles, mean desirability ${(sum / Math.max(1, tiles)).toFixed(1)}, best empty ${best.toFixed(1)}`);
  if (bestI >= 0) {
    const q = city.query(bestI % n, Math.floor(bestI / n))!;
    console.log('  at', bestI % n, Math.floor(bestI / n), 'powered', q.powered, 'factors', JSON.stringify(q.desirability[probe]));
  }
}

// -spikes: time 60 more days one by one and show the slowest (month ends).
if (process.argv.includes('-spikes')) {
  const times: number[] = [];
  for (let d = 0; d < 60; d++) {
    const t = performance.now();
    city.step(1);
    times.push(performance.now() - t);
  }
  const sorted = [...times].sort((a, b) => b - a);
  console.log(`slowest days ms ${sorted.slice(0, 4).map((v) => v.toFixed(0)).join(' ')} · median ${sorted[30]!.toFixed(1)}`);
}
