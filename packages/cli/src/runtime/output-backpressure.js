import { Buffer } from "node:buffer";

const DEFAULT_MAX_QUEUED_BYTES = 1024 * 1024;

function outputError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.isOutputBackpressureFailure = true;
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
  // Capture the native writer before a caller optionally installs this gate as
  // `stream.write`. Looking it up dynamically would recurse after installation.
  const nativeWrite = stream.write.bind(stream);
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

  const notifyCallback = (callback, error) => {
    if (typeof callback !== "function") return;
    queueMicrotask(() => {
      try {
        callback(error);
      } catch {
        // A write callback is observational and cannot replace gate failure.
      }
    });
  };

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
    const discarded = queue.splice(0);
    queuedBytes = 0;
    for (const entry of discarded) notifyCallback(entry.callback, error);
    ensureWait();
    rejectWait?.(error);
    try {
      onFailure?.(error);
    } catch {
      // Failure notification must never replace the original stream error.
    }
  };
  const writeNative = (chunk, encoding, callback) => {
    let accepted;
    try {
      accepted =
        typeof callback === "function"
          ? encoding != null
            ? nativeWrite(chunk, encoding, callback)
            : nativeWrite(chunk, callback)
          : encoding != null
            ? nativeWrite(chunk, encoding)
            : nativeWrite(chunk);
    } catch (error) {
      const wrapped = outputError(
        error?.code === "EPIPE" ? "EPIPE" : "CC_OUTPUT_STREAM_ERROR",
        `${label} write failed: ${error?.message || error}`,
        { cause: error },
      );
      notifyCallback(callback, wrapped);
      fail(wrapped);
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
      writeNative(entry.chunk, entry.encoding, entry.callback);
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
    write(chunk, encoding, callback) {
      if (typeof encoding === "function") {
        callback = encoding;
        encoding = undefined;
      }
      if (disposed || failure) {
        notifyCallback(
          callback,
          failure ||
            outputError(
              "CC_OUTPUT_BACKPRESSURE_DISPOSED",
              `${label} is no longer writable`,
            ),
        );
        return false;
      }
      if (!blocked && queue.length === 0) {
        return writeNative(chunk, encoding, callback);
      }

      const bytes = chunkBytes(chunk, encoding);
      if (queuedBytes + bytes > queueLimit) {
        const overflow = outputError(
          "CC_OUTPUT_BACKPRESSURE_OVERFLOW",
          `${label} backpressure queue exceeded ${queueLimit} bytes`,
          { queuedBytes, incomingBytes: bytes, maxQueuedBytes: queueLimit },
        );
        notifyCallback(callback, overflow);
        fail(overflow);
        return false;
      }
      queue.push({ chunk, encoding, callback, bytes });
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

/**
 * Install a gate directly on a Writable's `write` method. This is intended for
 * readline/TTY owners whose transitive writers all hold the same stream object
 * and cannot each be converted to an async writer. The original method shape
 * is restored exactly when `restore()` runs.
 */
export function installWritableBackpressureGate(stream, options = {}) {
  const hadOwnWrite = Object.prototype.hasOwnProperty.call(stream, "write");
  const ownWriteDescriptor = hadOwnWrite
    ? Object.getOwnPropertyDescriptor(stream, "write")
    : null;
  const gate = createWritableBackpressureGate(stream, options);
  const installedWrite = (chunk, encoding, callback) =>
    gate.write(chunk, encoding, callback);
  try {
    Object.defineProperty(stream, "write", {
      configurable: true,
      enumerable: ownWriteDescriptor?.enumerable ?? false,
      writable: true,
      value: installedWrite,
    });
  } catch (cause) {
    gate.dispose();
    throw outputError(
      "CC_OUTPUT_BACKPRESSURE_INSTALL_FAILED",
      `${options.label || "output"} write method cannot be gated`,
      { cause },
    );
  }

  let restored = false;
  return {
    wait: gate.wait,
    snapshot: gate.snapshot,
    restore() {
      if (restored) return;
      restored = true;
      if (stream.write === installedWrite) {
        if (hadOwnWrite) {
          Object.defineProperty(stream, "write", ownWriteDescriptor);
        } else {
          Reflect.deleteProperty(stream, "write");
        }
      }
      gate.dispose();
    },
  };
}

/** Install coordinated gates on stdout and stderr for a long-lived TTY owner. */
export function installOutputBackpressure({
  stdout = process.stdout,
  stderr = process.stderr,
  maxQueuedBytes,
  onFailure,
} = {}) {
  if (stdout === stderr) {
    const shared = installWritableBackpressureGate(stdout, {
      label: "output",
      maxQueuedBytes,
      onFailure,
    });
    return {
      wait: shared.wait,
      snapshot: () => {
        const current = shared.snapshot();
        return { stdout: current, stderr: current };
      },
      restore: shared.restore,
    };
  }
  const out = installWritableBackpressureGate(stdout, {
    label: "stdout",
    maxQueuedBytes,
    onFailure,
  });
  let err;
  try {
    err = installWritableBackpressureGate(stderr, {
      label: "stderr",
      maxQueuedBytes,
      onFailure,
    });
  } catch (error) {
    out.restore();
    throw error;
  }
  let restored = false;
  return {
    wait: () => Promise.all([out.wait(), err.wait()]),
    snapshot: () => ({ stdout: out.snapshot(), stderr: err.snapshot() }),
    restore() {
      if (restored) return;
      restored = true;
      out.restore();
      err.restore();
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
