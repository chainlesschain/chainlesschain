#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TaskLeaseRegistry } from "../src/lib/agent-team/task-lease.js";
import { TeamMailbox } from "../src/lib/agent-team/team-mailbox.js";
import { TeamDistributedQueue } from "../src/lib/agent-team/team-distributed-queue.js";
import { JsonlRolloutStore } from "../src/lib/app-server/rollout-store.js";
import { CoworkGraphAuthorityAdapter } from "../src/lib/cowork-graph-authority-adapter.js";
import {
  buildDynamicWorkflowRunAdmission,
  SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
} from "../src/lib/dynamic-workflow-facade.js";
import {
  dynamicWorkflowRunStatePath,
  executeDurableDynamicWorkflow,
  prepareDurableWorkflowResume,
  readDynamicWorkflowRuntimeState,
  reconcileDurableWorkflowEffect,
} from "../src/lib/dynamic-workflow-runtime.js";
import { createExecutionLocationBinding } from "../src/lib/execution-location-contract.js";
import { GraphEventStore } from "../src/lib/graph-kernel/event-store.js";
import { SchedulerGraphDispatchJournal } from "../src/lib/graph-kernel/trigger-adapter.js";
import {
  assertExactCommitSha,
  createGraphStoreCutoverEvidence,
  graphStoreEvidenceDigest,
} from "../src/lib/graph-kernel/store-cutover-evidence.js";
import { openSchedulerStore } from "../src/lib/scheduler-kernel/store.js";
import {
  createCoworkWorkflowRecord,
  verifyCoworkWorkflowRecord,
} from "../src/lib/workflow-definition-contract.js";

