/**
 * Artifacts drawer core (gap #9) — pure logic for the
 * `chainlesschain.artifacts.show` panel over the agent deliverable store
 * (`cc artifacts`, ~/.chainlesschain/artifacts/):
 *
 *  - list rows:   `cc artifacts list --json`  → { artifacts: [metadata…] }
 *  - one row:     `cc artifacts show <id> --json` → metadata only
 *  - content path:`cc artifacts access <id> … --json` → audited local path
 *  - remove:      `cc artifacts remove <id> --json`
 *
 * Only METADATA ever reaches this module — file bodies are never inlined into
 * the list HTML (previews go through vscode APIs in ui/artifacts-view.js:
 * markdown.showPreview / asWebviewUri <img> / showTextDocument /
 * openExternal for html). Every official content/path action first obtains a
 * content-free access authority from the CLI.
 *
 * Pure Node (no `vscode`) → unit-testable; the webview glue lives in
 * ui/artifacts-view.js. Everything that reaches HTML goes through escapeHtml —
 * titles/paths/session ids are user- or agent-controlled.
 */

const os = require("os");
const path = require("path");
const {
  escapeHtml,
  formatRelativeTime,
  toEpoch,
} = require("./sessions-workbench.js");

/** kind → icon/label (mirrors the CLI's ARTIFACT_KINDS). */
const ARTIFACT_KIND_META = {
  report: { icon: "📄", label: "report" },
  patch: { icon: "🩹", label: "patch" },
  screenshot: { icon: "🖼️", label: "screenshot" },
  log: { icon: "📜", label: "log" },
  data: { icon: "🗃️", label: "data" },
  other: { icon: "📦", label: "other" },
};

const ARTIFACT_KINDS = Object.keys(ARTIFACT_KIND_META);

/** The `cc …` argv arrays the drawer spawns. */
function buildArtifactsListArgs() {
  return ["artifacts", "list", "--json"];
}
function buildArtifactsWorkbenchArgs() {
  return ["artifacts", "workbench", "--json"];
}
function buildArtifactsShowArgs(id) {
  return ["artifacts", "show", String(id), "--json"];
}
function buildArtifactsAccessArgs(id, action, client = "vscode", accessId) {
  return [
    "artifacts",
    "access",
    String(id),
    "--client",
    String(client),
    "--action",
    String(action),
    ...(accessId ? ["--access-id", String(accessId)] : []),
    "--json",
  ];
}
function buildArtifactsRemoveArgs(id, deletionId = null) {
  return [
    "artifacts",
    "remove",
    String(id),
    "--client",
    "vscode",
    ...(deletionId ? ["--deletion-id", String(deletionId)] : []),
    "--json",
  ];
}

function buildArtifactsRecoveryAdjudicateArgs(
  itemId,
  planDigest,
  decision,
  adjudicationId,
) {
  return [
    "artifacts",
    "recovery-adjudicate",
    String(itemId),
    "--plan-digest",
    String(planDigest),
    "--decision",
    String(decision),
    ...(adjudicationId ? ["--adjudication-id", String(adjudicationId)] : []),
    ...(decision === "defer" ? [] : ["--approve"]),
    "--json",
  ];
}

/**
 * Where the store lives (same resolution as the CLI's artifactsDir()):
 * CC_ARTIFACTS_DIR override, else ~/.chainlesschain/artifacts. Used only for
 * the webview's localResourceRoots — per-artifact paths come from an audited
 * `cc artifacts access --json` authorization.
 */
function defaultArtifactsDir(homedir = os.homedir(), env = process.env) {
  if (env && env.CC_ARTIFACTS_DIR) return env.CC_ARTIFACTS_DIR;
  return path.join(homedir, ".chainlesschain", "artifacts");
}

