import { afterEach, describe, expect, it, vi } from "vitest";
import { queryLLM } from "../../src/commands/ask.js";
import { createChatFn } from "../../src/lib/cowork-adapter.js";
import {
  governModelTokenSource,
  prepareGovernedModelTurn,
} from "../../src/lib/evolution/governed-model-turn.js";
import { agentLoop, chatWithTools } from "../../src/runtime/agent-core.js";

afterEach(() => vi.unstubAllGlobals());

describe("CLI model egress closure", () => {
  it("rejects every shared content-bearing entry before provider transport without ingress", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const messages = [{ role: "user", content: "canary prompt" }];

    await expect(
      prepareGovernedModelTurn(null, { mode: "test", messages }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    await expect(queryLLM("canary prompt")).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    });
    await expect(
      chatWithTools(messages, { provider: "ollama", model: "test" }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(() => createChatFn({ provider: "ollama" })).toThrow(
      /authenticated evolution ingress/,
    );
    await expect(
      agentLoop(messages, { provider: "ollama", model: "test" }).next(),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not report an unfinished governed stream as complete", async () => {
    const complete = vi.fn();
    async function* source() {
      yield "partial";
    }
    const stream = governModelTokenSource(source(), { complete });
    expect((await stream.next()).value).toBe("partial");
    await stream.return();
    expect(complete).not.toHaveBeenCalled();
  });
});
