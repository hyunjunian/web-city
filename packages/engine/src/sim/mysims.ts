// My Sims: residents you follow. At home they think about local
// conditions (health, education, crime, pollution), their commute, transit
// stops, landmarks and nuclear plants nearby; sent somewhere, they give
// their opinion of the place. Approval is green, disapproval red.

import type { SimConfig } from '../config';
import { buildingAccess, type Fields } from './fields';
import { LANDFILL_ZONE } from './garbage';
import { mayorAt, ordinanceEffects, taxMoodFor } from './mayor';
import { facilityJobs, type Building, type CityState, type MySim, type Rect, type Structure } from './state';
import { Mode, tripTo } from './transport';

export type ThoughtSubject =
  | 'health' | 'education' | 'crime' | 'pollution' | 'commute' | 'bus' | 'transit' | 'landmark' | 'sailboat' | 'rat'
  | 'airport' | 'farm' | 'jail' | 'landfill' | 'park' | 'recycling' | 'reward' | 'shop' | 'restaurant' | 'hotel' | 'car' | 'friend';

export interface Thought {
  subject: ThoughtSubject;
  approve: boolean;
}

const centre = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];
const dist = (a: Rect, b: Rect): number => {
  const [ax, ay] = centre(a);
  const [bx, by] = centre(b);
  return Math.hypot(ax - bx, ay - by);
};

/** The workplace a My Sim was given, if it still stands. */
export function jobOf(s: CityState, sim: MySim): Building | Structure | undefined {
  return sim.job > 0 ? s.buildings.get(sim.job) : sim.job < 0 ? s.structures.get(-sim.job) : undefined;
}

/** A small deterministic coin for the opinions left to chance. */
function coin(s: CityState, sim: MySim, x: number, y: number): boolean {
  let h = (s.day * 73_856_093) ^ (x * 19_349_663) ^ (y * 83_492_791) ^ (sim.id * 2_654_435_761);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 13)) & 1) === 1;
}

/** Local conditions at a tile: crime, pollution, education and health coverage. */
function localConditions(s: CityState, f: Fields, cfg: SimConfig, i: number): Thought[] {
  const m = cfg.mySims;
  return [
    { subject: 'health', approve: f.healthQuality[i]! > 0 },
    { subject: 'education', approve: f.schoolQuality[i]! > 0 },
    { subject: 'crime', approve: s.crime[i]! < 1 },
    { subject: 'pollution', approve: f.air[i]! < m.airMedium && f.waterPollution[i]! < m.waterMedium },
  ];
}

/** What a My Sim thinks about at home. */
export function thoughtsAtHome(s: CityState, f: Fields, cfg: SimConfig, sim: MySim): Thought[] {
  const home = s.buildings.get(sim.home);
  if (!home?.type) return [];
  const m = cfg.mySims;
  const n = s.size;
  const i = Math.floor(home.y + home.h / 2) * n + Math.floor(home.x + home.w / 2);
  const mr = mayorAt(s, f, cfg, i, sim.wealth, home.age, taxMoodFor(s, cfg, sim.wealth), ordinanceEffects(s).mayorRating);
  const out: Thought[] = [
    { subject: 'health', approve: home.hq >= m.hqHigh },
    { subject: 'education', approve: home.eq >= m.eqHigh },
    { subject: 'crime', approve: mr.crime >= 0 },
    { subject: 'pollution', approve: mr.air + mr.water >= 0 },
  ];
  const trip = commute(s, f, cfg, sim);
  if (trip) out.push({ subject: trip.transit ? 'transit' : 'commute', approve: trip.time >= 0 && trip.time <= (cfg.desirability.tripShort + cfg.desirability.tripLong) / 2 });
  let landmarks = 0;
  let nearLandmark = false;
  let marina: boolean | null = null;
  for (const st of s.structures.values()) {
    const def = cfg.structures[st.kind];
    const d = dist(home, st);
    // Bus stops: wealthy Sims don't want one by the house; others do.
    if (def.station?.mode === 'bus' && d <= m.nearby + Math.max(home.w, home.h) / 2) out.push({ subject: 'bus', approve: sim.wealth < 2 });
    if (def.plant && st.kind === 'nuclearPlant' && d <= m.nuclearRadius) out.push({ subject: 'rat', approve: false });
    if (def.category === 'landmark') {
      landmarks++;
      if (d <= m.landmarkRadius) nearLandmark = true;
    }
    if (st.kind === 'marina') marina = marina || d <= m.nearby; // (a marina close to home)
  }
  if (landmarks) out.push({ subject: 'landmark', approve: nearLandmark });
  if (marina !== null) out.push({ subject: 'sailboat', approve: marina });
  return out;
}

