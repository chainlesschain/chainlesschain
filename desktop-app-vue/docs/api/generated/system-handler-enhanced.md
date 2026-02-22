# system-handler-enhanced

**Source**: `src/main/remote/handlers/system-handler-enhanced.js`

**Generated**: 2026-02-22T01:23:36.684Z

---

## const

```javascript
const
```

* 系统命令处理器（增强版）
 *
 * 完整实现系统相关命令，集成截图、通知、系统监控等功能
 *
 * 命令列表：
 * - system.screenshot: 截图
 * - system.notify: 发送通知
 * - system.getStatus: 获取系统状态
 * - system.getInfo: 获取系统信息
 * - system.execCommand: 执行命令（需 Admin 权限）
 *
 * @module remote/handlers/system-handler-enhanced

---

## class SystemCommandHandlerEnhanced extends EventEmitter

```javascript
class SystemCommandHandlerEnhanced extends EventEmitter
```

* 系统命令处理器类

---

## async handle(action, params, context)

```javascript
async handle(action, params, context)
```

* 处理命令（统一入口）

---

## async screenshot(params, context)

```javascript
async screenshot(params, context)
```

* 截图
   *
   * 支持全屏、区域截图、质量配置

---

## async notify(params, context)

```javascript
async notify(params, context)
```

* 发送通知
   *
   * 支持标题、内容、图标、操作按钮

---

## async getStatus(params, context)

```javascript
async getStatus(params, context)
```

* 获取系统状态
   *
   * CPU、内存、磁盘、网络状态

---

## async getInfo(params, context)

```javascript
async getInfo(params, context)
```

* 获取系统信息
   *
   * OS、硬件、应用版本等

---

## async execCommand(params, context)

```javascript
async execCommand(params, context)
```

* 执行命令（需 Admin 权限）
   *
   * 安全沙箱、超时控制、输出捕获

---

## isCommandSafe(command)

```javascript
isCommandSafe(command)
```

* 检查命令是否安全

---

## async getCPUStatus()

```javascript
async getCPUStatus()
```

* 获取 CPU 状态

---

## async getMemoryStatus()

```javascript
async getMemoryStatus()
```

* 获取内存状态

---

## async getDiskStatus()

```javascript
async getDiskStatus()
```

* 获取磁盘状态

---

## async getNetworkStatus()

```javascript
async getNetworkStatus()
```

* 获取网络状态

---

## async getOSInfo()

```javascript
async getOSInfo()
```

* 获取 OS 信息

---

## async getCPUInfo()

```javascript
async getCPUInfo()
```

* 获取 CPU 信息

---

## async getMemoryInfo()

```javascript
async getMemoryInfo()
```

* 获取内存信息

---

## async getGraphicsInfo()

```javascript
async getGraphicsInfo()
```

* 获取显卡信息

---

## getAppInfo()

```javascript
getAppInfo()
```

* 获取应用信息

---

## getMetrics()

```javascript
getMetrics()
```

* 获取性能指标

---

