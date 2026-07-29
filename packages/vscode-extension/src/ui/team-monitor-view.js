/**
 * `cc team` monitor and human-control surface.
 *
 * The extension only reads the state snapshot. Every mutation is routed
 * through the resolved CLI, which owns locking, legacy stateId validation,
 * distributed queue authority/fencing, and durable control/adjudication logs.
 */
const crypto = require("crypto");
const fs = require("fs");
const {
  parseTeamState,
  summarizeTeam,
  DISTRIBUTED_QUEUE_KIND,
} = require("../team-monitor.js");

const MAX_CONTROL_ID_LENGTH = 512;
const MAX_REASON_LENGTH = 500;
const MAX_CLI_FAILURE_LENGTH = 500;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const AUTHORITY_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const ADJUDICATION_DECISIONS = new Set(["retry", "accept", "cancel"]);

let _panel = null;
let _watcher = null;
let _debounce = null;
let _statePath = null;
let _deps = null;
let _controlBusy = false;

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Read + parse the state file into the webview payload (never throws). */
function snapshot(statePath) {
  let parsed;
  try {
    parsed = parseTeamState(fs.readFileSync(statePath, "utf8"));
  } catch (error) {
    parsed = { ok: false, error: `cannot read file: ${error.message}` };
  }
  if (!parsed.ok) {
    return { type: "update", ok: false, error: parsed.error, path: statePath };
  }
  return {
    type: "update",
    ok: true,
    path: statePath,
    stateKind: parsed.stateKind,
    distributed: parsed.distributed,
    version: parsed.version,
    stateId: parsed.stateId,
    schemaVersion: parsed.schemaVersion,
    queueId: parsed.queueId,
    authorityDigest: parsed.authorityDigest,
    authority: parsed.authority,
    revision: parsed.revision,
    tasks: parsed.tasks,
    summary: summarizeTeam(parsed),
    members: parsed.members,
    budget: parsed.budget,
  };
}

function post(statePath) {
  if (_panel) _panel.webview.postMessage(snapshot(statePath));
}

function validControlId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CONTROL_ID_LENGTH &&
    !hasControlCharacters(value)
  );
}

function validAuthorityPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    value.trim() === value &&
    !hasControlCharacters(value)
  );
}

