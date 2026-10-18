// The player's record of a city, kept in its save (the engine carries it untouched): the
// news (소식), what was done on each goal's screen, and the actions whose result is still
// to be told. A reload, an undo or another city brings its own.

import type { StructureKind } from '@web-city/engine';
import { type GoalId, GOALS } from './goals';
import { city } from './state';

/** A line of 소식: bad news (warn), worth noting but neither good nor bad (info), else good. */
export interface Notice { text: string; until: number; day?: number; warn?: boolean; info?: boolean; at?: [number, number]; goal?: GoalId; /** a reward or deal it offers, to take up from the news */ build?: StructureKind; /** a damage report: the rubble it left, cleared from the news */ rubble?: true }
export interface Done { goal: GoalId; day: number; text: string; key?: string; base?: string; n?: number }
export interface Pending { text: string; key?: string; count: number; day: number; label: string; value: string; n: number; better: number; /** a second figure told with it (transit's share beside the commute) */ also?: { label: string; value: string } }
export interface Journal { notices: Notice[]; done: Done[]; pending: Partial<Record<GoalId, Pending>> }

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
    for (const n of j.notices) if (n.goal) n.goal = now(n.goal);
    j.done = j.done.filter((d) => !!(d.goal = now(d.goal)!));
    for (const k of Object.keys(j.pending)) if (!(k in GOALS)) delete (j.pending as Record<string, unknown>)[k];
  }
  return j as Journal;
}
