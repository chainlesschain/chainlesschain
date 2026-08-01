"use strict";

const { createHash, randomUUID } = require("node:crypto");

const PROJECTION_SCHEMA = "chainlesschain.delivery-flow-projection";
const ACTION_SCHEMA = "chainlesschain.delivery-action";
const ACTION_RESULT_SCHEMA = "chainlesschain.delivery-action-result";
const COMMAND_RESULT_SCHEMA = "chainlesschain.delivery-flow-command-result";
const VERSION = 1;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/i;
const ACTIONS = new Set([
  "run_gates",
  "run_preview",
  "run_review",
  "apply_fix",
  "create_pr",
  "refresh_ci",
  "publish_evidence",
  "merge",
  "archive",
]);
const STATUSES = new Set(["active", "blocked", "stopped", "completed"]);
const PHASES = new Set([
  "gates",
  "preview",
  "review",
  "fix",
  "pr",
  "ci",
  "evidence",
  "merge",
  "archive",
  "completed",
]);
const ACTION_LABELS = Object.freeze({
  run_gates: "run gates",
  run_preview: "run preview",
  run_review: "run review",
  apply_fix: "apply reviewed fix",
  create_pr: "request PR creation",
  refresh_ci: "refresh CI evidence",
  publish_evidence: "publish immutable evidence",
  merge: "request merge",
  archive: "archive verified flow",
});
const STAGES = Object.freeze([
  ["Gates", new Set(["gates"])],
  ["Preview", new Set(["preview"])],
  ["Review", new Set(["review", "fix"])],
  ["PR / CI", new Set(["pr", "ci", "evidence"])],
  ["Merge", new Set(["merge"])],
  ["Archive", new Set(["archive"])],
]);

function objectFrom(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validFailure(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.message === "string" &&
    (value.line == null || nonNegativeInteger(value.line))
  );
}

/** Fail-closed parser for the shared CLI -> IDE projection. */
function parseDeliveryProjection(value) {
  const state = objectFrom(value);
  if (
    !state ||
    state.schema !== PROJECTION_SCHEMA ||
    state.version !== VERSION ||
    state.valid !== true ||
    !String(state.flowId || "") ||
    !nonNegativeInteger(state.revision) ||
    !DIGEST_RE.test(String(state.stateDigest || "")) ||
    !STATUSES.has(state.status) ||
    !PHASES.has(state.phase) ||
    !nonNegativeInteger(state.round) ||
    !nonNegativeInteger(state.maxRounds) ||
    !nonNegativeInteger(state.noProgressRounds) ||
    !nonNegativeInteger(state.maxNoProgressRounds) ||
    !Array.isArray(state.availableActions) ||
    state.availableActions.some((action) => !ACTIONS.has(action)) ||
    new Set(state.availableActions).size !== state.availableActions.length ||
    !Array.isArray(state.failures) ||
    state.failures.some((failure) => !validFailure(failure))
  ) {
    return null;
  }
  if (state.pendingEffect != null) {
    if (
      typeof state.pendingEffect !== "object" ||
      !DIGEST_RE.test(String(state.pendingEffect.id || "")) ||
      !ACTIONS.has(state.pendingEffect.action) ||
      state.availableActions.length !== 0
    ) {
      return null;
    }
  }
  if (
    state.pr != null &&
    (typeof state.pr !== "object" ||
      !Number.isInteger(state.pr.number) ||
      state.pr.number <= 0 ||
      typeof state.pr.mergeAllowed !== "boolean")
  ) {
    return null;
  }
  if (
    state.evidence != null &&
    (typeof state.evidence !== "object" ||
      !DIGEST_RE.test(String(state.evidence.recordDigest || "")) ||
      typeof state.evidence.ready !== "boolean" ||
      (state.evidence.artifactId != null &&
        typeof state.evidence.artifactId !== "string"))
  ) {
    return null;
  }
  return state;
}

