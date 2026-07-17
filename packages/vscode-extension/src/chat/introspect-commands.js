/**
 * Panel introspection commands `/cost` and `/context` (Claude Code REPL
 * parity). Rather than re-implement pricing / context-window math in the
 * webview, these defer to the CLI's source of truth — `cc cost <id>` and
 * `cc context <id>` — for THIS panel's session, mirroring how `/sessions`
 * defers to `cc session list`. Pure Node; `deps.execFile` is injectable.
 */
const { execFile } = require("child_process");
const { hardenedEnv } = require("../hardened-env");
const { escapeCmdArgs } = require("../win-shell");

/**
 * Build CLI args for an introspection command scoped to a session.
 * `cost`    → `cost <id>` (estimated $ + token rollup)
 * `context` → `context <id> [--model m] [--provider p]` (window usage)
 */
function buildIntrospectArgs(kind, sessionId, { model, provider, json } = {}) {
  const id = String(sessionId || "").trim();
  if (kind === "cost") return ["cost", id];
  const args = ["context", id];
  if (model && String(model).trim()) args.push("--model", String(model).trim());
  if (provider && String(provider).trim()) {
    args.push("--provider", String(provider).trim());
  }
  if (json) args.push("--json");
  return args;
}

/**
 * Parse `cc context --json` stdout into the compact status the persistent panel
 * indicator renders. Returns null when the text is not the expected JSON or is
 * missing the window/total fields (caller then leaves the indicator unchanged).
 * Shape from the CLI: { contextWindow, totalTokens, overflows, … }.
 */
function parseContextStatus(text) {
  let data;
  try {
    data = JSON.parse(String(text || ""));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const total = Number(data.totalTokens);
  const window = Number(data.contextWindow);
  if (!Number.isFinite(total) || !Number.isFinite(window) || window <= 0) {
    return null;
  }
  const pct = Math.round((total / window) * 100);
  return {
    total,
    window,
    pct,
    overflow: data.overflows === true || total > window,
  };
}

/**
 * Derive the context-window status locally from the LAST LLM call's usage
 * (a `token_usage` event): that call's prompt + completion size IS the live
 * context size, so once the window size is known (one `cc context --json`
 * probe, cached per model) the per-turn indicator needs no CLI spawn at all —
 * on Windows each cold `cc` spawn costs seconds, once per turn. Returns null
 * when the usage/window can't produce a meaningful status (caller falls back
 * to the authoritative CLI probe).
 */
function contextStatusFromUsage(usage, window) {
  if (!usage || typeof usage !== "object") return null;
  const w = Number(window);
  if (!Number.isFinite(w) || w <= 0) return null;
  const total =
    (Number(usage.input_tokens) || 0) +
    (Number(usage.cache_read_input_tokens) || 0) +
    (Number(usage.cache_creation_input_tokens) || 0) +
    (Number(usage.output_tokens) || 0);
  if (total <= 0) return null;
  return {
    total,
    window: w,
    pct: Math.round((total / w) * 100),
    overflow: total > w,
  };
}

/**
 * Run a CLI command and resolve its trimmed stdout (or stderr when stdout is
 * empty). Never rejects — resolves "" on a hard failure so the caller renders
 * a fallback. execFile gives plain text (chalk auto-disables off a TTY).
 */
function runCliText({
  command = "cc",
  args,
  cwd,
  env,
  timeoutMs = 30000,
  deps,
} = {}) {
  const run = (deps && deps.execFile) || execFile;
  const useShell = process.platform === "win32";
  return new Promise((resolve) => {
    run(
      command,
      // Under the Windows shell any caller-supplied argv (e.g. Plugin Manager's
      // free-form plugin source/registry) must be cmd-escaped or `&`/`|`/`%`
      // would break the command line or inject a second command.
      useShell ? escapeCmdArgs(args) : args,
      {
        cwd,
        // Hardened so cmd.exe doesn't resolve a repo-local `cc.bat` before PATH.
        env: hardenedEnv(env),
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        // npm global shims on Windows are .cmd files — they need a shell.
        shell: useShell,
      },
      (err, stdout, stderr) => {
        const out = String(stdout || "").trim();
        if (out) return resolve(out);
        const errOut = String(stderr || "").trim();
        resolve(err && !errOut ? "" : errOut);
      },
    );
  });
}

module.exports = {
  buildIntrospectArgs,
  runCliText,
  parseContextStatus,
  contextStatusFromUsage,
};
