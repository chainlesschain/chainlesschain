import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  ContextMemoryKernel,
  InMemoryMemoryPort,
  InMemoryProjectionPurgePort,
  InMemorySessionContextPort,
  canonicalDigest,
  normalizeContextItem,
} from "../index.mjs";

const require = createRequire(import.meta.url);
const {
  DesktopAppServerPilot,
} = require("../../../desktop-app-vue/src/main/ai-engine/code-agent/app-server-pilot.js");
const {
  IdeAppServerPilot,
} = require("../../vscode-extension/src/app-server-pilot.js");

const AT = "2026-08-30T00:00:00.000Z";
const PROFILES = Object.freeze({
  quick: {
    iterations: 30,
    minimumDurationMs: 0,
    paceMs: 0,
    restartEvery: 10,
  },
  release: {
    iterations: 1_800,
    minimumDurationMs: 30 * 60 * 1_000,
    paceMs: 1_000,
    restartEvery: 300,
  },
});
const SURFACES = Object.freeze([
  { id: "cli", hostAdapter: "ContextMemoryKernel direct CLI runtime" },
  {
    id: "desktop",
    hostAdapter: "DesktopAppServerPilot fixed capability",
  },
  { id: "vscode", hostAdapter: "IdeAppServerPilot fixed capability" },
  {
    id: "jetbrains",
    hostAdapter: "JetBrains App Server fixed-capability contract",
  },
]);

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function fullCommitSha() {
  const explicit = option("--candidate-sha", process.env.GITHUB_SHA || "");
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const value = explicit || head;
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error("candidate SHA must be a full commit SHA");
  }
  if (value !== head) throw new Error("candidate SHA must equal checkout HEAD");
  if (
    execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8",
    }).trim()
  ) {
    throw new Error("soak receipt requires a clean candidate worktree");
  }
  return value;
}

function platformName() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

class SoakSessionContextPort extends InMemorySessionContextPort {
  appendItems(sessionId, items) {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error(`unknown soak session ${sessionId}`);
    const appended = items.map(normalizeContextItem);
    state.items.push(...appended);
    state.head = canonicalDigest(
      {
        previousHead: state.head,
        appended: appended.map((item) => item.digest),
      },
      "chainlesschain.context-memory-soak-append/v1",
    );
  }
}

class SoakAppServerClient extends EventEmitter {
  constructor(runtime) {
    super();
    this.runtime = runtime;
    this.status = { running: true, initialized: true };
  }

  async start() {
    return { protocolVersion: 1 };
  }

  async close() {}

  async contextPlan(params) {
    return this.runtime.kernel.planContext(params);
  }

  async contextCompact(params) {
    return this.runtime.kernel.compactContext(params);
  }

  async memoryRecall(params) {
    return this.runtime.kernel.recallMemory(params);
  }

  async memoryPropose(params) {
    return this.runtime.kernel.proposeMemory(params);
  }

  async memoryDecide(params) {
    return this.runtime.kernel.decideMemory(params);
  }

  async memoryDelete(params) {
    return this.runtime.kernel.deleteMemory(params);
  }

  async memoryReconcile(params) {
    return this.runtime.kernel.reconcile(params.requestId);
  }
}

function contextItem(surface, index, overrides = {}) {
  const sessionId = `soak-${surface}`;
  return normalizeContextItem({
    schemaVersion: 1,
    itemId: `${surface}-item-${index}`,
    kind: "message",
    scope: "session",
    scopeId: sessionId,
    sourceRef: {
      store: "soak-fixture",
      id: `${surface}-source-${index}`,
      eventSequence: Number.isInteger(index) ? index + 1 : undefined,
    },
    provenance: {
      source: "soak-fixture",
      actor: "soak-user",
      observedAt: AT,
    },
    trust: "user",
    sensitivity: "internal",
    allowedSinks: ["provider.local"],
    tokenEstimate: 32,
    priority: Number.isInteger(index) ? index % 80 : 900,
    pinned: false,
    createdAt: AT,
    content:
      Number.isInteger(index) && index % 2 === 0
        ? `持续恢复上下文 ${surface} ${index}`
        : `long-running recovery context ${surface} ${index}`,
    ...overrides,
  });
}

function protectedItems(surface) {
  return [
    contextItem(surface, "goal", {
      kind: "task-state",
      tokenEstimate: 24,
      priority: 1_000,
      pinned: true,
      binding: { requiredForRecovery: true, taskState: "running" },
      content: `preserve ${surface} recovery goal`,
    }),
    contextItem(surface, "approval", {
      kind: "task-state",
      tokenEstimate: 16,
      binding: { approvalId: `${surface}-pending-approval` },
      content: `pending approval for ${surface}`,
    }),
    contextItem(surface, "question", {
      kind: "task-state",
      tokenEstimate: 16,
      binding: { questionId: `${surface}-pending-question` },
      content: `pending question for ${surface}`,
    }),
  ];
}

