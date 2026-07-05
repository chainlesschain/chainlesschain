/**
 * Centralized friendly-error boundary for the CLI entrypoint.
 *
 * An uncaught error thrown from a command action (malformed --json, a failed DB
 * op) — or, crucially, one that escapes into an async event handler / detached
 * task / third-party lib AFTER the top-level parse — otherwise surfaces as a raw
 * stack trace via Node's default unhandledRejection/uncaughtException, which on
 * modern Node terminates the process. Route all of those through one place that
 * prints a clean `error: <message>` (full stack under --verbose or
 * CC_DEBUG/DEBUG) and exits non-zero.
 *
 * Pure-ish: process bindings are injectable so this is unit-testable.
 */

export function reportFatal(
  err,
  {
    stderr = process.stderr,
    exit = process.exit,
    argv = process.argv,
    env = process.env,
  } = {},
) {
  // Ctrl-C / Esc on an interactive @inquirer prompt throws ExitPromptError.
  // That's a normal user cancel, not a failure — printing `error: User force
  // closed the prompt...` + a non-descript exit is confusing. Treat it as a
  // clean cancel: a brief note to stderr and the conventional SIGINT exit code
  // (130 = 128 + SIGINT), so scripts can tell "cancelled" from "succeeded".
  if (
    err &&
    (err.name === "ExitPromptError" || err.code === "ERR_USE_AFTER_CLOSE")
  ) {
    stderr.write("\nCancelled.\n");
    exit(130);
    return;
  }
  const verbose =
    argv.includes("--verbose") || Boolean(env.CC_DEBUG) || Boolean(env.DEBUG);
  if (verbose && err && err.stack) {
    stderr.write(`${err.stack}\n`);
  } else {
    const msg = err && err.message ? err.message : String(err);
    stderr.write(`error: ${msg}\n`);
  }
  exit(1);
}

/**
 * Install process-level safety nets that funnel unhandled rejections and
 * uncaught exceptions through `report`. Node terminates on these by default, so
 * this only swaps the ugly default stack for the friendly boundary — it is not
 * a behavior change (still exits non-zero).
 */
export function installGlobalErrorHandlers(
  proc = process,
  report = reportFatal,
) {
  proc.on("unhandledRejection", (reason) =>
    report(reason instanceof Error ? reason : new Error(String(reason))),
  );
  proc.on("uncaughtException", (err) =>
    report(err instanceof Error ? err : new Error(String(err))),
  );
}
