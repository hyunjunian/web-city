import { drain } from './steps';
import { allocateCapacitySteps, type CapacityOutlet } from './capacity';

export interface DisposalOutlet extends CapacityOutlet {}
export interface DisposalAllocation {
  collected: Map<number, number>;
  used: number[];
}

export function allocateDisposal(demand: ReadonlyMap<number, number>, outlets: readonly DisposalOutlet[]): DisposalAllocation {
  return drain(allocateDisposalSteps(demand, outlets));
}

/** Maximum feasible collection through road components and shared disposal capacities. */
export function* allocateDisposalSteps(demand: ReadonlyMap<number, number>, outlets: readonly DisposalOutlet[]): Generator<void, DisposalAllocation> {
  const { served, used } = yield* allocateCapacitySteps(demand, outlets);
  return { collected: served, used };
}
