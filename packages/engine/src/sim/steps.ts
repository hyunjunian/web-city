// Work done in steps: a generator pauses (yields) now and then so a viewer can
// spread a long computation over frames (see City.beginSteps). Each stepwise
// function has a plain twin that runs it to the end: same work, same result.

/** Runs a stepwise computation to its end. */
export function drain<T>(steps: Generator<void, T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}
