#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BACKGROUND_SESSION_BACKLOG_LIMITS } from "../src/lib/background-session-transport.js";
import { computeEventHash } from "../src/harness/transcript-integrity.js";
import {
  SESSION_RUNTIME_RELEASE_MARKER,
  SESSION_RUNTIME_RETENTION_LIMITS,
} from "../src/lib/session-runtime-retention.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../../..");
const CLI_ROOT = resolve(REPO_ROOT, "packages/cli");
const FRAGMENT_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment.v1";
const AGGREGATE_SCHEMA =
  "chainlesschain.session-runtime-retention-aggregate.v1";
const COMMITMENT_ID = "SESSION-RUNTIME";
const REQUIRED_PROFILE_VERSION = "session-runtime/retention-v1";
const ADVISORY_PROFILE_VERSION = "session-runtime/retention-smoke-v1";
const LOCAL_PROFILE_VERSION = "session-runtime/retention-advisory-v1";
const SESSION_SCALE_SCHEMA = "cc-cli-session-scale-result/v1";
const REQUIRED_OPERATING_SYSTEMS = Object.freeze(["linux", "macos", "windows"]);
const REQUIRED_RESULTS = 5_000;
const REQUIRED_RESULT_BYTES = 32 * 1024;
const ADVISORY_RESULTS = 160;
const ADVISORY_RESULT_BYTES = 4 * 1024;
const MAX_HEAP_DELTA_BYTES = 128 * 1024 * 1024;
const MAX_GC_SAMPLE_DIFFERENCE_RATIO = 0.1;
const SCAN_CHUNK_BYTES = 64 * 1024;
const REQUIRED_NODE_VERSION = "v22.12.0";
const SESSION_SCALE_PROFILE_MINIMUMS = Object.freeze({
  formal: Object.freeze({
    writers: 20,
    eventsPerWriter: 1_000,
    sessionCount: 10_000,
    transcriptBytes: 1024 ** 3,
    listSamples: 25,
    resumeSamples: 15,
    coldResumeSamples: 15,
    actualKillCases: 6,
  }),
  smoke: Object.freeze({
    writers: 3,
    eventsPerWriter: 25,
    sessionCount: 250,
    transcriptBytes: 64 * 1024 ** 2,
    listSamples: 5,
    resumeSamples: 5,
    coldResumeSamples: 3,
    actualKillCases: 2,
  }),
});
const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const GITHUB_WORKFLOW_REF_RE =
  /^[^\s]+\/\.github\/workflows\/[^@\s]+\.ya?ml@(?:refs\/[^\s]+|[a-f0-9]{40})$/u;
const CORE_TEST_IDS = Object.freeze([
  "SESSION-RUNTIME/HEAP-PLATEAU",
  "SESSION-RUNTIME/PRODUCT-AGENT-LOOP-RETENTION",
  "SESSION-RUNTIME/PRODUCT-JSONL-DURABLE-RESUME",
  "SESSION-RUNTIME/DURABLE-EVIDENCE-READBACK",
  "SESSION-RUNTIME/INCREMENTAL-TRANSCRIPT-SCAN",
  "SESSION-RUNTIME/BACKLOG-CAPS",
  "SESSION-RUNTIME/COMPACTION-RESUME-SEMANTICS",
]);
const SESSION_SCALE_TEST_ID = "SESSION-RUNTIME/SESSION-SCALE-LIST-RESUME";
const TEST_IDS = Object.freeze([...CORE_TEST_IDS, SESSION_SCALE_TEST_ID]);
const LOCAL_TEST_IDS = CORE_TEST_IDS;
const CONTRACT_TESTS = Object.freeze([
  "__tests__/unit/file-lines.test.js",
  "__tests__/unit/session-runtime-retention.test.js",
  "__tests__/unit/session-runtime-retention-evidence.test.js",
  "__tests__/unit/background-session-transport.test.js",
  "__tests__/unit/background-session-command.test.js",
  "__tests__/unit/agent-core-compact-persist.test.js",
]);
const PRODUCERS = Object.freeze([
  "package.json",
  "package-lock.json",
  ".github/actions/setup-node-deps/action.yml",
  ".github/workflows/cli-session-scale.yml",
  ".github/workflows/cli-reliability-soak.yml",
  ".github/workflows/ide-roadmap-accessibility-performance.yml",
  "packages/cli/scripts/session-scale-gate.mjs",
  "packages/cli/scripts/verify-session-runtime-retention.mjs",
  "packages/cli/src/harness/jsonl-session-store.js",
  "packages/cli/src/harness/session-list-index.js",
  "packages/cli/src/harness/transcript-integrity.js",
  "packages/cli/src/lib/file-lines.js",
  "packages/cli/src/lib/session-message-provenance.js",
  "packages/cli/src/lib/session-runtime-retention.js",
  "packages/cli/src/lib/background-session-transport.js",
  "packages/cli/src/commands/background-session.js",
  "packages/cli/src/runtime/agent-core.js",
  "packages/cli/__tests__/unit/session-runtime-retention.test.js",
  "packages/cli/__tests__/unit/file-lines.test.js",
  "packages/cli/__tests__/unit/session-runtime-retention-evidence.test.js",
  "packages/cli/__tests__/unit/background-session-transport.test.js",
  "packages/cli/__tests__/unit/background-session-command.test.js",
  "packages/cli/__tests__/unit/agent-core-compact-persist.test.js",
  "packages/cli/__tests__/unit/session-scale-gate.test.js",
]);

const REQUIRED_THRESHOLDS = Object.freeze({
  resultCountMinimum: REQUIRED_RESULTS,
  resultBytesMinimum: REQUIRED_RESULT_BYTES,
  recentResultsMaximum: SESSION_RUNTIME_RETENTION_LIMITS.recentResults,
  retainedResultCharsMaximum:
    SESSION_RUNTIME_RETENTION_LIMITS.retainedResultChars,
  heapDeltaBytesMaximum: MAX_HEAP_DELTA_BYTES,
  gcSampleDifferenceRatioMaximum: MAX_GC_SAMPLE_DIFFERENCE_RATIO,
  transcriptScanChunkBytesMaximum: SCAN_CHUNK_BYTES,
  backgroundBacklogMessagesMaximum: BACKGROUND_SESSION_BACKLOG_LIMITS.messages,
  backgroundBacklogBytesMaximum: BACKGROUND_SESSION_BACKLOG_LIMITS.bytes,
  productRuntimeRetentionEventsMinimum: 1,
  productRuntimeDegradedEventsMaximum: 0,
  durableEvidenceRecordLossMaximum: 0,
  sessionListP95MsExclusive: 200,
  sessionListPeakRssMbExclusive: 100,
  sessionResumeP95MsExclusive: 2_000,
  sessionResumePeakRssMbExclusive: 100,
  sessionResumeIoBytesMaximum: 1_048_576,
});

const ADVISORY_THRESHOLDS = Object.freeze({
  ...REQUIRED_THRESHOLDS,
  resultCountMinimum: ADVISORY_RESULTS,
  resultBytesMinimum: ADVISORY_RESULT_BYTES,
});

function parseArgs(argv, env = process.env) {
  const configuredMode = String(env.CC_SESSION_RUNTIME_MODE || "local")
    .trim()
    .toLowerCase();
  if (!new Set(["formal", "smoke", "local"]).has(configuredMode)) {
    throw new Error("CC_SESSION_RUNTIME_MODE must be formal, smoke, or local");
  }
  const parsed = {
    mode: configuredMode,
    allowDirty: false,
    allowAdvisory: false,
    output: env.CC_SESSION_RUNTIME_OUTPUT,
    releaseCommit: env.CC_SESSION_RUNTIME_EXPECTED_SHA,
    sessionScaleEvidence: env.CC_SESSION_SCALE_EVIDENCE,
    evidenceDir: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--formal") parsed.mode = "formal";
    else if (argument === "--smoke") parsed.mode = "smoke";
    else if (argument === "--allow-dirty") parsed.allowDirty = true;
    else if (argument === "--allow-advisory") parsed.allowAdvisory = true;
    else if (argument === "--output") parsed.output = argv[++index];
    else if (argument === "--release-commit") {
      parsed.releaseCommit = argv[++index];
    } else if (argument === "--session-scale-evidence") {
      parsed.sessionScaleEvidence = argv[++index];
    } else if (argument === "--verify-evidence-dir") {
      parsed.evidenceDir = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (parsed.mode === "formal" && parsed.allowDirty) {
    throw new Error(
      "formal SESSION-RUNTIME evidence cannot allow dirty sources",
    );
  }
  return parsed;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 128 * 1024 * 1024,
  }).trim();
}

