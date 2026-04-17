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

  program.addCommand(eco);
  return eco;
}
