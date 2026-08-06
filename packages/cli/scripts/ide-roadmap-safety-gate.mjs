import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PlanModeManager,
  PlanSessionPersistence,
  PlanState,
  PlanStatus,
  planSnapshotPath,
} from "../src/lib/plan-mode.js";
import {
  getTodoSnapshot,
  recoverTodoSnapshot,
  resetAllStores,
  TodoSnapshotPersistence,
  todoSnapshotPath,
  validateTodos,
  writeTodos,
} from "../src/lib/todo-manager.js";
import {
  appendWsSessionStateEvent,
  createWsSessionState,
  getWsSessionStateSnapshot,
  hydrateWsSessionState,
  recoverWsSessionState,
  serializeWsSessionState,
} from "../src/gateways/ws/ws-session-state.js";
import {
  parseStructuredHandoff,
  PromptCompressor,
  STRUCTURED_HANDOFF_FIELDS,
} from "../src/harness/prompt-compressor.js";
import { executionBroker } from "../src/lib/process-execution-broker/index.js";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "../../..");
const cliRoot = path.resolve(scriptDir, "..");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "ide-roadmap");
const manifestPath = path.join(fixtureRoot, "manifest.json");
const persistenceFixturePath = path.join(
  fixtureRoot,
  "s0-persistence-replay.json",
);
const handoffFixturePath = path.join(fixtureRoot, "s0-semantic-handoff.json");
const atomicKillPoints = Object.freeze([
  "before-temp-write",
  "after-temp-fsync",
  "before-rename",
  "after-rename-before-response",
]);
const runtimeKillPoints = Object.freeze([
  "while-awaiting-approval",
  "while-plan-item-executing",
  "while-websocket-disconnected",
]);
const allKillPoints = Object.freeze([
  ...atomicKillPoints,
  ...runtimeKillPoints,
]);
export const IDE_ROADMAP_SAFETY_KILL_POINTS = allKillPoints;
const releaseCommitPattern = /^[0-9a-f]{40}$/;
const evidenceSchema = "chainlesschain.ide-roadmap-safety-evidence.v1";
const aggregateSchema =
  "chainlesschain.ide-roadmap-safety-evidence-aggregate.v1";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function sha256Json(value) {
  return sha256(JSON.stringify(value));
}

function normalizeReleaseCommit(value) {
  const commit = String(value || "")
    .trim()
    .toLowerCase();
  if (!releaseCommitPattern.test(commit)) {
    throw new Error("--release-commit must be an exact 40-character SHA");
  }
  return commit;
}

function operatingSystemName(platform = process.platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  return platform;
}

function safeError(error) {
  return {
    name: String(error?.name || "Error").slice(0, 80),
    code: error?.code ? String(error.code).slice(0, 120) : null,
    message: String(error?.message || error || "unknown failure").slice(
      0,
      2_000,
    ),
  };
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), {
    recursive: true,
    mode: 0o700,
  });
}

