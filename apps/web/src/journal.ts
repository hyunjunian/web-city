// The player's record of a city, kept in its save (the engine carries it untouched): the
// news (소식), what was done on each goal's screen, and the actions whose result is still
// to be told. A reload, an undo or another city brings its own.

import type { StructureKind } from '@web-city/engine';
import { type GoalId, GOALS } from './goals';
import { city } from './state';

/** A line of 소식: bad news (warn), worth noting but neither good nor bad (info), else good. */
export interface Notice { text: string; until: number; day?: number; warn?: boolean; info?: boolean; at?: [number, number]; goal?: GoalId; /** the goal's tab it opens on, by its view (a 쾌적도 result: the city's 쾌적도) */ view?: string; /** a reward or deal it offers, to take up from the news */ build?: StructureKind; /** a damage report: the rubble it left, cleared from the news */ rubble?: true }
export interface Done { goal: GoalId; day: number; text: string; key?: string; base?: string; n?: number }
export interface Pending { text: string; key?: string; count: number; day: number; label: string; value: string; n: number; better: number; /** a second figure told with it (transit's share beside the commute) */ also?: { label: string; value: string } }
/** The city's 쾌적도's slot for a result to tell, beside its money's: judged apart, by a figure of its own. */
export const AMENITY_SLOT = 'finance:amenity';
/** Where an action's result waits: its goal's slot, or the 쾌적도's. */
export type Slot = GoalId | typeof AMENITY_SLOT;
export interface Journal { notices: Notice[]; done: Done[]; pending: Partial<Record<Slot, Pending>> }

/** A goal a save may name that is no more, and where its screen went (부유층·고급화: the city's 쾌적도 tab). */
const MOVED: Record<string, GoalId> = { wealth: 'finance' };
/** Journals already brought up to the goals as they are. */
const current = new WeakSet<object>();

/** The open city's journal (made empty the first time it is asked for). */
export function journal(): Journal {
  const s = city.state as { journal?: Partial<Journal> };
  if (!s.journal || typeof s.journal !== 'object') s.journal = {};
  const j = s.journal;
  j.notices ??= [];
  j.done ??= [];
  j.pending ??= {};
  // (A save from before a goal went: its news and log name the screen it went into; a result still to tell is let go —
  // it was to be read against a figure the new screen doesn't keep. Unread, a link to it broke the news.)
  if (!current.has(j)) {
    current.add(j);
    const now = (g: string | undefined): GoalId | undefined => (!g ? undefined : g in GOALS ? (g as GoalId) : MOVED[g]);
    for (const n of j.notices) {
      // (부유층·고급화's news opens the tab it became: the city's 쾌적도.)
      if (n.goal === ('wealth' as GoalId)) n.view = 'desirability';
      if (n.goal) n.goal = now(n.goal);
    }
    j.done = j.done.filter((d) => !!(d.goal = now(d.goal)!));
    // (Unless its figure went with it: a park's from 부유층·고급화, from the old 환경·쾌적's 쾌적도 tab, or from the city's
    // before it had its own slot, is the 쾌적도's; a raise of the ground's from its 땅값 tab, 땅값's.)
    const pend = j.pending as Record<string, Pending | undefined>;
    const move = (from: string, label: string, to: Slot) => {
      if (pend[from]?.label !== label) return;
      pend[to] ??= pend[from];
      delete pend[from];
    };
    move('wealth', '부유층 주민', AMENITY_SLOT);
    move('environment', '부유층 주민', AMENITY_SLOT);
    move('environment', '평균 땅값', 'land');
    move('finance', '부유층 주민', AMENITY_SLOT);
    for (const k of Object.keys(pend)) if (!(k in GOALS) && k !== AMENITY_SLOT) delete pend[k];
  }
  return j as Journal;
}
