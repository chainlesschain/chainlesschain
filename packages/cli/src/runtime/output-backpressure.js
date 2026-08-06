import { Buffer } from "node:buffer";

const DEFAULT_MAX_QUEUED_BYTES = 1024 * 1024;

function outputError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function chunkBytes(chunk, encoding) {
  if (Buffer.isBuffer(chunk) || ArrayBuffer.isView(chunk)) {
    return chunk.byteLength;
  }
  return Buffer.byteLength(String(chunk), encoding || "utf8");
}

/**
 * Honor Writable.write(false) without forcing every existing output call site
 * to become async. Once the native stream applies backpressure, later chunks
 * stay in a bounded host queue until `drain`; producers await `wait()` at their
 * event boundaries, so model/input consumption stops instead of growing the
 * native Writable queue without limit.
 */
export function createWritableBackpressureGate(
  stream,
  {
    label = "output",
    maxQueuedBytes = DEFAULT_MAX_QUEUED_BYTES,
    onFailure = null,
  } = {},
) {
  if (!stream || typeof stream.write !== "function") {
    throw new TypeError(`${label} must be a writable stream`);
  }
  const queueLimit =
    Number.isSafeInteger(maxQueuedBytes) && maxQueuedBytes > 0
      ? maxQueuedBytes
      : DEFAULT_MAX_QUEUED_BYTES;
  const queue = [];
  let queuedBytes = 0;
  let blocked = false;
  let failure = null;
  let waitPromise = null;
  let resolveWait = null;
  let rejectWait = null;
  let disposed = false;
  let backpressureCount = 0;

  const ensureWait = () => {
    if (waitPromise) return;
    waitPromise = new Promise((resolve, reject) => {
      resolveWait = resolve;
      rejectWait = reject;
    });
    // A caller may rely only on event-driven writes (for example a coalescer
    // timer) and observe the failure later. Mark the promise handled now while
    // preserving rejection for every explicit `wait()` caller.
    waitPromise.catch(() => {});
  };
  const finishWait = () => {
    const resolve = resolveWait;
    waitPromise = null;
    resolveWait = null;
    rejectWait = null;
    resolve?.();
  };
  const fail = (error) => {
    if (failure) return;
    failure = error;
    blocked = false;
    queue.length = 0;
    queuedBytes = 0;
    ensureWait();
    rejectWait?.(error);
    try {
      onFailure?.(error);
    } catch {
      // Failure notification must never replace the original stream error.
    }
  };
  const writeNative = (chunk, encoding) => {
    let accepted;
    try {
      accepted = stream.write(chunk, encoding);
    } catch (error) {
      fail(
        outputError(
          error?.code === "EPIPE" ? "EPIPE" : "CC_OUTPUT_STREAM_ERROR",
          `${label} write failed: ${error?.message || error}`,
          { cause: error },
        ),
      );
      return false;
    }
    if (accepted === false) {
      blocked = true;
      backpressureCount += 1;
      ensureWait();
    }
    return accepted !== false;
  };
  const onDrain = () => {
    if (disposed || failure) return;
    blocked = false;
    while (queue.length > 0 && !blocked && !failure) {
      const entry = queue.shift();
      queuedBytes -= entry.bytes;
      writeNative(entry.chunk, entry.encoding);
    }
    if (!blocked && queue.length === 0 && !failure) finishWait();
  };
  const onError = (cause) => {
    fail(
      outputError(
        cause?.code === "EPIPE" ? "EPIPE" : "CC_OUTPUT_STREAM_ERROR",
        `${label} stream failed: ${cause?.message || cause}`,
        { cause },
      ),
    );
  };

  stream.on?.("drain", onDrain);
  stream.on?.("error", onError);

  return {
    write(chunk, encoding) {
      if (disposed || failure) return false;
      if (!blocked && queue.length === 0) {
        return writeNative(chunk, encoding);
      }

      const bytes = chunkBytes(chunk, encoding);
      if (queuedBytes + bytes > queueLimit) {
        fail(
          outputError(
            "CC_OUTPUT_BACKPRESSURE_OVERFLOW",
            `${label} backpressure queue exceeded ${queueLimit} bytes`,
            { queuedBytes, incomingBytes: bytes, maxQueuedBytes: queueLimit },
          ),
        );
        return false;
      }
      queue.push({ chunk, encoding, bytes });
      queuedBytes += bytes;
      ensureWait();
      return false;
    },
    async wait() {
      if (failure) throw failure;
      if (blocked || queue.length > 0) {
        ensureWait();
        await waitPromise;
      }
      if (failure) throw failure;
    },
    snapshot() {
      return Object.freeze({
        label,
        blocked,
        queuedBytes,
        queuedChunks: queue.length,
        backpressureCount,
        failed: failure != null,
        failureCode: failure?.code || null,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stream.removeListener?.("drain", onDrain);
      stream.removeListener?.("error", onError);
      if (!failure && (blocked || queue.length > 0)) {
        fail(
          outputError(
            "CC_OUTPUT_BACKPRESSURE_DISPOSED",
            `${label} disposed before queued output drained`,
          ),
        );
      }
    },
  };
}

function injectedWriter(write) {
  return {
    write,
    wait: async () => {},
    snapshot: () => null,
    dispose: () => {},
  };
}

/** Create one coordinator for stdout and stderr. */
export function createHeadlessOutputBackpressure({
  stdout = process.stdout,
  stderr = process.stderr,
  writeOut = null,
  writeErr = null,
  maxQueuedBytes,
  onFailure,
} = {}) {
  const out = writeOut
    ? injectedWriter(writeOut)
    : createWritableBackpressureGate(stdout, {
        label: "stdout",
        maxQueuedBytes,
        onFailure,
      });
  const err = writeErr
    ? injectedWriter(writeErr)
    : createWritableBackpressureGate(stderr, {
        label: "stderr",
        maxQueuedBytes,
        onFailure,
      });

  return {
    writeOut: (chunk, encoding) => out.write(chunk, encoding),
    writeErr: (chunk, encoding) => err.write(chunk, encoding),
    wait: () => Promise.all([out.wait(), err.wait()]),
    snapshot: () => ({ stdout: out.snapshot(), stderr: err.snapshot() }),
    dispose() {
      out.dispose();
      err.dispose();
    },
  };
}
