/**
 * Discover installed plugins' skill directories so the skill-loader can expose
 * them to the agent (Phase 3.3 — plugin Skill component reaches the agent).
 *
 * A plugin ships skills under `<pluginRoot>/skills/<name>/SKILL.md` (the same
 * `<group>/<skill>/SKILL.md` layout every skill layer uses), so each installed
 * plugin's `skills/` directory becomes an extra skill layer. Only plugins whose
 * manifest fully validated (`manifest.ok`) contribute — a plugin with a
 * traversal/schema error in ANY component loads nothing.
 */

import fs from "fs";
import path from "path";
import { discoverPlugins } from "./scopes.js";

export const _deps = { existsSync: fs.existsSync };

/**
 * @param {object} [opts] { cwd, scopes }
 * @returns {Array<{ name, scope, version, path }>} one entry per plugin that has
 *   a `skills/` directory; `path` is that directory (a scan root for the loader).
 */
export function discoverPluginSkillLayers(opts = {}) {
  let plugins = [];
  try {
    plugins = discoverPlugins({ cwd: opts.cwd, scopes: opts.scopes });
  } catch {
    return [];
  }
  const out = [];
  for (const p of plugins) {
    if (!p.manifest || p.manifest.ok !== true) continue;
    const skillsDir = path.join(p.root, "skills");
    if (!_deps.existsSync(skillsDir)) continue;
    out.push({
      name: p.name,
      scope: p.scope,
      version: p.version,
      path: skillsDir,
    });
  }
  return out;
}
