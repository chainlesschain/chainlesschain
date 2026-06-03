/**
 * `skill.list` WS handler — Phase 1.A pilot (2026-04-29).
 *
 * Returns the bundled+managed+marketplace+workspace skill list to the
 * embedded web-panel without going through `ws.execute('skill list')` —
 * which is unusable inside Electron because `_executeCommand` spawns
 * `process.execPath` (= the Electron binary, not node).
 *
 * The returned shape mirrors what the CLI's `/api/skills` HTTP endpoint
 * already serves so the web-panel skills store can normalise both paths
 * with the same fields.
 *
 * The CLISkillLoader is in `packages/cli/src/lib/skill-loader.js` (ESM).
 * We dynamic-import it once and cache the loader instance — `loadAll()`
 * itself caches the resolved skill list.
 */

const path = require("path");
const { pathToFileURL } = require("url");

const SKILL_LOADER_REL = "../../../../../packages/cli/src/lib/skill-loader.js";

function deriveExecutionMode(category) {
  if (!category) {
    return "built-in";
  }
  const c = String(category);
  if (c.includes("agent")) {
    return "agent";
  }
  if (c.includes("llm")) {
    return "llm-query";
  }
  if (c === "cli-direct" || c.includes("cli")) {
    return "cli-direct";
  }
  return "built-in";
}

function shapeSkill(s) {
  return {
    name: s.id,
    displayName: s.displayName ?? s.id,
    description: s.description ?? "",
    category: s.category ?? "uncategorized",
    executionMode: s.executionMode ?? deriveExecutionMode(s.category),
    source: s.source ?? null,
    version: s.version ?? null,
  };
}

/**
 * Build a `skill.list` handler. Tests inject `loaderFactory` to bypass
 * the dynamic import.
 *
 * @param {Object} [options]
 * @param {() => Promise<{ loadAll: () => any[] }>} [options.loaderFactory]
 *   Override that returns a CLISkillLoader-shaped object. Defaults to
 *   dynamic-importing the CLI module.
 * @returns {(message: any, ctx: any) => Promise<{
 *   schema: 1,
 *   skills: ReturnType<typeof shapeSkill>[],
 * }>}
 */
function createSkillListHandler(options = {}) {
  const factory =
    options.loaderFactory ??
    (async () => {
      const moduleUrl = pathToFileURL(
        path.resolve(__dirname, SKILL_LOADER_REL),
      ).href;
      const mod = await import(moduleUrl);
      return new mod.CLISkillLoader();
    });

  let cachedLoader = null;

  return async function skillListHandler() {
    if (!cachedLoader) {
      cachedLoader = await factory();
    }
    const resolved = cachedLoader.loadAll();
    const skills = Array.isArray(resolved) ? resolved.map(shapeSkill) : [];
    return { schema: 1, skills };
  };
}

module.exports = { createSkillListHandler, shapeSkill, deriveExecutionMode };
