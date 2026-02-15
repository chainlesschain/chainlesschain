# auto-updater

**Source**: `src/main/system/auto-updater.js`

**Generated**: 2026-02-15T10:10:53.365Z

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

## setupAutoUpdater()

```javascript
setupAutoUpdater()
```

* 配置 autoUpdater 事件处理

---

## async checkForUpdates()

```javascript
async checkForUpdates()
```

* 手动检查更新

---

## setupPeriodicCheck()

```javascript
setupPeriodicCheck()
```

* 设置定期检查

---

## sendStatusToWindow(status, data = null)

```javascript
sendStatusToWindow(status, data = null)
```

* 发送状态到渲染进程

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

