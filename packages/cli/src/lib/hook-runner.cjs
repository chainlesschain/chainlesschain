"use strict";

/**
 * hook-runner — execute a Claude-Code `command` hook with the JSON protocol.
 *
 * Protocol (Claude-Code parity):
 *   - the hook event payload is written to the command's STDIN as JSON;
 *   - exit code 2          → BLOCK (reason = stderr) — the canonical "deny" path;
 *   - exit code 0 + JSON stdout → honored decision:
 *       { "decision": "block"|"approve"|"ask", "reason": "..." }
 *       { "hookSpecificOutput": { "permissionDecision": "deny"|"allow"|"ask",
 *                                 "permissionDecisionReason": "..." } }
 *       { "continue": false, "stopReason": "..." }                → block
 *       { "additionalContext": "..." }                            → continue
 *   - any other non-zero   → non-blocking error (surfaced, never blocks);
 *   - spawn failure / timeout → non-blocking (a broken hook must not wedge the
 *                               agent — only an explicit block decision blocks).
 *
 * Returns a normalized `{ decision, reason, exitCode, stdout, stderr, ... }`.
 * `_deps.spawnSync` is injected for unit tests (no real process needed).
 */

const cpDefault = require("node:child_process");
const {
  normalizeShellKind,
  buildPowershellArgv,
  loadShellConfig,
} = require("./shell-selector.cjs");
const { mergeHookDecisions } = require("./hook-event-bus.cjs");

const _deps = { spawnSync: cpDefault.spawnSync, spawn: cpDefault.spawn };

const HOOK_DECISIONS = Object.freeze({
  BLOCK: "block",
  ALLOW: "allow",
  ASK: "ask",
  CONTINUE: "continue",
});

/** JSON.parse that returns undefined (not throws) on failure. */
function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Parse a hook's stdout JSON into a normalized decision, or null if not JSON. */
function tryParseDecision(stdout) {
  const text = String(stdout || "").trim();
  if (!text || text[0] !== "{") return null;
  let obj = tryJson(text);
  if (obj === undefined) {
    // A hook that emits its decision as a JSON line followed by diagnostics
    // (`{"decision":"block"}\n…log lines…`) would fail a whole-text parse, so
    // the documented JSON-to-block pattern would be silently dropped and the
    // tool would proceed. Recover the decision from the first line. (Pure
    // pretty-printed JSON still parses via the whole-text attempt above.)
    const firstLine = text.split("\n", 1)[0].trim();
    if (firstLine && firstLine[0] === "{") obj = tryJson(firstLine);
  }
  if (obj === undefined || obj === null || typeof obj !== "object") return null;
  // PreToolUse-specific permission decision
  const hso = obj.hookSpecificOutput;
  if (hso && hso.permissionDecision) {
    const pd = String(hso.permissionDecision).toLowerCase();
    const decision =
      pd === "deny"
        ? HOOK_DECISIONS.BLOCK
        : pd === "ask"
          ? HOOK_DECISIONS.ASK
          : pd === "allow"
            ? HOOK_DECISIONS.ALLOW
            : HOOK_DECISIONS.CONTINUE;
    return { decision, reason: hso.permissionDecisionReason || null };
  }
  // Generic decision field
  if (obj.decision) {
    const d = String(obj.decision).toLowerCase();
    const decision =
      d === "block" || d === "deny"
        ? HOOK_DECISIONS.BLOCK
        : d === "approve" || d === "allow"
          ? HOOK_DECISIONS.ALLOW
          : d === "ask"
            ? HOOK_DECISIONS.ASK
            : HOOK_DECISIONS.CONTINUE;
    return { decision, reason: obj.reason || null };
  }
  // continue:false → stop/block
  if (obj.continue === false) {
    return {
      decision: HOOK_DECISIONS.BLOCK,
      reason: obj.stopReason || obj.reason || "hook requested stop",
    };
  }
  return {
    decision: HOOK_DECISIONS.CONTINUE,
    reason: null,
    additionalContext: obj.additionalContext || null,
  };
}

