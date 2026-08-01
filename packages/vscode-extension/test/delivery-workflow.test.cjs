"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  parseDeliveryProjection,
  parseDeliveryAction,
  parseDeliveryActionResult,
  parseDeliveryCommandResult,
  buildDeliveryProjectArgs,
  buildDeliveryStepArgs,
  DeliveryWorkflowController,
  renderDeliveryHtml,
} = require("../src/delivery-workflow.js");

const fixturePath = path.resolve(
  __dirname,
  "../../agent-sdk/__fixtures__/delivery-workflow/cases.json",
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

class FakeCliAdapter {
  constructor(outputs) {
    this.outputs = [...outputs];
    this.calls = [];
  }

  async run(args) {
    this.calls.push([...args]);
    assert.ok(
      this.outputs.length > 0,
      `unexpected CLI call: ${args.join(" ")}`,
    );
    return JSON.stringify(this.outputs.shift());
  }
}

test("consumes the shared projection/action/result fixture fail closed", () => {
  assert.equal(fixture.schema, "chainlesschain.delivery-host-fixtures");
  assert.equal(fixture.version, 1);

  for (const testCase of fixture.projectionCases) {
    assert.equal(
      parseDeliveryProjection(testCase.value) != null,
      testCase.valid,
      testCase.name,
    );
  }
  for (const testCase of fixture.actionCases) {
    assert.equal(
      parseDeliveryAction(JSON.stringify(testCase.value)) != null,
      testCase.valid,
      testCase.name,
    );
  }
  for (const testCase of fixture.resultCases) {
    assert.equal(
      parseDeliveryActionResult(testCase.value) != null,
      testCase.valid,
      testCase.name,
    );
  }
  assert.ok(parseDeliveryCommandResult(fixture.controllerCase.initial));
});

test("renders the complete delivery path, failure mapping and immutable evidence", () => {
  for (const testCase of fixture.uiCases) {
    const html = renderDeliveryHtml(testCase.value, { statePath: "flow.json" });
    for (const expected of testCase.contains) {
      assert.ok(
        html.includes(expected),
        `${testCase.name}: missing ${expected}`,
      );
    }
    assert.match(html, /data-delivery-action="merge"/);
    assert.match(
      html,
      /never call a PR, CI, merge, or archive provider directly/,
    );
  }
  const escaped = renderDeliveryHtml(
    { ...fixture.uiCases[0].value, flowId: "<script>alert(1)</script>" },
    { statePath: "<bad>" },
  );
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;bad&gt;/);
});

test("controller requests and settles only through exact delivery-step bindings", async () => {
  const c = fixture.controllerCase;
  const cli = new FakeCliAdapter([
    c.initial,
    c.initial,
    c.requested,
    c.requested,
    c.settled,
  ]);
  const controller = new DeliveryWorkflowController({
    runCli: (args) => cli.run(args),
    readResultFile: async (file) => {
      assert.equal(file, c.resultPath);
      return JSON.stringify(c.resultEnvelope);
    },
  });

  assert.deepEqual(buildDeliveryProjectArgs(c.statePath), [
    "artifacts",
    "delivery-project",
    c.statePath,
    "--json",
  ]);
  await controller.load(c.statePath);
  const request = controller.previewRequest("refresh_ci");
  assert.equal(request.expectedRevision, 7);
  await controller.confirmRequest(request);
  assert.deepEqual(cli.calls[2], c.expectedRequestArgs);
  assert.equal(controller.projection.pendingEffect.action, "refresh_ci");

  const settlement = await controller.previewSettlement(c.resultPath);
  assert.equal(settlement.expectedEffectId, c.resultEnvelope.effectId);
  await controller.confirmSettlement(settlement);
  assert.deepEqual(cli.calls[4], c.expectedSettleArgs);
  assert.equal(controller.projection.phase, "evidence");
  assert.equal(controller.projection.pendingEffect, null);

  const mutationCalls = cli.calls.filter((args) => args[1] === "delivery-step");
  assert.equal(mutationCalls.length, 2);
  for (const args of mutationCalls) {
    assert.deepEqual(args.slice(0, 2), ["artifacts", "delivery-step"]);
    assert.ok(args.includes("--write-state"));
    assert.equal(
      args.some((arg) => /^(gh|git|merge|push)$/.test(arg)),
      false,
    );
  }
});