/** Fail-closed parser for a state/revision-bound external action request. */
function parseDeliveryAction(value) {
  const action = objectFrom(value);
  if (
    !action ||
    action.schema !== ACTION_SCHEMA ||
    action.version !== VERSION ||
    !String(action.flowId || "") ||
    !nonNegativeInteger(action.expectedRevision) ||
    !DIGEST_RE.test(String(action.expectedStateDigest || "")) ||
    !ACTIONS.has(action.action) ||
    !action.payload ||
    typeof action.payload !== "object" ||
    Array.isArray(action.payload)
  ) {
    return null;
  }
  return action;
}

function parseDeliveryActionResult(value) {
  const envelope = objectFrom(value);
  if (
    !envelope ||
    envelope.schema !== ACTION_RESULT_SCHEMA ||
    envelope.version !== VERSION ||
    !DIGEST_RE.test(String(envelope.effectId || "")) ||
    !envelope.result ||
    typeof envelope.result !== "object" ||
    Array.isArray(envelope.result)
  ) {
    return null;
  }
  return envelope;
}

function parseDeliveryCommandResult(value) {
  const result = objectFrom(value);
  if (
    !result ||
    result.schema !== COMMAND_RESULT_SCHEMA ||
    result.version !== VERSION ||
    !result.state ||
    typeof result.state !== "object" ||
    Array.isArray(result.state)
  ) {
    return null;
  }
  const projection = parseDeliveryProjection(result.projection);
  return projection ? { ...result, projection } : null;
}

function buildDeliveryProjectArgs(statePath) {
  if (!String(statePath || "")) throw new Error("statePath is required");
  return ["artifacts", "delivery-project", String(statePath), "--json"];
}

/** CLI argv only; the CLI owns every request/settle transition. */
function buildDeliveryStepArgs({
  statePath,
  action,
  payloadPath,
  resultPath,
  expectedRevision,
  expectedStateDigest,
  expectedEffectId,
  writeState = false,
} = {}) {
  if (!String(statePath || "")) throw new Error("statePath is required");
  if (action != null && !ACTIONS.has(action)) {
    throw new Error(`unsupported delivery action: ${action}`);
  }
  if (
    expectedRevision != null &&
    (!Number.isInteger(expectedRevision) || expectedRevision < 0)
  ) {
    throw new Error("expectedRevision must be a non-negative integer");
  }
  if (
    expectedStateDigest != null &&
    !DIGEST_RE.test(String(expectedStateDigest))
  ) {
    throw new Error("expectedStateDigest must be a full sha256 digest");
  }
  if (expectedEffectId != null && !DIGEST_RE.test(String(expectedEffectId))) {
    throw new Error("expectedEffectId must be a full sha256 digest");
  }
  const args = ["artifacts", "delivery-step", String(statePath)];
  if (action) args.push("--action", action);
  if (payloadPath) args.push("--payload-file", String(payloadPath));
  if (resultPath) args.push("--result-file", String(resultPath));
  if (expectedRevision != null) {
    args.push("--expected-revision", String(expectedRevision));
  }
  if (expectedStateDigest) {
    args.push("--expected-state-digest", String(expectedStateDigest));
  }
  if (expectedEffectId) {
    args.push("--expected-effect-id", String(expectedEffectId));
  }
  if (writeState) args.push("--write-state");
  args.push("--json");
  return args;
}

function cliText(result) {
  if (result && typeof result === "object" && "ok" in result) {
    if (result.ok !== true) {
      throw failClosed(
        result.error || "delivery CLI command failed",
        "CLI_FAILED",
      );
    }
    if (result.raw != null) return result.raw;
    if (result.json != null) return result.json;
  }
  return result;
}

function failClosed(message, code = "DELIVERY_STALE") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sameBinding(projection, token, { effect = false } = {}) {
  return Boolean(
    projection &&
    token &&
    projection.flowId === token.flowId &&
    projection.revision === token.expectedRevision &&
    projection.stateDigest === token.expectedStateDigest &&
    (!effect || projection.pendingEffect?.id === token.expectedEffectId),
  );
}

