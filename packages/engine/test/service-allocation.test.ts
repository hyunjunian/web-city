import { describe, expect, it } from 'vitest';
import { City, type Building } from '../src';

function serviceCity(kind: 'health' | 'education', { smallBoost = 11.52, reverse = false } = {}): City {
  const city = new City({ size: 32, water: false, config: {
    safety: { fires: false }, disasters: { simulated: false }, mayor: { riots: false },
    services: { patientFraction: 1, studentFraction: 1, eduCurves: { elementary: [[0, 1], [100, 1]] } },
    structures: {
      largeMedicalCenter: { w: 1, h: 1, health: { radius: 8, capacity: 1_000 } },
      medicalClinic: { w: 1, h: 1, health: { radius: 8, capacity: 100, boost: smallBoost } },
      largeElementarySchool: { w: 1, h: 1, school: { radius: 8, capacity: 1_000 } },
      elementarySchool: { w: 1, h: 1, school: { radius: 8, capacity: 100 } },
    },
  } });
  city.state.funds = 1_000_000;
  city.state.unlocked.push('largeElementarySchool');
  city.buildNetwork(2, 9, 27, 9, 'road');
  const sites = [
    { kind: kind === 'health' ? 'largeMedicalCenter' : 'largeElementarySchool', x: 10 },
    { kind: kind === 'health' ? 'medicalClinic' : 'elementarySchool', x: 22 },
  ] as const;
  for (const site of reverse ? [...sites].reverse() : sites) expect(city.placeStructure(site.kind, site.x, 10).ok).toBe(true);
  for (const x of [6, 16]) {
    const id = city.state.nextId++;
    const b: Building = { id, x, y: 10, w: 1, h: 1, stage: 1, origType: 'R$', type: 'R$', capacity: 1_000,
      occupancy: 1, filled: 0, distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true,
      noWaterMonths: 0, watered: true, age: 30, eq: 70, hq: 70, abandonReason: null, builtDay: 0,
      commute: -1, noJobMonths: 0, historical: false };
    city.state.buildings.set(id, b);
    city.state.occupant[10 * 32 + x] = id;
  }
  city.refresh();
  return city;
}

describe('capacity-weighted public services', () => {
  it('combines different medical boosts without depending on facility insertion order', () => {
    const city = serviceCity('health', { smallBoost: 5 });
    const [large, small] = [...city.state.structures.values()];
    const expected = (large!.capacity * large!.effectiveness * city.cfg.structures.largeMedicalCenter.health!.boost
      + small!.capacity * small!.effectiveness * 5) / 1_100;
    const i = 10 * 32 + 16;
    expect(city.fields.hqBoost[i]).toBeCloseTo(expected, 4);
    const reversed = serviceCity('health', { smallBoost: 5, reverse: true });
    expect(reversed.fields.hqBoost).toEqual(city.fields.hqBoost);
    expect(reversed.fields.healthQuality).toEqual(city.fields.healthQuality);
  });

  it.each(['health', 'education'] as const)('weights %s quality by the share of patients or pupils each facility serves', kind => {
    const city = serviceCity(kind), [large, small] = [...city.state.structures.values()];
    expect(large!.load).toBeCloseTo(1_000 + 1_000 * 1_000 / 1_100, 4);
    expect(small!.load).toBeCloseTo(1_000 * 100 / 1_100, 4);
    const expected = (large!.capacity * large!.effectiveness + small!.capacity * small!.effectiveness) / 1_100;
    const i = 10 * 32 + 16;
    expect(kind === 'health' ? city.fields.healthQuality[i] : city.fields.eduEff.elementary[i]).toBeCloseTo(expected, 5);
    if (kind === 'health') {
      expect(city.fields.hospitalCover[i]).toBeCloseTo(expected, 5);
      expect(city.fields.hqBoost[i]).toBeCloseTo(city.cfg.structures.medicalClinic.health!.boost * expected, 4);
    }
  });

  it.each(['health', 'education'] as const)('keeps %s quality finite and absent when every facility is unfunded', kind => {
    const city = serviceCity(kind);
    for (const st of city.state.structures.values()) city.setFunding(st.id, 0);
    city.refreshIfDirty();
    const i = 10 * 32 + 16;
    expect(kind === 'health' ? city.fields.healthQuality[i] : city.fields.eduEff.elementary[i]).toBe(0);
    expect([...city.state.structures.values()].every(st => Number.isFinite(st.load))).toBe(true);
  });
});
