import { performance } from "node:perf_hooks";
import { setImmediate, setTimeout } from "node:timers/promises";

// These are host control signals, not serialized MemoryRecallRequest fields.
export function checkMemoryQueryAborted(signal) {
  signal?.throwIfAborted();
}

export function memoryLockWait(signal) {
  return async (milliseconds) => {
    checkMemoryQueryAborted(signal);
    await setTimeout(milliseconds, undefined, { signal });
    checkMemoryQueryAborted(signal);
  };
}

/** Yield between bounded shards while retaining the authority lock/snapshot. */
export function createMemoryQueryCheckpoint(signal) {
  let yieldedAt = performance.now();
  let workSinceYield = 0;
  return async (force = false) => {
    checkMemoryQueryAborted(signal);
    // Bound work as well as elapsed time so queued Stop handlers run even
    // when many small shards finish inside one clock slice.
    if (force || ++workSinceYield >= 32 || performance.now() - yieldedAt >= 8) {
      await setImmediate(undefined, { signal });
      yieldedAt = performance.now();
      workSinceYield = 0;
    }
    checkMemoryQueryAborted(signal);
  };
}
