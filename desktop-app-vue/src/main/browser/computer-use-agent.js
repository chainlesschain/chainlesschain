/**
 * ComputerUseAgent - 统一的电脑操作代理（类似 Claude Computer Use）
 *
 * 整合所有电脑操作能力：
 * - 浏览器自动化
 * - 桌面操作
 * - 视觉理解
 * - 坐标控制
 * - 网络拦截
 *
 * 提供类似 Claude Computer Use 的统一 API
 *
 * @module browser/computer-use-agent
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');
const { BrowserEngine } = require('./browser-engine');
const {
  CoordinateAction,
  VisionAction,
  NetworkInterceptor,
  DesktopAction,
  KeyboardAction,
  ScrollAction
} = require('./actions');

/**
 * 操作类型
 */
const ActionType = {
  // 鼠标操作
  CLICK: 'click',
  DOUBLE_CLICK: 'double_click',
  RIGHT_CLICK: 'right_click',
  MOUSE_MOVE: 'mouse_move',
  DRAG: 'drag',

  // 键盘操作
  TYPE: 'type',
  KEY: 'key',
  SHORTCUT: 'shortcut',

  // 滚动操作
  SCROLL: 'scroll',

  // 截图操作
  SCREENSHOT: 'screenshot',

  // 视觉操作
  VISION_CLICK: 'vision_click',
  VISION_ANALYZE: 'vision_analyze',
  VISION_LOCATE: 'vision_locate',

  // 浏览器操作
  NAVIGATE: 'navigate',
  BACK: 'back',
  FORWARD: 'forward',
  REFRESH: 'refresh',

  // 等待操作
  WAIT: 'wait',

  // 桌面操作
  DESKTOP_CLICK: 'desktop_click',
  DESKTOP_TYPE: 'desktop_type',
  DESKTOP_SCREENSHOT: 'desktop_screenshot'
};

/**
 * 操作模式
 */
const OperationMode = {
  BROWSER: 'browser',    // 浏览器内操作
  DESKTOP: 'desktop',    // 桌面级操作
  AUTO: 'auto'           // 自动选择
};

