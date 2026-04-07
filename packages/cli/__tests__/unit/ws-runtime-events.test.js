import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/worktree-isolator.js", () => ({
  diffWorktree: vi.fn(() => ({
    files: [
      { path: "README.md", insertions: 2, deletions: 1, status: "modified" },
    ],
    summary: { filesChanged: 1, insertions: 2, deletions: 1 },
    diff: "diff --git a/README.md b/README.md\n+updated\n",
  })),
  mergeWorktree: vi.fn(() => ({
    success: true,
    strategy: "merge",
    message: "ok",
    summary: { conflictedFiles: 0 },
    conflicts: [],
    previewEntrypoints: [],
    suggestions: [],
  })),
}));

vi.mock("../../src/lib/compression-telemetry.js", () => ({
  getCompressionTelemetrySummary: vi.fn(() => ({
    samples: 2,
    totalSavedTokens: 100,
    variantDistribution: { balanced: 2 },
  })),
}));

import { RUNTIME_EVENTS } from "../../src/runtime/runtime-events.js";
import {
  handleSessionCreate,
  handleSessionResume,
  handleSessionMessage,
  handleSessionPolicyUpdate,
  handleSessionClose,
  handleHostToolResult,
} from "../../src/gateways/ws/session-protocol.js";
import {
  handleWorktreeDiff,
  handleWorktreeMerge,
  handleCompressionStats,
} from "../../src/gateways/ws/worktree-protocol.js";

function createServer() {
  const session = {
    id: "sess-1",
    type: "agent",
    messages: [{ role: "user", content: "hello" }],
    interaction: {
      resolveHostTool: vi.fn(),
    },
  };

  return {
    emit: vi.fn(),
    _send: vi.fn(),
    sessionHandlers: new Map(),
    sessionManager: {
      createSession: vi.fn(() => ({ sessionId: "sess-1" })),
      getSession: vi.fn(() => session),
      resumeSession: vi.fn(() => session),
      closeSession: vi.fn(),
      updateSessionPolicy: vi.fn(() => ({
        id: "sess-1",
        hostManagedToolPolicy: {
          tools: {
            run_shell: { allowed: false, decision: "require_confirmation" },
          },
        },
      })),
      persistMessages: vi.fn(),
      db: null,
    },
    _session: session,
  };
}