function validDigest(value) {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function validAuthorityDigest(value) {
  return (
    typeof value === "string" && AUTHORITY_DIGEST_PATTERN.test(String(value))
  );
}

function validFencingToken(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function exactKeys(message, expected) {
  return (
    Object.keys(message).sort().join(",") === [...expected].sort().join(",")
  );
}

function parseDistributedControlMessage(message) {
  const common = [
    "action",
    "authorityDigest",
    "command",
    "queueId",
    "repoRoot",
    "runId",
    "taskKey",
  ];
  if (
    !validControlId(message.taskKey) ||
    !validControlId(message.queueId) ||
    !validControlId(message.runId) ||
    !validAuthorityPath(message.repoRoot) ||
    !validAuthorityDigest(message.authorityDigest)
  ) {
    return null;
  }
  if (
    message.action === "interrupt" &&
    exactKeys(message, [...common, "holder", "leaseId", "fencingToken"]) &&
    validControlId(message.holder) &&
    validControlId(message.leaseId) &&
    validFencingToken(message.fencingToken)
  ) {
    return {
      command: "control",
      action: "interrupt",
      taskKey: message.taskKey,
      queueId: message.queueId,
      authorityDigest: message.authorityDigest,
      repoRoot: message.repoRoot,
      runId: message.runId,
      holder: message.holder,
      leaseId: message.leaseId,
      fencingToken: message.fencingToken,
    };
  }
  if (
    message.action === "recover" &&
    exactKeys(message, [...common, "evidenceDigest"]) &&
    validDigest(message.evidenceDigest)
  ) {
    return {
      command: "control",
      action: "recover",
      taskKey: message.taskKey,
      queueId: message.queueId,
      authorityDigest: message.authorityDigest,
      repoRoot: message.repoRoot,
      runId: message.runId,
      evidenceDigest: message.evidenceDigest,
    };
  }
  if (
    message.action === "adjudicate" &&
    ADJUDICATION_DECISIONS.has(message.decision) &&
    exactKeys(message, [...common, "decision", "evidenceDigest"]) &&
    validDigest(message.evidenceDigest)
  ) {
    return {
      command: "control",
      action: "adjudicate",
      decision: message.decision,
      taskKey: message.taskKey,
      queueId: message.queueId,
      authorityDigest: message.authorityDigest,
      repoRoot: message.repoRoot,
      runId: message.runId,
      evidenceDigest: message.evidenceDigest,
    };
  }
  return null;
}

/**
 * Validate the tiny webview -> extension protocol. State paths, actors,
 * reasons and operation ids are never accepted from the webview. Distributed
 * authority fields are immutable click-time pins and are re-read below.
 */
function parseTeamMonitorMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  if (message.command === "refresh") {
    return Object.keys(message).length === 1 ? { command: "refresh" } : null;
  }
  if (message.command !== "control") return null;
  if (
    Object.hasOwn(message, "queueId") ||
    Object.hasOwn(message, "authorityDigest")
  ) {
    return parseDistributedControlMessage(message);
  }
  const keys = Object.keys(message).sort();
  const action = message.action;
  const taskKey = message.taskKey;
  const stateId = message.stateId;
  if (!validControlId(taskKey) || !validControlId(stateId)) return null;
  if (action === "interrupt") {
    const attemptDigest = message.attemptDigest;
    if (
      keys.join(",") !== "action,attemptDigest,command,stateId,taskKey" ||
      !validDigest(attemptDigest) ||
      message.decision != null
    ) {
      return null;
    }
    return {
      command: "control",
      action,
      taskKey,
      stateId,
      attemptDigest,
    };
  }
  if (
    action === "adjudicate" &&
    ADJUDICATION_DECISIONS.has(message.decision) &&
    keys.join(",") ===
      "action,adjudicationDigest,command,decision,stateId,taskKey" &&
    validDigest(message.adjudicationDigest)
  ) {
    return {
      command: "control",
      action,
      decision: message.decision,
      taskKey,
      stateId,
      adjudicationDigest: message.adjudicationDigest,
    };
  }
  return null;
}

function findUniqueTask(state, taskKey) {
  const matches = (state?.tasks || []).filter(
    (candidate) => candidate.key === taskKey,
  );
  return matches.length === 1 ? matches[0] : null;
}

function validateDistributedControlTarget(state, request) {
  if (
    state.stateKind !== DISTRIBUTED_QUEUE_KIND ||
    state.schemaVersion !== 1 ||
    state.queueId !== request.queueId ||
    state.authorityDigest !== request.authorityDigest ||
    state.authority?.repoRoot !== request.repoRoot ||
    state.authority?.runId !== request.runId
  ) {
    return {
      ok: false,
      error:
        "The distributed queue authority changed. Refresh before issuing a control action.",
    };
  }
  const task = findUniqueTask(state, request.taskKey);
  if (!task) {
    return { ok: false, error: "The selected task no longer exists." };
  }
  if (request.action === "interrupt") {
    if (task.status !== "in_progress") {
      return {
        ok: false,
        error: "Only an in-progress task can be taken over.",
      };
    }
    if (
      task.holder !== request.holder ||
      task.leaseId !== request.leaseId ||
      task.fencingToken !== request.fencingToken
    ) {
      return {
        ok: false,
        error:
          "The selected distributed lease fence changed. Refresh before requesting takeover.",
      };
    }
    return { ok: true, task };
  }
  if (task.adjudication?.required !== true) {
    return {
      ok: false,
      error: "This task no longer requires adjudication.",
    };
  }
  if (
    !validDigest(task.evidenceDigest) ||
    task.evidenceDigest !== request.evidenceDigest
  ) {
    return {
      ok: false,
      error:
        "The distributed task evidence changed. Refresh before applying human control.",
    };
  }
  if (
    request.action === "recover" &&
    task.checkpointRecoveryRequired !== true
  ) {
    return {
      ok: false,
      error: "This task no longer requires managed checkpoint recovery.",
    };
  }
  return { ok: true, task };
}

function validateControlTarget(state, request) {
  if (!state?.ok) {
    return { ok: false, error: state?.error || "Team state is unreadable." };
  }
  if (request.queueId != null || request.authorityDigest != null) {
    return validateDistributedControlTarget(state, request);
  }
  if (state.version !== 6 || !state.stateId) {
    return {
      ok: false,
      error: "Human control requires a version 6 team state with a stateId.",
    };
  }
  if (state.stateId !== request.stateId) {
    return {
      ok: false,
      error: "The team state changed. Refresh before issuing a control action.",
    };
  }
  const task = findUniqueTask(state, request.taskKey);
  if (!task) {
    return { ok: false, error: "The selected task no longer exists." };
  }
  if (request.action === "interrupt" && task.status !== "in_progress") {
    return {
      ok: false,
      error: "Only an in-progress task can be taken over.",
    };
  }
  if (
    request.action === "interrupt" &&
    (!validDigest(task.attemptDigest) ||
      task.attemptDigest !== request.attemptDigest)
  ) {
    return {
      ok: false,
      error:
        "The selected task attempt changed. Refresh before requesting takeover.",
    };
  }
  if (request.action === "adjudicate" && task.adjudication?.required !== true) {
    return {
      ok: false,
      error: "This task no longer requires adjudication.",
    };
  }
  if (
    request.action === "adjudicate" &&
    (!validDigest(task.adjudicationDigest) ||
      task.adjudicationDigest !== request.adjudicationDigest)
  ) {
    return {
      ok: false,
      error:
        "The adjudication case changed. Refresh before applying a decision.",
    };
  }
  return { ok: true, task };
}

function normalizeReason(value) {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  if (
    reason.length === 0 ||
    reason.length > MAX_REASON_LENGTH ||
    hasControlCharacters(reason)
  ) {
    return null;
  }
  return reason;
}

function buildTeamControlArgs({
  action,
  statePath,
  expectedStateId,
  expectedAttemptDigest,
  expectedAdjudicationDigest,
  taskKey,
  decision,
  reason,
  queueId,
  authorityDigest,
  repoRoot,
  runId,
  holder,
  leaseId,
  fencingToken,
  evidenceDigest,
  operationId,
}) {
  if (queueId != null || authorityDigest != null) {
    if (
      !validControlId(queueId) ||
      !validAuthorityDigest(authorityDigest) ||
      !validAuthorityPath(repoRoot) ||
      !validControlId(runId) ||
      !validControlId(taskKey) ||
      !validControlId(operationId)
    ) {
      throw new Error(
        "A complete pinned distributed queue authority is required",
      );
    }
    const args = [
      "team",
      "queue",
      action,
      "--state",
      statePath,
      "--repo",
      repoRoot,
      "--run-id",
      runId,
      "--queue-id",
      queueId,
      "--authority-digest",
      authorityDigest,
      "--task",
      taskKey,
    ];
    if (action === "interrupt") {
      if (
        !validControlId(holder) ||
        !validControlId(leaseId) ||
        !validFencingToken(fencingToken)
      ) {
        throw new Error("A complete distributed lease fence is required");
      }
      args.push(
        "--holder",
        holder,
        "--lease-id",
        leaseId,
        "--fencing-token",
        String(fencingToken),
        "--request-id",
        operationId,
      );
    } else if (action === "recover") {
      if (!validDigest(evidenceDigest)) {
        throw new Error(
          "A valid distributed recovery evidence digest is required",
        );
      }
      args.push(
        "--recovery-id",
        operationId,
        "--evidence-digest",
        evidenceDigest,
      );
    } else if (
      action === "adjudicate" &&
      ADJUDICATION_DECISIONS.has(decision)
    ) {
      if (!validDigest(evidenceDigest)) {
        throw new Error(
          "A valid distributed adjudication evidence digest is required",
        );
      }
      args.push(
        "--decision",
        decision,
        "--decision-id",
        operationId,
        "--evidence-digest",
        evidenceDigest,
      );
    } else {
      throw new Error("Unsupported distributed team control action");
    }
    args.push("--actor", "vscode", "--reason", reason, "--json");
    return args;
  }
  if (!validControlId(expectedStateId)) {
    throw new Error("A valid expected team stateId is required");
  }
  if (action === "interrupt") {
    if (!validDigest(expectedAttemptDigest)) {
      throw new Error("A valid expected task attempt digest is required");
    }
    return [
      "team",
      "interrupt",
      "--state",
      statePath,
      "--expected-state-id",
      expectedStateId,
      "--expected-attempt-digest",
      expectedAttemptDigest,
      "--task",
      taskKey,
      "--actor",
      "vscode",
      "--reason",
      reason,
      "--json",
    ];
  }
  if (action === "adjudicate" && ADJUDICATION_DECISIONS.has(decision)) {
    if (!validDigest(expectedAdjudicationDigest)) {
      throw new Error("A valid expected adjudication digest is required");
    }
    return [
      "team",
      "adjudicate",
      "--state",
      statePath,
      "--expected-state-id",
      expectedStateId,
      "--expected-adjudication-digest",
      expectedAdjudicationDigest,
      "--task",
      taskKey,
      "--decision",
      decision,
      "--authority",
      "vscode",
      "--reason",
      reason,
      "--json",
    ];
  }
  throw new Error("Unsupported team control action");
}

function safeCliFailureText(value) {
  const text = Array.from(String(value || ""), (character) =>
    hasControlCharacters(character) ? " " : character,
  )
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  return text.slice(0, MAX_CLI_FAILURE_LENGTH);
}

function cliFailure(result) {
  const detail = safeCliFailureText(
    result?.stderr || result?.error || result?.text,
  );
  const outcome = result?.timedOut
    ? "timed out"
    : result?.signal
      ? `was terminated by ${safeCliFailureText(result.signal)}`
      : Number.isInteger(result?.code) && result.code !== 0
        ? `exited with code ${result.code}`
        : "failed";
  return {
    ok: false,
    error: `Team control ${outcome}${detail ? `: ${detail}` : "."}`.slice(
      0,
      MAX_CLI_FAILURE_LENGTH,
    ),
  };
}

function parseControlOutput(output) {
  const text = String(output || "").trim();
  if (!text) {
    return { ok: false, error: "The CLI returned no control result." };
  }
  let value = null;
  try {
    value = JSON.parse(text);
  } catch {
    for (const line of text.split(/\r?\n/u).reverse()) {
      try {
        value = JSON.parse(line);
        break;
      } catch {
        /* try an earlier JSONL record */
      }
    }
    if (!value) {
      const first = text.indexOf("{");
      const last = text.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try {
          value = JSON.parse(text.slice(first, last + 1));
        } catch {
          value = null;
        }
      }
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const detail = safeCliFailureText(text).slice(0, 300);
    return {
      ok: false,
      error: `The CLI returned an invalid control result${
        detail ? `: ${detail}` : "."
      }`,
    };
  }
  if (value.ok === false || value.error) {
    const detail = safeCliFailureText(
      value.error || value.message || "Team control failed.",
    );
    return {
      ok: false,
      error: detail || "Team control failed.",
      value,
    };
  }
  return { ok: true, value };
}

function actionCopy(request, task) {
  if (request.action === "interrupt") {
    return {
      prompt: `Why are you taking over "${task.title}"?`,
      detail:
        "This interrupts the current teammate through the durable team control log. The outcome remains fail-closed until the CLI records it.",
      confirm: "Take over task",
      success: `Takeover requested for "${task.title}".`,
    };
  }
  if (request.action === "recover") {
    return {
      prompt: `Why are you recovering the checkpoint for "${task.title}"?`,
      detail:
        "The CLI will recover and reconcile only the evidence-pinned managed checkpoint. It will not bypass retry Git/clean-worktree gates.",
      confirm: "Recover checkpoint",
      success: `Checkpoint recovery requested for "${task.title}".`,
    };
  }
  const byDecision = {
    retry: {
      prompt: `Why is it safe to retry "${task.title}"?`,
      detail:
        "Retry may repeat an external side effect. Confirm only after checking the prior attempt.",
      confirm: "Retry task",
      success: `Retry approved for "${task.title}".`,
    },
    accept: {
      prompt: `Why should the prior effect for "${task.title}" be accepted?`,
      detail:
        "Accept marks the ambiguous prior effect as the task result without rerunning it.",
      confirm: "Accept prior effect",
      success: `Prior effect accepted for "${task.title}".`,
    },
    cancel: {
      prompt: `Why should "${task.title}" remain cancelled?`,
      detail:
        "Cancel resolves the ambiguity without retrying or accepting the prior effect.",
      confirm: "Cancel task",
      success: `Cancellation confirmed for "${task.title}".`,
    },
  };
  return byDecision[request.decision];
}

function createDistributedControlId(action, deps = {}) {
  const generate =
    typeof deps.randomUUID === "function"
      ? deps.randomUUID
      : () => crypto.randomUUID();
  const raw = String(generate());
  const kind =
    action === "interrupt"
      ? "request"
      : action === "recover"
        ? "recovery"
        : "decision";
  const id = `vscode-${kind}-${raw}`;
  if (!validControlId(id)) {
    throw new Error("Could not create a valid globally unique control id");
  }
  return id;
}

function readParsedState(statePath) {
  try {
    return parseTeamState(fs.readFileSync(statePath, "utf8"));
  } catch (error) {
    return { ok: false, error: `cannot read file: ${error.message}` };
  }
}

/**
 * Prompt, confirm, revalidate, then execute one CLI-owned control action.
 * Exported as a dependency-injected seam for unit tests.
 */
async function executeTeamControl(vscode, statePath, request, deps = {}) {
  if (typeof deps.runCliResult !== "function") {
    return { ok: false, error: "The CLI control runner is unavailable." };
  }
  let target = validateControlTarget(readParsedState(statePath), request);
  if (!target.ok) {
    vscode.window.showErrorMessage(target.error);
    return target;
  }
  const copy = actionCopy(request, target.task);
  if (!copy) {
    return { ok: false, error: "Unsupported team control action." };
  }
  const reasonInput = await vscode.window.showInputBox({
    title: copy.confirm,
    prompt: copy.prompt,
    placeHolder: "Required: record the human operator's reason",
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!String(value || "").trim()) return "A reason is required.";
      if (String(value).trim().length > MAX_REASON_LENGTH) {
        return `Reason must be at most ${MAX_REASON_LENGTH} characters.`;
      }
      return normalizeReason(value)
        ? null
        : "Reason contains invalid characters.";
    },
  });
  const reason = normalizeReason(reasonInput);
  if (!reason) return { ok: false, cancelled: reasonInput == null };

  const picked = await vscode.window.showWarningMessage(
    `${copy.confirm}?`,
    {
      modal: true,
      detail: `${copy.detail}\n\nReason: ${reason}`,
    },
    copy.confirm,
  );
  if (picked !== copy.confirm) return { ok: false, cancelled: true };

  // Close the prompt/read race: the task and stateId must still be eligible
  // immediately before the CLI is invoked. The CLI performs its own check too.
  target = validateControlTarget(readParsedState(statePath), request);
  if (!target.ok) {
    vscode.window.showErrorMessage(target.error);
    return target;
  }

  let args;
  try {
    args = buildTeamControlArgs({
      ...request,
      statePath,
      expectedStateId: request.stateId,
      expectedAttemptDigest: request.attemptDigest,
      expectedAdjudicationDigest: request.adjudicationDigest,
      operationId:
        request.queueId == null
          ? null
          : createDistributedControlId(request.action, deps),
      reason,
    });
  } catch (error) {
    const failure = {
      ok: false,
      error: `Team control validation failed: ${safeCliFailureText(
        error?.message || error,
      )}`,
    };
    vscode.window.showErrorMessage(failure.error);
    return failure;
  }
  let output;
  try {
    const invocation = {
      command: deps.command || "cc",
      args,
      cwd: deps.cwd,
      timeoutMs: 30000,
    };
    const cliResult = await deps.runCliResult(invocation);
    if (
      !cliResult ||
      cliResult.ok !== true ||
      cliResult.timedOut === true ||
      cliResult.signal ||
      (cliResult.code != null && cliResult.code !== 0)
    ) {
      const failure = cliFailure(cliResult);
      vscode.window.showErrorMessage(failure.error);
      return failure;
    }
    // A successful control result is protocol data written to stdout.
    // Never parse stderr (or a combined error transcript) as JSON success.
    output = typeof cliResult.stdout === "string" ? cliResult.stdout : "";
  } catch (error) {
    const detail =
      safeCliFailureText(error?.message || error) || "unknown error";
    const failure = {
      ok: false,
      error: `Team control could not start: ${detail}`.slice(
        0,
        MAX_CLI_FAILURE_LENGTH,
      ),
    };
    vscode.window.showErrorMessage(failure.error);
    return failure;
  }
  const result = parseControlOutput(output);
  if (!result.ok) {
    vscode.window.showErrorMessage(result.error);
    return result;
  }
  vscode.window.showInformationMessage(copy.success);
  return { ...result, message: copy.success };
}

