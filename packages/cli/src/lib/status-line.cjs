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
 * (spawnSync / settings reader) for tests.
 */

const cpDefault = require("node:child_process");
const path = require("node:path");
const { settingsPaths, readSettingsFile } = require("./settings-loader.cjs");

const _deps = {
  spawnSync: cpDefault.spawnSync,
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
        padding: Number(sl.padding) || 0,
      };
    } else if (sl === false || sl === null) {
      cfg = null; // an explicit disable in a higher layer wins
    }
  }
  return cfg && cfg.command ? cfg : null;
}

/** Build the JSON context handed to the status-line command on stdin. */
function buildContext({ sessionId, model, provider, cwd, projectDir } = {}) {
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
  };
}

/**
 * Render the status line by running the command with the JSON context on stdin.
 * Returns the first stdout line (trimmed, ANSI preserved) or null.
 */
function renderStatusLine(config, context = {}, { cwd, timeout = 5000 } = {}) {
  if (!config || !config.command) return null;
  let res;
  try {
    res = _deps.spawnSync(config.command, {
      input: JSON.stringify(context),
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
      timeout,
      shell: true,
      maxBuffer: 1024 * 1024,
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
function getStatusLine({ cwd, settingsFile, sessionId, model, provider, projectDir, timeout } = {}) {
  const config = loadStatusLineConfig({ cwd, settingsFile });
  if (!config) return null;
  const context = buildContext({ sessionId, model, provider, cwd, projectDir });
  return renderStatusLine(config, context, { cwd, timeout });
}

module.exports = {
  loadStatusLineConfig,
  buildContext,
  renderStatusLine,
  getStatusLine,
  _deps,
};
