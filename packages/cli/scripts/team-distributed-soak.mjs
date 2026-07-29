#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adjudicateDistributedQueue,
  distributedQueueStatus,
  finalizeDistributedQueue,
  initDistributedQueue,
} from "../src/commands/team-distributed.js";
import { TeamDistributedQueue } from "../src/lib/agent-team/team-distributed-queue.js";
import { TeamProcessCheckpointBroker } from "../src/lib/agent-team/team-process-checkpoint.js";
import executionBroker from "../src/lib/process-execution-broker/index.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(
  scriptDirectory,
  "team-distributed-soak-worker.mjs",
);
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const activeChildren = new Set();
const MIB = 1024 * 1024;

function readArgument(argv, index) {
  const argument = argv[index];
  const separator = argument.indexOf("=");
  if (separator >= 0) {
    return {
      name: argument.slice(0, separator),
      value: argument.slice(separator + 1),
      consumed: 1,
    };
  }
  return {
    name: argument,
    value: argv[index + 1],
    consumed: 2,
  };
}

function positiveNumber(value, label, { integer = false, minimum = 0 } = {}) {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    parsed < minimum ||
    (integer && !Number.isSafeInteger(parsed))
  ) {
    throw new TypeError(`${label} must be a positive number >= ${minimum}`);
  }
  return parsed;
}

function optionalPositiveInteger(value, label) {
  if (value == null || value === "") return null;
  return positiveNumber(value, label, { integer: true, minimum: 1 });
}

function unsignedInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    throw new TypeError(`${label} must be an unsigned 32-bit integer`);
  }
  return parsed >>> 0;
}

function booleanOption(value, label) {
  if (value == null || value === "") return false;
  if (value === true || value === "1" || value === "true") return true;
  if (value === false || value === "0" || value === "false") return false;
  throw new TypeError(`${label} must be true/false or 1/0`);
}

