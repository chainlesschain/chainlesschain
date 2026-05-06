/**
 * Screenshot IPC unit tests.
 *
 * Uses dependency injection (capture / recognize / ipcMain) to keep the
 * test offline — no real screenshot, no real Tesseract, no Electron app.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, vi } from "vitest";

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
      }));
      registerScreenshotIPC({
        ipcMain,
        capture: stubCapture,
        recognize: stubRecognize,
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

    it("screenshot:ocr accepts a tmp path and returns text", async () => {
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
        expect(stubRecognize).toHaveBeenCalledWith(p, "eng");
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
});
