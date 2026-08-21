/**
 * Canonical, read-only session projection consumed by every IDE surface.
 *
 * The CLI/control plane owns lifecycle and mutations. IDEs receive this
 * deliberately small JSON document and must never infer extra capabilities
 * from local state files. Unsupported checkpoint/archive/detach actions stay
 * explicit and unavailable.
 */

import { createHash } from "node:crypto";
import {
  deriveSessionState,
  normalizeSessionState,
  SESSION_STATES,
} from "./session-lifecycle.js";

export const SESSION_PROJECTION_SCHEMA = "chainlesschain.session-projection/v2";
export const SESSION_PROJECTION_VERSION = 2;

export const PROJECTION_KINDS = Object.freeze([
  "local",
  "background",
  "remote",
  "team",
  "workflow",
  "dynamic_workflow",
]);

export const PROJECTION_STATES = Object.freeze([
  "working",
  "needs_input",
  "blocked",
  "done",
  "failed",
  "stopped",
]);

export const PROJECTION_ACTIONS = Object.freeze([
  "dispatch",
  "peek",
  "reply",
  "attach",
  "detach",
  "stop",
  "checkpoint",
  "archive",
  "pause",
  "resume",
  "recover",
]);

export const PROJECTION_ACTION_EXECUTORS = Object.freeze([
  "cli",
  "terminal",
  "host",
]);

export const PROJECTION_PROMPT_PLACEHOLDER = "$prompt";

const TERMINAL_PROJECTION_STATES = new Set(["done", "failed", "stopped"]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

export function projectionRevision(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")}`;
}

export function canonicalSessionId(kind, sourceId) {
  const normalizedKind = PROJECTION_KINDS.includes(kind) ? kind : "local";
  return `${normalizedKind}:${encodeURIComponent(String(sourceId || "unknown"))}`;
}

function asText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function toIso(value) {
  if (value == null || value === "") return null;
  let epoch = null;
  if (typeof value === "number" || /^\d{10,}$/.test(String(value))) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) {
      epoch = number < 1e12 ? number * 1000 : number;
    }
  } else {
    const raw = String(value).trim();
    const normalized =
      raw.includes(" ") && !raw.includes("T")
        ? `${raw.replace(" ", "T")}Z`
        : raw;
    const parsed = Date.parse(normalized);
    if (Number.isFinite(parsed)) epoch = parsed;
  }
  if (epoch == null) return null;
  try {
    return new Date(epoch).toISOString();
  } catch {
    return null;
  }
}

function sourceSessionId(source, fallback = null) {
  return (
    asText(source?.sessionId) ||
    asText(source?.agentSessionId) ||
    asText(source?.remoteSessionId) ||
    asText(source?.executionAuthoritySessionId) ||
    fallback
  );
}

function sourceSessionIds(kind, source, fallback = null) {
  const ids = [];
  const add = (value) => {
    const id = asText(value);
    if (id && !ids.includes(id)) ids.push(id);
  };
  add(sourceSessionId(source, fallback));
  if (kind === "team") {
    for (const unit of Array.isArray(source?.units) ? source.units : []) {
      add(unit?.sessionId);
    }
  }
  return ids;
}

function mapLifecycleState(source) {
  const phase = String(source?.phase || "")
    .trim()
    .toLowerCase();
  const lifecycle =
    normalizeSessionState(source?.lifecycleState) ||
    deriveSessionState({
      status: source?.status,
      phase: source?.phase,
      connection: source?.connection,
      recovering: source?.recovering,
      cancelRequested: source?.cancelRequested,
      pendingApprovals: source?.pendingApprovals,
    });

  // Supervisor terminal verdicts are absorbing even when a stale worker phase
  // still says that the previous turn needed input.
  if (lifecycle === SESSION_STATES.COMPLETED) return "done";
  if (lifecycle === SESSION_STATES.FAILED) return "failed";
  if (lifecycle === SESSION_STATES.STOPPED) return "stopped";

  if (
    (source?.pendingQuestion != null && source.pendingQuestion !== false) ||
    source?.needsInput === true ||
    ["needs_input", "needs-input", "awaiting_input", "question"].includes(phase)
  ) {
    return "needs_input";
  }

  switch (lifecycle) {
    case SESSION_STATES.WAITING_APPROVAL:
    case SESSION_STATES.CANCELLING:
    case SESSION_STATES.DISCONNECTED:
    case SESSION_STATES.RECOVERING:
      return "blocked";
    default:
      return "working";
  }
}

