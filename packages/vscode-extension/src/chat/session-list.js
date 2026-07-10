/**
 * Session listing for the chat panel's picker — asks the CLI
 * (`cc session list --json`) instead of re-implementing the home-dir / store
 * resolution (CHAINLESSCHAIN_HOME vs %APPDATA% is a known divergence trap).
 * Pure Node; `deps.execFile` is injectable for tests.
 */
const { execFile } = require("child_process");
const { hardenedEnv } = require("../hardened-env");
const { readIdeSessionIndex, toSessionItems } = require("./ide-session-index");

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

function mergeSessionItems(cliItems = [], ideItems = []) {
  const byId = new Map();
  for (const item of cliItems) {
    if (item?.id) byId.set(item.id, { ...item });
  }
  for (const item of ideItems) {
    if (!item?.id) continue;
    const prev = byId.get(item.id);
    byId.set(item.id, {
      ...(prev || {}),
      ...item,
      title: item.title || prev?.title || "",
      updatedAt: item.updatedAt || prev?.updatedAt || null,
      store: prev ? `${prev.store}+${item.store}` : item.store,
    });
  }
  return [...byId.values()].sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
  );
}

/**
 * Run `cc session list --json -n <limit>` and return parsed items
 * (empty array on any failure — the picker just says "no sessions").
 */
function listSessions({
  command = "cc",
  limit = 30,
  cwd,
  env,
  deps,
  includeIdeIndex = false,
  indexFile,
} = {}) {
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
        const cliItems = err ? [] : parseSessionList(stdout);
        if (!includeIdeIndex) return resolve(cliItems);
        const ideItems = toSessionItems(
          readIdeSessionIndex({ file: indexFile }),
        );
        resolve(mergeSessionItems(cliItems, ideItems).slice(0, limit));
      },
    );
  });
}

/** {@code cc session delete <id> --force} — force skips the interactive confirm. */
function buildDeleteArgs(id) {
  return ["session", "delete", String(id), "--force"];
}

/**
 * Delete a CLI-stored session. Resolves false on any failure (e.g. the id only
 * ever lived in the IDE index) — callers still prune the IDE index themselves.
 */
function deleteCliSession({ command = "cc", id, cwd, env, deps } = {}) {
  const run = deps?.execFile || execFile;
  return new Promise((resolve) => {
    if (!id) return resolve(false);
    run(
      command,
      buildDeleteArgs(id),
      {
        cwd,
        env: hardenedEnv(env),
        timeout: 30000,
        windowsHide: true,
        shell: process.platform === "win32",
      },
      (err) => resolve(!err),
    );
  });
}

module.exports = {
  buildDeleteArgs,
  deleteCliSession,
  mergeSessionItems,
  parseSessionList,
  listSessions,
};
