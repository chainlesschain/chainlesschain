/** Trusted operator acceptance code. Candidate code runs only in Docker.
 * Generated setup/check files inline these bytes; no mutable helper imports.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

export const REVIEW_IMAGE = "node:22.12.0-bookworm-slim";
const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_STAGE_MS = 10 * 60 * 1000;
const CLEANUP_RESERVE_MS = 40000;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function requireCondition(condition, detail) {
  if (!condition) throw new Error(detail);
}

function regularFile(root, relative) {
  requireCondition(
    typeof relative === "string" &&
      relative
        .split("/")
        .every((part) => part && part !== "." && part !== "..") &&
      !/[\\:*?<>|"\u0000]/u.test(relative) &&
      !relative.startsWith("/"),
    "acceptance path must be an exact relative file",
  );
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    requireCondition(
      !fs.lstatSync(current).isSymbolicLink(),
      "acceptance path traverses a link",
    );
  }
  const stat = fs.statSync(current);
  requireCondition(
    stat.isFile() && stat.nlink === 1 && stat.size <= 16 * 1024 * 1024,
    "acceptance file must be a bounded regular file without hard-link aliases",
  );
  return current;
}

/** The Docker client gets only platform plumbing, never account credentials or
 * NODE_OPTIONS. No host environment variables are forwarded to the container.
 */
export function reviewEnvironment(input = process.env) {
  const result = {};
  for (const key of [
    "SystemRoot",
    "WINDIR",
    "PATH",
    "TEMP",
    "TMP",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
  ])
    if (input[key]) result[key] = input[key];
  return result;
}

export function reviewDockerArgs({
  workspace,
  control,
  containerName,
  setup = false,
  command,
  imageId,
  uid,
  gid,
  timeoutMs = MAX_STAGE_MS,
}) {
  requireCondition(
    /^sha256:[a-f0-9]{64}$/u.test(imageId || ""),
    "acceptance requires an externally pinned Docker image ID",
  );
  requireCondition(
    [uid, gid].every(
      (value) =>
        Number.isSafeInteger(value) && value >= 0 && value < 0xffffffff,
    ),
    "acceptance requires the Linux operator's numeric UID and GID",
  );
  requireCondition(
    path.isAbsolute(workspace) && path.isAbsolute(control),
    "Docker mounts must be absolute",
  );
  requireCondition(
    ![workspace, control].some((value) => /[,\r\n\u0000]/u.test(value)),
    "unsupported Docker mount path",
  );
  requireCondition(
    Number.isSafeInteger(timeoutMs) &&
      timeoutMs > 0 &&
      timeoutMs <= MAX_STAGE_MS,
    "container acceptance requires a bounded positive deadline",
  );
  return [
    "run",
    "--rm",
    "--init",
    // With all capabilities dropped, container root cannot write private
    // runner-owned bind mounts. Keep the operator's actual file identity.
    "--user",
    `${uid}:${gid}`,
    "--name",
    containerName,
    "--network",
    setup ? "bridge" : "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "256",
    "--memory",
    "4g",
    "--cpus",
    "2",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=1g",
    "--mount",
    `type=bind,source=${workspace},target=/workspace${setup ? "" : ",readonly"}`,
    "--mount",
    `type=bind,source=${control},target=/review,readonly`,
    "--workdir",
    "/workspace",
    "--env",
    "HOME=/tmp/review-home",
    "--env",
    "CI=1",
    imageId,
    // The daemon's PID namespace keeps its own deadline even if an outer
    // evaluator cancellation kills the Docker client before finally can run.
    "timeout",
    "--signal=TERM",
    "--kill-after=5s",
    `${Math.max(1, timeoutMs - 5000) / 1000}s`,
    ...command,
  ];
}

