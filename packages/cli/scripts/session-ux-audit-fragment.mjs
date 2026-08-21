#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildSessionProjection,
  canonicalSessionId,
} from "../src/lib/session-projection.js";
import { SessionWorkbenchStore } from "../src/lib/session-workbench-store.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const require = createRequire(import.meta.url);
const {
  buildSessionGroupMutationArgs,
  focusRows,
  parseSessionProjection,
  renderWorkbenchHtml,
} = require(
  path.join(
    REPOSITORY_ROOT,
    "packages/vscode-extension/src/sessions-workbench.js",
  ),
);
const { renderPageHtml } = require(
  path.join(
    REPOSITORY_ROOT,
    "packages/vscode-extension/src/ui/sessions-view.js",
  ),
);
const { buildChatHtml } = require(
  path.join(REPOSITORY_ROOT, "packages/vscode-extension/src/chat/chat-html.js"),
);

const FRAGMENT_SCHEMA =
  "chainlesschain.claude-code-increment-audit-fragment.v1";
const SESSION_UX_PROFILE_VERSION = "session-ux/v1";
const SESSION_UX_FRAGMENT_FILE = "session-ux-audit-fragment.json";
const SESSION_UX_PROJECTION_FILE = "session-ux-projection.json";
const SESSION_UX_NODE_EVIDENCE_FILE = "session-ux-node-evidence.json";
const SESSION_UX_JETBRAINS_EVIDENCE_FILE = "session-ux-jetbrains-evidence.json";
const SESSION_UX_INPUT_FILES = Object.freeze([
  SESSION_UX_PROJECTION_FILE,
  SESSION_UX_NODE_EVIDENCE_FILE,
  SESSION_UX_JETBRAINS_EVIDENCE_FILE,
]);
const SHA_RE = /^[a-f0-9]{40}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const MIB = 1024 * 1024;

const SESSION_UX_THRESHOLDS = Object.freeze({
  sessionCountMinimum: 128,
  groupCountMinimum: 1,
  groupedSessionCountMinimum: 128,
  multiSelectCountMinimum: 128,
  focusRowCountMinimum: 1,
  staleCasRejectionCountMinimum: 1,
  thinkingCollapseFailureCountMaximum: 0,
});

const SESSION_UX_TEST_IDS = Object.freeze([
  "packages/cli/__tests__/unit/session-workbench-store.test.js#persists group name/order and atomically moves 128 selected sessions",
  "packages/cli/__tests__/unit/session-workbench-store.test.js#rejects a stale second window instead of losing the first mutation",
  "packages/cli/__tests__/unit/session-projection.test.js#projects CLI-owned groups, bounded attention, Focus View context and offline/cloud state",
  "packages/cli/__tests__/unit/vscode-ext-sessions-workbench.test.js#renders and locally filters a 128-session workbench",
  "packages/cli/__tests__/unit/vscode-ext-sessions-workbench.test.js#consumes one CLI-owned group/focus schema and builds atomic batch move argv",
  "packages/cli/__tests__/unit/vscode-ext-sessions-workbench.test.js#wires keyboard multi-selection, atomic group moves and JetBrains interval selection",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/SessionProjectionTest.java#consumesCliOwnedGroupsFocusAttentionAndCloudOfflineStatus",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/SessionsWorkbenchTest.java#scaleGateKeepsAndFiltersAtLeast128Sessions",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/ChatTranscriptTest.java#thinkingOnlyTurnCollapsesAutomaticallyWhenCompletionSettles",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/SessionUxEvidenceTest.java#measuresCanonicalProjectionAndThinkingCollapse",
  "packages/cli/scripts/session-ux-audit-fragment.mjs#playwright-product-multiselect-and-thinking-collapse",
]);

const SESSION_UX_PRODUCER_PATHS = Object.freeze([
  ".github/workflows/ide-roadmap-accessibility-performance.yml",
  "packages/cli/scripts/session-ux-audit-fragment.mjs",
  "packages/cli/scripts/ide-roadmap-accessibility-performance.mjs",
  "packages/cli/scripts/verify-ide-roadmap-accessibility-performance.mjs",
  "packages/cli/src/lib/session-projection.js",
  "packages/cli/src/lib/session-workbench-store.js",
  "packages/cli/__tests__/unit/session-projection.test.js",
  "packages/cli/__tests__/unit/session-workbench-store.test.js",
  "packages/cli/__tests__/unit/vscode-ext-sessions-workbench.test.js",
  "packages/cli/__tests__/unit/session-ux-audit-fragment.test.js",
  "packages/cli/__tests__/unit/ide-roadmap-accessibility-performance.test.js",
  "packages/vscode-extension/src/sessions-workbench.js",
  "packages/vscode-extension/src/ui/sessions-view.js",
  "packages/vscode-extension/src/chat/chat-html.js",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/MiniJson.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/SessionProjection.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/SessionsWorkbench.java",
  "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/ChatTranscript.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/SessionProjectionTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/SessionsWorkbenchTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/ChatTranscriptTest.java",
  "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/intellij/SessionUxEvidenceTest.java",
]);

