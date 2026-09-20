"use strict";

const { registerIPCHandlers } = require("../followup-intent-ipc");

function createHarness({ authorizePurpose = vi.fn(() => true) } = {}) {
  const handlers = new Map();
  const mainFrame = { parent: null, url: "http://localhost:5173/" };
  const webContents = { id: 23, mainFrame };
  const classifier = {
    classify: vi.fn(async () => ({
      confidence: 0.9,
      extractedInfo: "use blue",
      intent: "MODIFY_REQUIREMENT",
      latency: 4,
      method: "rule",
      reason: "matched",
      scores: { MODIFY_REQUIREMENT: 1 },
    })),
    classifyBatch: vi.fn(async (inputs) =>
      inputs.map((input) => ({
        input,
        result: {
          confidence: 1,
          intent: "CONTINUE_EXECUTION",
          latency: 1,
          method: "rule",
          reason: "matched",
          scores: { CONTINUE_EXECUTION: 1 },
        },
      })),
    ),
    getStats: vi.fn(() => ({
      keywordsCount: 42,
      patternsCount: 16,
      rulesCount: 4,
      internal: "hidden",
    })),
  };
  registerIPCHandlers({
    authorizePurpose,
    classifier,
    getCurrentIdentity: () => ({
      did: "did:example:alice",
      tenantId: "team-a",
    }),
    getMainWindow: () => ({ webContents }),
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  });
  return {
    authorizePurpose,
    classifier,
    event: { sender: webContents, senderFrame: mainFrame },
    handlers,
  };
}

describe("authorized follow-up intent IPC", () => {
  it("authorizes and projects a single classification", async () => {
    const harness = createHarness();
    const response = await harness.handlers.get("followup-intent:classify")(
      harness.event,
      {
        input: "改成蓝色",
        context: {
          conversationHistory: [{ role: "user", content: "创建按钮" }],
          currentTask: { name: "site", status: "executing" },
        },
      },
    );

    expect(response).toEqual({
      success: true,
      data: {
        confidence: 0.9,
        extractedInfo: "use blue",
        intent: "MODIFY_REQUIREMENT",
        latency: 4,
        method: "rule",
        reason: "matched",
      },
    });
    expect(harness.authorizePurpose).toHaveBeenCalledWith(
      expect.objectContaining({
        actorDid: "did:example:alice",
        operation: "followup-intent-classify",
        purpose: "model-followup-intent-classify",
        senderId: 23,
        tenantId: "team-a",
      }),
    );
  });

  it("bounds batch input and does not echo input or internal scores", async () => {
    const harness = createHarness();
    await expect(
      harness.handlers.get("followup-intent:classify-batch")(harness.event, {
        inputs: ["继续", "好的"],
        context: {},
      }),
    ).resolves.toEqual({
      success: true,
      data: [
        {
          confidence: 1,
          intent: "CONTINUE_EXECUTION",
          latency: 1,
          method: "rule",
          reason: "matched",
        },
        {
          confidence: 1,
          intent: "CONTINUE_EXECUTION",
          latency: 1,
          method: "rule",
          reason: "matched",
        },
      ],
    });
    expect(harness.classifier.classifyBatch).toHaveBeenCalledWith(
      ["继续", "好的"],
      {},
    );
  });

  it("projects only bounded classifier statistics", async () => {
    const harness = createHarness();
    await expect(
      harness.handlers.get("followup-intent:get-stats")(harness.event),
    ).resolves.toEqual({
      success: true,
      data: { keywordsCount: 42, patternsCount: 16, rulesCount: 4 },
    });
  });

  it("rejects unauthorized callers before classification", async () => {
    const harness = createHarness({ authorizePurpose: vi.fn(() => false) });
    await expect(
      harness.handlers.get("followup-intent:classify")(harness.event, {
        input: "continue",
        context: {},
      }),
    ).rejects.toMatchObject({ code: "CC_LLM_IPC_UNAUTHORIZED" });
    expect(harness.classifier.classify).not.toHaveBeenCalled();
  });

  it("fails closed on malformed and oversized renderer input", async () => {
    const harness = createHarness();
    const accessor = { context: {} };
    Object.defineProperty(accessor, "input", {
      enumerable: true,
      get: () => "secret",
    });
    for (const request of [
      accessor,
      new Proxy({ input: "continue", context: {} }, {}),
      { input: "continue", context: {}, extra: true },
      { input: "x".repeat(8193), context: {} },
      {
        input: "continue",
        context: {
          conversationHistory: [{ role: "tool", content: "hidden" }],
        },
      },
    ]) {
      await expect(
        harness.handlers.get("followup-intent:classify")(
          harness.event,
          request,
        ),
      ).resolves.toMatchObject({
        code: "CC_FOLLOWUP_INTENT_OPERATION_FAILED",
        success: false,
      });
    }
    expect(harness.classifier.classify).not.toHaveBeenCalled();
  });
});
