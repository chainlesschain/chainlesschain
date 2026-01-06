/**
 * Keyboard Shortcuts System
 * 提供统一的键盘快捷键管理，支持作用域、禁用/启用、命令面板等
 */

class KeyboardShortcuts {
  constructor() {
    this.shortcuts = new Map() // key -> handler
    this.scopes = new Map() // scope -> Set of keys
    this.currentScope = 'global'
    this.enabled = true
    this.commandPaletteVisible = false
    this.allCommands = []

    // 绑定事件监听
    this.handleKeyDown = this.handleKeyDown.bind(this)
    this.init()
  }

  /**
   * 初始化
   */
  init() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown)
      console.log('[KeyboardShortcuts] Initialized')
    }
  }

  /**
   * 注册快捷键
   * @param {Object} options
   * @param {string} options.key - 快捷键组合 (e.g., 'Ctrl+S', 'Cmd+Shift+P')
   * @param {Function} options.handler - 处理函数
   * @param {string} options.description - 描述
   * @param {string} options.scope - 作用域 (默认: 'global')
   * @param {boolean} options.preventDefault - 是否阻止默认行为 (默认: true)
   */
  register({ key, handler, description = '', scope = 'global', preventDefault = true }) {
    const normalizedKey = this.normalizeKey(key)

    // 保存快捷键
    this.shortcuts.set(normalizedKey, {
      handler,
      description,
      scope,
      preventDefault,
      key: normalizedKey
    })

    // 添加到作用域
    if (!this.scopes.has(scope)) {
      this.scopes.set(scope, new Set())
    }
    this.scopes.get(scope).add(normalizedKey)

    // 添加到命令列表
    this.allCommands.push({
      key: normalizedKey,
      description,
      scope,
      handler
    })

    console.log(`[KeyboardShortcuts] Registered: ${normalizedKey} in scope "${scope}"`)
  }

  /**
   * 批量注册快捷键
   */
  registerMultiple(shortcuts) {
    shortcuts.forEach(shortcut => this.register(shortcut))
  }

  /**
   * 注销快捷键
   */
  unregister(key) {
    const normalizedKey = this.normalizeKey(key)
    const shortcut = this.shortcuts.get(normalizedKey)

    if (shortcut) {
      // 从作用域中移除
      const scopeKeys = this.scopes.get(shortcut.scope)
      if (scopeKeys) {
        scopeKeys.delete(normalizedKey)
      }

      // 从快捷键映射中移除
      this.shortcuts.delete(normalizedKey)

      // 从命令列表中移除
      this.allCommands = this.allCommands.filter(cmd => cmd.key !== normalizedKey)

      console.log(`[KeyboardShortcuts] Unregistered: ${normalizedKey}`)
    }
  }

  /**
   * 处理键盘事件
   */
  handleKeyDown(event) {
    if (!this.enabled) return

    const key = this.getKeyFromEvent(event)
    const shortcut = this.shortcuts.get(key)

    if (shortcut) {
      // 检查作用域
      if (shortcut.scope !== 'global' && shortcut.scope !== this.currentScope) {
        return
      }

      // 阻止默认行为
      if (shortcut.preventDefault) {
        event.preventDefault()
        event.stopPropagation()
      }

      // 执行处理函数
      try {
        shortcut.handler(event)
      } catch (error) {
        console.error('[KeyboardShortcuts] Handler error:', error)
      }
    }
  }

  /**
   * 从事件对象获取标准化的键组合
   */
  getKeyFromEvent(event) {
    const parts = []

    // 修饰键
    if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
    if (event.altKey) parts.push('Alt')
    if (event.shiftKey) parts.push('Shift')

    // 主键
    let mainKey = event.key

    // 特殊键映射
    const specialKeys = {
      ' ': 'Space',
      'ArrowUp': 'Up',
      'ArrowDown': 'Down',
      'ArrowLeft': 'Left',
      'ArrowRight': 'Right',
      'Escape': 'Esc'
    }

    mainKey = specialKeys[mainKey] || mainKey.toUpperCase()

    // 避免修饰键重复
    if (!['CONTROL', 'ALT', 'SHIFT', 'META'].includes(mainKey)) {
      parts.push(mainKey)
    }

    return parts.join('+')
  }

  /**
   * 标准化快捷键字符串
   */
  normalizeKey(key) {
    // 将 Cmd 转换为 Ctrl (跨平台兼容)
    const normalized = key
      .replace(/Cmd/gi, 'Ctrl')
      .replace(/Command/gi, 'Ctrl')
      .split('+')
      .map(part => part.trim())
      .map(part => {
        // 首字母大写
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      })

    // 排序：Ctrl, Alt, Shift, 主键
    const order = { 'Ctrl': 1, 'Alt': 2, 'Shift': 3 }
    normalized.sort((a, b) => {
      const orderA = order[a] || 999
      const orderB = order[b] || 999
      return orderA - orderB
    })

    return normalized.join('+')
  }

  /**
   * 设置当前作用域
   */
  setScope(scope) {
    this.currentScope = scope
    console.log(`[KeyboardShortcuts] Scope changed to: ${scope}`)
  }

  /**
   * 启用/禁用快捷键
   */
  setEnabled(enabled) {
    this.enabled = enabled
    console.log(`[KeyboardShortcuts] ${enabled ? 'Enabled' : 'Disabled'}`)
  }

  /**
   * 显示命令面板
   */
  showCommandPalette() {
    this.commandPaletteVisible = true

    // 触发自定义事件
    window.dispatchEvent(new CustomEvent('show-command-palette', {
      detail: { commands: this.getAllCommands() }
    }))
  }

  /**
   * 隐藏命令面板
   */
  hideCommandPalette() {
    this.commandPaletteVisible = false

    window.dispatchEvent(new CustomEvent('hide-command-palette'))
  }

  /**
   * 获取所有命令
   */
  getAllCommands() {
    return this.allCommands.map(cmd => ({
      ...cmd,
      keyDisplay: this.formatKeyForDisplay(cmd.key)
    }))
  }

  /**
   * 格式化快捷键用于显示
   */
  formatKeyForDisplay(key) {
    // macOS 使用 ⌘ 符号
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

    if (isMac) {
      return key
        .replace('Ctrl', '⌘')
        .replace('Alt', '⌥')
        .replace('Shift', '⇧')
    }

    return key
  }

  /**
   * 获取指定作用域的所有快捷键
   */
  getShortcutsByScope(scope) {
    return this.allCommands.filter(cmd => cmd.scope === scope)
  }

  /**
   * 销毁
   */
  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDown)
    }

    this.shortcuts.clear()
    this.scopes.clear()
    this.allCommands = []

    console.log('[KeyboardShortcuts] Destroyed')
  }
}

