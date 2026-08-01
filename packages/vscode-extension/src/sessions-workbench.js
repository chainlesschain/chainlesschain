/**
 * Sessions Workbench core (gap #3 跨端 Remote/Cloud Session 入口) — pure logic
 * for the `chainlesschain.sessions.workbench` panel. Aggregates every session
 * surface the IDE can see into one list:
 *
 *  - chat sessions:      `cc session list --json` (CLI session store)
 *  - IDE sessions:       ~/.chainlesschain/ide/session-index.json (shared
 *                        cross-IDE metadata incl. running/waiting_approval)
 *  - background agents:  the `cc agent --bg` supervisor state dir (read via
 *                        background-agents.js, same as the Background Agents
 *                        panel — no CLI round-trip needed)
 *  - remote control:     `cc remote-control status --json` (host discovery)
 *
 * Dedup: a background agent that references sessionId X replaces the chat/IDE
 * row for X (the background row wins and carries the sessionId). A remote host
 * bound to agentSessionId X annotates row X (`remoteControlled`) but keeps its
 * own host row — the host and the session are different things to stop.
 *
 * Pure Node (no `vscode`) → unit-testable; the webview glue lives in
 * ui/sessions-view.js. All strings that reach HTML go through escapeHtml —
 * titles/workspaces/ids are user- or filesystem-controlled.
 */

const { isBlockingPhase } = require("./phase-attention");

const KINDS = ["chat", "ide", "background", "remote"];
const SESSION_PROJECTION_SCHEMA = "chainlesschain.session-projection/v1";
const SESSION_PROJECTION_VERSION = 1;
const PROJECTION_KINDS = new Set([
  "local",
  "background",
  "remote",
  "team",
  "workflow",
]);
const PROJECTION_STATES = new Set([
  "working",
  "needs_input",
  "blocked",
  "done",
  "failed",
  "stopped",
]);
const PROJECTION_ACTIONS = new Set([
  "dispatch",
  "peek",
  "reply",
  "attach",
  "detach",
  "stop",
  "checkpoint",
  "archive",
]);
const PROJECTION_ACTION_EXECUTORS = new Set(["cli", "terminal", "host"]);
const PROJECTION_PROMPT_PLACEHOLDER = "$prompt";

function parseActionPreview(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !PROJECTION_ACTION_EXECUTORS.has(value.executor) ||
    !Array.isArray(value.argv) ||
    value.argv.length === 0 ||
    !value.argv.every((arg) => typeof arg === "string") ||
    typeof value.mutates !== "boolean" ||
    ![null, "prompt"].includes(value.input ?? null)
  ) {
    return null;
  }
  const input = value.input ?? null;
  const placeholders = value.argv.filter(
    (arg) => arg === PROJECTION_PROMPT_PLACEHOLDER,
  ).length;
  if (
    (input === "prompt" && placeholders !== 1) ||
    (input === null && placeholders !== 0)
  ) {
    return null;
  }
  return {
    executor: value.executor,
    argv: [...value.argv],
    mutates: value.mutates,
    input,
  };
}

/** The `cc …` argv arrays the workbench needs (state-dir sources excluded). */
function buildWorkbenchArgs({ limit = 100, cwd = null } = {}) {
  const sessionProjection = [
    "session",
    "projection",
    "--json",
    "-n",
    String(limit),
  ];
  if (typeof cwd === "string" && cwd.trim()) {
    sessionProjection.push("--cwd", cwd.trim());
  }
  return {
    sessionProjection,
  };
}

/**
 * Parse the CLI-owned v1 projection. Any transport/schema/revision problem
 * returns an empty disconnected snapshot so stale buttons cannot survive.
 */
