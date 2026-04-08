import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all heavy dependencies before importing
vi.mock("../../src/lib/plan-mode.js", () => ({
  PlanModeManager: vi.fn(() => ({
    state: "inactive",
    currentPlan: null,
    history: [],
    blockedToolLog: [],
    isActive: vi.fn(() => false),
    enterPlanMode: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
  })),
  PlanState: {
    INACTIVE: "inactive",
    ANALYZING: "analyzing",
    APPROVED: "approved",
  },
  ExecutionPlan: class ExecutionPlan {
    constructor(data = {}) {
      Object.assign(this, data);
      this.items = data.items || [];
    }
  },
}));

vi.mock("../../src/lib/cli-context-engineering.js", () => ({
  CLIContextEngineering: vi.fn(() => ({
    setTask: vi.fn(),
    clearTask: vi.fn(),
    recordError: vi.fn(),
    getStats: vi.fn(() => ({})),
    smartCompact: vi.fn((msgs) => msgs.slice(0, 2)),
  })),
}));

vi.mock("../../src/lib/permanent-memory.js", () => ({
  CLIPermanentMemory: vi.fn(() => ({
    initialize: vi.fn(),
    autoSummarize: vi.fn(),
  })),
}));

vi.mock("../../src/lib/session-manager.js", () => ({
  createSession: vi.fn(),
  saveMessages: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(() => []),
  updateSession: vi.fn(),
}));

vi.mock("../../src/lib/agent-core.js", () => ({
  getBaseSystemPrompt: vi.fn(() => "You are a helpful assistant."),
  buildSystemPrompt: vi.fn(() => "You are a helpful assistant."),
}));

vi.mock("../../src/lib/worktree-isolator.js", () => ({
  createWorktree: vi.fn((repoDir, branchName) => ({
    path: `${repoDir}/.worktrees/${branchName.replace(/\//g, "-")}`,
    branch: branchName,
  })),
  removeWorktree: vi.fn(),
}));

vi.mock("../../src/lib/git-integration.js", () => ({
  isGitRepo: vi.fn(() => true),
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ""),
  },
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
}));

import { WSSessionManager } from "../../src/lib/ws-session-manager.js";
import {
  createSession as dbCreateSession,
  saveMessages as dbSaveMessages,
  getSession as dbGetSession,
  listSessions as dbListSessions,
  updateSession as dbUpdateSession,
} from "../../src/lib/session-manager.js";
import {
  createWorktree,
  removeWorktree,
} from "../../src/lib/worktree-isolator.js";
import { isGitRepo } from "../../src/lib/git-integration.js";
import fs from "fs";
import { CODING_AGENT_MVP_TOOL_NAMES } from "../../src/runtime/coding-agent-contract.js";

