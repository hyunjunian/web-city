/** Copies plain save data, including nested arrays, without sharing mutable values. */
export function copyData<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => copyData(v)) as T;
  if (value === null || typeof value !== 'object') return value;
  // Spreading first keeps a JSON key named __proto__ an ordinary own property.
  const out = { ...value } as Record<string, unknown>;
  for (const key of Object.keys(out)) out[key] = copyData(out[key]);
  return out as T;
}
