/** Run the policy proxy on a separate event loop so a synchronous shell wait
 * cannot stall HTTP/CONNECT decisions. This is a host-side building block;
 * callers still need a kernel-enforced network route before allowing a
 * domain-restricted sandbox command to start.
 */
import { Worker } from "node:worker_threads";

const RESPONSE_TIMEOUT_MS = 10_000;

function workerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function startEgressProxyWorker(policy, options = {}) {
  const bindHost = options.bindHost || "127.0.0.1";
  if (bindHost !== "127.0.0.1" && bindHost !== "::1") {
    throw workerError("ERR_EGRESS_WORKER_BIND_HOST");
  }
  const timeoutMs = options.timeoutMs || RESPONSE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw workerError("ERR_EGRESS_WORKER_TIMEOUT");
  }
  const worker = new Worker(
    new URL("./sandbox-egress-worker-thread.js", import.meta.url),
    { workerData: { policy, bindHost } },
  );
  const pending = new Map();
  let nextId = 1;
  let revision = 0;
  let closed = false;
  let terminalError = null;
  let expectedTermination = false;
  let terminationPromise = null;
  let shutdownPromise = null;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const startupTimer = setTimeout(() => {
    fail(workerError("ERR_EGRESS_WORKER_START_TIMEOUT"));
    void terminateWorker();
  }, timeoutMs);

  function terminateWorker() {
    if (!terminationPromise) {
      expectedTermination = true;
      terminationPromise = worker.terminate();
    }
    return terminationPromise;
  }

  function fail(error) {
    if (terminalError) return;
    terminalError = error;
    clearTimeout(startupTimer);
    rejectReady(error);
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
    if (!closed) {
      try {
        options.onFailure?.(error);
      } catch {
        // A diagnostic observer cannot keep a failed proxy alive.
      }
    }
  }

  worker.on("message", (message) => {
    if (message?.type === "startup-failed") {
      fail(workerError("ERR_EGRESS_WORKER_START_FAILED"));
      return;
    }
    if (message?.type === "ready") {
      if (
        !Number.isSafeInteger(message.port) ||
        message.port < 1 ||
        message.port > 65535
      ) {
        fail(workerError("ERR_EGRESS_WORKER_PROTOCOL"));
        void terminateWorker();
        return;
      }
      clearTimeout(startupTimer);
      resolveReady(message.port);
      return;
    }
    const entry = pending.get(message?.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.errorCode) {
      entry.reject(
        workerError(
          message.errorCode === "ERR_EGRESS_POLICY_REVISION"
            ? message.errorCode
            : "ERR_EGRESS_WORKER_REQUEST",
        ),
      );
      return;
    }
    entry.resolve(message);
  });
  worker.on("error", () => fail(workerError("ERR_EGRESS_WORKER_FAILURE")));
  worker.on("exit", () => {
    if (!expectedTermination) fail(workerError("ERR_EGRESS_WORKER_EXIT"));
  });

  function request(type, fields = {}) {
    if (terminalError) return Promise.reject(terminalError);
    if (closed && type !== "close") {
      return Promise.reject(workerError("ERR_EGRESS_WORKER_CLOSED"));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = workerError("ERR_EGRESS_WORKER_RESPONSE_TIMEOUT");
        fail(error);
        void terminateWorker();
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        worker.postMessage({ id, type, ...fields });
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(workerError("ERR_EGRESS_WORKER_REQUEST"));
      }
    });
  }

  let port;
  try {
    port = await ready;
  } catch (error) {
    await terminateWorker();
    throw error;
  }
  return {
    port,
    get revision() {
      return revision;
    },
    async updatePolicy(nextPolicy, expectedRevision) {
      const response = await request("update", {
        policy: nextPolicy,
        expectedRevision,
      });
      if (!Number.isSafeInteger(response.revision)) {
        fail(workerError("ERR_EGRESS_WORKER_PROTOCOL"));
        void terminateWorker();
        throw terminalError;
      }
      revision = response.revision;
      return revision;
    },
    close() {
      if (!shutdownPromise) {
        closed = true;
        shutdownPromise = (async () => {
          try {
            if (!terminalError) await request("close");
          } finally {
            await terminateWorker();
          }
        })();
      }
      return shutdownPromise;
    },
    abort() {
      if (!shutdownPromise) {
        fail(workerError("ERR_EGRESS_WORKER_ABORTED"));
        closed = true;
        shutdownPromise = terminateWorker().then(() => {});
      } else if (!expectedTermination) {
        fail(workerError("ERR_EGRESS_WORKER_ABORTED"));
        void terminateWorker();
      }
      return shutdownPromise;
    },
  };
}