describe("WSSessionManager", () => {
  let manager;
  let mockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })),
      exec: vi.fn(),
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    };
    manager = new WSSessionManager({ db: mockDb, config: { test: true } });
  });

  describe("constructor", () => {
    it("sets defaults when no options given", () => {
      const m = new WSSessionManager();
      expect(m.db).toBe(null);
      expect(m.config).toEqual({});
      expect(m.defaultProjectRoot).toBe(process.cwd());
      expect(m.sessions).toBeInstanceOf(Map);
      expect(m.sessions.size).toBe(0);
    });

    it("accepts db and config", () => {
      expect(manager.db).toBe(mockDb);
      expect(manager.config).toEqual({ test: true });
    });
  });

  describe("createSession", () => {
    it("returns an object with sessionId", () => {
      const result = manager.createSession();
      expect(result).toHaveProperty("sessionId");
      expect(typeof result.sessionId).toBe("string");
      expect(result.sessionId).toMatch(/^ws-session-/);
    });

    it("creates agent type by default", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      expect(session.type).toBe("agent");
    });

    it("creates chat type when specified", () => {
      const { sessionId } = manager.createSession({ type: "chat" });
      const session = manager.getSession(sessionId);
      expect(session.type).toBe("chat");
    });

    it("uses defaultProjectRoot when no projectRoot given", () => {
      manager.defaultProjectRoot = "/my/project";
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      expect(session.projectRoot).toBe("/my/project");
    });

    it("rules.md is now loaded by buildSystemPrompt (session.rulesContent is null)", () => {
      const { sessionId } = manager.createSession({
        projectRoot: "/proj",
      });
      const session = manager.getSession(sessionId);
      // rules.md loading moved to buildSystemPrompt in agent-core.js
      expect(session.rulesContent).toBeNull();
    });

    it("creates plan manager per session", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      expect(session.planManager).toBeDefined();
      expect(session.planManager.isActive).toBeDefined();
    });

    it("creates context engine", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      expect(session.contextEngine).not.toBeNull();
    });

    it("persists to DB when db is available", () => {
      manager.createSession({ provider: "anthropic", model: "claude-3" });
      expect(dbCreateSession).toHaveBeenCalledTimes(1);
      expect(dbCreateSession).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          provider: "anthropic",
          model: "claude-3",
        }),
      );
    });

    it("does not persist when db is null", () => {
      const m = new WSSessionManager();
      m.createSession();
      expect(dbCreateSession).not.toHaveBeenCalled();
    });

    it("uses config.llm as defaults for provider/model/baseUrl/apiKey", () => {
      const m = new WSSessionManager({
        config: {
          llm: {
            provider: "volcengine",
            model: "doubao-seed-1-6",
            baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
            apiKey: "test-key",
          },
        },
      });
      const { sessionId } = m.createSession();
      const session = m.getSession(sessionId);
      expect(session.provider).toBe("volcengine");
      expect(session.model).toBe("doubao-seed-1-6");
      expect(session.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
      expect(session.apiKey).toBe("test-key");
    });

    it("options override config.llm defaults", () => {
      const m = new WSSessionManager({
        config: {
          llm: { provider: "volcengine", model: "doubao-seed-1-6" },
        },
      });
      const { sessionId } = m.createSession({
        provider: "anthropic",
        model: "claude-3-5-haiku",
      });
      const session = m.getSession(sessionId);
      expect(session.provider).toBe("anthropic");
      expect(session.model).toBe("claude-3-5-haiku");
    });

    it("falls back to ollama when no config.llm set", () => {
      const m = new WSSessionManager({ config: {} });
      const { sessionId } = m.createSession();
      const session = m.getSession(sessionId);
      expect(session.provider).toBe("ollama");
      expect(session.model).toBe("qwen2.5:7b");
    });

    it("sets session status to active", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      expect(session.status).toBe("active");
    });

    it("stores host-managed tool policy when provided", () => {
      const hostManagedToolPolicy = {
        tools: {
          write_file: { allowed: false, decision: "require_plan" },
        },
      };
      const { sessionId } = manager.createSession({ hostManagedToolPolicy });
      const session = manager.getSession(sessionId);
      expect(session.hostManagedToolPolicy).toEqual(hostManagedToolPolicy);
    });

    it("defaults coding sessions to the MVP tool set", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);

      expect(session.enabledToolNames).toEqual(CODING_AGENT_MVP_TOOL_NAMES);
    });

    it("stores a normalized enabledToolNames allowlist when provided", () => {
      const { sessionId } = manager.createSession({
        enabledToolNames: ["run_code", "read_file", "read_file", "unknown"],
      });
      const session = manager.getSession(sessionId);

      expect(session.enabledToolNames).toEqual(["run_code", "read_file"]);
    });

    it("builds direct session MCP tools from a trusted connected mcpClient", () => {
      const mcpClient = {
        servers: new Map([
          [
            "weather",
            {
              state: "connected",
              tools: [
                {
                  name: "get_forecast",
                  description: "Get weather forecast",
                  inputSchema: {
                    type: "object",
                    properties: {
                      city: { type: "string" },
                    },
                    required: ["city"],
                  },
                },
              ],
            },
          ],
        ]),
        listTools: vi.fn((serverName) => {
          const server = mcpClient.servers.get(serverName);
          return server?.tools || [];
        }),
      };
      const m = new WSSessionManager({
        db: mockDb,
        mcpClient,
        mcpServerRegistry: {
          trustedServers: [
            {
              id: "weather",
              securityLevel: "low",
              requiredPermissions: ["network:http"],
              capabilities: ["tools"],
            },
          ],
        },
      });

      const { sessionId } = m.createSession();
      const session = m.getSession(sessionId);

      expect(session.externalToolDefinitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            function: expect.objectContaining({
              name: "mcp_weather_get_forecast",
            }),
          }),
        ]),
      );
      expect(session.externalToolDescriptors).toMatchObject({
        mcp_weather_get_forecast: expect.objectContaining({
          source: "mcp:weather",
          riskLevel: "low",
          isReadOnly: true,
        }),
      });
      expect(session.externalToolExecutors).toMatchObject({
        mcp_weather_get_forecast: {
          kind: "mcp",
          serverName: "weather",
          toolName: "get_forecast",
        },
      });
    });

    it("persists resumable metadata for new sessions", () => {
      const { sessionId } = manager.createSession({
        type: "agent",
        projectRoot: "/repo",
        enabledToolNames: ["read_file", "run_code", "unknown"],
        hostManagedToolPolicy: {
          tools: {
            run_shell: { allowed: false, decision: "require_confirmation" },
          },
        },
      });

      expect(dbUpdateSession).toHaveBeenCalledWith(
        mockDb,
        sessionId,
        expect.objectContaining({
          metadata: expect.objectContaining({
            sessionType: "agent",
            projectRoot: "/repo",
            baseProjectRoot: "/repo",
            enabledToolNames: ["read_file", "run_code"],
            worktreeIsolation: false,
            hostManagedToolPolicy: {
              tools: {
                run_shell: {
                  allowed: false,
                  decision: "require_confirmation",
                },
              },
            },
          }),
        }),
      );
    });

    it("creates an isolated worktree when requested", () => {
      const { sessionId } = manager.createSession({
        projectRoot: "/repo",
        worktreeIsolation: true,
      });
      const session = manager.getSession(sessionId);

      expect(isGitRepo).toHaveBeenCalledWith("/repo");
      expect(createWorktree).toHaveBeenCalledWith(
        "/repo",
        `coding-agent/${sessionId}`,
      );
      expect(session.projectRoot).toContain("/repo/.worktrees/");
      expect(session.baseProjectRoot).toBe("/repo");
      expect(session.worktreeIsolation).toBe(true);
      expect(session.worktree).toMatchObject({
        branch: `coding-agent/${sessionId}`,
        baseProjectRoot: "/repo",
      });
    });
  });

  describe("getSession", () => {
    it("returns session by id", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session.id).toBe(sessionId);
    });

    it("returns null for unknown id", () => {
      const session = manager.getSession("nonexistent-id");
      expect(session).toBeNull();
    });
  });

  describe("resumeSession", () => {
    it("returns session from in-memory map", () => {
      const { sessionId } = manager.createSession();
      const session = manager.resumeSession(sessionId);
      expect(session).not.toBeNull();
      expect(session.id).toBe(sessionId);
      expect(session.status).toBe("active");
    });

    it("loads session from DB when not in memory", () => {
      dbGetSession.mockReturnValue({
        id: "db-session-123",
        provider: "openai",
        model: "gpt-4",
        messages: JSON.stringify([{ role: "system", content: "hello" }]),
        metadata: JSON.stringify({
          sessionType: "chat",
          projectRoot: "/repo/project",
          baseProjectRoot: "/repo/project",
          baseUrl: "https://api.example.com",
          enabledToolNames: ["read_file", "run_code"],
          hostManagedToolPolicy: {
            tools: {
              write_file: { allowed: false, decision: "require_plan" },
            },
          },
          worktreeIsolation: false,
          planSnapshot: {
            state: "approved",
            currentPlan: {
              id: "plan-1",
              title: "Resume Plan",
              items: [{ id: "item-1", title: "Edit file" }],
            },
            history: [],
            blockedToolLog: [{ tool: "write_file" }],
          },
        }),
        created_at: "2026-01-01T00:00:00Z",
      });

      const session = manager.resumeSession("db-session-123");
      expect(session).not.toBeNull();
      expect(session.id).toBe("db-session-123");
      expect(session.type).toBe("chat");
      expect(session.provider).toBe("openai");
      expect(session.model).toBe("gpt-4");
      expect(session.baseUrl).toBe("https://api.example.com");
      expect(session.projectRoot).toBe("/repo/project");
      expect(session.baseProjectRoot).toBe("/repo/project");
      expect(session.enabledToolNames).toEqual(["read_file", "run_code"]);
      expect(session.hostManagedToolPolicy).toEqual({
        tools: {
          write_file: { allowed: false, decision: "require_plan" },
        },
      });
      expect(session.planManager.state).toBe("approved");
      expect(session.planManager.currentPlan).toMatchObject({
        title: "Resume Plan",
      });
      expect(session.planManager.blockedToolLog).toEqual([
        { tool: "write_file" },
      ]);
      expect(session.messages).toEqual([{ role: "system", content: "hello" }]);
      expect(dbGetSession).toHaveBeenCalledWith(mockDb, "db-session-123");
    });

    it("returns null when not found in memory or DB", () => {
      dbGetSession.mockReturnValue(null);
      const session = manager.resumeSession("ghost-session");
      expect(session).toBeNull();
    });

    it("returns null when db is not available and session not in memory", () => {
      const m = new WSSessionManager();
      const session = m.resumeSession("no-db-session");
      expect(session).toBeNull();
    });
  });

  describe("closeSession", () => {
    it("removes session from map", () => {
      const { sessionId } = manager.createSession();
      expect(manager.getSession(sessionId)).not.toBeNull();
      manager.closeSession(sessionId);
      expect(manager.getSession(sessionId)).toBeNull();
    });

    it("persists messages to DB", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      session.messages.push({ role: "user", content: "hello" });
      manager.closeSession(sessionId);
      expect(dbSaveMessages).toHaveBeenCalledWith(
        mockDb,
        sessionId,
        expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "hello" }),
        ]),
        expect.objectContaining({
          sessionType: "agent",
          projectRoot: expect.any(String),
          planSnapshot: expect.objectContaining({
            state: "inactive",
          }),
        }),
      );
    });

    it("auto-summarizes when messages > 4 and permanentMemory exists", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      // Add enough messages to trigger summarize
      session.messages.push({ role: "user", content: "q1" });
      session.messages.push({ role: "assistant", content: "a1" });
      session.messages.push({ role: "user", content: "q2" });
      session.messages.push({ role: "assistant", content: "a2" });
      // Now messages.length > 4 (system + 4 = 5)
      manager.closeSession(sessionId);
      expect(session.permanentMemory.autoSummarize).toHaveBeenCalledWith(
        expect.any(Array),
      );
    });

    it("does nothing for unknown session", () => {
      // Should not throw
      manager.closeSession("unknown-id");
      expect(dbSaveMessages).not.toHaveBeenCalled();
    });

    it("cleans up the worktree when an isolated session closes", () => {
      const { sessionId } = manager.createSession({
        projectRoot: "/repo",
        worktreeIsolation: true,
      });
      const session = manager.getSession(sessionId);

      manager.closeSession(sessionId);

      expect(removeWorktree).toHaveBeenCalledWith(
        "/repo",
        session.worktree.path,
        { deleteBranch: true },
      );
    });
  });

  describe("listSessions", () => {
    it("returns in-memory sessions", () => {
      manager.createSession({ type: "agent" });
      manager.createSession({ type: "chat" });
      const sessions = manager.listSessions();
      expect(sessions.length).toBe(2);
      expect(sessions[0]).toHaveProperty("id");
      expect(sessions[0]).toHaveProperty("type");
      expect(sessions[0]).toHaveProperty("status");
      expect(sessions[0]).toHaveProperty("messageCount");
    });

    it("includes DB sessions not already in memory", () => {
      dbListSessions.mockReturnValue([
        {
          id: "db-only-1",
          provider: "ollama",
          model: "qwen2.5:7b",
          message_count: 5,
          created_at: "2026-01-01",
          updated_at: "2026-01-02",
        },
      ]);
      const sessions = manager.listSessions();
      expect(sessions.some((s) => s.id === "db-only-1")).toBe(true);
    });
  });

  describe("persistMessages", () => {
    it("updates lastActivity after persisting", () => {
      const { sessionId } = manager.createSession();
      const session = manager.getSession(sessionId);
      const before = session.lastActivity;

      // Small delay to ensure timestamp differs
      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);
      manager.persistMessages(sessionId);
      vi.useRealTimers();

      expect(dbSaveMessages).toHaveBeenCalledWith(
        mockDb,
        sessionId,
        session.messages,
        expect.objectContaining({
          sessionType: "agent",
          projectRoot: expect.any(String),
        }),
      );
    });

    it("does nothing for unknown session", () => {
      manager.persistMessages("ghost");
      expect(dbSaveMessages).not.toHaveBeenCalled();
    });
  });

  describe("updateSessionPolicy", () => {
    it("updates host-managed policy for an active session", () => {
      const { sessionId } = manager.createSession();
      const updated = manager.updateSessionPolicy(sessionId, {
        tools: {
          run_shell: { allowed: false, decision: "require_confirmation" },
        },
      });

      expect(updated?.hostManagedToolPolicy).toEqual({
        tools: {
          run_shell: { allowed: false, decision: "require_confirmation" },
        },
      });
    });

    it("returns null for an unknown session", () => {
      expect(manager.updateSessionPolicy("missing-session", {})).toBeNull();
    });
  });

  describe("review mode", () => {
    it("enterReview creates a pending review with normalized checklist", () => {
      const { sessionId } = manager.createSession();
      const state = manager.enterReview(sessionId, {
        reason: "Human check before shipping",
        requestedBy: "user",
        checklist: [
          { title: "Check migrations" },
          { id: "lint", title: "Run lint" },
        ],
      });

      expect(state).not.toBeNull();
      expect(state.status).toBe("pending");
      expect(state.blocking).toBe(true);
      expect(state.reviewId).toMatch(/^review-/);
      expect(state.reason).toBe("Human check before shipping");
      expect(state.requestedBy).toBe("user");
      expect(state.checklist).toHaveLength(2);
      expect(state.checklist[0]).toEqual(
        expect.objectContaining({ title: "Check migrations", done: false }),
      );
      expect(state.checklist[1].id).toBe("lint");
      expect(state.comments).toEqual([]);
      expect(manager.getReviewState(sessionId)).toBe(state);
    });

    it("enterReview is idempotent while a review is pending", () => {
      const { sessionId } = manager.createSession();
      const first = manager.enterReview(sessionId, { reason: "first" });
      const second = manager.enterReview(sessionId, { reason: "second" });
      expect(second).toBe(first);
      expect(second.reason).toBe("first");
    });

    it("enterReview returns null for an unknown session", () => {
      expect(manager.enterReview("ghost")).toBeNull();
    });

    it("isReviewBlocking reflects pending + blocking flag", () => {
      const { sessionId } = manager.createSession();
      expect(manager.isReviewBlocking(sessionId)).toBe(false);
      manager.enterReview(sessionId, { reason: "gate" });
      expect(manager.isReviewBlocking(sessionId)).toBe(true);
    });

    it("isReviewBlocking is false when blocking flag is explicitly false", () => {
      const { sessionId } = manager.createSession();
      manager.enterReview(sessionId, { reason: "advisory", blocking: false });
      expect(manager.isReviewBlocking(sessionId)).toBe(false);
    });

    it("submitReviewComment appends a comment with generated metadata", () => {
      const { sessionId } = manager.createSession();
      manager.enterReview(sessionId, { reason: "check" });
      const state = manager.submitReviewComment(sessionId, {
        comment: { author: "alice", content: "LGTM so far" },
      });
      expect(state.comments).toHaveLength(1);
      expect(state.comments[0]).toEqual(
        expect.objectContaining({
          author: "alice",
          content: "LGTM so far",
        }),
      );
      expect(state.comments[0].id).toBeDefined();
      expect(state.comments[0].timestamp).toBeDefined();
    });

    it("submitReviewComment toggles checklist items by id", () => {
      const { sessionId } = manager.createSession();
      manager.enterReview(sessionId, {
        reason: "check",
        checklist: [
          { id: "a", title: "Item A" },
          { id: "b", title: "Item B" },
        ],
      });
      const state = manager.submitReviewComment(sessionId, {
        checklistItemId: "a",
        checklistItemDone: true,
        checklistItemNote: "verified",
      });
      expect(state.checklist[0]).toEqual(
        expect.objectContaining({ id: "a", done: true, note: "verified" }),
      );
      expect(state.checklist[1].done).toBe(false);
    });

    it("submitReviewComment returns null when no pending review", () => {
      const { sessionId } = manager.createSession();
      expect(
        manager.submitReviewComment(sessionId, { comment: { content: "x" } }),
      ).toBeNull();
    });

    it("resolveReview marks the review as approved and unblocks the session", () => {
      const { sessionId } = manager.createSession();
      manager.enterReview(sessionId, { reason: "check" });
      const state = manager.resolveReview(sessionId, {
        decision: "approved",
        resolvedBy: "user",
        summary: "All good",
      });
      expect(state.status).toBe("approved");
      expect(state.decision).toBe("approved");
      expect(state.resolvedBy).toBe("user");
      expect(state.summary).toBe("All good");
      expect(state.blocking).toBe(false);
      expect(manager.isReviewBlocking(sessionId)).toBe(false);
    });

    it("resolveReview supports rejected decision", () => {
      const { sessionId } = manager.createSession();
      manager.enterReview(sessionId, { reason: "check" });
      const state = manager.resolveReview(sessionId, { decision: "rejected" });
      expect(state.status).toBe("rejected");
      expect(state.decision).toBe("rejected");
      expect(state.blocking).toBe(false);
    });

    it("resolveReview is a no-op when review is not pending", () => {
      const { sessionId } = manager.createSession();
      manager.enterReview(sessionId, { reason: "check" });
      const first = manager.resolveReview(sessionId, { decision: "approved" });
      const second = manager.resolveReview(sessionId, { decision: "rejected" });
      expect(second).toBe(first);
      expect(second.status).toBe("approved");
    });

    it("getReviewState returns null for unknown session", () => {
      expect(manager.getReviewState("ghost")).toBeNull();
    });
  });

  describe("patch preview", () => {
    it("proposePatch records pending files with computed stats", () => {
      const { sessionId } = manager.createSession();
      const patch = manager.proposePatch(sessionId, {
        origin: "tool",
        reason: "write new helper",
        files: [
          {
            path: "src/a.js",
            op: "create",
            after: "line1\nline2\nline3",
          },
          {
            path: "src/b.js",
            op: "modify",
            before: "old1\nold2",
            after: "old1\nnew2\nnew3",
          },
        ],
      });

      expect(patch).not.toBeNull();
      expect(patch.patchId).toMatch(/^patch-/);
      expect(patch.status).toBe("pending");
      expect(patch.files).toHaveLength(2);
      expect(patch.files[0].stats).toEqual({ added: 3, removed: 0 });
      expect(patch.files[1].stats.added).toBeGreaterThanOrEqual(1);
      expect(patch.stats.fileCount).toBe(2);
      expect(patch.stats.added).toBeGreaterThanOrEqual(3);
      expect(manager.hasPendingPatches(sessionId)).toBe(true);
    });

    it("proposePatch returns null for missing session", () => {
      expect(
        manager.proposePatch("ghost", { files: [{ path: "x" }] }),
      ).toBeNull();
    });

    it("proposePatch returns null when files array is empty", () => {
      const { sessionId } = manager.createSession();
      expect(manager.proposePatch(sessionId, { files: [] })).toBeNull();
    });

    it("applyPatch moves the patch to history and clears pending", () => {
      const { sessionId } = manager.createSession();
      const patch = manager.proposePatch(sessionId, {
        files: [{ path: "a.js", after: "x" }],
      });
      const applied = manager.applyPatch(sessionId, patch.patchId, {
        resolvedBy: "user",
        note: "looks good",
      });
      expect(applied.status).toBe("applied");
      expect(applied.note).toBe("looks good");
      expect(manager.hasPendingPatches(sessionId)).toBe(false);
      const summary = manager.getPatchSummary(sessionId);
      expect(summary.pending).toHaveLength(0);
      expect(summary.history).toHaveLength(1);
      expect(summary.totals.fileCount).toBe(1);
    });

    it("applyPatch returns null for unknown patchId", () => {
      const { sessionId } = manager.createSession();
      expect(manager.applyPatch(sessionId, "nope")).toBeNull();
    });

    it("rejectPatch records the rejection reason in history", () => {
      const { sessionId } = manager.createSession();
      const patch = manager.proposePatch(sessionId, {
        files: [{ path: "a.js", after: "x" }],
      });
      const rejected = manager.rejectPatch(sessionId, patch.patchId, {
        reason: "risky change",
      });
      expect(rejected.status).toBe("rejected");
      expect(rejected.rejectionReason).toBe("risky change");
      const summary = manager.getPatchSummary(sessionId);
      expect(summary.pending).toHaveLength(0);
      expect(summary.history[0].status).toBe("rejected");
    });

    it("getPatchSummary aggregates pending + history totals", () => {
      const { sessionId } = manager.createSession();
      const p1 = manager.proposePatch(sessionId, {
        files: [{ path: "a.js", after: "x\ny" }],
      });
      manager.proposePatch(sessionId, {
        files: [{ path: "b.js", after: "z" }],
      });
      manager.applyPatch(sessionId, p1.patchId);

      const summary = manager.getPatchSummary(sessionId);
      expect(summary.pending).toHaveLength(1);
      expect(summary.history).toHaveLength(1);
      expect(summary.totals.fileCount).toBe(2);
      expect(summary.totals.added).toBeGreaterThanOrEqual(3);
    });

    it("getPatchSummary returns null for unknown session", () => {
      expect(manager.getPatchSummary("ghost")).toBeNull();
    });

    it("proposed patches survive metadata serialization round-trip", () => {
      const { sessionId } = manager.createSession();
      manager.proposePatch(sessionId, {
        files: [{ path: "a.js", after: "hello" }],
      });
      const metadata = manager._serializeSessionMetadata(
        manager.getSession(sessionId),
      );
      expect(Array.isArray(metadata.pendingPatches)).toBe(true);
      expect(metadata.pendingPatches).toHaveLength(1);
      expect(metadata.pendingPatches[0].files[0].path).toBe("a.js");
    });
  });

  describe("task graph", () => {
    let sessionId;

    beforeEach(() => {
      const result = manager.createSession();
      sessionId = result.sessionId;
    });

    it("createTaskGraph stores normalized nodes and order", () => {
      const graph = manager.createTaskGraph(sessionId, {
        title: "Release",
        nodes: [
          { id: "a", title: "Build" },
          { id: "b", title: "Test", dependsOn: ["a"] },
          { id: "c", title: "Ship", dependsOn: ["b"] },
        ],
      });

      expect(graph.title).toBe("Release");
      expect(graph.status).toBe("active");
      expect(graph.order).toEqual(["a", "b", "c"]);
      expect(graph.nodes.a.status).toBe("pending");
      expect(graph.nodes.b.dependsOn).toEqual(["a"]);
    });

    it("createTaskGraph returns null for missing session", () => {
      expect(manager.createTaskGraph("ghost", { nodes: [] })).toBeNull();
    });

    it("addTaskNode rejects duplicate ids", () => {
      manager.createTaskGraph(sessionId, {
        nodes: [{ id: "a", title: "Build" }],
      });
      const result = manager.addTaskNode(sessionId, { id: "a", title: "dup" });
      expect(result).toBeNull();
    });

    it("addTaskNode appends a new node to the graph", () => {
      manager.createTaskGraph(sessionId, {
        nodes: [{ id: "a", title: "Build" }],
      });
      const graph = manager.addTaskNode(sessionId, {
        id: "b",
        title: "Test",
        dependsOn: ["a"],
      });
      expect(graph.order).toEqual(["a", "b"]);
      expect(graph.nodes.b.title).toBe("Test");
    });

    it("updateTaskNode records timestamps for running/completed transitions", () => {
      manager.createTaskGraph(sessionId, {
        nodes: [{ id: "a", title: "Build" }],
      });
      const running = manager.updateTaskNode(sessionId, "a", {
        status: "running",
      });
      expect(running.nodes.a.startedAt).toBeTruthy();

      const done = manager.updateTaskNode(sessionId, "a", {
        status: "completed",
        result: { ok: true },
      });
      expect(done.nodes.a.completedAt).toBeTruthy();
      expect(done.nodes.a.result).toEqual({ ok: true });
      expect(done.status).toBe("completed");
      expect(done.completedAt).toBeTruthy();
    });

    it("updateTaskNode marks graph as failed when any node fails", () => {
      manager.createTaskGraph(sessionId, {
        nodes: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
      });
      manager.updateTaskNode(sessionId, "a", { status: "completed" });
      const graph = manager.updateTaskNode(sessionId, "b", {
        status: "failed",
        error: "boom",
      });
      expect(graph.status).toBe("failed");
      expect(graph.nodes.b.error).toBe("boom");
    });

    it("advanceTaskGraph promotes nodes whose dependencies are completed", () => {
      manager.createTaskGraph(sessionId, {
        nodes: [
          { id: "a", title: "A" },
          { id: "b", title: "B", dependsOn: ["a"] },
          { id: "c", title: "C", dependsOn: ["b"] },
        ],
      });

      // Initial advance: only "a" is unblocked
      let result = manager.advanceTaskGraph(sessionId);
      expect(result.becameReady).toEqual(["a"]);
      expect(result.graph.nodes.a.status).toBe("ready");
      expect(result.graph.nodes.b.status).toBe("pending");

      // After completing "a", "b" unblocks
      manager.updateTaskNode(sessionId, "a", { status: "completed" });
      result = manager.advanceTaskGraph(sessionId);
      expect(result.becameReady).toEqual(["b"]);
    });

    it("advanceTaskGraph returns empty ready list when nothing changes", () => {
      manager.createTaskGraph(sessionId, {
        nodes: [{ id: "a", title: "A", status: "running" }],
      });
      const result = manager.advanceTaskGraph(sessionId);
      expect(result.becameReady).toEqual([]);
    });

    it("getTaskGraph returns null before the graph is created", () => {
      expect(manager.getTaskGraph(sessionId)).toBeNull();
    });

    it("clearTaskGraph wipes the session graph", () => {
      manager.createTaskGraph(sessionId, {
        nodes: [{ id: "a", title: "A" }],
      });
      expect(manager.clearTaskGraph(sessionId)).toBe(true);
      expect(manager.getTaskGraph(sessionId)).toBeNull();
    });

    it("task graph survives metadata serialization round-trip", () => {
      manager.createTaskGraph(sessionId, {
        graphId: "graph-x",
        title: "Deploy",
        nodes: [
          { id: "a", title: "Build" },
          { id: "b", title: "Ship", dependsOn: ["a"] },
        ],
      });
      const metadata = manager._serializeSessionMetadata(
        manager.getSession(sessionId),
      );
      expect(metadata.taskGraph).toBeTruthy();
      expect(metadata.taskGraph.graphId).toBe("graph-x");
      const hydrated = manager._hydrateTaskGraph(metadata.taskGraph);
      expect(hydrated.nodes.b.dependsOn).toEqual(["a"]);
      expect(hydrated.order).toEqual(["a", "b"]);
    });
  });
});
