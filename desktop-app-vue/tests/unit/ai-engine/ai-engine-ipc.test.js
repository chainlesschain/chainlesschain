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
  let pptEngine;
  let runtime;
  let instance;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcMainMock = createMockIpcMain();
    pptEngine = {
      generateFromOutline: vi.fn().mockResolvedValue({
        filePath: "/tmp/slides.pptx",
        slideCount: 8,
        internalMetadata: "must-not-cross-ipc",
      }),
    };
    runtime = {
      createPPTEngine: vi.fn(() => pptEngine),
      wordEngine: {
        writeWord: vi.fn().mockResolvedValue({
          filePath: "/tmp/plan.docx",
          fileSize: 2048,
          internalMetadata: "must-not-cross-ipc",
        }),
      },
      path: {
        basename: vi.fn((filePath) => filePath.split("/").pop()),
      },
    };
    instance = new AIEngineIPC(null, null, null, null, null, {
      ipcMain: ipcMainMock,
      runtime,
    });
  });

  it("registers only the two renderer-consumed document generators", () => {
    const registration = instance.registerHandlers(null);

    expect(AI_ENGINE_IPC_CHANNELS).toEqual([
      "aiEngine:generatePPT",
      "aiEngine:generateWord",
    ]);
    expect(Object.keys(ipcMainMock.handlers)).toEqual(AI_ENGINE_IPC_CHANNELS);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledTimes(2);
    expect(registration).toEqual({ handlerCount: 2 });
  });

  it("projects PPT output to the fields consumed by the renderer", async () => {
    instance.registerHandlers(null);

    const result = await ipcMainMock.handlers["aiEngine:generatePPT"](
      {},
      {
        outline: ["Intro"],
        outputPath: "/tmp/requested.pptx",
      },
    );

    expect(runtime.createPPTEngine).toHaveBeenCalledOnce();
    expect(pptEngine.generateFromOutline).toHaveBeenCalledWith(["Intro"], {
      theme: "business",
      author: "作者",
      outputPath: "/tmp/requested.pptx",
    });
    expect(result).toEqual({
      success: true,
      fileName: "slides.pptx",
      path: "/tmp/slides.pptx",
      slideCount: 8,
    });
  });

  it("projects Word output and normalizes counts", async () => {
    instance.registerHandlers(null);

    const result = await ipcMainMock.handlers["aiEngine:generateWord"](
      {},
      {
        outputPath: "/tmp/requested.docx",
        structure: { paragraphs: [{ text: "a" }, { text: "b" }] },
      },
    );

    expect(runtime.wordEngine.writeWord).toHaveBeenCalledWith(
      "/tmp/requested.docx",
      { paragraphs: [{ text: "a" }, { text: "b" }] },
    );
    expect(result).toEqual({
      success: true,
      fileName: "plan.docx",
      path: "/tmp/plan.docx",
      fileSize: 2048,
      paragraphCount: 2,
    });
  });

  it("returns fixed failures without exposing exception details", async () => {
    pptEngine.generateFromOutline.mockRejectedValueOnce(
      new Error("secret path C:/users/private/slides.pptx"),
    );
    instance.registerHandlers(null);

    const result = await ipcMainMock.handlers["aiEngine:generatePPT"]({}, {});

    expect(result).toEqual({
      success: false,
      code: "AI_ENGINE_OPERATION_FAILED",
      error: "AI engine operation failed",
    });
  });

  it("uses stable defaults when generators omit optional metadata", async () => {
    pptEngine.generateFromOutline.mockResolvedValueOnce({});
    runtime.wordEngine.writeWord.mockResolvedValueOnce({});
    instance.registerHandlers(null);

    await expect(
      ipcMainMock.handlers["aiEngine:generatePPT"](
        {},
        {
          outputPath: "/tmp/fallback.pptx",
        },
      ),
    ).resolves.toEqual({
      success: true,
      fileName: "fallback.pptx",
      path: "/tmp/fallback.pptx",
      slideCount: 0,
    });
    await expect(
      ipcMainMock.handlers["aiEngine:generateWord"](
        {},
        {
          outputPath: "/tmp/fallback.docx",
        },
      ),
    ).resolves.toEqual({
      success: true,
      fileName: "fallback.docx",
      path: "/tmp/fallback.docx",
      fileSize: 0,
      paragraphCount: 0,
    });
  });

  it("tolerates IPC cleanup edge cases and unregisters symmetrically", () => {
    expect(() =>
      instance.registerHandlers(null, {
        ipcMain: { handle: vi.fn(), removeHandler: undefined },
      }),
    ).not.toThrow();
    expect(() =>
      instance.registerHandlers(null, {
        ipcMain: {
          handle: vi.fn(),
          removeHandler: vi.fn(() => {
            throw new Error("missing");
          }),
        },
      }),
    ).not.toThrow();

    const testIpc = createMockIpcMain();
    instance.unregisterHandlers({ ipcMain: testIpc });
    expect(testIpc.removeHandler).toHaveBeenCalledTimes(2);
  });
});
