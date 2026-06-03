# keyboard-shortcuts

**Source**: `src\renderer\utils\keyboard-shortcuts.js`

**Generated**: 2026-01-27T06:44:03.898Z

---

## class KeyboardShortcuts

```javascript
class KeyboardShortcuts
```

* Keyboard Shortcuts System
 * 提供统一的键盘快捷键管理，支持作用域、禁用/启用、命令面板等

---

## init()

```javascript
init()
```

* 初始化

---

## register(

```javascript
register(
```

* 注册快捷键
   * @param {Object} options
   * @param {string} options.key - 快捷键组合 (e.g., 'Ctrl+S', 'Cmd+Shift+P')
   * @param {Function} options.handler - 处理函数
   * @param {string} options.description - 描述
   * @param {string} options.scope - 作用域 (默认: 'global')
   * @param {boolean} options.preventDefault - 是否阻止默认行为 (默认: true)

---

## registerMultiple(shortcuts)

```javascript
registerMultiple(shortcuts)
```

* 批量注册快捷键

---

## unregister(key)

```javascript
unregister(key)
```

* 注销快捷键

---

## handleKeyDown(event)

```javascript
handleKeyDown(event)
```

* 处理键盘事件

---

## getKeyFromEvent(event)

```javascript
getKeyFromEvent(event)
```

* 从事件对象获取标准化的键组合

---

## normalizeKey(key)

```javascript
normalizeKey(key)
```

* 标准化快捷键字符串

---

## setScope(scope)

```javascript
setScope(scope)
```

* 设置当前作用域

---

## setEnabled(enabled)

```javascript
setEnabled(enabled)
```

* 启用/禁用快捷键

---

## showCommandPalette()

```javascript
showCommandPalette()
```

* 显示命令面板

---

## hideCommandPalette()

```javascript
hideCommandPalette()
```

* 隐藏命令面板

---

## getAllCommands()

```javascript
getAllCommands()
```

* 获取所有命令

---

## formatKeyForDisplay(key)

```javascript
formatKeyForDisplay(key)
```

* 格式化快捷键用于显示

---

## getShortcutsByScope(scope)

```javascript
getShortcutsByScope(scope)
```

* 获取指定作用域的所有快捷键

---

## destroy()

```javascript
destroy()
```

* 销毁

---

## export function registerMenuCommands(router)

```javascript
export function registerMenuCommands(router)
```

* 注册菜单导航命令
 * @param {Object} router - Vue Router 实例

---

