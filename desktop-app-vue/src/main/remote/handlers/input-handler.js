/**
 * 输入控制远程处理器
 *
 * 处理来自 Android 端的输入控制命令：
 * - input.sendKeyPress: 发送按键 (NORMAL)
 * - input.sendKeyCombo: 发送组合键 (NORMAL)
 * - input.typeText: 输入文本 (NORMAL)
 * - input.mouseMove: 移动鼠标 (NORMAL)
 * - input.mouseClick: 鼠标点击 (NORMAL)
 * - input.mouseDoubleClick: 鼠标双击 (NORMAL)
 * - input.mouseDrag: 鼠标拖拽 (ADMIN)
 * - input.mouseScroll: 鼠标滚动 (NORMAL)
 * - input.getCursorPosition: 获取鼠标位置 (PUBLIC)
 * - input.getKeyboardLayout: 获取键盘布局 (PUBLIC)
 *
 * @module remote/handlers/input-handler
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const { logger } = require("../../utils/logger");

const execAsync = promisify(exec);

// 平台检测
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

// 有效的修饰键
const VALID_MODIFIERS = ["ctrl", "alt", "shift", "meta", "win", "cmd", "super"];

// Windows 虚拟键码映射
const WINDOWS_KEY_MAP = {
  // 功能键
  enter: "{ENTER}",
  return: "{ENTER}",
  tab: "{TAB}",
  escape: "{ESC}",
  esc: "{ESC}",
  backspace: "{BACKSPACE}",
  delete: "{DELETE}",
  del: "{DELETE}",
  insert: "{INSERT}",
  ins: "{INSERT}",
  home: "{HOME}",
  end: "{END}",
  pageup: "{PGUP}",
  pagedown: "{PGDN}",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  space: " ",
  // F键
  f1: "{F1}",
  f2: "{F2}",
  f3: "{F3}",
  f4: "{F4}",
  f5: "{F5}",
  f6: "{F6}",
  f7: "{F7}",
  f8: "{F8}",
  f9: "{F9}",
  f10: "{F10}",
  f11: "{F11}",
  f12: "{F12}",
  // 修饰键
  ctrl: "^",
  control: "^",
  alt: "%",
  shift: "+",
  win: "^{ESC}",
  // 特殊
  printscreen: "{PRTSC}",
  scrolllock: "{SCROLLLOCK}",
  pause: "{BREAK}",
  numlock: "{NUMLOCK}",
  capslock: "{CAPSLOCK}",
};

// macOS 键码映射
const MAC_KEY_MAP = {
  enter: "return",
  return: "return",
  tab: "tab",
  escape: "escape",
  esc: "escape",
  backspace: "delete",
  delete: "forward delete",
  space: "space",
  up: "up arrow",
  down: "down arrow",
  left: "left arrow",
  right: "right arrow",
  home: "home",
  end: "end",
  pageup: "page up",
  pagedown: "page down",
  f1: "f1",
  f2: "f2",
  f3: "f3",
  f4: "f4",
  f5: "f5",
  f6: "f6",
  f7: "f7",
  f8: "f8",
  f9: "f9",
  f10: "f10",
  f11: "f11",
  f12: "f12",
};

/**
 * 验证坐标值
 */
function validateCoordinate(value, name) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0 || num > 65535) {
    throw new Error(`Invalid ${name}: must be a number between 0 and 65535`);
  }
  return num;
}

/**
 * 验证按键名称（防止注入）
 */
function validateKeyName(key) {
  if (typeof key !== "string" || key.length === 0 || key.length > 20) {
    throw new Error("Invalid key name");
  }
  // 只允许字母数字和常见符号
  if (!/^[a-zA-Z0-9\-_]+$/.test(key)) {
    throw new Error("Invalid key name: contains disallowed characters");
  }
  return key.toLowerCase();
}

/**
 * 验证文本输入（防止注入）
 */
function validateText(text) {
  if (typeof text !== "string") {
    throw new Error("Text must be a string");
  }
  if (text.length > 10000) {
    throw new Error("Text too long (max 10000 characters)");
  }
  return text;
}

/**
 * 输入控制处理器类
 */
