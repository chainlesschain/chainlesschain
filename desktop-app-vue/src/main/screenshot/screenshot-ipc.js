/**
 * 截图 + OCR IPC
 *
 * 托盘"截图识别"入口的主进程支撑：
 *   - screenshot:capture   截屏 → 临时文件 + dataUrl 预览
 *   - screenshot:ocr       临时文件 → Tesseract.js 识别文本
 *   - screenshot:cleanup   删除临时文件（用户取消时调）
 *
 * 拆两个 channel 而不是合一是 UX 取舍：用户先看到截图，OCR
 * 在后台跑，结果回填到 textarea。失败时也能保留预览让人手输。
 *
 * @module screenshot-ipc
 */

const fs = require("fs");
const fsp = require("fs").promises;
const os = require("os");
const path = require("path");
const { logger } = require("../utils/logger.js");

const DEFAULT_LANG = "eng+chi_sim";
const TMP_PREFIX = "cc-screenshot-";

function tmpFilePath() {
  const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  return path.join(os.tmpdir(), `${TMP_PREFIX}${stamp}.png`);
}

function isInsideTmpDir(filePath) {
  try {
    const resolved = path.resolve(filePath);
    const realTmp = fs.realpathSync(os.tmpdir());
    return (
      resolved.startsWith(path.resolve(realTmp)) &&
      path.basename(resolved).startsWith(TMP_PREFIX)
    );
  } catch {
    return false;
  }
}

async function captureScreenshot(screenIndex = 0) {
  let screenshot;
  try {
    screenshot = require("screenshot-desktop");
  } catch (err) {
    throw new Error(
      "screenshot-desktop not installed: " + (err?.message || err),
    );
  }

  const displays = await screenshot.listDisplays();
  if (!displays.length) {
    throw new Error("No display detected");
  }
  const idx = Math.max(0, Math.min(screenIndex, displays.length - 1));
  const buffer = await screenshot({ screen: displays[idx].id });

  const filePath = tmpFilePath();
  await fsp.writeFile(filePath, buffer);
  return {
    path: filePath,
    dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    bytes: buffer.length,
    displays: displays.length,
    screenIndex: idx,
  };
}

async function recognize(filePath, lang = DEFAULT_LANG) {
  if (!fs.existsSync(filePath)) {
    throw new Error("Screenshot file not found: " + filePath);
  }
  const Tesseract = require("tesseract.js");
  const worker = await Tesseract.createWorker();
  try {
    if (typeof worker.loadLanguage === "function") {
      await worker.loadLanguage(lang);
    }
    if (typeof worker.initialize === "function") {
      await worker.initialize(lang);
    }
    const {
      data: { text, confidence },
    } = await worker.recognize(filePath);
    return {
      text: (text || "").trim(),
      confidence:
        typeof confidence === "number" ? Math.round(confidence * 100) / 100 : 0,
      language: lang,
    };
  } finally {
    await worker.terminate();
  }
}

function registerScreenshotIPC({
  ipcMain: injectedIpcMain,
  capture: injectedCapture,
  recognize: injectedRecognize,
} = {}) {
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;
  const captureImpl = injectedCapture || captureScreenshot;
  const recognizeImpl = injectedRecognize || recognize;

  logger.info("[Screenshot IPC] Registering handlers...");

  ipcMain.handle("screenshot:capture", async (_event, options = {}) => {
    try {
      const screenIndex =
        typeof options.screenIndex === "number" ? options.screenIndex : 0;
      const result = await captureImpl(screenIndex);
      return { success: true, ...result };
    } catch (err) {
      logger.error("[Screenshot IPC] capture failed:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("screenshot:ocr", async (_event, options = {}) => {
    try {
      const filePath = options?.path;
      if (!filePath || typeof filePath !== "string") {
        return { success: false, error: "Missing path" };
      }
      if (!isInsideTmpDir(filePath)) {
        return { success: false, error: "Path outside tmp dir is rejected" };
      }
      const lang =
        typeof options.lang === "string" && options.lang
          ? options.lang
          : DEFAULT_LANG;
      const result = await recognizeImpl(filePath, lang);
      return { success: true, ...result };
    } catch (err) {
      logger.error("[Screenshot IPC] ocr failed:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("screenshot:cleanup", async (_event, options = {}) => {
    try {
      const filePath = options?.path;
      if (!filePath || typeof filePath !== "string") {
        return { success: false, error: "Missing path" };
      }
      if (!isInsideTmpDir(filePath)) {
        return { success: false, error: "Refused to delete non-tmp path" };
      }
      if (fs.existsSync(filePath)) {
        await fsp.unlink(filePath);
      }
      return { success: true };
    } catch (err) {
      logger.warn("[Screenshot IPC] cleanup failed:", err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  logger.info("[Screenshot IPC] ✓ 3 handlers registered");
}

module.exports = {
  registerScreenshotIPC,
  // exported for tests
  _internal: { captureScreenshot, recognize, isInsideTmpDir, tmpFilePath },
};
