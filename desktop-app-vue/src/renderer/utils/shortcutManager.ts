/**
 * 键盘快捷键管理器
 * 提供全局快捷键注册和管理
 */

import { logger } from '@/utils/logger';
import { ref, onMounted, onUnmounted, type Ref } from 'vue';

// ==================== 类型定义 ====================

/**
 * 快捷键选项
 */
export interface ShortcutOptions {
  id?: string;
  keys: string[];
  description?: string;
  handler: (event: KeyboardEvent) => void;
  enabled?: boolean;
  global?: boolean;
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

/**
 * 快捷键返回类型
 */
export interface UseShortcutsReturn {
  register: (options: ShortcutOptions) => string;
  unregister: (id: string) => void;
  enable: (id: string) => void;
  disable: (id: string) => void;
  getDescription: (keys: string[]) => string;
}

// ==================== 类实现 ====================

/**
 * 快捷键类
 */
class Shortcut {
  id: string;
  keys: string[];
  description: string;
  handler: (event: KeyboardEvent) => void;
  enabled: boolean;
  global: boolean;
  preventDefault: boolean;
  stopPropagation: boolean;

  constructor(options: ShortcutOptions) {
    this.id = options.id || `shortcut-${Date.now()}`;
    this.keys = options.keys || [];
    this.description = options.description || '';
    this.handler = options.handler || (() => {});
    this.enabled = options.enabled !== false;
    this.global = options.global || false;
    this.preventDefault = options.preventDefault !== false;
    this.stopPropagation = options.stopPropagation !== false;
  }

  /**
   * 检查按键是否匹配
   */
  matches(event: KeyboardEvent): boolean {
    const pressedKeys: string[] = [];

    if (event.ctrlKey || event.metaKey) {
      pressedKeys.push('ctrl');
    }
    if (event.shiftKey) {
      pressedKeys.push('shift');
    }
    if (event.altKey) {
      pressedKeys.push('alt');
    }

    // 添加实际按键
    const key = event.key.toLowerCase();
    if (!['control', 'shift', 'alt', 'meta'].includes(key)) {
      pressedKeys.push(key);
    }

    // 比较按键组合
    if (pressedKeys.length !== this.keys.length) {
      return false;
    }

    return this.keys.every((k) => pressedKeys.includes(k.toLowerCase()));
  }

  /**
   * 执行处理函数
   */
  execute(event: KeyboardEvent): void {
    if (!this.enabled) {
      return;
    }

    if (this.preventDefault) {
      event.preventDefault();
    }

    if (this.stopPropagation) {
      event.stopPropagation();
    }

    try {
      this.handler(event);
    } catch (error) {
      logger.error('[Shortcut] Handler error:', error);
    }
  }
}

/**
 * 快捷键管理器
 */
class ShortcutManager {
  shortcuts: Ref<Shortcut[]>;
  enabled: Ref<boolean>;

