import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  CredentialTransport,
  resolveCredentialRefOverTransport,
} from "../src/lib/process-execution-broker/credential-transport.js";
import { CredentialAgent } from "../src/lib/process-execution-broker/credential-agent.js";
import { withFormalBudgetProviderScope } from "../src/lib/formal-budget-provider-scope.js";

const scoped = (operation) =>
  withFormalBudgetProviderScope(
    {
      runId: "offline-credential-worker-boundary",
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

test("credential worker creation and reference resolution reject before caller payload or IPC", async () => {
  await scoped(async () => {
    assert.throws(() => new CredentialTransport(unreadable()), {
      code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
      noReplay: true,
    });
    await assert.rejects(
      resolveCredentialRefOverTransport(unreadable(), unreadable()),
      { code: "CC_BUDGET_DESCENDANT_NOT_COVERED", noReplay: true },
    );
  });
});

test("pre-existing credential worker rejects registration but permits revoke and close", async () => {
  const messages = [];
  const worker = new EventEmitter();
  worker.unref = () => {};
  worker.terminate = async () => 0;
  worker.postMessage = (message) => {
    messages.push(message);
    if (message.type === "close") {
      queueMicrotask(() => worker.emit("message", { type: "closed" }));
    }
  };
  const transport = new CredentialTransport({
    agentId: "offline-worker",
    workerFactory: () => worker,
  });
  try {
    await scoped(async () => {
      assert.throws(() => transport.registerCredential(unreadable()), {
        code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
        noReplay: true,
      });
      assert.deepEqual(messages, []);
      transport.revokeCredential("offline-reference");
      await transport.close();
    });
    assert.deepEqual(
      messages.map((message) => message.type),
      ["revoke", "close"],
    );
  } finally {
    await transport.close();
  }
});

test("credential agent rejects issuance, resolution and spawn preparation before secrets or audit", async () => {
  const agent = new CredentialAgent({ env: {} });
  const beforeAudit = agent.getAuditLog();
  await scoped(async () => {
    for (const operation of [
      () => agent.issueCredentialRef(unreadable()),
      () => agent.resolveCredentialRef(unreadable(), unreadable()),
      () => agent.filterEnvironment(unreadable(), unreadable()),
      () => agent.applyWithReport(unreadable()),
    ]) {
      assert.throws(operation, {
        code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
        noReplay: true,
      });
    }
  });
  assert.deepEqual(agent.getAuditLog(), beforeAudit);
});

test("closed scope cannot resolve credential references from a detached continuation", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let detached;
  await scoped(async () => {
    detached = gate.then(() =>
      resolveCredentialRefOverTransport(unreadable(), unreadable()),
    );
  });
  release();
  await assert.rejects(detached, {
    code: "CC_BUDGET_SCOPE_CLOSED",
    noReplay: true,
  });
});
