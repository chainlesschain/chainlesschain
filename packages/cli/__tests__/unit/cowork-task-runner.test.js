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

import { runCoworkTask, _deps } from "../../src/lib/cowork-task-runner.js";
import {
  SubAgentContext,
  _mockCreate,
  _mockRun,
} from "../../src/lib/sub-agent-context.js";

describe("cowork-task-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all files exist
    _deps.existsSync = vi.fn(() => true);
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
});