// 创建单例实例
const keyboardShortcuts = new KeyboardShortcuts()

// 注册默认快捷键
keyboardShortcuts.registerMultiple([
  // 全局快捷键
  {
    key: 'Ctrl+S',
    description: '保存当前文件',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-save'))
    }
  },
  {
    key: 'Ctrl+F',
    description: '在当前文件中查找',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-find'))
    }
  },
  {
    key: 'Ctrl+Shift+F',
    description: '在项目中查找',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-find-in-project'))
    }
  },
  {
    key: 'Ctrl+P',
    description: '打开命令面板',
    handler: () => {
      keyboardShortcuts.showCommandPalette()
    }
  },
  {
    key: 'Ctrl+B',
    description: '切换侧边栏',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-toggle-sidebar'))
    }
  },
  {
    key: 'Ctrl+`',
    description: '切换终端面板',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-toggle-terminal'))
    }
  },
  {
    key: 'Ctrl+/',
    description: '切换注释',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-toggle-comment'))
    }
  },
  {
    key: 'Ctrl+D',
    description: '复制当前行',
    scope: 'editor',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-duplicate-line'))
    }
  },
  {
    key: 'Ctrl+Shift+K',
    description: '删除当前行',
    scope: 'editor',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-delete-line'))
    }
  },
  {
    key: 'Alt+Up',
    description: '向上移动行',
    scope: 'editor',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-move-line-up'))
    }
  },
  {
    key: 'Alt+Down',
    description: '向下移动行',
    scope: 'editor',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-move-line-down'))
    }
  },
  {
    key: 'Ctrl+Z',
    description: '撤销',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-undo'))
    }
  },
  {
    key: 'Ctrl+Shift+Z',
    description: '重做',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-redo'))
    }
  },
  {
    key: 'Ctrl+N',
    description: '新建文件',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-new-file'))
    }
  },
  {
    key: 'Ctrl+W',
    description: '关闭当前标签',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-close-tab'))
    }
  },
  {
    key: 'Ctrl+Shift+T',
    description: '重新打开已关闭的标签',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-reopen-tab'))
    }
  },
  {
    key: 'Ctrl+Tab',
    description: '切换到下一个标签',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-next-tab'))
    }
  },
  {
    key: 'Ctrl+Shift+Tab',
    description: '切换到上一个标签',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-prev-tab'))
    }
  },
  // 数字键快速切换标签
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => ({
    key: `Alt+${num}`,
    description: `切换到第 ${num} 个标签`,
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-switch-tab', { detail: { index: num - 1 } }))
    }
  })),
  {
    key: 'Esc',
    description: '关闭弹窗/取消操作',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-escape'))
    }
  },
  {
    key: 'F2',
    description: '重命名',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-rename'))
    }
  },
  {
    key: 'Delete',
    description: '删除',
    handler: () => {
      window.dispatchEvent(new CustomEvent('shortcut-delete'))
    }
  }
])

export default keyboardShortcuts

export { KeyboardShortcuts }
