/**
 * 截图 + OCR IPC
 *
 * 托盘"截图识别"入口的主进程支撑：
 *   - screenshot:capture   截屏 → 临时文件 + dataUrl 预览
 *   - screenshot:ocr       临时文件 → 文本（Tesseract / LLM 视觉模型）
 *   - screenshot:cleanup   删除临时文件（用户取消时调）
 *
 * 拆两个 channel 而不是合一是 UX 取舍：用户先看到截图，OCR
 * 在后台跑，结果回填到 textarea。失败时也能保留预览让人手输。
 *
 * Engine 三态（screenshot:ocr 接受 options.engine）：
 *   - "tesseract"  强制本地 Tesseract.js（离线、慢、中文准确度有限）
 *   - "llm"        强制走配置的视觉 LLM（目前火山引擎豆包视觉系列）
 *   - "auto"       默认。火山引擎已配置则走 LLM，失败回落 Tesseract；
 *                  没配置则直接 Tesseract。
 *
 * @module screenshot-ipc
 */

const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { logger } = require("../utils/logger.js");

const DEFAULT_LANG = "eng+chi_sim";
const TMP_PREFIX = "cc-screenshot-";
const TMP_NAME_PATTERN = /^cc-screenshot-[A-Za-z0-9_-]+\.png$/;
const MAX_SCREENSHOT_BYTES = 64 * 1024 * 1024;

// 纯 OCR prompt：只要原文，禁止任何添油加醋。说明换行保持是因为豆包默认
// 会"理解性总结"，不点穿就会丢掉表格/代码片段的视觉结构。
const PURE_OCR_PROMPT =
  "请准确转录图片中的所有可见文字，按从上到下、从左到右的视觉顺序输出，" +
  "保留原始换行。只输出文字本身，不要添加任何解释、标注、Markdown 包装或代码块。" +
  "如果图片中没有文字，请输出空字符串。";

// 哪些 provider 当前真的能跑视觉 OCR。第一版只白名单火山——它的
// chatWithImageProcess 已落地。其它 provider（gemini/openai/anthropic）
// 接入是机械工作，一并收口到这里。
const VISION_CAPABLE_PROVIDERS = new Set(["volcengine"]);

function tmpFilePath() {
  return path.join(os.tmpdir(), `${TMP_PREFIX}${crypto.randomUUID()}.png`);
}

function realpathSyncWith(fsImpl, value) {
  const realpath = fsImpl.realpathSync.native || fsImpl.realpathSync;
  return realpath.call(fsImpl, value);
}

/**
 * Resolve a screenshot to a canonical, direct child of the operating-system
 * temp directory. Returning our own canonical path is important: callers must
 * never perform I/O through a renderer-provided alias after validation.
 */
function resolveTmpScreenshotPath(filePath, fsImpl = fs) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("Invalid screenshot path");
  }

  const resolved = path.resolve(filePath);
  const fileName = path.basename(resolved);
  if (!TMP_NAME_PATTERN.test(fileName)) {
    throw new Error("Invalid screenshot filename");
  }

  const realTmp = realpathSyncWith(fsImpl, os.tmpdir());
  const realParent = realpathSyncWith(fsImpl, path.dirname(resolved));
  if (path.relative(realTmp, realParent) !== "") {
    throw new Error("Screenshot path must be a direct tmp file");
  }

  return path.join(realTmp, fileName);
}

function isSafeScreenshotFileStat(stat) {
  return (
    !!stat &&
    typeof stat.isFile === "function" &&
    stat.isFile() &&
    typeof stat.isSymbolicLink === "function" &&
    !stat.isSymbolicLink() &&
    (stat.nlink === 1 || stat.nlink === 1n)
  );
}

function isReadableScreenshotStat(stat) {
  const size = Number(stat?.size);
  return (
    isSafeScreenshotFileStat(stat) &&
    Number.isSafeInteger(size) &&
    size > 0 &&
    size <= MAX_SCREENSHOT_BYTES
  );
}

