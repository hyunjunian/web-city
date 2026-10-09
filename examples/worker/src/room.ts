// A city that lives in a Durable Object: its save is kept in the object's
// storage, requests act on it, and an alarm keeps the clock running (a month
// of game time a minute) whether or not anyone is connected.
//
//   POST /city/<name>          (body: { size?, seed?, difficulty?, water? }) → founds the city
//   GET  /city/<name>          → stats
//   POST /city/<name>/act      (body: { actions: [{ op, args }], days? }) → results and stats
//   POST /city/<name>/pause    · POST /city/<name>/resume

import { City, loadCity, saveCity, type SavedCity } from '@web-city/engine';
import { ACTIONS, cityOptions, summary, type Action } from './actions';

/** Stored values are size-limited, so the save is split into chunks. */
const CHUNK = 100_000;
/** Game time the alarm advances, and how often (env TICK_SECONDS overrides the minute). */
const DAYS_PER_TICK = 30;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export class CityRoom implements DurableObject {
  private city: City | null = null;
  private readonly tickMs: number;

  constructor(private readonly state: DurableObjectState, env: { TICK_SECONDS?: string }) {
    this.tickMs = Math.max(1, Number(env.TICK_SECONDS ?? 60) || 60) * 1000;
  }

  private async load(): Promise<City | null> {
    if (this.city) return this.city;
    const parts = (await this.state.storage.get<number>('chunks')) ?? 0;
    if (!parts) return null;
    const keys = Array.from({ length: parts }, (_, k) => `save:${k}`);
    const got = await this.state.storage.get<string>(keys);
    const text = keys.map((k) => got.get(k) ?? '').join('');
    this.city = loadCity(JSON.parse(text) as SavedCity);
    return this.city;
  }

  private async store(city: City): Promise<void> {
    const text = JSON.stringify(saveCity(city));
    const entries: Record<string, unknown> = { chunks: Math.ceil(text.length / CHUNK) };
    for (let k = 0; k * CHUNK < text.length; k++) entries[`save:${k}`] = text.slice(k * CHUNK, (k + 1) * CHUNK);
    await this.state.storage.put(entries);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.split('/')[3] ?? '';
    if (request.method === 'POST' && action === '') {
      this.city = new City(cityOptions(await request.json().catch(() => ({}))));
      await this.store(this.city);
      await this.state.storage.put('running', true);
      await this.state.storage.setAlarm(Date.now() + this.tickMs);
      return json({ founded: true, stats: summary(this.city) }, 201);
    }
    const city = await this.load();
    if (!city) return json({ error: 'no city here yet: POST to found one' }, 404);
    if (request.method === 'GET' && action === '') return json({ stats: summary(city), running: (await this.state.storage.get('running')) ?? false });
    if (request.method === 'POST' && action === 'act') {
      const body = (await request.json()) as { actions?: { op: string; args?: unknown[] }[]; days?: number };
      const results: unknown[] = [];
      for (const a of (body.actions ?? []).slice(0, 500)) {
        if (!ACTIONS.includes(a.op as Action)) {
          results.push({ error: `unknown op ${a.op}` });
          continue;
        }
        try {
          results.push((city[a.op as Action] as (...args: unknown[]) => unknown).apply(city, a.args ?? []) ?? null);
        } catch (e) {
          results.push({ error: String(e) });
        }
        city.refreshIfDirty();
      }
      if (body.days) city.step(Math.min(3600, Math.max(0, Math.floor(body.days))));
      await this.store(city);
      return json({ results, stats: summary(city) });
    }
    if (request.method === 'POST' && (action === 'pause' || action === 'resume')) {
      const running = action === 'resume';
      await this.state.storage.put('running', running);
      if (running) await this.state.storage.setAlarm(Date.now() + this.tickMs);
      else await this.state.storage.deleteAlarm();
      return json({ running });
    }
    return json({ error: 'unknown route' }, 404);
  }

  /** The clock: a month of game time, saved, and the next tick scheduled. */
  async alarm(): Promise<void> {
    if (!(await this.state.storage.get('running'))) return;
    const city = await this.load();
    if (!city) return;
    city.step(DAYS_PER_TICK);
    await this.store(city);
    await this.state.storage.setAlarm(Date.now() + this.tickMs);
  }
}
