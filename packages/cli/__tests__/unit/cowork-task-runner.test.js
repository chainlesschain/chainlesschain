import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock sub-agent-context before importing runner
vi.mock("../../src/lib/sub-agent-context.js", () => {
  const mockRun = vi.fn();
  const mockCreate = vi.fn(() => ({
    id: "sub-test-123456",
    status: "completed",
    run: mockRun,
  }));
  return {
    SubAgentContext: { create: mockCreate },
    _mockCreate: mockCreate,
    _mockRun: mockRun,
  };
});

// Mock debate-review-cli module
vi.mock("../../src/lib/cowork/debate-review-cli.js", () => {
  const mockStartDebate = vi.fn();
  return {
    startDebate: mockStartDebate,
    _mockStartDebate: mockStartDebate,
  };
});

// Mock cowork-mcp-tools so the runner doesn't try to spawn real servers
vi.mock("../../src/lib/cowork-mcp-tools.js", () => {
  const mockCleanup = vi.fn(async () => {});
  const mockMount = vi.fn(async () => ({
    mcpClient: null,
    mounted: [],
    skipped: [],
    extraToolDefinitions: [],
    externalToolDescriptors: {},
    externalToolExecutors: {},
    cleanup: mockCleanup,
  }));
  return {
    mountTemplateMcpTools: mockMount,
    _mockMount: mockMount,
    _mockCleanup: mockCleanup,
  };
});

import {
  runCoworkTask,
  runCoworkTaskParallel,
  runCoworkDebate,
  prepareCoworkMcpRuntime,
  _deps,
} from "../../src/lib/cowork-task-runner.js";
import { _mockStartDebate } from "../../src/lib/cowork/debate-review-cli.js";
import {
  SubAgentContext,
  _mockCreate,
  _mockRun,
} from "../../src/lib/sub-agent-context.js";
import { _mockMount, _mockCleanup } from "../../src/lib/cowork-mcp-tools.js";
import { executeTool } from "../../src/runtime/agent-core.js";
import { summarizeMcpPayload } from "../../src/lib/mcp-call-ledger.js";
import {
  MCP_CALL_LEDGER_EVENT,
  MCP_CALL_RECOVERY_ADJUDICATION_EVENT,
  computeMcpRecoveryDigest,
  reduceMcpLedgerEvents,
} from "../../src/lib/mcp-call-ledger-store.js";

function rawHead(sequence) {
  return sequence.toString(16).padStart(64, "0");
}

function adjudicatedRecoveryEvents(count, sessionId) {
  const events = [];
  let head = null;
  for (let index = 0; index < count; index += 1) {
    const input = summarizeMcpPayload({ index });
    const nextHead = rawHead(index + 1);
    events.push({
      type: MCP_CALL_LEDGER_EVENT,
      timestamp: index + 1,
      prevHash: head,
      hash: nextHead,
      data: {
        schemaVersion: 1,
        phase: "started",
        record: {
          schemaVersion: 1,
          ledgerId: `mcp-deny-${index}`,
          sessionId,
          turnId: `turn-${index}`,
          toolName: "publish",
          serverName: "repo",
          inputDigest: input.sha256,
          inputBytes: input.bytes,
          effectContract: { effect: "write" },
          resourceScopes: [],
          networkScopes: [],
          prewritePolicy: "fail-closed",
          prewritePersistence: "pending",
          status: "started",
          startedAt: "2026-08-02T00:00:00.000Z",
          settledAt: null,
          outputSummary: null,
          outputDigest: null,
          errorSummary: null,
        },
      },
    });
    head = nextHead;
  }
  for (let index = 0; index < count; index += 1) {
    const recovery = reduceMcpLedgerEvents(events, {
      sessionId,
      verified: true,
    });
    const nextHead = rawHead(count + index + 1);
    events.push({
      type: MCP_CALL_RECOVERY_ADJUDICATION_EVENT,
      timestamp: count + index + 1,
      prevHash: head,
      hash: nextHead,
      data: {
        schemaVersion: 1,
        requestId: `request-${index}`,
        sessionId,
        ledgerId: `mcp-deny-${index}`,
        decision: "confirmed_applied",
        expectedHeadHash: head,
        expectedRecoveryDigest: computeMcpRecoveryDigest(recovery),
        authority: "local-cli-tty",
        confirmation: "typed-digest-host-stopped",
        reasonDigest: `sha256:${"f".repeat(64)}`,
      },
    });
    head = nextHead;
  }
  return events;
}

