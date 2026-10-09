import { City, STRUCTURES } from '@web-city/engine';
import { describe, expect, it } from 'vitest';
import { buildingRisk, coverageRadius, overlayReading } from '../src/views';

describe('coverage circles', () => {
  it('police, fire, health and school facilities have a radius; parks and plants none', () => {
    const police = Object.keys(STRUCTURES).find((k) => STRUCTURES[k as keyof typeof STRUCTURES].police?.radius) as keyof typeof STRUCTURES;
    expect(coverageRadius(police)).toBe(STRUCTURES[police].police!.radius);
    expect(coverageRadius('coalPlant')).toBe(0);
    for (const k of Object.keys(STRUCTURES) as (keyof typeof STRUCTURES)[]) {
      const r = coverageRadius(k);
      expect(r === 0 || (r > 0 && r < 200)).toBe(true); // citywide services draw no circle
    }
  });
});

describe('abandonment risk', () => {
  it('names each countdown that has started', () => {
    const none = { noPowerMonths: 0, noWaterMonths: 0, noRoadMonths: 0, noJobMonths: 0, distressMonths: 0 };
    expect(buildingRisk(none)).toBe('');
    expect(buildingRisk({ ...none, noPowerMonths: 2, noJobMonths: 4 })).toBe('전기 2개월 · 일자리 못 구함 4개월');
  });
});

describe('data view readings', () => {
  it('reads a value for every view without throwing', () => {
    const city = new City({ size: 32, seed: 2, water: false });
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.zone(2, 6, 20, 9, 'R-low');
    const kinds = ['none', 'landValue', 'air', 'police', 'crime', 'fire', 'flammability', 'mayor', 'garbage', 'waterPollution',
      'waterService', 'power', 'health', 'school', 'hq', 'eq', 'age', 'commute', 'zones', 'growth', 'radiation', 'traffic', 'subway'] as const;
    for (const kind of kinds) for (const [x, y] of [[5, 10], [5, 8], [30, 30]] as const) expect(typeof overlayReading(city, { kind }, x, y)).toBe('string');
    // An empty zone tile (not an auto street): no plant anywhere yet.
    let at: [number, number] = [0, 0];
    for (let y = 6; y <= 9; y++) for (let x = 2; x <= 20; x++) if (city.growthBlockers(x, y)) at = [x, y];
    expect(overlayReading(city, { kind: 'power' }, ...at)).toBe('전기 없음');
    expect(overlayReading(city, { kind: 'growth' }, ...at)).toBe('전기 없음');
    expect(overlayReading(city, { kind: 'desirability', type: 'R$' }, ...at)).toMatch(/^주거 저소득 쾌적도 -?\d+$/);
  });
});

describe('Korean particles', async () => {
  const { josa } = await import('../src/util');
  it('follow the last syllable', () => {
    expect(josa('예시 도시', '을', '를')).toBe('를');
    expect(josa('경찰서', '을', '를')).toBe('를');
    expect(josa('대형 공원', '을', '를')).toBe('을');
    expect(josa('김민준', '이', '가')).toBe('이');
    expect(josa('서울', '으로', '로')).toBe('로'); // ㄹ
    expect(josa('한강', '으로', '로')).toBe('으로');
    expect(josa('New City', '을', '를')).toBe('을(를)');
    expect(josa('City 3', '으로', '로')).toBe('(으)로');
  });
});