function parseSessionProjection(input, { expectedRevision = null } = {}) {
  let root;
  try {
    root = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    return {
      connected: false,
      stale: false,
      revision: null,
      rows: [],
      error: "invalid session projection JSON",
    };
  }
  if (
    !root ||
    typeof root !== "object" ||
    root.schema !== SESSION_PROJECTION_SCHEMA ||
    root.schemaVersion !== SESSION_PROJECTION_VERSION ||
    root.authority !== "cli"
  ) {
    return {
      connected: false,
      stale: false,
      revision: null,
      rows: [],
      error: "unsupported or non-CLI session projection",
    };
  }
  const revision =
    typeof root.revision === "string" && root.revision ? root.revision : null;
  if (root.connected !== true || !revision || !Array.isArray(root.sessions)) {
    return {
      connected: false,
      stale: false,
      revision,
      rows: [],
      sources: root.sources || {},
      error: String(root.reason || "CLI session projection disconnected"),
    };
  }
  if (expectedRevision && revision !== expectedRevision) {
    return {
      connected: false,
      stale: true,
      revision,
      rows: [],
      sources: root.sources || {},
      error: "stale session projection revision",
    };
  }

  const rows = [];
  for (const item of root.sessions) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !item.id ||
      typeof item.sourceId !== "string" ||
      !item.sourceId ||
      !PROJECTION_KINDS.has(item.kind) ||
      !PROJECTION_STATES.has(item.state) ||
      typeof item.revision !== "string" ||
      !Array.isArray(item.actions)
    ) {
      return {
        connected: false,
        stale: false,
        revision,
        rows: [],
        sources: root.sources || {},
        error: "malformed session projection row",
      };
    }
    const actionAvailability = {};
    for (const action of item.actions) {
      if (
        action &&
        typeof action.id === "string" &&
        PROJECTION_ACTIONS.has(action.id)
      ) {
        const available = action.available === true;
        const preview = parseActionPreview(action.preview);
        if ((available && !preview) || (!available && action.preview != null)) {
          return {
            connected: false,
            stale: false,
            revision,
            rows: [],
            sources: root.sources || {},
            error: "malformed session action preview",
          };
        }
        actionAvailability[action.id] = {
          available,
          reason:
            typeof action.reason === "string" && action.reason
              ? action.reason
              : null,
          preview,
        };
      }
    }
    if (Object.keys(actionAvailability).length !== PROJECTION_ACTIONS.size) {
      return {
        connected: false,
        stale: false,
        revision,
        rows: [],
        sources: root.sources || {},
        error: "incomplete session action availability",
      };
    }
    const actions = [...PROJECTION_ACTIONS].filter(
      (id) => actionAvailability[id]?.available === true,
    );
    rows.push({
      id: item.id,
      sourceId: item.sourceId,
      kind: item.kind,
      title: typeof item.title === "string" ? item.title : item.sourceId,
      workspace:
        typeof item.environment?.cwd === "string" ? item.environment.cwd : "",
      status: item.state,
      state: item.state,
      lastActivity: toEpoch(item.lastEvent?.at),
      waitingApproval: item.state === "needs_input" || item.state === "blocked",
      actions,
      actionAvailability,
      actionPreviews: Object.fromEntries(
        actions.map((id) => [id, actionAvailability[id].preview]),
      ),
      sessionId:
        typeof item.linkedSessionId === "string" ? item.linkedSessionId : null,
      port:
        item.environment?.port != null &&
        Number.isFinite(Number(item.environment.port)) &&
        Number(item.environment.port) > 0
          ? Number(item.environment.port)
          : null,
      projectionRevision: revision,
      revision: item.revision,
      owner: item.owner || null,
      worktree: item.worktree || null,
      artifact: item.artifact || null,
      approval: item.approval || null,
      pr: item.pr || null,
    });
  }
  return {
    connected: true,
    stale: false,
    revision,
    generatedAt: root.generatedAt || null,
    sources: root.sources || {},
    rows: sortRows(rows),
    error: null,
  };
}

/** Re-check authority + revision + advertised availability at dispatch time. */
function canRunProjectionAction(snapshot, request) {
  if (!snapshot?.connected || !snapshot.revision || !request) return false;
  if (request.revision !== snapshot.revision) return false;
  const row = (snapshot.rows || []).find((item) => item.id === request.id);
  return Boolean(
    row &&
    row.projectionRevision === snapshot.revision &&
    row.actions.includes(request.action),
  );
}