describe("cowork-task-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all files exist
    _deps.existsSync = vi.fn(() => true);
    _deps.mkdirSync = vi.fn();
    _deps.appendFileSync = vi.fn();
    _deps.appendSessionEvent = vi.fn(() => true);
    _deps.appendSessionEventIfHead = vi.fn(() => true);
    _deps.readVerifiedSessionEvents = vi.fn(() => []);
    _deps.randomUUID = vi.fn(() => "stable-cowork-session");
    _mockRun.mockResolvedValue({
      summary: "Task completed successfully",
      artifacts: [],
      tokenCount: 500,
      toolsUsed: ["run_shell", "read_file"],
      iterationCount: 3,
    });
    // Reset status on each call
    _mockCreate.mockImplementation((opts) => ({
      id: "sub-test-123456",
      status: "completed",
      run: _mockRun,
    }));
  });

  // ─── Basic execution ──────────────────────────────────────

  it("runs a task with a known template", async () => {
    const result = await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "把 report.docx 转成 PDF",
    });

    expect(result.taskId).toBe("sub-test-123456");
    expect(result.status).toBe("completed");
    expect(result.templateId).toBe("doc-convert");
    expect(result.templateName).toBe("文档格式转换");
    expect(result.result.summary).toBe("Task completed successfully");
  });

  it("runs free-mode when templateId is null", async () => {
    const result = await runCoworkTask({
      templateId: null,
      userMessage: "帮我整理桌面文件",
    });

    expect(result.templateId).toBe("free");
    expect(result.templateName).toBe("自由模式");
  });

  it("runs free-mode when templateId is omitted", async () => {
    const result = await runCoworkTask({
      userMessage: "查看系统信息",
    });

    expect(result.templateId).toBe("free");
  });

  // ─── SubAgentContext creation ─────────────────────────────

  it("creates SubAgentContext with correct role", async () => {
    await runCoworkTask({
      templateId: "media-process",
      userMessage: "压缩视频",
    });

    expect(_mockCreate).toHaveBeenCalledOnce();
    const opts = _mockCreate.mock.calls[0][0];
    expect(opts.role).toBe("cowork-media-process");
  });

  it("injects template systemPromptExtension into task", async () => {
    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "转换文档",
    });

    const opts = _mockCreate.mock.calls[0][0];
    expect(opts.task).toContain("pandoc");
    expect(opts.task).toContain("开源工具优先");
  });

  it("includes files in task when provided", async () => {
    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "转换这两个文件",
      files: ["/path/to/a.docx", "/path/to/b.md"],
    });

    const opts = _mockCreate.mock.calls[0][0];
    expect(opts.task).toContain("/path/to/a.docx");
    expect(opts.task).toContain("/path/to/b.md");
    expect(opts.task).toContain("用户提供的文件");
  });

  it("does not include dynamic file list when files is empty", async () => {
    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "转换文档",
      files: [],
    });

    const opts = _mockCreate.mock.calls[0][0];
    // The task should NOT contain the "## 用户提供的文件" dynamic section header
    expect(opts.task).not.toContain("## 用户提供的文件");
  });

  // ─── File path validation ─────────────────────────────────

  it("throws when a provided file does not exist", async () => {
    _deps.existsSync = vi.fn((f) => f !== "/missing.txt");

    await expect(
      runCoworkTask({
        templateId: "doc-convert",
        userMessage: "转换文档",
        files: ["/existing.txt", "/missing.txt"],
      }),
    ).rejects.toThrow("File(s) not found: /missing.txt");
    expect(_mockCreate).not.toHaveBeenCalled();
  });

  it("passes validation when all files exist", async () => {
    _deps.existsSync = vi.fn(() => true);

    const result = await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "转换文档",
      files: ["/a.docx", "/b.md"],
    });

    expect(result.status).toBe("completed");
    expect(_deps.existsSync).toHaveBeenCalledTimes(2);
  });

  it("skips validation when no files provided", async () => {
    _deps.existsSync = vi.fn();

    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "转换文档",
    });

    expect(_deps.existsSync).not.toHaveBeenCalled();
  });

  // ─── onProgress callback ──────────────────────────────────

  it("forwards onProgress callback to SubAgentContext", async () => {
    const onProgress = vi.fn();

    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "转换文档",
      onProgress,
    });

    const opts = _mockCreate.mock.calls[0][0];
    expect(opts.onProgress).toBe(onProgress);
  });

  it("does not pass onProgress when not provided", async () => {
    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "转换文档",
    });

    const opts = _mockCreate.mock.calls[0][0];
    expect(opts.onProgress).toBeNull();
  });

  it("passes cwd to SubAgentContext", async () => {
    await runCoworkTask({
      templateId: "code-helper",
      userMessage: "写脚本",
      cwd: "/my/project",
    });

    const opts = _mockCreate.mock.calls[0][0];
    expect(opts.cwd).toBe("/my/project");
  });

  it("passes maxIterations and tokenBudget", async () => {
    await runCoworkTask({
      templateId: "code-helper",
      userMessage: "写脚本",
      maxIterations: 30,
      tokenBudget: 50000,
    });

    const opts = _mockCreate.mock.calls[0][0];
    expect(opts.maxIterations).toBe(30);
    expect(opts.tokenBudget).toBe(50000);
  });

  it("uses default maxIterations of 50", async () => {
    await runCoworkTask({
      templateId: "code-helper",
      userMessage: "写脚本",
    });

    const opts = _mockCreate.mock.calls[0][0];
    expect(opts.maxIterations).toBe(50);
  });

  it("calls subAgent.run() with the userMessage", async () => {
    await runCoworkTask({
      templateId: "data-analysis",
      userMessage: "分析 sales.csv 的月度趋势",
    });

    expect(_mockRun).toHaveBeenCalledWith(
      "分析 sales.csv 的月度趋势",
      expect.any(Object),
    );
  });

  // ─── Error handling ───────────────────────────────────────

  it("throws when userMessage is missing", async () => {
    await expect(runCoworkTask({ templateId: "doc-convert" })).rejects.toThrow(
      "userMessage is required",
    );
  });

  it("throws when userMessage is not a string", async () => {
    await expect(
      runCoworkTask({ templateId: "doc-convert", userMessage: 123 }),
    ).rejects.toThrow("userMessage is required");
  });

  it("returns failed status when sub-agent throws", async () => {
    _mockRun.mockRejectedValue(new Error("LLM connection failed"));

    const result = await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "转换文件",
    });

    expect(result.status).toBe("failed");
    expect(result.result.summary).toContain("LLM connection failed");
    expect(result.result.artifacts).toEqual([]);
  });

  // ─── Result structure ─────────────────────────────────────

  it("returns complete result structure", async () => {
    const result = await runCoworkTask({
      templateId: "image-process",
      userMessage: "批量压缩图片",
    });

    expect(result).toHaveProperty("taskId");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("templateId");
    expect(result).toHaveProperty("templateName");
    expect(result).toHaveProperty("result");
    expect(result.result).toHaveProperty("summary");
    expect(result.result).toHaveProperty("artifacts");
    expect(result.result).toHaveProperty("tokenCount");
    expect(result.result).toHaveProperty("toolsUsed");
    expect(result.result).toHaveProperty("iterationCount");
  });

  // ─── All 10 templates ─────────────────────────────────────

  const templateIds = [
    "doc-convert",
    "media-process",
    "data-analysis",
    "web-research",
    "image-process",
    "code-helper",
    "system-admin",
    "file-organize",
    "network-tools",
    "learning-assist",
  ];

  for (const tid of templateIds) {
    it(`runs successfully with template: ${tid}`, async () => {
      const result = await runCoworkTask({
        templateId: tid,
        userMessage: "测试任务",
      });
      expect(result.status).toBe("completed");
      expect(result.templateId).toBe(tid);
    });
  }

  // ─── shellPolicyOverrides passthrough ─────────────────────

  it("passes shellPolicyOverrides for web-research template", async () => {
    await runCoworkTask({
      templateId: "web-research",
      userMessage: "搜索最新 AI 新闻",
    });

    expect(_mockRun).toHaveBeenCalledWith(
      "搜索最新 AI 新闻",
      expect.objectContaining({
        shellPolicyOverrides: ["network-download"],
      }),
    );
  });

  it("passes shellPolicyOverrides for network-tools template", async () => {
    await runCoworkTask({
      templateId: "network-tools",
      userMessage: "ping example.com",
    });

    expect(_mockRun).toHaveBeenCalledWith(
      "ping example.com",
      expect.objectContaining({
        shellPolicyOverrides: ["network-download"],
      }),
    );
  });

  it("passes empty loopOptions for templates without overrides", async () => {
    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "转换文件",
    });

    // loopOptions should be an empty object (no shellPolicyOverrides)
    const loopOpts = _mockRun.mock.calls[0][1];
    expect(loopOpts.shellPolicyOverrides).toBeUndefined();
  });

  // ─── History persistence ─────────────────────────────────

  it("appends completed task to history.jsonl", async () => {
    _deps.mkdirSync = vi.fn();
    _deps.appendFileSync = vi.fn();

    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "转换文档",
      cwd: "/test/project",
    });

    expect(_deps.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("cowork"),
      { recursive: true },
    );
    expect(_deps.appendFileSync).toHaveBeenCalledTimes(1);
    const [filePath, content] = _deps.appendFileSync.mock.calls[0];
    expect(filePath).toContain("history.jsonl");
    const record = JSON.parse(content.trim());
    expect(record.taskId).toBe("sub-test-123456");
    expect(record.userMessage).toBe("转换文档");
    expect(record.timestamp).toBeDefined();
  });

  it("appends failed task to history.jsonl", async () => {
    _deps.mkdirSync = vi.fn();
    _deps.appendFileSync = vi.fn();
    _mockRun.mockRejectedValue(new Error("LLM failed"));

    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "失败任务",
      cwd: "/test/project",
    });

    expect(_deps.appendFileSync).toHaveBeenCalledTimes(1);
    const record = JSON.parse(_deps.appendFileSync.mock.calls[0][1].trim());
    expect(record.status).toBe("failed");
  });

  it("does not fail task when history write throws", async () => {
    _deps.mkdirSync = vi.fn(() => {
      throw new Error("Permission denied");
    });
    _deps.appendFileSync = vi.fn();

    const result = await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "正常任务",
    });

    expect(result.status).toBe("completed");
  });

  // ─── MCP integration ──────────────────────────────────────

  it("calls mountTemplateMcpTools with the resolved template", async () => {
    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "转换文档",
    });

    expect(_mockMount).toHaveBeenCalledOnce();
    const [template] = _mockMount.mock.calls[0];
    expect(template.id).toBe("doc-convert");
  });

  it("forwards MCP tool plumbing to SubAgentContext.create", async () => {
    const fakeDef = {
      type: "function",
      function: {
        name: "mcp__fetch__get",
        description: "GET URL",
        parameters: { type: "object", properties: {} },
      },
    };
    const fakeDesc = {
      name: "mcp__fetch__get",
      kind: "mcp",
      serverName: "fetch",
    };
    const fakeExec = { kind: "mcp", serverName: "fetch", toolName: "get" };
    const fakeClient = { connect: vi.fn(), callTool: vi.fn() };
    _mockMount.mockResolvedValueOnce({
      mcpClient: fakeClient,
      mounted: ["fetch"],
      skipped: [],
      extraToolDefinitions: [fakeDef],
      externalToolDescriptors: { mcp__fetch__get: fakeDesc },
      externalToolExecutors: { mcp__fetch__get: fakeExec },
      cleanup: _mockCleanup,
    });

    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "调用 MCP 工具",
    });

    const opts = _mockCreate.mock.calls[0][0];
    expect(opts.extraToolDefinitions).toEqual([fakeDef]);
    expect(opts.externalToolDescriptors).toEqual({ mcp__fetch__get: fakeDesc });
    expect(opts.externalToolExecutors).toEqual({ mcp__fetch__get: fakeExec });
    expect(opts.mcpClient).toBe(fakeClient);
    expect(opts.mcpCallLedger).toBeDefined();
  });

  it("blocks an unknown/write MCP call when the Cowork durable prewrite fails", async () => {
    const toolName = "mcp__publisher__publish";
    const fakeClient = { callTool: vi.fn(async () => ({ ok: true })) };
    const descriptor = {
      name: toolName,
      kind: "mcp",
      source: "cowork-template-mcp",
      effectContract: {
        declaredEffect: "write",
        authorizedEffect: null,
        sourceTrusted: false,
        annotations: {},
      },
    };
    const executor = {
      kind: "mcp",
      serverName: "publisher",
      toolName: "publish",
    };
    _mockMount.mockResolvedValueOnce({
      mcpClient: fakeClient,
      mounted: ["publisher"],
      skipped: [],
      extraToolDefinitions: [
        {
          type: "function",
          function: {
            name: toolName,
            description: "Publish",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      externalToolDescriptors: { [toolName]: descriptor },
      externalToolExecutors: { [toolName]: executor },
      cleanup: _mockCleanup,
    });
    _deps.appendSessionEvent = vi.fn((_sessionId, type) => {
      if (type === "cowork_mcp_session") return true;
      throw new Error("durable store unavailable");
    });

    const run = await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "publish",
      mcpSessionId: "cowork-safe-session",
    });
    const context = _mockCreate.mock.calls[0][0];
    const result = await executeTool(
      toolName,
      { repository: "owner/repo" },
      {
        cwd: process.cwd(),
        sessionId: run.mcpSessionId,
        planManager: {
          isActive: () => false,
          isToolAllowed: () => true,
        },
        mcpClient: fakeClient,
        mcpCallLedger: context.mcpCallLedger,
        externalToolDescriptors: { [toolName]: descriptor },
        externalToolExecutors: { [toolName]: executor },
      },
    );

    expect(result).toMatchObject({
      policy: { decision: "blocked", via: "mcp-ledger-prewrite" },
    });
    expect(result.error).toContain("ledger prewrite failed");
    expect(fakeClient.callTool).not.toHaveBeenCalled();
  });

  it("injects prior unsettled MCP recovery into the Cowork child authority", async () => {
    const onProgress = vi.fn();
    const toolName = "mcp__publisher__publish";
    const fakeClient = { callTool: vi.fn() };
    const descriptor = {
      name: toolName,
      kind: "mcp",
      source: "cowork-template-mcp",
      effectContract: {
        declaredEffect: "write",
        authorizedEffect: null,
        sourceTrusted: false,
        annotations: {},
      },
    };
    const executor = {
      kind: "mcp",
      serverName: "publisher",
      toolName: "publish",
    };
    _mockMount.mockResolvedValueOnce({
      mcpClient: fakeClient,
      mounted: ["publisher"],
      skipped: [],
      extraToolDefinitions: [
        {
          type: "function",
          function: {
            name: toolName,
            description: "Publish",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      externalToolDescriptors: { [toolName]: descriptor },
      externalToolExecutors: { [toolName]: executor },
      cleanup: _mockCleanup,
    });
    _deps.readVerifiedSessionEvents = vi.fn(() => [
      {
        type: "mcp_call_ledger",
        prevHash: null,
        hash: "a".repeat(64),
        data: {
          schemaVersion: 1,
          phase: "started",
          record: {
            schemaVersion: 1,
            ledgerId: "mcp-prior-1",
            toolName: "mcp__publisher__publish",
            serverName: "publisher",
            sessionId: "cowork-resume-session",
            turnId: "turn-1",
            inputDigest: `sha256:${"a".repeat(64)}`,
            inputBytes: 2,
            status: "started",
            effectContract: { effect: "write" },
            resourceScopes: [],
            networkScopes: [],
            prewritePolicy: "fail-closed",
            prewritePersistence: "pending",
            startedAt: "2026-08-01T00:00:00.000Z",
            settledAt: null,
            outputSummary: null,
            outputDigest: null,
            errorSummary: null,
          },
        },
      },
    ]);

    const result = await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "resume publishing",
      mcpSessionId: "cowork-resume-session",
      onProgress,
    });

    expect(result.mcpSessionId).toBe("cowork-resume-session");
    const context = _mockCreate.mock.calls[0][0];
    expect(context.task).toContain("Do NOT automatically retry");
    expect(_mockRun.mock.calls[0][1]).toMatchObject({
      sessionId: "cowork-resume-session",
    });
    expect(_deps.appendSessionEventIfHead).toHaveBeenCalledWith(
      "cowork-resume-session",
      "cowork_mcp_session",
      expect.objectContaining({ taskId: "sub-test-123456" }),
      "a".repeat(64),
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mcp-recovery",
        sessionId: "cowork-resume-session",
        unsettled: 1,
        recovery: expect.objectContaining({ blockMode: "unsafe" }),
      }),
    );

    const replay = await executeTool(
      toolName,
      { repository: "owner/repo" },
      {
        cwd: process.cwd(),
        sessionId: "cowork-resume-session",
        planManager: {
          isActive: () => false,
          isToolAllowed: () => true,
        },
        mcpClient: fakeClient,
        mcpCallLedger: context.mcpCallLedger,
        externalToolDescriptors: { [toolName]: descriptor },
        externalToolExecutors: { [toolName]: executor },
      },
    );
    expect(replay).toMatchObject({
      policy: { decision: "blocked", via: "mcp-ledger-prewrite" },
    });
    expect(replay.error).toContain("explicitly adjudicated");
    expect(fakeClient.callTool).not.toHaveBeenCalled();
  });

  it("retains every exact replay deny in Cowork host authority", async () => {
    const sessionId = "cowork-replay-deny-session";
    const events = adjudicatedRecoveryEvents(25, sessionId);
    const onProgress = vi.fn();
    _deps.readVerifiedSessionEvents = vi.fn(() => events);

    const runtime = prepareCoworkMcpRuntime(
      {
        mcpClient: { callTool: vi.fn() },
        extraToolDefinitions: [
          { type: "function", function: { name: "mcp__repo__publish" } },
        ],
      },
      { mcpSessionId: sessionId, templateId: "doc-convert", onProgress },
    );

    expect(runtime.recoveryState.replayDenied).toHaveLength(25);
    expect(runtime.recoveryState.replayDenied[24]).toMatchObject({
      ledgerId: "mcp-deny-24",
      serverName: "repo",
      toolName: "publish",
      inputBytes: summarizeMcpPayload({ index: 24 }).bytes,
    });
    expect(runtime.recoveryState.replayDenied[24]).toHaveProperty(
      "replayDigest",
    );
    expect(runtime.recoveryState.replayDenied[24]).not.toHaveProperty(
      "inputDigest",
    );
    expect(Object.isFrozen(runtime.recoveryState.replayDenied)).toBe(true);
    expect(Object.isFrozen(runtime.recoveryState.replayDenied[24])).toBe(true);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mcp-recovery",
        recovery: expect.objectContaining({
          replayDenied: expect.arrayContaining([
            expect.objectContaining({ ledgerId: "mcp-deny-24" }),
          ]),
        }),
      }),
    );
    await expect(
      runtime.ledger.begin({
        toolName: "publish",
        serverName: "repo",
        input: { index: 24 },
        effectContract: { effect: "read", trusted: true },
      }),
    ).rejects.toMatchObject({
      code: "CC_MCP_LEDGER_EXACT_REPLAY_DENIED",
      retryable: false,
    });
  });

  it("blocks every MCP effect when the durable transcript cannot be verified", async () => {
    _mockMount.mockResolvedValueOnce({
      mcpClient: { callTool: vi.fn() },
      mounted: ["reader"],
      skipped: [],
      extraToolDefinitions: [{ type: "function", function: { name: "read" } }],
      externalToolDescriptors: {},
      externalToolExecutors: {},
      cleanup: _mockCleanup,
    });
    _deps.readVerifiedSessionEvents = vi.fn(() => {
      const error = new Error("hash chain broken");
      error.code = "SESSION_TRANSCRIPT_UNVERIFIED";
      throw error;
    });
    const onProgress = vi.fn();

    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "read",
      mcpSessionId: "cowork-corrupt-session",
      onProgress,
    });

    const ledger = _mockCreate.mock.calls[0][0].mcpCallLedger;
    await expect(
      ledger.begin({
        toolName: "mcp__reader__read",
        serverName: "reader",
        effectContract: { effect: "read", trusted: true },
      }),
    ).rejects.toMatchObject({
      code: "CC_COWORK_MCP_RECOVERY_BLOCKED",
      blockMode: "all",
    });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mcp-recovery",
        recovery: expect.objectContaining({ blockMode: "all" }),
      }),
    );
  });

  it.each([
    ["null", () => null],
    ["a Promise", () => Promise.resolve([])],
  ])(
    "blocks every MCP effect when verified session events return %s",
    async (_label, readVerifiedSessionEvents) => {
      _mockMount.mockResolvedValueOnce({
        mcpClient: { callTool: vi.fn() },
        mounted: ["reader"],
        skipped: [],
        extraToolDefinitions: [
          { type: "function", function: { name: "read" } },
        ],
        externalToolDescriptors: {},
        externalToolExecutors: {},
        cleanup: _mockCleanup,
      });
      _deps.readVerifiedSessionEvents = vi.fn(readVerifiedSessionEvents);

      await runCoworkTask({
        templateId: "doc-convert",
        userMessage: "read",
        mcpSessionId: "cowork-invalid-events-session",
      });

      await expect(
        _mockCreate.mock.calls[0][0].mcpCallLedger.begin({
          toolName: "mcp__reader__read",
          serverName: "reader",
          effectContract: { effect: "read", trusted: true },
        }),
      ).rejects.toMatchObject({
        code: "CC_COWORK_MCP_RECOVERY_BLOCKED",
        blockMode: "all",
      });
    },
  );

  it("does not rebind an MCP recovery session to a different template", async () => {
    _mockMount.mockResolvedValueOnce({
      mcpClient: { callTool: vi.fn() },
      mounted: ["reader"],
      skipped: [],
      extraToolDefinitions: [{ type: "function", function: { name: "read" } }],
      externalToolDescriptors: {},
      externalToolExecutors: {},
      cleanup: _mockCleanup,
    });
    _deps.readVerifiedSessionEvents = vi.fn(() => [
      {
        type: "cowork_mcp_session",
        hash: "sha256:bound-head",
        data: {
          schemaVersion: 1,
          taskId: "old-task",
          templateId: "code-helper",
        },
      },
    ]);

    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "read",
      mcpSessionId: "cowork-bound-session",
    });

    expect(_deps.appendSessionEventIfHead).not.toHaveBeenCalled();
    expect(_mockRun.mock.calls[0][1]).not.toHaveProperty("sessionId");
    await expect(
      _mockCreate.mock.calls[0][0].mcpCallLedger.begin({
        toolName: "mcp__reader__read",
        serverName: "reader",
        effectContract: { effect: "read", trusted: true },
      }),
    ).rejects.toMatchObject({
      code: "CC_COWORK_MCP_RECOVERY_BLOCKED",
      blockMode: "all",
    });
  });

  it("cleans up and aborts when the session head changes before binding", async () => {
    _mockMount.mockResolvedValueOnce({
      mcpClient: { callTool: vi.fn() },
      mounted: ["reader"],
      skipped: [],
      extraToolDefinitions: [{ type: "function", function: { name: "read" } }],
      externalToolDescriptors: {},
      externalToolExecutors: {},
      cleanup: _mockCleanup,
    });
    _deps.appendSessionEventIfHead = vi.fn(() => {
      const error = new Error("session advanced");
      error.code = "SESSION_REVISION_STALE";
      throw error;
    });

    await expect(
      runCoworkTask({
        templateId: "doc-convert",
        userMessage: "read",
        mcpSessionId: "cowork-raced-session",
      }),
    ).rejects.toMatchObject({ code: "SESSION_REVISION_STALE" });
    expect(_mockRun).not.toHaveBeenCalled();
    expect(_mockCleanup).toHaveBeenCalledOnce();
  });

  it("cleans up mounted MCP servers when runtime setup throws", async () => {
    _mockMount.mockResolvedValueOnce({
      mcpClient: { callTool: vi.fn() },
      mounted: ["publisher"],
      skipped: [],
      extraToolDefinitions: [{ type: "function", function: { name: "x" } }],
      externalToolDescriptors: {},
      externalToolExecutors: {},
      cleanup: _mockCleanup,
    });
    _mockCreate.mockImplementationOnce(() => {
      throw new Error("context unavailable");
    });

    await expect(
      runCoworkTask({
        templateId: "doc-convert",
        userMessage: "publish",
      }),
    ).rejects.toThrow("context unavailable");
    expect(_mockCleanup).toHaveBeenCalledOnce();
  });

  it("always calls cleanup(), even when the sub-agent throws", async () => {
    _mockRun.mockRejectedValueOnce(new Error("agent exploded"));

    const result = await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "失败任务",
    });

    expect(result.status).toBe("failed");
    expect(_mockCleanup).toHaveBeenCalledOnce();
  });
});

