/**
 * Inline code completion (ghost-text) — manual-trigger v1.
 *
 * A VS Code InlineCompletionItemProvider that, ONLY when explicitly invoked
 * (the `chainlesschain.complete.trigger` keybinding → the built-in inline
 * trigger), sends the code around the caret to `cc complete --json` and renders
 * the returned text as a ghost suggestion. Automatic (per-keystroke) triggers
 * are ignored, so there is no per-keystroke LLM traffic — matching the "manual,
 * reuse the configured LLM" design.
 *
 * The pure helpers (context extraction, response parsing) and the stdin-piping
 * spawn are exported and vscode-free for unit testing; `createInlineCompletionProvider`
 * takes `vscode` + resolver callbacks injected so the provider object is testable
 * with a fake vscode.
 */
const { spawn } = require("child_process");
const { hardenedEnv } = require("./hardened-env");

/** Per-side context budget: keep the FIM prompt bounded on huge files. */
const CONTEXT_CHARS = 4000;

/**
 * Slice the prefix/suffix around a caret offset, each capped to `maxChars`, and
 * pair them with the document language id — the request `cc complete` consumes.
 */
function extractContext(
  fullText,
  offset,
  languageId,
  maxChars = CONTEXT_CHARS,
) {
  const text = String(fullText || "");
  const o = Math.max(0, Math.min(Number(offset) || 0, text.length));
  return {
    prefix: text.slice(Math.max(0, o - maxChars), o),
    suffix: text.slice(o, o + maxChars),
    language: languageId || "",
  };
}

/** Read `{completion}` from `cc complete --json` stdout; "" on any bad shape. */
function parseCompletionResponse(stdout) {
  try {
    const data = JSON.parse(String(stdout || ""));
    return data && typeof data.completion === "string" ? data.completion : "";
  } catch {
    return "";
  }
}

/** Hard cap so a runaway model can't flood the editor with a whole file. */
const MAX_COMPLETION_CHARS = 2000;

/**
 * Defensive clean of the completion text: strip an accidental markdown fence,
 * drop any echoed `<CURSOR>` sentinel, hard-cap the length, and trim TRAILING
 * whitespace only (leading indentation is meaningful). The CLI already cleans
 * (complete.js cleanCompletion) — this guards against a future/alternate
 * backend, mirroring the JetBrains twin's CcCompletion.cleanCompletion.
 */
function cleanCompletion(raw) {
  if (!raw) return "";
  let s = String(raw);
  s = s.replace(/^\s*```[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
  s = s.replace(/<CURSOR>/g, "");
  if (s.length > MAX_COMPLETION_CHARS) s = s.slice(0, MAX_COMPLETION_CHARS);
  return s.replace(/\s+$/, "");
}

/**
 * Spawn `cc complete --json`, pipe the request as JSON on stdin, resolve the
 * completion string. Never rejects — resolves "" on spawn error / timeout / bad
 * output, so a backend hiccup yields no suggestion rather than a thrown error.
 */
function spawnComplete({
  command,
  request,
  cwd,
  env,
  timeoutMs = 12000,
  token,
  deps,
} = {}) {
  const spawnFn = (deps && deps.spawn) || spawn;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(command || "cc", ["complete", "--json"], {
        cwd,
        env: hardenedEnv(env),
        windowsHide: true,
        // npm global shims on Windows are .cmd files — they need a shell.
        shell: process.platform === "win32",
      });
    } catch {
      resolve("");
      return;
    }
    let out = "";
    let done = false;
    let exited = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        cancelSub?.dispose?.();
      } catch {
        /* best-effort */
      }
      // Cancel/timeout with the child still alive: on Windows the child is a
      // cmd.exe wrapper (shell:true for the .cmd shim), so a plain kill()
      // orphans the real cc/node grandchild, which runs the full LLM call to
      // completion anyway — burning tokens — and holds the better_sqlite3
      // lock. taskkill /T reaps the tree (same pattern as agent-session.js).
      if (!exited) {
        if (child.pid && process.platform === "win32") {
          try {
            const killFn = (deps && deps.treeKill) || spawn;
            killFn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
              windowsHide: true,
            });
          } catch {
            /* fall through to child.kill */
          }
        }
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(""), timeoutMs);
    // Cancellation kills the in-flight child instead of letting it run the
    // full LLM call to completion for a result nobody will render (the user
    // typed on / dismissed — VS Code cancels the previous provider call).
    let cancelSub = null;
    if (token && typeof token.onCancellationRequested === "function") {
      if (token.isCancellationRequested) {
        finish("");
        return;
      }
      cancelSub = token.onCancellationRequested(() => finish(""));
    }
    if (child.stdout)
      child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.on("error", () => finish(""));
    child.on("close", () => {
      exited = true;
      finish(cleanCompletion(parseCompletionResponse(out)));
    });
    if (child.stdin) {
      // stdin can emit EPIPE if the child dies as we write — swallow it.
      child.stdin.on("error", () => {});
      try {
        child.stdin.write(JSON.stringify(request || {}));
        child.stdin.end();
      } catch {
        /* child gone — close/error handler resolves */
      }
    }
  });
}

/**
 * Build the InlineCompletionItemProvider. Manual-only: it returns a suggestion
 * only for an explicit Invoke trigger, never on automatic typing.
 * @param vscode        the (real or fake) vscode module
 * @param getCommand    () => resolved cc binary/path
 * @param getCwd        (document) => cwd for the spawn (workspace root)
 * @param isEnabled     () => whether ghost-text is turned on (setting)
 */
function createInlineCompletionProvider({
  vscode,
  getCommand,
  getCwd,
  isEnabled,
  runComplete,
}) {
  const run = runComplete || spawnComplete;
  return {
    async provideInlineCompletionItems(document, position, context, token) {
      if (isEnabled && !isEnabled()) return undefined;
      // Ignore automatic (per-keystroke) triggers — manual invoke only.
      if (
        context &&
        context.triggerKind !== vscode.InlineCompletionTriggerKind.Invoke
      ) {
        return undefined;
      }
      const offset = document.offsetAt(position);
      const request = extractContext(
        document.getText(),
        offset,
        document.languageId,
      );
      if (!request.prefix && !request.suffix) return undefined;

      const completion = await run({
        command: getCommand ? getCommand() : "cc",
        request,
        cwd: getCwd ? getCwd(document) : undefined,
        // The spawn kills the child when this call is superseded/dismissed.
        token,
      });
      if (!completion || (token && token.isCancellationRequested))
        return undefined;

      const item = new vscode.InlineCompletionItem(
        completion,
        new vscode.Range(position, position),
      );
      return { items: [item] };
    },
  };
}

module.exports = {
  CONTEXT_CHARS,
  MAX_COMPLETION_CHARS,
  cleanCompletion,
  extractContext,
  parseCompletionResponse,
  spawnComplete,
  createInlineCompletionProvider,
};
