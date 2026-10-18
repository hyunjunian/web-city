// The player's record of a city, kept in its save (the engine carries it untouched): the
// news (소식), what was done on each goal's screen, and the actions whose result is still
// to be told. A reload, an undo or another city brings its own.

import type { StructureKind } from '@web-city/engine';
import { type GoalId, GOALS, goalOfStructure } from './goals';
import { STRUCTURE_NAME } from './names';
import { city } from './state';

/** A line of 소식: bad news (warn), worth noting but neither good nor bad (info), else good. */
export interface Notice { text: string; until: number; day?: number; warn?: boolean; info?: boolean; at?: [number, number]; goal?: GoalId; /** the goal's tab it opens on, by its view (a 쾌적도 result: its own tab) */ view?: string; /** a reward or deal it offers, to take up from the news */ build?: StructureKind; /** a damage report: the rubble it left, cleared from the news */ rubble?: true }
export interface Done { goal: GoalId; day: number; text: string; key?: string; base?: string; n?: number }
export interface Pending { text: string; key?: string; count: number; day: number; label: string; value: string; n: number; better: number; /** a second figure told with it (transit's share beside the commute) */ also?: { label: string; value: string } }
export interface Journal { notices: Notice[]; done: Done[]; pending: Partial<Record<GoalId, Pending>> }

/** A goal a save may name that is no more, and where its screen went (부유층·고급화: 쾌적도's own tab). */
const MOVED: Record<string, GoalId> = { wealth: 'amenity' };
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
      // (부유층·고급화's news opens the tab it became: 쾌적도's own.)
      if (n.goal === ('wealth' as GoalId)) n.view = 'desirability';
      // (And the city's 쾌적도 tab's results, from before it was 쾌적도's.)
      if (n.goal === 'finance' && n.view === 'desirability') n.goal = 'amenity';
      if (n.goal) n.goal = now(n.goal);
    }
    j.done = j.done.filter((d) => !!(d.goal = now(d.goal)!));
    // (And the city's 쾌적도 tab's log, from before it was 쾌적도's: a park, landmark or reward built there or the road
    // laid to one, and what it came to three months on — the rich it drew. Left under 재정, they read as the money's.)
    const ours = new Set(Object.entries(STRUCTURE_NAME).filter(([k]) => goalOfStructure(k as StructureKind) === 'amenity').map(([, name]) => name));
    for (const d of j.done) {
      if (d.goal !== 'finance') continue;
      const what = (d.base ?? d.text).split(' · ')[0]!;
      if (d.key === 'result' ? d.text.includes('부유층 주민') : ours.has(what) || /^도로 [\d,]+칸$/.test(what)) d.goal = 'amenity';
    }
    // (Unless its figure went with it: a park's from 부유층·고급화, from the old 환경·쾌적's 쾌적도 tab, or from the city's
    // 쾌적도 tab — its own slot there, or the money's before it had one — is 쾌적도's; a raise of the ground's from its
    // 땅값 tab, 땅값's.)
    const pend = j.pending as Record<string, Pending | undefined>;
    const move = (from: string, label: string | null, to: GoalId) => {
      if (!pend[from] || (label !== null && pend[from]!.label !== label)) return;
      pend[to] ??= pend[from];
      delete pend[from];
    };
    move('wealth', '부유층 주민', 'amenity');
    move('environment', '부유층 주민', 'amenity');
    move('environment', '평균 땅값', 'land');
    move('finance:amenity', null, 'amenity');
    move('finance', '부유층 주민', 'amenity');
    for (const k of Object.keys(pend)) if (!(k in GOALS)) delete pend[k];
  }
  return j as Journal;
}
