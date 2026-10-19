import { describe, expect, it } from 'vitest';
import { City, type Building } from '../src';

function serviceCity(kind: 'health' | 'education', { smallBoost = 11.52, smallCapacity = 100, reverse = false } = {}): City {
  const city = new City({ size: 32, water: false, config: {
    safety: { fires: false }, disasters: { simulated: false }, mayor: { riots: false },
    services: { patientFraction: 1, studentFraction: 1, eduCurves: { elementary: [[0, 1], [100, 1]] } },
    structures: {
      largeMedicalCenter: { w: 1, h: 1, health: { radius: 8, capacity: 1_000 } },
      medicalClinic: { w: 1, h: 1, health: { radius: 8, capacity: smallCapacity, boost: smallBoost } },
      largeElementarySchool: { w: 1, h: 1, school: { radius: 8, capacity: 1_000 } },
      elementarySchool: { w: 1, h: 1, school: { radius: 8, capacity: smallCapacity } },
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
  it.each(['health', 'education'] as const)('uses spare %s capacity reachable from an overcrowded catchment', kind => {
    const city = serviceCity(kind, { smallCapacity: 1_000 });
    for (const st of city.state.structures.values()) {
      expect(st.load).toBeCloseTo(1_000, 6);
      expect(st.effectiveness).toBe(1);
    }
    const i = 10 * 32 + 16;
    expect(kind === 'health' ? city.fields.healthQuality[i] : city.fields.eduEff.elementary[i]).toBe(1);
  });

  it('conserves patients at the edge of coverage for even-sized residential lots', () => {
    const base = serviceCity('health');
    base.cfg.structures.medicalClinic.health!.radius = 6;
    base.cfg.structures.largeMedicalCenter.health!.radius = 6.2;
    const city = new City({ size: 32, water: false, config: base.cfg });
    city.state.funds = 1_000_000;
    city.buildNetwork(2, 9, 30, 9, 'road');
    expect(city.placeStructure('largeMedicalCenter', 21, 10).ok).toBe(true);
    expect(city.placeStructure('medicalClinic', 9, 10).ok).toBe(true);
    const id = city.state.nextId++;
    city.state.buildings.set(id, { ...base.state.buildings.values().next().value!, id, x: 14, w: 2, h: 2 });
    for (const y of [10, 11]) for (const x of [14, 15]) city.state.occupant[y * 32 + x] = id;
    const [large, small] = [...city.state.structures.values()];
    city.refresh();
    expect(small!.load).toBeCloseTo(1_000, 6);
    expect(large!.load).toBe(0);
  });

  it('redistributes pupils using their age-specific attendance rather than total residents', () => {
    const city = serviceCity('education', { smallCapacity: 500 });
    city.cfg.services.eduCurves.elementary = [[0, 0], [10, 1], [20, 0], [100, 0]];
    const [first, second] = [...city.state.buildings.values()];
    first!.age = 10;
    second!.age = 15;
    city.refresh();
    const [large, small] = [...city.state.structures.values()];
    expect(large!.load).toBeCloseTo(1_000, 6);
    expect(small!.load).toBeCloseTo(500, 6);
    expect(large!.effectiveness).toBe(1);
    expect(small!.effectiveness).toBe(1);
  });

  it('moves shared patients through a chain of catchments to reserve an exclusive hospital', () => {
    const base = serviceCity('health', { smallCapacity: 1_000 });
    const city = new City({ size: 32, water: false, config: base.cfg });
    city.state.funds = 1_000_000;
    city.buildNetwork(2, 9, 30, 9, 'road');
    for (const x of [4, 16, 28]) expect(city.placeStructure('medicalClinic', x, 10).ok).toBe(true);
    // The first shared group claims the left hospital before the exclusive
    // group: satisfying all three groups requires reassigning that first flow.
    for (const x of [10, 4, 22]) {
      const id = city.state.nextId++;
      city.state.buildings.set(id, { ...base.state.buildings.values().next().value!, id, x, y: 11 });
      city.state.occupant[11 * 32 + x] = id;
    }
    city.refresh();
    for (const st of city.state.structures.values()) {
      expect(st.load).toBeCloseTo(1_000, 6);
      expect(st.effectiveness).toBe(1);
    }
  });

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
    // Both facilities fill first. The remaining 900 shared patients or pupils
    // still contribute to overload, split in proportion to reachable capacity.
    expect(large!.load).toBeCloseTo(1_000 + 900 * 1_000 / 1_100, 4);
    expect(small!.load).toBeCloseTo(100 + 900 * 100 / 1_100, 4);
    expect(large!.load + small!.load).toBeCloseTo(2_000, 6);
    expect(large!.effectiveness).toBeCloseTo(0.55, 6);
    expect(small!.effectiveness).toBeCloseTo(0.55, 6);
    const expected = (large!.capacity * large!.effectiveness + small!.capacity * small!.effectiveness) / 1_100;
    const i = 10 * 32 + 16;
    expect(kind === 'health' ? city.fields.healthQuality[i] : city.fields.eduEff.elementary[i]).toBeCloseTo(expected, 5);
    if (kind === 'health') {
      expect(city.fields.hospitalCover[i]).toBeCloseTo(expected, 5);
      expect(city.fields.hqBoost[i]).toBeCloseTo(city.cfg.structures.medicalClinic.health!.boost * expected, 4);
    }
  });

  it.each(['health', 'education'] as const)('clears %s coverage after its last facility is removed', kind => {
    const city = serviceCity(kind);
    for (const st of [...city.state.structures.values()]) expect(city.bulldoze(st.x, st.y, st.x, st.y).ok).toBe(true);
    city.refreshIfDirty();
    const fields = kind === 'health' ? [city.fields.healthQuality, city.fields.hqBoost, city.fields.hospitalCover]
      : [city.fields.schoolQuality, ...Object.values(city.fields.eduEff)];
    for (const field of fields) expect(field.every(value => value === 0)).toBe(true);
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
