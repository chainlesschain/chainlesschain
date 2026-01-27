# shortcutManager

**Source**: `src\renderer\utils\shortcutManager.js`

**Generated**: 2026-01-27T06:44:03.894Z

---

## import

```javascript
import
```

* 键盘快捷键管理器
 * 提供全局快捷键注册和管理

---

## class Shortcut

```javascript
class Shortcut
```

* 快捷键类

---

## matches(event)

```javascript
matches(event)
```

* 检查按键是否匹配

---

## execute(event)

```javascript
execute(event)
```

* 执行处理函数

---

## class ShortcutManager

```javascript
class ShortcutManager
```

* 快捷键管理器

---

## register(options)

```javascript
register(options)
```

* 注册快捷键

---

## registerMultiple(shortcuts)

```javascript
registerMultiple(shortcuts)
```

* 批量注册快捷键

---

## unregister(id)

```javascript
unregister(id)
```

* 注销快捷键

---

## enable(id)

```javascript
enable(id)
```

* 启用快捷键

---

## disable(id)

```javascript
disable(id)
```

* 禁用快捷键

---

## enableAll()

```javascript
enableAll()
```

* 启用所有快捷键

---

## disableAll()

```javascript
disableAll()
```

* 禁用所有快捷键

---

## handleKeyDown(event)

```javascript
handleKeyDown(event)
```

* 处理按键事件

---

## startListening()

```javascript
startListening()
```

* 开始监听

---

## stopListening()

```javascript
stopListening()
```

* 停止监听

---

## getShortcuts()

```javascript
getShortcuts()
```

* 获取所有快捷键

---

## getShortcutDescription(keys)

```javascript
getShortcutDescription(keys)
```

* 获取快捷键描述

---

## clear()

```javascript
clear()
```

* 清空所有快捷键

---

## export function useShortcuts(shortcuts = [])

```javascript
export function useShortcuts(shortcuts = [])
```

* 组合式函数：使用快捷键

---

## export const CommonShortcuts =

```javascript
export const CommonShortcuts =
```

* 预定义的常用快捷键

---

