# menu-manager

**Source**: `src/main/system/menu-manager.js`

---

## const

```javascript
const
```

* 应用菜单管理器
 * 创建和管理Electron应用菜单

---

## constructor(mainWindow, options =

```javascript
constructor(mainWindow, options =
```

* @param {Electron.BrowserWindow} mainWindow
   * @param {Object} [options]
   * @param {() => ({ httpUrl?: string } | null)} [options.getWebShellHandle]
   *   Getter for the live web-shell handle so the "在浏览器中打开 web 视图"
   *   menu item can read the OS-assigned httpUrl when clicked. Returns null
   *   when web-shell is not running (user opted out → menu item disabled).
   * @param {(url: string) => Promise<void>} [options.openExternal]
   *   Override for `shell.openExternal` — used by tests to assert without
   *   spawning a real browser.

---

## async openWebShellInBrowser()

```javascript
async openWebShellInBrowser()
```

* Open the embedded web-shell URL in the user's default browser. No-op
   * when web-shell is not running (legacy V5/V6 desktop shell selected via
   * SystemSettings opt-out). Surfaced from both the View menu and the
   * Cmd/Ctrl+Shift+B in-window accelerator.

---

## createMenu()

```javascript
createMenu()
```

* 创建应用菜单

---

## async openControlPanel()

```javascript
async openControlPanel()
```

* 打开控制面板

---

## async openControlPanelTab(tab)

```javascript
async openControlPanelTab(tab)
```

* 打开控制面板特定标签页

---

## async checkControlPanelRunning()

```javascript
async checkControlPanelRunning()
```

* 检查控制面板API是否运行

---

## async startControlPanelAPI()

```javascript
async startControlPanelAPI()
```

* 启动控制面板API服务

---

## async waitForService(ms)

```javascript
async waitForService(ms)
```

* 等待服务启动

---

## openControlPanelGuide()

```javascript
openControlPanelGuide()
```

* 打开控制面板使用指南

---

## checkForUpdates()

```javascript
checkForUpdates()
```

* 检查更新

---

## showAbout()

```javascript
showAbout()
```

* 显示关于对话框

---

## showError(title, message)

```javascript
showError(title, message)
```

* 显示错误对话框

---

## sendToRenderer(channel, ...args)

```javascript
sendToRenderer(channel, ...args)
```

* 发送消息到渲染进程

---

## stopControlPanelAPI()

```javascript
stopControlPanelAPI()
```

* 停止控制面板API服务

---

## destroy()

```javascript
destroy()
```

* 清理资源

---

