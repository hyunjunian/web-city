/** Numeric min-heap for map-state ids. Equal keys retain the routing heap's existing tie order. */
export class MinHeap {
  private keys = new Float64Array(64);
  private values = new Int32Array(64);
  private count = 0;
  lastKey = 0;

  get size(): number { return this.count; }

  push(key: number, value: number): void {
    if (this.count === this.keys.length) {
      const keys = new Float64Array(this.count * 2), values = new Int32Array(this.count * 2);
      keys.set(this.keys);
      values.set(this.values);
      this.keys = keys;
      this.values = values;
    }
    let i = this.count++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= key) break;
      this.keys[i] = this.keys[parent]!;
      this.values[i] = this.values[parent]!;
      i = parent;
    }
    this.keys[i] = key;
    this.values[i] = value;
  }

  /** Removes the smallest key, returning its id; the key is available as lastKey. */
  pop(): number {
    if (!this.count) throw new RangeError('empty heap');
    const top = this.values[0]!;
    this.lastKey = this.keys[0]!;
    const length = --this.count;
    const key = this.keys[length]!, value = this.values[length]!;
    if (length) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= length) break;
        if (child + 1 < length && this.keys[child + 1]! < this.keys[child]!) child++;
        if (this.keys[child]! >= key) break;
        this.keys[i] = this.keys[child]!;
        this.values[i] = this.values[child]!;
        i = child;
      }
      this.keys[i] = key;
      this.values[i] = value;
    }
    return top;
  }
}