/**
 * Run one command hook. `input` is JSON-serialized to the hook's stdin.
 *
 * @param {string} command
 * @param {object} [input]   the hook event payload (tool_name, tool_input, …)
 * @param {object} [opts]    { timeout=60000, cwd, event, shell }
 *                           `shell: "powershell"|"pwsh"` runs the hook through
 *                           PowerShell via explicit argv (P1 #8 — per-hook
 *                           opt-in from the settings hook entry; the shell is
 *                           taken literally, so a missing executable surfaces
 *                           as the usual non-blocking spawn error)
 * @returns {{ decision:string, reason:string|null, exitCode:number|null,
 *            stdout?:string, stderr?:string, additionalContext?:string,
 *            nonBlockingError?:boolean, error?:string }}
 */
// Circuit breaker (gap 2026-07-11 P2 "Hooks 硬化"): N consecutive non-blocking
// failures (spawn error / timeout / non-zero non-2 exit) of the SAME command
// trip an open state — further runs are skipped for a cooldown, then one
// half-open trial runs; success (or a real block/ask decision) closes it.
// CC_HOOK_BREAKER_THRESHOLD=0 disables. Extracted so the sync + async runners
// share ONE breaker implementation.
function _breakerShortCircuit(command, breaker) {
  if (breaker.threshold <= 0) return null;
  const st = _breaker.get(command);
  if (st && st.fails >= breaker.threshold) {
    const now = Date.now();
    if (now - st.openedAt < breaker.cooldownMs) {
      return {
        decision: HOOK_DECISIONS.CONTINUE,
        reason: `hook circuit breaker open (${st.fails} consecutive failures) — skipped for cooldown`,
        exitCode: null,
        skipped: true,
        breakerOpen: true,
      };
    }
    // half-open: let this one trial through; the outcome records below.
  }
  return null;
}

function _breakerRecord(command, breaker, result) {
  if (breaker.threshold <= 0) return;
  if (result.nonBlockingError) {
    const st = _breaker.get(command) || { fails: 0, openedAt: 0 };
    st.fails += 1;
    if (st.fails >= breaker.threshold) st.openedAt = Date.now();
    _breaker.set(command, st);
  } else {
    _breaker.delete(command); // success / block / ask closes the breaker
  }
}

function runCommandHook(command, input = {}, opts = {}) {
  if (!command) {
    return { decision: HOOK_DECISIONS.CONTINUE, reason: null, exitCode: 0 };
  }
  const breaker = hookBreakerConfig();
  const shortCircuit = _breakerShortCircuit(command, breaker);
  if (shortCircuit) return shortCircuit;
  const result = _runCommandHookInner(command, input, opts);
  _breakerRecord(command, breaker, result);
  return result;
}

/** Async counterpart of runCommandHook (same breaker + protocol). */
async function runCommandHookAsync(command, input = {}, opts = {}) {
  if (!command) {
    return { decision: HOOK_DECISIONS.CONTINUE, reason: null, exitCode: 0 };
  }
  const breaker = hookBreakerConfig();
  const shortCircuit = _breakerShortCircuit(command, breaker);
  if (shortCircuit) return shortCircuit;
  const result = await _runCommandHookInnerAsync(command, input, opts);
  _breakerRecord(command, breaker, result);
  return result;
}

// Payload schema version (gap 2026-07-11 P2): every hook's stdin JSON carries
// schema_version so hook scripts can branch on future payload changes.
// Additive-only changes keep the version; a breaking reshape must bump it.
const HOOK_PAYLOAD_SCHEMA_VERSION = 1;

// command → { fails, openedAt } (per process; hooks are per-run anyway)
const _breaker = new Map();

