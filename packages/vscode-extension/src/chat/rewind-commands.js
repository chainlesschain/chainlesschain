/**
 * Panel `/rewind` (checkpoint restore) — Claude-Code parity for rolling the
 * work tree back to an agent auto-checkpoint. Rather than re-implement the
 * shadow-commit engine in the extension, this defers to the CLI's source of
 * truth — `cc checkpoint list|restore` — scoped to THIS panel's session
 * (mirroring how /cost and /sessions defer to the CLI). Pure Node;
 * `deps.execFile` is injectable. chat-view.js drives the QuickPick around it.
 */
const { execFile } = require("child_process");
const { hardenedEnv } = require("../hardened-env");

/** `cc checkpoint list -s <session> --json` — newest-first snapshots. */
function buildListArgs(sessionId) {
  return ["checkpoint", "list", "-s", String(sessionId || "default"), "--json"];
}

/**
 * `cc checkpoint restore <id> -s <session> --force --json` — auto-snapshots
 * the current state first, then restores. `--force` skips the CLI's own
 * interactive confirm because the panel confirms via its QuickPick selection.
 */
function buildRestoreArgs(sessionId, id) {
  return [
    "checkpoint",
    "restore",
    String(id || ""),
    "-s",
    String(sessionId || "default"),
    "--force",
    "--json",
  ];
}

/**
 * Run a CLI command and resolve `{ ok, data }` (stdout parsed as JSON) or
 * `{ ok:false, error }`. Never rejects — the caller renders a fallback.
 */
function runCliJson({
  command = "cc",
  args,
  cwd,
  env,
  timeoutMs = 30000,
  deps,
} = {}) {
  const run = (deps && deps.execFile) || execFile;
  return new Promise((resolve) => {
    run(
      command,
      args,
      {
        cwd,
        // Hardened so cmd.exe doesn't resolve a repo-local `cc.bat` before PATH.
        env: hardenedEnv(env),
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        // npm global shims on Windows are .cmd files — they need a shell.
        shell: process.platform === "win32",
      },
      (err, stdout, stderr) => {
        const out = String(stdout || "").trim();
        if (out) {
          try {
            return resolve({ ok: true, data: JSON.parse(out) });
          } catch {
            return resolve({ ok: false, error: out });
          }
        }
        resolve({
          ok: false,
          error: String(stderr || (err && err.message) || "no output").trim(),
        });
      },
    );
  });
}

/** A checkpoint row → a VS Code QuickPick item (carrying its id). */
function toQuickPickItem(c) {
  const files =
    c && c.fileCount != null ? `${c.fileCount} file(s)` : "";
  return {
    id: c && c.id,
    label: (c && c.id) || "?",
    description: [c && c.createdAt, files].filter(Boolean).join("  ·  "),
    detail: (c && c.label) || undefined,
  };
}

/** Restored-file count from a `checkpoint restore --json` payload (best-effort). */
function restoredCount(data) {
  if (!data || typeof data !== "object") return null;
  const n = data.restoredCount != null ? data.restoredCount : data.restored;
  return typeof n === "number" ? n : null;
}

module.exports = {
  buildListArgs,
  buildRestoreArgs,
  runCliJson,
  toQuickPickItem,
  restoredCount,
};
