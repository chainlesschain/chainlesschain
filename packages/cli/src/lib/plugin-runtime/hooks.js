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

import crypto from "node:crypto";
import fs from "fs";
import path from "node:path";
import { discoverPlugins } from "./scopes.js";
import { partitionByTrust, warnUntrustedOnce } from "./trust.js";
import { componentCapabilityDenial } from "./capabilities.js";
import { mergePluginSandboxPolicies } from "./sandbox-policy.js";

export const _deps = {
  discoverPlugins,
  readFileSync: fs.readFileSync,
};

function sha256Content(content) {
  return crypto.createHash("sha256").update(String(content)).digest("hex");
}

function pluginAuthorityError({
  code,
  error,
  plugin = null,
  sourceFile = null,
  digest = null,
  stage,
}) {
  return Object.freeze({
    code,
    kind: "plugin",
    authorityBearing: true,
    pluginId: plugin?.name || null,
    pluginVersion: plugin?.version || null,
    sourceFile:
      typeof sourceFile === "string" && sourceFile
        ? path.resolve(sourceFile)
        : null,
    digest: typeof digest === "string" && digest ? digest : null,
    stage,
    message: error?.message || String(error || code),
  });
}

function normalizedAuthorityErrors(errors) {
  return Object.freeze(
    (Array.isArray(errors) ? errors : []).map((entry) =>
      Object.freeze({ ...(entry || {}) }),
    ),
  );
}

function attachAuthorityErrors(target, errors) {
  Object.defineProperty(target, "_authorityErrors", {
    value: normalizedAuthorityErrors(errors),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return target;
}

function attachPluginAuthoritySource(target, { sourceFile, digest }) {
  Object.defineProperty(target, "authoritySource", {
    value: Object.freeze({
      kind: "plugin",
      sourceFile: path.resolve(sourceFile),
      digest,
    }),
    enumerable: true,
    writable: false,
    configurable: false,
  });
  return target;
}

function loadPluginHookSource(plugin, component, authorityErrors) {
  const sourceFile = component.absPath
    ? component.absPath
    : component.inline
      ? plugin.manifest?.manifestPath
      : null;
  if (!sourceFile) {
    authorityErrors.push(
      pluginAuthorityError({
        code: "CC_PLUGIN_HOOK_READ_FAILED",
        error: new Error("plugin hook source is missing"),
        plugin,
        sourceFile: plugin.manifest?.manifestPath || null,
        stage: "read",
      }),
    );
    return null;
  }

  let raw;
  try {
    raw = _deps.readFileSync(sourceFile, "utf8");
  } catch (error) {
    authorityErrors.push(
      pluginAuthorityError({
        code: "CC_PLUGIN_HOOK_READ_FAILED",
        error,
        plugin,
        sourceFile,
        stage: "read",
      }),
    );
    return null;
  }

  const digest = sha256Content(raw);
  try {
    const parsed = JSON.parse(raw);
    return {
      parsed: component.inline
        ? parsed && typeof parsed === "object"
          ? parsed.hooks
          : null
        : parsed,
      sourceFile,
      digest,
    };
  } catch (error) {
    authorityErrors.push(
      pluginAuthorityError({
        code: "CC_PLUGIN_HOOK_PARSE_FAILED",
        error,
        plugin,
        sourceFile,
        digest,
        stage: "parse",
      }),
    );
    return null;
  }
}

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
  const merged = {};
  const authorityErrors = [];
  let plugins = [];
  try {
    plugins = _deps.discoverPlugins({ cwd: opts.cwd, scopes: opts.scopes });
  } catch (error) {
    authorityErrors.push(
      pluginAuthorityError({
        code: "CC_PLUGIN_HOOK_DISCOVERY_FAILED",
        error,
        stage: "discover",
      }),
    );
    return attachAuthorityErrors(merged, authorityErrors);
  }
  // A hook runs a shell command — gate it behind trust so a cloned repo's
  // project plugin can't run commands the moment the agent starts.
  const { trusted, skipped } = partitionByTrust(plugins);
  warnUntrustedOnce(
    skipped.filter((p) => p.manifest?.components?.hooks).map((p) => p.name),
    "hooks",
  );
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
    // Inline declarations are re-read from the manifest because discovery's
    // normalized component retains only counts. Both source forms bind every
    // executable hook to the exact bytes that authorized it.
    const source = loadPluginHookSource(p, h, authorityErrors);
    if (!source) continue;
    const map = normalizeHookMap(source.parsed);
    for (const [event, entries] of Object.entries(map)) {
      if (!Array.isArray(entries)) continue;
      const tagged = entries
        .map((group) => {
          if (
            !group ||
            typeof group !== "object" ||
            !Array.isArray(group.hooks)
          ) {
            return group;
          }
          let groupSandboxPolicy;
          try {
            groupSandboxPolicy = mergePluginSandboxPolicies(
              p.manifest.sandboxPolicy,
              group.sandboxPolicy,
            );
          } catch (error) {
            authorityErrors.push(
              pluginAuthorityError({
                code: "CC_PLUGIN_HOOK_SANDBOX_INVALID",
                error,
                plugin: p,
                sourceFile: source.sourceFile,
                digest: source.digest,
                stage: "sandbox-policy",
              }),
            );
            return null;
          }
          const groupConfig = { ...group };
          delete groupConfig.sandboxPolicy;
          return {
            ...groupConfig,
            hooks: group.hooks
              .map((hook) => {
                if (!hook || typeof hook !== "object") return hook;
                let sandboxPolicy;
                try {
                  sandboxPolicy = mergePluginSandboxPolicies(
                    groupSandboxPolicy,
                    hook.sandboxPolicy,
                  );
                } catch (error) {
                  authorityErrors.push(
                    pluginAuthorityError({
                      code: "CC_PLUGIN_HOOK_SANDBOX_INVALID",
                      error,
                      plugin: p,
                      sourceFile: source.sourceFile,
                      digest: source.digest,
                      stage: "sandbox-policy",
                    }),
                  );
                  return null;
                }
                const hookConfig = { ...hook };
                delete hookConfig.sandboxPolicy;
                delete hookConfig.authoritySource;
                return attachPluginAuthoritySource(
                  {
                    ...hookConfig,
                    ...(sandboxPolicy ? { sandboxPolicy } : {}),
                    origin: "plugin:hook",
                    pluginId: p.name,
                    pluginVersion: p.version || null,
                    pluginSource: p.manifest?.manifestPath || null,
                  },
                  source,
                );
              })
              .filter(Boolean),
          };
        })
        .filter(Boolean);
      merged[event] = (merged[event] || []).concat(tagged);
    }
  }
  warnHookCapabilityDeniedOnce(denied);
  return attachAuthorityErrors(merged, authorityErrors);
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
  const pluginAuthorityErrors = plugin._authorityErrors || [];
  if (events.length === 0 && pluginAuthorityErrors.length === 0) {
    return settingsHooks;
  }
  const out =
    settingsHooks && typeof settingsHooks === "object"
      ? { ...settingsHooks }
      : {};
  for (const event of events) {
    out[event] = (Array.isArray(out[event]) ? out[event] : []).concat(
      plugin[event],
    );
  }
  return attachAuthorityErrors(out, [
    ...(settingsHooks?._authorityErrors || []),
    ...pluginAuthorityErrors,
  ]);
}
