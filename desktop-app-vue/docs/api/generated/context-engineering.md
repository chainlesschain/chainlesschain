# context-engineering

**Source**: `src/main/llm/context-engineering.js`

**Generated**: 2026-02-21T22:04:25.824Z

---

## const crypto = require("crypto");

```javascript
const crypto = require("crypto");
```

* Context Engineering 模块
 *
 * 基于 Manus AI 的最佳实践，优化 LLM 上下文构建以最大化 KV-Cache 命中率。
 *
 * 核心原则（来自 Manus Blog）：
 * 1. 保持 prompt 前缀稳定 - 避免时间戳等动态内容破坏缓存
 * 2. 采用只读追加模式 - 确保序列化确定性
 * 3. 显式标记缓存断点 - 优化缓存边界
 * 4. 将任务目标重述到上下文末尾 - 解决"丢失中间"问题
 *
 * @see https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus

---

## class ContextEngineering

```javascript
class ContextEngineering
```

* 上下文工程管理器

---

## setInstinctManager(instinctManager)

```javascript
setInstinctManager(instinctManager)
```

* Set the InstinctManager for learned pattern injection
   * @param {Object} instinctManager - InstinctManager instance

---

## setCodeKnowledgeGraph(codeKnowledgeGraph)

```javascript
setCodeKnowledgeGraph(codeKnowledgeGraph)
```

* Set the CodeKnowledgeGraph for architectural insight injection
   * @param {Object} codeKnowledgeGraph - CodeKnowledgeGraph instance

---

## buildOptimizedPrompt(options)

```javascript
buildOptimizedPrompt(options)
```

* 构建 KV-Cache 友好的 Prompt
   *
   * 关键策略：
   * - 静态部分（system prompt + 工具定义）放在最前面
   * - 动态部分（对话历史 + 用户输入）追加在后面
   * - 任务目标重述在最末尾
   *
   * @param {Object} options - 构建选项
   * @param {string} options.systemPrompt - 系统提示词
   * @param {Array} options.messages - 对话历史
   * @param {Array} options.tools - 工具定义
   * @param {Object} options.taskContext - 任务上下文
   * @returns {Object} 优化后的消息数组和元数据

---

## _cleanSystemPrompt(systemPrompt)

```javascript
_cleanSystemPrompt(systemPrompt)
```

* 清理 System Prompt，移除动态内容
   * @private

---

## _serializeToolDefinitions(tools)

```javascript
_serializeToolDefinitions(tools)
```

* 序列化工具定义（确保确定性）
   * @private

---

## _serializeToolsWithSkillContext(registry)

```javascript
_serializeToolsWithSkillContext(registry)
```

* Serialize tools grouped by skill with instructions and examples
   * @private
   * @param {Object} registry - UnifiedToolRegistry instance
   * @returns {string} Formatted tool definitions grouped by skill

---

## _cleanMessages(messages)

```javascript
_cleanMessages(messages)
```

* 清理消息数组，移除动态内容
   * @private

---

## _buildErrorContext()

```javascript
_buildErrorContext()
```

* 构建错误上下文（供模型学习）
   * @private

---

## _buildTaskReminder(taskContext)

```javascript
_buildTaskReminder(taskContext)
```

* 构建任务提醒（重述目标到上下文末尾）
   * @private

---

## _computeStaticHash(systemPrompt, tools)

```javascript
_computeStaticHash(systemPrompt, tools)
```

* 计算静态部分的哈希值
   * @private

---

## _computeHash(content)

```javascript
_computeHash(content)
```

* 计算字符串哈希
   * @private

---

## recordError(error)

```javascript
recordError(error)
```

* 记录错误（供模型学习）
   * @param {Object} error - 错误信息

---

## resolveError(errorIndex, resolution)

```javascript
resolveError(errorIndex, resolution)
```

* 标记错误已解决
   * @param {number} errorIndex - 错误索引
   * @param {string} resolution - 解决方案

---

## setCurrentTask(task)

```javascript
setCurrentTask(task)
```

* 设置当前任务上下文
   * @param {Object} task - 任务信息

---

## updateTaskProgress(currentStep, status)

```javascript
updateTaskProgress(currentStep, status)
```

* 更新任务进度
   * @param {number} currentStep - 当前步骤
   * @param {string} status - 状态

---

## getCurrentTask()

```javascript
getCurrentTask()
```

* 获取当前任务上下文
   * @returns {Object|null} 任务上下文

---

## clearTask()

```javascript
clearTask()
```

* 清除任务上下文

---

## clearErrors()

```javascript
clearErrors()
```

* 清除错误历史

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object} 统计数据

---

## resetStats()

```javascript
resetStats()
```

* 重置统计

---

## class RecoverableCompressor

```javascript
class RecoverableCompressor
```

* 可恢复压缩器
 *
 * Manus 策略：超长观察数据使用可恢复的压缩——保留 URL/路径，丢弃内容本体

---

## compress(content, type = "default")

```javascript
compress(content, type = "default")
```

* 压缩内容，保留可恢复的引用
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

## async recover(ref, recoveryFunctions =

```javascript
async recover(ref, recoveryFunctions =
```

* 恢复压缩内容
   * @param {Object} ref - 压缩引用
   * @param {Object} recoveryFunctions - 恢复函数集
   * @returns {Promise<any>} 恢复的内容

---

## function getContextEngineering(options =

```javascript
function getContextEngineering(options =
```

* 获取 Context Engineering 单例
 * @param {Object} options - 配置选项
 * @returns {ContextEngineering}

---