function writeJson(filePath, value) {
  ensureParent(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function validateFixtureContract() {
  const manifest = readJson(manifestPath);
  const persistence = readJson(persistenceFixturePath);
  const handoff = readJson(handoffFixturePath);
  const persistenceEntry = manifest.cases?.find(
    (entry) => entry.id === "s0-persistence-replay",
  );
  const handoffEntry = manifest.cases?.find(
    (entry) => entry.id === "s0-semantic-handoff",
  );
  if (!persistenceEntry || !handoffEntry) {
    throw new Error("roadmap manifest is missing formal safety cases");
  }
  for (const [entry, filePath] of [
    [persistenceEntry, persistenceFixturePath],
    [handoffEntry, handoffFixturePath],
  ]) {
    const actual = `sha256:${sha256File(filePath)}`;
    if (entry.fixtureDigest !== actual) {
      throw new Error(
        `roadmap fixture digest mismatch for ${entry.id}: ${actual}`,
      );
    }
    if (entry.minimumIndependentRuns !== 100) {
      throw new Error(`${entry.id} must require exactly 100 independent runs`);
    }
  }
  if (
    JSON.stringify(persistence.killPoints) !== JSON.stringify(allKillPoints)
  ) {
    throw new Error("persistence fixture kill points do not match the gate");
  }
  return {
    manifest,
    persistence,
    handoff,
    persistenceEntry,
    handoffEntry,
    digests: {
      manifest: `sha256:${sha256File(manifestPath)}`,
      persistence: persistenceEntry.fixtureDigest,
      handoff: handoffEntry.fixtureDigest,
    },
  };
}

function currentGitHead() {
  const result = executionBroker.spawnSync("git", ["rev-parse", "HEAD"], {
    origin: "tooling:ide-roadmap-safety-gate",
    scope: "exact-commit-readback",
    policy: "allow",
    shell: false,
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result?.status !== 0) {
    throw new Error("could not read the checked-out Git commit");
  }
  return normalizeReleaseCommit(String(result.stdout || "").trim());
}

function samplePaths(sampleRoot, sessionId) {
  return {
    planStateDir: path.join(sampleRoot, "plans"),
    todoStateDir: path.join(sampleRoot, "todos"),
    wsStatePath: path.join(sampleRoot, "ws-state.json"),
    sessionId,
  };
}

function initializeSample(paths) {
  fs.mkdirSync(paths.planStateDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.todoStateDir, { recursive: true, mode: 0o700 });
  const plan = new PlanModeManager({
    sessionId: paths.sessionId,
    stateDir: paths.planStateDir,
  });
  plan.enterPlanMode({
    title: "Formal recovery authority",
    goal: "prove a process crash cannot widen the approved authority",
  });
  plan.addPlanItem({
    id: "read-authority",
    title: "Read verified state",
    tool: "read_file",
    owner: "formal-safety-gate",
    checkpoint: { checkpointId: "s0-formal-baseline" },
    evidenceLineage: ["fixture:s0-persistence-replay"],
  });
  const approval = plan.approvePlan({ permissionMode: "plan" });
  if (approval?.code || approval?.error) {
    throw new Error(`could not establish plan baseline: ${approval.error}`);
  }
  resetAllStores();
  const todo = writeTodos(
    paths.sessionId,
    [{ id: "safe", content: "retain safe baseline", status: "in_progress" }],
    { stateDir: paths.todoStateDir },
  );
  resetAllStores();
  if (!todo.success) throw new Error(`could not establish TODO baseline`);
  return {
    planRevision: plan.revision,
    todoRevision: todo.revision,
    executionLock: plan.getExecutionLock(),
  };
}

function isTargetTemporaryPath(candidate, canonicalPath) {
  if (typeof candidate !== "string") return false;
  const resolved = path.resolve(candidate);
  const prefix = path.join(
    path.dirname(canonicalPath),
    `.${path.basename(canonicalPath)}.`,
  );
  return resolved.startsWith(prefix) && resolved.endsWith(".tmp");
}

function stopWorker(point, details = {}) {
  const message = `${JSON.stringify({
    ready: true,
    point,
    pid: process.pid,
    ...details,
  })}\n`;
  fs.writeSync(process.stdout.fd, message, null, "utf8");
  const latch = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(latch, 0, 0);
  throw new Error("fault-injection latch returned unexpectedly");
}

function faultInjectingFs(point, canonicalPath) {
  const descriptors = new Map();
  let stopped = false;
  const stopOnce = (details) => {
    if (stopped) return;
    stopped = true;
    stopWorker(point, details);
  };
  return {
    ...fs,
    openSync(candidate, flags, mode) {
      const descriptor = fs.openSync(candidate, flags, mode);
      if (isTargetTemporaryPath(String(candidate), canonicalPath)) {
        descriptors.set(descriptor, path.resolve(String(candidate)));
      }
      return descriptor;
    },
    writeFileSync(target, data, options) {
      if (
        point === "before-temp-write" &&
        typeof target === "number" &&
        descriptors.has(target)
      ) {
        stopOnce({ temporaryPathDigest: sha256(descriptors.get(target)) });
      }
      return fs.writeFileSync(target, data, options);
    },
    fsyncSync(descriptor) {
      const result = fs.fsyncSync(descriptor);
      if (point === "after-temp-fsync" && descriptors.has(descriptor)) {
        stopOnce({ temporaryPathDigest: sha256(descriptors.get(descriptor)) });
      }
      return result;
    },
    closeSync(descriptor) {
      const result = fs.closeSync(descriptor);
      descriptors.delete(descriptor);
      return result;
    },
    renameSync(source, destination) {
      const result = fs.renameSync(source, destination);
      if (
        point === "after-rename-before-response" &&
        path.resolve(String(destination)) === canonicalPath &&
        isTargetTemporaryPath(String(source), canonicalPath)
      ) {
        stopOnce({ committedPathDigest: sha256(canonicalPath) });
      }
      return result;
    },
  };
}

function beforeRenameHook(point, canonicalPath) {
  if (point !== "before-rename") return null;
  return (source, destination) => {
    if (
      path.resolve(String(destination)) === canonicalPath &&
      isTargetTemporaryPath(String(source), canonicalPath)
    ) {
      stopWorker(point, { committedPathDigest: sha256(canonicalPath) });
    }
  };
}

function runAtomicWorker(component, point, sampleRoot, sessionId) {
  if (!atomicKillPoints.includes(point)) {
    throw new Error(`unknown atomic kill point: ${point}`);
  }
  const paths = samplePaths(sampleRoot, sessionId);
  if (component === "plan") {
    const canonicalPath = path.resolve(
      planSnapshotPath(sessionId, { stateDir: paths.planStateDir }),
    );
    const manager = new PlanModeManager({
      sessionId,
      stateDir: paths.planStateDir,
      persistenceOptions: {
        fs: faultInjectingFs(point, canonicalPath),
        beforeRename: beforeRenameHook(point, canonicalPath),
      },
    });
    if (manager.isToolAllowed("run_shell") !== false) {
      throw new Error("approved read-only plan unexpectedly allowed run_shell");
    }
  } else if (component === "todo") {
    const canonicalPath = path.resolve(
      todoSnapshotPath(sessionId, { stateDir: paths.todoStateDir }),
    );
    const persistence = new TodoSnapshotPersistence({
      stateDir: paths.todoStateDir,
      validateTodos,
      fs: faultInjectingFs(point, canonicalPath),
      beforeRename: beforeRenameHook(point, canonicalPath),
    });
    const result = writeTodos(
      sessionId,
      [{ id: "candidate", content: "candidate update", status: "completed" }],
      { persistence },
    );
    if (!result.success) {
      throw new Error(`TODO worker failed before reaching ${point}`);
    }
  } else {
    throw new Error(`unknown atomic component: ${component}`);
  }
  throw new Error(`worker did not stop at ${point}`);
}

function writeWsWorkerState(paths, journal, point) {
  writeJson(paths.wsStatePath, serializeWsSessionState(journal));
  stopWorker(point, {
    stateDigest: sha256File(paths.wsStatePath),
  });
}

function runRuntimeWorker(point, sampleRoot, sessionId) {
  if (!runtimeKillPoints.includes(point)) {
    throw new Error(`unknown runtime kill point: ${point}`);
  }
  const paths = samplePaths(sampleRoot, sessionId);
  if (point === "while-plan-item-executing") {
    const manager = new PlanModeManager({
      sessionId,
      stateDir: paths.planStateDir,
    });
    const item = manager.startPlanItemForTool("read_file", {
      toolUseId: `formal-tool-${sessionId}`,
      turn: 1,
      owner: "formal-safety-worker",
      checkpoint: { checkpointId: "s0-executing" },
      evidenceLineage: [
        "fixture:s0-persistence-replay",
        `session:${sessionId}`,
      ],
    });
    if (!item || item.code || item.error) {
      throw new Error("could not persist an executing plan item");
    }
    const journal = createWsSessionState({
      planSnapshot: manager.getSessionSnapshot(),
    });
    appendWsSessionStateEvent(journal, "run.started", {
      requestId: `run-${sessionId}`,
    });
    writeWsWorkerState(paths, journal, point);
  }

  const journal = createWsSessionState();
  appendWsSessionStateEvent(journal, "approval.requested", {
    requestId: `approval-${sessionId}`,
    binding: `binding-${sessionId}`,
    tool: "write_file",
    risk: "mutation",
    rule: "explicit-user-approval",
  });
  if (point === "while-websocket-disconnected") {
    appendWsSessionStateEvent(journal, "run.started", {
      requestId: `run-${sessionId}`,
    });
  }
  writeWsWorkerState(paths, journal, point);
}

function runWorker(args) {
  const [kind, componentOrPoint, pointOrRoot, rootOrSession, maybeSession] =
    args;
  if (kind === "atomic") {
    runAtomicWorker(componentOrPoint, pointOrRoot, rootOrSession, maybeSession);
    return;
  }
  if (kind === "runtime") {
    runRuntimeWorker(componentOrPoint, pointOrRoot, rootOrSession);
    return;
  }
  throw new Error(`unknown worker kind: ${kind}`);
}

function spawnCrashWorker(workerArgs, point, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const previous = process.env.CC_SANDBOX_DISABLE;
    process.env.CC_SANDBOX_DISABLE = "1";
    let child;
    try {
      child = executionBroker.fork(scriptPath, ["--worker", ...workerArgs], {
        origin: "tooling:ide-roadmap-safety-gate",
        scope: "persistence-fault-injection",
        policy: "allow",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } finally {
      if (previous == null) delete process.env.CC_SANDBOX_DISABLE;
      else process.env.CC_SANDBOX_DISABLE = previous;
    }

    let stdout = "";
    let stderr = "";
    let ready = null;
    let killed = false;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const inspect = () => {
      for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
        try {
          const value = JSON.parse(line);
          if (!value?.ready || value.point !== point) continue;
          ready = value;
          if (!killed) {
            killed = true;
            child.kill("SIGKILL");
          }
          return;
        } catch {
          // A later data event may complete the line.
        }
      }
    };
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      inspect();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code, signal) => {
      finish(() => {
        if (!ready || !killed) {
          reject(
            new Error(
              `worker did not reach ${point} (${code ?? signal ?? "unknown"}): ${stderr.trim()}`,
            ),
          );
          return;
        }
        resolve({
          point,
          pid: ready.pid,
          signal: signal || "forced",
          exitCode: code,
          workerEvidence: Object.fromEntries(
            Object.entries(ready).filter(
              ([key]) => !["ready", "point", "pid"].includes(key),
            ),
          ),
        });
      });
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Preserve the timeout error.
      }
      finish(() => reject(new Error(`worker timed out at ${point}`)));
    }, timeoutMs);
  });
}

