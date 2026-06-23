/**
 * cc loop — core driver (pure, dependency-injected) for the fixed-interval
 * loop runner. The command layer (src/commands/loop.js) supplies a concrete
 * `runIteration` (spawns a child process) plus a real clock; everything here
 * is side-effect-free and clock-injected so the loop semantics — iteration
 * counting, stop conditions, between-run delay — are deterministically
 * testable without timers or subprocesses.
 *
 * Claude-Code `/loop` parity (fixed-interval MVP): run a command or agent
 * prompt repeatedly until a stop condition fires (max iterations / exit 0 /
 * output match) or the caller aborts (Ctrl-C).
 */

/** Multipliers for the duration suffixes we accept. */
const DURATION_UNITS = { ms: 1, s: 1000, m: 60000, h: 3600000 };

/**
 * Parse a human interval ("30s", "5m", "1.5h", "500ms") into milliseconds.
 * A bare number is interpreted as SECONDS (the natural unit for an interval),
 * so `--every 30` === `--every 30s`. Throws on anything unparseable.
 */
export function parseDuration(input) {
  if (typeof input === "number" && Number.isFinite(input)) {
    // Consistent with the bare-string path below: a bare number is SECONDS,
    // so parseDuration(30) === parseDuration("30") === parseDuration("30s").
    return Math.max(0, Math.round(input * DURATION_UNITS.s));
  }
  const s = String(input ?? "")
    .trim()
    .toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/);
  if (!m) {
    throw new Error(
      `invalid duration: "${input}" (use 30s, 5m, 1.5h, or 500ms)`,
    );
  }
  const value = parseFloat(m[1]);
  const unit = m[2] || "s"; // bare number → seconds
  return Math.round(value * DURATION_UNITS[unit]);
}