// ─── Parallel Runner ─────────────────────────────────────────────────────────

// Mock orchestrator for parallel tests
vi.mock("../../src/lib/orchestrator.js", () => {
  const mockAddTask = vi.fn();
  const mockStopCronWatch = vi.fn();
  const mockOn = vi.fn();
  const MockOrchestrator = vi.fn(function () {
    return {
      addTask: mockAddTask,
      stopCronWatch: mockStopCronWatch,
      on: mockOn,
      notifier: { addWebSocketChannel: vi.fn() },
    };
  });
  return {
    Orchestrator: MockOrchestrator,
    TASK_SOURCE: { CLI: "cli" },
    _mockAddTask: mockAddTask,
    _mockStopCronWatch: mockStopCronWatch,
    _mockOn: mockOn,
    _MockOrchestrator: MockOrchestrator,
  };
});

import {
  _mockAddTask,
  _mockStopCronWatch,
  _mockOn,
  _MockOrchestrator,
} from "../../src/lib/orchestrator.js";

describe("runCoworkTaskParallel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _deps.existsSync = vi.fn(() => true);
    _deps.mkdirSync = vi.fn();
    _deps.appendFileSync = vi.fn();
    _mockAddTask.mockResolvedValue({
      id: "orch-task-001",
      status: "completed",
      retries: 0,
      subtasks: [{ id: "s1" }, { id: "s2" }],
      agentResults: [
        { output: "Agent 1 completed analysis" },
        { output: "Agent 2 completed research" },
      ],
    });
  });

  it("returns parallel result with correct structure", async () => {
    const result = await runCoworkTaskParallel({
      templateId: "web-research",
      userMessage: "调研 AI 框架对比",
    });

    expect(result.parallel).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.templateId).toBe("web-research");
    expect(result.result.subtaskCount).toBe(2);
    expect(result.result.summary).toContain("Agent 1 completed analysis");
    expect(result.result.summary).toContain("Agent 2 completed research");
  });

  it("creates Orchestrator with correct maxParallel", async () => {
    await runCoworkTaskParallel({
      templateId: "data-analysis",
      userMessage: "分析数据",
      agents: 5,
    });

    expect(_MockOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ maxParallel: 5 }),
    );
  });

  it("caps agents at 10", async () => {
    await runCoworkTaskParallel({
      templateId: "data-analysis",
      userMessage: "分析数据",
      agents: 20,
    });

    expect(_MockOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ maxParallel: 10 }),
    );
  });

  it("defaults to 3 agents", async () => {
    await runCoworkTaskParallel({
      templateId: "data-analysis",
      userMessage: "分析数据",
    });

    expect(_MockOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ maxParallel: 3 }),
    );
  });

  it("includes template info in orchestrator task", async () => {
    await runCoworkTaskParallel({
      templateId: "web-research",
      userMessage: "调研 React 框架",
    });

    const taskArg = _mockAddTask.mock.calls[0][0];
    expect(taskArg).toContain("信息检索与调研");
    expect(taskArg).toContain("调研 React 框架");
  });

  it("includes files in orchestrator task", async () => {
    await runCoworkTaskParallel({
      templateId: "data-analysis",
      userMessage: "分析数据",
      files: ["/data/sales.csv"],
    });

    const taskArg = _mockAddTask.mock.calls[0][0];
    expect(taskArg).toContain("/data/sales.csv");
  });

  it("throws when userMessage is missing", async () => {
    await expect(
      runCoworkTaskParallel({ templateId: "web-research" }),
    ).rejects.toThrow("userMessage is required");
  });

  it("validates file paths", async () => {
    _deps.existsSync = vi.fn((f) => f !== "/missing.csv");

    await expect(
      runCoworkTaskParallel({
        templateId: "data-analysis",
        userMessage: "分析",
        files: ["/existing.csv", "/missing.csv"],
      }),
    ).rejects.toThrow("File(s) not found: /missing.csv");
  });

  it("returns failed status on orchestrator error", async () => {
    _mockAddTask.mockRejectedValue(new Error("Orchestrator crashed"));

    const result = await runCoworkTaskParallel({
      templateId: "web-research",
      userMessage: "调研",
    });

    expect(result.status).toBe("failed");
    expect(result.parallel).toBe(true);
    expect(result.result.summary).toContain("Orchestrator crashed");
  });

  it("wires onProgress to orchestrator events", async () => {
    const onProgress = vi.fn();

    await runCoworkTaskParallel({
      templateId: "web-research",
      userMessage: "调研",
      onProgress,
    });

    // Should register event listeners
    expect(_mockOn).toHaveBeenCalled();
    const eventNames = _mockOn.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain("task:added");
    expect(eventNames).toContain("agent:output");
  });

  it("appends parallel result to history", async () => {
    await runCoworkTaskParallel({
      templateId: "web-research",
      userMessage: "调研 AI",
      cwd: "/test/project",
    });

    expect(_deps.appendFileSync).toHaveBeenCalledTimes(1);
    const record = JSON.parse(_deps.appendFileSync.mock.calls[0][1].trim());
    expect(record.parallel).toBe(true);
    expect(record.userMessage).toBe("调研 AI");
  });

  it("passes strategy to Orchestrator when provided", async () => {
    await runCoworkTaskParallel({
      templateId: "data-analysis",
      userMessage: "分析",
      strategy: "parallel-all",
    });

    expect(_MockOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: { strategy: "parallel-all" },
      }),
    );
  });

  it("uses free mode when templateId is null", async () => {
    const result = await runCoworkTaskParallel({
      templateId: null,
      userMessage: "并行执行任务",
    });

    expect(result.templateId).toBe("free");
    expect(result.parallel).toBe(true);
  });
});

