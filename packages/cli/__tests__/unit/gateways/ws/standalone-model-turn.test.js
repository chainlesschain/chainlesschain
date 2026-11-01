import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChainlessChainWSServer } from "../../../../src/gateways/ws/ws-server.js";
import { prepareConfiguredUiModelTurn } from "../../../../src/lib/evolution/optional-ui-model-turn.js";

vi.mock("../../../../src/lib/evolution/optional-ui-model-turn.js", () => ({
  prepareConfiguredUiModelTurn: vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

describe("standalone WebSocket model policy", () => {
  it("uses the configured UI policy when the embedder omitted all policy hooks", async () => {
    const server = new ChainlessChainWSServer({
      projectRoot: "/host-workspace",
    });
    const context = {
      mode: "ws-llm-chat",
      messages: [{ role: "user", content: "hello" }],
    };
    const turn = {
      messages: context.messages,
      complete: async () => undefined,
    };
    prepareConfiguredUiModelTurn.mockResolvedValueOnce(turn);
    expect(await server.prepareUiModelTurn(context)).toBe(turn);
    expect(prepareConfiguredUiModelTurn).toHaveBeenCalledWith(context, {
      cwd: "/host-workspace",
    });
  });

  it("propagates configured host policy errors without falling back", async () => {
    const server = new ChainlessChainWSServer();
    prepareConfiguredUiModelTurn.mockRejectedValueOnce(
      new Error("Host policy rejected the turn"),
    );
    await expect(server.prepareUiModelTurn({ messages: [] })).rejects.toThrow(
      "Host policy rejected",
    );
  });

  it("preserves an explicit model preparation callback", () => {
    const prepareUiModelTurn = vi.fn();
    const server = new ChainlessChainWSServer({ prepareUiModelTurn });
    expect(server.prepareUiModelTurn).toBe(prepareUiModelTurn);
    expect(prepareConfiguredUiModelTurn).not.toHaveBeenCalled();
  });

  it.each([
    { evolutionCompositionFactory: null },
    { evolutionCompositionFactory: async () => null },
    { prepareUiModelTurn: null },
    { resolveEvolutionCompositionFactory: async () => null },
  ])("preserves explicit factory/resolver/null policy: %j", (options) => {
    const server = new ChainlessChainWSServer(options);
    expect(server.prepareUiModelTurn).toBeNull();
    expect(prepareConfiguredUiModelTurn).not.toHaveBeenCalled();
  });
});
