import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const AIEngineIPC = require("../../../src/main/ai-engine/ai-engine-ipc.js");
const { AI_ENGINE_IPC_CHANNELS } = AIEngineIPC;

function createMockIpcMain() {
  const handlers = {};
  return {
    handlers,
    handle: vi.fn((channel, handler) => {
      handlers[channel] = handler;
    }),
    removeHandler: vi.fn((channel) => {
      delete handlers[channel];
    }),
  };
}

describe("ai-engine-ipc", () => {
  let ipcMainMock;
  let mainWindow;
  let aiEngineManager;
  let webEngineManager;
  let documentEngineManager;
  let dataEngineManager;
  let gitAutoCommit;
  let runtime;
  let pptEngine;
  let instance;

  beforeEach(() => {
    ipcMainMock = createMockIpcMain();
    mainWindow = {
      webContents: {
        send: vi.fn(),
      },
    };

    aiEngineManager = {
      processUserInput: vi.fn().mockImplementation(async (input, context, onStepUpdate) => {
        onStepUpdate({ step: "thinking", input, context });
        return { output: "done" };
      }),
      getExecutionHistory: vi.fn().mockReturnValue([{ id: "run-1" }]),
      clearHistory: vi.fn(),
      getAvailableTools: vi.fn().mockReturnValue(["search", "write"]),
    };

    webEngineManager = {
      generateProject: vi.fn().mockResolvedValue({ projectPath: "/tmp/site" }),
      getTemplates: vi.fn().mockReturnValue(["landing"]),
      startPreview: vi.fn().mockResolvedValue({ url: "http://localhost:5173" }),
      stopPreview: vi.fn().mockResolvedValue({ stopped: true }),
      restartPreview: vi.fn().mockResolvedValue({ restarted: true }),
      getPreviewStatus: vi.fn().mockReturnValue({ running: true, port: 5173 }),
      changePreviewPort: vi.fn().mockResolvedValue({ port: 4173 }),
    };

    documentEngineManager = {
      generateDocument: vi.fn().mockResolvedValue({ outputPath: "/tmp/doc.docx" }),
      getTemplates: vi.fn().mockReturnValue(["report"]),
    };

    dataEngineManager = {
      readCSV: vi.fn().mockResolvedValue({ rows: 2 }),
      writeCSV: vi.fn().mockResolvedValue({ written: true }),
      readExcel: vi.fn().mockResolvedValue({ sheets: 1 }),
      writeExcel: vi.fn().mockResolvedValue({ written: true }),
      analyzeData: vi.fn().mockReturnValue({ summary: "ok" }),
      generateChart: vi.fn().mockResolvedValue({ filePath: "/tmp/chart.png" }),
      generateReport: vi.fn().mockResolvedValue({ filePath: "/tmp/report.pdf" }),
    };

    gitAutoCommit = {
      start: vi.fn(),
      stop: vi.fn(),
      stopAll: vi.fn(),
      setInterval: vi.fn(),
      setEnabled: vi.fn(),
      getWatchedProjects: vi.fn().mockReturnValue(["project-1"]),
    };

    pptEngine = {
      generateFromOutline: vi
        .fn()
        .mockResolvedValue({ filePath: "/tmp/slides.pptx", slideCount: 8 }),
    };

    runtime = {
      createIntentLLMManager: vi.fn().mockResolvedValue({ id: "llm-1" }),
      recognizeProjectIntent: vi
        .fn()
        .mockResolvedValue({ success: true, intent: "create-project" }),
      createPPTEngine: vi.fn(() => pptEngine),
      wordEngine: {
        writeWord: vi.fn().mockResolvedValue({
          filePath: "/tmp/plan.docx",
          fileSize: 2048,
        }),
      },
      path: {
        basename: vi.fn((filePath) => filePath.split("/").pop()),
      },
    };

    instance = new AIEngineIPC(
      aiEngineManager,
      webEngineManager,
      documentEngineManager,
      dataEngineManager,
      gitAutoCommit,
      { ipcMain: ipcMainMock, runtime },
    );

    instance.registerHandlers(mainWindow);
  });

  it("registers all channels and clears stale handlers", () => {
    expect(Object.keys(ipcMainMock.handlers)).toHaveLength(AI_ENGINE_IPC_CHANNELS.length);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledTimes(AI_ENGINE_IPC_CHANNELS.length);
    expect(ipcMainMock.handlers["ai:processInput"]).toBeTypeOf("function");
  });

  it("handles core AI engine handlers", async () => {
    const processResult = await ipcMainMock.handlers["ai:processInput"]({}, {
      input: "build a plan",
      context: { repo: "chainlesschain" },
    });
    expect(aiEngineManager.processUserInput).toHaveBeenCalledWith(
      "build a plan",
      { repo: "chainlesschain" },
      expect.any(Function),
    );
    expect(mainWindow.webContents.send).toHaveBeenCalledWith("ai:stepUpdate", {
      step: "thinking",
      input: "build a plan",
      context: { repo: "chainlesschain" },
    });
    expect(processResult).toEqual({
      success: true,
      result: { output: "done" },
    });

    const historyResult = await ipcMainMock.handlers["ai:getHistory"]({}, 25);
    expect(aiEngineManager.getExecutionHistory).toHaveBeenCalledWith(25);
    expect(historyResult.history).toEqual([{ id: "run-1" }]);

    const clearResult = await ipcMainMock.handlers["ai:clearHistory"]({});
    expect(aiEngineManager.clearHistory).toHaveBeenCalled();
    expect(clearResult).toEqual({ success: true });

    const toolsResult = await ipcMainMock.handlers["ai:getAvailableTools"]({});
    expect(aiEngineManager.getAvailableTools).toHaveBeenCalled();
    expect(toolsResult.tools).toEqual(["search", "write"]);
  });

  it("handles web-engine, document-engine, and data-engine handlers", async () => {
    await expect(
      ipcMainMock.handlers["web-engine:generate"]({}, { name: "site" }),
    ).resolves.toEqual({
      success: true,
      projectPath: "/tmp/site",
    });
    expect(webEngineManager.generateProject).toHaveBeenCalledWith({ name: "site" });

    await expect(ipcMainMock.handlers["web-engine:getTemplates"]({})).resolves.toEqual({
      success: true,
      templates: ["landing"],
    });

    await expect(
      ipcMainMock.handlers["web-engine:startPreview"]({}, "/tmp/site", 5173),
    ).resolves.toEqual({
      success: true,
      url: "http://localhost:5173",
    });
    expect(webEngineManager.startPreview).toHaveBeenCalledWith("/tmp/site", 5173);

    await expect(ipcMainMock.handlers["web-engine:stopPreview"]({})).resolves.toEqual({
      success: true,
      stopped: true,
    });
    await expect(
      ipcMainMock.handlers["web-engine:restartPreview"]({}, "/tmp/site"),
    ).resolves.toEqual({
      success: true,
      restarted: true,
    });
    await expect(
      ipcMainMock.handlers["web-engine:getPreviewStatus"]({}),
    ).resolves.toEqual({
      success: true,
      running: true,
      port: 5173,
    });
    await expect(
      ipcMainMock.handlers["web-engine:changePreviewPort"]({}, 4173),
    ).resolves.toEqual({
      success: true,
      port: 4173,
    });

    await expect(
      ipcMainMock.handlers["document-engine:generate"]({}, { title: "Plan" }),
    ).resolves.toEqual({
      success: true,
      outputPath: "/tmp/doc.docx",
    });
    await expect(
      ipcMainMock.handlers["document-engine:getTemplates"]({}),
    ).resolves.toEqual({
      success: true,
      templates: ["report"],
    });

    await expect(ipcMainMock.handlers["data-engine:readCSV"]({}, "/tmp/a.csv")).resolves.toEqual({
      success: true,
      rows: 2,
    });
    await expect(
      ipcMainMock.handlers["data-engine:writeCSV"]({}, "/tmp/a.csv", [{ id: 1 }]),
    ).resolves.toEqual({
      success: true,
      written: true,
    });
    await expect(
      ipcMainMock.handlers["data-engine:readExcel"]({}, "/tmp/a.xlsx"),
    ).resolves.toEqual({
      success: true,
      sheets: 1,
    });
    await expect(
      ipcMainMock.handlers["data-engine:writeExcel"]({}, "/tmp/a.xlsx", [{ id: 1 }]),
    ).resolves.toEqual({
      success: true,
      written: true,
    });
    await expect(
      ipcMainMock.handlers["data-engine:analyze"]({}, [{ id: 1 }], { mode: "quick" }),
    ).resolves.toEqual({
      success: true,
      summary: "ok",
    });
    await expect(
      ipcMainMock.handlers["data-engine:generateChart"]({}, [{ id: 1 }], { type: "bar" }),
    ).resolves.toEqual({
      success: true,
      filePath: "/tmp/chart.png",
    });
    await expect(
      ipcMainMock.handlers["data-engine:generateReport"]({}, { summary: "ok" }, "/tmp/report.pdf"),
    ).resolves.toEqual({
      success: true,
      filePath: "/tmp/report.pdf",
    });
  });

  it("handles git automation and runtime-backed AI engine handlers", async () => {
    await expect(
      ipcMainMock.handlers["git-auto-commit:start"]({}, "project-1", "/repo"),
    ).resolves.toEqual({ success: true });
    expect(gitAutoCommit.start).toHaveBeenCalledWith("project-1", "/repo");

    await expect(
      ipcMainMock.handlers["git-auto-commit:stop"]({}, "project-1"),
    ).resolves.toEqual({ success: true });
    expect(gitAutoCommit.stop).toHaveBeenCalledWith("project-1");

    await expect(ipcMainMock.handlers["git-auto-commit:stopAll"]({})).resolves.toEqual({
      success: true,
    });
    expect(gitAutoCommit.stopAll).toHaveBeenCalled();

    await expect(
      ipcMainMock.handlers["git-auto-commit:setInterval"]({}, 30000),
    ).resolves.toEqual({ success: true });
    expect(gitAutoCommit.setInterval).toHaveBeenCalledWith(30000);

    await expect(
      ipcMainMock.handlers["git-auto-commit:setEnabled"]({}, true),
    ).resolves.toEqual({ success: true });
    expect(gitAutoCommit.setEnabled).toHaveBeenCalledWith(true);

    await expect(
      ipcMainMock.handlers["git-auto-commit:getWatchedProjects"]({}),
    ).resolves.toEqual({
      success: true,
      projects: ["project-1"],
    });

    const intentResult = await ipcMainMock.handlers["aiEngine:recognizeIntent"](
      {},
      "create a roadmap",
    );
    expect(runtime.createIntentLLMManager).toHaveBeenCalled();
    expect(runtime.recognizeProjectIntent).toHaveBeenCalledWith("create a roadmap", {
      id: "llm-1",
    });
    expect(intentResult).toEqual({
      success: true,
      intent: "create-project",
    });

    const pptResult = await ipcMainMock.handlers["aiEngine:generatePPT"]({}, {
      outline: ["Intro"],
      outputPath: "/tmp/slides.pptx",
    });
    expect(runtime.createPPTEngine).toHaveBeenCalled();
    expect(pptEngine.generateFromOutline).toHaveBeenCalledWith(["Intro"], {
      theme: "business",
      author: "作者",
      outputPath: "/tmp/slides.pptx",
    });
    expect(pptResult.slideCount).toBe(8);

    const wordResult = await ipcMainMock.handlers["aiEngine:generateWord"]({}, {
      outputPath: "/tmp/plan.docx",
      structure: { paragraphs: [{ text: "a" }, { text: "b" }] },
    });
    expect(runtime.wordEngine.writeWord).toHaveBeenCalledWith("/tmp/plan.docx", {
      paragraphs: [{ text: "a" }, { text: "b" }],
    });
    expect(runtime.path.basename).toHaveBeenCalledWith("/tmp/plan.docx");
    expect(wordResult).toEqual({
      success: true,
      fileName: "plan.docx",
      path: "/tmp/plan.docx",
      fileSize: 2048,
      paragraphCount: 2,
    });
  });

  it("normalizes thrown handler errors", async () => {
    webEngineManager.generateProject.mockRejectedValueOnce(new Error("preview failed"));

    const result = await ipcMainMock.handlers["web-engine:generate"]({}, { name: "site" });
    expect(result).toEqual({
      success: false,
      error: "preview failed",
    });
  });

  it("tolerates IPC cleanup edge cases", () => {
    const handlersWithoutRemove = {};
    const instanceWithoutRemove = new AIEngineIPC(
      aiEngineManager,
      webEngineManager,
      documentEngineManager,
      dataEngineManager,
      gitAutoCommit,
    );
    expect(() =>
      instanceWithoutRemove.registerHandlers(mainWindow, {
        ipcMain: {
          handle: vi.fn((channel, handler) => {
            handlersWithoutRemove[channel] = handler;
          }),
          removeHandler: undefined,
        },
      }),
    ).not.toThrow();

    expect(() =>
      instanceWithoutRemove.registerHandlers(mainWindow, {
        ipcMain: {
          handle: vi.fn(),
          removeHandler: vi.fn(() => {
            throw new Error("missing");
          }),
        },
      }),
    ).not.toThrow();
  });

  it("unregisters all handlers", () => {
    const testIpc = createMockIpcMain();
    instance.unregisterHandlers({ ipcMain: testIpc });
    expect(testIpc.removeHandler).toHaveBeenCalledTimes(AI_ENGINE_IPC_CHANNELS.length);
  });
});
