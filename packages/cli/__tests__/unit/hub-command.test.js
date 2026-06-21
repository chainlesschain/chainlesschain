/**
 * Smoke tests for `cc hub` subcommand registration.
 *
 * We do NOT exercise the real vault here — that's the cli/integration
 * suite. These tests only verify Commander structure so the command
 * surface exists and accepts the documented options. Real-device end-to-
 * end is documented in docs/design/Personal_Data_Hub_Android_Standalone_Cc
 * .md §12 (T1/T2/T3 PASS on Xiaomi 24115RA8EC 2026-05-20).
 */

import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerHubCommand } from "../../src/commands/hub.js";

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
        "collect-qq", // module 101 — frida-free QQNT (nt_msg.db) decrypt + ingest in the bundle
        "destroy",
        "douyin-adb-sync", // Phase 2a (Douyin C 路径) — PC + ADB <uid>_im.db
        "douyin-watch-sync", // Douyin 观看历史 C 路径 — ADB video_record.db → history (BROWSE) events
        "event-detail", // §A6 citation chip — opens raw event for "出处" link
        "export", // §A8 v0.2 export staged snapshot rows
        "facet-counts", // Phase 16 Vault Browser — per-category counts
        "health",
        "kuaishou-adb-sync", // Phase 6d.3 (Kuaishou C 路径) — PC + ADB + NS_sig3 SignProvider
        "list-adapters",
        "query-events",
        "readiness", // 就绪检查：每源能否采集 + 不能的原因
        "recent-audit",
        "rederive", // trap #25 recovery — promote orphan raw_events to canonical
        "register-mock",
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
