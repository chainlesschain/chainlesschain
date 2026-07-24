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

import { readFileSync, writeFileSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import { getHub, getHubMinimal } from "../lib/personal-data-hub-wiring.js";
import { loadConfig } from "../lib/config-manager.js";
import { isCloudHubConfigured } from "../lib/hub-llm-client.js";
import { importPdh } from "../lib/pdh-load-error.js";
import { getAIChatWizard } from "../lib/personal-data-hub-aichat-wizard.js";
import { runDedicatedBatchCollectors } from "../lib/pdh-dedicated-batch-collectors.js";

function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

/**
 * Drain-then-exit. console.log → process.stdout.write is async for pipes;
 * exiting immediately can truncate output to the parent. Use this in
 * commands that must terminate even when getHub() left libuv handles
 * registered (aichat-health setInterval, sidecar supervisor, etc.) — sync
 * + read commands are all-done after the report, no reason to keep idling.
 * Real-device repro on Xiaomi 24115RA8EC 2026-05-23.
 */
function jsonAndExit(obj, exitCode = 0) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n", () =>
    process.exit(exitCode),
  );
}

/**
 * Coerce a Commander string option to a positive integer, returning null if
 * unset / blank / non-numeric / ≤0. Used by `--max-facts` / `--max-query-limit`
 * on `cc hub ask` so on-device callers can pass smaller budgets without
 * silent fallback to constructor defaults on a typo (`--max-facts abc`
 * should not silently use 80).
 */
