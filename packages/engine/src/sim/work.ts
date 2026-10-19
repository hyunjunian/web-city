// A tile-index work area shared by sequential field passes for one city.
const AREAS = new WeakMap<object, Int32Array>();

export function tileWork(owner: object, length: number): Int32Array {
  let area = AREAS.get(owner);
  if (area?.length !== length) {
    area = new Int32Array(length);
    AREAS.set(owner, area);
  }
  return area;
}
