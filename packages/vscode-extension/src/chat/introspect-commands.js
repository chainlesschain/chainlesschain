/**
 * Panel introspection commands `/cost` and `/context` (Claude Code REPL
 * parity). Rather than re-implement pricing / context-window math in the
 * webview, these defer to the CLI's source of truth — `cc cost <id>` and
 * `cc context <id>` — for THIS panel's session, mirroring how `/sessions`
 * defers to `cc session list`. Pure Node; `deps.execFile` is injectable.
 */
const { execFile } = require("child_process");

/**
 * Build CLI args for an introspection command scoped to a session.
 * `cost`    → `cost <id>` (estimated $ + token rollup)
 * `context` → `context <id> [--model m] [--provider p]` (window usage)
 */
function buildIntrospectArgs(kind, sessionId, { model, provider } = {}) {
  const id = String(sessionId || "").trim();
  if (kind === "cost") return ["cost", id];
  const args = ["context", id];
  if (model && String(model).trim()) args.push("--model", String(model).trim());
  if (provider && String(provider).trim()) {
    args.push("--provider", String(provider).trim());
  }
  return args;
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
  return new Promise((resolve) => {
    run(
      command,
      args,
      {
        cwd,
        env: env || process.env,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        // npm global shims on Windows are .cmd files — they need a shell.
        shell: process.platform === "win32",
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

module.exports = { buildIntrospectArgs, runCliText };
