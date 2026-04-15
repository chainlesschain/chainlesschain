/**
 * E2E test: full renderer → preload → ipcMain → provider → file write.
 * Uses the real preload `window.api.video.generate` wiring pattern,
 * plus a simulated ipcRenderer.invoke that dispatches into the main-side
 * handler registered by registerVideoIPC. Real network is never touched —
 * provider.fetch is stubbed per the "no real video API tests" rule.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

vi.mock("../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const mainHandlers = new Map();
const rendererListeners = new Map();

const electronStub = {
  ipcMain: {
    handle: (ch, fn) => mainHandlers.set(ch, fn),
    removeHandler: (ch) => mainHandlers.delete(ch),
  },
  dialog: { showOpenDialog: vi.fn() },
};
require.cache[require.resolve("electron")] = {
  id: require.resolve("electron"),
  filename: require.resolve("electron"),
  loaded: true,
  exports: electronStub,
};

// Simulate what preload exposes. Mirrors `contextBridge.exposeInMainWorld("api", ...)`
// from src/preload/index.js for the video.generate slice.
function createRendererApi(mainWindow) {
  const ipcRenderer = {
    invoke: async (ch, arg) => {
      const fn = mainHandlers.get(ch);
      if (!fn) {
        throw new Error(`no handler for ${ch}`);
      }
      return fn(null, arg);
    },
    on: (ch, cb) => {
      if (!rendererListeners.has(ch)) {
        rendererListeners.set(ch, new Set());
      }
      rendererListeners.get(ch).add(cb);
    },
    removeListener: (ch, cb) => rendererListeners.get(ch)?.delete(cb),
  };
  // Hook mainWindow.webContents.send to fan out to listeners
  mainWindow.webContents.send = (ch, payload) => {
    rendererListeners.get(ch)?.forEach((cb) => cb(null, payload));
  };
  return {
    video: {
      generate: (params) => ipcRenderer.invoke("video:generate", params),
      onGenerateProgress: (cb) => {
        const h = (_e, p) => cb(p);
        ipcRenderer.on("video:generate:progress", h);
        return () => ipcRenderer.removeListener("video:generate:progress", h);
      },
    },
  };
}

describe("video:generate E2E (renderer → ipc → provider → file)", () => {
  let tmpDir;
  let api;
  let provider;
  let generator;
  let mainWindow;

  beforeEach(() => {
    mainHandlers.clear();
    rendererListeners.clear();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-e2e-"));

    mainWindow = { webContents: { send: () => {} } };
    provider = require("../../src/main/video/providers/volcengine-video.js");
    generator = require("../../src/main/video/video-generator.js");
    generator._deps.getLLMConfig = () => ({
      volcengine: {
        apiKey: "e2e-key",
        baseURL: "https://ark.example/api/v3",
        videoModel: "doubao-seedance-1.0-lite",
      },
    });
    provider._deps.sleep = () => Promise.resolve();

    const { registerVideoIPC } = require("../../src/main/video/video-ipc.js");
    registerVideoIPC({ videoImporter: null, mainWindow, llmManager: null });

    api = createRendererApi(mainWindow);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("renderer call writes a real mp4 and receives progress events", async () => {
    const bytes = Buffer.from("MP4-BODY".repeat(500));
    const responses = [
      { body: { id: "e2e-1" } },
      { body: { status: "queued" } },
      {
        body: {
          status: "succeeded",
          content: { video_url: "https://cdn.example/v.mp4" },
        },
      },
      { bytes },
    ];
    provider._deps.fetch = async () => {
      const r = responses.shift();
      return {
        ok: r.ok !== false,
        status: r.status || 200,
        async json() {
          return r.body;
        },
        async text() {
          return JSON.stringify(r.body);
        },
        async arrayBuffer() {
          return r.bytes
            ? r.bytes.buffer.slice(
                r.bytes.byteOffset,
                r.bytes.byteOffset + r.bytes.byteLength,
              )
            : new ArrayBuffer(0);
        },
      };
    };

    const events = [];
    const unsubscribe = api.video.onGenerateProgress((p) => events.push(p));

    const out = path.join(tmpDir, "e2e-promo.mp4");
    const result = await api.video.generate({
      prompt: "mountain lake timelapse",
      outputPath: out,
      ratio: "16:9",
      duration: 5,
    });

    expect(result.taskId).toBe("e2e-1");
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.statSync(out).size).toBe(bytes.length);
    expect(events.map((e) => e.stage)).toContain("complete");
    unsubscribe();
    // After unsubscribe no further events fire
    const countBefore = events.length;
    mainWindow.webContents.send("video:generate:progress", { stage: "ghost" });
    expect(events.length).toBe(countBefore);
  });

  it("surfaces timeout / failed-task errors back to renderer", async () => {
    provider._deps.fetch = async () => ({
      ok: true,
      status: 200,
      async json() {
        return { id: "e2e-2", status: "failed", error: { message: "nope" } };
      },
      async text() {
        return "{}";
      },
      async arrayBuffer() {
        return new ArrayBuffer(0);
      },
    });
    // Provide enough responses: createTask → poll (fails)
    const responses = [
      { body: { id: "e2e-2" } },
      {
        body: {
          status: "failed",
          error: { code: "SensitiveContent", message: "nope" },
        },
      },
    ];
    provider._deps.fetch = async () => {
      const r = responses.shift();
      return {
        ok: true,
        status: 200,
        async json() {
          return r.body;
        },
        async text() {
          return JSON.stringify(r.body);
        },
      };
    };
    await expect(
      api.video.generate({
        prompt: "x",
        outputPath: path.join(tmpDir, "x.mp4"),
      }),
    ).rejects.toThrow(/failed.*nope/);
  });
});