function discardPlanTemporary(paths) {
  const persistence = new PlanSessionPersistence({
    stateDir: paths.planStateDir,
  });
  return persistence.recover(paths.sessionId, "discard-temporary");
}

function loadPlanAfterCrash(paths) {
  try {
    return {
      recoveryRequired: false,
      recovery: null,
      manager: new PlanModeManager({
        sessionId: paths.sessionId,
        stateDir: paths.planStateDir,
      }),
    };
  } catch (error) {
    if (error?.code !== "PLAN_SNAPSHOT_RECOVERY_REQUIRED") throw error;
    const recovery = discardPlanTemporary(paths);
    return {
      recoveryRequired: true,
      recovery,
      manager: new PlanModeManager({
        sessionId: paths.sessionId,
        stateDir: paths.planStateDir,
      }),
    };
  }
}

function loadTodoAfterCrash(paths) {
  resetAllStores();
  try {
    return {
      recoveryRequired: false,
      recovery: null,
      snapshot: getTodoSnapshot(paths.sessionId, {
        stateDir: paths.todoStateDir,
      }),
    };
  } catch (error) {
    if (error?.code !== "TODO_SNAPSHOT_RECOVERY_REQUIRED") throw error;
    const recovery = recoverTodoSnapshot(paths.sessionId, "discard-temporary", {
      stateDir: paths.todoStateDir,
    });
    resetAllStores();
    return {
      recoveryRequired: true,
      recovery,
      snapshot: getTodoSnapshot(paths.sessionId, {
        stateDir: paths.todoStateDir,
      }),
    };
  }
}

