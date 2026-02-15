# system-handler

**Source**: `src/main/remote/handlers/system-handler.js`

**Generated**: 2026-02-15T10:10:53.381Z

---

## const

```javascript
const
```

* 系统命令处理器
 *
 * 处理系统相关命令：
 * - system.getStatus: 获取系统状态
 * - system.getInfo: 获取系统信息
 * - system.screenshot: 截图
 * - system.notify: 通知
 * - system.execCommand: 执行 Shell 命令（高权限）
 *
 * @module remote/handlers/system-handler

---

## class SystemCommandHandler

```javascript
class SystemCommandHandler
```

* 系统命令处理器类

---

## async handle(action, params, context)

```javascript
async handle(action, params, context)
```

* 处理命令（统一入口）

---

## async getStatus(params, context)

```javascript
async getStatus(params, context)
```

* 获取系统状态

---

## async getInfo(params, context)

```javascript
async getInfo(params, context)
```

* 获取系统信息

---

## async screenshot(params, context)

```javascript
async screenshot(params, context)
```

* 截图
   * 使用 Electron desktopCapturer 获取屏幕截图

---

## async notify(params, context)

```javascript
async notify(params, context)
```

* 发送通知

---

## async execCommand(params, context)

```javascript
async execCommand(params, context)
```

* 执行 Shell 命令（高权限操作）

---

