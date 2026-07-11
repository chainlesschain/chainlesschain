/**
 * Session-store write guard — transcript tamper protection (agent tool layer).
 *
 * Session transcripts under `~/.chainlesschain/sessions` are hash-chained and
 * tamper-evident (see harness/transcript-integrity.js). An agent writing into
 * that directory could rewrite the very history that `cc session verify`,
 * resume, and audit trust — so write tools confirm first, exactly like the
 * sensitive-file guard. Pure path logic lives here so it is unit-testable
 * without the agent runtime.
 */

import { resolve, relative, isAbsolute, join } from "node:path";
import { getHomeDir } from "./paths.js";

export function sessionStoreDir() {
  return join(getHomeDir(), "sessions");
}

/**
 * True when targetPath (relative paths resolve against opts.cwd) lands inside
 * the session transcript store. path.win32.relative compares
 * case-insensitively, so mixed-case Windows paths are handled.
 */
export function isWithinSessionStore(targetPath, opts = {}) {
  const p = String(targetPath || "");
  if (!p) return false;
  const abs = resolve(opts.cwd || process.cwd(), p);
  const rel = relative(resolve(sessionStoreDir()), abs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * @param {string} targetPath path as the tool received it (rel or abs)
 * @returns {string|null} human reason when the path is a transcript-store
 *   write, null otherwise
 */
export function sessionStorePathReason(targetPath, opts = {}) {
  if (!isWithinSessionStore(targetPath, opts)) return null;
  return "session transcript store — transcripts are hash-chained and tamper-evident; direct edits break the chain";
}
