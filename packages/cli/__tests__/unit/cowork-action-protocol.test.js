import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock cowork-task-runner
vi.mock("../../src/lib/cowork-task-runner.js", () => ({
  runCoworkTask: vi.fn(),
  runCoworkTaskParallel: vi.fn(),
  runCoworkDebate: vi.fn(),
}));

// Mock cowork-task-templates
vi.mock("../../src/lib/cowork-task-templates.js", () => ({
  getTemplate: vi.fn(() => ({
    id: "doc-convert",
    name: "文档格式转换",
    parallelStrategy: "none",
  })),
  getTemplatesForUI: vi.fn(() => []),
}));

import {
  handleCoworkTask,
  handleCoworkCancel,
} from "../../src/gateways/ws/action-protocol.js";
import {
  runCoworkTask,
  runCoworkTaskParallel,
  runCoworkDebate,
} from "../../src/lib/cowork-task-runner.js";
import { getTemplate } from "../../src/lib/cowork-task-templates.js";

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
      trackingId: "cowork-req-3",
      parallel: false,
      mode: "agent",
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
      parallel: false,
      subtaskCount: 0,
      mode: "agent",
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

  it("passes onProgress callback that sends cowork:progress messages", async () => {
    await handleCoworkTask(server, "req-prog", ws, {
      templateId: "code-helper",
      userMessage: "写脚本",
    });

    // Verify onProgress function was passed
    expect(runCoworkTask).toHaveBeenCalledWith(
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );

    // Extract the captured callback and invoke it to verify WS plumbing
    const capturedOpts = runCoworkTask.mock.calls[0][0];
    server._send.mockClear();
    capturedOpts.onProgress({
      type: "tool-executing",
      tool: "run_shell",
      iterationCount: 1,
      tokenCount: 100,
    });

    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-prog",
      type: "cowork:progress",
      event: "tool-executing",
      tool: "run_shell",
      iterationCount: 1,
      tokenCount: 100,
    });
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
      onProgress: expect.any(Function),
      signal: expect.any(AbortSignal),
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

  it("includes trackingId in cowork:started response", async () => {
    await handleCoworkTask(server, "req-track", ws, {
      templateId: "code-helper",
      userMessage: "写代码",
    });

    const startedCall = server._send.mock.calls.find(
      (c) => c[1].type === "cowork:started",
    );
    expect(startedCall[1].trackingId).toBe("cowork-req-track");
    expect(startedCall[1].parallel).toBe(false);
  });

  it("passes signal to runCoworkTask", async () => {
    await handleCoworkTask(server, "req-sig", ws, {
      userMessage: "任务",
    });

    expect(runCoworkTask).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("handleCoworkCancel (action-protocol)", () => {
  let server;
  let ws;

  beforeEach(() => {
    vi.clearAllMocks();
    server = {
      _send: vi.fn(),
      projectRoot: "/test/project",
    };
    ws = { readyState: 1 };
  });

  it("returns INVALID_MESSAGE when trackingId is missing", () => {
    handleCoworkCancel(server, "req-c1", ws, {});

    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-c1",
      type: "error",
      code: "INVALID_MESSAGE",
      message: "trackingId field required",
    });
  });

  it("returns TASK_NOT_FOUND for unknown trackingId", () => {
    handleCoworkCancel(server, "req-c2", ws, {
      trackingId: "cowork-unknown",
    });

    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-c2",
      type: "error",
      code: "TASK_NOT_FOUND",
      message: "No running cowork task: cowork-unknown",
    });
  });

  it("aborts a running task and sends cowork:cancelled", async () => {
    // Start a task that never resolves (simulates a long-running task)
    let resolveTask;
    runCoworkTask.mockReturnValue(
      new Promise((resolve) => {
        resolveTask = resolve;
      }),
    );

    // handleCoworkTask is async — kick it off without awaiting
    const taskPromise = handleCoworkTask(server, "req-c3", ws, {
      userMessage: "长任务",
    });

    // Wait a tick for the cowork:started message to be sent
    await new Promise((r) => setTimeout(r, 10));

    const trackingId = "cowork-req-c3";

    // Cancel the task
    handleCoworkCancel(server, "req-c3-cancel", ws, { trackingId });

    expect(server._send).toHaveBeenCalledWith(ws, {
      id: "req-c3-cancel",
      type: "cowork:cancelled",
      trackingId,
    });

    // Verify the signal was aborted
    const capturedOpts = runCoworkTask.mock.calls[0][0];
    expect(capturedOpts.signal.aborted).toBe(true);

    // Resolve the pending task to clean up
    resolveTask({
      taskId: "sub-cancelled",
      status: "cancelled",
      templateId: null,
      templateName: "自由模式",
      result: { summary: "已取消" },
    });
    await taskPromise;
  });
});

