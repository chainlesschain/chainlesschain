import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map();
const testIpcMain = {
  handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
  removeHandler: vi.fn((channel) => handlers.delete(channel)),
};

vi.mock("electron", () => ({
  ipcMain: testIpcMain,
  default: { ipcMain: testIpcMain },
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

const {
  EVOLUTION_CHANNELS,
  registerEvolutionIPC,
  unregisterEvolutionIPC,
} = require("../evolution-ipc");

function dependencies(promptOptimizer) {
  return {
    codeKnowledgeGraph: null,
    decisionKnowledgeBase: null,
    promptOptimizer,
    skillDiscoverer: null,
    debateReview: null,
    abComparator: null,
  };
}

describe("Prompt active release IPC", () => {
  beforeEach(() => {
    unregisterEvolutionIPC(testIpcMain);
    handlers.clear();
  });

  it("exposes the governed active Prompt result", async () => {
    const active = Object.freeze({
      skillName: "code-review",
      promptText: "Use active content",
      lifecycle: "active",
    });
    const promptOptimizer = {
      initialized: true,
      getActiveVariant: vi.fn().mockResolvedValue(active),
    };
    const registration = registerEvolutionIPC(
      dependencies(promptOptimizer),
      testIpcMain,
    );

    expect(registration.handlerCount).toBe(36);
    expect(EVOLUTION_CHANNELS).toContain("prompt-opt:get-active-variant");
    await expect(
      handlers.get("prompt-opt:get-active-variant")({}, "code-review"),
    ).resolves.toEqual({ success: true, data: active });
    expect(promptOptimizer.getActiveVariant).toHaveBeenCalledWith(
      "code-review",
    );
  });

  it("preserves fail-closed reader errors", async () => {
    const unavailable = Object.assign(new Error("reader unavailable"), {
      code: "CC_PROMPT_ACTIVE_RELEASE_READER_UNAVAILABLE",
    });
    registerEvolutionIPC(
      dependencies({
        initialized: true,
        getActiveVariant: vi.fn().mockRejectedValue(unavailable),
      }),
      testIpcMain,
    );

    await expect(
      handlers.get("prompt-opt:get-active-variant")({}, "code-review"),
    ).resolves.toEqual({
      success: false,
      error: "reader unavailable",
      code: "CC_PROMPT_ACTIVE_RELEASE_READER_UNAVAILABLE",
    });
  });
});