function mapTeamState(source) {
  const status = String(source?.status || "")
    .trim()
    .toLowerCase();
  if (status === "completed") return "done";
  if (status === "failed") return "failed";
  if (["cancelled", "canceled", "stopped"].includes(status)) return "stopped";

  const units = Array.isArray(source?.units) ? source.units : [];
  if (
    units.some(
      (unit) =>
        asCount(unit?.sideEffects?.unknown) > 0 ||
        asCount(unit?.sideEffects?.unsettled) > 0,
    )
  ) {
    return "blocked";
  }
  return "working";
}

function mapWorkflowState(source) {
  const stage = String(source?.stage || source?.mode?.stage || "")
    .trim()
    .toLowerCase();
  if (["complete", "completed", "done"].includes(stage)) return "done";
  if (["failed", "error", "errored"].includes(stage)) return "failed";
  if (["cancelled", "canceled", "stopped"].includes(stage)) return "stopped";
  if (
    stage === "plan" &&
    source?.hasPlan === true &&
    source?.approved !== true
  ) {
    return "needs_input";
  }
  // A bare directory is durable workflow residue, not proof of a live writer.
  if (!stage) return "stopped";
  return "working";
}

function mapDynamicWorkflowState(source) {
  const status = String(source?.status || "")
    .trim()
    .toLowerCase();
  if (status === "completed") return "done";
  if (status === "stopped") return "stopped";
  if (status === "failed") return "failed";
  if (["input_requested", "needs_input"].includes(status)) {
    return "needs_input";
  }
  if (["pause_requested", "paused", "blocked"].includes(status)) {
    return "blocked";
  }
  return ["ready", "running"].includes(status) ? "working" : "failed";
}

function preview(executor, argv, { mutates = false, input = null } = {}) {
  return {
    executor,
    argv: argv.map((value) => String(value)),
    mutates: mutates === true,
    input,
  };
}

