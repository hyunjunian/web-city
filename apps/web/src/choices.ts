// The player's choices that change the city without a map edit (taxes, loans, ordinances, deals, names): counted, so
// a city left unsaved since one of them still asks before it is closed (saves.ts). (No undo on the web screen: the
// snapshots it took before each edit, and its ↶ ↷ and keys, went with it.)

/** How many choices have been made (taxes, loans, names, My Sims…): they change the city without a map edit (see unsavedProgress). */
export let choicesMade = 0;

/** Makes a player's choice (`what` names it, for the reader) and counts it if it took: a setter, true, ok, or a
 *  result without ok. A refused one changed nothing: no progress to lose. */
export function choice<T>(_what: string, make: () => T): T {
  const res = make();
  const took = res === undefined || res === true || (typeof res === 'object' && res !== null && (!('ok' in res) || (res as { ok: boolean }).ok));
  if (took) choicesMade++;
  return res;
}
