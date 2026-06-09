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
});