function actionPreviews(kind, state, source, sourceId, linkedSessionId) {
  const active = !TERMINAL_PROJECTION_STATES.has(state);
  const interactive = source?.interactive === true;
  const linked = Boolean(linkedSessionId);
  const port = Number(source?.port);
  const cwd =
    asText(source?.checkpointCwd) ||
    asText(source?.cwd) ||
    asText(source?.workspace) ||
    asText(source?.repoRoot);
  const checkpointSessionId =
    asText(source?.checkpointSessionId) || linkedSessionId || sourceId;
  const checkpointAvailable =
    source?.checkpointAvailable === true &&
    Boolean(cwd) &&
    Boolean(checkpointSessionId) &&
    ["local", "background", "workflow"].includes(kind);

  const routes = Object.fromEntries(
    PROJECTION_ACTIONS.map((action) => [action, null]),
  );

  if (kind === "local") {
    routes.dispatch = preview("host", ["session", "resume", sourceId], {
      mutates: true,
    });
    routes.peek = preview("cli", ["session", "show", sourceId, "--json"]);
  } else if (kind === "background") {
    routes.peek = preview("cli", ["daemon", "view", sourceId, "--json"]);
    if (!active && linked) {
      routes.dispatch = preview(
        "cli",
        ["daemon", "resume", sourceId, PROJECTION_PROMPT_PLACEHOLDER, "--json"],
        { mutates: true, input: "prompt" },
      );
    }
    if (active && interactive) {
      routes.reply = preview(
        "cli",
        ["daemon", "reply", sourceId, PROJECTION_PROMPT_PLACEHOLDER, "--json"],
        { mutates: true, input: "prompt" },
      );
      routes.attach = preview("terminal", ["attach", sourceId]);
    }
    if (active) {
      routes.stop = preview("cli", ["daemon", "stop", sourceId, "--json"], {
        mutates: true,
      });
    }
  } else if (kind === "remote") {
    routes.peek = preview("cli", ["remote-control", "status", "--json"]);
    if (state === "working" && port > 0) {
      routes.stop = preview(
        "cli",
        ["remote-control", "stop", "--port", String(port), "--json"],
        { mutates: true },
      );
    }
  } else if (kind === "workflow" && cwd) {
    routes.peek = preview("cli", [
      "session",
      "workflow",
      sourceId,
      "--json",
      "--cwd",
      cwd,
    ]);
  } else if (kind === "dynamic_workflow" && cwd) {
    const expectedRevision = String(source?.revision || "");
    const runtimeArgs = (action) => [
      "cowork",
      "workflow",
      `runtime-${action}`,
      sourceId,
      "--expected-revision",
      expectedRevision,
      "--cwd",
      cwd,
      "--json",
    ];
    routes.peek = preview("cli", [
      "cowork",
      "workflow",
      "runtime-status",
      sourceId,
      "--cwd",
      cwd,
      "--json",
    ]);
    if (
      !TERMINAL_PROJECTION_STATES.has(state) &&
      !["paused", "input_requested", "needs_input"].includes(source?.status)
    ) {
      routes.pause = preview("cli", runtimeArgs("pause"), { mutates: true });
    }
    if (
      ["paused", "failed", "blocked"].includes(source?.status) &&
      Number(source?.agents?.pending || 0) === 0 &&
      Number(source?.input?.pending || 0) === 0
    ) {
      routes.resume = preview("cli", runtimeArgs("resume"), { mutates: true });
    }
    if (!["completed", "stopped"].includes(source?.status)) {
      routes.stop = preview("cli", runtimeArgs("stop"), { mutates: true });
    }
    if (Number(source?.recovery?.terminal || 0) > 0) {
      routes.recover = preview("cli", runtimeArgs("recover-checkpoints"), {
        mutates: true,
      });
    }
  }

  if (checkpointAvailable) {
    routes.checkpoint = preview(
      "cli",
      [
        "checkpoint",
        "create",
        "--dir",
        cwd,
        "--session",
        checkpointSessionId,
        "--json",
      ],
      { mutates: true },
    );
  }

  return routes;
}

function actionAvailability(kind, state, source, sourceId, linkedSessionId) {
  const active = !TERMINAL_PROJECTION_STATES.has(state);
  const interactive = source?.interactive === true;
  const routes = actionPreviews(kind, state, source, sourceId, linkedSessionId);

  const reasons = {
    dispatch:
      kind === "background"
        ? active
          ? "background session is already active"
          : "no linked transcript can be dispatched"
        : "this session kind has no dispatch route",
    peek:
      kind === "team"
        ? "team collaboration runs have no run-level CLI detail route"
        : kind === "workflow"
          ? "workflow project root is unavailable"
          : "this session kind has no read-only detail route",
    reply:
      kind === "background"
        ? interactive
          ? "background session is not active"
          : "background session has no interactive transport"
        : "reply is only supported by interactive background sessions",
    attach:
      kind === "background"
        ? interactive
          ? "background session is not active"
          : "background session has no interactive transport"
        : "attach is only supported by interactive background sessions",
    detach:
      "no control-plane attachment id exists; detach is local to the attach client",
    stop: "session is not an active stoppable control-plane process",
    checkpoint:
      kind === "team"
        ? "team checkpoints are task-scoped; no run-level checkpoint route exists"
        : kind === "remote"
          ? "remote sessions have no local checkpoint route"
          : "no git-backed session checkpoint capability is available",
    archive:
      kind === "team"
        ? "the collaboration run store has no non-destructive archive route"
        : kind === "workflow"
          ? "coding workflow state has no non-destructive archive route"
          : "no non-destructive session archive capability is available",
    pause:
      kind === "dynamic_workflow"
        ? "workflow run cannot be paused in its current state"
        : "pause is only supported by durable dynamic workflow runs",
    resume:
      kind === "dynamic_workflow"
        ? "workflow run has pending input/effects or is not resumable"
        : "resume is only supported by durable dynamic workflow runs",
    recover:
      kind === "dynamic_workflow"
        ? "no terminal checkpoint recovery is currently available"
        : "recovery is only supported by durable dynamic workflow runs",
  };

  return PROJECTION_ACTIONS.map((id) => {
    const available = routes[id] != null;
    return {
      id,
      available,
      reason: available ? null : reasons[id],
      preview: routes[id],
    };
  });
}

