#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  releaseOldLiveSessionResults,
  SESSION_RUNTIME_RELEASE_MARKER,
  SESSION_RUNTIME_RETENTION_LIMITS,
} from "../src/lib/session-runtime-retention.js";
import { BACKGROUND_SESSION_BACKLOG_LIMITS } from "../src/lib/background-session-transport.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../../..");
const RESULT_SCHEMA = "chainlesschain.session-runtime-retention.v1";
const REQUIRED_RESULTS = 5_000;
const REQUIRED_RESULT_BYTES = 32 * 1024;
const MAX_HEAP_DELTA_BYTES = 128 * 1024 * 1024;
const MAX_GC_SAMPLE_DIFFERENCE_RATIO = 0.1;
const SCAN_CHUNK_BYTES = 64 * 1024;
const CONTRACT_TESTS = [
  "__tests__/unit/session-runtime-retention.test.js",
  "__tests__/unit/background-session-transport.test.js",
  "__tests__/unit/background-session-command.test.js",
  "__tests__/unit/agent-core-compact-persist.test.js",
];
const PRODUCERS = [
  "package.json",
  ".github/workflows/cli-session-scale.yml",
  ".github/workflows/cli-reliability-soak.yml",
  ".github/workflows/ide-roadmap-accessibility-performance.yml",
  "packages/cli/scripts/verify-session-runtime-retention.mjs",
  "packages/cli/src/lib/session-runtime-retention.js",
  "packages/cli/src/lib/background-session-transport.js",
  "packages/cli/src/commands/background-session.js",
  "packages/cli/src/runtime/agent-core.js",
  "packages/cli/__tests__/unit/session-runtime-retention.test.js",
  "packages/cli/__tests__/unit/background-session-transport.test.js",
  "packages/cli/__tests__/unit/background-session-command.test.js",
  "packages/cli/__tests__/unit/agent-core-compact-persist.test.js",
];

