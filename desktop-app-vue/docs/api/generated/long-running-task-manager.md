# long-running-task-manager

**Source**: `src/main/ai-engine/cowork/long-running-task-manager.js`

**Generated**: 2026-02-15T08:42:37.279Z

---

## const

```javascript
const
```

* LongRunningTaskManager - 长时运行任务管理器
 *
 * 支持复杂任务的长时间执行，具备检查点、恢复、暂停/继续等功能。
 *
 * 核心功能：
 * 1. 任务生命周期管理
 * 2. 检查点创建和恢复
 * 3. 后台执行
 * 4. 进度跟踪
 * 5. 错误处理和重试
 *
 * @module ai-engine/cowork/long-running-task-manager

---

## const TaskStatus =

```javascript
const TaskStatus =
```

* 任务状态

---

## class SmartCheckpointStrategy

```javascript
class SmartCheckpointStrategy
```

* 智能检查点策略
 * 根据任务特征动态调整检查点保存频率

---

## calculateInterval(taskMetadata)

```javascript
calculateInterval(taskMetadata)
```

* 计算检查点间隔

---

## shouldSaveCheckpoint(lastCheckpointTime, taskMetadata)

```javascript
shouldSaveCheckpoint(lastCheckpointTime, taskMetadata)
```

* 判断是否应该保存检查点

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

## class LongRunningTaskManager extends EventEmitter

```javascript
class LongRunningTaskManager extends EventEmitter
```

* LongRunningTaskManager 类

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* 设置数据库实例
   * @param {Object} db - 数据库实例

---

## async _ensureDataDir()

```javascript
async _ensureDataDir()
```

* 初始化存储目录
   * @private

---

## async createTask(taskConfig)

```javascript
async createTask(taskConfig)
```

* 创建长时运行任务
   * @param {Object} taskConfig - 任务配置
   * @returns {Promise<Object>} 任务对象

---

## async startTask(taskId)

```javascript
async startTask(taskId)
```

* 启动任务
   * @param {string} taskId - 任务 ID
   * @returns {Promise<void>} 返回任务执行Promise

---

## async pauseTask(taskId)

```javascript
async pauseTask(taskId)
```

* 暂停任务
   * @param {string} taskId - 任务 ID

---

## async resumeTask(taskId)

```javascript
async resumeTask(taskId)
```

* 继续任务
   * @param {string} taskId - 任务 ID

---

## async cancelTask(taskId, reason = "")

```javascript
async cancelTask(taskId, reason = "")
```

* 取消任务
   * @param {string} taskId - 任务 ID
   * @param {string} reason - 取消原因

---

## getTaskStatus(taskId)

```javascript
getTaskStatus(taskId)
```

* 获取任务状态
   * @param {string} taskId - 任务 ID
   * @returns {Object} 任务状态

---

## async _executeTask(task)

```javascript
async _executeTask(task)
```

* 执行任务
   * @private

---

## async _executeSteps(task)

```javascript
async _executeSteps(task)
```

* 按步骤执行任务
   * @private

---

## _createTaskContext(task)

```javascript
_createTaskContext(task)
```

* 创建任务上下文
   * @private

---

## async _handleTaskSuccess(task, result)

```javascript
async _handleTaskSuccess(task, result)
```

* 处理任务成功
   * @private

---

## async _handleTaskFailure(task, error)

```javascript
async _handleTaskFailure(task, error)
```

* 处理任务失败
   * @private

---

## async _markTaskFailed(task, error)

```javascript
async _markTaskFailed(task, error)
```

* 标记任务失败
   * @private

---

## async createCheckpoint(taskId, metadata =

```javascript
async createCheckpoint(taskId, metadata =
```

* 创建检查点
   * @param {string} taskId - 任务 ID
   * @param {Object} metadata - 元数据
   * @returns {Promise<Object>} 检查点信息

---

## async restoreFromCheckpoint(checkpointId)

```javascript
async restoreFromCheckpoint(checkpointId)
```

* 从检查点恢复任务
   * @param {string} checkpointId - 检查点 ID
   * @returns {Promise<Object>} 恢复的任务

---

## _startCheckpointTimer(taskId)

```javascript
_startCheckpointTimer(taskId)
```

* 启动检查点定时器
   * @private

---

## _stopCheckpointTimer(taskId)

```javascript
_stopCheckpointTimer(taskId)
```

* 停止检查点定时器
   * @private

---

## async _saveTask(task)

```javascript
async _saveTask(task)
```

* 保存任务到文件
   * @private

---

## async _saveTaskResult(task)

```javascript
async _saveTaskResult(task)
```

* 保存任务结果
   * @private

---

## _estimateTimeRemaining(task)

```javascript
_estimateTimeRemaining(task)
```

* 估算剩余时间
   * @private

---

## _log(message, level = "info")

```javascript
_log(message, level = "info")
```

* 日志输出
   * @private

---

## getAllActiveTasks()

```javascript
getAllActiveTasks()
```

* 获取所有活跃任务
   * @returns {Array}

---

## async cleanupCompletedTasks()

```javascript
async cleanupCompletedTasks()
```

* 清理已完成的任务

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object}

---

## getTask(taskId)

```javascript
getTask(taskId)
```

* 获取任务（别名：getTaskStatus）
   * @param {string} taskId - 任务ID
   * @returns {object} 任务对象

---

## getCheckpoints(taskId)

```javascript
getCheckpoints(taskId)
```

* 获取任务检查点列表
   * @param {string} taskId - 任务ID
   * @returns {Array} 检查点列表

---

## async retryTask(taskId)

```javascript
async retryTask(taskId)
```

* 重试失败的任务
   * @param {string} taskId - 任务ID
   * @returns {Promise<void>}

---

## listTasks(filters =

```javascript
listTasks(filters =
```

* 列出所有任务
   * @param {object} filters - 筛选条件
   * @returns {Array} 任务列表

---

