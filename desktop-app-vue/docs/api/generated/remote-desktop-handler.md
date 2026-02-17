# remote-desktop-handler

**Source**: `src/main/remote/handlers/remote-desktop-handler.js`

**Generated**: 2026-02-17T10:13:18.200Z

---

## const

```javascript
const
```

* 远程桌面命令处理器
 *
 * 处理远程桌面相关命令：
 * - desktop.startSession: 开始远程桌面会话
 * - desktop.stopSession: 停止远程桌面会话
 * - desktop.getFrame: 获取屏幕帧
 * - desktop.sendInput: 发送输入事件（鼠标/键盘）
 * - desktop.getDisplays: 获取显示器列表
 * - desktop.switchDisplay: 切换显示器
 *
 * @module remote/handlers/remote-desktop-handler

---

## class RemoteDesktopHandler extends EventEmitter

```javascript
class RemoteDesktopHandler extends EventEmitter
```

* 远程桌面命令处理器类

---

## async handle(action, params, context)

```javascript
async handle(action, params, context)
```

* 处理命令（统一入口）

---

## async startSession(params, context)

```javascript
async startSession(params, context)
```

* 开始远程桌面会话

---

## async stopSession(params, context)

```javascript
async stopSession(params, context)
```

* 停止远程桌面会话

---

## async getFrame(params, context)

```javascript
async getFrame(params, context)
```

* 获取屏幕帧

---

## async sendInput(params, context)

```javascript
async sendInput(params, context)
```

* 发送输入事件（鼠标/键盘）

---

## async handleMouseMove(data)

```javascript
async handleMouseMove(data)
```

* 处理鼠标移动

---

## async handleMouseClick(data)

```javascript
async handleMouseClick(data)
```

* 处理鼠标点击

---

## async handleMouseScroll(data)

```javascript
async handleMouseScroll(data)
```

* 处理鼠标滚动

---

## async handleKeyPress(data)

```javascript
async handleKeyPress(data)
```

* 处理按键

---

## async handleKeyType(data)

```javascript
async handleKeyType(data)
```

* 处理文本输入

---

## async getDisplays(params, context)

```javascript
async getDisplays(params, context)
```

* 获取显示器列表

---

## async switchDisplay(params, context)

```javascript
async switchDisplay(params, context)
```

* 切换显示器

---

## async getStats(params, context)

```javascript
async getStats(params, context)
```

* 获取性能统计

---

## async getAvailableDisplays()

```javascript
async getAvailableDisplays()
```

* 获取可用显示器列表

---

## async cleanupExpiredSessions(maxAge = 60 * 60 * 1000)

```javascript
async cleanupExpiredSessions(maxAge = 60 * 60 * 1000)
```

* 清理过期会话（可定期调用）

---