function hookBreakerConfig(env = process.env) {
  const threshold = Number(env.CC_HOOK_BREAKER_THRESHOLD);
  const cooldown = Number(env.CC_HOOK_BREAKER_COOLDOWN_MS);
  return {
    threshold:
      Number.isFinite(threshold) && threshold >= 0 ? Math.floor(threshold) : 3,
    cooldownMs: Number.isFinite(cooldown) && cooldown > 0 ? cooldown : 60000,
  };
}

/** Test seam: clear breaker state between cases. */
function _resetHookBreaker() {
  _breaker.clear();
}

function _runCommandHookInner(command, input = {}, opts = {}) {
  const { cwd, event } = opts;
  // spawnSync is SYNCHRONOUS — it blocks the whole agent until the hook returns
  // or its timeout fires. Node treats a 0/undefined timeout as UNLIMITED, so a
  // missing, zero, NaN, or negative value (e.g. a malformed settings.json
  // `timeout`) would let a hung hook freeze the agent forever. Guarantee a
  // positive, bounded timeout regardless of the caller's value (already in ms).
  const _rawTimeout = Number(opts.timeout);
  const timeout =
    Number.isFinite(_rawTimeout) && _rawTimeout > 0
      ? Math.min(_rawTimeout, 600000)
      : 60000;
  const shellKind = normalizeShellKind(opts.shell);
  const usePowershell = shellKind === "powershell" || shellKind === "pwsh";
  let res;
  try {
    const common = {
      input: JSON.stringify({
        ...input,
        schema_version: input.schema_version ?? HOOK_PAYLOAD_SCHEMA_VERSION,
      }),
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        CLAUDE_HOOK_EVENT: event || input.hook_event_name || "",
      },
    };
    if (usePowershell) {
      // Per-hook `shell: powershell|pwsh` (settings hook entry): explicit argv
      // instead of the default shell; the enterprise ExecutionPolicy override
      // (settings shell.powershell.executionPolicy) applies here too.
      const { executionPolicy } = loadShellConfig({
        cwd: common.cwd,
      });
      const inv = buildPowershellArgv(command, shellKind, { executionPolicy });
      res = _deps.spawnSync(inv.file, inv.argv, common);
    } else {
      res = _deps.spawnSync(command, { ...common, shell: true });
    }
  } catch (err) {
    return {
      decision: HOOK_DECISIONS.CONTINUE,
      reason: `hook spawn failed: ${err.message}`,
      exitCode: null,
      error: err.message,
      nonBlockingError: true,
    };
  }
  return interpretHookOutcome(res);
}

/**
 * Interpret a finished hook process — a spawnSync result OR the collected output
 * of an async spawn — into a normalized decision. The exit-code / JSON-stdout
 * protocol lives in ONE place so the sync and async runners can never drift.
 *
 * @param {{error?:Error|null, status:number|null, stdout?:string, stderr?:string}} res
 */
function interpretHookOutcome(res) {
  // A surfaced spawn error (timeout / ENOENT, status null) is non-blocking — a
  // broken hook must never wedge the agent; only an explicit block blocks.
  if (res.error) {
    return {
      decision: HOOK_DECISIONS.CONTINUE,
      reason: `hook error: ${res.error.message}`,
      exitCode: null,
      stdout: String(res.stdout || ""),
      stderr: String(res.stderr || ""),
      error: res.error.message,
      nonBlockingError: true,
    };
  }
  const exitCode = res.status;
  const stdout = String(res.stdout || "");
  const stderr = String(res.stderr || "");

  if (exitCode === 2) {
    return {
      decision: HOOK_DECISIONS.BLOCK,
      reason: stderr.trim() || "hook exited 2 (blocked)",
      exitCode,
      stdout,
      stderr,
    };
  }
  if (exitCode === 0) {
    const parsed = tryParseDecision(stdout);
    if (parsed) return { ...parsed, exitCode, stdout, stderr };
    // stdout that *looks* like a decision (`{`-leading) but parses as neither
    // whole-text nor first-line JSON is most likely a corrupt/truncated
    // decision — don't swallow it silently (a block hook could be neutered).
    // The exit code (0) still governs the flow (continue), but flag it so the
    // caller/logs can surface the misconfiguration.
    const looksLikeDecision = stdout.trim()[0] === "{";
    return {
      decision: HOOK_DECISIONS.CONTINUE,
      reason: looksLikeDecision
        ? "hook stdout looked like a decision but did not parse as JSON"
        : null,
      exitCode,
      stdout,
      stderr,
      ...(looksLikeDecision ? { malformedDecision: true } : {}),
    };
  }
  // Other non-zero → non-blocking error.
  return {
    decision: HOOK_DECISIONS.CONTINUE,
    reason: stderr.trim() || `hook exited ${exitCode}`,
    exitCode,
    stdout,
    stderr,
    nonBlockingError: true,
  };
}