describe("handleCoworkTask parallel routing", () => {
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
      taskId: "sub-seq",
      status: "completed",
      templateId: "doc-convert",
      templateName: "文档格式转换",
      result: {
        summary: "OK",
        artifacts: [],
        toolsUsed: [],
        iterationCount: 1,
        tokenCount: 100,
      },
    });

    runCoworkTaskParallel.mockResolvedValue({
      taskId: "orch-par",
      status: "completed",
      templateId: "web-research",
      templateName: "信息检索与调研",
      parallel: true,
      result: {
        summary: "并行完成",
        artifacts: [],
        toolsUsed: [],
        iterationCount: 2,
        tokenCount: 500,
        subtaskCount: 3,
      },
    });

    getTemplate.mockReturnValue({
      id: "doc-convert",
      name: "文档格式转换",
      parallelStrategy: "none",
    });
  });

  it("uses runCoworkTask when parallel not requested", async () => {
    await handleCoworkTask(server, "req-seq", ws, {
      userMessage: "转换文档",
    });

    expect(runCoworkTask).toHaveBeenCalled();
    expect(runCoworkTaskParallel).not.toHaveBeenCalled();
  });

  it("uses runCoworkTaskParallel when message.parallel is true", async () => {
    await handleCoworkTask(server, "req-par", ws, {
      userMessage: "并行调研",
      parallel: true,
    });

    expect(runCoworkTaskParallel).toHaveBeenCalled();
    expect(runCoworkTask).not.toHaveBeenCalled();
  });

  it("uses parallel when template.parallelStrategy is 'always'", async () => {
    getTemplate.mockReturnValue({
      id: "web-research",
      name: "信息检索与调研",
      parallelStrategy: "always",
    });

    await handleCoworkTask(server, "req-always", ws, {
      templateId: "web-research",
      userMessage: "调研",
    });

    expect(runCoworkTaskParallel).toHaveBeenCalled();
  });

  it("does NOT use parallel when message.parallel is false even with always strategy", async () => {
    getTemplate.mockReturnValue({
      id: "web-research",
      name: "信息检索与调研",
      parallelStrategy: "always",
    });

    await handleCoworkTask(server, "req-no", ws, {
      templateId: "web-research",
      userMessage: "调研",
      parallel: false,
    });

    expect(runCoworkTask).toHaveBeenCalled();
    expect(runCoworkTaskParallel).not.toHaveBeenCalled();
  });

  it("passes agents count to parallel runner", async () => {
    await handleCoworkTask(server, "req-agents", ws, {
      userMessage: "并行任务",
      parallel: true,
      agents: 5,
    });

    expect(runCoworkTaskParallel).toHaveBeenCalledWith(
      expect.objectContaining({ agents: 5 }),
    );
  });

  it("includes parallel and subtaskCount in cowork:done", async () => {
    await handleCoworkTask(server, "req-done", ws, {
      userMessage: "并行任务",
      parallel: true,
    });

    const doneCall = server._send.mock.calls.find(
      (c) => c[1].type === "cowork:done",
    );
    expect(doneCall[1].parallel).toBe(true);
    expect(doneCall[1].subtaskCount).toBe(3);
  });
});