/** Resolve the exact CLI/terminal/host route shown with one rendered row. */
function previewProjectionAction(snapshot, request) {
  if (!canRunProjectionAction(snapshot, request)) {
    return {
      ok: false,
      code: "SESSION_PROJECTION_STALE",
      error: "session projection is disconnected, stale, or unavailable",
    };
  }
  const row = snapshot.rows.find((item) => item.id === request.id);
  if (!row || request.itemRevision !== row.revision) {
    return {
      ok: false,
      code: "SESSION_PROJECTION_STALE",
      error: "session item revision changed",
    };
  }
  const action = row.actionAvailability?.[request.action];
  if (!action?.available || !action.preview) {
    return {
      ok: false,
      code: "SESSION_ACTION_UNAVAILABLE",
      error: action?.reason || "session action is unavailable",
    };
  }
  return {
    ok: true,
    row,
    preview: action.preview,
    expectedRevision: snapshot.revision,
    expectedItemRevision: row.revision,
  };
}

/** Per-item revision CAS against a freshly fetched CLI projection. */
function recheckProjectionAction(renderedSnapshot, currentSnapshot, request) {
  const rendered = previewProjectionAction(renderedSnapshot, request);
  if (!rendered.ok) return rendered;
  if (!currentSnapshot?.connected) {
    return {
      ok: false,
      code: "SESSION_PROJECTION_DISCONNECTED",
      error: "current session projection is disconnected",
    };
  }
  const row = (currentSnapshot.rows || []).find(
    (item) => item.id === request.id,
  );
  if (!row || row.revision !== request.itemRevision) {
    return {
      ok: false,
      code: "SESSION_PROJECTION_STALE",
      error: "session item changed before dispatch",
    };
  }
  const action = row.actionAvailability?.[request.action];
  if (!action?.available || !action.preview) {
    return {
      ok: false,
      code: "SESSION_ACTION_UNAVAILABLE",
      error: action?.reason || "session action is no longer available",
    };
  }
  return {
    ok: true,
    row,
    preview: action.preview,
    expectedRevision: request.revision,
    expectedItemRevision: request.itemRevision,
    currentRevision: currentSnapshot.revision,
  };
}

function materializeActionPreview(actionPreview, { prompt = null } = {}) {
  const parsed = parseActionPreview(actionPreview);
  if (!parsed) return null;
  if (parsed.input === "prompt") {
    const text = typeof prompt === "string" ? prompt.trim() : "";
    if (!text) return null;
    parsed.argv = parsed.argv.map((arg) =>
      arg === PROJECTION_PROMPT_PLACEHOLDER ? text : arg,
    );
  }
  return parsed;
}

