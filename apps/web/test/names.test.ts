import { City, GROWTH_CODES } from '@web-city/engine';
import { describe, expect, it } from 'vitest';
import { ADVICE_TEXT, ADVICE_TOOL, GROWTH_FIX } from '../src/names';
import { escapeHtml, josa, pct, short } from '../src/util';
import { overlayReading } from '../src/views';
import advisorsSource from '../../../packages/engine/src/sim/advisors.ts?raw';
import toolsSource from '../src/tools.ts?raw';

/** Every advisor code the engine can say, read from its source: `say(advisor, level, code…)`. */
function adviceCodes(): string[] {
  const src = advisorsSource;
  const codes = new Set<string>();
  for (const m of src.matchAll(/say\(\s*'[^']+',\s*'[^']+',\s*([^;]*?)(?:,\s*[^,]*)?\);/g)) {
    for (const lit of m[1]!.matchAll(/'([a-zA-Z]+)'/g)) codes.add(lit[1]!);
  }
  for (const lit of src.matchAll(/\['(cap[A-Za-z]+)'/g)) codes.add(lit[1]!);
  for (const c of ['R', 'C', 'I', 'A']) codes.add(`zone${c}`);
  return [...codes];
}

/** Tool ids in the web app's tool list. */
const toolIds = () => new Set([...toolsSource.matchAll(/id: '([A-Za-z-]+)'/g)].map((m) => m[1]!));

describe('advisor wording', () => {
  it('has Korean text for every advisor code the engine says', () => {
    const codes = adviceCodes();
    expect(codes.length).toBeGreaterThan(30);
    for (const code of codes) expect(ADVICE_TEXT[code], code).toBeTypeOf('function');
  });

  it('fix buttons point at tools that exist', () => {
    const ids = toolIds();
    for (const [code, [tool]] of Object.entries(ADVICE_TOOL)) {
      expect(ADVICE_TEXT[code], code).toBeTypeOf('function');
      expect(ids.has(tool.split(':')[0]!), `${code} → ${tool}`).toBe(true); // 'tool:kind' names a facility too
    }
    for (const [code, fix] of Object.entries(GROWTH_FIX)) {
      expect((GROWTH_CODES as readonly string[]).includes(code) || code === 'waterCap', code).toBe(true);
      expect(ids.has(fix![0]), `${code} → ${fix![0]}`).toBe(true);
    }
    expect(ids.has('park')).toBe(true); // a capped residential class gets parks
  });
});

describe('player-given names in HTML', () => {
  it('are escaped for text and attributes alike', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(escapeHtml("Bo's & Co")).toBe('Bo&#39;s &amp; Co');
  });
});

describe('formatting', () => {
  it('picks the particle by the last syllable', () => {
    expect(josa('도시', '을', '를')).toBe('를');
    expect(josa('공원', '을', '를')).toBe('을');
  });
  it('shortens and rounds', () => {
    expect(short(950)).toBe('950');
    expect(short(9_500)).toBe('9.5k');
    expect(short(23_473)).toBe('23k');
    expect(pct(0.374)).toBe('37%');
  });
});

describe('data view readings off the map', () => {
  it('read nothing past an edge (and never the next row)', () => {
    const city = new City({ size: 32, seed: 2, water: false });
    city.buildNetwork(0, 10, 31, 10, 'road');
    for (const [x, y] of [[-1, 10], [32, 10], [5, 32], [5, -1]] as const) {
      for (const kind of ['traffic', 'radiation', 'landValue'] as const) expect(overlayReading(city, { kind }, x, y)).toBe('');
    }
  });
});