export function parseReviewTests(
  result,
  { mutant = false, baseline = false } = {},
) {
  requireCondition(
    !result.error && !result.signal,
    "test runner failed or timed out",
  );
  let report;
  try {
    report = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("test runner did not emit one valid JSON report");
  }
  const cases = (report.testResults || []).flatMap(
    (file) => file.assertionResults || [],
  );
  requireCondition(
    cases.length > 0 && report.numTotalTests === cases.length,
    "acceptance requires executed test cases",
  );
  requireCondition(
    cases.every((test) =>
      (baseline
        ? ["passed", "failed", "pending"]
        : ["passed", "failed"]
      ).includes(test.status),
    ) &&
      (baseline || report.numPendingTests === 0) &&
      (report.numTodoTests || 0) === 0,
    "skipped, pending, todo or empty tests cannot pass acceptance",
  );
  if (mutant) {
    requireCondition(
      result.status === 1 &&
        report.numFailedTests > 0 &&
        report.success === false,
      "candidate tests did not reject the behavioral mutant",
    );
    requireCondition(
      cases.some(
        (test) =>
          test.status === "failed" &&
          (test.failureMessages || []).some((message) =>
            /^AssertionError(?:\s*\[[^\]]+\])?(?::|\b)/mu.test(message),
          ),
      ),
      "mutant failure must include an assertion, not a syntax/import/runner error",
    );
    requireCondition(
      (report.testResults || []).every(
        (file) =>
          !file.message ||
          !/SyntaxError|Cannot find module|ERR_MODULE_NOT_FOUND|Failed to load/iu.test(
            file.message,
          ),
      ),
      "mutant failed because of loading rather than behavior",
    );
  } else {
    requireCondition(
      result.status === 0 &&
        report.success === true &&
        report.numFailedTests === 0 &&
        report.numPassedTests > 0 &&
        report.numPassedTests + (baseline ? report.numPendingTests : 0) ===
          cases.length,
      "candidate or baseline regression failed",
    );
  }
  return {
    total: cases.length,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
  };
}

export function applyReviewMutation(source, mutant) {
  requireCondition(
    typeof mutant.find === "string" &&
      mutant.find.length > 0 &&
      typeof mutant.replace === "string" &&
      mutant.find !== mutant.replace,
    "invalid behavioral mutation",
  );
  const offset = source.indexOf(mutant.find);
  requireCondition(
    offset >= 0 && source.indexOf(mutant.find, offset + mutant.find.length) < 0,
    `mutation ${mutant.name} no longer has one exact match; independent re-review required`,
  );
  return (
    source.slice(0, offset) +
    mutant.replace +
    source.slice(offset + mutant.find.length)
  );
}

export function reviewStageDeadline(now, externalDeadline) {
  const outer = externalDeadline ?? now + MAX_STAGE_MS + CLEANUP_RESERVE_MS;
  requireCondition(
    Number.isSafeInteger(now) && Number.isSafeInteger(outer),
    "acceptance requires a valid evaluator deadline",
  );
  const deadline = Math.min(now + MAX_STAGE_MS, outer - CLEANUP_RESERVE_MS);
  requireCondition(
    deadline > now,
    "remaining task budget cannot provide container cleanup time",
  );
  return deadline;
}

