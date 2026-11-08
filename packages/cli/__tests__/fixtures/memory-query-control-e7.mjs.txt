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
  return async (force = false) => {
    checkMemoryQueryAborted(signal);
    if (force || performance.now() - yieldedAt >= 8) {
      await setImmediate(undefined, { signal });
      yieldedAt = performance.now();
    }
    checkMemoryQueryAborted(signal);
  };
}
