# enhanced-tray-manager

**Source**: `src/main/system/enhanced-tray-manager.js`

---

## const

```javascript
const
```

* 增强的系统托盘管理器
 * 提供丰富的托盘菜单和快捷操作

---

## create()

```javascript
create()
```

* 创建托盘

---

## getIconPath()

```javascript
getIconPath()
```

* 获取图标路径

---

## updateContextMenu(options =

```javascript
updateContextMenu(options =
```

* 更新上下文菜单

---

## toggleWindow()

```javascript
toggleWindow()
```

* 切换窗口显示/隐藏

---

## showWindow()

```javascript
showWindow()
```

* 显示窗口

---

## hideWindow()

```javascript
hideWindow()
```

* 隐藏窗口

---

## sendToRenderer(channel, ...args)

```javascript
sendToRenderer(channel, ...args)
```

* 发送消息到渲染进程（legacy，per-channel）

---

## dispatchTrayAction(type, payload = null)

```javascript
dispatchTrayAction(type, payload = null)
```

* 统一通过 "tray:action" channel 派发托盘事件给渲染进程。
   * Payload 形如 { type, payload }：renderer 监听单一 channel，按 type 分发。
   * 之前每个菜单项各发一个独立 channel（quick-action / sync / show-notifications
   * 等），renderer 一个都没监听，全部点了无效。统一通道后只要 App.vue 接住
   * "tray:action" 一个即可处理所有菜单项。

---

## showAboutDialog()

```javascript
showAboutDialog()
```

* "关于" 菜单 → 主进程原生 dialog（不需要 renderer 配合）。

---

## triggerCheckForUpdates()

```javascript
triggerCheckForUpdates()
```

* "检查更新" 菜单 → 调 auto-updater 单例。模块在 dev (NODE_ENV !==
   * "production") 下 autoUpdater.checkForUpdates() 会返回 null/no-op，
   * 所以这里给一个 fallback 提示，避免用户在 dev 模式下点了又是哑响。

---

## setNotificationCount(count)

```javascript
setNotificationCount(count)
```

* 更新通知计数

---

## startFlashing()

```javascript
startFlashing()
```

* 开始闪烁托盘图标

---

## stopFlashing()

```javascript
stopFlashing()
```

* 停止闪烁托盘图标

---

## displayBalloon(title, content, icon = null)

```javascript
displayBalloon(title, content, icon = null)
```

* 显示气球通知（Windows）

---

## updateSyncStatus(status)

```javascript
updateSyncStatus(status)
```

* 更新同步状态

---

## updateMemoryUsage(usage)

```javascript
updateMemoryUsage(usage)
```

* 更新内存使用

---

## destroy()

```javascript
destroy()
```

* 销毁托盘

---

