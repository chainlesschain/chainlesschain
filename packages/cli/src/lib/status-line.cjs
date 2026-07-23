"use strict";

/**
 * status-line — Claude-Code `statusLine` parity. A user command rendered into
 * a status line shown above the REPL prompt each turn (model / branch / cost /
 * whatever the script prints).
 *
 * Config lives in the `.claude/settings.json` hierarchy under `statusLine`:
 *   { "statusLine": { "type": "command", "command": "~/.claude/status.sh" } }
 * (a bare string is also accepted as the command). The command receives a JSON
 * context on stdin — `{ session_id, model:{id}, workspace:{current_dir,
 * project_dir}, cwd }` — and its first stdout line becomes the status line.
 *
 * Best-effort throughout: a missing config, a broken command, or a timeout just
 * yields no status line — it never blocks or breaks the REPL. `_deps` injection
 * (process runner / settings reader) for tests.
 */

const path = require("node:path");
const { settingsPaths, readSettingsFile } = require("./settings-loader.cjs");

const _deps = {
  runProcess: null,
  // injectable so tests don't touch real settings files
  readSettings: (cwd, settingsFile) => {
    const out = [];
    for (const file of settingsPaths(cwd, settingsFile)) {
      const data = readSettingsFile(file);
      if (data) out.push(data);
    }
    return out;
  },
};

/**
 * Load the effective `statusLine` config (last layer wins). Returns
 * `{ command, type, padding }` or null.
 */
function loadStatusLineConfig({ cwd = process.cwd(), settingsFile } = {}) {
  let cfg = null;
  for (const data of _deps.readSettings(cwd, settingsFile)) {
    if (!data || data.statusLine == null) continue;
    const sl = data.statusLine;
    if (typeof sl === "string" && sl.trim()) {
      cfg = { type: "command", command: sl.trim(), padding: 0 };
    } else if (sl && typeof sl === "object" && typeof sl.command === "string") {
      cfg = {
        type: sl.type || "command",
        command: sl.command,
        // Clamp to [0,80]: a non-finite/huge padding (e.g. "1e999" → Infinity,
        // or 999999999) would make " ".repeat(padding) at render time throw
        // RangeError on every REPL prompt, bricking the status line.
        padding: Math.max(0, Math.min(80, Math.floor(Number(sl.padding)) || 0)),
      };
    } else if (sl === false || sl === null) {
      cfg = null; // an explicit disable in a higher layer wins
    }
  }
  return cfg && cfg.command ? cfg : null;
}

/**
 * Build the JSON context handed to the status-line command on stdin (and used
 * by the built-in renderer). Carries context-window usage so a custom command —
 * or the built-in line — can show how full the window is. Additive: the prior
 * fields are unchanged; `context` + `turn` are new.
 */
function buildContext({
  sessionId,
  model,
  provider,
  cwd,
  projectDir,
  usedTokens = 0,
  contextWindow = 0,
  turn = 0,
} = {}) {
  const used = Math.max(0, Number(usedTokens) || 0);
  const window = Math.max(0, Number(contextWindow) || 0);
  const pct = window > 0 ? Math.min(100, Math.round((used / window) * 100)) : 0;
  return {
    hook_event_name: "Status",
    session_id: sessionId || null,
    model: { id: model || null, display_name: model || null },
    provider: provider || null,
    workspace: {
      current_dir: cwd || process.cwd(),
      project_dir: projectDir || cwd || process.cwd(),
    },
    cwd: cwd || process.cwd(),
    context: { used_tokens: used, window, pct },
    turn: Math.max(0, Number(turn) || 0),
  };
}

/** Compact a token count: 950 → "950", 12345 → "12.3k", 1500000 → "1.5M". */
function formatTokens(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(Math.max(0, Math.round(v)));
  if (v < 1_000_000) {
    const k = v / 1000;
    return (k >= 100 ? Math.round(k) : Number(k.toFixed(1))) + "k";
  }
  return Number((v / 1_000_000).toFixed(1)) + "M";
}

/**
 * Resolve the terminal size to advertise to the status-line command, as
 * positive integers or null. Explicit `columns`/`rows` options win (testing /
 * non-REPL callers); otherwise the live `process.stdout` dimensions are used.
 * Non-TTY (piped) stdout has no dimensions → null (env var simply omitted).
 */