function normalizeHeadSha(value, scope = "head SHA") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  assert.match(normalized, SHA_RE, `${scope} must be a full lowercase SHA`);
  return normalized;
}

function operatingSystem(platform = process.platform) {
  if (platform === "win32" || platform === "windows") return "windows";
  if (platform === "darwin" || platform === "macos") return "macos";
  if (platform === "linux") return "linux";
  throw new Error(`unsupported operating system: ${platform}`);
}

function readProducerAtHead(headSha, repoPath) {
  return execFileSync("git", ["show", `${headSha}:${repoPath}`], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 128 * 1024 * 1024,
  });
}

function exactHeadProducerDigests(headSha, allowMismatch) {
  const producerDigests = {};
  let exact = true;
  for (const repoPath of PRODUCERS) {
    const disk = readFileSync(resolve(REPO_ROOT, repoPath));
    const diskDigest = sha256(disk);
    let headDigest = null;
    try {
      headDigest = sha256(readProducerAtHead(headSha, repoPath));
    } catch (error) {
      exact = false;
      if (!allowMismatch) {
        throw new Error(`${repoPath} is absent from exact head ${headSha}`, {
          cause: error,
        });
      }
    }
    if (headDigest !== diskDigest) {
      exact = false;
      if (!allowMismatch) {
        throw new Error(`${repoPath} does not match exact head ${headSha}`);
      }
    }
    producerDigests[repoPath] = diskDigest;
  }
  return { producerDigests, exact };
}

const ARTIFACT_RUNNER_BY_OS = Object.freeze({
  linux: "ubuntu-latest",
  macos: "macos-latest",
  windows: "windows-latest",
});

function sourceFromEnvironment(
  env = process.env,
  { required = false, headSha = null, os = operatingSystem() } = {},
) {
  if (required) {
    assert.equal(env.GITHUB_ACTIONS, "true");
    assert.equal(
      normalizeHeadSha(env.GITHUB_WORKFLOW_SHA, "GitHub workflow SHA"),
      headSha,
      "formal workflow bytes must come from the exact tested head",
    );
    assert.ok(env.CC_SESSION_RUNTIME_ARTIFACT_NAME);
  }
  const source = {
    workflowId: env.GITHUB_WORKFLOW_REF || "local",
    runId: env.GITHUB_RUN_ID || "local",
    jobId: env.GITHUB_JOB || "local",
    artifactName:
      env.CC_SESSION_RUNTIME_ARTIFACT_NAME || "session-runtime-retention.json",
  };
  if (required) validateRequiredSource(source, { headSha, os });
  return source;
}

function validateRequiredSource(source, { headSha = null, os = null } = {}) {
  assert.match(source.workflowId, GITHUB_WORKFLOW_REF_RE);
  assert.match(
    source.workflowId,
    /\/\.github\/workflows\/cli-session-scale\.yml@/u,
  );
  assert.match(source.runId, /^[1-9][0-9]{0,31}$/u);
  assert.match(source.jobId, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u);
  assert.equal(source.jobId, "session-scale");
  assert.ok(
    source.artifactName.length > 0 && source.artifactName.length <= 255,
  );
  assert.equal(/[\\/]/u.test(source.artifactName), false);
  for (const value of Object.values(source)) assert.notEqual(value, "local");
  if (headSha && os) {
    const runner = ARTIFACT_RUNNER_BY_OS[os];
    assert.ok(runner, `unsupported source operating system: ${os}`);
    assert.match(
      source.artifactName,
      new RegExp(`^cli-session-scale-${runner}-${headSha}-[1-9][0-9]*$`, "u"),
    );
  }
}

function resultBody(index, bytes) {
  const resultId = String(index).padStart(5, "0");
  const prefix =
    `[Background sub-agent "runtime-retention-${resultId}"] completed: ` +
    `subagent-result-${resultId}:`;
  return prefix.padEnd(bytes, String(index % 10));
}

async function stabilizedHeapSample() {
  for (let index = 0; index < 3; index += 1) {
    global.gc();
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
  }
  return {
    heapBytes: process.memoryUsage().heapUsed,
    rssBytes: process.memoryUsage().rss,
  };
}

