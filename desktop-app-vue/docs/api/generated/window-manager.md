# window-manager

**Source**: `src/main/system/window-manager.js`

**Generated**: 2026-02-22T01:23:36.665Z

---

## const

```javascript
const
```

* 窗口管理器
 * 管理多窗口、窗口状态保存和恢复

---

## createWindow(options =

```javascript
createWindow(options =
```

* 创建窗口

---

## setupWindowListeners(window, windowId)

```javascript
setupWindowListeners(window, windowId)
```

* 设置窗口监听器

---

## saveWindowState(window, windowId)

```javascript
saveWindowState(window, windowId)
```

* 保存窗口状态

---

## ensureWindowInBounds(options)

```javascript
ensureWindowInBounds(options)
```

* 确保窗口在屏幕范围内

---

## getWindow(windowId)

```javascript
getWindow(windowId)
```

* 获取窗口

---

## getAllWindows()

```javascript
getAllWindows()
```

* 获取所有窗口

---

## closeWindow(windowId)

```javascript
closeWindow(windowId)
```

* 关闭窗口

---

## closeAllWindows()

```javascript
closeAllWindows()
```

* 关闭所有窗口

---

## showWindow(windowId)

```javascript
showWindow(windowId)
```

* 显示窗口

---

## hideWindow(windowId)

```javascript
hideWindow(windowId)
```

* 隐藏窗口

---

## minimizeWindow(windowId)

```javascript
minimizeWindow(windowId)
```

* 最小化窗口

---

## maximizeWindow(windowId)

```javascript
maximizeWindow(windowId)
```

* 最大化窗口

---

## toggleFullScreen(windowId)

```javascript
toggleFullScreen(windowId)
```

* 全屏窗口

---

## setAlwaysOnTop(windowId, flag)

```javascript
setAlwaysOnTop(windowId, flag)
```

* 设置窗口置顶

---

## loadStates()

```javascript
loadStates()
```

* 加载窗口状态

---

## saveStates()

```javascript
saveStates()
```

* 保存窗口状态到文件

---

## clearStates()

```javascript
clearStates()
```

* 清除保存的状态

---

## getWindowCount()

```javascript
getWindowCount()
```

* 获取窗口数量

---

## destroy()

```javascript
destroy()
```

* 销毁管理器

---