function controller(workspace, spec, execute = spawnSync, externalDeadline) {
  const deadline = reviewStageDeadline(Date.now(), externalDeadline);
  // This is not the task's review root and is never mounted writable in a test.
  const control = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-verify01-control-"),
  );
  const executions = [];
  const containerNames = new Set();
  requireCondition(
    /^sha256:[a-f0-9]{64}$/u.test(spec.imageId || ""),
    "acceptance requires an externally pinned Docker image ID",
  );
  function run(command, { setup = false } = {}) {
    const containerName = `cc-verify01-${randomUUID()}`;
    const started = Date.now();
    const timeoutMs = deadline - started;
    requireCondition(timeoutMs > 0, "acceptance stage deadline exhausted");
    containerNames.add(containerName);
    const result = execute(
      "docker",
      reviewDockerArgs({
        workspace,
        control,
        containerName,
        setup,
        command,
        imageId: spec.imageId,
        uid: process.getuid(),
        gid: process.getgid(),
        timeoutMs,
      }),
      {
        env: reviewEnvironment(),
        encoding: "utf8",
        shell: false,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
      },
    );
    executions.push({
      command,
      setup,
      ms: Date.now() - started,
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      error: result.error?.message || null,
    });
    if (result.error || result.signal) {
      const fence = execute("docker", ["rm", "--force", containerName], {
        env: reviewEnvironment(),
        encoding: "utf8",
        shell: false,
        timeout: 30000,
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
      });
      requireCondition(
        fence.status === 0 && !fence.error,
        "acceptance container cleanup is unconfirmed",
      );
    }
    containerNames.delete(containerName);
    return result;
  }
  function tests(files, mutant = false, baseline = false) {
    files.forEach((file) => regularFile(workspace, file));
    for (const support of spec.testSupport) {
      const bytes = fs.readFileSync(regularFile(workspace, support.path));
      requireCondition(
        `sha256:${hash(bytes)}` === support.digest,
        "frozen test setup support changed",
      );
    }
    // A locked external config prevents task-controlled Vitest include/exclude,
    // passWithNoTests, reporters and setup files from redefining acceptance.
    fs.writeFileSync(
      path.join(control, "vitest.config.mjs"),
      `export default ${JSON.stringify({
        test: {
          root: "/workspace",
          include: files,
          globals: true,
          pool: "forks",
          maxWorkers: 1,
          testTimeout: 90000,
          hookTimeout: 120000,
          teardownTimeout: 30000,
          passWithNoTests: false,
          cache: false,
          setupFiles: spec.testSupport
            .filter((file) => file.kind === "setup")
            .map((file) => `/workspace/${file.path}`),
          globalSetup: spec.testSupport
            .filter((file) => file.kind === "globalSetup")
            .map((file) => `/workspace/${file.path}`),
        },
      })};\n`,
    );
    return parseReviewTests(
      run([
        "node",
        "/workspace/node_modules/vitest/vitest.mjs",
        "run",
        "--config",
        "/review/vitest.config.mjs",
        "--configLoader",
        "native",
        "--reporter=json",
      ]),
      { mutant, baseline },
    );
  }
  function close() {
    requireCondition(
      containerNames.size === 0,
      "acceptance has an unfenced container",
    );
    fs.rmSync(control, { recursive: true });
  }
  return { run, tests, close, executions, control };
}

function verifyDocument(workspace, spec, runner) {
  const body = fs.readFileSync(
    regularFile(workspace, spec.expectedFiles[0]),
    "utf8",
  );
  requireCondition(
    body.trim().length >= 300,
    "runbook must contain substantive operating instructions",
  );
  for (const expression of [
    "task-outcome-report\\.mjs",
    "--fingerprint",
    "INSUFFICIENT_EVIDENCE",
    "(?:null|unknown|未知)",
    "(?:退出|exit|code)[^\\n]{0,40}2",
    "(?:不得|禁止|not|never)[^\\n]{0,60}(?:PASS|改善)",
  ])
    requireCondition(
      new RegExp(expression, "iu").test(body),
      `runbook misses ${expression}`,
    );
  // The frozen project predates this plan directory. It is evaluator input,
  // pinned in the generated script and mounted read-only outside the project.
  fs.writeFileSync(
    path.join(runner.control, "plan.json"),
    JSON.stringify(spec.frozenPlan),
  );
  const plan = "/review/plan.json";
  const script = "packages/cli/scripts/task-outcome-report.mjs";
  const fingerprint = runner.run([
    "node",
    script,
    "--plan",
    plan,
    "--fingerprint",
  ]);
  requireCondition(
    fingerprint.status === 0 && /sha256:[a-f0-9]{64}/u.test(fingerprint.stdout),
    "real fingerprint command failed",
  );
  const empty = runner.run([
    "node",
    script,
    "--plan",
    plan,
    "--plan-digest",
    fingerprint.stdout.trim(),
  ]);
  requireCondition(
    empty.status === 2 && !empty.error && !empty.signal,
    "missing observations must return exit 2",
  );
  const report = JSON.parse(empty.stdout);
  requireCondition(
    report.status === "INSUFFICIENT_EVIDENCE" &&
      report.task.observed === 0 &&
      report.task.missing === 36 &&
      report.firstRun.missing === 9 &&
      report.task.totalCost === null,
    "real missing-sample/unknown-cost report changed",
  );
  return {
    fingerprint: fingerprint.stdout.trim(),
    missingTaskSamples: 36,
    missingFirstRunSamples: 9,
  };
}

