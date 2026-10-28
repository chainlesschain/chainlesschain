import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { captureGoalWorkspace } from "./goal-workspace-evidence.js";
import { sameGoalWorkspace } from "./goal-check-evidence.js";
import {
  checkGoalVerificationCancellation,
  goalVerificationError,
  runGoalVerificationCommand,
} from "./goal-verification-command.js";

export const GOAL_VERIFICATION_SCHEMA = "chainlesschain.goal-verification/v1";
const PREPARED_SCHEMA = "chainlesschain.prepared-goal-verification/v1";
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fail = (message) => {
  throw goalVerificationError(message);
};
const fileCall = (file) => ({ tool: "read_file", args: { path: file } });

function fields(value, allowed, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    fail(`${label} contains unsupported fields`);
}
function text(value, label, maximum = 4096) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\0\r\n]/u.test(value)
  )
    fail(`${label} is invalid`);
  return value;
}
function list(value, label, maximum) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum)
    fail(`${label} must contain 1-${maximum} entries`);
  return value;
}
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function remaining(deadline) {
  const ms = deadline - Date.now();
  if (ms <= 0)
    fail("Goal verification preparation exceeded its resource limit");
  return ms;
}
async function bindFile(
  file,
  signal,
  deadline,
  maxFileBytes = 8 * 1024 * 1024,
) {
  checkGoalVerificationCancellation(signal);
  const binding = await captureGoalWorkspace(
    path.dirname(file),
    fileCall(path.basename(file)),
    {
      signal,
      limits: {
        maxFileBytes,
        maxBytes: maxFileBytes,
        maxMs: Math.min(15_000, remaining(deadline)),
      },
    },
  );
  checkGoalVerificationCancellation(signal);
  if (!binding.verified)
    fail(`Goal checker input is unavailable (${binding.reason}): ${file}`);
  return { path: file, binding };
}
async function readManifest(file, signal, deadline) {
  const before = await bindFile(file, signal, deadline, 64 * 1024);
  const handle = await fs.open(file, "r");
  let bytes;
  try {
    const buffer = Buffer.alloc(64 * 1024 + 1);
    let size = 0;
    while (size < buffer.length) {
      checkGoalVerificationCancellation(signal);
      const next = await handle.read(buffer, size, buffer.length - size, size);
      if (next.bytesRead === 0) break;
      size += next.bytesRead;
    }
    if (size > 64 * 1024) fail("Goal verification manifest is too large");
    bytes = buffer.subarray(0, size);
  } finally {
    await handle.close();
  }
  const after = await bindFile(file, signal, deadline, 64 * 1024);
  if (
    !sameGoalWorkspace(before.binding, after.binding) ||
    digest(bytes) !== before.binding.artifacts[0].digest
  )
    fail("Goal verification manifest changed while it was read");
  let manifest;
  try {
    manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    fail("Goal verification manifest must be valid UTF-8 JSON");
  }
  return { manifest, input: after };
}

/** Prepare before any author turn. On resume, the original definition and
 * checker input identities win; replacing a manifest cannot weaken the goal.
 */
export async function prepareGoalVerification(condition, cwd, { signal } = {}) {
  const deadline = Date.now() + 30_000;
  const manifestPath = path.resolve(cwd, text(condition.path, "manifest path"));
  const { manifest, input } = await readManifest(
    manifestPath,
    signal,
    deadline,
  );
  fields(
    manifest,
    ["schema", "checks", "artifacts"],
    "Goal verification manifest",
  );
  if (manifest.schema !== GOAL_VERIFICATION_SCHEMA)
    fail("Unknown Goal verification manifest schema");
  const root = await fs.realpath(path.resolve(cwd));
  const artifacts = list(manifest.artifacts, "artifacts", 32).map((name) => {
    const target = path.resolve(root, text(name, "artifact path"));
    const relative = path.relative(root, target);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      fail("Goal verification artifacts must be files inside the workspace");
    return relative.split(path.sep).join("/");
  });
  const ids = new Set(),
    inputs = new Map([[manifestPath, input]]);
  const checks = [];
  for (const value of list(manifest.checks, "checks", 8)) {
    fields(
      value,
      ["id", "executable", "args", "checkerFiles", "timeoutMs", "requirements"],
      "Goal check",
    );
    const id = text(value.id, "check id", 80);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u.test(id) || ids.has(id))
      fail("Goal check IDs must be distinct identifiers");
    ids.add(id);
    const requirements = list(value.requirements, "requirements", 32).map(
      (requirement) => text(requirement, "requirement ID", 80),
    );
    if (
      new Set(requirements).size !== requirements.length ||
      requirements.some(
        (requirement) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u.test(requirement),
      )
    )
      fail("Requirement IDs must be distinct identifiers within each check");
    const executable = text(value.executable, "checker executable");
    if (executable !== "node" && !path.isAbsolute(executable))
      fail("Use node or an absolute checker executable path");
    if (
      !Array.isArray(value.args) ||
      value.args.length > 64 ||
      value.args.some(
        (arg) =>
          typeof arg !== "string" || arg.length > 4096 || arg.includes("\0"),
      )
    )
      fail("Goal checker args must be a bounded string array");
    const timeoutMs = value.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      fail("Goal checker timeout must be 1-60000ms");
    const checkerFiles = [];
    for (const name of list(value.checkerFiles, "checkerFiles", 32)) {
      const file = path.resolve(
        path.dirname(manifestPath),
        text(name, "checker input"),
      );
      if (
        artifacts.some(
          (artifact) =>
            path.relative(file, path.resolve(root, artifact)) === "",
        )
      )
        fail("A mutable deliverable cannot also be a frozen checker input");
      if (!inputs.has(file)) {
        if (inputs.size >= 65) fail("Too many frozen checker inputs");
        inputs.set(file, await bindFile(file, signal, deadline));
      }
      checkerFiles.push(file);
    }
    checks.push({
      id,
      executable,
      args: [...value.args],
      checkerFiles,
      timeoutMs,
      requirements,
    });
  }
  const prepared = {
    schema: PREPARED_SCHEMA,
    workspace: root,
    manifestPath,
    checks,
    artifacts,
    inputs: [...inputs.values()],
  };
  const planDigest = digest(JSON.stringify(prepared));
  if (
    condition.verification &&
    (condition.verification.schema !== PREPARED_SCHEMA ||
      condition.verification.digest !== planDigest)
  )
    fail(
      "The frozen Goal verification definition changed; resume cannot replace its acceptance checks",
    );
  return freeze({
    ...condition,
    verification: { ...prepared, digest: planDigest },
  });
}

