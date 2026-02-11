/**
 * ActionReplay - 操作回放引擎
 *
 * 支持：
 * - 录制操作回放
 * - 变速播放
 * - 步进执行
 * - 断点暂停
 *
 * @module browser/actions/action-replay
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');

/**
 * 回放状态
 */
const ReplayState = {
  IDLE: 'idle',
  PLAYING: 'playing',
  PAUSED: 'paused',
  STEPPING: 'stepping',
  COMPLETED: 'completed',
  ERROR: 'error'
};

/**
 * 回放模式
 */
const ReplayMode = {
  NORMAL: 'normal',           // 正常速度
  FAST: 'fast',               // 快速 (2x)
  SLOW: 'slow',               // 慢速 (0.5x)
  STEP_BY_STEP: 'step',       // 单步执行
  INSTANT: 'instant'          // 即时执行（无延迟）
};

class ActionReplay extends EventEmitter {
  constructor(browserEngine = null, config = {}) {
    super();

    this.browserEngine = browserEngine;
    this.config = {
      defaultSpeed: config.defaultSpeed || 1.0,
      minDelay: config.minDelay || 50,
      maxDelay: config.maxDelay || 5000,
      screenshotOnStep: config.screenshotOnStep || false,
      stopOnError: config.stopOnError !== false,
      ...config
    };

    // 回放状态
    this.state = ReplayState.IDLE;
    this.currentSession = null;
    this.actionQueue = [];
    this.currentIndex = 0;
    this.speed = this.config.defaultSpeed;
    this.breakpoints = new Set();

    // 执行器映射
    this.executors = new Map();
    this._registerDefaultExecutors();
  }

  /**
   * 注册默认操作执行器
   * @private
   */
  _registerDefaultExecutors() {
    // 鼠标点击
    this.registerExecutor('click', async (action, context) => {
      const { CoordinateAction } = require('./coordinate-action');
      const coord = new CoordinateAction(this.browserEngine);
      return coord.clickAt(context.targetId, action.x, action.y, action.options);
    });

    // 双击
    this.registerExecutor('doubleClick', async (action, context) => {
      const { CoordinateAction } = require('./coordinate-action');
      const coord = new CoordinateAction(this.browserEngine);
      return coord.doubleClickAt(context.targetId, action.x, action.y);
    });

    // 右键点击
    this.registerExecutor('rightClick', async (action, context) => {
      const { CoordinateAction } = require('./coordinate-action');
      const coord = new CoordinateAction(this.browserEngine);
      return coord.rightClickAt(context.targetId, action.x, action.y);
    });

    // 鼠标移动
    this.registerExecutor('move', async (action, context) => {
      const { CoordinateAction } = require('./coordinate-action');
      const coord = new CoordinateAction(this.browserEngine);
      return coord.moveTo(context.targetId, action.x, action.y, action.options);
    });

    // 拖拽
    this.registerExecutor('drag', async (action, context) => {
      const { CoordinateAction } = require('./coordinate-action');
      const coord = new CoordinateAction(this.browserEngine);
      return coord.dragFromTo(
        context.targetId,
        action.fromX, action.fromY,
        action.toX, action.toY,
        action.options
      );
    });

    // 键盘输入
    this.registerExecutor('type', async (action, context) => {
      const { KeyboardAction } = require('./keyboard-action');
      const keyboard = new KeyboardAction(this.browserEngine);
      return keyboard.execute(context.targetId, {
        action: 'type',
        text: action.text,
        ...action.options
      });
    });

    // 按键
    this.registerExecutor('key', async (action, context) => {
      const { KeyboardAction } = require('./keyboard-action');
      const keyboard = new KeyboardAction(this.browserEngine);
      return keyboard.execute(context.targetId, {
        action: 'press',
        key: action.key,
        modifiers: action.modifiers
      });
    });

    // 滚动
    this.registerExecutor('scroll', async (action, context) => {
      const { ScrollAction } = require('./scroll-action');
      const scroll = new ScrollAction(this.browserEngine);
      return scroll.execute(context.targetId, {
        direction: action.direction,
        amount: action.amount,
        x: action.x,
        y: action.y
      });
    });

    // 导航
    this.registerExecutor('navigate', async (action, context) => {
      return this.browserEngine.navigate(context.targetId, action.url, action.options);
    });

    // 等待
    this.registerExecutor('wait', async (action) => {
      await this._delay(action.duration || 1000);
      return { success: true, waited: action.duration };
    });

    // 截图
    this.registerExecutor('screenshot', async (action, context) => {
      const buffer = await this.browserEngine.screenshot(context.targetId, action.options);
      return { success: true, screenshot: buffer.toString('base64') };
    });

    // 断言
    this.registerExecutor('assert', async (action, context) => {
      // 简单断言实现
      const snapshot = await this.browserEngine.takeSnapshot(context.targetId);
      const element = snapshot.elements.find(e => e.ref === action.ref);

      if (!element) {
        throw new Error(`Assertion failed: Element ${action.ref} not found`);
      }

      if (action.text && !element.text?.includes(action.text)) {
        throw new Error(`Assertion failed: Expected text "${action.text}" not found`);
      }

      if (action.visible !== undefined && element.visible !== action.visible) {
        throw new Error(`Assertion failed: Element visibility mismatch`);
      }

      return { success: true, element };
    });

    // 视觉点击
    this.registerExecutor('visualClick', async (action, context) => {
      const { VisionAction } = require('./vision-action');
      let llmService = null;
      try {
        const { getLLMService } = require('../../llm/llm-service');
        llmService = getLLMService();
      } catch (e) {
        throw new Error('LLM Service required for visual click');
      }
      const vision = new VisionAction(this.browserEngine, llmService);
      return vision.visualClick(context.targetId, action.description, action.options);
    });
  }

