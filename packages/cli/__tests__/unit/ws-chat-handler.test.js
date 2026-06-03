import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock chat-core
vi.mock("../../src/lib/chat-core.js", () => ({
  chatWithStreaming: vi.fn(),
}));

import { WSChatHandler } from "../../src/lib/ws-chat-handler.js";
import { chatWithStreaming } from "../../src/lib/chat-core.js";

function createMockSession(overrides = {}) {
  return {
    id: "chat-session-1",
    type: "chat",
    status: "active",
    messages: [{ role: "system", content: "You are a chat assistant." }],
    provider: "ollama",
    model: "qwen2.5:7b",
    apiKey: null,
    baseUrl: "http://localhost:11434",
    projectRoot: "/test/project",
    createdAt: "2026-01-01T00:00:00Z",
    lastActivity: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function createMockInteraction() {
  return {
    emit: vi.fn(),
  };
}

describe("WSChatHandler", () => {
  let handler;
  let session;
  let interaction;

  beforeEach(() => {
    vi.clearAllMocks();
    session = createMockSession();
    interaction = createMockInteraction();
    handler = new WSChatHandler({ session, interaction });
  });

  describe("constructor", () => {
    it("sets session and interaction", () => {
      expect(handler.session).toBe(session);
      expect(handler.interaction).toBe(interaction);
      expect(handler._processing).toBe(false);
    });
  });

  describe("handleMessage", () => {
    it("adds user message to session", async () => {
      chatWithStreaming.mockResolvedValue("Response text");
      await handler.handleMessage("Hello chat", "req-1");
      expect(session.messages).toContainEqual({
        role: "user",
        content: "Hello chat",
      });
    });

    it("returns busy error when already processing", async () => {
      // Create a blocking call
      let resolveChat;
      chatWithStreaming.mockImplementation(
        () =>
          new Promise((r) => {
            resolveChat = r;
          }),
      );

      const p1 = handler.handleMessage("first", "req-1");

      // Try second message while first is processing
      await handler.handleMessage("second", "req-2");

      expect(interaction.emit).toHaveBeenCalledWith("error", {
        requestId: "req-2",
        code: "BUSY",
        message: "Session is currently processing a message",
      });

      // Clean up
      resolveChat("done");
      await p1;
    });

    it("emits response-token events during streaming", async () => {
      chatWithStreaming.mockImplementation(
        async (messages, options, onEvent) => {
          // Simulate streaming tokens
          onEvent({ type: "response-token", token: "Hello" });
          onEvent({ type: "response-token", token: " world" });
          return "Hello world";
        },
      );

      await handler.handleMessage("greet me", "req-1");

      expect(interaction.emit).toHaveBeenCalledWith("response-token", {
        requestId: "req-1",
        token: "Hello",
      });
      expect(interaction.emit).toHaveBeenCalledWith("response-token", {
        requestId: "req-1",
        token: " world",
      });
    });

    it("emits response-complete with full content", async () => {
      chatWithStreaming.mockResolvedValue("Complete answer here.");
      await handler.handleMessage("question?", "req-1");

      expect(interaction.emit).toHaveBeenCalledWith("response-complete", {
        requestId: "req-1",
        content: "Complete answer here.",
      });
    });

    it("appends assistant message after completion", async () => {
      chatWithStreaming.mockResolvedValue("The answer is 42.");
      await handler.handleMessage("what is the meaning?", "req-1");

      expect(session.messages).toContainEqual({
        role: "assistant",
        content: "The answer is 42.",
      });
    });

    it("handles errors from chatWithStreaming", async () => {
      chatWithStreaming.mockRejectedValue(new Error("Network timeout"));
      await handler.handleMessage("fail", "req-1");

      expect(interaction.emit).toHaveBeenCalledWith("error", {
        requestId: "req-1",
        code: "CHAT_ERROR",
        message: "Network timeout",
      });
      expect(handler._processing).toBe(false);
    });
  });

  describe("handleSlashCommand", () => {
    it("/model changes model when arg given", () => {
      handler.handleSlashCommand("/model llama3:8b", "req-1");
      expect(session.model).toBe("llama3:8b");
      expect(interaction.emit).toHaveBeenCalledWith("command-response", {
        requestId: "req-1",
        command: "/model",
        result: { model: "llama3:8b" },
      });
    });

    it("/clear clears all messages", () => {
      session.messages.push({ role: "user", content: "hi" });
      session.messages.push({ role: "assistant", content: "hey" });
      expect(session.messages.length).toBe(3);

      handler.handleSlashCommand("/clear", "req-1");
      expect(session.messages.length).toBe(0);
      expect(interaction.emit).toHaveBeenCalledWith("command-response", {
        requestId: "req-1",
        command: "/clear",
        result: { cleared: true },
      });
    });

    it("/history returns messages (truncated)", () => {
      session.messages.push({ role: "user", content: "short msg" });
      handler.handleSlashCommand("/history", "req-1");

      expect(interaction.emit).toHaveBeenCalledWith(
        "command-response",
        expect.objectContaining({
          command: "/history",
          result: {
            messages: expect.arrayContaining([
              expect.objectContaining({ role: "user", content: "short msg" }),
            ]),
          },
        }),
      );
    });

    it("unknown command returns error", () => {
      handler.handleSlashCommand("/unknown", "req-1");
      expect(interaction.emit).toHaveBeenCalledWith("command-response", {
        requestId: "req-1",
        command: "/unknown",
        result: { error: "Unknown command: /unknown" },
      });
    });
  });
});
