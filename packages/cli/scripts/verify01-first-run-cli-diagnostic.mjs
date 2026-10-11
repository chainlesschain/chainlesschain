#!/usr/bin/env node
/** Independent diagnostic only. Never emits formal observations or edits a plan. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runDiagnostic as installPublic } from "./verify01-public-install-diagnostic.mjs";
import {
  DIAGNOSTIC,
  modelEnvironment,
  inspectModelTrace,
  redactDiagnostic,
} from "./verify01-volcengine-task-diagnostic.mjs";
import { generateReviewPack } from "./verify01-review-pack.mjs";
import {
  reviewEnvironment,
  REVIEW_IMAGE,
  runReviewStage,
} from "./verify01-review-runtime.mjs";
import {
  PRICING_SEMANTIC_MUTANTS,
  classifyPricingReceipt,
} from "./verify01-review-pricing-diagnostic.mjs";
import {
  snapshotVerify01Workspace,
  diffVerify01Workspace,
  seedVerify01Deliverables,
} from "../src/lib/eval/verify01-execution.js";

const SELF = fileURLToPath(import.meta.url);
const REPOSITORY = path.resolve(path.dirname(SELF), "../../..");
const PLAN = path.join(
  REPOSITORY,
  "docs/research/cli/verify01-plan-2026-10-04",
);
export const STAGES = Object.freeze([
  "install",
  "configure",
  "authenticate",
  "tool",
  "artifact",
]);
const stamp = () => new Date().toISOString();
const digest = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const save = (file, value, secret = "") => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const bytes = redactDiagnostic(
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    secret,
  );
  fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  return { path: file, digest: digest(bytes), bytes: Buffer.byteLength(bytes) };
};

/** Buffer first so a credential split across stream chunks is still redacted. */
export async function runCaptured(
  command,
  args,
  {
    cwd,
    env,
    deadline,
    signal,
    outputPrefix,
    secret = "",
    maxBytes = 16 * 1024 * 1024,
  },
) {
  signal?.throwIfAborted();
  assert.ok(deadline > Date.now(), "command deadline exceeded before launch");
  assert.ok(
    !secret || !args.some((arg) => arg.includes(secret)),
    "credential in command arguments",
  );
  const startedAt = stamp();
  const child = spawn(command, args, {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const buffers = { stdout: [], stderr: [] };
  let bytes = 0,
    timedOut = false,
    outputLimit = false,
    aborted = false,
    error = null;
  const kill = () => {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch (failure) {
      if (failure.code !== "ESRCH") error = failure.message;
    }
  };
  const abort = () => {
    aborted = true;
    kill();
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, deadline - Date.now());
  const heartbeat = setInterval(
    () =>
      console.log(
        JSON.stringify({ stage: path.basename(outputPrefix), running: true }),
      ),
    25000,
  );
  for (const stream of ["stdout", "stderr"])
    child[stream].on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        outputLimit = true;
        kill();
        return;
      }
      buffers[stream].push(chunk);
    });
  child.once("error", (failure) => {
    error = failure.message;
  });
  const { exitCode, exitSignal } = await new Promise((resolve) =>
    child.once("close", (exitCode, exitSignal) =>
      resolve({ exitCode, exitSignal }),
    ),
  );
  clearTimeout(timer);
  clearInterval(heartbeat);
  signal?.removeEventListener("abort", abort);
  // Terminate any remaining member of this diagnostic-owned POSIX group.
  if (process.platform !== "win32") kill();
  const stdout = redactDiagnostic(
    Buffer.concat(buffers.stdout).toString("utf8"),
    secret,
  );
  const stderr = redactDiagnostic(
    Buffer.concat(buffers.stderr).toString("utf8"),
    secret,
  );
  const receipt = {
    command,
    args,
    startedAt,
    finishedAt: stamp(),
    exitCode,
    signal: exitSignal,
    timedOut,
    outputLimit,
    aborted,
    error: error && redactDiagnostic(error, secret),
    ok:
      exitCode === 0 &&
      exitSignal === null &&
      !timedOut &&
      !outputLimit &&
      !aborted &&
      !error,
  };
  save(`${outputPrefix}.stdout.log`, stdout, secret);
  save(`${outputPrefix}.stderr.log`, stderr, secret);
  save(`${outputPrefix}.process.json`, receipt, secret);
  return { ...receipt, stdout, stderr };
}