function sameFileIdentity(left, right) {
  return (
    isReadableScreenshotStat(left) &&
    isReadableScreenshotStat(right) &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function isInsideTmpDir(filePath, fsImpl = fs) {
  try {
    const trustedPath = resolveTmpScreenshotPath(filePath, fsImpl);
    try {
      return isSafeScreenshotFileStat(
        fsImpl.lstatSync(trustedPath, { bigint: true }),
      );
    } catch (error) {
      // Cleanup is intentionally idempotent for an already-removed screenshot.
      // lstat still observes dangling links, so they are rejected above rather
      // than being mistaken for a missing leaf.
      return error?.code === "ENOENT";
    }
  } catch {
    return false;
  }
}

/**
 * Read through an opened file handle and bind validation to that handle. This
 * prevents a renderer from swapping the checked path for a symlink/junction
 * before Tesseract or an LLM reads it.
 */
async function readScreenshotFile(filePath, fsImpl = fs) {
  const trustedPath = resolveTmpScreenshotPath(filePath, fsImpl);
  const promises = fsImpl.promises;
  const before = await promises.lstat(trustedPath, { bigint: true });
  if (!isReadableScreenshotStat(before)) {
    throw new Error("Unsafe screenshot file");
  }

  const readOnly = fsImpl.constants?.O_RDONLY ?? fs.constants.O_RDONLY;
  const noFollow = fsImpl.constants?.O_NOFOLLOW ?? fs.constants.O_NOFOLLOW ?? 0;
  const handle = await promises.open(trustedPath, readOnly | noFollow);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFileIdentity(before, opened)) {
      throw new Error("Screenshot file changed during validation");
    }
    const buffer = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) {
        throw new Error("Screenshot file changed while reading");
      }
      offset += bytesRead;
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

async function removeScreenshotFile(filePath, fsImpl = fs) {
  const trustedPath = resolveTmpScreenshotPath(filePath, fsImpl);
  const promises = fsImpl.promises;
  let stat;
  try {
    stat = await promises.lstat(trustedPath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  if (!isSafeScreenshotFileStat(stat)) {
    throw new Error("Refused to delete unsafe screenshot file");
  }
  await promises.unlink(trustedPath);
  return true;
}

/**
 * Persist private screenshot bytes without ever following or truncating a
 * pre-created filesystem entry. A collision simply gets a fresh random name.
 */
async function writeScreenshotFile(
  imageBuffer,
  { fsImpl = fs, pathFactory = tmpFilePath, maxAttempts = 3 } = {},
) {
  if (!Buffer.isBuffer(imageBuffer)) {
    throw new Error("Screenshot image buffer is required");
  }
  if (imageBuffer.length === 0 || imageBuffer.length > MAX_SCREENSHOT_BYTES) {
    throw new Error("Screenshot image size is invalid");
  }

  let collisionError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const trustedPath = resolveTmpScreenshotPath(pathFactory(), fsImpl);
    let handle;
    try {
      handle = await fsImpl.promises.open(trustedPath, "wx", 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") {
        collisionError = error;
        continue;
      }
      throw error;
    }

    try {
      await handle.writeFile(imageBuffer);
      await handle.close();
      handle = null;
      return trustedPath;
    } catch (error) {
      // Exclusive open succeeded, so this process owns the random leaf. Clean
      // up a partial write without ever deleting a pre-existing collision.
      try {
        await handle?.close();
      } catch {
        // Continue to the unlink attempt.
      }
      try {
        await fsImpl.promises.unlink(trustedPath);
      } catch {
        // Best effort; preserve the original write failure.
      }
      throw error;
    }
  }

  throw new Error("Unable to allocate a unique screenshot file", {
    cause: collisionError,
  });
}

// Windows ships a security setting `NoDefaultCurrentDirectoryInExePath=1`
// (env-level or HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System)
// that disables cmd.exe's "search cwd for executables" behavior. screenshot-
// desktop's polyglot .bat (lib/win32/screenCapture_1.3.2.bat) invokes the
// compiled exe as plain `%~n0.exe %*` — without `.\` prefix — so on machines
// with that policy on, the .bat fails with `'screenCapture_1.3.2.exe' is not
// recognized as an internal or external command` even though the exe sits
// next to the .bat in the temp dir.
//
// Pre-stage a patched .bat (and the matching app.manifest) into the temp
// dir BEFORE screenshot-desktop's copyToTemp runs — its copyToTemp is a
// pure if-not-exists guard, so it'll skip the write and use our patched
// copy. Idempotent: re-runs are no-ops once the patched marker is present.
function ensurePatchedScreenCaptureBat() {
  if (process.platform !== "win32") {
    return;
  }
  try {
    const tmpDir = path.join(os.tmpdir(), "screenCapture");
    const tmpBat = path.join(tmpDir, "screenCapture_1.3.2.bat");
    const tmpManifest = path.join(tmpDir, "app.manifest");
    const sourceDir = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "node_modules",
      "screenshot-desktop",
      "lib",
      "win32",
    );
    const srcBat = path.join(sourceDir, "screenCapture_1.3.2.bat");
    const srcManifest = path.join(sourceDir, "app.manifest");
    if (!fs.existsSync(srcBat)) {
      // screenshot-desktop not laid out as expected — bail; the package
      // will surface its own error.
      return;
    }
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Read existing or source .bat and ensure the .\ patch is applied.
    const baseSource = fs.existsSync(tmpBat)
      ? fs.readFileSync(tmpBat, "utf-8")
      : fs.readFileSync(srcBat, "utf-8");
    if (baseSource.includes(".\\%~n0.exe")) {
      // Already patched; ensure manifest exists too (some users may have
      // hand-deleted it) and bail.
      if (!fs.existsSync(tmpManifest) && fs.existsSync(srcManifest)) {
        fs.copyFileSync(srcManifest, tmpManifest);
      }
      return;
    }
    const patched = baseSource
      .replace(/if not exist "%~n0\.exe"/g, 'if not exist ".\\%~n0.exe"')
      .replace(/^%~n0\.exe %\*$/m, ".\\%~n0.exe %*");
    if (patched === baseSource) {
      // Patterns shifted in a future screenshot-desktop release — bail
      // rather than corrupt.
      logger.warn(
        "[Screenshot IPC] screenCapture .bat shape changed; skipping cwd-policy patch",
      );
      return;
    }
    fs.writeFileSync(tmpBat, patched, "utf-8");
    if (!fs.existsSync(tmpManifest) && fs.existsSync(srcManifest)) {
      fs.copyFileSync(srcManifest, tmpManifest);
    }
    logger.info(
      "[Screenshot IPC] Patched screenCapture .bat to use .\\ prefix " +
        "(NoDefaultCurrentDirectoryInExePath workaround)",
    );
  } catch (err) {
    // Best-effort — if it fails, screenshot-desktop will run unpatched and
    // surface its own error.
    logger.warn(
      "[Screenshot IPC] Failed to ensure patched screenCapture .bat: " +
        (err?.message || err),
    );
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
  // Pre-stage the patched .bat so screenshot-desktop's copyToTemp's
  // if-not-exists guard skips its own write and uses our version.
  ensurePatchedScreenCaptureBat();

  const displays = await screenshot.listDisplays();
  if (!displays.length) {
    throw new Error("No display detected");
  }
  const idx = Math.max(0, Math.min(screenIndex, displays.length - 1));
  const buffer = await screenshot({ screen: displays[idx].id });

  const filePath = await writeScreenshotFile(buffer);
  return {
    path: filePath,
    dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    bytes: buffer.length,
    displays: displays.length,
    screenIndex: idx,
  };
}

async function recognize(imageBuffer, lang = DEFAULT_LANG) {
  if (!Buffer.isBuffer(imageBuffer)) {
    throw new Error("Screenshot image buffer is required");
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
    } = await worker.recognize(imageBuffer);
    return {
      text: (text || "").trim(),
      confidence:
        typeof confidence === "number" ? Math.round(confidence * 100) / 100 : 0,
      language: lang,
      engine: "tesseract",
    };
  } finally {
    await worker.terminate();
  }
}

/**
 * 用配置的视觉 LLM 识别截图。第一版只支持火山引擎（豆包视觉系列）——
 * llmManager.chatWithImageProcess 内部会按 selectByScenario 自动挑模型
 * （seed-1.6-vision / vision-pro / vision-lite 三档按 budget 选）。
 *
 * @param {Buffer} imageBuffer - 已安全读取并验证过的截图字节
 * @param {Object} llmManager - main 进程的 LLMManager 单例
 * @returns {Promise<{text:string, confidence:null, language:'auto', engine:'llm', model:string}>}
 */
async function recognizeWithLLM(imageBuffer, llmManager) {
  // 注：可用性 / provider 校验在 recognizeDispatch 里集中做。这里只做
  // I/O 和 API 调用，方便测试侧用任意 stub 替换 llmImpl。
  if (!Buffer.isBuffer(imageBuffer)) {
    throw new Error("Screenshot image buffer is required");
  }
  if (typeof llmManager?.chatWithImageProcess !== "function") {
    throw new Error("LLMManager.chatWithImageProcess 不可用");
  }

  const dataUrl = `data:image/png;base64,${imageBuffer.toString("base64")}`;

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: PURE_OCR_PROMPT },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];

  // userBudget=medium → 走 vision-pro（准确度 > lite，成本 < seed-1.6）
  const resp = await llmManager.chatWithImageProcess(messages, {
    userBudget: "medium",
  });

  const text = (resp?.choices?.[0]?.message?.content || "").trim();
  return {
    text,
    confidence: null, // LLM 不暴露 token-level 置信度
    language: "auto",
    engine: "llm",
    model: resp?.model || "doubao-vision",
  };
}

