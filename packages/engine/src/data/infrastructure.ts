/** Reserve capacity planning target, not an enforced build limit. */
export const INFRASTRUCTURE_PLANNING = { reserveRatio: 0.1 } as const;

/** Half of equipment wear comes from elapsed time, half from throughput. Stored reserve equipment still weathers and needs replacement. */
export const CALENDAR_WEAR_SHARE = 0.5;
