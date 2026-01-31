# task-tracker-file

**Source**: `src\main\ai-engine\task-tracker-file.js`

**Generated**: 2026-01-27T06:44:03.876Z

---

## const

```javascript
const
```

* 任务追踪文件系统
 *
 * 基于 Manus AI 的 todo.md 机制，实现文件系统持久化的任务追踪。
 *
 * 核心原则（来自 Manus Blog）：
 * 1. 将任务目标"重述"到上下文末尾 - 解决"丢失中间"问题
 * 2. 使用文件系统作为扩展记忆 - 支持长时间任务
 * 3. 保存中间结果 - 支持任务恢复
 *
 * @see https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus

---

## class TaskTrackerFile extends EventEmitter

```javascript
class TaskTrackerFile extends EventEmitter
```

* 任务追踪文件管理器

---

## _getDefaultWorkspaceDir()

```javascript
_getDefaultWorkspaceDir()
```

* 获取默认工作空间目录
   * @private

---

## async _initWorkspace()

```javascript
async _initWorkspace()
```

* 初始化工作空间
   * @private

---

## async createTask(plan)

```javascript
async createTask(plan)
```

* 创建新任务
   * @param {Object} plan - 任务计划
   * @param {string} plan.objective - 任务目标
   * @param {Array} plan.steps - 任务步骤
   * @param {Object} plan.metadata - 元数据
   * @returns {Object} 创建的任务

---

## async startTask()

```javascript
async startTask()
```

* 开始任务

---

## async updateProgress(stepIndex, status, result = null)

```javascript
async updateProgress(stepIndex, status, result = null)
```

* 更新任务进度
   * @param {number} stepIndex - 步骤索引
   * @param {string} status - 状态 (in_progress, completed, failed, skipped)
   * @param {Object} result - 步骤结果

---

## async completeCurrentStep(result = null)

```javascript
async completeCurrentStep(result = null)
```

* 完成当前步骤并进入下一步
   * @param {Object} result - 步骤结果

---

## async completeTask(result = null)

```javascript
async completeTask(result = null)
```

* 完成任务
   * @param {Object} result - 任务结果

---

## async cancelTask(reason = "用户取消")

```javascript
async cancelTask(reason = "用户取消")
```

* 取消任务
   * @param {string} reason - 取消原因

---

## async recordStepError(stepIndex, error)

```javascript
async recordStepError(stepIndex, error)
```

* 记录步骤错误
   * @param {number} stepIndex - 步骤索引
   * @param {Error} error - 错误对象

---

## async updateTodoFile(status = "in_progress")

```javascript
async updateTodoFile(status = "in_progress")
```

* 更新 todo.md 文件
   * Manus 策略：每次迭代更新，将目标"重述"到上下文末尾
   * @param {string} status - 当前状态

---

## _generateTodoContent(status)

```javascript
_generateTodoContent(status)
```

* 生成 todo.md 内容
   * @private

---

## _formatDuration(ms)

```javascript
_formatDuration(ms)
```

* 格式化持续时间
   * @private

---

## async getTodoContext()

```javascript
async getTodoContext()
```

* 读取 todo.md 内容，用于注入到 prompt 末尾
   * @returns {Promise<string|null>}

---

## getTaskContextForPrompt()

```javascript
getTaskContextForPrompt()
```

* 获取当前任务的上下文摘要（用于 prompt）
   * @returns {Object|null}

---

## async saveIntermediateResult(stepIndex, result)

```javascript
async saveIntermediateResult(stepIndex, result)
```

* 保存中间结果到文件（可恢复）
   * @param {number} stepIndex - 步骤索引
   * @param {Object} result - 结果数据

---

## async loadIntermediateResult(stepIndex)

```javascript
async loadIntermediateResult(stepIndex)
```

* 加载中间结果
   * @param {number} stepIndex - 步骤索引
   * @returns {Promise<Object|null>}

---

## async _saveTaskData()

```javascript
async _saveTaskData()
```

* 保存任务数据
   * @private

---

## async loadUnfinishedTask()

```javascript
async loadUnfinishedTask()
```

* 加载未完成的任务（用于恢复）
   * @returns {Promise<Object|null>}

---

## async _archiveTask()

```javascript
async _archiveTask()
```

* 归档已完成的任务
   * @private

---

## async _cleanupHistory()

```javascript
async _cleanupHistory()
```

* 清理旧历史
   * @private

---

## async getTaskHistory(limit = 10)

```javascript
async getTaskHistory(limit = 10)
```

* 获取任务历史
   * @param {number} limit - 限制数量
   * @returns {Promise<Array>}

---

## _startAutoSave()

```javascript
_startAutoSave()
```

* 启动自动保存
   * @private

---

## _stopAutoSave()

```javascript
_stopAutoSave()
```

* 停止自动保存
   * @private

---

## async _cleanupTodoFile()

```javascript
async _cleanupTodoFile()
```

* 清理 todo.md 文件
   * @private

---

## getCurrentTask()

```javascript
getCurrentTask()
```

* 获取当前任务
   * @returns {Object|null}

---

## hasActiveTask()

```javascript
hasActiveTask()
```

* 检查是否有活动任务
   * @returns {boolean}

---

## getWorkspaceDir()

```javascript
getWorkspaceDir()
```

* 获取工作空间目录
   * @returns {string}

---

## destroy()

```javascript
destroy()
```

* 销毁实例

---

## function getTaskTrackerFile(options =

```javascript
function getTaskTrackerFile(options =
```

* 获取 TaskTrackerFile 单例
 * @param {Object} options - 配置选项
 * @returns {TaskTrackerFile}

---

## function createTaskTrackerFile(options =

```javascript
function createTaskTrackerFile(options =
```

* 创建新的 TaskTrackerFile 实例（非单例）
 * @param {Object} options - 配置选项
 * @returns {TaskTrackerFile}

---

