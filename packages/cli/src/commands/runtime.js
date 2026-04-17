/**
 * `cc runtime` — CLI surface for Phase 63 Universal Runtime.
 *
 * Exposes plugin lifecycle, hot update/rollback, profiling,
 * state sync, platform info, health check, metrics, configure.
 */

import { Command } from "commander";

import {
  PLUGIN_STATUS,
  UPDATE_TYPE,
  HEALTH_STATUS,
  PROFILE_TYPES,
  ensureRuntimeTables,
  loadPlugin,
  unloadPlugin,
  setPluginStatus,
  getPlugin,
  listPlugins,
  hotUpdate,
  rollbackUpdate,
  listUpdates,
  takeProfile,
  getProfile,
  listProfiles,
  setState,
  getState,
  listState,
  deleteState,
  configure,
  getConfig,
  getPlatformInfo,
  healthCheck,
  getMetrics,
  getRuntimeStats,
} from "../lib/universal-runtime.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

function _parseJson(raw) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return raw;
  }
}

export function registerRuntimeCommand(program) {
  const runtime = new Command("runtime")
    .description("Universal application runtime (Phase 63)")
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensureRuntimeTables(db);
    });

  /* ── Catalogs ─────────────────────────────────────── */

  runtime
    .command("plugin-statuses")
    .description("List plugin lifecycle statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const statuses = Object.values(PLUGIN_STATUS);
      if (opts.json) return console.log(JSON.stringify(statuses, null, 2));
      for (const s of statuses) console.log(`  ${s}`);
    });

  runtime
    .command("update-types")
    .description("List update types (patch/minor/major/rollback)")
    .option("--json", "JSON output")
    .action((opts) => {
      const types = Object.values(UPDATE_TYPE);
      if (opts.json) return console.log(JSON.stringify(types, null, 2));
      for (const t of types) console.log(`  ${t}`);
    });

  runtime
    .command("health-levels")
    .description("List health levels")
    .option("--json", "JSON output")
    .action((opts) => {
      const levels = Object.values(HEALTH_STATUS);
      if (opts.json) return console.log(JSON.stringify(levels, null, 2));
      for (const l of levels) console.log(`  ${l}`);
    });

  runtime
    .command("profile-types")
    .description("List profile sample types (cpu/memory/flamegraph)")
    .option("--json", "JSON output")
    .action((opts) => {
      if (opts.json) return console.log(JSON.stringify(PROFILE_TYPES, null, 2));
      for (const t of PROFILE_TYPES) console.log(`  ${t}`);
    });

  /* ── Plugin lifecycle ─────────────────────────────── */

  runtime
    .command("plugin-load")
    .description("Load a plugin")
    .requiredOption("-n, --name <name>", "Plugin name")
    .option("-v, --version <version>", "Version", "1.0.0")
    .option("-c, --config <json>", "Config JSON")
    .option("-a, --apis <json>", "Exposed APIs JSON array")
    .option("-p, --permissions <json>", "Permissions JSON array")
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(runtime);
      const result = loadPlugin(db, {
        name: opts.name,
        version: opts.version,
        config: opts.config ? _parseJson(opts.config) : undefined,
        apis: opts.apis ? _parseJson(opts.apis) : undefined,
        permissions: opts.permissions
          ? _parseJson(opts.permissions)
          : undefined,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.loaded
          ? `Plugin loaded: ${result.pluginId}`
          : `Failed: ${result.reason}`,
      );
    });

  runtime
    .command("plugin-unload <id>")
    .description("Unload a plugin")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(runtime);
      const result = unloadPlugin(db, id);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.unloaded ? "Plugin unloaded." : `Failed: ${result.reason}`,
      );
    });

  runtime
    .command("plugin-status <id> <status>")
    .description("Set plugin status (loading/active/suspended/error/unloaded)")
    .option("--json", "JSON output")
    .action((id, status, opts) => {
      const db = _dbFromCtx(runtime);
      const result = setPluginStatus(db, id, status);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.updated ? "Plugin status updated." : `Failed: ${result.reason}`,
      );
    });

  runtime
    .command("plugin-show <id>")
    .description("Show plugin details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(runtime);
      const p = getPlugin(db, id);
      if (!p) return console.log("Plugin not found.");
      if (opts.json) return console.log(JSON.stringify(p, null, 2));
      console.log(`ID:        ${p.id}`);
      console.log(`Name:      ${p.name}`);
      console.log(`Version:   ${p.version}`);
      console.log(`Status:    ${p.status}`);
      if (p.config) console.log(`Config:    ${p.config}`);
      if (p.apis) console.log(`APIs:      ${p.apis}`);
      if (p.permissions) console.log(`Perms:     ${p.permissions}`);
      if (p.loaded_at)
        console.log(`Loaded:    ${new Date(p.loaded_at).toISOString()}`);
    });

  runtime
    .command("plugins")
    .description("List plugins")
    .option("-s, --status <status>", "Filter by status")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(runtime);
      const results = listPlugins(db, {
        status: opts.status,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(results, null, 2));
      if (results.length === 0) return console.log("No plugins.");
      for (const p of results) {
        console.log(
          `  ${p.status.padEnd(10)} ${p.version.padEnd(8)} ${p.name.padEnd(24)} ${p.id.slice(0, 14)}`,
        );
      }
    });

  /* ── Hot update ───────────────────────────────────── */

  runtime
    .command("hot-update <pluginId> <newVersion>")
    .description("Apply a hot update to a plugin")
    .option("-t, --type <type>", "Update type override (patch/minor/major)")
    .option("--json", "JSON output")
    .action((pluginId, newVersion, opts) => {
      const db = _dbFromCtx(runtime);
      const result = hotUpdate(db, pluginId, newVersion, {
        updateType: opts.type,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.updated) {
        console.log(
          `Updated ${pluginId}: ${result.fromVersion} → ${result.toVersion} (${result.updateType})`,
        );
      } else {
        console.log(`Failed: ${result.reason}`);
      }
    });

  runtime
    .command("rollback <updateId>")
    .description("Roll back a previous update")
    .option("--json", "JSON output")
    .action((updateId, opts) => {
      const db = _dbFromCtx(runtime);
      const result = rollbackUpdate(db, updateId);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.rolledBack) {
        console.log(
          `Rolled back: ${result.fromVersion} → ${result.toVersion} (${result.rollbackId})`,
        );
      } else {
        console.log(`Failed: ${result.reason}`);
      }
    });

  runtime
    .command("updates")
    .description("List updates")
    .option("-p, --plugin <id>", "Filter by plugin id")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(runtime);
      const results = listUpdates(db, {
        pluginId: opts.plugin,
        limit: opts.limit,
      });
      if (opts.json) return console.log(JSON.stringify(results, null, 2));
      if (results.length === 0) return console.log("No updates.");
      for (const u of results) {
        console.log(
          `  ${u.update_type.padEnd(9)} ${(u.from_version || "-").padEnd(8)} → ${(u.to_version || "-").padEnd(8)}  ${u.plugin_id.slice(0, 14)}  ${u.id.slice(0, 14)}`,
        );
      }
    });

  /* ── Profile ──────────────────────────────────────── */

  runtime
    .command("profile")
    .description("Take a runtime profile sample")
    .option("-t, --type <type>", "Profile type (cpu/memory/flamegraph)", "cpu")
    .option("-d, --duration <ms>", "Duration in ms", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(runtime);
      const result = takeProfile(db, {
        type: opts.type,
        duration: opts.duration,
      });
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      if (result.taken) {
        console.log(`Profile: ${result.profileId} (${result.type})`);
      } else {
        console.log(`Failed: ${result.reason}`);
      }
    });

  runtime
    .command("profile-show <id>")
    .description("Show profile details")
    .option("--json", "JSON output")
    .action((id, opts) => {
      const db = _dbFromCtx(runtime);
      const p = getProfile(db, id);
      if (!p) return console.log("Profile not found.");
      if (opts.json) return console.log(JSON.stringify(p, null, 2));
      console.log(`ID:       ${p.id}`);
      console.log(`Type:     ${p.profile_type}`);
      console.log(`Duration: ${p.duration_ms}ms`);
      console.log(`Created:  ${new Date(p.created_at).toISOString()}`);
      if (p.data) {
        console.log(`Data:`);
        console.log(JSON.stringify(p.data, null, 2));
      }
    });

  runtime
    .command("profiles")
    .description("List profiles")
    .option("-t, --type <type>", "Filter by profile type")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(runtime);
      const results = listProfiles(db, { type: opts.type, limit: opts.limit });
      if (opts.json) return console.log(JSON.stringify(results, null, 2));
      if (results.length === 0) return console.log("No profiles.");
      for (const p of results) {
        console.log(
          `  ${p.profile_type.padEnd(11)} ${String(p.duration_ms).padEnd(8)}ms  ${p.id.slice(0, 14)}`,
        );
      }
    });

  /* ── State sync ───────────────────────────────────── */

  runtime
    .command("state-set <key> <value>")
    .description("Set a synced state value (JSON or string)")
    .option("--json", "JSON output")
    .action((key, value, opts) => {
      const db = _dbFromCtx(runtime);
      const parsed = _parseJson(value);
      const result = setState(db, key, parsed);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.set ? `State set: ${key}` : `Failed: ${result.reason}`,
      );
    });

  runtime
    .command("state-get <key>")
    .description("Get a synced state value")
    .option("--json", "JSON output")
    .action((key, opts) => {
      const db = _dbFromCtx(runtime);
      const result = getState(db, key);
      if (!result) return console.log("Key not found.");
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        `${key} = ${typeof result.value === "string" ? result.value : JSON.stringify(result.value)}`,
      );
    });

  runtime
    .command("state-list")
    .description("List synced state keys")
    .option("--limit <n>", "Max results", parseInt)
    .option("--json", "JSON output")
    .action((opts) => {
      const db = _dbFromCtx(runtime);
      const results = listState(db, { limit: opts.limit });
      if (opts.json) return console.log(JSON.stringify(results, null, 2));
      if (results.length === 0) return console.log("No state.");
      for (const s of results) {
        const val =
          typeof s.value === "string" ? s.value : JSON.stringify(s.value);
        console.log(`  ${s.key.padEnd(24)} ${val}`);
      }
    });

  runtime
    .command("state-delete <key>")
    .description("Delete a synced state entry")
    .option("--json", "JSON output")
    .action((key, opts) => {
      const db = _dbFromCtx(runtime);
      const result = deleteState(db, key);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(result.deleted ? "Deleted." : `Failed: ${result.reason}`);
    });

  /* ── Platform / health / metrics ──────────────────── */

  runtime
    .command("platform")
    .description("Show platform info")
    .option("--json", "JSON output")
    .action((opts) => {
      const info = getPlatformInfo();
      if (opts.json) return console.log(JSON.stringify(info, null, 2));
      console.log(`Platform:       ${info.platform}`);
      console.log(`Arch:           ${info.arch}`);
      console.log(`Node:           ${info.nodeVersion}`);
      if (info.electronVersion)
        console.log(`Electron:       ${info.electronVersion}`);
      console.log(`PID:            ${info.pid}`);
      console.log(`CPUs:           ${info.cpus}`);
      console.log(`Total memory:   ${info.totalMemoryBytes} bytes`);
      console.log(`Free memory:    ${info.freeMemoryBytes} bytes`);
      if (info.hostname) console.log(`Host:           ${info.hostname}`);
      console.log(`Uptime (proc):  ${info.processUptimeMs}ms`);
      console.log(`Heap used:      ${info.heapUsed} bytes`);
    });

  runtime
    .command("health")
    .description("Run a runtime health check")
    .option("--json", "JSON output")
    .action((opts) => {
      const h = healthCheck();
      if (opts.json) return console.log(JSON.stringify(h, null, 2));
      console.log(`Status:    ${h.status}`);
      console.log(`Uptime:    ${h.uptimeMs}ms`);
      console.log(
        `Heap:      ${h.memory.heapUsed}/${h.memory.limitBytes} (${(h.memory.heapRatio * 100).toFixed(2)}%)`,
      );
      console.log(
        `Plugins:   total=${h.plugins.total} active=${h.plugins.active} errors=${h.plugins.errors}`,
      );
      console.log(`Errors:    ${h.errors}`);
    });

  runtime
    .command("metrics")
    .description("Show runtime metrics")
    .option("--json", "JSON output")
    .action((opts) => {
      const m = getMetrics();
      if (opts.json) return console.log(JSON.stringify(m, null, 2));
      console.log(`Uptime:            ${m.uptimeMs}ms`);
      console.log(`Plugins loaded:    ${m.pluginsLoaded}`);
      console.log(`Plugins unloaded:  ${m.pluginsUnloaded}`);
      console.log(`Hot updates:       ${m.hotUpdates}`);
      console.log(`Rollbacks:         ${m.rollbacks}`);
      console.log(`Profiles taken:    ${m.profilesTaken}`);
      console.log(`State writes:      ${m.stateWrites}`);
      console.log(`Active plugins:    ${m.activePlugins}`);
      console.log(`Total plugins:     ${m.totalPlugins}`);
      console.log(`Total updates:     ${m.totalUpdates}`);
      console.log(`Total profiles:    ${m.totalProfiles}`);
      console.log(`State keys:        ${m.stateKeys}`);
      console.log(`Errors:            ${m.errors}`);
    });

  /* ── Configure ────────────────────────────────────── */

  runtime
    .command("configure <key> <value>")
    .description("Update a runtime config key (JSON or string)")
    .option("--json", "JSON output")
    .action((key, value, opts) => {
      const db = _dbFromCtx(runtime);
      const parsed = _parseJson(value);
      const result = configure(db, key, parsed);
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        result.configured
          ? `Configured: ${key} = ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`
          : `Failed: ${result.reason}`,
      );
    });

  runtime
    .command("config")
    .description("Show current runtime config")
    .option("--json", "JSON output")
    .action((opts) => {
      const c = getConfig();
      if (opts.json) return console.log(JSON.stringify(c, null, 2));
      for (const [k, v] of Object.entries(c)) {
        console.log(
          `  ${k.padEnd(24)} ${typeof v === "string" ? v : JSON.stringify(v)}`,
        );
      }
    });

  /* ── Stats ────────────────────────────────────────── */

  runtime
    .command("stats")
    .description("Runtime statistics (plugins/updates/profiles/state counts)")
    .option("--json", "JSON output")
    .action((opts) => {
      const s = getRuntimeStats();
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(
        `Plugins: ${s.plugins} · Updates: ${s.updates} · Profiles: ${s.profiles} · State: ${s.state}`,
      );
      console.log(`By plugin status:`);
      for (const [k, v] of Object.entries(s.byPluginStatus)) {
        if (v > 0) console.log(`  ${k.padEnd(10)} ${v}`);
      }
      console.log(`By update type:`);
      for (const [k, v] of Object.entries(s.byUpdateType)) {
        if (v > 0) console.log(`  ${k.padEnd(10)} ${v}`);
      }
      console.log(`By profile type:`);
      for (const [k, v] of Object.entries(s.byProfileType)) {
        if (v > 0) console.log(`  ${k.padEnd(11)} ${v}`);
      }
      console.log(`Health:   ${s.health.status}`);
      console.log(`Uptime:   ${s.metrics.uptimeMs}ms`);
    });

  program.addCommand(runtime);
}