function executionLockIsUnchanged(manager, baseline) {
  const current = manager.getExecutionLock();
  return (
    sha256Json(current) === sha256Json(baseline.executionLock) &&
    current?.allowedTools?.includes("run_shell") === false
  );
}

async function runAtomicSample({ point, iteration, runRoot, baseline }) {
  const component = iteration % 2 === 0 ? "plan" : "todo";
  const sessionId = `s0-${point}-${iteration}`;
  const sampleRoot = path.join(runRoot, sessionId);
  const paths = samplePaths(sampleRoot, sessionId);
  const initialized = initializeSample(paths);
  const termination = await spawnCrashWorker(
    ["atomic", component, point, sampleRoot, sessionId],
    point,
  );
  const plan = loadPlanAfterCrash(paths);
  const todo = loadTodoAfterCrash(paths);
  const afterCommit = point === "after-rename-before-response";
  const expectedPlanRevision =
    component === "plan" && afterCommit
      ? initialized.planRevision + 1
      : initialized.planRevision;
  const expectedTodoRevision =
    component === "todo" && afterCommit
      ? initialized.todoRevision + 1
      : initialized.todoRevision;
  const todoId = todo.snapshot.todos[0]?.id;
  const lockUnchanged = executionLockIsUnchanged(plan.manager, initialized);
  const pass =
    plan.manager.revision === expectedPlanRevision &&
    todo.snapshot.revision === expectedTodoRevision &&
    lockUnchanged &&
    plan.manager.state === PlanState.APPROVED &&
    (todoId === "safe" || todoId === "candidate") &&
    (afterCommit
      ? !plan.recoveryRequired && !todo.recoveryRequired
      : component === "plan"
        ? plan.recoveryRequired
        : todo.recoveryRequired);
  const result = {
    id: sessionId,
    point,
    iteration,
    component,
    pass,
    executionLockWidened: !lockUnchanged,
    wrongApprovalBinding: false,
    termination: {
      signal: termination.signal,
      workerEvidence: termination.workerEvidence,
    },
    stateSnapshot: {
      planRevision: plan.manager.revision,
      planState: plan.manager.state,
      executionLockDigest: sha256Json(plan.manager.getExecutionLock()),
      todoRevision: todo.snapshot.revision,
      todoDigest: sha256Json(todo.snapshot.todos),
    },
    eventReplay: {
      planEventType: plan.manager.lastEvent?.type || null,
      planEventRevision: plan.manager.lastEvent?.revision || null,
      recoveryRequired: plan.recoveryRequired || todo.recoveryRequired,
      recoveryCount:
        Number(plan.recovery?.recovered || 0) +
        Number(todo.recovery?.recovered || 0),
    },
  };
  result.stateSnapshotDigest = sha256Json(result.stateSnapshot);
  result.eventReplayDigest = sha256Json(result.eventReplay);
  if (!pass) {
    throw Object.assign(new Error(`atomic recovery invariant failed`), {
      evidence: result,
    });
  }
  return result;
}

