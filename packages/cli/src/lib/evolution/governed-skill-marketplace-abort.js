import { raceWithAbort, throwIfAborted } from "../abort-utils.js";

// Only race reads/preparation. Durable commits must retain their acknowledgement
// and recovery path even when the caller interrupts after the append starts.
export function awaitMarketplaceRead(operation, signal) {
  throwIfAborted(signal);
  return raceWithAbort(
    Promise.resolve().then(() => {
      throwIfAborted(signal);
      return operation();
    }),
    signal,
  );
}
