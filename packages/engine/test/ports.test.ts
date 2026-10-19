import { expect, it } from 'vitest';
import { City } from '../src';

it('removes a closed port from freight destinations and brings it back without redrawing roads', () => {
  const city = new City({ size: 32, water: false, config: { structures: { internationalPort: { w: 2, h: 1 } } } });
  city.state.funds = 1_000_000;
  city.terraform(28, 0, 31, 31, 'water');
  city.buildNetwork(2, 9, 27, 9, 'road');
  expect(city.placeStructure('internationalPort', 27, 10).ok).toBe(true);
  expect(city.query(12, 9)!.freight).not.toBeNull();
  const port = [...city.state.structures.values()][0]!;
  city.setFunding(port.id, 0);
  city.refreshIfDirty();
  expect(port.capacity).toBe(0);
  expect(city.query(12, 9)!.freight).toBeNull();
  city.setFunding(port.id, 100);
  city.refreshIfDirty();
  expect(port.capacity).toBe(city.cfg.structures.internationalPort.seaport!.relief / city.cfg.structures.internationalPort.seaport!.perTrip);
  expect(city.query(12, 9)!.freight).not.toBeNull();
});
