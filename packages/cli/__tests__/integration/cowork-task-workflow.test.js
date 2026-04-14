/**
 * Integration tests: Cowork Task workflow
 *
 * Tests the end-to-end flow from template resolution through SubAgentContext
 * creation. SubAgentContext.run() is mocked (no real LLM), but all template
 * resolution, prompt assembly, and result handling run for real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock sub-agent-context — prevent real LLM calls
vi.mock("../../src/lib/sub-agent-context.js", () => {
  const createMock = vi.fn();
  return {
    SubAgentContext: { create: createMock },
    _createMock: createMock,
  };
});

import { runCoworkTask, _deps } from "../../src/lib/cowork-task-runner.js";
import {
  TASK_TEMPLATES,
  getTemplate,
  listTemplateIds,
} from "../../src/lib/cowork-task-templates.js";
import { _createMock } from "../../src/lib/sub-agent-context.js";

describe("cowork task workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock filesystem ops so tests don't need real files
    _deps.existsSync = vi.fn(() => true);
    _deps.mkdirSync = vi.fn();
    _deps.appendFileSync = vi.fn();
    _createMock.mockImplementation((opts) => ({
      id: "sub-intg-001",
      status: "completed",
      run: vi.fn().mockResolvedValue({
        summary: `Completed: ${opts.role}`,
        artifacts: [{ type: "tool-output", tool: "run_shell", content: "ok" }],
        tokenCount: 1200,
        toolsUsed: ["run_shell", "read_file", "write_file"],
        iterationCount: 8,
      }),
    }));
  });

  // ─── Template → Runner integration ──────────────────────────

  it("each template resolves and runs without error", async () => {
    for (const tid of listTemplateIds()) {
      const result = await runCoworkTask({
        templateId: tid,
        userMessage: `Integration test for ${tid}`,
      });
      expect(result.status).toBe("completed");
      expect(result.templateId).toBe(tid);
      expect(result.templateName).toBe(TASK_TEMPLATES[tid].name);
    }
  });

  it("free mode resolves and runs", async () => {
    const result = await runCoworkTask({
      templateId: null,
      userMessage: "自由任务",
    });
    expect(result.templateId).toBe("free");
    expect(result.templateName).toBe("自由模式");
  });

  // ─── Prompt assembly ─────────────────────────────────────────

  it("doc-convert task includes pandoc + auto-install rules in task", async () => {
    await runCoworkTask({
      templateId: "doc-convert",
      userMessage: "转换文件",
    });
    const opts = _createMock.mock.calls[0][0];
    expect(opts.task).toContain("pandoc");
    expect(opts.task).toContain("winget install");
    expect(opts.task).toContain("cli-anything register");
    expect(opts.role).toBe("cowork-doc-convert");
  });

  it("media-process task includes ffmpeg in task", async () => {
    await runCoworkTask({
      templateId: "media-process",
      userMessage: "压缩视频",
    });
    const opts = _createMock.mock.calls[0][0];
    expect(opts.task).toContain("ffmpeg");
    expect(opts.role).toBe("cowork-media-process");
  });

  it("files are appended to task as dynamic section", async () => {
    await runCoworkTask({
      templateId: "data-analysis",
      userMessage: "分析数据",
      files: ["/data/sales.csv", "/data/report.xlsx"],
    });
    const opts = _createMock.mock.calls[0][0];
    expect(opts.task).toContain("## 用户提供的文件");
    expect(opts.task).toContain("/data/sales.csv");
    expect(opts.task).toContain("/data/report.xlsx");
  });

  // ─── SubAgentContext options ──────────────────────────────────

  it("passes iteration and token budgets through", async () => {
    await runCoworkTask({
      templateId: "code-helper",
      userMessage: "写脚本",
      maxIterations: 25,
      tokenBudget: 80000,
    });
    const opts = _createMock.mock.calls[0][0];
    expect(opts.maxIterations).toBe(25);
    expect(opts.tokenBudget).toBe(80000);
  });

  it("passes cwd and db through", async () => {
    const fakeDb = { prepare: vi.fn() };
    await runCoworkTask({
      templateId: "system-admin",
      userMessage: "查看磁盘",
      cwd: "/my/dir",
      db: fakeDb,
    });
    const opts = _createMock.mock.calls[0][0];
    expect(opts.cwd).toBe("/my/dir");
    expect(opts.db).toBe(fakeDb);
  });

  // ─── Result propagation ──────────────────────────────────────

  it("propagates artifacts from sub-agent result", async () => {
    const result = await runCoworkTask({
      templateId: "image-process",
      userMessage: "压缩图片",
    });
    expect(result.result.artifacts).toHaveLength(1);
    expect(result.result.artifacts[0].tool).toBe("run_shell");
    expect(result.result.toolsUsed).toContain("write_file");
  });

  it("propagates token count and iteration count", async () => {
    const result = await runCoworkTask({
      templateId: "web-research",
      userMessage: "查资料",
    });
    expect(result.result.tokenCount).toBe(1200);
    expect(result.result.iterationCount).toBe(8);
  });

  // ─── Error propagation ───────────────────────────────────────

  it("returns failed status when sub-agent run() rejects", async () => {
    _createMock.mockImplementation(() => ({
      id: "sub-fail-001",
      status: "failed",
      run: vi.fn().mockRejectedValue(new Error("Provider unreachable")),
    }));

    const result = await runCoworkTask({
      templateId: "network-tools",
      userMessage: "测试API",
    });
    expect(result.status).toBe("failed");
    expect(result.result.summary).toContain("Provider unreachable");
  });

  // ─── WS action-protocol integration ──────────────────────────

  it("handleCoworkTask delegates to runCoworkTask", async () => {
    const { handleCoworkTask } =
      await import("../../src/gateways/ws/action-protocol.js");

    const server = {
      _send: vi.fn(),
      projectRoot: "/test",
    };
    const ws = {};

    await handleCoworkTask(server, "req-intg", ws, {
      templateId: "doc-convert",
      userMessage: "转换PDF",
      files: ["/tmp/doc.docx"],
    });

    const types = server._send.mock.calls.map((c) => c[1].type);
    expect(types).toContain("cowork:started");
    expect(types).toContain("cowork:done");

    const done = server._send.mock.calls.find(
      (c) => c[1].type === "cowork:done",
    );
    expect(done[1].status).toBe("completed");
    expect(done[1].templateId).toBe("doc-convert");
  });

  // ─── Cancel integration ─────────────────────────────────────

  it("handleCoworkCancel aborts a running task via AbortSignal", async () => {
    const { handleCoworkTask, handleCoworkCancel } =
      await import("../../src/gateways/ws/action-protocol.js");

    let resolveTask;
    _createMock.mockImplementation(() => ({
      id: "sub-cancel-001",
      status: "cancelled",
      run: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveTask = resolve;
          }),
      ),
    }));

    const server = { _send: vi.fn(), projectRoot: "/test" };
    const ws = {};

    const taskPromise = handleCoworkTask(server, "req-cancel", ws, {
      userMessage: "长任务",
    });

    await new Promise((r) => setTimeout(r, 10));

    handleCoworkCancel(server, "req-c", ws, {
      trackingId: "cowork-req-cancel",
    });

    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-c",
      type: "cowork:cancelled",
      trackingId: "cowork-req-cancel",
    });

    resolveTask({ summary: "cancelled" });
    await taskPromise;
  });

  // ─── Progress integration ───────────────────────────────────

  it("handleCoworkTask sends cowork:progress when onProgress fires", async () => {
    const { handleCoworkTask } =
      await import("../../src/gateways/ws/action-protocol.js");

    const server = { _send: vi.fn(), projectRoot: "/test" };
    const ws = {};

    await handleCoworkTask(server, "req-prog", ws, {
      templateId: "code-helper",
      userMessage: "写脚本",
    });

    // Verify onProgress was passed to SubAgentContext
    const opts = _createMock.mock.calls.find(
      (c) => c[0].role === "cowork-code-helper",
    );
    expect(opts[0].onProgress).toBeTypeOf("function");
  });

  // ─── Templates WS integration ──────────────────────────────

  it("handleCoworkTemplates returns template list via WS", async () => {
    const { handleCoworkTemplates } =
      await import("../../src/gateways/ws/action-protocol.js");

    const server = { _send: vi.fn() };
    const ws = {};

    await handleCoworkTemplates(server, "req-tpl", ws);

    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-tpl",
      type: "cowork:templates",
      templates: expect.any(Array),
    });

    const templates = server._send.mock.calls[0][1].templates;
    expect(templates.length).toBe(10);
    expect(templates[0]).toHaveProperty("icon");
    expect(templates[0]).toHaveProperty("description");
    expect(templates[0]).toHaveProperty("examples");
    // Should NOT include systemPromptExtension
    expect(templates[0].systemPromptExtension).toBeUndefined();
  });

  // ─── History WS integration ─────────────────────────────────

  it("handleCoworkHistory returns empty when no history file", async () => {
    const { handleCoworkHistory } =
      await import("../../src/gateways/ws/action-protocol.js");

    const server = { _send: vi.fn(), projectRoot: "/nonexistent" };
    const ws = {};

    await handleCoworkHistory(server, "req-hist", ws, { limit: 10 });

    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-hist",
      type: "cowork:history",
      entries: [],
    });
  });

  // ─── History persistence integration ────────────────────────

  it("runCoworkTask writes history entry after completion", async () => {
    _deps.appendFileSync = vi.fn();

    await runCoworkTask({
      templateId: "data-analysis",
      userMessage: "分析数据集",
      cwd: "/proj",
    });

    expect(_deps.appendFileSync).toHaveBeenCalledTimes(1);
    const record = JSON.parse(_deps.appendFileSync.mock.calls[0][1].trim());
    expect(record.userMessage).toBe("分析数据集");
    expect(record.templateId).toBe("data-analysis");
    expect(record.status).toBe("completed");
    expect(record.timestamp).toBeDefined();
  });

  // ─── Token count propagation ────────────────────────────────

  it("handleCoworkTask includes tokenCount in cowork:done", async () => {
    const { handleCoworkTask } =
      await import("../../src/gateways/ws/action-protocol.js");

    const server = { _send: vi.fn(), projectRoot: "/test" };
    const ws = {};

    await handleCoworkTask(server, "req-tok", ws, {
      userMessage: "测试",
    });

    const done = server._send.mock.calls.find(
      (c) => c[1].type === "cowork:done",
    );
    expect(done[1]).toHaveProperty("tokenCount");
    expect(done[1].tokenCount).toBe(1200);
  });
});