/**
 * Host-neutral controller used by the Workbench glue. It never invokes a PR,
 * CI, merge or archive provider. Its only mutation command is the exact
 * request/settle protocol exposed by `cc artifacts delivery-step`.
 */
class DeliveryWorkflowController {
  constructor({ runCli, readResultFile } = {}) {
    if (typeof runCli !== "function") throw new Error("runCli is required");
    if (typeof readResultFile !== "function") {
      throw new Error("readResultFile is required");
    }
    this._runCli = runCli;
    this._readResultFile = readResultFile;
    this._statePath = null;
    this._projection = null;
    this._confirmation = null;
    this._busy = false;
  }

  get statePath() {
    return this._statePath;
  }

  get projection() {
    return this._projection;
  }

  get busy() {
    return this._busy;
  }

  async _project(statePath) {
    const raw = cliText(
      await this._runCli(buildDeliveryProjectArgs(statePath)),
    );
    const result = parseDeliveryCommandResult(raw);
    if (!result) {
      throw failClosed(
        "invalid delivery projection from CLI",
        "INVALID_PROJECTION",
      );
    }
    return result;
  }

  async _step(args) {
    const raw = cliText(await this._runCli(args));
    const result = parseDeliveryCommandResult(raw);
    if (!result) {
      throw failClosed("invalid delivery step result from CLI", "INVALID_STEP");
    }
    return result;
  }

  async load(statePath = this._statePath) {
    if (!String(statePath || "")) throw new Error("statePath is required");
    const result = await this._project(String(statePath));
    this._statePath = String(statePath);
    this._projection = result.projection;
    this._confirmation = null;
    return this._projection;
  }

  previewRequest(action) {
    const projection = this._projection;
    if (!projection || !this._statePath) {
      throw failClosed("no delivery projection is loaded", "NOT_LOADED");
    }
    if (projection.pendingEffect) {
      throw failClosed(
        "a delivery effect is already pending",
        "EFFECT_PENDING",
      );
    }
    if (!projection.availableActions.includes(action)) {
      throw failClosed("delivery action is no longer available");
    }
    const token = Object.freeze({
      id: randomUUID(),
      kind: "request",
      statePath: this._statePath,
      flowId: projection.flowId,
      action,
      expectedRevision: projection.revision,
      expectedStateDigest: projection.stateDigest,
    });
    this._confirmation = token;
    return token;
  }

  async confirmRequest(token) {
    this._consumeConfirmation(token, "request");
    return this._exclusive(async () => {
      const latest = await this._project(token.statePath);
      this._projection = latest.projection;
      if (
        !sameBinding(latest.projection, token) ||
        latest.projection.pendingEffect ||
        !latest.projection.availableActions.includes(token.action)
      ) {
        throw failClosed("delivery request confirmation is stale");
      }
      const result = await this._step(
        buildDeliveryStepArgs({
          statePath: token.statePath,
          action: token.action,
          expectedRevision: token.expectedRevision,
          expectedStateDigest: token.expectedStateDigest,
          writeState: true,
        }),
      );
      const next = result.projection;
      if (
        next.flowId !== token.flowId ||
        next.revision <= token.expectedRevision ||
        next.pendingEffect?.action !== token.action ||
        next.availableActions.length !== 0
      ) {
        throw failClosed(
          "CLI did not return the requested pending effect",
          "INVALID_STEP",
        );
      }
      this._projection = next;
      return next;
    });
  }

