/**
 * DesktopAction - 桌面级操作（类似 Claude Computer Use 的系统操作能力）
 *
 * 支持：
 * - 系统级截图
 * - 桌面鼠标/键盘控制
 * - 窗口管理
 * - 剪贴板操作
 * - 文件对话框操作
 *
 * 注意：此模块需要 robotjs 依赖，部分功能仅在特定平台可用
 *
 * @module browser/actions/desktop-action
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');
const { screen, clipboard, nativeImage, desktopCapturer, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs').promises;

/**
 * 特殊按键映射
 */
const SpecialKey = {
  ENTER: 'enter',
  TAB: 'tab',
  ESCAPE: 'escape',
  BACKSPACE: 'backspace',
  DELETE: 'delete',
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
  HOME: 'home',
  END: 'end',
  PAGEUP: 'pageup',
  PAGEDOWN: 'pagedown',
  F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6',
  F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
  SPACE: 'space',
  PRINTSCREEN: 'printscreen',
  INSERT: 'insert',
  NUMLOCK: 'numlock',
  CAPSLOCK: 'capslock',
  SCROLLLOCK: 'scrolllock',
  PAUSE: 'pause'
};

/**
 * 修饰键
 */
const Modifier = {
  CONTROL: 'control',
  CTRL: 'control',
  ALT: 'alt',
  SHIFT: 'shift',
  COMMAND: 'command',
  META: 'command',
  WIN: 'command'
};

class DesktopAction extends EventEmitter {
  constructor() {
    super();

    // robotjs 延迟加载（可能未安装）
    this._robot = null;
    this._robotLoaded = false;
    this._robotError = null;

    // 屏幕信息缓存
    this._screenCache = null;
    this._screenCacheTime = 0;
    this._screenCacheMaxAge = 5000;
  }

  /**
   * 延迟加载 robotjs
   * @private
   */
  _loadRobot() {
    if (this._robotLoaded) {
      if (this._robotError) {
        throw this._robotError;
      }
      return this._robot;
    }

    this._robotLoaded = true;

    try {
      this._robot = require('robotjs');
      return this._robot;
    } catch (error) {
      this._robotError = new Error(
        'robotjs is not installed. Run: npm install robotjs\n' +
        'Note: robotjs requires native compilation and may need additional build tools.'
      );
      throw this._robotError;
    }
  }

  /**
   * 获取屏幕信息
   * @returns {Object}
   */
  getScreenInfo() {
    const now = Date.now();
    if (this._screenCache && now - this._screenCacheTime < this._screenCacheMaxAge) {
      return this._screenCache;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const allDisplays = screen.getAllDisplays();

    this._screenCache = {
      primary: {
        id: primaryDisplay.id,
        bounds: primaryDisplay.bounds,
        workArea: primaryDisplay.workArea,
        size: primaryDisplay.size,
        scaleFactor: primaryDisplay.scaleFactor
      },
      displays: allDisplays.map(d => ({
        id: d.id,
        bounds: d.bounds,
        workArea: d.workArea,
        size: d.size,
        scaleFactor: d.scaleFactor,
        isPrimary: d.id === primaryDisplay.id
      })),
      cursor: screen.getCursorScreenPoint()
    };
    this._screenCacheTime = now;

    return this._screenCache;
  }

  /**
   * 截取桌面屏幕
   * @param {Object} options - 截图选项
   * @returns {Promise<Object>}
   */
  async captureScreen(options = {}) {
    const displayId = options.displayId || screen.getPrimaryDisplay().id;

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: options.thumbnailSize || { width: 1920, height: 1080 }
      });

      // 找到匹配的显示器
      const source = sources.find(s =>
        s.display_id === String(displayId) || s.name.includes('Screen')
      ) || sources[0];

      if (!source) {
        throw new Error('No screen source available');
      }

      const thumbnail = source.thumbnail;

