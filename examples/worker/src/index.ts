// Cloudflare Worker running the web-city engine. The engine uses no Node or
// DOM APIs, so it imports straight into a Worker.
//
//   GET  /simulate?years=5&size=64&seed=1&difficulty=easy
//        → lays out a starter town, runs it and returns yearly stats.
//   POST /step?days=30   (body: a SavedCity JSON)
//        → advances a saved city and returns the new save plus stats.
//   POST /disaster?kind=meteor&x=20&y=20&intensity=0.5   (body: a SavedCity JSON)
//        → strikes the city and returns the damage report and the new save.
//   POST /act   (body: { save | city: { size, seed, difficulty }, actions: [{ op: 'zone', args: [1, 1, 10, 10, 'R-low'] }, …], days? })
//        → applies tool calls (a fixed list of City methods), optionally steps,
//          and returns each call's result, the stats and the new save.
//   /city/<name>…  → a long-lived city in a Durable Object (see room.ts).

import { City, DISASTER_KINDS, loadCity, saveCity, type Difficulty, type DisasterKind, type SavedCity } from '@web-city/engine';
import { ACTIONS, cityOptions, summary, type Action } from './actions';

export { CityRoom } from './room';

interface Env {
  /** Durable Object namespace for long-lived cities (see room.ts). */
  CITY: DurableObjectNamespace;
}

function starterTown(size: number, seed: number, difficulty: Difficulty): City {
  const city = new City({ size, seed, difficulty });
  const m = Math.floor(size / 2);
  city.buildNetwork(0, m - 8, size - 1, m - 8, 'road');
  city.buildNetwork(0, m + 8, size - 1, m + 8, 'road');
  city.zone(1, m - 20, size - 2, m - 9, 'R-low');
  city.zone(1, m - 7, size - 2, m - 4, 'C-low');
  city.zone(1, m - 3, size - 2, m + 7, 'R-medium');
  city.zone(1, m + 9, size - 2, m + 20, 'I-medium');
  // Zones conduct power to each other across gaps of up to four tiles.
  city.placeStructure('coalPlant', 1, m + 21);
  city.placeStructure('medicalClinic', 2, m - 21);
  city.placeStructure('elementarySchool', 8, m - 22);
  city.placeStructure('smallPoliceStation', 14, m - 22);
  city.placeStructure('smallFireStation', 20, m - 22);
  // Water lets buildings grow past stage 3; pipes water six tiles each way.
  for (const y of [m - 14, m + 2, m + 14]) city.buildPipe(1, y, size - 2, y);
  city.buildPipe(1, m - 14, 1, m + 14);
  // Pumps need power: next to the zones (which carry it) and on the pipes.
  city.placeStructure('waterPump', 2, m + 2);
  city.placeStructure('waterPump', size - 3, m + 2);
  return city;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Long-lived cities: one Durable Object per name.
    const room = /^\/city\/([\w-]{1,64})(\/|$)/.exec(url.pathname);
    if (room) return env.CITY.get(env.CITY.idFromName(room[1]!)).fetch(request);
    const num = (k: string, d: number, max: number) => Math.min(max, Math.max(1, Number(url.searchParams.get(k) ?? d) || d));

    if (url.pathname === '/simulate') {
      const size = num('size', 64, 128);
      const years = num('years', 5, 20);
      const difficulty = (url.searchParams.get('difficulty') ?? 'easy') as Difficulty;
      if (!['easy', 'medium', 'hard'].includes(difficulty)) return json({ error: 'difficulty must be easy, medium or hard' }, 400);
      const city = starterTown(size, num('seed', 1, 1e9), difficulty);
      const yearly = [];
      for (let y = 0; y < years; y++) {
        city.step(360);
        yearly.push(summary(city));
      }
      return json({ yearly });
    }

    if (url.pathname === '/step' && request.method === 'POST') {
      const saved = (await request.json()) as SavedCity;
      const city = loadCity(saved);
      city.step(num('days', 30, 3600));
      return json({ stats: summary(city), save: saveCity(city) });
    }

    if (url.pathname === '/disaster' && request.method === 'POST') {
      const kind = url.searchParams.get('kind') as DisasterKind;
      if (!DISASTER_KINDS.includes(kind)) return json({ error: `kind must be one of ${DISASTER_KINDS.join(', ')}` }, 400);
      const city = loadCity((await request.json()) as SavedCity);
      const at = (k: string) => Math.min(city.size - 1, Math.max(0, Number(url.searchParams.get(k) ?? city.size / 2) || 0));
      const report = city.disaster(kind, at('x'), at('y'), Number(url.searchParams.get('intensity') ?? 0.5));
      return json({ report, stats: summary(city), save: saveCity(city) });
    }

    if (url.pathname === '/act' && request.method === 'POST') {
      const body = (await request.json()) as {
        save?: SavedCity; city?: unknown;
        actions?: { op: string; args?: unknown[] }[]; days?: number;
      };
      // Continue a saved city, or found a new one.
      const city = body.save ? loadCity(body.save) : new City(cityOptions(body.city));
      const results: unknown[] = [];
      for (const a of (body.actions ?? []).slice(0, 500)) {
        if (!ACTIONS.includes(a.op as Action)) {
          results.push({ error: `unknown op ${a.op}` });
          continue;
        }
        const fn = city[a.op as Action] as (...args: unknown[]) => unknown;
        try {
          results.push(fn.apply(city, a.args ?? []) ?? null);
        } catch (e) {
          results.push({ error: String(e) });
        }
        city.refreshIfDirty();
      }
      if (body.days) city.step(Math.min(3600, Math.max(0, Math.floor(body.days))));
      return json({ results, stats: summary(city), save: saveCity(city) });
    }

    return json({
      routes: [
        'GET /simulate?years=5&size=64&seed=1&difficulty=easy', 'POST /step?days=30', 'POST /disaster?kind=meteor&x=20&y=20', 'POST /act',
        'POST /city/<name>', 'GET /city/<name>', 'POST /city/<name>/act', 'POST /city/<name>/pause', 'POST /city/<name>/resume',
      ],
      actions: ACTIONS,
    }, 404);
  },
};