function runContractTests() {
  const startedAt = Date.now();
  const vitestCandidates = [
    join(CLI_ROOT, "node_modules", "vitest", "vitest.mjs"),
    join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs"),
  ];
  const vitestEntry = vitestCandidates.find((candidate) =>
    existsSync(candidate),
  );
  assert.ok(
    vitestEntry,
    `vitest entrypoint is missing; checked: ${vitestCandidates.join(", ")}`,
  );
  execFileSync(
    process.execPath,
    [relative(CLI_ROOT, vitestEntry), "run", ...CONTRACT_TESTS],
    {
      cwd: CLI_ROOT,
      stdio: "inherit",
      env: { ...process.env, NO_COLOR: "1" },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return {
    status: "passed",
    files: [...CONTRACT_TESTS],
    durationMs: Date.now() - startedAt,
  };
}

function writeAllSync(fileDescriptor, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const written = writeSync(
      fileDescriptor,
      buffer,
      offset,
      buffer.length - offset,
    );
    if (written <= 0) throw new Error("SESSION-RUNTIME fixture short write");
    offset += written;
  }
}

/**
 * Seed the large immutable prefix in one linear pass, then make the real
 * product repair path prove the complete chain and publish its rebuildable
 * metadata + anti-rollback authorities. Calling appendUserMessage 5,000 times
 * is intentionally avoided: each public append proves the prior external
 * anchor prefix, which would turn this fixed evidence fixture into O(N^2) IO.
 * The measured retention settlement itself still uses the normal product
 * agentLoop and compare-and-append persistence path below.
 */
function seedProductTranscript(store, sessionId, resultCount, resultBytes) {
  const filePath = store.sessionPath(sessionId);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const expectedRawDigest = createHash("sha256");
  const startedAt = performance.now();
  let previousHash = null;
  let eventCount = 0;
  let transcriptBytes = 0;
  const fd = openSync(filePath, "wx", 0o600);
  const appendFixtureEvent = (type, timestamp, data) => {
    const core = { type, timestamp, data };
    const hash = computeEventHash(previousHash, core);
    const line = Buffer.from(
      `${JSON.stringify({ ...core, prevHash: previousHash, hash })}\n`,
      "utf8",
    );
    assert.ok(line.length <= store.CANONICAL_JSONL_RECORD_MAX_BYTES);
    writeAllSync(fd, line);
    previousHash = hash;
    eventCount += 1;
    transcriptBytes += line.length;
  };
  try {
    appendFixtureEvent("session_start", 1, {
      title: "SESSION-RUNTIME retention probe",
      provider: "session-runtime-evidence",
      model: "fixture",
    });
    for (let index = 0; index < resultCount; index += 1) {
      const result = resultBody(index, resultBytes);
      appendFixtureEvent("user_message", index + 2, {
        role: "user",
        content: result,
      });
      expectedRawDigest.update(`${index}\0${result}\n`, "utf8");
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const buildDurationMs = performance.now() - startedAt;
  assert.equal(statSync(filePath).size, transcriptBytes);

  const repairStartedAt = performance.now();
  const repair = store.repairSession(sessionId);
  const repairDurationMs = performance.now() - repairStartedAt;
  assert.equal(repair.healthy, true);
  assert.equal(repair.status, "verified");
  assert.equal(repair.indexRebuilt, true);
  assert.equal(repair.authorityAnchored, true);
  const verification = store.verifySession(sessionId);
  assert.equal(verification.status, "verified");
  assert.equal(verification.chainedEvents, eventCount);
  assert.equal(verification.lastHash, previousHash);

  return {
    seedMethod:
      "linear-canonical-jsonl-with-production-hasher-and-repair-authority",
    buildDurationMs,
    repairDurationMs,
    eventCount,
    transcriptBytes,
    headHash: previousHash,
    expectedEvidenceDigest: `sha256:${expectedRawDigest.digest("hex")}`,
  };
}

function readProductDurableProjection(
  store,
  sessionId,
  { references = null, projectedMessages = null, resultBytes = null } = {},
) {
  const ioMetrics = {};
  return store.readVerifiedProjection(
    sessionId,
    () => {
      const rawDigest = createHash("sha256");
      let resultCount = 0;
      let referenceMismatches = 0;
      let compactEvents = 0;
      let latestCompact = null;
      return {
        accept(event) {
          if (
            event?.type === "user_message" &&
            typeof event.data?.content === "string" &&
            event.data.content.startsWith('[Background sub-agent "')
          ) {
            const content = event.data.content;
            rawDigest.update(`${resultCount}\0${content}\n`, "utf8");
            if (references && resultCount < references.length) {
              const reference = references[resultCount];
              const projected = projectedMessages?.[resultCount]?.content;
              if (
                reference?.messageIndex !== resultCount ||
                reference?.digest !== sha256(Buffer.from(content, "utf8")) ||
                reference?.originalChars !== resultBytes ||
                reference?.retainedChars !== projected?.length ||
                !projected?.includes(reference.digest)
              ) {
                referenceMismatches += 1;
              }
            }
            resultCount += 1;
          }
          if (
            event?.type === "compact" &&
            event.data?.trigger === "runtime-retention"
          ) {
            compactEvents += 1;
            latestCompact = {
              trigger: event.data.trigger,
              strategy: event.data.strategy,
              messageCount: Array.isArray(event.data.messages)
                ? event.data.messages.length
                : -1,
              durableReferenceCount: Array.isArray(event.data.durableReferences)
                ? event.data.durableReferences.length
                : -1,
              durableReferenceDigest: sha256(
                Buffer.from(stableJson(event.data.durableReferences || [])),
              ),
              digest: sha256(Buffer.from(stableJson(event))),
              bytes: Buffer.byteLength(JSON.stringify(event), "utf8") + 1,
            };
          }
        },
        finish(authority) {
          return {
            resultCount,
            digest: `sha256:${rawDigest.digest("hex")}`,
            referenceMismatches,
            compactEvents,
            latestCompact,
            eventCount: authority.eventCount,
            headHash: authority.headHash,
            bytesRead: ioMetrics.bytesRead || 0,
            readCalls: ioMetrics.readCalls || 0,
            maxChunkBytes: ioMetrics.maxReadBytes || 0,
          };
        },
      };
    },
    { ioMetrics },
  );
}

function validateProjectedMessages(
  messages,
  resultCount,
  resultBytes,
  recentResults,
) {
  const projection = assertReleasedProjection(
    messages,
    resultCount,
    resultBytes,
    recentResults,
  );
  assert.equal(messages.length, resultCount);
  assert.equal(
    messages.every((message) => message.role === "user"),
    true,
  );
  return projection;
}

async function runProductStoreProbeInternal({
  resultCount,
  resultBytes,
  recentResults,
}) {
  if (typeof global.gc !== "function") {
    throw new Error("product store probe requires node --expose-gc");
  }
  const store = await import("../src/harness/jsonl-session-store.js");
  const { agentLoop } = await import("../src/runtime/agent-core.js");
  const sessionId = `session-runtime-${process.pid}-${Date.now()}`;
  const startedAt = performance.now();
  const fixture = seedProductTranscript(
    store,
    sessionId,
    resultCount,
    resultBytes,
  );
  const expectedEvidenceDigest = fixture.expectedEvidenceDigest;
  const durableBefore = readProductDurableProjection(store, sessionId);
  assert.equal(durableBefore.resultCount, resultCount);
  assert.equal(durableBefore.digest, expectedEvidenceDigest);
  assert.equal(durableBefore.compactEvents, 0);

  const baseline = await stabilizedHeapSample();
  const initialResumeIo = {};
  const initialResumeMessageIo = {};
  let liveMessages = [
    ...store.readVerifiedMessages(sessionId, {
      ioMetrics: initialResumeIo,
      messageIoMetrics: initialResumeMessageIo,
    }),
  ];
  assert.equal(liveMessages.length, resultCount);
  assert.equal(
    liveMessages.every(
      (message) =>
        message.role === "user" && message.content.length === resultBytes,
    ),
    true,
  );
  const allocated = {
    heapBytes: process.memoryUsage().heapUsed,
    rssBytes: process.memoryUsage().rss,
  };

  let retentionEvents = 0;
  let degradedEvents = 0;
  let retentionStats = null;

  const events = agentLoop(liveMessages, {
    autoCompact: false,
    sessionId,
    runtimeResultRetention: { recentResults },
    chatFn: async () => {
      throw new Error("product retention probe reached provider admission");
    },
  });

  for await (const event of events) {
    if (event.type === "session-runtime-retention-degraded") {
      degradedEvents += 1;
      throw new Error(`product runtime retention degraded: ${event.code}`);
    }
    if (event.type !== "session-runtime-retention") continue;
    retentionEvents += 1;
    retentionStats = event.stats;
    break;
  }

  if (retentionEvents !== 1) {
    throw new Error(
      `product runtime emitted ${retentionEvents} retention events`,
    );
  }
  assert.ok(retentionStats);
  const projection = validateProjectedMessages(
    liveMessages,
    resultCount,
    resultBytes,
    recentResults,
  );
  assert.equal(retentionStats.released, projection.releasedCount);
  assert.equal(
    retentionStats.durableReferences.length,
    projection.releasedCount,
  );

  const resumeIo = {};
  const resumeMessageIo = {};
  let resumedMessages = store.readVerifiedMessages(sessionId, {
    ioMetrics: resumeIo,
    messageIoMetrics: resumeMessageIo,
  });
  const resumedProjection = validateProjectedMessages(
    resumedMessages,
    resultCount,
    resultBytes,
    recentResults,
  );
  assert.deepEqual(resumedProjection, projection);
  assert.equal(
    resumedMessages.every(
      (message, index) =>
        message.role === liveMessages[index].role &&
        message.content === liveMessages[index].content,
    ),
    true,
  );
  const resumeProjectionDigest = sha256(
    Buffer.from(stableJson(resumedMessages)),
  );

  const durableAfter = readProductDurableProjection(store, sessionId, {
    references: retentionStats.durableReferences,
    projectedMessages: liveMessages,
    resultBytes,
  });
  assert.equal(durableAfter.resultCount, resultCount);
  assert.equal(durableAfter.digest, expectedEvidenceDigest);
  assert.equal(durableAfter.referenceMismatches, 0);
  assert.equal(durableAfter.compactEvents, 1);
  assert.equal(durableAfter.latestCompact?.trigger, "runtime-retention");
  assert.equal(
    durableAfter.latestCompact?.strategy,
    "session-runtime-retention",
  );
  assert.equal(durableAfter.latestCompact?.messageCount, resultCount);
  assert.equal(
    durableAfter.latestCompact?.durableReferenceCount,
    projection.releasedCount,
  );
  const durableReferenceDigest = sha256(
    Buffer.from(stableJson(retentionStats.durableReferences)),
  );
  assert.equal(
    durableAfter.latestCompact?.durableReferenceDigest,
    durableReferenceDigest,
  );
  assert.ok(
    durableAfter.latestCompact.bytes <= store.CANONICAL_JSONL_RECORD_MAX_BYTES,
  );
  assert.ok(
    (resumeMessageIo.bytesRead || 0) <=
      store.CANONICAL_JSONL_RECORD_MAX_BYTES + SCAN_CHUNK_BYTES,
  );

  const productRuntime = {
    surface: "packages/cli/src/runtime/agent-core.js#agentLoop",
    persistenceSurface:
      "packages/cli/src/harness/jsonl-session-store.js#appendCompactEventIfMessagesMatch/readVerifiedMessages",
    durationMs: performance.now() - startedAt,
    fixtureSeedMethod: fixture.seedMethod,
    fixtureBuildDurationMs: fixture.buildDurationMs,
    fixtureRepairDurationMs: fixture.repairDurationMs,
    fixtureEventCount: fixture.eventCount,
    fixtureTranscriptBytes: fixture.transcriptBytes,
    fixtureHeadHash: fixture.headHash,
    retentionEvents,
    degradedEvents,
    settlementCalls: durableAfter.compactEvents,
    settlementTrigger: durableAfter.latestCompact.trigger,
    projectedMessageCount: liveMessages.length,
    durableReferenceCount: retentionStats.durableReferences.length,
    durableReferenceMismatches: durableAfter.referenceMismatches,
    durableReferenceDigest,
    checkpointDigest: durableAfter.latestCompact.digest,
    checkpointBytes: durableAfter.latestCompact.bytes,
    checkpointMessageCount: durableAfter.latestCompact.messageCount,
    checkpointDurableReferenceCount:
      durableAfter.latestCompact.durableReferenceCount,
    releasedResults: retentionStats.released,
    savedChars: retentionStats.savedChars,
    resumeProjectionDigest,
    initialResumeForwardBytesRead: initialResumeIo.bytesRead || 0,
    initialResumeMessageBytesRead: initialResumeMessageIo.bytesRead || 0,
    resumeForwardBytesRead: resumeIo.bytesRead || 0,
    resumeMessageBytesRead: resumeMessageIo.bytesRead || 0,
  };
  retentionStats = null;
  resumedMessages = null;
  const firstGc = await stabilizedHeapSample();
  const secondGc = await stabilizedHeapSample();
  return {
    baseline,
    allocated,
    firstGc,
    secondGc,
    projection,
    productRuntime,
    durable: {
      count: durableAfter.resultCount,
      sha256: durableAfter.digest,
      recordLoss: resultCount - durableAfter.resultCount,
      maxChunkBytes: durableAfter.maxChunkBytes,
      transcriptBytes: statSync(store.sessionPath(sessionId)).size,
      eventCount: durableAfter.eventCount,
      headHash: durableAfter.headHash,
      forwardBytesRead: durableAfter.bytesRead,
      forwardReadCalls: durableAfter.readCalls,
    },
    canonicalRecordBytesMaximum: store.CANONICAL_JSONL_RECORD_MAX_BYTES,
  };
}

function runProductStoreProbe(options, profileRoot) {
  const output = join(profileRoot, "product-store-probe.json");
  const productHome = join(profileRoot, "product-home");
  const securityAnchorHome = join(profileRoot, "security-anchors");
  execFileSync(process.execPath, ["--expose-gc", SCRIPT_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CHAINLESSCHAIN_HOME: productHome,
      CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: securityAnchorHome,
      CC_SESSION_RUNTIME_INTERNAL_PROBE: "1",
      CC_SESSION_RUNTIME_INTERNAL_OUTPUT: output,
      CC_SESSION_RUNTIME_INTERNAL_RESULT_COUNT: String(options.resultCount),
      CC_SESSION_RUNTIME_INTERNAL_RESULT_BYTES: String(options.resultBytes),
      CC_SESSION_RUNTIME_INTERNAL_RECENT_RESULTS: String(options.recentResults),
    },
    stdio: ["ignore", "inherit", "inherit"],
    maxBuffer: 32 * 1024 * 1024,
    timeout:
      options.resultCount >= REQUIRED_RESULTS
        ? 120 * 60 * 1_000
        : 15 * 60 * 1_000,
    windowsHide: true,
  });
  return JSON.parse(readFileSync(output, "utf8"));
}

function validateSessionScaleResult(
  value,
  expectedHeadSha,
  required,
  allowDirty = false,
  { os = null, runtime = null } = {},
) {
  assert.equal(value.schema, SESSION_SCALE_SCHEMA);
  assert.equal(value.status, "passed");
  assert.equal(value.exactSha, expectedHeadSha);
  assert.equal(value.expectedSha, expectedHeadSha);
  if (!allowDirty) {
    assert.equal(value.trackedWorktreeDirty, false);
    assert.equal(value.gateSourcePathsExact, true);
  }
  assert.equal(value.parameters?.mode, required ? "formal" : "smoke");
  if (os) {
    assert.equal(
      value.platform,
      { linux: "linux", macos: "darwin", windows: "win32" }[os],
    );
  }
  if (runtime) {
    assert.equal(value.node, runtime.version);
    assert.equal(value.arch, runtime.arch);
  }
  if (required) assert.equal(value.node, REQUIRED_NODE_VERSION);
  const scaleMinimums =
    SESSION_SCALE_PROFILE_MINIMUMS[required ? "formal" : "smoke"];
  for (const [field, minimum] of Object.entries(scaleMinimums)) {
    assert.ok(
      Number.isSafeInteger(value.parameters?.[field]) &&
        value.parameters[field] >= minimum,
      `session-scale ${field} is below the locked ${required ? "formal" : "smoke"} profile`,
    );
  }
  if (required) assert.equal(value.parameters.exhaustiveCuts, true);
  else assert.equal(typeof value.parameters.exhaustiveCuts, "boolean");
  assert.deepEqual(value.parameters?.thresholds, {
    profile: "uniform-v1",
    listP95Ms: 200,
    listRssMb: 100,
    resumeP95Ms: 2_000,
    resumeRssMb: 100,
    resumeMaxIoBytes: 1_048_576,
  });
  for (const scenario of [
    "concurrentAppend",
    "indexedList",
    "checkpointResume",
    "crashRepair",
  ]) {
    assert.equal(value.scenarios?.[scenario]?.pass, true, scenario);
  }
  const list = value.scenarios.indexedList;
  const resume = value.scenarios.checkpointResume;
  const concurrent = value.scenarios.concurrentAppend;
  const crash = value.scenarios.crashRepair;
  const expectedProbeEvents =
    value.parameters.writers * value.parameters.eventsPerWriter;
  assert.deepEqual(concurrent.parameters, {
    writers: value.parameters.writers,
    eventsPerWriter: value.parameters.eventsPerWriter,
  });
  assert.equal(concurrent.expectedProbeEvents, expectedProbeEvents);
  assert.equal(concurrent.observedProbeEvents, expectedProbeEvents);
  assert.equal(concurrent.uniqueProbeEvents, expectedProbeEvents);
  assert.equal(concurrent.chainedEvents, expectedProbeEvents + 1);
  assert.equal(concurrent.chainStatus, "verified");
  assert.ok(list.fixture?.sessionCount >= value.parameters.sessionCount);
  assert.ok(list.fixture?.sidecarEntries >= value.parameters.sessionCount);
  assert.ok(list.samples?.length >= value.parameters.listSamples);
  assert.ok(resume.fixture?.logicalBytes >= value.parameters.transcriptBytes);
  assert.equal(resume.fixture?.fullChainStatus, "verified");
  assert.equal(resume.fixture?.productionSidecarAnchored, true);
  assert.ok(resume.samples?.length >= value.parameters.resumeSamples);
  assert.ok(
    resume.coldProcess?.samples?.length >= value.parameters.coldResumeSamples,
  );
  assert.ok(
    resume.coldProcess?.sampleCount >= value.parameters.coldResumeSamples,
  );
  assert.ok(
    crash.partialRecordProcessKills?.length >= value.parameters.actualKillCases,
  );
  assert.ok(
    crash.partialRecordProcessKills
      .slice(0, value.parameters.actualKillCases)
      .every((item) => item?.pass === true && item?.killConfirmed === true),
  );
  assert.ok(crash.actualProcessKillsTotal >= value.parameters.actualKillCases);
  assert.equal(
    crash.byteCutCoverage?.exhaustive,
    value.parameters.exhaustiveCuts,
  );
  assert.ok(list.p95Ms >= 0 && list.p95Ms < 200);
  assert.ok(list.peakRssMb >= 0 && list.peakRssMb < 100);
  assert.ok(resume.p95Ms >= 0 && resume.p95Ms < 2_000);
  assert.ok(resume.peakRssMb >= 0 && resume.peakRssMb < 100);
  assert.ok(resume.maxIoBytesRead >= 0 && resume.maxIoBytesRead <= 1_048_576);
  assert.ok(resume.coldProcess?.p95Ms >= 0 && resume.coldProcess.p95Ms < 2_000);
  assert.ok(
    resume.coldProcess?.peakRssMb >= 0 && resume.coldProcess.peakRssMb < 100,
  );
  return {
    available: true,
    mode: value.parameters.mode,
    platform: value.platform,
    node: value.node,
    arch: value.arch,
    listP95Ms: list.p95Ms,
    listPeakRssMb: list.peakRssMb,
    resumeP95Ms: resume.p95Ms,
    resumePeakRssMb: resume.peakRssMb,
    resumeMaxIoBytesRead: resume.maxIoBytesRead,
    coldResumeP95Ms: resume.coldProcess.p95Ms,
    coldResumePeakRssMb: resume.coldProcess.peakRssMb,
  };
}

function readSessionScaleEvidence(
  filePath,
  headSha,
  mode,
  allowDirty,
  runtime,
) {
  if (!filePath) {
    if (mode !== "local") {
      throw new Error(`${mode} retention requires session-scale evidence`);
    }
    return { available: false, reason: "session-scale-evidence-not-provided" };
  }
  const resolved = resolve(filePath);
  const bytes = readFileSync(resolved);
  return {
    ...validateSessionScaleResult(
      JSON.parse(bytes.toString("utf8")),
      headSha,
      mode === "formal",
      allowDirty,
      { os: operatingSystem(), runtime },
    ),
    evidenceDigest: sha256(bytes),
    evidenceFile: basename(resolved),
  };
}

function assertReleasedProjection(
  messages,
  resultCount,
  resultBytes,
  recentResults,
) {
  const releasedCount = resultCount - recentResults;
  let projectionViolations = 0;
  let digestMismatches = 0;
  let maxOldProjectionChars = 0;
  for (let index = 0; index < releasedCount; index += 1) {
    const content = messages[index]?.content || "";
    maxOldProjectionChars = Math.max(maxOldProjectionChars, content.length);
    if (
      content.length > SESSION_RUNTIME_RETENTION_LIMITS.retainedResultChars ||
      !content.includes(SESSION_RUNTIME_RELEASE_MARKER)
    ) {
      projectionViolations += 1;
    }
    const expectedDigest = sha256(resultBody(index, resultBytes));
    if (!content.includes(expectedDigest)) digestMismatches += 1;
  }
  const recentMessages = messages.slice(releasedCount);
  const recentWindowViolations = recentMessages.filter(
    (message) => message.content.length !== resultBytes,
  ).length;
  assert.equal(projectionViolations, 0);
  assert.equal(digestMismatches, 0);
  assert.equal(recentWindowViolations, 0);
  return {
    releasedCount,
    retainedFullResults: recentMessages.length,
    projectionViolations,
    digestMismatches,
    recentWindowViolations,
    maxOldProjectionChars,
  };
}

async function runProfile(options) {
  if (typeof global.gc !== "function") {
    throw new Error("SESSION-RUNTIME profile requires node --expose-gc");
  }
  const required = options.mode === "formal";
  const smoke = options.mode === "smoke";
  const resultCount = smoke ? ADVISORY_RESULTS : REQUIRED_RESULTS;
  const resultBytes = smoke ? ADVISORY_RESULT_BYTES : REQUIRED_RESULT_BYTES;
  const recentResults = SESSION_RUNTIME_RETENTION_LIMITS.recentResults;
  const thresholds = smoke ? ADVISORY_THRESHOLDS : REQUIRED_THRESHOLDS;
  const headSha = normalizeHeadSha(git("rev-parse", "HEAD"), "git HEAD");
  const expectedHead = options.releaseCommit
    ? normalizeHeadSha(options.releaseCommit, "expected head SHA")
    : null;
  if (required && !expectedHead) {
    throw new Error("formal SESSION-RUNTIME evidence requires an expected SHA");
  }
  if (expectedHead && expectedHead !== headSha) {
    throw new Error(`expected head ${expectedHead}, got ${headSha}`);
  }
  if (required && process.version !== REQUIRED_NODE_VERSION) {
    throw new Error(
      `formal SESSION-RUNTIME evidence requires Node ${REQUIRED_NODE_VERSION}`,
    );
  }
  const source = sourceFromEnvironment(process.env, {
    required,
    headSha,
    os: operatingSystem(),
  });
  const producerStateBefore = exactHeadProducerDigests(
    headSha,
    options.allowDirty,
  );
  if (required && !producerStateBefore.exact) {
    throw new Error(
      "formal SESSION-RUNTIME producers are not exact-head sources",
    );
  }
  const sessionScale = readSessionScaleEvidence(
    options.sessionScaleEvidence,
    headSha,
    options.mode,
    options.allowDirty,
    { version: process.version, arch: process.arch },
  );
  const contractTests = runContractTests();
  const profileRoot = mkdtempSync(join(tmpdir(), "cc-session-runtime-"));
  try {
    const productProbe = runProductStoreProbe(
      {
        resultCount,
        resultBytes,
        recentResults,
      },
      profileRoot,
    );
    const {
      baseline,
      allocated,
      firstGc,
      secondGc,
      projection,
      productRuntime,
      durable,
      canonicalRecordBytesMaximum,
    } = productProbe;
    assert.equal(productRuntime.releasedResults, projection.releasedCount);
    assert.equal(
      productRuntime.durableReferenceCount,
      projection.releasedCount,
    );
    assert.equal(productRuntime.projectedMessageCount, resultCount);
    assert.equal(productRuntime.settlementCalls, 1);
    assert.equal(productRuntime.settlementTrigger, "runtime-retention");
    assert.equal(productRuntime.degradedEvents, 0);
    assert.equal(productRuntime.durableReferenceMismatches, 0);
    assert.equal(
      productRuntime.checkpointMessageCount,
      productRuntime.projectedMessageCount,
    );
    assert.equal(
      productRuntime.checkpointDurableReferenceCount,
      productRuntime.durableReferenceCount,
    );
    assert.ok(productRuntime.checkpointBytes <= canonicalRecordBytesMaximum);
    assert.ok(
      productRuntime.resumeMessageBytesRead <=
        canonicalRecordBytesMaximum + SCAN_CHUNK_BYTES,
    );

    const heapDeltaBytes = Math.max(
      0,
      Math.max(firstGc.heapBytes, secondGc.heapBytes) - baseline.heapBytes,
    );
    const gcSampleDifferenceRatio =
      Math.abs(firstGc.heapBytes - secondGc.heapBytes) /
      Math.max(firstGc.heapBytes, secondGc.heapBytes, 1);
    assert.ok(
      gcSampleDifferenceRatio <= thresholds.gcSampleDifferenceRatioMaximum,
      `stabilized GC difference ${(gcSampleDifferenceRatio * 100).toFixed(2)}% exceeds 10%`,
    );
    assert.ok(
      heapDeltaBytes <= thresholds.heapDeltaBytesMaximum,
      `heap delta ${heapDeltaBytes} exceeds 128 MiB`,
    );
    assert.equal(durable.count, resultCount);
    assert.equal(durable.recordLoss, 0);
    assert.match(durable.sha256, DIGEST_RE);
    assert.ok(
      durable.maxChunkBytes <= thresholds.transcriptScanChunkBytesMaximum,
    );

    // Rehash after contract tests, dynamic product imports, persistence, and
    // measurement. Any producer mutation during the run is a hard TOCTOU
    // failure even for advisory/dirty development probes.
    const producerState = exactHeadProducerDigests(headSha, options.allowDirty);
    assert.deepEqual(
      producerState.producerDigests,
      producerStateBefore.producerDigests,
      "SESSION-RUNTIME producer bytes changed during measurement",
    );
    assert.equal(
      producerState.exact,
      producerStateBefore.exact,
      "SESSION-RUNTIME exact-head producer state changed during measurement",
    );
    if (required && !producerState.exact) {
      throw new Error(
        "formal SESSION-RUNTIME producers are not exact-head sources",
      );
    }

    return {
      schema: FRAGMENT_SCHEMA,
      commitmentId: COMMITMENT_ID,
      headSha,
      os: operatingSystem(),
      runtime: {
        name: "node",
        version: process.version,
        arch: process.arch,
      },
      profileVersion: required
        ? REQUIRED_PROFILE_VERSION
        : smoke
          ? ADVISORY_PROFILE_VERSION
          : LOCAL_PROFILE_VERSION,
      thresholds,
      measurements: {
        mode: options.mode,
        exactHeadSources: producerState.exact,
        resultCount,
        resultBytes,
        recentResults,
        releasedResults: projection.releasedCount,
        retainedFullResults: projection.retainedFullResults,
        maxOldProjectionChars: projection.maxOldProjectionChars,
        oldProjectionViolations: projection.projectionViolations,
        projectionDigestMismatches: projection.digestMismatches,
        recentWindowViolations: projection.recentWindowViolations,
        baselineHeapBytes: baseline.heapBytes,
        allocatedHeapBytes: allocated.heapBytes,
        firstGcHeapBytes: firstGc.heapBytes,
        secondGcHeapBytes: secondGc.heapBytes,
        heapDeltaBytes,
        gcSampleDifferenceRatio,
        baselineRssBytes: baseline.rssBytes,
        allocatedRssBytes: allocated.rssBytes,
        firstGcRssBytes: firstGc.rssBytes,
        secondGcRssBytes: secondGc.rssBytes,
        durableEvidenceRecords: durable.count,
        durableEvidenceRecordLoss: durable.recordLoss,
        durableEvidenceSha256: durable.sha256,
        maxTranscriptScanChunkBytes: durable.maxChunkBytes,
        durableTranscriptBytes: durable.transcriptBytes,
        durableTranscriptEventCount: durable.eventCount,
        durableTranscriptHeadHash: durable.headHash,
        durableTranscriptForwardBytesRead: durable.forwardBytesRead,
        durableTranscriptForwardReadCalls: durable.forwardReadCalls,
        canonicalRecordBytesMaximum,
        productRuntime,
        backlog: {
          maxMessages: BACKGROUND_SESSION_BACKLOG_LIMITS.messages,
          maxBytes: BACKGROUND_SESSION_BACKLOG_LIMITS.bytes,
        },
        sessionScale,
        contractTests,
      },
      testIds: [...(options.mode === "local" ? LOCAL_TEST_IDS : TEST_IDS)],
      producerDigests: producerState.producerDigests,
      disposition: required ? "required" : "advisory",
      source,
      outcome: "passed",
    };
  } finally {
    rmSync(profileRoot, { recursive: true, force: true });
  }
}

function writeJsonAtomic(filePath, value) {
  const resolved = resolve(filePath);
  mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, resolved);
}

function discoverJsonFiles(directory) {
  const root = resolve(directory);
  assert.equal(existsSync(root), true, "evidence directory must exist");
  assert.equal(lstatSync(root).isDirectory(), true);
  const pending = [root];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const candidate = join(current, entry.name);
      const stat = lstatSync(candidate);
      assert.equal(
        stat.isSymbolicLink(),
        false,
        "evidence cannot use symlinks",
      );
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(candidate);
      }
    }
  }
  return files;
}