/**
 * Engine 路由：tesseract / llm / auto。被 IPC handler 和 web-shell handler
 * 复用，所以单独抽出来 + 走 _internal 暴露便于注入测试。
 */
async function recognizeDispatch(imageBuffer, opts = {}) {
  const {
    engine = "auto",
    lang = DEFAULT_LANG,
    llmManager = null,
    tesseractImpl = recognize,
    llmImpl = recognizeWithLLM,
  } = opts;

  const llmAvailable =
    !!llmManager && VISION_CAPABLE_PROVIDERS.has(llmManager.provider);

  if (engine === "tesseract") {
    return await tesseractImpl(imageBuffer, lang);
  }
  if (engine === "llm") {
    // 显式 'llm' 时强校验，给用户清晰的诊断而不是默默回落 / silent failure
    if (!llmManager) {
      throw new Error("LLM manager not available — 请在设置里配置火山引擎");
    }
    if (!VISION_CAPABLE_PROVIDERS.has(llmManager.provider)) {
      throw new Error(
        `LLM OCR 当前仅支持火山引擎（current provider: ${llmManager.provider}）`,
      );
    }
    return await llmImpl(imageBuffer, llmManager);
  }
  // auto
  if (llmAvailable) {
    try {
      return await llmImpl(imageBuffer, llmManager);
    } catch (err) {
      logger.warn(
        "[Screenshot IPC] LLM OCR 失败，回落 Tesseract: " +
          (err?.message || err),
      );
      // 回落结果带 fallback 标记，UI 可以提示用户为何没用 LLM
      const fallback = await tesseractImpl(imageBuffer, lang);
      return { ...fallback, fallbackFrom: "llm", fallbackReason: err?.message };
    }
  }
  return await tesseractImpl(imageBuffer, lang);
}