class ComputerUseAgent extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      mode: config.mode || OperationMode.AUTO,
      defaultTimeout: config.defaultTimeout || 30000,
      screenshotOnError: config.screenshotOnError ?? true,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      ...config
    };

    // 组件
    this.browserEngine = null;
    this.coordinateAction = null;
    this.visionAction = null;
    this.networkInterceptor = null;
    this.desktopAction = null;
    this.keyboardAction = null;
    this.scrollAction = null;

    // LLM 服务
    this.llmService = null;

    // 状态
    this.isInitialized = false;
    this.currentTargetId = null;
    this.executionHistory = [];
    this.maxHistorySize = 100;
  }

  /**
   * 初始化代理
   * @param {Object} options - 初始化选项
   * @returns {Promise<void>}
   */
  async initialize(options = {}) {
    if (this.isInitialized) {
      return;
    }

    // 初始化浏览器引擎
    this.browserEngine = new BrowserEngine({
      headless: options.headless || false,
      cdpPort: options.cdpPort || 18800
    });

    // 初始化各个操作模块
    this.coordinateAction = new CoordinateAction(this.browserEngine);
    this.keyboardAction = new KeyboardAction(this.browserEngine);
    this.scrollAction = new ScrollAction(this.browserEngine);
    this.networkInterceptor = new NetworkInterceptor(this.browserEngine);
    this.desktopAction = new DesktopAction();

    // 尝试加载 LLM 服务
    try {
      const { getLLMService } = require('../llm/llm-service');
      this.llmService = getLLMService();
      this.visionAction = new VisionAction(this.browserEngine, this.llmService);
    } catch (e) {
      console.warn('[ComputerUseAgent] LLM Service not available, vision features disabled');
    }

    // 启动浏览器
    if (options.startBrowser !== false) {
      await this.browserEngine.start(options.browserOptions);
    }

    this.isInitialized = true;
    this.emit('initialized');
  }

  /**
   * 设置 LLM 服务
   * @param {Object} llmService - LLM 服务实例
   */
  setLLMService(llmService) {
    this.llmService = llmService;
    if (this.visionAction) {
      this.visionAction.setLLMService(llmService);
    } else {
      this.visionAction = new VisionAction(this.browserEngine, llmService);
    }
  }

  /**
   * 打开新标签页
   * @param {string} url - URL
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async openTab(url, options = {}) {
    this._ensureInitialized();

    const profileName = options.profile || 'default';

    // 确保上下文存在
    await this.browserEngine.createContext(profileName);

    // 打开标签页
    const result = await this.browserEngine.openTab(profileName, url, options);
    this.currentTargetId = result.targetId;

    this.emit('tabOpened', result);

    return result;
  }

  /**
   * 执行操作
   * @param {Object} action - 操作配置
   * @returns {Promise<Object>}
   */
  async execute(action) {
    this._ensureInitialized();

    const startTime = Date.now();
    const targetId = action.targetId || this.currentTargetId;

    let result;
    let error = null;
    let retries = 0;

    while (retries <= this.config.maxRetries) {
      try {
        result = await this._executeAction(action, targetId);
        break;
      } catch (e) {
        error = e;
        retries++;

        if (retries <= this.config.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));

          // 错误时截图
          if (this.config.screenshotOnError && targetId) {
            try {
              const screenshot = await this.browserEngine.screenshot(targetId);
              this.emit('errorScreenshot', { action, screenshot, error: e.message });
            } catch (screenshotError) {
              // 忽略截图错误
            }
          }
        }
      }
    }

    if (error && !result) {
      throw error;
    }

    // 记录历史
    const historyEntry = {
      id: `action_${Date.now()}`,
      action,
      result,
      duration: Date.now() - startTime,
      retries,
      timestamp: Date.now()
    };
    this._addToHistory(historyEntry);

    this.emit('actionExecuted', historyEntry);

    return result;
  }

  /**
   * 执行单个操作
   * @private
   */
  async _executeAction(action, targetId) {
    const { type } = action;

    switch (type) {
      // 鼠标操作
      case ActionType.CLICK:
        if (action.coordinate) {
          return this.coordinateAction.clickAt(targetId, action.x, action.y, action);
        } else if (action.ref) {
          return this.browserEngine.act(targetId, 'click', action.ref, action);
        } else {
          throw new Error('Click action requires coordinate (x, y) or element ref');
        }

      case ActionType.DOUBLE_CLICK:
        return this.coordinateAction.doubleClickAt(targetId, action.x, action.y, action);

      case ActionType.RIGHT_CLICK:
        return this.coordinateAction.rightClickAt(targetId, action.x, action.y, action);

      case ActionType.MOUSE_MOVE:
        return this.coordinateAction.moveTo(targetId, action.x, action.y, action);

      case ActionType.DRAG:
        return this.coordinateAction.dragFromTo(
          targetId,
          action.fromX, action.fromY,
          action.toX, action.toY,
          action
        );

      // 键盘操作
      case ActionType.TYPE:
        if (action.ref) {
          return this.browserEngine.act(targetId, 'type', action.ref, { text: action.text });
        } else {
          const page = this.browserEngine.getPage(targetId);
          await page.keyboard.type(action.text, { delay: action.delay });
          return { success: true, typed: action.text };
        }

      case ActionType.KEY:
        return this.keyboardAction.execute(targetId, {
          type: 'key',
          key: action.key,
          modifiers: action.modifiers
        });

      case ActionType.SHORTCUT:
        return this.keyboardAction.execute(targetId, {
          type: 'shortcut',
          shortcut: action.shortcut
        });

      // 滚动操作
      case ActionType.SCROLL:
        if (action.x !== undefined && action.y !== undefined) {
          return this.coordinateAction.scrollAt(
            targetId,
            action.x, action.y,
            action.deltaX || 0, action.deltaY || action.amount || 0,
            action
          );
        } else {
          return this.scrollAction.execute(targetId, action);
        }

      // 截图
      case ActionType.SCREENSHOT:
        const buffer = await this.browserEngine.screenshot(targetId, action);
        return {
          success: true,
          screenshot: buffer.toString('base64'),
          type: action.type || 'png'
        };

      // 视觉操作
      case ActionType.VISION_CLICK:
        if (!this.visionAction) {
          throw new Error('Vision features not available. LLM Service required.');
        }
        return this.visionAction.visualClick(targetId, action.description, action);

      case ActionType.VISION_ANALYZE:
        if (!this.visionAction) {
          throw new Error('Vision features not available. LLM Service required.');
        }
        return this.visionAction.analyze(targetId, action.prompt, action);

      case ActionType.VISION_LOCATE:
        if (!this.visionAction) {
          throw new Error('Vision features not available. LLM Service required.');
        }
        return this.visionAction.locateElement(targetId, action.description, action);

      // 浏览器操作
      case ActionType.NAVIGATE:
        return this.browserEngine.navigate(targetId, action.url, action);

      case ActionType.BACK:
        const backPage = this.browserEngine.getPage(targetId);
        await backPage.goBack();
        return { success: true, action: 'back' };

      case ActionType.FORWARD:
        const fwdPage = this.browserEngine.getPage(targetId);
        await fwdPage.goForward();
        return { success: true, action: 'forward' };

      case ActionType.REFRESH:
        const refreshPage = this.browserEngine.getPage(targetId);
        await refreshPage.reload();
        return { success: true, action: 'refresh' };

      // 等待
      case ActionType.WAIT:
        if (action.selector) {
          const waitPage = this.browserEngine.getPage(targetId);
          await waitPage.waitForSelector(action.selector, {
            timeout: action.timeout || this.config.defaultTimeout
          });
        } else {
          await new Promise(resolve => setTimeout(resolve, action.duration || 1000));
        }
        return { success: true, action: 'wait' };

      // 桌面操作
      case ActionType.DESKTOP_CLICK:
        return this.desktopAction.click(action.x, action.y, action);

      case ActionType.DESKTOP_TYPE:
        return this.desktopAction.typeText(action.text, action);

      case ActionType.DESKTOP_SCREENSHOT:
        return this.desktopAction.captureScreen(action);

      default:
        throw new Error(`Unknown action type: ${type}`);
    }
  }

  /**
   * 执行自然语言任务（需要 Vision AI）
   * @param {string} task - 任务描述
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async executeTask(task, options = {}) {
    this._ensureInitialized();

    if (!this.visionAction) {
      throw new Error('Vision features required for natural language tasks');
    }

    const targetId = options.targetId || this.currentTargetId;
    if (!targetId) {
      throw new Error('No active tab. Call openTab() first.');
    }

    return this.visionAction.executeVisualTask(targetId, task, options);
  }

  /**
   * 获取当前页面快照
   * @param {Object} options - 快照选项
   * @returns {Promise<Object>}
   */
  async getSnapshot(options = {}) {
    this._ensureInitialized();

    const targetId = options.targetId || this.currentTargetId;
    if (!targetId) {
      throw new Error('No active tab');
    }

    return this.browserEngine.takeSnapshot(targetId, options);
  }

  /**
   * 获取执行历史
   * @param {number} limit - 限制数量
   * @returns {Array}
   */
  getHistory(limit = 10) {
    return this.executionHistory.slice(-limit);
  }

  /**
   * 清除执行历史
   */
  clearHistory() {
    this.executionHistory = [];
  }

  /**
   * 添加到历史
   * @private
   */
  _addToHistory(entry) {
    this.executionHistory.push(entry);
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift();
    }
  }

  /**
   * 确保已初始化
   * @private
   */
  _ensureInitialized() {
    if (!this.isInitialized) {
      throw new Error('ComputerUseAgent not initialized. Call initialize() first.');
    }
  }

  /**
   * 获取状态
   * @returns {Object}
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      mode: this.config.mode,
      currentTargetId: this.currentTargetId,
      historySize: this.executionHistory.length,
      hasVision: !!this.visionAction,
      browserStatus: this.browserEngine?.getStatus()
    };
  }

  /**
   * 关闭代理
   * @returns {Promise<void>}
   */
  async close() {
    if (this.browserEngine) {
      await this.browserEngine.cleanup();
    }

    this.isInitialized = false;
    this.currentTargetId = null;

    this.emit('closed');
  }
}

// 便捷函数：创建并初始化代理
async function createComputerUseAgent(options = {}) {
  const agent = new ComputerUseAgent(options);
  await agent.initialize(options);
  return agent;
}

module.exports = {
  ComputerUseAgent,
  createComputerUseAgent,
  ActionType,
  OperationMode
};