function assertCanonicalKeys(fragment) {
  assert.deepEqual(Object.keys(fragment).sort(), [
    "commitmentId",
    "disposition",
    "headSha",
    "measurements",
    "os",
    "outcome",
    "producerDigests",
    "profileVersion",
    "runtime",
    "schema",
    "source",
    "testIds",
    "thresholds",
  ]);
  assert.deepEqual(Object.keys(fragment.runtime).sort(), [
    "arch",
    "name",
    "version",
  ]);
  assert.deepEqual(Object.keys(fragment.source).sort(), [
    "artifactName",
    "jobId",
    "runId",
    "workflowId",
  ]);
}

function validateFragment(
  fragment,
  { headSha, allowAdvisory, producerDigests, requireGitHubSource = true },
) {
  assertCanonicalKeys(fragment);
  assert.equal(fragment.schema, FRAGMENT_SCHEMA);
  assert.equal(fragment.commitmentId, COMMITMENT_ID);
  assert.equal(fragment.headSha, headSha);
  assert.ok(REQUIRED_OPERATING_SYSTEMS.includes(fragment.os));
  assert.equal(fragment.runtime?.name, "node");
  assert.match(fragment.runtime?.version || "", /^v\d+\.\d+\.\d+$/u);
  assert.ok(String(fragment.runtime?.arch || "").length > 0);
  assert.equal(fragment.outcome, "passed");
  const required = fragment.disposition === "required";
  const smoke = fragment.measurements?.mode === "smoke";
  assert.deepEqual(fragment.testIds, [
    ...(fragment.measurements?.mode === "local" ? LOCAL_TEST_IDS : TEST_IDS),
  ]);
  assert.deepEqual(fragment.producerDigests, producerDigests);
  if (requireGitHubSource) {
    validateRequiredSource(fragment.source, {
      headSha: fragment.headSha,
      os: fragment.os,
    });
  }

  if (!required) {
    assert.equal(allowAdvisory, true, "advisory evidence is non-qualifying");
    assert.equal(fragment.disposition, "advisory");
  }
  assert.equal(
    fragment.profileVersion,
    required
      ? REQUIRED_PROFILE_VERSION
      : smoke
        ? ADVISORY_PROFILE_VERSION
        : LOCAL_PROFILE_VERSION,
  );
  assert.deepEqual(
    fragment.thresholds,
    smoke ? ADVISORY_THRESHOLDS : REQUIRED_THRESHOLDS,
  );
  if (required) assert.equal(fragment.runtime.version, REQUIRED_NODE_VERSION);

  const thresholds = fragment.thresholds;
  const measurements = fragment.measurements;
  assert.equal(
    measurements.mode,
    required ? "formal" : smoke ? "smoke" : "local",
  );
  assert.equal(measurements.exactHeadSources, true);
  assert.ok(
    Number.isSafeInteger(measurements.resultCount) &&
      measurements.resultCount > 0,
  );
  assert.ok(
    Number.isSafeInteger(measurements.resultBytes) &&
      measurements.resultBytes > 0,
  );
  assert.ok(
    Number.isSafeInteger(measurements.recentResults) &&
      measurements.recentResults >= 0,
  );
  assert.ok(measurements.resultCount >= thresholds.resultCountMinimum);
  assert.ok(measurements.resultBytes >= thresholds.resultBytesMinimum);
  assert.ok(measurements.recentResults <= thresholds.recentResultsMaximum);
  assert.equal(
    measurements.releasedResults,
    measurements.resultCount - measurements.recentResults,
  );
  assert.equal(measurements.retainedFullResults, measurements.recentResults);
  assert.ok(
    measurements.maxOldProjectionChars <= thresholds.retainedResultCharsMaximum,
  );
  assert.equal(measurements.oldProjectionViolations, 0);
  assert.equal(measurements.projectionDigestMismatches, 0);
  assert.equal(measurements.recentWindowViolations, 0);
  assert.ok(measurements.maxOldProjectionChars >= 0);
  for (const field of [
    "baselineHeapBytes",
    "allocatedHeapBytes",
    "firstGcHeapBytes",
    "secondGcHeapBytes",
  ]) {
    assert.ok(
      Number.isSafeInteger(measurements[field]) && measurements[field] >= 0,
      `${field} must be a non-negative safe integer`,
    );
  }
  const recomputedHeapDeltaBytes = Math.max(
    0,
    Math.max(measurements.firstGcHeapBytes, measurements.secondGcHeapBytes) -
      measurements.baselineHeapBytes,
  );
  const recomputedGcSampleDifferenceRatio =
    Math.abs(measurements.firstGcHeapBytes - measurements.secondGcHeapBytes) /
    Math.max(measurements.firstGcHeapBytes, measurements.secondGcHeapBytes, 1);
  assert.equal(measurements.heapDeltaBytes, recomputedHeapDeltaBytes);
  assert.equal(
    measurements.gcSampleDifferenceRatio,
    recomputedGcSampleDifferenceRatio,
  );
  assert.ok(measurements.heapDeltaBytes >= 0);
  assert.ok(measurements.heapDeltaBytes <= thresholds.heapDeltaBytesMaximum);
  assert.ok(measurements.gcSampleDifferenceRatio >= 0);
  assert.ok(
    measurements.gcSampleDifferenceRatio <=
      thresholds.gcSampleDifferenceRatioMaximum,
  );
  assert.equal(measurements.durableEvidenceRecords, measurements.resultCount);
  assert.equal(
    measurements.durableEvidenceRecordLoss,
    thresholds.durableEvidenceRecordLossMaximum,
  );
  assert.match(measurements.durableEvidenceSha256, DIGEST_RE);
  assert.ok(
    measurements.maxTranscriptScanChunkBytes > 0 &&
      measurements.maxTranscriptScanChunkBytes <=
        thresholds.transcriptScanChunkBytesMaximum,
  );
  assert.deepEqual(measurements.backlog, {
    maxMessages: thresholds.backgroundBacklogMessagesMaximum,
    maxBytes: thresholds.backgroundBacklogBytesMaximum,
  });
  assert.equal(
    measurements.productRuntime?.surface,
    "packages/cli/src/runtime/agent-core.js#agentLoop",
  );
  assert.equal(
    measurements.productRuntime?.persistenceSurface,
    "packages/cli/src/harness/jsonl-session-store.js#appendCompactEventIfMessagesMatch/readVerifiedMessages",
  );
  assert.equal(
    measurements.productRuntime.fixtureSeedMethod,
    "linear-canonical-jsonl-with-production-hasher-and-repair-authority",
  );
  assert.ok(measurements.productRuntime.fixtureBuildDurationMs >= 0);
  assert.ok(measurements.productRuntime.fixtureRepairDurationMs >= 0);
  assert.ok(
    measurements.productRuntime.durationMs >=
      measurements.productRuntime.fixtureBuildDurationMs +
        measurements.productRuntime.fixtureRepairDurationMs,
  );
  assert.equal(
    measurements.productRuntime.fixtureEventCount,
    measurements.resultCount + 1,
  );
  assert.ok(measurements.productRuntime.fixtureTranscriptBytes > 0);
  assert.match(measurements.productRuntime.fixtureHeadHash, /^[a-f0-9]{64}$/u);
  assert.equal(
    measurements.productRuntime.initialResumeForwardBytesRead,
    measurements.productRuntime.fixtureTranscriptBytes,
  );
  assert.ok(
    measurements.productRuntime.retentionEvents >=
      thresholds.productRuntimeRetentionEventsMinimum,
  );
  assert.equal(measurements.productRuntime.retentionEvents, 1);
  assert.ok(measurements.productRuntime.degradedEvents >= 0);
  assert.ok(
    measurements.productRuntime.degradedEvents <=
      thresholds.productRuntimeDegradedEventsMaximum,
  );
  assert.equal(measurements.productRuntime.settlementCalls, 1);
  assert.equal(
    measurements.productRuntime.settlementTrigger,
    "runtime-retention",
  );
  assert.equal(
    measurements.productRuntime.projectedMessageCount,
    measurements.resultCount,
  );
  assert.equal(
    measurements.productRuntime.durableReferenceCount,
    measurements.releasedResults,
  );
  assert.equal(measurements.productRuntime.durableReferenceMismatches, 0);
  assert.match(measurements.productRuntime.durableReferenceDigest, DIGEST_RE);
  assert.match(measurements.productRuntime.checkpointDigest, DIGEST_RE);
  assert.ok(measurements.productRuntime.checkpointBytes > 0);
  assert.ok(
    measurements.productRuntime.checkpointBytes <=
      measurements.canonicalRecordBytesMaximum,
  );
  assert.equal(
    measurements.productRuntime.checkpointMessageCount,
    measurements.resultCount,
  );
  assert.equal(
    measurements.productRuntime.checkpointDurableReferenceCount,
    measurements.releasedResults,
  );
  assert.match(measurements.productRuntime.resumeProjectionDigest, DIGEST_RE);
  assert.ok(
    measurements.productRuntime.resumeMessageBytesRead >= 0 &&
      measurements.productRuntime.resumeMessageBytesRead <=
        measurements.canonicalRecordBytesMaximum + SCAN_CHUNK_BYTES,
  );
  assert.ok(measurements.durableTranscriptBytes > 0);
  assert.ok(
    measurements.durableTranscriptEventCount > measurements.resultCount,
  );
  assert.match(measurements.durableTranscriptHeadHash, /^[a-f0-9]{64}$/u);
  assert.equal(
    measurements.durableTranscriptForwardBytesRead,
    measurements.durableTranscriptBytes,
  );
  assert.ok(measurements.durableTranscriptForwardReadCalls > 0);
  assert.equal(measurements.contractTests?.status, "passed");
  assert.deepEqual(measurements.contractTests?.files, [...CONTRACT_TESTS]);
  if (required || smoke) {
    assert.equal(measurements.sessionScale?.available, true);
    assert.equal(
      measurements.sessionScale?.mode,
      required ? "formal" : "smoke",
    );
    assert.equal(
      measurements.sessionScale.platform,
      { linux: "linux", macos: "darwin", windows: "win32" }[fragment.os],
    );
    assert.equal(measurements.sessionScale.node, fragment.runtime.version);
    assert.equal(measurements.sessionScale.arch, fragment.runtime.arch);
    assert.match(measurements.sessionScale?.evidenceDigest || "", DIGEST_RE);
    assert.ok(
      measurements.sessionScale.listP95Ms >= 0 &&
        measurements.sessionScale.listP95Ms <
          thresholds.sessionListP95MsExclusive,
    );
    assert.ok(
      measurements.sessionScale.listPeakRssMb >= 0 &&
        measurements.sessionScale.listPeakRssMb <
          thresholds.sessionListPeakRssMbExclusive,
    );
    assert.ok(
      measurements.sessionScale.resumeP95Ms >= 0 &&
        measurements.sessionScale.resumeP95Ms <
          thresholds.sessionResumeP95MsExclusive,
    );
    assert.ok(
      measurements.sessionScale.resumePeakRssMb >= 0 &&
        measurements.sessionScale.resumePeakRssMb <
          thresholds.sessionResumePeakRssMbExclusive,
    );
    assert.ok(
      measurements.sessionScale.resumeMaxIoBytesRead >= 0 &&
        measurements.sessionScale.resumeMaxIoBytesRead <=
          thresholds.sessionResumeIoBytesMaximum,
    );
  }
  return fragment;
}

