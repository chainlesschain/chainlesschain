import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  ContextMemoryKernel,
  InMemoryMemoryPort,
  InMemoryProjectionPurgePort,
  canonicalDigest,
  normalizeContextItem,
} from "../index.mjs";

const AT = "2026-08-29T00:00:00.000Z";
const PROFILES = Object.freeze({
  quick: { iterations: 250, minimumDurationMs: 0, paceMs: 0 },
  release: { iterations: 1_800, minimumDurationMs: 30 * 60 * 1_000, paceMs: 1_000 },
});

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function fullCommitSha() {
  const explicit = option("--candidate-sha", process.env.GITHUB_SHA || "");
  const value = explicit || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new Error("candidate SHA must be a full commit SHA");
  return value;
}

function platformName() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function contextItem(index) {
  return normalizeContextItem({
    schemaVersion: 1,
    itemId: `soak-item-${index}`,
    kind: index === 0 ? "task-state" : "message",
    scope: "session",
    scopeId: "soak-session",
    sourceRef: { store: "soak-fixture", id: `source-${index}`, eventSequence: index + 1 },
    provenance: { source: "soak-fixture", actor: "soak-user", observedAt: AT },
    trust: "user",
    sensitivity: "internal",
    allowedSinks: ["provider.local"],
    tokenEstimate: 12,
    priority: 100 - index,
    pinned: index === 0,
    createdAt: AT,
    content: `deterministic context item ${index}`,
    ...(index === 0 ? { binding: { requiredForRecovery: true } } : {}),
  });
}

function proposal(index, content = `deterministic memory topic-${index % 8}`) {
  return {
    memoryId: `soak-memory-${index}`,
    scope: "user",
    scopeId: "soak-user",
    category: "soak",
    content,
    provenance: { source: "soak-fixture", actor: "soak-user", observedAt: AT },
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

const profileName = option("--profile", "quick");
const profile = PROFILES[profileName];
if (!profile) throw new Error(`unknown soak profile ${profileName}`);
const outputPath = option("--output");
const rssLimitBytes = Number(option("--rss-growth-limit-bytes", 256 * 1024 * 1024));
let uuidSequence = 0;
const memoryPort = new InMemoryMemoryPort();
const purgePort = new InMemoryProjectionPurgePort("soak-projection");
const kernel = new ContextMemoryKernel({
  memoryPort,
  reconciliationPort: memoryPort,
  purgePorts: [purgePort],
  clock: () => Date.parse(AT),
  randomUUID: () => `soak-${++uuidSequence}`,
});

for (let index = 0; index < 32; index += 1) {
  await kernel.proposeMemory(proposal(index));
}
const secretMarker = "SOAK_PRIVATE_VALUE_MUST_NOT_SURVIVE";
const secret = await kernel.proposeMemory(proposal(999, secretMarker));
const deletion = await kernel.deleteMemory({
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
if (deletion.status !== "purged") throw new Error("soak privacy deletion did not converge");

const items = Array.from({ length: 8 }, (_, index) => contextItem(index));
const startedAt = Date.now();
const baselineRssBytes = process.memoryUsage.rss();
let maxRssBytes = baselineRssBytes;
let iterations = 0;
let casRaces = 0;
do {
  const recalled = await kernel.recallMemory({
    query: `topic-${iterations % 8}`,
    sink: "provider.local",
    scopeAdmissions: [{ scope: "user", scopeId: "soak-user" }],
    limit: 8,
    tokenBudget: 2_048,
  });
  if (recalled.results.length > 8) throw new Error("recall exceeded its configured limit");
  if (recalled.results.some(({ record }) => record.content === secretMarker)) {
    throw new Error("deleted content was recalled");
  }
  const plan = await kernel.planContext({
    modelWindowTokens: 2_048,
    reservedOutputTokens: 256,
    safetyMarginTokens: 128,
    recoveryReserveTokens: 128,
    items,
    sink: "provider.local",
    scopeAdmissions: [{ scope: "session", scopeId: "soak-session" }],
    policyVersion: "soak-policy-v1",
    modelProfile: "soak-model",
    sessionHead: "soak-head-1",
    memoryRevision: recalled.memoryRevision,
    now: AT,
  });
  if (!plan.selectedItemIds.includes("soak-item-0")) {
    throw new Error("protected recovery item was dropped");
  }
  if (iterations % 100 === 0) {
    const current = await memoryPort.read("soak-memory-0");
    const decisions = await Promise.allSettled([
      kernel.decideMemory({
        memoryId: current.memoryId,
        type: "reinforce",
        expectedRevision: current.revision,
        confidenceDelta: 0.01,
      }),
      kernel.decideMemory({
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
  maxRssBytes = Math.max(maxRssBytes, process.memoryUsage.rss());
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
  throw new Error(`RSS growth ${rssGrowthBytes} exceeded limit ${rssLimitBytes}`);
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
  schema: "chainlesschain.context-memory-soak-receipt/v1",
  schemaVersion: 1,
  candidateSha: fullCommitSha(),
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
  invariants: {
    protectedRecoveryState: true,
    boundedRecall: true,
    casSingleWinner: true,
    deletionConverged: true,
    deletedContentAbsent: true,
  },
  workloadDigest: canonicalDigest(
    { profile: profileName, configuration: profile, items },
    "chainlesschain.context-memory-soak-workload/v1",
  ),
};
receipt.digest = canonicalDigest(receipt, receipt.schema);
const output = `${JSON.stringify(receipt, null, 2)}\n`;
if (outputPath) writeFileSync(outputPath, output, "utf8");
else process.stdout.write(output);
