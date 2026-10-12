import {
  MAX_SNAPSHOT_BYTES,
  canonicalDirectory,
  within,
  regularPath,
  seedVerify01Deliverables,
  snapshotVerify01Workspace as snapshot,
  diffVerify01Workspace as diff,
} from "./verify01-workspace.js";
export { seedVerify01Deliverables } from "./verify01-workspace.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import executionBroker from "../process-execution-broker/index.js";
import { evalDigest, createEvalComparison } from "./evidence.js";
import { outcomeDigest } from "./outcomes.js";
import { assertVerify01ExecutionWindow } from "./verify01-execution-window.js";
import {
  readBytes,
  readJson,
  relativeFile,
  requireValue,
  validateVerify01Review,
} from "./verify01-contracts.js";

export const VERIFY01_SUITES = [
  "verify01-plan-2026-10-04",
  "verify01-project-36",
];
const agentBindings = new WeakSet();
const EMPTY_DELIVERABLE_DIGEST = evalDigest(Buffer.alloc(0));

function createAgentBinding(directory, allowedPaths, provider, model, window) {
  assertVerify01ExecutionWindow({ window });
  const workspace = canonicalDirectory(directory);
  for (const relative of allowedPaths) {
    const file = regularPath(workspace, relative);
    requireValue(
      fs.statSync(file).nlink === 1,
      "allowed task files must not have hard-link aliases",
    );
  }
  const temporaryRoot = (fs.realpathSync.native || fs.realpathSync)(
    os.tmpdir(),
  );
  const root = fs.mkdtempSync(path.join(temporaryRoot, "cc-verify01-agent-"));
  const userHome = path.join(root, "user-home");
  const configHome = path.join(root, "chainlesschain-home");
  for (const dir of [userHome, configHome]) fs.mkdirSync(dir, { mode: 0o700 });
  const environment = Object.freeze({
    // Keep downstream temp-root containment checks on the same canonical root.
    TMPDIR: temporaryRoot,
    TEMP: temporaryRoot,
    TMP: temporaryRoot,
    HOME: userHome,
    USERPROFILE: userHome,
    APPDATA: path.join(userHome, "app-data"),
    LOCALAPPDATA: path.join(userHome, "local-app-data"),
    XDG_CONFIG_HOME: path.join(userHome, "xdg-config"),
    XDG_CACHE_HOME: path.join(userHome, "xdg-cache"),
    XDG_DATA_HOME: path.join(userHome, "xdg-data"),
    CHAINLESSCHAIN_HOME: configHome,
    CC_FORMAL_QUALITY_EVAL_HERMETIC: "1",
    CC_FORMAL_QUALITY_EVAL_PROVIDER: provider,
    CC_FORMAL_QUALITY_EVAL_ISOLATION_ROOT: root,
    CC_FORMAL_QUALITY_EVAL_ALLOWED_FILES: JSON.stringify(allowedPaths),
    ...(process.platform === "win32"
      ? { HOMEDRIVE: userHome.slice(0, 2), HOMEPATH: userHome.slice(2) }
      : {}),
  });
  const binding = Object.freeze({
    workspace,
    root,
    provider,
    model,
    executionWindow: Object.freeze({ ...window }),
    allowedPaths: Object.freeze([...allowedPaths]),
    environment,
  });
  agentBindings.add(binding);
  return binding;
}

/** Only suite-created immutable authority can narrow a formal child. The
 * prompt, generic task metadata and inherited environment cannot mint it. */
export function captureVerify01AgentBinding(binding, directory) {
  requireValue(
    agentBindings.has(binding),
    "unrecognized VERIFY01 agent binding",
  );
  assertVerify01ExecutionWindow({ window: binding.executionWindow });
  requireValue(
    canonicalDirectory(directory) === binding.workspace,
    "VERIFY01 agent binding belongs to another workspace",
  );
  canonicalDirectory(binding.root);
  for (const relative of binding.allowedPaths) {
    const file = regularPath(binding.workspace, relative);
    requireValue(
      fs.statSync(file).nlink === 1,
      "allowed task file acquired a hard-link alias",
    );
  }
  return binding;
}

// Host drivers use the same checkout, complete scan, dependency boundary and
// pinned evaluator processes as the CLI executor; no second diff contract.
export {
  materializeCheckout as materializeVerify01Checkout,
  snapshot as snapshotVerify01Workspace,
  diff as diffVerify01Workspace,
  reviewedProcess as runVerify01ReviewedProcess,
};

function git(directory, args, options = {}) {
  return executionBroker.execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30000,
    windowsHide: true,
    origin: "eval:verify01-checkout",
    policy: "allow",
    scope: "eval",
    shell: false,
    ...options,
  });
}

