/**
 * Keyboard Action - Advanced keyboard operations for browser automation
 *
 * @module browser/actions/keyboard-action
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { logger } = require('../../utils/logger');

/**
 * Common modifier keys
 */
const ModifierKey = {
  CTRL: 'Control',
  ALT: 'Alt',
  SHIFT: 'Shift',
  META: 'Meta',  // Cmd on Mac, Win key on Windows
  CMD: 'Meta'
};

/**
 * Common shortcut presets
 */
const ShortcutPresets = {
  // Navigation
  BACK: { keys: 'Alt+ArrowLeft', description: 'Go back' },
  FORWARD: { keys: 'Alt+ArrowRight', description: 'Go forward' },
  REFRESH: { keys: 'F5', description: 'Refresh page' },
  HARD_REFRESH: { keys: 'Control+F5', description: 'Hard refresh' },

  // Selection
  SELECT_ALL: { keys: 'Control+a', description: 'Select all' },
  COPY: { keys: 'Control+c', description: 'Copy' },
  CUT: { keys: 'Control+x', description: 'Cut' },
  PASTE: { keys: 'Control+v', description: 'Paste' },

  // Undo/Redo
  UNDO: { keys: 'Control+z', description: 'Undo' },
  REDO: { keys: 'Control+Shift+z', description: 'Redo' },

  // Search
  FIND: { keys: 'Control+f', description: 'Find on page' },
  FIND_NEXT: { keys: 'F3', description: 'Find next' },

  // Tab/Window
  NEW_TAB: { keys: 'Control+t', description: 'New tab' },
  CLOSE_TAB: { keys: 'Control+w', description: 'Close tab' },
  NEXT_TAB: { keys: 'Control+Tab', description: 'Next tab' },
  PREV_TAB: { keys: 'Control+Shift+Tab', description: 'Previous tab' },

  // Zoom
  ZOOM_IN: { keys: 'Control+Plus', description: 'Zoom in' },
  ZOOM_OUT: { keys: 'Control+Minus', description: 'Zoom out' },
  ZOOM_RESET: { keys: 'Control+0', description: 'Reset zoom' },

  // DevTools
  DEV_TOOLS: { keys: 'F12', description: 'Open DevTools' },
  INSPECTOR: { keys: 'Control+Shift+c', description: 'Inspector' },

  // Form
  SUBMIT: { keys: 'Enter', description: 'Submit form' },
  ESCAPE: { keys: 'Escape', description: 'Cancel/Close' },
  TAB_NEXT: { keys: 'Tab', description: 'Next field' },
  TAB_PREV: { keys: 'Shift+Tab', description: 'Previous field' }
};

/**
 * Keyboard Action Handler
 */
class KeyboardAction {
  constructor(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * Execute keyboard action
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Keyboard options
   * @returns {Promise<Object>} Action result
   */
  async execute(targetId, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const {
      keys,
      modifiers = [],
      text,
      preset,
      delay = 0,
      element  // Optional: focus element first
    } = options;

    try {
      // Focus element if specified
      if (element) {
        await this._focusElement(page, targetId, element);
      }

      // Use preset if specified
      if (preset && ShortcutPresets[preset]) {
        return this._executePreset(page, preset, delay);
      }

      // Type text
      if (text) {
        return this._typeText(page, text, delay);
      }

      // Press key combination
      if (keys) {
        return this._pressKeys(page, keys, modifiers, delay);
      }

      throw new Error('No keys, text, or preset specified');

    } catch (error) {
      logger.error('[KeyboardAction] Keyboard action failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Focus an element before keyboard action
   */
  async _focusElement(page, targetId, elementRef) {
    const { ElementLocator } = require('../element-locator');
    const element = this.browserEngine.findElement(targetId, elementRef);

    if (!element) {
      throw new Error(`Element ${elementRef} not found`);
    }

    const locator = await ElementLocator.locate(page, element);
    await locator.focus();
  }

  /**
   * Execute a preset shortcut
   */
  async _executePreset(page, presetName, delay) {
    const preset = ShortcutPresets[presetName];
    await this._pressKeyCombo(page, preset.keys, delay);

    return {
      success: true,
      preset: presetName,
      keys: preset.keys,
      description: preset.description
    };
  }

  /**
   * Type text character by character
   */
  async _typeText(page, text, delay) {
    if (delay > 0) {
      await page.keyboard.type(text, { delay });
    } else {
      await page.keyboard.type(text);
    }

    return {
      success: true,
      typed: text,
      characters: text.length
    };
  }

  /**
   * Press key combination
   */
  async _pressKeys(page, keys, modifiers, delay) {
    // Build key combination
    let keyCombo = keys;
    if (modifiers.length > 0) {
      keyCombo = [...modifiers, keys].join('+');
    }

    await this._pressKeyCombo(page, keyCombo, delay);

    return {
      success: true,
      pressed: keyCombo,
      keys,
      modifiers
    };
  }

  /**
   * Press a key combination string
   */
  async _pressKeyCombo(page, combo, delay = 0) {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    await page.keyboard.press(combo);
  }

  /**
   * Hold key while performing other actions
   * @param {string} targetId - Browser tab ID
   * @param {string} key - Key to hold
   * @param {Function} action - Action to perform while holding
   * @returns {Promise<Object>} Action result
   */
  async holdKeyWhile(targetId, key, action) {
    const page = this.browserEngine.getPage(targetId);

    try {
      await page.keyboard.down(key);
      const result = await action();
      await page.keyboard.up(key);

      return {
        success: true,
        heldKey: key,
        actionResult: result
      };
    } catch (error) {
      // Ensure key is released even on error
      await page.keyboard.up(key).catch(() => {});
      throw error;
    }
  }

  /**
   * Type with special handling (ime, composition)
   * @param {string} targetId - Browser tab ID
   * @param {string} text - Text to type
   * @param {Object} options - Type options
   * @returns {Promise<Object>} Type result
   */
  async typeSpecial(targetId, text, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const { element, clearFirst = false, pressEnter = false, delay = 0 } = options;

    // Focus element if specified
    if (element) {
      await this._focusElement(page, targetId, element);
    }

    // Clear existing content
    if (clearFirst) {
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
    }

    // Type text
    await page.keyboard.type(text, { delay });

    // Press Enter if requested
    if (pressEnter) {
      await page.keyboard.press('Enter');
    }

    return {
      success: true,
      typed: text,
      cleared: clearFirst,
      submitted: pressEnter
    };
  }

  /**
   * Input a sequence of keys with delays
   * @param {string} targetId - Browser tab ID
   * @param {Array} sequence - Array of {key, delay} objects
   * @returns {Promise<Object>} Sequence result
   */
  async keySequence(targetId, sequence) {
    const page = this.browserEngine.getPage(targetId);
    const results = [];

    for (const item of sequence) {
      const { key, delay = 0, type } = item;

      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      if (type === 'text') {
        await page.keyboard.type(key);
        results.push({ action: 'type', key });
      } else {
        await page.keyboard.press(key);
        results.push({ action: 'press', key });
      }
    }

    return {
      success: true,
      sequence: results,
      totalSteps: results.length
    };
  }

  /**
   * Get available shortcut presets
   * @returns {Object} Preset definitions
   */
  static getPresets() {
    return { ...ShortcutPresets };
  }

  /**
   * Get platform-specific modifier
   * @returns {string} Control on Windows/Linux, Meta on Mac
   */
  static getPlatformModifier() {
    return process.platform === 'darwin' ? 'Meta' : 'Control';
  }
}

module.exports = {
  KeyboardAction,
  ModifierKey,
  ShortcutPresets
};
