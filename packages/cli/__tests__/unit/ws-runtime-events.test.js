import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

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
  previewWorktreeMerge: vi.fn(() => ({
    success: false,
    baseBranch: "main",
    summary: { conflictedFiles: 1, bothModified: 1 },
    conflicts: [
      { path: "src/a.js", type: "both_modified", automationCandidates: [] },
    ],
    previewEntrypoints: [{ type: "worktree-diff", branch: "agent/task-1" }],
  })),
  applyWorktreeAutomationCandidate: vi.fn(() => ({
    baseBranch: "main",
    filePath: "src/a.js",
    summary: { filesChanged: 1, insertions: 3, deletions: 2 },
  })),
  listWorktrees: vi.fn(() => [
    {
      branch: "agent/task-1",
      path: "/repo/.worktrees/agent-task-1",
      head: "abc123",
    },
    {
      branch: "agent/task-2",
      path: "/repo/.worktrees/agent-task-2",
      head: "def456",
    },
    // Filtered out by handler — does not start with `agent/`.
    { branch: "main", path: "/repo", head: "ffffff" },
  ]),
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
  buildResumeRecovery,
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
  handleWorktreeMergePreview,
  handleWorktreeAutomationApply,
  handleWorktreeList,
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

const cleanSideEffectLedger = () => ({ ops: [] });