/** Copy only committed blobs, checking their actual Git object identities.
 * Untracked credentials, .git metadata, and development dependency junctions
 * are never part of the evaluation checkout. Setup owns dependency preparation.
 */
async function materializeCheckout(projectRoot, commit, destination, budget) {
  requireValue(
    git(projectRoot, ["rev-parse", "HEAD"]).trim() === commit,
    "actual checkout SHA changed",
  );
  const entries = git(projectRoot, ["ls-tree", "-rz", "--full-tree", commit])
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/su.exec(entry);
      requireValue(
        match,
        "evaluation checkout contains unsupported links or submodules",
      );
      relativeFile(match[3]);
      return { mode: match[1], oid: match[2], relative: match[3] };
    });
  let total = 0;
  // Read Git objects, rather than mutable checkout files or platform CRLF
  // conversions. A single bounded batch avoids one Git process per file.
  await new Promise((resolvePromise, reject) => {
    const child = executionBroker.spawn(
      "git",
      ["-C", projectRoot, "cat-file", "--batch"],
      {
        windowsHide: true,
        origin: "eval:verify01-checkout-blobs",
        policy: "allow",
        scope: "eval",
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let pending = Buffer.alloc(0),
      offset = 0,
      size = null,
      failed = false,
      stderr = "";
    const stop = (error) => {
      if (failed) return;
      failed = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    const timer = setTimeout(
      () => stop(new Error("frozen checkout materialization timed out")),
      Math.min(120000, budget.remainingMs("checkout")),
    );
    child.on("error", stop);
    child.stderr.on("data", (bytes) => {
      stderr = (stderr + bytes.toString("utf8")).slice(-4096);
    });
    child.stdout.on("data", (chunk) => {
      if (failed) return;
      try {
        pending = Buffer.concat([pending, chunk]);
        while (offset < entries.length) {
          const entry = entries[offset];
          if (size === null) {
            const newline = pending.indexOf(10);
            if (newline < 0) {
              requireValue(pending.length < 128, "invalid Git batch header");
              break;
            }
            const parts = pending
              .subarray(0, newline)
              .toString("utf8")
              .split(" ");
            requireValue(
              parts.length === 3 &&
                parts[0] === entry.oid &&
                parts[1] === "blob",
              "Git batch object mismatch",
            );
            size = Number(parts[2]);
            requireValue(
              Number.isSafeInteger(size) &&
                size >= 0 &&
                size <= 16 * 1024 * 1024,
              "Git blob exceeds materialization bound",
            );
            pending = pending.subarray(newline + 1);
          }
          if (pending.length < size + 1) break;
          const bytes = pending.subarray(0, size);
          requireValue(pending[size] === 10, "invalid Git batch terminator");
          total += size;
          requireValue(
            total <= MAX_SNAPSHOT_BYTES,
            "evaluation checkout exceeds 512 MiB",
          );
          const actual = createHash("sha1")
            .update(`blob ${size}\0`)
            .update(bytes)
            .digest("hex");
          requireValue(actual === entry.oid, "Git blob digest mismatch");
          const target = path.join(destination, entry.relative);
          within(destination, target);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, bytes, {
            flag: "wx",
            mode: entry.mode === "100755" ? 0o755 : 0o644,
          });
          pending = pending.subarray(size + 1);
          size = null;
          offset++;
        }
      } catch (error) {
        stop(error);
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (failed) return;
      if (code !== 0 || signal || offset !== entries.length || pending.length)
        reject(new Error(`incomplete frozen Git checkout: ${stderr}`));
      else resolvePromise();
    });
    child.stdin.on("error", stop);
    child.stdin.end(entries.map((entry) => entry.oid).join("\n") + "\n");
  });
  return { commit, files: entries.length, bytes: total };
}

function reviewedProcess(bytes, directory, reviewRoot, kind, timeout) {
  // Execute the captured bytes, not a path that task code could replace between
  // digest verification and process startup. Evaluators are explicitly trusted
  // operator code; their digest is not an independent-review attestation.
  const result = executionBroker.spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      bytes.toString("utf8"),
      directory,
      String(Date.now() + timeout),
    ],
    {
      cwd: reviewRoot,
      encoding: "utf8",
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      // Operator checks never receive model/account credentials, NODE_OPTIONS
      // or ambient provider configuration. Docker may still need its context.
      env: Object.fromEntries(
        [
          "PATH",
          "SystemRoot",
          "WINDIR",
          "TEMP",
          "TMP",
          "DOCKER_HOST",
          "DOCKER_CONTEXT",
        ]
          .filter((key) => process.env[key])
          .map((key) => [key, process.env[key]]),
      ),
      origin: `eval:verify01-${kind}`,
      policy: "allow",
      scope: "eval",
      shell: false,
    },
  );
  return {
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message || null,
    sourceDigest: evalDigest(bytes),
  };
}