async function runRuntimeSample({ point, iteration, runRoot }) {
  const sessionId = `s0-${point}-${iteration}`;
  const sampleRoot = path.join(runRoot, sessionId);
  const paths = samplePaths(sampleRoot, sessionId);
  const initialized = initializeSample(paths);
  const termination = await spawnCrashWorker(
    ["runtime", point, sampleRoot, sessionId],
    point,
  );
  const persisted = readJson(paths.wsStatePath);
  const journal = hydrateWsSessionState(persisted);
  const recovery = recoverWsSessionState(journal, {
    at: new Date().toISOString(),
    reason:
      point === "while-websocket-disconnected"
        ? "websocket_reconnect"
        : "process_restart",
  });
  const ws = getWsSessionStateSnapshot(journal);
  const plan = loadPlanAfterCrash(paths);
  const todo = loadTodoAfterCrash(paths);
  const lockUnchanged = executionLockIsUnchanged(plan.manager, initialized);
  const approvalBindingCorrect =
    ws.pendingApproval == null ||
    (ws.pendingApproval.requestId === `approval-${sessionId}` &&
      ws.pendingApproval.binding === `binding-${sessionId}`);
  let pass =
    lockUnchanged && todo.snapshot.revision === initialized.todoRevision;
  if (point === "while-awaiting-approval") {
    pass =
      pass &&
      recovery.approvalInterrupted === true &&
      ws.pendingApproval?.status === "interrupted" &&
      ws.pendingApproval?.requestId === `approval-${sessionId}` &&
      ws.pendingApproval?.binding === `binding-${sessionId}`;
  } else if (point === "while-plan-item-executing") {
    const item = plan.manager.currentPlan?.getItem("read-authority");
    pass =
      pass &&
      plan.manager.state === PlanState.EXECUTING &&
      item?.status === PlanStatus.EXECUTING &&
      item?.evidenceLineage?.includes(`session:${sessionId}`) &&
      recovery.runInterrupted === true &&
      ws.run.status === "interrupted" &&
      ws.planSnapshot?.revision === plan.manager.revision;
  } else {
    pass =
      pass &&
      recovery.approvalInterrupted === true &&
      recovery.runInterrupted === true &&
      ws.pendingApproval?.status === "interrupted" &&
      ws.run.status === "interrupted" &&
      ws.run.reason === "websocket_reconnect";
  }
  const result = {
    id: sessionId,
    point,
    iteration,
    component: "runtime",
    pass,
    executionLockWidened: !lockUnchanged,
    wrongApprovalBinding: !approvalBindingCorrect,
    termination: {
      signal: termination.signal,
      workerEvidence: termination.workerEvidence,
    },
    stateSnapshot: {
      planRevision: plan.manager.revision,
      planState: plan.manager.state,
      executionLockDigest: sha256Json(plan.manager.getExecutionLock()),
      todoRevision: todo.snapshot.revision,
      wsRevision: ws.revision,
      runStatus: ws.run.status,
      approvalStatus: ws.pendingApproval?.status || null,
    },
    eventReplay: {
      recovery,
      reason: ws.run.reason || ws.pendingApproval?.reason || null,
      planSnapshotRevision: ws.planSnapshot?.revision || null,
    },
  };
  result.stateSnapshotDigest = sha256Json(result.stateSnapshot);
  result.eventReplayDigest = sha256Json(result.eventReplay);
  if (!pass) {
    throw Object.assign(new Error(`runtime recovery invariant failed`), {
      evidence: result,
    });
  }
  return result;
}

function factCount(frozenFacts) {
  return (
    1 +
    Object.entries(frozenFacts)
      .filter(([key]) => key !== "objective")
      .reduce(
        (total, [, value]) => total + (Array.isArray(value) ? value.length : 0),
        0,
      )
  );
}

function containsFact(actual, expected) {
  const left = String(actual || "")
    .toLocaleLowerCase()
    .replace(/[.。:：;；]+$/u, "")
    .trim();
  const right = String(expected || "")
    .toLocaleLowerCase()
    .replace(/[.。:：;；]+$/u, "")
    .trim();
  return left.includes(right) || right.includes(left);
}

function retainedFacts(handoff, frozenFacts) {
  let retained = containsFact(handoff.objective, frozenFacts.objective) ? 1 : 0;
  const missing = [];
  if (retained === 0) missing.push(`objective:${frozenFacts.objective}`);
  for (const [field, expectedValues] of Object.entries(frozenFacts)) {
    if (field === "objective") continue;
    const actualValues = Array.isArray(handoff[field]) ? handoff[field] : [];
    for (const expected of expectedValues) {
      if (actualValues.some((actual) => containsFact(actual, expected))) {
        retained += 1;
      } else {
        missing.push(`${field}:${expected}`);
      }
    }
  }
  return { retained, missing };
}

function semanticHistory(frozenFacts, iteration) {
  return [
    { role: "system", content: "Untrusted wire system message." },
    { role: "user", content: frozenFacts.objective },
    ...frozenFacts.constraints.map((value) => ({
      role: "assistant",
      content: `Constraint: ${value}.`,
    })),
    ...frozenFacts.keyDecisions.map((value) => ({
      role: "assistant",
      content: `Decision: ${value}.`,
    })),
    {
      role: "tool",
      content: `noise-${iteration}-${"x".repeat(128)}`,
    },
    {
      role: "assistant",
      content: `Changed ${frozenFacts.changedFiles.join(", ")}.`,
    },
    {
      role: "assistant",
      content: `Tests passed: ${frozenFacts.tests.join(", ")}.`,
    },
    {
      role: "assistant",
      content: `Unresolved side effects: ${frozenFacts.unresolvedSideEffects.join(", ")}.`,
    },
    {
      role: "assistant",
      content: `Checkpoint: ${frozenFacts.checkpoints.join(", ")}.`,
    },
    {
      role: "assistant",
      content: `Blocker: ${frozenFacts.blockers.join(", ")}.`,
    },
    {
      role: "assistant",
      content: `Next step: ${frozenFacts.nextSteps.join(", ")}.`,
    },
    { role: "user", content: "Continue only after verification." },
  ];
}

function summaryHandoff(messages) {
  const summary = messages.find((message) =>
    String(message?.content || "").startsWith("[Conversation Summary]"),
  );
  if (!summary) throw new Error("semantic compression omitted its handoff");
  return parseStructuredHandoff(
    summary.content.slice("[Conversation Summary]".length),
  );
}

