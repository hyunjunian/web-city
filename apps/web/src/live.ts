// Moving disasters steered with the pointer.

import { LIVE_KINDS } from '@web-city/engine';
import { DISASTER_NAME, LIVE_ICON } from './names';
import { updatePanels } from './panels';
import { city, redraw, renderer } from './state';
import { tool } from './tools';
import { $, flash } from './util';

/** The moving disaster being pulled by the pointer (its id), if any. */
export let steering: number | null = null;

export let disasterClock = 0;

/**
 * With the disaster tool on a tornado or robot: pressing sets one loose (or
 * grabs the one already going) and holding pulls it towards the pointer.
 */
export function grabDisaster(t: [number, number]): boolean {
  if (tool.kind !== 'disaster') return false;
  const kind = tool.disaster;
  if (!LIVE_KINDS.includes(kind)) return false;
  let live = city.state.liveDisasters.find((d) => d.kind === kind);
  if (!live) {
    const res = city.unleash(kind, t[0], t[1], Number($<HTMLInputElement>('#disaster-intensity').value) / 100);
    if (!('id' in res)) return false;
    live = res;
    flash(`${DISASTER_NAME[kind]}! 누른 채로 끌면 그쪽으로 끌려갑니다`);
  }
  steering = live.id;
  city.steerDisaster(live.id, t[0], t[1]);
  return true;
}

/** Real time: moving disasters take a step about eight times a second. */
export function tickDisasters(dt: number): void {
  if (!city.state.liveDisasters.length) return;
  disasterClock += dt;
  let steps = 0;
  while (disasterClock >= 0.12) {
    disasterClock -= 0.12;
    steps++;
  }
  if (steps) {
    city.advanceDisasters(steps);
    if (!city.state.liveDisasters.some((d) => d.id === steering)) steering = null;
    city.refreshIfDirty();
    updatePanels();
  }
  renderer.live = city.state.liveDisasters.map((d) => ({ x: d.x, y: d.y, icon: LIVE_ICON[d.kind]!, steer: d.steer }));
  redraw();
}

export function setSteering(v: typeof steering): void {
  steering = v;
}
