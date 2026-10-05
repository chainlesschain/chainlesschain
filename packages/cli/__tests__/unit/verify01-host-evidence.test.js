import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { evalDigest } from "../../src/lib/eval/evidence.js";
import { outcomeDigest } from "../../src/lib/eval/outcomes.js";
import {
  inspectIdeProtocol,
  importVerify01HostCapture,
} from "../../src/lib/eval/verify01-host-evidence.js";

const directory = new URL(
  "../../../../docs/research/cli/verify01-plan-2026-10-04/",
  import.meta.url,
);
const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(name, directory), "utf8"));
function fixture(entry = "vscode") {
  const bundle = {
    plan: read("plan.json"),
    catalog: read("tasks.json"),
    bindings: read("comparison-bindings.json"),
    expectedPlanDigest: fs
      .readFileSync(new URL("plan.sha256", directory), "utf8")
      .trim(),
  };
  const sample = bundle.plan.samples.find(
    (row) => row.kind === "task" && row.stratum === `win32-${entry}-volcengine`,
  );
  const task = bundle.catalog.tasks.find((row) => row.id === sample.taskId);
  const comparison = bundle.bindings.comparisons[sample.stratum];
  const bytes = Buffer.from("// test-only evaluator; must never be executed");
  const review = {
    planDigest: bundle.expectedPlanDigest,
    catalogDigest: outcomeDigest(bundle.catalog),
    projectCommit: bundle.catalog.projectCommit,
    tasks: bundle.catalog.tasks.map((task) => ({
      taskId: task.id,
      setup: { path: `review/${task.id}-setup.mjs`, digest: evalDigest(bytes) },
      check: { path: `review/${task.id}-check.mjs`, digest: evalDigest(bytes) },
      allowedChangedPaths: [...task.expectedFiles],
    })),
  };
  const preparation = {
    review,
    expectedReviewDigest: outcomeDigest(review),
    projectCommit: review.projectCommit,
    readReviewedFile: () => bytes,
  };
  const origin = Date.parse(bundle.plan.window.start) + 10000;
  const at = (ms) => new Date(origin + ms).toISOString();
  const raw = [
    [
      "output",
      {
        type: "system",
        subtype: "init",
        session_id: "capture-test",
        model: comparison.model,
        provider: comparison.provider,
        permission_mode: "acceptEdits",
        input_receipts: { version: 1 },
      },
    ],
    [
      "input",
      { type: "user", text: task.prompt, client_message_id: "test-input" },
    ],
    [
      "output",
      {
        type: "system",
        subtype: "input_accepted",
        session_id: "capture-test",
        client_message_id: "test-input",
        receipt: {
          sessionId: "capture-test",
          clientMessageId: "test-input",
          duplicate: false,
          eventHash: "d".repeat(64),
          inputDigest: evalDigest(
            Buffer.from(
              JSON.stringify({
                text: task.prompt,
                images: [],
                llm: null,
                worklogSessionId: null,
              }),
            ),
          ).slice(7),
        },
      },
    ],
    [
      "output",
      {
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "capture-test",
        result: "actual terminal fixture",
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        total_cost_usd: 0.1,
      },
    ],
    ["exit", { code: 0, signal: null, stdoutDrained: true }],
  ].map(([direction, event], index) => ({
    schema: "chainlesschain.ide-protocol-record/v1",
    generation: "test-only-generation",
    sequence: index + 1,
    at: at(index * 100),
    direction,
    event,
  }));
  const ui = [
    "submit",
    "background-tab",
    "return-tab",
    "final-result",
    "reload",
    "restored-result",
  ].map((action, index) => ({
    action,
    sampleId: sample.id,
    sessionId: "capture-test",
    at: at(index === 0 ? 50 : index * 100),
    ...(["final-result", "restored-result"].includes(action)
      ? { resultDigest: evalDigest(Buffer.from(raw[3].event.result)) }
      : {}),
  }));
  const target = bundle.bindings.matrix.find(
    (row) => row.id === `win32-${entry}`,
  );
  const artifacts = new Map();
  const pin = (name, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    artifacts.set(name, bytes);
    return { path: name, digest: evalDigest(bytes) };
  };
  const check = {
    taskId: task.id,
    reviewDigest: preparation.expectedReviewDigest,
    pass: true,
    detail: "test-only acceptance",
    changedFiles: [...task.expectedFiles],
    unrelatedChanges: [],
    process: {
      sourceDigest: evalDigest(bytes),
      exitCode: 0,
      signal: null,
      error: null,
      stdout: JSON.stringify({ pass: true, detail: "test-only acceptance" }),
    },
  };
  const manifest = {
    schema: "chainlesschain.verify01-host-capture/v1",
    sampleId: sample.id,
    planDigest: bundle.expectedPlanDigest,
    reviewDigest: preparation.expectedReviewDigest,
    projectCommit: review.projectCommit,
    sourceCommit: "c".repeat(40),
    entry,
    platform: target.platform,
    arch: target.arch,
    node: target.node,
    host: target.host,
    os: target.os,
    observedAt: at(700),
    elapsedMs: 700,
    retries: 0,
    manualRepairs: 0,
    runId: "test-only-import",
    protocol: pin("protocol.json", raw),
    ui: pin("ui.json", ui),
    check: pin("check.json", check),
    diff: pin(
      "diff.json",
      task.expectedFiles.map((file) => ({
        path: file,
        before: null,
        after: {
          type: "file",
          mode: 0o644,
          dependency: false,
          digest: evalDigest(Buffer.from("test-only artifact")),
          bytes: Buffer.byteLength("test-only artifact"),
          bytesBase64: Buffer.from("test-only artifact").toString("base64"),
        },
      })),
    ),
  };
  const importCapture = () =>
    importVerify01HostCapture(bundle, preparation, {
      manifest,
      expectedManifestDigest: outcomeDigest(manifest),
      readArtifact: (file) => artifacts.get(file),
      sourceCommit: manifest.sourceCommit,
      now: Date.parse(bundle.plan.window.end) + 1000,
    });
  return {
    bundle,
    preparation,
    manifest,
    raw,
    ui,
    check,
    comparison,
    task,
    artifacts,
    pin,
    importCapture,
  };
}