function proposal(index, content = `deterministic memory topic-${index % 8}`) {
  return {
    memoryId: `soak-memory-${index}`,
    scope: "user",
    scopeId: "soak-user",
    category: "soak",
    content,
    provenance: {
      source: "soak-fixture",
      actor: "soak-user",
      observedAt: AT,
    },
    evidenceRefs: [{ store: "soak-fixture", id: `evidence-${index}` }],
    confidence: 0.8,
    importance: 0.7,
    tags: ["soak", `topic-${index % 8}`],
    sensitivity: "personal",
    allowedSinks: ["provider.local"],
    retentionPolicy: { mode: "durable" },
    activate: true,
    createdAt: AT,
  };
}

function compactionRequest(surface, iteration) {
  const sessionId = `soak-${surface}`;
  return {
    operationId: `soak-${surface}-compact-${iteration}`,
    sessionId,
    modelWindowTokens: 512,
    reservedOutputTokens: 64,
    safetyMarginTokens: 32,
    recoveryReserveTokens: 32,
    sink: "provider.local",
    scopeAdmissions: [{ scope: "session", scopeId: sessionId }],
    policyVersion: "soak-policy-v1",
    modelProfile: "soak-model",
    now: AT,
  };
}

const profileName = option("--profile", "quick");
const profile = PROFILES[profileName];
if (!profile) throw new Error(`unknown soak profile ${profileName}`);
const exactCandidateSha = fullCommitSha();
const outputPath = option("--output");
const rssLimitBytes = Number(
  option("--rss-growth-limit-bytes", 256 * 1024 * 1024),
);
let uuidSequence = 0;
const sessions = new SoakSessionContextPort(
  SURFACES.map((surface) => ({
    sessionId: `soak-${surface.id}`,
    head: `head:soak-${surface.id}`,
    items: protectedItems(surface.id),
  })),
);
const memoryPort = new InMemoryMemoryPort();
const purgePort = new InMemoryProjectionPurgePort("soak-projection");
const runtime = { kernel: null };
function restartKernel() {
  runtime.kernel = new ContextMemoryKernel({
    sessionPort: sessions,
    memoryPort,
    reconciliationPort: memoryPort,
    purgePorts: [purgePort],
    clock: () => Date.parse(AT),
    randomUUID: () => `soak-${++uuidSequence}`,
  });
}
restartKernel();

const appServerClient = new SoakAppServerClient(runtime);
const desktopPilot = new DesktopAppServerPilot({ client: appServerClient });
const vscodePilot = new IdeAppServerPilot({ client: appServerClient });
const routes = new Map([
  ["cli", (params) => runtime.kernel.compactContext(params)],
  ["desktop", (params) => desktopPilot.contextCompact(params)],
  ["vscode", (params) => vscodePilot.contextCompact(params)],
  ["jetbrains", (params) => appServerClient.contextCompact(params)],
]);

for (let index = 0; index < 32; index += 1) {
  await runtime.kernel.proposeMemory(proposal(index));
}
const secretMarker = "SOAK_PRIVATE_VALUE_MUST_NOT_SURVIVE";
const secret = await runtime.kernel.proposeMemory(proposal(999, secretMarker));
const deletion = await runtime.kernel.deleteMemory({
  requestId: "soak-delete-secret",
  subject: "soak-user",
  scope: "user",
  scopeId: "soak-user",
  selector: `memory:${secret.record.memoryId}`,
  memoryId: secret.record.memoryId,
  expectedRevision: secret.record.revision,
  fence: "soak-fence-secret",
  authority: "soak-user-request",
});
if (deletion.status !== "purged") {
  throw new Error("soak privacy deletion did not converge");
}

