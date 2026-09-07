import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const handlers = new Map();
const electronStub = {
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel),
  },
  dialog: { showOpenDialog: vi.fn() },
};
const electronPath = require.resolve("electron");
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: electronStub,
};

describe("video:generate IPC governed ingress", () => {
  let mainWindow;

  beforeEach(() => {
    handlers.clear();
    mainWindow = { webContents: { send: vi.fn() } };
    const { registerVideoIPC } = require("../../src/main/video/video-ipc.js");
    registerVideoIPC({ videoImporter: null, mainWindow, llmManager: null });
  });

  it("registers and fails closed before emitting generation progress", async () => {
    expect(handlers.has("video:generate")).toBe(true);
    await expect(
      handlers.get("video:generate")(null, {
        prompt: "private video prompt",
        outputPath: "/private/out.mp4",
      }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
  });
});