function verifySessionScaleSibling(fragmentPath, fragment) {
  const evidenceFile = fragment.measurements.sessionScale.evidenceFile;
  assert.equal(basename(evidenceFile), evidenceFile);
  const candidate = resolve(dirname(fragmentPath), evidenceFile);
  assert.equal(existsSync(candidate), true, `${evidenceFile} is missing`);
  const bytes = readFileSync(candidate);
  assert.equal(
    sha256(bytes),
    fragment.measurements.sessionScale.evidenceDigest,
    `${evidenceFile} digest drift`,
  );
  const validated = validateSessionScaleResult(
    JSON.parse(bytes.toString("utf8")),
    fragment.headSha,
    fragment.disposition === "required",
    false,
    { os: fragment.os, runtime: fragment.runtime },
  );
  assert.deepEqual(fragment.measurements.sessionScale, {
    ...validated,
    evidenceDigest: sha256(bytes),
    evidenceFile,
  });
}

function verifyEvidenceSet(options, dependencies = {}) {
  const headSha = normalizeHeadSha(options.releaseCommit, "release commit");
  const evidenceRoot = resolve(options.evidenceDir);
  const currentHead = dependencies.currentHead
    ? dependencies.currentHead()
    : git("rev-parse", "HEAD");
  assert.equal(normalizeHeadSha(currentHead), headSha);
  const producerState =
    dependencies.producerState || exactHeadProducerDigests(headSha, false);
  assert.equal(producerState.exact, true);
  const records = [];
  for (const filePath of discoverJsonFiles(options.evidenceDir)) {
    const bytes = readFileSync(filePath);
    const value = JSON.parse(bytes.toString("utf8"));
    if (
      value.schema !== FRAGMENT_SCHEMA ||
      value.commitmentId !== COMMITMENT_ID
    ) {
      continue;
    }
    validateFragment(value, {
      headSha,
      allowAdvisory: options.allowAdvisory,
      producerDigests: producerState.producerDigests,
    });
    const artifactDirectory = relative(evidenceRoot, filePath).split(
      /[\\/]/u,
    )[0];
    assert.equal(
      artifactDirectory,
      value.source.artifactName,
      `${relative(evidenceRoot, filePath)} is outside its claimed artifact`,
    );
    verifySessionScaleSibling(filePath, value);
    records.push({ filePath, bytes, value });
  }
  assert.equal(records.length, REQUIRED_OPERATING_SYSTEMS.length);
  const byOs = new Map();
  for (const record of records) {
    assert.equal(
      byOs.has(record.value.os),
      false,
      `duplicate ${record.value.os}`,
    );
    byOs.set(record.value.os, record);
  }
  assert.deepEqual(
    [...byOs.keys()].sort(),
    [...REQUIRED_OPERATING_SYSTEMS].sort(),
  );
  const dispositions = new Set(records.map(({ value }) => value.disposition));
  const profiles = new Set(records.map(({ value }) => value.profileVersion));
  const thresholdDigests = new Set(
    records.map(({ value }) =>
      sha256(Buffer.from(stableJson(value.thresholds))),
    ),
  );
  assert.equal(dispositions.size, 1);
  assert.equal(profiles.size, 1);
  assert.equal(thresholdDigests.size, 1);
  for (const sourceField of ["workflowId", "runId", "jobId"]) {
    assert.equal(
      new Set(records.map(({ value }) => value.source[sourceField])).size,
      1,
      `SESSION-RUNTIME ${sourceField} differs across operating systems`,
    );
  }
  const artifactAttempts = new Set(
    records.map(({ value }) => value.source.artifactName.split("-").at(-1)),
  );
  assert.equal(artifactAttempts.size, 1);
  const disposition = records[0].value.disposition;
  const currentEnvironment = dependencies.currentEnvironment || process.env;
  if (currentEnvironment.GITHUB_ACTIONS === "true") {
    if (disposition === "required") {
      assert.equal(
        normalizeHeadSha(
          currentEnvironment.GITHUB_WORKFLOW_SHA,
          "aggregate GitHub workflow SHA",
        ),
        headSha,
      );
    }
    assert.equal(
      records[0].value.source.workflowId,
      currentEnvironment.GITHUB_WORKFLOW_REF,
    );
    assert.equal(
      records[0].value.source.runId,
      currentEnvironment.GITHUB_RUN_ID,
    );
  }
  if (!dependencies.producerState) {
    const producerStateAfter = exactHeadProducerDigests(headSha, false);
    assert.equal(producerStateAfter.exact, true);
    assert.deepEqual(
      producerStateAfter.producerDigests,
      producerState.producerDigests,
      "SESSION-RUNTIME producers changed during aggregation",
    );
  }
  if (!options.allowAdvisory) assert.equal(disposition, "required");

  const aggregate = {
    schema: AGGREGATE_SCHEMA,
    commitmentId: COMMITMENT_ID,
    headSha,
    profileVersion: records[0].value.profileVersion,
    disposition,
    outcome: "passed",
    operatingSystems: [...REQUIRED_OPERATING_SYSTEMS],
    runtimes: Object.fromEntries(
      REQUIRED_OPERATING_SYSTEMS.map((os) => [os, byOs.get(os).value.runtime]),
    ),
    testIds: records[0].value.testIds,
    sources: Object.fromEntries(
      REQUIRED_OPERATING_SYSTEMS.map((os) => [os, byOs.get(os).value.source]),
    ),
    thresholds: records[0].value.thresholds,
    producerDigests: producerState.producerDigests,
    fragmentDigests: Object.fromEntries(
      REQUIRED_OPERATING_SYSTEMS.map((os) => [os, sha256(byOs.get(os).bytes)]),
    ),
    sessionScaleEvidenceDigests: Object.fromEntries(
      REQUIRED_OPERATING_SYSTEMS.map((os) => [
        os,
        byOs.get(os).value.measurements.sessionScale.evidenceDigest,
      ]),
    ),
    measurements: Object.fromEntries(
      REQUIRED_OPERATING_SYSTEMS.map((os) => [
        os,
        byOs.get(os).value.measurements,
      ]),
    ),
  };
  if (options.output) writeJsonAtomic(options.output, aggregate);
  return aggregate;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.evidenceDir) {
    const aggregate = verifyEvidenceSet(options);
    process.stdout.write(
      `${COMMITMENT_ID} ${aggregate.disposition} aggregate passed for ${aggregate.headSha}\n`,
    );
    return;
  }
  const result = await runProfile(options);
  const output = resolve(
    options.output ||
      join(tmpdir(), `session-runtime-retention-${process.platform}.json`),
  );
  writeJsonAtomic(output, result);
  process.stdout.write(
    `${JSON.stringify({
      outcome: result.outcome,
      disposition: result.disposition,
      headSha: result.headSha,
      heapDeltaBytes: result.measurements.heapDeltaBytes,
      gcSampleDifferenceRatio: result.measurements.gcSampleDifferenceRatio,
      output: relative(REPO_ROOT, output) || basename(output),
    })}\n`,
  );
}