function ownerSummary(source, kind) {
  const governance =
    source?.governance && typeof source.governance === "object"
      ? source.governance
      : {};
  const id =
    asText(governance.owner) ||
    asText(source?.owner) ||
    asText(source?.ownerId) ||
    (kind === "remote" ? asText(source?.peerId) : null);
  return {
    type:
      kind === "remote"
        ? "remote-peer"
        : kind === "team"
          ? "team-coordinator"
          : "local-user",
    id,
  };
}

function environmentSummary(source, kind) {
  return {
    cwd:
      asText(source?.cwd) ||
      asText(source?.workspace) ||
      asText(source?.repoRoot),
    host: kind === "remote" ? asText(source?.host) : null,
    port:
      kind === "remote" && Number.isFinite(Number(source?.port))
        ? Number(source.port)
        : null,
    mode: kind === "remote" ? asText(source?.mode) : null,
  };
}

function worktreeSummary(source) {
  if (Array.isArray(source?.units)) {
    const worktrees = source.units.filter(
      (unit) => asText(unit?.worktreePath) || asText(unit?.branch),
    );
    if (worktrees.length > 0 || asText(source?.repoRoot)) {
      const only = worktrees.length === 1 ? worktrees[0] : null;
      return {
        repoRoot: asText(source?.repoRoot),
        path: only ? asText(only.worktreePath) : null,
        branch: only ? asText(only.branch) : null,
        baseSha: null,
        count: worktrees.length,
      };
    }
  }
  const worktree =
    source?.worktree && typeof source.worktree === "object"
      ? source.worktree
      : source;
  const result = {
    repoRoot: asText(worktree?.repoRoot),
    path: asText(worktree?.worktreePath) || asText(worktree?.path),
    branch: asText(worktree?.branch),
    baseSha: asText(worktree?.baseSha),
  };
  return Object.values(result).some(Boolean) ? result : null;
}

function latestBy(rows, field) {
  return [...rows].sort((left, right) => {
    const leftAt = Date.parse(toIso(left?.[field]) || "") || 0;
    const rightAt = Date.parse(toIso(right?.[field]) || "") || 0;
    return rightAt - leftAt;
  })[0];
}

function artifactSummary(sessionIds, artifacts) {
  const ids = new Set(
    (Array.isArray(sessionIds) ? sessionIds : [sessionIds]).filter(Boolean),
  );
  if (ids.size === 0) return { count: 0, latest: null };
  const linked = (Array.isArray(artifacts) ? artifacts : []).filter((entry) =>
    ids.has(entry?.sessionId),
  );
  const latest = linked.length ? latestBy(linked, "createdAt") : null;
  return {
    count: linked.length,
    latest: latest
      ? {
          id: asText(latest.id),
          title: asText(latest.title),
          kind: asText(latest.kind),
          createdAt: toIso(latest.createdAt),
        }
      : null,
  };
}

function dynamicWorkflowSummary(source) {
  if (source?.schema !== "cc-dynamic-workflow-workbench-state/v1") return null;
  return {
    runtimeRevision: source.revision,
    phase: source.phase,
    agents: source.agents,
    budget: source.budget,
    artifacts: source.artifacts,
    checkpoints: source.checkpoints,
    recovery: source.recovery,
    recoveryPolicy: source.recoveryPolicy,
    recent: source.recent,
    definitionDigest: source.definitionDigest,
    admissionDigest: source.admissionDigest,
    stateDigest: source.stateDigest,
  };
}

function prSummary(sessionIds, prLinks) {
  const linked = [];
  for (const sessionId of Array.isArray(sessionIds)
    ? sessionIds
    : [sessionIds]) {
    if (sessionId && Array.isArray(prLinks?.[sessionId])) {
      linked.push(...prLinks[sessionId]);
    }
  }
  const latest = linked.length ? latestBy(linked, "updatedAt") : null;
  return {
    count: linked.length,
    latest: latest
      ? {
          number: Number.isFinite(Number(latest.number))
            ? Number(latest.number)
            : null,
          repo: asText(latest.repo),
          url: asText(latest.url),
          state: asText(latest.state),
          updatedAt: toIso(latest.updatedAt),
        }
      : null,
  };
}

