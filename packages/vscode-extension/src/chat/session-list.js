/**
 * Session listing for the chat panel's picker — asks the CLI
 * (`cc session list --json`) instead of re-implementing the home-dir / store
 * resolution (CHAINLESSCHAIN_HOME vs %APPDATA% is a known divergence trap).
 * Pure Node; `deps.execFile` is injectable for tests.
 */
const { execFile } = require("child_process");
const { hardenedEnv } = require("../hardened-env");

/** Tolerant parse of `cc session list --json` output. */
function parseSessionList(stdout) {
  let arr;
  try {
    arr = JSON.parse(String(stdout || "").trim());
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s) => s && typeof s.id === "string" && s.id)
    .map((s) => ({
      id: s.id,
      title: typeof s.title === "string" ? s.title : "",
      updatedAt: s.updated_at || s.updatedAt || null,
      store: s._store === "jsonl" ? "agent" : "chat",
    }));
}

/**
 * Run `cc session list --json -n <limit>` and return parsed items
 * (empty array on any failure — the picker just says "no sessions").
 */
function listSessions({ command = "cc", limit = 30, cwd, env, deps } = {}) {
  const run = deps?.execFile || execFile;
  return new Promise((resolve) => {
    run(
      command,
      ["session", "list", "--json", "-n", String(limit)],
      {
        cwd,
        // Hardened so cmd.exe doesn't resolve a repo-local `cc.bat` before PATH.
        env: hardenedEnv(env),
        timeout: 30000,
        windowsHide: true,
        // npm global shims on Windows are .cmd files — they need a shell.
        shell: process.platform === "win32",
      },
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(parseSessionList(stdout));
      },
    );
  });
}

module.exports = { parseSessionList, listSessions };
