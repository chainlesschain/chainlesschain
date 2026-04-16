/**
 * video-editing-ipc.test.js — Desktop video editing IPC integration tests
 *
 * Tests: IPC handler registration, channel exports, preload namespace,
 *        router route, store shape.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);

// ── IPC Handler Module ──────────────────────────────────────

describe("video-editing-ipc module", () => {
  let mod;

  beforeEach(() => {
    mod = require("../../../src/main/video/video-editing-ipc.js");
  });

  test("exports registerVideoEditingIPC function", () => {
    expect(typeof mod.registerVideoEditingIPC).toBe("function");
  });

  test("exports CHANNELS array with 7 entries", () => {
    expect(Array.isArray(mod.CHANNELS)).toBe(true);
    expect(mod.CHANNELS).toHaveLength(7);
  });

  test("CHANNELS contains expected channel names", () => {
    expect(mod.CHANNELS).toContain("video-edit:deconstruct");
    expect(mod.CHANNELS).toContain("video-edit:plan");
    expect(mod.CHANNELS).toContain("video-edit:assemble");
    expect(mod.CHANNELS).toContain("video-edit:render");
    expect(mod.CHANNELS).toContain("video-edit:edit");
    expect(mod.CHANNELS).toContain("video-edit:assets-list");
    expect(mod.CHANNELS).toContain("video-edit:cancel");
  });

  test("registerVideoEditingIPC registers handlers on ipcMain", () => {
    const handlers = {};
    const mockIpcMain = {
      handle: vi.fn((channel, handler) => {
        handlers[channel] = handler;
      }),
    };

    const result = mod.registerVideoEditingIPC(mockIpcMain, {});
    expect(result.channels).toHaveLength(7);
    expect(mockIpcMain.handle).toHaveBeenCalledTimes(7);
    expect(handlers["video-edit:deconstruct"]).toBeDefined();
    expect(handlers["video-edit:cancel"]).toBeDefined();
  });

  test("assets-list handler returns ok with empty array when no cache", async () => {
    const handlers = {};
    const mockIpcMain = {
      handle: vi.fn((ch, h) => {
        handlers[ch] = h;
      }),
    };
    mod.registerVideoEditingIPC(mockIpcMain, {});

    const result = await handlers["video-edit:assets-list"]();
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.assets)).toBe(true);
  });

  test("cancel handler returns error for unknown requestId", async () => {
    const handlers = {};
    const mockIpcMain = {
      handle: vi.fn((ch, h) => {
        handlers[ch] = h;
      }),
    };
    mod.registerVideoEditingIPC(mockIpcMain, {});

    const result = await handlers["video-edit:cancel"](null, "nonexistent");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No active pipeline");
  });
});

// ── Preload Namespace ───────────────────────────────────────

describe("preload videoEditing namespace", () => {
  test("preload index.js contains videoEditing namespace", () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, "../../../src/preload/index.js"),
      "utf-8",
    );
    expect(code).toContain("videoEditing:");
    expect(code).toContain("video-edit:deconstruct");
    expect(code).toContain("video-edit:plan");
    expect(code).toContain("video-edit:assemble");
    expect(code).toContain("video-edit:render");
    expect(code).toContain("video-edit:edit");
    expect(code).toContain("video-edit:assets-list");
    expect(code).toContain("video-edit:cancel");
    expect(code).toContain("video-edit:event");
  });

  test("preload exposes onEvent listener", () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, "../../../src/preload/index.js"),
      "utf-8",
    );
    expect(code).toContain("onEvent:");
    expect(code).toContain('ipcRenderer.on("video-edit:event"');
  });
});

// ── IPC Registry Registration ───────────────────────────────

describe("ipc-registry video-editing registration", () => {
  test("ipc-registry.js contains video-editing registration block", () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, "../../../src/main/ipc/ipc-registry.js"),
      "utf-8",
    );
    expect(code).toContain("video-editing-ipc.js");
    expect(code).toContain("registerVideoEditingIPC");
    expect(code).toContain('registeredModules["video-editing"]');
  });
});

// ── Router ──────────────────────────────────────────────────

describe("router video-editing route", () => {
  test("router/index.ts includes VideoEditing route", () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, "../../../src/renderer/router/index.ts"),
      "utf-8",
    );
    expect(code).toContain("video-editing");
    expect(code).toContain("VideoEditing");
    expect(code).toContain("VideoEditingPage.vue");
  });
});

// ── Store Shape ─────────────────────────────────────────────

describe("videoEditing store", () => {
  test("store file exists with expected exports", () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, "../../../src/renderer/stores/videoEditing.ts"),
      "utf-8",
    );
    expect(code).toContain("useVideoEditingStore");
    expect(code).toContain("defineStore");
    expect(code).toContain("videoEditing");
    expect(code).toContain("runFullPipeline");
    expect(code).toContain("runDeconstruct");
    expect(code).toContain("runPlan");
    expect(code).toContain("runAssemble");
    expect(code).toContain("runRender");
    expect(code).toContain("cancel");
    expect(code).toContain("loadAssets");
  });

  test("store defines PipelinePhase type", () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, "../../../src/renderer/stores/videoEditing.ts"),
      "utf-8",
    );
    expect(code).toContain("PipelinePhase");
    expect(code).toContain("idle");
    expect(code).toContain("deconstruct");
    expect(code).toContain("render");
    expect(code).toContain("done");
    expect(code).toContain("error");
  });
});

// ── Vue Page ────────────────────────────────────────────────

describe("VideoEditingPage.vue", () => {
  test("page file exists with expected content", () => {
    const code = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../src/renderer/pages/VideoEditingPage.vue",
      ),
      "utf-8",
    );
    expect(code).toContain("useVideoEditingStore");
    expect(code).toContain("startPipeline");
    expect(code).toContain("视频剪辑 Agent");
    expect(code).toContain("parallel");
    expect(code).toContain("useMadmom");
    expect(code).toContain("snapBeats");
    expect(code).toContain("ducking");
  });
});