  async previewSettlement(resultPath) {
    const projection = this._projection;
    const pending = projection?.pendingEffect;
    if (!projection || !pending || !this._statePath) {
      throw failClosed("no delivery effect is pending", "NO_PENDING_EFFECT");
    }
    const resultText = String(await this._readResultFile(String(resultPath)));
    const envelope = parseDeliveryActionResult(resultText);
    if (!envelope || envelope.effectId !== pending.id) {
      throw failClosed(
        "result envelope effectId does not match the pending effect",
      );
    }
    const token = Object.freeze({
      id: randomUUID(),
      kind: "settle",
      statePath: this._statePath,
      resultPath: String(resultPath),
      resultDigest: `sha256:${createHash("sha256").update(resultText).digest("hex")}`,
      flowId: projection.flowId,
      action: pending.action,
      expectedRevision: projection.revision,
      expectedStateDigest: projection.stateDigest,
      expectedEffectId: pending.id,
    });
    this._confirmation = token;
    return token;
  }

  async confirmSettlement(token) {
    this._consumeConfirmation(token, "settle");
    return this._exclusive(async () => {
      const latest = await this._project(token.statePath);
      this._projection = latest.projection;
      if (!sameBinding(latest.projection, token, { effect: true })) {
        throw failClosed("delivery settlement confirmation is stale");
      }
      const resultText = String(await this._readResultFile(token.resultPath));
      const resultDigest = `sha256:${createHash("sha256")
        .update(resultText)
        .digest("hex")}`;
      const envelope = parseDeliveryActionResult(resultText);
      if (
        resultDigest !== token.resultDigest ||
        !envelope ||
        envelope.effectId !== token.expectedEffectId
      ) {
        throw failClosed("delivery result envelope changed after preview");
      }
      const result = await this._step(
        buildDeliveryStepArgs({
          statePath: token.statePath,
          resultPath: token.resultPath,
          expectedRevision: token.expectedRevision,
          expectedStateDigest: token.expectedStateDigest,
          expectedEffectId: token.expectedEffectId,
          writeState: true,
        }),
      );
      const next = result.projection;
      if (
        next.flowId !== token.flowId ||
        next.revision <= token.expectedRevision ||
        next.pendingEffect != null
      ) {
        throw failClosed(
          "CLI did not settle the exact pending effect",
          "INVALID_STEP",
        );
      }
      this._projection = next;
      return next;
    });
  }

  _consumeConfirmation(token, kind) {
    if (!token || token !== this._confirmation || token.kind !== kind) {
      throw failClosed("delivery confirmation is stale");
    }
    this._confirmation = null;
  }