const surfaceMetrics = Object.fromEntries(
  SURFACES.map((surface) => [
    surface.id,
    {
      hostAdapter: surface.hostAdapter,
      compactions: 0,
      restarts: 0,
      maxInputItems: 0,
      maxOutputItems: 0,
    },
  ]),
);
const startedAt = Date.now();
const baselineRssBytes = process.memoryUsage().rss;
let maxRssBytes = baselineRssBytes;
let iterations = 0;
let casRaces = 0;
do {
  for (const surface of SURFACES) {
    const sessionId = `soak-${surface.id}`;
    sessions.appendItems(
      sessionId,
      Array.from({ length: 8 }, (_, offset) =>
        contextItem(surface.id, iterations * 8 + offset),
      ),
    );
    const before = await sessions.readSnapshot(sessionId);
    const receipt = await routes.get(surface.id)(
      compactionRequest(surface.id, iterations),
    );
    if (receipt.status !== "committed") {
      throw new Error(`${surface.id} compaction returned ${receipt.status}`);
    }
    const after = await sessions.readSnapshot(sessionId);
    for (const protectedId of ["goal", "approval", "question"]) {
      if (
        !after.items.some(
          (item) => item.itemId === `${surface.id}-item-${protectedId}`,
        )
      ) {
        throw new Error(`${surface.id} dropped protected ${protectedId} state`);
      }
    }
    surfaceMetrics[surface.id].compactions += 1;
    surfaceMetrics[surface.id].maxInputItems = Math.max(
      surfaceMetrics[surface.id].maxInputItems,
      before.items.length,
    );
    surfaceMetrics[surface.id].maxOutputItems = Math.max(
      surfaceMetrics[surface.id].maxOutputItems,
      after.items.length,
    );
  }

  const recalled = await runtime.kernel.recallMemory({
    query: `topic-${iterations % 8}`,
    sink: "provider.local",
    scopeAdmissions: [{ scope: "user", scopeId: "soak-user" }],
    limit: 8,
    tokenBudget: 2_048,
  });
  if (recalled.results.length > 8) {
    throw new Error("recall exceeded its configured limit");
  }
  if (recalled.results.some(({ record }) => record.content === secretMarker)) {
    throw new Error("deleted content was recalled");
  }

  if (iterations % 100 === 0) {
    const current = await memoryPort.read("soak-memory-0");
    const decisions = await Promise.allSettled([
      runtime.kernel.decideMemory({
        memoryId: current.memoryId,
        type: "reinforce",
        expectedRevision: current.revision,
        confidenceDelta: 0.01,
      }),
      runtime.kernel.decideMemory({
        memoryId: current.memoryId,
        type: "reinforce",
        expectedRevision: current.revision,
        confidenceDelta: 0.01,
      }),
    ]);
    if (decisions.filter(({ status }) => status === "fulfilled").length !== 1) {
      throw new Error("CAS race did not produce exactly one winner");
    }
    casRaces += 1;
  }

  iterations += 1;
  if (iterations % profile.restartEvery === 0) {
    restartKernel();
    for (const surface of SURFACES) surfaceMetrics[surface.id].restarts += 1;
  }
  maxRssBytes = Math.max(maxRssBytes, process.memoryUsage().rss);
  if (profile.paceMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, profile.paceMs));
  }
} while (
  iterations < profile.iterations ||
  Date.now() - startedAt < profile.minimumDurationMs
);

const durationMs = Date.now() - startedAt;
const rssGrowthBytes = Math.max(0, maxRssBytes - baselineRssBytes);
if (rssGrowthBytes > rssLimitBytes) {
  throw new Error(
    `RSS growth ${rssGrowthBytes} exceeded limit ${rssLimitBytes}`,
  );
}
for (const metrics of Object.values(surfaceMetrics)) {
  if (metrics.compactions < 2 || metrics.restarts < 1) {
    throw new Error(
      "each host adapter must survive multiple compactions and a restart",
    );
  }
}
const durableState = JSON.stringify({
  records: await memoryPort.query(),
  events: memoryPort.events,
  reconciliations: [...memoryPort.reconciliations.values()],
});
if (durableState.includes(secretMarker)) {
  throw new Error("deleted content survived in durable authority state");
}

const receipt = {
  schema: "chainlesschain.context-memory-soak-receipt/v2",
  schemaVersion: 2,
  candidateSha: exactCandidateSha,
  platform: platformName(),
  architecture: process.arch,
  nodeVersion: process.version,
  profile: profileName,
  status: "passed",
  iterations,
  durationMs,
  casRaces,
  recordCount: (await memoryPort.query()).length,
  baselineRssBytes,
  maxRssBytes,
  rssGrowthBytes,
  rssGrowthLimitBytes: rssLimitBytes,
  surfaces: surfaceMetrics,
  invariants: {
    protectedRecoveryState: true,
    pendingApprovalAndQuestion: true,
    boundedRecall: true,
    casSingleWinner: true,
    multiCompaction: true,
    crashRestartRecovery: true,
    deletionConverged: true,
    deletedContentAbsent: true,
  },
  workloadDigest: canonicalDigest(
    {
      profile: profileName,
      configuration: profile,
      surfaces: SURFACES,
    },
    "chainlesschain.context-memory-soak-workload/v2",
  ),
};
receipt.digest = canonicalDigest(receipt, receipt.schema);
const output = `${JSON.stringify(receipt, null, 2)}\n`;
if (outputPath) writeFileSync(outputPath, output, "utf8");
else process.stdout.write(output);
