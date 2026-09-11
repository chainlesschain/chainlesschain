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
  it("passes host authority to scoped resolver draining", async () => {
    const factory = vi.fn();
    const drain = vi.fn();
    const drainResolver = vi.fn(async () => ({ processed: 0, error: 1 }));
    ports.getHub.mockResolvedValue({
      entityResolver: { drain },
      drainResolver,
    });
    const messages = await dispatch(factory, {
      type: "personal-data-hub.resolver-drain",
      limit: 4,
      evolutionCompositionFactory: "client",
    });
    expect(drainResolver).toHaveBeenCalledWith({ limit: 4 }, factory);
    expect(drain).not.toHaveBeenCalled();
    expect(messages[0].result).toEqual({ processed: 0, error: 1 });
  });
  it("routes skills through the scoped Hub and surfaces governance rejection", async () => {
    const factory = vi.fn();
    const runSkill = vi
      .fn()
      .mockRejectedValue(new Error("skill evidence denied"));
    ports.getGovernedAnalysisHub.mockResolvedValue({ runSkill });
    const messages = await dispatch(factory, {
      type: "personal-data-hub.run-skill",
      name: "analysis.overview",
      options: { since: 42 },
    });
    expect(ports.getGovernedAnalysisHub).toHaveBeenCalledWith(factory);
    expect(ports.getHub).not.toHaveBeenCalled();
    expect(runSkill).toHaveBeenCalledWith("analysis.overview", { since: 42 });
    expect(messages[0]).toMatchObject({
      type: "error",
      message: "skill evidence denied",
    });
  });
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

  it("rejects unconfigured model operation and ignores client-supplied authority", async () => {
    ports.getHub.mockResolvedValue({
      engine: { ask: vi.fn(async () => ({ answer: "normal" })) },
    });
    const messages = await dispatch(undefined, {
      evolutionCompositionFactory: "untrusted",
    });
    expect(ports.getGovernedAnalysisHub).not.toHaveBeenCalled();
    expect(ports.getHub).not.toHaveBeenCalled();
    expect(messages).toEqual([
      {
        id: "ask-1",
        type: "error",
        code: "PERSONAL_DATA_HUB_ERROR",
        message:
          "Personal Data Hub model egress requires an authenticated evolution composition factory",
      },
    ]);
  });
});
