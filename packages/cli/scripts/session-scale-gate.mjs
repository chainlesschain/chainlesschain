#!/usr/bin/env node

import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "../../..");
const CONCURRENCY_WORKER = resolve(
  SCRIPT_DIR,
  "../__tests__/fixtures/session-concurrency-writer.mjs",
);
const MEASURE_WORKER = resolve(
  SCRIPT_DIR,
  "../__tests__/fixtures/session-scale-measure-worker.mjs",
);
const PROCESS_PROBE = resolve(
  SCRIPT_DIR,
  "../__tests__/fixtures/session-scale-process-probe.mjs",
);
const CLI_ENTRYPOINT = resolve(SCRIPT_DIR, "../bin/chainlesschain.js");
const CRASH_WORKER = resolve(
  SCRIPT_DIR,
  "../__tests__/fixtures/session-scale-crash-writer.mjs",
);
const PIPELINE_CRASH_WORKER = resolve(
  SCRIPT_DIR,
  "../__tests__/fixtures/session-scale-pipeline-crash-worker.mjs",
);
const RESULT_SCHEMA = "cc-cli-session-scale-result/v1";
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const GATE_SOURCE_PATHS = [
  ".github/workflows/cli-session-scale.yml",
  "package.json",
  "packages/cli/src/harness/jsonl-session-store.js",
  "packages/cli/src/harness/session-list-index.js",
  "packages/cli/src/lib/file-lines.js",
  "packages/cli/bin/chainlesschain.js",
  "packages/cli/src/lazy-dispatch.js",
  "packages/cli/src/commands/session.js",
  "packages/cli/src/commands/session-show.js",
  "packages/cli/src/lib/pr-link-store.js",
  "packages/cli/src/lib/session-anti-rollback-anchor.js",
  "packages/cli/scripts/session-scale-gate.mjs",
  "packages/cli/__tests__/fixtures/session-concurrency-writer.mjs",
  "packages/cli/__tests__/fixtures/session-scale-crash-writer.mjs",
  "packages/cli/__tests__/fixtures/session-scale-measure-worker.mjs",
  "packages/cli/__tests__/fixtures/session-scale-process-probe.mjs",
  "packages/cli/__tests__/fixtures/session-scale-pipeline-crash-worker.mjs",
  "packages/cli/__tests__/unit/jsonl-session-store.test.js",
  "packages/cli/__tests__/unit/session-list-index.test.js",
  "packages/cli/__tests__/unit/session-anti-rollback-anchor.test.js",
  "packages/cli/__tests__/unit/session-scale-gate.test.js",
];
const PRODUCTION_PIPELINE_KILL_POINTS = Object.freeze([
  Object.freeze({
    point: "after-new-transcript-file-fsync",
    createsSession: true,
    expectedBoundary: "new-transcript-file-fsync-before-sidecar",
  }),
  Object.freeze({
    point: "after-new-transcript-directory-fsync",
    createsSession: true,
    posixOnly: true,
    expectedBoundary: "new-transcript-directory-fsync-before-sidecar",
  }),
  Object.freeze({
    point: "after-transcript-fsync",
    expectedBoundary: "transcript-file-fsync-before-sidecar",
  }),
  Object.freeze({
    point: "after-meta-temp-fsync",
    expectedBoundary: "sidecar-temp-fsync-before-rename",
  }),
  Object.freeze({
    point: "after-meta-rename",
    canonicalMetaCommitted: true,
    expectedBoundary: "sidecar-rename-before-directory-fsync",
  }),
  Object.freeze({
    point: "after-meta-directory-fsync",
    posixOnly: true,
    canonicalMetaCommitted: true,
    expectedBoundary: "sidecar-directory-fsync-before-external-anchor",
  }),
  Object.freeze({
    point: "after-anchor",
    canonicalMetaCommitted: true,
    activityCommitted: true,
    anchorCommitted: true,
    expectedBoundary: "external-anti-rollback-anchor-settled",
  }),
]);

function positiveInteger(value, fallback, name) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function positiveNumber(value, fallback, name) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function atLeast(value, minimum) {
  return Math.max(minimum, value);
}

function atMost(value, maximum) {
  return Math.min(maximum, value);
}

export function resolveSessionScaleProfile(env = process.env) {
  const mode = String(env.CC_SESSION_SCALE_MODE || "smoke").trim();
  if (mode !== "formal" && mode !== "smoke") {
    throw new Error("CC_SESSION_SCALE_MODE must be formal or smoke");
  }
  const formal = mode === "formal";
  const defaults = formal
    ? {
        writers: 20,
        eventsPerWriter: 1_000,
        sessionCount: 10_000,
        transcriptBytes: GIB,
        listSamples: 25,
        resumeSamples: 15,
        coldResumeSamples: 15,
        actualKillCases: 6,
        exhaustiveCuts: true,
      }
    : {
        writers: 3,
        eventsPerWriter: 25,
        sessionCount: 250,
        transcriptBytes: 64 * MIB,
        listSamples: 5,
        resumeSamples: 5,
        coldResumeSamples: 3,
        actualKillCases: 2,
        exhaustiveCuts: false,
      };

  const readInteger = (name, fallback) =>
    positiveInteger(env[name], fallback, name);
  const floor = (value, minimum) => (formal ? atLeast(value, minimum) : value);
  const ceiling = (value, maximum) => (formal ? atMost(value, maximum) : value);

  return {
    mode,
    writers: floor(
      readInteger("CC_SESSION_SCALE_WRITERS", defaults.writers),
      defaults.writers,
    ),
    eventsPerWriter: floor(
      readInteger(
        "CC_SESSION_SCALE_EVENTS_PER_WRITER",
        defaults.eventsPerWriter,
      ),
      defaults.eventsPerWriter,
    ),
    sessionCount: floor(
      readInteger("CC_SESSION_SCALE_SESSION_COUNT", defaults.sessionCount),
      defaults.sessionCount,
    ),
    transcriptBytes: floor(
      readInteger(
        "CC_SESSION_SCALE_TRANSCRIPT_BYTES",
        defaults.transcriptBytes,
      ),
      defaults.transcriptBytes,
    ),
    listSamples: floor(
      readInteger("CC_SESSION_SCALE_LIST_SAMPLES", defaults.listSamples),
      defaults.listSamples,
    ),
    resumeSamples: floor(
      readInteger("CC_SESSION_SCALE_RESUME_SAMPLES", defaults.resumeSamples),
      defaults.resumeSamples,
    ),
    coldResumeSamples: floor(
      readInteger(
        "CC_SESSION_SCALE_COLD_RESUME_SAMPLES",
        defaults.coldResumeSamples,
      ),
      defaults.coldResumeSamples,
    ),
    actualKillCases: floor(
      readInteger(
        "CC_SESSION_SCALE_ACTUAL_KILL_CASES",
        defaults.actualKillCases,
      ),
      defaults.actualKillCases,
    ),
    exhaustiveCuts: formal
      ? true
      : env.CC_SESSION_SCALE_EXHAUSTIVE_CUTS === "1" || defaults.exhaustiveCuts,
    thresholds: {
      profile: "uniform-v1",
      listP95Ms: ceiling(
        positiveNumber(
          env.CC_SESSION_SCALE_LIST_P95_MS,
          200,
          "CC_SESSION_SCALE_LIST_P95_MS",
        ),
        200,
      ),
      listRssMb: ceiling(
        positiveNumber(
          env.CC_SESSION_SCALE_LIST_RSS_MB,
          100,
          "CC_SESSION_SCALE_LIST_RSS_MB",
        ),
        100,
      ),
      resumeP95Ms: ceiling(
        positiveNumber(
          env.CC_SESSION_SCALE_RESUME_P95_MS,
          2_000,
          "CC_SESSION_SCALE_RESUME_P95_MS",
        ),
        2_000,
      ),
      resumeRssMb: ceiling(
        positiveNumber(
          env.CC_SESSION_SCALE_RESUME_RSS_MB,
          100,
          "CC_SESSION_SCALE_RESUME_RSS_MB",
        ),
        100,
      ),
      resumeMaxIoBytes: ceiling(
        readInteger("CC_SESSION_SCALE_RESUME_MAX_IO_BYTES", MIB),
        MIB,
      ),
    },
  };
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * MIB,
  }).trim();
}

