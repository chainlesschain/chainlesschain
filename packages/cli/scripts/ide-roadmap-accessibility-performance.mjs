#!/usr/bin/env node
/* global document, getComputedStyle, requestAnimationFrame, window */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PROFILE_VERSION as INPUT_PERFORMANCE_PROFILE_VERSION,
  SOURCE_PATHS as INPUT_PERFORMANCE_SOURCE_PATHS,
  THRESHOLDS as INPUT_PERFORMANCE_THRESHOLDS,
  canonicalOs,
} from "./ide-input-performance-profile.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const requireFromRoot = createRequire(
  path.join(REPOSITORY_ROOT, "package.json"),
);
const requireFromCli = createRequire(
  path.join(REPOSITORY_ROOT, "packages/cli/package.json"),
);
const { buildChatHtml, TRANSCRIPT_ENTRY_MAX_CHARS } = requireFromRoot(
  "./packages/vscode-extension/src/chat/chat-html.js",
);
const { renderWorkbenchHtml, WORKBENCH_SESSION_LIMIT } = requireFromRoot(
  "./packages/vscode-extension/src/sessions-workbench.js",
);
const { DiagnosticsSnapshotScheduler } = requireFromRoot(
  "./packages/vscode-extension/src/diagnostics-scheduler.js",
);

const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const MIB = 1024 * 1024;
const PROFILE = Object.freeze({
  messagesPerSession: 2_000,
  diffBytes: 16 * MIB,
  logBytes: 64 * MIB,
  sessionCount: 128,
  transcriptPaintSamples: 100,
  scrollPaintSamples: 100,
  thresholds: Object.freeze({
    inputToPaintP99Ms: 1_000,
    scrollP99Ms: 500,
    diffPaintMs: 5_000,
    logPaintMs: 5_000,
    workbenchPaintMs: 3_000,
    nodeRssGrowthBytes: 512 * MIB,
    rendererHeapGrowthBytes: 256 * MIB,
    descriptorOrHandleGrowth: 32,
  }),
});
const DIAGNOSTICS_PROFILE = Object.freeze({
  profileVersion: "diagnostics-scale/v1",
  requiredCount: 10_000,
  advisoryCount: 50_000,
  requiredSamples: 20,
  advisorySamples: 5,
  thresholds: Object.freeze({
    stableSnapshotP95Ms: 1_000,
    eventLoopOrEdtMaxMs: 200,
    nodeRssGrowthBytes: 512 * MIB,
    rendererHeapGrowthBytes: 256 * MIB,
    lostCount: 0,
    duplicateCount: 0,
    staleVersionCount: 0,
  }),
});
const DIAGNOSTIC_TEST_IDS = Object.freeze([
  "DIAG-SCALE/vscode-10k-stable-snapshot",
  "DIAG-SCALE/jetbrains-10k-stable-snapshot",
]);
const REQUIRED_FILES = Object.freeze([
  "exact-commit.json",
  "host-environment.json",
  "assistive-technology.json",
  "keyboard-action-ledger.json",
  "accessibility-tree.json",
  "screen-reader-transcript.json",
  "focus-transition-ledger.json",
  "large-input-digests.json",
  "performance-samples.json",
  "resource-trajectory.json",
  "diagnostics-scale.json",
  "jetbrains-native.json",
  "ide-input-performance.json",
  "outcome-observations.json",
]);
const ACCESSIBILITY_WORKFLOW_PATH =
  ".github/workflows/ide-roadmap-accessibility-performance.yml";
const GATE_SOURCE_PATHS = Object.freeze([
  ACCESSIBILITY_WORKFLOW_PATH,
  "packages/cli/scripts/ide-roadmap-accessibility-performance.mjs",
  "packages/cli/scripts/verify-ide-roadmap-accessibility-performance.mjs",
  "packages/cli/__tests__/unit/ide-roadmap-accessibility-performance.test.js",
  "packages/cli/scripts/ide-input-performance-profile.mjs",
  "packages/cli/__tests__/unit/ide-input-performance.test.js",
  "packages/vscode-extension/src/chat/workspace-mention-index.js",
  "packages/vscode-extension/src/chat/chat-view.js",
  "packages/vscode-extension/src/chat/chat-html.js",
  "packages/vscode-extension/src/chat/symbol-mentions.js",
  "packages/vscode-extension/src/sessions-workbench.js",
  "packages/vscode-extension/src/diagnostics-scheduler.js",
  "packages/vscode-extension/src/vscode-facade.js",
  "packages/vscode-extension/test/host-dom-relay.test.cjs",
  "packages/cli/__tests__/unit/vscode-ext-diagnostics-scheduler.test.js",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/DiagnosticsSnapshotScheduler.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/IntellijEditorFacade.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/IdeBridgeService.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ContextCenterAction.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/TranscriptCap.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/SessionsWorkbench.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/Mentions.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/WorkspaceMentionIndex.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ChatMentionPopups.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ChatTranscript.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ConversationView.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/TranscriptCapTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/SessionsWorkbenchTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/DiagnosticsSnapshotSchedulerTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/ChatTranscriptTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/AccessibilityPerformanceEvidenceTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/WorkspaceMentionIndexPerformanceProfile.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/WorkspaceMentionIndexPerformanceTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/WorkspaceMentionIndexTest.java",
  "tests/fixtures/ide-roadmap/p2-accessibility-performance.json",
]);
const DIAGNOSTIC_PRODUCER_PATHS = Object.freeze([
  "packages/vscode-extension/src/diagnostics-scheduler.js",
  "packages/vscode-extension/src/vscode-facade.js",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/DiagnosticsSnapshotScheduler.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/IntellijEditorFacade.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/IdeBridgeService.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ContextCenterAction.java",
  "packages/cli/scripts/ide-roadmap-accessibility-performance.mjs",
  "packages/cli/scripts/verify-ide-roadmap-accessibility-performance.mjs",
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    assert.ok(argv[index]?.startsWith("--") && argv[index + 1]);
    options[
      argv[index]
        .slice(2)
        .replace(/-([a-z])/gu, (_, character) => character.toUpperCase())
    ] = argv[index + 1];
  }
  return options;
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function digestLargePayload(
  totalBytes,
  prefix,
  suffix,
  character,
  secret,
  command,
) {
  const middle = totalBytes - prefix.length - suffix.length;
  const left = Math.floor((middle - secret.length - command.length) / 2);
  const right = middle - secret.length - command.length - left;
  const hash = crypto.createHash("sha256");
  const updateRepeated = (count) => {
    const chunk = Buffer.alloc(MIB, character);
    let remaining = count;
    while (remaining > 0) {
      const size = Math.min(remaining, chunk.length);
      hash.update(size === chunk.length ? chunk : chunk.subarray(0, size));
      remaining -= size;
    }
  };
  hash.update(prefix);
  updateRepeated(left);
  hash.update(secret);
  hash.update(command);
  updateRepeated(right);
  hash.update(suffix);
  return `sha256:${hash.digest("hex")}`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function percentile(values, percentileValue) {
  assert.ok(values.length > 0);
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil((percentileValue / 100) * ordered.length) - 1,
  );
  return ordered[index];
}

function summarizeSamples(values) {
  assert.ok(values.every((value) => Number.isFinite(value) && value >= 0));
  return {
    samples: values.length,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    p99Ms: percentile(values, 99),
    maxMs: Math.max(...values),
  };
}

function diagnosticsUpdate(count, version, prefix) {
  const uri = "file:///workspace/diagnostics-scale.js";
  return {
    uri,
    file: "/workspace/diagnostics-scale.js",
    documentVersion: version,
    isDirty: false,
    read: () =>
      Array.from({ length: count }, (_, index) => ({
        documentUri: uri,
        documentVersion: version,
        severity: ["error", "warning", "information", "hint"][index % 4],
        message: `${prefix} diagnostic ${index}`,
        line: index,
        character: 0,
        source: "diagnostics-scale-fixture",
      })),
  };
}

async function runDiagnosticsScaleProfile({
  count,
  samples,
  disposition,
  maxDiagnostics = DIAGNOSTICS_PROFILE.requiredCount,
}) {
  const rssBefore = process.memoryUsage().rss;
  const heapBefore = process.memoryUsage().heapUsed;
  const scheduler = new DiagnosticsSnapshotScheduler({
    debounceMs: 0,
    maxDiagnostics,
  });
  const durations = [];
  let snapshot = scheduler.getSnapshot();
  try {
    for (let sample = 0; sample < samples; sample += 1) {
      const oldVersion = sample * 2 + 1;
      const finalVersion = oldVersion + 1;
      scheduler.schedule([
        diagnosticsUpdate(count, oldVersion, "old-generation"),
      ]);
      const started = performance.now();
      scheduler.schedule([
        diagnosticsUpdate(count, finalVersion, "stable-generation"),
      ]);
      snapshot = await scheduler.flushNow();
      durations.push(performance.now() - started);
    }
    const stats = scheduler.getStats();
    const rssAfter = process.memoryUsage().rss;
    const heapAfter = process.memoryUsage().heapUsed;
    const truncatedCount = snapshot.summary.truncatedCount;
    return {
      host: "vscode",
      disposition,
      inputCount: count,
      maxDiagnostics,
      publishedCount: snapshot.summary.total,
      truncatedCount,
      lostCount: Math.max(0, count - snapshot.summary.total - truncatedCount),
      duplicateCount: stats.publishedDuplicateCount,
      staleVersionCount: stats.publishedStaleVersionCount,
      canceledGenerationCount: stats.canceledGenerationCount,
      stableSnapshot: summarizeSamples(durations),
      eventLoopMaxMs: stats.maxWorkSliceMs,
      nodeRssGrowthBytes: Math.max(0, rssAfter - rssBefore),
      nodeHeapGrowthBytes: Math.max(0, heapAfter - heapBefore),
      snapshotDigest: digest(
        JSON.stringify({
          generation: snapshot.generation,
          summary: snapshot.summary,
          versions: snapshot.versions,
        }),
      ),
    };
  } finally {
    scheduler.dispose();
  }
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4 * MIB,
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
    if (error?.status === 1 || error?.status === 128) return false;
    throw error;
  }
}

