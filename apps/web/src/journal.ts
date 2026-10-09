// The player's record of a city, kept in its save (the engine carries it untouched): the
// news (소식), what was done on each goal's screen, and the actions whose result is still
// to be told. A reload, an undo or another city brings its own.

import { type GoalId } from './goals';
import { city } from './state';

/** A line of 소식: bad news (warn), worth noting but neither good nor bad (info), else good. */
export interface Notice { text: string; until: number; day?: number; warn?: boolean; info?: boolean; at?: [number, number]; goal?: GoalId }
export interface Done { goal: GoalId; day: number; text: string; key?: string; base?: string; n?: number }
export interface Pending { text: string; key?: string; count: number; day: number; label: string; value: string; n: number; better: number }
export interface Journal { notices: Notice[]; done: Done[]; pending: Partial<Record<GoalId, Pending>> }

/** The open city's journal (made empty the first time it is asked for). */
export function journal(): Journal {
  const s = city.state as { journal?: Partial<Journal> };
  if (!s.journal || typeof s.journal !== 'object') s.journal = {};
  const j = s.journal;
  j.notices ??= [];
  j.done ??= [];
  j.pending ??= {};
  return j as Journal;
}
