/**
 * Auto-checkpoint default resolution — Claude-Code parity: checkpoints are ON
 * by default inside a git repository (the shadow-commit engine never touches
 * the working tree or real index, so the only cost is a plumbing commit per
 * mutating tool), OFF elsewhere (the copy-based fallback writes real files
 * under the user home — too surprising as a silent default).
 *
 * Explicit flags always win: `--checkpoint` forces on anywhere (copy engine
 * included), `--no-checkpoint` forces off.
 */

import fsDefault from "fs";
import pathDefault from "path";

export const _deps = { fs: fsDefault, path: pathDefault };

/** Walk up from cwd looking for a `.git` marker. */
export function isInsideGitRepo(cwd, deps = _deps) {
  let dir = deps.path.resolve(cwd || ".");
  for (;;) {
    try {
      if (deps.fs.existsSync(deps.path.join(dir, ".git"))) return true;
    } catch {
      /* keep walking */
    }
    const parent = deps.path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * @param {object} opts
 * @param {boolean} [opts.flagValue]  commander's options.checkpoint
 * @param {string}  [opts.flagSource] commander getOptionValueSource("checkpoint")
 *                                    ("cli" when --checkpoint/--no-checkpoint given)
 * @param {string}  [opts.cwd]
 * @param {object}  [opts.deps]
 * @returns {boolean}
 */
export function resolveAutoCheckpoint({
  flagValue,
  flagSource,
  cwd = process.cwd(),
  deps = _deps,
} = {}) {
  if (flagSource === "cli") return flagValue === true;
  return isInsideGitRepo(cwd, deps);
}