function parsePositiveInt(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const SYNC_ENTITY_KEYS = ["events", "persons", "places", "items", "topics"];
const MAX_SYNC_COOKIE_BYTES = 64 * 1024;

function resolveSyncCookie(options = {}, env = process.env) {
  if (options.cookie && options.cookieFile) {
    throw new Error("Use either --cookie or --cookie-file, not both");
  }
  let raw = options.cookie || env.CC_PDH_COOKIE || null;
  if (options.cookieFile) {
    raw = readFileSync(String(options.cookieFile), "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_SYNC_COOKIE_BYTES) {
      throw new Error(`Cookie file exceeds ${MAX_SYNC_COOKIE_BYTES} bytes`);
    }
  }
  if (raw == null) return null;
  const normalized = String(raw).trim();
  if (Buffer.byteLength(normalized, "utf8") > MAX_SYNC_COOKIE_BYTES) {
    throw new Error(`Cookie exceeds ${MAX_SYNC_COOKIE_BYTES} bytes`);
  }
  return normalized || null;
}

function syncCount(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function optionalSyncCount(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function optionalNonNegativeSyncCount(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function syncEntityTotal(report) {
  const counts = report?.entityCounts;
  if (!counts || typeof counts !== "object") return 0;
  return SYNC_ENTITY_KEYS.reduce(
    (total, key) => total + syncCount(counts[key]),
    0,
  );
}

function analyzeSyncReport(report) {
  const valid = !!report && typeof report === "object";
  const status =
    valid && typeof report.status === "string" ? report.status : "invalid";
  const total = syncEntityTotal(report);
  const rawCount = syncCount(report?.rawCount);
  const archivedRawCount = syncCount(report?.archivedRawCount);
  const archiveFailureCount = syncCount(report?.archiveFailureCount);
  const invalidCount = syncCount(report?.invalidCount);
  const watermarkDeferred = report?.watermarkDeferred === true;
  const checkpointCommitted =
    typeof report?.checkpointCommitted === "boolean"
      ? report.checkpointCommitted
      : null;
  const durability = {
    archivedRawCount,
    archiveFailureCount,
    checkpointCommitted,
  };
  const pagination = {
    pageBudget: optionalSyncCount(report?.pageBudget),
    nextPageBudget: optionalSyncCount(report?.nextPageBudget),
    scanDeferredCount: syncCount(report?.scanDeferredCount),
    watermarkLookbackMs: syncCount(report?.watermarkLookbackMs),
    collectionSinceWatermark:
      typeof report?.collectionSinceWatermark === "string"
        ? report.collectionSinceWatermark
        : null,
  };
  const recovery = {
    attemptCount: syncCount(report?.attemptCount),
    retryCount: syncCount(report?.retryCount),
    totalRetryDelayMs: syncCount(report?.totalRetryDelayMs),
    retryExhausted: report?.retryExhausted === true,
    retryAfterMs: optionalSyncCount(report?.retryAfterMs),
    rateLimitReason:
      typeof report?.rateLimitReason === "string"
        ? report.rateLimitReason
        : null,
    rateLimitRemainingMinute: optionalNonNegativeSyncCount(
      report?.rateLimitRemainingMinute,
    ),
    rateLimitRemainingDay: optionalNonNegativeSyncCount(
      report?.rateLimitRemainingDay,
    ),
    sourceRequestCount: syncCount(report?.sourceRequestCount),
    sourceRequestThrottleMs: syncCount(report?.sourceRequestThrottleMs),
    sourceRequestRateLimitRemainingMinute: optionalNonNegativeSyncCount(
      report?.sourceRequestRateLimitRemainingMinute,
    ),
    sourceRequestRateLimitRemainingDay: optionalNonNegativeSyncCount(
      report?.sourceRequestRateLimitRemainingDay,
    ),
  };
  if (valid && status === "skipped") {
    return {
      kind: "skipped",
      ok: true,
      total,
      rawCount,
      ...durability,
      ...pagination,
      ...recovery,
      invalidCount,
      error: null,
      skipReason: report.skipReason || "NOT_READY",
      skipMessage: report.skipMessage || "source is not ready",
    };
  }
  if (!valid || status !== "ok") {
    return {
      kind: "failed",
      ok: false,
      total,
      rawCount,
      ...durability,
      ...pagination,
      ...recovery,
      invalidCount,
      error:
        (valid && typeof report.error === "string" && report.error.trim()) ||
        (status === "invalid" ? "invalid sync report" : `status=${status}`),
    };
  }
  if (
    watermarkDeferred ||
    archiveFailureCount > 0 ||
    checkpointCommitted === false ||
    invalidCount > 0 ||
    (rawCount > 0 && total === 0)
  ) {
    return {
      kind: "partial",
      ok: true,
      total,
      rawCount,
      ...durability,
      ...pagination,
      ...recovery,
      invalidCount,
      watermarkDeferred,
      error: null,
    };
  }
  return {
    kind: total === 0 ? "empty" : "success",
    ok: true,
    total,
    rawCount,
    ...durability,
    ...pagination,
    ...recovery,
    invalidCount,
    watermarkDeferred,
    error: null,
  };
}

function summarizeSyncReports(reports) {
  const analyses = Array.isArray(reports)
    ? reports.map(analyzeSyncReport)
    : [analyzeSyncReport(null)];
  return {
    total: Array.isArray(reports) ? reports.length : 0,
    success: analyses.filter((item) => item.kind === "success").length,
    empty: analyses.filter((item) => item.kind === "empty").length,
    partial: analyses.filter((item) => item.kind === "partial").length,
    skipped: analyses.filter((item) => item.kind === "skipped").length,
    failed: analyses.filter((item) => item.kind === "failed").length,
    entities: analyses.reduce((total, item) => total + item.total, 0),
  };
}

function formatSyncReportLine(report) {
  const analysis = analyzeSyncReport(report);
  const adapter = report?.adapter || "unknown";
  return (
    `${adapter} status=${report?.status || "invalid"} ` +
    `raw=${analysis.rawCount} archived=${analysis.archivedRawCount} ` +
    `archiveFailed=${analysis.archiveFailureCount} entities=${analysis.total} ` +
    `invalid=${analysis.invalidCount} kgTriples=${syncCount(report?.kgTripleCount)} ` +
    `ragDocs=${syncCount(report?.ragDocCount)} durationMs=${syncCount(report?.durationMs)}` +
    (analysis.kind === "skipped"
      ? ` skipReason=${analysis.skipReason} message=${analysis.skipMessage}`
      : "") +
    (analysis.watermarkDeferred ? " watermark=deferred" : "") +
    (analysis.pageBudget !== null
      ? ` pages=${analysis.pageBudget}` +
        (analysis.nextPageBudget !== null ? `->${analysis.nextPageBudget}` : "")
      : "") +
    (analysis.scanDeferredCount > 0
      ? ` deferredScans=${analysis.scanDeferredCount}`
      : "") +
    (analysis.retryCount > 0
      ? ` attempts=${analysis.attemptCount} retries=${analysis.retryCount}` +
        ` retryDelayMs=${analysis.totalRetryDelayMs}` +
        (analysis.retryExhausted ? " retryExhausted=true" : "")
      : "") +
    (analysis.rateLimitReason
      ? ` rateLimit=${analysis.rateLimitReason}` +
        (analysis.retryAfterMs !== null
          ? ` retryAfterMs=${analysis.retryAfterMs}`
          : "") +
        (analysis.rateLimitRemainingMinute !== null
          ? ` remainingMinute=${analysis.rateLimitRemainingMinute}`
          : "") +
        (analysis.rateLimitRemainingDay !== null
          ? ` remainingDay=${analysis.rateLimitRemainingDay}`
          : "")
      : "") +
    (analysis.sourceRequestCount > 0
      ? ` sourceRequests=${analysis.sourceRequestCount}` +
        (analysis.sourceRequestThrottleMs > 0
          ? ` sourceThrottleMs=${analysis.sourceRequestThrottleMs}`
          : "")
      : "") +
    (analysis.checkpointCommitted === false
      ? " checkpoint=not-committed"
      : "") +
    (analysis.error ? ` error=${analysis.error}` : "")
  );
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
    // _getHub injection mirrors other handlers — lets unit tests stub the
    // engine without standing up a real vault.
    const hub = await (options._getHub || getHub)();
    if (!hub.engine) throw new Error("Analysis engine unavailable");
    // 推文 §三道锁第二把 "默认不许问云端" — acceptNonLocal 默认 false (拒云)。
    // 优先 --accept-non-local CLI 旗，其次 env CC_HUB_ALLOW_NON_LOCAL (Android UI
    // 拒云 toggle 通过 LocalCcRunner.askQuestion 透传)，再次为 PERSISTENT config
    // `hub.llm` 选了云后端时的常驻同意 (一次性 `cc config set hub.llm …` 即informed
    // opt-in，免去每次 --accept-non-local)；否则维持 false。
    const envAllow =
      process.env.CC_HUB_ALLOW_NON_LOCAL === "1" ||
      process.env.CC_HUB_ALLOW_NON_LOCAL === "true";
    let cfgCloudHub = false;
    try {
      cfgCloudHub = isCloudHubConfigured(loadConfig());
    } catch {
      cfgCloudHub = false; // fail-closed: unreadable config → keep cloud denied
    }
    const acceptNonLocal = !!options.acceptNonLocal || envAllow || cfgCloudHub;
    // Per-call budget overrides for small-model callers (Android Qwen2.5-1.5B
    // passes --max-facts 20 --max-query-limit 50 to keep prompt ~1.5K tokens
    // and stay under the model's effective instruction-following window).
    // Commander parses --max-facts <n> as string — coerce + drop invalid.
    const maxFacts = parsePositiveInt(options.maxFacts);
    const maxQueryLimit = parsePositiveInt(options.maxQueryLimit);
    const askOptions = {
      useRag: options.useRag !== false,
      acceptNonLocal,
    };
    if (maxFacts !== null) askOptions.maxFacts = maxFacts;
    if (maxQueryLimit !== null) askOptions.maxQueryLimit = maxQueryLimit;
    const result = await hub.engine.ask(question, askOptions);
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
        // AnalysisEngine.ask() 回传 citations 是 event-id 字符串数组（analysis.js
        // 的 `known`），不是对象 — 旧代码 `c.eventId` 取到 undefined，依据行恒为
        // "undefined, undefined"。直接 join 字符串。
        logger.log(chalk.gray(`\n依据: ${result.citations.join(", ")}`));
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

// ─── repl (persistent ask loop — amortizes the ~8s CLI cold-start) ──────
//
// `cc hub ask` reloads the whole CLI + opens the encrypted vault on EVERY
// invocation (~8s cold-start; the SQL retrieval itself is <0.5s). `cc hub repl`
// opens the hub ONCE and loops on questions from stdin, so each follow-up only
// pays SQL + LLM. Same per-question semantics as `cc hub ask` (intent routing,
// RANK/TOTALS/AMOUNT_SUM bypasses, cloud-egress gate resolved once up front).
async function cmdRepl(options = {}) {
  const readline = await import("node:readline");
  const boot = ora("Loading hub (one-time)…").start();
  let hub;
  try {
    hub = await (options._getHub || getHub)();
    if (!hub.engine) throw new Error("Analysis engine unavailable");
  } catch (err) {
    fail(boot, err, false);
    return;
  }
  boot.succeed(
    "Hub loaded — vault open, engine warm. Type a question, or .exit to quit.",
  );

  // Resolve cloud-egress consent ONCE (same precedence as cmdAsk).
  const envAllow =
    process.env.CC_HUB_ALLOW_NON_LOCAL === "1" ||
    process.env.CC_HUB_ALLOW_NON_LOCAL === "true";
  let cfgCloudHub = false;
  try {
    cfgCloudHub = isCloudHubConfigured(loadConfig());
  } catch {
    cfgCloudHub = false; // fail-closed
  }
  const acceptNonLocal = !!options.acceptNonLocal || envAllow || cfgCloudHub;
  const maxFacts = parsePositiveInt(options.maxFacts);
  const maxQueryLimit = parsePositiveInt(options.maxQueryLimit);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("hub> "),
  });

  // Serialize via a queue: lines may arrive faster than asks complete (piped
  // stdin emits all lines + EOF immediately). Process one at a time; only exit
  // when the queue is drained AND input is closed — so piped runs answer every
  // question before quitting instead of exiting mid-flight.
  const queue = [];
  let processing = false;
  let inputClosed = false;

  const answerOne = async (question) => {
    const spinner = ora("Asking…").start();
    try {
      const askOptions = { useRag: options.useRag !== false, acceptNonLocal };
      if (maxFacts !== null) askOptions.maxFacts = maxFacts;
      if (maxQueryLimit !== null) askOptions.maxQueryLimit = maxQueryLimit;
      const t0 = Date.now();
      const result = await hub.engine.ask(question, askOptions);
      spinner.stop();
      if (result.error) {
        logger.error(chalk.red(`✗ ${result.error}`));
      } else {
        logger.log(result.answer);
        if (result.citations && result.citations.length) {
          logger.log(chalk.gray(`\n依据: ${result.citations.join(", ")}`));
        }
        if (result.llmName) {
          const tag = result.isLocal
            ? chalk.green("[local]")
            : chalk.yellow("[remote]");
          logger.log(
            chalk.gray(`-- ${result.llmName} ${tag} · ${Date.now() - t0}ms`),
          );
        }
      }
    } catch (err) {
      spinner.stop();
      logger.error(chalk.red(`✗ ${err.message || err}`));
    }
  };

  const drain = async () => {
    if (processing) return;
    processing = true;
    while (queue.length) {
       
      await answerOne(queue.shift());
    }
    processing = false;
    if (inputClosed) {
      logger.log(chalk.gray("bye"));
      process.exit(0);
    }
    rl.prompt();
  };

  rl.prompt();
  rl.on("line", (line) => {
    const question = line.trim();
    if (!question) {
      if (!processing) rl.prompt();
      return;
    }
    if (
      ["exit", "quit", ".exit", ".quit", "\\q"].includes(question.toLowerCase())
    ) {
      rl.close();
      return;
    }
    queue.push(question);
    drain();
  });
  rl.on("close", () => {
    inputClosed = true;
    if (!processing && queue.length === 0) {
      logger.log(chalk.gray("bye"));
      process.exit(0);
    }
    // otherwise drain() exits after the queue empties
  });
}

// ─── retrieve-context (LLM-free RAG preflight) ─────────────────────────
//
// 2026-05-27 — Bridges Android CLOUD_ANDROID route to RAG. AnalysisEngine
// already exposes `retrieveContext()` which runs parseQuery → _gatherFacts
// → buildPrompt and returns the LLM-ready messages WITHOUT calling any
// LLM. This subcommand surfaces that JSON to stdout so a non-Ollama
// caller (Android cloud LLM provider — Doubao / DeepSeek / Kimi) can:
//   1. Spawn `cc hub retrieve-context "<q>" --max-facts 20 --json`
//   2. Parse JSON → get { messages, factIds, factCount, parsed, ... }
//   3. POST messages to the cloud LLM provider directly
//   4. Validate citations from the answer against factIds locally
//
// Privacy invariant: retrieveContext does NOT invoke any LLM, so it never
// touches `acceptNonLocal` — the caller's own gate is the gate. The
// returned messages contain raw user data (events / persons / items)
// formatted as the prompt's FACTS block; the caller is responsible for
// where they POST it.

async function cmdRetrieveContext(question, options) {
  try {
    // §S4.1 cold-start optimization — when --minimal (or default to true
    // since this command never needs adapters), use getHubMinimal which
    // skips the 50+ adapter registry + KG/RAG sinks + email account auto-
    // load + ADB extension imports. retrieveContext only touches vault
    // queries + AnalysisEngine, so the full hub init is wasted work.
    // In-APK Android cold-start drops from ~90s to <5s. Tests can still
    // pass _getHub override for stubbing.
    const useMinimal = options.minimal !== false; // default true
    const hub = options._getHub
      ? await options._getHub()
      : useMinimal
        ? await getHubMinimal()
        : await getHub();
    if (!hub.engine) throw new Error("Analysis engine unavailable");
    const maxFacts = parsePositiveInt(options.maxFacts);
    const maxQueryLimit = parsePositiveInt(options.maxQueryLimit);
    const retrieveOptions = { skipAudit: false };
    if (maxFacts !== null) retrieveOptions.maxFacts = maxFacts;
    if (maxQueryLimit !== null) retrieveOptions.maxQueryLimit = maxQueryLimit;
    const result = await hub.engine.retrieveContext(question, retrieveOptions);
    // Always JSON output — this command is machine-only by design. The
    // shape mirrors AnalysisEngine.retrieveContext return + the system
    // prompt baked in (so the caller doesn't need to re-fetch it).
    printJson(result);
  } catch (err) {
    fail(null, err, true /* json */);
  }
}

// ─── stats ────────────────────────────────────────────────────────────

async function cmdStats(options) {
  try {
    // Default to the minimal hub: stats' core payload (vault row counts +
    // hubDir) only needs the vault, so the full 77-adapter registry + KG/RAG
    // sinks + email-account auto-load is wasted work for a quick `cc hub
    // stats`. Pass --full to also list registered adapters and the resolved
    // LLM, which require the full hub init. (The adapter list is also
    // available standalone via `cc hub list-adapters`.) getHubMinimal()
    // transparently returns the full hub if one was already built this
    // process, so --full is only needed on a cold stats call. Tests stub
    // via _getHub.
    const wantFull = options.full === true;
    const hub = options._getHub
      ? await options._getHub()
      : wantFull
        ? await getHub()
        : await getHubMinimal();
    const adapters = hub.registry ? hub.registry.list() : null;
    const out = {
      vault: hub.vault.stats(),
      adapters,
      hubDir: hub.hubDir,
      llm: hub.llm ? { name: hub.llm.name, isLocal: hub.llm.isLocal } : null,
      minimal: !!hub.minimal,
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
      if (out.adapters) {
        logger.log(chalk.bold(`\nadapters (${out.adapters.length}):`));
        for (const a of out.adapters) {
          logger.log(`  ${chalk.cyan(a.name)} v${a.version}`);
        }
      } else {
        logger.log(
          chalk.gray(
            "\nadapters: (run `cc hub stats --full` or `cc hub list-adapters`)",
          ),
        );
      }
      logger.log(chalk.gray(`\nhubDir: ${out.hubDir}`));
      if (out.llm) {
        const tag = out.llm.isLocal
          ? chalk.green("[local]")
          : chalk.yellow("[remote]");
        logger.log(chalk.gray(`llm: ${out.llm.name} ${tag}`));
      } else if (out.minimal) {
        logger.log(chalk.gray("llm: (run `cc hub stats --full` to resolve)"));
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
    // Full hub is the default: health's whole job is verifying that hub init
    // wired every component (llm / kgSink / ragSink), which a minimal hub
    // deliberately leaves null — reporting those as ✗ would be a false
    // negative, not a faster check. `--quick` opts into a vault-only probe
    // on the minimal hub (skips the 77-adapter registry + sink wiring) for
    // when you just need "is the vault openable / what schema". Tests stub
    // via _getHub.
    const quick = options.quick === true;
    const hub = options._getHub
      ? await options._getHub()
      : quick
        ? await getHubMinimal()
        : await getHub();
    const out = {
      quick,
      vault: {
        ok: !!hub.vault.db,
        schemaVersion: hub.vault.schemaVersion(),
      },
    };
    if (quick) {
      // Minimal hub intentionally has no llm / kgSink / ragSink — mark them
      // "not probed" rather than reporting a misleading down state.
      out.llm = { probed: false };
      out.kgSink = { probed: false };
      out.ragSink = { probed: false };
    } else {
      out.llm = hub.llm
        ? { ok: true, isLocal: hub.llm.isLocal, name: hub.llm.name }
        : { ok: false, reason: "LLM unavailable" };
      out.kgSink = { ok: !!hub.kgSink };
      out.ragSink = { ok: !!hub.ragSink };
    }
    if (options.json) {
      printJson(out);
    } else {
      const mark = (ok) => (ok ? chalk.green("✓") : chalk.red("✗"));
      logger.log(
        `${mark(out.vault.ok)} vault    schema=${out.vault.schemaVersion}`,
      );
      if (quick) {
        logger.log(
          chalk.gray(
            "· llm / kgSink / ragSink not probed (run without --quick)",
          ),
        );
      } else {
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

// ─── readiness ────────────────────────────────────────────────────────
//
// Per-adapter "能否采集 + 不能的原因". Unlike list-adapters (static
// metadata, and every healthCheck() returns a lenient ok), this probes
// each adapter's authenticate({ readinessOnly: true }) and maps the reason
// to a human explanation. This is the "止血" surface for "好多数据源采不到"
// — instead of a misleading green status, it shows 未配置/需采集/不支持.

const READINESS_STATUS_STYLE = {
  ready: (s) => chalk.green(s),
  needs_setup: (s) => chalk.yellow(s),
  unavailable: (s) => chalk.gray(s),
  error: (s) => chalk.red(s),
};

async function cmdReadiness(options) {
  try {
    const hub = await getHub();
    const reports = await hub.registry.readiness(
      options.timeout ? { timeoutMs: Number(options.timeout) } : {},
    );
    if (options.json) {
      printJson(reports);
      return;
    }
    if (!reports.length) {
      logger.log(chalk.yellow("(no adapters registered)"));
      return;
    }
    const readyCount = reports.filter((r) => r.ready).length;
    logger.log(
      chalk.bold(`数据源就绪情况：${readyCount}/${reports.length} 可采集\n`),
    );
    // Sort: not-ready first (those need attention), then by name.
    const sorted = [...reports].sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    for (const r of sorted) {
      const style = READINESS_STATUS_STYLE[r.status] || ((s) => s);
      const mark = r.ready ? chalk.green("✔") : chalk.red("✘");
      logger.log(
        `${mark} ${chalk.cyan(r.name.padEnd(24))} ${style(
          r.status.padEnd(12),
        )} ${chalk.gray(`[${r.category}]`)}`,
      );
      if (!r.ready) {
        logger.log(`    ${r.message}`);
        if (r.actionHint) logger.log(chalk.gray(`    → ${r.actionHint}`));
      }
      if (r.lastError) {
        logger.log(chalk.gray(`    上次同步错误: ${r.lastError}`));
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
    const hub = await (options._getHub || getHub)();
    const opts = {};
    if (options.since) opts.since = Number(options.since);
    if (options.until) opts.until = Number(options.until);
    if (options.limit) opts.limit = Number(options.limit);
    // Plan A v0.1 — system-data-android needs a snapshot file path. Generic
    // pass-through so other input-driven adapters reuse the same flag.
    if (options.input) opts.inputPath = String(options.input);
    // Local DB direct-read flags (本地直读样板): --key for SQLCipher-encrypted
    // sources (wechat-pc), --db-path as an explicit alias for the DB file.
    if (options.key) opts.key = String(options.key);
    if (options.dbPath) opts.dbPath = String(options.dbPath);
    // WhatsApp public-backup ADB path. `--key` accepts the crypt15 64-hex
    // root key or a crypt14/encrypted_backup.key file path. Device selection
    // follows --serial, then ADB_SERIAL, then the single connected device.
    if (options.serial) opts.serial = String(options.serial);
    if (options.whatsappBusiness) opts.business = true;
    if (options.remotePath) opts.remotePath = String(options.remotePath);
    // QQ NT (qq-pc): the SQLCipher passphrase from qq-win-db-key (ASCII, e.g.
    // "5{sww#,6aq=)8=A@"). Routes qq-pc through the decrypt+parse sidecar.
    if (options.passphrase) opts.passphrase = String(options.passphrase);
    // Cookie-mode sources: a file/env path avoids exposing the secret in shell
    // history and process listings. The value remains transient.
    const runtimeCookie = resolveSyncCookie(options);
    if (runtimeCookie) opts.cookie = runtimeCookie;
    // Constructor-optional cookie collectors use a transient account identity
    // to isolate watermarks without persisting the cookie or account id.
    const runtimeAccountId = options.accountId || process.env.CC_PDH_ACCOUNT_ID;
    if (runtimeAccountId) opts.accountId = String(runtimeAccountId);
    // Alipay bill ZIP exports may be password protected. Environment fallback
    // keeps the password out of shell history for automated collection.
    const zipPassword = options.zipPassword || process.env.CC_PDH_ZIP_PASSWORD;
    if (zipPassword) opts.zipPassword = String(zipPassword);
    // L1 local files (module 101): the local-files adapter walks directories
    // given via opts.roots (comma-separated dirs → array). Without this the
    // adapter falls back to its default user-data dirs.
    if (options.roots) {
      opts.roots = String(options.roots)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const report = await hub.registry.syncAdapter(name, opts);
    const analysis = analyzeSyncReport(report);
    // 2026-05-24 in-APK Android exit + flush-race fix. Real-device repro on
    // Xiaomi 24115RA8EC:
    //
    //   (1) cc subprocess sits idle in epoll_wait for the full 240s budget
    //       after the report is fully written, then gets destroyForcibly'd
    //       by Kotlin LocalCcRunner → false "timeout after 240000ms" UI
    //       error even though vault writes committed. Root cause: a
    //       lingering libuv handle in getHub() wiring (suspect: aichat-
    //       health setInterval or sidecar supervisor health ping) keeps
    //       the event loop alive forever. Long-run fix is to close those
    //       cleanly; until then we force-exit here.
    //
    //   (2) First-pass force-exit landed `process.exit(0)` after a normal
    //       `printJson(report) = console.log(...)`. But console.log →
    //       process.stdout.write is ASYNC for pipes (only sync for TTY),
    //       so process.exit fires before the JSON buffer drains → Kotlin
    //       parent reads truncated/empty stdout → "parse-failed" reason
    //       in CcResult.Failed → UI "写入本地数据库失败".
    //
    // Fix: explicit drain-then-exit (jsonAndExit helper at top of file).
    if (options.json) {
      jsonAndExit(report, analysis.ok ? 0 : 1);
      return;
    }
    if (!analysis.ok) {
      if (spinner) spinner.fail(`sync ${name} failed`);
      logger.error(chalk.red(`✗ ${formatSyncReportLine(report)}`));
      process.exit(1);
      return;
    }
    if (spinner) {
      if (analysis.kind === "partial") {
        spinner.warn(
          analysis.watermarkDeferred
            ? `synced ${name}; watermark deferred until the full page window is scanned` +
                (analysis.nextPageBudget
                  ? ` (next page budget: ${analysis.nextPageBudget})`
                  : "")
            : `synced ${name} with invalid data`,
        );
      } else if (analysis.kind === "empty") {
        spinner.succeed(`synced ${name} (no new data)`);
      } else {
        spinner.succeed(`synced ${name}`);
      }
    }
    logger.log(formatSyncReportLine(report));
    process.exit(0);
  } catch (err) {
    fail(spinner, err, options.json);
  }
}

async function cmdSyncAll(options) {
  const spinner = options.json ? null : ora("syncing all...").start();
  try {
    const hub = await (options._getHub || getHub)();
    const opts = { readyOnly: options.includeUnready !== true };
    if (options.since) opts.since = Number(options.since);
    if (options.until) opts.until = Number(options.until);
    if (options.limit) opts.limit = Number(options.limit);
    const registryReports = await hub.registry.syncAll(opts);
    const reports = await runDedicatedBatchCollectors(hub, registryReports);
    const summary = summarizeSyncReports(reports);
    if (spinner) {
      if (summary.failed > 0 || summary.partial > 0) {
        spinner.warn(
          `sync completed: ${summary.success} success, ${summary.empty} empty, ` +
            `${summary.partial} partial, ${summary.skipped} skipped, ` +
            `${summary.failed} failed`,
        );
      } else if (summary.skipped > 0) {
        spinner.info(
          `sync completed: ${summary.success} success, ${summary.empty} empty, ` +
            `${summary.skipped} skipped (${summary.entities} entities)`,
        );
      } else {
        spinner.succeed(
          `synced ${summary.total} adapters (${summary.entities} entities)`,
        );
      }
    }
    if (options.json) {
      printJson(reports);
    } else {
      for (const r of reports) {
        const line = formatSyncReportLine(r);
        logger.log(
          analyzeSyncReport(r).kind === "failed"
            ? chalk.red(line)
            : analyzeSyncReport(r).kind === "skipped"
              ? chalk.gray(line)
              : chalk.cyan(line),
        );
      }
    }
    if (summary.failed > 0) process.exitCode = 1;
  } catch (err) {
    fail(spinner, err, options.json);
  }
}

// ─── rederive ────────────────────────────────────────────────────────

async function cmdRederive(options) {
  const spinner = options.json
    ? null
    : ora(
        options.adapter
          ? `re-deriving ${options.adapter} from raw_events...`
          : "re-deriving all adapters from raw_events...",
      ).start();
  try {
    const hub = await getHub();
    const opts = {};
    if (options.adapter) opts.adapter = String(options.adapter);
    if (options.batchSize) opts.batchSize = Number(options.batchSize);
    const report = await hub.registry.rederive(opts);
    if (spinner) {
      spinner.succeed(
        `re-derived ${report.rawSeen} raw → events:${report.entityCounts.events} ` +
          `persons:${report.entityCounts.persons} items:${report.entityCounts.items} ` +
          `(invalid:${report.invalidCount} missing:${report.adapterMissing} ` +
          `${report.durationMs}ms)`,
      );
    }
    if (options.json) {
      jsonAndExit(report);
      return;
    }
    if (report.errors.length > 0) {
      logger.log(chalk.red(`errors: ${report.errors.length}`));
      for (const e of report.errors) {
        logger.log(`  ${chalk.red(e.adapter)}: ${e.error}`);
      }
    }
    process.exit(0);
  } catch (err) {
    fail(spinner, err, options.json);
  }
}

// ─── query-events / recent-audit ─────────────────────────────────────

async function cmdQueryEvents(options) {
  try {
    // Read-only vault query — needs no adapters / sinks / llm. Minimal hub
    // skips the 77-adapter registry build (and is crash-resilient to a
    // partial pdh install). getHubMinimal() returns the full hub if one was
    // already built this process, so the vault instance is identical.
    const hub = await (options._getHub || getHubMinimal)();
    const q = {};
    if (options.subtype) q.subtype = options.subtype;
    if (options.since) q.since = Number(options.since);
    if (options.until) q.until = Number(options.until);
    if (options.actor) q.actor = options.actor;
    if (options.adapter) q.adapter = options.adapter;
    if (options.limit) q.limit = Number(options.limit);
    const events = hub.vault.queryEvents(q);
    if (options.json) {
      jsonAndExit(events);
      return;
    }
    logger.log(`${events.length} events:`);
    for (const ev of events) {
      // Vault events carry `occurredAt` (epoch ms) + `content`, NOT `at` /
      // `summary` — reading the wrong fields previously threw "Invalid time
      // value" on the first row and killed the whole listing. Guard the
      // timestamp so one malformed row can't crash the output.
      const ts = Number(ev.occurredAt);
      const at = Number.isFinite(ts) ? new Date(ts).toISOString() : "(no date)";
      const summary =
        (ev.content &&
          (ev.content.text || ev.content.title || ev.content.subject)) ||
        ev.summary ||
        ev.id;
      logger.log(`  ${chalk.gray(at)} ${chalk.cyan(ev.subtype)} ${summary}`);
    }
    process.exit(0);
  } catch (err) {
    fail(null, err, options.json);
  }
}

// ─── export-events / import-events (§8.3 cross-device backup) ─────────
//
// Raw vault event export/import for the module 101 §8.3 backup engine.
// The Android PdhVaultBridge.CcVaultGateway shells to these:
//   cc hub export-events --json          → full events (paginated)
//   cc hub import-events --input <file>  → idempotent putEvent (ON
//                                          CONFLICT(id) upsert)
// Events round-trip queryEvents ⇄ putEvent (same canonical schema), so an
// exported snapshot re-imports without loss/dup. CLI-only (no pdh/lib change).

/** Page through queryEvents to collect EVERY event (no default 100 cap). */
function exportAllEvents(vault, pageSize = 10000) {
  const all = [];
  let offset = 0;
  for (;;) {
    const page = vault.queryEvents({ limit: pageSize, offset });
    all.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }
  return all;
}

/** putEvent each (idempotent upsert by id); count outcomes, never throw mid-batch. */
function importEventsInto(vault, events) {
  let imported = 0;
  let failed = 0;
  const errors = [];
  for (const ev of events) {
    try {
      vault.putEvent(ev);
      imported += 1;
    } catch (e) {
      failed += 1;
      if (errors.length < 10)
        errors.push({ id: ev && ev.id, error: e.message });
    }
  }
  return { ok: failed === 0, imported, failed, errors };
}

async function cmdExportEvents(options) {
  try {
    // Vault-only raw-event export — no adapters needed, use the minimal hub.
    const hub = await (options._getHub || getHubMinimal)();
    const all = exportAllEvents(hub.vault);
    if (options.output) {
      // ESM module — must NOT use require("fs") (ReferenceError: require is
      // not defined). Use the static node:fs import.
      writeFileSync(options.output, JSON.stringify(all), "utf-8");
      if (options.json) {
        jsonAndExit({ ok: true, count: all.length, output: options.output });
        return;
      }
      logger.log(`exported ${all.length} events → ${options.output}`);
      process.exit(0);
    }
    // default: emit the array (data command; the gateway reads stdout)
    jsonAndExit(all);
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdImportEvents(options) {
  try {
    if (!options.input) {
      throw new Error(
        "import-events: --input <file> is required (a JSON array of events)",
      );
    }
    // ESM module — use the static node:fs import, not require("fs").
    const raw = readFileSync(options.input, "utf-8");
    const events = JSON.parse(raw);
    if (!Array.isArray(events)) {
      throw new Error("import-events: expected a JSON array of events");
    }
    // Vault-only idempotent upsert — no adapters needed, use the minimal hub.
    const hub = await (options._getHub || getHubMinimal)();
    const result = importEventsInto(hub.vault, events);
    if (options.json) {
      jsonAndExit(result);
      return;
    }
    logger.log(`imported ${result.imported}, failed ${result.failed}`);
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    fail(null, err, options.json);
  }
}

// ─── search / facet-counts (Phase 16 Vault Browser) ──────────────────
//
// Surfaces vault.searchEvents + vault.facetCounts for headless use
// (Android LocalCcRunner.searchEvents calls this; CI smoke too).
async function cmdSearchEvents(options) {
  try {
    // Read-only vault FTS search — vault-only, use the minimal hub.
    const hub = await getHubMinimal();
    const q = {};
    if (options.q) q.q = String(options.q);
    if (options.adapter) q.adapter = options.adapter;
    if (options.category) q.category = options.category;
    if (options.subtype) q.subtype = options.subtype;
    if (options.since) q.since = Number(options.since);
    if (options.until) q.until = Number(options.until);
    if (options.limit) q.limit = Number(options.limit);
    // cursor passed as `--cursor "<occurredAt>:<id>"` (cli-friendly)
    if (options.cursor) {
      const m = String(options.cursor).match(/^(\d+):(.+)$/);
      if (m) q.cursor = { occurredAt: Number(m[1]), id: m[2] };
    }
    const result = hub.vault.searchEvents(q);
    if (options.json) {
      jsonAndExit(result);
      return;
    }
    logger.log(
      `${result.rows.length} events (mode=${result.mode}${result.shortQuery ? " shortQuery!" : ""})` +
        (result.nextCursor
          ? `  nextCursor=${result.nextCursor.occurredAt}:${result.nextCursor.id}`
          : ""),
    );
    for (const ev of result.rows) {
      const at = new Date(ev.occurredAt).toISOString();
      const summary =
        (ev.content &&
          (ev.content.text || ev.content.title || ev.content.subject)) ||
        ev.id;
      logger.log(
        `  ${chalk.gray(at)} ${chalk.cyan(ev.source.adapter)} ${chalk.dim(ev.subtype)} ${summary}`,
      );
    }
    process.exit(0);
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdFacetCounts(options) {
  try {
    // Read-only vault facet aggregation — vault-only, use the minimal hub.
    const hub = await getHubMinimal();
    const q = {};
    if (options.q) q.q = String(options.q);
    if (options.since) q.since = Number(options.since);
    if (options.until) q.until = Number(options.until);
    const result = hub.vault.facetCounts(q);
    if (options.json) {
      jsonAndExit(result);
      return;
    }
    logger.log(
      `total=${result.total} mode=${result.mode}${result.shortQuery ? " shortQuery!" : ""}`,
    );
    logger.log(chalk.bold("by category:"));
    for (const [k, n] of Object.entries(result.byCategory)) {
      logger.log(`  ${chalk.cyan(k.padEnd(10))} ${n}`);
    }
    logger.log(chalk.bold("by adapter:"));
    for (const [k, n] of Object.entries(result.byAdapter)) {
      logger.log(`  ${chalk.cyan(k.padEnd(24))} ${n}`);
    }
    process.exit(0);
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdRecentAudit(options) {
  try {
    // Read-only vault audit log query — vault-only, use the minimal hub.
    const hub = await getHubMinimal();
    const q = {};
    if (options.since) q.since = Number(options.since);
    if (options.action) q.action = options.action;
    if (options.limit) q.limit = Number(options.limit);
    const rows = hub.vault.queryAudit(q);
    if (options.json) {
      jsonAndExit(rows);
      return;
    }
    logger.log(`${rows.length} audit rows:`);
    for (const r of rows) {
      const at = new Date(r.at).toISOString();
      logger.log(
        `  ${chalk.gray(at)} ${chalk.cyan(r.action)} ${r.adapter || ""} ${r.eventId || ""}`,
      );
    }
    process.exit(0);
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

// ─── event-detail ────────────────────────────────────────────────────

/**
 * `cc hub event-detail <eventId> [--json]`
 *
 * 推文 §"AI 回答必须给出处" 的兑现路径——点 citation chip → 调本命令 → 显
 * 原文。Returns the full event row from the vault, including subtype /
 * source / actor / title / timestamps / payload-derived fields.
 *
 * Caller is typically the Android UI (HubAskCard citation chip click) or
 * desktop renderer. Returns `null` shape `{ found: false, eventId }` when
 * the id doesn't match (e.g. event was deleted by destroy after the ask).
 */
async function cmdEventDetail(eventId, options) {
  if (!eventId) {
    const msg = "eventId argument required";
    if (options.json) printJson({ error: msg });
    else logger.error(chalk.red(`✗ ${msg}`));
    process.exit(1);
  }
  try {
    // Read-only single-event lookup — vault-only, use the minimal hub.
    const hub = await (options._getHub || getHubMinimal)();
    const event = hub.vault.getEvent(eventId);
    if (!event) {
      const result = { found: false, eventId };
      if (options.json) printJson(result);
      else logger.log(chalk.yellow(`(no event with id ${eventId})`));
      return;
    }
    if (options.json) {
      printJson({ found: true, event });
    } else {
      logger.log(chalk.bold(`event ${event.id}`));
      logger.log(`  subtype:  ${event.subtype}`);
      // occurredAt (epoch ms) is the canonical timestamp; guard a bad value.
      const ts = Number(event.occurredAt);
      if (Number.isFinite(ts)) {
        logger.log(`  occurred: ${new Date(ts).toISOString()}`);
      }
      // `source` is an object ({ adapter, ... }) — print the adapter, not the
      // object (which renders as "[object Object]").
      const adapter =
        event.source && typeof event.source === "object"
          ? event.source.adapter
          : event.source;
      if (adapter) logger.log(`  source:   ${adapter}`);
      if (event.actor) logger.log(`  actor:    ${event.actor}`);
      const summary =
        event.content &&
        (event.content.text || event.content.title || event.content.subject);
      if (summary) logger.log(`  content:  ${summary}`);
      if (event.title) logger.log(`  title:    ${event.title}`);
      if (event.amount != null) {
        logger.log(`  amount:   ${event.amount} ${event.currency || ""}`);
      }
      if (event.startedAt) {
        logger.log(`  started:  ${new Date(event.startedAt).toISOString()}`);
      }
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

// ─── export ──────────────────────────────────────────────────────────

/**
 * `cc hub export --output <path> [--json]`
 *
 * 推文 §"一键带走"。Closes the vault, copies vault.db (+ WAL/SHM if present)
 * to the destination path, then reopens. Resulting file is SQLCipher-encrypted
 * exactly as on disk — caller (Android UI) hands the bytes off via SAF
 * picker. Desktop side can `cc hub import-vault <path>` to reimport.
 *
 * No re-encryption / re-keying. The file IS the export. Key handling is
 * out of scope here — the file is useless without the user's keystore-backed
 * key material (which is bound to device by KeyProvider).
 */
async function cmdExport(options) {
  if (!options.output) {
    const msg = "--output <path> required";
    if (options.json) printJson({ error: msg });
    else logger.error(chalk.red(`✗ ${msg}`));
    process.exit(1);
  }
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    // Vault-file snapshot copy — vault-only, use the minimal hub.
    const hub = await getHubMinimal();
    const src = hub.vault.path;
    if (!src) throw new Error("vault path unavailable (hub not initialized?)");

    // Resolve output → absolute path. Make parent directory if missing.
    const outAbs = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });

    // Close the vault so we copy a consistent snapshot. better-sqlite3 keeps
    // WAL pages buffered; closing flushes everything to disk. We reopen at
    // end so the running hub session continues to work.
    try {
      hub.vault.close?.();
    } catch (_e) {
      // ignore — closing failure is rare and we still try to copy
    }

    // Copy main db file. WAL / SHM are sidecars — only copy if present (they
    // may or may not exist depending on WAL mode + last checkpoint).
    let bytes = 0;
    fs.copyFileSync(src, outAbs);
    bytes += fs.statSync(outAbs).size;
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = src + suffix;
      if (fs.existsSync(sidecar)) {
        const outSidecar = outAbs + suffix;
        fs.copyFileSync(sidecar, outSidecar);
        bytes += fs.statSync(outSidecar).size;
      }
    }

    // Reopen so the same hub instance can keep serving.
    try {
      hub.vault.open?.();
    } catch (e) {
      // If reopen fails the next operation will surface it; don't block export.
      logger.warn?.(
        chalk.yellow(
          `! vault.open after export failed: ${e?.message || e} — restart cc`,
        ),
      );
    }

    const result = {
      ok: true,
      source: src,
      output: outAbs,
      bytes,
      // Hint to caller (e.g. Android UI) that this is encrypted at rest.
      encrypted: true,
    };
    if (options.json) {
      printJson(result);
    } else {
      logger.log(chalk.green(`✓ exported ${bytes} bytes to ${outAbs}`));
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

// ─── salvage ───────────────────────────────────────────────────────────
//
// Method B (key-free) decryption capstone: a rooted device dumps a running
// app's decrypted SQLite pages from /proc/<pid>/mem, then this salvages the
// message records straight out of the leaf pages (no key, no password) and
// ingests them through the social-douyin snapshot path. This is the on-device
// command the Android「一键 root 采集」button calls after the mem scan.
// See docs/internal/pdh-db-decryption-runbook.md §3.5.

async function cmdSalvage(dumpfile, options) {
  const spinner = options.json ? null : ora(`salvaging ${dumpfile}...`).start();
  try {
    const hub = await (options._getHub || getHub)();
    // Generic multi-app salvage → vault with correct per-app source.adapter
    // (douyin→social-douyin, toutiao→social-toutiao, wechat→wechat, …). The
    // earlier social-douyin-only path mis-attributed every app to douyin.
    const { salvageDumpToVault } = options._salvageDumpToVault
      ? { salvageDumpToVault: options._salvageDumpToVault }
      : await importPdh(
          "@chainlesschain/personal-data-hub/forensics/salvage-ingest",
        );
    const opts = {
      app: options.app || "douyin",
      unaligned: options.unaligned !== false, // default-on: scattered page cache
    };
    if (options.pageSize) opts.pageSize = Number(options.pageSize);
    if (options.minCols) opts.minCols = Number(options.minCols);
    if (options.columns)
      opts.columns = String(options.columns)
        .split(",")
        .map((s) => s.trim());
    const report = salvageDumpToVault(hub.vault, dumpfile, opts);
    if (spinner) spinner.succeed(`salvaged ${dumpfile}`);
    if (options.json) {
      jsonAndExit(report);
      return;
    }
    logger.log(chalk.green(`✓ salvage succeeded`));
    logger.log(
      `  app:          ${report.app} (source: ${report.sourceAdapter})`,
    );
    logger.log(`  leaf pages:   ${report.leafPages || 0}`);
    logger.log(`  records:      ${report.salvaged || 0}`);
    logger.log(`  ingested:     ${report.ingested || 0}`);
    process.exit(0);
  } catch (err) {
    fail(spinner, err, options.json);
  }
}

// ─── collect-qq (QQNT frida-free decrypt → vault) ────────────────────────
//
// module 101 QQNT 采集方案 — on-device path. Decrypts a (root-staged) encrypted
// nt_msg.db via the DERIVED key (MD5(MD5(uid)+rand), no frida), protobuf-parses
// the messages, and ingests them. The Android CollectQqNativeTool su-reads the
// DB + uid candidates, then invokes this. Same logic also runs on PC (USB).
// Plaintext is written to a temp file only for parsing, then deleted.
async function cmdCollectQq(options) {
  const spinner = options.json
    ? null
    : ora("collect-qq (decrypt + ingest)...").start();
  try {
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const qq = options._qqCore
      ? options._qqCore
      : await importPdh(
          "@chainlesschain/personal-data-hub/forensics/qq-nt-collect",
        );

    if (!options.db) throw new Error("need --db <encrypted nt_msg.db>");
    if (!options.uids) throw new Error("need --uids <file with u_ candidates>");
    const raw = fs.readFileSync(options.db);
    const rand = options.rand || qq.extractRand(raw);
    if (!rand)
      throw new Error(
        "could not read `rand` from nt_msg.db header (pass --rand)",
      );
    const uids = fs
      .readFileSync(options.uids, "utf8")
      .split(/\s+/)
      .filter((u) => /^u_[A-Za-z0-9_-]{10,}$/.test(u));
    if (!uids.length) throw new Error("no u_ uid candidates in --uids file");

    const result = qq.deriveAndDecrypt(raw, uids, rand);
    if (!result) {
      const report = {
        ok: false,
        reason: "no-uid-match",
        uidCandidates: uids.length,
      };
      if (options.json) {
        jsonAndExit(report);
        return;
      }
      if (spinner)
        spinner.fail(
          "no uid matched (account uid not in candidates, or formula changed)",
        );
      process.exit(2);
    }

    // better-sqlite3's native binding isn't at the standard `bindings` path on
    // Android (the bundle loads it specially) — reuse the vault's already-loaded
    // Database constructor instead of require("better-sqlite3").
    const hub = await (options._getHub || getHub)();
    const vault = hub.vault;
    const Database = (vault.db || vault._db || vault).constructor;

    // Write the plaintext next to the (app-writable) input DB — os.tmpdir() is
    // /data/local/tmp on Android, which the app uid can't write (EACCES).
    void os;
    const tmp = path.join(
      path.dirname(path.resolve(options.db)),
      `qqnt-dec-${process.pid}.db`,
    );
    fs.writeFileSync(tmp, result.decrypted);
    let parsed;
    try {
      // selfUid = the matched account uid → reliable self attribution.
      parsed = qq.parseEvents(Database, tmp, {
        selfUid: result.uid,
        self: options.self || "self",
      });
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* best-effort wipe */
      }
    }
    const events = Array.isArray(parsed) ? parsed : parsed.events || [];
    const persons = Array.isArray(parsed) ? [] : parsed.persons || [];
    const topics = Array.isArray(parsed) ? [] : parsed.topics || [];

    for (const p of persons) {
      try {
        vault.putPerson(p);
      } catch {
        /* dup / optional */
      }
    }
    for (const t of topics) {
      try {
        if (typeof vault.putTopic === "function") vault.putTopic(t);
      } catch {
        /* dup / optional */
      }
    }
    let ingested = 0;
    for (const ev of events) {
      try {
        vault.putEvent(ev);
        ingested++;
      } catch {
        /* skip dup/invalid */
      }
    }
    const report = {
      ok: true,
      matchedUid: result.uid,
      kdf: result.kdf,
      messages: events.length,
      persons: persons.length,
      topics: topics.length,
      ingested,
    };
    if (spinner) spinner.succeed(`collect-qq: ${ingested} QQ messages → vault`);
    if (options.json) {
      jsonAndExit(report);
      return;
    }
    logger.log(chalk.green("✓ QQNT collect succeeded"));
    logger.log(`  matched uid:  ${result.uid} (kdf ${result.kdf})`);
    logger.log(`  messages:     ${events.length}`);
    logger.log(`  ingested:     ${ingested}`);
    process.exit(0);
  } catch (err) {
    fail(spinner, err, options.json);
  }
}

// ─── collect-db (generic plaintext-db ingest → vault) ────────────────────
//
// module 101 — collect an app's PLAINTEXT SQLite dbs (browse/read/history/
// content/config) into the vault. The Magisk daemon (root, MIUI cross-app)
// stages an app's databases dir; this turns each readable db into vault
// records (generic text extraction). Encrypted IM (QQNT/WeChat) have their
// own collectors; this covers the rest of the 明文库.
async function cmdCollectDb(options) {
  const spinner = options.json
    ? null
    : ora("collect-db (plaintext)...").start();
  try {
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    const fs = require("fs");
    const path = require("path");
    const g = options._plaintextCore
      ? options._plaintextCore
      : await importPdh(
          "@chainlesschain/personal-data-hub/forensics/plaintext-db-collect",
        );
    if (!options.app) throw new Error("need --app <key>");
    let dbs = [];
    if (options.db) {
      dbs = [options.db];
    } else if (options.dir) {
      dbs = fs
        .readdirSync(options.dir)
        .filter((f) => /\.db$/.test(f) && !/-wal$|-shm$/.test(f))
        .map((f) => path.join(options.dir, f));
    } else {
      throw new Error("need --db <path> or --dir <dir>");
    }
    const hub = await (options._getHub || getHub)();
    const vault = hub.vault;
    const Database = (vault.db || vault._db || vault).constructor;
    let ingested = 0;
    let records = 0;
    const perDb = [];
    for (const dbp of dbs) {
      try {
        const events = g.ingestPlaintextDb(Database, dbp, options.app);
        let ok = 0;
        for (const ev of events) {
          try {
            vault.putEvent(ev);
            ok++;
          } catch {
            /* skip dup/invalid */
          }
        }
        ingested += ok;
        records += events.length;
        if (events.length)
          perDb.push({ db: path.basename(dbp), records: events.length });
      } catch {
        /* skip encrypted/unreadable db */
      }
    }
    const report = {
      ok: true,
      app: options.app,
      dbs: dbs.length,
      records,
      ingested,
      perDb,
    };
    if (spinner)
      spinner.succeed(
        `collect-db: ${ingested} records from ${perDb.length}/${dbs.length} dbs`,
      );
    if (options.json) {
      jsonAndExit(report);
      return;
    }
    logger.log(
      chalk.green(`✓ collect-db (${options.app}): ${ingested} records → vault`),
    );
    for (const d of perDb.slice(0, 12)) logger.log(`  ${d.db}: ${d.records}`);
    process.exit(0);
  } catch (err) {
    fail(spinner, err, options.json);
  }
}

// ─── collect-wechat (WeChat EnMicroMsg derived-key decrypt → vault) ──────
//
// module 101 — same model as collect-qq. The Magisk daemon stages a
// (root-read) EnMicroMsg.db + uin/IMEI candidates; this derives the key
// (MD5(IMEI+uin)[:7]), decrypts (SQLCipher page-AES), parses message/rcontact/
// chatroom, and ingests. Plaintext temp is written app-local + wiped.
async function cmdCollectWechat(options) {
  const spinner = options.json
    ? null
    : ora("collect-wechat (decrypt + ingest)...").start();
  try {
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    const fs = require("fs");
    const path = require("path");
    const wx = options._wechatCore
      ? options._wechatCore
      : await importPdh(
          "@chainlesschain/personal-data-hub/forensics/wechat-collect",
        );
    if (!options.db) throw new Error("need --db <EnMicroMsg.db>");
    const raw = fs.readFileSync(options.db);
    const readLines = (f) =>
      f && fs.existsSync(f)
        ? fs.readFileSync(f, "utf8").split(/\s+/).filter(Boolean)
        : [];
    let passphrases = readLines(options.keys);
    const uins = readLines(options.uins);
    const imeis = options.imeis ? readLines(options.imeis) : [];
    // Android 13 IMEI usually unreadable → always try empty + a placeholder
    imeis.push("", "1234567890ABCDE");
    if (uins.length)
      passphrases = passphrases.concat(
        wx.computeKeyCandidates(imeis, uins, passphrases),
      );
    const rawKeys =
      options.rawKeys && fs.existsSync(options.rawKeys)
        ? (() => {
            try {
              return JSON.parse(fs.readFileSync(options.rawKeys, "utf8"));
            } catch {
              return [];
            }
          })()
        : [];
    if (!passphrases.length && !rawKeys.length) {
      throw new Error("no key candidates (need --uins, --keys, or --raw-keys)");
    }

    const result = wx.deriveAndDecrypt(raw, passphrases, rawKeys);
    if (!result) {
      const report = {
        ok: false,
        reason: "no-key-match",
        candidates: passphrases.length + rawKeys.length,
      };
      if (options.json) {
        jsonAndExit(report);
        return;
      }
      if (spinner)
        spinner.fail(
          "no WeChat key matched (supply a saved --keys or frida --raw-keys)",
        );
      process.exit(2);
    }

    const hub = await (options._getHub || getHub)();
    const vault = hub.vault;
    const Database = (vault.db || vault._db || vault).constructor;
    const tmp = path.join(
      path.dirname(path.resolve(options.db)),
      `enmm-dec-${process.pid}.db`,
    );
    fs.writeFileSync(tmp, result.decrypted);
    let parsed;
    try {
      parsed = wx.parseEvents(Database, tmp, options.self || "self");
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* wipe plaintext */
      }
    }
    // parseEvents now returns { events, persons, topics } (bare-array shape
    // from older bundles tolerated for forward-compat).
    const events = Array.isArray(parsed) ? parsed : parsed.events || [];
    const persons = Array.isArray(parsed) ? [] : parsed.persons || [];
    const topics = Array.isArray(parsed) ? [] : parsed.topics || [];

    // Named contacts + group topics first so events resolve names / interests.
    for (const p of persons) {
      try {
        vault.putPerson(p);
      } catch {
        /* dup / optional */
      }
    }
    for (const t of topics) {
      try {
        if (typeof vault.putTopic === "function") vault.putTopic(t);
      } catch {
        /* dup / optional */
      }
    }
    let ingested = 0;
    for (const ev of events) {
      try {
        vault.putEvent(ev);
        ingested++;
      } catch {
        /* dup */
      }
    }
    const report = {
      ok: true,
      cfg: result.cfg,
      messages: events.length,
      persons: persons.length,
      topics: topics.length,
      ingested,
    };
    if (spinner)
      spinner.succeed(`collect-wechat: ${ingested} messages → vault`);
    if (options.json) {
      jsonAndExit(report);
      return;
    }
    logger.log(chalk.green("✓ WeChat collect succeeded"));
    logger.log(`  config:    ${result.cfg}`);
    logger.log(`  messages:  ${events.length}`);
    logger.log(`  ingested:  ${ingested}`);
    process.exit(0);
  } catch (err) {
    fail(spinner, err, options.json);
  }
}

// ─── collect-qzone (QQ空间 说说/留言板/相册 via API → vault) ──────────────
//
// module 101 — Qzone has no local DB, so this is the cookie+g_tk API path. The
// Android in-app WebView (or a desktop browser) captures the qzone-domain
// p_skey cookie; this derives g_tk and pulls the owner's feeds. The cookie is
// passed via --cookie or --cookie-file (kept out of argv/history when staged).
async function cmdCollectQzone(options) {
  const spinner = options.json
    ? null
    : ora("collect-qzone (API + ingest)...").start();
  try {
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    const fs = require("fs");
    const qz = options._qzoneCore
      ? options._qzoneCore
      : await importPdh(
          "@chainlesschain/personal-data-hub/forensics/qzone-collect",
        );
    let cookie = options.cookie;
    if (!cookie && options.cookieFile && fs.existsSync(options.cookieFile))
      cookie = fs.readFileSync(options.cookieFile, "utf8").trim();
    if (!cookie)
      throw new Error(
        'need --cookie "<qzone cookie>" or --cookie-file <path> (must contain uin + p_skey)',
      );
    const what = (options.what || "shuoshuo,msgb,album")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const max = Number.isFinite(+options.max) ? +options.max : 1000;

    const result = await qz.collectQzone({
      uin: options.uin,
      cookie,
      what,
      max,
      fetchImpl: options._fetch,
    });
    if (!result.ok) {
      const report = { ok: false, reason: result.reason };
      if (options.json) {
        jsonAndExit(report);
        return;
      }
      if (spinner) spinner.fail(`collect-qzone: ${result.reason}`);
      process.exit(2);
    }

    const hub = await (options._getHub || getHub)();
    const vault = hub.vault;
    try {
      vault.putPerson({
        type: "person",
        subtype: "contact",
        id: qz.SELF_ID,
        names: ["我(QQ空间)"],
        source: {
          adapter: "qzone",
          adapterVersion: "0.1.0",
          originalId: qz.SELF_ID,
          capturedAt: Date.now(),
          capturedBy: "api",
        },
        ingestedAt: Date.now(),
      });
    } catch {
      /* dup */
    }
    for (const p of result.persons) {
      try {
        vault.putPerson(p);
      } catch {
        /* dup */
      }
    }
    let ingested = 0;
    for (const ev of result.events) {
      try {
        vault.putEvent(ev);
        ingested++;
      } catch {
        /* dup */
      }
    }

    const report = {
      ok: true,
      uin: result.uin,
      counts: result.counts,
      events: result.events.length,
      persons: result.persons.length,
      ingested,
    };
    if (spinner)
      spinner.succeed(
        `collect-qzone: ${ingested} events → vault (${Object.entries(
          result.counts,
        )
          .map(([k, v]) => k + ":" + v)
          .join(" ")})`,
      );
    if (options.json) {
      jsonAndExit(report);
      return;
    }
    logger.log(chalk.green("✓ Qzone collect succeeded"));
    logger.log(`  counts:    ${JSON.stringify(result.counts)}`);
    logger.log(`  ingested:  ${ingested}`);
    process.exit(0);
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
    // Bypass vite import-analysis (which can't resolve subpath exports
    // for dynamic imports in vitest SSR mode) by composing the specifier
    // at runtime — the static analyzer skips non-literal arguments.
    const hcSpecifier =
      "@chainlesschain/personal-data-hub" +
      "/adapters/ai-chat-history/health-checker";
    const { createAIChatHealthChecker } = await import(hcSpecifier);
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
    logger.log(
      `  ${probe.ok ? chalk.green("✓") : chalk.red("✗")} suggested: ${chalk.cyan(probe.suggestedKeyProvider)}`,
    );
    logger.log(
      `  device: ${probe.device.reachable ? chalk.green("reachable") : chalk.red("unreachable")}${probe.device.serial ? " (" + probe.device.serial + ")" : ""} abi=${probe.device.abi || "?"}`,
    );
    logger.log(
      `  root: ${probe.root.detected ? chalk.green("yes") : chalk.gray("no")} magisk=${probe.root.magiskInstalled ? "yes" : "no"}`,
    );
    logger.log(
      `  frida-server: ${probe.frida.serverRunning ? chalk.green("running") : chalk.gray("not running")}${probe.frida.port ? " :" + probe.frida.port : ""}`,
    );
    logger.log(
      `  wechat: ${probe.wechat.installed ? chalk.green(probe.wechat.versionName) : chalk.gray("not installed")}`,
    );
    for (const reason of probe.reasons || [])
      logger.log(`  · ${chalk.gray(reason)}`);
    for (const w of probe.warnings || [])
      logger.log(`  ${chalk.yellow("!")} ${chalk.yellow(w)}`);
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
      fridaOpts: options.fridaDeviceId
        ? { deviceId: options.fridaDeviceId }
        : null,
    });
    if (options.json) {
      printJson(r);
      return;
    }
    if (!r.ok) {
      logger.error(
        chalk.red(`✗ ${r.reason || "register failed"}: ${r.message || ""}`),
      );
      if (r.probe) {
        for (const reason of r.probe.reasons || [])
          logger.error(chalk.gray("  · " + reason));
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
      const active = row.active ? chalk.green(" [active]") : "";
      logger.log(
        `  • uin=${chalk.cyan(row.uin)}${active} provider=${row.chosenKeyProvider || "?"} db=${row.dbPath || "(none)"} regAt=${row.registeredAt ? new Date(row.registeredAt).toISOString() : "?"}`,
      );
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdWechatActivate(uin, options) {
  try {
    if (!uin) throw new Error("uin argument required");
    const hub = await (options._getHub || getHub)();
    const r = await hub.activateWechatAdapter(uin, {
      keyProviderOverride: options.forceProvider || null,
      fridaOpts: options.fridaDeviceId
        ? { deviceId: options.fridaDeviceId }
        : null,
    });
    if (options.json) {
      printJson(r);
      return;
    }
    if (!r.ok) {
      logger.error(
        chalk.red(
          `activate failed: ${r.reason || "unknown"} ${r.message || ""}`,
        ),
      );
      process.exit(1);
    }
    logger.log(chalk.green(`WeChat account activated (uin=${uin})`));
    logger.log(`  provider: ${chalk.cyan(r.chosenKeyProvider || "?")}`);
  } catch (err) {
    fail(null, err, options.json);
  }
}

/**
 * Phase 1c — `cc hub bilibili-adb-sync`
 *
 * One-shot Bilibili C 路径 sync: pulls cookies from the user's Android
 * Bilibili App via ADB, fetches history/favourite/dynamic/follow, writes
 * a snapshot, and ingests via the existing social-bilibili adapter.
 *
 * Requires:
 *  - `adb` on PATH (or ADB_PATH env var) — see host-adb-bridge.js
 *  - exactly one Android device attached + authorized (set ADB_SERIAL if
 *    multiple are present)
 *  - phone rooted (Bilibili release APK isn't debuggable; we use `su -c
 *    base64` to read /data/data/tv.danmaku.bili/app_webview/Default/Cookies)
 *  - user already logged into the Bilibili App on the phone
 *
 * Common failure reasons (UI maps these to actionable banners):
 *  - BRIDGE_UNAVAILABLE — adb missing on host
 *  - BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN — Cookies path absent
 *  - BILIBILI_NO_ROOT — phone isn't rooted
 *  - BILIBILI_COOKIES_INCOMPLETE — user logged out, or Keystore-wrapped
 *    cookies we can't decrypt yet
 *  - SYNC_FAILED — anything else (HTTP / vault error)
 */
async function cmdBilibiliAdbSync(options) {
  try {
    const hub = await (options._getHub || getHub)();
    const result = await hub.bilibiliAdbSync({
      stagingDir: options.stagingDir,
      displayName: options.displayName,
      limits:
        options.limitHistory ||
        options.limitFavourite ||
        options.limitDynamic ||
        options.limitFollow
          ? {
              history: parsePositiveInt(options.limitHistory),
              favourite: parsePositiveInt(options.limitFavourite),
              dynamic: parsePositiveInt(options.limitDynamic),
              follow: parsePositiveInt(options.limitFollow),
            }
          : undefined,
    });
    if (options.json) {
      printJson(result);
      return;
    }
    if (!result.ok) {
      logger.log(chalk.red(`✗ bilibili-adb-sync failed: ${result.reason}`));
      logger.log(chalk.gray(`  ${result.message || ""}`));
      // Inline tips for the common reasons — saves a doc lookup.
      if (result.reason === "BRIDGE_UNAVAILABLE") {
        logger.log(
          chalk.gray(
            "  Install Android Platform Tools or set ADB_PATH=/path/to/adb",
          ),
        );
      } else if (result.reason === "BILIBILI_NO_ROOT") {
        logger.log(
          chalk.gray(
            "  Bilibili release APK isn't debuggable; root + Magisk required to read its Cookies DB",
          ),
        );
      } else if (
        result.reason === "BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN"
      ) {
        logger.log(
          chalk.gray(
            "  Install Bilibili App on the phone + log in once, then retry",
          ),
        );
      } else if (result.reason === "BILIBILI_COOKIES_INCOMPLETE") {
        logger.log(
          chalk.gray(
            "  Cookie file is missing required fields — relog on the phone",
          ),
        );
      }
      process.exitCode = 1;
      return;
    }
    const report = result.report || {};
    const bili = report.bilibili || {};
    const counts = bili.eventCounts || {};
    logger.log(chalk.green(`✓ bilibili-adb-sync succeeded`));
    logger.log(`  uid:        ${chalk.cyan(bili.uid)}`);
    logger.log(`  history:    ${counts.history || 0}`);
    logger.log(`  favourite:  ${counts.favourite || 0}`);
    logger.log(`  dynamic:    ${counts.dynamic || 0}`);
    logger.log(`  follow:     ${counts.follow || 0}`);
    logger.log(`  total:      ${counts.total || 0}`);
    if (bili.lastErrorCode) {
      logger.log(
        chalk.yellow(
          `  ⚠ partial: lastErrorCode=${bili.lastErrorCode} (${bili.lastErrorMessage || "?"})`,
        ),
      );
    }
    logger.log(`  status:     ${report.status || "?"}`);
    logger.log(`  rawCount:   ${report.rawCount || 0}`);
    const ec = report.entityCounts || {};
    logger.log(`  events:     ${ec.events || 0}`);
    if (bili.cleanupFailed) {
      logger.log(
        chalk.gray(`  (note: staging file cleanup failed — non-fatal)`),
      );
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

/**
 * Phase 3c — `cc hub xhs-adb-sync`
 *
 * Pulls xiaohongshu.com cookies from the user's Android Xhs App, fetches
 * userId + 3 endpoints (notes/liked/follows, X-S signed best-effort).
 * Inline tip per typed reason codes + meFetchFailed warning.
 */
async function cmdXhsAdbSync(options) {
  try {
    const hub = await (options._getHub || getHub)();
    const result = await hub.xhsAdbSync({
      stagingDir: options.stagingDir,
      displayName: options.displayName,
      limits:
        options.limitNote || options.limitLiked || options.limitFollow
          ? {
              note: parsePositiveInt(options.limitNote),
              liked: parsePositiveInt(options.limitLiked),
              follow: parsePositiveInt(options.limitFollow),
            }
          : undefined,
    });
    if (options.json) {
      printJson(result);
      return;
    }
    if (!result.ok) {
      logger.log(chalk.red(`✗ xhs-adb-sync failed: ${result.reason}`));
      logger.log(chalk.gray(`  ${result.message || ""}`));
      if (result.reason === "BRIDGE_UNAVAILABLE") {
        logger.log(
          chalk.gray(
            "  Install Android Platform Tools or set ADB_PATH=/path/to/adb",
          ),
        );
      } else if (result.reason === "XHS_NO_ROOT") {
        logger.log(
          chalk.gray(
            "  Phone needs Magisk root — Xhs release APK isn't debuggable",
          ),
        );
      } else if (result.reason === "XHS_NOT_INSTALLED") {
        logger.log(
          chalk.gray(
            "  Install Xiaohongshu App on the phone + log in once, then retry",
          ),
        );
      } else if (result.reason === "XHS_COOKIES_INCOMPLETE") {
        logger.log(
          chalk.gray(
            "  a1 / web_session cookie missing — relog on the Xhs App",
          ),
        );
      } else if (
        result.reason === "XHS_COOKIES_TRUNCATED" ||
        result.reason === "XHS_NOT_SQLITE"
      ) {
        logger.log(
          chalk.gray(
            "  ADB stream may be corrupted; unplug + replug USB and retry",
          ),
        );
      }
      process.exitCode = 1;
      return;
    }
    const report = result.report || {};
    const xhs = report.xhs || {};
    const counts = xhs.eventCounts || {};
    logger.log(chalk.green(`✓ xhs-adb-sync succeeded`));
    logger.log(
      `  userId:     ${chalk.cyan(xhs.userId || "(me fetch failed)")}`,
    );
    if (xhs.nickname) {
      logger.log(`  nickname:   ${xhs.nickname}`);
    }
    logger.log(`  notes:      ${counts.note || 0}`);
    logger.log(`  liked:      ${counts.liked || 0}`);
    logger.log(`  follows:    ${counts.follow || 0}`);
    logger.log(`  total:      ${counts.total || 0}`);
    logger.log(`  status:     ${report.status || "?"}`);
    logger.log(`  rawCount:   ${report.rawCount || 0}`);
    if (xhs.meFetchFailed) {
      logger.log(
        chalk.yellow(
          `  ⚠ /user/me returned no user_id — cookie expired or web_session missing (lastErrorCode=${xhs.lastErrorCode})`,
        ),
      );
    } else if (xhs.lastErrorCode) {
      // X-S sign best-effort: ~60% GET hit, <30% POST hit; 461 = X-S rejected
      logger.log(
        chalk.yellow(
          `  ⚠ partial: lastErrorCode=${xhs.lastErrorCode} (${xhs.lastErrorMessage || "?"}) — X-S 签名 best-effort, 部分接口 461 可能正常`,
        ),
      );
    }
    if (xhs.cleanupFailed) {
      logger.log(chalk.gray(`  (note: staging cleanup failed — non-fatal)`));
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

/**
 * Phase 6d — `cc hub kuaishou-adb-sync`
 *
 * Pulls www.kuaishou.com cookies from the user's Android Kuaishou App,
 * fetches uid + profile via cookie's api_ph payload (PURE COOKIE PARSE,
 * no HTTP) + 3 signed GraphQL endpoints (watch / collect / search).
 * CLI context has NO sign bridge — 3 signed endpoints short-circuit
 * with lastErrorCode=-99. Desktop wiring upgrades via KuaishouSignBridge.
 */
async function cmdKuaishouAdbSync(options) {
  try {
    const hub = await (options._getHub || getHub)();
    const result = await hub.kuaishouAdbSync({
      stagingDir: options.stagingDir,
      displayName: options.displayName,
      limits:
        options.limitWatch || options.limitCollect || options.limitSearch
          ? {
              watch: parsePositiveInt(options.limitWatch),
              collect: parsePositiveInt(options.limitCollect),
              search: parsePositiveInt(options.limitSearch),
            }
          : undefined,
    });
    if (options.json) {
      printJson(result);
      return;
    }
    if (!result.ok) {
      logger.log(chalk.red(`✗ kuaishou-adb-sync failed: ${result.reason}`));
      logger.log(chalk.gray(`  ${result.message || ""}`));
      if (result.reason === "BRIDGE_UNAVAILABLE") {
        logger.log(
          chalk.gray(
            "  Install Android Platform Tools or set ADB_PATH=/path/to/adb",
          ),
        );
      } else if (result.reason === "KUAISHOU_NO_ROOT") {
        logger.log(
          chalk.gray(
            "  Phone needs Magisk root — Kuaishou release APK isn't debuggable",
          ),
        );
      } else if (result.reason === "KUAISHOU_NOT_INSTALLED") {
        logger.log(
          chalk.gray(
            "  Install 快手 (com.smile.gifmaker, NOT 极速版 com.kuaishou.nebula) + log in once + open any video (WebView populates cookies), then retry",
          ),
        );
      } else if (result.reason === "KUAISHOU_COOKIES_INCOMPLETE") {
        logger.log(
          chalk.gray(
            "  userId / kuaishou.web.cp.api_ph missing — relog on the Kuaishou App",
          ),
        );
      } else if (
        result.reason === "KUAISHOU_COOKIES_TRUNCATED" ||
        result.reason === "KUAISHOU_NOT_SQLITE"
      ) {
        logger.log(
          chalk.gray(
            "  ADB stream may be corrupted; unplug + replug USB and retry",
          ),
        );
      }
      process.exitCode = 1;
      return;
    }
    const report = result.report || {};
    const kuaishou = report.kuaishou || {};
    const counts = kuaishou.eventCounts || {};
    logger.log(chalk.green(`✓ kuaishou-adb-sync succeeded`));
    logger.log(
      `  uid:        ${chalk.cyan(kuaishou.uid || "(profile fetch failed)")}`,
    );
    if (kuaishou.nickname) {
      logger.log(`  nickname:   ${kuaishou.nickname}`);
    }
    logger.log(`  profile:    ${counts.profile || 0}`);
    logger.log(`  watch:      ${counts.watch || 0}`);
    logger.log(`  collect:    ${counts.collect || 0}`);
    logger.log(`  search:     ${counts.search || 0}`);
    logger.log(`  total:      ${counts.total || 0}`);
    logger.log(`  status:     ${report.status || "?"}`);
    logger.log(`  rawCount:   ${report.rawCount || 0}`);
    if (kuaishou.profileFetchFailed) {
      logger.log(
        chalk.yellow(
          `  ⚠ cookie 缺 kuaishou.web.cp.api_ph — relog on Kuaishou (lastErrorCode=${kuaishou.lastErrorCode})`,
        ),
      );
    } else if (
      kuaishou.signProviderUsed === "none" &&
      counts.watch === 0 &&
      counts.collect === 0 &&
      counts.search === 0
    ) {
      logger.log(
        chalk.yellow(
          `  ⚠ 3 signed endpoints short-circuited (no sign bridge in CLI context) — run from desktop app to enable __NS_sig3 via Electron WebContentsView`,
        ),
      );
    } else if (kuaishou.lastErrorCode) {
      logger.log(
        chalk.yellow(
          `  ⚠ partial: lastErrorCode=${kuaishou.lastErrorCode} (${kuaishou.lastErrorMessage || "?"})`,
        ),
      );
    }
    if (kuaishou.cleanupFailed) {
      logger.log(chalk.gray(`  (note: staging cleanup failed — non-fatal)`));
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

/**
 * Phase 6c — `cc hub toutiao-adb-sync`
 *
 * Pulls www.toutiao.com cookies from the user's Android Toutiao App,
 * fetches uid + profile (no _sig) + 3 signed endpoints (feed / collection
 * / search). CLI context has NO sign bridge — 3 signed endpoints short-
 * circuit with lastErrorCode=-99 (no HTTP traffic). Desktop wiring
 * upgrades via ToutiaoSignBridge (Electron WebContentsView).
 */
async function cmdToutiaoAdbSync(options) {
  try {
    const hub = await (options._getHub || getHub)();
    const result = await hub.toutiaoAdbSync({
      stagingDir: options.stagingDir,
      displayName: options.displayName,
      limits:
        options.limitFeed || options.limitCollection || options.limitSearch
          ? {
              feed: parsePositiveInt(options.limitFeed),
              collection: parsePositiveInt(options.limitCollection),
              search: parsePositiveInt(options.limitSearch),
            }
          : undefined,
    });
    if (options.json) {
      printJson(result);
      return;
    }
    if (!result.ok) {
      logger.log(chalk.red(`✗ toutiao-adb-sync failed: ${result.reason}`));
      logger.log(chalk.gray(`  ${result.message || ""}`));
      if (result.reason === "BRIDGE_UNAVAILABLE") {
        logger.log(
          chalk.gray(
            "  Install Android Platform Tools or set ADB_PATH=/path/to/adb",
          ),
        );
      } else if (result.reason === "TOUTIAO_NO_ROOT") {
        logger.log(
          chalk.gray(
            "  Phone needs Magisk root — Toutiao release APK isn't debuggable",
          ),
        );
      } else if (result.reason === "TOUTIAO_NOT_INSTALLED") {
        logger.log(
          chalk.gray(
            "  Install 今日头条 (com.ss.android.article.news, NOT 极速版/.lite) + log in once + open any article (WebView populates cookies), then retry",
          ),
        );
      } else if (result.reason === "TOUTIAO_COOKIES_INCOMPLETE") {
        logger.log(
          chalk.gray(
            "  sessionid / sessionid_ss missing — relog on the Toutiao App",
          ),
        );
      } else if (
        result.reason === "TOUTIAO_COOKIES_TRUNCATED" ||
        result.reason === "TOUTIAO_NOT_SQLITE"
      ) {
        logger.log(
          chalk.gray(
            "  ADB stream may be corrupted; unplug + replug USB and retry",
          ),
        );
      }
      process.exitCode = 1;
      return;
    }
    const report = result.report || {};
    const toutiao = report.toutiao || {};
    const counts = toutiao.eventCounts || {};
    logger.log(chalk.green(`✓ toutiao-adb-sync succeeded`));
    logger.log(
      `  uid:        ${chalk.cyan(toutiao.uid || "(profile fetch failed)")}`,
    );
    if (toutiao.nickname) {
      logger.log(`  nickname:   ${toutiao.nickname}`);
    }
    logger.log(`  profile:    ${counts.profile || 0}`);
    logger.log(`  feed:       ${counts.feed || 0}`);
    logger.log(`  collection: ${counts.collection || 0}`);
    logger.log(`  search:     ${counts.search || 0}`);
    logger.log(`  total:      ${counts.total || 0}`);
    logger.log(`  status:     ${report.status || "?"}`);
    logger.log(`  rawCount:   ${report.rawCount || 0}`);
    if (toutiao.profileFetchFailed) {
      logger.log(
        chalk.yellow(
          `  ⚠ passport/info/v2 returned no user_id — cookie expired or sessionid missing (lastErrorCode=${toutiao.lastErrorCode})`,
        ),
      );
    } else if (
      toutiao.signProviderUsed === "none" &&
      counts.feed === 0 &&
      counts.collection === 0 &&
      counts.search === 0
    ) {
      logger.log(
        chalk.yellow(
          `  ⚠ 3 signed endpoints short-circuited (no sign bridge in CLI context) — run from desktop app to enable _signature via Electron WebContentsView`,
        ),
      );
    } else if (toutiao.lastErrorCode) {
      logger.log(
        chalk.yellow(
          `  ⚠ partial: lastErrorCode=${toutiao.lastErrorCode} (${toutiao.lastErrorMessage || "?"})`,
        ),
      );
    }
    if (toutiao.cleanupFailed) {
      logger.log(chalk.gray(`  (note: staging cleanup failed — non-fatal)`));
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

/**
 * Phase 3a — `cc hub weibo-adb-sync`
 *
 * Pulls m.weibo.cn cookies from the user's Android Weibo App, fetches
 * UID + 3 endpoints (posts/favourites/follows), ingests via social-weibo
 * adapter snapshot mode. Inline tip per typed reason codes.
 */
async function cmdWeiboAdbSync(options) {
  try {
    const hub = await (options._getHub || getHub)();
    const result = await hub.weiboAdbSync({
      stagingDir: options.stagingDir,
      displayName: options.displayName,
      limits:
        options.limitPost || options.limitFavourite || options.limitFollow
          ? {
              post: parsePositiveInt(options.limitPost),
              favourite: parsePositiveInt(options.limitFavourite),
              follow: parsePositiveInt(options.limitFollow),
            }
          : undefined,
    });
    if (options.json) {
      printJson(result);
      return;
    }
    if (!result.ok) {
      logger.log(chalk.red(`✗ weibo-adb-sync failed: ${result.reason}`));
      logger.log(chalk.gray(`  ${result.message || ""}`));
      if (result.reason === "BRIDGE_UNAVAILABLE") {
        logger.log(
          chalk.gray(
            "  Install Android Platform Tools or set ADB_PATH=/path/to/adb",
          ),
        );
      } else if (result.reason === "WEIBO_NO_ROOT") {
        logger.log(
          chalk.gray(
            "  Phone needs Magisk root — Weibo release APK isn't debuggable",
          ),
        );
      } else if (result.reason === "WEIBO_NOT_INSTALLED") {
        logger.log(
          chalk.gray(
            "  Install Weibo App on the phone + log in once, then retry",
          ),
        );
      } else if (result.reason === "WEIBO_COOKIES_INCOMPLETE") {
        logger.log(
          chalk.gray(
            "  SUB cookie missing — relog on the Weibo App (or app uses non-default WebView profile dir)",
          ),
        );
      } else if (
        result.reason === "WEIBO_COOKIES_TRUNCATED" ||
        result.reason === "WEIBO_NOT_SQLITE"
      ) {
        logger.log(
          chalk.gray(
            "  ADB stream may be corrupted; unplug + replug USB and retry",
          ),
        );
      }
      process.exitCode = 1;
      return;
    }
    const report = result.report || {};
    const wb = report.weibo || {};
    const counts = wb.eventCounts || {};
    logger.log(chalk.green(`✓ weibo-adb-sync succeeded`));
    logger.log(`  uid:        ${chalk.cyan(wb.uid || "(uid fetch failed)")}`);
    logger.log(`  posts:      ${counts.post || 0}`);
    logger.log(`  favourites: ${counts.favourite || 0}`);
    logger.log(`  follows:    ${counts.follow || 0}`);
    logger.log(`  total:      ${counts.total || 0}`);
    logger.log(`  status:     ${report.status || "?"}`);
    logger.log(`  rawCount:   ${report.rawCount || 0}`);
    if (wb.uidFetchFailed) {
      logger.log(
        chalk.yellow(
          `  ⚠ /api/config returned login=false — cookie expired or anti-bot redirect (lastErrorCode=${wb.lastErrorCode})`,
        ),
      );
    } else if (wb.lastErrorCode) {
      logger.log(
        chalk.yellow(
          `  ⚠ partial: lastErrorCode=${wb.lastErrorCode} (${wb.lastErrorMessage || "?"})`,
        ),
      );
    }
    if (wb.cleanupFailed) {
      logger.log(chalk.gray(`  (note: staging cleanup failed — non-fatal)`));
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

/**
 * Phase 2a — `cc hub douyin-adb-sync`
 *
 * Pulls <uid>_im.db from the user's Android Douyin App, parses msg +
 * SIMPLE_USER (abrignoni DFIR schema), ingests via social-douyin adapter
 * snapshot mode. Inline tip per 9 typed reason codes.
 */
async function cmdDouyinAdbSync(options) {
  try {
    const hub = await (options._getHub || getHub)();
    const result = await hub.douyinAdbSync({
      uid: options.uid,
      stagingDir: options.stagingDir,
      displayName: options.displayName,
      limits:
        options.limitMessages || options.limitContacts
          ? {
              messages: parsePositiveInt(options.limitMessages),
              contacts: parsePositiveInt(options.limitContacts),
            }
          : undefined,
    });
    if (options.json) {
      printJson(result);
      return;
    }
    if (!result.ok) {
      logger.log(chalk.red(`✗ douyin-adb-sync failed: ${result.reason}`));
      logger.log(chalk.gray(`  ${result.message || ""}`));
      if (result.reason === "BRIDGE_UNAVAILABLE") {
        logger.log(
          chalk.gray(
            "  Install Android Platform Tools or set ADB_PATH=/path/to/adb",
          ),
        );
      } else if (result.reason === "DOUYIN_NO_ROOT") {
        logger.log(
          chalk.gray(
            "  Phone needs Magisk root — Douyin release APK isn't debuggable",
          ),
        );
      } else if (result.reason === "DOUYIN_NOT_INSTALLED") {
        logger.log(chalk.gray("  Install Douyin App on the phone, then retry"));
      } else if (result.reason === "DOUYIN_NO_IM_DB") {
        logger.log(
          chalk.gray(
            "  Log in to Douyin App + open any chat thread to materialize the IM database",
          ),
        );
      } else if (result.reason === "DOUYIN_MULTIPLE_USERS") {
        logger.log(
          chalk.gray(
            "  Multiple accounts on this phone — pass --uid <19-digit> to pick one",
          ),
        );
      }
      process.exitCode = 1;
      return;
    }
    const report = result.report || {};
    const dy = report.douyin || {};
    const counts = dy.eventCounts || {};
    logger.log(chalk.green(`✓ douyin-adb-sync succeeded`));
    logger.log(`  uid:        ${chalk.cyan(dy.uid)}`);
    logger.log(`  messages:   ${counts.message || 0}`);
    logger.log(`  contacts:   ${counts.contact || 0}`);
    logger.log(`  total:      ${counts.total || 0}`);
    logger.log(`  status:     ${report.status || "?"}`);
    logger.log(`  rawCount:   ${report.rawCount || 0}`);
    const diag = dy.parserDiagnostic || {};
    if (!diag.hadMsgTable) {
      logger.log(
        chalk.yellow(
          `  ⚠ msg table not found — Douyin App version may use a different IM schema`,
        ),
      );
    }
    if (!diag.hadSimpleUserTable) {
      logger.log(
        chalk.yellow(
          `  ⚠ SIMPLE_USER table not found — contacts won't be ingested`,
        ),
      );
    }
    if (dy.cleanupFailed) {
      logger.log(chalk.gray(`  (note: staging cleanup failed — non-fatal)`));
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

async function cmdDouyinWatchSync(options) {
  try {
    const hub = await (options._getHub || getHub)();
    const result = await hub.douyinWatchSync({
      uid: options.uid,
      stagingDir: options.stagingDir,
      displayName: options.displayName,
      limit: parsePositiveInt(options.limit),
      resolveTitles: !!options.resolveTitles,
      titleLimit: parsePositiveInt(options.titleLimit),
    });
    if (options.json) {
      printJson(result);
      return;
    }
    if (!result.ok) {
      logger.log(chalk.red(`✗ douyin-watch-sync failed: ${result.reason}`));
      logger.log(chalk.gray(`  ${result.message || ""}`));
      if (result.reason === "DOUYIN_NO_ROOT") {
        logger.log(
          chalk.gray(
            "  Phone needs Magisk root — Douyin release APK isn't debuggable",
          ),
        );
      } else if (result.reason === "DOUYIN_VIDEO_RECORD_MISSING") {
        logger.log(
          chalk.gray(
            "  Open Douyin + watch a few videos to populate video_record.db, then retry",
          ),
        );
      } else if (result.reason === "BRIDGE_UNAVAILABLE") {
        logger.log(
          chalk.gray(
            "  Install Android Platform Tools or set ADB_PATH=/path/to/adb",
          ),
        );
      }
      process.exitCode = 1;
      return;
    }
    const report = result.report || {};
    const dy = report.douyin || {};
    const counts = dy.eventCounts || {};
    logger.log(chalk.green(`✓ douyin-watch-sync succeeded`));
    logger.log(`  uid:        ${chalk.cyan(dy.uid || "?")}`);
    logger.log(`  watched:    ${counts.history || 0}`);
    if (options.resolveTitles) {
      logger.log(`  titles:     ${dy.titlesResolved || 0} resolved`);
    }
    logger.log(`  status:     ${report.status || "?"}`);
    logger.log(`  rawCount:   ${report.rawCount || 0}`);
    if (dy.cleanupFailed) {
      logger.log(chalk.gray(`  (note: staging cleanup failed — non-fatal)`));
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

/**
 * Phase 1e — `cc hub bilibili-adb-doctor`
 *
 * Dry-run env probe. Runs only the cookies-extraction half of the sync
 * pipeline (no api.bilibili.com calls, no vault writes) so the user can
 * confirm root + Bilibili-installed + cookie-complete BEFORE triggering
 * a real sync. Surfaces the same 9 typed reasons as bilibili-adb-sync
 * but with a green "✓ ready to sync" message on success.
 *
 * Use this as the first command in a real-device E2E session.
 */
async function cmdBilibiliAdbDoctor(options) {
  try {
    const hub = await (options._getHub || getHub)();
    const result = await hub.bilibiliAdbDoctor();
    if (options.json) {
      printJson(result);
      return;
    }
    if (!result.ok) {
      logger.log(chalk.red(`✗ bilibili-adb-doctor: ${result.reason}`));
      logger.log(chalk.gray(`  ${result.message || ""}`));
      if (result.reason === "BRIDGE_UNAVAILABLE") {
        logger.log(
          chalk.gray(
            "  Fix: install Android Platform Tools, or set ADB_PATH=/path/to/adb",
          ),
        );
      } else if (result.reason === "BILIBILI_NO_ROOT") {
        logger.log(
          chalk.gray(
            "  Fix: phone needs Magisk root — Bilibili release APK isn't debuggable",
          ),
        );
      } else if (
        result.reason === "BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN"
      ) {
        logger.log(
          chalk.gray("  Fix: install Bilibili App + log in once on the phone"),
        );
      } else if (result.reason === "BILIBILI_COOKIES_INCOMPLETE") {
        logger.log(
          chalk.gray(
            "  Fix: relog on the Bilibili App — required cookies are missing",
          ),
        );
      } else if (
        result.reason === "BILIBILI_COOKIES_TRUNCATED" ||
        result.reason === "BILIBILI_NOT_SQLITE"
      ) {
        logger.log(
          chalk.gray(
            "  Fix: ADB stream may be corrupted; unplug + replug USB and retry",
          ),
        );
      }
      process.exitCode = 1;
      return;
    }
    const diag = result.cookieDiagnostic || {};
    logger.log(chalk.green(`✓ bilibili-adb-doctor: env ready to sync`));
    logger.log(`  uid:                 ${chalk.cyan(result.uid)}`);
    logger.log(`  cookies found:       ${diag.cookieCount || "?"}`);
    if (diag.hadEncrypted) {
      logger.log(
        chalk.yellow(
          `  ⚠ encrypted rows:    some cookies are Android-Keystore-wrapped (skipped)`,
        ),
      );
      logger.log(
        chalk.gray(
          `  This may indicate a newer Bilibili App on Android 14+ using Keystore wrap.`,
        ),
      );
    }
    logger.log(
      `  extracted at:        ${new Date(result.extractedAt).toISOString()}`,
    );
    logger.log(
      chalk.gray(
        `\n  Next: run \`cc hub bilibili-adb-sync\` to ingest 4 endpoints.`,
      ),
    );
  } catch (err) {
    fail(null, err, options.json);
  }
}

/**
 * `cc hub wechat doctor` — env-probe + actionable interpretation +
 * inline reference to the Phase 12.9 §5.1 Frida hook trap table.
 *
 * Designed to be the single command user runs on a rooted Android during
 * Phase 12.9 real-device E2E to figure out "what should I do next?" —
 * combines env-probe output + readiness checklist (per md5 vs frida
 * path) + post-register telemetry fields to capture if hook fails.
 *
 * Returns the same JSON as env-probe + a `doctor` block under --json so
 * scripts can branch on `doctor.readiness === 'ready' | 'blocked' | 'partial'`.
 */
async function cmdWechatDoctor(options) {
  try {
    const hub = await (options._getHub || getHub)();
    const probe = await hub.probeWechatEnv();

    // Determine readiness + concrete next-action based on probe shape.
    const advice = interpretWechatProbe(probe);

    if (options.json) {
      printJson({ probe, doctor: advice });
      return;
    }

    // Human-readable: re-use env-probe formatting then append advice.
    logger.log(chalk.bold("WeChat env-probe:"));
    logger.log(
      `  ${probe.ok ? chalk.green("✓") : chalk.red("✗")} suggested: ${chalk.cyan(probe.suggestedKeyProvider)}`,
    );
    logger.log(
      `  device: ${probe.device.reachable ? chalk.green("reachable") : chalk.red("unreachable")}${probe.device.serial ? " (" + probe.device.serial + ")" : ""} abi=${probe.device.abi || "?"}`,
    );
    logger.log(
      `  root: ${probe.root.detected ? chalk.green("yes") : chalk.gray("no")} magisk=${probe.root.magiskInstalled ? "yes" : "no"}`,
    );
    logger.log(
      `  frida-server: ${probe.frida.serverRunning ? chalk.green("running") : chalk.gray("not running")}${probe.frida.port ? " :" + probe.frida.port : ""}`,
    );
    logger.log(
      `  wechat: ${probe.wechat.installed ? chalk.green(probe.wechat.versionName) : chalk.gray("not installed")}`,
    );

    logger.log("");
    const statusColor =
      advice.readiness === "ready"
        ? chalk.green
        : advice.readiness === "partial"
          ? chalk.yellow
          : chalk.red;
    logger.log(
      chalk.bold(`Doctor: ${statusColor(advice.readiness.toUpperCase())}`),
    );
    for (const blocker of advice.blockers) {
      logger.log(`  ${chalk.red("✗")} ${blocker}`);
    }
    for (const w of advice.warnings) {
      logger.log(`  ${chalk.yellow("!")} ${w}`);
    }
    for (const step of advice.nextSteps) {
      logger.log(`  ${chalk.cyan("→")} ${step}`);
    }

    if (advice.readiness !== "blocked") {
      logger.log("");
      logger.log(
        chalk.bold("After `cc hub wechat register`, capture telemetry:"),
      );
      logger.log(
        chalk.gray(
          "  cc hub wechat register --uin <UIN> --db ... --json | jq '.fridaTelemetry'",
        ),
      );
      logger.log(
        chalk.gray(
          "  Expected fields: hooked / keySource / keySig / keyFormat / keyLength / keyAlt / errors / durationMs",
        ),
      );
      logger.log("");
      logger.log(
        chalk.bold("If hook fails, match telemetry against trap table:"),
      );
      logger.log(
        chalk.gray(
          "  A — hooked:[] empty           → libWCDB.so module name (try OEM custom names)",
        ),
      );
      logger.log(
        chalk.gray(
          "  B — keySig:v2 but DB won't open → sqlite3_key_v2 args index wrong",
        ),
      );
      logger.log(
        chalk.gray(
          "  C — keyFormat:raw-bytes but len=64 → ascii-hex path missed",
        ),
      );
      logger.log(
        chalk.gray(
          "  Full table: docs/design/Personal_Data_Hub_Phase_12_9_*Runbook.md §5.1",
        ),
      );
    }
  } catch (err) {
    fail(null, err, options.json);
  }
}

/**
 * Interpret env-probe result into { readiness, blockers, warnings, nextSteps }.
 * Pure function — testable without device.
 *
 * @param {object} probe  output of hub.probeWechatEnv()
 * @returns {{readiness: 'ready'|'partial'|'blocked', blockers: string[],
 *   warnings: string[], nextSteps: string[]}}
 */
function interpretWechatProbe(probe) {
  const blockers = [];
  const warnings = [];
  const nextSteps = [];

  if (!probe || !probe.device || !probe.device.reachable) {
    blockers.push("adb 设备未连接 (USB 调试 / drivers / authorize?)");
    nextSteps.push("`adb devices` 应列出至少一台 device 状态");
    return { readiness: "blocked", blockers, warnings, nextSteps };
  }

  if (!probe.wechat || !probe.wechat.installed) {
    blockers.push("WeChat (com.tencent.mm) 未安装");
    nextSteps.push("先把 WeChat 装上 + 登一次产生 EnMicroMsg.db");
    return { readiness: "blocked", blockers, warnings, nextSteps };
  }

  const ver = probe.wechat.majorVersion || 0;
  const suggested = probe.suggestedKeyProvider;

  if (ver < 8 && suggested === "md5") {
    nextSteps.push(
      "MD5 path: `adb pull /data/data/com.tencent.mm/ /tmp/wechat-data/`",
    );
    nextSteps.push(
      "拉到本地后跑: `cc hub wechat register --uin <UIN> --db /tmp/wechat-data/MicroMsg/<md5-uin>/EnMicroMsg.db --wechat-data-path /tmp/wechat-data/`",
    );
    if (!probe.root.detected) {
      warnings.push(
        "非 root 设备只能 adb pull WeChat backup 子集 — 可能拿不到全部 db / 文件",
      );
    }
    return { readiness: "ready", blockers, warnings, nextSteps };
  }

  if (ver >= 8 && suggested === "frida") {
    if (!probe.root.detected) {
      blockers.push("WeChat ≥ 8.0 必须 root + Frida hook，当前设备未 root");
      nextSteps.push("Magisk 刷入 → 重启 → 重跑 doctor");
      return { readiness: "blocked", blockers, warnings, nextSteps };
    }
    if (!probe.frida.serverRunning) {
      blockers.push("Frida server 未运行");
      nextSteps.push(
        "见 docs/design/Adapter_WeChat_SQLCipher_Frida_Setup.md §2 启 frida-server",
      );
      return { readiness: "partial", blockers, warnings, nextSteps };
    }
    nextSteps.push(
      "Frida path 就绪。register: `cc hub wechat register --uin <wxid>`（无需 --db / --wechat-data-path）",
    );
    nextSteps.push("WeChat 必须前台运行（已登录），register 期间不要切走");
    return { readiness: "ready", blockers, warnings, nextSteps };
  }

  if (suggested === "unsupported") {
    blockers.push("env-probe 判定为 unsupported");
    for (const reason of probe.reasons || []) blockers.push(reason);
    nextSteps.push(
      "见 docs/design/Adapter_WeChat_SQLCipher.md §13 — 检查 WeChat 版本兼容矩阵",
    );
    return { readiness: "blocked", blockers, warnings, nextSteps };
  }

  // Fallback — probe shape we don't recognize
  warnings.push(
    `未识别的 suggested='${suggested}' (version=${probe.wechat.versionName || "?"})`,
  );
  return { readiness: "partial", blockers, warnings, nextSteps };
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
    if (r.removed)
      logger.log(chalk.green(`✓ removed wechat account (uin=${uin})`));
    else
      logger.log(
        chalk.gray(`(uin=${uin} was not registered — nothing removed)`),
      );
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
    .option(
      "--max-facts <n>",
      "Cap facts in prompt (default 80; on-device small models e.g. Qwen2.5-1.5B should pass 20)",
    )
    .option(
      "--max-query-limit <n>",
      "Cap vault queryEvents limit (default 200; small-model callers should pass 50)",
    )
    .option("--json", "Output JSON")
    .addHelpText(
      "after",
      "\nLLM backend: defaults to local Ollama (privacy). To use a cloud provider:\n" +
        "  • Persistent (recommended): cc config set hub.llm config\n" +
        "      → uses cc config's llm.{provider,model,baseUrl,apiKey}; no flag/env needed,\n" +
        "        and the standing config opt-in also authorizes off-device egress.\n" +
        "      Separate key/account for the hub? set an object instead:\n" +
        "        cc config set hub.llm.provider volcengine\n" +
        "        cc config set hub.llm.model doubao-seed-2-1-pro-260628\n" +
        "        cc config set hub.llm.apiKeyEnv MY_HUB_KEY   (or hub.llm.apiKey <key>)\n" +
        "  • Ephemeral: CC_HUB_LLM=config|<provider> cc hub ask … --accept-non-local\n" +
        "      (a one-off override still needs an explicit egress flag).",
    )
    .action(cmdAsk);

  hub
    .command("repl")
    .description(
      "Persistent ask loop — opens the vault once, then answers follow-up questions fast (amortizes the ~8s per-call CLI cold-start)",
    )
    .option("--no-use-rag", "Disable RAG retrieval")
    .option(
      "--accept-non-local",
      "Allow non-local LLM (sends data off device — required when provider is not Ollama/vLLM)",
    )
    .option("--max-facts <n>", "Cap facts in prompt (default 80)")
    .option(
      "--max-query-limit <n>",
      "Cap vault queryEvents limit (default 200)",
    )
    .addHelpText(
      "after",
      "\nSame per-question semantics + cloud-egress gate as `cc hub ask`, but the\n" +
        "~8s cold-start is paid ONCE. Type questions at the `hub>` prompt; .exit to quit.",
    )
    .action(cmdRepl);

  hub
    .command("retrieve-context <question>")
    .description(
      "RAG preflight — gather facts + build LLM prompt WITHOUT calling LLM (for cloud-LLM callers that need RAG context)",
    )
    .option(
      "--max-facts <n>",
      "Cap facts in prompt (default 80; on-device small models e.g. Qwen2.5-1.5B should pass 20)",
    )
    .option(
      "--max-query-limit <n>",
      "Cap vault queryEvents limit (default 200; small-model callers should pass 50)",
    )
    .option(
      "--no-minimal",
      "Use full hub init (with adapters / KG / RAG sinks). Default uses minimal init (vault + engine only) which is ~10-20x faster on cold-start.",
    )
    .action(cmdRetrieveContext);

  hub
    .command("stats")
    .description(
      "Vault row counts + hub paths (use --full to also list adapters + LLM)",
    )
    .option("--json", "Output JSON")
    .option(
      "--full",
      "Include registered adapter list + resolved LLM (loads the full hub)",
    )
    .action(cmdStats);

  hub
    .command("health")
    .description("Component health: vault / llm / kgSink / ragSink")
    .option("--json", "Output JSON")
    .option(
      "--quick",
      "Vault-only probe via the minimal hub (skips llm/kgSink/ragSink wiring)",
    )
    .action(cmdHealth);

  hub
    .command("list-adapters")
    .description("List registered adapters")
    .option("--json", "Output JSON")
    .action(cmdListAdapters);

  hub
    .command("readiness")
    .description(
      "Per-adapter 就绪检查：能否采集 + 不能的原因（未配置/需采集/不支持）",
    )
    .option("--timeout <ms>", "Per-adapter probe timeout (default 4000)")
    .option("--json", "Output JSON")
    .action(cmdReadiness);

  hub
    .command("sync-adapter <name>")
    .description("Run one adapter's ingest pipeline")
    .option("--since <ms>", "Override watermark — sync from this unix-ms")
    .option("--until <ms>", "Stop at this unix-ms")
    .option("--limit <n>", "Cap ingested events")
    .option(
      "--input <path>",
      "Path to a snapshot file or local DB (system-data-android snapshot, douyin <uid>_im.db, wechat-pc MSG*.db, etc.)",
    )
    .option(
      "--roots <dirs>",
      "Comma-separated directories to scan (local-files adapter, e.g. /sdcard/Documents,/sdcard/Download)",
    )
    .option(
      "--db-path <path>",
      "Explicit local DB path (alias of --input for device-pull adapters)",
    )
    .option(
      "--key <hex>",
      "Encryption key: SQLCipher 64-hex, WhatsApp crypt15 64-hex, or WhatsApp key-file path",
    )
    .option(
      "--serial <adb-serial>",
      "Android device serial for ADB-backed adapters (otherwise ADB_SERIAL or the single connected device)",
    )
    .option(
      "--whatsapp-business",
      "Pull the WhatsApp Business public backup instead of the personal app backup",
    )
    .option(
      "--remote-path <android-path>",
      "Explicit WhatsApp msgstore backup path inside an allowed public Databases directory",
    )
    .option(
      "--passphrase <key>",
      'QQ NT SQLCipher passphrase from qq-win-db-key (ASCII, e.g. "5{sww#,6aq=)8=A@") — decrypts + parses qq-pc',
    )
    .option(
      "--cookie <cookie>",
      "Login cookie for supported shopping, travel, and social collectors",
    )
    .option(
      "--cookie-file <path>",
      "Read the login cookie from a local file (preferred over putting it in shell history)",
    )
    .option(
      "--account-id <id>",
      "Platform account identity (for example a Zhihu url_token; stored only as a hashed scope)",
    )
    .option(
      "--zip-password <password>",
      "Password for an Alipay bill ZIP (or set CC_PDH_ZIP_PASSWORD to keep it out of shell history)",
    )
    .option("--json", "Output JSON")
    .action(cmdSyncAdapter);

  hub
    .command("sync-all")
    .description("Run all registered adapters in series")
    .option("--since <ms>", "Override watermark for all")
    .option("--until <ms>", "Stop at this unix-ms")
    .option("--limit <n>", "Cap each adapter")
    .option(
      "--include-unready",
      "Force every registered adapter to run instead of skipping sources that need setup",
    )
    .option("--json", "Output JSON")
    .action(cmdSyncAll);

  // Phase 1c — Bilibili C 路径 one-shot
  hub
    .command("bilibili-adb-sync")
    .description(
      "Bilibili C 路径: pull cookies via ADB from the user's Android Bilibili App, fetch 4 endpoints, ingest as snapshot. Needs rooted Android + Bilibili App logged in + `adb` on PATH.",
    )
    .option("--limit-history <n>", "Cap history items (default 200)")
    .option(
      "--limit-favourite <n>",
      "Cap favourite items per folder (default 50)",
    )
    .option("--limit-dynamic <n>", "Cap dynamic items (default 50)")
    .option("--limit-follow <n>", "Cap follow items (default 200)")
    .option(
      "--display-name <s>",
      "Account displayName for the snapshot (default empty)",
    )
    .option(
      "--staging-dir <path>",
      "Custom dir for the temp snapshot JSON (default os.tmpdir())",
    )
    .option("--json", "Output JSON")
    .action(cmdBilibiliAdbSync);

  // Phase 1e — dry-run env probe (cookies only, no API, no vault write)
  hub
    .command("bilibili-adb-doctor")
    .description(
      "Bilibili C 路径 dry-run: probe adb + root + Bilibili App + cookies completeness without triggering a sync. Use this BEFORE `cc hub bilibili-adb-sync` to debug env issues.",
    )
    .option("--json", "Output JSON")
    .action(cmdBilibiliAdbDoctor);

  // Phase 3a — Weibo C 路径 one-shot (m.weibo.cn cookies + 4 endpoints, sign-less)
  hub
    .command("weibo-adb-sync")
    .description(
      "Weibo C 路径: pull m.weibo.cn cookies via ADB from the user's Android Weibo App, fetch UID + 3 endpoints (posts/favourites/follows), ingest as snapshot. Needs rooted Android + Weibo App logged in + `adb` on PATH. No X-Bogus / WBI signing required.",
    )
    .option("--limit-post <n>", "Cap user-timeline posts (default 100)")
    .option("--limit-favourite <n>", "Cap favourite items (default 100)")
    .option("--limit-follow <n>", "Cap follow items (default 200)")
    .option(
      "--display-name <s>",
      "Account displayName for the snapshot (default empty)",
    )
    .option(
      "--staging-dir <path>",
      "Custom dir for the temp snapshot JSON (default os.tmpdir())",
    )
    .option("--json", "Output JSON")
    .action(cmdWeiboAdbSync);

  // Phase 6d — Kuaishou C 路径 one-shot (www.kuaishou.com cookies + profile
  // from api_ph + 3 GraphQL endpoints with __NS_sig3 + kpf/kpn).
  // CLI: signed endpoints short-circuit. Desktop: KuaishouSignBridge.
  hub
    .command("kuaishou-adb-sync")
    .description(
      "Kuaishou C 路径: pull www.kuaishou.com cookies via ADB from the user's Android Kuaishou App (com.smile.gifmaker, NOT 极速版 com.kuaishou.nebula), parse profile from kuaishou.web.cp.api_ph cookie payload (no HTTP) + 3 GraphQL endpoints (watch/collect/search, __NS_sig3 + kpf/kpn — CLI short-circuits, desktop uses KuaishouSignBridge). Needs rooted Android + Kuaishou App logged in once + opened a video once + `adb` on PATH.",
    )
    .option(
      "--limit-watch <n>",
      "Cap recommended feed watch history (default 50)",
    )
    .option("--limit-collect <n>", "Cap own posted photos (default 100)")
    .option("--limit-search <n>", "Cap search history (default 50)")
    .option(
      "--display-name <s>",
      "Account displayName for the snapshot (default = api_ph user_name)",
    )
    .option(
      "--staging-dir <path>",
      "Custom dir for the temp snapshot JSON (default os.tmpdir())",
    )
    .option("--json", "Output JSON")
    .action(cmdKuaishouAdbSync);

  // Phase 6c — Toutiao C 路径 one-shot (www.toutiao.com cookies + profile +
  // 3 endpoints with _signature). CLI context: signed endpoints short-circuit
  // (-99) with no HTTP traffic. Desktop: ToutiaoSignBridge → ~100% hit.
  hub
    .command("toutiao-adb-sync")
    .description(
      "Toutiao C 路径: pull www.toutiao.com cookies via ADB from the user's Android Toutiao App (com.ss.android.article.news, NOT 极速版), fetch profile (no _sig) + 3 endpoints (feed/collection/search, _signature required — CLI short-circuits, desktop uses ToutiaoSignBridge). Needs rooted Android + Toutiao App logged in once + `adb` on PATH.",
    )
    .option("--limit-feed <n>", "Cap recommended feed (default 50)")
    .option("--limit-collection <n>", "Cap saved articles (default 200)")
    .option("--limit-search <n>", "Cap search history (default 100)")
    .option(
      "--display-name <s>",
      "Account displayName for the snapshot (default = passport screen_name)",
    )
    .option(
      "--staging-dir <path>",
      "Custom dir for the temp snapshot JSON (default os.tmpdir())",
    )
    .option("--json", "Output JSON")
    .action(cmdToutiaoAdbSync);

  // Phase 3c — Xhs C 路径 one-shot (xiaohongshu.com cookies + 4 endpoints with X-S signing)
  hub
    .command("xhs-adb-sync")
    .description(
      "Xhs C 路径: pull xiaohongshu.com cookies via ADB from the user's Android Xhs App, fetch userId + 3 endpoints (notes/liked/follows). Best-effort X-S signing (~60% GET hit rate). Needs rooted Android + Xhs App logged in + `adb` on PATH.",
    )
    .option("--limit-note <n>", "Cap user notes (default 30)")
    .option("--limit-liked <n>", "Cap liked notes (default 30)")
    .option("--limit-follow <n>", "Cap follow list (default 100)")
    .option(
      "--display-name <s>",
      "Account displayName for the snapshot (default = xhs nickname)",
    )
    .option(
      "--staging-dir <path>",
      "Custom dir for the temp snapshot JSON (default os.tmpdir())",
    )
    .option("--json", "Output JSON")
    .action(cmdXhsAdbSync);

  // Phase 2a — Douyin C 路径 one-shot (pull <uid>_im.db → parse abrignoni DFIR schema)
  hub
    .command("douyin-adb-sync")
    .description(
      "Douyin C 路径: pull <uid>_im.db cohort via ADB from the user's Android Douyin App, parse msg + SIMPLE_USER (abrignoni DFIR), ingest as snapshot. Needs rooted Android + Douyin App logged in + `adb` on PATH.",
    )
    .option(
      "--uid <id>",
      "19-digit Douyin uid — required when multiple accounts logged in on the phone",
    )
    .option(
      "--limit-messages <n>",
      "Cap msg rows from the IM db (default 10000)",
    )
    .option(
      "--limit-contacts <n>",
      "Cap SIMPLE_USER rows from the IM db (default 5000)",
    )
    .option(
      "--display-name <s>",
      "Account displayName for the snapshot (default empty)",
    )
    .option(
      "--staging-dir <path>",
      "Custom dir for the temp snapshot JSON (default os.tmpdir())",
    )
    .option("--json", "Output JSON")
    .action(cmdDouyinAdbSync);

  // Douyin watch-history (video_record.db, plaintext — no X-Bogus / no SQLCipher)
  hub
    .command("douyin-watch-sync")
    .description(
      "Douyin 观看历史 C 路径: pull video_record.db via ADB from the user's Android Douyin App (com.ss.android.ugc.aweme), read record_<uid> (aid + view_time_timestamp + enter_from), ingest as `history` (BROWSE) events. Plaintext — no X-Bogus signing, no SQLCipher. Needs rooted Android + Douyin App with watch history. Add --resolve-titles to enrich each event with the video's desc/author/duration via the web detail endpoint (also no signing).",
    )
    .option(
      "--uid <id>",
      "Douyin uid to disambiguate multiple accounts (default: largest record_<uid> table)",
    )
    .option("--limit <n>", "Cap watch records (default 2000)")
    .option(
      "--resolve-titles",
      "Resolve aweme ids → desc/author/duration via the web detail endpoint (no signing) so events show WHAT was watched",
    )
    .option(
      "--title-limit <n>",
      "Cap unique videos to title-resolve (default 60; dedup'd, ~200ms/call)",
    )
    .option("--display-name <s>", "Account displayName for the snapshot")
    .option(
      "--staging-dir <path>",
      "Custom dir for the temp snapshot JSON (default os.tmpdir())",
    )
    .option("--json", "Output JSON")
    .action(cmdDouyinWatchSync);

  hub
    .command("rederive")
    .description(
      "Re-derive canonical events from raw_events without re-fetching " +
        "from source (recovers orphan raws from a past sync where putBatch " +
        "silently failed, e.g. trap #25 partial-index drift).",
    )
    .option(
      "--adapter <name>",
      "Filter to one adapter; default = all registered",
    )
    .option(
      "--batch-size <n>",
      "Raws per partitionBatch+putBatch tx (default 100)",
    )
    .option("--json", "Output JSON")
    .action(cmdRederive);

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
    .command("search")
    .description("Vault Browser search — events_fts (FTS5) + faceted filters")
    .option("--q <text>", "Keyword (FTS5 phrase match if mode=fts5)")
    .option("--adapter <name>", "Filter by exact adapter")
    .option(
      "--category <cat>",
      "Filter by category (chat/social/email/shopping/travel/system/ai-chat/other)",
    )
    .option("--subtype <t>", "Filter by event subtype")
    .option("--since <ms>", "Start of time window (unix-ms)")
    .option("--until <ms>", "End of time window (unix-ms)")
    .option("--cursor <occurredAt:id>", "Page cursor from previous response")
    .option("--limit <n>", "Page size (max 500)", "50")
    .option("--json", "Output JSON")
    .action(cmdSearchEvents);

  hub
    .command("facet-counts")
    .description(
      "Sidebar / chip counts — events grouped by category / adapter / subtype",
    )
    .option("--q <text>", "Keyword filter (same semantics as `cc hub search`)")
    .option("--since <ms>", "Start of time window (unix-ms)")
    .option("--until <ms>", "End of time window (unix-ms)")
    .option("--json", "Output JSON")
    .action(cmdFacetCounts);

  hub
    .command("export-events")
    .description(
      "Export all vault events as JSON (module 101 §8.3 cross-device backup)",
    )
    .option("--output <file>", "Write JSON array to file (default: stdout)")
    .option("--json", "Output JSON ({ok,count} with --output; array otherwise)")
    .action(cmdExportEvents);

  hub
    .command("import-events")
    .description(
      "Import vault events from a JSON array file (idempotent upsert by id; §8.3)",
    )
    .requiredOption("--input <file>", "JSON array of events to import")
    .option("--json", "Output JSON result")
    .action(cmdImportEvents);

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
      "Run a built-in analysis skill: overview (跨 app 汇聚, 决策依据) / spending / relations / footprint / interests / timeline. 'analysis.overview' aggregates all apps' data into one cross-app snapshot.",
    )
    .option("--since <ms>", "Start of time window")
    .option("--until <ms>", "End of time window")
    .option("--json", "Output JSON")
    .action(cmdRunSkill);

  hub
    .command("salvage <dumpfile>")
    .description(
      "Method B (免密钥): salvage SQLite leaf-page records from a /proc/mem dump → ingest into the vault with the correct per-app source (--app). Used by the Android root 一键采集 button after a memory scan.",
    )
    .option(
      "--app <key>",
      "Source app: douyin/toutiao/wechat/kuaishou/xiaohongshu/weibo/qq (default douyin)",
    )
    .option(
      "--columns <list>",
      "Comma-separated msg column order; else inferred",
    )
    .option("--page-size <n>", "SQLite page size (default 4096)")
    .option("--min-cols <n>", "Drop records with fewer columns (default 3)")
    .option("--no-unaligned", "Disable the finer (512) stride scan")
    .option("--json", "Output JSON")
    .action(cmdSalvage);

  hub
    .command("collect-qq")
    .description(
      "QQNT (modern QQ): decrypt a root-staged encrypted nt_msg.db via the DERIVED key (no frida), protobuf-parse messages, and ingest into the vault. Used by the Android CollectQqNativeTool (su-reads DB + uids); also runnable on PC.",
    )
    .requiredOption("--db <path>", "Encrypted nt_msg.db (root-staged / pulled)")
    .requiredOption(
      "--uids <path>",
      "File with u_ uid candidates (one per line)",
    )
    .option("--rand <str>", "Override the header-derived rand")
    .option("--self <qq>", "Your own QQ number (attribution fallback)")
    .option("--json", "Output JSON")
    .action(cmdCollectQq);

  hub
    .command("collect-db")
    .description(
      "Ingest an app's PLAINTEXT SQLite dbs (browse/read/history/content/config) into the vault — generic readable-record extraction with noise filtering. Pair with the Magisk daemon which stages the dbs (root, MIUI cross-app). Encrypted IM has its own collectors (collect-qq/collect-wechat).",
    )
    .requiredOption(
      "--app <key>",
      "App key (→ source local-<app>, e.g. qq/toutiao/douyin)",
    )
    .option("--db <path>", "A single plaintext db")
    .option("--dir <dir>", "A dir of plaintext dbs (all *.db ingested)")
    .option("--json", "Output JSON")
    .action(cmdCollectDb);

  hub
    .command("collect-wechat")
    .description(
      "WeChat: decrypt a root-staged EnMicroMsg.db via the DERIVED key MD5(IMEI+uin)[:7] (no frida; saved/raw keys as fallback), parse message/rcontact/chatroom, and ingest. Pairs with the Magisk daemon (stages DB + uin/IMEI candidates).",
    )
    .requiredOption(
      "--db <path>",
      "Encrypted EnMicroMsg.db (root-staged / pulled)",
    )
    .option(
      "--uins <path>",
      "File with uin(s) (one per line) for key derivation",
    )
    .option(
      "--imeis <path>",
      "File with IMEI candidate(s); empty+placeholder always tried",
    )
    .option(
      "--keys <path>",
      "File with saved 7-char passphrase keys (instant re-match)",
    )
    .option(
      "--raw-keys <path>",
      "JSON array of 32-byte raw AES keys (frida fallback)",
    )
    .option("--self <wxid>", "Your own wxid (attribution for sent messages)")
    .option("--json", "Output JSON")
    .action(cmdCollectWechat);

  hub
    .command("collect-qzone")
    .description(
      "QQ空间 (Qzone): collect 说说/留言板/相册 via the Qzone CGI API. No local DB — needs the qzone-domain p_skey cookie (from the in-app WebView or a browser login to user.qzone.qq.com; base .qq.com skey is rejected). Derives g_tk from p_skey and ingests as post/message/media events.",
    )
    .option(
      "--cookie <cookie>",
      "Qzone cookie string (must contain uin + p_skey)",
    )
    .option(
      "--cookie-file <path>",
      "File holding the cookie (preferred — keeps it out of argv)",
    )
    .option("--uin <uin>", "Account uin (else parsed from cookie)")
    .option(
      "--what <list>",
      "Comma list: shuoshuo,msgb,album (default all)",
      "shuoshuo,msgb,album",
    )
    .option("--max <n>", "Max items per source", "1000")
    .option("--json", "Output JSON")
    .action(cmdCollectQzone);

  hub
    .command("event-detail <eventId>")
    .description(
      "推文 §AI 给出处: fetch full event row from local vault by id (used by citation chip deeplink).",
    )
    .option("--json", "Output JSON")
    .action(cmdEventDetail);

  hub
    .command("export")
    .description(
      "推文 §一键带走: copy SQLCipher vault.db (+ WAL/SHM) to <path>. Encrypted at rest; reimport via cc hub import-vault on desktop.",
    )
    .requiredOption(
      "--output <path>",
      "Destination file path for the vault copy",
    )
    .option("--json", "Output JSON")
    .action(cmdExport);

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
    .description(
      "Probe attached Android device for adb / root / frida-server / WeChat version",
    )
    .option("--json", "Output JSON")
    .action(cmdWechatEnvProbe);

  wechat
    .command("register")
    .description(
      "Bootstrap a WeChat adapter (chooses md5 or frida path per env-probe) and persist wechat-accounts.json",
    )
    .requiredOption("--uin <id>", "WeChat numeric UIN (≤ 8.0) or wxid (8.0+)")
    .option("--db <path>", "Local path to the already-pulled EnMicroMsg.db")
    .option(
      "--wechat-data-path <dir>",
      "Local pulled /data/data/com.tencent.mm/ tree (required for md5 path)",
    )
    .option("--force-provider <md5|frida>", "Override env-probe suggestion")
    .option(
      "--frida-device-id <id>",
      "Frida device id (defaults to first USB device)",
    )
    .option("--json", "Output JSON")
    .action(cmdWechatRegister);

  wechat
    .command("list")
    .description("List registered WeChat accounts (scrubbed)")
    .option("--json", "Output JSON")
    .action(cmdWechatList);

  wechat
    .command("activate <uin>")
    .description("Activate a saved WeChat account without registering it again")
    .option("--force-provider <md5|frida>", "Override the saved key provider")
    .option(
      "--frida-device-id <id>",
      "Frida device id (defaults to first USB device)",
    )
    .option("--json", "Output JSON")
    .action(cmdWechatActivate);

  wechat
    .command("unregister <uin>")
    .description(
      "Remove a registered WeChat account (does not touch vault data)",
    )
    .option("--json", "Output JSON")
    .action(cmdWechatUnregister);

  // Phase 12.9 — diagnostic helper for real-device E2E. Combines env-probe
  // with actionable readiness checklist + inline §5.1 Frida trap reference.
  wechat
    .command("doctor")
    .description(
      "Diagnose WeChat setup — env-probe + readiness checklist + Phase 12.9 trap reference",
    )
    .option("--json", "Output JSON")
    .action(cmdWechatDoctor);
}

// exported for tests — handler functions can be invoked directly with
// `_wizard` / `_factoryDeps` / `_knownVendors` injected, bypassing the
// real `getHub()` call. The commander wiring above is the runtime path.
export const _internal = {
  cmdAsk,
  cmdRepl,
  cmdRetrieveContext,
  cmdStats,
  cmdHealth,
  cmdQueryEvents,
  cmdEventDetail,
  parsePositiveInt,
  syncEntityTotal,
  analyzeSyncReport,
  summarizeSyncReports,
  formatSyncReportLine,
  resolveSyncCookie,
  cmdSyncAdapter,
  cmdSyncAll,
  cmdAIChatList,
  cmdAIChatLogin,
  cmdAIChatProbe,
  cmdAIChatRegister,
  cmdAIChatHealth,
  cmdAIChatUnregister,
  cmdWechatEnvProbe,
  cmdWechatRegister,
  cmdWechatList,
  cmdWechatActivate,
  cmdWechatUnregister,
  cmdWechatDoctor,
  cmdBilibiliAdbSync,
  cmdBilibiliAdbDoctor,
  cmdDouyinAdbSync,
  cmdDouyinWatchSync,
  cmdWeiboAdbSync,
  cmdXhsAdbSync,
  cmdToutiaoAdbSync,
  cmdKuaishouAdbSync,
  interpretWechatProbe,
  _defaultKnownVendors,
  exportAllEvents,
  importEventsInto,
  cmdExportEvents,
  cmdImportEvents,
};
