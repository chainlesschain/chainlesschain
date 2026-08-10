import { SessionHostLeaseAuthority } from "../../src/lib/session-host-lease.js";
import { writeFileSync } from "node:fs";

const [stateRoot, sessionId] = process.argv.slice(2);
const mode = process.argv[4] || "host";
const requestId = process.argv[5] || null;

function sendAndExit(message, exitCode = 0) {
  if (typeof process.send !== "function") {
    process.exit(exitCode);
    return;
  }
  process.send(message, () => process.exit(exitCode));
}

try {
  const authority = new SessionHostLeaseAuthority({ stateRoot });
  if (mode === "revoke") {
    const revocation = authority.revoke(sessionId, {
      requestId,
      reasonCode: "fixture",
    });
    sendAndExit({ type: "revoked", ...revocation });
  } else if (mode !== "host") {
    throw new Error(`unknown fixture mode: ${mode}`);
  } else {
    const lease = authority.acquire(sessionId, {
      hostKind: "fixture",
      ttlMs: 30_000,
      heartbeatMs: 1_000,
    });
    process.send?.({
      type: "ready",
      pid: process.pid,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      revocationEpoch: lease.revocationEpoch,
    });
    process.on("message", (message) => {
      if (message?.type === "assert") {
        try {
          process.send?.({ type: "asserted", authority: lease.assert() });
        } catch (error) {
          process.send?.({
            type: "assert-error",
            code: error?.code || null,
            message: error?.message || String(error),
          });
        }
      }
      if (message?.type === "precheck") {
        try {
          const authority = lease.assert();
          process.send?.({ type: "prechecked", authority });
        } catch (error) {
          process.send?.({
            type: "precheck-error",
            code: error?.code || null,
            message: error?.message || String(error),
          });
        }
      }
      if (message?.type === "admitted-side-effect") {
        try {
          const result = lease.admitMcpDispatch(
            { method: "tools/call", transport: "stdio" },
            () => {
              writeFileSync(message.path, "executed\n", {
                encoding: "utf8",
                flag: "wx",
              });
              return "dispatched";
            },
          );
          process.send?.({ type: "admitted-side-effect-executed", result });
        } catch (error) {
          process.send?.({
            type: "admitted-side-effect-error",
            code: error?.code || null,
            message: error?.message || String(error),
          });
        }
      }
      if (message?.type === "side-effect") {
        try {
          const authority = lease.assert();
          writeFileSync(message.path, "executed\n", {
            encoding: "utf8",
            flag: "wx",
          });
          process.send?.({ type: "side-effect-executed", authority });
        } catch (error) {
          process.send?.({
            type: "side-effect-error",
            code: error?.code || null,
            message: error?.message || String(error),
          });
        }
      }
    });
    setInterval(() => {}, 1_000);
  }
} catch (error) {
  sendAndExit(
    {
      type: "error",
      code: error?.code || null,
      message: error?.message || String(error),
    },
    1,
  );
}