const FRAGMENT_KEYS = Object.freeze([
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
const SOURCE_KEYS = Object.freeze([
  "artifactName",
  "jobId",
  "runId",
  "workflowId",
]);
const NODE_EVIDENCE_KEYS = Object.freeze([
  "cli",
  "headSha",
  "nodeArch",
  "nodeVersion",
  "platform",
  "projectionDigest",
  "projectionRevision",
  "groupRevision",
  "schema",
  "source",
  "vscode",
]);
const CLI_MEASUREMENT_KEYS = Object.freeze([
  "assignmentCount",
  "groupCount",
  "groupedSessionCount",
  "persistedAssignmentCount",
  "revisionChangedAfterCreate",
  "revisionChangedAfterMove",
  "sessionCount",
  "staleCasErrorCode",
  "staleCasRejectionCount",
]);
const VSCODE_MEASUREMENT_KEYS = Object.freeze([
  "ariaRowCount",
  "atomicMoveArgumentSessionCount",
  "atomicMoveExpectedRevisionPreserved",
  "focusRowCount",
  "groupCount",
  "groupRevisionPreserved",
  "groupedSessionCount",
  "pendingQuestionPreserved",
  "postedMoveRevisionPreserved",
  "postedMoveSessionCount",
  "projectionConnected",
  "renderedRowCount",
  "renderedSelectionControlCount",
  "selectedSessionCount",
  "sessionCount",
  "settledAnswerPreserved",
  "thinkingCollapsedAfterTool",
  "thinkingCollapsedAfterTurnEnd",
  "thinkingCollapseFailureCount",
  "thinkingExpandedWhileStreaming",
]);
const JETBRAINS_EVIDENCE_KEYS = Object.freeze([
  "groupRevision",
  "headSha",
  "javaArch",
  "javaVersion",
  "measurements",
  "platform",
  "projectionDigest",
  "projectionRevision",
  "schema",
  "source",
]);
const JETBRAINS_MEASUREMENT_KEYS = Object.freeze([
  "focusRowCount",
  "groupCount",
  "groupRevisionPreserved",
  "groupedSessionCount",
  "pendingQuestionPreserved",
  "projectionConnected",
  "reasoningCollapsedAfterSettlement",
  "reasoningExpandedBeforeSettlement",
  "reasoningRestoredAfterToggle",
  "sessionCount",
  "settledAnswerPreserved",
  "thinkingCollapseFailureCount",
]);

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertExactKeys(value, expected, scope) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), scope);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), scope);
}

function canonicalOs(platform) {
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  throw new Error(`unsupported SESSION-UX operating system: ${platform}`);
}

function validateSource(source, scope = "source") {
  assertExactKeys(source, SOURCE_KEYS, scope);
  for (const key of SOURCE_KEYS) {
    assert.ok(
      typeof source[key] === "string" && source[key].length > 0,
      `${scope}/${key}`,
    );
    assert.notEqual(source[key], "local", `${scope}/${key}`);
  }
  return source;
}

function sourceFromActions(environment, artifactName) {
  assert.equal(
    environment.GITHUB_ACTIONS,
    "true",
    "SESSION-UX required evidence is produced only by GitHub Actions",
  );
  assert.equal(
    environment.CC_P2_ARTIFACT,
    artifactName,
    "SESSION-UX artifact name must come from the producer job environment",
  );
  return validateSource({
    workflowId: String(environment.GITHUB_WORKFLOW_REF || ""),
    runId: String(environment.GITHUB_RUN_ID || ""),
    jobId: String(environment.GITHUB_JOB || ""),
    artifactName: String(artifactName || ""),
  });
}

function readHead(repositoryRoot = REPOSITORY_ROOT) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function requireExactActionsRuntime({
  releaseCommit,
  artifactName,
  environment = process.env,
  platform = process.platform,
  repositoryRoot = REPOSITORY_ROOT,
  headReader = readHead,
}) {
  assert.match(releaseCommit || "", SHA_RE);
  canonicalOs(platform);
  const source = sourceFromActions(environment, artifactName);
  assert.equal(
    headReader(repositoryRoot),
    releaseCommit,
    "SESSION-UX producer checkout must equal the requested exact commit",
  );
  return source;
}

