# integration-example

**Source**: `src/main/remote/integration-example.js`

**Generated**: 2026-02-21T22:04:25.788Z

---

## const

```javascript
const
```

* 远程控制模块集成示例
 *
 * 展示如何在主进程中初始化和使用远程控制系统

---

## async function initializeRemoteControl(app, mainWindow)

```javascript
async function initializeRemoteControl(app, mainWindow)
```

* 初始化远程控制系统
 *
 * @param {Object} app - Electron app 实例
 * @param {Object} mainWindow - 主窗口实例
 * @returns {Promise<Object>} 远程网关实例

---

## function setupEventHandlers(gateway, mainWindow)

```javascript
function setupEventHandlers(gateway, mainWindow)
```

* 设置事件处理器

---

## function getRemoteGateway()

```javascript
function getRemoteGateway()
```

* 获取远程网关实例

---

## async function shutdownRemoteControl()

```javascript
async function shutdownRemoteControl()
```

* 关闭远程控制系统

---

## async function example(mainWindow)

```javascript
async function example(mainWindow)
```

* 使用示例

---

