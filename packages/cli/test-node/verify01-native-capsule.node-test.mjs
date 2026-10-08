import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import {
  inspectNativeCapsuleCompletion,
  nativeCapsuleCheckSource,
  inspectNativeCapsuleSource,
} from "../scripts/verify01-native-capsule.mjs";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { outcomeDigest } from "../src/lib/eval/outcomes.js";

function evidence(
  mode = "global-setup",
  detail = { globalSetupExecuted: true, teardownCompleted: true },
) {
  const inventory = {
    runtime: { modulesAbi: process.versions.modules },
    addons: [],
  };
  const inventoryDigest = outcomeDigest(inventory);
  const manifest = { version: 2, capsuleBinding: { inventoryDigest } };
  const manifestDigest = evalDigest(Buffer.from(JSON.stringify(manifest)));
  const report = {
    mode,
    formalSample: false,
    providerAssessed: false,
    fullReviewPackReady: false,
    nodeVersion: process.version,
    inventory,
    inventoryDigest,
    manifest,
    manifestDigest,
    execution: {
      status: 0,
      signal: null,
      error: null,
      stdout:
        "CC_NATIVE_CAPSULE:" +
        JSON.stringify({
          mode,
          pid: 1001,
          nodeVersion: process.version,
          modulesAbi: process.versions.modules,
          detail,
        }) +
        "\n",
    },
    settlement: {
      targetPid: 1001,
      cleanupConfirmed: true,
      executionFailed: false,
      targetExitCode: 0,
      capabilityCount: 0,
      loopbackExemptionAbsent: true,
      manifestDigest: manifestDigest.slice(7),
    },
  };
  const rows = [
    {
      sequence: 0,
      stage: "started",
      mode,
      pid: 1001,
      nodeVersion: process.version,
      modulesAbi: process.versions.modules,
    },
    { sequence: 1, stage: "completed", mode, pid: 1001, ...detail },
  ];
  const stages =
    mode === "global-setup"
      ? [
          "builtin-import-started",
          "builtin-imported",
          "support-import-started",
          "support-imported",
          "setup-started",
          "setup-completed",
          "teardown-started",
        ]
      : mode === "vitest-smoke"
        ? ["vitest-import-started", "vitest-imported", "vitest-started"]
        : [];
  rows.splice(
    1,
    0,
    ...stages.map((stage) => ({
      stage,
      mode,
      pid: 1001,
      ...(stage === "vitest-started"
        ? { pool: "threads", config: "packages/cli/vitest.config.js" }
        : {}),
    })),
  );
  rows.forEach((row, index) => {
    row.sequence = index;
  });
  report.journalDigest = evalDigest(
    Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n") + "\n"),
  );
  return {
    report,
    rows,
    journal: () =>
      Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n") + "\n"),
  };
}

test("completion binds real exit, empty Job, unique frame, runtime and journal", () => {
  const item = evidence();
  assert.deepEqual(
    inspectNativeCapsuleCompletion(item.report, item.journal()),
    { globalSetupExecuted: true, teardownCompleted: true },
  );
});

for (const mutation of [
  "exit",
  "cleanup",
  "pid",
  "runtime",
  "sequence",
  "duplicate-frame",
  "missing-frame",
  "partial-journal",
  "false-setup",
  "scope",
  "manifest",
  "inventory",
]) {
  test(`capsule rejects ${mutation} rather than promoting exit zero`, () => {
    const item = evidence();
    if (mutation === "exit") item.report.settlement.targetExitCode = 125;
    if (mutation === "cleanup") item.report.settlement.cleanupConfirmed = false;
    if (mutation === "pid") item.report.settlement.targetPid++;
    if (mutation === "runtime") item.rows[0].modulesAbi = "wrong";
    if (mutation === "sequence") item.rows[1].sequence++;
    if (mutation === "duplicate-frame")
      item.report.execution.stdout += item.report.execution.stdout;
    if (mutation === "missing-frame") item.report.execution.stdout = "";
    if (mutation === "partial-journal") item.rows.pop();
    if (mutation === "false-setup") item.rows.at(-1).teardownCompleted = false;
    if (mutation === "scope") item.report.formalSample = true;
    if (mutation === "manifest") item.report.manifest.version = 1;
    if (mutation === "inventory")
      item.report.inventory.runtime.modulesAbi = "wrong";
    assert.throws(
      () => inspectNativeCapsuleCompletion(item.report, item.journal()),
      /Native capsule:/,
    );
  });
}

test("an empty addon population does not certify an ABI", () => {
  const item = evidence("addon-load", {
    results: [],
    loaded: [],
    addonAbiVerified: null,
  });
  assert.equal(
    inspectNativeCapsuleCompletion(item.report, item.journal())
      .addonAbiVerified,
    null,
  );
  item.rows[1].addonAbiVerified = true;
  assert.throws(() =>
    inspectNativeCapsuleCompletion(item.report, item.journal()),
  );
});