describe("handleCoworkTask debate routing", () => {
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
      taskId: "sub-seq",
      status: "completed",
      templateId: "doc-convert",
      templateName: "文档格式转换",
      result: {
        summary: "OK",
        artifacts: [],
        toolsUsed: [],
        iterationCount: 1,
        tokenCount: 0,
      },
    });

    runCoworkDebate.mockResolvedValue({
      taskId: "cowork-debate-1",
      status: "completed",
      templateId: "code-review",
      templateName: "代码评审",
      mode: "debate",
      result: {
        summary: "Overall NEEDS_WORK due to security concern.",
        verdict: "NEEDS_WORK",
        consensusScore: 70,
        reviews: [
          {
            perspective: "security",
            role: "Security Reviewer",
            review: "Issue",
            verdict: "NEEDS_WORK",
          },
        ],
        perspectives: ["security"],
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: 2,
      },
    });

    getTemplate.mockReturnValue({
      id: "doc-convert",
      name: "文档格式转换",
      parallelStrategy: "none",
    });
  });

  it("uses runCoworkDebate when message.mode is 'debate'", async () => {
    await handleCoworkTask(server, "req-d1", ws, {
      userMessage: "review this code",
      mode: "debate",
    });

    expect(runCoworkDebate).toHaveBeenCalled();
    expect(runCoworkTask).not.toHaveBeenCalled();
  });

  it("uses debate when template.mode is 'debate'", async () => {
    getTemplate.mockReturnValue({
      id: "code-review",
      name: "代码评审",
      mode: "debate",
      parallelStrategy: "none",
    });

    await handleCoworkTask(server, "req-d2", ws, {
      templateId: "code-review",
      userMessage: "审一下",
    });

    expect(runCoworkDebate).toHaveBeenCalled();
  });

  it("passes perspectives override to debate runner", async () => {
    await handleCoworkTask(server, "req-d3", ws, {
      userMessage: "review",
      mode: "debate",
      perspectives: ["architecture", "security"],
    });

    expect(runCoworkDebate).toHaveBeenCalledWith(
      expect.objectContaining({ perspectives: ["architecture", "security"] }),
    );
  });

  it("includes verdict, consensusScore, reviews in cowork:done", async () => {
    await handleCoworkTask(server, "req-d4", ws, {
      userMessage: "review",
      mode: "debate",
    });

    const doneCall = server._send.mock.calls.find(
      (c) => c[1].type === "cowork:done",
    );
    expect(doneCall[1].mode).toBe("debate");
    expect(doneCall[1].verdict).toBe("NEEDS_WORK");
    expect(doneCall[1].consensusScore).toBe(70);
    expect(doneCall[1].reviews).toHaveLength(1);
  });

  it("includes mode:debate in cowork:started", async () => {
    await handleCoworkTask(server, "req-d5", ws, {
      userMessage: "review",
      mode: "debate",
    });

    const startedCall = server._send.mock.calls.find(
      (c) => c[1].type === "cowork:started",
    );
    expect(startedCall[1].mode).toBe("debate");
  });

  it("debate takes precedence over parallel when both requested", async () => {
    getTemplate.mockReturnValue({
      id: "code-review",
      name: "代码评审",
      mode: "debate",
      parallelStrategy: "always",
    });

    await handleCoworkTask(server, "req-d6", ws, {
      templateId: "code-review",
      userMessage: "审",
    });

    expect(runCoworkDebate).toHaveBeenCalled();
    expect(runCoworkTaskParallel).not.toHaveBeenCalled();
  });

  it("message.mode='agent' overrides template debate mode", async () => {
    getTemplate.mockReturnValue({
      id: "code-review",
      name: "代码评审",
      mode: "debate",
      parallelStrategy: "none",
    });

    await handleCoworkTask(server, "req-d7", ws, {
      templateId: "code-review",
      userMessage: "审",
      mode: "agent",
    });

    expect(runCoworkTask).toHaveBeenCalled();
    expect(runCoworkDebate).not.toHaveBeenCalled();
  });
});
