/**
 * Per-directory skill path-scoping (P1 large-monorepo lazy context).
 *
 * A skill may declare a `paths:` (or `globs:` / `pathScope:`) frontmatter list
 * so it is only surfaced when the agent is working under a matching subtree —
 * e.g. a skill scoped to `packages/cli/**` should not clutter discovery or run
 * when the agent is operating in `android-app/`. This keeps the on-demand skill
 * surface small in a big monorepo.
 *
 * Pure (path math only; the matching semantics are reused from
 * project-instructions.js's `ruleApplies`, the same prefix-overlap rule used for
 * path-scoped `.claude/rules`). A skill with no `paths` applies everywhere, so a
 * skill set with no path-scoped skills is filtered byte-for-byte unchanged.
 */

import path from "node:path";
import { ruleApplies } from "./project-instructions.js";

/**
 * Normalize a skill's raw path-scope frontmatter (`paths` / `globs` /
 * `pathScope`, string or array) into a non-empty string[] of globs, or null
 * when the skill declares no scope (→ applies everywhere).
 */
export function normalizeSkillPaths(data) {
  const raw = data?.paths ?? data?.globs ?? data?.pathScope ?? null;
  if (raw == null) return null;
  const list = (Array.isArray(raw) ? raw : [raw])
    .map((g) => String(g == null ? "" : g).trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

/**
 * The agent's cwd expressed relative to the project root, forward-slashed — the
 * form `ruleApplies` expects (skill `paths` globs are project-root-relative,
 * like rule globs). A cwd at (or outside) the root resolves to "" → every skill
 * applies (never hide skills just because we can't locate the root).
 */
export function relCwdForCwd(cwd, root) {
  if (!cwd || !root) return "";
  let rel;
  try {
    rel = path.relative(root, cwd);
  } catch {
    return "";
  }
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return "";
  return rel.replace(/\\/g, "/");
}

/**
 * Does a skill's path-scope apply when the agent runs at `relCwd`? A skill with
 * no `paths` (null/empty) applies everywhere.
 */
export function skillAppliesToCwd(skill, relCwd) {
  return ruleApplies(skill?.paths || [], relCwd);
}

/** Filter a skill list to those whose path-scope applies at `relCwd`. */
export function filterSkillsByRelCwd(skills, relCwd) {
  if (!Array.isArray(skills)) return skills;
  return skills.filter((s) => skillAppliesToCwd(s, relCwd));
}