export function createStageLedger(outputDir, secret = "") {
  const stages = [];
  return {
    stages,
    record(stage, details) {
      assert.equal(
        stage,
        STAGES[stages.length],
        "stages must be recorded exactly once in order",
      );
      const row = { stage, ...details, finishedAt: stamp() };
      const artifact = save(
        path.join(outputDir, `${stages.length + 1}-${stage}.json`),
        row,
        secret,
      );
      stages.push({
        ...row,
        receipt: { ...artifact, path: path.basename(artifact.path) },
      });
      return row;
    },
    skipRemaining(reason) {
      while (stages.length < STAGES.length)
        this.record(STAGES[stages.length], {
          executed: false,
          passed: false,
          reason,
        });
    },
  };
}

export function costAccounting(
  toolEstimatedCostUSD = null,
  authenticationExecuted = true,
) {
  return {
    authenticationExecuted,
    authenticationEstimatedCostUSD: null,
    toolEstimatedCostUSD,
    totalJourneyEstimatedCostUSD: null,
    actualBilledCostUSD: null,
    billingVerified: false,
    budgetVerified: false,
    hardQuotaVerified: false,
    reason:
      "Public CLI 0.166.97 authentication does not report usage; tool estimate is not total journey cost.",
  };
}

export function assessArtifact({ toolPassed, frozen, semantic }) {
  const checkerPassed =
    frozen.pass === true &&
    frozen.sourceRestored === true &&
    semantic.length === PRICING_SEMANTIC_MUTANTS.length &&
    PRICING_SEMANTIC_MUTANTS.every(
      (mutant, index) =>
        semantic[index].mutant === mutant.name &&
        semantic[index].outcome === "killed",
    );
  return {
    passed: toolPassed === true && checkerPassed,
    prerequisitePassed: toolPassed === true,
    checkerPassed,
    frozenPassed: frozen.pass,
    sourceRestored: frozen.sourceRestored,
    semantic,
  };
}

export function agentArguments(cli, task) {
  return [
    cli,
    "agent",
    "-p",
    task.prompt,
    "--provider",
    DIAGNOSTIC.provider,
    "--model",
    DIAGNOSTIC.model,
    "--base-url",
    DIAGNOSTIC.endpoint,
    "--permission-mode",
    "acceptEdits",
    "--output-format",
    "stream-json",
    "--max-turns",
    String(DIAGNOSTIC.maxTurns),
    "--max-budget-usd",
    String(DIAGNOSTIC.estimatedSpendStopUSD),
    "--allowed-tools",
    "read_file,search_files,list_dir,write_file,edit_file,edit_file_hashed",
    "--ephemeral",
    "--no-project-memory",
    "--no-file-refs",
    "--no-slash-macros",
    "--no-mcp",
    "--no-ide",
    "--no-pdh",
    "--no-jetbrains",
  ];
}

/** Runs only in a separate, keyless child; candidate code stays in Docker. */
function checkerMode(values) {
  assert.ok(
    !process.env.VOLCENGINE_API_KEY,
    "checker must not receive credentials",
  );
  const packRoot = values["pack-root"];
  if (values["checker-mode"] === "prepare") {
    const result = generateReviewPack({
      outputDir: packRoot,
      imageId: values["image-id"],
      planDir: PLAN,
    });
    save(values.report, result);
    return;
  }
  const script = fs.readFileSync(
    path.join(packRoot, "verify-04-check.mjs"),
    "utf8",
  );
  const spec = JSON.parse(
    script.match(/\nconst spec = (.+);\nconst receipt =/u)[1],
  );
  let stage = "check";
  if (values["checker-mode"] === "setup") stage = "setup";
  else if (values["checker-mode"] !== "frozen") {
    assert.match(values["checker-mode"], /^semantic-[0-3]$/u);
    spec.sourcePath = "packages/cli/src/lib/llm-pricing.js";
    spec.mutants = [
      PRICING_SEMANTIC_MUTANTS[Number(values["checker-mode"].slice(-1))],
    ];
  }
  const source = path.join(values.workspace, spec.sourcePath);
  const before = digest(fs.readFileSync(source));
  const receipt = runReviewStage(values.workspace, spec, stage, {
    deadline: Number(values.deadline),
    execute(command, args, options) {
      if (command === "docker" && args[0] === "run") {
        const name = args[args.indexOf("--name") + 1];
        assert.match(name, /^cc-verify01-[a-f0-9-]{36}$/u);
        // Write ownership before launch so the parent can fence containers
        // even if this synchronous checker is terminated during Docker I/O.
        fs.appendFileSync(values["container-ledger"], name + "\n", {
          mode: 0o600,
        });
      }
      return spawnSync(command, args, options);
    },
  });
  receipt.sourceRestored = digest(fs.readFileSync(source)) === before;
  save(values.report, receipt);
  assert.ok(receipt.sourceRestored, "checker failed to restore source");
}

