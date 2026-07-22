/**
 * Merge installed plugins' `hooks/hooks.json` into the effective settings-hook
 * map (Phase 3.3c — plugin Hook component reaches the agent lifecycle).
 *
 * A plugin ships lifecycle hooks in the same shape as `.claude/settings.json`
 * `hooks`: a map of event name → array of `{ matcher?, hooks: [{type,command}] }`
 * entries, optionally wrapped under a top-level `hooks` key. Those entries are
 * concatenated onto whatever the user's settings already declared, so a plugin
 * ADDS hooks without being able to silently replace the user's.
 *
 * Only plugins whose manifest fully validated (`manifest.ok`) contribute. Note:
 * a hook can run a shell command, so a plugin's hooks carry the same trust as
 * the user installing it (same as an npm package's lifecycle scripts) and run
 * through the existing hook-runner (which applies the project-hook trust model).
 */

import fs from "fs";
import { discoverPlugins } from "./scopes.js";
import { partitionByTrust, warnUntrustedOnce } from "./trust.js";
import { componentCapabilityDenial } from "./capabilities.js";

export const _deps = { readFileSync: fs.readFileSync };

// One-time stderr notice when a plugin's hooks are refused at the COMPONENT
// level because the plugin opted into the capability model but did not declare
// the `process` capability its shell hooks need. Distinct from the trust gate:
// these plugins ARE trusted, but their hook component is denied.
const _capabilityDenied = new Set();
function warnHookCapabilityDeniedOnce(entries) {
  if (!entries || entries.length === 0) return;
  if (_capabilityDenied.has("hook-capability")) return;
  _capabilityDenied.add("hook-capability");
  const list = entries.map((e) => `${e.name} (${e.reason})`).join("; ");
  try {
    process.stderr.write(
      `[plugins] refused hook(s) from plugin(s) that declared a permissions ` +
        `block but did not declare the 'process' capability their hooks need: ${list}\n` +
        `          add 'process' to the plugin's permissions block to enable them.\n`,
    );
  } catch {
    /* stderr notice is best-effort */
  }
}

/** Test hook: reset the one-time capability-denied warning guard. */
export function _resetHookWarnings() {
  _capabilityDenied.clear();
}

/** Accept either `{ hooks: {Event:[...]} }` (plugin wrap) or `{Event:[...]}`. */
function normalizeHookMap(parsed) {
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    parsed.hooks &&
    typeof parsed.hooks === "object" &&
    !Array.isArray(parsed.hooks)
  ) {
    return parsed.hooks;
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : {};
}

/**
 * Collect + merge every installed plugin's hook entries into one event map.
 * @param {object} [opts] { cwd, scopes }
 * @returns {Record<string, Array>} event name → concatenated hook entries
 */
export function collectPluginHooks(opts = {}) {
  let plugins = [];
  try {
    plugins = discoverPlugins({ cwd: opts.cwd, scopes: opts.scopes });
  } catch {
    return {};
  }
  // A hook runs a shell command — gate it behind trust so a cloned repo's
  // project plugin can't run commands the moment the agent starts.
  const { trusted, skipped } = partitionByTrust(plugins);
  warnUntrustedOnce(
    skipped.filter((p) => p.manifest?.components?.hooks).map((p) => p.name),
    "hooks",
  );
  const merged = {};
  const denied = [];
  for (const p of trusted) {
    if (!p.manifest || p.manifest.ok !== true) continue;
    const h = p.manifest.components?.hooks;
    if (!h) continue;
    // Component-level capability gate: a plugin that declared a permissions
    // block but under-declared the `process` capability its shell hooks need
    // gets its hooks refused here (mirrors the MCP collector's denial).
    const denial = componentCapabilityDenial(p.manifest, ["process"]);
    if (denial) {
      denied.push({ name: p.name, reason: denial.reason });
      continue;
    }
    let parsed;
    if (h.absPath) {
      try {
        parsed = JSON.parse(_deps.readFileSync(h.absPath, "utf8"));
      } catch {
        continue;
      }
    } else if (h.inline) {
      // Hooks declared inline in plugin.json — the normalized component keeps
      // only counts, so re-read the raw manifest for the actual entries (same
      // approach as the MCP collector). Without this, inline hooks never fire.
      try {
        const raw = JSON.parse(
          _deps.readFileSync(p.manifest.manifestPath, "utf8"),
        );
        parsed = raw && typeof raw === "object" ? raw.hooks : null;
      } catch {
        continue;
      }
    } else {
      continue;
    }
    const map = normalizeHookMap(parsed);
    for (const [event, entries] of Object.entries(map)) {
      if (!Array.isArray(entries)) continue;
      const tagged = entries.map((group) => {
        if (!group || typeof group !== "object" || !Array.isArray(group.hooks)) return group;
        return {
          ...group,
          hooks: group.hooks.map((hook) => ({
            ...hook,
            origin: "plugin:hook",
            pluginId: p.name,
            pluginVersion: p.version || null,
            pluginSource: p.manifest?.manifestPath || null,
          })),
        };
      });
      merged[event] = (merged[event] || []).concat(tagged);
    }
  }
  warnHookCapabilityDeniedOnce(denied);
  return merged;
}

/**
 * Return a settings-hook map that ADDS the installed plugins' hooks to the
 * user's own. Returns the input unchanged when no plugin contributes hooks.
 *
 * @param {object|null} settingsHooks  the user's loaded settings hooks
 * @param {object} [opts] { cwd, scopes }
 */
export function mergePluginHooks(settingsHooks, opts = {}) {
  const plugin = collectPluginHooks(opts);
  const events = Object.keys(plugin);
  if (events.length === 0) return settingsHooks;
  const out =
    settingsHooks && typeof settingsHooks === "object"
      ? { ...settingsHooks }
      : {};
  for (const event of events) {
    out[event] = (Array.isArray(out[event]) ? out[event] : []).concat(
      plugin[event],
    );
  }
  return out;
}
