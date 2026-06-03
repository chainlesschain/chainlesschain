/**
 * Screenshot IPC unit tests.
 *
 * Uses dependency injection (capture / recognize / ipcMain) to keep the
 * test offline — no real screenshot, no real Tesseract, no Electron app.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { registerScreenshotIPC, _internal } = require("../screenshot-ipc.js");

function makeStubIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, ...args) => {
      const fn = handlers.get(channel);
      if (!fn) {
        throw new Error("No handler for " + channel);
      }
      return fn({}, ...args);
    },
    _channels: () => Array.from(handlers.keys()),
  };
}

describe("screenshot-ipc", () => {
  describe("isInsideTmpDir", () => {
    it("accepts paths under os.tmpdir() with the cc-screenshot- prefix", () => {
      const p = path.join(os.tmpdir(), "cc-screenshot-abc.png");
      fs.writeFileSync(p, Buffer.from([0]));
      try {
        expect(_internal.isInsideTmpDir(p)).toBe(true);
      } finally {
        fs.unlinkSync(p);
      }
    });

    it("rejects paths outside os.tmpdir()", () => {
      expect(_internal.isInsideTmpDir("/etc/passwd")).toBe(false);
      expect(_internal.isInsideTmpDir("C:/Windows/System32")).toBe(false);
    });

    it("rejects tmp paths without the cc-screenshot- prefix", () => {
      const p = path.join(os.tmpdir(), "other-file.png");
      fs.writeFileSync(p, Buffer.from([0]));
      try {
        expect(_internal.isInsideTmpDir(p)).toBe(false);
      } finally {
        fs.unlinkSync(p);
      }
    });
  });

  describe("handlers", () => {
    let ipcMain;
    let stubCapture;
    let stubRecognize;
    let stubRecognizeWithLLM;

    beforeEach(() => {
      ipcMain = makeStubIpcMain();
      stubCapture = vi.fn(async (idx) => ({
        path: path.join(os.tmpdir(), "cc-screenshot-test-fixture.png"),
        dataUrl: "data:image/png;base64,AAAA",
        bytes: 4,
        displays: 2,
        screenIndex: idx,
      }));
      stubRecognize = vi.fn(async (_p, lang) => ({
        text: "hello world",
        confidence: 92.5,
        language: lang,
        engine: "tesseract",
      }));
      stubRecognizeWithLLM = vi.fn(async () => ({
        text: "豆包识别结果",
        confidence: null,
        language: "auto",
        engine: "llm",
        model: "doubao-1-5-vision-pro-240828",
      }));
      registerScreenshotIPC({
        ipcMain,
        capture: stubCapture,
        recognize: stubRecognize,
        recognizeWithLLM: stubRecognizeWithLLM,
      });
    });

    it("registers all three channels", () => {
      expect(ipcMain._channels()).toEqual(
        expect.arrayContaining([
          "screenshot:capture",
          "screenshot:ocr",
          "screenshot:cleanup",
        ]),
      );
    });

    it("screenshot:capture wraps result with success:true", async () => {
      const result = await ipcMain.invoke("screenshot:capture", {
        screenIndex: 1,
      });
      expect(result.success).toBe(true);
      expect(result.dataUrl).toMatch(/^data:image\/png/);
      expect(result.path).toMatch(/cc-screenshot-/);
      expect(stubCapture).toHaveBeenCalledWith(1);
    });

    it("screenshot:capture returns success:false on error", async () => {
      stubCapture.mockRejectedValueOnce(new Error("no display"));
      const result = await ipcMain.invoke("screenshot:capture", {});
      expect(result.success).toBe(false);
      expect(result.error).toBe("no display");
    });

    it("screenshot:ocr rejects path outside tmp dir", async () => {
      const result = await ipcMain.invoke("screenshot:ocr", {
        path: "/etc/passwd",
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/outside tmp/);
      expect(stubRecognize).not.toHaveBeenCalled();
    });

    it("screenshot:ocr accepts a tmp path and returns text (auto → tesseract when no llmManager)", async () => {
      const p = path.join(os.tmpdir(), "cc-screenshot-ocr-test.png");
      fs.writeFileSync(p, Buffer.from([0]));
      try {
        const result = await ipcMain.invoke("screenshot:ocr", {
          path: p,
          lang: "eng",
        });
        expect(result.success).toBe(true);
        expect(result.text).toBe("hello world");
        expect(result.confidence).toBe(92.5);
        expect(result.engine).toBe("tesseract");
        expect(stubRecognize).toHaveBeenCalledWith(p, "eng");
        expect(stubRecognizeWithLLM).not.toHaveBeenCalled();
      } finally {
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      }
    });

    it("screenshot:cleanup deletes a tmp file", async () => {
      const p = path.join(os.tmpdir(), "cc-screenshot-cleanup-test.png");
      fs.writeFileSync(p, Buffer.from([0]));
      const result = await ipcMain.invoke("screenshot:cleanup", { path: p });
      expect(result.success).toBe(true);
      expect(fs.existsSync(p)).toBe(false);
    });

    it("screenshot:cleanup refuses non-tmp paths", async () => {
      const result = await ipcMain.invoke("screenshot:cleanup", {
        path: "/etc/passwd",
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Refused/);
    });
  });

  // engine 路由——三态 + auto 回落语义
  describe("engine routing (tesseract | llm | auto)", () => {
    let ipcMain;
    let stubCapture;
    let stubRecognize;
    let stubRecognizeWithLLM;
    const tmpFile = path.join(os.tmpdir(), "cc-screenshot-engine-test.png");

    function setup(llmManager) {
      ipcMain = makeStubIpcMain();
      stubCapture = vi.fn();
      stubRecognize = vi.fn(async (_p, lang) => ({
        text: "tesseract text",
        confidence: 80,
        language: lang,
        engine: "tesseract",
      }));
      stubRecognizeWithLLM = vi.fn(async () => ({
        text: "llm text",
        confidence: null,
        language: "auto",
        engine: "llm",
        model: "doubao-test",
      }));
      registerScreenshotIPC({
        ipcMain,
        capture: stubCapture,
        recognize: stubRecognize,
        recognizeWithLLM: stubRecognizeWithLLM,
        llmManager,
      });
    }

    beforeEach(() => {
      fs.writeFileSync(tmpFile, Buffer.from([0]));
    });

    afterEach(() => {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    });

    it("engine='tesseract' forces tesseract path even with volcengine llmManager", async () => {
      setup({ provider: "volcengine" });
      const result = await ipcMain.invoke("screenshot:ocr", {
        path: tmpFile,
        engine: "tesseract",
      });
      expect(result.success).toBe(true);
      expect(result.engine).toBe("tesseract");
      expect(stubRecognize).toHaveBeenCalledOnce();
      expect(stubRecognizeWithLLM).not.toHaveBeenCalled();
    });

    it("engine='llm' uses LLM path when volcengine configured", async () => {
      setup({ provider: "volcengine" });
      const result = await ipcMain.invoke("screenshot:ocr", {
        path: tmpFile,
        engine: "llm",
      });
      expect(result.success).toBe(true);
      expect(result.engine).toBe("llm");
      expect(result.model).toBe("doubao-test");
      expect(stubRecognizeWithLLM).toHaveBeenCalledOnce();
      expect(stubRecognize).not.toHaveBeenCalled();
    });

    it("engine='llm' returns success:false when no llmManager", async () => {
      setup(null);
      const result = await ipcMain.invoke("screenshot:ocr", {
        path: tmpFile,
        engine: "llm",
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/LLM manager not available/);
    });

    it("engine='llm' returns success:false when provider is not vision-capable", async () => {
      setup({ provider: "ollama" });
      const result = await ipcMain.invoke("screenshot:ocr", {
        path: tmpFile,
        engine: "llm",
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/仅支持火山引擎/);
    });

    it("engine='auto' picks LLM when volcengine configured", async () => {
      setup({ provider: "volcengine" });
      const result = await ipcMain.invoke("screenshot:ocr", {
        path: tmpFile,
        engine: "auto",
      });
      expect(result.success).toBe(true);
      expect(result.engine).toBe("llm");
      expect(stubRecognizeWithLLM).toHaveBeenCalledOnce();
      expect(stubRecognize).not.toHaveBeenCalled();
    });

    it("engine='auto' falls back to tesseract when no llmManager", async () => {
      setup(null);
      const result = await ipcMain.invoke("screenshot:ocr", {
        path: tmpFile,
        engine: "auto",
      });
      expect(result.success).toBe(true);
      expect(result.engine).toBe("tesseract");
      expect(stubRecognizeWithLLM).not.toHaveBeenCalled();
    });

    it("engine='auto' falls back to tesseract when LLM throws and tags fallbackFrom", async () => {
      setup({ provider: "volcengine" });
      stubRecognizeWithLLM.mockRejectedValueOnce(
        new Error("API quota exceeded"),
      );
      const result = await ipcMain.invoke("screenshot:ocr", {
        path: tmpFile,
        engine: "auto",
      });
      expect(result.success).toBe(true);
      expect(result.engine).toBe("tesseract");
      expect(result.fallbackFrom).toBe("llm");
      expect(result.fallbackReason).toBe("API quota exceeded");
      expect(stubRecognizeWithLLM).toHaveBeenCalledOnce();
      expect(stubRecognize).toHaveBeenCalledOnce();
    });

    it("engine omitted defaults to auto", async () => {
      setup({ provider: "volcengine" });
      const result = await ipcMain.invoke("screenshot:ocr", { path: tmpFile });
      expect(result.success).toBe(true);
      expect(result.engine).toBe("llm");
    });

    it("engine='garbage' is coerced to auto (defensive)", async () => {
      setup({ provider: "volcengine" });
      const result = await ipcMain.invoke("screenshot:ocr", {
        path: tmpFile,
        engine: "drop-tables",
      });
      expect(result.success).toBe(true);
      expect(result.engine).toBe("llm"); // auto picked LLM
    });
  });

  // 直接测 _internal.recognizeDispatch 的纯函数路由（不走 IPC）
  describe("_internal.recognizeDispatch (pure routing)", () => {
    const tmpFile = path.join(os.tmpdir(), "cc-screenshot-dispatch-test.png");

    beforeEach(() => fs.writeFileSync(tmpFile, Buffer.from([0])));
    afterEach(() => {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    });

    it("returns engine 'llm' on auto+volcengine success", async () => {
      const tesseractImpl = vi.fn();
      const llmImpl = vi.fn(async () => ({
        text: "llm",
        engine: "llm",
        model: "x",
      }));
      const result = await _internal.recognizeDispatch(tmpFile, {
        engine: "auto",
        llmManager: { provider: "volcengine", chatWithImageProcess: vi.fn() },
        tesseractImpl,
        llmImpl,
      });
      expect(result.engine).toBe("llm");
      expect(tesseractImpl).not.toHaveBeenCalled();
    });
  });
});
