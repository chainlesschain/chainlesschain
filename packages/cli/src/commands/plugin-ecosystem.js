/**
 * `cc ecosystem` — CLI port of Phase 64 智能插件生态 2.0.
 *
 * Heuristic / record-keeping only — AI recommender, ML code review,
 * real sandbox isolation, packaging and payment gateway stay Desktop.
 */

import { Command } from "commander";

import {
  REVIEW_SEVERITY,
  PUBLISH_STATUS,
  REVENUE_TYPE,
  INSTALL_STATUS,
  DEP_KIND,
  SANDBOX_RESULT,
  ensurePluginEcosystemTables,
  registerPlugin,
  getPlugin,
  listPlugins,
  updatePluginStats,
  addDependency,
  listDependencies,
  resolveDependencies,
  installPlugin,
  listInstalls,
  uninstallPlugin,
  aiReviewCode,
  getReview,
  listReviews,
  recordSandboxTest,
  getSandboxTest,
  listSandboxTests,
  submitForReview,
  approvePlugin,
  rejectPlugin,
  publishPlugin,
  recordRevenue,
  getDeveloperRevenue,
  recommend,
  getConfig,
  getStats,
  // V2
  PLUGIN_MATURITY_V2,
  INSTALL_LIFECYCLE_V2,
  PLUGIN_DEFAULT_MAX_ACTIVE_PER_DEVELOPER,
  PLUGIN_DEFAULT_MAX_PENDING_INSTALLS_PER_USER,
  PLUGIN_DEFAULT_AUTO_DEPRECATE_AFTER_MS,
  PLUGIN_DEFAULT_AUTO_ARCHIVE_AFTER_MS,
  setMaxActivePluginsPerDeveloper,
  setMaxPendingInstallsPerUser,
  setAutoDeprecateAfterMs,
  setAutoArchiveAfterMs,
  getMaxActivePluginsPerDeveloper,
  getMaxPendingInstallsPerUser,
  getAutoDeprecateAfterMs,
  getAutoArchiveAfterMs,
  getActivePluginCount,
  getPendingInstallCount,
  registerPluginV2,
  getMaturityV2,
  setPluginMaturityV2,
  deprecatePlugin,
  archivePluginV2,
  removePluginV2,
  touchPluginActivity,
  submitInstallV2,
  getInstallStatusV2,
  setInstallStatusV2,
  resolveInstall,
  completeInstall,
  failInstall,
  uninstallInstallV2,
  retryFailedInstall,
  autoDeprecateStalePlugins,
  autoArchiveLongDeprecated,
  getEcosystemStatsV2,
} from "../lib/plugin-ecosystem.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

function _json(v) {
  console.log(JSON.stringify(v, null, 2));
}