describe("ws MCP recovery projection", () => {
  it("projects complete read-only recovery authority without truncating replay denies", () => {
    const replayDenied = Array.from({ length: 25 }, (_, index) => ({
      ledgerId: `mcp-deny-${index}`,
      serverName: "repo",
      toolName: "publish",
      inputBytes: index + 1,
      replayDigest: `sha256:${index.toString(16).padStart(64, "0")}`,
    }));
    const recovery = buildResumeRecovery("sess-mcp", {
      loadSideEffectLedger: cleanSideEffectLedger,
      loadMcpLedgerRecovery: () => ({
        unsettled: [],
        incidents: [],
        replayDenied,
        headHash: "a".repeat(64),
        recoveryDigest: `sha256:${"b".repeat(64)}`,
        remediation: "exact_replay_denied",
      }),
    });

    expect(recovery.mcp).toMatchObject({
      count: 25,
      headHash: "a".repeat(64),
      recoveryDigest: `sha256:${"b".repeat(64)}`,
      remediation: "exact_replay_denied",
    });
    expect(recovery.mcp.replayDenied).toHaveLength(25);
    expect(recovery.mcp.replayDenied[24]).toEqual(replayDenied[24]);
    expect(Object.isFrozen(recovery.mcp.replayDenied)).toBe(true);
    expect(Object.isFrozen(recovery.mcp.replayDenied[0])).toBe(true);
    expect(JSON.stringify(recovery.mcp)).not.toContain("inputDigest");
    expect(recovery.mcp.notice).toContain("exact replay denied");
  });

  it("fails closed on malformed replay authority or authority digests", () => {
    for (const authority of [
      {
        replayDenied: [
          {
            ledgerId: "mcp-old-shape",
            serverName: "repo",
            toolName: "publish",
            inputDigest: `sha256:${"c".repeat(64)}`,
          },
        ],
      },
      { headHash: `sha256:${"d".repeat(64)}` },
      { recoveryDigest: "e".repeat(64) },
      { remediation: "retry_automatically" },
    ]) {
      const recovery = buildResumeRecovery("sess-mcp", {
        loadSideEffectLedger: cleanSideEffectLedger,
        loadMcpLedgerRecovery: () => ({
          unsettled: [],
          incidents: [],
          ...authority,
        }),
      });
      expect(recovery.mcp).toMatchObject({
        blockMode: "all",
        remediation: "inspect_transcript",
        incidents: [{ code: "CC_MCP_LEDGER_RECOVERY_INVALID", ledgerId: null }],
      });
    }
  });

  it("surfaces unsettled MCP calls without retaining their arguments", () => {
    const recovery = buildResumeRecovery("sess-mcp", {
      loadSideEffectLedger: cleanSideEffectLedger,
      loadMcpLedgerRecovery: () => ({
        unsettled: [
          {
            ledgerId: "mcp-1",
            serverName: "github",
            toolName: "create_issue",
            status: "started",
            effectContract: { effect: "write" },
            inputDigest: "sha256:redacted",
            secretArgument: "must-not-leak",
          },
        ],
        incidents: [],
        replayDenied: [],
      }),
    });

    expect(recovery).toMatchObject({
      count: 1,
      items: [],
      mcp: {
        unsettled: [
          {
            ledgerId: "mcp-1",
            serverName: "github",
            toolName: "create_issue",
            effect: "write",
            status: "outcome_unknown",
          },
        ],
      },
    });
    expect(JSON.stringify(recovery)).not.toContain("must-not-leak");
    expect(recovery.notice).toContain("Do NOT automatically retry");
  });

  it("retains MCP authority state when a custom formatter returns no notice", () => {
    const recovery = buildResumeRecovery("sess-mcp", {
      loadSideEffectLedger: cleanSideEffectLedger,
      loadMcpLedgerRecovery: () => ({
        unsettled: [
          {
            ledgerId: "mcp-formatter-null",
            serverName: "github",
            toolName: "create_issue",
            effectContract: { effect: "write" },
          },
        ],
        incidents: [],
        replayDenied: [],
      }),
      formatMcpLedgerRecoveryNotice: () => null,
    });

    expect(recovery.mcp.unsettled).toHaveLength(1);
    expect(recovery.notice).toContain("requires inspection");
  });

  it.each([
    { incidents: {}, unsettled: [] },
    { incidents: [], unsettled: null },
    Promise.resolve({ incidents: [], unsettled: [] }),
  ])(
    "turns malformed MCP recovery into a fail-closed incident",
    (malformed) => {
      const recovery = buildResumeRecovery("sess-mcp", {
        loadSideEffectLedger: cleanSideEffectLedger,
        loadMcpLedgerRecovery: () => malformed,
      });

      expect(recovery.mcp.incidents).toEqual([
        {
          code: "CC_MCP_LEDGER_RECOVERY_INVALID",
          ledgerId: null,
        },
      ]);
    },
  );

  it("turns an unreadable MCP ledger into a fail-closed incident", () => {
    const error = Object.assign(new Error("corrupt transcript"), {
      code: "CC_MCP_LEDGER_EVENT_READ_FAILED",
    });
    const recovery = buildResumeRecovery("sess-mcp", {
      loadSideEffectLedger: cleanSideEffectLedger,
      loadMcpLedgerRecovery: () => {
        throw error;
      },
    });

    expect(recovery.mcp.incidents).toEqual([
      {
        code: "CC_MCP_LEDGER_EVENT_READ_FAILED",
        ledgerId: null,
      },
    ]);
    expect(recovery.notice).toContain("Do NOT automatically retry");
    expect(recovery.notice).not.toContain("corrupt transcript");
  });

  it("rejects Proxy/accessor recovery without reading time-varying getters", () => {
    let proxyReads = 0;
    const proxied = new Proxy(
      {
        unsettled: [
          { ledgerId: "unsafe", effectContract: { effect: "write" } },
        ],
        incidents: [],
        replayDenied: [],
      },
      {
        get(target, key, receiver) {
          proxyReads += 1;
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const accessor = { incidents: [] };
    Object.defineProperty(accessor, "unsettled", {
      enumerable: true,
      get: () => [],
    });

    for (const malformed of [proxied, accessor]) {
      const recovery = buildResumeRecovery("sess-mcp", {
        loadSideEffectLedger: cleanSideEffectLedger,
        loadMcpLedgerRecovery: () => malformed,
      });
      expect(recovery.mcp).toMatchObject({
        blockMode: "all",
        incidents: [{ code: "CC_MCP_LEDGER_RECOVERY_INVALID", ledgerId: null }],
      });
    }
    expect(proxyReads).toBe(0);
  });

  it("fails closed on an asynchronous formatter and only formats frozen redacted data", () => {
    let formatted = null;
    const recovery = buildResumeRecovery("sess-mcp", {
      loadSideEffectLedger: cleanSideEffectLedger,
      loadMcpLedgerRecovery: () => ({
        unsettled: [
          {
            ledgerId: "mcp-format",
            serverName: "repo",
            toolName: "publish",
            effectContract: { effect: "write" },
            secretArgument: "must-not-reach-formatter",
          },
        ],
        incidents: [],
        replayDenied: [],
      }),
      formatMcpLedgerRecoveryNotice: (projection) => {
        formatted = projection;
        return Promise.resolve("late notice");
      },
    });

    expect(Object.isFrozen(formatted)).toBe(true);
    expect(Object.isFrozen(formatted.unsettled)).toBe(true);
    expect(JSON.stringify(formatted)).not.toContain("must-not-reach-formatter");
    expect(recovery.mcp).toMatchObject({
      blockMode: "all",
      incidents: [{ code: "CC_MCP_LEDGER_RECOVERY_INVALID", ledgerId: null }],
    });
  });

  it("rejects non-string recovery scalars without projecting object content", () => {
    const recovery = buildResumeRecovery("sess-mcp", {
      loadSideEffectLedger: cleanSideEffectLedger,
      loadMcpLedgerRecovery: () => ({
        unsettled: [
          {
            ledgerId: { secret: "must-not-project" },
            serverName: "repo",
            toolName: "publish",
            effectContract: { effect: "write" },
          },
        ],
        incidents: [],
      }),
    });

    expect(recovery.mcp).toMatchObject({
      blockMode: "all",
      incidents: [{ code: "CC_MCP_LEDGER_RECOVERY_INVALID", ledgerId: null }],
    });
    expect(JSON.stringify(recovery)).not.toContain("must-not-project");
  });

  it("keeps an explicit recovery block mode visible even with empty arrays", () => {
    const recovery = buildResumeRecovery("sess-mcp", {
      loadSideEffectLedger: cleanSideEffectLedger,
      loadMcpLedgerRecovery: () => ({
        unsettled: [],
        incidents: [],
        replayDenied: [],
        blockMode: "all",
      }),
      formatMcpLedgerRecoveryNotice: () => null,
    });

    expect(recovery.mcp).toMatchObject({ blockMode: "all", count: 0 });
    expect(recovery.notice).toContain("requires inspection");
  });

  it("surfaces side-effect ledger read failures instead of dropping recovery", () => {
    const error = Object.assign(new Error("secret parse details"), {
      code: "CC_SIDE_EFFECT_LEDGER_CORRUPT",
    });
    const recovery = buildResumeRecovery("sess-side-effect", {
      loadSideEffectLedger: () => {
        throw error;
      },
      loadMcpLedgerRecovery: () => ({
        unsettled: [],
        incidents: [],
        replayDenied: [],
      }),
    });

    expect(recovery.sideEffectIncidents).toEqual([
      { code: "CC_SIDE_EFFECT_LEDGER_CORRUPT" },
    ]);
    expect(recovery.notice).toContain("Do NOT automatically retry");
    expect(recovery.notice).not.toContain("secret parse details");
  });
});

describe("ws runtime event emission", () => {
  let server;
  let ws;

  beforeEach(() => {
    server = createServer();
    ws = {};
  });

  afterEach(() => {
    for (const handler of server.sessionHandlers.values()) {
      try {
        handler?.destroy?.();
      } catch {
        // Individual tests assert bootstrap semantics; cleanup must still
        // release the process-local host lease for the next isolated server.
      }
    }
    server.sessionHandlers.clear();
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
    server.sessionHandlers.get("sess-1")?.destroy?.();
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

  it("binds recovery authority before refreshing a live handler", async () => {
    const observations = [];
    const handler = {
      refreshMcpRecoveryRuntime: vi.fn(() => {
        observations.push({
          recovery: server._session.mcpLedgerRecovery,
          revision: server._session.mcpLedgerRecoveryRevision,
        });
      }),
    };
    server.sessionHandlers.set("sess-1", handler);
    server.resumeRecoveryDependencies = {
      loadSideEffectLedger: cleanSideEffectLedger,
      loadMcpLedgerRecovery: () => ({
        unsettled: [],
        incidents: [{ code: "SESSION_TRANSCRIPT_UNVERIFIED" }],
        replayDenied: [],
      }),
    };

    await handleSessionResume(server, "req-authority", ws, {
      sessionId: "sess-1",
    });

    expect(handler.refreshMcpRecoveryRuntime).toHaveBeenCalledOnce();
    expect(observations).toEqual([
      {
        recovery: expect.objectContaining({
          blockMode: "all",
          incidents: [
            { code: "SESSION_TRANSCRIPT_UNVERIFIED", ledgerId: null },
          ],
        }),
        revision: 1,
      },
    ]);
  });

  it("turns an asynchronous handler refresh rejection into a resumed fail-closed response", async () => {
    const refreshError = Object.assign(new Error("async refresh failed"), {
      code: "CC_ASYNC_MCP_REFRESH_FAILED",
    });
    const handler = {
      refreshMcpRecoveryRuntime: vi.fn().mockRejectedValue(refreshError),
    };
    server.sessionHandlers.set("sess-1", handler);
    server.resumeRecoveryDependencies = {
      loadSideEffectLedger: cleanSideEffectLedger,
      loadMcpLedgerRecovery: () => ({
        unsettled: [],
        incidents: [],
        replayDenied: [],
      }),
    };

    await expect(
      handleSessionResume(server, "req-async-refresh", ws, {
        sessionId: "sess-1",
      }),
    ).resolves.toBeUndefined();

    expect(server._session.mcpLedgerRecovery).toMatchObject({
      blockMode: "all",
      incidents: [{ code: "CC_ASYNC_MCP_REFRESH_FAILED", ledgerId: null }],
    });
    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        type: "session.resumed",
        payload: expect.objectContaining({
          recovery: expect.objectContaining({
            mcp: expect.objectContaining({ blockMode: "all" }),
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
    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        version: "1.0",
        type: "command.response",
        requestId: "req-8",
        sessionId: "sess-1",
        payload: expect.objectContaining({
          success: true,
          sessionId: "sess-1",
        }),
      }),
    );
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
    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        version: "1.0",
        type: "command.response",
        requestId: "req-9",
        sessionId: "sess-1",
        payload: expect.objectContaining({
          success: true,
        }),
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────
  // Envelope shape coverage — every WS protocol handler must emit a v1.0
  // envelope keyed by `requestId` and tagged `source: "cli-runtime"`.
  // ─────────────────────────────────────────────────────────────────────

  it("worktree-diff handler emits a unified envelope with files+summary+diff", async () => {
    await handleWorktreeDiff(server, "req-wd", ws, {
      branch: "agent/task-1",
      baseBranch: "main",
    });

    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        version: "1.0",
        type: "worktree.diff",
        requestId: "req-wd",
        source: "cli-runtime",
        payload: expect.objectContaining({
          files: expect.any(Array),
          summary: expect.objectContaining({ filesChanged: 1 }),
          diff: expect.stringContaining("diff --git"),
          record: expect.objectContaining({
            previewEntrypoints: expect.arrayContaining([
              expect.objectContaining({
                type: "worktree-diff",
                branch: "agent/task-1",
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("worktree-diff handler emits an error envelope when branch is missing", async () => {
    await handleWorktreeDiff(server, "req-wd-err", ws, {});

    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        version: "1.0",
        type: "error",
        requestId: "req-wd-err",
        source: "cli-runtime",
        payload: expect.objectContaining({
          code: "NO_BRANCH",
          message: expect.stringContaining("branch required"),
        }),
      }),
    );
  });

  it("worktree-merge handler emits envelope with success+strategy+record", async () => {
    await handleWorktreeMerge(server, "req-wm", ws, {
      branch: "agent/task-1",
      strategy: "merge",
    });

    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        version: "1.0",
        type: "worktree.merged",
        requestId: "req-wm",
        source: "cli-runtime",
        payload: expect.objectContaining({
          success: true,
          strategy: "merge",
          record: expect.any(Object),
        }),
      }),
    );
  });

  it("worktree-merge-preview handler emits envelope with conflicts+previewOnly", async () => {
    await handleWorktreeMergePreview(server, "req-wmp", ws, {
      branch: "agent/task-1",
      baseBranch: "main",
      strategy: "merge",
    });

    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        version: "1.0",
        type: "worktree.merge-preview",
        requestId: "req-wmp",
        source: "cli-runtime",
        payload: expect.objectContaining({
          success: false,
          baseBranch: "main",
          conflicts: expect.arrayContaining([
            expect.objectContaining({
              path: "src/a.js",
              type: "both_modified",
            }),
          ]),
        }),
      }),
    );
  });

  it("worktree-merge-preview handler emits error envelope when branch is missing", async () => {
    await handleWorktreeMergePreview(server, "req-wmp-err", ws, {});
    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        version: "1.0",
        type: "error",
        requestId: "req-wmp-err",
        payload: expect.objectContaining({ code: "NO_BRANCH" }),
      }),
    );
  });

  it("worktree-automation-apply handler emits envelope with summary record", async () => {
    await handleWorktreeAutomationApply(server, "req-wa", ws, {
      branch: "agent/task-1",
      baseBranch: "main",
      filePath: "src/a.js",
      candidateId: "auto-1",
      conflictType: "both_modified",
    });

    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        version: "1.0",
        type: "worktree.automation-applied",
        requestId: "req-wa",
        source: "cli-runtime",
        payload: expect.objectContaining({
          baseBranch: "main",
          filePath: "src/a.js",
          summary: expect.objectContaining({ filesChanged: 1 }),
          record: expect.any(Object),
        }),
      }),
    );
  });

  it("worktree-automation-apply handler emits error envelope on missing filePath/candidateId", async () => {
    await handleWorktreeAutomationApply(server, "req-wa-err", ws, {
      branch: "agent/task-1",
    });
    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        version: "1.0",
        type: "error",
        requestId: "req-wa-err",
        payload: expect.objectContaining({
          code: "INVALID_WORKTREE_AUTOMATION",
        }),
      }),
    );
  });

  it("worktree-list handler emits envelope filtered to agent/* branches only", async () => {
    await handleWorktreeList(server, "req-wl", ws);

    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        version: "1.0",
        type: "worktree.list",
        requestId: "req-wl",
        source: "cli-runtime",
        payload: expect.objectContaining({
          worktrees: expect.arrayContaining([
            expect.objectContaining({ branch: "agent/task-1" }),
            expect.objectContaining({ branch: "agent/task-2" }),
          ]),
        }),
      }),
    );

    // The `main` branch returned by listWorktrees() must be filtered out.
    const sendCall = server._send.mock.calls[0];
    const envelope = sendCall[1];
    const branches = envelope.payload.worktrees.map((w) => w.branch);
    expect(branches).not.toContain("main");
  });

  it("session-create handler emits envelope with sessionId+record+source", async () => {
    await handleSessionCreate(server, "req-sc-env", ws, {
      sessionType: "agent",
      provider: "openai",
      model: "gpt-4o-mini",
    });

    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        version: "1.0",
        type: "session.started",
        requestId: "req-sc-env",
        sessionId: "sess-1",
        source: "cli-runtime",
        payload: expect.objectContaining({
          sessionId: "sess-1",
          sessionType: "agent",
          record: expect.any(Object),
        }),
      }),
    );
  });

  it("fails session creation closed when handler bootstrap fails", async () => {
    const bootstrapError = Object.assign(new Error("handler bootstrap failed"), {
      code: "CC_WS_HANDLER_BOOTSTRAP_FAILED",
    });
    server._session.mcpClient = {
      setElicitationHandler: vi.fn(() => {
        throw bootstrapError;
      }),
      clearElicitationHandler: vi.fn(),
    };
    server.sessionManager.rollbackSessionCreation = vi.fn();

    await handleSessionCreate(server, "req-bootstrap-failed", ws, {
      sessionType: "agent",
    });

    expect(server.sessionManager.rollbackSessionCreation).toHaveBeenCalledWith(
      "sess-1",
    );
    expect(server.emit).not.toHaveBeenCalledWith(
      RUNTIME_EVENTS.SESSION_START,
      expect.anything(),
    );
    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        type: "error",
        sessionId: "sess-1",
        payload: expect.objectContaining({
          code: "CC_WS_HANDLER_BOOTSTRAP_FAILED",
        }),
      }),
    );
  });

  it("session-resume handler emits envelope with history+record", async () => {
    await handleSessionResume(server, "req-sr-env", ws, {
      sessionId: "sess-1",
    });

    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        version: "1.0",
        type: "session.resumed",
        requestId: "req-sr-env",
        sessionId: "sess-1",
        source: "cli-runtime",
        payload: expect.objectContaining({
          sessionId: "sess-1",
          history: expect.any(Array),
          record: expect.any(Object),
        }),
      }),
    );
  });

  it("fails resume closed when a live handler cannot be established", async () => {
    const bootstrapError = Object.assign(new Error("resume bootstrap failed"), {
      code: "CC_WS_RESUME_BOOTSTRAP_FAILED",
    });
    server._session.mcpClient = {
      setElicitationHandler: vi.fn(() => {
        throw bootstrapError;
      }),
    };

    await handleSessionResume(server, "req-resume-bootstrap-failed", ws, {
      sessionId: "sess-1",
    });

    expect(server.emit).not.toHaveBeenCalledWith(
      RUNTIME_EVENTS.SESSION_RESUME,
      expect.anything(),
    );
    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        type: "error",
        sessionId: "sess-1",
        payload: expect.objectContaining({
          code: "CC_WS_RESUME_BOOTSTRAP_FAILED",
        }),
      }),
    );
  });

  it("session-resume adds the optional replayed state snapshot", async () => {
    server.sessionManager.getSessionStateSnapshot = vi.fn(() => ({
      schema: "chainlesschain.ws-session-state",
      version: 1,
      revision: 5,
      todo: { revision: 3, todos: [] },
      pendingApproval: null,
      run: { status: "interrupted", requestId: "turn-1" },
    }));

    await handleSessionResume(server, "req-state", ws, {
      sessionId: "sess-1",
    });

    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        type: "session.resumed",
        payload: expect.objectContaining({
          stateSnapshot: expect.objectContaining({
            revision: 5,
            todo: { revision: 3, todos: [] },
            run: expect.objectContaining({ status: "interrupted" }),
          }),
        }),
      }),
    );
  });

  it("session-close handler emits command.response envelope", () => {
    handleSessionClose(server, "req-cl-env", ws, { sessionId: "sess-1" });
    expect(server._send).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        version: "1.0",
        type: "command.response",
        requestId: "req-cl-env",
        sessionId: "sess-1",
        payload: expect.objectContaining({
          success: true,
          sessionId: "sess-1",
        }),
      }),
    );
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