function gitSucceeds(...args) {
  try {
    execFileSync("git", args, {
      cwd: REPOSITORY_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch (error) {
    if (error?.status === 1) return false;
    throw error;
  }
}

function exactRepositoryState() {
  const trackedPorcelain = git("status", "--porcelain", "--untracked-files=no");
  const sourcePathsTracked = GATE_SOURCE_PATHS.every((filePath) =>
    gitSucceeds("ls-files", "--error-unmatch", "--", filePath),
  );
  const sourcePathsUnmodified = gitSucceeds(
    "diff",
    "--quiet",
    "HEAD",
    "--",
    ...GATE_SOURCE_PATHS,
  );
  return {
    commitSha: git("rev-parse", "HEAD").toLowerCase(),
    treeSha: git("rev-parse", "HEAD^{tree}").toLowerCase(),
    trackedWorktreeDirty: trackedPorcelain.length > 0,
    gateSourcePathsExact: sourcePathsTracked && sourcePathsUnmodified,
  };
}

function spawnCapture(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: REPOSITORY_ROOT,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timeoutError = null;
    let forcedSettlement = null;
    let settled = false;
    const cleanupTimers = () => {
      clearTimeout(timeout);
      if (forcedSettlement !== null) clearTimeout(forcedSettlement);
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      rejectPromise(error);
    };
    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      resolvePromise(value);
    };
    const timeout = setTimeout(() => {
      timeoutError = new Error(`process timed out: ${command}`);
      child.kill("SIGKILL");
      forcedSettlement = setTimeout(() => {
        // A failed OS termination request must not leave a gate Promise (and
        // therefore a workflow job) waiting forever. Detach only after a
        // second bounded kill attempt and close the captured pipe handles.
        child.kill("SIGKILL");
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        rejectOnce(timeoutError);
      }, 5_000);
    }, options.timeoutMs || 60_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      options.onStdout?.(stdout, child);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      rejectOnce(error);
    });
    child.once("exit", (code, signal) => {
      if (timeoutError) {
        rejectOnce(timeoutError);
      } else if (code === 0 || options.acceptKilled === true) {
        resolveOnce({ code, signal, stdout, stderr, child });
      } else {
        rejectOnce(
          new Error(
            `process exited ${code ?? signal}: ${stderr || stdout}`.trim(),
          ),
        );
      }
    });
  });
}

async function runJsonWorker(args, { timeoutMs = 60_000 } = {}) {
  const result = await spawnCapture(
    process.execPath,
    ["--expose-gc", "--max-old-space-size=96", MEASURE_WORKER, ...args],
    { timeoutMs },
  );
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines.at(-1));
}

function percentile(values, percentileValue) {
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.ceil((percentileValue / 100) * ordered.length) - 1,
  );
  return ordered[index];
}

async function runColdCliResumeSample(home, sessionId, sampleIndex) {
  const probeOutput = join(
    home,
    `cold-cli-probe-${String(sampleIndex).padStart(3, "0")}.json`,
  );
  const started = performance.now();
  const execution = await spawnCapture(
    process.execPath,
    [
      "--max-old-space-size=96",
      "--import",
      pathToFileURL(PROCESS_PROBE).href,
      CLI_ENTRYPOINT,
      "session",
      "show",
      sessionId,
      "--json",
    ],
    {
      timeoutMs: 30_000,
      env: {
        ...process.env,
        CHAINLESSCHAIN_HOME: home,
        CC_SESSION_SCALE_PROBE_OUTPUT: probeOutput,
        NO_COLOR: "1",
      },
    },
  );
  const wallMs = performance.now() - started;
  if (!existsSync(probeOutput)) {
    throw new Error("cold CLI resume process did not emit its RSS probe");
  }
  const probe = JSON.parse(readFileSync(probeOutput, "utf8"));
  rmSync(probeOutput, { force: true });
  const payload = JSON.parse(execution.stdout.trim());
  if (
    payload.id !== sessionId ||
    payload.message_count !== 2 ||
    payload.messages?.[0]?.content !== "bounded summary" ||
    payload.messages?.[1]?.content !== "new turn"
  ) {
    throw new Error("cold CLI resume returned unexpected session content");
  }
  return {
    wallMs,
    processDurationMs: probe.durationMs,
    peakRssMb: probe.peakRssMb,
    messageCount: payload.message_count,
  };
}

async function measureColdCliResume(home, sessionId, profile) {
  const samples = [];
  for (let index = 0; index < profile.coldResumeSamples; index += 1) {
    samples.push(await runColdCliResumeSample(home, sessionId, index));
  }
  return {
    measurementScope: "full-cli-cold-process",
    samples,
    sampleCount: samples.length,
    p95Ms: percentile(
      samples.map((sample) => sample.wallMs),
      95,
    ),
    peakRssMb: Math.max(...samples.map((sample) => sample.peakRssMb)),
  };
}

export function concurrencyWriterTimeoutMs(platform = process.platform) {
  // Windows keeps the full 20×1000 formal writer matrix but needs a larger
  // watchdog for its slower strict directory-lock and fsync path. This does
  // not reduce writer count, event count, or any correctness assertion.
  return platform === "win32" ? 60 * 60_000 : 30 * 60_000;
}