/** Render a millisecond duration back to a compact human string. */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${trim(ms / 1000)}s`;
  if (ms < 3600000) return `${trim(ms / 60000)}m`;
  return `${trim(ms / 3600000)}h`;
}

function trim(n) {
  // Strip trailing ".0" so 5.0 → "5" but 1.5 stays "1.5".
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Parse the `--dynamic` control directives an iteration may print so it can
 * self-pace. An iteration ends its output with at most one of:
 *   [[loop:next <interval>]]   schedule the next run after <interval>
 *   [[loop:stop]]              the task is done; stop looping
 * Returns { done, nextDelayMs }. `stop` wins over `next` (done short-circuits
 * before the next sleep). A malformed interval is ignored (falls back to the
 * fixed `--every`). Lives here so the protocol is unit-testable in isolation.
 */
export function parseLoopDirectives(output) {
  const text = String(output || "");
  const result = { done: false, nextDelayMs: null };
  if (/\[\[\s*loop:stop\s*\]\]/i.test(text)) result.done = true;
  const m = text.match(/\[\[\s*loop:next\s+([0-9.]+\s*(?:ms|s|m|h)?)\s*\]\]/i);
  if (m) {
    try {
      result.nextDelayMs = parseDuration(m[1]);
    } catch {
      /* malformed interval → leave null, caller falls back to --every */
    }
  }
  return result;
}

/**
 * Reduce a persisted loop session's events into the state needed to resume it:
 * the original `loop_config`, how many iterations already completed, and the
 * last recorded exit code. Pure (operates on the event array, no fs) so the
 * resume reconstruction is unit-testable without the session store.
 */
export function summarizeLoopEvents(events) {
  let config = null;
  let completedIterations = 0;
  let lastExitCode = null;
  for (const e of events || []) {
    if (e?.type === "loop_config") {
      config = e.data || null;
    } else if (e?.type === "loop_iteration") {
      completedIterations += 1;
      if (e.data && typeof e.data.exitCode !== "undefined") {
        lastExitCode = e.data.exitCode;
      }
    }
  }
  return { config, completedIterations, lastExitCode };
}

/** Default abortable sleep — resolves early if the signal aborts. */
export function makeSleep(signal) {
  return (ms) =>
    new Promise((resolve) => {
      if (signal?.aborted || ms <= 0) return resolve();
      // NB: do NOT unref() — the pending interval timer is what keeps the
      // process alive between rounds. Under a TTY the active stdin would mask
      // an unref'd timer, but headless (piped stdin / CI / cron) the loop would
      // exit after the first round. SIGINT aborts the wait via the signal.
      let t;
      const onAbort = () => {
        clearTimeout(t);
        resolve();
      };
      t = setTimeout(() => {
        // Normal completion: drop the abort listener so it can't accumulate on
        // a shared signal across rounds. A long `cc loop` reuses one
        // AbortController for the whole run, and `{once:true}` only removes the
        // listener if it FIRES — a sleep that completes normally never aborts,
        // so without this each round would leak a dangling listener (N rounds →
        // N retained closures + a MaxListenersExceededWarning past 10).
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * Drive the loop. Calls `runIteration(n)` once per round (1-based), evaluates
 * the stop conditions AFTER each round, and sleeps `intervalMs` between rounds
 * (never after the final round). Returns a summary describing why it stopped.
 *
 * @param {object}   opts
 * @param {(n:number)=>Promise<{exitCode?:number, output?:string}>} opts.runIteration
 * @param {number}   opts.intervalMs       default delay between iterations (>= 0)
 * @param {number}  [opts.maxIterations]   stop after N rounds (>= 1)
 * @param {boolean} [opts.untilExitZero]   stop once a round exits with code 0
 * @param {RegExp}  [opts.untilRegex]      stop once a round's output matches
 * @param {(ms:number)=>Promise<void>} [opts.sleep]  injectable delay
 * @param {()=>boolean} [opts.shouldStop]  external stop probe (e.g. SIGINT)
 * @param {(n:number, res:object)=>void} [opts.onIteration] per-round hook
 * @param {number}  [opts.startIndex]      iterations already done (resume)
 * @returns {Promise<{iterations:number, stoppedBy:string, results:object[]}>}
 *          `iterations` is cumulative (startIndex + rounds run this call);
 *          `results` holds only this call's rounds.
 */
export async function runLoop({
  runIteration,
  intervalMs,
  maxIterations,
  untilExitZero = false,
  untilRegex = null,
  sleep,
  shouldStop,
  onIteration,
  startIndex = 0,
}) {
  if (typeof runIteration !== "function") {
    throw new Error("runLoop requires a runIteration function");
  }
  const delay = sleep || makeSleep();
  const results = [];
  // Iterations already completed in a prior (resumed) run. `i` continues from
  // here so the displayed/persisted round numbers are cumulative and
  // `maxIterations` counts across resume.
  let i = startIndex;

  while (true) {
    if (shouldStop && shouldStop()) {
      return { iterations: i, stoppedBy: "signal", results };
    }

    i += 1;
    const res = (await runIteration(i)) || {};
    results.push(res);
    if (onIteration) onIteration(i, res);

    // Stop conditions, most-specific first. Evaluated after the round so the
    // work always runs at least once before any condition can end the loop.
    // `res.done` is the iteration's own explicit stop (e.g. a --dynamic
    // [[loop:stop]] directive) and wins over everything else.
    if (res.done) {
      return { iterations: i, stoppedBy: "done", results };
    }
    if (untilExitZero && res.exitCode === 0) {
      return { iterations: i, stoppedBy: "exit-zero", results };
    }
    if (untilRegex && untilRegex.test(res.output || "")) {
      return { iterations: i, stoppedBy: "match", results };
    }
    if (maxIterations && i >= maxIterations) {
      return { iterations: i, stoppedBy: "max-iterations", results };
    }
    if (shouldStop && shouldStop()) {
      return { iterations: i, stoppedBy: "signal", results };
    }

    // An iteration may set its own next interval (--dynamic [[loop:next]]);
    // otherwise fall back to the fixed --every delay.
    const nextMs = Number.isFinite(res.nextDelayMs)
      ? res.nextDelayMs
      : intervalMs;
    await delay(nextMs);
  }
}
