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
        "destroy",
        "event-detail", // §A6 citation chip — opens raw event for "出处" link
        "export", // §A8 v0.2 export staged snapshot rows
        "facet-counts", // Phase 16 Vault Browser — per-category counts
        "health",
        "list-adapters",
        "query-events",
        "recent-audit",
        "rederive", // trap #22 recovery — promote orphan raw_events to canonical
        "register-mock",
        "run-skill",
        "search", // Phase 16 Vault Browser — FTS5 search surface
        "stats",
        "sync-adapter",
        "sync-all",
        "wechat",
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