function approvalSummary(source, state) {
  let count = asCount(source?.pendingApprovals);
  if (Array.isArray(source?.units)) {
    count += source.units.reduce(
      (total, unit) =>
        total +
        asCount(unit?.sideEffects?.unknown) +
        asCount(unit?.sideEffects?.unsettled),
      0,
    );
  }
  if (source?.schema === "cc-dynamic-workflow-workbench-state/v1") {
    count +=
      asCount(source?.input?.pending) + asCount(source?.recovery?.terminal);
  }
  const needsInput = state === "needs_input";
  return {
    pending: needsInput || state === "blocked" || count > 0,
    type: needsInput
      ? "input"
      : source?.schema === "cc-dynamic-workflow-workbench-state/v1" && count > 0
        ? "recovery"
        : Array.isArray(source?.units) && count > 0
          ? "adjudication"
          : count > 0
            ? "approval"
            : null,
    count,
  };
}

function messagingSummary(sessionIds, fabric) {
  const linked = new Set(
    (Array.isArray(sessionIds) ? sessionIds : [sessionIds]).filter(Boolean),
  );
  const endpoints = Array.isArray(fabric?.endpoints)
    ? fabric.endpoints
        .filter((endpoint) => linked.has(endpoint?.sessionId))
        .map((endpoint) => ({
          name: asText(endpoint?.name),
          address: asText(endpoint?.address),
          policy: ["accept", "hold", "refuse"].includes(endpoint?.policy)
            ? endpoint.policy
            : "refuse",
          online: endpoint?.online === true,
          idle: endpoint?.idle === true,
          unread: asCount(endpoint?.unread),
          held: asCount(endpoint?.held),
        }))
        .filter((endpoint) => endpoint.name && endpoint.address)
        .sort((left, right) => left.name.localeCompare(right.name))
    : [];
  return {
    authority: "cli",
    registered: endpoints.length > 0,
    revision: Number.isSafeInteger(fabric?.revision) ? fabric.revision : 0,
    unread: endpoints.reduce((total, endpoint) => total + endpoint.unread, 0),
    held: endpoints.reduce((total, endpoint) => total + endpoint.held, 0),
    endpoints,
  };
}

function lastEventFor(source, state) {
  const at =
    toIso(source?.lastEvent?.at) ||
    toIso(source?.updatedAt) ||
    toIso(source?.updated_at) ||
    toIso(source?.endedAt) ||
    toIso(source?.heartbeatAt) ||
    toIso(source?.startedAt);
  return {
    type: asText(source?.lastEvent?.type) || `state:${state}`,
    at,
  };
}