function terminalSize({ columns, rows } = {}) {
  const out = process.stdout || {};
  const cols = Number.isFinite(columns) ? columns : out.columns;
  const rws = Number.isFinite(rows) ? rows : out.rows;
  return {
    columns: Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : null,
    rows: Number.isFinite(rws) && rws > 0 ? Math.floor(rws) : null,
  };
}

/** Home-relative compact path: the home dir collapses to "~". */
function shortenPath(p) {
  const cwd = String(p || "");
  let home = "";
  try {
    home = require("node:os").homedir() || "";
  } catch {
    home = "";
  }
  if (
    home &&
    (cwd === home || cwd.startsWith(home + "/") || cwd.startsWith(home + "\\"))
  ) {
    return "~" + cwd.slice(home.length);
  }
  return cwd;
}

/**
 * Built-in context-usage line shown when no custom `statusLine` command is
 * configured: "model · ⛁ used/window (pct%) · cwd · turn N". No color — the
 * caller dims it. Returns "" when there's genuinely nothing to show.
 */
function renderDefaultStatusLine(context = {}) {
  const c = context.context || {};
  const parts = [];
  if (context.model && context.model.id) parts.push(context.model.id);
  if (c.window > 0) {
    parts.push(
      `⛁ ${formatTokens(c.used_tokens)}/${formatTokens(c.window)} (${c.pct}%)`,
    );
  } else if (c.used_tokens > 0) {
    parts.push(`⛁ ${formatTokens(c.used_tokens)}`);
  }
  if (context.cwd) parts.push(shortenPath(context.cwd));
  if (context.turn) parts.push(`turn ${context.turn}`);
  return parts.join("  ·  ");
}

/**
 * Whether the user explicitly disabled the status line via `statusLine: false`
 * in the effective (last-layer-wins) settings. Lets the REPL suppress even the
 * built-in line, while a mere absence of config still shows the built-in.
 */
function isStatusLineDisabled({ cwd = process.cwd(), settingsFile } = {}) {
  let disabled = false;
  for (const data of _deps.readSettings(cwd, settingsFile)) {
    if (!data || !("statusLine" in data)) continue;
    disabled = data.statusLine === false;
  }
  return disabled;
}

/**
 * Render the status line by running the command with the JSON context on stdin.
 * Returns the first stdout line (trimmed, ANSI preserved) or null.
 */
function renderStatusLine(
  config,
  context = {},
  { cwd, timeout = 5000, columns, rows, runProcess } = {},
) {
  if (!config || !config.command) return null;
  // Claude-Code parity (2.1.153): hand the command the terminal width/height so
  // a script can right-size its output. process.env is spread first so the
  // command (run via shell) keeps PATH etc.; COLUMNS/LINES are only added when
  // a real size is known (TTY) so a non-TTY run doesn't fake a width.
  const { columns: cols, rows: rws } = terminalSize({ columns, rows });
  const env = { ...process.env };
  if (cols != null) env.COLUMNS = String(cols);
  if (rws != null) env.LINES = String(rws);
  let res;
  try {
    const runner = runProcess || _deps.runProcess;
    if (typeof runner !== "function") return null;
    res = runner(config.command, [], {
      input: JSON.stringify(context),
      cwd: cwd || process.cwd(),
      env,
      encoding: "utf-8",
      timeout,
      shell: true,
      maxBuffer: 1024 * 1024,
      origin: "status-line:command",
      policy: "allow",
      scope: "status-line",
    });
  } catch {
    return null; // spawn failure → no status line
  }
  if (res.error || res.status !== 0) return null;
  const out = String(res.stdout || "");
  const firstLine = out.split(/\r?\n/)[0];
  const line = (firstLine || "").trim();
  if (!line) return null;
  const pad = config.padding > 0 ? " ".repeat(config.padding) : "";
  return pad + line;
}

/** Convenience: load + render in one call (used by the REPL each turn). */
function getStatusLine({
  cwd,
  settingsFile,
  sessionId,
  model,
  provider,
  projectDir,
  timeout,
  columns,
  rows,
  runProcess,
} = {}) {
  const config = loadStatusLineConfig({ cwd, settingsFile });
  if (!config) return null;
  const context = buildContext({ sessionId, model, provider, cwd, projectDir });
  return renderStatusLine(config, context, {
    cwd,
    timeout,
    columns,
    rows,
    runProcess,
  });
}

module.exports = {
  loadStatusLineConfig,
  buildContext,
  renderStatusLine,
  getStatusLine,
  formatTokens,
  shortenPath,
  renderDefaultStatusLine,
  isStatusLineDisabled,
  terminalSize,
  _deps,
};