/** "512 B" / "3.4 KB" / "1.2 MB" / "2.0 GB". */
function formatSize(bytes) {
  if (bytes == null || bytes === "") return "";
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i += 1;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(1)} ${units[i]}`;
}

const EXT_PREVIEW = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".log": "text",
  ".json": "text",
  ".csv": "text",
  ".xml": "text",
  ".yaml": "text",
  ".yml": "text",
  ".patch": "text",
  ".diff": "text",
  // svg is TEXT on purpose: an <img>-embedded svg is script-inert, but the
  // safe default for a document that CAN carry <script> is the text editor.
  ".svg": "text",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".html": "html",
  ".htm": "html",
};

const MIME_PREVIEW = {
  "text/markdown": "markdown",
  "text/plain": "text",
  "text/csv": "text",
  "text/x-patch": "text",
  "application/json": "text",
  "application/xml": "text",
  "application/yaml": "text",
  "image/svg+xml": "text", // see EXT_PREVIEW note
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
  "text/html": "html",
};

/**
 * How (and whether) an artifact can be previewed:
 *   "markdown" → markdown.showPreview
 *   "image"    → <img asWebviewUri> inside the panel
 *   "text"     → showTextDocument
 *   "html"     → NEVER executed in the panel; offered as "Open in browser"
 *   null       → no preview (pdf/zip/binary/unknown)
 * Mime decides first; a generic octet-stream falls back to the stored file's
 * extension.
 */
function previewKindForMime(mime, file) {
  const m = String(mime || "").toLowerCase();
  if (m && MIME_PREVIEW[m]) return MIME_PREVIEW[m];
  if (m && m !== "application/octet-stream") return null;
  const ext = path.extname(String(file || "")).toLowerCase();
  return EXT_PREVIEW[ext] || null;
}

/**
 * Allowed action ids for a shaped row. html is intentionally NOT "preview":
 * the panel webview must never execute artifact html — it opens externally.
 */
function deriveArtifactActions(row) {
  if (!row) return [];
  const acts = [];
  if (row.preview && row.preview !== "html") acts.push("preview");
  if (row.preview === "html") acts.push("openExternal");
  acts.push("copyPath", "reveal", "download", "remove");
  return acts;
}

/** One `cc artifacts list --json` metadata row → display row. Junk → null. */
function shapeArtifact(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.id !== "string") {
    return null;
  }
  const kind = ARTIFACT_KIND_META[entry.kind] ? entry.kind : "other";
  const preview = previewKindForMime(entry.mime, entry.file);
  const row = {
    id: entry.id,
    title: typeof entry.title === "string" ? entry.title : entry.id,
    kind,
    kindIcon: ARTIFACT_KIND_META[kind].icon,
    kindLabel: ARTIFACT_KIND_META[kind].label,
    mime: typeof entry.mime === "string" ? entry.mime : "",
    size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : null,
    sizeLabel: formatSize(entry.size),
    sha256: typeof entry.sha256 === "string" ? entry.sha256 : "",
    file: typeof entry.file === "string" ? entry.file : "",
    sourcePath: typeof entry.sourcePath === "string" ? entry.sourcePath : "",
    sessionId: typeof entry.sessionId === "string" ? entry.sessionId : null,
    createdAt: toEpoch(entry.createdAt),
    expiresAt: toEpoch(entry.expiresAt),
    immutable: entry.immutable === true,
    recordDigest:
      typeof entry.recordDigest === "string" ? entry.recordDigest : null,
    returnedResult:
      entry.returnedResult && typeof entry.returnedResult === "object"
        ? {
            sessionId: String(entry.returnedResult.sessionId || ""),
            requestId: String(entry.returnedResult.requestId || ""),
            reviewDigest: String(entry.returnedResult.reviewDigest || ""),
            item: String(entry.returnedResult.item || ""),
            kind: String(entry.returnedResult.kind || ""),
            sourceDigest: String(entry.returnedResult.sourceDigest || ""),
          }
        : null,
    history: {
      accessCount: Number(entry.history?.accessCount || 0),
      latestAccess:
        entry.history?.latestAccess &&
        typeof entry.history.latestAccess === "object"
          ? {
              action: String(entry.history.latestAccess.action || ""),
              client: String(entry.history.latestAccess.client || ""),
              authorizedAt: toEpoch(entry.history.latestAccess.authorizedAt),
              eventDigest: String(entry.history.latestAccess.eventDigest || ""),
            }
          : null,
    },
    preview,
  };
  row.actions = deriveArtifactActions(row);
  return row;
}

function shapeArtifactWorkbench(payload) {
  if (
    !payload ||
    payload.schema !== "cc-artifact-workbench/v1" ||
    !payload.recovery ||
    !Array.isArray(payload.recovery.items) ||
    !payload.history ||
    !Array.isArray(payload.history.activity)
  ) {
    return null;
  }
  const recoveryItems = payload.recovery.items
    .filter(
      (item) =>
        item &&
        typeof item.itemId === "string" &&
        typeof item.kind === "string" &&
        typeof item.recommendedDecision === "string",
    )
    .map((item) => ({
      itemId: item.itemId,
      kind: item.kind,
      severity: String(item.severity || "warning"),
      timedOut: item.timedOut === true,
      recommendedDecision: item.recommendedDecision,
    }));
  return {
    rows: shapeArtifacts(payload),
    recovery: {
      planDigest: String(payload.recovery.planDigest || ""),
      summary: {
        itemCount: Number(payload.recovery.summary?.itemCount || 0),
        criticalCount: Number(payload.recovery.summary?.criticalCount || 0),
        timedOutCount: Number(payload.recovery.summary?.timedOutCount || 0),
      },
      items: recoveryItems,
    },
    history: {
      totalEventCount: Number(payload.history.totalEventCount || 0),
      truncated: payload.history.truncated === true,
      activity: payload.history.activity.slice(0, 200),
    },
  };
}

/**
 * `cc artifacts list --json` output → shaped rows, newest first.
 * Accepts `{ artifacts: […] }` or a bare array; junk rows are dropped.
 */
function shapeArtifacts(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.artifacts)
      ? payload.artifacts
      : [];
  return list
    .map(shapeArtifact)
    .filter(Boolean)
    .sort((a, b) => {
      const ta = a.createdAt ?? -Infinity;
      const tb = b.createdAt ?? -Infinity;
      if (tb !== ta) return tb - ta;
      return String(a.id).localeCompare(String(b.id));
    });
}

/** Case-insensitive substring on title/id/sessionId/file + exact kind. */
function filterArtifacts(rows, { query, kind } = {}) {
  let out = [...(rows || [])];
  const k = String(kind || "").trim();
  if (k && k !== "all") out = out.filter((r) => r.kind === k);
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return out;
  return out.filter((r) =>
    [r.title, r.id, r.sessionId, r.file].some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(q),
    ),
  );
}

const ACTION_LABELS = {
  preview: "Preview",
  openExternal: "Open in browser",
  copyPath: "Copy path",
  reveal: "Reveal",
  download: "Download",
  remove: "Remove",
};

/**
 * Rows-table HTML fragment (server-rendered, fully escaped) the webview
 * injects on every `{type:"rows"}` message. Metadata only — never file
 * bodies. `opts.errors` renders warning rows (failure tolerance).
 */
function renderArtifactsHtml(
  rows,
  { now = Date.now(), errors = [], recovery = null, history = null } = {},
) {
  const parts = [];
  for (const e of errors || []) {
    parts.push(
      `<div class="warn">⚠ ${escapeHtml(e.source || "source")} unavailable: ${escapeHtml(e.message || "unknown error")}</div>`,
    );
  }
  if (recovery?.summary?.itemCount > 0) {
    parts.push(
      `<section class="recovery"><strong>Recovery review required</strong> · ${escapeHtml(recovery.summary.itemCount)} item(s), ${escapeHtml(recovery.summary.criticalCount)} critical, ${escapeHtml(recovery.summary.timedOutCount)} timed out<div class="muted">plan ${escapeHtml(String(recovery.planDigest || "").slice(0, 24))}… · startup scan never mutates unattended</div>`,
    );
    for (const item of recovery.items || []) {
      const decision = item.recommendedDecision;
      const mutable = decision === "retry" || decision === "delete-orphan";
      parts.push(
        `<div class="recovery-item">${escapeHtml(item.severity)} · ${escapeHtml(item.kind)}${item.timedOut ? " · timed out" : ""}<button class="sec" data-recovery="${escapeHtml(decision)}" data-item="${escapeHtml(item.itemId)}">${mutable ? escapeHtml(decision) : "Acknowledge"}</button></div>`,
      );
    }
    parts.push("</section>");
  }
  if (history) {
    parts.push(
      `<div class="muted history-summary">Verified history: ${escapeHtml(history.totalEventCount || 0)} event(s)${history.truncated ? " · showing latest 200" : ""}</div>`,
    );
  }
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    parts.push(
      '<p class="muted">No artifacts. Agents publish deliverables with the publish_artifact tool.</p>',
    );
    return parts.join("");
  }
  const body = list
    .map((r) => {
      const acts = (r.actions || [])
        .map(
          (a) =>
            `<button class="${a === "preview" || a === "openExternal" ? "" : "sec"}" data-act="${escapeHtml(a)}" data-id="${escapeHtml(r.id)}">${ACTION_LABELS[a] || escapeHtml(a)}</button>`,
        )
        .join("");
      const meta = [
        r.id,
        r.sessionId ? `session ${r.sessionId}` : "",
        r.returnedResult?.requestId
          ? `returned ${r.returnedResult.kind} · request ${r.returnedResult.requestId}`
          : "",
        r.returnedResult?.reviewDigest
          ? `review ${r.returnedResult.reviewDigest.slice(0, 20)}…`
          : "",
        r.recordDigest ? `record ${r.recordDigest.slice(0, 20)}…` : "",
        r.history?.accessCount
          ? `${r.history.accessCount} audited access${r.history.accessCount === 1 ? "" : "es"}`
          : "",
        r.sha256 ? `sha256 ${r.sha256.slice(0, 12)}…` : "",
      ]
        .filter(Boolean)
        .map(escapeHtml);
      return (
        `<tr><td><span class="kind">${escapeHtml(r.kindIcon)} ${escapeHtml(r.kindLabel)}</span></td>` +
        `<td>${escapeHtml(r.title)}<div class="muted">${meta.join(" · ")}</div></td>` +
        `<td>${escapeHtml(r.mime)}</td>` +
        `<td>${escapeHtml(r.sizeLabel)}</td>` +
        `<td>${escapeHtml(formatRelativeTime(r.createdAt, now))}</td>` +
        `<td>${acts}</td></tr>`
      );
    })
    .join("");
  parts.push(
    '<table><thead><tr><th style="width:110px">kind</th><th>artifact</th><th style="width:130px">mime</th><th style="width:70px">size</th><th style="width:90px">created</th><th style="width:330px">actions</th></tr></thead><tbody>' +
      body +
      "</tbody></table>",
  );
  return parts.join("");
}

module.exports = {
  ARTIFACT_KINDS,
  ARTIFACT_KIND_META,
  ACTION_LABELS,
  buildArtifactsListArgs,
  buildArtifactsWorkbenchArgs,
  buildArtifactsShowArgs,
  buildArtifactsAccessArgs,
  buildArtifactsRemoveArgs,
  buildArtifactsRecoveryAdjudicateArgs,
  defaultArtifactsDir,
  formatSize,
  previewKindForMime,
  deriveArtifactActions,
  shapeArtifact,
  shapeArtifacts,
  shapeArtifactWorkbench,
  filterArtifacts,
  escapeHtml,
  renderArtifactsHtml,
};