describe("ws runtime event emission", () => {
  let server;
  let ws;

  beforeEach(() => {
    server = createServer();
    ws = {};
  });

  it("emits runtime session events for create, resume, message, and close", async () => {
    await handleSessionCreate(server, "req-1", ws, {
      sessionType: "agent",
      provider: "openai",
      model: "gpt-4o-mini",
      worktreeIsolation: true,
    });

    await handleSessionResume(server, "req-2", ws, {
      sessionId: "sess-1",
    });

    const handler = {
      handleMessage: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
    };
    server.sessionHandlers.set("sess-1", handler);
    handleSessionMessage(server, "req-3", ws, {
      sessionId: "sess-1",
      content: "hello runtime",
    });
    await Promise.resolve();

    handleSessionClose(server, "req-4", ws, {
      sessionId: "sess-1",
    });

    expect(server.emit).toHaveBeenCalledWith(
      RUNTIME_EVENTS.SESSION_START,
      expect.objectContaining({
        type: "session:start",
        kind: "server",
        sessionId: "sess-1",
        payload: expect.objectContaining({
          sessionType: "agent",
          provider: "openai",
          model: "gpt-4o-mini",
          record: expect.objectContaining({
            id: "sess-1",
            type: "agent",
            status: "created",
            worktreeIsolation: true,
          }),
        }),
      }),
    );
    expect(server.emit).toHaveBeenCalledWith(
      RUNTIME_EVENTS.SESSION_RESUME,
      expect.objectContaining({
        type: "session:resume",
        sessionId: "sess-1",
        payload: expect.objectContaining({
          historyCount: 1,
          record: expect.objectContaining({
            id: "sess-1",
            type: "agent",
            status: "resumed",
            messageCount: 1,
          }),
        }),
      }),
    );
    expect(server.emit).toHaveBeenCalledWith(
      RUNTIME_EVENTS.SESSION_MESSAGE,
      expect.objectContaining({
        type: "session:message",
        sessionId: "sess-1",
        payload: expect.objectContaining({
          messageId: "req-3",
          content: "hello runtime",
        }),
      }),
    );
    expect(server.emit).toHaveBeenCalledWith(
      RUNTIME_EVENTS.SESSION_END,
      expect.objectContaining({
        type: "session:end",
        sessionId: "sess-1",
        payload: expect.objectContaining({
          record: expect.objectContaining({
            id: "sess-1",
            status: "closed",
          }),
        }),
      }),
    );
  });

  it("emits runtime worktree and compression summary events", async () => {
    await handleWorktreeDiff(server, "req-5", ws, {
      branch: "agent/task-1",
      baseBranch: "main",
    });
    await handleWorktreeMerge(server, "req-6", ws, {
      branch: "agent/task-1",
      strategy: "merge",
    });
    await handleCompressionStats(server, "req-7", ws, {
      windowMs: 60000,
      provider: "openai",
      model: "gpt-4o-mini",
    });

    expect(server.emit).toHaveBeenCalledWith(
      RUNTIME_EVENTS.WORKTREE_DIFF_READY,
      expect.objectContaining({
        type: "worktree:diff:ready",
        payload: expect.objectContaining({
          requestId: "req-5",
          diff: expect.stringContaining("diff --git"),
          record: expect.objectContaining({
            branch: "agent/task-1",
          }),
        }),
      }),
    );
    expect(server.emit).toHaveBeenCalledWith(
      RUNTIME_EVENTS.WORKTREE_MERGED,
      expect.objectContaining({
        type: "worktree:merge:completed",
        payload: expect.objectContaining({
          requestId: "req-6",
          suggestions: [],
          record: expect.objectContaining({
            branch: "agent/task-1",
          }),
        }),
      }),
    );
    expect(server.emit).toHaveBeenCalledWith(
      RUNTIME_EVENTS.COMPRESSION_SUMMARY,
      expect.objectContaining({
        type: "compression:summary",
        payload: expect.objectContaining({
          requestId: "req-7",
          summary: expect.objectContaining({
            totalSavedTokens: 100,
          }),
          filters: expect.objectContaining({
            windowMs: 60000,
            provider: "openai",
            model: "gpt-4o-mini",
          }),
        }),
      }),
    );
  });

  it("acknowledges host-managed session policy updates", () => {
    handleSessionPolicyUpdate(server, "req-8", ws, {
      sessionId: "sess-1",
      hostManagedToolPolicy: {
        tools: {
          run_shell: { allowed: false, decision: "require_confirmation" },
        },
      },
    });

    expect(server.sessionManager.updateSessionPolicy).toHaveBeenCalledWith(
      "sess-1",
      {
        tools: {
          run_shell: { allowed: false, decision: "require_confirmation" },
        },
      },
    );
    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-8",
      type: "session-policy-updated",
      success: true,
      sessionId: "sess-1",
    });
  });

  it("acknowledges host tool results and resolves the pending interaction", () => {
    handleHostToolResult(server, "req-9", ws, {
      sessionId: "sess-1",
      requestId: "host-tool-1",
      toolName: "mcp_weather_get_forecast",
      success: true,
      result: { forecast: "sunny" },
    });

    expect(server._session.interaction.resolveHostTool).toHaveBeenCalledWith(
      "host-tool-1",
      {
        success: true,
        result: { forecast: "sunny" },
        error: null,
        toolName: "mcp_weather_get_forecast",
      },
    );
    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-9",
      type: "result",
      success: true,
    });
  });

  it("passes worktree isolation through session creation", async () => {
    await handleSessionCreate(server, "req-10", ws, {
      sessionType: "agent",
      projectRoot: "/repo",
      worktreeIsolation: true,
    });

    expect(server.sessionManager.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent",
        projectRoot: "/repo",
        worktreeIsolation: true,
      }),
    );
  });
});
