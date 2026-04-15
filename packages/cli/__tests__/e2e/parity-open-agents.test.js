/**
 * E2E tests for open-agents parity Phases 2–5.
 *
 * Verifies the new modules are wired into the CLI surface:
 *   - AGENT_TOOLS exports web_fetch / todo_write / ask_user_question (16 total)
 *   - spawn_sub_agent contract exposes the `profile` enum (Phase 3)
 *   - sub-agent-profiles module is importable + ships 3 built-ins
 *   - turn-context / provider-options / todo-manager / web-fetch modules load
 *   - skill-loader exports $ARGUMENTS helpers
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const CLI_DIR = join(import.meta.dirname, "../..");
const BIN = join(CLI_DIR, "bin/chainlesschain.js");
const pkg = JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf-8"));

function runCLI(args) {
  try {
    return execSync(`node "${BIN}" ${args}`, {
      cwd: CLI_DIR,
      encoding: "utf-8",
      timeout: 15000,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
  } catch (err) {
    return err.stdout || err.stderr || err.message;
  }
}

describe("E2E: open-agents parity Phases 2–5", () => {
  it("CLI is runnable", () => {
    expect(runCLI("--version").trim()).toBe(pkg.version);
  });

  it("AGENT_TOOLS includes the 3 new tools and totals 16", async () => {
    const { AGENT_TOOLS } = await import("../../src/runtime/agent-core.js");
    const names = AGENT_TOOLS.map((t) => t.function.name);
    expect(names).toContain("web_fetch");
    expect(names).toContain("todo_write");
    expect(names).toContain("ask_user_question");
    expect(names).toContain("spawn_sub_agent");
    expect(names).toHaveLength(16);
  });

  it("spawn_sub_agent contract exposes profile enum (Phase 3)", async () => {
    const { AGENT_TOOLS } = await import("../../src/runtime/agent-core.js");
    const spawn = AGENT_TOOLS.find(
      (t) => t.function.name === "spawn_sub_agent",
    );
    const schema = spawn.function.inputSchema || spawn.function.parameters;
    expect(schema.properties.profile).toBeDefined();
    expect(schema.properties.profile.enum).toEqual(
      expect.arrayContaining(["explorer", "executor", "design"]),
    );
  });

  it("sub-agent-profiles ships explorer/executor/design", async () => {
    const mod = await import("../../src/lib/sub-agent-profiles.js");
    const names = mod
      .listSubAgentProfiles()
      .map((p) => p.name)
      .sort();
    expect(names).toEqual(["design", "executor", "explorer"]);
  });

  it("sub-agent-profiles registry round-trip works", async () => {
    const mod = await import("../../src/lib/sub-agent-profiles.js");
    mod.resetToBuiltins();
    expect(
      mod.registerSubAgentProfile({
        name: "e2e-tmp",
        shortDescription: "e2e",
        systemPrompt: "e2e",
      }),
    ).toBe(true);
    expect(mod.getSubAgentProfile("e2e-tmp")).toBeTruthy();
    mod.resetToBuiltins();
    expect(mod.getSubAgentProfile("e2e-tmp")).toBeNull();
  });

  it("turn-context module exposes buildTurnContext + defaultPrepareCall", async () => {
    const mod = await import("../../src/lib/turn-context.js");
    expect(typeof mod.buildTurnContext).toBe("function");
    expect(typeof mod.defaultPrepareCall).toBe("function");
    const out = mod.buildTurnContext({ iteration: 2, cwd: process.cwd() });
    expect(out).toMatch(/## Turn context \(iteration 2\)/);
  });

  it("provider-options module exposes mergeProviderOptions + deepMerge", async () => {
    const mod = await import("../../src/lib/provider-options.js");
    expect(typeof mod.mergeProviderOptions).toBe("function");
    const merged = mod.mergeProviderOptions("anthropic", "claude-opus-4-6", {
      maxTokens: 100,
    });
    expect(merged.maxTokens).toBe(100);
    expect(merged.anthropic.thinking.type).toBe("enabled");
  });

  it("todo-manager + web-fetch modules load", async () => {
    const tm = await import("../../src/lib/todo-manager.js");
    expect(typeof tm.writeTodos).toBe("function");
    const wf = await import("../../src/lib/web-fetch.js");
    expect(typeof wf.webFetch).toBe("function");
    expect(typeof wf.isPrivateHost).toBe("function");
  });

  it("skill-loader exposes $ARGUMENTS helpers (Phase 2)", async () => {
    const mod = await import("../../src/lib/skill-loader.js");
    expect(typeof mod.substituteArguments).toBe("function");
    expect(typeof mod.injectSkillDirectory).toBe("function");
    expect(typeof mod.prepareSkillBody).toBe("function");
    expect(mod.substituteArguments("hello $ARGUMENTS world", "everyone")).toBe(
      "hello everyone world",
    );
  });
});
