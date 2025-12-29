/**
 * 全局键盘快捷键 Hook
 */

import { onMounted, onBeforeUnmount, h } from 'vue';
import { message } from 'ant-design-vue';

// 快捷键映射表
const shortcutMap = new Map();

// 当前平台
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const cmdKey = isMac ? 'Meta' : 'Control';

/**
 * 注册快捷键
 * @param {string} key - 快捷键组合，如 'ctrl+k' 或 'cmd+k'
 * @param {Function} handler - 处理函数
 * @param {Object} options - 选项
 */
export function registerShortcut(key, handler, options = {}) {
  const normalizedKey = normalizeKey(key);
  shortcutMap.set(normalizedKey, { handler, options });
}

/**
 * 注销快捷键
 */
export function unregisterShortcut(key) {
  const normalizedKey = normalizeKey(key);
  shortcutMap.delete(normalizedKey);
}

/**
 * 规范化快捷键字符串
 */
function normalizeKey(key) {
  return key
    .toLowerCase()
    .replace(/cmd/g, cmdKey.toLowerCase())
    .replace(/ctrl/g, 'control')
    .split('+')
    .sort()
    .join('+');
}

/**
 * 检查事件是否匹配快捷键
 */
function matchesShortcut(event, shortcutKey) {
  const keys = shortcutKey.split('+');

  // 检查修饰键
  const needsCtrl = keys.includes('control');
  const needsShift = keys.includes('shift');
  const needsAlt = keys.includes('alt');
  const needsMeta = keys.includes('meta');

  if (needsCtrl && !event.ctrlKey) return false;
  if (needsShift && !event.shiftKey) return false;
  if (needsAlt && !event.altKey) return false;
  if (needsMeta && !event.metaKey) return false;

  // 检查主键
  const mainKey = keys.find(k => !['control', 'shift', 'alt', 'meta'].includes(k));
  if (!mainKey) return false;

  return event.key.toLowerCase() === mainKey.toLowerCase();
}

/**
 * 全局键盘事件处理
 */
function handleKeyDown(event) {
  // 忽略输入框中的快捷键（除了某些全局快捷键）
  const tagName = event.target.tagName;
  const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName);
  const isContentEditable = event.target.isContentEditable;

  // 检查每个注册的快捷键
  for (const [key, { handler, options }] of shortcutMap) {
    if (matchesShortcut(event, key)) {
      // 如果在输入框中，只响应全局快捷键
      if ((isInput || isContentEditable) && !options.global) {
        continue;
      }

      event.preventDefault();
      event.stopPropagation();

      handler(event);
      return;
    }
  }
}

/**
 * 使用键盘快捷键
 */
export function useKeyboardShortcuts() {
  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  return {
    registerShortcut,
    unregisterShortcut,
  };
}

/**
 * 预定义的快捷键
 */
export const SHORTCUTS = {
  // 搜索
  SEARCH: isMac ? 'cmd+k' : 'ctrl+k',

  // 创建
  NEW: isMac ? 'cmd+n' : 'ctrl+n',

  // 刷新
  REFRESH: isMac ? 'cmd+r' : 'ctrl+r',

  // 保存
  SAVE: isMac ? 'cmd+s' : 'ctrl+s',

  // 删除
  DELETE: 'delete',

  // 全选
  SELECT_ALL: isMac ? 'cmd+a' : 'ctrl+a',

  // 取消选择
  DESELECT: isMac ? 'cmd+d' : 'ctrl+d',

  // 关闭
  CLOSE: 'escape',

  // 帮助
  HELP: 'f1',

  // 撤销
  UNDO: isMac ? 'cmd+z' : 'ctrl+z',

  // 重做
  REDO: isMac ? 'cmd+shift+z' : 'ctrl+shift+z',

  // 复制
  COPY: isMac ? 'cmd+c' : 'ctrl+c',

  // 粘贴
  PASTE: isMac ? 'cmd+v' : 'ctrl+v',

  // 查找
  FIND: isMac ? 'cmd+f' : 'ctrl+f',
};

/**
 * 显示快捷键提示
 */
export function showShortcutHelp() {
  const shortcuts = [
    { key: SHORTCUTS.SEARCH, desc: '快速搜索' },
    { key: SHORTCUTS.NEW, desc: '新建' },
    { key: SHORTCUTS.REFRESH, desc: '刷新' },
    { key: SHORTCUTS.DELETE, desc: '删除' },
    { key: SHORTCUTS.SELECT_ALL, desc: '全选' },
    { key: SHORTCUTS.HELP, desc: '帮助' },
    { key: SHORTCUTS.CLOSE, desc: '关闭' },
  ];

  const content = shortcuts
    .map(s => `${s.key.toUpperCase().replace(/\+/g, ' + ')}: ${s.desc}`)
    .join('\n');

  message.info({
    content: h('div', { style: { whiteSpace: 'pre-line', textAlign: 'left' } }, [
      h('strong', '键盘快捷键：'),
      h('br'),
      content
    ]),
    duration: 5,
  });
}

export default useKeyboardShortcuts;