/**
 * Async single-hook runner — mirrors _runCommandHookInner but uses async spawn
 * so a batch can run CONCURRENTLY (see runHooksParallel). stdin gets the JSON
 * payload; stdout/stderr are collected (bounded); a hard timeout SIGKILLs a hung
 * hook and reports it as a non-blocking error. Interpretation is shared via
 * interpretHookOutcome so the exit-code protocol matches the sync path exactly.
 */
async function _runCommandHookInnerAsync(command, input = {}, opts = {}) {
  const { cwd, event } = opts;
  const _rawTimeout = Number(opts.timeout);
  const timeout =
    Number.isFinite(_rawTimeout) && _rawTimeout > 0
      ? Math.min(_rawTimeout, 600000)
      : 60000;
  const shellKind = normalizeShellKind(opts.shell);
  const usePowershell = shellKind === "powershell" || shellKind === "pwsh";
  const wd = cwd || process.cwd();
  const inputJson = JSON.stringify({
    ...input,
    schema_version: input.schema_version ?? HOOK_PAYLOAD_SCHEMA_VERSION,
  });
  const spawnEnv = {
    ...process.env,
    CLAUDE_HOOK_EVENT: event || input.hook_event_name || "",
  };

  let child;
  try {
    if (usePowershell) {
      const { executionPolicy } = loadShellConfig({ cwd: wd });
      const inv = buildPowershellArgv(command, shellKind, { executionPolicy });
      child = _deps.spawn(inv.file, inv.argv, { cwd: wd, env: spawnEnv });
    } else {
      child = _deps.spawn(command, { cwd: wd, env: spawnEnv, shell: true });
    }
  } catch (err) {
    return {
      decision: HOOK_DECISIONS.CONTINUE,
      reason: `hook spawn failed: ${err.message}`,
      exitCode: null,
      error: err.message,
      nonBlockingError: true,
    };
  }

  return await new Promise((resolve) => {
    const MAXB = 8 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(interpretHookOutcome(res));
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already exited */
      }
      done({
        error: new Error(`hook timed out after ${timeout}ms`),
        status: null,
        stdout,
        stderr,
      });
    }, timeout);
    if (typeof timer.unref === "function") timer.unref();

    child.on("error", (err) =>
      done({ error: err, status: null, stdout, stderr }),
    );
    if (child.stdout) {
      child.stdout.on("data", (d) => {
        if (stdout.length < MAXB) stdout += d.toString("utf8");
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (d) => {
        if (stderr.length < MAXB) stderr += d.toString("utf8");
      });
    }
    child.on("close", (code) =>
      done({ error: null, status: code, stdout, stderr }),
    );
    // Feed the payload to the hook's stdin. A fast-exiting hook may close its
    // end first (EPIPE) — that is harmless, the exit code still governs.
    try {
      if (child.stdin) {
        child.stdin.on("error", () => {});
        child.stdin.write(inputJson);
        child.stdin.end();
      }
    } catch {
      /* stdin already closed */
    }
  });
}

