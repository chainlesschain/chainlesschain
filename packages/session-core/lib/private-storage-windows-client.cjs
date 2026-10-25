// Synchronous host API backed by a reusable, isolated ACL process. The bridge
// thread only manages pipes and deadlines; all native ACL work stays killable
// in the child process. No path, token, ACL or authority result is cached.
const { Worker } = require("node:worker_threads");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const MAX_RESPONSE = 8 * 1024 * 1024 + 65536;
const PENDING = 0,
  CANCELLED = 2;

function createClient({
  workerPath = join(__dirname, "private-storage-windows-worker.cjs"),
  environment = {},
} = {}) {
  let bridge = null;
  let closed = false;
  function retire(worker) {
    worker.postMessage({ close: true });
    if (bridge === worker) bridge = null;
  }
  return {
    run(request, timeoutMs) {
      if (closed) return { status: null, error: { code: "ACL_CLIENT_CLOSED" } };
      const deadline = Date.now() + timeoutMs;
      const input = JSON.stringify(request);
      if (Buffer.byteLength(input) > 4 * 1024 * 1024) {
        return { status: null, error: { code: "E2BIG" } };
      }
      if (!bridge) {
        bridge = new Worker(
          join(__dirname, "private-storage-windows-bridge.cjs"),
          {
            workerData: { workerPath, environment },
            // Inherited preload/loader hooks must not run in the transport thread.
            execArgv: [],
            env: environment,
          },
        );
        bridge.on("error", () => {});
        bridge.unref();
      }
      const worker = bridge;
      const shared = new SharedArrayBuffer(16 + MAX_RESPONSE);
      const state = new Int32Array(shared, 0, 4);
      worker.postMessage({ id: randomUUID(), input, deadline, shared });
      Atomics.wait(state, 0, PENDING, Math.max(0, deadline - Date.now()));
      if (Atomics.compareExchange(state, 0, PENDING, CANCELLED) === PENDING) {
        // The independent bridge enforces the deadline through its live child
        // process handle, even while the host is blocked here. Never kill by a
        // cached PID, which the OS could have recycled after a child exit.
        retire(worker);
        return { status: null, error: { code: "ETIMEDOUT" } };
      }
      const length = Atomics.load(state, 1);
      if (length < 1 || length > MAX_RESPONSE) {
        retire(worker);
        return { status: null, error: { code: "ACL_PROTOCOL_ERROR" } };
      }
      let result;
      try {
        result = JSON.parse(Buffer.from(shared, 16, length).toString("utf8"));
      } catch {
        retire(worker);
        return { status: null, error: { code: "ACL_PROTOCOL_ERROR" } };
      }
      if (result.error) retire(worker);
      return result;
    },
    close() {
      closed = true;
      if (bridge) retire(bridge);
    },
  };
}

let client;
function run(request, timeoutMs, environment) {
  client ??= createClient({ environment });
  return client.run(request, timeoutMs);
}
module.exports = { run, createClient };
