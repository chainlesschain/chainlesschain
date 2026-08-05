#!/usr/bin/env node

/**
 * Deterministic stream-json peer for real VS Code and JetBrains host journeys.
 *
 * Each host driver puts a wrapper for this file at the front of PATH only for
 * its sandbox IDE process. Production plugin code is therefore exercised
 * unchanged: it still resolves `cc`, spawns a persistent agent, writes NDJSON,
 * and renders protocol events through the normal ConversationView pipeline.
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";
import { buildSessionProjection } from "../../../packages/cli/src/lib/session-projection.js";

const argv = process.argv.slice(2);
const statePath = process.env.CC_UI_FIXTURE_STATE || "";
const tracePath = process.env.CC_UI_FIXTURE_TRACE || "";
const timelineFixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/vscode-extension/src/__fixtures__/checkpoint-timeline/cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
  trace({ direction: "out", event });
}

function trace(record) {
  if (!tracePath) return;
  try {
    appendFileSync(
      tracePath,
      `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  } catch {
    // Evidence capture is useful but must never change protocol behavior.
  }
}

function option(name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function readState() {
  if (!statePath) return { sessions: {} };
  try {
    const value = JSON.parse(readFileSync(statePath, "utf8"));
    return value && typeof value === "object" && value.sessions
      ? value
      : { sessions: {} };
  } catch {
    return { sessions: {} };
  }
}

function writeState(value) {
  if (!statePath) return;
  writeFileSync(statePath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

const WORKBENCH_SESSION_ID = "ui-workbench-session";
const WORKBENCH_BACKGROUND_ID = "ui-workbench-background";

function workbenchStage(state = readState()) {
  const stage = String(state.workbench?.stage || "stopped");
  return new Set(["stopped", "needs_input", "done"]).has(stage)
    ? stage
    : "stopped";
}

function workbenchProjection() {
  const state = readState();
  const stage = workbenchStage(state);
  const background = {
    id: WORKBENCH_BACKGROUND_ID,
    title: "Workbench lifecycle fixture",
    status: stage === "needs_input" ? "running" : "completed",
    phase: stage,
    sessionId: WORKBENCH_SESSION_ID,
    interactive: true,
    cwd: process.cwd(),
    heartbeatAt: Date.parse("2026-08-06T00:04:00.000Z"),
    governance: { owner: "ui-host-fixture" },
  };
  if (stage === "needs_input") {
    background.pendingQuestion = {
      requestId: "ui-workbench-question",
      question: "Choose the deterministic workbench answer",
      options: ["alpha", "beta"],
    };
  }
  const artifacts =
    stage === "done"
      ? [
          {
            id: "ui-workbench-artifact",
            sessionId: WORKBENCH_SESSION_ID,
            title: "workbench-result.md",
            kind: "report",
            createdAt: "2026-08-06T00:08:00.000Z",
          },
        ]
      : [];
  return buildSessionProjection({
    generatedAt: "2026-08-06T00:10:00.000Z",
    local: [
      {
        id: WORKBENCH_SESSION_ID,
        title: "Workbench saved session",
        workspace: process.cwd(),
        updated_at: "2026-08-06 00:00:00",
      },
    ],
    background: [background],
    remote: [
      {
        remoteSessionId: "ui-workbench-remote",
        agentSessionId: WORKBENCH_SESSION_ID,
        peerId: "ui-host-peer",
        alive: true,
        port: 18888,
        host: "127.0.0.1",
        mode: "fixture",
      },
    ],
    team: [
      {
        id: "ui-workbench-team",
        kind: "team",
        status: "blocked",
        owner: "team:ui-workbench-team",
        updatedAt: Date.parse("2026-08-06T00:06:00.000Z"),
        units: [
          {
            key: "review",
            sessionId: "ui-workbench-team-session",
            status: "blocked",
            sideEffects: { unknown: 1 },
          },
        ],
      },
    ],
    workflow: [
      {
        id: "ui-workbench-workflow",
        sessionId: "ui-workbench-workflow",
        stage: "plan",
        hasPlan: true,
        approved: false,
        cwd: process.cwd(),
        updatedAt: "2026-08-06T00:05:00.000Z",
      },
    ],
    artifacts,
    prLinks:
      stage === "done"
        ? {
            [WORKBENCH_SESSION_ID]: [
              {
                number: 88,
                repo: "chainlesschain/chainlesschain",
                url: "https://github.com/chainlesschain/chainlesschain/pull/88",
                state: "merged",
                updatedAt: Date.parse("2026-08-06T00:09:00.000Z"),
              },
            ],
          }
        : {},
  });
}

function updateWorkbench(stage, details = {}) {
  const state = readState();
  state.workbench = {
    ...(state.workbench || {}),
    ...details,
    stage,
  };
  writeState(state);
  return state.workbench;
}

function handleWorkbenchCommand() {
  if (argv[0] === "session" && argv[1] === "projection") {
    trace({ direction: "command", command: "session-projection" });
    writeJson(workbenchProjection());
    return true;
  }
  if (argv[0] === "daemon" && argv[1] === "resume") {
    const id = String(argv[2] || "");
    const prompt = String(argv[3] || "");
    if (id !== WORKBENCH_BACKGROUND_ID || !prompt) {
      process.stderr.write("invalid workbench resume request\n");
      process.exitCode = 1;
      return true;
    }
    const stage = workbenchStage();
    if (stage !== "stopped" && stage !== "done") {
      process.stderr.write(`workbench session cannot resume from ${stage}\n`);
      process.exitCode = 1;
      return true;
    }
    const workbench = updateWorkbench("needs_input", {
      dispatchPrompt: prompt,
    });
    trace({
      direction: "command",
      command: "daemon-resume",
      id,
      stage: workbench.stage,
    });
    writeJson({ id, accepted: true, phase: workbench.stage });
    return true;
  }
  if (argv[0] === "daemon" && argv[1] === "reply") {
    const id = String(argv[2] || "");
    const prompt = String(argv[3] || "");
    if (
      id !== WORKBENCH_BACKGROUND_ID ||
      !prompt ||
      workbenchStage() !== "needs_input"
    ) {
      process.stderr.write("invalid workbench reply request\n");
      process.exitCode = 1;
      return true;
    }
    const workbench = updateWorkbench("done", { replyPrompt: prompt });
    trace({
      direction: "command",
      command: "daemon-reply",
      id,
      stage: workbench.stage,
    });
    writeJson({ id, accepted: true, queued: 1, phase: workbench.stage });
    return true;
  }
  if (argv[0] === "daemon" && argv[1] === "view") {
    writeJson({
      session: {
        id: WORKBENCH_BACKGROUND_ID,
        phase: workbenchStage(),
        sessionId: WORKBENCH_SESSION_ID,
      },
      log: "deterministic workbench fixture",
    });
    return true;
  }
  return false;
}

function projectionForSession(sessionId) {
  const projection = clone(timelineFixture.projection);
  projection.sessionId = sessionId;
  for (const entry of projection.entries) {
    for (const candidate of entry.actions) {
      if (candidate.submission) candidate.submission.sessionId = sessionId;
    }
  }
  return projection;
}

function timelineEntry(projection, turnId) {
  return projection.entries.find((entry) => entry.turnId === turnId) || null;
}

function workspaceConfirmation(action) {
  if (!new Set(["restore-code", "restore-both"]).has(action)) return null;
  return clone(timelineFixture.actionPreview.confirmationSubmission.workspace);
}

function branchResult(submission) {
  if (submission.action !== "branch") return null;
  return {
    branchSessionId: `${submission.sessionId}-branch-${submission.turnId}`,
    parentSessionId: submission.sessionId,
    warnings: ["partial-coverage", "irreversible-side-effects"],
  };
}

function previewTimelineAction(submission) {
  const projection = projectionForSession(submission.sessionId);
  const entry = timelineEntry(projection, submission.turnId);
  if (!entry)
    return {
      schema: "cc-checkpoint-timeline-result/v1",
      version: 1,
      ok: false,
    };
  const action = submission.action;
  const includesCode = action === "restore-code" || action === "restore-both";
  const includesConversation = action !== "restore-code";
  return {
    schema: "cc-checkpoint-timeline-result/v1",
    version: 1,
    ok: true,
    mode: "preview",
    action,
    sessionId: submission.sessionId,
    turnId: submission.turnId,
    revision: submission.revision,
    coverage: entry.coverage,
    excludedPaths: clone(entry.excludedPaths),
    irreversibleSideEffects: clone(entry.irreversibleSideEffects),
    warnings: clone(entry.warnings || []),
    confirmationRequired: true,
    code: includesCode
      ? {
          checkpointId: submission.checkpointId,
          modified: ["src/a.js"],
          added: [],
          deleted: ["old.js"],
        }
      : null,
    conversation: includesConversation
      ? { beforeMessages: 9, afterMessages: 4, affectedMessages: 5 }
      : null,
    branch: branchResult(submission),
    confirmationSubmission: {
      schema: "cc-checkpoint-timeline-confirmation/v1",
      version: 1,
      authority: "cli",
      submission: clone(submission),
      workspace: workspaceConfirmation(action),
      digest: `sha256:${"6".repeat(64)}`,
    },
  };
}

function commitTimelineAction(confirmation) {
  const submission = confirmation?.submission || {};
  const projection = projectionForSession(
    submission.sessionId || "ui-host-session",
  );
  const entry = timelineEntry(projection, submission.turnId);
  if (!entry)
    return {
      schema: "cc-checkpoint-timeline-result/v1",
      version: 1,
      ok: false,
    };
  return {
    schema: "cc-checkpoint-timeline-result/v1",
    version: 1,
    ok: true,
    mode: "commit",
    action: submission.action,
    sessionId: submission.sessionId,
    turnId: submission.turnId,
    revision: submission.revision,
    coverage: entry.coverage,
    excludedPaths: clone(entry.excludedPaths),
    irreversibleSideEffects: clone(entry.irreversibleSideEffects),
    result: {
      code:
        submission.action === "restore-code" ||
        submission.action === "restore-both"
          ? { restored: true, checkpointId: submission.checkpointId }
          : null,
      conversation:
        submission.action !== "restore-code"
          ? { restored: true, afterMessages: 4 }
          : null,
      branch: branchResult(submission),
    },
  };
}

function handleCheckpointCommand() {
  const sessionId = option("-s", "ui-host-session");
  if (argv[1] === "timeline") {
    trace({ direction: "command", command: "checkpoint-timeline", sessionId });
    writeJson(projectionForSession(sessionId));
    return true;
  }
  if (argv[1] === "action") {
    let envelope;
    try {
      envelope = JSON.parse(option("--submission", "{}"));
    } catch {
      envelope = {};
    }
    const mode = argv.includes("--preview") ? "preview" : "confirm";
    const submission = mode === "preview" ? envelope : envelope.submission;
    trace({
      direction: "command",
      command: "checkpoint-action",
      mode,
      sessionId,
      action: submission?.action || null,
      turnId: submission?.turnId || null,
    });
    writeJson(
      mode === "preview"
        ? previewTimelineAction(envelope)
        : commitTimelineAction(envelope),
    );
    return true;
  }
  return false;
}

function textDelta(text) {
  emit({
    type: "stream_event",
    event: { delta: { type: "text_delta", text } },
  });
}

function finish(turn, result, extra = {}) {
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    turn,
    result,
    usage: { input_tokens: 32, output_tokens: 12 },
    ...extra,
  });
}

if (argv.includes("--version")) {
  process.stdout.write("0.999.0-ui-journey\n");
  process.exit(0);
}

// ConversationView probes these after a turn. Keep machine output valid so a
// successful journey does not collect unrelated parse warnings.
if (argv[0] === "context") {
  process.stdout.write(
    `${JSON.stringify({ total: 44, window: 4096, pct: 1, overflow: false })}\n`,
  );
  process.exit(0);
}

if (argv[0] === "checkpoint" && handleCheckpointCommand()) {
  process.exit(0);
}

if (handleWorkbenchCommand()) {
  process.exit(process.exitCode || 0);
}

if (argv[0] !== "agent") {
  process.stdout.write("\n");
  process.exit(0);
}

const sessionId = option("--resume", "ui-host-session");
const state = readState();
const priorMessages = Number(state.sessions[sessionId] || 0);
let turn = Math.floor(priorMessages / 2);
let pending = null;
let interruptedTimer = null;

emit({
  type: "system",
  subtype: "init",
  protocol_version: 1,
  provider: "ui-fixture",
  model: "deterministic-host-peer",
  session_id: sessionId,
  resumed_messages: priorMessages,
  slash_commands: ["compact", "context", "cost", "doctor"],
});

function rememberTurn() {
  state.sessions[sessionId] = Math.max(
    Number(state.sessions[sessionId] || 0),
    turn * 2,
  );
  writeState(state);
}

function handleUser(event) {
  turn += 1;
  rememberTurn();
  const text = String(event.text || "");

  if (text.includes("journey:plan")) {
    pending = { kind: "plan", turn };
    emit({
      type: "plan_update",
      active: true,
      state: "awaiting_approval",
      plan_id: `fixture-plan-${turn}`,
      plan_version: 1,
      risk: "low",
      execution_lock: { revision: turn, locked: true },
      items: [
        { title: "Inspect fixture", tool: "read_file", status: "pending" },
        { title: "Run verification", tool: "run_command", status: "pending" },
      ],
    });
    return;
  }

  if (text.includes("journey:permission")) {
    pending = { kind: "approval", turn, id: `fixture-approval-${turn}` };
    emit({
      type: "approval_request",
      id: pending.id,
      tool: "run_command",
      command: "npm test -- --fixture",
      risk: "medium",
      reason: "Deterministic host-journey approval",
    });
    return;
  }

  if (text.includes("journey:question")) {
    pending = { kind: "question", turn, id: `fixture-question-${turn}` };
    emit({
      type: "question_request",
      id: pending.id,
      question: "Choose the deterministic fixture answer",
      options: ["alpha", "beta"],
      multiSelect: false,
    });
    return;
  }

  if (text.includes("journey:stop")) {
    pending = { kind: "interrupt", turn };
    textDelta(`fixture stop waiting #${turn}`);
    return;
  }

  textDelta(`fixture stream part A #${turn} `);
  setTimeout(() => {
    textDelta(`fixture stream complete #${turn}`);
    finish(turn, `fixture stream complete #${turn}`);
  }, 40);
}

function handleControl(event) {
  if (event.type === "interrupt" && pending?.kind === "interrupt") {
    const stoppedTurn = pending.turn;
    // Deliberately leave enough time for the UI's second-click force-stop path.
    // A single Stop still resolves normally after the grace period.
    interruptedTimer = setTimeout(() => {
      pending = null;
      emit({
        type: "result",
        subtype: "interrupted",
        interrupted: true,
        is_error: false,
        turn: stoppedTurn,
      });
    }, 3_000);
    return;
  }

  if (event.type === "plan" && pending?.kind === "plan") {
    const planTurn = pending.turn;
    const action = String(event.action || "");
    pending = null;
    emit({
      type: "plan_update",
      active: false,
      state: action === "reject" ? "rejected" : "approved",
      plan_id: `fixture-plan-${planTurn}`,
      plan_version: 2,
      items: [],
      note: `fixture plan ${action}`,
    });
    textDelta(`fixture plan ${action} #${planTurn}`);
    finish(planTurn, `fixture plan ${action} #${planTurn}`);
    return;
  }

  if (
    event.type === "approval" &&
    pending?.kind === "approval" &&
    event.id === pending.id
  ) {
    const approval = pending;
    pending = null;
    emit({
      type: "approval_resolved",
      id: approval.id,
      approved: event.approve === true,
      via: "ui-host-fixture",
    });
    textDelta(
      `fixture permission ${event.approve === true ? "approved" : "denied"} #${approval.turn}`,
    );
    finish(approval.turn, "fixture permission settled");
    return;
  }

  if (
    event.type === "answer" &&
    pending?.kind === "question" &&
    event.id === pending.id
  ) {
    const question = pending;
    pending = null;
    emit({ type: "question_resolved", id: question.id, via: "user-answer" });
    textDelta(`fixture answer ${String(event.answer)} #${question.turn}`);
    finish(question.turn, "fixture question settled");
  }
}

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  trace({ direction: "in", event });
  if (event?.type === "user") handleUser(event);
  else handleControl(event || {});
});

input.on("close", () => {
  if (interruptedTimer) clearTimeout(interruptedTimer);
  process.exit(0);
});
