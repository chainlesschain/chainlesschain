/**
 * screenshot.* WS handler 单元测试 — Phase 3c.7 web-shell parity
 *
 * Pattern 与 notification-handlers.test 同款:_internal 注入,跳过真截图
 * (screenshot-desktop) 和 OCR (tesseract.js) 加载,聚焦 envelope/
 * isInsideTmpDir 路径校验/错误返回。
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  createScreenshotHandlers,
  createScreenshotCaptureHandler,
  createScreenshotOcrHandler,
  createScreenshotCleanupHandler,
} = require("../handlers/screenshot-handlers");

// ── helpers ─────────────────────────────────────────────────────

function makeStubInternal(overrides = {}) {
  return {
    captureScreenshot: vi.fn().mockResolvedValue({
      path: "/tmp/cc-screenshot-stub.png",
      dataUrl: "data:image/png;base64,c3R1Yg==",
      bytes: 4,
      displays: 1,
      screenIndex: 0,
    }),
    recognize: vi
      .fn()
      .mockResolvedValue({ text: "hello", confidence: 0.9, language: "eng" }),
    isInsideTmpDir: vi.fn((p) => /cc-screenshot-/.test(p)),
    tmpFilePath: vi.fn(() => "/tmp/cc-screenshot-stub.png"),
    ...overrides,
  };
}

function makeStubFs({ exists = true, unlinkOk = true } = {}) {
  return {
    existsSync: vi.fn(() => exists),
    promises: {
      unlink: vi.fn(async () => {
        if (!unlinkOk) {
          throw new Error("EACCES");
        }
      }),
    },
  };
}

// ── capture ─────────────────────────────────────────────────────

describe("screenshot.capture", () => {
  it("returns success envelope with V5-shape result", async () => {
    const _internal = makeStubInternal();
    const handler = createScreenshotCaptureHandler({ _internal });
    const reply = await handler({});
    expect(reply.success).toBe(true);
    expect(reply.path).toMatch(/cc-screenshot-/);
    expect(reply.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(reply.displays).toBe(1);
    expect(_internal.captureScreenshot).toHaveBeenCalledWith(0);
  });

  it("forwards numeric screenIndex from frame", async () => {
    const _internal = makeStubInternal();
    const handler = createScreenshotCaptureHandler({ _internal });
    await handler({ screenIndex: 2 });
    expect(_internal.captureScreenshot).toHaveBeenCalledWith(2);
  });

  it("ignores non-numeric screenIndex (defaults to 0)", async () => {
    const _internal = makeStubInternal();
    const handler = createScreenshotCaptureHandler({ _internal });
    await handler({ screenIndex: "two" });
    expect(_internal.captureScreenshot).toHaveBeenCalledWith(0);
  });

  it("returns error envelope when capture throws", async () => {
    const _internal = makeStubInternal({
      captureScreenshot: vi.fn().mockRejectedValue(new Error("no display")),
    });
    const handler = createScreenshotCaptureHandler({ _internal });
    const reply = await handler({});
    expect(reply.success).toBe(false);
    expect(reply.error).toMatch(/no display/);
  });
});

// ── ocr ─────────────────────────────────────────────────────────

describe("screenshot.ocr", () => {
  it("rejects missing path", async () => {
    const handler = createScreenshotOcrHandler({
      _internal: makeStubInternal(),
    });
    const reply = await handler({});
    expect(reply.success).toBe(false);
    expect(reply.error).toMatch(/缺少 path/);
  });

  it("rejects path outside tmp dir", async () => {
    const _internal = makeStubInternal({
      isInsideTmpDir: vi.fn(() => false),
    });
    const handler = createScreenshotOcrHandler({ _internal });
    const reply = await handler({ path: "/etc/passwd" });
    expect(reply.success).toBe(false);
    expect(reply.error).toMatch(/tmp 外/);
    expect(_internal.recognize).not.toHaveBeenCalled();
  });

  it("forwards lang option (defaulting to eng+chi_sim)", async () => {
    const _internal = makeStubInternal();
    const handler = createScreenshotOcrHandler({ _internal });

    await handler({ path: "/tmp/cc-screenshot-x.png" });
    expect(_internal.recognize).toHaveBeenLastCalledWith(
      "/tmp/cc-screenshot-x.png",
      "eng+chi_sim",
    );

    await handler({ path: "/tmp/cc-screenshot-x.png", lang: "deu" });
    expect(_internal.recognize).toHaveBeenLastCalledWith(
      "/tmp/cc-screenshot-x.png",
      "deu",
    );
  });

  it("returns success envelope merging recognize result", async () => {
    const _internal = makeStubInternal();
    const handler = createScreenshotOcrHandler({ _internal });
    const reply = await handler({ path: "/tmp/cc-screenshot-x.png" });
    expect(reply).toEqual({
      success: true,
      text: "hello",
      confidence: 0.9,
      language: "eng",
    });
  });

  it("returns error envelope when recognize throws", async () => {
    const _internal = makeStubInternal({
      recognize: vi.fn().mockRejectedValue(new Error("worker boom")),
    });
    const handler = createScreenshotOcrHandler({ _internal });
    const reply = await handler({ path: "/tmp/cc-screenshot-x.png" });
    expect(reply.success).toBe(false);
    expect(reply.error).toMatch(/worker boom/);
  });
});

// ── cleanup ─────────────────────────────────────────────────────

describe("screenshot.cleanup", () => {
  it("rejects missing path", async () => {
    const handler = createScreenshotCleanupHandler({
      _internal: makeStubInternal(),
      fs: makeStubFs(),
    });
    const reply = await handler({});
    expect(reply.success).toBe(false);
    expect(reply.error).toMatch(/缺少 path/);
  });

  it("rejects path outside tmp dir", async () => {
    const _internal = makeStubInternal({
      isInsideTmpDir: vi.fn(() => false),
    });
    const fsStub = makeStubFs();
    const handler = createScreenshotCleanupHandler({ _internal, fs: fsStub });
    const reply = await handler({ path: "/etc/passwd" });
    expect(reply.success).toBe(false);
    expect(reply.error).toMatch(/tmp 外/);
    expect(fsStub.promises.unlink).not.toHaveBeenCalled();
  });

  it("unlinks tmp file when it exists", async () => {
    const _internal = makeStubInternal();
    const fsStub = makeStubFs({ exists: true });
    const handler = createScreenshotCleanupHandler({ _internal, fs: fsStub });
    const reply = await handler({ path: "/tmp/cc-screenshot-x.png" });
    expect(reply.success).toBe(true);
    expect(fsStub.promises.unlink).toHaveBeenCalledWith(
      "/tmp/cc-screenshot-x.png",
    );
  });

  it("succeeds silently when file does not exist", async () => {
    const _internal = makeStubInternal();
    const fsStub = makeStubFs({ exists: false });
    const handler = createScreenshotCleanupHandler({ _internal, fs: fsStub });
    const reply = await handler({ path: "/tmp/cc-screenshot-x.png" });
    expect(reply.success).toBe(true);
    expect(fsStub.promises.unlink).not.toHaveBeenCalled();
  });

  it("returns error envelope when unlink fails", async () => {
    const _internal = makeStubInternal();
    const fsStub = makeStubFs({ exists: true, unlinkOk: false });
    const handler = createScreenshotCleanupHandler({ _internal, fs: fsStub });
    const reply = await handler({ path: "/tmp/cc-screenshot-x.png" });
    expect(reply.success).toBe(false);
    expect(reply.error).toMatch(/EACCES/);
  });
});

// ── factory ─────────────────────────────────────────────────────

describe("createScreenshotHandlers", () => {
  it("returns the 3 named topics", () => {
    const handlers = createScreenshotHandlers({
      _internal: makeStubInternal(),
    });
    expect(Object.keys(handlers).sort()).toEqual([
      "screenshot.capture",
      "screenshot.cleanup",
      "screenshot.ocr",
    ]);
    for (const fn of Object.values(handlers)) {
      expect(typeof fn).toBe("function");
    }
  });
});
