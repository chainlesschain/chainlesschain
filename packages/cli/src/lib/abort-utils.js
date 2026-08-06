export function createAbortError(message = "Agent loop interrupted") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function isAbortError(error) {
  return (
    error?.name === "AbortError" ||
    error?.code === "ABORT_ERR" ||
    (typeof error?.message === "string" &&
      /aborted|interrupted/i.test(error.message))
  );
}

export function throwIfAborted(signal, message = "Agent loop interrupted") {
  if (signal?.aborted) {
    throw signal.reason || createAbortError(message);
  }
}

/**
 * Await a value while making a host AbortSignal authoritative over settlement.
 * The source promise is always observed after cancellation, so a late rejection
 * cannot become unhandled and a late success cannot revive the cancelled path.
 */
export function raceWithAbort(
  value,
  signal,
  message = "Agent loop interrupted",
) {
  if (!signal) return Promise.resolve(value);
  try {
    throwIfAborted(signal, message);
  } catch (error) {
    return Promise.reject(error);
  }
  if (typeof signal.addEventListener !== "function") {
    return Promise.resolve(value);
  }

  const source = Promise.resolve(value);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      try {
        signal.removeEventListener?.("abort", onAbort);
      } catch {
        // Listener cleanup cannot change the already-authoritative settlement.
      }
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(signal.reason || createAbortError(message));
    };
    try {
      signal.addEventListener("abort", onAbort, { once: true });
    } catch (error) {
      settled = true;
      // Observe a later source rejection even though the signal contract was
      // malformed and this wrapper must fail immediately.
      source.catch(() => {});
      reject(error);
      return;
    }
    source.then(
      (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
    // AbortSignal does not replay an event that fired immediately before the
    // listener was attached. Re-check after both observers are installed so
    // that narrow registration race still settles as cancellation, while the
    // source remains observed if it finishes later.
    if (signal.aborted) onAbort();
  });
}