class InputHandler {
  constructor(options = {}) {
    this.options = {
      defaultTypeDelay: options.defaultTypeDelay || 50,
      maxTypeDelay: options.maxTypeDelay || 500,
      enableMouse: options.enableMouse !== false,
      enableKeyboard: options.enableKeyboard !== false,
      ...options,
    };

    logger.info("[InputHandler] 输入控制处理器已创建");
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[InputHandler] 处理命令: ${action}`);

    switch (action) {
      case "sendKeyPress":
        return await this.sendKeyPress(params, context);

      case "sendKeyCombo":
        return await this.sendKeyCombo(params, context);

      case "typeText":
        return await this.typeText(params, context);

      case "mouseMove":
        return await this.mouseMove(params, context);

      case "mouseClick":
        return await this.mouseClick(params, context);

      case "mouseDoubleClick":
        return await this.mouseDoubleClick(params, context);

      case "mouseDrag":
        return await this.mouseDrag(params, context);

      case "mouseScroll":
        return await this.mouseScroll(params, context);

      case "getCursorPosition":
        return await this.getCursorPosition(params, context);

      case "getKeyboardLayout":
        return await this.getKeyboardLayout(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 发送单个按键
   */
  async sendKeyPress(params, context) {
    const { key } = params;

    if (!key) {
      throw new Error('Parameter "key" is required');
    }

    if (!this.options.enableKeyboard) {
      throw new Error("Keyboard input is disabled");
    }

    const validKey = validateKeyName(key);
    logger.info(`[InputHandler] 发送按键: ${validKey}`);

    try {
      if (isWindows) {
        await this._sendWindowsKey(validKey);
      } else if (isMac) {
        await this._sendMacKey(validKey);
      } else if (isLinux) {
        await this._sendLinuxKey(validKey);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        key: validKey,
        message: `Key "${validKey}" sent`,
      };
    } catch (error) {
      logger.error("[InputHandler] 发送按键失败:", error);
      throw new Error(`Failed to send key: ${error.message}`);
    }
  }

  async _sendWindowsKey(key) {
    const mappedKey = WINDOWS_KEY_MAP[key] || key;
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${mappedKey.replace(/'/g, "''")}')
    `;
    await execAsync(`powershell -command "${script.replace(/"/g, '\\"')}"`);
  }

  async _sendMacKey(key) {
    const mappedKey = MAC_KEY_MAP[key] || key;
    await execAsync(
      `osascript -e 'tell application "System Events" to key code ${this._getMacKeyCode(mappedKey)}'`,
    );
  }

  _getMacKeyCode(key) {
    // macOS key codes
    const keyCodes = {
      return: 36,
      tab: 48,
      space: 49,
      delete: 51,
      escape: 53,
      "left arrow": 123,
      "right arrow": 124,
      "down arrow": 125,
      "up arrow": 126,
    };
    return keyCodes[key] || 0;
  }

  async _sendLinuxKey(key) {
    await execAsync(`xdotool key ${key}`);
  }

  /**
   * 发送组合键
   */
  async sendKeyCombo(params, context) {
    const { modifiers = [], key } = params;

    if (!key) {
      throw new Error('Parameter "key" is required');
    }

    if (!this.options.enableKeyboard) {
      throw new Error("Keyboard input is disabled");
    }

    // 验证修饰键
    const validModifiers = modifiers
      .map((m) => m.toLowerCase())
      .filter((m) => VALID_MODIFIERS.includes(m));

    const validKey = validateKeyName(key);

    logger.info(
      `[InputHandler] 发送组合键: ${validModifiers.join("+")}+${validKey}`,
    );

    try {
      if (isWindows) {
        await this._sendWindowsCombo(validModifiers, validKey);
      } else if (isMac) {
        await this._sendMacCombo(validModifiers, validKey);
      } else if (isLinux) {
        await this._sendLinuxCombo(validModifiers, validKey);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        modifiers: validModifiers,
        key: validKey,
        message: `Key combo "${validModifiers.join("+")}+${validKey}" sent`,
      };
    } catch (error) {
      logger.error("[InputHandler] 发送组合键失败:", error);
      throw new Error(`Failed to send key combo: ${error.message}`);
    }
  }