const SELF = fileURLToPath(import.meta.url);
let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (error) {
  if (
    error?.code !== "ERR_UNKNOWN_BUILTIN_MODULE" ||
    process.execArgv.includes("--experimental-sqlite")
  ) {
    throw error;
  }
  const relaunched = spawnSync(
    process.execPath,
    ["--experimental-sqlite", SELF, ...process.argv.slice(2)],
    {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (relaunched.error) throw relaunched.error;
  process.exit(relaunched.status ?? 1);
}
const JOURNEY_SCHEMA = "chainlesschain.graph-cli-store-cutover-journey/v1";
const RUN_ID = "p1-3-cli-store-cutover";
const DYNAMIC_RUN_ID = `${RUN_ID}-dynamic`;
const DISTRIBUTED_RUN_ID = `${RUN_ID}-distributed`;
const JOURNAL_KEY = "scheduler-revision-1\0scheduler-occurrence-1";
const ADMISSION_DIGEST = `sha256:${"b".repeat(64)}`;
const DEFINITION_DIGEST = `sha256:${"a".repeat(64)}`;
const COWORK_GRAPH_RUN_ID = `cowork:${ADMISSION_DIGEST.slice(7, 55)}`;
const PLATFORM =
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : process.platform;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function digest(value) {
  return graphStoreEvidenceDigest(stableValue(value));
}

const STORE_SCOPES = Object.freeze({
  TaskLeaseRegistry: ["cli_team", "cli-team-local"],
  TeamMailbox: ["cli_team", "cli-team-local"],
  TeamDistributedQueue: ["cli_team", "cli-team-distributed"],
  DynamicWorkflowRuntimeStore: ["cowork", "cli-cowork"],
  CoworkTaskStore: ["cowork", "cli-cowork"],
  SchedulerKernelStore: ["scheduler", "cli-scheduler"],
  SchedulerGraphDispatchJournal: ["scheduler", "cli-scheduler"],
});

function parseArguments(argv) {
  const options = {
    keep: false,
    writerRoot: null,
    output: null,
    commitSha: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--keep") options.keep = true;
    else if (value === "--writer-root") options.writerRoot = argv[++index];
    else if (value === "--output") options.output = argv[++index];
    else if (value === "--expected-commit") options.commitSha = argv[++index];
    else throw new Error(`unknown argument: ${value}`);
  }
  return options;
}

function deterministicIds(prefix) {
  let sequence = 0;
  return (kind = "id") => `${prefix}-${kind}-${++sequence}`;
}

class NodeSqliteDatabase {
  constructor(file) {
    this.database = new DatabaseSync(file);
  }

  get inTransaction() {
    return this.database.isTransaction;
  }

  exec(sql) {
    return this.database.exec(sql);
  }

  prepare(sql) {
    const statement = this.database.prepare(sql);
    statement.setAllowBareNamedParameters?.(true);
    return statement;
  }

  pragma(source, { simple = false } = {}) {
    const statement = String(source).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/u.test(statement)) {
      this.exec(`PRAGMA ${statement}`);
      return undefined;
    }
    const rows = this.prepare(`PRAGMA ${statement}`).all();
    if (!simple) return rows;
    const row = rows[0];
    return row ? Object.values(row)[0] : undefined;
  }

  transaction(callback) {
    const immediate = (...args) => {
      this.exec("BEGIN IMMEDIATE");
      try {
        const result = callback(...args);
        this.exec("COMMIT");
        return result;
      } catch (error) {
        if (this.inTransaction) this.exec("ROLLBACK");
        throw error;
      }
    };
    immediate.immediate = immediate;
    return immediate;
  }

  close() {
    this.database.close();
  }
}

function workflowDefinition() {
  return {
    id: "p1-3-durable-workflow",
    name: "P1-3 durable workflow",
    steps: [
      { id: "collect", message: "Collect release evidence" },
      {
        id: "review",
        message: "Review ${step.collect.summary}",
        dependsOn: ["collect"],
      },
    ],
    facade: {
      requirements: {
        capabilities: ["cowork-task", "dag", "variables"],
        executionLocations: ["local"],
        permissions: {
          file: "read",
          shell: false,
          network: false,
          mcp: false,
          externalSystems: false,
        },
        sandbox: "strong",
        dataBoundary: "repository",
        credentials: [],
      },
      estimates: {
        tokensPerTask: 100,
        usdPerTask: 0.01,
        durationMsPerTask: 1000,
      },
      budget: {
        maxExpandedTasks: 8,
        maxParallel: 1,
        maxTokens: 1000,
        maxUsd: 1,
        maxDurationMs: 10_000,
      },
    },
  };
}

function executionLocation(projectRoot) {
  return createExecutionLocationBinding({
    location: "local",
    observed: true,
    observedAt: "2026-08-28T00:00:00.000Z",
    source: {
      cwd: projectRoot,
      git: { root: projectRoot, commit: "a".repeat(40) },
    },
    runtime: {
      platform: process.platform,
      arch: process.arch,
      tools: ["node"],
    },
    model: {
      provider: "fixture",
      name: "fixture-model",
      credentialSource: "none",
    },
    permissions: {
      status: "declared",
      file: "read",
      shell: false,
      network: false,
      mcp: false,
      externalSystems: false,
    },
    policy: {
      network: "offline",
      sandbox: "strong",
      dataBoundary: { kind: "repository", root: projectRoot },
    },
  });
}

function admittedExecution(projectRoot) {
  const definitionAuthority = verifyCoworkWorkflowRecord(
    createCoworkWorkflowRecord(workflowDefinition()),
  );
  const executionLocationAuthority = {
    schema: SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
    authority: "verified-session-start",
    sessionId: `${RUN_ID}-session`,
    headHash: "d".repeat(64),
    eventCount: 4,
    binding: executionLocation(projectRoot),
  };
  const admission = buildDynamicWorkflowRunAdmission(
    {
      definitionAuthority,
      executionAuthoritySessionId: `${RUN_ID}-session`,
      maxParallel: 1,
      execution: {
        cwd: projectRoot,
        continueOnError: false,
        pipeline: false,
        provider: "fixture",
        model: "fixture-model",
      },
    },
    {
      verifyAuthorities: () => ({
        definitionAuthority,
        executionLocationAuthority,
      }),
    },
  );
  if (admission.allowed !== true)
    throw new Error("dynamic workflow admission failed");
  return {
    workflow: definitionAuthority.definition,
    definitionDigest: definitionAuthority.definitionDigest,
    cwd: projectRoot,
    continueOnError: false,
    pipeline: false,
    llmOptions: { provider: "fixture", model: "fixture-model" },
    runAdmission: admission.admission,
  };
}

function completedTask(args) {
  return {
    taskId: `task-${args.workflowEffect.stepId}-${args.workflowEffect.iteration}-${args.workflowEffect.attempt}`,
    status: "completed",
    result: { summary: `done:${args.userMessage}`, tokenCount: 10 },
  };
}

function schedulerAuthority() {
  return {
    schemaVersion: 1,
    principal: { type: "agent", id: "p1-3-store-journey" },
    tenantId: "tenant-p1-3",
    workspaceId: "workspace-p1-3",
    requestedCapabilities: ["workspace.read", "network.none"],
    authorizationRefs: {
      decisionId: "decision-p1-3",
      policyRevision: "policy-p1-3",
      grantIds: ["grant-p1-3"],
      approvalIds: [],
      delegationIds: [],
    },
  };
}

function openScheduler(file) {
  return openSchedulerStore({
    file,
    Database: NodeSqliteDatabase,
    clock: () => Date.parse("2026-08-28T00:00:00.000Z"),
  });
}

function writeTeamStores(root) {
  const registry = new TaskLeaseRegistry({
    now: () => 1000,
    defaultTtlMs: 60_000,
  });
  registry.addTasks([
    { key: "build", title: "Build" },
    { key: "verify", title: "Verify", dependsOn: ["build"] },
  ]);
  const lease = registry.acquire("build", {
    holder: "writer",
    ttlMs: 60_000,
  });
  if (!lease.ok) throw new Error("could not create TaskLeaseRegistry cutpoint");

  const mailbox = new TeamMailbox({
    now: () => 1000,
    recipients: ["writer", "reviewer"],
  });
  mailbox.send({
    from: "writer",
    to: "reviewer",
    body: { task: "verify" },
    idempotencyKey: "p1-3-team-message",
  });
  mailbox.receive("reviewer", { markRead: true });
  writeFileSync(
    path.join(root, "team-local.json"),
    `${JSON.stringify({ registry: registry.snapshot(), mailbox: mailbox.snapshot() })}\n`,
    "utf8",
  );
}

function writeDistributedStore(root) {
  const queuePath = path.join(root, "distributed", "queue.json");
  const queue = TeamDistributedQueue.create({
    filePath: queuePath,
    id: deterministicIds("writer"),
    processId: process.pid,
    isProcessAlive: (pid) => pid === process.pid,
    tasks: [
      { key: "build", title: "Build" },
      { key: "verify", title: "Verify", dependsOn: ["build"] },
    ],
    authority: { runId: DISTRIBUTED_RUN_ID, graphOwner: "graph-kernel" },
    runId: DISTRIBUTED_RUN_ID,
  });
  const claimed = queue.claim({ holder: "writer", ttlMs: 60_000 });
  if (!claimed.ok)
    throw new Error("could not create distributed queue cutpoint");
}

function writeCoworkTaskStore(root) {
  const rolloutStore = new JsonlRolloutStore({
    directory: path.join(root, "cowork-rollout"),
    now: () => Date.parse("2026-08-28T00:00:00.000Z"),
  });
  const authority = new CoworkGraphAuthorityAdapter({
    mode: "canonical",
    authorityResolver: () => "canonical",
    eventStore: new GraphEventStore({ rolloutStore }),
    createId: deterministicIds("cowork-writer"),
    now: () => Date.parse("2026-08-28T00:00:00.000Z"),
  });
  const claim = authority.begin({
    workflow: { id: "p1-3-cowork", name: "P1-3 Cowork" },
    admission: {
      definitionDigest: DEFINITION_DIGEST,
      admissionDigest: ADMISSION_DIGEST,
    },
  });
  authority.settleSuccess(claim, {
    workflowId: "p1-3-cowork",
    status: "completed",
  });
}

function writeSchedulerStores(root) {
  const schedulerFile = path.join(root, "scheduler", "scheduler.db");
  const store = openScheduler(schedulerFile);
  store.createJob({
    id: "p1-3-job",
    kind: "test.adapter",
    trigger: { adapter: "test", expression: "p1-3" },
    payload: { action: "probe" },
    authority: schedulerAuthority(),
    maxAttempts: 3,
  });
  const occurrence = store.enqueueOccurrence({
    jobId: "p1-3-job",
    scheduledFor: Date.parse("2026-08-28T00:00:00.000Z"),
    triggerKey: "p1-3-cutpoint",
  });

  const journal = new SchedulerGraphDispatchJournal({
    store: new JsonlRolloutStore({
      directory: path.join(root, "scheduler-journal"),
      now: () => Date.parse("2026-08-28T00:00:00.000Z"),
    }),
  });
  journal.append(JOURNAL_KEY, "prepared", {
    occurrenceId: occurrence.id,
    jobId: "p1-3-job",
  });
  writeFileSync(
    path.join(root, "journey-meta.json"),
    `${JSON.stringify({ occurrenceId: occurrence.id })}\n`,
    "utf8",
  );
  return store;
}

async function runWriter(root) {
  writeTeamStores(root);
  writeDistributedStore(root);
  writeCoworkTaskStore(root);
  const schedulerStore = writeSchedulerStores(root);
  const projectRoot = path.join(root, "cowork-project");
  const statePath = dynamicWorkflowRunStatePath(projectRoot, DYNAMIC_RUN_ID);
  await executeDurableDynamicWorkflow(
    {
      statePath,
      runId: DYNAMIC_RUN_ID,
      execution: admittedExecution(projectRoot),
    },
    {
      runTask: async (args) => completedTask(args),
      now: (() => {
        let tick = 0;
        return () =>
          new Date(
            Date.parse("2026-08-28T00:00:00.000Z") + tick++ * 1000,
          ).toISOString();
      })(),
      afterProvider: async () => {
        process.stdout.write(
          `${JSON.stringify({ type: "cutpoint-ready", pid: process.pid })}\n`,
        );
        await new Promise(() => {});
      },
    },
  );
  schedulerStore.close();
}

function readCoworkTaskProjection(root) {
  const rolloutStore = new JsonlRolloutStore({
    directory: path.join(root, "cowork-rollout"),
  });
  return {
    graph: new GraphEventStore({ rolloutStore }).read(COWORK_GRAPH_RUN_ID),
    result: rolloutStore.read(`cowork-result:${COWORK_GRAPH_RUN_ID}`),
  };
}

function readSchedulerProjection(root) {
  const meta = JSON.parse(
    readFileSync(path.join(root, "journey-meta.json"), "utf8"),
  );
  const store = openScheduler(path.join(root, "scheduler", "scheduler.db"));
  try {
    return {
      schema: store.schemaInfo(),
      job: store.getJob("p1-3-job"),
      occurrence: store.getOccurrence(meta.occurrenceId),
    };
  } finally {
    store.close();
  }
}

function readStoreProjections(root) {
  const team = JSON.parse(
    readFileSync(path.join(root, "team-local.json"), "utf8"),
  );
  const distributed = TeamDistributedQueue.open({
    filePath: path.join(root, "distributed", "queue.json"),
    runId: DISTRIBUTED_RUN_ID,
    now: () => Date.parse("2026-08-28T02:00:00.000Z"),
    id: deterministicIds("projection"),
    processId: process.pid,
    isProcessAlive: () => false,
  });
  const journalStore = new JsonlRolloutStore({
    directory: path.join(root, "scheduler-journal"),
  });
  const journal = journalStore
    .read("scheduler-graph-dispatch")
    .filter((event) => event.payload?.keyDigest)
    .map((event) => event.payload);
  return {
    TaskLeaseRegistry: TaskLeaseRegistry.restore(team.registry, {
      now: () => 1000,
    }).snapshot(),
    TeamMailbox: TeamMailbox.restore(team.mailbox, {
      now: () => 1000,
    }).snapshot(),
    TeamDistributedQueue: distributed.snapshot(),
    DynamicWorkflowRuntimeStore: readDynamicWorkflowRuntimeState(
      dynamicWorkflowRunStatePath(
        path.join(root, "cowork-project"),
        DYNAMIC_RUN_ID,
      ),
    ),
    CoworkTaskStore: readCoworkTaskProjection(root),
    SchedulerKernelStore: readSchedulerProjection(root),
    SchedulerGraphDispatchJournal: journal,
  };
}

async function recoverStores(root) {
  const team = JSON.parse(
    readFileSync(path.join(root, "team-local.json"), "utf8"),
  );
  const registry = TaskLeaseRegistry.restore(team.registry, {
    now: () => 1000,
  });
  const mailbox = TeamMailbox.restore(team.mailbox, { now: () => 1000 });
  const distributed = TeamDistributedQueue.open({
    filePath: path.join(root, "distributed", "queue.json"),
    runId: DISTRIBUTED_RUN_ID,
    now: () => Date.parse("2026-08-28T02:00:00.000Z"),
    id: deterministicIds("recovery"),
    processId: process.pid,
    isProcessAlive: () => false,
  });
  const projectRoot = path.join(root, "cowork-project");
  const statePath = dynamicWorkflowRunStatePath(projectRoot, DYNAMIC_RUN_ID);
  let dynamicState = readDynamicWorkflowRuntimeState(statePath);
  const effect = dynamicState.effects[0];
  dynamicState = reconcileDurableWorkflowEffect(
    statePath,
    {
      expectedRevision: dynamicState.revision,
      effectId: effect.id,
      result: completedTask({
        workflowEffect: {
          stepId: effect.stepId,
          iteration: effect.iteration,
          attempt: effect.attempt,
        },
        userMessage: "Collect release evidence",
      }),
    },
    { now: () => "2026-08-28T01:00:00.000Z" },
  );
  dynamicState = prepareDurableWorkflowResume(
    statePath,
    dynamicState.revision,
    { now: () => "2026-08-28T01:00:01.000Z" },
  );
  const dynamicRecord = await executeDurableDynamicWorkflow(
    {
      statePath,
      runId: DYNAMIC_RUN_ID,
      execution: admittedExecution(projectRoot),
    },
    {
      runTask: async (args) => completedTask(args),
      now: (() => {
        let tick = 0;
        return () =>
          new Date(
            Date.parse("2026-08-28T01:00:00.000Z") + tick++ * 1000,
          ).toISOString();
      })(),
    },
  );

  const rolloutStore = new JsonlRolloutStore({
    directory: path.join(root, "cowork-rollout"),
    now: () => Date.parse("2026-08-28T01:00:00.000Z"),
  });
  const cowork = new CoworkGraphAuthorityAdapter({
    mode: "canonical",
    authorityResolver: () => "canonical",
    eventStore: new GraphEventStore({ rolloutStore }),
    createId: deterministicIds("cowork-recovery"),
    now: () => Date.parse("2026-08-28T01:00:00.000Z"),
  }).begin({
    workflow: { id: "p1-3-cowork", name: "P1-3 Cowork" },
    admission: {
      definitionDigest: DEFINITION_DIGEST,
      admissionDigest: ADMISSION_DIGEST,
    },
  });
  const scheduler = readSchedulerProjection(root);
  const journal = new SchedulerGraphDispatchJournal({
    store: new JsonlRolloutStore({
      directory: path.join(root, "scheduler-journal"),
    }),
  }).read(JOURNAL_KEY);
  return {
    TaskLeaseRegistry: {
      restored: registry.getTask("build")?.status === "in_progress",
    },
    TeamMailbox: { restored: mailbox.receive("reviewer").length === 1 },
    TeamDistributedQueue: {
      restored:
        distributed.getTask("build")?.metadata?.adjudication?.required === true,
    },
    DynamicWorkflowRuntimeStore: {
      reconciledRevision: dynamicState.revision,
      status: dynamicRecord.status,
    },
    CoworkTaskStore: {
      alreadySettled: cowork?.alreadySettled === true,
      status: cowork?.record?.status,
    },
    SchedulerKernelStore: {
      restored:
        scheduler.job?.id === "p1-3-job" && Boolean(scheduler.occurrence?.id),
    },
    SchedulerGraphDispatchJournal: { restored: journal.length >= 1 },
  };
}

function spawnWriter(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [...process.execArgv, SELF, "--writer-root", root],
      {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/u);
      stdout = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type === "cutpoint-ready" && !settled) {
          settled = true;
          resolve({ child, message, stderr: () => stderr });
        }
      }
    });
    child.once("error", fail);
    child.once("exit", (code, signal) => {
      if (!settled) {
        fail(
          new Error(
            `writer exited before cutpoint (code=${code}, signal=${signal}): ${stderr}`,
          ),
        );
      }
    });
  });
}