function registerScreenshotIPC({
  ipcMain: injectedIpcMain,
  capture: injectedCapture,
  recognize: injectedRecognize,
  recognizeWithLLM: injectedRecognizeWithLLM,
  readScreenshotFile: injectedReadScreenshotFile,
  removeScreenshotFile: injectedRemoveScreenshotFile,
  llmManager: directLlmManager,
  // app 模式：image-ipc 同款晚绑定。LLM 初始化晚于 IPC 注册，所以在 handler
  // 里 lazy-read app.llmManager 才能拿到真实 manager（直接传 null/undefined
  // 会被一直钉死成 null）。
  app,
} = {}) {
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;
  const captureImpl = injectedCapture || captureScreenshot;
  const tesseractImpl = injectedRecognize || recognize;
  const llmImpl = injectedRecognizeWithLLM || recognizeWithLLM;
  const readScreenshotImpl = injectedReadScreenshotFile || readScreenshotFile;
  const removeScreenshotImpl =
    injectedRemoveScreenshotFile || removeScreenshotFile;
  const getLLM = () => app?.llmManager ?? directLlmManager ?? null;

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
      const engine =
        options.engine === "tesseract" ||
        options.engine === "llm" ||
        options.engine === "auto"
          ? options.engine
          : "auto";
      const imageBuffer = await readScreenshotImpl(filePath);
      const result = await recognizeDispatch(imageBuffer, {
        engine,
        lang,
        llmManager: getLLM(),
        tesseractImpl,
        llmImpl,
      });
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
      await removeScreenshotImpl(filePath);
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
  _internal: {
    captureScreenshot,
    recognize,
    recognizeWithLLM,
    recognizeDispatch,
    readScreenshotFile,
    removeScreenshotFile,
    writeScreenshotFile,
    resolveTmpScreenshotPath,
    sameFileIdentity,
    isInsideTmpDir,
    tmpFilePath,
    MAX_SCREENSHOT_BYTES,
    PURE_OCR_PROMPT,
    VISION_CAPABLE_PROVIDERS,
  },
};
