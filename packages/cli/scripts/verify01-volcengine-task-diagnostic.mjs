#!/usr/bin/env node
/** Manual, paid task diagnostic. Never writes frozen outcome observations.
 * The model edits only task deliverables; generated operator checks execute
 * candidate tests in a network-disabled Docker container without credentials.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { generateReviewPack } from "./verify01-review-pack.mjs";
import { reviewEnvironment, REVIEW_IMAGE } from "./verify01-review-runtime.mjs";
import { VERIFY01_REVIEW_SPECS } from "./verify01-review-specs.mjs";
import { verifyAgentTerminal } from "../src/lib/eval/stream-terminal.js";
import { createVolcengineDiagnosticBroker } from "./verify01-volcengine-diagnostic-broker.mjs";

export const DIAGNOSTIC = Object.freeze({
  tasks: ["verify-04", "verify-22"],
  projectCommit: "b2aa3aba082873570e85dce39b00754e5504ff37",
  planDigest:
    "sha256:04b90d1a93cfd6556f91688a39508c69e4423671a7b6bcb85fac4dc7e82c0e13",
  publicVersion: "0.166.99",
  publicReleaseCommit: "311e01a5ec34a8e433c7abde0e4b6b05bce4513b",
  provider: "volcengine",
  model: "deepseek-v4-flash-ga-260731",
  endpoint: "https://ark.cn-beijing.volces.com/api/v3",
  maxTurns: 14,
  taskTimeoutMs: 20 * 60 * 1000,
  estimatedSpendStopUSD: 0.25,
});
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const planDir = path.join(
  repository,
  "docs/research/cli/verify01-plan-2026-10-13-volcengine",
);
const fileTools = [
  "read_file",
  "search_files",
  "list_dir",
  "write_file",
  "edit_file",
  "edit_file_hashed",
];
const writeTools = new Set(["write_file", "edit_file", "edit_file_hashed"]);
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const stamp = () => new Date().toISOString();
const command = (name, args, options = {}) =>
  execFileSync(name, args, {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
    env: reviewEnvironment(),
    ...options,
  });

export function redactDiagnostic(text, secret) {
  if (!secret) return text;
  for (const value of new Set([secret, JSON.stringify(secret).slice(1, -1)])) {
    if (value) text = text.replaceAll(value, "[redacted]");
  }
  return text;
}

export function modelEnvironment({
  root,
  profile,
  expectedFiles,
  key,
  input = process.env,
}) {
  // No ambient provider settings, fallbacks, npm credentials, GitHub tokens,
  // NODE_OPTIONS, OTLP endpoints or inherited shell hooks enter this child.
  return {
    PATH: input.PATH || "",
    HOME: path.join(root, "user-home"),
    TMPDIR: os.tmpdir(),
    LANG: "C.UTF-8",
    CHAINLESSCHAIN_HOME: profile,
    CC_MAX_RETRIES: "0",
    CLAUDE_CODE_MAX_RETRIES: "0",
    CC_FORMAL_QUALITY_EVAL_HERMETIC: "1",
    CC_FORMAL_QUALITY_EVAL_PROVIDER: DIAGNOSTIC.provider,
    CC_FORMAL_QUALITY_EVAL_ISOLATION_ROOT: root,
    CC_FORMAL_QUALITY_EVAL_ALLOWED_FILES: JSON.stringify(expectedFiles),
    VOLCENGINE_API_KEY: key,
  };
}

export function taskPrompt(task, spec) {
  return `${task.prompt}\n\nThis is an independent diagnostic, not a formal VERIFY01 sample.
Read the frozen source and existing tests before writing your own regression tests.
Use the named files as your starting points; avoid listing the entire test directory. Search for exact API names, then read bounded slices rather than repeatedly reading whole unchanged files.
Keep the patch focused: at most six behavioral cases and roughly 150 lines. Confirm argument names and result fields from source before asserting them. Spend the first six turns reading, then write, read back the deliverable once, and finish. Do not add unrelated validation cases.
Frozen source files: ${task.sourcePaths.join(", ")}
Related existing tests: ${spec.baselineTests.join(", ")}
Only these deliverables may be changed: ${task.expectedFiles.join(", ")}
Use repository-relative paths for every mutation. Absolute paths are rejected even when they name an allowed deliverable.
Each deliverable currently contains a non-answer placeholder; replace it with complete runnable Vitest tests.
Import paths are relative to each deliverable's location. Use explicit behavioral assertions and positive/negative cases; do not merely import an existing test suite or inspect source text.
Source implementation and existing tests are read-only in this diagnostic. If you discover an implementation defect, describe it in your final response instead of modifying source.
Use only the exposed file tools. Do not run shell commands, code, MCP or network tools. Do not inspect node_modules or paths outside this project. No credentials are present in this project.
An independent operator will execute baseline tests, your candidate tests, and behavioral mutants after you finish, using Vitest in Linux Docker. You cannot execute the tests yourself; do not claim that tests passed.
Read back your completed deliverable. Finish with a concise explanation of the assertions and any limitations. You have at most ${DIAGNOSTIC.maxTurns} model turns; use focused reads and leave time to write the file.`;
}

export function inspectModelTrace(stdout, expectedFiles, workspace) {
  const terminal = verifyAgentTerminal(stdout);
  let events;
  try {
    events = stdout
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map(JSON.parse);
  } catch {
    return {
      pass: false,
      terminal,
      parseError: true,
      estimatedCostUSD: null,
      actualBilledCostUSD: null,
    };
  }
  const init = events.find(
    (event) => event.type === "system" && event.subtype === "init",
  );
  const plannedTools = [
    ...new Set(
      events
        .filter((event) => event.type === "context.plan.created")
        .flatMap((event) =>
          (event.plan?.selected || [])
            .filter((item) => item.kind === "tool-schema")
            .map((item) => item.sourceRef?.id),
        ),
    ),
  ];
  const fileOnlyToolSurface =
    Array.isArray(init?.tools) &&
    init.tools.every((tool) => fileTools.includes(tool)) &&
    plannedTools.every((tool) => fileTools.includes(tool));
  const uses = events.filter((event) => event.type === "tool_use");
  const results = events.filter((event) => event.type === "tool_result");
  const usageEvents = events.filter((event) => event.type === "token_usage");
  const unknownUsageEvents = events.filter((event) =>
    /usage[_-]unknown/u.test(event.type || ""),
  );
  const expected = new Set(
    expectedFiles.map((file) => path.resolve(workspace, file)),
  );
  const inWorkspace = (file) => {
    if (typeof file !== "string") return false;
    const relative = path.relative(workspace, path.resolve(workspace, file));
    return (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const uniqueIds =
    uses.every((use) => typeof use.id === "string" && use.id.length > 0) &&
    new Set(uses.map((use) => use.id)).size === uses.length;
  const scoped = uses.every(
    (use) =>
      fileTools.includes(use.tool) &&
      (writeTools.has(use.tool)
        ? typeof use.args?.path === "string" &&
          expected.has(path.resolve(workspace, use.args.path))
        : inWorkspace(use.args?.path ?? use.args?.directory ?? ".")),
  );
  const settled =
    uniqueIds &&
    results.length === uses.length &&
    uses.every((use) => {
      const matches = results.filter(
        (result) => result.id === use.id && result.tool === use.tool,
      );
      return (
        matches.length === 1 && events.indexOf(matches[0]) > events.indexOf(use)
      );
    });
  // Authority can refuse a request before tool-executing. Keep these denials
  // visible without treating a result-only trace as a verified invocation.
  const preExecutionDenials = results
    .filter((result) => {
      const policy = result.result?.policy;
      const decision = result.permission_decision;
      return (
        !uses.some((use) => use.id === result.id) &&
        typeof result.id === "string" &&
        result.id.length > 0 &&
        result.is_error === true &&
        typeof result.error === "string" &&
        result.error.length > 0 &&
        result.execution_started !== true &&
        writeTools.has(result.tool) &&
        policy?.decision === "deny" &&
        policy.via === "exact-file-mutation-scope" &&
        decision?.decision === policy.decision &&
        decision.version === 1 &&
        decision.via === policy.via &&
        decision.tool === result.tool &&
        decision.reason === policy.reason &&
        decision.id === result.permission_decision_id &&
        decision.id === `${result.id}:perm:exact-file-mutation-scope` &&
        [
          "invalid-scope",
          "invalid-path",
          "non-canonical-path",
          "path-not-allowed",
          "path-identity-changed",
        ].includes(policy.reason)
      );
    })
    .map((result) => ({
      id: result.id,
      tool: result.tool,
      reason: result.result.policy.reason,
      executionStarted: result.execution_started === false ? false : null,
    }));
  const delivered = expectedFiles.every((file) =>
    uses.some(
      (use) =>
        writeTools.has(use.tool) &&
        path.resolve(workspace, use.args?.path || ".") ===
          path.resolve(workspace, file) &&
        results.some(
          (result) =>
            result.id === use.id && result.is_error === false && !result.error,
        ),
    ),
  );
  const identity =
    init?.provider === DIAGNOSTIC.provider &&
    init?.model === DIAGNOSTIC.model &&
    init?.permission_mode === "acceptEdits" &&
    usageEvents.length > 0 &&
    usageEvents.every(
      (event) =>
        event.provider === DIAGNOSTIC.provider &&
        event.model === DIAGNOSTIC.model,
    );
  const observedUsage = usageEvents.reduce((sum, event) => {
    for (const [name, value] of Object.entries(event.usage || {})) {
      if (Number.isSafeInteger(value) && value >= 0)
        sum[name] = (sum[name] || 0) + value;
    }
    return sum;
  }, {});
  const errorResult = events.find(
    (event) => event.type === "result" && event.is_error === true,
  );
  return {
    pass:
      terminal.terminalVerified &&
      terminal.observedFallback === false &&
      identity &&
      fileOnlyToolSurface &&
      scoped &&
      settled &&
      delivered,
    terminal,
    identity,
    fileOnlyToolSurface,
    plannedTools,
    scoped,
    settled,
    preExecutionDenials,
    delivered,
    init,
    tools: uses,
    toolResults: results,
    usageEvents,
    unknownUsageEvents,
    observedUsage,
    usageComplete: terminal.terminalVerified,
    failureCategory: errorResult
      ? errorResult.subtype === "error_max_turns"
        ? "iteration-budget-exhausted"
        : errorResult.error === "fetch failed"
          ? "provider-fetch-failed"
          : "agent-error"
      : !terminal.terminalVerified
        ? "missing-terminal"
        : !settled
          ? "tool-settlement-unverified"
          : !scoped
            ? "tool-scope-unverified"
            : !delivered
              ? "deliverable-unverified"
              : null,
    modelUsageRecordCount: usageEvents.length,
    // This is the CLI estimate, never a provider invoice or a hard quota.
    estimatedCostUSD: terminal.totalCostUsd,
    actualBilledCostUSD: null,
    final: events.filter((event) => event.type === "result").at(-1) || null,
  };
}

function snapshot(root) {
  const entries = {};
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      if (name === "node_modules") continue;
      const file = path.posix.join(relative, name),
        absolute = path.join(root, file);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink())
        entries[file] = { type: "link", target: fs.readlinkSync(absolute) };
      else if (stat.isDirectory()) visit(file);
      else
        entries[file] = {
          type: "file",
          bytes: stat.size,
          digest: hash(fs.readFileSync(absolute)),
          mode: stat.mode & 0o777,
        };
    }
  }
  visit("");
  return entries;
}

export function changedFiles(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter(
      (file) => JSON.stringify(before[file]) !== JSON.stringify(after[file]),
    );
}

export async function runTaskDiagnostic({
  outputDir,
  imageId,
  sourceSha,
  key,
}) {
  const output = path.resolve(outputDir);
  const relativeOutput = path.relative(repository, output);
  assert.ok(
    relativeOutput.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeOutput),
    "evidence must be outside the execution source repository",
  );
  assert.ok(!fs.existsSync(output), "output directory must be new");
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const save = (relative, value) => {
    const bytes = redactDiagnostic(
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
      key,
    );
    const file = path.join(output, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
    return {
      path: relative,
      digest: hash(bytes),
      bytes: Buffer.byteLength(bytes),
    };
  };
  const summary = {
    schema: "chainlesschain.verify01-volcengine-task-diagnostic/v1",
    startedAt: stamp(),
    executionSourceCommit: sourceSha,
    ...DIAGNOSTIC,
    tasks: [],
    imageId,
    imageReference: REVIEW_IMAGE,
    formalSample: false,
    formal36Observed: 0,
    formal9Observed: 0,
    independentHumanReview: false,
    productionAttested: false,
    releaseEligible: false,
    actualBilledCostUSD: null,
    limitations: [
      "Public CLI .99 is executed, with transport-only diagnostic overrides recorded separately from the frozen default-thinking comparisons.",
      "Public .99 exposes a six-file-tool ceiling; this run requests all six explicitly and records the actual schemas and calls. It does not attest a narrower two-tool ceiling.",
      "Only expected test deliverables may change; implementation edits in the original task are deliberately excluded.",
      "The $0.25 per-task CLI stop uses returned usage estimates; an in-flight call may exceed it and unpriced/unknown usage is not a hard quota.",
      "The diagnostic broker disables thinking, requests at most 4096 answer tokens, admits at most 14 physical requests per task and rejects unknown usage before another call. These are diagnostic bounds, not formal budget activation or a provider invoice.",
      "Acceptance is an AI-reviewed independent Docker checker, not independent human review or frozen sample admission.",
      "Setup, model and checker share each task's 20-minute deadline; no automatic model retries or fallback models.",
    ],
    passed: false,
  };
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-volcengine-task-diagnostic-"),
  );
  let broker;
  let activeChild,
    canceled = false;
  const stop = () => {
    if (activeChild?.pid) {
      try {
        process.kill(-activeChild.pid, "SIGKILL");
      } catch {
        // The process group may already have exited before cancellation.
      }
    }
  };
  const onSignal = () => {
    canceled = true;
    stop();
    process.exitCode = 130;
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  async function run(
    name,
    executable,
    args,
    { cwd, env = reviewEnvironment(), timeoutMs = 120000 } = {},
  ) {
    assert.ok(
      !canceled,
      "diagnostic was canceled; no further subprocesses may start",
    );
    assert.ok(timeoutMs > 0, "diagnostic deadline exhausted");
    const beganAt = stamp();
    const child = spawn(executable, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    let stdout = [],
      stderr = [],
      count = 0,
      timedOut = false,
      outputLimitExceeded = false,
      launchError = null;
    const append = (target, bytes) => {
      count += bytes.length;
      if (count > 64 * 1024 * 1024) {
        outputLimitExceeded = true;
        stop();
        return;
      }
      target.push(bytes);
    };
    child.stdout.on("data", (bytes) => append(stdout, bytes));
    child.stderr.on("data", (bytes) => append(stderr, bytes));
    child.on("error", (error) => {
      launchError = error.code || "UNKNOWN";
    });
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    const progress = setInterval(
      () => console.log(JSON.stringify({ stage: name, status: "running" })),
      25000,
    );
    const [exitCode, signal] = await new Promise((resolve) =>
      child.on("close", (code, signaled) => resolve([code, signaled])),
    );
    clearTimeout(timer);
    clearInterval(progress);
    activeChild = null;
    stdout = redactDiagnostic(Buffer.concat(stdout).toString("utf8"), key);
    stderr = redactDiagnostic(Buffer.concat(stderr).toString("utf8"), key);
    const receipt = {
      name,
      executable,
      args,
      beganAt,
      finishedAt: stamp(),
      timeoutMs,
      exitCode,
      signal,
      timedOut,
      outputLimitExceeded,
      launchError,
      stdout: save(`${name}.stdout`, stdout),
      stderr: save(`${name}.stderr`, stderr),
    };
    save(`${name}.process.json`, receipt);
    return {
      ...receipt,
      stdout,
      stderr,
      ok:
        exitCode === 0 &&
        !signal &&
        !timedOut &&
        !outputLimitExceeded &&
        !launchError,
    };
  }
  try {
    assert.equal(process.platform, "linux", "Linux Docker runner required");
    assert.equal(process.arch, "x64");
    assert.equal(process.version, "v22.12.0");
    assert.match(sourceSha || "", /^[a-f0-9]{40}$/u);
    assert.match(imageId || "", /^sha256:[a-f0-9]{64}$/u);
    assert.ok(
      typeof key === "string" && key.length > 0,
      "VOLCENGINE_API_KEY is required",
    );
    assert.equal(
      command("git", ["-C", repository, "rev-parse", "HEAD"]).trim(),
      sourceSha,
    );
    assert.equal(
      command("git", [
        "-C",
        repository,
        "status",
        "--porcelain",
        "--untracked-files=no",
      ]).trim(),
      "",
      "execution source must be clean",
    );
    summary.executionSourceBindings = [];
    for (const file of [
      "packages/cli/scripts/verify01-volcengine-task-diagnostic.mjs",
      "packages/cli/scripts/verify01-volcengine-diagnostic-broker.mjs",
      "packages/cli/scripts/verify01-review-pack.mjs",
      "packages/cli/scripts/verify01-review-runtime.mjs",
      "packages/cli/scripts/verify01-review-specs.mjs",
      "packages/cli/src/lib/eval/stream-terminal.js",
      ".github/workflows/verify01-volcengine-task-diagnostic.yml",
    ]) {
      const bytes = fs.readFileSync(path.join(repository, file));
      const committed = command(
        "git",
        ["-C", repository, "show", `${sourceSha}:${file}`],
        { encoding: null },
      );
      assert.ok(
        bytes.equals(committed),
        `execution source binding differs: ${file}`,
      );
      summary.executionSourceBindings.push({
        file,
        ...save(`execution-source/${file}`, bytes.toString("utf8")),
      });
    }
    const catalog = json(path.join(planDir, "tasks.json"));
    assert.equal(catalog.projectCommit, DIAGNOSTIC.projectCommit);
    assert.equal(
      fs.readFileSync(path.join(planDir, "plan.sha256"), "utf8").trim(),
      DIAGNOSTIC.planDigest,
    );
    const image = JSON.parse(
      command("docker", ["image", "inspect", imageId]),
    )[0];
    assert.equal(image.Id, imageId);
    assert.ok(image.RepoTags?.includes(REVIEW_IMAGE));
    summary.imageRepoDigests = image.RepoDigests;
    const packRoot = path.join(output, "pack");
    const pack = generateReviewPack({ outputDir: packRoot, imageId, planDir });
    summary.reviewDigest = pack.reviewDigest;
    const review = json(path.join(packRoot, "review.json"));
    const archive = path.join(scratch, "frozen.tar");
    command("git", [
      "-C",
      repository,
      "archive",
      "--format=tar",
      "--output",
      archive,
      DIAGNOSTIC.projectCommit,
    ]);
    const archiveHash = createHash("sha256");
    for await (const chunk of fs.createReadStream(archive))
      archiveHash.update(chunk);
    summary.frozenArchiveDigest = "sha256:" + archiveHash.digest("hex");

    const install = path.join(scratch, "public-cli");
    fs.mkdirSync(install);
    fs.writeFileSync(
      path.join(install, "package.json"),
      '{"private":true,"type":"module"}\n',
    );
    const npmCli = path.resolve(
      path.dirname(process.execPath),
      "../lib/node_modules/npm/bin/npm-cli.js",
    );
    const installation = await run(
      "public-install",
      process.execPath,
      [
        npmCli,
        "install",
        `chainlesschain@${DIAGNOSTIC.publicVersion}`,
        "--ignore-scripts",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--registry=https://registry.npmjs.org",
        "--userconfig=/dev/null",
        "--cache",
        path.join(scratch, "npm-cache"),
      ],
      { cwd: install, timeoutMs: 300000 },
    );
    assert.ok(installation.ok, "public CLI installation failed");
    const packageDir = path.join(install, "node_modules/chainlesschain");
    const locked = json(path.join(install, "package-lock.json")).packages[
      "node_modules/chainlesschain"
    ];
    assert.equal(locked.version, DIAGNOSTIC.publicVersion);
    assert.equal(
      locked.resolved,
      `https://registry.npmjs.org/chainlesschain/-/chainlesschain-${DIAGNOSTIC.publicVersion}.tgz`,
    );
    assert.match(locked.integrity, /^sha512-/u);
    const sourceBindings = [];
    for (const file of [
      "bin/chainlesschain.js",
      "src/commands/agent.js",
      "src/runtime/headless-runner.js",
      "src/runtime/agent-core.js",
      "src/lib/formal-quality-eval-runtime.js",
      "src/lib/eval/stream-terminal.js",
    ]) {
      const installed = fs.readFileSync(path.join(packageDir, file));
      const frozen = command(
        "git",
        [
          "-C",
          repository,
          "show",
          `${DIAGNOSTIC.publicReleaseCommit}:packages/cli/${file}`,
        ],
        { encoding: null },
      );
      assert.ok(
        installed.equals(frozen),
        `public release binding differs: ${file}`,
      );
      sourceBindings.push({
        file,
        digest: hash(installed),
        bytes: installed.length,
      });
    }
    save(
      "public-package-lock.json",
      fs.readFileSync(path.join(install, "package-lock.json"), "utf8"),
    );
    save("public-install-binding.json", {
      ...locked,
      sourceBindings,
      lifecycleScriptsEnabled: false,
      nativeSqliteAssessed: false,
    });

    broker = await createVolcengineDiagnosticBroker({
      outputDir: path.join(output, "broker"),
      key,
    });

    for (const taskId of DIAGNOSTIC.tasks) {
      if (canceled) break;
      const task = catalog.tasks.find((entry) => entry.id === taskId);
      const spec = VERIFY01_REVIEW_SPECS.find(
        (entry) => entry.taskId === taskId,
      );
      assert.ok(task && spec);
      const taskRoot = path.join(scratch, taskId),
        workspace = path.join(taskRoot, "workspace"),
        profile = path.join(taskRoot, "profile");
      fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
      fs.mkdirSync(profile, { mode: 0o700 });
      fs.mkdirSync(path.join(taskRoot, "user-home"), { mode: 0o700 });
      command("tar", ["-xf", archive, "-C", workspace]);
      const deadline = Date.now() + DIAGNOSTIC.taskTimeoutMs;
      const row = {
        taskId,
        startedAt: stamp(),
        deadline: new Date(deadline).toISOString(),
        expectedFiles: task.expectedFiles,
        formalSample: false,
        passed: false,
        setup: null,
        model: null,
        check: null,
        estimatedCostUSD: null,
        actualBilledCostUSD: null,
      };
      summary.tasks.push(row);
      async function stage(name) {
        const entry = review.tasks.find((item) => item.taskId === taskId)[name];
        const bytes = fs.readFileSync(path.join(packRoot, entry.path));
        assert.equal(hash(bytes), entry.digest);
        const result = await run(
          `${taskId}/${name}`,
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            bytes.toString("utf8"),
            workspace,
            String(deadline),
          ],
          { cwd: packRoot, timeoutMs: Math.min(645000, deadline - Date.now()) },
        );
        assert.ok(result.ok, `${name} process did not complete successfully`);
        const verdict = JSON.parse(result.stdout.trim());
        assert.match(
          verdict.receipt,
          new RegExp(`^${taskId}-${name}-[a-f0-9-]+\\.json$`, "u"),
        );
        const receiptBytes = fs.readFileSync(
          path.join(packRoot, "acceptance-evidence", verdict.receipt),
        );
        assert.equal(hash(receiptBytes), verdict.receiptDigest);
        const receipt = JSON.parse(receiptBytes);
        assert.equal(receipt.taskId, taskId);
        assert.equal(receipt.stage, name);
        assert.equal(receipt.pass, verdict.pass);
        return {
          ...verdict,
          scriptDigest: entry.digest,
          receiptPath: `pack/acceptance-evidence/${verdict.receipt}`,
          tests: receipt.tests,
          mutations: receipt.mutations,
          detail: receipt.detail,
        };
      }
      try {
        save(`${taskId}/task.json`, task);
        row.setup = await stage("setup");
        assert.equal(row.setup.pass, true, "trusted setup failed");
        const before = snapshot(workspace);
        save(`${taskId}/before-model-tree.json`, before);
        for (const file of task.expectedFiles) {
          const absolute = path.join(workspace, file);
          assert.ok(
            !fs.existsSync(absolute),
            "frozen task already contains a deliverable",
          );
          fs.mkdirSync(path.dirname(absolute), { recursive: true });
          fs.writeFileSync(
            absolute,
            "// Diagnostic placeholder: replace with your independent behavioral tests.\n",
            { flag: "wx", mode: 0o600 },
          );
        }
        broker.beginTask(taskId);
        const taskEnvironment = modelEnvironment({
          root: taskRoot,
          profile,
          expectedFiles: task.expectedFiles,
          key: broker.childKey,
        });
        // Exercise the installed product's directory guards before a model call.
        const configPreflight = await run(
          `${taskId}/config-preflight`,
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            "const {loadConfig}=await import(process.argv[1]);loadConfig({failIfUnavailable:true});console.log(JSON.stringify({loaded:true}));",
            pathToFileURL(path.join(packageDir, "src/lib/config-manager.js"))
              .href,
          ],
          {
            cwd: workspace,
            env: taskEnvironment,
            timeoutMs: Math.min(30000, deadline - Date.now()),
          },
        );
        row.configPreflight = { passed: configPreflight.ok, modelCalls: 0 };
        assert.ok(
          configPreflight.ok,
          "installed config directory preflight failed",
        );
        const prompt = taskPrompt(task, spec);
        save(`${taskId}/prompt.txt`, prompt);
        const modelTimeout = Math.min(
          8 * 60 * 1000,
          deadline - Date.now() - 4 * 60 * 1000,
        );
        assert.ok(
          modelTimeout > 0,
          "setup left insufficient time for model and independent checker",
        );
        const args = [
          path.join(packageDir, "bin/chainlesschain.js"),
          "agent",
          "-p",
          prompt,
          "--provider",
          DIAGNOSTIC.provider,
          "--model",
          DIAGNOSTIC.model,
          "--base-url",
          broker.baseUrl,
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
        const result = await run(`${taskId}/model`, process.execPath, args, {
          cwd: workspace,
          timeoutMs: modelTimeout,
          env: taskEnvironment,
        });
        row.model = {
          processPassed: result.ok,
          timedOut: result.timedOut,
          signal: result.signal,
          exitCode: result.exitCode,
          ...inspectModelTrace(result.stdout, task.expectedFiles, workspace),
        };
        row.estimatedCostUSD = row.model.estimatedCostUSD;
        const after = snapshot(workspace);
        row.changedPaths = changedFiles(before, after);
        row.onlyExpectedFilesChanged =
          row.changedPaths.length === task.expectedFiles.length &&
          row.changedPaths.every((file) => task.expectedFiles.includes(file));
        save(`${taskId}/after-model-tree.json`, after);
        row.candidates = [];
        for (const file of task.expectedFiles) {
          const candidate = fs.readFileSync(path.join(workspace, file));
          row.candidates.push({
            file,
            originalDigest: hash(candidate),
            ...save(`${taskId}/candidate/${file}`, candidate.toString("utf8")),
          });
          // git diff --no-index returns 1 for a real diff. It never executes candidate code.
          const diff = await run(
            `${taskId}/diff-${path.basename(file)}`,
            "git",
            ["diff", "--no-index", "--", "/dev/null", file],
            { cwd: workspace },
          );
          assert.ok(
            [0, 1].includes(diff.exitCode) && !diff.signal && !diff.launchError,
            "candidate diff failed",
          );
        }
        // Even an incomplete agent response gets independent checking if its
        // candidate bytes and workspace scope are intact. Never run candidate
        // code outside Docker or feed checker results back for unbounded retries.
        if (row.onlyExpectedFilesChanged) row.check = await stage("check");
        row.sourceRestored = changedFiles(before, snapshot(workspace)).every(
          (file) => task.expectedFiles.includes(file),
        );
        row.passed =
          result.ok &&
          row.model.pass &&
          row.onlyExpectedFilesChanged &&
          row.sourceRestored &&
          row.check?.pass === true &&
          row.check.mutations.length === spec.mutants.length;
      } catch (error) {
        row.failure = redactDiagnostic(String(error.message), key);
      } finally {
        row.broker = broker?.taskStatus(taskId) || null;
        row.passed = row.passed && row.broker?.passed === true;
        row.finishedAt = stamp();
        save(`${taskId}/result.json`, row);
        console.log(
          JSON.stringify({
            taskId,
            passed: row.passed,
            estimatedCostUSD: row.estimatedCostUSD,
            actualBilledCostUSD: null,
          }),
        );
      }
    }
    summary.passed =
      summary.tasks.length === DIAGNOSTIC.tasks.length &&
      summary.tasks.every((task) => task.passed);
  } catch (error) {
    summary.failure = redactDiagnostic(String(error.message), key);
  } finally {
    stop();
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
    if (broker) summary.broker = await broker.close();
    summary.passed =
      summary.passed &&
      summary.broker?.poisoned === null &&
      summary.broker.physicalRequestsStarted > 0 &&
      summary.broker.usageCompleteRequests ===
        summary.broker.physicalRequestsStarted;
    summary.finishedAt = stamp();
    summary.estimatedTotalUSD =
      summary.tasks.length === DIAGNOSTIC.tasks.length &&
      summary.tasks.every((task) => Number.isFinite(task.estimatedCostUSD))
        ? summary.tasks.reduce((sum, task) => sum + task.estimatedCostUSD, 0)
        : null;
    save("summary.json", summary);
    // Keep scratch out of artifacts: it contains installed dependencies and
    // the transient model profile. Only explicitly selected evidence is saved.
  }
  return summary;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        "confirm-live": { type: "boolean", default: false },
        "output-dir": { type: "string" },
        "source-sha": { type: "string" },
        "image-id": { type: "string" },
        help: { type: "boolean", default: false },
      },
    });
    if (values.help)
      console.log(
        "Manual paid Volcengine verify-04/verify-22 diagnostic. Requires --confirm-live --output-dir NEW_DIR --source-sha EXACT_SHA --image-id sha256:IMAGE_ID and VOLCENGINE_API_KEY. No formal samples. $0.25 per-task estimated stop is not a hard spending limit.",
      );
    else {
      assert.ok(values["confirm-live"], "explicit --confirm-live is required");
      assert.ok(values["output-dir"], "--output-dir is required");
      const result = await runTaskDiagnostic({
        outputDir: values["output-dir"],
        sourceSha: values["source-sha"],
        imageId: values["image-id"],
        key: process.env.VOLCENGINE_API_KEY,
      });
      if (!result.passed) process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      redactDiagnostic(String(error.message), process.env.VOLCENGINE_API_KEY),
    );
    process.exitCode = 1;
  }
}
