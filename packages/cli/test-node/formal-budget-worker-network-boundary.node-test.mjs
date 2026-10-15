import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMarketplaceNetworkTransport,
  resolveMarketplacePac,
} from "../src/lib/plugin-runtime/marketplace-network.js";
import { startEgressProxyWorker } from "../src/lib/sandbox-egress-worker.js";
import { withFormalBudgetProviderScope } from "../src/lib/formal-budget-provider-scope.js";

const scoped = (operation) =>
  withFormalBudgetProviderScope(
    {
      runId: "offline-worker-network-boundary",
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

test("worker launchers reject before reading caller policy, PAC or options", async () => {
  await scoped(async () => {
    await assert.rejects(startEgressProxyWorker(unreadable(), unreadable()), {
      code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
      noReplay: true,
    });
    assert.throws(
      () => resolveMarketplacePac(unreadable(), unreadable(), unreadable()),
      { code: "CC_BUDGET_DESCENDANT_NOT_COVERED", noReplay: true },
    );
    assert.throws(() => createMarketplaceNetworkTransport(unreadable()), {
      code: "CC_BUDGET_EXTERNAL_TOOL_NOT_COVERED",
      noReplay: true,
    });
  });
});

test("pre-existing marketplace transport and egress worker cannot be used to bypass the scope", async () => {
  const marketplace = createMarketplaceNetworkTransport({
    proxyUrl: "http://127.0.0.1:1",
  });
  const egress = await startEgressProxyWorker({ allowedDomains: [] });
  try {
    await scoped(async () => {
      await assert.rejects(marketplace.fetch(unreadable(), unreadable()), {
        code: "CC_BUDGET_EXTERNAL_TOOL_NOT_COVERED",
        noReplay: true,
      });
      await assert.rejects(egress.updatePolicy(unreadable(), unreadable()), {
        code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
        noReplay: true,
      });
      assert.equal(egress.revision, 0);
      await egress.close();
    });
  } finally {
    await Promise.all([egress.close(), marketplace.close()]);
  }
});

test("asynchronous calls after scope closure retain the closed-scope refusal", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let detached;
  await scoped(async () => {
    detached = gate.then(() =>
      resolveMarketplacePac(unreadable(), unreadable(), unreadable()),
    );
  });
  release();
  await assert.rejects(detached, {
    code: "CC_BUDGET_SCOPE_CLOSED",
    noReplay: true,
  });
});
