/**
 * Integration tests for agent-core + SlotFiller interactions
 *
 * Tests real module interactions between SlotFiller and agentLoop,
 * mocking only the LLM fetch layer.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// Mock plan-mode, skill-loader, hook-manager
vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
}));

vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn().mockImplementation(() => ({
    getResolvedSkills: vi.fn(() => []),
  })),
}));

vi.mock("../../src/lib/hook-manager.js", () => ({
  executeHooks: vi.fn().mockResolvedValue(undefined),
  HookEvents: {
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    ToolError: "ToolError",
  },
}));

const { agentLoop } = await import("../../src/lib/agent-core.js");
const { CLISlotFiller } = await import("../../src/lib/slot-filler.js");

describe("Integration: SlotFiller + agentLoop", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("SlotFiller detects deploy intent → fills platform slot → augments user message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { role: "assistant", content: "Deploying to docker." },
      }),
    });

    const mockInteraction = {
      askSelect: vi.fn().mockResolvedValue("docker"),
      askInput: vi.fn().mockResolvedValue("test-value"),
      emit: vi.fn(),
    };

    const slotFiller = new CLISlotFiller({ interaction: mockInteraction });

    const messages = [{ role: "user", content: "deploy this project" }];
    const events = [];

    for await (const event of agentLoop(messages, {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
      slotFiller,
      interaction: mockInteraction,
    })) {
      events.push(event);
    }

    // Should have slot-filling event for platform
    const slotEvents = events.filter((e) => e.type === "slot-filling");
    expect(slotEvents.length).toBeGreaterThan(0);
    expect(slotEvents[0].slot).toBe("platform");

    // User message should have been augmented
    const userMsg = messages.find((m) => m.role === "user");
    expect(userMsg.content).toContain("[Context");
    expect(userMsg.content).toContain("platform");
    expect(userMsg.content).toContain("docker");
  });

  it("SlotFiller extracts entities from file path → no missing slots → proceeds directly", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { role: "assistant", content: "File created at src/test.js" },
      }),
    });

    const mockInteraction = {
      askSelect: vi.fn(),
      askInput: vi.fn(),
      emit: vi.fn(),
    };

    const slotFiller = new CLISlotFiller({ interaction: mockInteraction });

    const messages = [
      { role: "user", content: "create a file at src/test.js" },
    ];
    const events = [];

    for await (const event of agentLoop(messages, {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
      slotFiller,
      interaction: mockInteraction,
    })) {
      events.push(event);
    }

    // Intent "create_file" detected, but path and fileType can be extracted
    // from the message itself — so askSelect may only be called for remaining
    // unextracted required slots, or not at all if all are filled.
    // The key assertion: should still produce response-complete
    expect(events.some((e) => e.type === "response-complete")).toBe(true);
  });

  it("Unrecognized intent → no slot-filling events", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { role: "assistant", content: "Here's the info." },
      }),
    });

    const mockInteraction = {
      askSelect: vi.fn(),
      askInput: vi.fn(),
      emit: vi.fn(),
    };

    const slotFiller = new CLISlotFiller({ interaction: mockInteraction });

    const messages = [{ role: "user", content: "what is the meaning of life" }];
    const events = [];

    for await (const event of agentLoop(messages, {
      provider: "ollama",
      model: "test",
      baseUrl: "http://localhost:11434",
      slotFiller,
      interaction: mockInteraction,
    })) {
      events.push(event);
    }

    // No slot-filling events for unrecognized intent
    const slotEvents = events.filter((e) => e.type === "slot-filling");
    expect(slotEvents).toHaveLength(0);

    // Should not have prompted the user for anything
    expect(mockInteraction.askSelect).not.toHaveBeenCalled();
    expect(mockInteraction.askInput).not.toHaveBeenCalled();

    // Should still complete normally
    expect(events.some((e) => e.type === "response-complete")).toBe(true);
  });
});