describe("existing actual-host evidence adapter (all records here are test fixtures)", () => {
  it.each(["vscode", "jetbrains"])(
    "imports %s records into the existing fixed-denominator report",
    (entry) => {
      const f = fixture(entry);
      const result = f.importCapture();
      expect(result.report.task).toMatchObject({
        planned: 36,
        observed: 1,
        missing: 35,
        succeeded: 1,
      });
      expect(result.report.firstRun).toMatchObject({ missing: 9 });
      expect(result.report.status).toBe("INSUFFICIENT_EVIDENCE");
      expect(result).toMatchObject({
        identityVerified: false,
        installationVerified: false,
        billingVerified: false,
      });
    },
  );
  it("keeps absent actual usage and cost unknown", () => {
    const f = fixture();
    delete f.raw[3].event.usage;
    delete f.raw[3].event.total_cost_usd;
    f.manifest.protocol = f.pin("protocol.json", f.raw);
    const result = f.importCapture();
    expect(result.history.runs[0].results[0]).toMatchObject({
      totalCostUsd: null,
      usage: null,
    });
    expect(result.report.task.succeeded).toBe(0);
  });
  it("retains a verified explicit failure rather than counting it as success", () => {
    const f = fixture();
    Object.assign(f.raw[3].event, {
      subtype: "error_max_turns",
      is_error: true,
    });
    f.manifest.protocol = f.pin("protocol.json", f.raw);
    const result = f.importCapture();
    expect(result.history.runs[0].results[0]).toMatchObject({
      executionSucceeded: false,
      pass: false,
      executionEvidence: { terminalVerified: true },
    });
    expect(result.report.task).toMatchObject({ observed: 1, succeeded: 0 });
  });
  it("retains an actual error-only persistence envelope and its interrupted UI journey", () => {
    const f = fixture();
    Object.assign(f.raw[3].event, {
      subtype: "error_persistence",
      is_error: true,
      code: "SESSION_WRITE_FAILED",
      error: "Session user turn was not durably persisted",
    });
    delete f.raw[3].event.result;
    delete f.raw[3].event.usage;
    delete f.raw[3].event.total_cost_usd;
    f.raw[4].event.code = 1;
    f.manifest.protocol = f.pin("protocol.json", f.raw);
    f.check.pass = false;
    f.check.changedFiles = [];
    f.check.process.stdout = JSON.stringify({
      pass: false,
      detail: "required artifact was not produced",
    });
    f.manifest.check = f.pin("check.json", f.check);
    f.manifest.diff = f.pin("diff.json", []);
    // The error itself prevented a restored result. Keep the actual actions,
    // rather than manufacturing reload/restoration records to count a failure.
    const actions = f.ui.slice(0, 4);
    actions[3].resultDigest = evalDigest(Buffer.from(f.raw[3].event.error));
    f.manifest.ui = f.pin("ui.json", actions);
    const result = f.importCapture();
    expect(result.history.runs[0].results[0]).toMatchObject({
      executionSucceeded: false,
      artifactCheckPassed: false,
      pass: false,
      executionEvidence: { terminalVerified: true, exitCode: 1 },
    });
    expect(result.report.task).toMatchObject({ observed: 1, succeeded: 0 });
    expect(result.report.task.totalCost).toBeNull();
    actions[3].resultDigest = evalDigest(Buffer.from("an unrelated UI error"));
    f.manifest.ui = f.pin("ui.json", actions);
    expect(f.importCapture).toThrow(/visible\/restored result/);
  });
  it("still requires all six UI steps for a successful terminal", () => {
    const f = fixture();
    f.manifest.ui = f.pin("ui.json", f.ui.slice(0, 4));
    expect(f.importCapture).toThrow(/journey is incomplete/);
  });
  it("accepts a UI submission that triggers cold initialization before the first protocol record", () => {
    const f = fixture();
    f.ui[0].at = new Date(Date.parse(f.raw[0].at) - 50).toISOString();
    f.manifest.elapsedMs += 50;
    f.manifest.ui = f.pin("ui.json", f.ui);
    expect(f.importCapture().report.task.observed).toBe(1);
  });
  it.each([
    [
      "sequence gap",
      (f) => {
        f.raw[2].sequence += 1;
      },
    ],
    [
      "stale generation",
      (f) => {
        f.raw[3].generation = "previous-child";
      },
    ],
    [
      "foreign session",
      (f) => {
        f.raw[3].event.session_id = "other-tab";
      },
    ],
    [
      "wrong model",
      (f) => {
        f.raw[0].event.model = "fallback-model";
      },
    ],
    [
      "wrong permission mode",
      (f) => {
        f.raw[0].event.permission_mode = "bypassPermissions";
      },
    ],
    [
      "wrong receipt",
      (f) => {
        f.raw[2].event.client_message_id = "old-input";
      },
    ],
    [
      "duplicate receipt",
      (f) => {
        f.raw[2].event.receipt.duplicate = true;
      },
    ],
    [
      "no negotiated receipt",
      (f) => {
        f.raw[0].event.input_receipts.version = 0;
      },
    ],
    [
      "undrained exit",
      (f) => {
        f.raw[4].event.stdoutDrained = false;
      },
    ],
    [
      "wrong frozen prompt",
      (f) => {
        f.raw[1].event.text = "a different task";
      },
    ],
    [
      "per-turn model override",
      (f) => {
        f.raw[1].event.llm = { provider: "ollama", model: "substitute" };
      },
    ],
    [
      "wrong receipt input digest",
      (f) => {
        f.raw[2].event.receipt.inputDigest = "e".repeat(64);
      },
    ],
    [
      "missing durable event hash",
      (f) => {
        delete f.raw[2].event.receipt.eventHash;
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    const f = fixture();
    mutate(f);
    expect(() =>
      inspectIdeProtocol(f.raw, {
        prompt: f.task.prompt,
        comparison: f.comparison,
      }),
    ).toThrow();
  });
  it.each([
    [
      "CLI claiming IDE",
      (f) => {
        f.manifest.entry = "cli";
      },
    ],
    [
      "missing captured run identity",
      (f) => {
        delete f.manifest.runId;
      },
    ],
    [
      "wrong native runtime",
      (f) => {
        f.manifest.node = "v22.22.2";
      },
    ],
    [
      "missing host journey",
      (f) => {
        f.ui.pop();
        f.manifest.ui = f.pin("ui.json", f.ui);
      },
    ],
    [
      "stale restored text",
      (f) => {
        f.ui[5].resultDigest = evalDigest(Buffer.from("stale"));
        f.manifest.ui = f.pin("ui.json", f.ui);
      },
    ],
    [
      "future UI action",
      (f) => {
        f.ui[5].at = "2030-01-01T00:00:00Z";
        f.manifest.ui = f.pin("ui.json", f.ui);
      },
    ],
    [
      "unpinned checker",
      (f) => {
        f.check.process.sourceDigest = "sha256:" + "a".repeat(64);
        f.manifest.check = f.pin("check.json", f.check);
      },
    ],
    [
      "unreviewed edit",
      (f) => {
        f.check.changedFiles.push("package.json");
        f.manifest.check = f.pin("check.json", f.check);
      },
    ],
    [
      "falsified check verdict",
      (f) => {
        f.check.process.stdout = JSON.stringify({
          pass: false,
          detail: "failure",
        });
        f.manifest.check = f.pin("check.json", f.check);
      },
    ],
    [
      "artifact changed after pinning",
      (f) => {
        f.artifacts.set("protocol.json", Buffer.from("[]"));
      },
    ],
    [
      "missing full diff",
      (f) => {
        delete f.manifest.diff;
      },
    ],
    [
      "incomplete changed-file body",
      (f) => {
        f.manifest.diff = f.pin("diff.json", [
          {
            path: f.task.expectedFiles[0],
            before: null,
            after: {
              type: "file",
              mode: 0o644,
              dependency: false,
              digest: evalDigest(Buffer.from("other")),
              bytes: 5,
              bytesBase64: Buffer.from("actual").toString("base64"),
            },
          },
        ]);
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    const f = fixture();
    mutate(f);
    expect(f.importCapture).toThrow();
  });
  it("imports a first-install early failure with all five stage receipts and no invented Eval run", () => {
    const f = fixture();
    const sample = f.bundle.plan.samples.find(
      (row) =>
        row.kind === "first-run" && row.stratum === "win32-vscode-volcengine",
    );
    Object.assign(f.manifest, {
      sampleId: sample.id,
      failureCause: "install",
      cost: null,
      firstRun: {
        cleanEnvironment: true,
        stages: Object.fromEntries(
          ["install", "configure", "authenticate", "tool", "artifact"].map(
            (stage) => [
              stage,
              {
                passed: false,
                receipt: f.pin(`${stage}.json`, {
                  error:
                    stage === "install"
                      ? "not available"
                      : "prerequisite failed",
                }),
              },
            ],
          ),
        ),
      },
    });
    delete f.manifest.protocol;
    delete f.manifest.ui;
    delete f.manifest.check;
    delete f.manifest.diff;
    const result = f.importCapture();
    expect(result.history.runs).toEqual([]);
    expect(result.observations[0]).toMatchObject({
      runId: null,
      cost: null,
      failureCause: "install",
    });
    expect(result.report.firstRun).toMatchObject({
      observed: 1,
      missing: 8,
      succeeded: 0,
    });
    f.manifest.invocation = f.pin("invocation.json", { taskId: sample.taskId });
    expect(f.importCapture).toThrow(/early stop/);
    delete f.manifest.invocation;
    delete f.manifest.firstRun.stages.configure.receipt;
    expect(f.importCapture).toThrow();
  });
  it("binds a completed CLI first-install to its own invocation, stdout, exit and full diff", () => {
    const f = fixture();
    const sample = f.bundle.plan.samples.find(
      (row) =>
        row.kind === "first-run" && row.stratum === "win32-cli-volcengine",
    );
    const task = f.bundle.catalog.tasks.find((row) => row.id === sample.taskId);
    const comparison = f.bundle.bindings.comparisons[sample.stratum];
    const target = f.bundle.bindings.matrix.find(
      (row) => row.id === "win32-cli",
    );
    const startedAt = f.raw[0].at;
    Object.assign(f.manifest, {
      sampleId: sample.id,
      entry: "cli",
      host: target.host,
      firstRun: {
        cleanEnvironment: true,
        stages: Object.fromEntries(
          ["install", "configure", "authenticate", "tool", "artifact"].map(
            (stage) => [
              stage,
              {
                passed: true,
                receipt: f.pin(`${stage}.json`, { testOnly: true, stage }),
              },
            ],
          ),
        ),
      },
    });
    delete f.manifest.protocol;
    delete f.manifest.ui;
    const invocation = {
      taskId: task.id,
      prompt: task.prompt,
      provider: comparison.provider,
      model: comparison.model,
      permissionMode: "acceptEdits",
      projectCommit: f.bundle.catalog.projectCommit,
      sourceCommit: f.manifest.sourceCommit,
      startedAt,
    };
    f.manifest.invocation = f.pin("invocation.json", invocation);
    const raw = [
      {
        type: "system",
        subtype: "init",
        model: comparison.model,
        provider: comparison.provider,
        permission_mode: "acceptEdits",
        session_id: "cli-first-run",
      },
      { ...f.raw[3].event, session_id: "cli-first-run" },
    ]
      .map(JSON.stringify)
      .join("\n");
    const streamBytes = Buffer.from(raw);
    f.artifacts.set("stream.jsonl", streamBytes);
    f.manifest.stream = {
      path: "stream.jsonl",
      digest: evalDigest(streamBytes),
    };
    f.manifest.exit = f.pin("exit.json", {
      code: 0,
      signal: null,
      finishedAt: f.raw[4].at,
    });
    f.check.taskId = task.id;
    f.check.changedFiles = [...task.expectedFiles];
    f.manifest.check = f.pin("check.json", f.check);
    f.manifest.diff = f.pin(
      "diff.json",
      task.expectedFiles.map((file) => ({
        path: file,
        before: null,
        after: {
          type: "file",
          mode: 0o644,
          dependency: false,
          digest: evalDigest(Buffer.from("test-only artifact")),
          bytes: Buffer.byteLength("test-only artifact"),
          bytesBase64: Buffer.from("test-only artifact").toString("base64"),
        },
      })),
    );
    const result = f.importCapture();
    expect(result.report.firstRun).toMatchObject({
      observed: 1,
      missing: 8,
      succeeded: 1,
    });
    expect(result.report.task.observed).toBe(0);
    expect(result.installationVerified).toBe(false);
    invocation.prompt = "different first-install task";
    f.manifest.invocation = f.pin("invocation.json", invocation);
    expect(f.importCapture).toThrow(/invocation/);
  });
});