test("revision and result/effect changes invalidate confirmations before step", async () => {
  const c = fixture.controllerCase;
  const staleCli = new FakeCliAdapter([c.initial, c.stale]);
  const staleController = new DeliveryWorkflowController({
    runCli: (args) => staleCli.run(args),
    readResultFile: async () => JSON.stringify(c.resultEnvelope),
  });
  await staleController.load(c.statePath);
  const request = staleController.previewRequest("refresh_ci");
  await assert.rejects(
    staleController.confirmRequest(request),
    /confirmation is stale/,
  );
  assert.equal(
    staleCli.calls.some((args) => args[1] === "delivery-step"),
    false,
  );

  let resultText = JSON.stringify(c.resultEnvelope);
  const changedCli = new FakeCliAdapter([c.requested, c.requested]);
  const changedController = new DeliveryWorkflowController({
    runCli: (args) => changedCli.run(args),
    readResultFile: async () => resultText,
  });
  await changedController.load(c.statePath);
  const settlement = await changedController.previewSettlement(c.resultPath);
  resultText = JSON.stringify({
    ...c.resultEnvelope,
    result: { ...c.resultEnvelope.result, changed: true },
  });
  await assert.rejects(
    changedController.confirmSettlement(settlement),
    /result envelope changed/,
  );
  assert.equal(
    changedCli.calls.some((args) => args[1] === "delivery-step"),
    false,
  );
});

test("load and confirmation failures clear stale actions but retain the selected path", async () => {
  const c = fixture.controllerCase;
  let loadCalls = 0;
  const loadController = new DeliveryWorkflowController({
    runCli: async () => {
      loadCalls += 1;
      return loadCalls === 1
        ? JSON.stringify(c.initial)
        : { ok: false, error: "offline" };
    },
    readResultFile: async () => JSON.stringify(c.resultEnvelope),
  });
  await loadController.load(c.statePath);
  assert.deepEqual(loadController.projection.availableActions, ["refresh_ci"]);
  await assert.rejects(loadController.load(c.statePath), /offline/);
  assert.equal(loadController.statePath, c.statePath);
  assert.equal(loadController.projection, null);
  assert.throws(
    () => loadController.previewRequest("refresh_ci"),
    /no delivery projection is loaded/,
  );

  let confirmCalls = 0;
  const confirmController = new DeliveryWorkflowController({
    runCli: async () => {
      confirmCalls += 1;
      return confirmCalls === 1
        ? JSON.stringify(c.initial)
        : { ok: false, error: "recheck unavailable" };
    },
    readResultFile: async () => JSON.stringify(c.resultEnvelope),
  });
  await confirmController.load(c.statePath);
  const token = confirmController.previewRequest("refresh_ci");
  await assert.rejects(
    confirmController.confirmRequest(token),
    /recheck unavailable/,
  );
  assert.equal(confirmController.statePath, c.statePath);
  assert.equal(confirmController.projection, null);
});

test("builds legacy and CAS-bound CLI argv without any provider command", () => {
  assert.deepEqual(
    buildDeliveryStepArgs({
      statePath: "flow.json",
      action: "refresh_ci",
      resultPath: "ci.json",
    }),
    [
      "artifacts",
      "delivery-step",
      "flow.json",
      "--action",
      "refresh_ci",
      "--result-file",
      "ci.json",
      "--json",
    ],
  );
  assert.throws(
    () =>
      buildDeliveryStepArgs({ statePath: "flow.json", action: "force_merge" }),
    /unsupported delivery action/,
  );
});