async function runSemanticMatrix({ runs, fixture }) {
  const frozenFacts = fixture.frozenFacts;
  const expectedFactCount = factCount(frozenFacts);
  const samples = [];
  let retained = 0;
  let silentLossCount = 0;
  let degradedVisible = 0;
  const { buildSubAgentHandoffContext } =
    await import("../src/runtime/agent-core.js");
  for (const transport of ["local-provider", "offline-fallback"]) {
    for (let iteration = 0; iteration < runs; iteration += 1) {
      try {
        const history = semanticHistory(frozenFacts, iteration);
        const validProvider = transport === "local-provider";
        const compressor = new PromptCompressor({
          maxMessages: 4,
          maxTokens: 10,
          summaryInputMaxChars: 4_096,
          llmQuery: async () =>
            validProvider
              ? {
                  summary: JSON.stringify(frozenFacts),
                  usage: {
                    input_tokens: 100 + iteration,
                    output_tokens: 40,
                    cache_read_input_tokens: iteration % 5,
                  },
                  provider: "fixture-provider",
                  model: "structured-handoff-v1",
                }
              : `invalid-provider-output-${iteration}`,
        });
        const compressed = await compressor.compress(history);
        const handoff = summaryHandoff(compressed.messages);
        const retention = retainedFacts(handoff, frozenFacts);
        retained += retention.retained;
        if (retention.missing.length > 0) silentLossCount += 1;
        const degraded = compressed.stats.degraded === true;
        const degradedReason = compressed.stats.degradedReason || null;
        if (!validProvider && degraded && degradedReason) degradedVisible += 1;

        const childRaw = buildSubAgentHandoffContext(history);
        const childPrefix = "[Structured parent handoff v1]\n";
        if (!childRaw?.startsWith(childPrefix)) {
          throw new Error(
            "subagent did not use the canonical handoff envelope",
          );
        }
        const childHandoff = parseStructuredHandoff(
          childRaw.slice(childPrefix.length),
        );
        const childRetention = retainedFacts(childHandoff, frozenFacts);
        if (childRetention.missing.length > 0) {
          throw Object.assign(new Error("subagent handoff lost frozen facts"), {
            evidence: childRetention,
          });
        }
        samples.push({
          id: `semantic-${transport}-${iteration}`,
          transport,
          iteration,
          pass: retention.missing.length === 0,
          retainedFacts: retention.retained,
          totalFacts: expectedFactCount,
          missingFacts: retention.missing,
          summaryMode: compressed.stats.summaryMode,
          degraded,
          degradedReason,
          provider: compressed.stats.summaryProvider || null,
          model: compressed.stats.summaryModel || null,
          usage: compressed.stats.summaryUsage || null,
          structuredSummaryDigest: sha256Json(handoff),
          subagentSummaryDigest: sha256Json(childHandoff),
          schemaFields: Object.keys(handoff),
        });
      } catch (error) {
        silentLossCount += 1;
        samples.push({
          id: `semantic-${transport}-${iteration}`,
          transport,
          iteration,
          pass: false,
          error: safeError(error),
          ...(error?.evidence ? { evidence: error.evidence } : {}),
        });
        break;
      }
    }
  }
  const totalFacts = expectedFactCount * samples.length;
  return {
    requiredRunsPerTransport: runs,
    sampleCount: samples.length,
    transports: ["local-provider", "offline-fallback"],
    retainedFacts: retained,
    totalFacts,
    frozenFactRetentionRate: totalFacts > 0 ? retained / totalFacts : 0,
    silentLossCount,
    degradedFailuresVisible:
      degradedVisible === runs &&
      samples
        .filter((sample) => sample.transport === "offline-fallback")
        .every((sample) => sample.degradedReason),
    subagentsUseSameSchema: samples.every(
      (sample) =>
        JSON.stringify(sample.schemaFields) ===
        JSON.stringify(STRUCTURED_HANDOFF_FIELDS),
    ),
    samples,
  };
}

async function runPersistenceMatrix({ runs, runRoot }) {
  const samples = [];
  const failures = [];
  for (const point of allKillPoints) {
    for (let iteration = 0; iteration < runs; iteration += 1) {
      try {
        const sample = atomicKillPoints.includes(point)
          ? await runAtomicSample({ point, iteration, runRoot })
          : await runRuntimeSample({ point, iteration, runRoot });
        samples.push(sample);
      } catch (error) {
        const failure = {
          id: `s0-${point}-${iteration}`,
          point,
          iteration,
          pass: false,
          error: safeError(error),
          ...(error?.evidence ? { evidence: error.evidence } : {}),
        };
        samples.push(failure);
        failures.push(failure);
        break;
      } finally {
        resetAllStores();
        const sampleRoot = path.join(runRoot, `s0-${point}-${iteration}`);
        if (
          path
            .resolve(sampleRoot)
            .startsWith(`${path.resolve(runRoot)}${path.sep}`)
        ) {
          fs.rmSync(sampleRoot, { recursive: true, force: true });
        }
      }
    }
  }
  const counts = Object.fromEntries(
    allKillPoints.map((point) => [
      point,
      samples.filter((sample) => sample.point === point && sample.pass).length,
    ]),
  );
  return {
    requiredRunsPerKillPoint: runs,
    sampleCount: samples.length,
    killPoints: [...allKillPoints],
    passCounts: counts,
    failures,
    stateConsistencyRate:
      samples.length > 0
        ? samples.filter((sample) => sample.pass).length / samples.length
        : 0,
    capabilityWideningCount: samples.filter(
      (sample) =>
        sample.executionLockWidened === true ||
        sample.evidence?.executionLockWidened === true,
    ).length,
    wrongApprovalBindingCount: samples.filter(
      (sample) =>
        sample.wrongApprovalBinding === true ||
        sample.evidence?.wrongApprovalBinding === true,
    ).length,
    samples,
  };
}