/** The Sim's commute: to the job you gave them, else their household's trip to the nearest job. */
export function commute(s: CityState, f: Fields, cfg: SimConfig, sim: MySim): { time: number; transit: boolean } | null {
  const home = s.buildings.get(sim.home);
  if (!home) return null;
  const job = jobOf(s, sim);
  if (job && 'kind' in job && facilityJobs(cfg.structures[job.kind], job)[sim.wealth] <= 0) return { time: -1, transit: false };
  if (!job) return home.commute >= 0 || home.noJobMonths > 0 ? { time: home.commute, transit: false } : null;
  const a = buildingAccess(s, f, home);
  if (a.road < 0) return { time: -1, transit: false };
  const trip = tripTo(s, f, cfg, a.road, job);
  if (!trip) return { time: -1, transit: false };
  const transit = trip.modes.some((md) => md !== Mode.Walk && md !== Mode.Car && md !== Mode.HighCar && md !== Mode.CarFerry);
  return { time: trip.time + a.dist * cfg.transport.speed.street.car, transit };
}

/** A My Sim's opinion of the place at (x, y) (My Sims Dispatch). */
export function thoughtsAt(s: CityState, f: Fields, cfg: SimConfig, sim: MySim, x: number, y: number, stats: {
  hospitalGrade: (st: Structure) => number; uncollected: number;
}): Thought[] {
  const m = cfg.mySims;
  const n = s.size;
  const i = y * n + x;
  const occ = s.occupant[i]!;
  const random = (subject: ThoughtSubject): Thought[] => [{ subject, approve: coin(s, sim, x, y) }];
  if (occ < 0) {
    const st = s.structures.get(-occ)!;
    const def = cfg.structures[st.kind];
    if (def.airport) return [{ subject: 'airport', approve: true }];
    if (st.kind === 'nuclearPlant' || st.kind === 'toxicWasteDump') return [{ subject: 'rat', approve: false }];
    if (def.health) return [{ subject: 'health', approve: stats.hospitalGrade(st) >= m.goodGrade }];
    if (def.police?.cells && def.police.radius === 0) return [{ subject: 'jail', approve: st.load < st.capacity }];
    if (def.recycling) return [{ subject: 'recycling', approve: stats.uncollected <= 0 }];
    if (def.seaport || def.station?.mode === 'ferry' || def.station?.mode === 'carFerry' || st.kind === 'marina') {
      return [{ subject: 'sailboat', approve: f.waterPollution[i]! < m.waterMedium }];
    }
    if (def.category === 'park') return [{ subject: 'park', approve: f.air[i]! < m.airMedium }];
    if (def.category === 'landmark') return random('landmark');
    if (def.category === 'reward') return random('reward');
  } else if (occ > 0) {
    const b = s.buildings.get(occ)!;
    if (b.type === 'IA') return [{ subject: 'farm', approve: f.air[i]! < m.airMedium }];
    if (b.type?.startsWith('Cs')) {
      const kinds: ThoughtSubject[] = ['shop', 'restaurant', 'hotel', 'car'];
      return random(kinds[(b.id * 7 + x) % kinds.length]!);
    }
    if (b.type?.[0] === 'R') return [...random('friend'), ...localConditions(s, f, cfg, i)];
  } else if (s.zone[i] === LANDFILL_ZONE) {
    // How full the landfill is, all of it (approved below a quarter full), not the tile picked.
    let used = 0;
    let tiles = 0;
    for (let j = 0; j < s.zone.length; j++) if (s.zone[j] === LANDFILL_ZONE) { used += s.landfill[j]!; tiles++; }
    return [{ subject: 'landfill', approve: used / Math.max(1, tiles * cfg.garbage.landfill.tileCapacity) < m.landfillFull }];
  }
  return localConditions(s, f, cfg, i);
}