function readProducerAtHead(
  producerPath,
  headSha,
  repositoryRoot = REPOSITORY_ROOT,
) {
  return execFileSync(
    "git",
    ["cat-file", "blob", `${headSha}:${producerPath}`],
    {
      cwd: repositoryRoot,
      encoding: null,
      maxBuffer: 128 * MIB,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function producerDigestsAtHead({
  headSha,
  repositoryRoot = REPOSITORY_ROOT,
  producerReader = readProducerAtHead,
  requireWorkingTreeMatch = true,
} = {}) {
  assert.match(headSha || "", SHA_RE);
  if (requireWorkingTreeMatch) {
    execFileSync(
      "git",
      ["diff", "--quiet", headSha, "--", ...SESSION_UX_PRODUCER_PATHS],
      { cwd: repositoryRoot, stdio: "ignore" },
    );
  }
  return Object.fromEntries(
    SESSION_UX_PRODUCER_PATHS.map((producerPath) => [
      producerPath,
      digest(producerReader(producerPath, headSha, repositoryRoot)),
    ]),
  );
}

function syntheticSessions() {
  return Array.from({ length: 128 }, (_, index) => ({
    id: `session-${String(index).padStart(3, "0")}`,
    title: `SESSION-UX scale session ${index}`,
    workspace: "/workspace/session-ux",
    updated_at: `2026-08-21T00:${String(index % 60).padStart(2, "0")}:00Z`,
    ...(index === 0
      ? {
          liveTool: { name: "verify_session_ux", status: "running" },
          latestTodo: "Verify the three-OS session workbench",
          pendingQuestion: { question: "Publish the canonical fragment?" },
          settledAnswer: { answer: "Only after exact-head verification" },
        }
      : {}),
  }));
}

function measureSessionUxProjectionSurfaces({ stateFile } = {}) {
  const temporaryRoot = stateFile
    ? null
    : fs.mkdtempSync(path.join(os.tmpdir(), "cc-session-ux-projection-"));
  const resolvedStateFile =
    stateFile || path.join(temporaryRoot, "session-workbench.json");
  try {
    const makeStore = () =>
      new SessionWorkbenchStore({
        filePath: resolvedStateFile,
        uuid: () => "00000000-0000-0000-0000-000000000128",
      });
    const first = makeStore();
    const staleWindow = makeStore();
    const empty = first.projection();
    const created = first.createGroup({
      name: "SESSION-UX Release",
      expectedRevision: empty.revision,
    });
    const groupId = created.items[0].id;
    let staleCasErrorCode = null;
    try {
      staleWindow.createGroup({
        name: "Stale writer",
        expectedRevision: empty.revision,
      });
    } catch (error) {
      staleCasErrorCode = error?.code || null;
    }
    assert.equal(staleCasErrorCode, "SESSION_GROUP_STALE");

    const sources = syntheticSessions();
    const sessionIds = sources.map((source) =>
      canonicalSessionId("local", source.id),
    );
    const moved = first.moveSessions({
      groupId,
      sessionIds,
      expectedRevision: created.revision,
    });
    const persisted = makeStore().projection();
    const projection = buildSessionProjection({
      local: sources,
      sessionWorkbench: persisted,
      generatedAt: "2026-08-21T01:28:00.000Z",
    });
    const parsed = parseSessionProjection(JSON.stringify(projection));
    assert.equal(parsed.connected, true);
    const focused = focusRows(parsed.rows);
    const mutationArgs = buildSessionGroupMutationArgs({
      action: "move",
      groupId,
      sessionIds: parsed.rows.map((row) => row.id),
      expectedRevision: parsed.groups.revision,
    });
    assert.ok(mutationArgs);
    const expectedRevisionIndex = mutationArgs.indexOf("--expected-revision");
    const rendered = renderWorkbenchHtml(parsed.rows, {
      now: Date.parse("2026-08-21T01:28:00.000Z"),
    });
    const firstFocused = focused[0] || {};
    const cli = {
      sessionCount: projection.sessions.length,
      groupCount: persisted.items.length,
      assignmentCount: moved.assignments.length,
      groupedSessionCount: projection.sessions.filter(
        (session) => session.groupId === groupId,
      ).length,
      persistedAssignmentCount: persisted.assignments.length,
      revisionChangedAfterCreate: created.revision !== empty.revision,
      revisionChangedAfterMove: moved.revision !== created.revision,
      staleCasRejectionCount:
        staleCasErrorCode === "SESSION_GROUP_STALE" ? 1 : 0,
      staleCasErrorCode,
    };
    const vscode = {
      projectionConnected: parsed.connected,
      sessionCount: parsed.rows.length,
      groupCount: parsed.groups.items.length,
      groupRevisionPreserved: parsed.groups.revision === persisted.revision,
      groupedSessionCount: parsed.rows.filter((row) => row.groupId === groupId)
        .length,
      focusRowCount: focused.length,
      pendingQuestionPreserved:
        firstFocused.focus?.pendingQuestion ===
        "Publish the canonical fragment?",
      settledAnswerPreserved:
        firstFocused.focus?.settledAnswer ===
        "Only after exact-head verification",
      atomicMoveArgumentSessionCount: Math.max(0, expectedRevisionIndex - 4),
      atomicMoveExpectedRevisionPreserved:
        mutationArgs[expectedRevisionIndex + 1] === persisted.revision,
      renderedRowCount: (rendered.match(/<tr data-session-row>/gu) || [])
        .length,
      renderedSelectionControlCount: (
        rendered.match(/data-session-select/gu) || []
      ).length,
      ariaRowCount: Number(
        rendered.match(/aria-rowcount="(\d+)"/u)?.[1] || Number.NaN,
      ),
    };
    return { groupId, projection, parsed, cli, vscode };
  } finally {
    if (temporaryRoot) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

async function measureVscodeBrowserSurfaces(
  { projection, parsed, groupId },
  { launchOptions = {} } = {},
) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, ...launchOptions });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    globalThis.__ccVscodeMessages = [];
    globalThis.acquireVsCodeApi = () => ({
      postMessage(message) {
        globalThis.__ccVscodeMessages.push(message);
      },
      getState() {
        return null;
      },
      setState() {},
    });
  });
  try {
    const workbench = await context.newPage();
    await workbench.setContent(renderPageHtml(), {
      waitUntil: "domcontentloaded",
    });
    const rendered = renderWorkbenchHtml(parsed.rows, {
      now: Date.parse("2026-08-21T01:28:00.000Z"),
    });
    await workbench.evaluate(
      ({ html, visible, total, groups }) => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "rows",
              html,
              visible,
              total,
              focusOnly: false,
              groups,
            },
          }),
        );
      },
      {
        html: rendered,
        visible: parsed.rows.length,
        total: projection.sessions.length,
        groups: parsed.groups,
      },
    );
    await workbench.selectOption("#group-target", groupId);
    await workbench.locator("#list").dispatchEvent("keydown", {
      key: "a",
      ctrlKey: true,
    });
    const selectedSessionCount = await workbench
      .locator("#list input[data-session-select]:checked")
      .count();
    await workbench.locator("#list").dispatchEvent("keydown", {
      key: "m",
      altKey: true,
    });
    const groupMove = await workbench.evaluate(() =>
      [...globalThis.__ccVscodeMessages]
        .reverse()
        .find(
          (message) =>
            message?.command === "group" && message?.groupAction === "move",
        ),
    );

    const chat = await context.newPage();
    await chat.setContent(
      buildChatHtml({
        cspSource: "https://session-ux.invalid",
        nonce: "sessionuxnonce",
        l10n: {},
      }),
      { waitUntil: "domcontentloaded" },
    );
    await chat.evaluate(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { kind: "thinking", text: "first reasoning block" },
        }),
      ),
    );
    const thinkingExpandedWhileStreaming = await chat
      .locator("details.thinking")
      .first()
      .evaluate((element) => element.open === true);
    await chat.evaluate(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { kind: "tool", tool: "verify_session_ux", summary: "running" },
        }),
      ),
    );
    const thinkingCollapsedAfterTool = await chat
      .locator("details.thinking")
      .first()
      .evaluate((element) => element.open === false);
    await chat.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { kind: "thinking", text: "second reasoning block" },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { kind: "turn_end", text: "settled answer" },
        }),
      );
    });
    const thinkingCollapsedAfterTurnEnd = await chat
      .locator("details.thinking")
      .last()
      .evaluate((element) => element.open === false);
    const thinkingCollapseFailureCount = [
      thinkingExpandedWhileStreaming,
      thinkingCollapsedAfterTool,
      thinkingCollapsedAfterTurnEnd,
    ].filter((value) => value !== true).length;
    return {
      selectedSessionCount,
      postedMoveSessionCount: Array.isArray(groupMove?.ids)
        ? groupMove.ids.length
        : 0,
      postedMoveRevisionPreserved:
        groupMove?.groupRevision === parsed.groups.revision,
      thinkingExpandedWhileStreaming,
      thinkingCollapsedAfterTool,
      thinkingCollapsedAfterTurnEnd,
      thinkingCollapseFailureCount,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

function buildSessionUxNodeEvidence({
  headSha,
  platform,
  source,
  projectionBytes,
  projectionRevision,
  groupRevision,
  cli,
  vscode,
  nodeVersion = process.version,
  nodeArch = process.arch,
}) {
  const evidence = {
    schema: "chainlesschain.session-ux-node-evidence.v1",
    headSha,
    platform,
    nodeVersion,
    nodeArch,
    source,
    projectionDigest: digest(projectionBytes),
    projectionRevision,
    groupRevision,
    cli,
    vscode,
  };
  validateNodeEvidence(evidence, {
    headSha,
    platform,
    source,
    projectionBytes,
  });
  return evidence;
}

function validateNodeEvidence(
  evidence,
  { headSha, platform, source, projectionBytes },
) {
  assertExactKeys(evidence, NODE_EVIDENCE_KEYS, "SESSION-UX Node evidence");
  assert.equal(evidence.schema, "chainlesschain.session-ux-node-evidence.v1");
  assert.equal(evidence.headSha, headSha);
  assert.equal(evidence.platform, platform);
  assert.ok(typeof evidence.nodeVersion === "string" && evidence.nodeVersion);
  assert.ok(typeof evidence.nodeArch === "string" && evidence.nodeArch);
  assert.deepEqual(validateSource(evidence.source), source);
  assert.equal(evidence.projectionDigest, digest(projectionBytes));
  assert.match(evidence.projectionRevision || "", DIGEST_RE);
  assert.match(evidence.groupRevision || "", DIGEST_RE);
  assertExactKeys(
    evidence.cli,
    CLI_MEASUREMENT_KEYS,
    "SESSION-UX CLI measurements",
  );
  assertExactKeys(
    evidence.vscode,
    VSCODE_MEASUREMENT_KEYS,
    "SESSION-UX VS Code measurements",
  );
  return evidence;
}

function validateJetbrainsEvidence(
  evidence,
  {
    headSha,
    platform,
    source,
    projectionBytes,
    projectionRevision,
    groupRevision,
  },
) {
  assertExactKeys(
    evidence,
    JETBRAINS_EVIDENCE_KEYS,
    "SESSION-UX JetBrains evidence",
  );
  assert.equal(
    evidence.schema,
    "chainlesschain.session-ux-jetbrains-evidence.v1",
  );
  assert.equal(evidence.headSha, headSha);
  assert.equal(evidence.platform, platform);
  assert.ok(typeof evidence.javaVersion === "string" && evidence.javaVersion);
  assert.ok(typeof evidence.javaArch === "string" && evidence.javaArch);
  assert.deepEqual(validateSource(evidence.source), source);
  assert.equal(evidence.projectionDigest, digest(projectionBytes));
  assert.equal(evidence.projectionRevision, projectionRevision);
  assert.equal(evidence.groupRevision, groupRevision);
  assertExactKeys(
    evidence.measurements,
    JETBRAINS_MEASUREMENT_KEYS,
    "SESSION-UX JetBrains measurements",
  );
  return evidence;
}

function validateProjectionEvidence({
  projectionBytes,
  nodeEvidence,
  jetbrainsEvidence,
  headSha,
  platform,
  source,
}) {
  const projection = JSON.parse(projectionBytes.toString("utf8"));
  const parsed = parseSessionProjection(projection);
  assert.equal(parsed.connected, true);
  validateNodeEvidence(nodeEvidence, {
    headSha,
    platform,
    source,
    projectionBytes,
  });
  assert.equal(nodeEvidence.projectionRevision, projection.revision);
  assert.equal(nodeEvidence.groupRevision, projection.groups.revision);
  assert.equal(nodeEvidence.cli.sessionCount, projection.sessions.length);
  assert.equal(nodeEvidence.vscode.sessionCount, parsed.rows.length);
  assert.equal(nodeEvidence.vscode.groupCount, parsed.groups.items.length);
  assert.equal(
    nodeEvidence.vscode.groupedSessionCount,
    parsed.rows.filter((row) => Boolean(row.groupId)).length,
  );
  assert.equal(
    nodeEvidence.vscode.focusRowCount,
    focusRows(parsed.rows).length,
  );
  validateJetbrainsEvidence(jetbrainsEvidence, {
    headSha,
    platform,
    source,
    projectionBytes,
    projectionRevision: projection.revision,
    groupRevision: projection.groups.revision,
  });
  const sessionCount = projection.sessions.length;
  const assignmentCount = projection.groups.assignments.length;
  const groupCount = projection.groups.items.length;
  const focusRowCount = focusRows(parsed.rows).length;
  assert.equal(nodeEvidence.cli.assignmentCount, assignmentCount);
  assert.equal(nodeEvidence.cli.persistedAssignmentCount, assignmentCount);
  assert.equal(nodeEvidence.cli.groupedSessionCount, assignmentCount);
  assert.equal(
    nodeEvidence.vscode.atomicMoveArgumentSessionCount,
    sessionCount,
  );
  assert.equal(nodeEvidence.vscode.renderedRowCount, sessionCount);
  assert.equal(nodeEvidence.vscode.renderedSelectionControlCount, sessionCount);
  assert.equal(nodeEvidence.vscode.ariaRowCount, sessionCount);
  assert.equal(nodeEvidence.vscode.selectedSessionCount, sessionCount);
  assert.equal(nodeEvidence.vscode.postedMoveSessionCount, sessionCount);
  assert.equal(jetbrainsEvidence.measurements.sessionCount, sessionCount);
  assert.equal(jetbrainsEvidence.measurements.groupCount, groupCount);
  assert.equal(
    jetbrainsEvidence.measurements.groupedSessionCount,
    assignmentCount,
  );
  assert.equal(jetbrainsEvidence.measurements.focusRowCount, focusRowCount);
  return { projection, parsed };
}

function measurementsPass(measurements) {
  const cli = measurements.cli;
  const vscode = measurements.vscode;
  const jetbrains = measurements.jetbrains;
  return (
    cli.sessionCount >= SESSION_UX_THRESHOLDS.sessionCountMinimum &&
    cli.groupCount >= SESSION_UX_THRESHOLDS.groupCountMinimum &&
    cli.groupedSessionCount >=
      SESSION_UX_THRESHOLDS.groupedSessionCountMinimum &&
    cli.assignmentCount >= SESSION_UX_THRESHOLDS.groupedSessionCountMinimum &&
    cli.persistedAssignmentCount >=
      SESSION_UX_THRESHOLDS.groupedSessionCountMinimum &&
    cli.revisionChangedAfterCreate === true &&
    cli.revisionChangedAfterMove === true &&
    cli.staleCasErrorCode === "SESSION_GROUP_STALE" &&
    cli.staleCasRejectionCount >=
      SESSION_UX_THRESHOLDS.staleCasRejectionCountMinimum &&
    vscode.projectionConnected === true &&
    vscode.sessionCount >= SESSION_UX_THRESHOLDS.sessionCountMinimum &&
    vscode.groupCount >= SESSION_UX_THRESHOLDS.groupCountMinimum &&
    vscode.groupRevisionPreserved === true &&
    vscode.groupedSessionCount >=
      SESSION_UX_THRESHOLDS.groupedSessionCountMinimum &&
    vscode.focusRowCount >= SESSION_UX_THRESHOLDS.focusRowCountMinimum &&
    vscode.pendingQuestionPreserved === true &&
    vscode.settledAnswerPreserved === true &&
    vscode.atomicMoveArgumentSessionCount >=
      SESSION_UX_THRESHOLDS.multiSelectCountMinimum &&
    vscode.atomicMoveExpectedRevisionPreserved === true &&
    vscode.renderedRowCount >= SESSION_UX_THRESHOLDS.sessionCountMinimum &&
    vscode.renderedSelectionControlCount >=
      SESSION_UX_THRESHOLDS.multiSelectCountMinimum &&
    vscode.ariaRowCount >= SESSION_UX_THRESHOLDS.sessionCountMinimum &&
    vscode.selectedSessionCount >=
      SESSION_UX_THRESHOLDS.multiSelectCountMinimum &&
    vscode.postedMoveSessionCount >=
      SESSION_UX_THRESHOLDS.multiSelectCountMinimum &&
    vscode.postedMoveRevisionPreserved === true &&
    vscode.thinkingExpandedWhileStreaming === true &&
    vscode.thinkingCollapsedAfterTool === true &&
    vscode.thinkingCollapsedAfterTurnEnd === true &&
    vscode.thinkingCollapseFailureCount <=
      SESSION_UX_THRESHOLDS.thinkingCollapseFailureCountMaximum &&
    jetbrains.projectionConnected === true &&
    jetbrains.sessionCount >= SESSION_UX_THRESHOLDS.sessionCountMinimum &&
    jetbrains.groupCount >= SESSION_UX_THRESHOLDS.groupCountMinimum &&
    jetbrains.groupRevisionPreserved === true &&
    jetbrains.groupedSessionCount >=
      SESSION_UX_THRESHOLDS.groupedSessionCountMinimum &&
    jetbrains.focusRowCount >= SESSION_UX_THRESHOLDS.focusRowCountMinimum &&
    jetbrains.pendingQuestionPreserved === true &&
    jetbrains.settledAnswerPreserved === true &&
    jetbrains.reasoningExpandedBeforeSettlement === true &&
    jetbrains.reasoningCollapsedAfterSettlement === true &&
    jetbrains.reasoningRestoredAfterToggle === true &&
    jetbrains.thinkingCollapseFailureCount <=
      SESSION_UX_THRESHOLDS.thinkingCollapseFailureCountMaximum
  );
}

function buildSessionUxFragment({
  nodeEvidence,
  jetbrainsEvidence,
  headSha,
  os: fragmentOs,
  source,
  producerDigests,
}) {
  const measurements = {
    cli: nodeEvidence.cli,
    vscode: nodeEvidence.vscode,
    jetbrains: jetbrainsEvidence.measurements,
  };
  return {
    schema: FRAGMENT_SCHEMA,
    commitmentId: "SESSION-UX",
    headSha,
    os: fragmentOs,
    runtime: {
      name: "node+java",
      version: `${nodeEvidence.nodeVersion};${jetbrainsEvidence.javaVersion}`,
      arch: nodeEvidence.nodeArch,
    },
    profileVersion: SESSION_UX_PROFILE_VERSION,
    thresholds: SESSION_UX_THRESHOLDS,
    measurements,
    testIds: [...SESSION_UX_TEST_IDS],
    producerDigests,
    disposition: "required",
    source,
    outcome: measurementsPass(measurements) ? "passed" : "failed",
  };
}

function validateSessionUxFragment(fragment) {
  assertExactKeys(fragment, FRAGMENT_KEYS, "SESSION-UX fragment");
  assert.equal(fragment.schema, FRAGMENT_SCHEMA);
  assert.equal(fragment.commitmentId, "SESSION-UX");
  assert.match(fragment.headSha || "", SHA_RE);
  assert.ok(["linux", "macos", "windows"].includes(fragment.os));
  assertExactKeys(fragment.runtime, ["arch", "name", "version"], "runtime");
  assert.equal(fragment.runtime.name, "node+java");
  assert.equal(fragment.profileVersion, SESSION_UX_PROFILE_VERSION);
  assert.deepEqual(fragment.thresholds, SESSION_UX_THRESHOLDS);
  assert.deepEqual(fragment.testIds, SESSION_UX_TEST_IDS);
  assert.equal(fragment.disposition, "required");
  assert.equal(fragment.outcome, "passed");
  validateSource(fragment.source);
  assert.deepEqual(
    Object.keys(fragment.producerDigests || {}).sort(),
    [...SESSION_UX_PRODUCER_PATHS].sort(),
  );
  for (const value of Object.values(fragment.producerDigests)) {
    assert.match(value, DIGEST_RE);
  }
  assertExactKeys(
    fragment.measurements,
    ["cli", "jetbrains", "vscode"],
    "measurements",
  );
  assertExactKeys(
    fragment.measurements.cli,
    CLI_MEASUREMENT_KEYS,
    "measurements/cli",
  );
  assertExactKeys(
    fragment.measurements.vscode,
    VSCODE_MEASUREMENT_KEYS,
    "measurements/vscode",
  );
  assertExactKeys(
    fragment.measurements.jetbrains,
    JETBRAINS_MEASUREMENT_KEYS,
    "measurements/jetbrains",
  );
  assert.equal(measurementsPass(fragment.measurements), true);
  return fragment;
}

function manifestEntry(filePath) {
  const bytes = fs.readFileSync(filePath);
  return { sha256: digest(bytes), bytes: bytes.length };
}

async function prepareSessionUxEvidence({
  releaseCommit,
  artifactName,
  projectionOutput,
  nodeEvidenceOutput,
  environment = process.env,
  platform = process.platform,
  repositoryRoot = REPOSITORY_ROOT,
  headReader = readHead,
}) {
  const source = requireExactActionsRuntime({
    releaseCommit,
    artifactName,
    environment,
    platform,
    repositoryRoot,
    headReader,
  });
  const measured = measureSessionUxProjectionSurfaces();
  const projectionBytes = Buffer.from(
    `${JSON.stringify(measured.projection, null, 2)}\n`,
  );
  const browser = await measureVscodeBrowserSurfaces(measured);
  const nodeEvidence = buildSessionUxNodeEvidence({
    headSha: releaseCommit,
    platform,
    source,
    projectionBytes,
    projectionRevision: measured.projection.revision,
    groupRevision: measured.projection.groups.revision,
    cli: measured.cli,
    vscode: { ...measured.vscode, ...browser },
  });
  fs.mkdirSync(path.dirname(path.resolve(projectionOutput)), {
    recursive: true,
  });
  fs.writeFileSync(path.resolve(projectionOutput), projectionBytes);
  writeJson(path.resolve(nodeEvidenceOutput), nodeEvidence);
  return { nodeEvidence, projection: measured.projection };
}

function appendSessionUxFragment({
  artifactDir,
  releaseCommit,
  artifactName,
  projectionPath,
  nodeEvidencePath,
  jetbrainsEvidencePath,
  environment = process.env,
  platform = process.platform,
  repositoryRoot = REPOSITORY_ROOT,
  producerReader = readProducerAtHead,
  requireWorkingTreeMatch = true,
  headReader = readHead,
}) {
  const source = requireExactActionsRuntime({
    releaseCommit,
    artifactName,
    environment,
    platform,
    repositoryRoot,
    headReader,
  });
  const resolved = path.resolve(artifactDir);
  assert.equal(fs.existsSync(path.join(resolved, "failure.json")), false);
  const manifestPath = path.join(resolved, "manifest.json");
  const manifest = readJson(manifestPath);
  assert.equal(manifest.releaseCommit, releaseCommit);
  const host = readJson(path.join(resolved, "host-environment.json"));
  assert.equal(host.releaseCommit, releaseCommit);
  assert.equal(host.operatingSystem, platform);
  assert.deepEqual(
    {
      workflowId: host.provenance.workflowRef,
      runId: host.provenance.runId,
      jobId: host.provenance.job,
      artifactName: host.provenance.artifactName,
    },
    source,
  );

  const inputs = [
    [SESSION_UX_PROJECTION_FILE, projectionPath],
    [SESSION_UX_NODE_EVIDENCE_FILE, nodeEvidencePath],
    [SESSION_UX_JETBRAINS_EVIDENCE_FILE, jetbrainsEvidencePath],
  ];
  for (const [file, input] of inputs) {
    assert.ok(input && fs.statSync(path.resolve(input)).isFile(), file);
    fs.copyFileSync(path.resolve(input), path.join(resolved, file));
    manifest.files[file] = manifestEntry(path.join(resolved, file));
  }
  const projectionBytes = fs.readFileSync(
    path.join(resolved, SESSION_UX_PROJECTION_FILE),
  );
  const nodeEvidence = readJson(
    path.join(resolved, SESSION_UX_NODE_EVIDENCE_FILE),
  );
  const jetbrainsEvidence = readJson(
    path.join(resolved, SESSION_UX_JETBRAINS_EVIDENCE_FILE),
  );
  validateProjectionEvidence({
    projectionBytes,
    nodeEvidence,
    jetbrainsEvidence,
    headSha: releaseCommit,
    platform,
    source,
  });
  const fragment = buildSessionUxFragment({
    nodeEvidence,
    jetbrainsEvidence,
    headSha: releaseCommit,
    os: canonicalOs(platform),
    source,
    producerDigests: producerDigestsAtHead({
      headSha: releaseCommit,
      repositoryRoot,
      producerReader,
      requireWorkingTreeMatch,
    }),
  });
  validateSessionUxFragment(fragment);
  const fragmentPath = path.join(resolved, SESSION_UX_FRAGMENT_FILE);
  writeJson(fragmentPath, fragment);
  manifest.files[SESSION_UX_FRAGMENT_FILE] = manifestEntry(fragmentPath);
  writeJson(manifestPath, manifest);
  return fragment;
}

function verifySessionUxFragment({
  artifactDir,
  releaseCommit,
  artifactName,
  expectedPlatform,
  expectedSource,
  repositoryRoot = REPOSITORY_ROOT,
  producerReader = readProducerAtHead,
}) {
  const resolved = path.resolve(artifactDir);
  const manifest = readJson(path.join(resolved, "manifest.json"));
  assert.equal(manifest.releaseCommit, releaseCommit);
  const files = [...SESSION_UX_INPUT_FILES, SESSION_UX_FRAGMENT_FILE];
  for (const file of files) {
    const filePath = path.join(resolved, file);
    assert.deepEqual(manifest.files?.[file], manifestEntry(filePath), file);
  }
  const source = validateSource(expectedSource);
  assert.equal(source.artifactName, artifactName);
  const projectionBytes = fs.readFileSync(
    path.join(resolved, SESSION_UX_PROJECTION_FILE),
  );
  const nodeEvidence = readJson(
    path.join(resolved, SESSION_UX_NODE_EVIDENCE_FILE),
  );
  const jetbrainsEvidence = readJson(
    path.join(resolved, SESSION_UX_JETBRAINS_EVIDENCE_FILE),
  );
  validateProjectionEvidence({
    projectionBytes,
    nodeEvidence,
    jetbrainsEvidence,
    headSha: releaseCommit,
    platform: expectedPlatform,
    source,
  });
  const expected = buildSessionUxFragment({
    nodeEvidence,
    jetbrainsEvidence,
    headSha: releaseCommit,
    os: canonicalOs(expectedPlatform),
    source,
    producerDigests: producerDigestsAtHead({
      headSha: releaseCommit,
      repositoryRoot,
      producerReader,
      requireWorkingTreeMatch: false,
    }),
  });
  const fragmentPath = path.join(resolved, SESSION_UX_FRAGMENT_FILE);
  const actual = readJson(fragmentPath);
  validateSessionUxFragment(actual);
  assert.deepEqual(actual, expected);
  return {
    required: actual,
    requiredDigest: digest(fs.readFileSync(fragmentPath)),
  };
}

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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const releaseCommit = String(options.releaseCommit || "").toLowerCase();
  if (options.mode === "prepare") {
    await prepareSessionUxEvidence({
      releaseCommit,
      artifactName: options.artifactName,
      projectionOutput: options.projectionOutput,
      nodeEvidenceOutput: options.nodeEvidenceOutput,
    });
    return;
  }
  assert.equal(options.mode, "append");
  appendSessionUxFragment({
    artifactDir: options.artifactDir,
    releaseCommit,
    artifactName: options.artifactName,
    projectionPath: options.projection,
    nodeEvidencePath: options.nodeEvidence,
    jetbrainsEvidencePath: options.jetbrainsEvidence,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}

export {
  CLI_MEASUREMENT_KEYS,
  FRAGMENT_KEYS,
  JETBRAINS_MEASUREMENT_KEYS,
  NODE_EVIDENCE_KEYS,
  SESSION_UX_FRAGMENT_FILE,
  SESSION_UX_INPUT_FILES,
  SESSION_UX_JETBRAINS_EVIDENCE_FILE,
  SESSION_UX_NODE_EVIDENCE_FILE,
  SESSION_UX_PRODUCER_PATHS,
  SESSION_UX_PROFILE_VERSION,
  SESSION_UX_PROJECTION_FILE,
  SESSION_UX_TEST_IDS,
  SESSION_UX_THRESHOLDS,
  VSCODE_MEASUREMENT_KEYS,
  SESSION_UX_PRODUCER_PATHS as PRODUCER_PATHS,
  SESSION_UX_PROFILE_VERSION as PROFILE_VERSION,
  SESSION_UX_TEST_IDS as TEST_IDS,
  SESSION_UX_THRESHOLDS as THRESHOLDS,
  appendSessionUxFragment,
  buildSessionUxFragment,
  buildSessionUxNodeEvidence,
  canonicalOs,
  digest,
  measureSessionUxProjectionSurfaces,
  measureVscodeBrowserSurfaces,
  prepareSessionUxEvidence,
  producerDigestsAtHead,
  validateSessionUxFragment,
  verifySessionUxFragment,
};
