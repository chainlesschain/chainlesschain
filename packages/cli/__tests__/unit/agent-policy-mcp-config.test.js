/**
 * Guards the --mcp-config plumbing for interactive `cc agent`: the option must
 * survive resolveAgentPolicy so it reaches startAgentRepl (which loads the
 * servers via the shared mcp-config engine). The REPL wiring itself reuses the
 * already-tested engine (mcp-config.js) + the headless path's option contract.
 */

import { describe, it, expect } from "vitest";
import { resolveAgentPolicy } from "../../src/runtime/policies/agent-policy.js";

describe("resolveAgentPolicy — mcpConfig", () => {
  it("carries overrides.mcpConfig onto the policy", () => {
    const policy = resolveAgentPolicy({ overrides: { mcpConfig: "servers.json" } });
    expect(policy.mcpConfig).toBe("servers.json");
  });

  it("defaults to null when not provided", () => {
    expect(resolveAgentPolicy({}).mcpConfig).toBeNull();
  });
  it("defaults useRegisteredMcp to true, false when --no-mcp", () => {
    expect(resolveAgentPolicy({}).useRegisteredMcp).toBe(true);
    expect(
      resolveAgentPolicy({ overrides: { useRegisteredMcp: false } })
        .useRegisteredMcp,
    ).toBe(false);
  });

  // IDE bridge: the tri-state --ide/--no-ide flag must survive onto the policy
  // (undefined=auto), else the REPL can never honor it interactively.
  it("carries the IDE tri-state onto the policy", () => {
    expect(resolveAgentPolicy({}).ide).toBeUndefined(); // auto-detect
    expect(resolveAgentPolicy({ overrides: { ide: true } }).ide).toBe(true); // --ide
    expect(resolveAgentPolicy({ overrides: { ide: false } }).ide).toBe(false); // --no-ide
  });
});
