# manus-optimizations

**Source**: `src/main/llm/manus-optimizations.js`

**Generated**: 2026-02-16T13:44:34.654Z

---

## const

```javascript
const
```

* Manus 优化集成模块
 *
 * 将 Context Engineering 和 Tool Masking 集成到 LLM 调用流程中。
 *
 * 主要功能：
 * 1. KV-Cache 友好的 Prompt 构建
 * 2. 工具掩码控制
 * 3. 任务追踪和目标重述
 * 4. 可恢复压缩
 *
 * @see https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus

---

## class ManusOptimizations

```javascript
class ManusOptimizations
```

* Manus 优化管理器
 *
 * 协调 Context Engineering 和 Tool Masking 的工作

---

## this.unifiedRegistry = null;

```javascript
this.unifiedRegistry = null;
```

@type {Object|null} UnifiedToolRegistry for skill-aware prompts

---

## bindUnifiedRegistry(registry)

```javascript
bindUnifiedRegistry(registry)
```

* Bind UnifiedToolRegistry for skill-aware prompt building.
   * When bound, buildOptimizedPrompt will include skill context (instructions, examples).
   * @param {Object} registry - UnifiedToolRegistry instance

---

## buildOptimizedPrompt(options)

```javascript
buildOptimizedPrompt(options)
```

* 构建优化后的 Prompt
   *
   * @param {Object} options - 构建选项
   * @param {string} options.systemPrompt - 系统提示词
   * @param {Array} options.messages - 对话历史
   * @param {Array} options.tools - 工具定义（可选，默认使用掩码系统的工具）
   * @returns {Object} 优化后的消息和元数据

---

## _buildBasicMessages(options)

```javascript
_buildBasicMessages(options)
```

* 构建基础消息（不优化）
   * @private

---

## setToolAvailable(toolName, available)

```javascript
setToolAvailable(toolName, available)
```

* 设置工具可用性
   * @param {string} toolName - 工具名称
   * @param {boolean} available - 是否可用

---

## setToolsByPrefix(prefix, available)

```javascript
setToolsByPrefix(prefix, available)
```

* 按前缀设置工具可用性
   * @param {string} prefix - 工具前缀
   * @param {boolean} available - 是否可用

---

## validateToolCall(toolName)

```javascript
validateToolCall(toolName)
```

* 验证工具调用
   * @param {string} toolName - 工具名称
   * @returns {Object} 验证结果

---

## getAvailableTools()

```javascript
getAvailableTools()
```

* 获取可用工具列表
   * @returns {Array} 工具定义

---

## async startTask(task)

```javascript
async startTask(task)
```

* 开始新任务
   * @param {Object} task - 任务信息
   * @param {string} task.objective - 任务目标
   * @param {Array} task.steps - 任务步骤

---

## _createMemoryTask(task)

```javascript
_createMemoryTask(task)
```

* 创建内存任务（备用）
   * @private

---

## async updateTaskProgress(stepIndex, status = "in_progress")

```javascript
async updateTaskProgress(stepIndex, status = "in_progress")
```

* 更新任务进度
   * @param {number} stepIndex - 当前步骤索引
   * @param {string} status - 状态

---

## async completeCurrentStep(result = null)

```javascript
async completeCurrentStep(result = null)
```

* 完成当前步骤
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

## getCurrentTask()

```javascript
getCurrentTask()
```

* 获取当前任务
   * @returns {Object|null} 当前任务

---

## async getTodoContext()

```javascript
async getTodoContext()
```

* 获取 todo.md 上下文（用于注入到 prompt 末尾）
   * @returns {Promise<string|null>}

---

## async resumeUnfinishedTask()

```javascript
async resumeUnfinishedTask()
```

* 恢复未完成的任务
   * @returns {Promise<Object|null>}

---

## async getTaskHistory(limit = 10)

```javascript
async getTaskHistory(limit = 10)
```

* 获取任务历史
   * @param {number} limit - 限制数量
   * @returns {Promise<Array>}

---

## async saveIntermediateResult(stepIndex, result)

```javascript
async saveIntermediateResult(stepIndex, result)
```

* 保存中间结果
   * @param {number} stepIndex - 步骤索引
   * @param {Object} result - 结果数据

---

## recordError(error)

```javascript
recordError(error)
```

* 记录错误（供模型学习）
   * @param {Object} error - 错误信息

---

## resolveLastError(resolution)

```javascript
resolveLastError(resolution)
```

* 标记错误已解决
   * @param {string} resolution - 解决方案

---

## compress(content, type = "default")

```javascript
compress(content, type = "default")
```

* 压缩内容
   * @param {any} content - 原始内容
   * @param {string} type - 内容类型
   * @returns {Object} 压缩后的引用

---

## isCompressedRef(data)

```javascript
isCompressedRef(data)
```

* 检查是否为压缩引用
   * @param {any} data - 数据
   * @returns {boolean}

---

## async recover(ref, recoveryFunctions)

```javascript
async recover(ref, recoveryFunctions)
```

* 恢复压缩内容
   * @param {Object} ref - 压缩引用
   * @param {Object} recoveryFunctions - 恢复函数集
   * @returns {Promise<any>}

---

## configureTaskPhases(config = null)

```javascript
configureTaskPhases(config = null)
```

* 配置任务阶段状态机
   * @param {Object} config - 状态机配置（可选，默认使用预定义配置）

---

## transitionToPhase(phase)

```javascript
transitionToPhase(phase)
```

* 切换到指定阶段
   * @param {string} phase - 阶段名称
   * @returns {boolean} 是否成功

---

## getCurrentPhase()

```javascript
getCurrentPhase()
```

* 获取当前阶段
   * @returns {string|null}

---

## getStats()

```javascript
getStats()
```

* 获取综合统计
   * @returns {Object} 统计数据

---

## resetStats()

```javascript
resetStats()
```

* 重置统计

---

## exportDebugInfo()

```javascript
exportDebugInfo()
```

* 导出调试信息
   * @returns {Object}

---

## function getManusOptimizations(options =

```javascript
function getManusOptimizations(options =
```

* 获取 Manus 优化管理器单例
 * @param {Object} options - 配置选项
 * @returns {ManusOptimizations}

---

## function createManusOptimizations(options =

```javascript
function createManusOptimizations(options =
```

* 创建新的 Manus 优化管理器实例（非单例）
 * @param {Object} options - 配置选项
 * @returns {ManusOptimizations}

---

