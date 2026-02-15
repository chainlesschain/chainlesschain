# progress-emitter

**Source**: `src/main/utils/progress-emitter.js`

**Generated**: 2026-02-15T07:37:13.762Z

---

## const

```javascript
const
```

* 统一进度通知系统
 *
 * 核心功能：
 * - 标准化进度事件格式
 * - 多任务并发追踪
 * - 层级进度聚合（子任务 -> 父任务）
 * - 进度持久化（可选）
 * - IPC 自动转发（Electron）
 *
 * v0.18.0: 新建文件，统一多媒体处理的进度通知

---

## const ProgressStage =

```javascript
const ProgressStage =
```

* 进度阶段枚举

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 默认配置

---

## class ProgressEmitter extends EventEmitter

```javascript
class ProgressEmitter extends EventEmitter
```

* 统一进度通知器类

---

## setMainWindow(window)

```javascript
setMainWindow(window)
```

* 设置主窗口（用于 IPC 转发）
   * @param {BrowserWindow} window - Electron 主窗口

---

## createTracker(taskId, options =

```javascript
createTracker(taskId, options =
```

* 创建任务追踪器
   * @param {string} taskId - 任务唯一标识
   * @param {Object} options - 任务选项
   * @returns {Object} 任务追踪器

---

## step: (message = "", increment = 1) =>

```javascript
step: (message = "", increment = 1) =>
```

* 更新步进（自动计算百分比）
       * @param {string} message - 进度消息
       * @param {number} increment - 步进增量（默认1）

---

## setPercent: (percent, message = "") =>

```javascript
setPercent: (percent, message = "") =>
```

* 直接设置百分比
       * @param {number} percent - 百分比 (0-100)
       * @param {string} message - 进度消息

---

## setStage: (stage, message = "") =>

```javascript
setStage: (stage, message = "") =>
```

* 设置任务阶段
       * @param {string} stage - 阶段（使用 ProgressStage 枚举）
       * @param {string} message - 消息

---

## complete: (result =

```javascript
complete: (result =
```

* 任务完成
       * @param {Object} result - 任务结果

---

## error: (error) =>

```javascript
error: (error) =>
```

* 任务失败
       * @param {Error|string} error - 错误信息

---

## cancel: (reason = "用户取消") =>

```javascript
cancel: (reason = "用户取消") =>
```

* 取消任务
       * @param {string} reason - 取消原因

---

## getInfo: () =>

```javascript
getInfo: () =>
```

* 获取任务信息
       * @returns {Object} 任务信息

---

## emitProgress(taskId, progress)

```javascript
emitProgress(taskId, progress)
```

* 发送进度事件（带节流）
   * @param {string} taskId - 任务ID
   * @param {Object} progress - 进度数据

---

## updateParentProgress(childTaskId)

```javascript
updateParentProgress(childTaskId)
```

* 更新父任务进度（聚合子任务）
   * @param {string} childTaskId - 子任务ID

---

## async persistTaskProgress(taskId, eventData)

```javascript
async persistTaskProgress(taskId, eventData)
```

* 持久化任务进度（可选）
   * @param {string} taskId - 任务ID
   * @param {Object} eventData - 事件数据

---

## removeTask(taskId)

```javascript
removeTask(taskId)
```

* 移除任务
   * @param {string} taskId - 任务ID

---

## getActiveTasks()

```javascript
getActiveTasks()
```

* 获取所有活动任务
   * @returns {Array} 任务列表

---

## getTask(taskId)

```javascript
getTask(taskId)
```

* 获取任务信息
   * @param {string} taskId - 任务ID
   * @returns {Object|null} 任务信息

---

## clearAll()

```javascript
clearAll()
```

* 清空所有任务

---

