/**
 * Guards the spawn_sub_agent contract change for named-subagent delegation:
 * the LLM-facing tool now exposes an `agent` parameter (delegate to a
 * .chainlesschain/.claude agents/*.md definition) and `role` is no longer
 * required (the named agent supplies the identity). The resolution itself
 * reuses getAgent (tested in agents-loader.test.js).
 */

import { describe, it, expect } from "vitest";
import { getCodingAgentFunctionToolDefinitions } from "../../src/runtime/coding-agent-contract.js";

const spawn = getCodingAgentFunctionToolDefinitions().find(
  (t) => t.function?.name === "spawn_sub_agent",
);

describe("spawn_sub_agent — named-agent delegation contract", () => {
  it("is present with an inputSchema", () => {
    expect(spawn).toBeTruthy();
    expect(spawn.function.parameters.type).toBe("object");
  });

  it("exposes an `agent` parameter pointing at the agents dirs", () => {
    const agentProp = spawn.function.parameters.properties.agent;
    expect(agentProp).toMatchObject({ type: "string" });
    expect(agentProp.description).toMatch(/agents/);
  });

  it("requires only `task` (role OR agent supplies identity)", () => {
    expect(spawn.function.parameters.required).toEqual(["task"]);
  });

  it("still carries role / tools / profile for ad-hoc spawns", () => {
    const p = spawn.function.parameters.properties;
    expect(p.role).toBeTruthy();
    expect(p.task).toBeTruthy();
    expect(p.tools).toBeTruthy();
    expect(p.profile).toBeTruthy();
  });
});