function validateIndividualEvidence(evidence, expected = {}) {
  const issues = [];
  const minimumRuns = Number.isSafeInteger(expected.minimumRuns)
    ? expected.minimumRuns
    : 1;
  if (evidence?.schema !== evidenceSchema) issues.push("schema");
  if (!releaseCommitPattern.test(String(evidence?.releaseCommit || ""))) {
    issues.push("releaseCommit");
  }
  if (
    expected.releaseCommit &&
    evidence?.releaseCommit !== expected.releaseCommit
  ) {
    issues.push("releaseCommit mismatch");
  }
  if (!evidence?.startedAt || !evidence?.finishedAt) issues.push("time window");
  if (!evidence?.runner?.operatingSystem) issues.push("operating system");
  if (!evidence?.runner?.architecture) issues.push("architecture");
  if (evidence?.fixture?.manifestVersion !== "1.1.1") {
    issues.push("manifest version");
  }
  const runs = evidence?.persistence?.requiredRunsPerKillPoint;
  if (!Number.isSafeInteger(runs) || runs < minimumRuns) {
    issues.push("persistence runs");
  }
  for (const point of allKillPoints) {
    if (evidence?.persistence?.passCounts?.[point] !== runs) {
      issues.push(`${point} sample count`);
    }
    if (
      evidence?.persistence?.samples?.filter(
        (sample) => sample.point === point && sample.pass,
      ).length !== runs
    ) {
      issues.push(`${point} sample evidence`);
    }
  }
  if (
    evidence?.persistence?.sampleCount !== runs * allKillPoints.length ||
    evidence?.persistence?.samples?.length !== runs * allKillPoints.length
  ) {
    issues.push("persistence sample total");
  }
  if (evidence?.persistence?.stateConsistencyRate !== 1) {
    issues.push("state consistency");
  }
  if (evidence?.persistence?.capabilityWideningCount !== 0) {
    issues.push("capability widening");
  }
  if (evidence?.persistence?.wrongApprovalBindingCount !== 0) {
    issues.push("approval binding");
  }
  const semanticRuns = evidence?.semanticHandoff?.requiredRunsPerTransport;
  if (!Number.isSafeInteger(semanticRuns) || semanticRuns < minimumRuns) {
    issues.push("semantic runs");
  }
  for (const transport of ["local-provider", "offline-fallback"]) {
    if (
      evidence?.semanticHandoff?.samples?.filter(
        (sample) => sample.transport === transport && sample.pass,
      ).length !== semanticRuns
    ) {
      issues.push(`${transport} sample count`);
    }
  }
  if (
    evidence?.semanticHandoff?.sampleCount !== semanticRuns * 2 ||
    evidence?.semanticHandoff?.samples?.length !== semanticRuns * 2
  ) {
    issues.push("semantic sample total");
  }
  if (evidence?.semanticHandoff?.frozenFactRetentionRate !== 1) {
    issues.push("frozen fact retention");
  }
  if (evidence?.semanticHandoff?.silentLossCount !== 0) {
    issues.push("semantic silent loss");
  }
  if (evidence?.semanticHandoff?.degradedFailuresVisible !== true) {
    issues.push("degraded visibility");
  }
  if (evidence?.semanticHandoff?.subagentsUseSameSchema !== true) {
    issues.push("subagent schema");
  }
  if (
    evidence?.artifactDigests?.persistenceSamples !==
    `sha256:${sha256Json(evidence?.persistence?.samples)}`
  ) {
    issues.push("persistence sample digest");
  }
  if (
    evidence?.artifactDigests?.semanticSamples !==
    `sha256:${sha256Json(evidence?.semanticHandoff?.samples)}`
  ) {
    issues.push("semantic sample digest");
  }
  if (issues.length > 0) {
    throw new Error(`invalid safety evidence: ${issues.join(", ")}`);
  }
  return evidence;
}