/** Epoch-ms from an epoch number, numeric string, or date string. */
function toEpoch(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const s = String(value).trim();
  if (/^\d{10,}$/.test(s)) return Number(s);
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxEpoch(a, b) {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.max(a, b);
}

/** "just now" / "5m ago" / "3h ago" / "12d ago" / "2026-05-01". */
function formatRelativeTime(epochMs, now = Date.now()) {
  const ts = toEpoch(epochMs);
  if (ts == null) return "";
  const delta = now - ts;
  if (delta < 45 * 1000) return "just now";
  const min = Math.floor(delta / 60000);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toISOString().slice(0, 10);
}

/** Allowed action ids for a row, by kind + status. */
function deriveActions(row) {
  if (!row) return [];
  switch (row.kind) {
    case "chat":
    case "ide":
      // resume = repoint the IDE chat tab; rename = shared IDE index overlay;
      // delete = `cc session delete --force` + index prune.
      return ["resume", "rename", "delete"];
    case "background": {
      const acts = [];
      if (row.status === "running") {
        if (row.interactive) acts.push("attach");
        acts.push("stop");
      } else if (row.sessionId) {
        // `cc daemon resume <id> <prompt>` continues a finished session.
        acts.push("continue");
      }
      acts.push("rename");
      return acts;
    }
    case "remote":
      return row.status === "running" ? ["stop"] : [];
    default:
      return [];
  }
}

function finalizeRow(row) {
  return { ...row, actions: deriveActions(row) };
}

/**
 * Merge the four sources into unified rows:
 * `{id, kind, title, workspace, status, lastActivity, waitingApproval, actions}`
 * (+ `sessionId` on background rows, `port` on remote rows). Sorted:
 * waitingApproval → running → lastActivity desc.
 */
function aggregateSessions({
  chatSessions = [],
  ideIndex = [],
  backgroundAgents = [],
  remoteControl = [],
} = {}) {
  const byId = new Map();

  for (const s of Array.isArray(chatSessions) ? chatSessions : []) {
    if (!s || typeof s.id !== "string" || !s.id) continue;
    byId.set(s.id, {
      id: s.id,
      kind: "chat",
      title: typeof s.title === "string" ? s.title : "",
      workspace: "",
      status: "stored",
      lastActivity: toEpoch(s.updatedAt),
      waitingApproval: false,
      sessionId: null,
    });
  }

  // IDE index overlays chat rows (live status, workspace, IDE-side titles);
  // IDE-only ids become their own "ide" rows.
  for (const r of Array.isArray(ideIndex) ? ideIndex : []) {
    if (!r || typeof r.id !== "string" || !r.id) continue;
    const prev = byId.get(r.id);
    const status = r.status || "stopped";
    byId.set(r.id, {
      ...(prev || {}),
      id: r.id,
      kind: prev ? prev.kind : "ide",
      title: r.title || prev?.title || "",
      workspace: r.workspace || prev?.workspace || "",
      status,
      lastActivity: maxEpoch(prev?.lastActivity ?? null, toEpoch(r.updatedAt)),
      waitingApproval: status === "waiting_approval",
      sessionId: prev?.sessionId || null,
    });
  }

  // Background agents win over the chat/IDE row for the session they drive.
  for (const b of Array.isArray(backgroundAgents) ? backgroundAgents : []) {
    if (!b || typeof b.id !== "string" || !b.id) continue;
    const linked = b.sessionId ? byId.get(b.sessionId) : null;
    if (linked) byId.delete(b.sessionId);
    const last =
      toEpoch(b.endedAt) ?? toEpoch(b.heartbeatAt) ?? toEpoch(b.startedAt);
    byId.set(b.id, {
      id: b.id,
      kind: "background",
      title: b.title || linked?.title || b.id,
      workspace: b.cwd || linked?.workspace || "",
      status: b.status || "?",
      lastActivity: maxEpoch(last, linked?.lastActivity ?? null),
      // The supervisor's own phase reporter is authoritative for a blocked
      // worker — the shared isBlockingPhase predicate (waiting_permission /
      // needs_input / uncertain_side_effect / pendingApprovals>0) keeps this
      // row's badge from drifting from the Background Agents panel's.
      waitingApproval:
        Boolean(linked?.waitingApproval) ||
        Boolean(b.attention) ||
        (b.status === "running" &&
          isBlockingPhase(b.phase, b.pendingApprovals)),
      sessionId: b.sessionId || null,
      interactive: Boolean(b.interactive),
    });
  }

  // Remote-control hosts are their own rows; a host bound to a session we
  // already show annotates that row instead of hiding either.
  const rows = [];
  for (const st of Array.isArray(remoteControl) ? remoteControl : []) {
    if (!st || typeof st !== "object") continue;
    if (st.invalid) {
      rows.push({
        id: `remote:${st.stateFile || "invalid"}`,
        kind: "remote",
        title: "Remote-control host (invalid state file)",
        workspace: "",
        status: "invalid",
        lastActivity: null,
        waitingApproval: false,
        port: null,
        sessionId: null,
      });
      continue;
    }
    const port = Number.isFinite(Number(st.port)) ? Number(st.port) : null;
    if (st.agentSessionId && byId.has(st.agentSessionId)) {
      byId.get(st.agentSessionId).remoteControlled = true;
    }
    rows.push({
      id: `remote:${port ?? "?"}`,
      kind: "remote",
      title:
        `Remote control host :${port ?? "?"}` +
        (st.mode ? ` (${st.mode})` : ""),
      workspace: "",
      status: st.alive ? "running" : "stale",
      lastActivity: toEpoch(st.startedAt),
      waitingApproval: false,
      port,
      sessionId: st.agentSessionId || null,
    });
  }

  const all = [...byId.values(), ...rows].map(finalizeRow);
  return sortRows(all);
}

/** waitingApproval first, then running, then lastActivity desc, then id. */
function sortRows(rows) {
  const rank = (r) => {
    if (r.status === "needs_input") return 0;
    if (r.status === "blocked" || r.waitingApproval) return 1;
    if (r.status === "working" || r.status === "running") return 2;
    return 3;
  };
  return [...(rows || [])].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    const ta = a.lastActivity ?? -Infinity;
    const tb = b.lastActivity ?? -Infinity;
    if (tb !== ta) return tb - ta;
    return String(a.id).localeCompare(String(b.id));
  });
}

