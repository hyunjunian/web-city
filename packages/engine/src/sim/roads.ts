// Road maintenance: underfunding cracks asphalt,
// mending follows funding (none at 0%, faster when overfunded).

import type { SimConfig } from '../config';
import type { Rng } from '../rng';
import { ELEVATED, isAsphalt, type CityState } from './state';

export function updatePotholes(s: CityState, cfg: SimConfig, rng: Rng): void {
  const p = cfg.transport.potholes;
  const f = s.departments.roads / 100;
  const crack = f < 1 ? p.damage * (1 - f) : 0;
  // Crews mend in proportion to funding, so damage settles at a level set by it (less funding, more
  // potholes; none mended below 100% left every tile cracked in the end, even at 99%).
  const fix = Math.min(1, p.repair * f);
  for (let i = 0; i < s.net.length; i++) {
    // Elevated highways crack too (highway tiles get potholes like roads and streets); over a road, the road's flag is the one kept.
    if (!isAsphalt(s.net[i]!) && s.elevated[i] !== ELEVATED.highway) {
      s.potholes[i] = 0;
      continue;
    }
    if (s.potholes[i]) {
      if (fix && rng.next() < fix) s.potholes[i] = 0;
    } else if (crack && rng.next() < crack) s.potholes[i] = 1;
  }
}
