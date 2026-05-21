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
import { getAIChatWizard } from "../lib/personal-data-hub-aichat-wizard.js";

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

// ─── Phase 10.3 — cc hub aichat <verb> wizard subcommand surface ─────
//
// Mirrors the WS topics (personal-data-hub.aichat-*) so scripts and the
// Android in-app terminal can drive the AIChat WebView wizard without a
// UI. cc ui defaults to fallbackMode:"paste" — these subcommands inherit
// that, so the user-facing path is always: login (print loginUrl) →
// fetch cookies in external browser → register --cookies <string>.

async function cmdAIChatList(options) {
  try {
    const wiz =
      options._wizard ||
      getAIChatWizard({ hubDir: (await (options._getHub || getHub)()).hubDir });
    // Probe each known vendor for current health
    const items = [];
    for (const vendor of options._knownVendors || _defaultKnownVendors()) {
      const opened = await wiz.openVendorLogin({ vendor });
      items.push({
        vendor,
        displayName: opened.notes ? opened.notes.split("；")[0] : vendor,
        loginUrl: opened.loginUrl,
        fallbackMode: opened.fallbackMode,
        requiredCookies: opened.requiredCookies || [],
      });
    }
    if (options.json) {
      printJson({ vendors: items });
    } else {
      logger.log(chalk.bold("可注册 vendor 列表："));
      for (const v of items) {
        logger.log(`  • ${chalk.cyan(v.vendor)}  ${chalk.gray(v.loginUrl)}`);
      }
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdAIChatLogin(vendor, options) {
  try {
    const wiz =
      options._wizard ||
      getAIChatWizard({ hubDir: (await (options._getHub || getHub)()).hubDir });
    const r = await wiz.openVendorLogin({ vendor });
    if (options.json) {
      printJson(r);
      return;
    }
    if (!r.ok) {
      logger.error(chalk.red(`✗ ${r.reason || "open failed"}`));
      process.exit(1);
    }
    logger.log(chalk.bold(`vendor: ${vendor}`));
    logger.log(`  loginUrl:  ${chalk.cyan(r.loginUrl)}`);
    if (r.helpText) logger.log(`  ${chalk.gray(r.helpText)}`);
    if (r.requiredCookies && r.requiredCookies.length) {
      logger.log(
        chalk.gray(
          `  required:  ${r.requiredCookies.join(", ")}  (至少识别 1 个)`,
        ),
      );
    }
    logger.log(
      chalk.gray(
        "\n登录完成后从浏览器 DevTools 复制 cookie，再跑：\n  cc hub aichat register " +
          vendor +
          ' --cookies "<paste>"',
      ),
    );
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdAIChatProbe(vendor, options) {
  try {
    const wiz =
      options._wizard ||
      getAIChatWizard({ hubDir: (await (options._getHub || getHub)()).hubDir });
    if (!options.cookies) {
      throw new Error('--cookies <string> required (e.g. "a=1; b=2")');
    }
    const r = await wiz.probeCookies({ vendor, cookieHeader: options.cookies });
    if (options.json) {
      printJson(r);
      return;
    }
    if (!r.ok) {
      logger.error(
        chalk.red(
          `✗ ${r.reason || "incomplete"} — missing: ${(r.missingRequired || []).join(", ") || "(none)"}`,
        ),
      );
      process.exit(1);
    }
    logger.log(chalk.green(`✓ ${vendor} cookies look valid`));
    logger.log(`  found:   ${(r.foundRequired || []).join(", ")}`);
    if (r.foundOptional && r.foundOptional.length) {
      logger.log(`  +opt:    ${r.foundOptional.join(", ")}`);
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdAIChatRegister(vendor, options) {
  try {
    if (!options.cookies) {
      throw new Error("--cookies <string> required");
    }
    const wiz =
      options._wizard ||
      getAIChatWizard({ hubDir: (await (options._getHub || getHub)()).hubDir });
    const r = await wiz.registerVendor({ vendor, cookies: options.cookies });
    if (options.json) {
      printJson(r);
      return;
    }
    if (!r.ok) {
      logger.error(chalk.red(`✗ ${r.reason || "register failed"}`));
      if (r.missingRequired && r.missingRequired.length) {
        logger.error(chalk.gray(`  missing: ${r.missingRequired.join(", ")}`));
      }
      process.exit(1);
    }
    logger.log(chalk.green(`✓ registered ${vendor} (${r.accountId})`));
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdAIChatHealth(options) {
  // One-shot health-checker pass (does NOT start the periodic loop —
  // that's owned by long-running processes like the cc ui server). This
  // is the manual/scripted equivalent.
  try {
    const factoryDeps = options._factoryDeps || {};
    const hubDir =
      factoryDeps.hubDir || (await (options._getHub || getHub)()).hubDir;
    const { createAIChatHealthChecker } =
      await import("@chainlesschain/personal-data-hub/adapters/ai-chat-history/health-checker");
    const { createAccountsStore, createVendorAdapterBridge } =
      await import("../lib/personal-data-hub-aichat-wizard.js");
    const accountsStore =
      factoryDeps.accountsStore || createAccountsStore({ hubDir });
    const vendorAdapter =
      factoryDeps.vendorAdapter || createVendorAdapterBridge();
    const hc = createAIChatHealthChecker({
      accountsStore,
      vendorAdapter,
      _deps: factoryDeps.timerDeps,
    });
    const r = await hc.runOnce();
    if (options.json) {
      printJson(r);
      return;
    }
    logger.log(
      `checked=${r.checked} ${chalk.green("ok=" + r.ok)} ${chalk.red("failed=" + r.failed)} ${chalk.yellow("mismatch=" + r.mismatch)}`,
    );
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdAIChatUnregister(vendor, options) {
  try {
    const factoryDeps = options._factoryDeps || {};
    const hubDir =
      factoryDeps.hubDir || (await (options._getHub || getHub)()).hubDir;
    const { createAccountsStore } =
      await import("../lib/personal-data-hub-aichat-wizard.js");
    const accountsStore =
      factoryDeps.accountsStore || createAccountsStore({ hubDir });
    const existing = await accountsStore.get(vendor);
    if (!existing) {
      const result = { ok: false, reason: "NOT_REGISTERED", vendor };
      if (options.json) printJson(result);
      else logger.error(chalk.red(`✗ ${vendor} is not registered`));
      process.exit(1);
    }
    await accountsStore.delete(vendor);
    if (options.json) {
      printJson({ ok: true, vendor, removed: true });
    } else {
      logger.log(chalk.green(`✓ removed ${vendor} from aichat-accounts.json`));
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

// ─── Phase 12.6.9 — cc hub wechat <verb> subcommand surface ─────────
//
// Mirrors the WS topics (personal-data-hub.wechat-env-probe /
// register-wechat / unregister-wechat / list-wechat-accounts). Useful
// for headless / scripted setup on a rooted Android attached to a Mac
// where the user doesn't want to bring up the Vue page just to wire
// the adapter (cf. cc hub aichat).

async function cmdWechatEnvProbe(options) {
  try {
    const hub = await (options._getHub || getHub)();
    const probe = await hub.probeWechatEnv();
    if (options.json) {
      printJson(probe);
      return;
    }
    logger.log(chalk.bold("WeChat env-probe:"));
    logger.log(`  ${probe.ok ? chalk.green("✓") : chalk.red("✗")} suggested: ${chalk.cyan(probe.suggestedKeyProvider)}`);
    logger.log(`  device: ${probe.device.reachable ? chalk.green("reachable") : chalk.red("unreachable")}${probe.device.serial ? " (" + probe.device.serial + ")" : ""} abi=${probe.device.abi || "?"}`);
    logger.log(`  root: ${probe.root.detected ? chalk.green("yes") : chalk.gray("no")} magisk=${probe.root.magiskInstalled ? "yes" : "no"}`);
    logger.log(`  frida-server: ${probe.frida.serverRunning ? chalk.green("running") : chalk.gray("not running")}${probe.frida.port ? " :" + probe.frida.port : ""}`);
    logger.log(`  wechat: ${probe.wechat.installed ? chalk.green(probe.wechat.versionName) : chalk.gray("not installed")}`);
    for (const reason of probe.reasons || []) logger.log(`  · ${chalk.gray(reason)}`);
    for (const w of probe.warnings || []) logger.log(`  ${chalk.yellow("!")} ${chalk.yellow(w)}`);
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdWechatRegister(options) {
  try {
    if (!options.uin) {
      throw new Error("--uin <wxid-or-uin> required");
    }
    const hub = await (options._getHub || getHub)();
    const r = await hub.registerWechatAdapter({
      account: { uin: options.uin },
      dbPath: options.db || null,
      wechatDataPath: options.wechatDataPath || null,
      keyProviderOverride: options.forceProvider || null,
      fridaOpts: options.fridaDeviceId ? { deviceId: options.fridaDeviceId } : null,
    });
    if (options.json) {
      printJson(r);
      return;
    }
    if (!r.ok) {
      logger.error(chalk.red(`✗ ${r.reason || "register failed"}: ${r.message || ""}`));
      if (r.probe) {
        for (const reason of r.probe.reasons || []) logger.error(chalk.gray("  · " + reason));
      }
      process.exit(1);
    }
    logger.log(chalk.green(`✓ wechat registered (uin=${options.uin})`));
    logger.log(`  provider: ${chalk.cyan(r.chosenKeyProvider)}`);
    logger.log(`  sensitivity: ${r.sensitivity}`);
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdWechatList(options) {
  try {
    const hub = await (options._getHub || getHub)();
    const rows = hub.listWechatAccounts();
    if (options.json) {
      printJson({ accounts: rows });
      return;
    }
    if (rows.length === 0) {
      logger.log(chalk.gray("(no registered WeChat accounts)"));
      return;
    }
    logger.log(chalk.bold("Registered WeChat accounts:"));
    for (const row of rows) {
      logger.log(`  • uin=${chalk.cyan(row.uin)} provider=${row.chosenKeyProvider || "?"} db=${row.dbPath || "(none)"} regAt=${row.registeredAt ? new Date(row.registeredAt).toISOString() : "?"}`);
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdWechatUnregister(uin, options) {
  try {
    if (!uin) throw new Error("uin argument required");
    const hub = await (options._getHub || getHub)();
    const r = await hub.unregisterWechatAdapter(uin);
    if (options.json) {
      printJson(r);
      return;
    }
    if (!r.ok) {
      logger.error(chalk.red(`✗ ${r.reason || "unregister failed"}`));
      process.exit(1);
    }
    if (r.removed) logger.log(chalk.green(`✓ removed wechat account (uin=${uin})`));
    else logger.log(chalk.gray(`(uin=${uin} was not registered — nothing removed)`));
  } catch (err) {
    fail(null, err, options.json);
  }
}

function _defaultKnownVendors() {
  // Match KNOWN_VENDORS in the hub package — kept inline so this file
  // doesn't have to dynamic-import that module on the hot path.
  return [
    "deepseek",
    "kimi",
    "tongyi",
    "zhipu",
    "hunyuan",
    "qianfan",
    "coze",
    "dreamina",
    "doubao",
  ];
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

  // Phase 10.3 — AIChat WebView wizard CLI surface (paste-mode on cc ui).
  const aichat = hub
    .command("aichat")
    .description(
      "AIChat WebView 鉴权向导 — list / login / probe / register / health / unregister 9 家国产 AI",
    );

  aichat
    .command("list")
    .description("List the 9 known AIChat vendors with their login URLs")
    .option("--json", "Output JSON")
    .action(cmdAIChatList);

  aichat
    .command("login <vendor>")
    .description("Print the vendor's login URL + paste-fallback help text")
    .option("--json", "Output JSON")
    .action(cmdAIChatLogin);

  aichat
    .command("probe <vendor>")
    .description(
      "Classify a pasted cookie string against the vendor spec (dry-run)",
    )
    .option("--cookies <string>", 'Raw cookie header (e.g. "a=1; b=2")')
    .option("--json", "Output JSON")
    .action(cmdAIChatProbe);

  aichat
    .command("register <vendor>")
    .description(
      "Register the vendor — runs validateCookie + persists aichat-accounts.json",
    )
    .option("--cookies <string>", "Raw cookie header from the browser")
    .option("--json", "Output JSON")
    .action(cmdAIChatRegister);

  aichat
    .command("health")
    .description("Run one HealthChecker pass over registered AIChat vendors")
    .option("--json", "Output JSON")
    .action(cmdAIChatHealth);

  aichat
    .command("unregister <vendor>")
    .description(
      "Remove a registered AIChat vendor entry (does not touch vault data)",
    )
    .option("--json", "Output JSON")
    .action(cmdAIChatUnregister);

  // Phase 12.6.9 — cc hub wechat <verb> mirror of WS topics.
  const wechat = hub
    .command("wechat")
    .description(
      "WeChat adapter — env-probe / register / list / unregister (rooted Android required for 8.0+)",
    );

  wechat
    .command("env-probe")
    .description("Probe attached Android device for adb / root / frida-server / WeChat version")
    .option("--json", "Output JSON")
    .action(cmdWechatEnvProbe);

  wechat
    .command("register")
    .description(
      "Bootstrap a WeChat adapter (chooses md5 or frida path per env-probe) and persist wechat-accounts.json",
    )
    .requiredOption("--uin <id>", "WeChat numeric UIN (≤ 8.0) or wxid (8.0+)")
    .option("--db <path>", "Local path to the already-pulled EnMicroMsg.db")
    .option("--wechat-data-path <dir>", "Local pulled /data/data/com.tencent.mm/ tree (required for md5 path)")
    .option("--force-provider <md5|frida>", "Override env-probe suggestion")
    .option("--frida-device-id <id>", "Frida device id (defaults to first USB device)")
    .option("--json", "Output JSON")
    .action(cmdWechatRegister);

  wechat
    .command("list")
    .description("List registered WeChat accounts (scrubbed)")
    .option("--json", "Output JSON")
    .action(cmdWechatList);

  wechat
    .command("unregister <uin>")
    .description("Remove a registered WeChat account (does not touch vault data)")
    .option("--json", "Output JSON")
    .action(cmdWechatUnregister);
}

// exported for tests — handler functions can be invoked directly with
// `_wizard` / `_factoryDeps` / `_knownVendors` injected, bypassing the
// real `getHub()` call. The commander wiring above is the runtime path.
export const _internal = {
  cmdAIChatList,
  cmdAIChatLogin,
  cmdAIChatProbe,
  cmdAIChatRegister,
  cmdAIChatHealth,
  cmdAIChatUnregister,
  cmdWechatEnvProbe,
  cmdWechatRegister,
  cmdWechatList,
  cmdWechatUnregister,
  _defaultKnownVendors,
};