/**
 * Open (or reveal) the monitor for `statePath`, watching it for changes.
 * Switching to a different file re-points the watcher on the singleton panel.
 */
function openTeamMonitor(vscode, statePath, deps = {}) {
  _statePath = statePath;
  _deps = deps;
  if (_panel) {
    _panel.reveal();
    rewatch();
    post(_statePath);
    return _panel;
  }
  _panel = vscode.window.createWebviewPanel(
    "chainlesschainTeamMonitor",
    "ChainlessChain · Team",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  _panel.webview.html = renderHtml();
  _panel.webview.onDidReceiveMessage(async (rawMessage) => {
    const message = parseTeamMonitorMessage(rawMessage);
    if (!message) return;
    if (message.command === "refresh") {
      post(_statePath);
      return;
    }
    if (_controlBusy) {
      vscode.window.showWarningMessage(
        "Another team control action is already in progress.",
      );
      return;
    }
    _controlBusy = true;
    _panel?.webview.postMessage({ type: "actionPending" });
    let result;
    try {
      result = await executeTeamControl(vscode, _statePath, message, _deps);
    } catch (error) {
      result = {
        ok: false,
        error: `Team control failed: ${error.message}`,
      };
      vscode.window.showErrorMessage(result.error);
    }
    try {
      post(_statePath);
      _panel?.webview.postMessage({
        type: "actionResult",
        ok: result.ok === true,
        cancelled: result.cancelled === true,
        message: result.message || null,
        error: result.error || null,
      });
    } finally {
      _controlBusy = false;
    }
  });
  _panel.onDidDispose(() => {
    stopWatch();
    _panel = null;
    _statePath = null;
    _deps = null;
    _controlBusy = false;
  });
  rewatch();
  post(_statePath);
  return _panel;
}

/** (Re)install the fs.watch on the current state file, debounced. */
function rewatch() {
  stopWatch();
  try {
    _watcher = fs.watch(_statePath, () => {
      if (_debounce) clearTimeout(_debounce);
      _debounce = setTimeout(() => {
        post(_statePath);
        try {
          _watcher?.close();
        } catch {
          /* ignore */
        }
        try {
          rewatch();
        } catch {
          /* the next manual refresh recovers */
        }
      }, 150);
    });
  } catch {
    // The panel remains usable through Refresh if the file is mid-swap.
  }
}

function stopWatch() {
  if (_debounce) {
    clearTimeout(_debounce);
    _debounce = null;
  }
  if (_watcher) {
    try {
      _watcher.close();
    } catch {
      /* ignore */
    }
    _watcher = null;
  }
}

function nonce() {
  return crypto.randomBytes(16).toString("hex");
}

function renderHtml() {
  const value = nonce();
  const csp =
    "default-src 'none'; " +
    `style-src 'nonce-${value}'; script-src 'nonce-${value}'; ` +
    "img-src 'none'; font-src 'none'; connect-src 'none'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none';";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style nonce="${value}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         padding: 16px; font-size: 13px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .path { opacity: .55; font-size: 11px; margin-bottom: 12px; word-break: break-all;
          font-family: var(--vscode-editor-font-family); }
  .row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  button.danger { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); }
  button:disabled { cursor: wait; opacity: .55; }
  progress { flex: 1; min-width: 120px; height: 8px; accent-color: #3fb950; }
  .cards { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
  .card { background: var(--vscode-editorWidget-background);
          border: 1px solid var(--vscode-widget-border, transparent); border-radius: 6px;
          padding: 8px 14px; min-width: 74px; }
  .card .k { opacity: .65; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  .card .v { font-size: 18px; font-weight: 600; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--vscode-widget-border, #333);
           vertical-align: top; }
  th { opacity: .6; font-weight: 500; font-size: 11px; }
  .status { font-weight: 600; }
  .completed { color: #3fb950; }
  .in-progress { color: var(--vscode-charts-blue, #3794ff); }
  .blocked, .cancelled { color: var(--vscode-errorForeground, #f85149); }
  .pending { opacity: .7; }
  .muted { opacity: .6; }
  .warning { color: var(--vscode-editorWarning-foreground, orange); margin-top: 3px; }
  .error { color: var(--vscode-errorForeground, #f85149); }
  .success { color: var(--vscode-testing-iconPassed, #3fb950); }
  .actions { display: flex; gap: 5px; flex-wrap: wrap; }
  .readonly { border-left: 3px solid var(--vscode-editorWarning-foreground, orange);
              padding: 6px 10px; margin-bottom: 10px; }
</style>
</head>
<body>
  <h1>ChainlessChain · Team monitor</h1>
  <div class="path" id="path"></div>
  <div class="row">
    <progress id="progress" max="100" value="0"></progress>
    <span id="percent" class="muted">—</span>
    <button id="refresh" type="button">Refresh</button>
  </div>
  <div id="notice" aria-live="polite"></div>
  <div class="cards" id="cards"></div>
  <div id="body"></div>
<script nonce="${value}">
  const vscode = acquireVsCodeApi();
  const refresh = document.getElementById('refresh');
  const notice = document.getElementById('notice');
  const cards = document.getElementById('cards');
  const body = document.getElementById('body');
  let controlBusy = false;

  refresh.addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));

  function clear(node) { node.replaceChildren(); }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function card(label, count) {
    const node = element('div', null, 'card');
    node.append(element('div', label, 'k'), element('div', count, 'v'));
    return node;
  }
  function controlButton(label, request, className) {
    const button = element('button', label, 'control ' + (className || 'secondary'));
    const clickBinding = Object.freeze({ ...request });
    button.type = 'button';
    button.addEventListener('click', () => {
      vscode.postMessage({ command: 'control', ...clickBinding });
    });
    return button;
  }
  function setBusy(busy) {
    for (const button of document.querySelectorAll('button.control')) {
      button.disabled = busy;
    }
  }
  function addTaskDetail(cell, task) {
    cell.append(element('div', task.title || task.key || '(untitled)'));
    const details = [];
    if (Number(task.attempts) > 1) details.push('attempts: ' + task.attempts);
    if (Array.isArray(task.dependsOn) && task.dependsOn.length) {
      details.push('depends on: ' + task.dependsOn.join(', '));
    }
    if (details.length) cell.append(element('div', details.join(' · '), 'muted'));
    if (task.leaseId && task.fencingToken != null) {
      cell.append(element(
        'div',
        'lease: ' + task.leaseId + ' · fence: ' + task.fencingToken,
        'muted'
      ));
    }
    if (task.workspaceExecution) {
      const execution = task.workspaceExecution;
      const checkpoint = execution.checkpoint;
      const checkpointText = checkpoint && checkpoint.state
        ? ' · checkpoint: ' + checkpoint.state
        : '';
      const transactionText = checkpoint && checkpoint.transactionId
        ? ' · transaction: ' + checkpoint.transactionId
        : '';
      cell.append(element(
        'div',
        'workspace: ' + (execution.phase || 'unknown') +
          checkpointText + transactionText,
        execution.recoveryRequired ? 'warning' : 'muted'
      ));
    }
    if (task.interruption) {
      cell.append(element(
        'div',
        'interrupt requested by ' + (task.interruption.actor || 'operator'),
        'warning'
      ));
    }
    if (task.adjudication && task.adjudication.required === true) {
      const reason = task.adjudication.reason || task.lastError || 'Outcome requires human adjudication';
      cell.append(element('div', reason, 'warning'));
    } else if (task.adjudication && task.adjudication.decision) {
      const decision = task.adjudication.decision.action || 'resolved';
      cell.append(element('div', 'Adjudicated: ' + decision, 'muted'));
    }
    if (task.evidenceDigest) {
      cell.append(element('div', 'evidence: ' + task.evidenceDigest, 'muted'));
    }
  }
  function addActions(cell, task, message) {
    const actions = element('div', null, 'actions');
    if (message.stateKind === 'distributed-queue') {
      const authority = message.authority || {};
      const common = {
        taskKey: task.key,
        queueId: message.queueId,
        authorityDigest: message.authorityDigest,
        repoRoot: authority.repoRoot,
        runId: authority.runId
      };
      if (task.status === 'in_progress' && task.holder && task.leaseId &&
          Number.isSafeInteger(task.fencingToken) && task.fencingToken > 0) {
        actions.append(controlButton('Take over', {
          action: 'interrupt',
          ...common,
          holder: task.holder,
          leaseId: task.leaseId,
          fencingToken: task.fencingToken
        }, 'danger'));
      }
      if (task.adjudication && task.adjudication.required === true &&
          task.evidenceDigest) {
        if (task.checkpointRecoveryRequired === true) {
          actions.append(controlButton('Recover checkpoint', {
            action: 'recover',
            ...common,
            evidenceDigest: task.evidenceDigest
          }, 'danger'));
        }
        actions.append(
          controlButton('Retry', {
            action: 'adjudicate', decision: 'retry', ...common,
            evidenceDigest: task.evidenceDigest
          }, 'danger'),
          controlButton('Accept', {
            action: 'adjudicate', decision: 'accept', ...common,
            evidenceDigest: task.evidenceDigest
          }),
          controlButton('Cancel', {
            action: 'adjudicate', decision: 'cancel', ...common,
            evidenceDigest: task.evidenceDigest
          })
        );
      }
    }
    const stateId = message.version === 6 && message.stateId
      ? message.stateId
      : null;
    if (stateId && task.key && task.status === 'in_progress' && task.attemptDigest) {
      actions.append(controlButton('Take over', {
        action: 'interrupt',
        taskKey: task.key,
        stateId,
        attemptDigest: task.attemptDigest
      }, 'danger'));
    }
    if (stateId && task.key && task.adjudication &&
        task.adjudication.required === true && task.adjudicationDigest) {
      actions.append(
        controlButton('Retry', {
          action: 'adjudicate', decision: 'retry', taskKey: task.key,
          stateId, adjudicationDigest: task.adjudicationDigest
        }, 'danger'),
        controlButton('Accept', {
          action: 'adjudicate', decision: 'accept', taskKey: task.key,
          stateId, adjudicationDigest: task.adjudicationDigest
        }),
        controlButton('Cancel', {
          action: 'adjudicate', decision: 'cancel', taskKey: task.key,
          stateId, adjudicationDigest: task.adjudicationDigest
        })
      );
    }
    if (!actions.childNodes.length) actions.append(element('span', '—', 'muted'));
    cell.append(actions);
  }
  function apply(message) {
    document.getElementById('path').textContent = message.path || '';
    clear(notice);
    clear(cards);
    clear(body);
    if (!message.ok) {
      document.getElementById('percent').textContent = '';
      document.getElementById('progress').value = 0;
      body.append(element('p', message.error || 'Unreadable state file', 'error'));
      return;
    }
    const distributed = message.stateKind === 'distributed-queue';
    const stateId = message.version === 6 && message.stateId ? message.stateId : null;
    if (distributed) {
      const authority = message.authority || {};
      notice.append(element(
        'div',
        'Distributed queue ' + (message.queueId || 'unknown') +
          ' · run ' + (authority.runId || 'unknown') +
          ' · revision ' + (message.revision == null ? 'unknown' : message.revision) +
          ' · authority ' + (message.authorityDigest || 'unknown'),
        'muted'
      ));
    } else if (!stateId) {
      notice.append(element(
        'div',
        'This legacy snapshot is read-only. Human control requires a version 6 team state.',
        'readonly'
      ));
    }
    const summary = message.summary || {
      counts: {}, total: 0, donePct: 0, active: 0, stale: 0, adjudicationRequired: 0
    };
    document.getElementById('progress').value = Number(summary.donePct) || 0;
    document.getElementById('percent').textContent =
      (Number(summary.donePct) || 0) + '% · ' +
      (Number(summary.counts && summary.counts.completed) || 0) + '/' +
      (Number(summary.total) || 0) + ' done';
    cards.append(
      card('tasks', summary.total || 0),
      card('active', summary.active || 0)
    );
    if (summary.stale) cards.append(card('stale lease', summary.stale));
    if (summary.adjudicationRequired) {
      cards.append(card('needs decision', summary.adjudicationRequired));
    }
    cards.append(
      card('blocked', Number(summary.counts && summary.counts.blocked) || 0),
      card('done', Number(summary.counts && summary.counts.completed) || 0)
    );
    const tasks = Array.isArray(message.tasks) ? message.tasks.slice() : [];
    const order = ['in_progress', 'pending', 'blocked', 'completed', 'cancelled'];
    tasks.sort((left, right) => {
      const leftIndex = order.indexOf(left.status);
      const rightIndex = order.indexOf(right.status);
      return (leftIndex < 0 ? order.length : leftIndex) -
        (rightIndex < 0 ? order.length : rightIndex);
    });
    if (!tasks.length) {
      body.append(element('p', 'No tasks in this state file yet.', 'muted'));
      return;
    }
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of ['status', 'task', 'holder', 'human control']) {
      headRow.append(element('th', label));
    }
    head.append(headRow);
    const rows = document.createElement('tbody');
    for (const task of tasks) {
      const row = document.createElement('tr');
      const statusClass = {
        completed: 'completed',
        in_progress: 'in-progress',
        blocked: 'blocked',
        cancelled: 'cancelled',
        pending: 'pending'
      }[task.status] || '';
      row.append(element('td', task.status || 'unknown', 'status ' + statusClass));
      const taskCell = document.createElement('td');
      addTaskDetail(taskCell, task);
      row.append(taskCell, element('td', task.holder || '—', task.holder ? '' : 'muted'));
      const actions = document.createElement('td');
      addActions(actions, task, message);
      row.append(actions);
      rows.append(row);
    }
    table.append(head, rows);
    body.append(table);
    setBusy(controlBusy);
  }
  window.addEventListener('message', (event) => {
    if (event.source && event.source !== window) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'update') {
      apply(message);
    } else if (message.type === 'actionPending') {
      controlBusy = true;
      setBusy(true);
      clear(notice);
      notice.append(element('p', 'Applying team control…', 'muted'));
    } else if (message.type === 'actionResult') {
      controlBusy = false;
      setBusy(false);
      clear(notice);
      if (!message.cancelled) {
        notice.append(element(
          'p',
          message.ok ? (message.message || 'Team control applied.') :
            (message.error || 'Team control failed.'),
          message.ok ? 'success' : 'error'
        ));
      }
    }
  });
</script>
</body>
</html>`;
}

module.exports = {
  openTeamMonitor,
  snapshot,
  parseTeamMonitorMessage,
  validateControlTarget,
  buildTeamControlArgs,
  parseControlOutput,
  executeTeamControl,
  renderHtml,
  MAX_REASON_LENGTH,
};
