/**
 * Personal Data Hub — CLI subcommand surface.
 *
 * Exposes the same operations the WS gateway (gateways/ws/personal-data-
 * hub-protocol.js) handles, so `cc hub <verb>` works identically across:
 *   - Desktop in-app terminal (Phase 2.5 cc bundle)
 *   - `cc ui` web-shell (WS topic personal-data-hub.* — peer to this)
 *   - Direct CLI invocation (this file)
 *
 * Plan A v0.1 Sub-Phase A3.1. Real-device verified on Xiaomi 24115RA8EC
 * 2026-05-20 via cc-smoke.js (T1/T2/T3 PASS) — bs3mc + SQLCipher vault
 * proven working in-app. This command surface is what makes those
 * capabilities usable without writing JS.
 *
 * All output supports --json for scripting. Default is human-readable.
 */

import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import { getHub } from "../lib/personal-data-hub-wiring.js";

function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function fail(spinner, err, asJson) {
  if (spinner) spinner.stop();
  const msg = err && err.message ? err.message : String(err);
  if (asJson) {
    printJson({ error: msg });
  } else {
    logger.error(chalk.red(`✗ ${msg}`));
  }
  process.exit(1);
}

// ─── ask ──────────────────────────────────────────────────────────────

async function cmdAsk(question, options) {
  const spinner = options.json ? null : ora("Asking hub...").start();
  try {
    const hub = await getHub();
    if (!hub.engine) throw new Error("Analysis engine unavailable");
    const result = await hub.engine.ask(question, {
      useRag: options.useRag !== false,
      acceptNonLocal: !!options.acceptNonLocal,
    });
    if (spinner) spinner.stop();
    if (options.json) {
      printJson(result);
    } else {
      if (result.error) {
        logger.error(chalk.red(`✗ ${result.error}`));
        process.exit(1);
      }
      logger.log(result.answer);
      if (result.citations && result.citations.length) {
        logger.log(
          chalk.gray(
            `\n依据: ${result.citations.map((c) => c.eventId).join(", ")}`,
          ),
        );
      }
      if (result.llmName) {
        const localTag = result.isLocal
          ? chalk.green("[local]")
          : chalk.yellow("[remote]");
        logger.log(chalk.gray(`-- ${result.llmName} ${localTag}`));
      }
    }
  } catch (err) {
    fail(spinner, err, options.json);
  }
}

// ─── stats ────────────────────────────────────────────────────────────

