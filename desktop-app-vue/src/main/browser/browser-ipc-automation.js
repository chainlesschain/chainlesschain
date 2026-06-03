/**
 * Browser IPC handlers — automation group.
 * Split verbatim from browser-ipc.js registerBrowserIPC(); see that file for
 * the shared ctx ({ _ipcMain, _getBrowserEngine, _getAutomationAgent,
 * withErrorHandler, getBrowserEngine }).
 *
 * @module browser/browser-ipc-automation
 */
const { logger } = require("../utils/logger");

function registerAutomationHandlers(ctx) {
  const { _ipcMain, _getBrowserEngine, _getAutomationAgent, withErrorHandler } =
    ctx;

  // ==================== Phase 2: 智能快照和元素操作 ====================

  /**
   * 获取页面快照
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 快照选项
   * @returns {Promise<Object>} 快照对象
   */
  _ipcMain.handle(
    "browser:snapshot",
    withErrorHandler(async (event, targetId, options = {}) => {
      const engine = _getBrowserEngine();
      const snapshot = await engine.takeSnapshot(targetId, options);

      logger.info("[Browser IPC] Snapshot taken", {
        targetId,
        elementsCount: snapshot.elementsCount,
      });

      return snapshot;
    }),
  );

  /**
   * 执行元素操作
   * @param {string} targetId - 标签页 ID
   * @param {string} action - 操作类型 (click/type/select/drag/hover)
   * @param {string} ref - 元素引用
   * @param {Object} options - 操作选项
   * @returns {Promise<Object>} 操作结果
   */
  _ipcMain.handle(
    "browser:act",
    withErrorHandler(async (event, targetId, action, ref, options = {}) => {
      const engine = _getBrowserEngine();
      const result = await engine.act(targetId, action, ref, options);

      logger.info("[Browser IPC] Element action executed", {
        targetId,
        action,
        ref,
      });

      return result;
    }),
  );

  /**
   * 查找元素
   * @param {string} targetId - 标签页 ID
   * @param {string} ref - 元素引用
   * @returns {Promise<Object>} 元素对象
   */
  _ipcMain.handle(
    "browser:findElement",
    withErrorHandler(async (event, targetId, ref) => {
      const engine = _getBrowserEngine();
      const element = engine.findElement(targetId, ref);

      if (!element) {
        throw new Error(`Element ${ref} not found`);
      }

      logger.debug("[Browser IPC] Element found", { targetId, ref });

      return element;
    }),
  );

  /**
   * 验证引用是否有效
   * @param {string} targetId - 标签页 ID
   * @param {string} ref - 元素引用
   * @returns {Promise<boolean>}
   */
  _ipcMain.handle(
    "browser:validateRef",
    withErrorHandler(async (event, targetId, ref) => {
      const engine = _getBrowserEngine();
      const isValid = engine.validateRef(targetId, ref);

      logger.debug("[Browser IPC] Reference validated", {
        targetId,
        ref,
        isValid,
      });

      return isValid;
    }),
  );

  /**
   * 清除快照缓存
   * @param {string} targetId - 标签页 ID（可选）
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clearSnapshot",
    withErrorHandler(async (event, targetId = null) => {
      const engine = _getBrowserEngine();
      engine.clearSnapshot(targetId);

      logger.info("[Browser IPC] Snapshot cleared", { targetId });

      return { success: true };
    }),
  );

  /**
   * 获取快照统计
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:getSnapshotStats",
    withErrorHandler(async (event) => {
      const engine = _getBrowserEngine();
      const stats = engine.getSnapshotStats();

      logger.debug("[Browser IPC] Snapshot stats retrieved", {
        totalSnapshots: stats.totalSnapshots,
      });

      return stats;
    }),
  );

  // ==================== Phase 3: AI 自然语言控制 ====================

  /**
   * 执行 AI 指令
   * @param {string} targetId - 标签页 ID
   * @param {string} prompt - 自然语言指令
   * @param {Object} options - 执行选项
   * @returns {Promise<Object>} 执行结果
   */
  _ipcMain.handle(
    "browser:aiExecute",
    withErrorHandler(async (event, targetId, prompt, options = {}) => {
      const agent = _getAutomationAgent();

      if (!agent.llmService) {
        throw new Error(
          "LLM Service not available. Please configure LLM settings.",
        );
      }

      const result = await agent.execute(targetId, prompt, options);

      logger.info("[Browser IPC] AI command executed", {
        targetId,
        prompt,
        stepsCount: result.steps.length,
      });

      return result;
    }),
  );

  /**
   * 解析 AI 指令（仅解析，不执行）
   * @param {string} targetId - 标签页 ID
   * @param {string} prompt - 自然语言指令
   * @returns {Promise<Array>} 操作步骤
   */
  _ipcMain.handle(
    "browser:aiParse",
    withErrorHandler(async (event, targetId, prompt) => {
      const agent = _getAutomationAgent();

      if (!agent.llmService) {
        throw new Error(
          "LLM Service not available. Please configure LLM settings.",
        );
      }

      const engine = _getBrowserEngine();
      const snapshot = await engine.takeSnapshot(targetId, {
        interactive: true,
        visible: true,
        roleRefs: true,
      });

      const steps = await agent.parseCommand(prompt, snapshot);

      logger.info("[Browser IPC] AI command parsed", {
        targetId,
        prompt,
        stepsCount: steps.length,
      });

      return { steps, snapshot };
    }),
  );

  /**
   * 获取 AI 执行历史
   * @param {number} limit - 返回数量限制
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:aiGetHistory",
    withErrorHandler(async (event, limit = 10) => {
      const agent = _getAutomationAgent();
      const history = agent.getHistory(limit);

      logger.debug("[Browser IPC] AI history retrieved", {
        count: history.length,
      });

      return history;
    }),
  );

  /**
   * 清除 AI 执行历史
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:aiClearHistory",
    withErrorHandler(async (event) => {
      const agent = _getAutomationAgent();
      agent.clearHistory();

      logger.info("[Browser IPC] AI history cleared");

      return { success: true };
    }),
  );

  // ==================== Phase 4: Extended Actions ====================

  /**
   * Execute scroll action
   * @param {string} targetId - Tab ID
   * @param {Object} options - Scroll options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:action:scroll",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { ScrollAction } = require("./actions");
      const engine = _getBrowserEngine();
      const scrollAction = new ScrollAction(engine);
      return scrollAction.execute(targetId, options);
    }),
  );

  /**
   * Execute keyboard action
   * @param {string} targetId - Tab ID
   * @param {Object} options - Keyboard options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:action:keyboard",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { KeyboardAction } = require("./actions");
      const engine = _getBrowserEngine();
      const keyboardAction = new KeyboardAction(engine);
      return keyboardAction.execute(targetId, options);
    }),
  );

  /**
   * Execute file upload action
   * @param {string} targetId - Tab ID
   * @param {Object} options - Upload options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:action:upload",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { UploadAction } = require("./actions");
      const engine = _getBrowserEngine();
      const uploadAction = new UploadAction(engine);
      return uploadAction.execute(targetId, options);
    }),
  );

  /**
   * Execute multi-tab action
   * @param {string} targetId - Primary tab ID
   * @param {Object} options - Multi-tab options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:action:multiTab",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { MultiTabAction } = require("./actions");
      const engine = _getBrowserEngine();
      const multiTabAction = new MultiTabAction(engine);
      return multiTabAction.execute(targetId, options);
    }),
  );

  // ==================== Phase 4: Advanced Scanning ====================

  /**
   * Advanced page scan (Shadow DOM + iframes)
   * @param {string} targetId - Tab ID
   * @param {Object} options - Scan options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:scan:advanced",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { ShadowDOMScanner, IframeScanner } = require("./advanced");
      const engine = _getBrowserEngine();

      const result = {
        shadowDOM: null,
        iframes: null,
      };

      if (options.scanShadowDOM !== false) {
        const shadowScanner = new ShadowDOMScanner(engine);
        result.shadowDOM = await shadowScanner.scan(
          targetId,
          options.shadowOptions,
        );
      }

      if (options.scanIframes !== false) {
        const iframeScanner = new IframeScanner(engine);
        result.iframes = await iframeScanner.scan(
          targetId,
          options.iframeOptions,
        );
      }

      return result;
    }),
  );

  // ==================== Phase 5: OCR ====================

  /**
   * OCR recognize text
   * @param {string} targetId - Tab ID
   * @param {Object} options - OCR options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:ocr:recognize",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { OCREngine } = require("./diagnostics");
      const engine = _getBrowserEngine();
      const page = engine.getPage(targetId);
      const ocr = new OCREngine(options);
      return ocr.recognizeFromPage(page, options);
    }),
  );

  // ==================== Phase 5: Screenshot Comparison ====================

  /**
   * Compare screenshots
   * @param {Buffer|string} baseline - Baseline screenshot
   * @param {Buffer|string} current - Current screenshot
   * @param {Object} options - Compare options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:screenshot:compare",
    withErrorHandler(async (event, baseline, current, options = {}) => {
      const { ScreenshotDiff } = require("./diagnostics");
      const diff = new ScreenshotDiff(options);
      return diff.compare(
        Buffer.isBuffer(baseline) ? baseline : Buffer.from(baseline, "base64"),
        Buffer.isBuffer(current) ? current : Buffer.from(current, "base64"),
        options,
      );
    }),
  );
}

module.exports = { registerAutomationHandlers };
