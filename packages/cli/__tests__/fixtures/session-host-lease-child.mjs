import { SessionHostLeaseAuthority } from "../../src/lib/session-host-lease.js";

const [stateRoot, sessionId] = process.argv.slice(2);

try {
  const authority = new SessionHostLeaseAuthority({ stateRoot });
  authority.acquire(sessionId, {
    hostKind: "fixture",
    ttlMs: 30_000,
    heartbeatMs: 1_000,
  });
  process.send?.({ type: "ready", pid: process.pid });
  setInterval(() => {}, 1_000);
} catch (error) {
  process.send?.({
    type: "error",
    code: error?.code || null,
    message: error?.message || String(error),
  });
  process.exitCode = 1;
}
