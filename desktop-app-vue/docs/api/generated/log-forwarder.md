# log-forwarder

**Source**: `src/main/utils/log-forwarder.js`

**Generated**: 2026-02-15T08:42:37.169Z

---

## const LOG_CHANNEL = "main:log";

```javascript
const LOG_CHANNEL = "main:log";
```

* 日志转发器 - 将主进程日志转发到渲染进程 DevTools
 *
 * 使用方法：
 * 1. 在主进程中调用 initLogForwarder(mainWindow)
 * 2. 在渲染进程中通过 window.electronAPI.mainLog.onLog(callback) 监听
 *
 * @module log-forwarder

---

## function shouldForward(args)

```javascript
function shouldForward(args)
```

* 检查日志是否应该被转发
 * @param {any[]} args - console 参数
 * @returns {boolean}

---

## function serializeArgs(args)

```javascript
function serializeArgs(args)
```

* 安全序列化参数
 * @param {any[]} args - 原始参数
 * @returns {string[]}

---

## function forwardLog(level, args)

```javascript
function forwardLog(level, args)
```

* 发送日志到渲染进程
 * @param {string} level - 日志级别
 * @param {any[]} args - 日志参数

---

## function createWrapper(level, original)

```javascript
function createWrapper(level, original)
```

* 创建包装后的 console 方法
 * @param {string} level - 日志级别
 * @param {Function} original - 原始方法
 * @returns {Function}

---

## function initLogForwarder(mainWindow)

```javascript
function initLogForwarder(mainWindow)
```

* 初始化日志转发器
 * @param {Electron.BrowserWindow} mainWindow - 主窗口实例

---

## function updateWebContents(webContents)

```javascript
function updateWebContents(webContents)
```

* 更新 webContents 引用（窗口重建时使用）
 * @param {Electron.WebContents} webContents

---

## function sendLog(level, ...args)

```javascript
function sendLog(level, ...args)
```

* 手动发送日志（用于特殊情况）
 * @param {string} level - 日志级别
 * @param {...any} args - 日志内容

---

## function getLogChannel()

```javascript
function getLogChannel()
```

* 获取日志通道名称
 * @returns {string}

---