function parseOptions(argv, environment) {
  const envMinutes = environment.CC_TEAM_SOAK_DURATION_MINUTES;
  const envMilliseconds = environment.CC_TEAM_SOAK_DURATION_MS;
  const options = {
    durationMs:
      envMilliseconds != null
        ? positiveNumber(envMilliseconds, "CC_TEAM_SOAK_DURATION_MS", {
            integer: true,
            minimum: 250,
          })
        : envMinutes != null
          ? positiveNumber(envMinutes, "CC_TEAM_SOAK_DURATION_MINUTES", {
              minimum: 0.01,
            }) * 60_000
          : 5_000,
    workers: positiveNumber(
      environment.CC_TEAM_SOAK_WORKERS || 2,
      "worker count",
      { integer: true, minimum: 2 },
    ),
    tasks: positiveNumber(environment.CC_TEAM_SOAK_TASKS || 6, "task count", {
      integer: true,
      minimum: 5,
    }),
    crashes: positiveNumber(
      environment.CC_TEAM_SOAK_CRASHES || 2,
      "crash count",
      { integer: true, minimum: 1 },
    ),
    ttlMs: positiveNumber(environment.CC_TEAM_SOAK_TTL_MS || 60_000, "TTL", {
      integer: true,
      minimum: 1_000,
    }),
    taskDelayMs: positiveNumber(
      environment.CC_TEAM_SOAK_TASK_DELAY_MS || 5,
      "task delay",
      { integer: true, minimum: 1 },
    ),
    maxRssMb: positiveNumber(
      environment.CC_TEAM_SOAK_MAX_RSS_MB || 1_024,
      "maximum RSS",
      { minimum: 128 },
    ),
    maxRssGrowthMb: positiveNumber(
      environment.CC_TEAM_SOAK_MAX_RSS_GROWTH_MB || 256,
      "maximum RSS trend growth",
      { minimum: 32 },
    ),
    seed: unsignedInteger(environment.CC_TEAM_SOAK_SEED || 0x5eed2026, "seed"),
    output: path.resolve(
      environment.CC_TEAM_SOAK_OUTPUT ||
        path.join(repositoryRoot, "artifacts", "cli-team-soak-result.json"),
    ),
    expectedSha: environment.CC_TEAM_SOAK_EXPECTED_SHA || null,
    maxRounds: optionalPositiveInteger(
      environment.CC_TEAM_SOAK_MAX_ROUNDS,
      "maximum rounds",
    ),
    requireManagedAgent: booleanOption(
      environment.CC_TEAM_SOAK_REQUIRE_MANAGED_AGENT,
      "CC_TEAM_SOAK_REQUIRE_MANAGED_AGENT",
    ),
  };

  for (let index = 0; index < argv.length;) {
    if (argv[index] === "--help" || argv[index] === "-h") {
      options.help = true;
      index += 1;
      continue;
    }
    const parsed = readArgument(argv, index);
    if (parsed.value == null || parsed.value === "") {
      throw new TypeError(`${parsed.name} requires a value`);
    }
    switch (parsed.name) {
      case "--duration-ms":
        options.durationMs = positiveNumber(parsed.value, "duration", {
          integer: true,
          minimum: 250,
        });
        break;
      case "--duration-minutes":
        options.durationMs =
          positiveNumber(parsed.value, "duration", { minimum: 0.01 }) * 60_000;
        break;
      case "--workers":
        options.workers = positiveNumber(parsed.value, "worker count", {
          integer: true,
          minimum: 2,
        });
        break;
      case "--tasks":
        options.tasks = positiveNumber(parsed.value, "task count", {
          integer: true,
          minimum: 5,
        });
        break;
      case "--crashes":
        options.crashes = positiveNumber(parsed.value, "crash count", {
          integer: true,
          minimum: 1,
        });
        break;
      case "--ttl-ms":
        options.ttlMs = positiveNumber(parsed.value, "TTL", {
          integer: true,
          minimum: 1_000,
        });
        break;
      case "--task-delay-ms":
        options.taskDelayMs = positiveNumber(parsed.value, "task delay", {
          integer: true,
          minimum: 1,
        });
        break;
      case "--max-rss-mb":
        options.maxRssMb = positiveNumber(parsed.value, "maximum RSS", {
          minimum: 128,
        });
        break;
      case "--max-rss-growth-mb":
        options.maxRssGrowthMb = positiveNumber(
          parsed.value,
          "maximum RSS trend growth",
          { minimum: 32 },
        );
        break;
      case "--seed":
        options.seed = unsignedInteger(parsed.value, "seed");
        break;
      case "--output":
        options.output = path.resolve(parsed.value);
        break;
      case "--expected-sha":
        options.expectedSha = parsed.value;
        break;
      case "--max-rounds":
        options.maxRounds = positiveNumber(parsed.value, "maximum rounds", {
          integer: true,
          minimum: 1,
        });
        break;
      case "--require-managed-agent":
        options.requireManagedAgent = booleanOption(
          parsed.value,
          "require managed Agent",
        );
        break;
      default:
        throw new TypeError(`unknown option: ${parsed.name}`);
    }
    index += parsed.consumed;
  }

  if (
    options.expectedSha != null &&
    !/^[a-f0-9]{40,64}$/i.test(options.expectedSha)
  ) {
    throw new TypeError(
      "expected SHA must be a full 40-64 digit hex commit ID",
    );
  }
  if (options.crashes > 2) {
    throw new TypeError(
      "crash count must be 1 or 2 so the pinned three-attempt queue can still complete",
    );
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node team-distributed-soak.mjs [options]

Runs real Git worktrees, durable multi-process queue workers, a Process Broker
managed-process capability probe, deterministic local Agent
contract/worktree/checkpoint turns, and fenced finalize. No network or live
model is used.

Options:
  --duration-ms <n>          Local duration in milliseconds (default 5000)
  --duration-minutes <n>     CI duration in minutes
  --workers <n>              Concurrent OS worker processes (default 2)
  --tasks <n>                Real DAG worktrees per round (default 6)
  --crashes <n>              Injected pre-execution worker exits (default 2)
  --ttl-ms <n>               Worker lease TTL (default 60000)
  --task-delay-ms <n>        Deterministic Agent delay (default 5)
  --max-rss-mb <n>           Per-process RSS ceiling (default 1024)
  --max-rss-growth-mb <n>    Tail RSS trend ceiling (default 256)
  --seed <n>                 Reproducible unsigned 32-bit seed
  --max-rounds <n>           Optional deterministic round cap
  --require-managed-agent <boolean>
                             Require the managed-process capability probe
  --expected-sha <sha>       Fail unless checkout HEAD is this exact full SHA
                             and the tracked worktree is clean
  --output <path>            JSON result path
`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function currentCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim().toLowerCase() : null;
}

function trackedWorktreeEvidence() {
  const result = spawnSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=no"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: 16 * MIB,
      windowsHide: true,
    },
  );
  const output = typeof result.stdout === "string" ? result.stdout : "";
  const changes = output.split(/\r?\n/u).filter(Boolean);
  const errorMessage =
    result.error == null
      ? null
      : String(result.error?.message || result.error).slice(0, 500);
  const available = result.status === 0 && errorMessage == null;
  return {
    available,
    clean: available && changes.length === 0,
    status: result.status,
    changeCount: changes.length,
    changes,
    evidenceDigest: digestText(output),
    error: errorMessage,
  };
}

function git(repo, ...args) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}

function nextRandom(state) {
  let value = state.value >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.value = value >>> 0;
  return state.value;
}

function makeDag(taskCount, seed, workflowMode) {
  const random = { value: seed || 1 };
  const tasks = Array.from({ length: taskCount }, (_, index) => {
    const key = `task-${String(index).padStart(3, "0")}`;
    let dependsOn = [];
    if (index === 2) dependsOn = ["task-000"];
    else if (index === 3) dependsOn = ["task-001"];
    else if (index === 4) dependsOn = ["task-002", "task-003"];
    else if (index > 4) {
      dependsOn = [`task-${String(index - 1).padStart(3, "0")}`];
    }
    const specification = {
      kind: "chainlesschain-team-soak-task",
      key,
      dependsOn,
    };
    return {
      key,
      title: `Real soak task ${index}`,
      dependsOn,
      priority: ["high", "normal", "low"][nextRandom(random) % 3],
      retrySafe: true,
      ...(workflowMode === "agent-worktree"
        ? { prompt: JSON.stringify(specification) }
        : { command: `node soak-task.mjs ${key}` }),
    };
  });
  return tasks;
}

function shellTaskProgram() {
  return `#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const key = process.argv[2];
const runId = process.env.CC_TEAM_SOAK_RUN_ID;
const workerId = process.env.CC_TEAM_SOAK_WORKER_ID;
const effectsDir = process.env.CC_TEAM_SOAK_EFFECTS_DIR;
if (!key || !runId || !workerId || !effectsDir) {
  throw new Error("shell fallback has no pinned soak authority");
}
const graph = JSON.parse(fs.readFileSync("soak-dependencies.json", "utf8"));
const dependsOn = graph[key];
if (!Array.isArray(dependsOn)) throw new Error("unknown soak task");
const dependencyEvidence = dependsOn.map((dependencyKey) => {
  const dependency = JSON.parse(
    fs.readFileSync(path.join("soak-output", dependencyKey + ".json"), "utf8"),
  );
  if (dependency.key !== dependencyKey || dependency.runId !== runId) {
    throw new Error("invalid dependency baseline for " + dependencyKey);
  }
  return {
    key: dependencyKey,
    attemptId: dependency.attemptId,
    contentDigest: crypto
      .createHash("sha256")
      .update(JSON.stringify(dependency))
      .digest("hex"),
  };
});
const attemptId = crypto
  .createHash("sha256")
  .update(JSON.stringify({ runId, key, workerId, pid: process.pid }))
  .digest("hex");
function writeExclusiveJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value) + "\\n", "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
const attempt = {
  kind: "chainlesschain-team-soak-effect-attempt",
  runId,
  taskKey: key,
  attemptId,
  workerId,
  pid: process.pid,
};
writeExclusiveJson(
  path.join(effectsDir, "attempts", key, attemptId + ".json"),
  attempt,
);
writeExclusiveJson(path.join(effectsDir, "confirmed", key + ".json"), {
  ...attempt,
  kind: "chainlesschain-team-soak-confirmed-effect",
  confirmationId: crypto
    .createHash("sha256")
    .update(runId + "\\0" + key)
    .digest("hex"),
});
fs.mkdirSync("soak-output", { recursive: true });
fs.writeFileSync(
  path.join("soak-output", key + ".json"),
  JSON.stringify(
    {
      kind: "chainlesschain-team-soak-output",
      runId,
      key,
      attemptId,
      workerId,
      dependencyEvidence,
    },
    null,
    2,
  ) + "\\n",
  "utf8",
);
`;
}

function createFixture(
  rootDirectory,
  roundIndex,
  roundSeed,
  workflowMode,
  taskCount,
) {
  const roundDirectory = path.join(
    rootDirectory,
    `round-${String(roundIndex).padStart(6, "0")}`,
  );
  const repo = path.join(roundDirectory, "repo");
  const authority = path.join(roundDirectory, "authority");
  const effectsDir = path.join(authority, "effects");
  const checkpointStateDir = path.join(authority, "checkpoints");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(authority, { recursive: true, mode: 0o700 });
  const runId = `soak-${roundIndex}-${roundSeed}`;
  const tasks = makeDag(taskCount, roundSeed, workflowMode);
  fs.writeFileSync(path.join(repo, "README.md"), "real Agent Team soak\n");
  fs.writeFileSync(path.join(repo, "soak-task.mjs"), shellTaskProgram());
  fs.writeFileSync(
    path.join(repo, "soak-dependencies.json"),
    `${JSON.stringify(
      Object.fromEntries(tasks.map((task) => [task.key, task.dependsOn])),
      null,
      2,
    )}\n`,
  );
  git(repo, "init");
  git(repo, "config", "user.name", "Agent Team Soak");
  git(repo, "config", "user.email", "agent-team-soak@example.invalid");
  git(repo, "add", "README.md", "soak-task.mjs", "soak-dependencies.json");
  git(repo, "commit", "-m", "soak base");
  const statePath = path.join(authority, "queue.json");
  const graphPath = path.join(authority, "tasks.json");
  fs.writeFileSync(graphPath, `${JSON.stringify({ tasks }, null, 2)}\n`, {
    mode: 0o600,
  });
  return {
    roundDirectory,
    repo,
    authority,
    effectsDir,
    checkpointStateDir,
    runId,
    statePath,
    graphPath,
    tasks,
    baseOid: git(repo, "rev-parse", "HEAD").toLowerCase(),
  };
}

function createWorker(configurationPath, mode, workerId) {
  const child = spawn(
    process.execPath,
    [workerPath, configurationPath, mode, workerId],
    {
      cwd: repositoryRoot,
      env: { ...process.env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  activeChildren.add(child);
  const events = [];
  let stdoutBuffer = "";
  let stderr = "";
  let parseError = null;

  function dispatch(line) {
    if (!line.trim()) return;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      parseError = new Error(`worker emitted invalid JSON: ${line}`, {
        cause: error,
      });
    }
  }

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    for (;;) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      dispatch(stdoutBuffer.slice(0, newline));
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const done = new Promise((resolve) => {
    child.on("error", (error) => {
      parseError ||= error;
    });
    child.on("close", (code, signal) => {
      activeChildren.delete(child);
      dispatch(stdoutBuffer);
      resolve({ code, signal, events, stderr, parseError });
    });
  });
  return { child, done };
}

async function withTimeout(promise, milliseconds, label, children = []) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          for (const child of children) child.kill();
          reject(new Error(`${label} timed out after ${milliseconds} ms`));
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}

function writeReport(filePath, report) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJson(filePath, report);
}

async function terminateActiveWorkers() {
  const children = [...activeChildren];
  if (children.length === 0) return;
  const closed = children.map(
    (child) =>
      new Promise((resolve) => {
        if (child.exitCode != null || child.signalCode != null) {
          resolve();
          return;
        }
        child.once("close", resolve);
      }),
  );
  for (const child of children) child.kill();
  await Promise.race([
    Promise.all(closed),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

function digestText(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function canonicalWorkspaceLockPath(workspaceRoot) {
  const identity = `${os.homedir()}\0${
    typeof process.getuid === "function"
      ? process.getuid()
      : os.userInfo().username
  }`;
  const lockRoot = path.join(
    os.tmpdir(),
    `chainlesschain-workspace-transaction-locks-${crypto
      .createHash("sha256")
      .update(identity)
      .digest("hex")
      .slice(0, 24)}`,
  );
  const canonicalWorkspace =
    process.platform === "win32"
      ? path.resolve(workspaceRoot).toLowerCase()
      : path.resolve(workspaceRoot);
  return path.join(
    lockRoot,
    crypto.createHash("sha256").update(canonicalWorkspace).digest("hex"),
  );
}

function stableBudgetEvidence(status) {
  return {
    maxTasks: status.maxTasks,
    maxTokens: status.maxTokens,
    maxUsd: status.maxUsd,
    maxWallMs: status.maxWallMs,
    tasksStarted: status.tasksStarted,
    tasksSettled: status.tasksSettled,
    tokens: status.tokens,
    spentUsd: status.spentUsd,
    reservedTokens: status.reservedTokens,
    reservedUsd: status.reservedUsd,
    reservations: status.reservations,
    reason: status.reason,
  };
}

function probeManagedProcessCapability(rootDirectory) {
  const probeRoot = path.join(rootDirectory, "platform-capability");
  const workspaceRoot = path.join(probeRoot, "workspace");
  const stateDir = path.join(probeRoot, "process-checkpoints");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "base.txt"), "before\n");
  const broker = new TeamProcessCheckpointBroker({
    stateDir,
    coverageTarget: "partial",
    writerIsolation: "unknown",
    externalSideEffects: true,
  });
  const guard = broker.beginTask({
    runId: "soak-platform-capability",
    taskKey: "managed-process-probe",
    workspaceRoot,
  });
  guard.markRunning();
  let supported = false;
  let failure = null;
  try {
    executionBroker.execFileSync("git", ["--version"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      origin: "team-soak:managed-process-probe",
      policy: "allow",
      scope: "team-soak",
    });
    supported = true;
  } catch (error) {
    const message = String(error?.message || error);
    failure = {
      code: error?.code || null,
      name: error?.name || "Error",
      message: message.slice(0, 500),
      messageDigest: digestText(message),
      failClosedVerified:
        /sandbox|process.?tree|required boundar|exit 125|bwrap|seatbelt|restricted token/iu.test(
          `${error?.code || ""} ${message}`,
        ),
    };
  }
  const rolledBack = guard.rollback({
    reason: supported
      ? "soak capability probe completed"
      : "soak capability probe verified fail-closed execution",
  });
  const rolledBackSnapshot = broker.inspectCheckpoint(guard.id);
  assert(
    rolledBack.outcome === "rolled_back" &&
      rolledBackSnapshot.state === "rolled_back",
    "managed process capability probe did not settle its checkpoint",
  );
  assert(
    supported || failure?.failClosedVerified === true,
    "managed process probe failed for a reason that is not a verified fail-closed isolation refusal",
  );
  assert(
    !fs.existsSync(canonicalWorkspaceLockPath(workspaceRoot)),
    "managed process capability probe left its canonical workspace lock",
  );

  const directStateDir = path.join(probeRoot, "direct-checkpoints");
  const directBroker = new TeamProcessCheckpointBroker({
    stateDir: directStateDir,
    coverageTarget: "full",
    writerIsolation: "exclusive-workspace",
    externalSideEffects: false,
  });
  const direct = directBroker.beginTask({
    runId: "soak-platform-capability",
    taskKey: "direct-file-checkpoint",
    workspaceRoot,
  });
  direct.markRunning();
  fs.writeFileSync(path.join(workspaceRoot, "direct.txt"), "checkpointed\n");
  const committed = direct.accept();
  const committedSnapshot = directBroker.inspectCheckpoint(direct.id);
  assert(
    committed.outcome === "committed" &&
      committedSnapshot.state === "committed" &&
      committed.fileCoverage === "full",
    "direct deterministic file checkpoint was not committed with full file coverage",
  );
  assert(
    !fs.existsSync(canonicalWorkspaceLockPath(workspaceRoot)),
    "direct deterministic file checkpoint left its canonical workspace lock",
  );

  return {
    managedProcessSupported: supported,
    workflowMode: supported ? "agent-worktree" : "shell-worktree",
    managedProcessProbe: {
      outcome: supported ? "supported" : "failed-closed",
      failure,
      checkpointState: rolledBackSnapshot.state,
      checkpointEvidenceDigest: rolledBack.evidenceDigest,
    },
    directFileCheckpoint: {
      outcome: "committed",
      state: committedSnapshot.state,
      coverage: committed.coverage,
      fileCoverage: committed.fileCoverage,
      evidenceDigest: committed.evidenceDigest,
    },
    truth: supported
      ? "managed-process capability probe passed; deterministic Agent contract/worktree/checkpoint coverage is verified without a live model"
      : "managed-process capability probe failed closed; deterministic shell-worktree fallback and direct-file checkpoint coverage are verified separately",
  };
}

function readJsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        output.push(JSON.parse(fs.readFileSync(target, "utf8")));
      }
    }
  }
  return output;
}

function residuePaths(...roots) {
  const residues = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const pending = [root];
    while (pending.length > 0) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const target = path.join(current, entry.name);
        if (
          entry.name.endsWith(".lock") ||
          entry.name.endsWith(".tmp") ||
          entry.name.includes(".tmp-")
        ) {
          residues.push(target);
        }
        if (entry.isDirectory() && entry.name !== ".git") pending.push(target);
      }
    }
  }
  return residues.sort();
}

function verifyExternalEffects(fixture) {
  const attempts = readJsonFiles(path.join(fixture.effectsDir, "attempts"));
  const confirmed = readJsonFiles(path.join(fixture.effectsDir, "confirmed"));
  assert(
    attempts.length === fixture.tasks.length,
    `observed ${attempts.length} external attempts for ${fixture.tasks.length} tasks`,
  );
  assert(
    confirmed.length === fixture.tasks.length,
    `observed ${confirmed.length} confirmed effects for ${fixture.tasks.length} tasks`,
  );
  const attemptsByTask = new Map();
  for (const attempt of attempts) {
    const entries = attemptsByTask.get(attempt.taskKey) || [];
    entries.push(attempt);
    attemptsByTask.set(attempt.taskKey, entries);
  }
  const attemptIds = new Set(attempts.map((entry) => entry.attemptId));
  const productiveWorkerIds = new Set(confirmed.map((entry) => entry.workerId));
  assert(
    attemptIds.size === attempts.length,
    "external effect attempt IDs were not globally unique",
  );
  assert(
    productiveWorkerIds.size >= 2,
    "confirmed effects do not prove multi-process queue competition",
  );
  for (const task of fixture.tasks) {
    const taskAttempts = attemptsByTask.get(task.key) || [];
    const confirmation = confirmed.find((entry) => entry.taskKey === task.key);
    assert(
      taskAttempts.length === 1,
      `task ${task.key} executed ${taskAttempts.length} external-effect attempts`,
    );
    assert(
      confirmation?.attemptId === taskAttempts[0].attemptId,
      `task ${task.key} confirmation does not bind its sole attempt`,
    );
  }
  return {
    attempts: attempts.length,
    confirmed: confirmed.length,
    duplicateConfirmed:
      confirmed.length - new Set(confirmed.map((entry) => entry.taskKey)).size,
    uniqueAttemptIds: attemptIds.size,
    productiveWorkers: productiveWorkerIds.size,
    crashBoundary: "before-worktree-checkpoint-and-external-effect",
    authority: "external idempotency markers keyed by task and attempt ID",
  };
}

function verifyDagOutputs(fixture, status) {
  const tasksByKey = new Map(status.tasks.map((task) => [task.key, task]));
  for (const task of fixture.tasks) {
    const outputPath = path.join(
      fixture.repo,
      "soak-output",
      `${task.key}.json`,
    );
    const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert(output.key === task.key, `base output for ${task.key} is misbound`);
    assert(
      output.runId === fixture.runId,
      `base output for ${task.key} has the wrong run`,
    );
    assert(
      JSON.stringify(output.dependencyEvidence.map((entry) => entry.key)) ===
        JSON.stringify(task.dependsOn),
      `task ${task.key} did not observe its exact dependency baseline`,
    );
    const result = tasksByKey.get(task.key)?.metadata?.result;
    assert(result?.commitOid, `task ${task.key} has no durable Git result`);
    assert(
      (result.dependencyCommits || []).length === task.dependsOn.length,
      `task ${task.key} has incomplete dependency commit evidence`,
    );
    for (const dependencyKey of task.dependsOn) {
      const binding = result.dependencyCommits.find(
        (entry) => entry.key === dependencyKey,
      );
      const dependency = tasksByKey.get(dependencyKey)?.metadata?.result;
      assert(
        binding?.commitOid === dependency?.commitOid,
        `task ${task.key} inherited a stale ${dependencyKey} commit`,
      );
    }
  }
  return {
    outputs: fixture.tasks.length,
    dependencyEdges: fixture.tasks.reduce(
      (total, task) => total + task.dependsOn.length,
      0,
    ),
    diamondBaselineVerified: fixture.tasks.length >= 5,
  };
}

function verifyGitCleanup(fixture, status, finalized) {
  assert(finalized.merged === true, "finalization did not reach completed");
  assert(
    finalized.finalization.phase === "completed",
    `finalization stopped at ${finalized.finalization.phase}`,
  );
  assert(
    finalized.cleanup.length === fixture.tasks.length &&
      finalized.cleanup.every((entry) => entry.ok === true),
    "finalization did not durably clean every task worktree",
  );
  const worktrees = git(fixture.repo, "worktree", "list", "--porcelain")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree "));
  assert(worktrees.length === 1, "Git retained a registered task worktree");
  assert(git(fixture.repo, "status", "--porcelain") === "", "base is dirty");
  for (const task of status.tasks) {
    const result = task.metadata?.result;
    assert(
      !fs.existsSync(result.worktreePath),
      `cleaned worktree still exists for ${task.key}`,
    );
    assert(
      git(fixture.repo, "rev-parse", result.branch).toLowerCase() ===
        result.commitOid,
      `retained branch for ${task.key} moved after completion`,
    );
    git(fixture.repo, "merge-base", "--is-ancestor", result.commitOid, "HEAD");
  }
  const baseBranch = git(
    fixture.repo,
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  );
  const actualBranches = git(
    fixture.repo,
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  )
    .split(/\r?\n/u)
    .filter(Boolean)
    .sort();
  const expectedBranches = [
    baseBranch,
    ...status.tasks.map((task) => task.metadata.result.branch),
  ].sort();
  assert(
    JSON.stringify(actualBranches) === JSON.stringify(expectedBranches),
    "Git retained an unaccounted branch or lost an expected task branch",
  );
  const operationResidue = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
  ].filter((name) => fs.existsSync(path.join(fixture.repo, ".git", name)));
  assert(
    operationResidue.length === 0,
    `Git operation residue remained: ${operationResidue.join(",")}`,
  );
  const gitLockResidue = [];
  const pending = [path.join(fixture.repo, ".git")];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.name.endsWith(".lock") || entry.name.includes(".tmp-")) {
        gitLockResidue.push(path.relative(fixture.repo, target));
      }
    }
  }
  assert(
    gitLockResidue.length === 0,
    `Git lock/temp residue remained: ${gitLockResidue.join(",")}`,
  );
  return {
    baseOidBefore: fixture.baseOid,
    baseOidAfter: git(fixture.repo, "rev-parse", "HEAD").toLowerCase(),
    registeredWorktrees: worktrees.length,
    retainedVerifiedTaskBranches: status.tasks.length,
    accountedBranches: actualBranches.length,
    operationResidue,
    lockResidue: gitLockResidue,
  };
}

function verifyCheckpoints(fixture, status, workflowMode) {
  if (workflowMode !== "agent-worktree") {
    return {
      taskManagedCheckpointSupported: false,
      truth:
        "task processes are intentionally not reported as checkpointed on this platform profile",
      transactions: 0,
      terminal: 0,
    };
  }
  const broker = new TeamProcessCheckpointBroker({
    stateDir: fixture.checkpointStateDir,
  });
  const checkpoints = broker.listCheckpoints();
  assert(
    checkpoints.length === fixture.tasks.length,
    `observed ${checkpoints.length} checkpoints for ${fixture.tasks.length} tasks`,
  );
  assert(
    checkpoints.every(
      (checkpoint) =>
        checkpoint.state === "committed" &&
        checkpoint.runId === fixture.runId &&
        checkpoint.evidence?.evidenceDigest,
    ),
    "a task checkpoint is non-terminal or lacks durable evidence",
  );
  const transactionIds = new Set(
    status.tasks.map(
      (task) => task.metadata?.result?.workspaceCheckpoint?.transactionId,
    ),
  );
  assert(
    transactionIds.size === fixture.tasks.length &&
      checkpoints.every((checkpoint) => transactionIds.has(checkpoint.id)),
    "queue results and Process Broker transactions do not match exactly",
  );
  const lockResidues = checkpoints
    .map((checkpoint) => canonicalWorkspaceLockPath(checkpoint.workspaceRoot))
    .filter((lockPath) => fs.existsSync(lockPath));
  assert(
    lockResidues.length === 0,
    "a terminal Process Broker checkpoint retained its canonical workspace lock",
  );
  return {
    taskManagedCheckpointSupported: true,
    coverageTarget: "partial",
    externalSideEffects: true,
    transactions: checkpoints.length,
    terminal: checkpoints.filter((checkpoint) =>
      ["committed", "rolled_back", "aborted"].includes(checkpoint.state),
    ).length,
    committed: checkpoints.filter(
      (checkpoint) => checkpoint.state === "committed",
    ).length,
    lockResidues,
  };
}

function rssTrend(samples, options) {
  const tail = samples.slice(-Math.min(20, samples.length));
  let slopeBytesPerRound = 0;
  if (tail.length >= 2) {
    const xMean = (tail.length - 1) / 2;
    const yMean = tail.reduce((total, value) => total + value, 0) / tail.length;
    let numerator = 0;
    let denominator = 0;
    for (let index = 0; index < tail.length; index += 1) {
      numerator += (index - xMean) * (tail[index] - yMean);
      denominator += (index - xMean) ** 2;
    }
    slopeBytesPerRound = denominator === 0 ? 0 : numerator / denominator;
  }
  const projectedTailGrowth = Math.max(
    0,
    slopeBytesPerRound * Math.max(0, tail.length - 1),
  );
  const maximum = Math.max(0, ...samples);
  return {
    samples: samples.length,
    maximumBytes: maximum,
    tailSamples: tail.length,
    tailSlopeBytesPerRound: Math.round(slopeBytesPerRound),
    projectedTailGrowthBytes: Math.round(projectedTailGrowth),
    absoluteLimitBytes: Math.round(options.maxRssMb * MIB),
    growthLimitBytes: Math.round(options.maxRssGrowthMb * MIB),
    bounded:
      maximum <= options.maxRssMb * MIB &&
      projectedTailGrowth <= options.maxRssGrowthMb * MIB,
  };
}

async function runRound(
  rootDirectory,
  options,
  platformCapability,
  roundIndex,
) {
  const roundSeed =
    (options.seed + Math.imul(roundIndex + 1, 2654435761)) >>> 0;
  const workflowMode = platformCapability.workflowMode;
  const fixture = createFixture(
    rootDirectory,
    roundIndex,
    roundSeed,
    workflowMode,
    options.tasks,
  );
  initDistributedQueue({
    state: fixture.statePath,
    repo: fixture.repo,
    runId: fixture.runId,
    tasks: fixture.graphPath,
    mode: workflowMode,
    managedCheckpoint: workflowMode === "agent-worktree",
    checkpointStateDir:
      workflowMode === "agent-worktree"
        ? fixture.checkpointStateDir
        : undefined,
    maxTasks: fixture.tasks.length + options.crashes,
    agentMaxTokens: workflowMode === "agent-worktree" ? 8 : undefined,
    agentMaxTurns: workflowMode === "agent-worktree" ? 2 : undefined,
    ttlMs: options.ttlMs,
  });
  const configurationPath = path.join(fixture.authority, "worker.json");
  writeJson(configurationPath, {
    statePath: fixture.statePath,
    repo: fixture.repo,
    runId: fixture.runId,
    effectsDir: fixture.effectsDir,
    checkpointStateDir: fixture.checkpointStateDir,
    readyDir: path.join(fixture.authority, "worker-ready"),
    workflowMode,
    workers: options.workers,
    tasks: fixture.tasks.length,
    crashes: options.crashes,
    crashLeaseTtlMs: Math.max(options.ttlMs * 10, 600_000),
    workerTtlMs: options.ttlMs,
    renewEveryMs: Math.max(500, Math.floor(options.ttlMs / 3)),
    pollMs: 25,
    taskDelayMs: options.taskDelayMs,
  });

  const crashedLeases = [];
  const childRssSamples = [];
  for (let index = 0; index < options.crashes; index += 1) {
    const workerId = `pre-exec-crash-${roundIndex}-${index}`;
    const worker = createWorker(
      configurationPath,
      "crash-before-execution",
      workerId,
    );
    const result = await withTimeout(
      worker.done,
      30_000,
      `pre-execution crash ${index}`,
      [worker.child],
    );
    assert(!result.parseError, result.parseError?.message);
    assert(
      result.code === 86 && result.signal == null,
      `crash worker exited ${result.code}/${result.signal}: ${result.stderr}`,
    );
    const claimEvent = result.events.find((event) => event.type === "claimed");
    assert(claimEvent?.claim?.ok, "pre-execution crash did not claim a task");
    crashedLeases.push({
      key: claimEvent.claim.key,
      holder: workerId,
      lease: claimEvent.claim.lease,
    });
    childRssSamples.push(
      ...result.events.map((event) => event.rssBytes).filter(Number.isFinite),
    );
  }

  // Managed checkpoint authority deliberately refuses to auto-replay even a
  // retrySafe task when its owner dies before publishing checkpoint evidence.
  // This injected boundary is known to be before worktree creation and before
  // any external-effect attempt, so exercise the real evidence-bound operator
  // adjudication path before allowing a new fence to run the task.
  const crashStatus = distributedQueueStatus({
    state: fixture.statePath,
    repo: fixture.repo,
    runId: fixture.runId,
    mode: workflowMode,
  });
  const crashAdjudications =
    workflowMode === "agent-worktree"
      ? crashStatus.pendingAdjudications.map((pending, index) => {
          const crashed = crashedLeases.find(
            (entry) => entry.key === pending.key,
          );
          assert(
            crashed,
            `adjudication has no crashed lease for ${pending.key}`,
          );
          const task = crashStatus.tasks.find(
            (candidate) => candidate.key === pending.key,
          );
          const abandoned = task?.metadata?.abandonedLeaseEvidence;
          assert(
            abandoned?.lease?.holder === crashed.holder &&
              abandoned?.lease?.leaseId === crashed.lease.leaseId &&
              abandoned?.lease?.fencingToken === crashed.lease.fencingToken &&
              abandoned?.evidenceDigest === pending.evidenceDigest,
            `crash adjudication for ${pending.key} changed its exact lease evidence`,
          );
          const result = adjudicateDistributedQueue({
            state: fixture.statePath,
            repo: fixture.repo,
            runId: fixture.runId,
            task: pending.key,
            decision: "retry",
            decisionId: `soak-crash-retry-${roundIndex}-${index}`,
            evidenceDigest: pending.evidenceDigest,
            actor: "agent-team-soak",
            reason:
              "injected crash was observed before worktree, checkpoint, and external effect",
          });
          assert(
            result.ok === true &&
              result.decision === "retry" &&
              result.status === "pending",
            `crash adjudication for ${pending.key} did not authorize retry`,
          );
          return {
            key: pending.key,
            evidenceDigest: pending.evidenceDigest,
            decisionId: `soak-crash-retry-${roundIndex}-${index}`,
          };
        })
      : [];
  if (workflowMode === "agent-worktree") {
    assert(
      crashAdjudications.length === crashedLeases.length,
      "managed pre-execution crashes did not enter exact fail-closed adjudication",
    );
  } else {
    assert(
      crashStatus.pendingAdjudications.length === 0,
      "uncheckpointed pre-execution crash unexpectedly requires adjudication",
    );
  }

  const drainMode =
    workflowMode === "agent-worktree" ? "agent-drain" : "shell-drain";
  const workers = Array.from({ length: options.workers }, (_, index) =>
    createWorker(
      configurationPath,
      drainMode,
      `real-worker-${roundIndex}-${index}`,
    ),
  );
  const timeoutMs = Math.max(
    180_000,
    fixture.tasks.length * (process.platform === "win32" ? 45_000 : 20_000),
  );
  const workerResults = await withTimeout(
    Promise.all(workers.map((worker) => worker.done)),
    timeoutMs,
    "real distributed workers",
    workers.map((worker) => worker.child),
  );
  for (const result of workerResults) {
    assert(!result.parseError, result.parseError?.message);
    assert(
      result.code === 0 && result.signal == null,
      `distributed worker exited ${result.code}/${result.signal}: ${
        result.stderr
      } events=${JSON.stringify(result.events).slice(0, 4_000)}`,
    );
    assert(
      result.events.some((event) => event.type === "worker-finished"),
      "distributed worker produced no terminal summary",
    );
    childRssSamples.push(
      ...result.events.map((event) => event.rssBytes).filter(Number.isFinite),
    );
  }
  const workerTaskLimit = Math.ceil(fixture.tasks.length / options.workers);
  const workerExecutionLimits = workerResults.map((result) => {
    const finished = result.events.find(
      (event) => event.type === "worker-finished",
    );
    const executions = Number(finished?.summary?.executions);
    assert(
      finished?.workerId &&
        Number.isSafeInteger(finished.localTaskCap) &&
        finished.localTaskCap === workerTaskLimit,
      "distributed worker did not report its pinned local task ceiling",
    );
    assert(
      Number.isSafeInteger(executions) &&
        executions >= 0 &&
        executions <= workerTaskLimit,
      `worker ${finished.workerId} executed ${executions} tasks above its ${workerTaskLimit}-task ceiling`,
    );
    return {
      workerId: finished.workerId,
      executions,
      limit: finished.localTaskCap,
      withinLimit: true,
    };
  });
  const workerExecutionTotal = workerExecutionLimits.reduce(
    (total, worker) => total + worker.executions,
    0,
  );
  assert(
    workerExecutionTotal === fixture.tasks.length,
    `worker execution evidence accounts for ${workerExecutionTotal}/${fixture.tasks.length} tasks`,
  );
  const productiveWorkers = workerExecutionLimits.filter(
    (worker) => worker.executions > 0,
  ).length;
  assert(
    productiveWorkers >= Math.min(2, options.workers),
    `only ${productiveWorkers} worker process(es) won a real queue claim`,
  );
  assert(
    childRssSamples.every((rss) => rss <= options.maxRssMb * MIB),
    "a worker process exceeded the configured RSS ceiling",
  );

  const status = distributedQueueStatus({
    state: fixture.statePath,
    repo: fixture.repo,
    runId: fixture.runId,
    mode: workflowMode,
  });
  assert(status.stats.total === fixture.tasks.length, "task count changed");
  assert(
    status.stats.completed === fixture.tasks.length &&
      status.stats.leased === 0 &&
      status.stats.adjudicationRequired === 0,
    `distributed queue did not reach a clean terminal state: ${JSON.stringify({
      stats: status.stats,
      tasks: status.tasks.map((task) => ({
        key: task.key,
        status: task.status,
        attempts: task.metadata?.attempts,
        lastError: task.metadata?.lastError,
        adjudication: task.metadata?.adjudication,
      })),
    }).slice(0, 8_000)}`,
  );
  const queue = new TeamDistributedQueue({ filePath: fixture.statePath });
  const budgetBeforeReplay = stableBudgetEvidence(queue.budgetStatus());
  assert(
    budgetBeforeReplay.tasksStarted === fixture.tasks.length + options.crashes,
    "crash/reclaim did not consume the exact global task-start budget",
  );
  assert(
    budgetBeforeReplay.tasksSettled === fixture.tasks.length &&
      budgetBeforeReplay.reservations === 0,
    "global budget retained an unsettled reservation",
  );
  assert(
    budgetBeforeReplay.tokens ===
      (workflowMode === "agent-worktree" ? fixture.tasks.length * 3 : 0),
    "global token accounting does not match deterministic Agent usage",
  );
  assert(
    budgetBeforeReplay.reason === "max-tasks",
    `global budget closed for ${budgetBeforeReplay.reason || "no reason"}`,
  );
  for (const crashed of crashedLeases) {
    const stale = queue.complete(crashed.key, {
      holder: crashed.holder,
      leaseId: crashed.lease.leaseId,
      usage: { input_tokens: 1, output_tokens: 0 },
      result: { staleReplay: true },
    });
    assert(stale.ok === false, "a dead pre-execution lease bypassed fencing");
  }
  assert(
    JSON.stringify(stableBudgetEvidence(queue.budgetStatus())) ===
      JSON.stringify(budgetBeforeReplay),
    "stale crash settlement changed the global budget",
  );

  const preview = finalizeDistributedQueue({
    state: fixture.statePath,
    repo: fixture.repo,
    runId: fixture.runId,
    mode: workflowMode,
  });
  assert(
    preview.preview.length === fixture.tasks.length &&
      preview.preview.every((entry) => entry.clean === true),
    "real Git merge preview was not clean",
  );
  const finalized = finalizeDistributedQueue({
    state: fixture.statePath,
    repo: fixture.repo,
    runId: fixture.runId,
    mode: workflowMode,
    merge: true,
  });
  const effects = verifyExternalEffects(fixture);
  const dag = verifyDagOutputs(fixture, status);
  const checkpoint = verifyCheckpoints(fixture, status, workflowMode);
  const gitEvidence = verifyGitCleanup(fixture, status, finalized);
  const residues = residuePaths(fixture.authority, fixture.repo);
  assert(
    residues.length === 0,
    `queue/checkpoint/Git lock or temp residue remained: ${residues.join(",")}`,
  );
  const terminalQueueSnapshot = queue.snapshot();
  fs.rmSync(fixture.roundDirectory, { recursive: true, force: true });
  assert(
    !fs.existsSync(fixture.roundDirectory),
    "verified round state could not be removed after evidence collection",
  );

  return {
    round: roundIndex,
    seed: roundSeed,
    workflowMode,
    tasks: fixture.tasks.length,
    workers: options.workers,
    productiveWorkers,
    workerExecutionCeiling: {
      limitPerWorker: workerTaskLimit,
      totalExecutions: workerExecutionTotal,
      expectedExecutions: fixture.tasks.length,
      enforced: true,
      workers: workerExecutionLimits,
    },
    preExecutionCrashes: options.crashes,
    reclaimedLeases: crashedLeases.length,
    adjudicatedCrashRetries: crashAdjudications.length,
    rejectedStaleSettlements: crashedLeases.length,
    successfulSettlements: fixture.tasks.length,
    queueRevision: terminalQueueSnapshot.revision,
    maxFence: terminalQueueSnapshot.nextFence - 1,
    budget: budgetBeforeReplay,
    dag,
    effects,
    checkpoint,
    finalization: {
      previewed: preview.preview.length,
      merged: finalized.integration.length,
      cleaned: finalized.cleanup.length,
      phase: finalized.finalization.phase,
    },
    git: gitEvidence,
    residues,
    verifiedRoundStateRemoved: true,
    childRss: {
      samples: childRssSamples.length,
      maximumBytes: Math.max(0, ...childRssSamples),
      limitBytes: Math.round(options.maxRssMb * MIB),
    },
  };
}

async function run(options) {
  const commitSha = currentCommit();
  const expectedSha = options.expectedSha?.toLowerCase() || null;
  const trackedWorktree = trackedWorktreeEvidence();

  const startedAt = new Date();
  const startedMonotonic = performance.now();
  const report = {
    schemaVersion: 2,
    kind: "chainlesschain-cli-team-production-soak",
    success: false,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    elapsedMs: null,
    targetDurationMs: options.durationMs,
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    commitSha,
    checkoutEvidence: {
      expectedSha,
      headMatchesExpected:
        expectedSha == null ? null : commitSha === expectedSha,
      trackedWorktreeRequired: expectedSha != null,
      trackedWorktree,
    },
    coverageSemantics: {
      managedProcess: "capability-probe",
      agentExecution: "deterministic-contract",
      faultInjection: "pre-execution-worker-exit",
    },
    seed: options.seed,
    platformCapability: null,
    configuration: {
      workers: options.workers,
      tasksPerRound: options.tasks,
      crashesPerRound: options.crashes,
      ttlMs: options.ttlMs,
      maxRounds: options.maxRounds,
      maxRssMb: options.maxRssMb,
      maxRssGrowthMb: options.maxRssGrowthMb,
      requireManagedAgent: options.requireManagedAgent,
      liveModel: false,
      networkRequired: false,
    },
    totals: {
      rounds: 0,
      tasks: 0,
      workerCrashes: 0,
      adjudicatedCrashRetries: 0,
      successfulSettlements: 0,
      rejectedStaleSettlements: 0,
      confirmedExternalEffects: 0,
      duplicateConfirmedExternalEffects: 0,
      managedTaskCheckpoints: 0,
      finalizedWorktrees: 0,
      residues: 0,
    },
    memory: null,
    rounds: [],
    failures: [],
  };
  const rootDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-team-production-soak-"),
  );
  const parentRssSamples = [];
  const workerMaximumRssSamples = [];
  try {
    assert(
      expectedSha == null || commitSha === expectedSha,
      `checkout SHA mismatch: expected ${expectedSha}, got ${commitSha || "unavailable"}`,
    );
    assert(
      expectedSha == null || trackedWorktree.available,
      `tracked worktree cleanliness could not be verified: ${
        trackedWorktree.error || `git status exited ${trackedWorktree.status}`
      }`,
    );
    assert(
      expectedSha == null || trackedWorktree.clean,
      `tracked worktree is dirty at expected SHA ${expectedSha}: ${trackedWorktree.changes
        .slice(0, 20)
        .join(", ")}`,
    );
    report.platformCapability = probeManagedProcessCapability(rootDirectory);
    assert(
      !options.requireManagedAgent ||
        report.platformCapability.managedProcessSupported,
      "this gate requires a passing managed-process capability probe, but the probe failed closed",
    );
    const roundsStartedMonotonic = performance.now();
    while (
      (report.totals.rounds === 0 ||
        performance.now() - roundsStartedMonotonic < options.durationMs) &&
      (options.maxRounds == null || report.totals.rounds < options.maxRounds)
    ) {
      const round = await runRound(
        rootDirectory,
        options,
        report.platformCapability,
        report.totals.rounds,
      );
      report.rounds.push(round);
      report.totals.rounds += 1;
      report.totals.tasks += round.tasks;
      report.totals.workerCrashes += round.preExecutionCrashes;
      report.totals.adjudicatedCrashRetries += round.adjudicatedCrashRetries;
      report.totals.successfulSettlements += round.successfulSettlements;
      report.totals.rejectedStaleSettlements += round.rejectedStaleSettlements;
      report.totals.confirmedExternalEffects += round.effects.confirmed;
      report.totals.duplicateConfirmedExternalEffects +=
        round.effects.duplicateConfirmed;
      report.totals.managedTaskCheckpoints += round.checkpoint.transactions;
      report.totals.finalizedWorktrees += round.finalization.cleaned;
      report.totals.residues += round.residues.length;
      parentRssSamples.push(process.memoryUsage().rss);
      workerMaximumRssSamples.push(round.childRss.maximumBytes);
      report.memory = {
        ...rssTrend(parentRssSamples, options),
        workerMaximaTrend: rssTrend(workerMaximumRssSamples, options),
      };
      assert(
        report.memory.bounded && report.memory.workerMaximaTrend.bounded,
        "parent or worker RSS trend exceeded its bound",
      );
      if (report.totals.rounds % 5 === 0) {
        process.stderr.write(
          `team production soak: ${report.totals.rounds} rounds, ${report.totals.tasks} worktrees\n`,
        );
      }
    }
    assert(report.totals.rounds > 0, "soak completed without a round");
    assert(
      report.totals.successfulSettlements === report.totals.tasks,
      "aggregate settlements do not match real worktree tasks",
    );
    assert(
      report.totals.confirmedExternalEffects === report.totals.tasks &&
        report.totals.duplicateConfirmedExternalEffects === 0,
      "aggregate confirmed external-effect evidence is not exactly once",
    );
    assert(
      report.totals.finalizedWorktrees === report.totals.tasks &&
        report.totals.residues === 0,
      "aggregate finalization or residue validation failed",
    );
    report.success = true;
  } catch (error) {
    report.failures.push({
      name: error?.name || "Error",
      code: error?.code || null,
      message: error?.message || String(error),
      stack: error?.stack || null,
    });
  } finally {
    await terminateActiveWorkers();
    try {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    } catch (error) {
      report.success = false;
      report.failures.push({
        name: error?.name || "Error",
        code: error?.code || null,
        message: `soak temporary-state cleanup failed: ${
          error?.message || String(error)
        }`,
        stack: error?.stack || null,
      });
    }
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Math.round(performance.now() - startedMonotonic);
    report.memory ||= {
      ...rssTrend(parentRssSamples, options),
      workerMaximaTrend: rssTrend(workerMaximumRssSamples, options),
    };
    writeReport(options.output, report);
  }
  process.stdout.write(
    `${JSON.stringify({
      success: report.success,
      output: options.output,
      rounds: report.totals.rounds,
      tasks: report.totals.tasks,
      elapsedMs: report.elapsedMs,
      workflowMode: report.platformCapability?.workflowMode || null,
      commitSha: report.commitSha,
      failure: report.failures[0]?.message || null,
    })}\n`,
  );
  return report.success;
}

let options;
try {
  options = parseOptions(process.argv.slice(2), process.env);
  if (options.help) {
    printHelp();
  } else if (!(await run(options))) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
}
