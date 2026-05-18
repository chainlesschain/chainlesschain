/**
 * Phase 1.2 — fs.openDialog / fs.saveDialog handler unit tests.
 *
 * The handlers depend on Electron's `dialog` and `fs.promises`. Both are
 * injectable via the factory's `dialogModule` / `fsModule` options so we
 * never need to spin up Electron in vitest.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createFsOpenDialogHandler,
  createFsOpenDirectoryHandler,
  createFsSaveDialogHandler,
  READ_MAX_BYTES,
} from "../handlers/fs-handlers.js";

const FAKE_WINDOW = { id: "fake-bw" };

function makeOpenDialogModule(returnValue) {
  return {
    showOpenDialog: vi.fn().mockResolvedValue(returnValue),
    showSaveDialog: vi.fn(),
  };
}

function makeSaveDialogModule(returnValue) {
  return {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn().mockResolvedValue(returnValue),
  };
}

function makeFsModule(overrides = {}) {
  return {
    stat: vi.fn().mockResolvedValue({ size: 1234 }),
    readFile: vi.fn().mockResolvedValue("hello"),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("fs.openDialog handler", () => {
  it("returns {canceled:true} when the user dismisses the dialog", async () => {
    const handler = createFsOpenDialogHandler({
      mainWindow: FAKE_WINDOW,
      dialogModule: makeOpenDialogModule({ canceled: true, filePaths: [] }),
      fsModule: makeFsModule(),
    });
    const result = await handler({ id: "1", type: "fs.openDialog" });
    expect(result).toEqual({ canceled: true, path: null, content: null });
  });

  it("returns the file content when the user picks a small file", async () => {
    const fsModule = makeFsModule({
      stat: vi.fn().mockResolvedValue({ size: 5 }),
      readFile: vi.fn().mockResolvedValue("hello"),
    });
    const handler = createFsOpenDialogHandler({
      mainWindow: FAKE_WINDOW,
      dialogModule: makeOpenDialogModule({
        canceled: false,
        filePaths: ["/tmp/x.txt"],
      }),
      fsModule,
    });
    const result = await handler({ id: "2", type: "fs.openDialog" });
    expect(result).toEqual({
      canceled: false,
      path: "/tmp/x.txt",
      size: 5,
      content: "hello",
    });
    expect(fsModule.readFile).toHaveBeenCalledWith("/tmp/x.txt", "utf-8");
  });

  it("returns reason:too_large for files over the cap and skips readFile", async () => {
    const fsModule = makeFsModule({
      stat: vi.fn().mockResolvedValue({ size: READ_MAX_BYTES + 1 }),
      readFile: vi.fn(),
    });
    const handler = createFsOpenDialogHandler({
      mainWindow: FAKE_WINDOW,
      dialogModule: makeOpenDialogModule({
        canceled: false,
        filePaths: ["/tmp/huge.bin"],
      }),
      fsModule,
    });
    const result = await handler({ id: "3", type: "fs.openDialog" });
    expect(result).toMatchObject({
      canceled: false,
      path: "/tmp/huge.bin",
      content: null,
      reason: "too_large",
    });
    expect(fsModule.readFile).not.toHaveBeenCalled();
  });

  it("forwards user-provided filters to showOpenDialog", async () => {
    const dialogModule = makeOpenDialogModule({
      canceled: true,
      filePaths: [],
    });
    const handler = createFsOpenDialogHandler({
      mainWindow: FAKE_WINDOW,
      dialogModule,
      fsModule: makeFsModule(),
    });
    await handler({
      id: "4",
      type: "fs.openDialog",
      title: "Pick a markdown",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    expect(dialogModule.showOpenDialog).toHaveBeenCalledWith(
      FAKE_WINDOW,
      expect.objectContaining({
        title: "Pick a markdown",
        filters: [{ name: "Markdown", extensions: ["md"] }],
        properties: ["openFile"],
      }),
    );
  });

  it("throws main_window_unavailable when no mainWindow is available", async () => {
    const handler = createFsOpenDialogHandler({
      mainWindow: null,
      dialogModule: makeOpenDialogModule({ canceled: true, filePaths: [] }),
      fsModule: makeFsModule(),
    });
    await expect(handler({ id: "5", type: "fs.openDialog" })).rejects.toThrow(
      "main_window_unavailable",
    );
  });
});

describe("fs.saveDialog handler", () => {
  it("returns {canceled:true} when the user dismisses the dialog", async () => {
    const handler = createFsSaveDialogHandler({
      mainWindow: FAKE_WINDOW,
      dialogModule: makeSaveDialogModule({ canceled: true, filePath: null }),
      fsModule: makeFsModule(),
    });
    const result = await handler({
      id: "10",
      type: "fs.saveDialog",
      content: "data",
    });
    expect(result).toEqual({ canceled: true, path: null });
  });

  it("writes the supplied content to the chosen path and returns it", async () => {
    const fsModule = makeFsModule();
    const handler = createFsSaveDialogHandler({
      mainWindow: FAKE_WINDOW,
      dialogModule: makeSaveDialogModule({
        canceled: false,
        filePath: "/tmp/out.txt",
      }),
      fsModule,
    });
    const result = await handler({
      id: "11",
      type: "fs.saveDialog",
      content: "payload",
    });
    expect(result).toEqual({ canceled: false, path: "/tmp/out.txt" });
    expect(fsModule.writeFile).toHaveBeenCalledWith(
      "/tmp/out.txt",
      "payload",
      "utf-8",
    );
  });

  it("throws content_must_be_string if content is missing or non-string", async () => {
    const handler = createFsSaveDialogHandler({
      mainWindow: FAKE_WINDOW,
      dialogModule: makeSaveDialogModule({
        canceled: false,
        filePath: "/tmp/x.txt",
      }),
      fsModule: makeFsModule(),
    });
    await expect(handler({ id: "12", type: "fs.saveDialog" })).rejects.toThrow(
      "content_must_be_string",
    );
    await expect(
      handler({ id: "13", type: "fs.saveDialog", content: 123 }),
    ).rejects.toThrow("content_must_be_string");
  });

  it("throws main_window_unavailable when no mainWindow is available", async () => {
    const handler = createFsSaveDialogHandler({
      mainWindow: null,
      dialogModule: makeSaveDialogModule({
        canceled: true,
        filePath: null,
      }),
      fsModule: makeFsModule(),
    });
    await expect(
      handler({ id: "14", type: "fs.saveDialog", content: "x" }),
    ).rejects.toThrow("main_window_unavailable");
  });

  it("forwards defaultPath + filters to showSaveDialog", async () => {
    const dialogModule = makeSaveDialogModule({
      canceled: true,
      filePath: null,
    });
    const handler = createFsSaveDialogHandler({
      mainWindow: FAKE_WINDOW,
      dialogModule,
      fsModule: makeFsModule(),
    });
    await handler({
      id: "15",
      type: "fs.saveDialog",
      content: "x",
      title: "Save as",
      defaultPath: "/tmp/y.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    expect(dialogModule.showSaveDialog).toHaveBeenCalledWith(
      FAKE_WINDOW,
      expect.objectContaining({
        title: "Save as",
        defaultPath: "/tmp/y.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      }),
    );
  });
});

describe("fs.openDirectory handler", () => {
  it("returns {canceled:true} when the user dismisses the picker", async () => {
    const handler = createFsOpenDirectoryHandler({
      mainWindow: FAKE_WINDOW,
      dialogModule: makeOpenDialogModule({ canceled: true, filePaths: [] }),
      fsModule: makeFsModule(),
    });
    const result = await handler({ id: "20", type: "fs.openDirectory" });
    expect(result).toEqual({
      canceled: true,
      path: null,
      initialized: false,
    });
  });

  it("reports initialized:true when <dir>/.chainlesschain/config.json exists", async () => {
    const fsModule = makeFsModule({
      stat: vi.fn().mockResolvedValue({ isFile: () => true }),
    });
    const handler = createFsOpenDirectoryHandler({
      mainWindow: FAKE_WINDOW,
      dialogModule: makeOpenDialogModule({
        canceled: false,
        filePaths: ["/work/my-project"],
      }),
      fsModule,
    });
    const result = await handler({ id: "21", type: "fs.openDirectory" });
    expect(result.canceled).toBe(false);
    expect(result.path).toBe("/work/my-project");
    expect(result.initialized).toBe(true);
    // The stat call must target <dir>/.chainlesschain/config.json — never an
    // arbitrary path the SPA could request.
    expect(fsModule.stat).toHaveBeenCalledWith(
      expect.stringMatching(/\.chainlesschain[\\/]config\.json$/),
    );
  });

  it("reports initialized:false when stat ENOENTs", async () => {
    const fsModule = makeFsModule({
      stat: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
        ),
    });
    const handler = createFsOpenDirectoryHandler({
      mainWindow: FAKE_WINDOW,
      dialogModule: makeOpenDialogModule({
        canceled: false,
        filePaths: ["/work/empty-dir"],
      }),
      fsModule,
    });
    const result = await handler({ id: "22", type: "fs.openDirectory" });
    expect(result).toEqual({
      canceled: false,
      path: "/work/empty-dir",
      initialized: false,
    });
  });

  it("uses openDirectory property — never returns a file content blob", async () => {
    const dialogModule = makeOpenDialogModule({
      canceled: false,
      filePaths: ["/some/dir"],
    });
    const handler = createFsOpenDirectoryHandler({
      mainWindow: FAKE_WINDOW,
      dialogModule,
      fsModule: makeFsModule({
        stat: vi.fn().mockResolvedValue({ isFile: () => false }),
      }),
    });
    const result = await handler({ id: "23", type: "fs.openDirectory" });
    expect(dialogModule.showOpenDialog).toHaveBeenCalledWith(
      FAKE_WINDOW,
      expect.objectContaining({ properties: ["openDirectory"] }),
    );
    // Result shape must NOT include `content` — directory pickers don't read.
    expect(result).not.toHaveProperty("content");
    expect(result).not.toHaveProperty("size");
  });

  it("throws main_window_unavailable when no parent window is registered", async () => {
    const handler = createFsOpenDirectoryHandler({
      mainWindow: null,
      dialogModule: makeOpenDialogModule({}),
      fsModule: makeFsModule(),
    });
    await expect(
      handler({ id: "24", type: "fs.openDirectory" }),
    ).rejects.toThrow("main_window_unavailable");
  });
});
