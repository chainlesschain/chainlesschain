import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureVerify01AgentBinding,
  loadVerify01Suite,
  runVerify01ReviewedProcess,
  seedVerify01Deliverables,
} from "../../src/lib/eval/verify01-execution.js";
import { runAgentHeadless } from "../helpers/test-model-egress.js";
import {
  makeHeadlessRunAgent,
  _deps as commandDeps,
} from "../../src/commands/eval.js";
import { EventEmitter } from "node:events";
import { getSuite } from "../../src/lib/eval/tasks.js";
import {
  runEvalSuite,
  _deps as runnerDeps,
} from "../../src/lib/eval/runner.js";
import { outcomeDigest } from "../../src/lib/eval/outcomes.js";
import {
  evalDigest,
  EVAL_EXECUTION_PROTOCOL,
  createEvalHistoryRecord,
} from "../../src/lib/eval/evidence.js";
import { validateVerify01Collection } from "../../src/lib/eval/verify01-contracts.js";

const roots = [];
const frozen = new URL(
  "../../../../docs/research/cli/verify01-plan-2026-10-04/",
  import.meta.url,
);
const json = (name) =>
  JSON.parse(fs.readFileSync(new URL(name, frozen), "utf8"));
function location() {
  const root = fs.mkdtempSync(
    join(
      (fs.realpathSync.native || fs.realpathSync)(tmpdir()),
      "cc-verify01-execution-",
    ),
  );
  roots.push(root);
  return root;
}
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value));
}
function fixture() {
  // Explicitly synthetic, independently pinned fixture. Never written to the
  // real frozen plan, review directory, history or observations.
  const root = location(),
    projectRoot = join(root, "project"),
    reviewRoot = join(root, "review"),
    planDir = join(root, "plan");
  [projectRoot, reviewRoot, planDir].forEach((dir) => fs.mkdirSync(dir));
  const git = (args) =>
    execFileSync("git", ["-C", projectRoot, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
  git(["init", "--template="]);
  fs.writeFileSync(
    join(projectRoot, "source.js"),
    "export const baseline = 'committed';\n",
  );
  git(["add", "source.js"]);
  git([
    "-c",
    "user.name=Eval Fixture",
    "-c",
    "user.email=eval-fixture@example.test",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--no-gpg-sign",
    "-m",
    "fixture only",
  ]);
  const commit = git(["rev-parse", "HEAD"]).trim();
  const plan = json("plan.json"),
    catalog = json("tasks.json"),
    bindings = json("comparison-bindings.json");
  plan.commitSha = catalog.projectCommit = commit;
  plan.window = {
    start: new Date(Date.now() - 60000).toISOString(),
    end: new Date(Date.now() + 3600000).toISOString(),
  };
  catalog.tasks.forEach((task) => {
    task.sourcePaths = ["source.js"];
    task.expectedFiles = [`result/${task.id}.txt`];
    task.prompt = `Offline fixture: write accepted to result/${task.id}.txt`;
  });
  for (const comparison of Object.values(bindings.comparisons)) {
    comparison.corpusDigest = outcomeDigest(catalog);
    comparison.runtime = {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    };
  }
  for (const sample of plan.samples)
    sample.comparisonDigest = outcomeDigest(
      bindings.comparisons[sample.stratum],
    );
  const planDigest = outcomeDigest(plan);
  writeJson(join(planDir, "plan.json"), plan);
  writeJson(join(planDir, "tasks.json"), catalog);
  writeJson(join(planDir, "comparison-bindings.json"), bindings);
  fs.writeFileSync(join(planDir, "plan.sha256"), planDigest);
  const review = {
    planDigest,
    catalogDigest: outcomeDigest(catalog),
    projectCommit: commit,
    tasks: [],
  };
  for (const task of catalog.tasks) {
    const setup = Buffer.from("console.log('offline setup');");
    const check = Buffer.from(
      `import fs from 'node:fs'; import path from 'node:path'; const pass = fs.readFileSync(path.join(process.argv[1], ${JSON.stringify(task.expectedFiles[0])}), 'utf8') === 'accepted'; const deadline=Number(process.argv[2]); if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error('missing outer deadline'); console.log(JSON.stringify({pass, detail: 'independent byte assertion', deadline}));`,
    );
    fs.writeFileSync(join(reviewRoot, `${task.id}-setup.js`), setup);
    fs.writeFileSync(join(reviewRoot, `${task.id}-check.js`), check);
    review.tasks.push({
      taskId: task.id,
      setup: { path: `${task.id}-setup.js`, digest: evalDigest(setup) },
      check: { path: `${task.id}-check.js`, digest: evalDigest(check) },
      allowedChangedPaths: task.expectedFiles,
    });
  }
  const reviewFile = join(root, "review.json");
  writeJson(reviewFile, review);
  const sample = plan.samples[0],
    comparison = bindings.comparisons[sample.stratum];
  const options = {
    planDir,
    planDigest,
    reviewFile,
    reviewDigest: outcomeDigest(review),
    reviewRoot,
    projectRoot,
    sampleIds: [sample.id],
    provider: comparison.provider,
    model: comparison.model,
  };
  return { root, options, plan, catalog, bindings, review, sample, commit };
}
function pinFixtureWindow(f, window) {
  f.plan.window = window;
  f.options.planDigest = outcomeDigest(f.plan);
  f.review.planDigest = f.options.planDigest;
  f.options.reviewDigest = outcomeDigest(f.review);
  writeJson(join(f.options.planDir, "plan.json"), f.plan);
  fs.writeFileSync(
    join(f.options.planDir, "plan.sha256"),
    f.options.planDigest,
  );
  writeJson(f.options.reviewFile, f.review);
}
async function runFixture(tasks, edit = () => {}) {
  return runEvalSuite(tasks, {
    cwdBase: location(),
    keepWorkspaces: true,
    runAgent: async ({ cwd, costBudgetUsd }) => {
      expect(costBudgetUsd).toBe(2);
      fs.mkdirSync(join(cwd, "result"), { recursive: true });
      fs.writeFileSync(join(cwd, "result", `${tasks[0].id}.txt`), "accepted");
      edit(cwd);
      return {
        ok: true,
        output: "synthetic offline terminal",
        totalCostUsd: null,
        executionEvidence: {
          protocol: EVAL_EXECUTION_PROTOCOL,
          exitCode: 0,
          signal: null,
          terminalVerified: true,
          observedFallback: false,
        },
      };
    },
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

describe("review-gated frozen eval execution", () => {
  it.each(["not-started", "expired", "insufficient-time"])(
    "refuses %s windows before checkout, setup or a model request",
    async (condition) => {
      const f = fixture(),
        now = Date.now();
      pinFixtureWindow(f, {
        start: new Date(
          condition === "not-started" ? now + 60000 : now - 3600000,
        ).toISOString(),
        end: new Date(
          condition === "expired"
            ? now - 1000
            : condition === "insufficient-time"
              ? now + f.sample.timeBudgetMs - 1000
              : now + 3600000,
        ).toISOString(),
      });
      const tasks = loadVerify01Suite(f.options),
        runAgent = vi.fn();
      const result = await runEvalSuite(tasks, {
        cwdBase: location(),
        keepWorkspaces: true,
        runAgent,
      });
      expect(result.failed).toBe(1);
      expect(runAgent).not.toHaveBeenCalled();
      expect(tasks.verification.receipts[0].setup).toBeNull();
      expect(tasks.verification.receipts[0].checkout).toBeUndefined();
    },
  );

  it("checks the execution window again when an already prepared task starts", async () => {
    const f = fixture(),
      tasks = loadVerify01Suite(f.options),
      runAgent = vi.fn();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(f.plan.window.end));
    const result = await runEvalSuite(tasks, {
      cwdBase: location(),
      keepWorkspaces: true,
      runAgent,
    });
    expect(result.failed).toBe(1);
    expect(runAgent).not.toHaveBeenCalled();
    expect(tasks.verification.receipts[0].setup).toBeNull();
  });

  it("rejects an expired saved agent binding immediately before launch", async () => {
    const f = fixture(),
      tasks = loadVerify01Suite(f.options),
      workspace = location();
    await tasks[0].setup(workspace, { remainingMs: () => 60000 });
    try {
      const binding = tasks[0].agentLaunchBinding(workspace);
      vi.spyOn(Date, "now").mockReturnValue(Date.parse(f.plan.window.end));
      expect(() =>
        captureVerify01AgentBinding(binding, workspace),
      ).toThrowError(
        expect.objectContaining({ code: "CC_VERIFY01_WINDOW_EXPIRED" }),
      );
    } finally {
      tasks[0].cleanup();
    }
  });

  it("keeps account credentials and Node hooks out of the independent checker", () => {
    vi.stubEnv("CC_API_KEY", "fixture-only-key");
    vi.stubEnv("GITHUB_TOKEN", "fixture-only-token");
    vi.stubEnv("NODE_OPTIONS", "--invalid-option");
    const root = location();
    const result = runVerify01ReviewedProcess(
      Buffer.from(
        "console.log(JSON.stringify({account:process.env.CC_API_KEY,github:process.env.GITHUB_TOKEN,options:process.env.NODE_OPTIONS}));",
      ),
      root,
      root,
      "check",
      10000,
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
  });

  it("prepares only new empty regular deliverables and rejects existing, linked and escaping paths", () => {
    const directory = location(),
      budget = { remainingMs: () => 10000 };
    fs.writeFileSync(join(directory, "source.js"), "source");
    const seed = seedVerify01Deliverables(
      directory,
      ["nested/answer.test.js"],
      budget,
    );
    expect(seed).toMatchObject([
      {
        path: "nested/answer.test.js",
        before: null,
        bytes: 0,
        digest: evalDigest(Buffer.alloc(0)),
        requestedMode: 0o600,
      },
    ]);
    expect(
      fs.readFileSync(join(directory, "nested/answer.test.js")),
    ).toHaveLength(0);
    if (process.platform !== "win32")
      expect(
        fs.statSync(join(directory, "nested/answer.test.js")).mode & 0o777,
      ).toBe(0o600);
    expect(() =>
      seedVerify01Deliverables(directory, ["source.js"], budget),
    ).toThrow();
    expect(() =>
      seedVerify01Deliverables(directory, ["../outside.test.js"], budget),
    ).toThrow();
    const outside = location();
    fs.symlinkSync(
      outside,
      join(directory, "alias"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() =>
      seedVerify01Deliverables(directory, ["alias/answer.test.js"], budget),
    ).toThrow(/canonical|unaliased|link/);
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(fs.readFileSync(join(directory, "source.js"), "utf8")).toBe(
      "source",
    );
  });

  it("does not seed or launch after reviewed setup failure", async () => {
    const f = fixture();
    const bytes = Buffer.from("throw new Error('setup failed before model');");
    fs.writeFileSync(
      join(f.options.reviewRoot, f.review.tasks[0].setup.path),
      bytes,
    );
    f.review.tasks[0].setup.digest = evalDigest(bytes);
    writeJson(f.options.reviewFile, f.review);
    f.options.reviewDigest = outcomeDigest(f.review);
    const tasks = loadVerify01Suite(f.options),
      agent = vi.fn();
    const result = await runEvalSuite(tasks, {
      cwdBase: location(),
      keepWorkspaces: true,
      runAgent: agent,
    });
    expect(result.passed).toBe(0);
    expect(agent).not.toHaveBeenCalled();
    expect(tasks.verification.receipts[0].deliverablePreparation).toEqual([]);
    expect(
      fs.existsSync(
        join(tasks.verification.receipts[0].workspace, "result/verify-01.txt"),
      ),
    ).toBe(false);
  });

  it("binds sequential tasks to independent immutable scopes and distinct user/config homes", async () => {
    const f = fixture();
    f.options.sampleIds = f.plan.samples
      .filter(
        (sample) =>
          sample.kind === "task" && sample.stratum === f.sample.stratum,
      )
      .slice(0, 2)
      .map((sample) => sample.id);
    const tasks = loadVerify01Suite(f.options),
      bindings = [];
    const canonicalBase = location(),
      aliasedBase = join(location(), "temporary-root");
    fs.symlinkSync(
      canonicalBase,
      aliasedBase,
      process.platform === "win32" ? "junction" : "dir",
    );
    const previousHome = process.env.CHAINLESSCHAIN_HOME;
    const result = await runEvalSuite(tasks, {
      cwdBase: aliasedBase,
      keepWorkspaces: true,
      runAgent: async ({ cwd, verify01Binding }) => {
        const binding = captureVerify01AgentBinding(verify01Binding, cwd);
        bindings.push(binding);
        expect(Object.isFrozen(binding)).toBe(true);
        expect(Object.isFrozen(binding.allowedPaths)).toBe(true);
        expect(Object.isFrozen(binding.environment)).toBe(true);
        expect(binding.environment.HOME).not.toBe(
          binding.environment.CHAINLESSCHAIN_HOME,
        );
        expect(
          JSON.parse(binding.environment.CC_FORMAL_QUALITY_EVAL_ALLOWED_FILES),
        ).toEqual(binding.allowedPaths);
        expect(() => captureVerify01AgentBinding({ ...binding }, cwd)).toThrow(
          /unrecognized/,
        );
        expect(() => captureVerify01AgentBinding(binding, location())).toThrow(
          /workspace/,
        );
        fs.writeFileSync(join(cwd, binding.allowedPaths[0]), "accepted");
        return { ok: true, output: "synthetic task only" };
      },
    });
    expect(result.passed).toBe(2);
    expect(bindings[0].root).not.toBe(bindings[1].root);
    expect(bindings[0].allowedPaths).not.toEqual(bindings[1].allowedPaths);
    expect(process.env.CHAINLESSCHAIN_HOME).toBe(previousHome);
    for (const binding of bindings)
      expect(fs.existsSync(binding.root)).toBe(false);
    for (const receipt of tasks.verification.receipts) {
      expect(receipt.diff[0].before).toBeNull();
      expect(receipt.agentDiff[0].before.bytes).toBe(0);
      expect(receipt.agentBinding.profileRemoved).toBe(true);
    }
  });

  it("retains reviewed source edits without replacing source files with seeds", async () => {
    const f = fixture();
    f.review.tasks[0].allowedChangedPaths = [
      "result/verify-01.txt",
      "source.js",
    ];
    writeJson(f.options.reviewFile, f.review);
    f.options.reviewDigest = outcomeDigest(f.review);
    const tasks = loadVerify01Suite(f.options);
    const result = await runEvalSuite(tasks, {
      cwdBase: location(),
      keepWorkspaces: true,
      runAgent: async ({ cwd, verify01Binding }) => {
        expect(verify01Binding.allowedPaths).toContain("source.js");
        expect(fs.readFileSync(join(cwd, "source.js"), "utf8")).toContain(
          "committed",
        );
        fs.writeFileSync(
          join(cwd, "source.js"),
          "export const baseline = 'reviewed edit';\n",
        );
        fs.writeFileSync(join(cwd, "result/verify-01.txt"), "accepted");
        return { ok: true, output: "reviewed source edit" };
      },
    });
    expect(result.passed).toBe(1);
    const receipt = tasks.verification.receipts[0];
    expect(receipt.deliverablePreparation.map((seed) => seed.path)).toEqual([
      "result/verify-01.txt",
    ]);
    expect(
      receipt.diff.find((change) => change.path === "source.js").before,
    ).not.toBeNull();
  });

  it("refuses the actual formal command child even with a valid immutable binding and selected credential", async () => {
    const f = fixture(),
      tasks = loadVerify01Suite(f.options);
    const spawn = vi.spyOn(commandDeps, "spawn").mockImplementation(() => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 1234;
      queueMicrotask(() => child.emit("close", 1, null));
      return child;
    });
    const result = await runEvalSuite(tasks, {
      cwdBase: location(),
      keepWorkspaces: true,
      runAgent: makeHeadlessRunAgent({
        provider: f.options.provider,
        model: f.options.model,
        requireVerify01Binding: true,
        env: {
          CC_FORMAL_QUALITY_EVAL_ALLOWED_FILES: '["wrong.txt"]',
          CHAINLESSCHAIN_HOME: "wrong-home",
          CC_API_KEY: "fixture-only-key",
          NODE_OPTIONS: "--invalid-option",
          GITHUB_TOKEN: "unrelated",
          CC_FALLBACK_MODEL: "unreviewed",
          NPM_TOKEN: "unrelated",
          ...(process.platform === "win32" ? { Path: "fixture-path" } : {}),
        },
      }),
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toContain("not yet all routed");
    expect(() =>
      makeHeadlessRunAgent({ requireVerify01Binding: true })({
        cwd: location(),
        prompt: "unbound",
      }),
    ).toThrow(/task-specific/);
  });

  it("starts real headless on a new seeded deliverable and still blocks out-of-scope writes", async () => {
    const f = fixture(),
      tasks = loadVerify01Suite(f.options),
      emitted = [];
    const result = await runEvalSuite(tasks, {
      cwdBase: location(),
      keepWorkspaces: true,
      runAgent: async ({ cwd, verify01Binding }) => {
        const binding = captureVerify01AgentBinding(verify01Binding, cwd);
        let call = 0;
        const headless = await runAgentHeadless(
          {
            prompt:
              "Offline fixture: write accepted to the authorized deliverable",
            cwd,
            provider: f.options.provider,
            model: f.options.model,
            outputFormat: "stream-json",
            ephemeral: true,
            permissionMode: "acceptEdits",
            hermeticExecution: true,
            exactToolNames: true,
            allowedTools: ["write_file", "read_file"],
            maxTurns: 4,
            fileMutationScope: {
              exact: true,
              worktreeRoot: binding.workspace,
              allowedPaths: binding.allowedPaths,
            },
          },
          {
            writeOut: (line) => emitted.push(line),
            writeErr: () => {},
            chatFn: async () => {
              call++;
              return {
                message:
                  call <= 2
                    ? {
                        role: "assistant",
                        content: "",
                        tool_calls: [
                          {
                            id: `fixture-${call}`,
                            type: "function",
                            function: {
                              name: "write_file",
                              arguments: JSON.stringify({
                                path:
                                  call === 1
                                    ? binding.allowedPaths[0]
                                    : "source.js",
                                content:
                                  call === 1 ? "accepted" : "must not write",
                              }),
                            },
                          },
                        ],
                      }
                    : { role: "assistant", content: "done" },
                usage: { input_tokens: 7, output_tokens: 3 },
              };
            },
          },
        );
        expect(call).toBe(3);
        expect(headless.exitCode).toBe(0);
        expect(fs.readFileSync(join(cwd, "source.js"), "utf8")).toContain(
          "committed",
        );
        return { ok: headless.exitCode === 0, output: emitted.join("") };
      },
    });
    expect(result.passed, JSON.stringify(result.results)).toBe(1);
    const events = emitted.join("").trim().split("\n").map(JSON.parse);
    expect(
      events.find(
        (event) => event.type === "tool_result" && event.id === "fixture-1",
      ).is_error,
    ).toBe(false);
    expect(
      events.find(
        (event) => event.type === "tool_result" && event.id === "fixture-2",
      ).is_error,
    ).toBe(true);
  }, 30000);
  it("fingerprints dependency bodies separately, captures changes without base64 copies, and refuses dependency edits", async () => {
    const f = fixture();
    const setup = Buffer.from(
      "import fs from 'node:fs'; import path from 'node:path'; const dir = path.join(process.argv[1], 'node_modules/pkg'); fs.mkdirSync(dir, {recursive:true}); const fd = fs.openSync(path.join(dir, 'large.bin'), 'w'); fs.ftruncateSync(fd, 17 * 1024 * 1024); fs.closeSync(fd);",
    );
    fs.writeFileSync(
      join(f.options.reviewRoot, f.review.tasks[0].setup.path),
      setup,
    );
    f.review.tasks[0].setup.digest = evalDigest(setup);
    writeJson(f.options.reviewFile, f.review);
    f.options.reviewDigest = outcomeDigest(f.review);
    const tasks = loadVerify01Suite(f.options);
    const summary = await runFixture(tasks, (cwd) =>
      fs.writeFileSync(
        join(cwd, "node_modules/pkg/large.bin"),
        "changed dependency",
      ),
    );
    expect(summary.passed).toBe(0);
    expect(summary.results[0].unrelatedChanges).toEqual([
      "node_modules/pkg/large.bin",
    ]);
    const receipt = tasks.verification.receipts[0];
    expect(receipt.dependencyBoundary.before.bytes).toBe(17 * 1024 * 1024);
    expect(
      receipt.diff.find((change) => change.path.includes("node_modules"))
        .before,
    ).toMatchObject({ dependency: true, bytesBase64: null });
    expect(receipt.check).toBeNull();
  });
  it("shares one deadline across setup, agent and check and retains the exhausted phase", async () => {
    const original = runnerDeps.monotonicNow;
    let tick = 0;
    runnerDeps.monotonicNow = () => tick;
    try {
      const f = fixture(),
        tasks = loadVerify01Suite(f.options);
      const setup = tasks[0].setup;
      tasks[0].setup = async (...args) => {
        await setup(...args);
        tick += 1000;
      };
      const summary = await runEvalSuite(tasks, {
        cwdBase: location(),
        keepWorkspaces: true,
        runAgent: async ({ timeoutMs }) => {
          expect(timeoutMs).toBe(f.sample.timeBudgetMs - 1000);
          tick = f.sample.timeBudgetMs + 1;
          return { ok: true, output: "late result" };
        },
      });
      expect(summary.passed).toBe(0);
      expect(summary.results[0].failurePhase).toBe("agent");
      expect(tasks.verification.receipts[0]).toMatchObject({
        failure: { phase: "agent", code: "EVAL_TOTAL_TIMEOUT" },
        check: null,
        execution: { output: "late result" },
      });
    } finally {
      runnerDeps.monotonicNow = original;
    }
  });
  it("recognizes the named suite but refuses to launch without external review bindings", () => {
    expect(() => getSuite("verify01-plan-2026-10-04")).toThrow(
      /requires planDir/,
    );
    expect(() => getSuite("verify01-project-36")).toThrow(/requires planDir/);
    expect(getSuite("builtin").length).toBeGreaterThan(0);
  });
  it("runs real setup/check processes against Git object bytes and captures full diff without granting cost evidence", async () => {
    const f = fixture();
    // Dirty and untracked source files must not enter the frozen checkout.
    fs.writeFileSync(
      join(f.options.projectRoot, "source.js"),
      "uncommitted work",
    );
    fs.writeFileSync(
      join(f.options.projectRoot, "secret.txt"),
      "not a committed artifact",
    );
    const tasks = getSuite("verify01-plan-2026-10-04", { verify01: f.options });
    const summary = await runFixture(tasks, (cwd) => {
      expect(fs.readFileSync(join(cwd, "source.js"), "utf8")).toContain(
        "committed",
      );
      expect(fs.existsSync(join(cwd, "secret.txt"))).toBe(false);
      expect(fs.existsSync(join(cwd, ".git"))).toBe(false);
    });
    expect(summary.passed).toBe(1);
    expect(summary.results[0].totalCostUsd).toBeNull();
    const receipt = tasks.verification.receipts[0];
    expect(receipt.setup.exitCode).toBe(0);
    expect(receipt.check.stdout).toContain("independent byte assertion");
    expect(JSON.parse(receipt.check.stdout).deadline).toBeGreaterThan(
      Date.now(),
    );
    expect(receipt.diff).toHaveLength(1);
    expect(
      Buffer.from(receipt.diff[0].after.bytesBase64, "base64").toString(),
    ).toBe("accepted");
    expect(tasks.verification.population).toEqual({ tasks: 36, firstRuns: 9 });
    expect(tasks.verification.productionAttested).toBe(false);
    const ranAt = new Date(
      Date.parse(f.plan.window.start) + 1000,
    ).toISOString();
    const record = createEvalHistoryRecord(summary, {
      comparison: tasks.verification.comparison,
      label: f.commit,
      ranAt,
      runId: "offline-fixture-only",
    });
    const observation = {
      sampleId: f.sample.id,
      runId: record.runId,
      observedAt: ranAt,
      retries: 0,
      manualRepairs: 0,
      cost: null,
      elapsedMs: summary.results[0].ms,
    };
    // Unknown billing stays unknown in the collector; even a passing offline
    // execution does not complete or improve the 36+9 outcome denominator.
    const report = validateVerify01Collection(
      {
        plan: f.plan,
        catalog: f.catalog,
        bindings: f.bindings,
        expectedPlanDigest: f.options.planDigest,
      },
      {
        review: f.review,
        expectedReviewDigest: f.options.reviewDigest,
        projectCommit: f.commit,
        readReviewedFile: (file) =>
          fs.readFileSync(join(f.options.reviewRoot, file)),
      },
      {
        sampleIds: [f.sample.id],
        sourceCommit: f.commit,
        history: { runs: [record], issues: [] },
        observations: [observation],
        now: Date.parse(f.plan.window.end) + 1000,
      },
    );
    expect(report.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(report.task.missing).toBe(35);
    expect(report.firstRun.missing).toBe(9);
  });
  it("refuses drifted plan/review/artifacts/runtime and mismatched actual Git identity before setup", () => {
    const f = fixture();
    for (const overrides of [
      { planDigest: `sha256:${"a".repeat(64)}` },
      { reviewDigest: `sha256:${"a".repeat(64)}` },
      { model: "wrong-model" },
    ])
      expect(() => loadVerify01Suite({ ...f.options, ...overrides })).toThrow();
    fs.appendFileSync(
      join(f.options.reviewRoot, "verify-01-check.js"),
      "\nthrow Error('changed');",
    );
    expect(() => loadVerify01Suite(f.options)).toThrow(
      /reviewed check file changed/,
    );
    expect(fs.readdirSync(f.options.projectRoot)).not.toContain("result");
  });
  it("refuses CLI impersonation of IDE or first-install samples and mixed-stratum runs", () => {
    const f = fixture();
    expect(() =>
      loadVerify01Suite({ ...f.options, sampleIds: [f.plan.samples[1].id] }),
    ).toThrow(/IDE/);
    expect(() =>
      loadVerify01Suite({
        ...f.options,
        sampleIds: [f.plan.samples.find((row) => row.kind === "first-run").id],
      }),
    ).toThrow(/installation/);
    expect(() =>
      loadVerify01Suite({
        ...f.options,
        sampleIds: [f.plan.samples[0].id, f.plan.samples[1].id],
      }),
    ).toThrow(/stratum/);
  });
  it("rejects unreviewed changes before running acceptance and preserves the workspace and raw diff", async () => {
    const f = fixture(),
      tasks = loadVerify01Suite(f.options);
    const summary = await runFixture(tasks, (cwd) =>
      fs.writeFileSync(join(cwd, "source.js"), "unreviewed"),
    );
    expect(summary.passed).toBe(0);
    expect(summary.results[0].unrelatedChanges).toEqual(["source.js"]);
    expect(tasks.verification.receipts[0].check).toBeNull();
    expect(tasks.verification.receipts[0].diff).toHaveLength(2);
    expect(fs.existsSync(tasks.verification.receipts[0].workspace)).toBe(true);
  });
  it("uses the prevalidated evaluator bytes rather than a task-time replacement", async () => {
    const f = fixture(),
      tasks = loadVerify01Suite(f.options);
    fs.writeFileSync(
      join(f.options.reviewRoot, "verify-01-check.js"),
      "throw Error('untrusted replacement');",
    );
    const summary = await runFixture(tasks);
    expect(summary.passed).toBe(1);
    expect(tasks.verification.receipts[0].check.sourceDigest).toBe(
      f.review.tasks[0].check.digest,
    );
  });
  it("retains missing terminal and unknown cost from dry-run/no-op execution without inventing either", async () => {
    const f = fixture(),
      tasks = loadVerify01Suite(f.options);
    const summary = await runEvalSuite(tasks, {
      cwdBase: location(),
      keepWorkspaces: true,
      runAgent: async () => ({ ok: true, output: "no-op" }),
    });
    expect(summary.passed).toBe(0);
    expect(summary.results[0].executionEvidence).toBeNull();
    expect(summary.results[0].totalCostUsd).toBeNull();
    expect(tasks.verification.receipts[0].execution.evidence).toBeNull();
    expect(summary.results[0].error).toMatch(/empty seeds/);
    expect(tasks.verification.receipts[0].check).toBeNull();
    expect(tasks.verification.receipts[0].diff[0]).toMatchObject({
      before: null,
      after: { bytes: 0 },
    });
  });
});