async function runInternalProductProbeFromEnvironment(env = process.env) {
  const positiveInteger = (name) => {
    const value = Number(env[name]);
    assert.ok(Number.isSafeInteger(value) && value > 0, `${name} is invalid`);
    return value;
  };
  const output = env.CC_SESSION_RUNTIME_INTERNAL_OUTPUT;
  assert.ok(output, "internal product probe output is required");
  const result = await runProductStoreProbeInternal({
    resultCount: positiveInteger("CC_SESSION_RUNTIME_INTERNAL_RESULT_COUNT"),
    resultBytes: positiveInteger("CC_SESSION_RUNTIME_INTERNAL_RESULT_BYTES"),
    recentResults: positiveInteger(
      "CC_SESSION_RUNTIME_INTERNAL_RECENT_RESULTS",
    ),
  });
  writeJsonAtomic(output, result);
}

const invokedAsScript =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href ===
    pathToFileURL(SCRIPT_PATH).href;
if (invokedAsScript) {
  const operation =
    process.env.CC_SESSION_RUNTIME_INTERNAL_PROBE === "1"
      ? runInternalProductProbeFromEnvironment()
      : main();
  operation.catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

export {
  ADVISORY_PROFILE_VERSION,
  ADVISORY_THRESHOLDS,
  AGGREGATE_SCHEMA,
  COMMITMENT_ID,
  CONTRACT_TESTS,
  FRAGMENT_SCHEMA,
  LOCAL_TEST_IDS,
  LOCAL_PROFILE_VERSION,
  PRODUCERS,
  REQUIRED_OPERATING_SYSTEMS,
  REQUIRED_PROFILE_VERSION,
  REQUIRED_THRESHOLDS,
  TEST_IDS,
  parseArgs,
  sourceFromEnvironment,
  validateFragment,
  validateSessionScaleResult,
  verifyEvidenceSet,
};
