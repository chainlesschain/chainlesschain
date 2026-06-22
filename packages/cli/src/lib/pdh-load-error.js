/**
 * Shared helper for loading the personal-data-hub package with an actionable
 * error when the install is incomplete.
 *
 * pdh is imported lazily from several places (the hub wiring, the ws
 * personal-data-hub protocol's system-data ingest, and the `cc hub
 * collect-*` / `salvage` forensics commands). When a global
 * `npm i -g chainlesschain` is interrupted mid-extraction — commonly a
 * running `cc` / node process holding a lock on a native .node file →
 * EBUSY/EPERM — the pdh package is left partially written. The default Node
 * error ("Cannot find module .../personal-data-hub/lib/...") reads like a bug
 * in the package rather than a local-install problem, so users can't
 * self-fix. Centralizing the rewrite here keeps that guidance identical
 * across every pdh load site.
 */

/**
 * Turn a raw ESM module-resolution failure for the personal-data-hub package
 * into an actionable "your install is incomplete — repair it" error. Real
 * bugs inside pdh (a TypeError) and unrelated missing modules pass through
 * unchanged.
 */
export function rewritePdhLoadError(err) {
  const isMissingModule =
    err &&
    (err.code === "ERR_MODULE_NOT_FOUND" ||
      /Cannot find (module|package)/.test(err.message || ""));
  const mentionsPdh = /personal-data-hub/.test(
    (err && (err.url || err.message)) || "",
  );
  if (!isMissingModule || !mentionsPdh) return err;
  const wrapped = new Error(
    "Personal Data Hub package is missing files — your install looks " +
      "incomplete.\n" +
      "This usually means a global install was interrupted (often a running " +
      "`cc`/node process locking a native file).\n" +
      "Repair it with:  npm i -g chainlesschain@latest\n" +
      "(close any running `cc` sessions first so the install isn't blocked).\n" +
      `Original error: ${err.message}`,
  );
  wrapped.code = "PDH_INSTALL_INCOMPLETE";
  wrapped.cause = err;
  return wrapped;
}

/**
 * `await import()` a pdh package/subpath specifier, rewriting an
 * incomplete-install resolution failure into the actionable error above.
 * Returns the raw module namespace (caller does its own .default / named
 * destructure, exactly like a bare dynamic import).
 */
export async function importPdh(spec) {
  try {
    return await import(spec);
  } catch (err) {
    throw rewritePdhLoadError(err);
  }
}
