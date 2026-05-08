/**
 * `screenshot.*` WS handlers — Phase 3c.7 web-shell parity (2026-05-07).
 *
 * 暴露 3 个 topic 给 web-panel，对齐 V5/V6 桌面壳 `screenshot:*` IPC:
 *   screenshot.capture     → 截屏 + 写入 os.tmpdir/cc-screenshot-*.png
 *   screenshot.ocr         → 文本识别（engine: tesseract|llm|auto，默认 auto）
 *   screenshot.cleanup     → 删除截图临时文件
 *
 * Why we don't reuse ipcMain.handle: web-shell 走 WS dispatcher。但底层
 * 截图 + OCR 实现共享 — 直接 require ../screenshot/screenshot-ipc 的
 * `_internal` exports，零 Electron IPC 依赖，测试侧 mock _internal 即可。
 *
 * 安全：`screenshot.ocr` / `screenshot.cleanup` 仍走 _internal.isInsideTmpDir
 * 防 path-traversal，与 IPC 完全一致。`screenshot.capture` 不接受 client
 * 传入的 path —— tmp 路径完全 server-allocated，零外部输入。
 *
 * Engine 路由（2026-05-08）：与 V5/V6 IPC 对齐三态。auto 模式自动用配置
 * 的视觉 LLM（火山引擎），失败回落 Tesseract。llmManager 走 app 晚绑定
 * 同款，由 web-shell-bootstrap 在 init 完成后注入。
 *
 * dataUrl 内联 vs 分离: 当前 V5 IPC 把 base64 PNG 跟 path 一起返回（4K
 * ~5–15 MB inline）。WS server (ws-cli-loader) 没有 envelope 封顶，
 * 单帧 15 MB 在 127.0.0.1 本机串行走完，跟 V5 对齐。如果未来 OOM/卡顿
 * 反馈出现，split 成独立 screenshot.preview topic 是机械改动。
 */

const fs = require("fs");
const fsp = require("fs").promises;

function _loadInternal() {
  return require("../../screenshot/screenshot-ipc")._internal;
}

function createScreenshotCaptureHandler({ _internal } = {}) {
  return async function screenshotCaptureHandler(frame = {}) {
    const helpers = _internal || _loadInternal();
    const screenIndex =
      typeof frame?.screenIndex === "number" ? frame.screenIndex : 0;
    try {
      const result = await helpers.captureScreenshot(screenIndex);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createScreenshotOcrHandler({
  _internal,
  llmManager: directLlmManager,
  app,
} = {}) {
  return async function screenshotOcrHandler(frame = {}) {
    const helpers = _internal || _loadInternal();
    const filePath = frame?.path;
    if (!filePath || typeof filePath !== "string") {
      return { success: false, error: "缺少 path" };
    }
    if (!helpers.isInsideTmpDir(filePath)) {
      return { success: false, error: "拒绝识别 tmp 外路径" };
    }
    const lang =
      typeof frame.lang === "string" && frame.lang ? frame.lang : "eng+chi_sim";
    const engine =
      frame.engine === "tesseract" ||
      frame.engine === "llm" ||
      frame.engine === "auto"
        ? frame.engine
        : "auto";
    const llmManager = app?.llmManager ?? directLlmManager ?? null;
    try {
      const result = await helpers.recognizeDispatch(filePath, {
        engine,
        lang,
        llmManager,
        tesseractImpl: helpers.recognize,
        llmImpl: helpers.recognizeWithLLM,
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createScreenshotCleanupHandler({ _internal, fs: fsImpl } = {}) {
  return async function screenshotCleanupHandler(frame = {}) {
    const helpers = _internal || _loadInternal();
    const filePath = frame?.path;
    if (!filePath || typeof filePath !== "string") {
      return { success: false, error: "缺少 path" };
    }
    if (!helpers.isInsideTmpDir(filePath)) {
      return { success: false, error: "拒绝删除 tmp 外路径" };
    }
    try {
      const fsLib = fsImpl || fs;
      const fspLib = fsImpl?.promises || fsp;
      if (fsLib.existsSync(filePath)) {
        await fspLib.unlink(filePath);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createScreenshotHandlers(opts = {}) {
  // ocr handler 单独需要 llmManager / app；capture/cleanup 不需要。
  // 工厂层平铺整个 opts 给所有 sub-handler，多余字段 sub-handler 自动忽略。
  return {
    "screenshot.capture": createScreenshotCaptureHandler(opts),
    "screenshot.ocr": createScreenshotOcrHandler(opts),
    "screenshot.cleanup": createScreenshotCleanupHandler(opts),
  };
}

module.exports = {
  createScreenshotHandlers,
  createScreenshotCaptureHandler,
  createScreenshotOcrHandler,
  createScreenshotCleanupHandler,
};
