// My Sims: what they approve of and complain about. Levels with no set
// number (medium pollution, nearby) are tuning values.

export const MY_SIMS = {
  /** Most My Sims a city can have at once (as in SimCity 4). */
  max: 5,
  /** Tiles counted as near the house for bus stops and marinas. */
  nearby: 6,
  /** A Nuclear Power Plant this close to home is something to complain about. */
  nuclearRadius: 20,
  /** Landmarks within this many tiles count as nearby; farther ones as too far. */
  landmarkRadius: 32,
  /** EQ / HQ (0–200) counted as high in a tract. */
  eqHigh: 100,
  hqHigh: 100,
  /** Air / water pollution counted as medium. */
  airMedium: 100,
  waterMedium: 100,
  /** Landfills under 25% full impress. */
  landfillFull: 0.25,
  /** Hospitals with three of five apples or better (effectiveness ≥ 0.6) are approved of. */
  goodGrade: 0.6,
} as const;