/** Case-insensitive substring filter on title / workspace / id. */
function filterRows(rows, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return [...(rows || [])];
  return (rows || []).filter((r) =>
    [r.title, r.workspace, r.id].some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(q),
    ),
  );
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

const ACTION_LABELS = {
  dispatch: "Dispatch",
  peek: "Peek",
  reply: "Reply",
  attach: "Attach",
  detach: "Detach",
  checkpoint: "Checkpoint",
  archive: "Archive",
  resume: "Resume",
  continue: "Continue",
  stop: "Stop",
  rename: "Rename",
  delete: "Delete",
};

/**
 * Rows-table HTML fragment (server-rendered, fully escaped) that the webview
 * injects on every `{type:"rows"}` message. `opts.errors` renders per-source
 * warning rows so one failing source never blanks the panel.
 */
function renderWorkbenchHtml(rows, { now = Date.now(), errors = [] } = {}) {
  const parts = [];
  for (const e of errors || []) {
    parts.push(
      `<div class="warn">⚠ ${escapeHtml(e.source || "source")} unavailable: ${escapeHtml(e.message || "unknown error")}</div>`,
    );
  }
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    parts.push('<p class="muted">No sessions found.</p>');
    return parts.join("");
  }
  const body = list
    .map((r) => {
      const acts = (r.actions || [])
        .map(
          (a) =>
            `<button class="${a === "attach" || a === "resume" ? "" : "sec"}" data-act="${escapeHtml(a)}" data-id="${escapeHtml(r.id)}" data-kind="${escapeHtml(r.kind)}"` +
            (r.sourceId ? ` data-source-id="${escapeHtml(r.sourceId)}"` : "") +
            (r.projectionRevision
              ? ` data-revision="${escapeHtml(r.projectionRevision)}"`
              : "") +
            (r.revision
              ? ` data-item-revision="${escapeHtml(r.revision)}"`
              : "") +
            (r.sessionId ? ` data-session="${escapeHtml(r.sessionId)}"` : "") +
            (r.port != null ? ` data-port="${escapeHtml(r.port)}"` : "") +
            `>${ACTION_LABELS[a] || escapeHtml(a)}</button>`,
        )
        .join("");
      const badge = r.waitingApproval
        ? ' <span class="badge">waiting approval</span>'
        : "";
      const remote = r.remoteControlled
        ? ' <span class="badge alt">remote-controlled</span>'
        : "";
      const meta = [r.id, r.workspace].filter(Boolean).map(escapeHtml);
      return (
        `<tr><td><span class="st ${escapeHtml(r.status)}">${escapeHtml(r.status)}</span>${badge}</td>` +
        `<td><span class="kind ${escapeHtml(r.kind)}">${escapeHtml(r.kind)}</span> ${escapeHtml(r.title || r.id)}${remote}` +
        `<div class="muted">${meta.join(" · ")}</div></td>` +
        `<td>${escapeHtml(formatRelativeTime(r.lastActivity, now))}</td>` +
        `<td>${acts}</td></tr>`
      );
    })
    .join("");
  parts.push(
    '<table><thead><tr><th style="width:150px">status</th><th>session</th><th style="width:90px">activity</th><th style="width:280px">actions</th></tr></thead><tbody>' +
      body +
      "</tbody></table>",
  );
  return parts.join("");
}

module.exports = {
  KINDS,
  SESSION_PROJECTION_SCHEMA,
  SESSION_PROJECTION_VERSION,
  PROJECTION_KINDS,
  PROJECTION_STATES,
  PROJECTION_ACTIONS,
  PROJECTION_ACTION_EXECUTORS,
  PROJECTION_PROMPT_PLACEHOLDER,
  ACTION_LABELS,
  buildWorkbenchArgs,
  parseSessionProjection,
  canRunProjectionAction,
  previewProjectionAction,
  recheckProjectionAction,
  materializeActionPreview,
  toEpoch,
  formatRelativeTime,
  deriveActions,
  aggregateSessions,
  sortRows,
  filterRows,
  escapeHtml,
  renderWorkbenchHtml,
};
