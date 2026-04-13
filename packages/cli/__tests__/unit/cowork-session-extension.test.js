/**
 * Unit tests: systemPromptExtension passthrough in session-protocol
 *
 * Verifies that session-create messages with systemPromptExtension
 * correctly pass through to the session manager's createSession method.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleSessionCreate } from "../../src/gateways/ws/session-protocol.js";

describe("systemPromptExtension in session-create", () => {
  let server;
  let ws;
  let mockCreateSession;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateSession = vi.fn().mockReturnValue({ sessionId: "sess-ext-1" });

    server = {
      _send: vi.fn(),
      emit: vi.fn(),
      sessionManager: {
        createSession: mockCreateSession,
        getSession: vi.fn().mockReturnValue({
          id: "sess-ext-1",
          type: "agent",
          messages: [],
          provider: "ollama",
          model: "qwen2.5:7b",
        }),
      },
      sessionHandlers: new Map(),
    };
    ws = { readyState: 1 };
  });

  it("passes systemPromptExtension to createSession", async () => {
    const extension = "## 开源工具优先\n使用 ffmpeg 处理视频";

    await handleSessionCreate(server, "req-ext-1", ws, {
      sessionType: "agent",
      systemPromptExtension: extension,
    });

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPromptExtension: extension,
      }),
    );
  });

  it("creates session without systemPromptExtension when not provided", async () => {
    await handleSessionCreate(server, "req-ext-2", ws, {
      sessionType: "agent",
    });

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPromptExtension: undefined,
      }),
    );
  });

  it("sends session-started response after session with extension", async () => {
    await handleSessionCreate(server, "req-ext-3", ws, {
      sessionType: "agent",
      systemPromptExtension: "## 任务模板: 文档转换",
    });

    // Should have sent a session-started response
    const sendCalls = server._send.mock.calls;
    expect(sendCalls.length).toBeGreaterThan(0);

    const response = sendCalls[0][1];
    expect(response).toHaveProperty("sessionId", "sess-ext-1");
  });

  it("returns SESSION_CREATE_FAILED on error", async () => {
    mockCreateSession.mockImplementation(() => {
      throw new Error("Extension too large");
    });

    await handleSessionCreate(server, "req-ext-4", ws, {
      sessionType: "agent",
      systemPromptExtension: "x".repeat(1000000),
    });

    const sent = server._send.mock.calls[0][1];
    expect(sent.type).toBe("error");
    // v1.0 envelope wraps code/message in payload
    const code = sent.code || sent.payload?.code;
    const message = sent.message || sent.payload?.message;
    expect(code).toBe("SESSION_CREATE_FAILED");
    expect(message).toBe("Extension too large");
  });

  it("returns NO_SESSION_SUPPORT when sessionManager is null", async () => {
    server.sessionManager = null;

    await handleSessionCreate(server, "req-ext-5", ws, {
      sessionType: "agent",
      systemPromptExtension: "test",
    });

    const sent = server._send.mock.calls[0][1];
    expect(sent.type).toBe("error");
    const code = sent.code || sent.payload?.code;
    expect(code).toBe("NO_SESSION_SUPPORT");
  });

  it("passes shellPolicyOverrides to createSession", async () => {
    await handleSessionCreate(server, "req-ext-6", ws, {
      sessionType: "agent",
      systemPromptExtension: "## 信息检索",
      shellPolicyOverrides: ["network-download"],
    });

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        shellPolicyOverrides: ["network-download"],
      }),
    );
  });

  it("passes undefined shellPolicyOverrides when not provided", async () => {
    await handleSessionCreate(server, "req-ext-7", ws, {
      sessionType: "agent",
    });

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        shellPolicyOverrides: undefined,
      }),
    );
  });
});
