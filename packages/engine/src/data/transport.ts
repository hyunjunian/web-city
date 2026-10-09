// Transportation. Travel times are each mode's time to cross a tile, read
// as hours (see README) and stored in centi-hours (1 = 0.01 h), so the
// 2.5-hour trip limit is 250.

/** Per network: capacity (trips) and centi-hours per tile by mode; null = not allowed. */
export interface NetworkSpeed {
  capacity: number;
  car: number | null;
  bus: number | null;
  walk: number | null;
  train: number | null;
}

/** Avenue and Ground Highway rows from Rush Hour (speed ≈ 1.38 / kph). */
export const NETWORK_SPEED = {
  street: { capacity: 100, car: 5, bus: 3, walk: 27, train: null },
  road: { capacity: 1_000, car: 3, bus: 2, walk: 27, train: null },
  /** Rush Hour One-Way Road: 2,000 trips, Road speed. */
  oneway: { capacity: 2_000, car: 3, bus: 2, walk: 27, train: null },
  avenue: { capacity: 2_500, car: 3.5, bus: 2.3, walk: 27, train: null },
  highway: { capacity: 4_000, car: 1, bus: 1, walk: null, train: null },
  /** Onramps work as Highway tiles; only their costs differ. */
  onramp: { capacity: 4_000, car: 1, bus: 1, walk: null, train: null },
  rail: { capacity: 3_000, car: null, bus: null, walk: null, train: 1 },
  subway: { capacity: 3_000, car: null, bus: null, walk: null, train: 1 },
  /** Rush Hour: elevated rail 150 kph, monorail 200 kph. */
  elrail: { capacity: 2_000, car: null, bus: null, walk: null, train: 1 },
  monorail: { capacity: 2_000, car: null, bus: null, walk: null, train: 0.7 },
  /** Rush Hour ferries: 96 kph, 1,000 trips per route tile. */
  ferry: { capacity: 1_000, car: null, bus: null, walk: null, train: 1.5 },
} as const satisfies Record<string, NetworkSpeed>;

/**
 * Industry's freight time counts airports less than a connection or seaport:
 * reaching one costs this much more (centi-hours, half an hour; assumed).
 */
export const AIRPORT_FREIGHT_PENALTY = 50;

/** No trip may take longer than 2.5 hours. */
export const TRIP_LIMIT = 250;

/** Congestion vs. speed: −35% at 200% of capacity, −70% (cap) from 300%. */
export const CONGESTION = { slope: 0.35, max: 0.7 } as const;

/** Speed lost on an intersection tile, and one and two tiles either side of it. */
export const INTERSECTION_SLOWDOWN = [0.3, 0.2, 0.1] as const;

/**
 * Travel strategy odds by wealth (R$, R$$, R$$$): share of workers taking
 * mass transit, car only, or the fastest mix.
 */
export const STRATEGY_ODDS = [
  { transit: 0.8, car: 0.2, fastest: 0 },
  { transit: 0.3, car: 0, fastest: 0.7 },
  { transit: 0.1, car: 0.8, fastest: 0.1 },
] as const;

/**
 * Transit-strategy Sims weigh car legs this much heavier (assumed; they keep
 * to transit even when the trip then takes too long). With slow walks to and
 * from stops, 2 left buses all but empty (4% of an 86k city's commuters with
 * a stop every six tiles); 3 gives 15%, while heavier still makes them walk
 * whole trips.
 */
export const TRANSIT_CAR_BIAS = 3;

/** Mass transit fares: §0.001 per tile ridden, each way (trips are once a month here). */
export const FARE_PER_TILE = 0.001;
/** Ferries: §0.01 a trip (Rush Hour). */
export const FERRY_FARE = 0.01;

/** Presumed time to a job reached through a neighbour connection (deliberately high). */
export const CONNECTION_COMMUTE = 150;

/**
 * Potholes (more with deeper underfunding; +0.1 per damaged tile).
 * Monthly chance a tile cracks at funding f < 1: damage × (1 − f); a cracked
 * tile is fixed with chance repair × f (any funding above 0; faster overfunded).
 */
export const POTHOLES = { damage: 0.05, repair: 0.25, penalty: 10 } as const;

/** Toll booths (Rush Hour): 60% of the road's capacity, a 0.2-hour stop, §0.10 a car. */
export const TOLL = { capacity: 0.6, wait: 20, fare: 0.1, cost: 200, upkeep: 10 } as const;

/**
 * A street, road or avenue carried over a Ground Highway costs extra (amount
 * assumed: half an Overpass Onramp's §1,000), on top of the road itself.
 */
export const ROAD_OVERPASS = { cost: 500 } as const;

/**
 * Freight vehicles on the road (or rail) a day per filled industrial job:
 * trucks add to road traffic and freight rail to rail traffic (rate assumed:
 * a truck per four jobs). Separate from the trips that reach a connection
 * for demand-cap relief.
 */
export const FREIGHT_TRAFFIC_PER_JOB = 0.25;

/** Cloverleaf: §3,000 and §26 a month. */
export const CLOVERLEAF = { cost: 3_000, upkeep: 26 } as const;

/**
 * Subway-to-Elevated Transition (Rush Hour): the piece that ties subway and
 * elevated rail together. The price is assumed, matching a few tiles of track.
 */
export const SUBWAY_TRANSITION = { cost: 250, upkeep: 5 } as const;

/**
 * Tunnels: roads, rail and highways climbing slopes steeper than
 * 45° (16 m over a 16 m tile) go through the hill instead, until the ground
 * comes back to their height. Pedestrians can't enter. Cost is a tuning value.
 */
export const TUNNEL = { grade: 16, costMult: 4 } as const;
