/**
 * Guards the seam that spawn_sub_agent's model-override relies on: a delegated
 * subagent (cc agents `model:` frontmatter) reaches the LLM by passing
 * llmOptions into SubAgentContext, which forwards provider/model/baseUrl/apiKey
 * into its agentLoop → chatWithTools call. The resolution logic in
 * _executeSpawnSubAgent (agent-core) is `mdModel || parentLlm.model`; the
 * model frontmatter itself is read by getAgent (agents-loader.test.js).
 */

import { describe, it, expect } from "vitest";
import { SubAgentContext } from "../../src/lib/sub-agent-context.js";

describe("SubAgentContext — llmOptions seam (model override)", () => {
  it("stores the full llmOptions so provider/model/key reach chatWithTools", () => {
    const ctx = SubAgentContext.create({
      role: "review",
      task: "audit",
      llmOptions: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "k",
      },
    });
    expect(ctx._llmOptions).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "k",
    });
  });

  it("defaults to an empty llmOptions object when none is given", () => {
    const ctx = SubAgentContext.create({ role: "r", task: "t" });
    expect(ctx._llmOptions).toEqual({});
  });
});
