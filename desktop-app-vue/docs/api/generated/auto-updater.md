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

## maybeNotifyDownloaded(info)

```javascript
maybeNotifyDownloaded(info)
```

* 主窗口隐藏到托盘 / 最小化时，发系统通知告知用户更新已就绪；点击通知
   * 亮窗，用户随即看到 notifier 卡片。窗口可见时 notifier 卡片自己就够，
   * 跳过通知避免双重提示。

---

## maybeNotifyNoUpdate(appVersion)

```javascript
maybeNotifyNoUpdate(appVersion)
```

* 用户手动检查 + 主窗口隐藏到托盘 / 最小化时，发系统通知告知"已是最新版"；
   * 否则 dialog.showMessageBox 的模态框跟着隐藏 parentWindow 一起不可见 = 用户
   * 看不到任何反馈。窗口可见时走原来的 native dialog 路径（在 event handler 里）。

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

