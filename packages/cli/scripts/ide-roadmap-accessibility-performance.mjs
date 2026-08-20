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
  "jetbrains-native.json",
  "outcome-observations.json",
]);
const GATE_SOURCE_PATHS = Object.freeze([
  ".github/workflows/ide-roadmap-accessibility-performance.yml",
  "packages/cli/scripts/ide-roadmap-accessibility-performance.mjs",
  "packages/cli/scripts/verify-ide-roadmap-accessibility-performance.mjs",
  "packages/cli/__tests__/unit/ide-roadmap-accessibility-performance.test.js",
  "packages/vscode-extension/src/chat/chat-html.js",
  "packages/vscode-extension/src/sessions-workbench.js",
  "packages/vscode-extension/test/host-dom-relay.test.cjs",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/TranscriptCap.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/SessionsWorkbench.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ChatTranscript.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/TranscriptCapTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/SessionsWorkbenchTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/ChatTranscriptTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/AccessibilityPerformanceEvidenceTest.java",
  "tests/fixtures/ide-roadmap/p2-accessibility-performance.json",
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
  const rawTree = await cdp.send("Accessibility.getFullAXTree");
  const accessibilityTree = semanticAxTree(rawTree.nodes || []);
  const unnamedInteractiveControlCount = accessibilityTree.filter(
    (node) => ["button", "textbox", "tab"].includes(node.role) && !node.name,
  ).length;
  const requiredAx = [
    ["log", "Conversation transcript"],
    ["textbox", "Message the agent"],
    ["tablist", "Conversation tabs"],
    ["button", "Approve"],
    ["button", "Deny"],
  ];
  const criticalAnnouncementMissCount = requiredAx.filter(
    ([role, name]) =>
      !accessibilityTree.some(
        (node) => node.role === role && node.name.includes(name),
      ),
  ).length;

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

  const focusFailures = keyboardActions.filter(
    (entry) =>
      (entry.expected === "input"
        ? entry.observation.id !== "input"
        : entry.observation.tabId !== entry.expected) ||
      entry.observation.visible !== true,
  ).length;
  return {
    accessibilityTree,
    unnamedInteractiveControlCount,
    criticalAnnouncementMissCount,
    keyboardActions,
    approvalTraversal,
    approvalReached,
    approvalPosted,
    focusFailures,
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
  const atProbe = validateAtProbe(
    readJson(path.resolve(options.atProbe)),
    dependencies.platform || process.platform,
  );
  const jetBrainsSource = path.resolve(options.jetbrainsEvidence);
  const jetBrains = validateJetBrainsEvidence(readJson(jetBrainsSource));
  const testSecret = `cc-p2-secret-${crypto.randomBytes(24).toString("hex")}`;
  const descriptorOrHandleBefore = countOwnDescriptorsOrHandles();
  const browserProcessesBefore = browserProcessIds();
  const rssBefore = process.memoryUsage().rss;
  const started = performance.now();
  try {
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
    const keyboardUnreachableActionCount =
      chromium.keyboardActions.filter((entry) =>
        entry.expected === "input"
          ? entry.observation.id !== "input"
          : entry.observation.tabId !== entry.expected,
      ).length + (chromium.approvalReached ? 0 : 1);
    const invisibleFocusCount = chromium.keyboardActions.filter(
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
    if (
      rendererHeapPeak - rendererHeapBefore >
      PROFILE.thresholds.rendererHeapGrowthBytes
    )
      thresholdViolations.push("renderer-heap-growth");
    if (
      chromium.descriptorOrHandleSettled - chromium.descriptorOrHandleBaseline >
      PROFILE.thresholds.descriptorOrHandleGrowth
    )
      thresholdViolations.push("descriptor-or-handle-growth");

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
      ],
      provenance: provenanceFromEnvironment(artifactName),
    };
    const keyboard = {
      actions: chromium.keyboardActions,
      approvalTraversal: chromium.approvalTraversal,
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
        .filter((node) => ["log", "status", "group"].includes(node.role))
        .map((node) => ({ role: node.role, name: node.name })),
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
    const outcome = {
      success: false,
      keyboardUnreachableActionCount,
      keyboardTrapCount: chromium.approvalReached ? 0 : 1,
      invisibleFocusCount,
      focusRestoreFailureCount: chromium.focusFailures,
      unnamedInteractiveControlCount: chromium.unnamedInteractiveControlCount,
      criticalAnnouncementMissCount: chromium.criticalAnnouncementMissCount,
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
      outcome.unboundedTranscriptGrowthCount === 0 &&
      outcome.silentDiffOrLogTruncationCount === 0 &&
      outcome.uiHangCount === 0 &&
      outcome.credentialLeakCount === 0 &&
      outcome.orphanProcessCount === 0 &&
      outcome.pageErrorCount === 0 &&
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
      "jetbrains-native.json": jetBrains,
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
  GATE_SOURCE_PATHS,
  PROFILE,
  REQUIRED_FILES,
  digest,
  mainCampaign,
  platformSuffix,
  summarizeSamples,
  validateAtProbe,
  validateJetBrainsEvidence,
};