export async function runFirstRunDiagnostic({
  outputDir,
  sourceSha,
  imageId,
  confirmLive,
  key = process.env.VOLCENGINE_API_KEY,
  signal,
}) {
  assert.equal(confirmLive, true, "explicit --confirm-live is required");
  assert.ok(key?.trim(), "VOLCENGINE_API_KEY is required");
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  assert.equal(process.version, "v22.12.0");
  assert.match(sourceSha || "", /^[a-f0-9]{40}$/u);
  assert.match(imageId || "", /^sha256:[a-f0-9]{64}$/u);
  const root = path.resolve(outputDir);
  assert.ok(!fs.existsSync(root), "output directory must be new");
  assert.ok(
    !root.startsWith(REPOSITORY + path.sep) && root !== REPOSITORY,
    "evidence must be outside the checkout",
  );
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const startedAt = stamp();
  const deadline = Date.now() + 30 * 60 * 1000;
  const ledger = createStageLedger(root, key);
  let current = "install",
    currentStarted = startedAt,
    currentExecuted = false,
    toolEstimate = null,
    authenticationExecuted = false;
  const run = (
    name,
    command,
    args,
    env = reviewEnvironment(),
    cwd = REPOSITORY,
    timeout = 60000,
  ) =>
    runCaptured(command, args, {
      cwd,
      env,
      deadline: Math.min(deadline, Date.now() + timeout),
      signal,
      outputPrefix: path.join(root, "commands", name),
      secret: key,
    });
  const must = (result) => {
    assert.ok(
      result.ok,
      `command failed: ${result.command}; see retained process receipt`,
    );
    return result;
  };
  try {
    assert.equal(
      must(await run("source", "git", ["rev-parse", "HEAD"])).stdout.trim(),
      sourceSha,
    );
    assert.equal(
      must(
        await run("clean-source", "git", [
          "status",
          "--porcelain",
          "--untracked-files=no",
        ]),
      ).stdout.trim(),
      "",
    );
    const image = JSON.parse(
      must(await run("image", "docker", ["image", "inspect", imageId])).stdout,
    )[0];
    assert.equal(image.Id, imageId);
    assert.ok(image.RepoTags?.includes(REVIEW_IMAGE));
    const catalog = read(path.join(PLAN, "tasks.json"));
    assert.equal(catalog.projectCommit, DIAGNOSTIC.projectCommit);
    assert.equal(
      fs.readFileSync(path.join(PLAN, "plan.sha256"), "utf8").trim(),
      DIAGNOSTIC.planDigest,
    );
    const task = catalog.tasks.find((row) => row.id === "verify-04");
    assert.ok(task);
    save(path.join(root, "frozen-prompt.txt"), task.prompt, key);
    currentExecuted = true;
    const installation = await installPublic({
      outputDir: path.join(root, "installation"),
      version: DIAGNOSTIC.publicVersion,
      releaseSha: DIAGNOSTIC.publicReleaseCommit,
      deadline,
      signal,
      onVerifiedInstallation: async ({
        scratch,
        installRoot,
        cliRoot,
        env,
        summary,
      }) => {
        ledger.record("install", {
          executed: true,
          passed: summary.nativeSqliteVerified,
          startedAt: currentStarted,
          summary: "installation/summary.json",
          summaryDigest: digest(
            fs.readFileSync(path.join(root, "installation/summary.json")),
          ),
        });
        assert.ok(
          summary.nativeSqliteVerified,
          "native database installation prerequisite failed",
        );
        const cli = path.join(cliRoot, "bin/chainlesschain.js");
        current = "configure";
        currentStarted = stamp();
        currentExecuted = true;
        for (const [field, value] of Object.entries({
          provider: DIAGNOSTIC.provider,
          model: DIAGNOSTIC.model,
          baseUrl: DIAGNOSTIC.endpoint,
        }))
          must(
            await run(
              `config-${field}`,
              process.execPath,
              [cli, "config", "set", `llm.${field}`, value],
              env,
              installRoot,
            ),
          );
        const configured = JSON.parse(
          must(
            await run(
              "config-readback",
              process.execPath,
              [cli, "config", "get", "llm", "--json"],
              env,
              installRoot,
            ),
          ).stdout,
        ).value;
        assert.equal(configured.provider, DIAGNOSTIC.provider);
        assert.equal(configured.model, DIAGNOSTIC.model);
        assert.equal(configured.baseUrl, DIAGNOSTIC.endpoint);
        ledger.record(current, {
          executed: true,
          passed: true,
          startedAt: currentStarted,
          configured,
          credentialsPersisted: false,
          sharedProfile: env.CHAINLESSCHAIN_HOME,
        });
        current = "authenticate";
        currentStarted = stamp();
        authenticationExecuted = true;
        const auth = await run(
          "authenticate",
          process.execPath,
          [cli, "llm", "test"],
          {
            ...env,
            CC_MAX_RETRIES: "0",
            CLAUDE_CODE_MAX_RETRIES: "0",
            VOLCENGINE_API_KEY: key,
          },
          installRoot,
          90000,
        );
        ledger.record(current, {
          executed: true,
          passed: auth.ok,
          startedAt: currentStarted,
          invocation: "commands/authenticate.process.json",
          usage: null,
          estimatedCostUSD: null,
          billingVerified: false,
        });
        must(auth);
        current = "tool";
        currentStarted = stamp();
        currentExecuted = false;
        const workspace = path.join(scratch, "workspace");
        fs.mkdirSync(workspace, { mode: 0o700 });
        const archive = path.join(scratch, "project.tar");
        must(
          await run(
            "archive",
            "git",
            [
              "archive",
              DIAGNOSTIC.projectCommit,
              "--format=tar",
              `--output=${archive}`,
            ],
            reviewEnvironment(),
            REPOSITORY,
            120000,
          ),
        );
        must(
          await run(
            "extract",
            "tar",
            ["-xf", archive, "-C", workspace],
            reviewEnvironment(),
            REPOSITORY,
            120000,
          ),
        );
        const packRoot = path.join(root, "pack");
        const check = async (mode) => {
          const report = path.join(scratch, `${mode}.json`);
          const containers = path.join(scratch, `${mode}-containers.txt`);
          const result = await run(
            `checker-${mode}`,
            process.execPath,
            [
              SELF,
              "--checker-mode",
              mode,
              "--pack-root",
              packRoot,
              "--workspace",
              workspace,
              "--image-id",
              imageId,
              "--deadline",
              String(deadline),
              "--report",
              report,
              "--container-ledger",
              containers,
            ],
            reviewEnvironment(),
            REPOSITORY,
            10 * 60 * 1000 + 45000,
          );
          if (!result.ok && fs.existsSync(containers)) {
            const names = [
              ...new Set(
                fs.readFileSync(containers, "utf8").trim().split("\n"),
              ),
            ];
            for (const [index, name] of names.entries()) {
              assert.match(name, /^cc-verify01-[a-f0-9-]{36}$/u);
              const cleanup = await runCaptured(
                "docker",
                ["rm", "--force", name],
                {
                  cwd: REPOSITORY,
                  env: reviewEnvironment(),
                  deadline: Date.now() + 30000,
                  outputPrefix: path.join(
                    root,
                    "commands",
                    `cleanup-${mode}-${index}`,
                  ),
                  secret: key,
                },
              );
              assert.ok(
                cleanup.ok ||
                  (!cleanup.timedOut &&
                    cleanup.exitCode === 1 &&
                    cleanup.stderr.trim() ===
                      `Error response from daemon: No such container: ${name}`),
                "interrupted checker container cleanup unconfirmed",
              );
            }
          }
          const receipt = fs.existsSync(report) ? read(report) : null;
          if (receipt)
            save(path.join(root, "checks", `${mode}.json`), receipt, key);
          must(result);
          assert.ok(receipt, "checker omitted receipt");
          return receipt;
        };
        await check("prepare");
        const setup = await check("setup");
        assert.ok(setup.pass, "checker setup failed");
        const budget = {
          remainingMs(stage) {
            signal?.throwIfAborted();
            assert.ok(Date.now() < deadline, `${stage} deadline exceeded`);
            return deadline - Date.now();
          },
        };
        const before = snapshotVerify01Workspace(
          workspace,
          budget,
          "before-model",
        );
        save(
          path.join(root, "deliverable-preparation.json"),
          seedVerify01Deliverables(workspace, task.expectedFiles, budget),
          key,
        );
        const modelEnv = {
          ...modelEnvironment({
            root: scratch,
            profile: env.CHAINLESSCHAIN_HOME,
            expectedFiles: task.expectedFiles,
            key,
          }),
          HOME: env.HOME,
        };
        const modelTimeout = Math.min(
          8 * 60 * 1000,
          deadline - Date.now() - 4 * 60 * 1000,
        );
        assert.ok(modelTimeout > 0, "insufficient time for model and checker");
        currentExecuted = true;
        const model = await run(
          "model",
          process.execPath,
          agentArguments(cli, task),
          modelEnv,
          workspace,
          modelTimeout,
        );
        const trace = inspectModelTrace(
          model.stdout,
          task.expectedFiles,
          workspace,
        );
        toolEstimate = trace.estimatedCostUSD ?? null;
        save(path.join(root, "model-analysis.json"), trace, key);
        // Preserve partial output before the deadline-aware whole-tree scan.
        // Cancellation must not discard an already written model candidate.
        const candidates = task.expectedFiles.map((file) => {
          const absolute = path.join(workspace, file);
          const stat = fs.lstatSync(absolute);
          assert.ok(
            stat.isFile() &&
              !stat.isSymbolicLink() &&
              stat.nlink === 1 &&
              stat.size <= 16 * 1024 * 1024,
            "candidate is not a bounded regular file",
          );
          assert.equal(
            fs.realpathSync(absolute),
            absolute,
            "aliased candidate path",
          );
          const bytes = fs.readFileSync(absolute);
          const retained = save(
            path.join(root, "candidate", file),
            bytes.toString("utf8"),
            key,
          );
          return {
            file,
            originalDigest: digest(bytes),
            retainedDigest: retained.digest,
            bytes: bytes.length,
          };
        });
        save(path.join(root, "candidate-manifest.json"), candidates, key);
        const changes = diffVerify01Workspace(
          before,
          snapshotVerify01Workspace(workspace, budget, "after-model"),
        );
        const scopePassed =
          changes.length === task.expectedFiles.length &&
          changes.every(
            (entry) =>
              task.expectedFiles.includes(entry.path) &&
              !entry.after?.dependency,
          );
        // Retain exact digests; redact textual bytes before encoding for evidence.
        for (const entry of changes)
          for (const side of ["before", "after"])
            if (entry[side]?.bytesBase64)
              entry[side].bytesBase64 = Buffer.from(
                redactDiagnostic(
                  Buffer.from(entry[side].bytesBase64, "base64").toString(
                    "utf8",
                  ),
                  key,
                ),
              ).toString("base64");
        save(path.join(root, "diff.json"), changes, key);
        const toolPassed = model.ok && trace.pass && scopePassed;
        ledger.record(current, {
          executed: true,
          passed: toolPassed,
          startedAt: currentStarted,
          modelProcessPassed: model.ok,
          scopePassed,
          trace,
          candidates,
        });
        current = "artifact";
        currentStarted = stamp();
        currentExecuted = false;
        assert.ok(
          scopePassed,
          "candidate changed files outside its permitted scope",
        );
        currentExecuted = true;
        const frozen = await check("frozen");
        const semantic = [];
        for (const [index, mutant] of PRICING_SEMANTIC_MUTANTS.entries()) {
          try {
            const receipt = await check(`semantic-${index}`);
            semantic.push({
              mutant: mutant.name,
              ...classifyPricingReceipt(receipt, mutant),
            });
          } catch (error) {
            semantic.push({
              mutant: mutant.name,
              outcome: "not-established",
              error: redactDiagnostic(error.message, key),
            });
            if (signal?.aborted || Date.now() >= deadline) break;
          }
        }
        for (const mutant of PRICING_SEMANTIC_MUTANTS.slice(semantic.length)) {
          semantic.push({
            mutant: mutant.name,
            outcome: "not-run",
            reason: "diagnostic stopped or deadline exhausted",
          });
        }
        ledger.record(current, {
          executed: true,
          startedAt: currentStarted,
          ...assessArtifact({ toolPassed, frozen, semantic }),
        });
      },
    });
    if (!ledger.stages.length)
      throw new Error(installation.error || "public installation failed");
  } catch (error) {
    if (STAGES[ledger.stages.length] === current)
      ledger.record(current, {
        executed: currentExecuted,
        passed: false,
        startedAt: currentStarted,
        error: redactDiagnostic(error.message, key),
      });
    ledger.skipRemaining(
      `prerequisite failed or execution stopped: ${redactDiagnostic(error.message, key)}`,
    );
  }
  const summary = {
    schema: "chainlesschain.verify01-first-run-cli-diagnostic/v1",
    startedAt,
    finishedAt: stamp(),
    sourceCommit: sourceSha,
    projectCommit: DIAGNOSTIC.projectCommit,
    releaseCommit: DIAGNOSTIC.publicReleaseCommit,
    publicVersion: DIAGNOSTIC.publicVersion,
    taskId: "verify-04",
    planDigest: DIAGNOSTIC.planDigest,
    imageId,
    runtime: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      osRelease: fs.readFileSync("/etc/os-release", "utf8"),
      identityAttested: false,
    },
    provider: DIAGNOSTIC.provider,
    model: DIAGNOSTIC.model,
    endpoint: DIAGNOSTIC.endpoint,
    formalSample: false,
    independentHumanReview: false,
    releaseEligible: false,
    formalStatus: "NOT_RUN",
    observationsProduced: 0,
    billingVerified: false,
    productionAttested: false,
    passed:
      ledger.stages.length === 5 && ledger.stages.every((row) => row.passed),
    stages: ledger.stages,
    costAccounting: costAccounting(toolEstimate, authenticationExecuted),
    limits: {
      overallMs: 30 * 60 * 1000,
      modelMs: 8 * 60 * 1000,
      turns: DIAGNOSTIC.maxTurns,
      estimatedToolSpendStopUSD: DIAGNOSTIC.estimatedSpendStopUSD,
      hardQuota: false,
    },
  };
  save(path.join(root, "summary.json"), summary, key);
  return summary;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "output-dir": { type: "string" },
      "source-sha": { type: "string" },
      "image-id": { type: "string" },
      "confirm-live": { type: "boolean", default: false },
      "checker-mode": { type: "string" },
      "pack-root": { type: "string" },
      workspace: { type: "string" },
      deadline: { type: "string" },
      report: { type: "string" },
      "container-ledger": { type: "string" },
    },
  });
  if (values["checker-mode"]) return checkerMode(values);
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("diagnostic interrupted"));
  process.once("SIGTERM", abort);
  process.once("SIGINT", abort);
  try {
    const result = await runFirstRunDiagnostic({
      outputDir: values["output-dir"],
      sourceSha: values["source-sha"],
      imageId: values["image-id"],
      confirmLive: values["confirm-live"],
      signal: controller.signal,
    });
    console.log(
      JSON.stringify({
        passed: result.passed,
        formalSample: false,
        totalJourneyEstimatedCostUSD: null,
      }),
    );
    process.exitCode = result.passed ? 0 : 1;
  } finally {
    process.removeListener("SIGTERM", abort);
    process.removeListener("SIGINT", abort);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF)
  main().catch((error) => {
    console.error(
      redactDiagnostic(error.message, process.env.VOLCENGINE_API_KEY),
    );
    process.exitCode = 1;
  });