function _parseJsonArg(s, fallback) {
  if (s == null) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function registerPluginEcosystemCommand(program) {
  const eco = new Command("ecosystem")
    .alias("eco")
    .description(
      "Plugin Ecosystem 2.0 (Phase 64) — registry + deps + install + AI review + publish + revenue + recommend",
    )
    .hook("preAction", (thisCmd) => {
      const db = _dbFromCtx(thisCmd);
      if (db) ensurePluginEcosystemTables(db);
    });

  /* ── Catalogs ────────────────────────────────────── */

  eco
    .command("config")
    .description(
      "Show ecosystem config (severities, statuses, rules, defaults)",
    )
    .action(() => _json(getConfig()));

  eco
    .command("severities")
    .description("List review severities")
    .action(() => _json(Object.values(REVIEW_SEVERITY)));

  eco
    .command("statuses")
    .description("List publish / install statuses")
    .action(() =>
      _json({
        publish: Object.values(PUBLISH_STATUS),
        install: Object.values(INSTALL_STATUS),
        sandbox: Object.values(SANDBOX_RESULT),
      }),
    );

  eco
    .command("revenue-types")
    .description("List revenue event types")
    .action(() => _json(Object.values(REVENUE_TYPE)));

  eco
    .command("dep-kinds")
    .description("List dependency kinds")
    .action(() => _json(Object.values(DEP_KIND)));

  eco
    .command("rules")
    .description("List heuristic AI review rules")
    .action(() => _json(getConfig().reviewRules));

  /* ── Plugin registry ─────────────────────────────── */

  eco
    .command("register")
    .description("Register a new plugin (status=draft)")
    .requiredOption("-n, --name <name>", "Plugin name")
    .requiredOption("-v, --version <ver>", "Plugin version")
    .requiredOption("-d, --developer <id>", "Developer ID")
    .option("-c, --category <cat>", "Category")
    .option("-D, --description <text>", "Description")
    .option("-m, --manifest <json>", "Manifest JSON")
    .action((opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        registerPlugin(db, {
          name: opts.name,
          version: opts.version,
          developerId: opts.developer,
          category: opts.category || null,
          description: opts.description || null,
          manifest: _parseJsonArg(opts.manifest, {}),
        }),
      );
    });

  eco
    .command("plugins")
    .description("List plugins")
    .option("-c, --category <cat>", "Filter by category")
    .option("-s, --status <status>", "Filter by status")
    .option("-d, --developer <id>", "Filter by developer")
    .option("-l, --limit <n>", "Max rows", (v) => parseInt(v, 10), 100)
    .action((opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        listPlugins(db, {
          category: opts.category,
          status: opts.status,
          developerId: opts.developer,
          limit: opts.limit,
        }),
      );
    });

  eco
    .command("show <pluginId>")
    .description("Show plugin details")
    .action((pluginId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      const p = getPlugin(db, pluginId);
      if (!p) return console.error(`Plugin not found: ${pluginId}`);
      _json(p);
    });

  eco
    .command("update-stats <pluginId>")
    .description("Update download count / avg rating")
    .option("-d, --downloads <n>", "Download count", (v) => parseInt(v, 10))
    .option("-r, --rating <r>", "Avg rating", (v) => parseFloat(v))
    .action((pluginId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        updatePluginStats(db, pluginId, {
          downloadCount: opts.downloads ?? null,
          avgRating: opts.rating ?? null,
        }),
      );
    });

  /* ── Dependencies ────────────────────────────────── */

  eco
    .command("dep-add <pluginId>")
    .description("Add a dependency to a plugin")
    .requiredOption("-p, --dep-plugin <id>", "Dependency plugin ID")
    .requiredOption("-v, --dep-version <ver>", "Required version")
    .option(
      "-k, --kind <kind>",
      "Kind (required/optional/peer)",
      DEP_KIND.REQUIRED,
    )
    .action((pluginId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        addDependency(db, pluginId, {
          depPluginId: opts.depPlugin,
          depVersion: opts.depVersion,
          kind: opts.kind,
        }),
      );
    });

  eco
    .command("deps <pluginId>")
    .description("List direct dependencies of a plugin")
    .action((pluginId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(listDependencies(db, pluginId));
    });

  eco
    .command("resolve <pluginId>")
    .description("Resolve dependency tree (detects conflicts + cycles)")
    .action((pluginId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(resolveDependencies(db, pluginId));
    });

  /* ── Installation ────────────────────────────────── */

  eco
    .command("install")
    .description("Install a plugin for a user (auto-fails on cycle/conflict)")
    .requiredOption("-u, --user <id>", "User ID")
    .requiredOption("-p, --plugin <id>", "Plugin ID")
    .option(
      "-v, --version <ver>",
      "Specific version (defaults to plugin version)",
    )
    .option("--no-resolve", "Skip dependency resolution")
    .action((opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        installPlugin(db, {
          userId: opts.user,
          pluginId: opts.plugin,
          version: opts.version || null,
          autoResolveDeps: opts.resolve !== false,
        }),
      );
    });

  eco
    .command("installs")
    .description("List install records")
    .option("-u, --user <id>", "Filter by user")
    .option("-p, --plugin <id>", "Filter by plugin")
    .option("-s, --status <status>", "Filter by status")
    .option("-l, --limit <n>", "Max rows", (v) => parseInt(v, 10), 100)
    .action((opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        listInstalls(db, {
          userId: opts.user,
          pluginId: opts.plugin,
          status: opts.status,
          limit: opts.limit,
        }),
      );
    });

  eco
    .command("uninstall <installId>")
    .description("Mark an install as uninstalled")
    .action((installId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(uninstallPlugin(db, installId));
    });

  /* ── AI review (heuristic) ───────────────────────── */

  eco
    .command("review <pluginId>")
    .description("Run heuristic AI code review (regex rules + score)")
    .option("-c, --code <text>", "Source code (inline)")
    .option(
      "-s, --strictness <level>",
      "lenient | standard | strict",
      "standard",
    )
    .action((pluginId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        aiReviewCode(db, pluginId, {
          sourceCode: opts.code || "",
          strictness: opts.strictness || "standard",
        }),
      );
    });

  eco
    .command("review-show <reviewId>")
    .description("Show a single review record")
    .action((reviewId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      const r = getReview(db, reviewId);
      if (!r) return console.error(`Review not found: ${reviewId}`);
      _json(r);
    });

  eco
    .command("reviews")
    .description("List review records")
    .option("-p, --plugin <id>", "Filter by plugin")
    .option("-s, --severity <level>", "Filter by max severity")
    .option("-l, --limit <n>", "Max rows", (v) => parseInt(v, 10), 100)
    .action((opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        listReviews(db, {
          pluginId: opts.plugin,
          severity: opts.severity,
          limit: opts.limit,
        }),
      );
    });

  /* ── Sandbox tests ───────────────────────────────── */

  eco
    .command("sandbox <pluginId>")
    .description("Record a sandbox test result (caller pushes outcome)")
    .option("-t, --test-suite <name>", "Test suite name", "default")
    .option(
      "-r, --result <value>",
      "Result (passed/failed/timeout/resource-exceeded)",
      SANDBOX_RESULT.PASSED,
    )
    .option("-m, --metrics <json>", "Metrics as JSON")
    .option("-L, --logs <json>", "Logs array as JSON")
    .option("-d, --duration <ms>", "Duration in ms", (v) => parseInt(v, 10))
    .action((pluginId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        recordSandboxTest(db, pluginId, {
          testSuite: opts.testSuite,
          result: opts.result,
          metrics: _parseJsonArg(opts.metrics, {}),
          logs: _parseJsonArg(opts.logs, []),
          durationMs: opts.duration ?? null,
        }),
      );
    });

  eco
    .command("sandbox-show <testId>")
    .description("Show a single sandbox test record")
    .action((testId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      const t = getSandboxTest(db, testId);
      if (!t) return console.error(`Sandbox test not found: ${testId}`);
      _json(t);
    });

  eco
    .command("sandbox-tests")
    .description("List sandbox test records")
    .option("-p, --plugin <id>", "Filter by plugin")
    .option("-r, --result <value>", "Filter by result")
    .option("-l, --limit <n>", "Max rows", (v) => parseInt(v, 10), 100)
    .action((opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        listSandboxTests(db, {
          pluginId: opts.plugin,
          result: opts.result,
          limit: opts.limit,
        }),
      );
    });

  /* ── Publish flow ────────────────────────────────── */

  eco
    .command("submit <pluginId>")
    .description("Submit a plugin for review (draft/rejected → reviewing)")
    .action((pluginId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(submitForReview(db, pluginId));
    });

  eco
    .command("approve <pluginId>")
    .description("Approve a reviewing plugin")
    .action((pluginId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(approvePlugin(db, pluginId));
    });

  eco
    .command("reject <pluginId>")
    .description(
      "Reject a reviewing plugin (appends a rejection review record)",
    )
    .option("-r, --reason <text>", "Rejection reason")
    .action((pluginId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(rejectPlugin(db, pluginId, opts.reason || "review rejected"));
    });

  eco
    .command("publish <pluginId>")
    .description("Publish an approved plugin (computes sourceHash)")
    .option("-c, --code <text>", "Source code for hashing")
    .option("-l, --changelog <text>", "Changelog note")
    .action((pluginId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        publishPlugin(db, pluginId, {
          sourceCode: opts.code || "",
          changelog: opts.changelog || "",
        }),
      );
    });

  /* ── Revenue ─────────────────────────────────────── */

  eco
    .command("rev-record")
    .description("Record a revenue event (splits via developerShareRatio)")
    .requiredOption("-d, --developer <id>", "Developer ID")
    .requiredOption("-p, --plugin <id>", "Plugin ID")
    .requiredOption(
      "-t, --type <type>",
      "Type (download/subscription/donation/premium)",
    )
    .requiredOption("-a, --amount <n>", "Amount (gross)", (v) => parseFloat(v))
    .option("-u, --user <id>", "User ID")
    .option("-r, --ratio <n>", "Developer share ratio (0-1)", (v) =>
      parseFloat(v),
    )
    .action((opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      const rec = {
        developerId: opts.developer,
        pluginId: opts.plugin,
        userId: opts.user || null,
        type: opts.type,
        amount: opts.amount,
      };
      if (opts.ratio != null) rec.developerShareRatio = opts.ratio;
      _json(recordRevenue(db, rec));
    });

  eco
    .command("revenue <developerId>")
    .description("Aggregate a developer's revenue")
    .option("-p, --plugin <id>", "Filter by plugin")
    .option("--from <ts>", "Unix ms >= from", (v) => parseInt(v, 10))
    .option("--to <ts>", "Unix ms <= to", (v) => parseInt(v, 10))
    .action((developerId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(
        getDeveloperRevenue(db, developerId, {
          from: opts.from ?? null,
          to: opts.to ?? null,
          pluginId: opts.plugin || null,
        }),
      );
    });

  /* ── Recommendation ──────────────────────────────── */

  eco
    .command("recommend")
    .description("Heuristic plugin recommendations for a user")
    .requiredOption("-u, --user <id>", "User ID")
    .option("-c, --category <cat>", "Restrict to a category")
    .option("-l, --limit <n>", "Max recommendations", (v) => parseInt(v, 10))
    .action((opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      const arg = { userId: opts.user };
      if (opts.category) arg.category = opts.category;
      if (opts.limit != null) arg.limit = opts.limit;
      _json(recommend(db, arg));
    });

  /* ── Stats ───────────────────────────────────────── */

  eco
    .command("stats")
    .description("Show ecosystem stats")
    .action((_opts, cmd) => {
      const db = _dbFromCtx(cmd);
      if (!db) return console.error("No database");
      _json(getStats(db));
    });

  /* ── Phase 64 V2 ──────────────────────────────────── */

  eco
    .command("maturity-statuses-v2")
    .description("List V2 plugin maturity statuses")
    .action(() => _json(Object.values(PLUGIN_MATURITY_V2)));

  eco
    .command("install-lifecycle-v2")
    .description("List V2 install lifecycle statuses")
    .action(() => _json(Object.values(INSTALL_LIFECYCLE_V2)));

  eco
    .command("default-max-active-plugins-per-developer")
    .description("Show V2 default max active plugins per developer")
    .action(() => _json(PLUGIN_DEFAULT_MAX_ACTIVE_PER_DEVELOPER));

  eco
    .command("max-active-plugins-per-developer")
    .description("Show current V2 max active plugins per developer")
    .action(() => _json(getMaxActivePluginsPerDeveloper()));

  eco
    .command("set-max-active-plugins-per-developer <n>")
    .description("Set V2 max active plugins per developer")
    .action((n) => _json(setMaxActivePluginsPerDeveloper(Number(n))));

  eco
    .command("default-max-pending-installs-per-user")
    .description("Show V2 default max pending installs per user")
    .action(() => _json(PLUGIN_DEFAULT_MAX_PENDING_INSTALLS_PER_USER));

  eco
    .command("max-pending-installs-per-user")
    .description("Show current V2 max pending installs per user")
    .action(() => _json(getMaxPendingInstallsPerUser()));

  eco
    .command("set-max-pending-installs-per-user <n>")
    .description("Set V2 max pending installs per user")
    .action((n) => _json(setMaxPendingInstallsPerUser(Number(n))));

  eco
    .command("default-auto-deprecate-after-ms")
    .description("Show V2 default auto-deprecate threshold (ms)")
    .action(() => _json(PLUGIN_DEFAULT_AUTO_DEPRECATE_AFTER_MS));

  eco
    .command("auto-deprecate-after-ms")
    .description("Show current V2 auto-deprecate threshold (ms)")
    .action(() => _json(getAutoDeprecateAfterMs()));

  eco
    .command("set-auto-deprecate-after-ms <ms>")
    .description("Set V2 auto-deprecate threshold (ms)")
    .action((ms) => _json(setAutoDeprecateAfterMs(Number(ms))));

  eco
    .command("default-auto-archive-after-ms")
    .description("Show V2 default auto-archive threshold (ms)")
    .action(() => _json(PLUGIN_DEFAULT_AUTO_ARCHIVE_AFTER_MS));

  eco
    .command("auto-archive-after-ms")
    .description("Show current V2 auto-archive threshold (ms)")
    .action(() => _json(getAutoArchiveAfterMs()));

  eco
    .command("set-auto-archive-after-ms <ms>")
    .description("Set V2 auto-archive threshold (ms)")
    .action((ms) => _json(setAutoArchiveAfterMs(Number(ms))));

  eco
    .command("active-plugin-count")
    .description("Count V2 active plugins (optionally scoped)")
    .option("-d, --developer <id>", "Filter by developer ID")
    .action((opts) => _json(getActivePluginCount(opts.developer)));

  eco
    .command("pending-install-count")
    .description("Count V2 pending+resolving installs (optionally scoped)")
    .option("-u, --user <id>", "Filter by user ID")
    .action((opts) => _json(getPendingInstallCount(opts.user)));

  eco
    .command("register-plugin-v2 <plugin-id>")
    .description("Register V2 plugin (status=active)")
    .requiredOption("-d, --developer <id>", "Developer ID")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((pluginId, opts) => {
      _json(
        registerPluginV2(null, {
          pluginId,
          developerId: opts.developer,
          metadata: _parseJsonArg(opts.metadata, undefined),
        }),
      );
    });

  eco
    .command("maturity-v2 <plugin-id>")
    .description("Show V2 plugin maturity")
    .action((pluginId) => _json(getMaturityV2(pluginId)));

  eco
    .command("set-maturity-v2 <plugin-id> <status>")
    .description("Transition V2 plugin maturity")
    .option("-r, --reason <text>", "Reason")
    .option("-m, --metadata <json>", "Metadata JSON to merge")
    .action((pluginId, status, opts) => {
      _json(
        setPluginMaturityV2(null, pluginId, status, {
          reason: opts.reason,
          metadata: _parseJsonArg(opts.metadata, undefined),
        }),
      );
    });

  eco
    .command("deprecate-plugin <plugin-id>")
    .description("Deprecate V2 plugin")
    .option("-r, --reason <text>", "Reason")
    .action((pluginId, opts) =>
      _json(deprecatePlugin(null, pluginId, opts.reason)),
    );

  eco
    .command("archive-plugin-v2 <plugin-id>")
    .description("Archive V2 plugin")
    .option("-r, --reason <text>", "Reason")
    .action((pluginId, opts) =>
      _json(archivePluginV2(null, pluginId, opts.reason)),
    );

  eco
    .command("remove-plugin-v2 <plugin-id>")
    .description("Remove V2 plugin (terminal)")
    .option("-r, --reason <text>", "Reason")
    .action((pluginId, opts) =>
      _json(removePluginV2(null, pluginId, opts.reason)),
    );

  eco
    .command("touch-plugin-activity <plugin-id>")
    .description("Bump lastActivityAt for V2 plugin")
    .action((pluginId) => _json(touchPluginActivity(pluginId)));

  eco
    .command("submit-install-v2 <install-id>")
    .description("Submit V2 install (status=pending)")
    .requiredOption("-u, --user <id>", "User ID")
    .requiredOption("-p, --plugin <id>", "Plugin ID")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((installId, opts) => {
      _json(
        submitInstallV2(null, {
          installId,
          userId: opts.user,
          pluginId: opts.plugin,
          metadata: _parseJsonArg(opts.metadata, undefined),
        }),
      );
    });

  eco
    .command("install-status-v2 <install-id>")
    .description("Show V2 install status")
    .action((installId) => _json(getInstallStatusV2(installId)));

  eco
    .command("set-install-status-v2 <install-id> <status>")
    .description("Transition V2 install status")
    .option("-r, --reason <text>", "Reason")
    .option("-m, --metadata <json>", "Metadata JSON to merge")
    .action((installId, status, opts) => {
      _json(
        setInstallStatusV2(null, installId, status, {
          reason: opts.reason,
          metadata: _parseJsonArg(opts.metadata, undefined),
        }),
      );
    });

  eco
    .command("resolve-install <install-id>")
    .description("Mark V2 install as resolving")
    .option("-r, --reason <text>", "Reason")
    .action((installId, opts) =>
      _json(resolveInstall(null, installId, opts.reason)),
    );

  eco
    .command("complete-install <install-id>")
    .description("Mark V2 install as installed")
    .option("-r, --reason <text>", "Reason")
    .action((installId, opts) =>
      _json(completeInstall(null, installId, opts.reason)),
    );

  eco
    .command("fail-install <install-id>")
    .description("Mark V2 install as failed")
    .option("-r, --reason <text>", "Reason")
    .action((installId, opts) =>
      _json(failInstall(null, installId, opts.reason)),
    );

  eco
    .command("uninstall-install-v2 <install-id>")
    .description("Mark V2 install as uninstalled (terminal)")
    .option("-r, --reason <text>", "Reason")
    .action((installId, opts) =>
      _json(uninstallInstallV2(null, installId, opts.reason)),
    );

  eco
    .command("retry-failed-install <install-id>")
    .description("Retry a failed V2 install (failed → pending)")
    .option("-r, --reason <text>", "Reason")
    .action((installId, opts) =>
      _json(retryFailedInstall(null, installId, opts.reason)),
    );

  eco
    .command("auto-deprecate-stale-plugins")
    .description("Bulk-flip stale V2 ACTIVE plugins to DEPRECATED")
    .action(() => _json(autoDeprecateStalePlugins(null)));

  eco
    .command("auto-archive-long-deprecated")
    .description("Bulk-flip long-deprecated V2 plugins to ARCHIVED")
    .action(() => _json(autoArchiveLongDeprecated(null)));

  eco
    .command("stats-v2")
    .description("Show V2 ecosystem stats (maturity + install)")
    .action(() => _json(getEcosystemStatsV2()));

  program.addCommand(eco);
  return eco;
}

