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
