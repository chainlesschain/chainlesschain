/**
 * Plugin Auto-Discovery — zero-friction file-drop plugin loading.
 *
 * Scans ~/.chainlesschain/plugins/*.js for auto-loadable plugins.
 * Hermes-style: drop a .js file, restart agent, it's available.
 *
 * Plugin exports:
 *   { name, version?, description?, tools?, hooks?, commands? }
 *
 * - tools[]  → injected via extraTools in agent-core
 * - hooks{}  → auto-registered in HookManager
 * - commands{} → added to REPL slash commands
 *
 * DB-registered plugins (plugin-manager.js) override file-drop plugins
 * with the same name.
 *
 * @module plugin-autodiscovery
 */

import { readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { getHomeDir } from "./paths.js";

// ─── Constants ──────────────────────────────────────────────────────

const PLUGINS_DIR_NAME = "plugins";

// ─── Exported for test injection ────────────────────────────────────

export const _deps = {
  readdirSync,
  existsSync,
  mkdirSync,
};

// ─── Path ───────────────────────────────────────────────────────────

/**
 * Get the file-drop plugins directory path.
 * @returns {string}
 */
export function getPluginDir() {
  return join(getHomeDir(), PLUGINS_DIR_NAME);
}

// ─── Validation ─────────────────────────────────────────────────────

/**
 * Validate a plugin's exported shape.
 * @param {object} mod - Module exports
 * @param {string} filePath - Source file (for error messages)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePluginExports(mod, filePath) {
  const errors = [];
  const fname = basename(filePath);

  if (!mod || typeof mod !== "object") {
    return { valid: false, errors: [`${fname}: exports is not an object`] };
  }

  if (!mod.name || typeof mod.name !== "string") {
    errors.push(`${fname}: missing or invalid 'name' (string required)`);
  }

  if (mod.tools && !Array.isArray(mod.tools)) {
    errors.push(`${fname}: 'tools' must be an array`);
  }

  if (mod.hooks && typeof mod.hooks !== "object") {
    errors.push(`${fname}: 'hooks' must be an object`);
  }

  if (mod.commands && typeof mod.commands !== "object") {
    errors.push(`${fname}: 'commands' must be an object`);
  }

  return { valid: errors.length === 0, errors };
}

// ─── Scan ───────────────────────────────────────────────────────────

/**
 * Scan the plugins directory and return .js file paths.
 * @returns {string[]} Array of absolute paths to .js files
 */
export function scanPluginDir() {
  const dir = getPluginDir();
  if (!_deps.existsSync(dir)) {
    return [];
  }

  try {
    const entries = _deps.readdirSync(dir);
    return entries.filter((f) => extname(f) === ".js").map((f) => join(dir, f));
  } catch (_err) {
    return [];
  }
}

// ─── Load ───────────────────────────────────────────────────────────

/**
 * Load a single file-drop plugin.
 * @param {string} filePath - Absolute path to the .js file
 * @returns {Promise<{ plugin: object|null, errors: string[] }>}
 */
export async function loadFileDropPlugin(filePath) {
  try {
    const fileUrl = pathToFileURL(filePath).href;
    const mod = await import(fileUrl);
    // Handle both default export and named exports
    const exports = mod.default || mod;

    const { valid, errors } = validatePluginExports(exports, filePath);
    if (!valid) {
      return { plugin: null, errors };
    }

    return {
      plugin: {
        ...exports,
        source: "file-drop",
        filePath,
      },
      errors: [],
    };
  } catch (err) {
    return {
      plugin: null,
      errors: [`${basename(filePath)}: load failed — ${err.message}`],
    };
  }
}

// ─── Discover All ───────────────────────────────────────────────────

/**
 * Discover and load all file-drop plugins.
 * @param {object} [options]
 * @param {string[]} [options.dbPluginNames] - Names of DB-registered plugins (these take priority)
 * @param {function} [options.onWarn] - Warning callback (message) => void
 * @returns {Promise<{ plugins: object[], errors: string[] }>}
 */
export async function getAutoDiscoveredPlugins(options = {}) {
  const { dbPluginNames = [], onWarn } = options;
  const dbNameSet = new Set(dbPluginNames);
  const files = scanPluginDir();
  const plugins = [];
  const errors = [];

  for (const filePath of files) {
    const result = await loadFileDropPlugin(filePath);
    if (result.errors.length > 0) {
      errors.push(...result.errors);
      if (onWarn) result.errors.forEach((e) => onWarn(e));
      continue;
    }

    // DB-registered plugin with same name takes priority
    if (dbNameSet.has(result.plugin.name)) {
      if (onWarn) {
        onWarn(
          `Plugin "${result.plugin.name}" skipped (DB-registered version takes priority)`,
        );
      }
      continue;
    }

    plugins.push(result.plugin);
  }

  return { plugins, errors };
}

// ─── Tool extraction ────────────────────────────────────────────────

/**
 * Extract tool definitions from loaded file-drop plugins.
 * Returns tools in OpenAI function-calling format.
 * @param {object[]} plugins - Loaded plugins from getAutoDiscoveredPlugins
 * @returns {object[]} Tool definitions ready for extraTools
 */
export function extractPluginTools(plugins) {
  const tools = [];
  for (const plugin of plugins) {
    if (!plugin.tools || !Array.isArray(plugin.tools)) continue;
    for (const tool of plugin.tools) {
      if (tool?.function?.name) {
        tools.push({ ...tool, _pluginSource: plugin.name });
      }
    }
  }
  return tools;
}

/**
 * Extract REPL commands from loaded file-drop plugins.
 * @param {object[]} plugins - Loaded plugins
 * @returns {Map<string, { handler: function, description: string, pluginName: string }>}
 */
export function extractPluginCommands(plugins) {
  const commands = new Map();
  for (const plugin of plugins) {
    if (!plugin.commands || typeof plugin.commands !== "object") continue;
    for (const [cmdName, cmdDef] of Object.entries(plugin.commands)) {
      if (typeof cmdDef === "function") {
        commands.set(cmdName, {
          handler: cmdDef,
          description: "",
          pluginName: plugin.name,
        });
      } else if (cmdDef && typeof cmdDef.handler === "function") {
        commands.set(cmdName, {
          handler: cmdDef.handler,
          description: cmdDef.description || "",
          pluginName: plugin.name,
        });
      }
    }
  }
  return commands;
}
