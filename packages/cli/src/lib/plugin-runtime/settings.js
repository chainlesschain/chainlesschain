/**
 * Plugin `settings` component — a plugin's default configuration (Phase 3.3o).
 *
 * A plugin ships a `settings.json` with defaults. We contribute ONLY the safe,
 * non-security config-override keys — `env` (default environment variables) and
 * `model` (a default model) — as the LOWEST-priority layer: the user's own
 * settings, the system environment, and managed settings ALL override them.
 *
 * SECURITY: a plugin's settings deliberately CANNOT contribute permission rules,
 * hooks, MCP servers, or any security-relevant key — those either have their own
 * dedicated (trust-gated) wiring or must come from the user/managed settings, so
 * a plugin can never widen the permission envelope through `settings.json`. Even
 * so, because `env` can influence tool behavior, collection is trust-gated:
 * only user/local-scope and explicitly-trusted project plugins contribute.
 */

import fs from "fs";
import { discoverPlugins } from "./scopes.js";
import { partitionByTrust, warnUntrustedOnce } from "./trust.js";

export const _deps = { readFileSync: fs.readFileSync };

/** Keys a plugin's settings.json is allowed to contribute (safe subset). */
const SAFE_KEYS = new Set(["env", "model"]);

/**
 * Merge trusted plugins' settings.json into a safe defaults object. A later
 * plugin (in discovery precedence) wins on an env-key / model clash.
 *
 * @param {object} [opts] { cwd, scopes }
 * @returns {{ env: Record<string,string>, model: string|null, sources: string[] }}
 */
export function collectPluginSettings(opts = {}) {
  let plugins = [];
  try {
    plugins = discoverPlugins({ cwd: opts.cwd, scopes: opts.scopes });
  } catch {
    return { env: {}, model: null, sources: [] };
  }
  const { trusted, skipped } = partitionByTrust(plugins);
  warnUntrustedOnce(
    skipped.filter((p) => p.manifest?.components?.settings).map((p) => p.name),
    "settings",
  );
  const env = {};
  let model = null;
  const sources = [];
  for (const p of trusted) {
    if (!p.manifest || p.manifest.ok !== true) continue;
    const s = p.manifest.components?.settings;
    if (!s || !s.absPath) continue;
    let parsed;
    try {
      parsed = JSON.parse(_deps.readFileSync(s.absPath, "utf8"));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      continue;
    let contributed = false;
    // ONLY the safe subset — everything else (permissions/hooks/mcp/…) ignored.
    if (
      SAFE_KEYS.has("env") &&
      parsed.env &&
      typeof parsed.env === "object" &&
      !Array.isArray(parsed.env)
    ) {
      for (const [k, v] of Object.entries(parsed.env)) {
        if (typeof v === "string") {
          env[k] = v;
          contributed = true;
        }
      }
    }
    if (
      SAFE_KEYS.has("model") &&
      typeof parsed.model === "string" &&
      parsed.model.trim()
    ) {
      model = parsed.model.trim();
      contributed = true;
    }
    if (contributed) sources.push(s.absPath);
  }
  return { env, model, sources };
}

/**
 * Apply trusted plugins' default env vars to `env` (defaults to process.env) —
 * but ONLY for keys not already set, so the user's / system's environment always
 * wins. Session-scoped: returns `restore()` + the keys added.
 *
 * @param {object} [opts] { cwd, scopes, env }
 * @returns {{ added: string[], model: string|null, restore: () => void }}
 */
export function applyPluginSettingsEnv(opts = {}) {
  const env = opts.env || process.env;
  const { env: pluginEnv, model } = collectPluginSettings({
    cwd: opts.cwd,
    scopes: opts.scopes,
  });
  const added = [];
  for (const [k, v] of Object.entries(pluginEnv)) {
    if (env[k] === undefined) {
      env[k] = v;
      added.push(k);
    }
  }
  let restored = false;
  return {
    added,
    model,
    restore: () => {
      if (restored) return;
      restored = true;
      for (const k of added) delete env[k];
    },
  };
}