async function currentInputs(plan, signal) {
  const deadline = Date.now() + 30_000;
  for (const input of plan.inputs) {
    try {
      const current = await bindFile(input.path, signal, deadline);
      if (!sameGoalWorkspace(input.binding, current.binding)) return false;
    } catch {
      checkGoalVerificationCancellation(signal);
      return false;
    }
  }
  return true;
}
async function captureInputs(plan, signal) {
  checkGoalVerificationCancellation(signal);
  const source = await captureGoalWorkspace(
    plan.workspace,
    { tool: "run_shell" },
    { signal },
  );
  const artifacts = [];
  for (const artifact of plan.artifacts) {
    checkGoalVerificationCancellation(signal);
    artifacts.push(
      await captureGoalWorkspace(plan.workspace, fileCall(artifact), {
        signal,
      }),
    );
  }
  checkGoalVerificationCancellation(signal);
  return {
    source,
    artifacts,
    verified: source.verified && artifacts.every((entry) => entry.verified),
  };
}
function sameInputs(left, right) {
  return (
    sameGoalWorkspace(left.source, right.source) &&
    left.artifacts.length === right.artifacts.length &&
    left.artifacts.every((entry, index) =>
      sameGoalWorkspace(entry, right.artifacts[index]),
    )
  );
}

/** All independently declared checks must pass against one unchanged candidate.
 * The author/model cannot supply the command result or select a passing subset.
 */
export async function evaluateGoalVerification(
  condition,
  {
    cwd,
    signal,
    deadline = Infinity,
    runCommand = runGoalVerificationCommand,
    onCheckStart = () => {},
  } = {},
) {
  checkGoalVerificationCancellation(signal);
  const plan = condition.verification;
  if (!plan || plan.schema !== PREPARED_SCHEMA)
    fail("Goal verification was not prepared before the author turn");
  if ((await fs.realpath(path.resolve(cwd))) !== plan.workspace)
    fail("Goal verification workspace changed");
  const evidence = {
    kind: "verification",
    source: "host-prepared-checks",
    planDigest: plan.digest,
    manifestPath: plan.manifestPath,
    requiredChecks: plan.checks.map((check) => check.id),
    checks: [],
    checkerInputs: plan.inputs,
    coverage: { required: plan.checks.length, executed: 0, passed: 0 },
    manualReviewRequired: false,
  };
  const unmet = (reason) => ({ met: false, reason, evidence });
  if (Date.now() >= deadline)
    return unmet("Goal time budget exhausted before independent verification");
  if (!(await currentInputs(plan, signal)))
    fail(
      "Frozen Goal checker inputs changed; stop and review the acceptance definition",
    );
  const before = await captureInputs(plan, signal);
  evidence.workspace = before;
  if (!before.verified)
    return unmet(
      "Goal source or required artifact evidence is missing or incomplete",
    );
  for (const check of plan.checks) {
    checkGoalVerificationCancellation(signal);
    await onCheckStart({
      met: false,
      reason: `Independent Goal check ${check.id} is starting`,
      evidence: { ...structuredClone(evidence), pendingCheckId: check.id },
    });
    checkGoalVerificationCancellation(signal);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0)
      return unmet(
        "Goal time budget exhausted before independent verification",
      );
    const result = await runCommand(check, {
      cwd: plan.workspace,
      signal,
      timeoutMs: Math.min(check.timeoutMs, remainingMs),
    });
    checkGoalVerificationCancellation(signal);
    evidence.checks.push(result);
    evidence.coverage.executed++;
    if (!(await currentInputs(plan, signal)))
      fail(
        "Frozen Goal checker inputs changed during verification; stop and review",
      );
    const after = await captureInputs(plan, signal);
    evidence.workspaceCurrent = after.verified && sameInputs(before, after);
    if (!evidence.workspaceCurrent)
      return unmet(
        "Goal source or artifacts changed during independent verification",
      );
    if (result?.status !== "passed" || result.exitCode !== 0 || result.signal)
      return unmet(
        `Independent Goal check ${check.id} did not pass (${result?.status || "unknown"})`,
      );
    evidence.coverage.passed++;
  }
  if (Date.now() >= deadline)
    return unmet("Goal time budget expired before verification settled");
  checkGoalVerificationCancellation(signal);
  return {
    met: true,
    reason:
      "All independent Goal checks passed for the current source and required artifacts",
    evidence,
  };
}
