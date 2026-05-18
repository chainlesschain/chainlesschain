# auto-updater

**Source**: `src/main/system/auto-updater.js`

---

## const

```javascript
const
```

* ChainlessChain 自动更新模块
 * 基于 electron-updater 实现自动更新功能

---

## init(mainWindow)

```javascript
init(mainWindow)
```

* 初始化自动更新器
   * @param {BrowserWindow} mainWindow - 主窗口实例

---

## registerIpcHandlers()

```javascript
registerIpcHandlers()
```

* 注册 IPC handlers（幂等）：渲染端 notifier 通过 electronAPI.appUpdate.*
   * 触发检查 / 下载 / 安装；onStatus 订阅走 webContents.send(update-status)
   * 单向广播，不在这里注册。

---

## setupAutoUpdater()

```javascript
setupAutoUpdater()
```

* 配置 autoUpdater 事件处理

---

## setTaskbarProgress(percent)

```javascript
setTaskbarProgress(percent)
```

* 设置 Windows 任务栏 / macOS Dock 进度条。
   * `percent` 是 0-100 整数 / 浮点；setProgressBar 接收 0-1。

---

## async checkForUpdates(manual = false)

```javascript
async checkForUpdates(manual = false)
```

* 检查更新。`manual=true` 表示用户主动从托盘触发，事件回调会弹 native
   * dialog 给 feedback；`manual=false`（默认）是启动 3s 自检 + 每 4h 周期
   * 检查，全程静默不弹任何 UI。
   * @param {boolean} [manual=false]

---

## setupPeriodicCheck()

```javascript
setupPeriodicCheck()
```

* 设置定期检查

---

## sendStatusToWindow(status, data = null, info = null)

```javascript
sendStatusToWindow(status, data = null, info = null)
```

* 发送状态到渲染进程。`status` 是 dot-case 枚举：
   *   idle / checking / available / not-available / downloading
   *   / downloaded / error
   * `data` 仅 downloading 状态非空（electron-updater progress object）。
   * `info` 在 available / downloaded / error 携带 {version,releaseNotes,…} / {message}。

---

## showUpdateAvailableDialog(info)

```javascript
showUpdateAvailableDialog(info)
```

* 显示"发现新版本"对话框

---

## showUpdateReadyDialog(info)

```javascript
showUpdateReadyDialog(info)
```

* 显示"更新就绪"对话框

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

## getConfig()

```javascript
getConfig()
```

* 获取当前配置

---

## setFeedURL(url)

```javascript
setFeedURL(url)
```

* 设置更新服务器 URL
   * @param {string} url - 更新服务器 URL

---