  async _sendWindowsCombo(modifiers, key) {
    let combo = "";
    for (const mod of modifiers) {
      if (mod === "ctrl" || mod === "control") {
        combo += "^";
      } else if (mod === "alt") {
        combo += "%";
      } else if (mod === "shift") {
        combo += "+";
      }
    }
    const mappedKey = WINDOWS_KEY_MAP[key] || key;
    combo += mappedKey;

    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${combo.replace(/'/g, "''")}')
    `;
    await execAsync(`powershell -command "${script.replace(/"/g, '\\"')}"`);
  }

  async _sendMacCombo(modifiers, key) {
    const modMap = {
      ctrl: "control down",
      control: "control down",
      alt: "option down",
      shift: "shift down",
      cmd: "command down",
      meta: "command down",
      win: "command down",
    };

    const modStr = modifiers
      .map((m) => modMap[m] || "")
      .filter(Boolean)
      .join(", ");
    const mappedKey = MAC_KEY_MAP[key] || key;

    await execAsync(
      `osascript -e 'tell application "System Events" to keystroke "${mappedKey}" using {${modStr}}'`,
    );
  }

  async _sendLinuxCombo(modifiers, key) {
    const combo = [...modifiers, key].join("+");
    await execAsync(`xdotool key ${combo}`);
  }

  /**
   * 输入文本
   */
  async typeText(params, context) {
    const { text, delay = this.options.defaultTypeDelay } = params;

    if (!text) {
      throw new Error('Parameter "text" is required');
    }

    if (!this.options.enableKeyboard) {
      throw new Error("Keyboard input is disabled");
    }

    const validText = validateText(text);
    const validDelay = Math.min(Math.max(0, delay), this.options.maxTypeDelay);

    logger.info(`[InputHandler] 输入文本 (${validText.length} 字符)`);

    try {
      if (isWindows) {
        await this._typeWindowsText(validText, validDelay);
      } else if (isMac) {
        await this._typeMacText(validText, validDelay);
      } else if (isLinux) {
        await this._typeLinuxText(validText, validDelay);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        length: validText.length,
        delay: validDelay,
        message: `Typed ${validText.length} characters`,
      };
    } catch (error) {
      logger.error("[InputHandler] 输入文本失败:", error);
      throw new Error(`Failed to type text: ${error.message}`);
    }
  }

  async _typeWindowsText(text, delay) {
    // 转义特殊字符
    const escaped = text
      .replace(/\+/g, "{+}")
      .replace(/\^/g, "{^}")
      .replace(/%/g, "{%}")
      .replace(/~/g, "{~}")
      .replace(/\(/g, "{(}")
      .replace(/\)/g, "{)}")
      .replace(/\[/g, "{[}")
      .replace(/\]/g, "{]}")
      .replace(/\{/g, "{{}}")
      .replace(/\}/g, "{}}");

    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
    `;
    await execAsync(`powershell -command "${script.replace(/"/g, '\\"')}"`);
  }

  async _typeMacText(text, delay) {
    // 转义双引号和反斜杠
    const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    await execAsync(
      `osascript -e 'tell application "System Events" to keystroke "${escaped}"'`,
    );
  }

  async _typeLinuxText(text, delay) {
    await execAsync(
      `xdotool type --delay ${delay} "${text.replace(/"/g, '\\"')}"`,
    );
  }

  /**
   * 移动鼠标
   */
  async mouseMove(params, context) {
    const { x, y, relative = false } = params;

    if (x === undefined || y === undefined) {
      throw new Error('Parameters "x" and "y" are required');
    }

    if (!this.options.enableMouse) {
      throw new Error("Mouse input is disabled");
    }

    const validX = validateCoordinate(x, "x");
    const validY = validateCoordinate(y, "y");

    logger.info(`[InputHandler] 移动鼠标到 (${validX}, ${validY})`);

    try {
      if (isWindows) {
        await this._moveWindowsMouse(validX, validY, relative);
      } else if (isMac) {
        await this._moveMacMouse(validX, validY, relative);
      } else if (isLinux) {
        await this._moveLinuxMouse(validX, validY, relative);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        x: validX,
        y: validY,
        relative,
        message: `Mouse moved to (${validX}, ${validY})`,
      };
    } catch (error) {
      logger.error("[InputHandler] 移动鼠标失败:", error);
      throw new Error(`Failed to move mouse: ${error.message}`);
    }
  }

  async _moveWindowsMouse(x, y, relative) {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      ${relative ? `$pos = [System.Windows.Forms.Cursor]::Position; $x = $pos.X + ${x}; $y = $pos.Y + ${y}` : `$x = ${x}; $y = ${y}`}
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
    `;
    await execAsync(`powershell -command "${script.replace(/"/g, '\\"')}"`);
  }

  async _moveMacMouse(x, y, relative) {
    if (relative) {
      await execAsync(`cliclick m:+${x},+${y}`);
    } else {
      await execAsync(`cliclick m:${x},${y}`);
    }
  }

  async _moveLinuxMouse(x, y, relative) {
    if (relative) {
      await execAsync(`xdotool mousemove_relative ${x} ${y}`);
    } else {
      await execAsync(`xdotool mousemove ${x} ${y}`);
    }
  }

  /**
   * 鼠标点击
   */
  async mouseClick(params, context) {
    const { button = "left", x, y } = params;

    if (!this.options.enableMouse) {
      throw new Error("Mouse input is disabled");
    }

    const validButton = ["left", "right", "middle"].includes(button)
      ? button
      : "left";

    logger.info(`[InputHandler] 鼠标${validButton}键点击`);

    try {
      // 如果提供了坐标，先移动鼠标
      if (x !== undefined && y !== undefined) {
        await this.mouseMove({ x, y }, context);
      }

      if (isWindows) {
        await this._clickWindowsMouse(validButton);
      } else if (isMac) {
        await this._clickMacMouse(validButton, x, y);
      } else if (isLinux) {
        await this._clickLinuxMouse(validButton);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        button: validButton,
        x,
        y,
        message: `Mouse ${validButton} click`,
      };
    } catch (error) {
      logger.error("[InputHandler] 鼠标点击失败:", error);
      throw new Error(`Failed to click mouse: ${error.message}`);
    }
  }

  async _clickWindowsMouse(button) {
    const buttonMap = { left: 1, right: 2, middle: 4 };
    const script = `
      Add-Type @'
      using System;
      using System.Runtime.InteropServices;
      public class Mouse {
        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
      }
'@
      $down = ${button === "left" ? "0x02" : button === "right" ? "0x08" : "0x20"}
      $up = ${button === "left" ? "0x04" : button === "right" ? "0x10" : "0x40"}
      [Mouse]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
      [Mouse]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
    `;
    await execAsync(`powershell -command "${script.replace(/"/g, '\\"')}"`);
  }

  async _clickMacMouse(button, x, y) {
    const cmd = button === "right" ? "rc" : "c";
    if (x !== undefined && y !== undefined) {
      await execAsync(`cliclick ${cmd}:${x},${y}`);
    } else {
      await execAsync(`cliclick ${cmd}:.`);
    }
  }

  async _clickLinuxMouse(button) {
    const buttonNum = button === "left" ? 1 : button === "right" ? 3 : 2;
    await execAsync(`xdotool click ${buttonNum}`);
  }

  /**
   * 鼠标双击
   */
  async mouseDoubleClick(params, context) {
    const { button = "left", x, y } = params;

    if (!this.options.enableMouse) {
      throw new Error("Mouse input is disabled");
    }

    logger.info(`[InputHandler] 鼠标双击`);

    try {
      if (x !== undefined && y !== undefined) {
        await this.mouseMove({ x, y }, context);
      }

      if (isWindows) {
        await this._doubleClickWindowsMouse(button);
      } else if (isMac) {
        await this._doubleClickMacMouse(button, x, y);
      } else if (isLinux) {
        await this._doubleClickLinuxMouse(button);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        button,
        x,
        y,
        message: `Mouse double click`,
      };
    } catch (error) {
      logger.error("[InputHandler] 鼠标双击失败:", error);
      throw new Error(`Failed to double click: ${error.message}`);
    }
  }

  async _doubleClickWindowsMouse(button) {
    // 执行两次点击
    await this._clickWindowsMouse(button);
    await new Promise((r) => setTimeout(r, 50));
    await this._clickWindowsMouse(button);
  }

  async _doubleClickMacMouse(button, x, y) {
    const cmd = button === "right" ? "rc" : "dc";
    if (x !== undefined && y !== undefined) {
      await execAsync(`cliclick ${cmd}:${x},${y}`);
    } else {
      await execAsync(`cliclick ${cmd}:.`);
    }
  }

  async _doubleClickLinuxMouse(button) {
    const buttonNum = button === "left" ? 1 : button === "right" ? 3 : 2;
    await execAsync(`xdotool click --repeat 2 --delay 50 ${buttonNum}`);
  }

  /**
   * 鼠标拖拽
   */
  async mouseDrag(params, context) {
    const { startX, startY, endX, endY, button = "left" } = params;

    if (
      startX === undefined ||
      startY === undefined ||
      endX === undefined ||
      endY === undefined
    ) {
      throw new Error(
        'Parameters "startX", "startY", "endX", "endY" are required',
      );
    }

    if (!this.options.enableMouse) {
      throw new Error("Mouse input is disabled");
    }

    const validStartX = validateCoordinate(startX, "startX");
    const validStartY = validateCoordinate(startY, "startY");
    const validEndX = validateCoordinate(endX, "endX");
    const validEndY = validateCoordinate(endY, "endY");

    logger.info(
      `[InputHandler] 鼠标拖拽 (${validStartX},${validStartY}) -> (${validEndX},${validEndY})`,
    );

    try {
      if (isWindows) {
        await this._dragWindowsMouse(
          validStartX,
          validStartY,
          validEndX,
          validEndY,
        );
      } else if (isMac) {
        await this._dragMacMouse(
          validStartX,
          validStartY,
          validEndX,
          validEndY,
        );
      } else if (isLinux) {
        await this._dragLinuxMouse(
          validStartX,
          validStartY,
          validEndX,
          validEndY,
        );
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        startX: validStartX,
        startY: validStartY,
        endX: validEndX,
        endY: validEndY,
        message: `Mouse dragged from (${validStartX},${validStartY}) to (${validEndX},${validEndY})`,
      };
    } catch (error) {
      logger.error("[InputHandler] 鼠标拖拽失败:", error);
      throw new Error(`Failed to drag mouse: ${error.message}`);
    }
  }

  async _dragWindowsMouse(startX, startY, endX, endY) {
    const script = `
      Add-Type @'
      using System;
      using System.Runtime.InteropServices;
      public class Mouse {
        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);
        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
      }
'@
      [Mouse]::SetCursorPos(${startX}, ${startY})
      Start-Sleep -Milliseconds 50
      [Mouse]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 50
      [Mouse]::SetCursorPos(${endX}, ${endY})
      Start-Sleep -Milliseconds 50
      [Mouse]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)
    `;
    await execAsync(`powershell -command "${script.replace(/"/g, '\\"')}"`);
  }

  async _dragMacMouse(startX, startY, endX, endY) {
    await execAsync(`cliclick dd:${startX},${startY} du:${endX},${endY}`);
  }

  async _dragLinuxMouse(startX, startY, endX, endY) {
    await execAsync(
      `xdotool mousemove ${startX} ${startY} mousedown 1 mousemove ${endX} ${endY} mouseup 1`,
    );
  }

  /**
   * 鼠标滚动
   */
  async mouseScroll(params, context) {
    const { direction = "down", amount = 3 } = params;

    if (!this.options.enableMouse) {
      throw new Error("Mouse input is disabled");
    }

    const validDirection = ["up", "down", "left", "right"].includes(direction)
      ? direction
      : "down";
    const validAmount = Math.min(Math.max(1, amount), 100);

    logger.info(`[InputHandler] 鼠标滚动 ${validDirection} ${validAmount}`);

    try {
      if (isWindows) {
        await this._scrollWindowsMouse(validDirection, validAmount);
      } else if (isMac) {
        await this._scrollMacMouse(validDirection, validAmount);
      } else if (isLinux) {
        await this._scrollLinuxMouse(validDirection, validAmount);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        direction: validDirection,
        amount: validAmount,
        message: `Mouse scrolled ${validDirection} by ${validAmount}`,
      };
    } catch (error) {
      logger.error("[InputHandler] 鼠标滚动失败:", error);
      throw new Error(`Failed to scroll mouse: ${error.message}`);
    }
  }

  async _scrollWindowsMouse(direction, amount) {
    const wheelDelta = direction === "up" ? 120 * amount : -120 * amount;
    const script = `
      Add-Type @'
      using System;
      using System.Runtime.InteropServices;
      public class Mouse {
        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
      }
'@
      [Mouse]::mouse_event(0x0800, 0, 0, ${wheelDelta}, [UIntPtr]::Zero)
    `;
    await execAsync(`powershell -command "${script.replace(/"/g, '\\"')}"`);
  }

  async _scrollMacMouse(direction, amount) {
    const scrollAmount = direction === "up" ? amount : -amount;
    await execAsync(
      `osascript -e 'tell application "System Events" to scroll (${scrollAmount})'`,
    );
  }

  async _scrollLinuxMouse(direction, amount) {
    const button = direction === "up" ? 4 : 5;
    await execAsync(`xdotool click --repeat ${amount} ${button}`);
  }

  /**
   * 获取鼠标位置
   */
  async getCursorPosition(params, context) {
    logger.debug(`[InputHandler] 获取鼠标位置`);

    try {
      let position;

      if (isWindows) {
        position = await this._getWindowsCursorPosition();
      } else if (isMac) {
        position = await this._getMacCursorPosition();
      } else if (isLinux) {
        position = await this._getLinuxCursorPosition();
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        x: position.x,
        y: position.y,
      };
    } catch (error) {
      logger.error("[InputHandler] 获取鼠标位置失败:", error);
      throw new Error(`Failed to get cursor position: ${error.message}`);
    }
  }

  async _getWindowsCursorPosition() {
    const { stdout } = await execAsync(
      'powershell -command "[System.Windows.Forms.Cursor]::Position | Format-Table -HideTableHeaders"',
    );
    const lines = stdout.trim().split("\n");
    const match = lines.join(" ").match(/(\d+)\s+(\d+)/);
    if (match) {
      return { x: parseInt(match[1]), y: parseInt(match[2]) };
    }
    return { x: 0, y: 0 };
  }

  async _getMacCursorPosition() {
    const { stdout } = await execAsync("cliclick p");
    const match = stdout.match(/(\d+),(\d+)/);
    if (match) {
      return { x: parseInt(match[1]), y: parseInt(match[2]) };
    }
    return { x: 0, y: 0 };
  }

  async _getLinuxCursorPosition() {
    const { stdout } = await execAsync("xdotool getmouselocation");
    const xMatch = stdout.match(/x:(\d+)/);
    const yMatch = stdout.match(/y:(\d+)/);
    return {
      x: xMatch ? parseInt(xMatch[1]) : 0,
      y: yMatch ? parseInt(yMatch[1]) : 0,
    };
  }

  /**
   * 获取键盘布局
   */
  async getKeyboardLayout(params, context) {
    logger.debug(`[InputHandler] 获取键盘布局`);

    try {
      let layout;

      if (isWindows) {
        layout = await this._getWindowsKeyboardLayout();
      } else if (isMac) {
        layout = await this._getMacKeyboardLayout();
      } else if (isLinux) {
        layout = await this._getLinuxKeyboardLayout();
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        layout,
        platform: process.platform,
      };
    } catch (error) {
      logger.error("[InputHandler] 获取键盘布局失败:", error);
      return {
        success: true,
        layout: "unknown",
        error: error.message,
        platform: process.platform,
      };
    }
  }

  async _getWindowsKeyboardLayout() {
    const { stdout } = await execAsync(
      'powershell -command "(Get-WinUserLanguageList).LanguageTag"',
    );
    return stdout.trim().split("\n")[0] || "en-US";
  }

  async _getMacKeyboardLayout() {
    const { stdout } = await execAsync(
      "defaults read ~/Library/Preferences/com.apple.HIToolbox.plist AppleSelectedInputSources | grep 'KeyboardLayout Name' | head -1",
    );
    const match = stdout.match(/"KeyboardLayout Name" = "([^"]+)"/);
    return match ? match[1] : "US";
  }

  async _getLinuxKeyboardLayout() {
    const { stdout } = await execAsync("setxkbmap -query | grep layout");
    const match = stdout.match(/layout:\s+(\S+)/);
    return match ? match[1] : "us";
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info("[InputHandler] 资源已清理");
  }
}

module.exports = { InputHandler };
