import assert from "node:assert/strict";
import test from "node:test";
import { createPlan, runTestSequence } from "./plan.mjs";

test("default keeps five-case selection and pre-test host probe", async () => {
  const plan = createPlan({});
  assert.equal(plan.gateContext, false);
  assert.equal(plan.fullUpdaterSuite, false);
  assert.equal(plan.hostProbeTiming, "before-tests");
  assert.equal(plan.updaterSelectionArgs[0], "--testNamePattern");
  assert.equal(plan.updaterSelectionArgs[1].split("|").length, 5);
  const result = await runTestSequence(
    plan,
    () => assert.fail("default must not run installers"),
    async () => ({ status: 0, observationComplete: true }),
  );
  assert.equal(result.updaterRan, true);
});

test("existing full-suite opt-in retains default host probe order", () => {
  const plan = createPlan({ CC_UPDATER_DIAGNOSTIC_FULL_SUITE: "true" });
  assert.equal(plan.gateContext, false);
  assert.equal(plan.hostProbeTiming, "before-tests");
  assert.deepEqual(plan.updaterSelectionArgs, []);
});

test("gate context forces full suite after the original installer command", async () => {
  const plan = createPlan({
    CC_UPDATER_DIAGNOSTIC_GATE_CONTEXT: "true",
    CC_UPDATER_DIAGNOSTIC_FULL_SUITE: "false",
  });
  assert.equal(plan.fullUpdaterSuite, true);
  assert.equal(plan.hostProbeTiming, "after-tests");
  assert.deepEqual(plan.updaterSelectionArgs, []);
  const order = [];
  const result = await runTestSequence(
    plan,
    async (args) => {
      assert.deepEqual(args, [
        "node_modules/vitest/vitest.mjs",
        "run",
        "packages/cli/__tests__/unit/native-installers-transaction.test.js",
        "--maxWorkers=1",
      ]);
      await Promise.resolve();
      order.push("installer-finished");
      return { status: 0 };
    },
    async () => {
      order.push("updater-started");
      return { status: 0, observationComplete: true };
    },
  );
  assert.deepEqual(order, ["installer-finished", "updater-started"]);
  assert.equal(result.status, 0);
});

for (const status of [1, null]) {
  test(`installer failure (${status}) prevents updater execution`, async () => {
    const result = await runTestSequence(
      createPlan({ CC_UPDATER_DIAGNOSTIC_GATE_CONTEXT: "true" }),
      async () => ({ status }),
      () => assert.fail("updater must not run after installer failure"),
    );
    assert.equal(result.updaterRan, false);
    assert.equal(result.status, 1);
    assert.equal(result.reason, "installer-predecessor-failed");
  });
}
