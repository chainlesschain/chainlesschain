import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as immediate } from "node:timers/promises";
import broker from "../src/lib/process-execution-broker/index.js";
import { withFormalBudgetProviderScope } from "../src/lib/formal-budget-provider-scope.js";

const scoped = (operation) =>
  withFormalBudgetProviderScope(
    {
      runId: "offline-process-broker",
      transport: {
        createFetch: () => () => {
          throw new Error("Unexpected model transport call");
        },
      },
    },
    operation,
  );

function unreadable() {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("Caller payload inspected before budget refusal");
      },
      ownKeys() {
        throw new Error("Caller payload enumerated before budget refusal");
      },
    },
  );
}

test("all seven broker entry points reject before caller payload, native launch or audit", async () => {
  const originalNative = broker._native;
  let nativeCalls = 0;
  broker._native = {
    ...originalNative,
    spawn() {
      nativeCalls++;
      throw new Error("Unexpected native spawn");
    },
    spawnSync() {
      nativeCalls++;
      throw new Error("Unexpected native sync spawn");
    },
  };
  const beforeAudit = broker.getAuditLog().length;
  const beforeStats = broker.getStats();
  try {
    await scoped(async () => {
      const command = unreadable();
      const args = unreadable();
      const options = unreadable();
      const cases = [
        () => broker.spawn(command, args, options),
        () => broker.spawnSync(command, args, options),
        () => broker.exec(command, options),
        () => broker.execSync(command, options),
        () => broker.execFile(command, args, options),
        () => broker.execFileSync(command, args, options),
        () => broker.fork(command, args, options),
      ];
      for (const run of cases) {
        assert.throws(run, {
          code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
          noReplay: true,
        });
      }
    });
    assert.equal(nativeCalls, 0);
    assert.equal(broker.getAuditLog().length, beforeAudit);
    assert.deepEqual(broker.getStats(), beforeStats);
  } finally {
    broker._native = originalNative;
  }
});

test("asynchronous descendants retain broker refusal and closed scopes cannot spawn", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let detached;
  await scoped(async () => {
    await immediate();
    assert.throws(
      () => broker.spawn(unreadable(), unreadable(), unreadable()),
      {
        code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
        noReplay: true,
      },
    );
    detached = gate.then(() =>
      broker.spawnSync(unreadable(), unreadable(), unreadable()),
    );
  });
  release();
  await assert.rejects(detached, {
    code: "CC_BUDGET_SCOPE_CLOSED",
    noReplay: true,
  });
});