// ─── Debate Runner ───────────────────────────────────────────────────────────

describe("runCoworkDebate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _deps.existsSync = vi.fn(() => true);
    _deps.mkdirSync = vi.fn();
    _deps.appendFileSync = vi.fn();
    _deps.readFileSync = vi.fn(() => "function foo() { return 42; }");
    _mockStartDebate.mockResolvedValue({
      target: "test",
      perspectives: ["performance", "security", "maintainability"],
      reviews: [
        {
          perspective: "performance",
          role: "Performance Reviewer",
          review: "OK",
          verdict: "APPROVE",
        },
        {
          perspective: "security",
          role: "Security Reviewer",
          review: "Issue",
          verdict: "NEEDS_WORK",
        },
        {
          perspective: "maintainability",
          role: "Maintainability Reviewer",
          review: "Good",
          verdict: "APPROVE",
        },
      ],
      verdict: "NEEDS_WORK",
      consensusScore: 75,
      summary: "Overall decent, fix the security issue.",
    });
  });

  it("returns debate result with verdict and reviews", async () => {
    const result = await runCoworkDebate({
      templateId: "code-review",
      userMessage: "评审这个函数",
    });

    expect(result.status).toBe("completed");
    expect(result.mode).toBe("debate");
    expect(result.result.verdict).toBe("NEEDS_WORK");
    expect(result.result.consensusScore).toBe(75);
    expect(result.result.reviews).toHaveLength(3);
    expect(result.result.summary).toContain("security");
  });

  it("reads file contents when files provided", async () => {
    _deps.readFileSync = vi.fn(() => "const x = 1;");

    await runCoworkDebate({
      templateId: "code-review",
      userMessage: "Review this",
      files: ["/src/foo.js"],
    });

    expect(_deps.readFileSync).toHaveBeenCalledWith("/src/foo.js", "utf-8");
    const callArgs = _mockStartDebate.mock.calls[0][0];
    expect(callArgs.code).toContain("const x = 1;");
    expect(callArgs.code).toContain("/src/foo.js");
  });

  it("uses userMessage as code body when no files provided", async () => {
    await runCoworkDebate({
      templateId: "code-review",
      userMessage: "function inlineCode() { return 1; }",
    });

    const callArgs = _mockStartDebate.mock.calls[0][0];
    expect(callArgs.code).toContain("function inlineCode");
  });

  it("validates file paths before starting debate", async () => {
    _deps.existsSync = vi.fn((f) => f !== "/missing.js");

    await expect(
      runCoworkDebate({
        userMessage: "review",
        files: ["/missing.js"],
      }),
    ).rejects.toThrow("File(s) not found: /missing.js");
    expect(_mockStartDebate).not.toHaveBeenCalled();
  });

  it("uses template debatePerspectives by default", async () => {
    await runCoworkDebate({
      templateId: "code-review",
      userMessage: "review",
    });

    const callArgs = _mockStartDebate.mock.calls[0][0];
    expect(callArgs.perspectives).toEqual([
      "performance",
      "security",
      "maintainability",
    ]);
  });

  it("allows custom perspectives override", async () => {
    await runCoworkDebate({
      templateId: "code-review",
      userMessage: "review",
      perspectives: ["architecture", "correctness"],
    });

    const callArgs = _mockStartDebate.mock.calls[0][0];
    expect(callArgs.perspectives).toEqual(["architecture", "correctness"]);
  });

  it("throws when userMessage missing", async () => {
    await expect(runCoworkDebate({})).rejects.toThrow(
      "userMessage is required",
    );
  });

  it("emits debate-started and debate-completed progress events", async () => {
    const onProgress = vi.fn();

    await runCoworkDebate({
      templateId: "code-review",
      userMessage: "review",
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: "debate-started" }),
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "debate-completed",
        verdict: "NEEDS_WORK",
      }),
    );
  });

  it("returns failed status when startDebate throws", async () => {
    _mockStartDebate.mockRejectedValue(new Error("LLM offline"));

    const result = await runCoworkDebate({
      templateId: "code-review",
      userMessage: "review",
    });

    expect(result.status).toBe("failed");
    expect(result.result.summary).toContain("LLM offline");
  });

  it("handles read errors gracefully with error marker", async () => {
    _deps.readFileSync = vi.fn(() => {
      throw new Error("EACCES");
    });

    await runCoworkDebate({
      templateId: "code-review",
      userMessage: "review",
      files: ["/protected.js"],
    });

    const callArgs = _mockStartDebate.mock.calls[0][0];
    expect(callArgs.code).toContain("read error: EACCES");
  });

  it("appends debate result to history", async () => {
    await runCoworkDebate({
      templateId: "code-review",
      userMessage: "review",
      cwd: "/test/proj",
    });

    expect(_deps.appendFileSync).toHaveBeenCalledTimes(1);
    const record = JSON.parse(_deps.appendFileSync.mock.calls[0][1].trim());
    expect(record.mode).toBe("debate");
    expect(record.status).toBe("completed");
  });
});