function parseArgs(argv) {
  const parsed = {
    smoke: false,
    allowDirty: false,
    output: process.env.CC_SESSION_RUNTIME_OUTPUT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--smoke") parsed.smoke = true;
    else if (arg === "--allow-dirty") parsed.allowDirty = true;
    else if (arg === "--output") parsed.output = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function exactHeadProducers(headSha, allowMismatch) {
  return PRODUCERS.map((repoPath) => {
    const disk = execFileSync(process.execPath, [
      "-e",
      "const fs=require('node:fs');process.stdout.write(fs.readFileSync(process.argv[1]))",
      resolve(REPO_ROOT, repoPath),
    ]);
    const diskDigest = sha256(disk);
    let headDigest = null;
    try {
      headDigest = sha256(
        execFileSync("git", ["show", `${headSha}:${repoPath}`], {
          cwd: REPO_ROOT,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
    } catch {
      if (!allowMismatch) {
        throw new Error(`${repoPath} is absent from exact head ${headSha}`);
      }
    }
    if (!allowMismatch && diskDigest !== headDigest) {
      throw new Error(`${repoPath} does not match exact head ${headSha}`);
    }
    return { path: repoPath, sha256: diskDigest, headSha256: headDigest };
  });
}

function resultBody(index, bytes) {
  const prefix = `subagent-result-${String(index).padStart(5, "0")}:`;
  return prefix.padEnd(bytes, String(index % 10));
}

async function stabilizedHeapSample() {
  for (let index = 0; index < 3; index += 1) {
    global.gc();
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
  }
  return process.memoryUsage().heapUsed;
}

async function scanDurableEvidence(filePath, expectedResults) {
  const stream = createReadStream(filePath, {
    highWaterMark: SCAN_CHUNK_BYTES,
  });
  let maxChunkBytes = 0;
  stream.on("data", (chunk) => {
    maxChunkBytes = Math.max(maxChunkBytes, chunk.length);
  });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const digest = createHash("sha256");
  let count = 0;
  for await (const line of lines) {
    const record = JSON.parse(line);
    digest.update(`${record.id}\0${record.result}\n`, "utf8");
    count += 1;
  }
  if (count !== expectedResults) {
    throw new Error(`durable evidence count ${count} != ${expectedResults}`);
  }
  return { count, sha256: digest.digest("hex"), maxChunkBytes };
}

function runContractTests() {
  const startedAt = Date.now();
  execFileSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", ...CONTRACT_TESTS],
    {
      cwd: resolve(REPO_ROOT, "packages/cli"),
      stdio: "inherit",
    },
  );
  return { files: [...CONTRACT_TESTS], durationMs: Date.now() - startedAt };
}

async function runProfile(options) {
  if (typeof global.gc !== "function") {
    throw new Error("SESSION-RUNTIME profile requires node --expose-gc");
  }
  const resultCount = options.smoke ? 160 : REQUIRED_RESULTS;
  const resultBytes = options.smoke ? 4 * 1024 : REQUIRED_RESULT_BYTES;
  const recentResults = SESSION_RUNTIME_RETENTION_LIMITS.recentResults;
  const headSha = git("rev-parse", "HEAD");
  const producers = exactHeadProducers(
    headSha,
    options.smoke || options.allowDirty,
  );
  const contractTests = runContractTests();
  const profileRoot = mkdtempSync(join(tmpdir(), "cc-session-runtime-"));
  const evidencePath = join(profileRoot, "durable-results.ndjson");
  const fd = openSync(evidencePath, "wx", 0o600);
  const expectedDigest = createHash("sha256");
  let liveMessages = [];
  let retention;
  try {
    const baselineHeapBytes = await stabilizedHeapSample();
    for (let index = 0; index < resultCount; index += 1) {
      const result = resultBody(index, resultBytes);
      const line = `${JSON.stringify({ id: index, result })}\n`;
      writeSync(fd, line, null, "utf8");
      expectedDigest.update(`${index}\0${result}\n`, "utf8");
      liveMessages.push({
        role: "tool",
        tool_call_id: `subagent-${index}`,
        content: result,
      });
    }
    closeSync(fd);

    retention = releaseOldLiveSessionResults(liveMessages, { recentResults });
    liveMessages = retention.messages;
    const firstGcHeapBytes = await stabilizedHeapSample();
    const secondGcHeapBytes = await stabilizedHeapSample();
    const heapDeltaBytes = Math.max(
      0,
      Math.max(firstGcHeapBytes, secondGcHeapBytes) - baselineHeapBytes,
    );
    const gcSampleDifferenceRatio =
      Math.abs(firstGcHeapBytes - secondGcHeapBytes) /
      Math.max(firstGcHeapBytes, secondGcHeapBytes, 1);

    const releasedCount = resultCount - recentResults;
    const releasedMessages = liveMessages.slice(0, releasedCount);
    const recentMessages = liveMessages.slice(-recentResults);
    if (retention.stats.released !== releasedCount) {
      throw new Error(
        `released result count ${retention.stats.released} != ${releasedCount}`,
      );
    }
    if (
      releasedMessages.some(
        (message) =>
          message.content.length >
            SESSION_RUNTIME_RETENTION_LIMITS.retainedResultChars ||
          !message.content.includes(SESSION_RUNTIME_RELEASE_MARKER),
      )
    ) {
      throw new Error("an old live result escaped the bounded projection");
    }
    if (
      recentMessages.some((message) => message.content.length !== resultBytes)
    ) {
      throw new Error("the recent result window lost full result content");
    }
    if (gcSampleDifferenceRatio > MAX_GC_SAMPLE_DIFFERENCE_RATIO) {
      throw new Error(
        `stabilized GC difference ${(gcSampleDifferenceRatio * 100).toFixed(2)}% exceeds 10%`,
      );
    }
    if (heapDeltaBytes > MAX_HEAP_DELTA_BYTES) {
      throw new Error(`heap delta ${heapDeltaBytes} exceeds 128 MiB`);
    }

    const durable = await scanDurableEvidence(evidencePath, resultCount);
    const expectedEvidenceDigest = expectedDigest.digest("hex");
    if (durable.sha256 !== expectedEvidenceDigest) {
      throw new Error("incremental durable evidence digest mismatch");
    }
    if (durable.maxChunkBytes > SCAN_CHUNK_BYTES) {
      throw new Error("durable transcript scan exceeded its chunk cap");
    }

    return {
      schema: RESULT_SCHEMA,
      disposition: options.smoke
        ? "advisory-smoke"
        : options.allowDirty
          ? "local-non-qualifying"
          : "required",
      passed: true,
      headSha,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      profile: {
        resultCount,
        resultBytes,
        recentResults,
        maxHeapDeltaBytes: MAX_HEAP_DELTA_BYTES,
        maxGcSampleDifferenceRatio: MAX_GC_SAMPLE_DIFFERENCE_RATIO,
        transcriptScanChunkBytes: SCAN_CHUNK_BYTES,
        backlog: BACKGROUND_SESSION_BACKLOG_LIMITS,
      },
      measurements: {
        baselineHeapBytes,
        firstGcHeapBytes,
        secondGcHeapBytes,
        heapDeltaBytes,
        gcSampleDifferenceRatio,
        releasedResults: retention.stats.released,
        savedChars: retention.stats.savedChars,
        durableEvidenceRecords: durable.count,
        durableEvidenceSha256: durable.sha256,
        maxTranscriptScanChunkBytes: durable.maxChunkBytes,
      },
      testIds: [
        "SESSION-RUNTIME-5000X32K-HEAP",
        "SESSION-RUNTIME-DURABLE-EVIDENCE",
        "SESSION-RUNTIME-INCREMENTAL-SCAN",
        "SESSION-RUNTIME-BACKLOG-CAPS",
        "SESSION-RUNTIME-RESUME-SEMANTICS",
      ],
      contractTests,
      producers,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
    liveMessages = [];
    retention = null;
    rmSync(profileRoot, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv.slice(2));
const result = await runProfile(options);
const output = resolve(
  options.output ||
    join(tmpdir(), `session-runtime-retention-${process.platform}.json`),
);
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log(
  JSON.stringify({
    passed: result.passed,
    headSha: result.headSha,
    heapDeltaBytes: result.measurements.heapDeltaBytes,
    gcSampleDifferenceRatio: result.measurements.gcSampleDifferenceRatio,
    output: relative(REPO_ROOT, output) || basename(output),
  }),
);
