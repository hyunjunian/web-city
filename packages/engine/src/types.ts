/** Wealth levels of Sims and of the jobs they fill. */
export type Wealth = 0 | 1 | 2;
export const WEALTHS: readonly Wealth[] = [0, 1, 2];
export const WEALTH_LABEL = ['$', '$$', '$$$'] as const;

/** Education level buckets used by business demand (EQ1–EQ4). */
export type EqLevel = 0 | 1 | 2 | 3;
export const EQ_LEVELS: readonly EqLevel[] = [0, 1, 2, 3];

/** The twelve SC4 developer types. */
export const DEV_TYPES = [
  'R$', 'R$$', 'R$$$',
  'Cs$', 'Cs$$', 'Cs$$$',
  'Co$$', 'Co$$$',
  'IA', 'ID', 'IM', 'IHT',
] as const;
export type DevType = (typeof DEV_TYPES)[number];

export const RES_TYPES = ['R$', 'R$$', 'R$$$'] as const satisfies readonly DevType[];
export const BUSINESS_TYPES = [
  'Cs$', 'Cs$$', 'Cs$$$', 'Co$$', 'Co$$$', 'IA', 'ID', 'IM', 'IHT',
] as const satisfies readonly DevType[];
export type ResType = (typeof RES_TYPES)[number];
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export type ZoneClass = 'R' | 'C' | 'I';
export type Density = 'low' | 'medium' | 'high';

export type PerType<T = number> = Record<DevType, T>;
export type PerWealth<T = number> = [T, T, T];

export function zoneClassOf(t: DevType): ZoneClass {
  return t[0] === 'R' ? 'R' : t[0] === 'C' ? 'C' : 'I';
}

export function isResidential(t: DevType): t is ResType {
  return t[0] === 'R';
}

export function perType<T>(f: (t: DevType) => T): PerType<T> {
  const out = {} as PerType<T>;
  for (const t of DEV_TYPES) out[t] = f(t);
  return out;
}
