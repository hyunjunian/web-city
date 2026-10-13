import { drain } from './steps';

export interface DisposalOutlet {
  /** Road components that can deliver to this shared-capacity outlet. */
  components: readonly number[];
  capacity: number;
}

export interface DisposalAllocation {
  collected: Map<number, number>;
  used: number[];
}

interface Edge { to: number; reverse: number; room: number }
const EPSILON = 1e-9;

export function allocateDisposal(demand: ReadonlyMap<number, number>, outlets: readonly DisposalOutlet[]): DisposalAllocation {
  return drain(allocateDisposalSteps(demand, outlets));
}

/** Maximum feasible collection through road components and shared disposal capacities. No tile-level path searches. */
export function* allocateDisposalSteps(demand: ReadonlyMap<number, number>, outlets: readonly DisposalOutlet[]): Generator<void, DisposalAllocation> {
  const collected = new Map<number, number>();
  const used = outlets.map(() => 0);
  const groups = [...demand].filter(([, amount]) => amount > EPSILON);
  if (!groups.length) return { collected, used };
  // A normal connected city needs only a capacity pass, preserving outlet priority.
  if (groups.length === 1) {
    const [component, amount] = groups[0]!;
    let left = amount;
    for (let i = 0; i < outlets.length && left > EPSILON; i++) {
      if ((i & 0x1ff) === 0x1ff) yield;
      const outlet = outlets[i]!;
      if (!outlet.components.includes(component)) continue;
      const take = Math.min(left, Math.max(0, outlet.capacity));
      used[i] = take;
      left -= take;
    }
    collected.set(component, amount - left);
    return { collected, used };
  }
  // Dinic flow on a small bipartite graph: source → road components → outlets → sink.
  // Reverse edges can move an earlier allocation to another outlet instead of stranding a less flexible component.
  const source = 0, firstOutlet = groups.length + 1, sink = firstOutlet + outlets.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const add = (from: number, to: number, room: number): Edge => {
    const edge = { to, reverse: graph[to]!.length, room };
    graph[from]!.push(edge);
    graph[to]!.push({ to: from, reverse: graph[from]!.length - 1, room: 0 });
    return edge;
  };
  const nodes = new Map<number, number>();
  const inputs = groups.map(([component, amount], i) => {
    nodes.set(component, i + 1);
    return add(source, i + 1, amount);
  });
  const outputs: Edge[] = [];
  for (let i = 0; i < outlets.length; i++) {
    if ((i & 0x1ff) === 0x1ff) yield;
    const outlet = outlets[i]!;
    outputs.push(add(firstOutlet + i, sink, Math.max(0, outlet.capacity)));
    if (!(outlet.capacity > EPSILON)) continue;
    for (const component of new Set(outlet.components)) {
      const node = nodes.get(component);
      if (node !== undefined) add(node, firstOutlet + i, Infinity);
    }
  }
  yield;
  const level = new Int32Array(graph.length), next = new Int32Array(graph.length);
  const queue = new Int32Array(graph.length);
  let work = 0;
  for (;;) {
    level.fill(-1);
    level[source] = 0;
    queue[0] = source;
    let tail = 1;
    for (let head = 0; head < tail; head++) {
      const node = queue[head]!;
      for (const edge of graph[node]!) {
        if ((++work & 0x7ff) === 0) yield;
        if (edge.room > EPSILON && level[edge.to]! < 0) {
          level[edge.to] = level[node]! + 1;
          queue[tail++] = edge.to;
        }
      }
    }
    if (level[sink]! < 0) break;
    next.fill(0);
    // Iterative blocking-flow search avoids recursion even on many interlocking collection islands.
    for (;;) {
      const path = [source];
      const edges: Edge[] = [];
      while (path.length && path[path.length - 1] !== sink) {
        if ((++work & 0x7ff) === 0) yield;
        const node = path[path.length - 1]!;
        const list = graph[node]!;
        while (next[node]! < list.length) {
          const edge = list[next[node]!]!;
          if (edge.room > EPSILON && level[edge.to] === level[node]! + 1) break;
          next[node]!++;
        }
        if (next[node]! < list.length) {
          const edge = list[next[node]!]!;
          edges.push(edge);
          path.push(edge.to);
        } else {
          level[node] = -1;
          path.pop();
          edges.pop();
          if (path.length) next[path[path.length - 1]!]!++;
        }
      }
      if (!path.length) break;
      let amount = Infinity;
      for (const edge of edges) amount = Math.min(amount, edge.room);
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i]!;
        edge.room -= amount;
        graph[edge.to]![edge.reverse]!.room += amount;
      }
    }
    yield;
  }
  groups.forEach(([component, amount], i) => collected.set(component, Math.max(0, amount - inputs[i]!.room)));
  outputs.forEach((edge, i) => { used[i] = Math.max(0, outlets[i]!.capacity - edge.room); });
  return { collected, used };
}
