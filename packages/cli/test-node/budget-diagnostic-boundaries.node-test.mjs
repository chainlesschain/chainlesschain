import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { withFormalBudgetProviderScope } from "../src/lib/formal-budget-provider-scope.js";
import { runContextTokenLiveProbe } from "../scripts/context-token-volcengine-live-probe.mjs";
import { runVolcenginePlanDiagnostic } from "../scripts/implementation-plan-volcengine-live.mjs";
import { runPmExplorationLiveProbe } from "../scripts/pm-exploration-volcengine-live-probe.mjs";
import { createVolcengineDiagnosticBroker } from "../scripts/verify01-volcengine-diagnostic-broker.mjs";
import { runTaskDiagnostic } from "../scripts/verify01-volcengine-task-diagnostic.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const inScope = (operation) =>
  withFormalBudgetProviderScope(
    {
      runId: "offline-diagnostic-boundary",
      transport: {
        createFetch: () => () => {
          throw new Error("A rejected diagnostic must not invoke a provider");
        },
      },
    },
    operation,
  );

for (const [name, run] of [
  ["calibration probe", runContextTokenLiveProbe],
  ["implementation plan diagnostic", runVolcenginePlanDiagnostic],
  ["native diagnostic broker", createVolcengineDiagnosticBroker],
  ["native task diagnostic launcher", runTaskDiagnostic],
]) {
  test(`${name} rejects before resolving credentials, paths or injected transports`, async () => {
    let reads = 0;
    const options = new Proxy(
      {},
      {
        get() {
          reads++;
          throw new Error("Diagnostic arguments must remain unread");
        },
      },
    );
    const originalFetch = globalThis.fetch;
    const originalRetries = process.env.CC_MAX_RETRIES;
    await assert.rejects(
      inScope(() => run(options)),
      {
        code: "CC_BUDGET_TRANSPORT_NOT_COVERED",
      },
    );
    assert.equal(reads, 0);
    assert.equal(globalThis.fetch, originalFetch);
    assert.equal(process.env.CC_MAX_RETRIES, originalRetries);
  });
}

test("PM exploration probe rejects the formal scope before CLI/config resolution", async () => {
  await assert.rejects(
    inScope(() => runPmExplorationLiveProbe()),
    {
      code: "CC_BUDGET_TRANSPORT_NOT_COVERED",
    },
  );
});

test("importing the PM exploration diagnostic has no CLI execution side effect", () => {
  const url = new URL(
    "../scripts/pm-exploration-volcengine-live-probe.mjs",
    import.meta.url,
  );
  const stdout = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(url.href)}); console.log('IMPORTED');`,
    ],
    { cwd: repository, encoding: "utf8", windowsHide: true, timeout: 30000 },
  );
  assert.equal(stdout.trim(), "IMPORTED");
});

test("live CLI entry points still refuse execution without explicit live confirmation", () => {
  for (const script of [
    "context-token-volcengine-live-probe.mjs",
    "implementation-plan-volcengine-live.mjs",
    "pm-exploration-volcengine-live-probe.mjs",
    "verify01-volcengine-task-diagnostic.mjs",
  ]) {
    const result = spawnSync(
      process.execPath,
      ["packages/cli/scripts/" + script],
      {
        cwd: repository,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000,
      },
    );
    assert.equal(result.error, undefined, script);
    assert.equal(result.status, 1, script);
  }
});

test("a previously created broker cannot begin a diagnostic task inside a formal scope", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-diagnostic-boundary-"),
  );
  let broker;
  let requests = 0;
  try {
    broker = await createVolcengineDiagnosticBroker({
      outputDir: path.join(root, "broker"),
      key: "OFFLINE-FAKE-SECRET",
      requestImpl: async () => {
        requests++;
        throw new Error("No physical dispatch expected");
      },
    });
    await assert.rejects(
      inScope(() => broker.beginTask("verify-04")),
      {
        code: "CC_BUDGET_TRANSPORT_NOT_COVERED",
      },
    );
    assert.equal(requests, 0);
    // The rejection did not consume the ordinary diagnostic task allowance.
    broker.beginTask("verify-04");
    assert.equal(broker.taskStatus("verify-04").physicalRequestsStarted, 0);
  } finally {
    if (broker) await broker.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("cc-diagnostic-boundary-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