for (const alteration of ["none", "hide-blocked", "claim-all-loaded"]) {
  test(`mixed addon outcomes retain every locked binary (${alteration})`, () => {
    const results = [
      { path: "node_modules/a/native.node", status: "loaded", code: null },
      {
        path: "node_modules/b/native.node",
        status: "blocked",
        code: "ERR_DLOPEN_FAILED",
      },
      { path: "node_modules/c/native.node", status: "loaded", code: null },
    ];
    const item = evidence("addon-load", {
      results,
      loaded: [results[0].path, results[2].path],
      addonAbiVerified: false,
    });
    item.report.inventory.addons = results.map((row) => ({ path: row.path }));
    item.report.inventoryDigest = outcomeDigest(item.report.inventory);
    item.report.manifest.capsuleBinding.inventoryDigest =
      item.report.inventoryDigest;
    item.report.manifestDigest = evalDigest(
      Buffer.from(JSON.stringify(item.report.manifest)),
    );
    item.report.settlement.manifestDigest = item.report.manifestDigest.slice(7);
    item.rows.splice(
      1,
      0,
      ...results.flatMap((row) => [
        {
          stage: "addon-started",
          mode: "addon-load",
          pid: 1001,
          path: row.path,
        },
        {
          stage: row.status === "loaded" ? "addon-loaded" : "addon-blocked",
          mode: "addon-load",
          pid: 1001,
          path: row.path,
          code: row.code,
        },
      ]),
    );
    item.rows.forEach((row, index) => {
      row.sequence = index;
    });
    item.report.journalDigest = evalDigest(item.journal());
    if (alteration === "none")
      assert.equal(
        inspectNativeCapsuleCompletion(item.report, item.journal())
          .addonAbiVerified,
        false,
      );
    else {
      if (alteration === "hide-blocked") results.splice(1, 1);
      else item.rows.at(-1).addonAbiVerified = true;
      item.report.journalDigest = evalDigest(item.journal());
      assert.throws(() =>
        inspectNativeCapsuleCompletion(item.report, item.journal()),
      );
    }
  });
}

test("threads smoke must execute exactly one test with the frozen config", () => {
  const item = evidence("vitest-smoke", {
    executedTests: 1,
    pool: "threads",
    frozenConfigLoaded: true,
  });
  assert.equal(
    inspectNativeCapsuleCompletion(item.report, item.journal()).executedTests,
    1,
  );
  item.rows.at(-1).executedTests = 0;
  assert.throws(() =>
    inspectNativeCapsuleCompletion(item.report, item.journal()),
  );
});

test("fixed checker modes parse and retain the original config and explicit diagnostic pool", () => {
  for (const mode of [
    "package-import",
    "global-setup",
    "addon-load",
    "vitest-smoke",
  ]) {
    const source = nativeCapsuleCheckSource(mode, { addons: [] });
    assert.doesNotThrow(() => new vm.Script(source));
    assert.ok(source.includes("packages/cli/vitest.config.js"));
    assert.ok(source.includes("pool:'threads'"));
    assert.ok(source.includes("fs.fsyncSync(journal)"));
  }
  assert.throws(
    () => nativeCapsuleCheckSource("host-fallback", { addons: [] }),
    /unknown diagnostic mode/,
  );
});

test("an inventory JSON cannot be supplied as a staging ticket", () => {
  assert.throws(
    () =>
      inspectNativeCapsuleSource({
        inventory: { registryContentVerified: true },
      }),
    /absolute root required/,
  );
});

test("oversize journals are rejected before parsing", () => {
  const item = evidence();
  assert.throws(
    () => inspectNativeCapsuleCompletion(item.report, Buffer.alloc(65537)),
    /bounded native journal/,
  );
});

test("a replaced journal cannot keep its original evidence digest", () => {
  const item = evidence();
  item.report.journalDigest = "sha256:" + "0".repeat(64);
  assert.throws(
    () => inspectNativeCapsuleCompletion(item.report, item.journal()),
    /journal digest/,
  );
});

for (const stage of ["failed", "unknown"]) {
  test(`a complete-looking import cannot hide an intermediate ${stage} stage`, () => {
    const item = evidence();
    item.rows.splice(1, 0, { stage, pid: 1001, mode: "global-setup" });
    item.rows.forEach((row, index) => {
      row.sequence = index;
    });
    item.report.journalDigest = evalDigest(item.journal());
    assert.throws(
      () => inspectNativeCapsuleCompletion(item.report, item.journal()),
      /diagnostic stages/,
    );
  });
}

for (const variation of ["missing", "duplicate"]) {
  test(`Vitest cannot pass with a ${variation} actual start stage`, () => {
    const item = evidence("vitest-smoke", {
      executedTests: 1,
      pool: "threads",
      frozenConfigLoaded: true,
    });
    if (variation === "missing") item.rows.splice(3, 1);
    else item.rows.splice(3, 0, { ...item.rows[3] });
    item.rows.forEach((row, index) => {
      row.sequence = index;
    });
    item.report.journalDigest = evalDigest(item.journal());
    assert.throws(
      () => inspectNativeCapsuleCompletion(item.report, item.journal()),
      /Vitest smoke/,
    );
  });
}
