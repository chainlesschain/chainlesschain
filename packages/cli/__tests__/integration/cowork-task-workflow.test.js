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

import { runCoworkTask } from "../../src/lib/cowork-task-runner.js";
import {
  TASK_TEMPLATES,
  getTemplate,
  listTemplateIds,
} from "../../src/lib/cowork-task-templates.js";
import { _createMock } from "../../src/lib/sub-agent-context.js";

describe("cowork task workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    // Import the handler directly
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

    // Should have sent cowork:started + cowork:done
    const types = server._send.mock.calls.map((c) => c[1].type);
    expect(types).toContain("cowork:started");
    expect(types).toContain("cowork:done");

    const done = server._send.mock.calls.find(
      (c) => c[1].type === "cowork:done",
    );
    expect(done[1].status).toBe("completed");
    expect(done[1].templateId).toBe("doc-convert");
  });
});