/** Prepare a frozen suite. No evaluator or agent runs during admission. */
export function loadVerify01Suite(options = {}) {
  for (const field of [
    "planDir",
    "planDigest",
    "reviewFile",
    "reviewDigest",
    "reviewRoot",
    "projectRoot",
    "sampleIds",
  ])
    requireValue(
      options[field],
      `VERIFY-01 requires ${field}; an independent review binding is not optional`,
    );
  const planDir = path.resolve(options.planDir);
  const bundle = {
    plan: readJson(path.join(planDir, "plan.json")),
    catalog: readJson(path.join(planDir, "tasks.json")),
    bindings: readJson(path.join(planDir, "comparison-bindings.json")),
    expectedPlanDigest: options.planDigest,
  };
  requireValue(
    readBytes(path.join(planDir, "plan.sha256")).toString("utf8").trim() ===
      options.planDigest,
    "pinned plan.sha256 differs from external plan binding",
  );
  const projectRoot = fs.realpathSync(options.projectRoot),
    reviewRoot = fs.realpathSync(options.reviewRoot);
  requireValue(
    projectRoot !== reviewRoot &&
      !reviewRoot.startsWith(`${projectRoot}${path.sep}`),
    "review root must be outside the task project",
  );
  const projectCommit = git(projectRoot, ["rev-parse", "HEAD"]).trim();
  const artifacts = new Map();
  const preparation = {
    review: readJson(options.reviewFile),
    expectedReviewDigest: options.reviewDigest,
    projectCommit,
    readReviewedFile(relative) {
      const bytes = readBytes(regularPath(reviewRoot, relative));
      artifacts.set(relative, bytes);
      return bytes;
    },
  };
  const validated = validateVerify01Review(bundle, preparation);
  const ids = Array.isArray(options.sampleIds)
    ? options.sampleIds
    : String(options.sampleIds).split(",");
  requireValue(
    ids.length > 0 && new Set(ids).size === ids.length,
    "selected sample IDs are missing or duplicated",
  );
  const samples = ids.map((id) => validated.samples.get(id));
  requireValue(samples.every(Boolean), "sample outside frozen population");
  requireValue(
    samples.every((sample) => sample.kind === "task"),
    "first-run samples require actual installation journey collection; task execution cannot replace it",
  );
  requireValue(
    new Set(samples.map((sample) => sample.stratum)).size === 1,
    "one execution must retain one frozen comparison stratum",
  );
  const sampleComparison = bundle.bindings.comparisons[samples[0].stratum];
  const entry = options.entry || "cli";
  requireValue(
    entry === "cli" &&
      samples.every((sample) => sample.stratum.includes("-cli-")),
    "IDE samples require an actual IDE host adapter; CLI cannot impersonate that entry",
  );
  const comparison = createEvalComparison({
    ...sampleComparison,
    context: sampleComparison.declared,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    provider: options.provider,
    model: options.model,
  });
  requireValue(
    outcomeDigest(comparison) === samples[0].comparisonDigest,
    "actual provider/model/runtime differs from frozen comparison",
  );
  const receipts = [];
  const tasks = samples.map((sample) => {
    const task = validated.tasks.get(sample.taskId),
      reviewed = validated.reviewed.get(sample.taskId);
    let baseline, after, agentBinding;
    const receipt = {
      sampleId: sample.id,
      taskId: task.id,
      planDigest: options.planDigest,
      reviewDigest: options.reviewDigest,
      projectCommit,
      comparisonDigest: sample.comparisonDigest,
      entry,
      productionAttested: false,
      dependencyBoundary: null,
      setup: null,
      check: null,
      diff: null,
      execution: null,
      deliverablePreparation: [],
      agentDiff: null,
      agentBinding: null,
    };
    receipts.push(receipt);
    return {
      id: task.id,
      description: task.description,
      prompt: task.prompt,
      timeoutMs: sample.timeBudgetMs,
      totalTimeoutMs: sample.timeBudgetMs,
      costBudgetUsd: sample.costBudget,
      expectedFiles: [...reviewed.allowedChangedPaths],
      async setup(directory, budget) {
        receipt.windowAdmission = assertVerify01ExecutionWindow(bundle.plan, {
          requiredTimeMs: sample.timeBudgetMs,
        });
        receipt.workspace = directory;
        receipt.checkout = await materializeCheckout(
          projectRoot,
          projectCommit,
          directory,
          budget,
        );
        receipt.setup = reviewedProcess(
          artifacts.get(reviewed.setup.path),
          directory,
          reviewRoot,
          "setup",
          budget.remainingMs("setup"),
        );
        requireValue(
          receipt.setup.exitCode === 0 &&
            !receipt.setup.signal &&
            !receipt.setup.error,
          "reviewed setup failed",
        );
        receipt.deliverablePreparation = seedVerify01Deliverables(
          directory,
          task.expectedFiles,
          budget,
        );
        agentBinding = createAgentBinding(
          directory,
          reviewed.allowedChangedPaths,
          options.provider,
          options.model,
          bundle.plan.window,
        );
        receipt.agentBinding = {
          workspace: agentBinding.workspace,
          isolationRoot: agentBinding.root,
          userHome: agentBinding.environment.HOME,
          configHome: agentBinding.environment.CHAINLESSCHAIN_HOME,
          allowedChangedPaths: agentBinding.allowedPaths,
          provider: agentBinding.provider,
          model: agentBinding.model,
          productionAttested: false,
        };
      },
      agentLaunchBinding(directory) {
        return captureVerify01AgentBinding(agentBinding, directory);
      },
      cleanup() {
        if (!agentBinding) return;
        canonicalDirectory(agentBinding.root);
        fs.rmSync(agentBinding.root, { recursive: true, force: true });
        agentBindings.delete(agentBinding);
        receipt.agentBinding.profileRemoved = true;
        agentBinding = null;
      },
      snapshotWorkspace(directory, budget, stage) {
        const captured = snapshot(directory, budget, stage);
        if (stage === "baseline") baseline = captured;
        else after = captured;
        receipt.dependencyBoundary = {
          before: baseline?.dependencyBoundary || null,
          after: after?.dependencyBoundary || null,
        };
        return new Map(
          [...captured].map(([file, value]) => [
            file,
            JSON.stringify([value.digest, value.type, value.mode]),
          ]),
        );
      },
      recordFailure(failure) {
        receipt.failure = failure;
        baseline = after = null;
      },
      recordExecution(agentResult) {
        receipt.execution = {
          output: agentResult?.output ?? null,
          error: agentResult?.error ?? null,
          evidence: agentResult?.executionEvidence ?? null,
          usage: agentResult?.usage ?? null,
          totalCostUsd: agentResult?.totalCostUsd ?? null,
        };
      },
      check(directory, agentResult, budget) {
        receipt.agentDiff = diff(baseline, after);
        // The agent baseline contains empty seeds. Preserve that view, while
        // the task-origin diff still describes absent -> candidate additions.
        const originalBaseline = new Map(baseline);
        for (const seed of receipt.deliverablePreparation)
          originalBaseline.delete(seed.path);
        receipt.diff = diff(originalBaseline, after);
        baseline = null;
        requireValue(
          receipt.diff.every(
            (change) =>
              reviewed.allowedChangedPaths.includes(change.path) &&
              !change.before?.dependency &&
              !change.after?.dependency &&
              change.after?.type !== "link",
          ),
          "task modified a path outside independent review or introduced a deliverable link",
        );
        requireValue(
          task.expectedFiles.every(
            (file) =>
              after.get(file)?.type === "file" &&
              after.get(file)?.digest !== EMPTY_DELIVERABLE_DIGEST,
          ),
          "task did not replace all empty seeds with regular-file deliverables",
        );
        after = null;
        receipt.check = reviewedProcess(
          artifacts.get(reviewed.check.path),
          directory,
          reviewRoot,
          "check",
          budget.remainingMs("check"),
        );
        requireValue(
          receipt.check.exitCode === 0 &&
            !receipt.check.signal &&
            !receipt.check.error,
          "reviewed acceptance process failed",
        );
        const verdict = JSON.parse(receipt.check.stdout.trim());
        requireValue(
          typeof verdict?.pass === "boolean" &&
            typeof verdict?.detail === "string",
          "reviewed check must emit one JSON pass/detail verdict",
        );
        return verdict;
      },
    };
  });
  Object.defineProperty(tasks, "verification", {
    value: {
      comparison,
      projectCommit,
      planDigest: options.planDigest,
      reviewDigest: options.reviewDigest,
      population: { tasks: 36, firstRuns: 9 },
      selectedSamples: ids,
      receipts,
      productionAttested: false,
      requiredSandboxMode: "workspace-write",
    },
  });
  return tasks;
}

export function persistVerify01Receipts(verification, directory, runId) {
  requireValue(
    typeof runId === "string" && /^[a-f0-9-]{36}$/u.test(runId),
    "invalid evaluation run ID",
  );
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  requireValue(
    stat.isDirectory() && !stat.isSymbolicLink(),
    "evidence directory must not be a link",
  );
  const { receipts, ...binding } = verification;
  const artifacts = receipts.map((receipt, index) => {
    const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const file = path.join(root, `verify-${runId}-${index}.json`);
    const fd = fs.openSync(file, "wx", 0o600);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return {
      sampleId: receipt.sampleId,
      path: file,
      digest: evalDigest(bytes),
      bytes: bytes.length,
    };
  });
  return { ...binding, artifacts };
}