      // 保存到文件（可选）
      let filePath = null;
      if (options.saveTo) {
        filePath = options.saveTo;
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, thumbnail.toPNG());
      }

      this.emit('screenCaptured', { displayId, size: thumbnail.getSize() });

      return {
        success: true,
        image: thumbnail.toDataURL(),
        base64: thumbnail.toPNG().toString('base64'),
        size: thumbnail.getSize(),
        filePath
      };
    } catch (error) {
      throw new Error(`Screen capture failed: ${error.message}`);
    }
  }

  /**
   * 在桌面上点击
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {Object} options - 点击选项
   * @returns {Promise<Object>}
   */
  async click(x, y, options = {}) {
    const robot = this._loadRobot();

    const button = options.button || 'left';
    const double = options.double || false;

    // 移动鼠标
    robot.moveMouse(x, y);

    // 等待（可选）
    if (options.moveDelay) {
      await new Promise(resolve => setTimeout(resolve, options.moveDelay));
    }

    // 点击
    robot.mouseClick(button, double);

    this.emit('desktopClick', { x, y, button, double });

    return {
      success: true,
      action: 'click',
      x,
      y,
      button
    };
  }

  /**
   * 移动鼠标
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {Object} options - 移动选项
   * @returns {Promise<Object>}
   */
  async moveMouse(x, y, options = {}) {
    const robot = this._loadRobot();

    if (options.smooth) {
      // 平滑移动
      const current = robot.getMousePos();
      const steps = options.steps || 20;

      for (let i = 1; i <= steps; i++) {
        const progress = i / steps;
        const currentX = current.x + (x - current.x) * progress;
        const currentY = current.y + (y - current.y) * progress;
        robot.moveMouse(Math.round(currentX), Math.round(currentY));
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } else {
      robot.moveMouse(x, y);
    }

    this.emit('desktopMouseMove', { x, y });

    return {
      success: true,
      action: 'moveMouse',
      x,
      y
    };
  }

  /**
   * 获取鼠标位置
   * @returns {Object}
   */
  getMousePosition() {
    const robot = this._loadRobot();
    return robot.getMousePos();
  }

  /**
   * 拖拽操作
   * @param {number} fromX - 起始 X
   * @param {number} fromY - 起始 Y
   * @param {number} toX - 目标 X
   * @param {number} toY - 目标 Y
   * @param {Object} options - 拖拽选项
   * @returns {Promise<Object>}
   */
  async drag(fromX, fromY, toX, toY, options = {}) {
    const robot = this._loadRobot();

    // 移动到起始位置
    robot.moveMouse(fromX, fromY);
    await new Promise(resolve => setTimeout(resolve, 50));

    // 按下
    robot.mouseToggle('down');

    // 拖动
    const steps = options.steps || 20;
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const currentX = fromX + (toX - fromX) * progress;
      const currentY = fromY + (toY - fromY) * progress;
      robot.moveMouse(Math.round(currentX), Math.round(currentY));
      await new Promise(resolve => setTimeout(resolve, options.stepDelay || 10));
    }

    // 释放
    robot.mouseToggle('up');

    this.emit('desktopDrag', { from: { x: fromX, y: fromY }, to: { x: toX, y: toY } });

    return {
      success: true,
      action: 'drag',
      from: { x: fromX, y: fromY },
      to: { x: toX, y: toY }
    };
  }

  /**
   * 输入文本
   * @param {string} text - 要输入的文本
   * @param {Object} options - 输入选项
   * @returns {Promise<Object>}
   */
  async typeText(text, options = {}) {
    const robot = this._loadRobot();

    // robotjs 的 typeString 有时对中文支持不好
    // 使用剪贴板方式更可靠
    if (options.useClipboard || this._containsNonASCII(text)) {
      clipboard.writeText(text);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Ctrl+V / Cmd+V
      const modifier = process.platform === 'darwin' ? 'command' : 'control';
      robot.keyTap('v', modifier);
    } else {
      // 直接输入
      if (options.delay) {
        for (const char of text) {
          robot.typeString(char);
          await new Promise(resolve => setTimeout(resolve, options.delay));
        }
      } else {
        robot.typeString(text);
      }
    }

    this.emit('desktopTypeText', { length: text.length });

    return {
      success: true,
      action: 'typeText',
      length: text.length
    };
  }

  /**
   * 检查是否包含非 ASCII 字符
   * @private
   */
  _containsNonASCII(text) {
    return /[^\x00-\x7F]/.test(text);
  }

  /**
   * 按下按键
   * @param {string} key - 按键名称
   * @param {Array<string>} modifiers - 修饰键
   * @returns {Promise<Object>}
   */
  async pressKey(key, modifiers = []) {
    const robot = this._loadRobot();

    // 规范化修饰键
    const normalizedModifiers = modifiers.map(m => {
      const lower = m.toLowerCase();
      return Modifier[lower.toUpperCase()] || lower;
    });

    if (normalizedModifiers.length > 0) {
      robot.keyTap(key.toLowerCase(), normalizedModifiers);
    } else {
      robot.keyTap(key.toLowerCase());
    }

    this.emit('desktopKeyPress', { key, modifiers: normalizedModifiers });

    return {
      success: true,
      action: 'pressKey',
      key,
      modifiers: normalizedModifiers
    };
  }

  /**
   * 执行快捷键
   * @param {string} shortcut - 快捷键字符串（如 "Ctrl+C"）
   * @returns {Promise<Object>}
   */
  async executeShortcut(shortcut) {
    const parts = shortcut.split('+').map(p => p.trim());
    const key = parts.pop();
    const modifiers = parts;

    return this.pressKey(key, modifiers);
  }

  /**
   * 获取剪贴板内容
   * @param {string} type - 内容类型 (text/image/html)
   * @returns {Object}
   */
  getClipboard(type = 'text') {
    switch (type) {
      case 'text':
        return { success: true, content: clipboard.readText() };

      case 'html':
        return { success: true, content: clipboard.readHTML() };

      case 'image':
        const image = clipboard.readImage();
        if (image.isEmpty()) {
          return { success: false, error: 'No image in clipboard' };
        }
        return {
          success: true,
          content: image.toDataURL(),
          base64: image.toPNG().toString('base64'),
          size: image.getSize()
        };

      default:
        return { success: false, error: `Unknown clipboard type: ${type}` };
    }
  }

  /**
   * 设置剪贴板内容
   * @param {string} content - 内容
   * @param {string} type - 内容类型
   * @returns {Object}
   */
  setClipboard(content, type = 'text') {
    switch (type) {
      case 'text':
        clipboard.writeText(content);
        break;

      case 'html':
        clipboard.writeHTML(content);
        break;

      case 'image':
        // base64 或文件路径
        let image;
        if (content.startsWith('data:')) {
          image = nativeImage.createFromDataURL(content);
        } else {
          image = nativeImage.createFromPath(content);
        }
        clipboard.writeImage(image);
        break;

      default:
        return { success: false, error: `Unknown clipboard type: ${type}` };
    }

    this.emit('clipboardSet', { type });

    return { success: true, type };
  }

  /**
   * 获取所有窗口信息
   * @returns {Array}
   */
  getAllWindows() {
    const windows = BrowserWindow.getAllWindows();

    return windows.map(win => ({
      id: win.id,
      title: win.getTitle(),
      bounds: win.getBounds(),
      isVisible: win.isVisible(),
      isFocused: win.isFocused(),
      isMinimized: win.isMinimized(),
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen()
    }));
  }

  /**
   * 聚焦窗口
   * @param {number} windowId - 窗口 ID
   * @returns {Object}
   */
  focusWindow(windowId) {
    const win = BrowserWindow.fromId(windowId);
    if (!win) {
      return { success: false, error: `Window ${windowId} not found` };
    }

    if (win.isMinimized()) {
      win.restore();
    }
    win.focus();

    this.emit('windowFocused', { windowId });

    return { success: true, windowId };
  }

  /**
   * 设置窗口边界
   * @param {number} windowId - 窗口 ID
   * @param {Object} bounds - 边界 { x, y, width, height }
   * @returns {Object}
   */
  setWindowBounds(windowId, bounds) {
    const win = BrowserWindow.fromId(windowId);
    if (!win) {
      return { success: false, error: `Window ${windowId} not found` };
    }

    win.setBounds(bounds);

    this.emit('windowBoundsChanged', { windowId, bounds });

    return { success: true, windowId, bounds };
  }

  /**
   * 获取指定坐标的像素颜色
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @returns {Object}
   */
  getPixelColor(x, y) {
    const robot = this._loadRobot();
    const color = robot.getPixelColor(x, y);

    return {
      success: true,
      x,
      y,
      color: `#${color}`,
      rgb: {
        r: parseInt(color.substr(0, 2), 16),
        g: parseInt(color.substr(2, 2), 16),
        b: parseInt(color.substr(4, 2), 16)
      }
    };
  }

  /**
   * 滚动鼠标滚轮
   * @param {number} amount - 滚动量（正数向下，负数向上）
   * @returns {Object}
   */
  scroll(amount) {
    const robot = this._loadRobot();
    robot.scrollMouse(0, amount);

    this.emit('desktopScroll', { amount });

    return { success: true, action: 'scroll', amount };
  }

  /**
   * 统一执行入口
   * @param {Object} options - 操作选项
   * @returns {Promise<Object>}
   */
  async execute(options = {}) {
    const { action } = options;

    switch (action) {
      case 'captureScreen':
        return this.captureScreen(options);

      case 'click':
        return this.click(options.x, options.y, options);

      case 'moveMouse':
        return this.moveMouse(options.x, options.y, options);

      case 'drag':
        return this.drag(options.fromX, options.fromY, options.toX, options.toY, options);

      case 'typeText':
        return this.typeText(options.text, options);

      case 'pressKey':
        return this.pressKey(options.key, options.modifiers || []);

      case 'shortcut':
        return this.executeShortcut(options.shortcut);

      case 'getClipboard':
        return this.getClipboard(options.type);

      case 'setClipboard':
        return this.setClipboard(options.content, options.type);

      case 'getScreenInfo':
        return { success: true, ...this.getScreenInfo() };

      case 'getMousePosition':
        return { success: true, ...this.getMousePosition() };

      case 'getPixelColor':
        return this.getPixelColor(options.x, options.y);

      case 'scroll':
        return this.scroll(options.amount);

      case 'getAllWindows':
        return { success: true, windows: this.getAllWindows() };

      case 'focusWindow':
        return this.focusWindow(options.windowId);

      case 'setWindowBounds':
        return this.setWindowBounds(options.windowId, options.bounds);

      default:
        throw new Error(`Unknown desktop action: ${action}`);
    }
  }
}

module.exports = {
  DesktopAction,
  SpecialKey,
  Modifier
};