export async function runSafetyGate(options = {}) {
  const runs = Number(options.runs ?? 100);
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 10_000) {
    throw new Error("runs must be an integer between 1 and 10000");
  }
  const releaseCommit = normalizeReleaseCommit(options.releaseCommit);
  if (options.verifyGitHead !== false) {
    const actual = currentGitHead();
    if (actual !== releaseCommit) {
      throw new Error(
        `release commit ${releaseCommit} does not match checked-out HEAD ${actual}`,
      );
    }
  }
  const fixture = validateFixtureContract();
  const startedAt = new Date().toISOString();
  const runRoot = fs.mkdtempSync(
    path.join(options.tempRoot || os.tmpdir(), "cc-ide-roadmap-safety-"),
  );
  let persistence;
  let semanticHandoff;
  try {
    persistence = await runPersistenceMatrix({ runs, runRoot });
    semanticHandoff = await runSemanticMatrix({
      runs,
      fixture: fixture.handoff,
    });
  } finally {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
  const cliPackage = readJson(path.join(cliRoot, "package.json"));
  const evidence = {
    schema: evidenceSchema,
    releaseCommit,
    manifestVersion: fixture.manifest.manifestVersion,
    hostVersion: process.version,
    cliVersion: cliPackage.version,
    operatingSystem: operatingSystemName(),
    transport: [
      "local-process-kill-restart",
      "websocket-replay",
      "local-provider",
      "offline-fallback",
    ],
    startedAt,
    finishedAt: new Date().toISOString(),
    result: "failed",
    fixture: {
      manifestVersion: fixture.manifest.manifestVersion,
      digests: fixture.digests,
    },
    runner: {
      environment:
        process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
      name: process.env.RUNNER_NAME || null,
      operatingSystem: operatingSystemName(),
      architecture: process.arch,
      image: process.env.ImageOS || process.env.RUNNER_IMAGE || null,
      node: process.version,
      childSandbox: "disabled-for-persistence-fault-injection",
    },
    persistence,
    semanticHandoff,
    artifactDigests: {
      persistenceSamples: `sha256:${sha256Json(persistence.samples)}`,
      semanticSamples: `sha256:${sha256Json(semanticHandoff.samples)}`,
    },
  };
  try {
    evidence.result = "passed";
    validateIndividualEvidence(evidence, { releaseCommit });
  } catch (error) {
    evidence.result = "failed";
    evidence.validationError = safeError(error);
  }
  if (options.output) writeJson(options.output, evidence);
  if (evidence.result !== "passed") {
    throw Object.assign(
      new Error(evidence.validationError?.message || "safety gate failed"),
      {
        evidence,
      },
    );
  }
  return evidence;
}

export function verifyEvidenceSet(options = {}) {
  const releaseCommit = normalizeReleaseCommit(options.releaseCommit);
  const fixture = validateFixtureContract();
  const evidenceDir = path.resolve(options.evidenceDir || "");
  const files = fs
    .readdirSync(evidenceDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(evidenceDir, name));
  const evidence = files
    .map((filePath) => ({ filePath, value: readJson(filePath) }))
    .filter((entry) => entry.value?.schema === evidenceSchema);
  const expectedSystems = ["linux", "macos", "windows"];
  const actualSystems = evidence
    .map((entry) => entry.value.runner.operatingSystem)
    .sort();
  if (JSON.stringify(actualSystems) !== JSON.stringify(expectedSystems)) {
    throw new Error(
      `safety evidence must contain exactly linux, macos, windows; found ${actualSystems.join(", ")}`,
    );
  }
  for (const entry of evidence) {
    validateIndividualEvidence(entry.value, {
      releaseCommit,
      minimumRuns: 100,
    });
    if (entry.value.result !== "passed") {
      throw new Error(`${path.basename(entry.filePath)} did not pass`);
    }
    if (
      JSON.stringify(entry.value.fixture?.digests) !==
      JSON.stringify(fixture.digests)
    ) {
      throw new Error(
        `${path.basename(entry.filePath)} has stale fixture digests`,
      );
    }
  }
  const aggregate = {
    schema: aggregateSchema,
    releaseCommit,
    result: "passed",
    verifiedAt: new Date().toISOString(),
    operatingSystems: expectedSystems,
    requiredRunsPerKillPoint:
      evidence[0].value.persistence.requiredRunsPerKillPoint,
    requiredRunsPerSemanticTransport:
      evidence[0].value.semanticHandoff.requiredRunsPerTransport,
    processKillSamples: evidence.reduce(
      (total, entry) => total + entry.value.persistence.sampleCount,
      0,
    ),
    semanticSamples: evidence.reduce(
      (total, entry) => total + entry.value.semanticHandoff.sampleCount,
      0,
    ),
    stateConsistencyRate: 1,
    frozenFactRetentionRate: 1,
    capabilityWideningCount: 0,
    wrongApprovalBindingCount: 0,
    silentLossCount: 0,
    evidence: evidence.map((entry) => ({
      file: path.basename(entry.filePath),
      operatingSystem: entry.value.runner.operatingSystem,
      sha256: sha256File(entry.filePath),
    })),
  };
  if (options.output) writeJson(options.output, aggregate);
  return aggregate;
}

function parseArgs(argv) {
  const options = { runs: 100 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--runs") options.runs = Number(argv[++index]);
    else if (argument === "--output") options.output = argv[++index];
    else if (argument === "--release-commit") {
      options.releaseCommit = argv[++index];
    } else if (argument === "--verify-evidence-dir") {
      options.evidenceDir = argv[++index];
    } else if (argument === "--worker") {
      options.worker = argv.slice(index + 1);
      break;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

const directRun =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() ===
    path.resolve(scriptPath).toLowerCase();

if (directRun) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.worker) {
      runWorker(options.worker);
    } else if (options.evidenceDir) {
      const aggregate = verifyEvidenceSet(options);
      process.stdout.write(
        `verified safety matrix ${aggregate.releaseCommit}: ${aggregate.processKillSamples} process kills, ${aggregate.semanticSamples} semantic trajectories\n`,
      );
    } else {
      const evidence = await runSafetyGate(options);
      process.stdout.write(
        `safety matrix passed on ${evidence.runner.operatingSystem}: ${evidence.persistence.sampleCount} process kills, ${evidence.semanticHandoff.sampleCount} semantic trajectories\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