function projectOne(
  kind,
  source,
  { artifacts, prLinks, sessionMessageFabric },
) {
  let sourceId;
  if (kind === "remote") {
    const stateFile = asText(source?.stateFile);
    sourceId =
      asText(source?.remoteSessionId) ||
      (Number(source?.port) > 0 ? `port:${Number(source.port)}` : null) ||
      (stateFile
        ? `invalid:${createHash("sha256").update(stateFile).digest("hex").slice(0, 16)}`
        : null) ||
      "invalid";
  } else {
    sourceId =
      asText(source?.id) ||
      asText(source?.runId) ||
      asText(source?.sessionId) ||
      "unknown";
  }

  let state;
  if (kind === "local") state = "stopped";
  else if (kind === "team") state = mapTeamState(source);
  else if (kind === "workflow") state = mapWorkflowState(source);
  else if (kind === "dynamic_workflow") {
    state = mapDynamicWorkflowState(source);
  } else if (kind === "remote") {
    state = source?.invalid ? "failed" : source?.alive ? "working" : "stopped";
  } else state = mapLifecycleState(source);

  const linkedSessionIds = sourceSessionIds(
    kind,
    source,
    kind === "local" || kind === "workflow" ? sourceId : null,
  );
  const linkedSessionId =
    linkedSessionIds.length === 1 ? linkedSessionIds[0] : null;
  const actions = actionAvailability(
    kind,
    state,
    source,
    sourceId,
    linkedSessionId,
  );
  const projected = {
    id: canonicalSessionId(kind, sourceId),
    sourceId,
    kind,
    state,
    title:
      asText(source?.title) ||
      (kind === "remote"
        ? `Remote control ${sourceId}`
        : kind === "team"
          ? `Team run ${sourceId}`
          : kind === "workflow"
            ? `Workflow ${sourceId}`
            : kind === "dynamic_workflow"
              ? `Dynamic workflow ${source?.workflowId || sourceId}`
              : `${kind} ${sourceId}`),
    capabilities: actions
      .filter((action) => action.available)
      .map((action) => action.id),
    actions,
    linkedSessionId,
    owner: ownerSummary(source, kind),
    environment: environmentSummary(source, kind),
    worktree: worktreeSummary(source),
    artifact:
      kind === "dynamic_workflow"
        ? { count: asCount(source?.artifacts?.count), latest: null }
        : artifactSummary(linkedSessionIds, artifacts),
    approval: approvalSummary(source, state),
    messaging: messagingSummary(linkedSessionIds, sessionMessageFabric),
    pr: prSummary(linkedSessionIds, prLinks),
    workflow: dynamicWorkflowSummary(source),
    lastEvent: lastEventFor(source, state),
  };
  return { ...projected, revision: projectionRevision(projected) };
}

function sourceStatus(count, error) {
  return {
    ok: !error,
    count,
    error: error ? String(error).slice(0, 240) : null,
  };
}

