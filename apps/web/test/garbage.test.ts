import { describe, expect, it } from 'vitest';
import { firstSentence, landfillMonths, landfillSpan } from '../src/util';

describe('landfill months', () => {
  const g = { kept: 0, produced: 1000, recycled: 200, incinerated: 0, landfilled: 800, landfillSpace: 8000 };
  it('counts the month’s rubbish after burning, not the backlog buried', () => {
    expect(landfillMonths(g)).toBe(10);
    expect(landfillMonths({ ...g, landfilled: 5000 })).toBe(10);
    expect(landfillMonths({ ...g, incinerated: 400 })).toBe(20);
  });
  it('lasts for ever while all of it is burnt, is spent once full, and is nothing with no landfill', () => {
    expect(landfillSpan(landfillMonths({ ...g, incinerated: 800, landfilled: 0 })!)).toBe('100년 넘게');
    expect(landfillMonths({ ...g, landfillSpace: 0 })).toBe(0);
    expect(landfillMonths({ ...g, landfillSpace: 0, landfilled: 0 })).toBeNull();
  });
});

describe('toast wording', () => {
  it('keeps the first sentence of an advisor\'s word', () => {
    expect(firstSentence('학교 선생님들이 파업 중입니다. 정원을 넘었거나(학교를 더 지으세요) 예산이 모자랍니다.')).toBe('학교 선생님들이 파업 중입니다.');
    expect(firstSentence('발전소 1곳이 소방서 반경 밖에 있습니다')).toBe('발전소 1곳이 소방서 반경 밖에 있습니다');
    expect(firstSentence('§1.5 대출이 있습니다. 갚으세요.')).toBe('§1.5 대출이 있습니다.');
  });
});
