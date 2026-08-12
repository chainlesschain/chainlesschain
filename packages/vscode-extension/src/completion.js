/**
 * Inline code completion (ghost-text) — manual plus governed automatic mode.
 *
 * A VS Code InlineCompletionItemProvider that always supports the explicit
 * `chainlesschain.complete.trigger` action and, when separately opted in,
 * sends a debounced, budgeted caret context to `cc complete --json`.
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

const DEFAULT_AUTO_OPTIONS = Object.freeze({
  debounceMs: 650,
  cacheTtlMs: 30_000,
  cacheEntries: 64,
  maxRequestsPerHour: 60,
  maxContextCharsPerHour: 240_000,
  maxCompletionChars: 800,
  maxCompletionLines: 12,
});

const AUTO_COMPLETION_SLO = Object.freeze({
  p50Ms: 2_000,
  p95Ms: 5_000,
  minimumSamples: 20,
});

function clampInteger(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.max(min, Math.min(max, Math.trunc(n)))
    : fallback;
}

function normalizeAutoOptions(value = {}) {
  return {
    debounceMs: clampInteger(value.debounceMs, 650, 100, 3_000),
    cacheTtlMs: clampInteger(value.cacheTtlMs, 30_000, 1_000, 300_000),
    cacheEntries: clampInteger(value.cacheEntries, 64, 1, 256),
    maxRequestsPerHour: clampInteger(value.maxRequestsPerHour, 60, 1, 10_000),
    maxContextCharsPerHour: clampInteger(
      value.maxContextCharsPerHour,
      240_000,
      1_000,
      10_000_000,
    ),
    maxCompletionChars: clampInteger(
      value.maxCompletionChars,
      800,
      32,
      MAX_COMPLETION_CHARS,
    ),
    maxCompletionLines: clampInteger(value.maxCompletionLines, 12, 1, 100),
  };
}

function completionKey(request) {
  return JSON.stringify([
    request?.language || "",
    request?.prefix || "",
    request?.suffix || "",
  ]);
}

function waitForDebounce(ms, token, deps = {}) {
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;
  return new Promise((resolve) => {
    if (token?.isCancellationRequested) {
      resolve(false);
      return;
    }
    let settled = false;
    let cancelSub = null;
    let timer = null;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      cancelSub?.dispose?.();
      resolve(ready);
    };
    timer = setTimer(() => finish(true), ms);
    cancelSub = token?.onCancellationRequested?.(() => finish(false));
  });
}

function isAutomaticContextEligible(request) {
  const prefix = request?.prefix || "";
  if (!prefix || /\s$/.test(prefix)) return false;
  const lastLine = prefix.slice(prefix.lastIndexOf("\n") + 1);
  return lastLine.trim().length >= 2;
}

function isAutomaticCompletionUsable(completion, request, options) {
  if (!completion) return false;
  if (completion.length > options.maxCompletionChars) return false;
  if (completion.split(/\r?\n/).length > options.maxCompletionLines)
    return false;
  const suffix = request?.suffix || "";
  if (suffix && suffix.startsWith(completion)) return false;
  return !/^\s*(?:here(?:'s| is)|explanation:|```)/i.test(completion);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}

class AutomaticCompletionPolicy {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.usage = [];
    this.cache = new Map();
    this.inFlight = new Set();
    this.latencies = [];
    this.metrics = {
      requests: 0,
      cacheHits: 0,
      dedupeHits: 0,
      budgetRejects: 0,
      qualityRejects: 0,
      sloRejects: 0,
      cancellations: 0,
    };
  }

  prune(options) {
    const now = this.now();
    const cutoff = now - 3_600_000;
    this.usage = this.usage.filter((entry) => entry.at >= cutoff);
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    while (this.cache.size > options.cacheEntries) {
      this.cache.delete(this.cache.keys().next().value);
    }
  }

  cached(key, options) {
    this.prune(options);
    const entry = this.cache.get(key);
    if (!entry) return "";
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.metrics.cacheHits++;
    return entry.value;
  }

  reserve(contextChars, options) {
    this.prune(options);
    const chars = this.usage.reduce((sum, entry) => sum + entry.chars, 0);
    if (
      this.usage.length >= options.maxRequestsPerHour ||
      chars + contextChars > options.maxContextCharsPerHour
    ) {
      this.metrics.budgetRejects++;
      return false;
    }
    this.usage.push({ at: this.now(), chars: contextChars });
    this.metrics.requests++;
    return true;
  }

  begin(key) {
    if (this.inFlight.has(key)) {
      this.metrics.dedupeHits++;
      return false;
    }
    this.inFlight.add(key);
    return true;
  }

  end(key) {
    this.inFlight.delete(key);
  }

  recordLatency(latencyMs) {
    const latency = Math.max(0, Math.round(latencyMs));
    this.latencies.push(latency);
    if (this.latencies.length > 200) this.latencies.shift();
    if (latency > AUTO_COMPLETION_SLO.p95Ms) {
      this.metrics.sloRejects++;
      return false;
    }
    return true;
  }

  store(key, value, options) {
    this.cache.set(key, { value, expiresAt: this.now() + options.cacheTtlMs });
    this.prune(options);
  }

  snapshot() {
    const p50Ms = percentile(this.latencies, 0.5);
    const p95Ms = percentile(this.latencies, 0.95);
    const sloEvaluable =
      this.latencies.length >= AUTO_COMPLETION_SLO.minimumSamples;
    return {
      ...this.metrics,
      p50Ms,
      p95Ms,
      samples: this.latencies.length,
      sloTargetP50Ms: AUTO_COMPLETION_SLO.p50Ms,
      sloTargetP95Ms: AUTO_COMPLETION_SLO.p95Ms,
      sloEvaluable,
      sloMet:
        sloEvaluable &&
        p50Ms <= AUTO_COMPLETION_SLO.p50Ms &&
        p95Ms <= AUTO_COMPLETION_SLO.p95Ms,
    };
  }
}

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
  isAutomaticEnabled,
  getAutomaticOptions,
  runComplete,
  autoPolicy,
  now,
  onMetrics,
  deps,
}) {
  const run = runComplete || spawnComplete;
  const policy = autoPolicy || new AutomaticCompletionPolicy({ now });
  return {
    async provideInlineCompletionItems(document, position, context, token) {
      if (isEnabled && !isEnabled()) return undefined;
      const automatic =
        context?.triggerKind === vscode.InlineCompletionTriggerKind.Automatic;
      if (automatic && !(isAutomaticEnabled && isAutomaticEnabled()))
        return undefined;
      const offset = document.offsetAt(position);
      const request = extractContext(
        document.getText(),
        offset,
        document.languageId,
      );
      if (!request.prefix && !request.suffix) return undefined;

      let key = "";
      let options = null;
      let startedAt = 0;
      if (automatic) {
        options = normalizeAutoOptions(getAutomaticOptions?.());
        if (!isAutomaticContextEligible(request)) return undefined;
        key = completionKey(request);
        const cached = policy.cached(key, options);
        if (cached) return completionItems(vscode, cached, position);
        // User-visible latency includes the quiet period as well as the
        // backend request.
        startedAt = (now || Date.now)();
        const ready = await waitForDebounce(options.debounceMs, token, deps);
        if (!ready) {
          policy.metrics.cancellations++;
          onMetrics?.(policy.snapshot());
          return undefined;
        }
        // A matching request may have populated the cache during our debounce.
        const postDebounceCached = policy.cached(key, options);
        if (postDebounceCached)
          return completionItems(vscode, postDebounceCached, position);
        // The platform normally cancels superseded provider calls. Keep an
        // explicit exact-context guard as well so host scheduling races never
        // create duplicate model requests.
        if (!policy.begin(key)) {
          onMetrics?.(policy.snapshot());
          return undefined;
        }
        const contextChars = request.prefix.length + request.suffix.length;
        if (!policy.reserve(contextChars, options)) {
          policy.end(key);
          onMetrics?.(policy.snapshot());
          return undefined;
        }
      }

      let completion = "";
      try {
        completion = await run({
          command: getCommand ? getCommand() : "cc",
          request,
          cwd: getCwd ? getCwd(document) : undefined,
          timeoutMs: automatic
            ? Math.max(100, AUTO_COMPLETION_SLO.p95Ms - options.debounceMs)
            : 12_000,
          // The spawn kills the child when this call is superseded/dismissed.
          token,
        });
      } catch {
        // Alternate/injected backends must preserve the production adapter's
        // fail-quiet contract as well.
        return undefined;
      } finally {
        if (automatic) policy.end(key);
      }
      if (automatic) {
        if (token && token.isCancellationRequested) {
          policy.metrics.cancellations++;
          onMetrics?.(policy.snapshot());
          return undefined;
        }
        const withinSlo = policy.recordLatency((now || Date.now)() - startedAt);
        if (!withinSlo) {
          onMetrics?.(policy.snapshot());
          return undefined;
        }
      }
      if (token && token.isCancellationRequested) return undefined;
      if (!completion) return undefined;
      if (automatic) {
        if (!isAutomaticCompletionUsable(completion, request, options)) {
          policy.metrics.qualityRejects++;
          onMetrics?.(policy.snapshot());
          return undefined;
        }
        policy.store(key, completion, options);
        onMetrics?.(policy.snapshot());
      }
      return completionItems(vscode, completion, position);
    },
    getAutomaticMetrics: () => policy.snapshot(),
  };
}

function completionItems(vscode, completion, position) {
  const item = new vscode.InlineCompletionItem(
    completion,
    new vscode.Range(position, position),
  );
  return { items: [item] };
}

module.exports = {
  AUTO_COMPLETION_SLO,
  CONTEXT_CHARS,
  DEFAULT_AUTO_OPTIONS,
  MAX_COMPLETION_CHARS,
  AutomaticCompletionPolicy,
  cleanCompletion,
  completionKey,
  extractContext,
  isAutomaticCompletionUsable,
  isAutomaticContextEligible,
  normalizeAutoOptions,
  parseCompletionResponse,
  waitForDebounce,
  spawnComplete,
  createInlineCompletionProvider,
};