  /**
   * 注册自定义操作执行器
   * @param {string} actionType - 操作类型
   * @param {Function} executor - 执行器函数
   */
  registerExecutor(actionType, executor) {
    this.executors.set(actionType, executor);
  }

  /**
   * 设置浏览器引擎
   * @param {Object} browserEngine
   */
  setBrowserEngine(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * 加载操作序列
   * @param {Array} actions - 操作列表
   * @param {Object} options - 加载选项
   * @returns {Object}
   */
  load(actions, options = {}) {
    if (this.state === ReplayState.PLAYING) {
      throw new Error('Cannot load while playing');
    }

    this.actionQueue = actions.map((action, index) => ({
      ...action,
      index,
      status: 'pending'
    }));

    this.currentIndex = 0;
    this.currentSession = {
      id: `replay_${Date.now()}`,
      startTime: null,
      endTime: null,
      targetId: options.targetId,
      totalActions: actions.length,
      completedActions: 0,
      failedActions: 0,
      results: []
    };

    this.state = ReplayState.IDLE;

    this.emit('loaded', {
      sessionId: this.currentSession.id,
      actionCount: actions.length
    });

    return {
      success: true,
      sessionId: this.currentSession.id,
      actionCount: actions.length
    };
  }

  /**
   * 从录制加载
   * @param {Object} recording - 录制数据（来自 ScreenRecorder 的元数据）
   * @param {Array} actions - 关联的操作序列
   * @returns {Object}
   */
  loadFromRecording(recording, actions) {
    return this.load(actions, {
      targetId: recording.targetId,
      recordingId: recording.id
    });
  }

  /**
   * 开始回放
   * @param {Object} options - 回放选项
   * @returns {Promise<Object>}
   */
  async play(options = {}) {
    if (!this.currentSession || this.actionQueue.length === 0) {
      throw new Error('No actions loaded');
    }

    if (this.state === ReplayState.PLAYING) {
      throw new Error('Already playing');
    }

    this.speed = options.speed || this.speed;
    this.currentSession.startTime = new Date().toISOString();
    this.state = ReplayState.PLAYING;

    this.emit('started', {
      sessionId: this.currentSession.id,
      speed: this.speed
    });

    try {
      await this._executeLoop();

      this.currentSession.endTime = new Date().toISOString();
      this.state = ReplayState.COMPLETED;

      const result = {
        success: true,
        sessionId: this.currentSession.id,
        completed: this.currentSession.completedActions,
        failed: this.currentSession.failedActions,
        total: this.currentSession.totalActions,
        duration: new Date(this.currentSession.endTime) - new Date(this.currentSession.startTime)
      };

      this.emit('completed', result);

      return result;

    } catch (error) {
      this.state = ReplayState.ERROR;
      this.emit('error', { error: error.message, index: this.currentIndex });
      throw error;
    }
  }

  /**
   * 执行循环
   * @private
   */
  async _executeLoop() {
    while (this.currentIndex < this.actionQueue.length) {
      if (this.state === ReplayState.PAUSED) {
        await this._waitForResume();
      }

      if (this.state !== ReplayState.PLAYING && this.state !== ReplayState.STEPPING) {
        break;
      }

      // 检查断点
      if (this.breakpoints.has(this.currentIndex)) {
        this.state = ReplayState.PAUSED;
        this.emit('breakpoint', { index: this.currentIndex });
        await this._waitForResume();
      }

      const action = this.actionQueue[this.currentIndex];

      try {
        const result = await this._executeAction(action);
        action.status = 'completed';
        action.result = result;
        this.currentSession.completedActions++;
        this.currentSession.results.push({
          index: this.currentIndex,
          action: action.type,
          success: true,
          result
        });

        this.emit('actionCompleted', {
          index: this.currentIndex,
          action: action.type,
          result
        });

      } catch (error) {
        action.status = 'failed';
        action.error = error.message;
        this.currentSession.failedActions++;
        this.currentSession.results.push({
          index: this.currentIndex,
          action: action.type,
          success: false,
          error: error.message
        });

        this.emit('actionFailed', {
          index: this.currentIndex,
          action: action.type,
          error: error.message
        });

        if (this.config.stopOnError) {
          throw error;
        }
      }

      this.currentIndex++;

      // 步进模式下每步暂停
      if (this.state === ReplayState.STEPPING) {
        this.state = ReplayState.PAUSED;
      }
    }
  }

  /**
   * 执行单个操作
   * @private
   */
  async _executeAction(action) {
    const executor = this.executors.get(action.type);

    if (!executor) {
      throw new Error(`Unknown action type: ${action.type}`);
    }

    // 操作前延迟
    if (action.delay && this.speed !== 0) {
      const delay = Math.min(
        Math.max(action.delay / this.speed, this.config.minDelay),
        this.config.maxDelay
      );
      await this._delay(delay);
    }

    // 执行操作
    const context = {
      targetId: this.currentSession.targetId,
      sessionId: this.currentSession.id,
      index: action.index
    };

    const result = await executor(action, context);

    // 截图（可选）
    if (this.config.screenshotOnStep && this.browserEngine) {
      try {
        const screenshot = await this.browserEngine.screenshot(context.targetId);
        result.screenshot = screenshot.toString('base64');
      } catch (e) {
        // 忽略截图错误
      }
    }

    return result;
  }

  /**
   * 等待恢复
   * @private
   */
  async _waitForResume() {
    return new Promise(resolve => {
      const handler = () => {
        if (this.state !== ReplayState.PAUSED) {
          this.removeListener('resumed', handler);
          resolve();
        }
      };
      this.on('resumed', handler);
    });
  }

  /**
   * 延迟
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 暂停回放
   * @returns {Object}
   */
  pause() {
    if (this.state !== ReplayState.PLAYING) {
      throw new Error('Not playing');
    }

    this.state = ReplayState.PAUSED;

    this.emit('paused', {
      index: this.currentIndex
    });

    return {
      success: true,
      pausedAt: this.currentIndex
    };
  }

  /**
   * 恢复回放
   * @returns {Object}
   */
  resume() {
    if (this.state !== ReplayState.PAUSED) {
      throw new Error('Not paused');
    }

    this.state = ReplayState.PLAYING;

    this.emit('resumed', {
      index: this.currentIndex
    });

    return {
      success: true,
      resumedAt: this.currentIndex
    };
  }

  /**
   * 单步执行
   * @returns {Promise<Object>}
   */
  async step() {
    if (this.state !== ReplayState.PAUSED && this.state !== ReplayState.IDLE) {
      throw new Error('Can only step when paused or idle');
    }

    if (this.currentIndex >= this.actionQueue.length) {
      return { success: false, reason: 'No more actions' };
    }

    this.state = ReplayState.STEPPING;

    const action = this.actionQueue[this.currentIndex];

    try {
      const result = await this._executeAction(action);
      action.status = 'completed';
      action.result = result;
      this.currentSession.completedActions++;

      this.currentIndex++;
      this.state = ReplayState.PAUSED;

      return {
        success: true,
        index: this.currentIndex - 1,
        action: action.type,
        result
      };

    } catch (error) {
      action.status = 'failed';
      action.error = error.message;
      this.currentSession.failedActions++;
      this.state = ReplayState.PAUSED;

      return {
        success: false,
        index: this.currentIndex,
        action: action.type,
        error: error.message
      };
    }
  }

  /**
   * 停止回放
   * @returns {Object}
   */
  stop() {
    if (this.state === ReplayState.IDLE || this.state === ReplayState.COMPLETED) {
      return { success: true, reason: 'Already stopped' };
    }

    const previousState = this.state;
    this.state = ReplayState.IDLE;

    this.emit('stopped', {
      stoppedAt: this.currentIndex,
      previousState
    });

    return {
      success: true,
      stoppedAt: this.currentIndex,
      completed: this.currentSession?.completedActions || 0,
      failed: this.currentSession?.failedActions || 0
    };
  }

  /**
   * 设置断点
   * @param {number} index - 操作索引
   */
  setBreakpoint(index) {
    this.breakpoints.add(index);
  }

  /**
   * 移除断点
   * @param {number} index - 操作索引
   */
  removeBreakpoint(index) {
    this.breakpoints.delete(index);
  }

  /**
   * 清除所有断点
   */
  clearBreakpoints() {
    this.breakpoints.clear();
  }

  /**
   * 跳转到指定位置
   * @param {number} index - 目标索引
   * @returns {Object}
   */
  jumpTo(index) {
    if (this.state === ReplayState.PLAYING) {
      throw new Error('Cannot jump while playing');
    }

    if (index < 0 || index >= this.actionQueue.length) {
      throw new Error('Invalid index');
    }

    this.currentIndex = index;

    return {
      success: true,
      jumpedTo: index
    };
  }

  /**
   * 设置回放速度
   * @param {number} speed - 速度倍数
   */
  setSpeed(speed) {
    if (speed <= 0) {
      throw new Error('Speed must be positive');
    }
    this.speed = speed;
  }

  /**
   * 获取状态
   * @returns {Object}
   */
  getStatus() {
    return {
      state: this.state,
      sessionId: this.currentSession?.id,
      currentIndex: this.currentIndex,
      totalActions: this.actionQueue.length,
      completedActions: this.currentSession?.completedActions || 0,
      failedActions: this.currentSession?.failedActions || 0,
      speed: this.speed,
      breakpoints: Array.from(this.breakpoints)
    };
  }

  /**
   * 获取操作列表
   * @returns {Array}
   */
  getActions() {
    return this.actionQueue.map(a => ({
      index: a.index,
      type: a.type,
      status: a.status,
      delay: a.delay
    }));
  }

  /**
   * 获取执行结果
   * @returns {Array}
   */
  getResults() {
    return this.currentSession?.results || [];
  }

  /**
   * 重置
   */
  reset() {
    this.stop();
    this.actionQueue = [];
    this.currentIndex = 0;
    this.currentSession = null;
    this.breakpoints.clear();
    this.state = ReplayState.IDLE;
  }
}

// 单例
let actionReplayInstance = null;

function getActionReplay(browserEngine, config) {
  if (!actionReplayInstance) {
    actionReplayInstance = new ActionReplay(browserEngine, config);
  } else if (browserEngine) {
    actionReplayInstance.setBrowserEngine(browserEngine);
  }
  return actionReplayInstance;
}

module.exports = {
  ActionReplay,
  ReplayState,
  ReplayMode,
  getActionReplay
};