export function runReviewStage(
  workspaceInput,
  spec,
  stage,
  { execute = spawnSync, deadline } = {},
) {
  const workspace = fs.realpathSync(workspaceInput);
  requireCondition(
    stage === "setup" || stage === "check",
    "unknown review stage",
  );
  requireCondition(
    process.platform === "linux",
    "this Docker acceptance pack supports Linux strata only; native IDE/Windows/macOS reviews remain separate",
  );
  requireCondition(/^verify-\d{2}$/u.test(spec.taskId), "unknown review task");
  const runner = controller(workspace, spec, execute, deadline);
  const receipt = {
    scope: "verify01-operator-acceptance",
    taskId: spec.taskId,
    stage,
    productionAttested: false,
    providerAssessed: false,
    isolation: "docker",
    imageReference: REVIEW_IMAGE,
    imageId: spec.imageId,
    operator: { uid: process.getuid(), gid: process.getgid() },
    tests: [],
    mutations: [],
    executions: runner.executions,
  };
  let sourceFile, original;
  try {
    const version = runner.run(["node", "--version"]);
    requireCondition(
      version.status === 0 && version.stdout.trim() === "v22.12.0",
      "pinned acceptance image does not supply Node 22.12.0",
    );
    if (stage === "setup") {
      requireCondition(
        spec.expectedFiles.every(
          (file) => !fs.existsSync(path.join(workspace, file)),
        ),
        "setup must not preinstall answer deliverables",
      );
      const installation = runner.run(
        [
          "npm",
          "ci",
          "--workspace",
          "packages/cli",
          "--include-workspace-root=false",
          "--legacy-peer-deps",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--cache",
          "/tmp/npm-cache",
          "--userconfig",
          "/dev/null",
        ],
        { setup: true },
      );
      requireCondition(
        installation.status === 0 &&
          !installation.error &&
          !installation.signal,
        "locked dependency installation failed",
      );
      if (spec.baselineTests.length)
        receipt.tests.push({
          kind: "baseline",
          ...runner.tests(spec.baselineTests, false, true),
        });
    } else if (spec.doc) {
      receipt.document = verifyDocument(workspace, spec, runner);
    } else {
      receipt.tests.push({
        kind: "baseline",
        ...runner.tests(spec.baselineTests, false, true),
      });
      receipt.tests.push({
        kind: "candidate",
        ...runner.tests(spec.expectedFiles),
      });
      sourceFile = regularFile(workspace, spec.sourcePath);
      original = fs.readFileSync(sourceFile);
      requireCondition(
        spec.mutants.length > 0,
        "behavioral mutants are required",
      );
      for (const mutant of spec.mutants) {
        const changed = applyReviewMutation(original.toString("utf8"), mutant);
        fs.writeFileSync(sourceFile, changed);
        const syntax = runner.run([
          "node",
          "--check",
          `/workspace/${spec.sourcePath}`,
        ]);
        requireCondition(
          syntax.status === 0 && !syntax.error && !syntax.signal,
          "behavioral mutation has invalid syntax",
        );
        receipt.mutations.push({
          name: mutant.name,
          sourceSha256: hash(Buffer.from(changed)),
          ...runner.tests(spec.expectedFiles, true),
        });
        fs.writeFileSync(sourceFile, original);
      }
    }
    receipt.pass = true;
    receipt.detail =
      "Independent operator checks passed; this is not a provider or task-outcome sample.";
  } catch (error) {
    receipt.pass = false;
    receipt.detail = error.message;
  } finally {
    if (sourceFile && original) {
      requireCondition(
        regularFile(workspace, spec.sourcePath) === sourceFile,
        "mutated source identity changed before restoration",
      );
      fs.writeFileSync(sourceFile, original);
    }
    runner.close();
  }
  return receipt;
}