async function runConcurrencyScenario(store, home, profile) {
  process.env.CHAINLESSCHAIN_HOME = home;
  const sessionId = `scale-concurrency-${Date.now()}`;
  store.startSession(sessionId, { title: "session scale concurrency" });
  const started = performance.now();
  const writers = await Promise.allSettled(
    Array.from({ length: profile.writers }, (_, writerIndex) =>
      spawnCapture(
        process.execPath,
        [
          CONCURRENCY_WORKER,
          sessionId,
          `writer-${writerIndex}`,
          String(profile.eventsPerWriter),
        ],
        {
          env: { ...process.env, CHAINLESSCHAIN_HOME: home },
          timeoutMs: concurrencyWriterTimeoutMs(),
        },
      ),
    ),
  );
  const writerFailures = writers
    .filter((writer) => writer.status === "rejected")
    .map((writer) => String(writer.reason?.message || writer.reason));
  if (writerFailures.length > 0) {
    throw new Error(
      `${writerFailures.length} session writer(s) failed: ${writerFailures.join("; ")}`,
    );
  }
  const appendDurationMs = performance.now() - started;
  const events = store.readEvents(sessionId);
  const probes = events.filter((event) => event.type === "concurrency_probe");
  const unique = new Set(
    probes.map((event) => `${event.data?.writerId}:${event.data?.sequence}`),
  );
  const expected = profile.writers * profile.eventsPerWriter;
  const verification = store.verifySession(sessionId);
  const violations = [];
  if (probes.length !== expected) {
    violations.push(`event count ${probes.length} != ${expected}`);
  }
  if (unique.size !== expected) {
    violations.push(`unique event count ${unique.size} != ${expected}`);
  }
  if (
    verification.status !== "verified" ||
    verification.chainedEvents !== expected + 1
  ) {
    violations.push("hash chain is not complete");
  }
  return {
    pass: violations.length === 0,
    parameters: {
      writers: profile.writers,
      eventsPerWriter: profile.eventsPerWriter,
    },
    expectedProbeEvents: expected,
    observedProbeEvents: probes.length,
    uniqueProbeEvents: unique.size,
    chainedEvents: verification.chainedEvents,
    chainStatus: verification.status,
    appendDurationMs,
    violations,
  };
}