function terminateWriter(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("writer termination timed out")),
      15_000,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    if (!child.kill()) {
      clearTimeout(timer);
      reject(new Error("could not terminate writer process"));
    }
  });
}

function currentCommitSha(explicit) {
  const actual = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: path.resolve(path.dirname(SELF), "../../.."),
    encoding: "utf8",
  });
  return assertExactCommitSha(explicit, actual);
}

async function runJourney(options) {
  const commitSha = currentCommitSha(options.commitSha);
  const root = mkdtempSync(path.join(tmpdir(), "cc-p1-3-cli-store-writer-"));
  const rollbackRoot = mkdtempSync(
    path.join(tmpdir(), "cc-p1-3-cli-store-rollback-"),
  );
  try {
    const writer = await spawnWriter(root);
    const termination = await terminateWriter(writer.child);
    cpSync(root, rollbackRoot, { recursive: true, force: true });

    const cutpoint = readStoreProjections(root);
    const rollback = readStoreProjections(rollbackRoot);
    const cutpointDigests = Object.fromEntries(
      Object.entries(cutpoint).map(([store, value]) => [store, digest(value)]),
    );
    const rollbackDigests = Object.fromEntries(
      Object.entries(rollback).map(([store, value]) => [store, digest(value)]),
    );
    for (const store of Object.keys(cutpointDigests)) {
      if (cutpointDigests[store] !== rollbackDigests[store]) {
        throw new Error(`rollback clone drifted before takeover: ${store}`);
      }
    }

    const recoveredBefore = readStoreProjections(root);
    for (const [store, value] of Object.entries(recoveredBefore)) {
      if (digest(value) !== cutpointDigests[store]) {
        throw new Error(`RPO=0 recovery failed before takeover: ${store}`);
      }
    }
    const recoveryActions = await recoverStores(root);
    for (const [store, action] of Object.entries(recoveryActions)) {
      if (
        !Object.values(action).some(
          (value) => value === true || value === "completed",
        )
      ) {
        throw new Error(`recovery action did not settle: ${store}`);
      }
    }
    const recoveredAfter = readStoreProjections(root);

    const stores = Object.keys(cutpointDigests)
      .sort()
      .map((store) => ({
        surface: STORE_SCOPES[store][0],
        entryId: STORE_SCOPES[store][1],
        store,
        cutpointDigest: cutpointDigests[store],
        recoveryReceiptDigest: digest({
          action: recoveryActions[store],
          before: cutpointDigests[store],
          after: digest(recoveredAfter[store]),
        }),
        rollbackDrillDigest: digest({
          cutpoint: cutpointDigests[store],
          rollback: rollbackDigests[store],
          matched: true,
        }),
        rpoLossCount: 0,
        recovered: true,
      }));
    const sourceReceipts = {
      writerCutpointDigest: digest({
        pid: writer.message.pid,
        stores: cutpointDigests,
      }),
      killReceiptDigest: digest({
        pid: writer.message.pid,
        exitCode: termination.code,
        signal: termination.signal,
      }),
      recoveryReceiptDigest: digest(recoveryActions),
      rollbackReceiptDigest: digest(rollbackDigests),
    };
    const storeEvidence = createGraphStoreCutoverEvidence({
      source: "cli_store_kill_recovery",
      commitSha,
      platform: PLATFORM,
      stores,
      sourceReceipts,
    });
    const unsigned = {
      schema: JOURNEY_SCHEMA,
      status: "passed",
      commitSha,
      platform: PLATFORM,
      writerPid: writer.message.pid,
      writerKilled: true,
      termination,
      cutpointDigests,
      recoveryActions,
      rollbackDigests,
      storeEvidence,
    };
    const artifact = { ...unsigned, artifactDigest: digest(unsigned) };
    const text = `${JSON.stringify(artifact, null, 2)}\n`;
    if (options.output)
      writeFileSync(path.resolve(options.output), text, "utf8");
    else process.stdout.write(text);
  } finally {
    if (!options.keep) {
      rmSync(root, { recursive: true, force: true });
      rmSync(rollbackRoot, { recursive: true, force: true });
    } else {
      process.stderr.write(
        `writer root: ${root}\nrollback root: ${rollbackRoot}\n`,
      );
    }
  }
}

const options = parseArguments(process.argv.slice(2));
if (options.writerRoot) {
  await runWriter(path.resolve(options.writerRoot));
} else {
  await runJourney(options);
}
