/**
 * E2E tests for Sub-Agent Isolation commands
 *
 * Tests CLI-level behavior of sub-agent features:
 * - spawn_sub_agent tool availability
 * - Agent tool enumeration
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const CLI_DIR = join(import.meta.dirname, "../..");
const BIN = join(CLI_DIR, "bin/chainlesschain.js");
const pkg = JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf-8"));

function runCLI(args, options = {}) {
  try {
    return execSync(`node "${BIN}" ${args}`, {
      cwd: options.cwd || CLI_DIR,
      encoding: "utf-8",
      timeout: 15000,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
  } catch (err) {
    return err.stdout || err.stderr || err.message;
  }
}

describe("E2E: Sub-Agent Isolation", () => {
  it("CLI version is accessible", () => {
    const output = runCLI("--version");
    expect(output.trim()).toBe(pkg.version);
  });

  it("help output includes agent command", () => {
    const output = runCLI("--help");
    expect(output).toContain("agent");
  });

  it("agent command help mentions tools", () => {
    const output = runCLI("agent --help");
    // Should list agent mode options
    expect(output.toLowerCase()).toMatch(/agent|tool|session/);
  });

  // Verify the spawn_sub_agent tool is exported in agent-core
  it("agent-core exports spawn_sub_agent in AGENT_TOOLS", async () => {
    const agentCore = await import("../../src/lib/agent-core.js");
    const toolNames = agentCore.AGENT_TOOLS.map((t) => t.function.name);
    expect(toolNames).toContain("spawn_sub_agent");
    expect(toolNames).toContain("run_code");
    expect(toolNames).toHaveLength(13);
  });

  it("sub-agent-context module is importable", async () => {
    const mod = await import("../../src/lib/sub-agent-context.js");
    expect(mod.SubAgentContext).toBeDefined();
    expect(typeof mod.SubAgentContext.create).toBe("function");
  });

  it("sub-agent-registry module is importable", async () => {
    const mod = await import("../../src/lib/sub-agent-registry.js");
    expect(mod.SubAgentRegistry).toBeDefined();
    expect(typeof mod.SubAgentRegistry.getInstance).toBe("function");
  });

  it("agent-coordinator exports executeDecomposedTask", async () => {
    const mod = await import("../../src/lib/agent-coordinator.js");
    expect(typeof mod.executeDecomposedTask).toBe("function");
    expect(mod.ROLE_TOOL_WHITELIST).toBeDefined();
  });

  it("hierarchical-memory supports namespaced operations", async () => {
    const mod = await import("../../src/lib/hierarchical-memory.js");
    // Verify _working has namespace-aware internals
    expect(mod._working._nsMap).toBeDefined();
    expect(mod._shortTerm._nsMap).toBeDefined();
  });
});
