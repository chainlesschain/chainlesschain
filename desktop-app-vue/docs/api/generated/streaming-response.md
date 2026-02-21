# streaming-response

**Source**: `src/main/ai-engine/streaming-response.js`

**Generated**: 2026-02-21T22:04:25.868Z

---

## const

```javascript
const
```

* 流式响应模块 (Streaming Response)
 *
 * 功能:
 * 1. 进度反馈 - 实时报告任务执行进度
 * 2. 取消机制 - 允许用户中断正在执行的任务
 * 3. 部分结果流式返回 - 逐步返回中间结果
 * 4. IPC事件系统 - 与UI层实时通信
 * 5. 状态管理 - 跟踪任务生命周期
 *
 * @module streaming-response

---

## const TaskStatus =

```javascript
const TaskStatus =
```

* 任务状态

---

## const ProgressEventType =

```javascript
const ProgressEventType =
```

* 进度事件类型

---

## class CancellationToken

```javascript
class CancellationToken
```

* 取消令牌
 * 用于传递取消信号

---

## cancel(reason = "User cancelled")

```javascript
cancel(reason = "User cancelled")
```

* 请求取消

---

## isCancelled()

```javascript
isCancelled()
```

* 检查是否已取消

---

## throwIfCancelled()

```javascript
throwIfCancelled()
```

* 抛出取消异常（如果已取消）

---

## onCancelled(callback)

```javascript
onCancelled(callback)
```

* 注册取消回调

---

## class StreamingTask extends EventEmitter

```javascript
class StreamingTask extends EventEmitter
```

* 流式任务执行器

---

## start(totalSteps = 0)

```javascript
start(totalSteps = 0)
```

* 开始任务

---

## updateProgress(step, message = "", metadata =

```javascript
updateProgress(step, message = "", metadata =
```

* 更新进度

---

## milestone(name, data =

```javascript
milestone(name, data =
```

* 报告里程碑

---

## addResult(result)

```javascript
addResult(result)
```

* 添加部分结果

---

## complete(finalResult = null)

```javascript
complete(finalResult = null)
```

* 完成任务

---

## fail(error)

```javascript
fail(error)
```

* 任务失败

---

## cancel(reason = "User cancelled")

```javascript
cancel(reason = "User cancelled")
```

* 取消任务

---

## getCancellationToken()

```javascript
getCancellationToken()
```

* 获取取消令牌

---

## getStatus()

```javascript
getStatus()
```

* 获取任务状态

---

## _emitEvent(type, data)

```javascript
_emitEvent(type, data)
```

* 发送事件

---

## class StreamingResponse

```javascript
class StreamingResponse
```

* 流式响应管理器

---

## setIPC(ipcChannel)

```javascript
setIPC(ipcChannel)
```

* 设置IPC通道
   * 在Electron环境中用于与渲染进程通信

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* 设置数据库连接

---

## createTask(taskId, config =

```javascript
createTask(taskId, config =
```

* 创建流式任务

---

## getTask(taskId)

```javascript
getTask(taskId)
```

* 获取任务

---

## cancelTask(taskId, reason = "User cancelled")

```javascript
cancelTask(taskId, reason = "User cancelled")
```

* 取消任务

---

## cleanupTask(taskId)

```javascript
cleanupTask(taskId)
```

* 清理已完成的任务

---

## _handleTaskEvent(event)

```javascript
_handleTaskEvent(event)
```

* 处理任务事件

---

## async _recordEvent(event)

```javascript
async _recordEvent(event)
```

* 记录事件到数据库

---

## _sendToUI(event)

```javascript
_sendToUI(event)
```

* 通过IPC发送事件到UI层

---

## getActiveTasks()

```javascript
getActiveTasks()
```

* 获取所有活跃任务

---

## getStats()

```javascript
getStats()
```

* 获取任务统计

---

## async getTaskHistory(options =

```javascript
async getTaskHistory(options =
```

* 获取任务历史（从数据库）

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

## async function withStreaming(

```javascript
async function withStreaming(
```

* 辅助函数：包装异步函数以支持流式进度

---

