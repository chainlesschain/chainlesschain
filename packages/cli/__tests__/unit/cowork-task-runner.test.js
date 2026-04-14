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
  _deps,
} from "../../src/lib/cowork-task-runner.js";
import { _mockStartDebate } from "../../src/lib/cowork/debate-review-cli.js";
import {
  SubAgentContext,
  _mockCreate,
  _mockRun,
} from "../../src/lib/sub-agent-context.js";
import {
  _mockMount,
  _mockCleanup,
} from "../../src/lib/cowork-mcp-tools.js";

describe("cowork-task-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all files exist
    _deps.existsSync = vi.fn(() => true);
    _deps.mkdirSync = vi.fn();
    _deps.appendFileSync = vi.fn();
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
    const fakeDesc = { name: "mcp__fetch__get", kind: "mcp", serverName: "fetch" };
    const fakeExec = { kind: "mcp", serverName: "fetch", toolName: "get" };
    const fakeClient = { connect: vi.fn(), callTool: vi.fn() };
    _mockMount.mockResolvedValueOnce({
      mcpClient: fakeClient,
      mounted: ["fetch"],
      skipped: [],
      extraToolDefinitions: [fakeDef],
      externalToolDescriptors: { "mcp__fetch__get": fakeDesc },
      externalToolExecutors: { "mcp__fetch__get": fakeExec },
      cleanup: _mockCleanup,
    });

    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "调用 MCP 工具",
    });

    const opts = _mockCreate.mock.calls[0][0];
    expect(opts.extraToolDefinitions).toEqual([fakeDef]);
    expect(opts.externalToolDescriptors).toEqual({ "mcp__fetch__get": fakeDesc });
    expect(opts.externalToolExecutors).toEqual({ "mcp__fetch__get": fakeExec });
    expect(opts.mcpClient).toBe(fakeClient);
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
  const MockOrchestrator = vi.fn(() => ({
    addTask: mockAddTask,
    stopCronWatch: mockStopCronWatch,
    on: mockOn,
    notifier: { addWebSocketChannel: vi.fn() },
  }));
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
