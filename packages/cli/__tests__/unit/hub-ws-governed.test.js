import { beforeEach, describe, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({
  getHub: vi.fn(),
  getGovernedAnalysisHub: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../../src/lib/personal-data-hub-wiring.js", () => ports);
import { createWsMessageDispatcher } from "../../src/gateways/ws/message-dispatcher.js";

beforeEach(() => vi.resetAllMocks());

async function dispatch(factory, extra = {}) {
  const server = {
    clients: new Map(),
    _send: vi.fn(),
    ...(factory === undefined ? {} : { evolutionCompositionFactory: factory }),
  };
  await createWsMessageDispatcher(server).dispatch(
    "client",
    {},
    {
      id: "ask-1",
      type: "personal-data-hub.ask",
      question: "Summarize my records",
      ...extra,
    },
  );
  return server._send.mock.calls.map((call) => call[1]);
}

describe("Hub WebSocket governed analysis", () => {
  it("uses host authority through the dispatcher and preserves cloud consent", async () => {
    const factory = vi.fn();
    const ask = vi.fn(async () => ({ answer: "governed" }));
    ports.getGovernedAnalysisHub.mockResolvedValue({ engine: { ask } });
    const messages = await dispatch(factory, {
      evolutionCompositionFactory: "client-controlled",
      server: { evolutionCompositionFactory: "client-controlled" },
      options: { acceptNonLocal: true },
    });
    expect(ports.getGovernedAnalysisHub).toHaveBeenCalledWith(factory);
    expect(ports.getHub).not.toHaveBeenCalled();
    expect(ask).toHaveBeenCalledWith("Summarize my records", {
      acceptNonLocal: true,
    });
    expect(messages).toEqual([
      {
        id: "ask-1",
        type: "personal-data-hub.ask.response",
        result: { answer: "governed" },
      },
    ]);
  });

  it.each(["initialization", "model turn"])(
    "returns an error without fallback after denied %s",
    async (phase) => {
      const denial = new Error("governance denied");
      if (phase === "initialization")
        ports.getGovernedAnalysisHub.mockRejectedValue(denial);
      else
        ports.getGovernedAnalysisHub.mockResolvedValue({
          engine: { ask: vi.fn().mockRejectedValue(denial) },
        });
      const messages = await dispatch(vi.fn());
      expect(ports.getHub).not.toHaveBeenCalled();
      expect(messages).toEqual([
        {
          id: "ask-1",
          type: "error",
          code: "PERSONAL_DATA_HUB_ERROR",
          message: "governance denied",
        },
      ]);
    },
  );

  it("keeps unconfigured operation and ignores client-supplied authority", async () => {
    ports.getHub.mockResolvedValue({
      engine: { ask: vi.fn(async () => ({ answer: "normal" })) },
    });
    const messages = await dispatch(undefined, {
      evolutionCompositionFactory: "untrusted",
    });
    expect(ports.getGovernedAnalysisHub).not.toHaveBeenCalled();
    expect(ports.getHub).toHaveBeenCalledOnce();
    expect(messages[0].result).toEqual({ answer: "normal" });
  });
});