  constructor() {
    this.shortcuts = ref([]);
    this.enabled = ref(true);
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  /**
   * 注册快捷键
   */
  register(options: ShortcutOptions): string {
    const shortcut = new Shortcut(options);
    this.shortcuts.value.push(shortcut);
    return shortcut.id;
  }

  /**
   * 批量注册快捷键
   */
  registerMultiple(shortcuts: ShortcutOptions[]): string[] {
    return shortcuts.map((options) => this.register(options));
  }

  /**
   * 注销快捷键
   */
  unregister(id: string): void {
    const index = this.shortcuts.value.findIndex((s) => s.id === id);
    if (index > -1) {
      this.shortcuts.value.splice(index, 1);
    }
  }

  /**
   * 启用快捷键
   */
  enable(id: string): void {
    const shortcut = this.shortcuts.value.find((s) => s.id === id);
    if (shortcut) {
      shortcut.enabled = true;
    }
  }

  /**
   * 禁用快捷键
   */
  disable(id: string): void {
    const shortcut = this.shortcuts.value.find((s) => s.id === id);
    if (shortcut) {
      shortcut.enabled = false;
    }
  }

  /**
   * 启用所有快捷键
   */
  enableAll(): void {
    this.enabled.value = true;
  }

  /**
   * 禁用所有快捷键
   */
  disableAll(): void {
    this.enabled.value = false;
  }

  /**
   * 处理按键事件
   */
  handleKeyDown(event: KeyboardEvent): void {
    if (!this.enabled.value) {
      return;
    }

    // 忽略输入框中的快捷键
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    // 查找匹配的快捷键
    for (const shortcut of this.shortcuts.value) {
      if (shortcut.matches(event)) {
        shortcut.execute(event);
        break; // 只执行第一个匹配的快捷键
      }
    }
  }

  /**
   * 开始监听
   */
  startListening(): void {
    window.addEventListener('keydown', this.handleKeyDown);
  }

  /**
   * 停止监听
   */
  stopListening(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  /**
   * 获取所有快捷键
   */
  getShortcuts(): Shortcut[] {
    return this.shortcuts.value;
  }

  /**
   * 获取快捷键描述
   */
  getShortcutDescription(keys: string[]): string {
    const keyMap: Record<string, string> = {
      ctrl: '⌘',
      shift: '⇧',
      alt: '⌥',
      enter: '↵',
      escape: 'Esc',
      backspace: '⌫',
      delete: 'Del',
      arrowup: '↑',
      arrowdown: '↓',
      arrowleft: '←',
      arrowright: '→',
    };
    return keys
      .map((key) => keyMap[key.toLowerCase()] || key.toUpperCase())
      .join(' + ');
  }

  /**
   * 清空所有快捷键
   */
  clear(): void {
    this.shortcuts.value = [];
  }
}

// 创建全局实例
const shortcutManager = new ShortcutManager();

// 自动开始监听
if (typeof window !== 'undefined') {
  shortcutManager.startListening();
}

/**
 * 组合式函数：使用快捷键
 */
export function useShortcuts(shortcuts: ShortcutOptions[] = []): UseShortcutsReturn {
  const ids = ref<string[]>([]);

  onMounted(() => {
    // 注册快捷键
    ids.value = shortcuts.map((shortcut) => shortcutManager.register(shortcut));
  });

  onUnmounted(() => {
    // 注销快捷键
    ids.value.forEach((id) => shortcutManager.unregister(id));
  });

  return {
    register: (options: ShortcutOptions): string => {
      const id = shortcutManager.register(options);
      ids.value.push(id);
      return id;
    },
    unregister: (id: string): void => {
      shortcutManager.unregister(id);
      const index = ids.value.indexOf(id);
      if (index > -1) {
        ids.value.splice(index, 1);
      }
    },
    enable: (id: string): void => shortcutManager.enable(id),
    disable: (id: string): void => shortcutManager.disable(id),
    getDescription: (keys: string[]): string => shortcutManager.getShortcutDescription(keys),
  };
}

/**
 * 预定义的常用快捷键
 */
export const CommonShortcuts = {
  // 文件操作
  NEW: ['ctrl', 'n'],
  OPEN: ['ctrl', 'o'],
  SAVE: ['ctrl', 's'],
  SAVE_AS: ['ctrl', 'shift', 's'],
  CLOSE: ['ctrl', 'w'],
  QUIT: ['ctrl', 'q'],

  // 编辑操作
  UNDO: ['ctrl', 'z'],
  REDO: ['ctrl', 'shift', 'z'],
  CUT: ['ctrl', 'x'],
  COPY: ['ctrl', 'c'],
  PASTE: ['ctrl', 'v'],
  SELECT_ALL: ['ctrl', 'a'],
  FIND: ['ctrl', 'f'],
  REPLACE: ['ctrl', 'h'],

  // 视图操作
  ZOOM_IN: ['ctrl', '+'],
  ZOOM_OUT: ['ctrl', '-'],
  ZOOM_RESET: ['ctrl', '0'],
  FULLSCREEN: ['f11'],
  TOGGLE_SIDEBAR: ['ctrl', 'b'],
  TOGGLE_DEVTOOLS: ['f12'],

  // 导航操作
  GO_BACK: ['alt', 'arrowleft'],
  GO_FORWARD: ['alt', 'arrowright'],
  REFRESH: ['ctrl', 'r'],
  HOME: ['ctrl', 'h'],

  // 其他
  HELP: ['f1'],
  SETTINGS: ['ctrl', ','],
  SEARCH: ['ctrl', 'k'],
  COMMAND_PALETTE: ['ctrl', 'shift', 'p'],
} as const;

export default shortcutManager;