/**
 * Run a list of command hooks and reduce to one decision.
 *
 * Default (`opts.mergeStrict` falsy): in-order, the first BLOCK **or** ASK
 * short-circuits — byte-identical to the historical behavior.
 *
 * `opts.mergeStrict: true`: run EVERY matching hook (no short-circuit) then take
 * the STRICTEST decision (block > ask > allow > continue) via mergeHookDecisions.
 * This closes the safety gap where an earlier hook's `ask` masks a LATER hook's
 * `block` (the short-circuit path returns `ask` and never runs the blocker).
 * Claude-Code parity: all matching hooks contribute to the merged decision.
 * spawnSync is synchronous so execution is sequential — but the MERGE is
 * order-independent, so the outcome matches a parallel run.
 *
 * @returns {{ decision, reason, hook?, results, contributing? }}
 */
function runHooks(commandHooks, input = {}, opts = {}) {
  const results = [];
  const hooks = commandHooks || [];
  const runOne = (h) =>
    runCommandHook(h.command, input, {
      ...opts,
      timeout: h.timeout != null ? h.timeout * 1000 : opts.timeout,
      // per-hook shell selection (P1 #8): `{ "type":"command", "command":…,
      // "shell":"powershell" }` in the settings hook entry
      shell: h.shell != null ? h.shell : opts.shell,
    });

  if (opts.mergeStrict) {
    const decisions = [];
    for (const h of hooks) {
      const r = runOne(h);
      results.push({ command: h.command, ...r });
      decisions.push({
        decision: r.decision,
        reason: r.reason,
        hook: h.command,
      });
    }
    const merged = mergeHookDecisions(decisions);
    return {
      decision: merged.decision,
      reason: merged.reason,
      hook: merged.hook,
      results,
      contributing: merged.contributing,
    };
  }

  for (const h of hooks) {
    const r = runOne(h);
    results.push({ command: h.command, ...r });
    if (
      r.decision === HOOK_DECISIONS.BLOCK ||
      r.decision === HOOK_DECISIONS.ASK
    ) {
      return {
        decision: r.decision,
        reason: r.reason,
        hook: h.command,
        results,
      };
    }
  }
  return { decision: HOOK_DECISIONS.CONTINUE, reason: null, results };
}

/**
 * Run every matching hook CONCURRENTLY (async spawn) and reduce to the strictest
 * decision (block > ask > allow > continue) via mergeHookDecisions — the true-
 * parallel form of runHooks({mergeStrict}). Wall-clock is the slowest single hook
 * rather than their sum; the merge is order-independent so the outcome matches
 * the sequential strict merge exactly. Same per-hook timeout/shell resolution as
 * runHooks. Returns the same shape ({decision, reason, hook, results,
 * contributing}) so the decision consumers are unchanged.
 */
async function runHooksParallel(commandHooks, input = {}, opts = {}) {
  const hooks = commandHooks || [];
  const settled = await Promise.all(
    hooks.map((h) =>
      runCommandHookAsync(h.command, input, {
        ...opts,
        timeout: h.timeout != null ? h.timeout * 1000 : opts.timeout,
        shell: h.shell != null ? h.shell : opts.shell,
      }).then((r) => ({ h, r })),
    ),
  );
  const results = settled.map(({ h, r }) => ({ command: h.command, ...r }));
  const decisions = settled.map(({ h, r }) => ({
    decision: r.decision,
    reason: r.reason,
    hook: h.command,
  }));
  const merged = mergeHookDecisions(decisions);
  return {
    decision: merged.decision,
    reason: merged.reason,
    hook: merged.hook,
    results,
    contributing: merged.contributing,
  };
}

module.exports = {
  runCommandHook,
  runCommandHookAsync,
  runHooks,
  runHooksParallel,
  interpretHookOutcome,
  tryParseDecision,
  HOOK_DECISIONS,
  HOOK_PAYLOAD_SCHEMA_VERSION,
  hookBreakerConfig,
  _resetHookBreaker,
  _deps,
};