/** Build one deterministic projection envelope from already-read sources. */
export function buildSessionProjection({
  local = [],
  background = [],
  remote = [],
  team = [],
  workflow = [],
  dynamicWorkflow = [],
  artifacts = [],
  prLinks = {},
  sessionMessageFabric = null,
  sourceErrors = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const context = { artifacts, prLinks, sessionMessageFabric };
  const sessions = [
    ...(Array.isArray(local) ? local : []).map((source) =>
      projectOne("local", source, context),
    ),
    ...(Array.isArray(background) ? background : []).map((source) =>
      projectOne("background", source, context),
    ),
    ...(Array.isArray(remote) ? remote : []).map((source) =>
      projectOne("remote", source, context),
    ),
    ...(Array.isArray(team) ? team : []).map((source) =>
      projectOne("team", source, context),
    ),
    ...(Array.isArray(workflow) ? workflow : []).map((source) =>
      projectOne("workflow", source, context),
    ),
    ...(Array.isArray(dynamicWorkflow) ? dynamicWorkflow : []).map((source) =>
      projectOne("dynamic_workflow", source, context),
    ),
  ].sort((left, right) => {
    const priority = { needs_input: 0, blocked: 1, working: 2 };
    const rank = (item) => priority[item.state] ?? 3;
    return (
      rank(left) - rank(right) ||
      (Date.parse(right.lastEvent.at || "") || 0) -
        (Date.parse(left.lastEvent.at || "") || 0) ||
      left.id.localeCompare(right.id)
    );
  });

  const sources = {
    local: sourceStatus(
      Array.isArray(local) ? local.length : 0,
      sourceErrors.local,
    ),
    background: sourceStatus(
      Array.isArray(background) ? background.length : 0,
      sourceErrors.background,
    ),
    remote: sourceStatus(
      Array.isArray(remote) ? remote.length : 0,
      sourceErrors.remote,
    ),
    team: sourceStatus(
      Array.isArray(team) ? team.length : 0,
      sourceErrors.team,
    ),
    workflow: sourceStatus(
      Array.isArray(workflow) ? workflow.length : 0,
      sourceErrors.workflow,
    ),
    dynamicWorkflow: sourceStatus(
      Array.isArray(dynamicWorkflow) ? dynamicWorkflow.length : 0,
      sourceErrors.dynamicWorkflow,
    ),
    sessionMessageFabric: sourceStatus(
      Array.isArray(sessionMessageFabric?.endpoints)
        ? sessionMessageFabric.endpoints.length
        : 0,
      sourceErrors.sessionMessageFabric,
    ),
  };
  const revision = projectionRevision({
    schema: SESSION_PROJECTION_SCHEMA,
    sources,
    sessions: sessions.map((session) => ({
      id: session.id,
      revision: session.revision,
    })),
  });
  return {
    schema: SESSION_PROJECTION_SCHEMA,
    schemaVersion: SESSION_PROJECTION_VERSION,
    authority: "cli",
    connected: true,
    generatedAt: toIso(generatedAt) || new Date().toISOString(),
    revision,
    sources,
    sessions,
  };
}

function actionRequestError(code, reason, details = {}) {
  return { ok: false, code, reason, ...details };
}

/** Resolve the exact safe action preview shown by one projection revision. */
export function previewSessionProjectionAction(projection, request = {}) {
  if (
    !projection ||
    projection.authority !== "cli" ||
    projection.connected !== true ||
    typeof projection.revision !== "string"
  ) {
    return actionRequestError(
      "SESSION_PROJECTION_DISCONNECTED",
      "session projection is disconnected",
    );
  }
  if (request.revision !== projection.revision) {
    return actionRequestError(
      "SESSION_PROJECTION_STALE",
      "session projection revision changed",
      { currentRevision: projection.revision },
    );
  }
  const item = projection.sessions?.find((entry) => entry?.id === request.id);
  if (!item || request.itemRevision !== item.revision) {
    return actionRequestError(
      "SESSION_PROJECTION_STALE",
      "session item revision changed",
      { currentItemRevision: item?.revision || null },
    );
  }
  const action = item.actions?.find((entry) => entry?.id === request.action);
  if (!action?.available || !action.preview) {
    return actionRequestError(
      "SESSION_ACTION_UNAVAILABLE",
      action?.reason || "session action is unavailable",
    );
  }
  return {
    ok: true,
    id: item.id,
    action: action.id,
    expectedRevision: projection.revision,
    expectedItemRevision: item.revision,
    preview: stableValue(action.preview),
  };
}

/**
 * Re-check one rendered action against a freshly read authority projection.
 * Envelope churn caused by unrelated rows is allowed; the target item is a
 * strict content-revision CAS.
 */
export function recheckSessionProjectionAction(
  renderedProjection,
  currentProjection,
  request = {},
) {
  const rendered = previewSessionProjectionAction(renderedProjection, request);
  if (!rendered.ok) return rendered;
  if (
    !currentProjection ||
    currentProjection.authority !== "cli" ||
    currentProjection.connected !== true
  ) {
    return actionRequestError(
      "SESSION_PROJECTION_DISCONNECTED",
      "current session projection is disconnected",
    );
  }
  const currentItem = currentProjection.sessions?.find(
    (entry) => entry?.id === request.id,
  );
  if (!currentItem || currentItem.revision !== request.itemRevision) {
    return actionRequestError(
      "SESSION_PROJECTION_STALE",
      "session item changed before dispatch",
      { currentItemRevision: currentItem?.revision || null },
    );
  }
  const currentAction = currentItem.actions?.find(
    (entry) => entry?.id === request.action,
  );
  if (!currentAction?.available || !currentAction.preview) {
    return actionRequestError(
      "SESSION_ACTION_UNAVAILABLE",
      currentAction?.reason || "session action is no longer available",
    );
  }
  return {
    ok: true,
    id: currentItem.id,
    action: currentAction.id,
    expectedRevision: request.revision,
    expectedItemRevision: request.itemRevision,
    currentRevision: currentProjection.revision,
    preview: stableValue(currentAction.preview),
  };
}

/** A fail-closed transport envelope. No stale session actions survive. */
export function disconnectedSessionProjection(reasonText = "CLI unavailable") {
  const reason = String(reasonText || "CLI unavailable").slice(0, 240);
  return {
    schema: SESSION_PROJECTION_SCHEMA,
    schemaVersion: SESSION_PROJECTION_VERSION,
    authority: "cli",
    connected: false,
    generatedAt: new Date().toISOString(),
    revision: projectionRevision({ connected: false, reason }),
    reason,
    sources: {},
    sessions: [],
  };
}
