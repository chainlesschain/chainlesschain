/**
 * Integration test: video:generate IPC handler end-to-end with mocked
 * Volcengine fetch. Verifies IPC registration, progress events, and
 * success payload propagation.
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

const handlers = new Map();
// Patch the CJS require cache so src/main/video/video-ipc.js picks up our stub
// when it `require("electron")`. vi.mock does not intercept CJS require from
// inlined source files (known Vitest limitation).
const electronStub = {
  ipcMain: {
    handle: (ch, fn) => handlers.set(ch, fn),
    removeHandler: (ch) => handlers.delete(ch),
  },
  dialog: { showOpenDialog: vi.fn() },
};
require.cache[require.resolve("electron")] = {
  id: require.resolve("electron"),
  filename: require.resolve("electron"),
  loaded: true,
  exports: electronStub,
};

describe("video:generate IPC integration", () => {
  let tmpDir;
  let sentEvents;
  let mainWindow;
  let provider;
  let generator;

  beforeEach(() => {
    handlers.clear();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-int-"));
    sentEvents = [];
    mainWindow = {
      webContents: { send: (ch, p) => sentEvents.push({ ch, p }) },
    };
    provider = require("../../src/main/video/providers/volcengine-video.js");
    generator = require("../../src/main/video/video-generator.js");
    generator._deps.getLLMConfig = () => ({
      volcengine: {
        apiKey: "int-key",
        baseURL: "https://ark.example/api/v3",
        videoModel: "doubao-seedance-1.0-lite",
      },
    });
    provider._deps.sleep = () => Promise.resolve();

    const { registerVideoIPC } = require("../../src/main/video/video-ipc.js");
    registerVideoIPC({
      videoImporter: null,
      mainWindow,
      llmManager: null,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers video:generate handler", () => {
    expect(handlers.has("video:generate")).toBe(true);
  });

  it("invokes the handler and writes the file, emits progress events", async () => {
    const bytes = Buffer.from("FAKE".repeat(100));
    const responses = [
      { body: { id: "task-int-1" } },
      { body: { status: "running" } },
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

    const out = path.join(tmpDir, "promo.mp4");
    const result = await handlers.get("video:generate")(null, {
      prompt: "a skyline at sunset",
      outputPath: out,
      ratio: "16:9",
      duration: 5,
    });

    expect(result.path).toBe(out);
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.statSync(out).size).toBe(bytes.length);
    const progressStages = sentEvents
      .filter((e) => e.ch === "video:generate:progress")
      .map((e) => e.p.stage);
    expect(progressStages).toContain("task-created");
    expect(progressStages).toContain("complete");
  });

  it("propagates provider errors to the IPC caller", async () => {
    provider._deps.fetch = async () => ({
      ok: false,
      status: 401,
      async text() {
        return "unauthorized";
      },
      async json() {
        return {};
      },
    });
    await expect(
      handlers.get("video:generate")(null, {
        prompt: "x",
        outputPath: path.join(tmpDir, "x.mp4"),
      }),
    ).rejects.toThrow(/401/);
  });

  it("rejects when apiKey is missing in config", async () => {
    generator._deps.getLLMConfig = () => ({ volcengine: { apiKey: "" } });
    await expect(
      handlers.get("video:generate")(null, {
        prompt: "x",
        outputPath: path.join(tmpDir, "x.mp4"),
      }),
    ).rejects.toThrow(/apiKey/);
  });
});
