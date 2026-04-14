import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock cowork-task-runner
vi.mock("../../src/lib/cowork-task-runner.js", () => ({
  runCoworkTask: vi.fn(),
}));

import { handleCoworkTask } from "../../src/gateways/ws/action-protocol.js";
import { runCoworkTask } from "../../src/lib/cowork-task-runner.js";

describe("handleCoworkTask (action-protocol)", () => {
  let server;
  let ws;

  beforeEach(() => {
    vi.clearAllMocks();
    server = {
      _send: vi.fn(),
      projectRoot: "/test/project",
    };
    ws = { readyState: 1 };

    runCoworkTask.mockResolvedValue({
      taskId: "sub-abc123",
      status: "completed",
      templateId: "doc-convert",
      templateName: "文档格式转换",
      result: {
        summary: "文件已转换为 PDF",
        artifacts: [],
        toolsUsed: ["run_shell"],
        iterationCount: 5,
      },
    });
  });

  it("returns INVALID_MESSAGE when userMessage is missing", async () => {
    await handleCoworkTask(server, "req-1", ws, {});

    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-1",
      type: "error",
      code: "INVALID_MESSAGE",
      message: "userMessage field required",
    });
  });

  it("returns INVALID_MESSAGE when userMessage is not a string", async () => {
    await handleCoworkTask(server, "req-2", ws, { userMessage: 42 });

    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-2",
      type: "error",
      code: "INVALID_MESSAGE",
      message: "userMessage field required",
    });
  });

  it("sends cowork:started and cowork:done on success", async () => {
    await handleCoworkTask(server, "req-3", ws, {
      templateId: "doc-convert",
      userMessage: "把 report.docx 转成 PDF",
      files: ["/tmp/report.docx"],
    });

    // First call: cowork:started
    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-3",
      type: "cowork:started",
      templateId: "doc-convert",
    });

    // Second call: cowork:done
    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-3",
      type: "cowork:done",
      taskId: "sub-abc123",
      status: "completed",
      templateId: "doc-convert",
      templateName: "文档格式转换",
      summary: "文件已转换为 PDF",
      artifacts: [],
      toolsUsed: ["run_shell"],
      iterationCount: 5,
      tokenCount: 0,
    });
  });

  it("forwards tokenCount from result to cowork:done", async () => {
    runCoworkTask.mockResolvedValue({
      taskId: "sub-tok",
      status: "completed",
      templateId: "data-analysis",
      templateName: "数据分析",
      result: {
        summary: "分析完成",
        artifacts: [],
        toolsUsed: ["run_code"],
        iterationCount: 8,
        tokenCount: 12500,
      },
    });

    await handleCoworkTask(server, "req-tok", ws, {
      templateId: "data-analysis",
      userMessage: "分析数据",
    });

    const doneCall = server._send.mock.calls.find(
      (c) => c[1].type === "cowork:done",
    );
    expect(doneCall[1].tokenCount).toBe(12500);
  });

  it("calls runCoworkTask with correct parameters", async () => {
    await handleCoworkTask(server, "req-4", ws, {
      templateId: "media-process",
      userMessage: "压缩视频",
      files: ["/tmp/video.mp4"],
    });

    expect(runCoworkTask).toHaveBeenCalledWith({
      templateId: "media-process",
      userMessage: "压缩视频",
      files: ["/tmp/video.mp4"],
      cwd: "/test/project",
      llmOptions: {},
    });
  });

  it("defaults templateId to null", async () => {
    await handleCoworkTask(server, "req-5", ws, {
      userMessage: "帮我做点事",
    });

    expect(runCoworkTask).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: null }),
    );
  });

  it("defaults files to empty array", async () => {
    await handleCoworkTask(server, "req-6", ws, {
      userMessage: "帮我做点事",
    });

    expect(runCoworkTask).toHaveBeenCalledWith(
      expect.objectContaining({ files: [] }),
    );
  });

  it("uses process.cwd() when server has no projectRoot", async () => {
    server.projectRoot = null;
    await handleCoworkTask(server, "req-7", ws, {
      userMessage: "查看信息",
    });

    expect(runCoworkTask).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: process.cwd() }),
    );
  });

  it("sends COWORK_FAILED error on runner exception", async () => {
    runCoworkTask.mockRejectedValue(new Error("SubAgent init failed"));

    await handleCoworkTask(server, "req-8", ws, {
      userMessage: "做任务",
    });

    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-8",
      type: "error",
      code: "COWORK_FAILED",
      message: "SubAgent init failed",
    });
  });

  it("handles result with empty summary gracefully", async () => {
    runCoworkTask.mockResolvedValue({
      taskId: "sub-empty",
      status: "completed",
      templateId: "free",
      templateName: "自由模式",
      result: {},
    });

    await handleCoworkTask(server, "req-9", ws, {
      userMessage: "测试",
    });

    const doneCall = server._send.mock.calls.find(
      (c) => c[1].type === "cowork:done",
    );
    expect(doneCall[1].summary).toBe("");
    expect(doneCall[1].artifacts).toEqual([]);
    expect(doneCall[1].toolsUsed).toEqual([]);
  });
});
