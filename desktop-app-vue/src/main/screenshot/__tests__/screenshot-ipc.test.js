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

    it("accepts a filesystem alias that resolves to os.tmpdir()", () => {
      const name = `cc-screenshot-alias-${process.pid}-${Date.now()}.png`;
      const target = path.join(os.tmpdir(), name);
      const alias = path.join(
        process.cwd(),
        `.screenshot-ipc-tmp-alias-${process.pid}-${Date.now()}`,
      );
      fs.writeFileSync(target, Buffer.from([0]));
      try {
        fs.symlinkSync(
          os.tmpdir(),
          alias,
          process.platform === "win32" ? "junction" : "dir",
        );
        expect(_internal.isInsideTmpDir(path.join(alias, name))).toBe(true);
      } finally {
        if (fs.existsSync(alias)) {
          if (process.platform === "win32") {
            fs.rmdirSync(alias);
          } else {
            fs.unlinkSync(alias);
          }
        }
        fs.rmSync(target, { force: true });
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

    it("rejects a sibling whose name merely starts with the tmp path", () => {
      const sibling = `${path.resolve(os.tmpdir())}-outside`;
      expect(
        _internal.isInsideTmpDir(
          path.join(sibling, "cc-screenshot-prefix-confusion.png"),
        ),
      ).toBe(false);
    });

    it.skipIf(process.platform === "win32")(
      "rejects a tmp symlink that resolves outside the tmp directory",
      () => {
        const outsideDir = fs.mkdtempSync(
          path.join(process.cwd(), ".screenshot-ipc-outside-"),
        );
        const outsideFile = path.join(
          outsideDir,
          "cc-screenshot-outside-target.png",
        );
        const linkPath = path.join(
          os.tmpdir(),
          `cc-screenshot-link-${process.pid}-${Date.now()}.png`,
        );
        fs.writeFileSync(outsideFile, Buffer.from([0]));
        try {
          fs.symlinkSync(outsideFile, linkPath, "file");
          expect(_internal.isInsideTmpDir(linkPath)).toBe(false);
        } finally {
          fs.rmSync(linkPath, { force: true });
          fs.rmSync(outsideDir, { recursive: true, force: true });
        }
      },
    );

    it("rejects a directory junction used as a screenshot leaf", () => {
      const outsideDir = fs.mkdtempSync(
        path.join(process.cwd(), ".screenshot-ipc-junction-target-"),
      );
      const linkPath = path.join(
        os.tmpdir(),
        `cc-screenshot-junction-${process.pid}-${Date.now()}.png`,
      );
      try {
        fs.symlinkSync(
          outsideDir,
          linkPath,
          process.platform === "win32" ? "junction" : "dir",
        );
        expect(_internal.isInsideTmpDir(linkPath)).toBe(false);
      } finally {
        if (fs.existsSync(linkPath)) {
          if (process.platform === "win32") {
            fs.rmdirSync(linkPath);
          } else {
            fs.unlinkSync(linkPath);
          }
        }
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("rejects a hard-linked screenshot leaf", () => {
      const nestedDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "screenshot-ipc-hardlink-target-"),
      );
      const target = path.join(nestedDir, "target.png");
      const linkPath = path.join(
        os.tmpdir(),
        `cc-screenshot-hardlink-${process.pid}-${Date.now()}.png`,
      );
      fs.writeFileSync(target, Buffer.from([0]));
      try {
        fs.linkSync(target, linkPath);
        expect(_internal.isInsideTmpDir(linkPath)).toBe(false);
      } finally {
        fs.rmSync(linkPath, { force: true });
        fs.rmSync(nestedDir, { recursive: true, force: true });
      }
    });

    it("rejects screenshots nested below the tmp root", () => {
      const nestedDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "screenshot-ipc-nested-"),
      );
      const nestedFile = path.join(nestedDir, "cc-screenshot-nested.png");
      fs.writeFileSync(nestedFile, Buffer.from([0]));
      try {
        expect(_internal.isInsideTmpDir(nestedFile)).toBe(false);
      } finally {
        fs.rmSync(nestedDir, { recursive: true, force: true });
      }
    });
  });

  describe("secure screenshot file I/O", () => {
    it("uses a canonical tmp path instead of a caller-provided alias", async () => {
      const name = "cc-screenshot-canonical-open.png";
      const aliasParent = path.join(process.cwd(), "screenshot-tmp-alias");
      const canonicalTmp = path.join(os.tmpdir(), "canonical-tmp-root");
      const trustedPath = path.join(canonicalTmp, name);
      const stat = {
        dev: 1,
        ino: 10,
        nlink: 1,
        size: 1,
        isFile: () => true,
        isSymbolicLink: () => false,
      };
      const handle = {
        stat: vi.fn(async () => stat),
        read: vi.fn(async (buffer, offset) => {
          buffer[offset] = 42;
          return { bytesRead: 1 };
        }),
        close: vi.fn(async () => {}),
      };
      const fakeFs = {
        realpathSync: vi.fn((value) => {
          const resolved = path.resolve(value);
          if (
            resolved === path.resolve(os.tmpdir()) ||
            resolved === path.resolve(aliasParent)
          ) {
            return canonicalTmp;
          }
          throw new Error(`unexpected realpath: ${value}`);
        }),
        constants: fs.constants,
        promises: {
          lstat: vi.fn(async () => stat),
          open: vi.fn(async () => handle),
          unlink: vi.fn(async () => {}),
        },
      };

      const result = await _internal.readScreenshotFile(
        path.join(aliasParent, name),
        fakeFs,
      );

      expect(result).toEqual(Buffer.from([42]));
      expect(fakeFs.promises.lstat).toHaveBeenCalledWith(trustedPath, {
        bigint: true,
      });
      expect(fakeFs.promises.open).toHaveBeenCalledWith(
        trustedPath,
        expect.any(Number),
      );
      expect(handle.close).toHaveBeenCalledOnce();

      await expect(
        _internal.removeScreenshotFile(path.join(aliasParent, name), fakeFs),
      ).resolves.toBe(true);
      expect(fakeFs.promises.unlink).toHaveBeenCalledWith(trustedPath);
    });

    it("rejects a file identity swap and closes the opened handle", async () => {
      const safeStat = {
        dev: 1,
        ino: 10,
        nlink: 1,
        size: 1,
        isFile: () => true,
        isSymbolicLink: () => false,
      };
      const swappedStat = { ...safeStat, ino: 11 };
      const handle = {
        stat: vi.fn(async () => swappedStat),
        read: vi.fn(async () => ({ bytesRead: 1 })),
        close: vi.fn(async () => {}),
      };
      const fakeFs = {
        realpathSync: vi.fn((value) => path.resolve(value)),
        constants: fs.constants,
        promises: {
          lstat: vi.fn(async () => safeStat),
          open: vi.fn(async () => handle),
        },
      };
      const filePath = path.join(os.tmpdir(), "cc-screenshot-race.png");

      await expect(
        _internal.readScreenshotFile(filePath, fakeFs),
      ).rejects.toThrow(/changed during validation/);
      expect(handle.read).not.toHaveBeenCalled();
      expect(handle.close).toHaveBeenCalledOnce();
    });

    it("reads short chunks to completion through the validated handle", async () => {
      const stat = {
        dev: 1,
        ino: 10,
        nlink: 1,
        size: 3,
        isFile: () => true,
        isSymbolicLink: () => false,
      };
      const handle = {
        stat: vi.fn(async () => stat),
        read: vi.fn(async (buffer, offset) => {
          buffer[offset] = offset + 1;
          return { bytesRead: 1 };
        }),
        close: vi.fn(async () => {}),
      };
      const fakeFs = {
        realpathSync: vi.fn((value) => path.resolve(value)),
        constants: fs.constants,
        promises: {
          lstat: vi.fn(async () => stat),
          open: vi.fn(async () => handle),
        },
      };

      await expect(
        _internal.readScreenshotFile(
          path.join(os.tmpdir(), "cc-screenshot-short-read.png"),
          fakeFs,
        ),
      ).resolves.toEqual(Buffer.from([1, 2, 3]));
      expect(handle.read).toHaveBeenCalledTimes(3);
      expect(handle.close).toHaveBeenCalledOnce();
    });

    it("closes the validated handle when a short read stops early", async () => {
      const stat = {
        dev: 1,
        ino: 10,
        nlink: 1,
        size: 2,
        isFile: () => true,
        isSymbolicLink: () => false,
      };
      const handle = {
        stat: vi.fn(async () => stat),
        read: vi
          .fn()
          .mockResolvedValueOnce({ bytesRead: 1 })
          .mockResolvedValueOnce({ bytesRead: 0 }),
        close: vi.fn(async () => {}),
      };
      const fakeFs = {
        realpathSync: vi.fn((value) => path.resolve(value)),
        constants: fs.constants,
        promises: {
          lstat: vi.fn(async () => stat),
          open: vi.fn(async () => handle),
        },
      };

      await expect(
        _internal.readScreenshotFile(
          path.join(os.tmpdir(), "cc-screenshot-stopped-read.png"),
          fakeFs,
        ),
      ).rejects.toThrow(/changed while reading/);
      expect(handle.close).toHaveBeenCalledOnce();
    });

    it("cleans up empty and oversized regular screenshot files", async () => {
      const emptyPath = path.join(
        os.tmpdir(),
        `cc-screenshot-empty-${process.pid}-${Date.now()}.png`,
      );
      const oversizedPath = path.join(
        os.tmpdir(),
        `cc-screenshot-oversized-${process.pid}-${Date.now()}.png`,
      );
      fs.writeFileSync(emptyPath, Buffer.alloc(0));
      const fd = fs.openSync(oversizedPath, "w", 0o600);
      fs.ftruncateSync(fd, _internal.MAX_SCREENSHOT_BYTES + 1);
      fs.closeSync(fd);
      try {
        expect(_internal.isInsideTmpDir(emptyPath)).toBe(true);
        expect(_internal.isInsideTmpDir(oversizedPath)).toBe(true);
        await expect(_internal.readScreenshotFile(emptyPath)).rejects.toThrow(
          /Unsafe screenshot file/,
        );
        await expect(
          _internal.readScreenshotFile(oversizedPath),
        ).rejects.toThrow(/Unsafe screenshot file/);
        await expect(_internal.removeScreenshotFile(emptyPath)).resolves.toBe(
          true,
        );
        await expect(
          _internal.removeScreenshotFile(oversizedPath),
        ).resolves.toBe(true);
        expect(fs.existsSync(emptyPath)).toBe(false);
        expect(fs.existsSync(oversizedPath)).toBe(false);
      } finally {
        fs.rmSync(emptyPath, { force: true });
        fs.rmSync(oversizedPath, { force: true });
      }
    });

    it("uses exclusive private writes and never truncates a collision", async () => {
      const nestedDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "screenshot-ipc-write-target-"),
      );
      const target = path.join(nestedDir, "target.png");
      const occupied = path.join(
        os.tmpdir(),
        `cc-screenshot-occupied-${process.pid}-${Date.now()}.png`,
      );
      const available = path.join(
        os.tmpdir(),
        `cc-screenshot-private-${process.pid}-${Date.now()}.png`,
      );
      fs.writeFileSync(target, Buffer.from("sensitive"), { mode: 0o600 });
      fs.linkSync(target, occupied);
      const pathFactory = vi
        .fn()
        .mockReturnValueOnce(occupied)
        .mockReturnValueOnce(available);
      let writtenPath;
      try {
        writtenPath = await _internal.writeScreenshotFile(
          Buffer.from([1, 2, 3]),
          { pathFactory, maxAttempts: 2 },
        );
        expect(pathFactory).toHaveBeenCalledTimes(2);
        expect(fs.readFileSync(target, "utf8")).toBe("sensitive");
        expect(fs.readFileSync(writtenPath)).toEqual(Buffer.from([1, 2, 3]));
        if (process.platform !== "win32") {
          expect(fs.statSync(writtenPath).mode & 0o777).toBe(0o600);
        }
      } finally {
        fs.rmSync(occupied, { force: true });
        if (writtenPath) {
          fs.rmSync(writtenPath, { force: true });
        }
        fs.rmSync(available, { force: true });
        fs.rmSync(nestedDir, { recursive: true, force: true });
      }
    });

    it("rejects empty and oversized buffers before allocating a path", async () => {
      const pathFactory = vi.fn();
      await expect(
        _internal.writeScreenshotFile(Buffer.alloc(0), { pathFactory }),
      ).rejects.toThrow(/size is invalid/);
      await expect(
        _internal.writeScreenshotFile(
          Buffer.allocUnsafe(_internal.MAX_SCREENSHOT_BYTES + 1),
          { pathFactory },
        ),
      ).rejects.toThrow(/size is invalid/);
      expect(pathFactory).not.toHaveBeenCalled();
    });

    it("closes and removes a file after a partial write failure", async () => {
      const filePath = path.join(os.tmpdir(), "cc-screenshot-partial.png");
      const handle = {
        writeFile: vi.fn(async () => {
          throw new Error("ENOSPC");
        }),
        close: vi.fn(async () => {}),
      };
      const fakeFs = {
        realpathSync: vi.fn((value) => path.resolve(value)),
        promises: {
          open: vi.fn(async () => handle),
          unlink: vi.fn(async () => {}),
        },
      };

      await expect(
        _internal.writeScreenshotFile(Buffer.from([1]), {
          fsImpl: fakeFs,
          pathFactory: () => filePath,
        }),
      ).rejects.toThrow(/ENOSPC/);
      expect(fakeFs.promises.open).toHaveBeenCalledWith(
        path.resolve(filePath),
        "wx",
        0o600,
      );
      expect(handle.close).toHaveBeenCalledOnce();
      expect(fakeFs.promises.unlink).toHaveBeenCalledWith(
        path.resolve(filePath),
      );
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

    it("screenshot:ocr never invokes OCR after a validation race", async () => {
      const p = path.join(os.tmpdir(), "cc-screenshot-handler-race.png");
      const readScreenshotFile = vi.fn(async () => {
        throw new Error("Screenshot file changed during validation");
      });
      fs.writeFileSync(p, Buffer.from([0]));
      try {
        registerScreenshotIPC({
          ipcMain,
          capture: stubCapture,
          recognize: stubRecognize,
          recognizeWithLLM: stubRecognizeWithLLM,
          readScreenshotFile,
        });
        const result = await ipcMain.invoke("screenshot:ocr", { path: p });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/changed during validation/);
        expect(readScreenshotFile).toHaveBeenCalledWith(p);
        expect(stubRecognize).not.toHaveBeenCalled();
        expect(stubRecognizeWithLLM).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(p, { force: true });
      }
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
        expect(stubRecognize).toHaveBeenCalledWith(expect.any(Buffer), "eng");
        expect(stubRecognize.mock.calls[0][0]).toEqual(Buffer.from([0]));
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
      const result = await _internal.recognizeDispatch(Buffer.from([0]), {
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
