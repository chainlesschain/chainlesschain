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
  let authorization;
  let outputResolver;
  let pptLease;
  let wordLease;

  const pptRequest = () => ({
    projectId: "project-123",
    outline: {
      title: "Launch",
      subtitle: "Plan",
      sections: [
        {
          title: "Overview",
          subsections: [{ title: "Intro", points: ["First point"] }],
        },
      ],
    },
  });

  const wordRequest = () => ({
    projectId: "project-123",
    structure: {
      title: "Plan",
      paragraphs: [{ text: "a" }, { text: "b" }],
    },
  });

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
    };
    authorization = {
      authorize: vi.fn(async (_event, operation) =>
        Object.freeze({
          actorDid: "did:key:operator",
          operation,
          purpose:
            operation === "generate-ppt"
              ? "project-presentation-generate"
              : "project-document-generate",
          senderId: 17,
          tenantId: "tenant:alpha",
        }),
      ),
    };
    pptLease = {
      fileName: "Launch.pptx",
      outputPath: "/managed/Launch.pptx",
      commit: vi.fn(async () => Object.freeze({ fileSize: 4096 })),
      cleanup: vi.fn(async () => {}),
    };
    wordLease = {
      fileName: "Plan.docx",
      outputPath: "/managed/Plan.docx",
      commit: vi.fn(async () => Object.freeze({ fileSize: 2048 })),
      cleanup: vi.fn(async () => {}),
    };
    outputResolver = {
      reserve: vi.fn(async (_context, request) =>
        request.extension === ".pptx" ? pptLease : wordLease,
      ),
    };
    instance = new AIEngineIPC(null, null, null, null, null, {
      ipcMain: ipcMainMock,
      runtime,
      authorization,
      outputResolver,
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
      { marker: "ppt-event" },
      pptRequest(),
    );

    expect(authorization.authorize).toHaveBeenCalledWith(
      { marker: "ppt-event" },
      "generate-ppt",
    );
    expect(runtime.createPPTEngine).toHaveBeenCalledOnce();
    expect(outputResolver.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        actorDid: "did:key:operator",
        tenantId: "tenant:alpha",
      }),
      {
        projectId: "project-123",
        title: "Launch",
        extension: ".pptx",
      },
    );
    expect(pptEngine.generateFromOutline).toHaveBeenCalledWith(
      {
        title: "Launch",
        subtitle: "Plan",
        sections: [
          {
            title: "Overview",
            subsections: [{ title: "Intro", points: ["First point"] }],
          },
        ],
      },
      {
        theme: "business",
        author: "作者",
        outputPath: "/managed/Launch.pptx",
      },
    );
    expect(pptLease.commit).toHaveBeenCalledOnce();
    expect(result).toEqual({
      success: true,
      fileName: "Launch.pptx",
      path: "/managed/Launch.pptx",
      slideCount: 8,
    });
  });

  it("projects Word output and normalizes counts", async () => {
    instance.registerHandlers(null);

    const result = await ipcMainMock.handlers["aiEngine:generateWord"](
      { marker: "word-event" },
      wordRequest(),
    );

    expect(authorization.authorize).toHaveBeenCalledWith(
      { marker: "word-event" },
      "generate-word",
    );
    expect(runtime.wordEngine.writeWord).toHaveBeenCalledWith(
      "/managed/Plan.docx",
      {
        title: "Plan",
        paragraphs: [
          { text: "a", style: {}, spacing: { after: 200 } },
          { text: "b", style: {}, spacing: { after: 200 } },
        ],
      },
    );
    expect(wordLease.commit).toHaveBeenCalledOnce();
    expect(result).toEqual({
      success: true,
      fileName: "Plan.docx",
      path: "/managed/Plan.docx",
      fileSize: 2048,
      paragraphCount: 2,
    });
  });

  it("returns fixed failures without exposing exception details", async () => {
    pptEngine.generateFromOutline.mockRejectedValueOnce(
      new Error("secret path C:/users/private/slides.pptx"),
    );
    instance.registerHandlers(null);

    const result = await ipcMainMock.handlers["aiEngine:generatePPT"](
      {},
      pptRequest(),
    );

    expect(result).toEqual({
      success: false,
      code: "AI_ENGINE_OPERATION_FAILED",
      error: "AI engine operation failed",
    });
    expect(pptLease.cleanup).toHaveBeenCalledOnce();
  });

  it("uses stable output metadata when generators omit optional metadata", async () => {
    pptEngine.generateFromOutline.mockResolvedValueOnce({});
    runtime.wordEngine.writeWord.mockResolvedValueOnce({});
    instance.registerHandlers(null);

    await expect(
      ipcMainMock.handlers["aiEngine:generatePPT"]({}, pptRequest()),
    ).resolves.toEqual({
      success: true,
      fileName: "Launch.pptx",
      path: "/managed/Launch.pptx",
      slideCount: 0,
    });
    await expect(
      ipcMainMock.handlers["aiEngine:generateWord"]({}, wordRequest()),
    ).resolves.toEqual({
      success: true,
      fileName: "Plan.docx",
      path: "/managed/Plan.docx",
      fileSize: 2048,
      paragraphCount: 2,
    });
  });

  it("fails closed before constructing an engine when authorization is denied", async () => {
    authorization.authorize.mockRejectedValueOnce(new Error("private policy"));
    instance.registerHandlers(null);

    await expect(
      ipcMainMock.handlers["aiEngine:generatePPT"]({}, pptRequest()),
    ).resolves.toEqual({
      success: false,
      code: "AI_ENGINE_OPERATION_FAILED",
      error: "AI engine operation failed",
    });
    expect(runtime.createPPTEngine).not.toHaveBeenCalled();
    expect(outputResolver.reserve).not.toHaveBeenCalled();
  });

  it("rejects invalid input before constructing an engine", async () => {
    instance.registerHandlers(null);

    await expect(
      ipcMainMock.handlers["aiEngine:generatePPT"](
        {},
        {
          ...pptRequest(),
          debug: true,
        },
      ),
    ).resolves.toEqual({
      success: false,
      code: "AI_ENGINE_OPERATION_FAILED",
      error: "AI engine operation failed",
    });
    expect(runtime.createPPTEngine).not.toHaveBeenCalled();
    expect(outputResolver.reserve).not.toHaveBeenCalled();
  });

  it("builds production authorization from the live window and identity providers", async () => {
    const mainFrame = {
      parent: null,
      url: "http://localhost:5173/#/projects/current",
    };
    const webContents = { id: 31, mainFrame };
    const mainWindow = { webContents };
    const authorizePurpose = vi.fn(async () => true);
    const productionInstance = new AIEngineIPC(null, null, null, null, null, {
      ipcMain: ipcMainMock,
      runtime,
      getMainWindow: () => mainWindow,
      getCurrentIdentity: () => ({
        did: "did:key:operator",
        tenantId: "tenant:alpha",
      }),
      authorizePurpose,
      outputResolver,
    });
    productionInstance.registerHandlers(mainWindow);

    await expect(
      ipcMainMock.handlers["aiEngine:generatePPT"](
        { sender: webContents, senderFrame: mainFrame },
        pptRequest(),
      ),
    ).resolves.toMatchObject({ success: true, fileName: "Launch.pptx" });
    expect(authorizePurpose).toHaveBeenCalledWith({
      actorDid: "did:key:operator",
      operation: "generate-ppt",
      purpose: "project-presentation-generate",
      senderId: 31,
      tenantId: "tenant:alpha",
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
