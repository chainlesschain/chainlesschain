/**
 * @deprecated — canonical implementation lives in `../harness/plugin-manager.js`
 * as of the CLI Runtime Convergence roadmap (Phase 4, 2026-04-09).
 * This file is retained as a re-export shim for backwards compatibility
 * and will be removed once all external consumers have migrated.
 *
 * Please import plugin manager functions directly from
 * `packages/cli/src/harness/plugin-manager.js` in new code.
 */

export {
  ensurePluginTables,
  installPlugin,
  getPlugin,
  getPluginById,
  listPlugins,
  enablePlugin,
  disablePlugin,
  removePlugin,
  updatePlugin,
  setPluginSetting,
  getPluginSetting,
  getPluginSettings,
  registerInMarketplace,
  searchRegistry,
  listRegistry,
  getPluginSummary,
  installPluginSkills,
  removePluginSkills,
  getPluginSkills,
} from "../harness/plugin-manager.js";