  async _exclusive(operation) {
    if (this._busy)
      throw failClosed("another delivery operation is running", "BUSY");
    this._busy = true;
    try {
      return await operation();
    } finally {
      this._busy = false;
    }
  }
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function phaseStageIndex(phase) {
  if (phase === "completed") return STAGES.length;
  return STAGES.findIndex(([, phases]) => phases.has(phase));
}

function failureLocation(failure) {
  const parts = [];
  if (failure.file) {
    parts.push(
      `${failure.file}${failure.line != null ? `:${failure.line}` : ""}`,
    );
  }
  if (failure.hunk) parts.push(failure.hunk);
  if (failure.turnId) parts.push(`turn ${failure.turnId}`);
  if (failure.toolCallId) parts.push(`tool ${failure.toolCallId}`);
  return parts.join(" · ");
}

/** Safe HTML fragment embedded in the existing Sessions Workbench. */
function renderDeliveryHtml(projection, { statePath = "", error = "" } = {}) {
  const parts = [
    '<div class="delivery-head"><strong>Delivery flow</strong><span class="delivery-controls">',
    '<button class="sec" data-delivery-command="select">Select state…</button>',
    statePath
      ? '<button class="sec" data-delivery-command="refresh">Refresh flow</button>'
      : "",
    "</span></div>",
  ];
  if (statePath) {
    parts.push(
      `<div class="muted delivery-path">${escapeHtml(statePath)}</div>`,
    );
  }
  if (error) {
    parts.push(`<div class="warn">${escapeHtml(error)}</div>`);
  }
  const state = parseDeliveryProjection(projection);
  if (!state) {
    parts.push(
      '<p class="muted">Select a CLI delivery-flow state snapshot. No delivery action is available while disconnected.</p>',
    );
    return parts.join("");
  }

  const current = phaseStageIndex(state.phase);
  parts.push('<div class="delivery-stages">');
  for (let index = 0; index < STAGES.length; index += 1) {
    const [label] = STAGES[index];
    let status =
      index < current ? "done" : index === current ? "current" : "next";
    if (state.phase === "completed") status = "done";
    if (
      (state.status === "blocked" || state.status === "stopped") &&
      index === current
    ) {
      status = "blocked";
    }
    parts.push(
      `<span class="delivery-stage ${status}">${status === "done" ? "✓" : status === "current" ? "●" : status === "blocked" ? "!" : "○"} ${label}</span>`,
    );
  }
  parts.push("</div>");
  parts.push(
    `<div><strong>${escapeHtml(state.status)} / ${escapeHtml(state.phase)}</strong> · round ${state.round}/${state.maxRounds} · no progress ${state.noProgressRounds}/${state.maxNoProgressRounds} · revision ${state.revision}</div>`,
  );
  if (state.stopReason) {
    parts.push(
      `<div class="warn">Stop reason: ${escapeHtml(state.stopReason)}</div>`,
    );
  }
  if (state.pendingEffect) {
    parts.push(
      `<div class="warn">Pending request only: ${escapeHtml(ACTION_LABELS[state.pendingEffect.action] || state.pendingEffect.action)}<br/><code>${escapeHtml(state.pendingEffect.id)}</code></div>`,
    );
  }
  if (state.failures.length) {
    parts.push("<details open><summary>Failure mapping</summary><ul>");
    for (const failure of state.failures) {
      const labels = [failure.source, failure.gateId, failure.test]
        .filter(Boolean)
        .join(" / ");
      const location = failureLocation(failure);
      parts.push(
        `<li>${labels ? `<strong>${escapeHtml(labels)}</strong>: ` : ""}${escapeHtml(failure.message)}${location ? `<div class="muted">${escapeHtml(location)}</div>` : ""}</li>`,
      );
    }
    parts.push("</ul></details>");
  }
  if (state.pr) {
    parts.push(
      `<div>PR #${state.pr.number} · head <code>${escapeHtml(state.pr.headCommitSha || "unverified")}</code> · CI <code>${escapeHtml(state.pr.ciCommitSha || "unverified")}</code> · merge ${state.pr.mergeAllowed ? "eligible" : "blocked"}</div>`,
    );
  }
  if (state.evidence) {
    parts.push(
      `<div><strong>Immutable evidence</strong>: ${state.evidence.ready ? "ready" : "not ready"} · <code>${escapeHtml(state.evidence.recordDigest)}</code>${state.evidence.artifactId ? ` · artifact ${escapeHtml(state.evidence.artifactId)}` : ""}</div>`,
    );
  }
  parts.push('<div class="delivery-actions">');
  for (const action of state.availableActions) {
    parts.push(
      `<button data-delivery-action="${escapeHtml(action)}">Request: ${escapeHtml(ACTION_LABELS[action] || action)}</button>`,
    );
  }
  if (state.pendingEffect) {
    parts.push(
      '<button data-delivery-command="settle">Settle from result JSON…</button>',
    );
  }
  parts.push(
    '</div><div class="muted">Buttons create or settle a coordinator effect through <code>cc artifacts delivery-step</code>. They never call a PR, CI, merge, or archive provider directly.</div>',
  );
  return parts.join("");
}

module.exports = {
  ACTIONS,
  ACTION_LABELS,
  parseDeliveryProjection,
  parseDeliveryAction,
  parseDeliveryActionResult,
  parseDeliveryCommandResult,
  buildDeliveryProjectArgs,
  buildDeliveryStepArgs,
  DeliveryWorkflowController,
  renderDeliveryHtml,
};