async function cmdStats(options) {
  try {
    const hub = await getHub();
    const out = {
      vault: hub.vault.stats(),
      adapters: hub.registry.list(),
      hubDir: hub.hubDir,
      llm: hub.llm ? { name: hub.llm.name, isLocal: hub.llm.isLocal } : null,
    };
    if (options.json) {
      printJson(out);
    } else {
      const v = out.vault;
      logger.log(chalk.bold("vault:"));
      logger.log(`  events:   ${v.events}`);
      logger.log(`  persons:  ${v.persons}`);
      logger.log(`  places:   ${v.places}`);
      logger.log(`  items:    ${v.items}`);
      logger.log(`  topics:   ${v.topics}`);
      logger.log(chalk.bold(`\nadapters (${out.adapters.length}):`));
      for (const a of out.adapters) {
        logger.log(`  ${chalk.cyan(a.name)} v${a.version}`);
      }
      logger.log(chalk.gray(`\nhubDir: ${out.hubDir}`));
      if (out.llm) {
        const tag = out.llm.isLocal
          ? chalk.green("[local]")
          : chalk.yellow("[remote]");
        logger.log(chalk.gray(`llm: ${out.llm.name} ${tag}`));
      } else {
        logger.log(chalk.yellow("llm: (none)"));
      }
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

// ─── health ───────────────────────────────────────────────────────────

async function cmdHealth(options) {
  try {
    const hub = await getHub();
    const out = {
      vault: {
        ok: !!hub.vault.db,
        schemaVersion: hub.vault.schemaVersion(),
      },
      llm: hub.llm
        ? { ok: true, isLocal: hub.llm.isLocal, name: hub.llm.name }
        : { ok: false, reason: "LLM unavailable" },
      kgSink: { ok: !!hub.kgSink },
      ragSink: { ok: !!hub.ragSink },
    };
    if (options.json) {
      printJson(out);
    } else {
      const mark = (ok) => (ok ? chalk.green("✓") : chalk.red("✗"));
      logger.log(
        `${mark(out.vault.ok)} vault    schema=${out.vault.schemaVersion}`,
      );
      logger.log(
        `${mark(out.llm.ok)} llm      ${out.llm.name || out.llm.reason}${
          out.llm.ok
            ? out.llm.isLocal
              ? chalk.green(" [local]")
              : chalk.yellow(" [remote]")
            : ""
        }`,
      );
      logger.log(`${mark(out.kgSink.ok)} kgSink`);
      logger.log(`${mark(out.ragSink.ok)} ragSink`);
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

// ─── list-adapters ────────────────────────────────────────────────────

async function cmdListAdapters(options) {
  try {
    const hub = await getHub();
    const adapters = hub.registry.list();
    if (options.json) {
      printJson(adapters);
    } else {
      if (!adapters.length) {
        logger.log(chalk.yellow("(no adapters registered)"));
        return;
      }
      for (const a of adapters) {
        logger.log(
          `${chalk.cyan(a.name.padEnd(22))} v${a.version.padEnd(8)} ${
            a.sensitivity ? chalk.gray(`(${a.sensitivity})`) : ""
          }`,
        );
      }
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

// ─── sync-adapter / sync-all ──────────────────────────────────────────

async function cmdSyncAdapter(name, options) {
  const spinner = options.json ? null : ora(`syncing ${name}...`).start();
  try {
    const hub = await getHub();
    const opts = {};
    if (options.since) opts.since = Number(options.since);
    if (options.until) opts.until = Number(options.until);
    if (options.limit) opts.limit = Number(options.limit);
    const report = await hub.registry.syncAdapter(name, opts);
    if (spinner) spinner.succeed(`synced ${name}`);
    if (options.json) {
      printJson(report);
    } else {
      logger.log(
        `ingested=${report.ingested} kgTriples=${report.kgTriples} ragDocs=${report.ragDocs} durationMs=${report.durationMs}`,
      );
    }
  } catch (err) {
    fail(spinner, err, options.json);
  }
}

async function cmdSyncAll(options) {
  const spinner = options.json ? null : ora("syncing all...").start();
  try {
    const hub = await getHub();
    const opts = {};
    if (options.since) opts.since = Number(options.since);
    if (options.until) opts.until = Number(options.until);
    if (options.limit) opts.limit = Number(options.limit);
    const reports = await hub.registry.syncAll(opts);
    if (spinner) spinner.succeed(`synced ${reports.length} adapters`);
    if (options.json) {
      printJson(reports);
    } else {
      for (const r of reports) {
        logger.log(
          `${chalk.cyan(r.adapter)}  ingested=${r.ingested} dur=${r.durationMs}ms`,
        );
      }
    }
  } catch (err) {
    fail(spinner, err, options.json);
  }
}

// ─── query-events / recent-audit ─────────────────────────────────────

async function cmdQueryEvents(options) {
  try {
    const hub = await getHub();
    const q = {};
    if (options.subtype) q.subtype = options.subtype;
    if (options.since) q.since = Number(options.since);
    if (options.until) q.until = Number(options.until);
    if (options.actor) q.actor = options.actor;
    if (options.adapter) q.adapter = options.adapter;
    if (options.limit) q.limit = Number(options.limit);
    const events = hub.vault.queryEvents(q);
    if (options.json) {
      printJson(events);
    } else {
      logger.log(`${events.length} events:`);
      for (const ev of events) {
        const at = new Date(ev.at).toISOString();
        logger.log(
          `  ${chalk.gray(at)} ${chalk.cyan(ev.subtype)} ${ev.summary || ev.id}`,
        );
      }
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdRecentAudit(options) {
  try {
    const hub = await getHub();
    const q = {};
    if (options.since) q.since = Number(options.since);
    if (options.action) q.action = options.action;
    if (options.limit) q.limit = Number(options.limit);
    const rows = hub.vault.queryAudit(q);
    if (options.json) {
      printJson(rows);
    } else {
      logger.log(`${rows.length} audit rows:`);
      for (const r of rows) {
        const at = new Date(r.at).toISOString();
        logger.log(
          `  ${chalk.gray(at)} ${chalk.cyan(r.action)} ${r.adapter || ""} ${r.eventId || ""}`,
        );
      }
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

// ─── register-mock ───────────────────────────────────────────────────

async function cmdRegisterMock(options) {
  try {
    const hub = await getHub();
    const a = hub.registerMockAdapter({
      name: options.name || "mock",
      count: options.count ? Number(options.count) : 20,
      seed: options.seed ? Number(options.seed) : 1,
    });
    const out = { name: a.name, version: a.version };
    if (options.json) {
      printJson(out);
    } else {
      logger.log(chalk.green(`✓ registered ${out.name} v${out.version}`));
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

// ─── destroy ─────────────────────────────────────────────────────────

async function cmdDestroy(options) {
  if (!options.confirm) {
    const msg =
      "Destructive: pass --confirm to wipe vault. This deletes vault.db + WAL.";
    if (options.json) {
      printJson({ error: msg });
    } else {
      logger.error(chalk.red(`✗ ${msg}`));
    }
    process.exit(1);
  }
  try {
    const hub = await getHub();
    hub.vault.destroy();
    if (options.json) {
      printJson({ ok: true });
    } else {
      logger.log(chalk.green("✓ vault destroyed"));
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

// ─── runSkill ────────────────────────────────────────────────────────

async function cmdRunSkill(name, options) {
  const spinner = options.json
    ? null
    : ora(`running analysis skill ${name}...`).start();
  try {
    const hub = await getHub();
    if (!hub.analysisSkillNames.includes(name)) {
      throw new Error(
        `Unknown skill: ${name}. Available: ${hub.analysisSkillNames.join(", ")}`,
      );
    }
    const skillOpts = {};
    if (options.since) skillOpts.since = Number(options.since);
    if (options.until) skillOpts.until = Number(options.until);
    const result = await hub.runSkill(name, skillOpts);
    if (spinner) spinner.stop();
    if (options.json) {
      printJson(result);
    } else {
      logger.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    fail(spinner, err, options.json);
  }
}

// ─── Commander wire-up ───────────────────────────────────────────────

export function registerHubCommand(program) {
  const hub = program
    .command("hub")
    .description(
      "Personal Data Hub — local vault + adapters + AnalysisEngine on this machine",
    );

  hub
    .command("ask <question>")
    .description("Natural-language question over your local vault")
    .option("--use-rag", "Enable RAG retrieval (default true)", true)
    .option("--no-use-rag", "Disable RAG retrieval")
    .option(
      "--accept-non-local",
      "Allow non-local LLM (sends data off device — required when provider is not Ollama/vLLM)",
    )
    .option("--json", "Output JSON")
    .action(cmdAsk);

  hub
    .command("stats")
    .description("Vault row counts + registered adapter list + hub paths")
    .option("--json", "Output JSON")
    .action(cmdStats);

  hub
    .command("health")
    .description("Component health: vault / llm / kgSink / ragSink")
    .option("--json", "Output JSON")
    .action(cmdHealth);

  hub
    .command("list-adapters")
    .description("List registered adapters")
    .option("--json", "Output JSON")
    .action(cmdListAdapters);

  hub
    .command("sync-adapter <name>")
    .description("Run one adapter's ingest pipeline")
    .option("--since <ms>", "Override watermark — sync from this unix-ms")
    .option("--until <ms>", "Stop at this unix-ms")
    .option("--limit <n>", "Cap ingested events")
    .option("--json", "Output JSON")
    .action(cmdSyncAdapter);

  hub
    .command("sync-all")
    .description("Run all registered adapters in series")
    .option("--since <ms>", "Override watermark for all")
    .option("--until <ms>", "Stop at this unix-ms")
    .option("--limit <n>", "Cap each adapter")
    .option("--json", "Output JSON")
    .action(cmdSyncAll);

  hub
    .command("query-events")
    .description("Query vault events with filters")
    .option("--subtype <t>", "Event subtype filter")
    .option("--since <ms>", "Start of time window (unix-ms)")
    .option("--until <ms>", "End of time window (unix-ms)")
    .option("--actor <id>", "Actor person id filter")
    .option("--adapter <name>", "Adapter origin filter")
    .option("--limit <n>", "Max rows", "100")
    .option("--json", "Output JSON")
    .action(cmdQueryEvents);

  hub
    .command("recent-audit")
    .description("Recent audit log entries")
    .option("--since <ms>", "Start of time window (unix-ms)")
    .option("--action <a>", "Filter by action (ingest / ask / register / ...)")
    .option("--limit <n>", "Max rows", "50")
    .option("--json", "Output JSON")
    .action(cmdRecentAudit);

  hub
    .command("register-mock")
    .description("Register MockAdapter (dev/smoke only)")
    .option("--name <n>", "Adapter name", "mock")
    .option("--count <n>", "How many fake events per sync", "20")
    .option("--seed <n>", "Deterministic seed", "1")
    .option("--json", "Output JSON")
    .action(cmdRegisterMock);

  hub
    .command("run-skill <name>")
    .description(
      "Run one of the built-in analysis skills (spending/relations/footprint/interests/timeline)",
    )
    .option("--since <ms>", "Start of time window")
    .option("--until <ms>", "End of time window")
    .option("--json", "Output JSON")
    .action(cmdRunSkill);

  hub
    .command("destroy")
    .description(
      "DESTRUCTIVE: wipe vault.db + WAL. Requires --confirm. Adapters / accounts files preserved.",
    )
    .option("--confirm", "Required to proceed")
    .option("--json", "Output JSON")
    .action(cmdDestroy);
}