function createIndexFixture(home, sessionCount, computeEventHash) {
  const sessionsDir = join(home, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  const width = String(sessionCount - 1).length;
  const journal = [];
  let newestId = null;
  for (let index = 0; index < sessionCount; index += 1) {
    const id = `scale-index-${String(index).padStart(width, "0")}`;
    newestId = id;
    const core = {
      type: "session_start",
      timestamp: index + 1,
      data: {
        title: `Synthetic session ${index}`,
        provider: "scale",
        model: "fixture",
      },
    };
    const lastHash = computeEventHash(null, core);
    const meta = {
      schema: 2,
      id,
      title: `Synthetic session ${index}`,
      provider: "scale",
      model: "fixture",
      message_count: 0,
      event_count: 1,
      created_at_ms: index + 1,
      updated_at_ms: index + 1,
      last_hash: lastHash,
      deleted: false,
    };
    writeFileSync(
      join(sessionsDir, `${id}.jsonl`),
      `${JSON.stringify({ ...core, prevHash: null, hash: lastHash })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    writeFileSync(
      join(sessionsDir, `${id}.meta.json`),
      `${JSON.stringify(meta)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    journal.push(JSON.stringify(meta));
  }
  writeFileSync(
    join(sessionsDir, ".sessions-index-v2.ndjson"),
    `\n${journal.join("\n\n")}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return { newestId, sessionsDir };
}

async function runIndexScenario(home, profile, computeEventHash) {
  const setupStarted = performance.now();
  const fixture = createIndexFixture(
    home,
    profile.sessionCount,
    computeEventHash,
  );
  const setupDurationMs = performance.now() - setupStarted;
  const listLimit = Math.min(10, profile.sessionCount);
  const measurement = await runJsonWorker(
    [
      "list",
      home,
      fixture.newestId,
      String(profile.listSamples),
      String(listLimit),
    ],
    { timeoutMs: 5 * 60_000 },
  );
  const violations = [];
  if (!(measurement.p95Ms < profile.thresholds.listP95Ms)) {
    violations.push(
      `list p95 ${measurement.p95Ms}ms is not below ${profile.thresholds.listP95Ms}ms`,
    );
  }
  if (!(measurement.peakRssMb < profile.thresholds.listRssMb)) {
    violations.push(
      `list RSS ${measurement.peakRssMb}MB is not below ${profile.thresholds.listRssMb}MB`,
    );
  }
  return {
    pass: violations.length === 0,
    fixture: {
      kind: "synthetic-valid-canonical-transcripts-with-derived-index-v2",
      sessionCount: profile.sessionCount,
      transcriptEntries: profile.sessionCount,
      sidecarEntries: profile.sessionCount,
      setupDurationMs,
    },
    commandSemantics: `listJsonlSessions({ limit: ${listLimit} })`,
    ...measurement,
    thresholds: {
      p95MsExclusive: profile.thresholds.listP95Ms,
      peakRssMbExclusive: profile.thresholds.listRssMb,
    },
    violations,
  };
}

function writeAllSync(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const written = writeSync(fd, buffer, offset, buffer.length - offset);
    if (written <= 0) throw new Error("session scale fixture short write");
    offset += written;
  }
}

function eventLine(core, prevHash, computeEventHash) {
  const hash = computeEventHash(prevHash, core);
  return {
    hash,
    buffer: Buffer.from(
      `${JSON.stringify({ ...core, prevHash, hash })}\n`,
      "utf8",
    ),
  };
}

function createValidTranscript(
  store,
  sessionIndex,
  home,
  transcriptBytes,
  computeEventHash,
) {
  process.env.CHAINLESSCHAIN_HOME = home;
  mkdirSync(join(home, "sessions"), { recursive: true });
  const sessionId = "scale-valid-checkpoint";
  const filePath = store.sessionPath(sessionId);
  const compactCore = {
    type: "compact",
    timestamp: 2,
    data: {
      messages: [{ role: "system", content: "bounded summary" }],
    },
  };
  const suffixCore = {
    type: "user_message",
    timestamp: 3,
    data: { role: "user", content: "new turn" },
  };
  const placeholderHash = "0".repeat(64);
  const tailBytes =
    Buffer.byteLength(
      `${JSON.stringify({
        ...compactCore,
        prevHash: placeholderHash,
        hash: placeholderHash,
      })}\n`,
    ) +
    Buffer.byteLength(
      `${JSON.stringify({
        ...suffixCore,
        prevHash: placeholderHash,
        hash: placeholderHash,
      })}\n`,
    );
  let prefixBytesRemaining = transcriptBytes - tailBytes;
  if (prefixBytesRemaining < 1024) {
    throw new Error("valid transcript size is too small");
  }

  const maxPaddingBytes = MIB;
  let paddingEventCount = 0;
  let prevHash = null;
  const fd = openSync(filePath, "w", 0o600);
  try {
    while (prefixBytesRemaining > 0) {
      const sequence = paddingEventCount;
      const coreForPadding = (padding) =>
        sequence === 0
          ? {
              type: "session_start",
              timestamp: 1,
              data: {
                title: "scale fixture",
                provider: "scale",
                model: "fixture",
                padding,
              },
            }
          : {
              type: "scale_padding",
              timestamp: 1,
              data: { sequence, padding },
            };
      const emptyCore = coreForPadding("");
      const baseBytes = Buffer.byteLength(
        `${JSON.stringify({
          ...emptyCore,
          prevHash,
          hash: placeholderHash,
        })}\n`,
      );
      if (prefixBytesRemaining < baseBytes) {
        throw new Error("could not exactly size the valid transcript fixture");
      }

      let paddingBytes;
      if (prefixBytesRemaining <= baseBytes + maxPaddingBytes) {
        paddingBytes = prefixBytesRemaining - baseBytes;
      } else {
        const nextSequence = sequence + 1;
        const nextCore = {
          type: "scale_padding",
          timestamp: 1,
          data: { sequence: nextSequence, padding: "" },
        };
        const nextBaseBytes = Buffer.byteLength(
          `${JSON.stringify({
            ...nextCore,
            prevHash: placeholderHash,
            hash: placeholderHash,
          })}\n`,
        );
        const afterMaximum = prefixBytesRemaining - baseBytes - maxPaddingBytes;
        paddingBytes =
          afterMaximum < nextBaseBytes
            ? prefixBytesRemaining - baseBytes - nextBaseBytes
            : maxPaddingBytes;
      }
      if (paddingBytes < 0 || paddingBytes > maxPaddingBytes) {
        throw new Error("invalid valid-transcript padding calculation");
      }

      const core = coreForPadding("x".repeat(paddingBytes));
      const line = eventLine(core, prevHash, computeEventHash);
      if (line.buffer.length !== baseBytes + paddingBytes) {
        throw new Error("valid transcript serialization size drifted");
      }
      writeAllSync(fd, line.buffer);
      prefixBytesRemaining -= line.buffer.length;
      prevHash = line.hash;
      paddingEventCount += 1;
    }

    const compact = eventLine(compactCore, prevHash, computeEventHash);
    writeAllSync(fd, compact.buffer);
    const suffix = eventLine(suffixCore, compact.hash, computeEventHash);
    writeAllSync(fd, suffix.buffer);
    prevHash = suffix.hash;
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const stat = statSync(filePath);
  if (stat.size !== transcriptBytes) {
    throw new Error(
      `valid transcript size ${stat.size} != requested ${transcriptBytes}`,
    );
  }
  const verificationStarted = performance.now();
  const fullChainVerification = store.verifySession(sessionId);
  const fullChainVerificationDurationMs =
    performance.now() - verificationStarted;
  if (
    fullChainVerification.status !== "verified" ||
    fullChainVerification.chainedEvents !== paddingEventCount + 2
  ) {
    throw new Error(
      "valid transcript failed full production chain verification",
    );
  }
  const sidecarStarted = performance.now();
  const metadata = store.getJsonlSessionMetadata(sessionId);
  const rawMetadata = sessionIndex.readSessionMeta(
    join(home, "sessions"),
    sessionId,
  );
  const sidecarBuildDurationMs = performance.now() - sidecarStarted;
  if (
    !metadata ||
    rawMetadata?.deleted === true ||
    rawMetadata?.last_hash !== fullChainVerification.lastHash ||
    Number(rawMetadata?.event_count) !== fullChainVerification.chainedEvents
  ) {
    throw new Error("valid transcript production metadata anchor is missing");
  }
  // Production tail readers deliberately fail closed until both the local
  // metadata sidecar and the independent anti-rollback witness are published.
  // The synthetic fixture writes its transcript directly, so establish those
  // authorities before proving the checkpoint fast path.
  const latestCompact = store.findLatestEvent(sessionId, "compact");
  const latestSuffix = store.findLatestEvent(sessionId, "user_message");
  const tailChainVerified =
    latestCompact?.hash ===
      computeEventHash(latestCompact?.prevHash, compactCore) &&
    latestSuffix?.prevHash === latestCompact?.hash &&
    latestSuffix?.hash === computeEventHash(latestCompact?.hash, suffixCore) &&
    latestSuffix?.hash === prevHash;
  if (!tailChainVerified) {
    throw new Error("valid transcript checkpoint tail failed chain validation");
  }
  return {
    sessionId,
    filePath,
    logicalBytes: stat.size,
    allocatedBytes:
      Number.isFinite(stat.blocks) && stat.blocks >= 0
        ? stat.blocks * 512
        : null,
    checkpointDistanceFromTailBytes: tailBytes,
    paddingEventCount,
    totalEventCount: paddingEventCount + 2,
    maxPaddingBytesPerEvent: maxPaddingBytes,
    tailChainVerified,
    fullChainStatus: fullChainVerification.status,
    fullChainVerifiedEvents: fullChainVerification.chainedEvents,
    fullChainVerificationDurationMs,
    productionSidecarAnchored: true,
    sidecarBuildDurationMs,
  };
}

async function runResumeScenario(
  store,
  sessionIndex,
  home,
  profile,
  computeEventHash,
) {
  const fixture = createValidTranscript(
    store,
    sessionIndex,
    home,
    profile.transcriptBytes,
    computeEventHash,
  );
  const measurement = await runJsonWorker(
    ["resume", home, fixture.sessionId, String(profile.resumeSamples), "10"],
    { timeoutMs: 5 * 60_000 },
  );
  const coldProcess = await measureColdCliResume(
    home,
    fixture.sessionId,
    profile,
  );
  const violations = [];
  if (!(measurement.p95Ms < profile.thresholds.resumeP95Ms)) {
    violations.push(
      `resume p95 ${measurement.p95Ms}ms is not below ${profile.thresholds.resumeP95Ms}ms`,
    );
  }
  if (!(measurement.peakRssMb < profile.thresholds.resumeRssMb)) {
    violations.push(
      `resume RSS ${measurement.peakRssMb}MB is not below ${profile.thresholds.resumeRssMb}MB`,
    );
  }
  if (!(measurement.maxIoBytesRead <= profile.thresholds.resumeMaxIoBytes)) {
    violations.push(
      `resume read ${measurement.maxIoBytesRead} bytes, above ${profile.thresholds.resumeMaxIoBytes}`,
    );
  }
  if (!(measurement.maxIoBytesRead < fixture.logicalBytes)) {
    violations.push("resume IO is not bounded below transcript size");
  }
  if (!(coldProcess.p95Ms < profile.thresholds.resumeP95Ms)) {
    violations.push(
      `cold CLI resume p95 ${coldProcess.p95Ms}ms is not below ${profile.thresholds.resumeP95Ms}ms`,
    );
  }
  if (!(coldProcess.peakRssMb < profile.thresholds.resumeRssMb)) {
    violations.push(
      `cold CLI resume RSS ${coldProcess.peakRssMb}MB is not below ${profile.thresholds.resumeRssMb}MB`,
    );
  }
  return {
    pass: violations.length === 0,
    fixture: {
      kind: "synthetic-valid-fully-hash-chained-jsonl",
      construction:
        "bounded-memory-canonical-events-with-production-computeEventHash",
      allRecordsValidJson: true,
      allRecordsHashChainedByConstruction: true,
      logicalBytes: fixture.logicalBytes,
      allocatedBytes: fixture.allocatedBytes,
      checkpointDistanceFromTailBytes: fixture.checkpointDistanceFromTailBytes,
      paddingEventCount: fixture.paddingEventCount,
      totalEventCount: fixture.totalEventCount,
      maxPaddingBytesPerEvent: fixture.maxPaddingBytesPerEvent,
      tailChainVerified: fixture.tailChainVerified,
      fullChainStatus: fixture.fullChainStatus,
      fullChainVerifiedEvents: fixture.fullChainVerifiedEvents,
      fullChainVerificationDurationMs: fixture.fullChainVerificationDurationMs,
      productionSidecarAnchored: fixture.productionSidecarAnchored,
      sidecarBuildDurationMs: fixture.sidecarBuildDurationMs,
    },
    operation: "rebuildMessages from newest compact checkpoint",
    ...measurement,
    coldProcess,
    ioToLogicalRatio: measurement.maxIoBytesRead / fixture.logicalBytes,
    thresholds: {
      p95MsExclusive: profile.thresholds.resumeP95Ms,
      peakRssMbExclusive: profile.thresholds.resumeRssMb,
      maxIoBytesInclusive: profile.thresholds.resumeMaxIoBytes,
    },
    proof: {
      boundedHeapProcessMb: 96,
      productionReverseReaderInstrumented: true,
      validJsonlConstructedWithProductionHasher: true,
      entireFileLoaded: measurement.maxIoBytesRead >= fixture.logicalBytes,
      fullCliEntrypoint: "packages/cli/bin/chainlesschain.js",
      fullCliCommand: "session show <id> --json",
      freshProcessPerSample: true,
      processStartupAndModuleLoadIncluded: true,
    },
    violations,
  };
}

function buildNextRecord(store, computeEventHash, sessionId, label) {
  const events = store.readEvents(sessionId);
  const previous = events.at(-1)?.hash || null;
  const core = {
    type: "scale_crash_probe",
    timestamp: Date.now(),
    data: { label, payload: "x".repeat(96) },
  };
  const event = {
    ...core,
    prevHash: previous,
    hash: computeEventHash(previous, core),
  };
  return Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
}

function inspectRepairOutcome(store, sessionId, cut, recordBytes) {
  const filePath = store.sessionPath(sessionId);
  const beforeDryRun = readFileSync(filePath);
  const dryRun = store.repairSession(sessionId, { dryRun: true });
  const dryRunPreservedBytes = readFileSync(filePath).equals(beforeDryRun);
  const repaired = store.repairSession(sessionId);
  const verified = store.verifySession(sessionId);
  let authoritativeEvents = null;
  try {
    authoritativeEvents = store.readVerifiedEvents(sessionId);
  } catch {
    // Keep the result structured so this crash cut fails the gate instead of
    // turning an authority-read exception into an unscoped fatal error.
  }
  const completeJsonBytes = recordBytes - 1;
  const completeWithoutNewline = cut === completeJsonBytes;
  const completeWithNewline = cut === recordBytes;
  const expectedPhysicalChange = !completeWithNewline;
  const expectedIndexRebuild = true;
  const expectedPhysicalAction = completeWithNewline
    ? "none"
    : completeWithoutNewline
      ? "normalize-newline"
      : "discard-partial-record";
  const expectedAction = completeWithNewline
    ? "rebuild-index"
    : expectedPhysicalAction;
  const expectedChainedEvents =
    completeWithoutNewline || completeWithNewline ? 2 : 1;
  const pass =
    dryRun.changed === expectedPhysicalChange &&
    dryRun.healthy === false &&
    dryRun.wouldChange === true &&
    dryRun.action === expectedAction &&
    dryRun.physicalAction === expectedPhysicalAction &&
    dryRunPreservedBytes &&
    repaired.changed === true &&
    repaired.physicalChanged === expectedPhysicalChange &&
    repaired.indexRebuilt === expectedIndexRebuild &&
    repaired.healthy === true &&
    repaired.authorityAnchored === true &&
    repaired.action === expectedAction &&
    repaired.physicalAction === expectedPhysicalAction &&
    repaired.discardedRecords <= 1 &&
    repaired.discardedBytes ===
      (completeWithoutNewline || completeWithNewline ? 0 : cut) &&
    verified.status === "verified" &&
    verified.chainedEvents === expectedChainedEvents &&
    authoritativeEvents?.length === expectedChainedEvents &&
    authoritativeEvents?.at(-1)?.hash === verified.lastHash;
  return {
    pass,
    cut,
    action: repaired.action,
    physicalAction: repaired.physicalAction,
    discardedBytes: repaired.discardedBytes,
    discardedRecords: repaired.discardedRecords,
    dryRunPreservedBytes,
    dryRunHealthy: dryRun.healthy,
    repairedHealthy: repaired.healthy,
    authorityAnchored: repaired.authorityAnchored,
    authorityReadSucceeded: authoritativeEvents !== null,
    physicalChanged: repaired.physicalChanged,
    indexRebuilt: repaired.indexRebuilt,
    chainStatus: verified.status,
    chainedEvents: verified.chainedEvents,
    expectedChainedEvents,
  };
}

async function killAtCut(home, sessionId, record, cut) {
  let killRequested = false;
  const result = await spawnCapture(
    process.execPath,
    [CRASH_WORKER, home, sessionId, record.toString("base64"), String(cut)],
    {
      timeoutMs: 30_000,
      acceptKilled: true,
      onStdout(stdout, child) {
        if (!killRequested && stdout.includes('"ready":true')) {
          killRequested = child.kill("SIGKILL");
        }
      },
    },
  );
  if (!killRequested) {
    throw new Error(`crash worker never accepted SIGKILL at byte cut ${cut}`);
  }
  const signal = result.signal || null;
  return {
    exitCode: result.code,
    signal,
    killRequested,
    killConfirmed: signal === "SIGKILL",
  };
}

async function killAtPipelinePoint(home, sessionId, point) {
  let killRequested = false;
  let ready = null;
  let lockOwnerMatched = false;
  const lockOwnerPath = `${join(
    home,
    "sessions",
    `${sessionId}.jsonl`,
  )}.lock/owner.json`;
  const result = await spawnCapture(
    process.execPath,
    [PIPELINE_CRASH_WORKER, home, sessionId, point],
    {
      env: {
        ...process.env,
        CHAINLESSCHAIN_HOME: home,
        CC_SESSION_SCALE_FAULT_INJECTION: "1",
      },
      timeoutMs: 30_000,
      acceptKilled: true,
      onStdout(stdout, child) {
        if (killRequested) return;
        for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
          try {
            const parsed = JSON.parse(line);
            if (!parsed?.ready || parsed.point !== point) continue;
            ready = parsed;
            try {
              const owner = JSON.parse(readFileSync(lockOwnerPath, "utf8"));
              lockOwnerMatched = owner?.pid === parsed.pid;
            } catch {
              // The kill must not depend on a diagnostic owner read. A failed
              // read remains a case failure through lockOwnerMatched=false.
            }
            killRequested = child.kill("SIGKILL");
            break;
          } catch {
            // The callback may observe a partial stdout chunk. The cumulative
            // buffer is parsed again when the next chunk arrives.
          }
        }
      },
    },
  );
  if (!killRequested || !ready) {
    throw new Error(`pipeline crash worker never accepted SIGKILL at ${point}`);
  }
  const signal = result.signal || null;
  return {
    exitCode: result.code,
    signal,
    killRequested,
    killConfirmed: signal === "SIGKILL",
    eventHash: ready.eventHash,
    lockOwnerMatched,
  };
}

async function runPipelineKillCase(
  store,
  sessionIndex,
  antiRollback,
  home,
  specification,
) {
  const {
    point,
    createsSession = false,
    posixOnly = false,
    canonicalMetaCommitted = false,
    activityCommitted = false,
    anchorCommitted = false,
    expectedBoundary,
  } = specification;
  if (posixOnly && process.platform === "win32") {
    return {
      pass: true,
      point,
      productionAppendEvent: true,
      skipped: true,
      reason:
        "Node does not expose a usable Windows directory fsync; file FlushFileBuffers remains covered",
      expectedBoundary,
    };
  }

  const sessionId = `scale-pipeline-${point}`;
  let baseline = null;
  if (!createsSession) {
    store.startSession(sessionId, { title: `pipeline ${point}` });
    baseline = store.readEvents(sessionId).at(-1);
  }
  const termination = await killAtPipelinePoint(home, sessionId, point);
  const sessionsDir = join(home, "sessions");
  const filePath = store.sessionPath(sessionId);
  const beforeDryRun = readFileSync(filePath);
  const sidecarBeforeRepair = sessionIndex.readSessionMeta(
    sessionsDir,
    sessionId,
  );
  const activityBeforeRepair = sessionIndex.readLatestSessionActivity(
    sessionsDir,
    sessionId,
  );
  // Capture the external witness before any store presence/verification read:
  // getSessionPresence deliberately adjudicates an exact transcript+meta pair
  // and may advance a stale external prefix as part of safe crash recovery.
  const anchorAtKillBoundary =
    antiRollback.readSessionAntiRollbackAnchor(sessionId);
  const verificationBeforeRepair = store.verifySession(sessionId);
  const anchorAfterPresenceAdjudication =
    antiRollback.readSessionAntiRollbackAnchor(sessionId);
  const expectedEventCount = createsSession ? 1 : 2;
  const baselineEventCount = createsSession ? null : 1;
  const expectedSidecarCount = canonicalMetaCommitted
    ? expectedEventCount
    : baselineEventCount;
  const expectedActivityCount = activityCommitted
    ? expectedEventCount
    : baselineEventCount;
  const expectedAnchorCount = anchorCommitted
    ? expectedEventCount
    : baselineEventCount;
  const expectedAnchorAfterPresenceCount = canonicalMetaCommitted
    ? expectedEventCount
    : expectedAnchorCount;
  const indexRepairRequired =
    expectedSidecarCount !== expectedEventCount ||
    expectedActivityCount !== expectedEventCount;
  const dryRun = store.repairSession(sessionId, { dryRun: true });
  const dryRunPreservedBytes = readFileSync(filePath).equals(beforeDryRun);
  const repaired = store.repairSession(sessionId);
  const repairedPreservedBytes = readFileSync(filePath).equals(beforeDryRun);
  const anchorImmediatelyAfterRepair =
    antiRollback.readSessionAntiRollbackAnchor(sessionId);
  const verification = store.verifySession(sessionId);
  const sidecarAfterRepair = sessionIndex.readSessionMeta(
    sessionsDir,
    sessionId,
  );
  const activityAfterRepair = sessionIndex.readLatestSessionActivity(
    sessionsDir,
    sessionId,
  );
  // A verified authority read is the restart adjudicator: it proves the old
  // external witness is an exact prefix before advancing it to the repaired
  // canonical head. This must never bless a forked/equal-count transcript.
  const recoveredEvents = store.readVerifiedEvents(sessionId);
  const anchorAfterAdjudication =
    antiRollback.readSessionAntiRollbackAnchor(sessionId);
  const expectedSidecarHash = canonicalMetaCommitted
    ? termination.eventHash
    : baseline?.hash || null;
  const pass =
    termination.killConfirmed === true &&
    termination.lockOwnerMatched === true &&
    verificationBeforeRepair.status === "verified" &&
    verificationBeforeRepair.chainedEvents === expectedEventCount &&
    (sidecarBeforeRepair?.event_count ?? null) === expectedSidecarCount &&
    (sidecarBeforeRepair?.last_hash ?? null) === expectedSidecarHash &&
    (activityBeforeRepair?.event_count ?? null) === expectedActivityCount &&
    (activityBeforeRepair?.last_hash ?? null) ===
      (activityCommitted ? termination.eventHash : baseline?.hash || null) &&
    (anchorAtKillBoundary?.eventCount ?? null) === expectedAnchorCount &&
    (anchorAtKillBoundary?.headHash ?? null) ===
      (anchorCommitted ? termination.eventHash : baseline?.hash || null) &&
    (anchorAfterPresenceAdjudication?.eventCount ?? null) ===
      expectedAnchorAfterPresenceCount &&
    (anchorAfterPresenceAdjudication?.headHash ?? null) ===
      (canonicalMetaCommitted || anchorCommitted
        ? termination.eventHash
        : baseline?.hash || null) &&
    dryRun.changed === false &&
    dryRun.physicalChanged === false &&
    dryRun.indexRepairRequired === indexRepairRequired &&
    dryRun.wouldChange === indexRepairRequired &&
    dryRun.action === (indexRepairRequired ? "rebuild-index" : "none") &&
    dryRun.indexAction === (indexRepairRequired ? "rebuild-index" : "none") &&
    dryRun.healthy === !indexRepairRequired &&
    dryRunPreservedBytes &&
    repaired.changed === indexRepairRequired &&
    repaired.physicalChanged === false &&
    repaired.indexChanged === indexRepairRequired &&
    repaired.indexRebuilt === indexRepairRequired &&
    repaired.healthy === true &&
    repaired.action === (indexRepairRequired ? "rebuild-index" : "none") &&
    repaired.discardedBytes === 0 &&
    repaired.discardedRecords === 0 &&
    repairedPreservedBytes &&
    repaired.authorityAnchored === true &&
    anchorImmediatelyAfterRepair?.eventCount === expectedEventCount &&
    anchorImmediatelyAfterRepair?.headHash === termination.eventHash &&
    verification.status === "verified" &&
    verification.chainedEvents === expectedEventCount &&
    sidecarAfterRepair?.event_count === expectedEventCount &&
    sidecarAfterRepair?.last_hash === termination.eventHash &&
    activityAfterRepair?.event_count === expectedEventCount &&
    activityAfterRepair?.last_hash === termination.eventHash &&
    recoveredEvents.length === expectedEventCount &&
    recoveredEvents.at(-1)?.hash === termination.eventHash &&
    anchorAfterAdjudication?.eventCount === expectedEventCount &&
    anchorAfterAdjudication?.headHash === termination.eventHash &&
    !existsSync(`${filePath}.lock`);
  return {
    pass,
    point,
    productionAppendEvent: true,
    createsSession,
    skipped: false,
    expectedBoundary,
    ...termination,
    stateBeforeRepair: {
      transcriptEvents: verificationBeforeRepair.chainedEvents,
      sidecarEvents: sidecarBeforeRepair?.event_count ?? null,
      activityEvents: activityBeforeRepair?.event_count ?? null,
      externalAnchorEvents: anchorAtKillBoundary?.eventCount ?? null,
      externalAnchorEventsAfterPresence:
        anchorAfterPresenceAdjudication?.eventCount ?? null,
    },
    dryRun: {
      action: dryRun.action,
      changed: dryRun.changed,
      wouldChange: dryRun.wouldChange,
      healthy: dryRun.healthy,
      bytesPreserved: dryRunPreservedBytes,
    },
    repair: {
      action: repaired.action,
      physicalChanged: repaired.physicalChanged,
      indexRebuilt: repaired.indexRebuilt,
      healthy: repaired.healthy,
      bytesPreserved: repairedPreservedBytes,
      authorityAnchored: repaired.authorityAnchored,
      externalAnchorEvents: anchorImmediatelyAfterRepair?.eventCount ?? null,
    },
    adjudication: {
      recoveredEvents: recoveredEvents.length,
      externalAnchorEvents: anchorAfterAdjudication?.eventCount ?? null,
      exactHead:
        anchorAfterAdjudication?.headHash === termination.eventHash &&
        recoveredEvents.at(-1)?.hash === termination.eventHash,
    },
    chainStatus: verification.status,
    chainedEvents: verification.chainedEvents,
    staleOwnerLockRecovered: !existsSync(`${filePath}.lock`),
  };
}

function chooseKillCuts(recordLength, count) {
  const completeJsonBytes = recordLength - 1;
  const cuts = new Set([
    1,
    Math.floor(completeJsonBytes / 4),
    Math.floor(completeJsonBytes / 2),
    completeJsonBytes - 1,
    completeJsonBytes,
    recordLength,
  ]);
  for (let index = 1; cuts.size < count && index < recordLength; index += 1) {
    cuts.add(Math.max(1, Math.round((index * recordLength) / (count + 1))));
  }
  return [...cuts]
    .filter((cut) => cut > 0 && cut <= recordLength)
    .slice(0, count);
}

async function runCrashRepairScenario(
  store,
  sessionIndex,
  antiRollback,
  computeEventHash,
  home,
  profile,
) {
  process.env.CHAINLESSCHAIN_HOME = home;
  const templateId = "scale-crash-template";
  store.startSession(templateId, { title: "crash template" });
  const template = buildNextRecord(
    store,
    computeEventHash,
    templateId,
    "template",
  );
  const recordBytes = template.length;
  const productionAppendPipelineKills = [];
  for (const specification of PRODUCTION_PIPELINE_KILL_POINTS) {
    productionAppendPipelineKills.push(
      await runPipelineKillCase(
        store,
        sessionIndex,
        antiRollback,
        home,
        specification,
      ),
    );
  }
  const actualKillResults = [];
  for (const [index, cut] of chooseKillCuts(
    template.length,
    profile.actualKillCases,
  ).entries()) {
    const sessionId = `scale-real-kill-${index}`;
    store.startSession(sessionId, { title: "real kill" });
    const record = buildNextRecord(
      store,
      computeEventHash,
      sessionId,
      `kill-${String(index).padStart(3, "0")}`,
    );
    const boundedCut = Math.min(cut, record.length);
    const termination = await killAtCut(home, sessionId, record, boundedCut);
    actualKillResults.push({
      ...termination,
      ...inspectRepairOutcome(store, sessionId, boundedCut, record.length),
    });
  }

  const exhaustiveCuts = profile.exhaustiveCuts
    ? Array.from({ length: recordBytes }, (_, index) => index + 1)
    : [
        1,
        Math.floor(recordBytes / 2),
        recordBytes - 2,
        recordBytes - 1,
        recordBytes,
      ];
  const exhaustiveFailures = [];
  for (const cut of [...new Set(exhaustiveCuts)]) {
    const sessionId = `scale-cut-${cut}`;
    store.startSession(sessionId, { title: "cut matrix" });
    const record = buildNextRecord(
      store,
      computeEventHash,
      sessionId,
      `cut-${String(cut).padStart(4, "0")}`,
    );
    const boundedCut = Math.min(cut, record.length);
    appendFileSync(
      store.sessionPath(sessionId),
      record.subarray(0, boundedCut),
    );
    const outcome = inspectRepairOutcome(
      store,
      sessionId,
      boundedCut,
      record.length,
    );
    if (!outcome.pass) exhaustiveFailures.push(outcome);
  }

  const tamperId = "scale-interior-tamper";
  store.startSession(tamperId, { title: "tamper" });
  store.appendEvent(tamperId, "scale_probe", { value: "original" });
  const tamperPath = store.sessionPath(tamperId);
  const tampered = readFileSync(tamperPath, "utf8").replace(
    '"original"',
    '"modified"',
  );
  writeFileSync(tamperPath, tampered, "utf8");
  const beforeRepair = readFileSync(tamperPath);
  const tamperRepair = store.repairSession(tamperId);
  const tamperUnchanged = readFileSync(tamperPath).equals(beforeRepair);

  const doublePartialId = "scale-double-partial";
  store.startSession(doublePartialId, { title: "double partial" });
  appendFileSync(store.sessionPath(doublePartialId), "{first-partial\n{tail");
  const doubleRepair = store.repairSession(doublePartialId);

  const violations = [];
  if (actualKillResults.length < profile.actualKillCases) {
    violations.push(
      `actual kill cases ${actualKillResults.length} < ${profile.actualKillCases}`,
    );
  }
  if (actualKillResults.some((item) => !item.pass)) {
    violations.push("one or more real kill cases repaired incorrectly");
  }
  if (actualKillResults.some((item) => item.killConfirmed !== true)) {
    violations.push(
      "one or more partial-record SIGKILL requests were not confirmed",
    );
  }
  if (productionAppendPipelineKills.some((item) => !item.pass)) {
    violations.push(
      "one or more production append pipeline kills repaired incorrectly",
    );
  }
  if (exhaustiveFailures.length > 0) {
    violations.push(
      `${exhaustiveFailures.length} byte cuts repaired incorrectly`,
    );
  }
  if (
    tamperRepair.healthy !== false ||
    tamperRepair.changed !== false ||
    !tamperUnchanged
  ) {
    violations.push("interior tampering was rewritten or reported healthy");
  }
  if (
    doubleRepair.discardedRecords > 1 ||
    doubleRepair.healthy !== false ||
    doubleRepair.status !== "tampered"
  ) {
    violations.push("multiple partial records were hidden by repair");
  }
  return {
    pass: violations.length === 0,
    recordBytes: template.length,
    faultModel: {
      kind: "process-sigkill-at-production-persistence-boundary",
      namedHostCallCompletesBeforeKill: true,
      physicalPowerLossSimulated: false,
      preexistingDurableStateRootsRequired: true,
      windowsDirectoryFsyncAvailableThroughNode: false,
      allowedRestartOutcomes: ["exact-old", "exact-new", "blocked"],
    },
    actualProcessKillsTotal:
      actualKillResults.filter((item) => item.killConfirmed === true).length +
      productionAppendPipelineKills.filter(
        (item) => !item.skipped && item.killConfirmed === true,
      ).length,
    partialRecordProcessKills: actualKillResults,
    productionAppendPipelineKills,
    byteCutCoverage: {
      exhaustive: profile.exhaustiveCuts,
      testedCuts: new Set(exhaustiveCuts).size,
      firstCut: Math.min(...exhaustiveCuts),
      lastCut: Math.max(...exhaustiveCuts),
      failures: exhaustiveFailures.slice(0, 10),
    },
    honestRepairGuards: {
      interiorTamper: {
        healthy: tamperRepair.healthy,
        changed: tamperRepair.changed,
        bytesUnchanged: tamperUnchanged,
        status: tamperRepair.status,
      },
      multiplePartialRecords: {
        healthy: doubleRepair.healthy,
        changed: doubleRepair.changed,
        discardedRecords: doubleRepair.discardedRecords,
        status: doubleRepair.status,
      },
    },
    violations,
  };
}

function outputPath() {
  return (
    process.env.CC_SESSION_SCALE_OUTPUT ||
    join(tmpdir(), `cli-session-scale-${process.platform}-${process.pid}.json`)
  );
}

function writeResult(filePath, result) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export async function runSessionScaleGate() {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const resultFile = outputPath();
  const result = {
    schema: RESULT_SCHEMA,
    startedAt,
    status: "running",
    exactSha: null,
    expectedSha:
      String(process.env.CC_SESSION_SCALE_EXPECTED_SHA || "")
        .trim()
        .toLowerCase() || null,
    treeSha: null,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    parameters: null,
    scenarios: {},
    violations: [],
  };
  let root = null;
  try {
    const profile = resolveSessionScaleProfile();
    result.parameters = profile;
    const repository = exactRepositoryState();
    result.exactSha = repository.commitSha;
    result.treeSha = repository.treeSha;
    result.trackedWorktreeDirty = repository.trackedWorktreeDirty;
    result.gateSourcePathsExact = repository.gateSourcePathsExact;
    if (!/^[0-9a-f]{40,64}$/.test(repository.commitSha)) {
      result.violations.push("could not resolve an exact commit SHA");
    }
    if (result.expectedSha && result.expectedSha !== repository.commitSha) {
      result.violations.push(
        "gate checkout does not match its expected exact SHA",
      );
    }
    if (profile.mode === "formal" && !result.expectedSha) {
      result.violations.push("formal gate requires an expected exact SHA");
    }
    if (
      profile.mode === "formal" &&
      (repository.trackedWorktreeDirty || !repository.gateSourcePathsExact)
    ) {
      result.violations.push(
        "formal gate requires exact committed sources and a clean tracked worktree",
      );
    }
    if (profile.mode === "formal" && result.violations.length > 0) {
      throw new Error("formal session-scale provenance validation failed");
    }

    root = mkdtempSync(join(tmpdir(), "cc-session-scale-"));
    process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = join(
      root,
      "security-anchors",
    );
    const firstHome = join(root, "concurrency-home");
    mkdirSync(firstHome, { recursive: true });
    process.env.CHAINLESSCHAIN_HOME = firstHome;
    const store = await import("../src/harness/jsonl-session-store.js");
    const { computeEventHash } =
      await import("../src/harness/transcript-integrity.js");
    const sessionIndex = await import("../src/harness/session-list-index.js");
    const antiRollback =
      await import("../src/lib/session-anti-rollback-anchor.js");

    const runScenario = async (name, task) => {
      const scenarioStarted = performance.now();
      try {
        result.scenarios[name] = await task();
      } catch (error) {
        result.scenarios[name] = {
          pass: false,
          error: {
            name: error?.name || "Error",
            code: error?.code || null,
            message: String(error?.message || error),
          },
          violations: [String(error?.message || error)],
        };
      }
      result.scenarios[name].durationMs = performance.now() - scenarioStarted;
    };

    await runScenario("concurrentAppend", () =>
      runConcurrencyScenario(store, firstHome, profile),
    );
    const indexHome = join(root, "index-home");
    mkdirSync(indexHome, { recursive: true });
    await runScenario("indexedList", () =>
      runIndexScenario(indexHome, profile, computeEventHash),
    );
    const resumeHome = join(root, "resume-home");
    mkdirSync(resumeHome, { recursive: true });
    await runScenario("checkpointResume", () =>
      runResumeScenario(
        store,
        sessionIndex,
        resumeHome,
        profile,
        computeEventHash,
      ),
    );
    const crashHome = join(root, "crash-home");
    mkdirSync(crashHome, { recursive: true });
    await runScenario("crashRepair", () =>
      runCrashRepairScenario(
        store,
        sessionIndex,
        antiRollback,
        computeEventHash,
        crashHome,
        profile,
      ),
    );

    for (const [name, scenario] of Object.entries(result.scenarios)) {
      if (scenario.pass !== true) {
        result.violations.push(`${name} did not pass`);
      }
    }
    result.status = result.violations.length === 0 ? "passed" : "failed";
  } catch (error) {
    result.status = "failed";
    result.violations.push(String(error?.message || error));
    result.fatalError = {
      name: error?.name || "Error",
      code: error?.code || null,
      message: String(error?.message || error),
      stack: error?.stack || null,
    };
  } finally {
    if (root && existsSync(root)) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        result.status = "failed";
        result.violations.push(
          `session scale fixture cleanup failed: ${String(error?.message || error)}`,
        );
      }
    }
    result.completedAt = new Date().toISOString();
    result.durationMs = performance.now() - started;
    writeResult(resultFile, result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`session scale artifact: ${resultFile}\n`);
  }
  if (result.status !== "passed") process.exitCode = 1;
  return result;
}

const invokedAsScript =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) await runSessionScaleGate();
