import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  createEvalComparison,
  evalDigest,
} from "../../src/lib/eval/evidence.js";
import { outcomeDigest } from "../../src/lib/eval/outcomes.js";
import {
  prepareVerify01HostTask,
  finishVerify01HostTask,
} from "../../src/lib/eval/verify01-host-capture.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
const planRoot = new URL(
  "../../../../docs/research/cli/verify01-plan-2026-10-04/",
  import.meta.url,
);
const readPlan = (name) =>
  JSON.parse(fs.readFileSync(new URL(name, planRoot), "utf8"));
const write = (root, file, text) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

/** Synthetic plan and Git repository for orchestration tests. All subprocesses,
 * Git blobs, setup/check bytes and workspace scans run for real. No IDE/provider
 * is represented by these protocol fixtures or by the generated reports. */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-host-capture-test-"));
  roots.push(root);
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot);
  const git = (args) =>
    execFileSync("git", ["-C", projectRoot, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
  git(["init", "--quiet"]);
  write(projectRoot, "baseline.txt", "committed baseline");
  git(["add", "baseline.txt"]);
  git([
    "-c",
    "user.name=Capture Test",
    "-c",
    "user.email=capture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "test fixture",
  ]);
  const projectCommit = git(["rev-parse", "HEAD"]).trim();
  write(projectRoot, "untracked-private.txt", "must not enter task checkout");
  const bundle = {
    plan: readPlan("plan.json"),
    catalog: readPlan("tasks.json"),
    bindings: readPlan("comparison-bindings.json"),
  };
  bundle.plan.commitSha = bundle.catalog.projectCommit = projectCommit;
  bundle.plan.window = {
    start: new Date(Date.now() - 60000).toISOString(),
    end: new Date(Date.now() + 3600000).toISOString(),
  };
  for (const target of bundle.bindings.matrix) {
    target.node = process.version;
    if (target.platform === process.platform) target.arch = process.arch;
  }
  for (const [key, comparison] of Object.entries(bundle.bindings.comparisons)) {
    const target = bundle.bindings.matrix.find((row) =>
      key.startsWith(`${row.platform}-${row.entry}-`),
    );
    bundle.bindings.comparisons[key] = createEvalComparison({
      ...comparison,
      context: comparison.declared,
      corpusDigest: outcomeDigest(bundle.catalog),
      platform: target.platform,
      arch: target.arch,
      node: target.node,
    });
  }
  for (const sample of bundle.plan.samples)
    sample.comparisonDigest = outcomeDigest(
      bundle.bindings.comparisons[sample.stratum],
    );
  bundle.expectedPlanDigest = outcomeDigest(bundle.plan);
  const sample = bundle.plan.samples.find(
    (row) =>
      row.kind === "task" &&
      row.stratum === `${process.platform}-vscode-volcengine`,
  );
  const task = bundle.catalog.tasks.find((row) => row.id === sample.taskId);
  const comparison = bundle.bindings.comparisons[sample.stratum];
  const artifacts = new Map();
  const review = {
    planDigest: bundle.expectedPlanDigest,
    catalogDigest: outcomeDigest(bundle.catalog),
    projectCommit,
    tasks: bundle.catalog.tasks.map((entry) => {
      const setup = Buffer.from(
        "import fs from 'node:fs'; import path from 'node:path'; fs.mkdirSync(path.join(process.argv[1],'node_modules')); fs.writeFileSync(path.join(process.argv[1],'node_modules','boundary.txt'),'dependency');",
      );
      const check = Buffer.from(
        `import fs from 'node:fs'; import path from 'node:path'; console.log(JSON.stringify({pass:${JSON.stringify(entry.expectedFiles)}.every(file=>fs.existsSync(path.join(process.argv[1],file)) && fs.readFileSync(path.join(process.argv[1],file),'utf8')==='candidate'), detail:'synthetic acceptance with real subprocess'}));`,
      );
      const setupPath = `${entry.id}-setup.mjs`,
        checkPath = `${entry.id}-check.mjs`;
      artifacts.set(setupPath, setup);
      artifacts.set(checkPath, check);
      return {
        taskId: entry.id,
        setup: { path: setupPath, digest: evalDigest(setup) },
        check: { path: checkPath, digest: evalDigest(check) },
        allowedChangedPaths: [...entry.expectedFiles, ...entry.sourcePaths],
      };
    }),
  };
  const preparation = {
    review,
    expectedReviewDigest: outcomeDigest(review),
    projectCommit,
    readReviewedFile: (file) => artifacts.get(file),
  };
  const reviewRoot = path.join(root, "review");
  fs.mkdirSync(reviewRoot);
  const options = {
    sampleId: sample.id,
    projectRoot,
    workspace: path.join(root, "workspace"),
    captureRoot: path.join(root, "capture"),
    reviewRoot,
    sourceCommit: "c".repeat(40),
    os: bundle.bindings.matrix.find(
      (row) => row.id === `${process.platform}-vscode`,
    ).os,
  };
  const prepare = () => prepareVerify01HostTask(bundle, preparation, options);
  function rawHost() {
    const at = new Date().toISOString();
    const records = [
      [
        "output",
        {
          type: "system",
          subtype: "init",
          session_id: "synthetic-host",
          provider: comparison.provider,
          model: comparison.model,
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
          session_id: "synthetic-host",
          client_message_id: "test-input",
          receipt: {
            sessionId: "synthetic-host",
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
          session_id: "synthetic-host",
          result: "synthetic terminal",
        },
      ],
      ["exit", { code: 0, signal: null, stdoutDrained: true }],
    ].map(([direction, event], index) => ({
      schema: "chainlesschain.ide-protocol-record/v1",
      generation: "synthetic-generation",
      sequence: index + 1,
      at,
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
    ].map((action) => ({
      action,
      sampleId: sample.id,
      sessionId: "synthetic-host",
      at,
      ...(["final-result", "restored-result"].includes(action)
        ? { resultDigest: evalDigest(Buffer.from("synthetic terminal")) }
        : {}),
    }));
    write(options.captureRoot, "protocol.json", JSON.stringify(records));
    write(options.captureRoot, "ui.json", JSON.stringify(ui));
  }
  const finish = (prepared) =>
    finishVerify01HostTask(bundle, preparation, {
      ...options,
      state: prepared.state,
      expectedStateDigest: prepared.stateDigest,
    });
  return { root, bundle, preparation, options, task, prepare, finish, rawHost };
}

describe("actual host preparation and acceptance assembly", () => {
  it("materializes committed blobs, preserves full diffs and keeps missing cost unknown", async () => {
    const f = fixture(),
      prepared = await f.prepare();
    expect(
      fs.existsSync(path.join(f.options.workspace, "untracked-private.txt")),
    ).toBe(false);
    expect(
      fs.readFileSync(path.join(f.options.workspace, "baseline.txt"), "utf8"),
    ).toBe("committed baseline");
    for (const file of f.task.expectedFiles)
      write(f.options.workspace, file, "candidate");
    f.rawHost();
    const result = f.finish(prepared);
    expect(result.imported.history.runs).toHaveLength(1);
    expect(result.imported.observations[0].cost).toBeNull();
    expect(result.imported.productionAttested).toBe(false);
    expect(result.imported.report.status).toBe("INSUFFICIENT_EVIDENCE");
    const changes = JSON.parse(
      fs.readFileSync(path.join(f.options.captureRoot, "diff.json")),
    );
    expect(changes.map((row) => row.path)).toEqual(
      [...f.task.expectedFiles].sort(),
    );
    expect(Buffer.from(changes[0].after.bytesBase64, "base64").toString()).toBe(
      "candidate",
    );
  });

  it.each(["node_modules/boundary.txt", "unexpected.txt"])(
    "rejects unreviewed mutation %s and preserves the complete diff",
    async (file) => {
      const f = fixture(),
        prepared = await f.prepare();
      f.rawHost();
      write(f.options.workspace, file, "changed");
      expect(() => f.finish(prepared)).toThrow(/unreviewed\/dependency/u);
      expect(
        JSON.parse(
          fs.readFileSync(path.join(f.options.captureRoot, "diff.json")),
        )[0].path,
      ).toBe(file);
      expect(
        fs.existsSync(path.join(f.options.captureRoot, "capture.json")),
      ).toBe(false);
    },
  );

  it("rejects changed before bodies and modified state without replacing evidence", async () => {
    const f = fixture(),
      prepared = await f.prepare();
    f.rawHost();
    const index = JSON.parse(
      fs.readFileSync(
        path.join(
          f.options.captureRoot,
          prepared.state.baseline.indexes[0].path,
        ),
      ),
    );
    write(
      f.options.captureRoot,
      index.find((row) => row.path === "baseline.txt").blob,
      "tampered",
    );
    expect(() => f.finish(prepared)).toThrow(/before body/u);
    const changed = { ...prepared, state: { ...prepared.state, deadline: 1 } };
    expect(() => f.finish(changed)).toThrow(/binding/u);
    expect(
      fs.existsSync(path.join(f.options.captureRoot, "capture.json")),
    ).toBe(false);
  });

  it("rejects an elapsed task deadline before starting the acceptance process", async () => {
    const f = fixture(),
      prepared = await f.prepare();
    f.rawHost();
    prepared.state.startedAt = new Date(Date.now() - 2000).toISOString();
    prepared.state.deadline = Date.now() - 1;
    prepared.stateDigest = outcomeDigest(prepared.state);
    expect(() => f.finish(prepared)).toThrow(/deadline exhausted/u);
    expect(
      fs.existsSync(path.join(f.options.captureRoot, "check-process.json")),
    ).toBe(false);
  });

  it("does not publish an imported capture when protocol records have a gap", async () => {
    const f = fixture(),
      prepared = await f.prepare();
    f.rawHost();
    const file = path.join(f.options.captureRoot, "protocol.json");
    const records = JSON.parse(fs.readFileSync(file));
    records.splice(2, 1);
    fs.writeFileSync(file, JSON.stringify(records));
    expect(() => f.finish(prepared)).toThrow(/sequence/u);
    expect(
      fs.existsSync(path.join(f.options.captureRoot, "check-process.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(f.options.captureRoot, "host-import.json")),
    ).toBe(false);
  });

  it("retains a real failing check verdict and refuses stale attempt reuse", async () => {
    const f = fixture(),
      prepared = await f.prepare();
    f.rawHost();
    const result = f.finish(prepared);
    expect(result.imported.history.runs[0].results[0].pass).toBe(false);
    expect(result.imported.history.runs[0].results[0].totalCostUsd).toBeNull();
    await expect(f.prepare()).rejects.toThrow(/must be new/u);
  });

  it("refuses a declared Node version different from the actual execution runtime before setup", async () => {
    const f = fixture();
    f.bundle.bindings.matrix.find(
      (row) => row.id === `${process.platform}-vscode`,
    ).node = "v0.0.0";
    await expect(f.prepare()).rejects.toThrow(/actual capture runtime/u);
    expect(fs.existsSync(f.options.workspace)).toBe(false);
  });
});