function assertExactCheckout(releaseCommit) {
  assert.match(releaseCommit, SHA_RE);
  assert.equal(git("rev-parse", "HEAD").toLowerCase(), releaseCommit);
  assert.ok(
    GATE_SOURCE_PATHS.every((filePath) =>
      gitSucceeds("ls-files", "--error-unmatch", "--", filePath),
    ),
    "all accessibility/performance gate sources must be tracked",
  );
  assert.ok(
    gitSucceeds("diff", "--quiet", "HEAD", "--", ...GATE_SOURCE_PATHS),
    "accessibility/performance gate sources differ from exact HEAD",
  );
}

function readGitBlob(commit, filePath) {
  return execFileSync("git", ["show", `${commit}:${filePath}`], {
    cwd: REPOSITORY_ROOT,
    maxBuffer: 8 * MIB,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function verifyAccessibilityWorkflowAuthority({
  releaseCommit,
  workflowSha,
  workflowRef,
  required = false,
  githubActions = process.env.GITHUB_ACTIONS,
  producerReader = readGitBlob,
}) {
  assert.match(releaseCommit, SHA_RE);
  if (!required) return null;
  assert.equal(githubActions, "true", "required evidence must run in Actions");
  assert.match(workflowSha || "", SHA_RE, "workflow SHA");
  assert.match(
    workflowRef || "",
    new RegExp(
      `^[^/]+/[^/]+/${ACCESSIBILITY_WORKFLOW_PATH.replaceAll(".", "\\.")}@`,
      "u",
    ),
    "workflow ref",
  );
  const candidateBytes = producerReader(
    releaseCommit,
    ACCESSIBILITY_WORKFLOW_PATH,
  );
  const executedBytes = producerReader(workflowSha, ACCESSIBILITY_WORKFLOW_PATH);
  assert.equal(
    digest(executedBytes),
    digest(candidateBytes),
    "executed workflow bytes differ from the exact release commit",
  );
  return digest(candidateBytes);
}

function platformSuffix(platform = process.platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  throw new Error(`unsupported operating system: ${platform}`);
}

function expectedAssistiveTechnology(platform = process.platform) {
  if (platform === "win32") return "nvda";
  if (platform === "darwin") return "voiceover";
  if (platform === "linux") return "orca";
  throw new Error(`unsupported operating system: ${platform}`);
}

function validateAtProbe(probe, platform = process.platform) {
  assert.equal(probe.schema, "chainlesschain.assistive-technology-probe.v1");
  assert.equal(probe.technology, expectedAssistiveTechnology(platform));
  assert.equal(probe.binaryPresent, true);
  assert.equal(probe.speechQualityAssessed, false);
  if (platform === "darwin") {
    assert.equal(probe.externalManualRequired, true);
    assert.equal(probe.automatedProcessProbeComplete, false);
  } else {
    assert.equal(probe.externalManualRequired, false);
    assert.equal(probe.automatedProcessProbeComplete, true);
  }
  assert.match(probe.versionDigest || "", DIGEST_RE);
  return probe;
}

function validateJetBrainsEvidence(evidence) {
  assert.equal(
    evidence.schema,
    "chainlesschain.jetbrains-accessibility-performance.v1",
  );
  assert.equal(
    evidence.measurementSurface,
    "headless-swing-product-components",
  );
  assert.equal(evidence.messageCount, PROFILE.messagesPerSession);
  assert.equal(evidence.diffBytes, PROFILE.diffBytes);
  assert.equal(evidence.logBytes, PROFILE.logBytes);
  assert.equal(evidence.sessionCount, PROFILE.sessionCount);
  for (const field of [
    "transcriptBounded",
    "diffMarkerVisible",
    "logMarkerVisible",
    "accessibleNamePresent",
    "accessibleDescriptionPresent",
    "focusable",
    "sessionProjectionComplete",
  ]) {
    assert.equal(evidence[field], true, `JetBrains ${field}`);
  }
  for (const metric of ["inputToPaint", "scrollToPaint"]) {
    assert.equal(evidence[metric]?.samples, 100);
    for (const field of ["p50Ms", "p95Ms", "p99Ms"]) {
      assert.ok(Number.isFinite(evidence[metric]?.[field]));
    }
  }
  assert.equal(evidence.inputToPaintSamplesMs?.length, 100);
  assert.equal(evidence.scrollToPaintSamplesMs?.length, 100);
  assert.equal(typeof evidence.javaVersion, "string");
  assert.equal(typeof evidence.javaArch, "string");
  const diagnostics = evidence.diagnosticsScaleRequired;
  assert.equal(diagnostics?.inputCount, DIAGNOSTICS_PROFILE.requiredCount);
  assert.equal(diagnostics?.publishedCount, DIAGNOSTICS_PROFILE.requiredCount);
  assert.equal(diagnostics?.truncatedCount, 0);
  assert.equal(diagnostics?.lostCount, 0);
  assert.equal(diagnostics?.duplicateCount, 0);
  assert.equal(diagnostics?.staleVersionCount, 0);
  assert.ok(diagnostics?.canceledGenerationCount > 0);
  assert.equal(
    diagnostics?.stableSnapshot?.samples,
    DIAGNOSTICS_PROFILE.requiredSamples,
  );
  assert.ok(
    diagnostics?.stableSnapshot?.p95Ms <=
      DIAGNOSTICS_PROFILE.thresholds.stableSnapshotP95Ms,
  );
  assert.ok(
    diagnostics?.maxWorkSliceMs <=
      DIAGNOSTICS_PROFILE.thresholds.eventLoopOrEdtMaxMs,
  );
  assert.ok(
    diagnostics?.edtMaxMs <= DIAGNOSTICS_PROFILE.thresholds.eventLoopOrEdtMaxMs,
  );
  assert.ok(
    diagnostics?.heapGrowthBytes <=
      DIAGNOSTICS_PROFILE.thresholds.rendererHeapGrowthBytes,
  );
  return evidence;
}

function validateInputPerformanceEvidence(
  evidence,
  releaseCommit,
  platform,
  expectedSource,
) {
  assert.equal(
    evidence.schema,
    "chainlesschain.claude-code-increment-audit-fragment.v1",
  );
  assert.equal(evidence.commitmentId, "IDE-INPUT-PERF");
  assert.equal(evidence.headSha, releaseCommit);
  assert.equal(evidence.os, canonicalOs(platform));
  assert.equal(evidence.profileVersion, INPUT_PERFORMANCE_PROFILE_VERSION);
  assert.deepEqual(evidence.thresholds, INPUT_PERFORMANCE_THRESHOLDS);
  assert.equal(evidence.disposition, "required");
  assert.equal(evidence.outcome, "passed");
  assert.equal(evidence.runtime?.name, "node+java");
  const runtimeVersions = String(evidence.runtime?.version || "").split(";");
  assert.equal(runtimeVersions.length, 2);
  assert.ok(runtimeVersions.every((version) => version.length > 0));
  assert.ok(String(evidence.runtime?.arch || "").length > 0);
  assert.ok(Array.isArray(evidence.testIds) && evidence.testIds.length >= 2);
  for (const host of ["vscode", "jetbrains"]) {
    const measurement = evidence.measurements?.[host];
    assert.equal(
      measurement?.pathCount,
      INPUT_PERFORMANCE_THRESHOLDS.pathCount,
    );
    assert.equal(
      measurement?.consecutiveQueries,
      INPUT_PERFORMANCE_THRESHOLDS.consecutiveQueries,
    );
    assert.equal(
      measurement?.rapidQueries,
      INPUT_PERFORMANCE_THRESHOLDS.rapidQueries,
    );
    assert.equal(
      measurement?.samplesMs?.length,
      INPUT_PERFORMANCE_THRESHOLDS.consecutiveQueries,
    );
    assert.ok(
      measurement.samplesMs.every(
        (sample) => Number.isFinite(sample) && sample >= 0,
      ),
    );
    assert.ok(
      Number.isFinite(measurement.p50Ms) &&
        measurement.p50Ms <= measurement.p95Ms &&
        measurement.p95Ms <= measurement.p99Ms,
    );
    assert.ok(measurement?.p95Ms <= INPUT_PERFORMANCE_THRESHOLDS.p95Ms);
    assert.ok(
      measurement?.maxCandidates <= INPUT_PERFORMANCE_THRESHOLDS.maxCandidates,
    );
    assert.equal(measurement?.staleCommitCount, 0);
    assert.ok(
      measurement?.cancellationCount >=
        INPUT_PERFORMANCE_THRESHOLDS.rapidQueries - 1,
    );
    assert.ok(
      measurement?.discardedQueryCount >=
        INPUT_PERFORMANCE_THRESHOLDS.rapidQueries - 1,
    );
    assert.ok(measurement?.deniedPathCount >= 2);
    assert.equal(measurement?.leakCount, 0);
    assert.equal(measurement?.contentReadCount, 0);
    assert.equal(measurement?.symbolObserved, true);
    assert.equal(measurement?.workspaceTrustEnforced, true);
  }
  assert.deepEqual(
    Object.keys(evidence.producerDigests || {}).sort(),
    [...INPUT_PERFORMANCE_SOURCE_PATHS].sort(),
  );
  for (const sourcePath of INPUT_PERFORMANCE_SOURCE_PATHS) {
    const bytes = fs.readFileSync(path.join(REPOSITORY_ROOT, sourcePath));
    assert.equal(evidence.producerDigests[sourcePath], digest(bytes));
  }
  for (const field of ["workflowId", "runId", "jobId", "artifactName"]) {
    assert.ok(String(evidence.source?.[field] || "").length > 0);
    if (expectedSource) {
      assert.equal(evidence.source[field], expectedSource[field]);
    }
  }
  if (process.env.GITHUB_ACTIONS === "true") {
    assert.notEqual(evidence.source.workflowId, "local");
    assert.notEqual(evidence.source.runId, "local");
    assert.notEqual(evidence.source.jobId, "local");
    assert.notEqual(evidence.source.artifactName, "local");
  }
  return evidence;
}

function countOwnDescriptorsOrHandles() {
  if (process.platform === "linux") {
    return fs.readdirSync("/proc/self/fd").length;
  }
  if (process.platform === "darwin") {
    const output = execFileSync("lsof", ["-p", String(process.pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return Math.max(0, output.trim().split(/\r?\n/u).length - 1);
  }
  if (process.platform === "win32") {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${process.pid}).HandleCount`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return Number.parseInt(output.trim(), 10);
  }
  return -1;
}

function browserProcessIds() {
  if (process.platform === "win32") {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Process | Where-Object { $_.ProcessName -match 'chrome|chromium|headless' } | Select-Object -ExpandProperty Id",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return new Set(
      output
        .split(/\r?\n/u)
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter(Number.isSafeInteger),
    );
  }
  const output = execFileSync("ps", ["-Ao", "pid=,comm="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return new Set(
    output
      .split(/\r?\n/u)
      .map((line) => line.trim().match(/^(\d+)\s+(.+)$/u))
      .filter(
        (match) =>
          match &&
          /chrome|chromium|headless_shell|headless-shell/iu.test(match[2]),
      )
      .map((match) => Number.parseInt(match[1], 10)),
  );
}

function semanticAxTree(nodes) {
  const interestingRoles = new Set([
    "button",
    "textbox",
    "tab",
    "tablist",
    "log",
    "status",
    "group",
    "listbox",
    "region",
    "heading",
    "article",
  ]);
  return nodes
    .map((node) => ({
      role: node.role?.value || "",
      name: node.name?.value || "",
      description: node.description?.value || "",
      disabled:
        node.properties?.find((property) => property.name === "disabled")?.value
          ?.value === true,
    }))
    .filter((node) => interestingRoles.has(node.role));
}

async function runChromiumJourney({ browserExecutable, testSecret }) {
  const { chromium } = requireFromCli("playwright");
  const launchOptions = { headless: true };
  if (browserExecutable) launchOptions.executablePath = browserExecutable;
  const browser = await chromium.launch(launchOptions);
  const descriptorOrHandleBaseline = countOwnDescriptorsOrHandles();
  const page = await browser.newPage({
    viewport: { width: 1_280, height: 900 },
  });
  const pageErrors = [];
  page.on("pageerror", (error) =>
    pageErrors.push(digest(String(error.message))),
  );
  let html = buildChatHtml({
    cspSource: "vscode-webview:",
    nonce: "p2nonce",
    l10n: {},
  });
  html = html.replace(
    "<body>",
    '<body><script nonce="p2nonce">window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__posted.push(m)});</script>',
  );
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => {
    window.__semanticAnnouncements = [];
    const announcer = document.getElementById("announcer");
    let last = "";
    new MutationObserver(() => {
      const text = announcer?.textContent?.trim() || "";
      if (text && text !== last) {
        window.__semanticAnnouncements.push(text);
        last = text;
      }
      if (!text) last = "";
    }).observe(announcer, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });

  const dispatch = (kind, payload = {}) =>
    page.evaluate(
      ({ eventKind, eventPayload }) => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { kind: eventKind, ...eventPayload },
          }),
        );
      },
      { eventKind: kind, eventPayload: payload },
    );

  await dispatch("tabs", {
    tabs: [
      { id: "tab-a", title: "Alpha" },
      { id: "tab-b", title: "Beta" },
      { id: "tab-c", title: "Gamma" },
    ],
    activeId: "tab-a",
  });
  await dispatch("approval", {
    id: "approval-scale",
    tool: "write_file",
    risk: "high",
    reason: "Review exact side effect",
    binding: `sha256:${"c".repeat(64)}`,
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");

  const keyboardActions = [];
  const active = () =>
    page.evaluate(() => ({
      id: document.activeElement?.id || null,
      tabId: document.activeElement?.getAttribute("data-tab-id") || null,
      label:
        document.activeElement?.getAttribute("aria-label") ||
        document.activeElement?.textContent?.trim() ||
        null,
      visible: Boolean(
        document.activeElement &&
        document.activeElement.getClientRects().length > 0 &&
        getComputedStyle(document.activeElement).visibility !== "hidden",
      ),
    }));
  await page.locator('[data-tab-id="tab-a"]').focus();
  for (const [key, expected] of [
    ["ArrowRight", "tab-b"],
    ["End", "tab-c"],
    ["Home", "tab-a"],
  ]) {
    await page.keyboard.press(key);
    const observation = await active();
    keyboardActions.push({ action: key, expected, observation });
  }
  await page.locator('[data-tab-id="tab-b"]').focus();
  await dispatch("tabs", {
    tabs: [
      { id: "tab-a", title: "Alpha" },
      { id: "tab-b", title: "Beta" },
      { id: "tab-c", title: "Gamma" },
    ],
    activeId: "tab-a",
  });
  keyboardActions.push({
    action: "tab-rerender-same-item",
    expected: "tab-b",
    observation: await active(),
  });
  await dispatch("tabs", {
    tabs: [
      { id: "tab-a", title: "Alpha" },
      { id: "tab-c", title: "Gamma" },
    ],
    activeId: "tab-a",
  });
  keyboardActions.push({
    action: "tab-rerender-removed-item",
    expected: "tab-a",
    observation: await active(),
  });

  await page.locator("#log").focus();
  const approvalTraversal = [];
  let approvalReached = false;
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press("Tab");
    const observation = await active();
    approvalTraversal.push(observation);
    if (observation.label === "Approve") {
      approvalReached = true;
      break;
    }
  }
  if (approvalReached) await page.keyboard.press("Enter");
  const approvalFocusAfterSettlement = await active();
  keyboardActions.push({
    action: "approval-keyboard-activate",
    expected: "input",
    observation: approvalFocusAfterSettlement,
  });
  const approvalPosted = await page.evaluate(() =>
    window.__posted.some(
      (message) =>
        message.type === "approval" &&
        message.id === "approval-scale" &&
        message.approve === true,
    ),
  );

  // Drive one complete semantic turn. Streaming tokens update only the visual
  // transcript; the dedicated live region receives one settled reply plus
  // independently classified permission/error/status events.
  await page.locator("#input").fill("semantic announcement fixture");
  await page.locator("#send").click();
  await dispatch("delta", { text: "Hello " });
  await dispatch("delta", { text: "world" });
  await dispatch("tool_done", { tool: "run_shell", isError: true });
  await dispatch("tool_done", { tool: "run_shell", isError: true });
  await dispatch("approval", {
    id: "approval-announcement",
    tool: "run_shell",
    command: "npm test",
    risk: "high",
    reason: "Review exact command",
  });
  await dispatch("approval", {
    id: "approval-announcement",
    tool: "run_shell",
    command: "npm test",
    risk: "high",
    reason: "Review exact command",
  });
  await dispatch("approval_done", {
    id: "approval-announcement",
    approved: false,
    via: "user",
  });
  await dispatch("turn_end", {});
  await page.waitForTimeout(1_200);

  const semanticProjection = await page.evaluate(() => ({
    headings: [...document.querySelectorAll("#log .turn-heading")].map(
      (node) => node.textContent?.trim() || "",
    ),
    articleLabels: [...document.querySelectorAll('#log [role="article"]')].map(
      (node) => node.getAttribute("aria-label") || "",
    ),
    announcements: [...window.__semanticAnnouncements],
    logAriaLive: document.getElementById("log")?.getAttribute("aria-live"),
    logRole: document.getElementById("log")?.getAttribute("role"),
    announcerRole: document.getElementById("announcer")?.getAttribute("role"),
    announcerLive: document
      .getElementById("announcer")
      ?.getAttribute("aria-live"),
    announcerAtomic: document
      .getElementById("announcer")
      ?.getAttribute("aria-atomic"),
  }));
  const headingKeyboardActions = [];
  for (const label of ["Turn 1, User message", "Turn 1, Assistant response"]) {
    const heading = page.getByRole("heading", { name: label, exact: true });
    await heading.focus();
    headingKeyboardActions.push({
      action: "heading-focus",
      expected: await heading.getAttribute("id"),
      observation: await active(),
    });
  }

  const rawTree = await cdp.send("Accessibility.getFullAXTree");
  const accessibilityTree = semanticAxTree(rawTree.nodes || []);
  const unnamedInteractiveControlCount = accessibilityTree.filter(
    (node) => ["button", "textbox", "tab"].includes(node.role) && !node.name,
  ).length;
  const requiredAx = [
    ["region", "Conversation transcript"],
    ["status", "Conversation announcements"],
    ["textbox", "Message the agent"],
    ["tablist", "Conversation tabs"],
    ["button", "Approve"],
    ["button", "Deny"],
    ["heading", "Turn 1, User message"],
    ["heading", "Turn 1, Assistant response"],
    ["article", "Turn 1, Tool error"],
  ];
  const axSemanticMissCount = requiredAx.filter(
    ([role, name]) =>
      !accessibilityTree.some(
        (node) => node.role === role && node.name.includes(name),
      ),
  ).length;
  const assistantAnnouncements = semanticProjection.announcements.filter(
    (text) => text.includes("Assistant response"),
  );
  const toolErrorAnnouncements = semanticProjection.announcements.filter(
    (text) => text.includes("Tool error"),
  );
  const permissionAnnouncements = semanticProjection.announcements.filter(
    (text) => text.includes("Permission request"),
  );
  const statusAnnouncements = semanticProjection.announcements.filter((text) =>
    text.includes("Status"),
  );
  const announcementDuplicateCount =
    semanticProjection.announcements.length -
    new Set(semanticProjection.announcements).size;
  const turnHeadingMissCount = [
    "Turn 1, User message",
    "Turn 1, Assistant response",
  ].filter((heading) => !semanticProjection.headings.includes(heading)).length;
  const streamingTokenReplayCount =
    assistantAnnouncements.length === 1 &&
    assistantAnnouncements[0].includes("Hello world")
      ? 0
      : Math.max(1, assistantAnnouncements.length);
  const semanticAnnouncementMissCount = [
    semanticProjection.logAriaLive === null,
    semanticProjection.logRole === "region",
    semanticProjection.announcerRole === "status",
    semanticProjection.announcerLive === "polite",
    semanticProjection.announcerAtomic === "true",
    assistantAnnouncements.length === 1,
    toolErrorAnnouncements.length === 1,
    permissionAnnouncements.length >= 3,
    statusAnnouncements.some((text) => text.includes("thinking")),
    statusAnnouncements.some((text) => text.includes("ready")),
    announcementDuplicateCount === 0,
    turnHeadingMissCount === 0,
    streamingTokenReplayCount === 0,
  ].filter((passed) => !passed).length;
  const criticalAnnouncementMissCount =
    axSemanticMissCount + semanticAnnouncementMissCount;

  const heapTrajectory = [];
  heapTrajectory.push({
    stage: "baseline",
    ...(await cdp.send("Runtime.getHeapUsage")),
  });
  const transcript = await page.evaluate(async (messageCount) => {
    const samples = [];
    for (let batch = 0; batch < 100; batch += 1) {
      const started = performance.now();
      for (let offset = 0; offset < messageCount / 100; offset += 1) {
        const index = batch * (messageCount / 100) + offset;
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              kind: "info",
              text: `scale-message-${String(index).padStart(4, "0")}`,
            },
          }),
        );
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      samples.push(performance.now() - started);
    }
    const nodes = [...document.querySelectorAll("#log > *")];
    return {
      samples,
      renderedNodes: nodes.length,
      firstText: nodes[0]?.textContent || "",
      lastText: nodes.at(-1)?.textContent || "",
    };
  }, PROFILE.messagesPerSession);
  heapTrajectory.push({
    stage: "transcript-2000",
    ...(await cdp.send("Runtime.getHeapUsage")),
  });

  const largeInputs = await page.evaluate(
    async ({ diffBytes, logBytes, secret }) => {
      const dispatchAndPaint = async (kind, text) => {
        const started = performance.now();
        window.dispatchEvent(
          new MessageEvent("message", { data: { kind, text } }),
        );
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return performance.now() - started;
      };
      const command = `npm publish --//registry.invalid/:_authToken=${secret}`;
      const makePayload = (total, prefix, suffix, fill) => {
        const middle = total - prefix.length - suffix.length;
        const left = Math.floor((middle - secret.length - command.length) / 2);
        const right = middle - secret.length - command.length - left;
        return (
          prefix +
          fill.repeat(left) +
          secret +
          command +
          fill.repeat(right) +
          suffix
        );
      };
      const diff = makePayload(diffBytes, "DIFF_HEAD", "DIFF_TAIL", "d");
      const diffPaintMs = await dispatchAndPaint("turn_end", diff);
      const diffNode = document.querySelector("#log > :last-child");
      const diffVisible = diffNode?.textContent || "";
      const log = makePayload(logBytes, "LOG_HEAD", "LOG_TAIL", "l");
      const logPaintMs = await dispatchAndPaint("info", log);
      const logNode = document.querySelector("#log > :last-child");
      const logVisible = logNode?.textContent || "";
      return {
        diffPaintMs,
        logPaintMs,
        diffVisibleChars: diffVisible.length,
        logVisibleChars: logVisible.length,
        diffMarkerVisible: diffVisible.includes("characters omitted"),
        logMarkerVisible: logVisible.includes("characters omitted"),
        diffHeadTailVisible:
          diffVisible.startsWith("DIFF_HEAD") &&
          diffVisible.endsWith("DIFF_TAIL"),
        logHeadTailVisible:
          logVisible.startsWith("LOG_HEAD") && logVisible.endsWith("LOG_TAIL"),
        credentialVisible:
          diffVisible.includes(secret) || logVisible.includes(secret),
        fullCommandVisible:
          diffVisible.includes(command) || logVisible.includes(command),
      };
    },
    {
      diffBytes: PROFILE.diffBytes,
      logBytes: PROFILE.logBytes,
      secret: testSecret,
    },
  );
  heapTrajectory.push({
    stage: "large-diff-log",
    ...(await cdp.send("Runtime.getHeapUsage")),
  });

  const rows = Array.from({ length: PROFILE.sessionCount }, (_, index) => ({
    id: `session-${index}`,
    kind: index % 2 === 0 ? "chat" : "background",
    title: `Scale session ${index}`,
    workspace: `/workspace/${index % 8}`,
    status: index % 7 === 0 ? "needs_input" : "working",
    waitingApproval: index % 7 === 0,
    lastActivity: Date.UTC(2026, 7, 20, 0, 0, index),
    actions: ["peek", "reply", "stop"],
  }));
  const workbenchHtml = renderWorkbenchHtml(rows, {
    now: Date.UTC(2026, 7, 20, 1, 0, 0),
  });
  const workbench = await page.evaluate(
    async ({ body, sessionCount, sampleCount }) => {
      document.body.innerHTML =
        '<main aria-label="Sessions Workbench scale"><div id="scale" style="height:500px;overflow:auto"></div></main>';
      const container = document.getElementById("scale");
      const started = performance.now();
      container.innerHTML = body;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const paintMs = performance.now() - started;
      const samples = [];
      for (let index = 0; index < sampleCount; index += 1) {
        const sampleStarted = performance.now();
        container.scrollTop =
          index % 2 === 0
            ? container.scrollHeight
            : Math.floor(container.scrollHeight / 3);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        samples.push(performance.now() - sampleStarted);
      }
      return {
        paintMs,
        samples,
        rowCount: container.querySelectorAll("[data-session-row]").length,
        ariaRowCount: Number(
          container.querySelector("table")?.getAttribute("aria-rowcount"),
        ),
        namedButtonCount: [...container.querySelectorAll("button")].filter(
          (button) => button.getAttribute("aria-label"),
        ).length,
        expectedSessionCount: sessionCount,
      };
    },
    {
      body: workbenchHtml,
      sessionCount: PROFILE.sessionCount,
      sampleCount: PROFILE.scrollPaintSamples,
    },
  );
  heapTrajectory.push({
    stage: "workbench-128",
    ...(await cdp.send("Runtime.getHeapUsage")),
  });
  const domCounters = await cdp.send("Memory.getDOMCounters");
  await cdp.detach();
  await browser.close();
  const descriptorOrHandleSettled = countOwnDescriptorsOrHandles();

  const focusFailures =
    keyboardActions.filter(
      (entry) =>
        (entry.expected === "input"
          ? entry.observation.id !== "input"
          : entry.observation.tabId !== entry.expected) ||
        entry.observation.visible !== true,
    ).length +
    headingKeyboardActions.filter(
      (entry) =>
        entry.observation.id !== entry.expected ||
        entry.observation.visible !== true,
    ).length;
  return {
    accessibilityTree,
    unnamedInteractiveControlCount,
    criticalAnnouncementMissCount,
    keyboardActions,
    headingKeyboardActions,
    approvalTraversal,
    approvalReached,
    approvalPosted,
    focusFailures,
    semanticProjection,
    announcementDuplicateCount,
    turnHeadingMissCount,
    streamingTokenReplayCount,
    transcript,
    largeInputs,
    workbench,
    heapTrajectory,
    domCounters,
    pageErrors,
    descriptorOrHandleBaseline,
    descriptorOrHandleSettled,
  };
}

function provenanceFromEnvironment(artifactName) {
  return {
    repository: process.env.GITHUB_REPOSITORY || "local",
    workflowRef: process.env.GITHUB_WORKFLOW_REF || "local",
    workflowSha: process.env.GITHUB_WORKFLOW_SHA || "local",
    runId: process.env.GITHUB_RUN_ID || "local",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || "local",
    job: process.env.GITHUB_JOB || "local",
    eventName: process.env.GITHUB_EVENT_NAME || "local",
    artifactName,
  };
}

async function mainCampaign(options, dependencies = {}) {
  const releaseCommit = String(options.releaseCommit || "").toLowerCase();
  const artifactDir = path.resolve(options.artifactDir);
  const artifactName = options.artifactName;
  assert.match(releaseCommit, SHA_RE);
  assert.ok(artifactName);
  fs.mkdirSync(artifactDir, { recursive: true });
  const exactCheckout = dependencies.assertExactCheckout || assertExactCheckout;
  exactCheckout(releaseCommit);
  const provenance = provenanceFromEnvironment(artifactName);
  verifyAccessibilityWorkflowAuthority({
    releaseCommit,
    workflowSha: provenance.workflowSha,
    workflowRef: provenance.workflowRef,
    required: options.required === "true",
  });
  const atProbe = validateAtProbe(
    readJson(path.resolve(options.atProbe)),
    dependencies.platform || process.platform,
  );
  const jetBrainsSource = path.resolve(options.jetbrainsEvidence);
  const jetBrains = validateJetBrainsEvidence(readJson(jetBrainsSource));
  const inputPerformance = validateInputPerformanceEvidence(
    readJson(path.resolve(options.inputPerformanceEvidence)),
    releaseCommit,
    dependencies.platform || process.platform,
    {
      workflowId: provenance.workflowRef,
      runId: provenance.runId,
      jobId: provenance.job,
      artifactName: provenance.artifactName,
    },
  );
  const testSecret = `cc-p2-secret-${crypto.randomBytes(24).toString("hex")}`;
  const descriptorOrHandleBefore = countOwnDescriptorsOrHandles();
  const browserProcessesBefore = browserProcessIds();
  const rssBefore = process.memoryUsage().rss;
  const started = performance.now();
  try {
    const vscodeDiagnosticsRequired = await runDiagnosticsScaleProfile({
      count: DIAGNOSTICS_PROFILE.requiredCount,
      samples: DIAGNOSTICS_PROFILE.requiredSamples,
      disposition: "required",
    });
    const diagnosticsProfiles = [
      vscodeDiagnosticsRequired,
      {
        host: "jetbrains",
        disposition: "required",
        ...jetBrains.diagnosticsScaleRequired,
      },
    ];
    if ((process.env.GITHUB_EVENT_NAME || "") === "schedule") {
      diagnosticsProfiles.push(
        await runDiagnosticsScaleProfile({
          count: DIAGNOSTICS_PROFILE.advisoryCount,
          samples: DIAGNOSTICS_PROFILE.advisorySamples,
          disposition: "advisory",
        }),
      );
      if (jetBrains.diagnosticsScaleAdvisory) {
        diagnosticsProfiles.push({
          host: "jetbrains",
          disposition: "advisory",
          ...jetBrains.diagnosticsScaleAdvisory,
        });
      }
    }
    const chromium = await runChromiumJourney({
      browserExecutable: options.browserExecutable || null,
      testSecret,
    });
    const durationMs = performance.now() - started;
    const rssAfter = process.memoryUsage().rss;
    const browserProcessesAfter = browserProcessIds();
    const orphanProcessIds = [...browserProcessesAfter].filter(
      (processId) => !browserProcessesBefore.has(processId),
    );
    const inputToPaint = summarizeSamples(chromium.transcript.samples);
    const scrollToPaint = summarizeSamples(chromium.workbench.samples);
    const rendererHeapBefore = chromium.heapTrajectory[0].usedSize;
    const rendererHeapPeak = Math.max(
      ...chromium.heapTrajectory.map((entry) => entry.usedSize),
    );
    const rendererHeapGrowthBytes = Math.max(
      0,
      rendererHeapPeak - rendererHeapBefore,
    );
    for (const profile of diagnosticsProfiles) {
      if (profile.host === "vscode") {
        profile.rendererHeapGrowthBytes = rendererHeapGrowthBytes;
        profile.rendererHeapMeasurement =
          "chromium-product-journey-peak-minus-baseline";
      }
    }
    const keyboardUnreachableActionCount =
      chromium.keyboardActions.filter((entry) =>
        entry.expected === "input"
          ? entry.observation.id !== "input"
          : entry.observation.tabId !== entry.expected,
      ).length +
      (chromium.approvalReached ? 0 : 1) +
      chromium.headingKeyboardActions.filter(
        (entry) => entry.observation.id !== entry.expected,
      ).length;
    const invisibleFocusCount =
      chromium.keyboardActions.filter(
        (entry) => entry.observation.visible !== true,
      ).length +
      chromium.headingKeyboardActions.filter(
        (entry) => entry.observation.visible !== true,
      ).length;
    const thresholdViolations = [];
    if (inputToPaint.p99Ms > PROFILE.thresholds.inputToPaintP99Ms)
      thresholdViolations.push("input-to-paint-p99");
    if (scrollToPaint.p99Ms > PROFILE.thresholds.scrollP99Ms)
      thresholdViolations.push("scroll-p99");
    if (chromium.largeInputs.diffPaintMs > PROFILE.thresholds.diffPaintMs)
      thresholdViolations.push("diff-paint");
    if (chromium.largeInputs.logPaintMs > PROFILE.thresholds.logPaintMs)
      thresholdViolations.push("log-paint");
    if (chromium.workbench.paintMs > PROFILE.thresholds.workbenchPaintMs)
      thresholdViolations.push("workbench-paint");
    if (rssAfter - rssBefore > PROFILE.thresholds.nodeRssGrowthBytes)
      thresholdViolations.push("node-rss-growth");
    if (rendererHeapGrowthBytes > PROFILE.thresholds.rendererHeapGrowthBytes)
      thresholdViolations.push("renderer-heap-growth");
    if (
      chromium.descriptorOrHandleSettled - chromium.descriptorOrHandleBaseline >
      PROFILE.thresholds.descriptorOrHandleGrowth
    )
      thresholdViolations.push("descriptor-or-handle-growth");
    const diagnosticsRequiredProfiles = diagnosticsProfiles.filter(
      (profile) => profile.disposition === "required",
    );
    for (const profile of diagnosticsRequiredProfiles) {
      const stable = profile.stableSnapshot;
      const eventLoopOrEdt = Math.max(
        Number(profile.eventLoopMaxMs || profile.maxWorkSliceMs || 0),
        Number(profile.edtMaxMs || 0),
      );
      if (stable?.p95Ms > DIAGNOSTICS_PROFILE.thresholds.stableSnapshotP95Ms) {
        thresholdViolations.push(`diagnostics-${profile.host}-stable-p95`);
      }
      if (eventLoopOrEdt > DIAGNOSTICS_PROFILE.thresholds.eventLoopOrEdtMaxMs) {
        thresholdViolations.push(`diagnostics-${profile.host}-event-loop-edt`);
      }
      if (
        Number(profile.nodeRssGrowthBytes || 0) >
        DIAGNOSTICS_PROFILE.thresholds.nodeRssGrowthBytes
      ) {
        thresholdViolations.push(`diagnostics-${profile.host}-rss`);
      }
      if (
        Number(
          profile.rendererHeapGrowthBytes || profile.heapGrowthBytes || 0,
        ) > DIAGNOSTICS_PROFILE.thresholds.rendererHeapGrowthBytes
      ) {
        thresholdViolations.push(`diagnostics-${profile.host}-heap`);
      }
      for (const field of [
        "lostCount",
        "duplicateCount",
        "staleVersionCount",
      ]) {
        if (Number(profile[field] || 0) !== 0) {
          thresholdViolations.push(`diagnostics-${profile.host}-${field}`);
        }
      }
    }

    const exact = {
      releaseCommit,
      exactCommitBound: true,
      gateSourceCount: GATE_SOURCE_PATHS.length,
    };
    const host = {
      releaseCommit,
      operatingSystem: dependencies.platform || process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      hosts: ["vscode", "jetbrains"],
      measurementSurfaces: [
        "chromium-vscode-product-webview",
        "headless-swing-jetbrains-product-components",
        "metadata-only-vscode-workspace-mention-index",
        "metadata-only-jetbrains-workspace-mention-index",
      ],
      provenance,
    };
    const keyboard = {
      actions: chromium.keyboardActions,
      approvalTraversal: chromium.approvalTraversal,
      headingActions: chromium.headingKeyboardActions,
      keyboardUnreachableActionCount,
      keyboardTrapCount: chromium.approvalReached ? 0 : 1,
      invisibleFocusCount,
    };
    const accessibility = {
      capture: "chromium-cdp-full-ax-tree",
      nodes: chromium.accessibilityTree,
      unnamedInteractiveControlCount: chromium.unnamedInteractiveControlCount,
      requiredSemanticMissCount: chromium.criticalAnnouncementMissCount,
    };
    const screenReader = {
      capture: "semantic-live-region-and-accessible-name-projection",
      assistiveTechnology: atProbe,
      announcements: chromium.accessibilityTree
        .filter((node) =>
          ["region", "status", "group", "heading"].includes(node.role),
        )
        .map((node) => ({ role: node.role, name: node.name })),
      eventAnnouncements: chromium.semanticProjection.announcements,
      visualTranscriptLiveRegion:
        chromium.semanticProjection.logAriaLive !== null ||
        chromium.semanticProjection.logRole === "log",
      visualTranscriptRole: chromium.semanticProjection.logRole,
      classifiedEventRegion: {
        role: chromium.semanticProjection.announcerRole,
        live: chromium.semanticProjection.announcerLive,
        atomic: chromium.semanticProjection.announcerAtomic,
      },
      announcementDuplicateCount: chromium.announcementDuplicateCount,
      streamingTokenReplayCount: chromium.streamingTokenReplayCount,
      turnHeadings: chromium.semanticProjection.headings,
      speechAudioCaptured: false,
      speechQualityAssessed: false,
      externalManualSpeechReviewRequired: true,
    };
    const focus = {
      transitions: chromium.keyboardActions.map((entry) => ({
        action: entry.action,
        expected: entry.expected,
        observed: entry.observation.id || entry.observation.tabId,
        visible: entry.observation.visible,
      })),
      focusRestoreFailureCount: chromium.focusFailures,
    };
    const largeInputs = {
      messagesPerSession: PROFILE.messagesPerSession,
      renderedTranscriptNodes: chromium.transcript.renderedNodes,
      transcriptNodeLimit: 800,
      diffBytes: PROFILE.diffBytes,
      diffDigest: digestLargePayload(
        PROFILE.diffBytes,
        "DIFF_HEAD",
        "DIFF_TAIL",
        "d",
        testSecret,
        `npm publish --//registry.invalid/:_authToken=${testSecret}`,
      ),
      logBytes: PROFILE.logBytes,
      logDigest: digestLargePayload(
        PROFILE.logBytes,
        "LOG_HEAD",
        "LOG_TAIL",
        "l",
        testSecret,
        `npm publish --//registry.invalid/:_authToken=${testSecret}`,
      ),
      sessionCount: PROFILE.sessionCount,
      workbenchSessionLimit: WORKBENCH_SESSION_LIMIT,
      diffVisibleChars: chromium.largeInputs.diffVisibleChars,
      logVisibleChars: chromium.largeInputs.logVisibleChars,
      diffMarkerVisible: chromium.largeInputs.diffMarkerVisible,
      logMarkerVisible: chromium.largeInputs.logMarkerVisible,
      diffHeadTailVisible: chromium.largeInputs.diffHeadTailVisible,
      logHeadTailVisible: chromium.largeInputs.logHeadTailVisible,
      credentialVisible: chromium.largeInputs.credentialVisible,
      fullCommandVisible: chromium.largeInputs.fullCommandVisible,
    };
    const performanceEvidence = {
      inputToPaint,
      scrollToPaint,
      diffPaintMs: chromium.largeInputs.diffPaintMs,
      logPaintMs: chromium.largeInputs.logPaintMs,
      workbenchPaintMs: chromium.workbench.paintMs,
      thresholds: PROFILE.thresholds,
      thresholdViolations,
      durationMs,
      jetbrains: {
        inputToPaint: jetBrains.inputToPaint,
        scrollToPaint: jetBrains.scrollToPaint,
        diffPaintMs: jetBrains.diffPaintMs,
        logPaintMs: jetBrains.logPaintMs,
        sessionProjectionMs: jetBrains.sessionProjectionMs,
      },
    };
    const resources = {
      nodeRssTrajectory: [
        { stage: "before", bytes: rssBefore },
        { stage: "after", bytes: rssAfter },
      ],
      rendererHeapTrajectory: chromium.heapTrajectory,
      rendererDomCounters: chromium.domCounters,
      descriptorOrHandleBefore,
      descriptorOrHandleBaseline: chromium.descriptorOrHandleBaseline,
      descriptorOrHandleAfter: chromium.descriptorOrHandleSettled,
      descriptorOrHandleDelta:
        chromium.descriptorOrHandleSettled -
        chromium.descriptorOrHandleBaseline,
      orphanProcessCount: orphanProcessIds.length,
      jetbrainsHeapBeforeBytes: jetBrains.heapBeforeBytes,
      jetbrainsHeapAfterBytes: jetBrains.heapAfterBytes,
      jetbrainsOpenFileDescriptorCount: jetBrains.openFileDescriptorCount,
    };
    const diagnosticsEvidence = {
      schema: "chainlesschain.claude-code-increment-audit-fragment.v1",
      commitmentId: "DIAG-SCALE",
      headSha: releaseCommit,
      os: platformSuffix(dependencies.platform || process.platform),
      runtime: {
        name: "node+java",
        version: `${process.version};${jetBrains.javaVersion}`,
        arch: process.arch,
      },
      profileVersion: DIAGNOSTICS_PROFILE.profileVersion,
      thresholds: DIAGNOSTICS_PROFILE.thresholds,
      measurements: { profiles: diagnosticsProfiles },
      testIds: [...DIAGNOSTIC_TEST_IDS],
      producerDigests: Object.fromEntries(
        DIAGNOSTIC_PRODUCER_PATHS.map((sourcePath) => [
          sourcePath,
          digest(fs.readFileSync(path.join(REPOSITORY_ROOT, sourcePath))),
        ]),
      ),
      disposition: "required",
      source: {
        workflowId: process.env.GITHUB_WORKFLOW_REF || "local",
        runId: process.env.GITHUB_RUN_ID || "local",
        jobId: process.env.GITHUB_JOB || "local",
        artifactName,
      },
      outcome: thresholdViolations.some((value) =>
        value.startsWith("diagnostics-"),
      )
        ? "failed"
        : "passed",
    };
    const outcome = {
      success: false,
      keyboardUnreachableActionCount,
      keyboardTrapCount: chromium.approvalReached ? 0 : 1,
      invisibleFocusCount,
      focusRestoreFailureCount: chromium.focusFailures,
      unnamedInteractiveControlCount: chromium.unnamedInteractiveControlCount,
      criticalAnnouncementMissCount: chromium.criticalAnnouncementMissCount,
      announcementDuplicateCount: chromium.announcementDuplicateCount,
      streamingTokenReplayCount: chromium.streamingTokenReplayCount,
      turnHeadingMissCount: chromium.turnHeadingMissCount,
      unboundedTranscriptGrowthCount:
        chromium.transcript.renderedNodes <= 800 &&
        jetBrains.renderedChars <= TRANSCRIPT_ENTRY_MAX_CHARS
          ? 0
          : 1,
      silentDiffOrLogTruncationCount:
        chromium.largeInputs.diffMarkerVisible &&
        chromium.largeInputs.logMarkerVisible &&
        jetBrains.diffMarkerVisible &&
        jetBrains.logMarkerVisible
          ? 0
          : 1,
      uiHangCount: thresholdViolations.length,
      credentialLeakCount:
        chromium.largeInputs.credentialVisible ||
        chromium.largeInputs.fullCommandVisible
          ? 1
          : 0,
      orphanProcessCount: orphanProcessIds.length,
      pageErrorCount: chromium.pageErrors.length,
      requiredMeasurementsComplete: true,
      exactCommitBound: true,
      ideInputPerformanceRequiredPassed: inputPerformance.outcome === "passed",
      automatedAssistiveTechnologyProcessProbeComplete:
        atProbe.automatedProcessProbeComplete,
      manualSpeechQualityPending: true,
      continuousEightHourHostSoakPending: true,
    };
    outcome.success =
      outcome.keyboardUnreachableActionCount === 0 &&
      outcome.keyboardTrapCount === 0 &&
      outcome.invisibleFocusCount === 0 &&
      outcome.focusRestoreFailureCount === 0 &&
      outcome.unnamedInteractiveControlCount === 0 &&
      outcome.criticalAnnouncementMissCount === 0 &&
      outcome.announcementDuplicateCount === 0 &&
      outcome.streamingTokenReplayCount === 0 &&
      outcome.turnHeadingMissCount === 0 &&
      outcome.unboundedTranscriptGrowthCount === 0 &&
      outcome.silentDiffOrLogTruncationCount === 0 &&
      outcome.uiHangCount === 0 &&
      outcome.credentialLeakCount === 0 &&
      outcome.orphanProcessCount === 0 &&
      outcome.pageErrorCount === 0 &&
      outcome.ideInputPerformanceRequiredPassed === true &&
      chromium.approvalPosted === true &&
      chromium.transcript.renderedNodes === 800 &&
      !chromium.transcript.firstText.includes("scale-message-0000") &&
      chromium.transcript.lastText.includes("scale-message-1999") &&
      chromium.workbench.rowCount === PROFILE.sessionCount &&
      chromium.workbench.ariaRowCount === PROFILE.sessionCount &&
      chromium.workbench.namedButtonCount === PROFILE.sessionCount * 3;

    const documents = {
      "exact-commit.json": exact,
      "host-environment.json": host,
      "assistive-technology.json": atProbe,
      "keyboard-action-ledger.json": keyboard,
      "accessibility-tree.json": accessibility,
      "screen-reader-transcript.json": screenReader,
      "focus-transition-ledger.json": focus,
      "large-input-digests.json": largeInputs,
      "performance-samples.json": performanceEvidence,
      "resource-trajectory.json": resources,
      "diagnostics-scale.json": diagnosticsEvidence,
      "jetbrains-native.json": jetBrains,
      "ide-input-performance.json": inputPerformance,
      "outcome-observations.json": outcome,
    };
    for (const [file, document] of Object.entries(documents)) {
      writeJson(path.join(artifactDir, file), document);
    }
    assert.equal(outcome.success, true, "zero-tolerance P2-4 outcome failed");
    const serializedEvidence = REQUIRED_FILES.map((file) =>
      fs.readFileSync(path.join(artifactDir, file), "utf8"),
    ).join("\n");
    assert.equal(serializedEvidence.includes(testSecret), false);
    assert.equal(serializedEvidence.includes("npm publish --"), false);
    const files = Object.fromEntries(
      REQUIRED_FILES.map((file) => {
        const bytes = fs.readFileSync(path.join(artifactDir, file));
        return [file, { sha256: digest(bytes), bytes: bytes.length }];
      }),
    );
    writeJson(path.join(artifactDir, "manifest.json"), {
      schema: "chainlesschain.accessibility-performance-manifest.v1",
      releaseCommit,
      operatingSystem: dependencies.platform || process.platform,
      files,
    });
    return { artifactDir, outcome, performance: performanceEvidence };
  } catch (error) {
    writeJson(path.join(artifactDir, "failure.json"), {
      schema: "chainlesschain.accessibility-performance-failure.v1",
      releaseCommit,
      operatingSystem: dependencies.platform || process.platform,
      diagnosticDigest: digest(String(error?.stack || error)),
    });
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mainCampaign(options);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `accessibility/performance campaign failed (${digest(String(error))})`,
    );
    process.exitCode = 1;
  });
}

export {
  ACCESSIBILITY_WORKFLOW_PATH,
  DIAGNOSTIC_PRODUCER_PATHS,
  DIAGNOSTIC_TEST_IDS,
  DIAGNOSTICS_PROFILE,
  GATE_SOURCE_PATHS,
  PROFILE,
  REQUIRED_FILES,
  digest,
  mainCampaign,
  platformSuffix,
  runDiagnosticsScaleProfile,
  summarizeSamples,
  validateAtProbe,
  validateInputPerformanceEvidence,
  validateJetBrainsEvidence,
  verifyAccessibilityWorkflowAuthority,
};
