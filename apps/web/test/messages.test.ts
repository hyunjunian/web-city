import { describe, expect, it } from 'vitest';
import { ko } from '../src/messages';

/** Every literal tool message in the engine source (message: '…', no('…'), and sentence-like returned strings). */
function engineMessages(): string[] {
  // The engine's own source, read at build time (no Node APIs in tests either).
  const sources = import.meta.glob(['../../../packages/engine/src/city.ts', '../../../packages/engine/src/sim/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const found = new Set<string>();
  for (const src of Object.values(sources)) {
    for (const re of [/message: '([^'$]+)'/g, /no\('([^']+)'\)/g, /return '([a-z][^']* [^']*)';/g, /\? '([a-z][^']* [^']*)' : '([a-z][^']* [^']*)'/g, /message: "([^"$]+)"/g]) {
      for (const m of src.matchAll(re)) for (const g of m.slice(1)) if (g) found.add(g);
    }
  }
  return [...found];
}

describe('viewer wording', () => {
  it('every engine tool message has a Korean translation', () => {
    const all = engineMessages();
    expect(all.length).toBeGreaterThan(40); // the scan finds them
    const missing = all.filter((m) => ko(m) === m && !m.startsWith('unknown') && !m.includes('use disaster()'));
    expect(missing).toEqual([]);
  });
});

describe('advisor wording', () => {
  it('every advisor code the engine can say has Korean text', async () => {
    const { ADVICE_TEXT } = await import('../src/names');
    const src = Object.values(import.meta.glob('../../../packages/engine/src/sim/advisors.ts', { query: '?raw', import: 'default', eager: true }))[0] as string;
    const codes = [...src.matchAll(/say\('\w+', '\w+', '(\w+)'/g)].map((m) => m[1]!);
    expect(codes.length).toBeGreaterThan(20);
    // Built from a template: zone${c} for each zone class.
    codes.push('zoneR', 'zoneC', 'zoneI', 'zoneA');
    expect(codes.filter((c) => !ADVICE_TEXT[c])).toEqual([]);
  });
});
