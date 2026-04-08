import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";

vi.mock("crypto", () => ({
  randomUUID: () => "event-id",
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const {
  CODING_AGENT_EVENT_CHANNEL,
  CodingAgentEventType,
  defaultSequenceTracker,
} = require("../coding-agent-events.js");
const {
  CodingAgentSessionService,
} = require("../coding-agent-session-service.js");

class MockBridge extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.host = "127.0.0.1";
    this.port = 4317;
    this.sentMessages = [];
    this.updatedPolicies = [];
  }

  async ensureReady() {
    return { host: this.host, port: this.port };
  }

  async createSession(options = {}) {
    const message = {
      id: "create-request",
      type: "session-created",
      sessionId: "session-1",
      record: {
        provider: options.provider || "openai",
        model: options.model || "gpt-4o-mini",
        projectRoot:
          options.worktreeIsolation === true
            ? "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1"
            : "C:\\code\\chainlesschain",
        baseProjectRoot: "C:\\code\\chainlesschain",
        worktreeIsolation: options.worktreeIsolation === true,
        worktree:
          options.worktreeIsolation === true
            ? {
                branch: "coding-agent/session-1",
                path: "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
                meta: { requested: true },
              }
            : null,
      },
    };
    this.emit("message", message);
    return message;
  }

  async resumeSession(sessionId) {
    const message = {
      id: "resume-request",
      type: "session-resumed",
      sessionId,
      history: [{ role: "assistant", content: "restored" }],
      record: {
        provider: "openai",
        model: "gpt-4o-mini",
      },
    };
    this.emit("message", message);
    return message;
  }

  async listSessions() {
    return {
      sessions: [{ id: "session-1", provider: "openai", model: "gpt-4o-mini" }],
    };
  }

  async listBackgroundTasks() {
    return {
      tasks: [
        {
          id: "task-1",
          status: "running",
          description: "Run verification",
        },
        {
          id: "task-2",
          status: "completed",
          description: "Build summary",
        },
      ],
    };
  }

  async getBackgroundTask(taskId) {
    return {
      task: {
        id: taskId,
        status: "running",
        description: "Run verification",
      },
    };
  }

  async getBackgroundTaskHistory(taskId) {
    return {
      taskId,
      history: {
        items: [{ event: "started" }, { event: "heartbeat" }],
        total: 2,
      },
    };
  }

  async stopBackgroundTask(taskId) {
    return {
      type: "tasks-stopped",
      taskId,
    };
  }

  async closeSession(sessionId) {
    return { id: "close-request", success: true, sessionId };
  }

  async interruptSession(sessionId) {
    const message = {
      id: "interrupt-request",
      type: "session.interrupted",
      sessionId,
      interrupted: true,
      wasProcessing: true,
      interruptedRequestId: "session-message-1",
    };
    this.emit("message", message);
    return message;
  }

  async listWorktrees() {
    return {
      id: "worktree-list-request",
      worktrees: [
        {
          path: "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
          branch: "coding-agent/session-1",
        },
      ],
    };
  }

  async diffWorktree(branch, options = {}) {
    return {
      id: "worktree-diff-request",
      filePath: options.filePath || null,
      files: [
        { path: options.filePath || "README.md", insertions: 2, deletions: 1 },
      ],
      summary: { filesChanged: 1, insertions: 2, deletions: 1 },
      diff: `diff --git a/${options.filePath || "README.md"} b/${options.filePath || "README.md"}\n+updated\n`,
      record: {
        branch,
        path: "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
        baseBranch: options.baseBranch || "HEAD",
        summary: { filesChanged: 1, insertions: 2, deletions: 1 },
      },
    };
  }

  async mergeWorktree(branch, options = {}) {
    return {
      id: "worktree-merge-request",
      success: true,
      strategy: options.strategy || "merge",
      message: "Merged successfully",
      summary: { conflictedFiles: 0 },
      conflicts: [],
      suggestions: [],
      previewEntrypoints: [],
      record: {
        branch,
        path: "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
        summary: { conflictedFiles: 0 },
        meta: {
          strategy: options.strategy || "merge",
          success: true,
        },
      },
    };
  }

  async previewWorktreeMerge(branch, options = {}) {
    return {
      id: "worktree-merge-preview-request",
      success: false,
      previewOnly: true,
      strategy: options.strategy || "merge",
      baseBranch: options.baseBranch || "main",
      message: "Merge preview detected conflicts - review before merging",
      summary: {
        conflictedFiles: 1,
        bothModified: 1,
        bothAdded: 0,
        deleteModify: 0,
      },
      conflicts: [
        {
          path: "README.md",
          type: "both_modified",
          suggestion:
            "Review both sides in README.md and resolve conflict markers manually.",
          automationCandidates: [
            {
              id: "accept-current",
              label: "Keep current branch",
              executable: true,
            },
          ],
          diffPreview: {
            route: {
              type: "worktree-diff",
              branch,
              filePath: "README.md",
            },
          },
        },
      ],
      suggestions: ["Resolve 1 conflicted file(s), then rerun the merge."],
      previewEntrypoints: [
        {
          type: "worktree-diff",
          branch,
          filePath: "README.md",
        },
      ],
      record: {
        branch,
        path: "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
        baseBranch: options.baseBranch || "main",
        hasChanges: true,
        summary: {
          conflictedFiles: 1,
          bothModified: 1,
          bothAdded: 0,
          deleteModify: 0,
        },
        conflicts: [
          {
            path: "README.md",
            type: "both_modified",
          },
        ],
        previewEntrypoints: [
          {
            type: "worktree-diff",
            branch,
            filePath: "README.md",
          },
        ],
        meta: {
          strategy: options.strategy || "merge",
          success: false,
          previewOnly: true,
        },
      },
    };
  }

  async applyWorktreeAutomationCandidate(branch, options = {}) {
    return {
      id: "worktree-automation-request",
      branch,
      baseBranch: options.baseBranch || "HEAD",
      filePath: options.filePath,
      candidateId: options.candidateId,
      message: `Applied ${options.candidateId} to ${options.filePath}`,
      files: [],
      summary: { filesChanged: 0, insertions: 0, deletions: 0 },
      diff: "",
      record: {
        branch,
        path: "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
        baseBranch: options.baseBranch || "HEAD",
        hasChanges: false,
        summary: { filesChanged: 0, insertions: 0, deletions: 0 },
        conflicts: [],
        previewEntrypoints: [],
        meta: {
          candidateId: options.candidateId,
          filePath: options.filePath,
          success: true,
        },
      },
    };
  }

  async updateSessionPolicy(sessionId, hostManagedToolPolicy) {
    this.updatedPolicies.push({ sessionId, hostManagedToolPolicy });
    return {
      id: "policy-request",
      type: "session-policy-updated",
      success: true,
      sessionId,
    };
  }

  send(message) {
    this.sentMessages.push(message);
  }

  async shutdown() {
    return undefined;
  }
}

describe("CodingAgentSessionService", () => {
  let bridge;
  let mainWindow;
  let service;

  beforeEach(() => {
    // Reset the process-global sequence tracker so each test sees fresh
    // counters — until the SessionService gets its own per-instance tracker.
    defaultSequenceTracker.reset();
    bridge = new MockBridge();
    mainWindow = {
      webContents: {
        send: vi.fn(),
      },
      isDestroyed: vi.fn(() => false),
    };
    service = new CodingAgentSessionService({
      bridge,
      mainWindow,
      repoRoot: "C:\\code\\chainlesschain",
      projectRoot: "C:\\code\\chainlesschain",
    });
  });

  it("creates a session and exposes normalized session state", async () => {
    const result = await service.createSession({
      provider: "openai",
      model: "gpt-4o-mini",
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe("session-1");

    const state = service.getSessionState("session-1");
    expect(state.success).toBe(true);
    expect(state.session?.status).toBe("ready");
    expect(state.session?.planModeState).toBe("inactive");
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      CODING_AGENT_EVENT_CHANNEL,
      expect.objectContaining({
        type: CodingAgentEventType.SESSION_CREATED,
        sessionId: "session-1",
      }),
    );
    expect(bridge.updatedPolicies.at(-1)).toMatchObject({
      sessionId: "session-1",
      hostManagedToolPolicy: expect.objectContaining({
        tools: expect.objectContaining({
          read_file: expect.objectContaining({ allowed: true }),
          write_file: expect.objectContaining({ allowed: false }),
          run_shell: expect.objectContaining({ allowed: false }),
        }),
      }),
    });
  });

  it("emits events using the normalized coding-agent event envelope", async () => {
    await service.createSession({
      provider: "openai",
      model: "gpt-4o-mini",
    });

    const event = service.getSessionEvents("session-1").events.at(0);
    expect(event).toMatchObject({
      version: "1.0",
      source: "desktop-main",
      sequence: 1,
      sessionId: "session-1",
      meta: expect.objectContaining({
        __prepared: true,
      }),
    });
    expect(event.eventId).toEqual(expect.any(String));
    expect(event.id).toBe(event.eventId);
  });

  it("preserves worktree session metadata when isolation is requested", async () => {
    const result = await service.createSession({
      provider: "openai",
      model: "gpt-4o-mini",
      worktreeIsolation: true,
    });

    expect(result.success).toBe(true);
    expect(
      bridge.updatedPolicies.at(-1)?.hostManagedToolPolicy?.sessionId,
    ).toBe("session-1");

    const state = service.getSessionState("session-1");
    expect(state.success).toBe(true);
    expect(state.session).toMatchObject({
      projectRoot:
        "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
      baseProjectRoot: "C:\\code\\chainlesschain",
      worktreeIsolation: true,
      worktree: {
        branch: "coding-agent/session-1",
        path: "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
      },
    });
  });

  it("lists worktrees and emits a worktree-list event", async () => {
    const result = await service.listWorktrees();

    expect(result).toEqual({
      success: true,
      worktrees: [
        {
          path: "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
          branch: "coding-agent/session-1",
        },
      ],
    });
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      CODING_AGENT_EVENT_CHANNEL,
      expect.objectContaining({
        type: CodingAgentEventType.WORKTREE_LIST,
      }),
    );
  });

  it("exposes background task data through the harness service methods", async () => {
    const listResult = await service.listBackgroundTasks();
    const detailResult = await service.getBackgroundTask("task-1");
    const historyResult = await service.getBackgroundTaskHistory("task-1");
    const stopResult = await service.stopBackgroundTask("task-1");

    expect(listResult).toMatchObject({
      success: true,
      tasks: [
        expect.objectContaining({ id: "task-1", status: "running" }),
        expect.objectContaining({ id: "task-2", status: "completed" }),
      ],
    });
    expect(detailResult).toMatchObject({
      success: true,
      task: expect.objectContaining({ id: "task-1" }),
    });
    expect(historyResult).toMatchObject({
      success: true,
      taskId: "task-1",
      history: expect.objectContaining({
        items: expect.any(Array),
        total: 2,
      }),
    });
    expect(stopResult).toEqual({
      success: true,
      taskId: "task-1",
    });
  });

  it("aggregates harness status from sessions, worktrees, and background tasks", async () => {
    await service.createSession({
      worktreeIsolation: true,
    });
    bridge.emit("message", {
      id: "worktree-dirty",
      type: "worktree-diff",
      sessionId: "session-1",
      record: {
        branch: "coding-agent/session-1",
        path: "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
        hasChanges: true,
      },
    });

    const result = await service.getHarnessStatus();

    expect(result).toEqual({
      success: true,
      harness: {
        sessions: {
          total: 1,
          running: 0,
          waitingApproval: 0,
          active: 1,
        },
        worktrees: {
          tracked: 1,
          isolated: 1,
          dirty: 1,
        },
        backgroundTasks: {
          total: 2,
          pending: 0,
          running: 1,
          completed: 1,
          failed: 0,
          timeout: 0,
        },
      },
    });
  });

  it("tracks plan mode transitions across enter, show, and approve", async () => {
    await service.createSession();

    const enterResult = await service.enterPlanMode("session-1");
    expect(enterResult.success).toBe(true);
    expect(bridge.sentMessages.at(-1)).toMatchObject({
      id: enterResult.requestId,
      type: "slash-command",
      sessionId: "session-1",
      command: "/plan",
    });

    bridge.emit("message", {
      id: enterResult.requestId,
      type: "command-response",
      sessionId: "session-1",
      command: "/plan",
      result: { state: "analyzing" },
    });

    expect(service.getSessionState("session-1").session?.planModeState).toBe(
      "analyzing",
    );

    const showResult = await service.showPlan("session-1");
    expect(bridge.sentMessages.at(-1)).toMatchObject({
      id: showResult.requestId,
      type: "slash-command",
      sessionId: "session-1",
      command: "/plan show",
    });

    bridge.emit("message", {
      id: showResult.requestId,
      type: "plan-ready",
      sessionId: "session-1",
      summary: "1. Edit the target file\n2. Run the related test",
      items: [
        { id: "item-1", title: "Edit file", tool: "edit_file" },
        { id: "item-2", title: "Run test", tool: "run_shell" },
      ],
    });

    let state = service.getSessionState("session-1");
    expect(state.session?.status).toBe("waiting_approval");
    expect(state.session?.planModeState).toBe("plan_ready");
    expect(state.session?.lastPlanSummary).toContain("Edit the target file");
    expect(state.session?.requiresHighRiskConfirmation).toBe(true);
    expect(state.session?.highRiskConfirmationGranted).toBe(false);
    expect(state.session?.highRiskToolNames).toEqual(["run_shell"]);

    // After unifying the event protocol, plan/approval events use the
    // canonical dot-case names from CODING_AGENT_EVENT_TYPES instead of
    // the legacy kebab-case wire format. See coding-agent-events.cjs.
    const planEvents = service
      .getSessionEvents("session-1")
      .events.filter((event) =>
        [
          "plan.approval_required",
          "plan.updated",
          "approval.requested",
          "approval.high-risk.requested",
        ].includes(event.type),
      );
    expect(planEvents.map((event) => event.type)).toEqual([
      "plan.approval_required",
      "plan.updated",
      "approval.requested",
      "approval.high-risk.requested",
    ]);

    const approveResult = await service.approvePlan("session-1");
    expect(bridge.sentMessages.at(-1)).toMatchObject({
      id: approveResult.requestId,
      type: "slash-command",
      sessionId: "session-1",
      command: "/plan approve",
    });

    bridge.emit("message", {
      id: approveResult.requestId,
      type: "command-response",
      sessionId: "session-1",
      command: "/plan approve",
      result: { state: "approved" },
    });

    state = service.getSessionState("session-1");
    expect(state.session?.status).toBe("ready");
    expect(state.session?.planModeState).toBe("approved");
  });

  it("marks a high-risk plan as confirmed after explicit approval", async () => {
    await service.createSession();

    bridge.emit("message", {
      id: "plan-1",
      type: "plan-ready",
      sessionId: "session-1",
      summary: "Run a verification command",
      items: [{ id: "item-1", title: "Run test", tool: "run_shell" }],
    });

    const result = await service.confirmHighRiskExecution("session-1");
    expect(result).toMatchObject({
      success: true,
      sessionId: "session-1",
      highRiskConfirmationGranted: true,
      tools: ["run_shell"],
    });

    const state = service.getSessionState("session-1");
    expect(state.session?.requiresHighRiskConfirmation).toBe(true);
    expect(state.session?.highRiskConfirmationGranted).toBe(true);

    expect(
      service
        .getSessionEvents("session-1")
        .events.some(
          (event) => event.type === CodingAgentEventType.HIGH_RISK_CONFIRMED,
        ),
    ).toBe(true);
    expect(bridge.updatedPolicies.at(-1)).toMatchObject({
      sessionId: "session-1",
      hostManagedToolPolicy: expect.objectContaining({
        tools: expect.objectContaining({
          run_shell: expect.objectContaining({ allowed: false }),
        }),
      }),
    });
  });

  it("accepts generic approval responses for high-risk confirmation", async () => {
    await service.createSession();

    bridge.emit("message", {
      id: "plan-1",
      type: "plan-ready",
      sessionId: "session-1",
      summary: "Run a verification command",
      items: [{ id: "item-1", title: "Run test", tool: "run_shell" }],
    });

    const result = await service.respondApproval("session-1", {
      approvalType: "high-risk",
      decision: "granted",
    });

    expect(result).toMatchObject({
      success: true,
      sessionId: "session-1",
      approvalType: "high-risk",
      decision: "granted",
      highRiskConfirmationGranted: true,
    });
    expect(
      service
        .getSessionEvents("session-1")
        .events.some(
          (event) => event.type === CodingAgentEventType.APPROVAL_GRANTED,
        ),
    ).toBe(true);
  });

  it("blocks follow-up messages until high-risk execution is explicitly confirmed", async () => {
    await service.createSession();

    bridge.emit("message", {
      id: "plan-1",
      type: "plan-ready",
      sessionId: "session-1",
      summary: "Run a verification command",
      items: [{ id: "item-1", title: "Run test", tool: "run_shell" }],
    });

    await expect(
      service.sendMessage("session-1", "Continue with the approved plan"),
    ).rejects.toThrow(
      "High-risk confirmation required before continuing: run_shell",
    );

    expect(
      service
        .getSessionEvents("session-1")
        .events.filter(
          (event) =>
            event.type === CodingAgentEventType.HIGH_RISK_CONFIRMATION_REQUIRED,
        ).length,
    ).toBeGreaterThan(0);
  });

  it("surfaces blocked tool feedback and exposes tool policy in status", async () => {
    await service.createSession();

    bridge.emit("message", {
      id: "tool-result-1",
      type: "tool-result",
      sessionId: "session-1",
      result: {
        error:
          '[Plan Mode] Tool "write_file" is blocked during planning. It has been added to the plan. Use /plan approve to execute.',
      },
    });

    const events = service.getSessionEvents("session-1").events;
    expect(
      events.some((event) => event.type === CodingAgentEventType.TOOL_BLOCKED),
    ).toBe(true);

    const status = await service.getStatus();
    expect(status.tools).toHaveLength(7);
    expect(status.permissionPolicy).toMatchObject({
      planModeRules: {
        low: "allow",
        medium: "require_plan",
        high: "require_plan_and_confirmation",
      },
    });
  });

  it("includes allowlisted managed tools in status and synced host policy", async () => {
    const managedService = new CodingAgentSessionService({
      bridge,
      mainWindow,
      repoRoot: "C:\\code\\chainlesschain",
      projectRoot: "C:\\code\\chainlesschain",
      toolManager: {
        getAllTools: vi.fn().mockResolvedValue([
          {
            id: "tool-2",
            name: "info_searcher",
            description: "Managed search tool",
            parameters_schema: JSON.stringify({
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            }),
            risk_level: 1,
            enabled: 1,
          },
        ]),
        getToolByName: vi.fn().mockResolvedValue(null),
      },
    });

    await managedService.createSession();
    const status = await managedService.getStatus();

    expect(status.tools).toHaveLength(8);
    expect(
      status.tools.find((tool) => tool.name === "info_searcher"),
    ).toMatchObject({
      source: "desktop-tool-manager:tool-2",
      riskLevel: "low",
      isReadOnly: true,
    });
    expect(status.toolSummary.toolsBySource).toMatchObject({
      "desktop-tool-manager:tool-2": ["info_searcher"],
    });
    expect(status.permissionPolicy.toolsBySource).toMatchObject({
      "desktop-tool-manager:tool-2": ["info_searcher"],
    });
    expect(bridge.updatedPolicies.at(-1)).toMatchObject({
      sessionId: "session-1",
      hostManagedToolPolicy: expect.objectContaining({
        toolDefinitions: expect.arrayContaining([
          expect.objectContaining({
            function: expect.objectContaining({
              name: "info_searcher",
            }),
          }),
        ]),
        tools: expect.objectContaining({
          info_searcher: expect.objectContaining({
            allowed: true,
            riskLevel: "low",
            requiresPlanApproval: false,
            requiresConfirmation: false,
          }),
        }),
      }),
    });
  });

  it("includes allowlisted MCP tools in status and synced host policy", async () => {
    const mcpService = new CodingAgentSessionService({
      bridge,
      mainWindow,
      repoRoot: "C:\\code\\chainlesschain",
      projectRoot: "C:\\code\\chainlesschain",
      mcpManager: {
        servers: new Map([["weather", { state: "connected" }]]),
        listTools: vi.fn().mockResolvedValue([
          {
            name: "get_forecast",
            description: "Get the local weather forecast",
            inputSchema: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
            },
          },
        ]),
      },
    });

    await mcpService.createSession();
    const status = await mcpService.getStatus();

    expect(
      status.tools.find((tool) => tool.name === "mcp_weather_get_forecast"),
    ).toMatchObject({
      source: "mcp:weather",
      riskLevel: "low",
      isReadOnly: true,
    });
    expect(status.toolSummary.toolsBySource).toMatchObject({
      "mcp:weather": ["mcp_weather_get_forecast"],
    });
    expect(status.permissionPolicy.toolsBySource).toMatchObject({
      "mcp:weather": ["mcp_weather_get_forecast"],
    });
    expect(bridge.updatedPolicies.at(-1)).toMatchObject({
      sessionId: "session-1",
      hostManagedToolPolicy: expect.objectContaining({
        toolDefinitions: expect.arrayContaining([
          expect.objectContaining({
            function: expect.objectContaining({
              name: "mcp_weather_get_forecast",
            }),
          }),
        ]),
        tools: expect.objectContaining({
          mcp_weather_get_forecast: expect.objectContaining({
            allowed: true,
            riskLevel: "low",
            requiresPlanApproval: false,
            requiresConfirmation: false,
          }),
        }),
      }),
    });
  });

  it("can opt in to trusted high-risk MCP servers and sync them into host policy", async () => {
    const mcpService = new CodingAgentSessionService({
      bridge,
      mainWindow,
      repoRoot: "C:\\code\\chainlesschain",
      projectRoot: "C:\\code\\chainlesschain",
      allowedMcpServerNames: ["github"],
      allowHighRiskMcpServers: true,
      mcpManager: {
        servers: new Map([["github", { state: "connected" }]]),
        listTools: vi.fn().mockResolvedValue([
          {
            name: "create_issue",
            description: "Create a GitHub issue",
            inputSchema: {
              type: "object",
              properties: {
                title: { type: "string" },
              },
              required: ["title"],
            },
          },
        ]),
      },
    });

    await mcpService.createSession();
    const status = await mcpService.getStatus();

    expect(
      status.tools.find((tool) => tool.name === "mcp_github_create_issue"),
    ).toMatchObject({
      source: "mcp:github",
      riskLevel: "high",
      isReadOnly: false,
      mcpMetadata: expect.objectContaining({
        trusted: true,
        securityLevel: "high",
      }),
    });
    expect(bridge.updatedPolicies.at(-1)).toMatchObject({
      sessionId: "session-1",
      hostManagedToolPolicy: expect.objectContaining({
        tools: expect.objectContaining({
          mcp_github_create_issue: expect.objectContaining({
            riskLevel: "high",
            requiresPlanApproval: true,
            requiresConfirmation: false,
          }),
        }),
      }),
    });
  });

  it("re-syncs allowlisted MCP tools into host policy when a session is resumed", async () => {
    const resumeBridge = new MockBridge();
    const mcpService = new CodingAgentSessionService({
      bridge: resumeBridge,
      mainWindow,
      repoRoot: "C:\\code\\chainlesschain",
      projectRoot: "C:\\code\\chainlesschain",
      mcpManager: {
        servers: new Map([["weather", { state: "connected" }]]),
        listTools: vi.fn().mockResolvedValue([
          {
            name: "get_forecast",
            description: "Get the local weather forecast",
            inputSchema: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
            },
          },
        ]),
      },
    });

    await mcpService.resumeSession("session-1");

    const latestPolicy = resumeBridge.updatedPolicies.at(-1);
    expect(latestPolicy?.sessionId).toBe("session-1");
    expect(
      latestPolicy?.hostManagedToolPolicy?.toolDefinitions?.some(
        (definition) =>
          definition?.function?.name === "mcp_weather_get_forecast",
      ),
    ).toBe(true);
    expect(
      latestPolicy?.hostManagedToolPolicy?.tools?.mcp_weather_get_forecast,
    ).toMatchObject({
      allowed: true,
      riskLevel: "low",
      requiresPlanApproval: false,
    });
  });

  it("executes hosted tool calls from the CLI runtime and returns the result", async () => {
    const localBridge = new MockBridge();
    const hostedService = new CodingAgentSessionService({
      bridge: localBridge,
      mainWindow,
      repoRoot: "C:\\code\\chainlesschain",
      projectRoot: "C:\\code\\chainlesschain",
      mcpManager: {
        servers: new Map([["weather", { state: "connected" }]]),
        listTools: vi.fn().mockResolvedValue([
          {
            name: "get_forecast",
            description: "Get the local weather forecast",
            inputSchema: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
            },
          },
        ]),
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "Sunny" }],
          isError: false,
        }),
      },
    });

    await hostedService.createSession();

    localBridge.emit("message", {
      type: "host-tool-call",
      sessionId: "session-1",
      requestId: "host-tool-1",
      toolName: "mcp_weather_get_forecast",
      args: { city: "Shanghai" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(localBridge.sentMessages.at(-1)).toMatchObject({
      type: "host-tool-result",
      sessionId: "session-1",
      requestId: "host-tool-1",
      toolName: "mcp_weather_get_forecast",
      success: true,
      result: {
        content: [{ type: "text", text: "Sunny" }],
        isError: false,
        toolName: "mcp_weather_get_forecast",
      },
    });
  });

  it("loads the current session worktree diff from the CLI bridge", async () => {
    await service.createSession({
      worktreeIsolation: true,
    });

    const result = await service.getWorktreeDiff("session-1", {
      baseBranch: "main",
    });

    expect(result).toMatchObject({
      success: true,
      sessionId: "session-1",
      branch: "coding-agent/session-1",
      summary: { filesChanged: 1, insertions: 2, deletions: 1 },
      diff: expect.stringContaining("diff --git"),
      record: expect.objectContaining({
        branch: "coding-agent/session-1",
        baseBranch: "main",
      }),
    });
    expect(
      service.getSessionState("session-1").session?.worktree,
    ).toMatchObject({
      branch: "coding-agent/session-1",
      path: "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
      baseBranch: "main",
      summary: { filesChanged: 1, insertions: 2, deletions: 1 },
      hasChanges: true,
    });

    expect(
      service
        .getSessionEvents("session-1")
        .events.some(
          (event) => event.type === CodingAgentEventType.WORKTREE_DIFF,
        ),
    ).toBe(true);
  });

  it("supports file-scoped worktree diff requests", async () => {
    await service.createSession({
      worktreeIsolation: true,
    });

    const result = await service.getWorktreeDiff("session-1", {
      baseBranch: "main",
      filePath: "src/index.js",
    });

    expect(result).toMatchObject({
      success: true,
      sessionId: "session-1",
      branch: "coding-agent/session-1",
      filePath: "src/index.js",
      files: [{ path: "src/index.js", insertions: 2, deletions: 1 }],
      diff: expect.stringContaining("src/index.js"),
    });
  });

  it("merges the current session worktree branch through the CLI bridge", async () => {
    await service.createSession({
      worktreeIsolation: true,
    });

    const result = await service.mergeWorktree("session-1", {
      strategy: "squash",
      commitMessage: "Merge coding agent changes",
    });

    expect(result).toMatchObject({
      success: true,
      sessionId: "session-1",
      branch: "coding-agent/session-1",
      strategy: "squash",
      message: "Merged successfully",
      suggestions: [],
    });
    expect(
      service.getSessionState("session-1").session?.worktree,
    ).toMatchObject({
      branch: "coding-agent/session-1",
      path: "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
      hasChanges: false,
      meta: {
        strategy: "squash",
        success: true,
      },
    });

    expect(
      service
        .getSessionEvents("session-1")
        .events.some(
          (event) => event.type === CodingAgentEventType.WORKTREE_MERGED,
        ),
    ).toBe(true);
  });

  it("previews the current session worktree merge through the CLI bridge", async () => {
    await service.createSession({
      worktreeIsolation: true,
    });

    const result = await service.previewWorktreeMerge("session-1", {
      baseBranch: "main",
    });

    expect(result).toMatchObject({
      success: false,
      previewOnly: true,
      sessionId: "session-1",
      branch: "coding-agent/session-1",
      baseBranch: "main",
      summary: {
        conflictedFiles: 1,
        bothModified: 1,
        bothAdded: 0,
        deleteModify: 0,
      },
      conflicts: [{ path: "README.md", type: "both_modified" }],
    });
    expect(
      service.getSessionState("session-1").session?.worktree,
    ).toMatchObject({
      branch: "coding-agent/session-1",
      path: "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
      baseBranch: "main",
      conflicts: [{ path: "README.md", type: "both_modified" }],
      previewEntrypoints: [
        {
          type: "worktree-diff",
          branch: "coding-agent/session-1",
          filePath: "README.md",
        },
      ],
      meta: {
        strategy: "merge",
        success: false,
        previewOnly: true,
      },
    });

    expect(
      service
        .getSessionEvents("session-1")
        .events.some(
          (event) => event.type === CodingAgentEventType.WORKTREE_MERGE_PREVIEW,
        ),
    ).toBe(true);
  });

  it("applies a safe worktree automation candidate through the CLI bridge", async () => {
    await service.createSession({
      worktreeIsolation: true,
    });

    const result = await service.applyWorktreeAutomationCandidate("session-1", {
      baseBranch: "main",
      filePath: "README.md",
      candidateId: "accept-current",
      conflictType: "both_modified",
    });

    expect(result).toMatchObject({
      success: true,
      sessionId: "session-1",
      branch: "coding-agent/session-1",
      baseBranch: "main",
      filePath: "README.md",
      candidateId: "accept-current",
      summary: { filesChanged: 0, insertions: 0, deletions: 0 },
    });
    expect(
      service.getSessionState("session-1").session?.worktree,
    ).toMatchObject({
      branch: "coding-agent/session-1",
      path: "C:\\code\\chainlesschain\\.worktrees\\coding-agent-session-1",
      baseBranch: "main",
      hasChanges: false,
      conflicts: [],
      previewEntrypoints: [],
      meta: {
        candidateId: "accept-current",
        filePath: "README.md",
        success: true,
      },
    });

    expect(
      service
        .getSessionEvents("session-1")
        .events.some(
          (event) =>
            event.type === CodingAgentEventType.WORKTREE_AUTOMATION_APPLIED,
        ),
    ).toBe(true);
  });

  it("recognizes host-policy tool blocks from CLI tool results", async () => {
    await service.createSession();

    bridge.emit("message", {
      id: "tool-result-2",
      type: "tool-result",
      sessionId: "session-1",
      tool: "run_shell",
      result: {
        error:
          '[Host Policy] Tool "run_shell" is blocked by desktop host policy. High-risk tools require an explicit second confirmation.',
      },
    });

    const blockedEvent = service
      .getSessionEvents("session-1")
      .events.find((event) => event.type === CodingAgentEventType.TOOL_BLOCKED);

    expect(blockedEvent?.payload).toMatchObject({
      toolName: "run_shell",
      source: "host-policy",
      decision: "require_plan",
    });
  });

  it("returns shallow copies from getSessionState/getSessionEvents so callers cannot mutate internal state", async () => {
    await service.createSession({ provider: "openai", model: "gpt-4o-mini" });
    await service.sendMessage("session-1", "Initial message");

    const state = service.getSessionState("session-1");
    expect(state.success).toBe(true);
    const initialHistoryLength = state.session.history.length;
    const initialPendingLength = state.session.pendingRequests.length;

    // Mutate the returned arrays — internal state must remain unchanged.
    state.session.history.push({ role: "assistant", content: "tampered" });
    state.session.pendingRequests.push("fake-request");
    state.session.lastPlanItems.push({ tool: "tampered_tool" });
    state.session.highRiskToolNames.push("tampered_tool");

    const refetched = service.getSessionState("session-1");
    expect(refetched.session.history).toHaveLength(initialHistoryLength);
    expect(refetched.session.pendingRequests).toHaveLength(
      initialPendingLength,
    );
    expect(refetched.session.lastPlanItems).toHaveLength(0);
    expect(refetched.session.highRiskToolNames).toHaveLength(0);

    const events = service.getSessionEvents("session-1");
    const initialEventCount = events.events.length;
    events.events.push({ type: "tampered" });
    const refetchedEvents = service.getSessionEvents("session-1");
    expect(refetchedEvents.events).toHaveLength(initialEventCount);
  });

  it("uses the resolved sessionId when bridge messages omit sessionId", async () => {
    await service.createSession({ provider: "openai", model: "gpt-4o-mini" });

    // Capture the requestId that sendMessage registers in requestSessionMap.
    const sent = await service.sendMessage("session-1", "Edit README");
    expect(sent.success).toBe(true);
    const { requestId } = sent;
    expect(service.requestSessionMap.get(requestId)).toBe("session-1");

    // The CLI sometimes echoes a response that carries only `id` (matching
    // the original request) but no `sessionId`. The host must still route the
    // event to session-1 via requestSessionMap and tag the normalized event
    // with sessionId="session-1".
    bridge.emit("message", {
      id: requestId,
      type: "response-complete",
      // sessionId intentionally omitted
      content: "Updated README content.",
    });

    const events = service.getSessionEvents("session-1").events;
    const completeEvent = events.find(
      (event) => event.type === CodingAgentEventType.RESPONSE_COMPLETE,
    );
    expect(completeEvent).toBeDefined();
    expect(completeEvent.sessionId).toBe("session-1");
    expect(completeEvent.requestId).toBe(requestId);
  });

  it("closes a session and emits a session-closed event", async () => {
    await service.createSession();
    const sent = await service.sendMessage("session-1", "Implement the change");
    expect(sent.success).toBe(true);

    const result = await service.closeSession("session-1");
    expect(result.success).toBe(true);

    const state = service.getSessionState("session-1");
    expect(state.session?.status).toBe("closed");
    expect(state.session?.planModeState).toBe("inactive");
    expect(state.session?.pendingRequests).toEqual([]);

    const events = service.getSessionEvents("session-1");
    expect(
      events.events?.some(
        (event) => event.type === CodingAgentEventType.SESSION_CLOSED,
      ),
    ).toBe(true);
  });

  it("interrupts a session without closing it and emits a session-interrupted event", async () => {
    await service.createSession();
    const sent = await service.sendMessage("session-1", "Implement the change");
    expect(sent.success).toBe(true);

    const result = await service.interruptSession("session-1");
    expect(result).toMatchObject({
      success: true,
      sessionId: "session-1",
      interrupted: true,
      wasProcessing: true,
    });

    const state = service.getSessionState("session-1");
    expect(state.session?.status).toBe("ready");
    expect(state.session?.pendingRequests).toEqual([]);

    const events = service.getSessionEvents("session-1");
    expect(
      events.events?.some(
        (event) => event.type === CodingAgentEventType.SESSION_INTERRUPTED,
      ),
    ).toBe(true);
  });
});
