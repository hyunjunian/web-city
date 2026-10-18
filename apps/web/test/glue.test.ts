import { describe, expect, it } from 'vitest';
import { glue } from '../src/util';

/** The word joiner glue puts in, shown as a visible mark. */
const shown = (t: string) => t.replace(/⁠/g, '+');

describe('Korean line breaks held together', () => {
  it('keeps a closing parenthesis with the particle after it, and an opening one with the word before it', () => {
    expect(shown(glue('상한(21,560명)에 닿았습니다'))).toBe('상한+(21,560명)+에 닿았습니다');
    expect(shown(glue('정원의 181%(81% 초과)인 학교'))).toBe('정원의 181%+(81% 초과)+인 학교');
  });
  it('keeps the halves of a 가·나 pair together, not a spaced list', () => {
    expect(shown(glue('병원·보건소가 있습니다'))).toBe('병원+·+보건소가 있습니다');
    // (A spaced list still breaks after its dot, never before it: the dot stays with the item it follows.)
    expect(glue('§130 · 월 §15')).toBe('§130\u00a0· 월 §15');
  });
  it('leaves code-like text alone and is safe to apply twice', () => {
    expect(glue('rgb(1,2,3)')).toBe('rgb(1,2,3)');
    const once = glue('주거 상한(4,000명)·수요 없음');
    expect(glue(once)).toBe(once);
  });
});