// === Iter24 V2 governance overlay ===
export function registerEcogovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "ecosystem");
  if (!parent) return;
  const L = async () => await import("../lib/plugin-ecosystem.js");
  parent
    .command("ecogov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.ECOGOV_PROFILE_MATURITY_V2,
            installLifecycle: m.ECOGOV_INSTALL_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ecogov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveEcogovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingEcogovInstallsPerProfileV2(),
            idleMs: m.getEcogovProfileIdleMsV2(),
            stuckMs: m.getEcogovInstallStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ecogov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveEcogovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ecogov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingEcogovInstallsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ecogov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setEcogovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ecogov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setEcogovInstallStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ecogov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--category <v>", "category")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerEcogovProfileV2({ id, owner, category: o.category }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ecogov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateEcogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ecogov-disable-v2 <id>")
    .description("Disable profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).disableEcogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ecogov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveEcogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ecogov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchEcogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ecogov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getEcogovProfileV2(id), null, 2));
    });
  parent
    .command("ecogov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listEcogovProfilesV2(), null, 2));
    });
  parent
    .command("ecogov-create-install-v2 <id> <profileId>")
    .description("Create install")
    .option("--version <v>", "version")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createEcogovInstallV2({ id, profileId, version: o.version }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ecogov-installing-install-v2 <id>")
    .description("Mark install as installing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).installingEcogovInstallV2(id), null, 2),
      );
    });
  parent
    .command("ecogov-complete-install-v2 <id>")
    .description("Complete install")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeInstallEcogovV2(id), null, 2),
      );
    });
  parent
    .command("ecogov-fail-install-v2 <id> [reason]")
    .description("Fail install")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failEcogovInstallV2(id, reason), null, 2),
      );
    });
  parent
    .command("ecogov-cancel-install-v2 <id> [reason]")
    .description("Cancel install")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelEcogovInstallV2(id, reason), null, 2),
      );
    });
  parent
    .command("ecogov-get-install-v2 <id>")
    .description("Get install")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getEcogovInstallV2(id), null, 2));
    });
  parent
    .command("ecogov-list-installs-v2")
    .description("List installs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listEcogovInstallsV2(), null, 2));
    });
  parent
    .command("ecogov-auto-disable-idle-v2")
    .description("Auto-disable idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoDisableIdleEcogovProfilesV2(), null, 2),
      );
    });
  parent
    .command("ecogov-auto-fail-stuck-v2")
    .description("Auto-fail stuck installs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckEcogovInstallsV2(), null, 2),
      );
    });
  parent
    .command("ecogov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getPluginEcosystemGovStatsV2(), null, 2),
      );
    });
}
