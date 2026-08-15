import fs from "node:fs";
import { DurableRemoteMembershipCoordinator } from "../../src/lib/remote-membership-coordinator.js";
import { DurableRemoteMembershipHostStore } from "../../src/lib/remote-membership-host-store.js";

const payload = JSON.parse(
  Buffer.from(process.argv[2], "base64url").toString("utf8"),
);
const waiter = new Int32Array(new SharedArrayBuffer(4));
const target =
  payload.target === "host"
    ? new DurableRemoteMembershipHostStore({
        ...payload.paths,
        now: () => payload.now,
      })
    : new DurableRemoteMembershipCoordinator({
        ...payload.paths,
        now: () => payload.now,
      });

process.stdout.write("READY\n");
const barrierDeadline = Date.now() + 15_000;
while (!fs.existsSync(payload.barrierFile)) {
  if (Date.now() >= barrierDeadline) {
    throw new Error("Remote membership worker barrier timed out");
  }
  Atomics.wait(waiter, 0, 0, 5);
}

try {
  const result = target[payload.method](payload.args);
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      error: {
        name: error?.name || null,
        code: error?.code || null,
        message: error?.message || String(error),
        commitState: error?.commitState || null,
      },
    })}\n`,
  );
}
