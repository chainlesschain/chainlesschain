import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { modelStream } = vi.hoisted(() => ({ modelStream: vi.fn() }));
vi.mock("../../src/lib/chat-core.js", () => ({ chatStream: modelStream }));
vi.mock("../../src/gateways/ws/llm-creds.js", () => ({
  resolveLlmCreds: () => ({ provider: "ollama", model: "test-model" }),
}));
import {
  handleChatIntentUnderstand,
  handleChatIntentUnderstandStream,
  handleChatIntentClassifyFollowup,
} from "../../src/gateways/ws/chat-intent-protocol.js";
import {
  loadConfiguredUiEvolutionFactory,
  prepareConfiguredUiModelTurn,
} from "../../src/lib/evolution/optional-ui-model-turn.js";
import { setConfigValue } from "../../src/lib/config-manager.js";

const roots = [];
afterEach(() => {
  modelStream.mockReset();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cc-intent-opt-in-"));
  roots.push(root);
  const options = { env: { CHAINLESSCHAIN_HOME: root } };
  const server = {
    _send: vi.fn(),
    prepareUiModelTurn: (context) =>
      prepareConfiguredUiModelTurn(context, options),
    resolveEvolutionCompositionFactory: () =>
      loadConfiguredUiEvolutionFactory(options),
  };
  return { options, server };
}

const handlers = [
  ["understand", handleChatIntentUnderstand],
  ["stream", handleChatIntentUnderstandStream],
  ["classify", handleChatIntentClassifyFollowup],
];
const message = {
  userInput: "Review this context",
  input: "Review this context",
};

describe("UI intent requests use the shared Evolution switch", () => {
  it.each(handlers)(
    "allows ordinary intent %s while off",
    async (mode, handler) => {
      const { server } = fixture();
      modelStream.mockImplementation(async function* () {
        const content = JSON.stringify({
          correctedInput: "Review this context",
          intent: "CLARIFICATION",
          confidence: 0.9,
          keyPoints: [],
        });
        yield { type: "response-token", token: content };
        yield { type: "response-complete", content };
      });
      await handler(server, "request", {}, message);
      expect(modelStream).toHaveBeenCalledOnce();
      expect(modelStream.mock.calls[0][1].requireCompletion).toBe(true);
      const response = server._send.mock.calls.at(-1)[1];
      if (mode === "stream")
        expect(response).toMatchObject({ ok: true, result: { success: true } });
      else if (mode === "classify")
        expect(response).toMatchObject({
          method: "llm",
          intent: "CLARIFICATION",
        });
      else
        expect(response).toMatchObject({
          success: true,
          intent: "CLARIFICATION",
        });
    },
  );

  it.each(handlers)(
    "rejects invalid enabled deployments for %s despite client bypass fields",
    async (_mode, handler) => {
      const { server, options } = fixture();
      setConfigValue("evolution.enabled", true, options);
      options.env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR =
        "missing-descriptor";
      options.env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT =
        "missing-root";
      await handler(
        server,
        "request",
        {},
        { ...message, evolutionDisabled: true, prepareModelTurn: null },
      );
      expect(modelStream).not.toHaveBeenCalled();
      const response = server._send.mock.calls.at(-1)[1];
      expect(response.type).toMatch(/error$/);
    },
  );
});
