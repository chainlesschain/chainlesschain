/**
 * Smoke tests for `cc hub` subcommand registration.
 *
 * We do NOT exercise the real vault here — that's the cli/integration
 * suite. These tests only verify Commander structure so the command
 * surface exists and accepts the documented options. Real-device end-to-
 * end is documented in docs/design/Personal_Data_Hub_Android_Standalone_Cc
 * .md §12 (T1/T2/T3 PASS on Xiaomi 24115RA8EC 2026-05-20).
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerHubCommand, _internal } from "../../src/commands/hub.js";

function buildProgram() {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit in tests
  registerHubCommand(program);
  return program;
}

describe("cc hub command surface", () => {
  it("registers a 'hub' top-level command", () => {
    const program = buildProgram();
    const hub = program.commands.find((c) => c.name() === "hub");
    expect(hub).toBeDefined();
    expect(hub.description()).toContain("Personal Data Hub");
  });

  it("registers all expected subcommands", () => {
    const program = buildProgram();
    const hub = program.commands.find((c) => c.name() === "hub");
    const subnames = hub.commands.map((c) => c.name()).sort();
    expect(subnames).toEqual(
      [
        "aichat",
        "ask",
        "bilibili-adb-doctor", // Phase 1e (Bilibili C 路径) — dry-run doctor
        "bilibili-adb-sync", // Phase 1c (Bilibili C 路径) — PC + ADB chrome cookies
        "collect-db", // module 101 — generic plaintext-db ingest for the 明文库
        "collect-qq", // module 101 — frida-free QQNT (nt_msg.db) decrypt + ingest in the bundle
        "collect-qzone", // module 101 (B1) — QQ空间 feed collection via qzone-collect.js
        "collect-wechat", // module 101 — wechat-collect.js bundle (derived-key decrypt + parse)
        "destroy",
        "douyin-adb-sync", // Phase 2a (Douyin C 路径) — PC + ADB <uid>_im.db
        "douyin-watch-sync", // Douyin 观看历史 C 路径 — ADB video_record.db → history (BROWSE) events
        "event-detail", // §A6 citation chip — opens raw event for "出处" link
        "export", // §A8 v0.2 export staged snapshot rows
        "export-events", // module 101 §8.3 — raw event export for cross-device backup
        "facet-counts", // Phase 16 Vault Browser — per-category counts
        "import-events", // module 101 §8.3 — raw event import (idempotent upsert by id)
        "health",
        "kuaishou-adb-sync", // Phase 6d.3 (Kuaishou C 路径) — PC + ADB + NS_sig3 SignProvider
        "list-adapters",
        "query-events",
        "readiness", // 就绪检查：每源能否采集 + 不能的原因
        "recent-audit",
        "rederive", // trap #25 recovery — promote orphan raw_events to canonical
        "register-mock",
        "repl", // persistent ask loop — amortizes the ~8s per-call CLI cold-start
        "retrieve-context", // S4 cloud RAG bridge — LLM-free fact gathering
        "run-skill",
        "salvage", // Method B 免密钥取证 — salvage decrypted SQLite pages from a /proc/<pid>/mem dump then ingest
        "search", // Phase 16 Vault Browser — FTS5 search surface
        "stats",
        "sync-adapter",
        "sync-all",
        "toutiao-adb-sync", // Phase 6c.3 (Toutiao C 路径) — PC + ADB + acrawler SignProvider
        "wechat",
        "weibo-adb-sync", // Phase 3a (Weibo C 路径) — PC + ADB m.weibo.cn cookies
        "xhs-adb-sync", // Phase 3c (Xhs C 路径) — PC + ADB + X-S best-effort sig
      ].sort(),
    );
  });

  it("ask requires a question argument", () => {
    const program = buildProgram();
    const hub = program.commands.find((c) => c.name() === "hub");
    const ask = hub.commands.find((c) => c.name() === "ask");
    expect(ask.registeredArguments.length).toBe(1);
    expect(ask.registeredArguments[0].required).toBe(true);
  });

  it("ask supports --use-rag / --no-use-rag / --accept-non-local / --json", () => {
    const program = buildProgram();
    const hub = program.commands.find((c) => c.name() === "hub");
    const ask = hub.commands.find((c) => c.name() === "ask");
    const optNames = ask.options.map((o) => o.long);
    expect(optNames).toContain("--use-rag");
    expect(optNames).toContain("--no-use-rag");
    expect(optNames).toContain("--accept-non-local");
    expect(optNames).toContain("--json");
  });

  it("repl is a no-arg persistent loop with the ask cloud-egress/budget options", () => {
    const program = buildProgram();
    const hub = program.commands.find((c) => c.name() === "hub");
    const repl = hub.commands.find((c) => c.name() === "repl");
    expect(repl).toBeDefined();
    expect(repl.registeredArguments.length).toBe(0); // no question arg — reads from stdin
    const optNames = repl.options.map((o) => o.long);
    expect(optNames).toContain("--no-use-rag");
    expect(optNames).toContain("--accept-non-local");
    expect(optNames).toContain("--max-facts");
    expect(optNames).toContain("--max-query-limit");
  });

  it("destroy refuses to run without --confirm flag", () => {
    const program = buildProgram();
    const hub = program.commands.find((c) => c.name() === "hub");
    const destroy = hub.commands.find((c) => c.name() === "destroy");
    const optNames = destroy.options.map((o) => o.long);
    expect(optNames).toContain("--confirm");
    expect(optNames).toContain("--json");
  });

  it("sync-adapter requires adapter <name>", () => {
    const program = buildProgram();
    const hub = program.commands.find((c) => c.name() === "hub");
    const sync = hub.commands.find((c) => c.name() === "sync-adapter");
    expect(sync.registeredArguments.length).toBe(1);
    expect(sync.registeredArguments[0].name()).toBe("name");
    expect(sync.registeredArguments[0].required).toBe(true);
    expect(sync.options.map((option) => option.long)).toContain(
      "--zip-password",
    );
    expect(sync.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--cookie", "--cookie-file", "--account-id"]),
    );
  });

  it("resolves transient cookies from direct, environment, or bounded file input", () => {
    expect(_internal.resolveSyncCookie({ cookie: " sid=direct " }, {})).toBe(
      "sid=direct",
    );
    expect(
      _internal.resolveSyncCookie({}, { CC_PDH_COOKIE: " sid=environment " }),
    ).toBe("sid=environment");
    expect(() =>
      _internal.resolveSyncCookie(
        {},
        { CC_PDH_COOKIE: "x".repeat(64 * 1024 + 1) },
      ),
    ).toThrow(/exceeds/u);
    expect(() =>
      _internal.resolveSyncCookie(
        { cookie: "a=1", cookieFile: "cookie.txt" },
        {},
      ),
    ).toThrow(/either --cookie or --cookie-file/u);

    const dir = mkdtempSync(join(tmpdir(), "pdh-cookie-"));
    const file = join(dir, "cookie.txt");
    try {
      writeFileSync(file, " sid=file \n", "utf8");
      expect(_internal.resolveSyncCookie({ cookieFile: file }, {})).toBe(
        "sid=file",
      );
      writeFileSync(file, "x".repeat(64 * 1024 + 1), "utf8");
      expect(() =>
        _internal.resolveSyncCookie({ cookieFile: file }, {}),
      ).toThrow(/exceeds/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sync-all exposes an explicit force-all escape hatch", () => {
    const program = buildProgram();
    const hub = program.commands.find((c) => c.name() === "hub");
    const syncAll = hub.commands.find((c) => c.name() === "sync-all");
    expect(syncAll.options.map((option) => option.long)).toContain(
      "--include-unready",
    );
  });

  it("query-events accepts time-window + adapter filters", () => {
    const program = buildProgram();
    const hub = program.commands.find((c) => c.name() === "hub");
    const q = hub.commands.find((c) => c.name() === "query-events");
    const optNames = q.options.map((o) => o.long);
    for (const o of [
      "--subtype",
      "--since",
      "--until",
      "--actor",
      "--adapter",
      "--limit",
      "--json",
    ]) {
      expect(optNames).toContain(o);
    }
  });
});

describe("cc hub sync report semantics", () => {
  it("treats unhealthy reports as failures instead of successful commands", () => {
    expect(
      _internal.analyzeSyncReport({
        adapter: "wechat",
        status: "unhealthy",
        error: "DB_NOT_PULLED",
        entityCounts: {},
      }),
    ).toMatchObject({
      kind: "failed",
      ok: false,
      error: "DB_NOT_PULLED",
    });
  });

  it("prints current SyncReport fields without undefined legacy counters", () => {
    const report = {
      adapter: "mock",
      status: "ok",
      rawCount: 2,
      archivedRawCount: 2,
      archiveFailureCount: 0,
      checkpointCommitted: true,
      invalidCount: 0,
      entityCounts: {
        events: 1,
        persons: 1,
        places: 1,
        items: 1,
        topics: 1,
      },
      kgTripleCount: 12,
      ragDocCount: 2,
      durationMs: 25,
    };
    expect(_internal.syncEntityTotal(report)).toBe(5);
    const line = _internal.formatSyncReportLine(report);
    expect(line).toContain("raw=2");
    expect(line).toContain("archived=2");
    expect(line).toContain("archiveFailed=0");
    expect(line).toContain("entities=5");
    expect(line).toContain("kgTriples=12");
    expect(line).not.toContain("undefined");
  });

  it("surfaces deferred pagination watermarks as partial", () => {
    const report = {
      adapter: "travel-ctrip",
      status: "ok",
      rawCount: 20,
      invalidCount: 0,
      entityCounts: { events: 20 },
      watermarkDeferred: true,
      pageBudget: 10,
      nextPageBudget: 20,
      scanDeferredCount: 1,
      watermarkLookbackMs: 86_400_000,
      collectionSinceWatermark: "1700000000000",
    };
    expect(_internal.analyzeSyncReport(report)).toMatchObject({
      kind: "partial",
      ok: true,
      watermarkDeferred: true,
      pageBudget: 10,
      nextPageBudget: 20,
      scanDeferredCount: 1,
      watermarkLookbackMs: 86_400_000,
      collectionSinceWatermark: "1700000000000",
    });
    const line = _internal.formatSyncReportLine(report);
    expect(line).toContain("watermark=deferred");
    expect(line).toContain("pages=10->20");
    expect(line).toContain("deferredScans=1");
  });

  it("surfaces retry recovery and persistent rate-limit progress", () => {
    const recovered = {
      adapter: "shopping-taobao",
      status: "ok",
      rawCount: 2,
      archivedRawCount: 2,
      entityCounts: { events: 2 },
      attemptCount: 3,
      retryCount: 2,
      totalRetryDelayMs: 1500,
      retryExhausted: false,
      sourceRequestCount: 4,
      sourceRequestThrottleMs: 20_000,
      sourceRequestRateLimitRemainingMinute: 2,
      sourceRequestRateLimitRemainingDay: 196,
    };
    expect(_internal.analyzeSyncReport(recovered)).toMatchObject({
      kind: "success",
      attemptCount: 3,
      retryCount: 2,
      totalRetryDelayMs: 1500,
      retryExhausted: false,
      sourceRequestCount: 4,
      sourceRequestThrottleMs: 20_000,
      sourceRequestRateLimitRemainingMinute: 2,
      sourceRequestRateLimitRemainingDay: 196,
    });
    expect(_internal.formatSyncReportLine(recovered)).toContain(
      "attempts=3 retries=2 retryDelayMs=1500",
    );
    expect(_internal.formatSyncReportLine(recovered)).toContain(
      "sourceRequests=4 sourceThrottleMs=20000",
    );

    const limited = {
      adapter: "shopping-taobao",
      status: "rate_limited",
      error: "retry later",
      entityCounts: {},
      retryAfterMs: 45_000,
      rateLimitReason: "per_minute",
      rateLimitRemainingMinute: 0,
      rateLimitRemainingDay: 12,
    };
    expect(_internal.analyzeSyncReport(limited)).toMatchObject({
      kind: "failed",
      retryAfterMs: 45_000,
      rateLimitReason: "per_minute",
      rateLimitRemainingMinute: 0,
      rateLimitRemainingDay: 12,
    });
    const limitedLine = _internal.formatSyncReportLine(limited);
    expect(limitedLine).toContain("rateLimit=per_minute");
    expect(limitedLine).toContain("retryAfterMs=45000");
    expect(limitedLine).toContain("remainingMinute=0");
  });

  it("surfaces an uncommitted raw archive checkpoint as a failed collection", () => {
    const report = {
      adapter: "email-imap",
      status: "error",
      rawCount: 5,
      archivedRawCount: 4,
      archiveFailureCount: 1,
      checkpointCommitted: false,
      entityCounts: {},
      error: "raw archive incomplete",
    };

    expect(_internal.analyzeSyncReport(report)).toMatchObject({
      kind: "failed",
      ok: false,
      archivedRawCount: 4,
      archiveFailureCount: 1,
      checkpointCommitted: false,
    });
    expect(_internal.formatSyncReportLine(report)).toContain(
      "checkpoint=not-committed",
    );
  });

  it("keeps failed adapters visible in sync-all summaries", () => {
    expect(
      _internal.summarizeSyncReports([
        {
          adapter: "ok",
          status: "ok",
          rawCount: 1,
          invalidCount: 0,
          entityCounts: { events: 1 },
        },
        {
          adapter: "empty",
          status: "ok",
          rawCount: 0,
          invalidCount: 0,
          entityCounts: {},
        },
        {
          adapter: "skipped",
          status: "skipped",
          skipReason: "NO_INPUT",
          skipMessage: "choose a snapshot",
          entityCounts: {},
        },
        {
          adapter: "bad",
          status: "error",
          error: "boom",
          entityCounts: {},
        },
      ]),
    ).toEqual({
      total: 4,
      success: 1,
      empty: 1,
      partial: 0,
      skipped: 1,
      failed: 1,
      entities: 1,
    });
  });

  it("makes sync-all readiness-aware by default and permits force-all", async () => {
    const received = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const getHub = async () => ({
      registry: {
        syncAll: async (options) => {
          received.push(options);
          return [];
        },
      },
    });

    try {
      await _internal.cmdSyncAll({ json: true, _getHub: getHub });
      await _internal.cmdSyncAll({
        json: true,
        includeUnready: true,
        _getHub: getHub,
      });
    } finally {
      log.mockRestore();
    }

    expect(received).toEqual([{ readyOnly: true }, { readyOnly: false }]);
  });

  it("returns exit code 1 for a JSON sync command whose report is unhealthy", async () => {
    let stdout = "";
    let exitCode = null;
    let receivedOptions = null;
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk, callback) => {
        stdout += String(chunk);
        if (typeof callback === "function") callback();
        return true;
      });
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      exitCode = code;
      return undefined;
    });

    try {
      await _internal.cmdSyncAdapter("wechat", {
        json: true,
        zipPassword: "zip-secret",
        cookie: "sid=runtime-secret",
        accountId: "shopping-user",
        _getHub: async () => ({
          registry: {
            syncAdapter: async (_name, options) => {
              receivedOptions = options;
              return {
                adapter: "wechat",
                status: "unhealthy",
                error: "DB_NOT_PULLED",
                rawCount: 0,
                invalidCount: 0,
                entityCounts: {},
              };
            },
          },
        }),
      });
    } finally {
      write.mockRestore();
      exit.mockRestore();
    }

    expect(JSON.parse(stdout)).toMatchObject({
      adapter: "wechat",
      status: "unhealthy",
      error: "DB_NOT_PULLED",
    });
    expect(exitCode).toBe(1);
    expect(receivedOptions.zipPassword).toBe("zip-secret");
    expect(receivedOptions.cookie).toBe("sid=runtime-secret");
    expect(receivedOptions.accountId).toBe("shopping-user");
    expect(stdout).not.toContain("zip-secret");
    expect(stdout).not.toContain("runtime-secret");
    expect(stdout).not.toContain("shopping-user");
  });
});
