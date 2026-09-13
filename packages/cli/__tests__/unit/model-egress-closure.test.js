import { afterEach, describe, expect, it, vi } from "vitest";
import { queryLLM } from "../../src/commands/ask.js";
import { createChatFn } from "../../src/lib/cowork-adapter.js";
import {
  governModelTokenSource,
  prepareGovernedModelTurn,
} from "../../src/lib/evolution/governed-model-turn.js";
import { createGovernedSkillSynthesisProviderChat } from "../../src/lib/evolution/governed-skill-synthesis-provider-chat.js";
import { chatWithTools } from "../../src/runtime/agent-core.js";

afterEach(() => vi.unstubAllGlobals());

describe("CLI model egress closure", () => {
  it("rejects governed-only content-bearing entries before provider transport without ingress", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const messages = [{ role: "user", content: "canary prompt" }];

    await expect(
      prepareGovernedModelTurn(null, { mode: "test", messages }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    await expect(queryLLM("canary prompt")).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    });
    expect(() => createChatFn({ provider: "ollama" })).toThrow(
      /authenticated evolution ingress/,
    );
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

  it("keeps the legacy agent transport available before deployment configuration", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        message: { role: "assistant", content: "online" },
      }),
    }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      chatWithTools([{ role: "user", content: "hello" }], {
        provider: "ollama",
        model: "test",
        baseUrl: "http://127.0.0.1:11434",
        contextMemorySkipPlanning: true,
      }),
    ).resolves.toMatchObject({
      message: { role: "assistant", content: "online" },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps learning synthesis provider egress unavailable without a branded ingress", () => {
    const options = {
      provider: "volcengine",
      model: "doubao-test",
      apiKey: "test-secret",
    };
    expect(() => createGovernedSkillSynthesisProviderChat(options)).toThrow(
      /authenticated evolution ingress/i,
    );
    expect(() =>
      createGovernedSkillSynthesisProviderChat({
        ...options,
        evolutionIngress: {},
      }),
    ).toThrow(/evolution ingress/i);
  });
});
