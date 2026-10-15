import assert from "node:assert/strict";
import { test } from "node:test";
import { EvoMapClient, _deps as evomapDeps } from "../src/lib/evomap-client.js";
import { CloudClient, pollUntilDone } from "../src/lib/cloud/cloud-client.js";
import { ResilientGatewayClient } from "../src/lib/gateway-client-resilience.js";
import { withFormalBudgetProviderScope } from "../src/lib/formal-budget-provider-scope.js";

const scoped = (operation) =>
  withFormalBudgetProviderScope(
    {
      runId: "offline-service-cloud-boundary",
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
        throw new Error("Caller input inspected before budget refusal");
      },
      ownKeys() {
        throw new Error("Caller input enumerated before budget refusal");
      },
    },
  );
}

test("EvoMap constructor and pre-existing client reject before inputs or fetch", async () => {
  const previousFetch = evomapDeps.fetch;
  let fetches = 0;
  evomapDeps.fetch = async () => {
    fetches++;
    return { ok: true, json: async () => ({ genes: [] }) };
  };
  const client = new EvoMapClient({ hubUrl: "https://example.test" });
  try {
    await scoped(async () => {
      assert.throws(() => new EvoMapClient(unreadable()), {
        code: "CC_BUDGET_SERVICE_NOT_COVERED",
        noReplay: true,
      });
      for (const call of [
        () => client.search("query", unreadable()),
        () => client.getGene(unreadable()),
        () => client.download(unreadable()),
        () => client.publish(unreadable()),
        () => client.getHubInfo(),
        () => client.listHubs(),
        () => client._request(unreadable(), unreadable()),
      ]) {
        await assert.rejects(call(), {
          code: "CC_BUDGET_SERVICE_NOT_COVERED",
          noReplay: true,
        });
      }
    });
    assert.equal(fetches, 0);
    assert.deepEqual(await client.search("query"), []);
    assert.equal(fetches, 1);
  } finally {
    evomapDeps.fetch = previousFetch;
  }
});

test("Cloud Runner rejects construction, delegated calls and injected polling", async () => {
  let fetches = 0;
  let streams = 0;
  const client = new CloudClient({
    baseUrl: "https://runner.example.test",
    deps: {
      fetch: async () => {
        fetches++;
        return { ok: true, json: async () => ({ jobId: "job-1" }) };
      },
    },
    gateway: {
      stream: async () => {
        streams++;
        return { ended: true };
      },
    },
  });
  await scoped(async () => {
    assert.throws(() => new CloudClient(unreadable()), {
      code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
      noReplay: true,
    });
    for (const call of [
      () => client.submit(unreadable()),
      () => client.status(unreadable()),
      () => client.result(unreadable()),
      () => client.events(unreadable(), unreadable()),
      () => client._json("POST", "/v1/jobs", unreadable()),
      () => pollUntilDone(unreadable(), unreadable(), unreadable()),
    ]) {
      await assert.rejects(call(), {
        code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
        noReplay: true,
      });
    }
  });
  assert.equal(fetches, 0);
  assert.equal(streams, 0);
  assert.equal((await client.submit({ task: "offline" })).jobId, "job-1");
  assert.equal(fetches, 1);
});

test("direct gateway requests reject before URL, TLS or injected fetch", async () => {
  let fetches = 0;
  let tlsCalls = 0;
  const gateway = new ResilientGatewayClient({
    baseUrl: "https://runner.example.test",
    fetch: async () => {
      fetches++;
      throw new Error("Unexpected gateway fetch");
    },
    tlsProvider: async () => {
      tlsCalls++;
      return null;
    },
  });
  await scoped(async () => {
    assert.throws(() => new ResilientGatewayClient(unreadable()), {
      code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
      noReplay: true,
    });
    await assert.rejects(gateway.stream(unreadable(), unreadable()), {
      code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
      noReplay: true,
    });
    await assert.rejects(gateway._request(unreadable(), unreadable()), {
      code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
      noReplay: true,
    });
  });
  assert.equal(fetches, 0);
  assert.equal(tlsCalls, 0);
});

test("late calls retain the closed budget scope refusal", async () => {
  const evomap = new EvoMapClient({ hubUrl: "https://example.test" });
  const cloud = new CloudClient({ baseUrl: "https://runner.example.test" });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let lateService;
  let lateCloud;
  await scoped(async () => {
    lateService = gate.then(() => evomap.getHubInfo());
    lateCloud = gate.then(() => cloud.status("job-1"));
  });
  release();
  for (const call of [lateService, lateCloud]) {
    await assert.rejects(call, {
      code: "CC_BUDGET_SCOPE_CLOSED",
      noReplay: true,
    });
  }
});
