import assert from "node:assert/strict";
import { test } from "node:test";
import {
  _deps as androidDeps,
  caps,
  invoke,
  loadBridgeConfig,
} from "../src/lib/cc-android-bridge.js";
import {
  _deps as teamDeps,
  makeAgentRunTask,
  makeShellRunTask,
  spawnAgent,
} from "../src/commands/team.js";
import { withFormalBudgetProviderScope } from "../src/lib/formal-budget-provider-scope.js";

const scoped = (operation) =>
  withFormalBudgetProviderScope(
    {
      runId: "offline-android-team",
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

test("Android invoke rejects before method, params, config, test hook or HTTP", async () => {
  const originals = {
    detectAndroid: androidDeps.detectAndroid,
    loadBridgeConfig: androidDeps.loadBridgeConfig,
    fetch: androidDeps.fetch,
    testInvoke: androidDeps.testInvoke,
  };
  let calls = 0;
  for (const key of Object.keys(originals)) {
    androidDeps[key] = () => {
      calls++;
      throw new Error(`Unexpected ${key}`);
    };
  }
  try {
    await scoped(async () => {
      await assert.rejects(invoke(unreadable(), unreadable()), {
        code: "CC_BUDGET_EXTERNAL_TOOL_NOT_COVERED",
        noReplay: true,
      });
      assert.throws(caps, {
        code: "CC_BUDGET_EXTERNAL_TOOL_NOT_COVERED",
        noReplay: true,
      });
      assert.throws(loadBridgeConfig, {
        code: "CC_BUDGET_EXTERNAL_TOOL_NOT_COVERED",
        noReplay: true,
      });
    });
    assert.equal(calls, 0);
  } finally {
    Object.assign(androidDeps, originals);
  }
});

test("team shell and Agent runners reject before payload or process broker", async () => {
  const oldSpawn = teamDeps.spawn;
  let spawns = 0;
  teamDeps.spawn = () => {
    spawns++;
    throw new Error("Unexpected team child process");
  };
  try {
    const shellTask = makeShellRunTask();
    const agentTask = makeAgentRunTask(unreadable());
    await scoped(async () => {
      for (const run of [shellTask, agentTask]) {
        assert.throws(() => run(unreadable()), {
          code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
          noReplay: true,
        });
      }
      assert.throws(
        () => spawnAgent(unreadable(), unreadable(), unreadable()),
        { code: "CC_BUDGET_DESCENDANT_NOT_COVERED", noReplay: true },
      );
    });
    assert.equal(spawns, 0);
  } finally {
    teamDeps.spawn = oldSpawn;
  }
});

test("detached Android and team calls cannot use a closed scope", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let deferred;
  await scoped(async () => {
    deferred = gate.then(() =>
      Promise.allSettled([
        invoke(unreadable(), unreadable()),
        Promise.resolve().then(() =>
          spawnAgent(unreadable(), unreadable(), unreadable()),
        ),
      ]),
    );
  });
  release();
  const results = await deferred;
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    assert.equal(result.reason.code, "CC_BUDGET_SCOPE_CLOSED");
    assert.equal(result.reason.noReplay, true);
  }
});

test("unscoped Android test transport keeps its ordinary response", async () => {
  const oldOverride = process.env.CC_ANDROID_BRIDGE_OVERRIDE;
  const oldTestInvoke = androidDeps.testInvoke;
  process.env.CC_ANDROID_BRIDGE_OVERRIDE = "1";
  androidDeps.testInvoke = async (method, params) => ({ method, params });
  try {
    assert.deepEqual(await invoke("contacts.query", { q: "offline" }), {
      method: "contacts.query",
      params: { q: "offline" },
    });
  } finally {
    androidDeps.testInvoke = oldTestInvoke;
    if (oldOverride === undefined)
      delete process.env.CC_ANDROID_BRIDGE_OVERRIDE;
    else process.env.CC_ANDROID_BRIDGE_OVERRIDE = oldOverride;
  }
});
