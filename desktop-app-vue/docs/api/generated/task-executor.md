# task-executor

**Source**: `src\main\ai-engine\task-executor.js`

**Generated**: 2026-01-27T06:44:03.876Z

---

## const

```javascript
const
```

* AI任务并行执行器
 * 支持依赖分析、并发控制、优先级队列

---

## class AutoPhaseTransition

```javascript
class AutoPhaseTransition
```

* 自动阶段转换管理器
 * 根据任务执行状态自动切换工具掩码阶段

---

## setupListeners()

```javascript
setupListeners()
```

* 设置事件监听器

---

## maybeTransition(targetPhase, reason = '')

```javascript
maybeTransition(targetPhase, reason = '')
```

* 尝试切换阶段

---

## shouldTransition(targetPhase)

```javascript
shouldTransition(targetPhase)
```

* 判断是否允许转换

---

## manualTransition(targetPhase, reason = '手动触发')

```javascript
manualTransition(targetPhase, reason = '手动触发')
```

* 手动切换阶段

---

## reset()

```javascript
reset()
```

* 重置到初始阶段

---

## getCurrentPhase()

```javascript
getCurrentPhase()
```

* 获取当前阶段

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## const EXECUTOR_CONFIG =

```javascript
const EXECUTOR_CONFIG =
```

* 任务执行器配置

---

## class DynamicConcurrencyController

```javascript
class DynamicConcurrencyController
```

* 动态并发控制器
 * 根据CPU和内存使用率自动调整并发数

---

## getCpuUsage()

```javascript
getCpuUsage()
```

* 获取CPU使用率（百分比）

---

## getMemoryUsage()

```javascript
getMemoryUsage()
```

* 获取内存使用率（百分比）

---

## async sampleSystemResources()

```javascript
async sampleSystemResources()
```

* 采样系统资源

---

## getAverage(samples)

```javascript
getAverage(samples)
```

* 计算平均值

---

## async adjustConcurrency()

```javascript
async adjustConcurrency()
```

* 调整并发数

---

## getCurrentConcurrency()

```javascript
getCurrentConcurrency()
```

* 获取当前并发数

---

## setConcurrency(value)

```javascript
setConcurrency(value)
```

* 手动设置并发数

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## reset()

```javascript
reset()
```

* 重置统计

---

## class SmartRetryStrategy

```javascript
class SmartRetryStrategy
```

* 智能重试策略
 * 支持指数退避、错误分类、抖动(jitter)

---

## isRetryable(error)

```javascript
isRetryable(error)
```

* 判断错误是否可重试

---

## calculateDelay(attemptNumber)

```javascript
calculateDelay(attemptNumber)
```

* 计算重试延迟（指数退避 + 抖动）

---

## async delay(attemptNumber)

```javascript
async delay(attemptNumber)
```

* 执行重试延迟

---

## shouldRetry(error, currentAttempt)

```javascript
shouldRetry(error, currentAttempt)
```

* 判断是否应该重试

---

## recordSuccess()

```javascript
recordSuccess()
```

* 记录重试成功

---

## recordFailure()

```javascript
recordFailure()
```

* 记录重试失败

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## reset()

```javascript
reset()
```

* 重置统计

---

## const TaskStatus =

```javascript
const TaskStatus =
```

* 任务状态

---

## class TaskNode

```javascript
class TaskNode
```

* 任务节点

---

## isReady(completedTasks)

```javascript
isReady(completedTasks)
```

* 检查是否可以执行

---

## markReady()

```javascript
markReady()
```

* 标记为可执行

---

## markRunning()

```javascript
markRunning()
```

* 开始执行

---

## markCompleted(result)

```javascript
markCompleted(result)
```

* 标记完成

---

## markFailed(error)

```javascript
markFailed(error)
```

* 标记失败

---

## getDuration()

```javascript
getDuration()
```

* 获取执行时长

---

## class TaskExecutor extends EventEmitter

```javascript
class TaskExecutor extends EventEmitter
```

* 任务执行器

---

## addTask(task)

```javascript
addTask(task)
```

* 添加任务

---

## addTasks(tasks)

```javascript
addTasks(tasks)
```

* 批量添加任务

---

## buildDependencyGraph()

```javascript
buildDependencyGraph()
```

* 构建依赖图

---

## detectCyclicDependencies()

```javascript
detectCyclicDependencies()
```

* 检测循环依赖

---

## getReadyTasks()

```javascript
getReadyTasks()
```

* 获取可执行的任务

---

## async executeTask(node, executor)

```javascript
async executeTask(node, executor)
```

* 执行单个任务

---

## async executeAll(executor, options =

```javascript
async executeAll(executor, options =
```

* 并行执行所有任务

---

## cancel()

```javascript
cancel()
```

* 取消执行

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## reset()

```javascript
reset()
```

* 重置执行器

---

## visualize()

```javascript
visualize()
```

* 可视化任务图

---

