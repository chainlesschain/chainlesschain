import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * Locate a Git marker without `existsSync()`'s fail-open error swallowing.
 * ENOENT/ENOTDIR means "keep walking"; access, I/O, and indeterminate marker
 * failures propagate so a mutation-capable background task never silently
 * falls back to the shared checkout.
 */
export function findGitRepositoryRootStrict(
  cwd = process.cwd(),
  {
    stat = lstatSync,
    realpath = realpathSync.native || realpathSync,
    pathApi = path,
  } = {},
) {
  // Resolve the starting directory before walking ancestors. A lexical cwd
  // reached through a symlink/junction may sit outside the repository even
  // though its canonical target is inside it; walking the alias would
  // otherwise classify a real Git checkout as non-Git and share it.
  let dir = realpath(pathApi.resolve(cwd));
  for (;;) {
    try {
      stat(pathApi.join(dir, ".git"));
      return dir;
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
    }
    const parent = pathApi.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Decide whether an agent session must use an isolated git worktree.
 *
 * Background prompts and tool declarations are deliberately not inspected.
 * An unqualified detached agent is treated as mutation-capable and isolated
 * whenever it starts in a git repository. `--no-worktree` is the only explicit
 * escape hatch: a nominally read-only permission mode is not enough because
 * host/MCP extension tools may widen the effective tool surface.
 */
export function resolveBackgroundWorktreePolicy({
  background = false,
  worktree,
  inputFormat = "text",
  cwd = process.cwd(),
  findProjectRoot = findGitRepositoryRootStrict,
} = {}) {
  if (worktree === true) {
    const repoRoot = findProjectRoot(cwd);
    if (!repoRoot) {
      throw new Error("--worktree requires a Git repository");
    }
    return {
      enabled: true,
      source: "explicit",
      reason: "worktree explicitly requested",
      repoRoot,
    };
  }
  if (worktree === false) {
    return {
      enabled: false,
      source: "explicit-disable",
      reason: "worktree explicitly disabled",
      repoRoot: null,
    };
  }
  if (!background) {
    return {
      enabled: false,
      source: "foreground-default",
      reason: "foreground sessions preserve the existing default",
      repoRoot: null,
    };
  }
  // stream-json is a foreground, long-lived stdin protocol in the current
  // command contract even if callers also pass --background. Do not silently
  // change that established dispatch path in the worktree policy layer.
  if (String(inputFormat || "text").toLowerCase() === "stream-json") {
    return {
      enabled: false,
      source: "stream-json-foreground",
      reason: "stream-json uses the foreground stream driver",
      repoRoot: null,
    };
  }
  // Detection errors propagate: once a caller asks for mutation-capable
  // background isolation, an indeterminate repository state must not silently
  // fall back to sharing the main checkout.
  const repoRoot = findProjectRoot(cwd);
  if (!repoRoot) {
    return {
      enabled: false,
      source: "non-git-default",
      reason: "current directory is not inside a git repository",
      repoRoot: null,
    };
  }
  return {
    enabled: true,
    source: "background-git-default",
    reason: "mutation-capable background agent in a git repository",
    repoRoot,
  };
}
