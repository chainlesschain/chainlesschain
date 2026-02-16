# agent-orchestrator

**Source**: `src/main/ai-engine/multi-agent/agent-orchestrator.js`

**Generated**: 2026-02-16T13:44:34.697Z

---

## const

```javascript
const
```

* 多 Agent 协调器
 *
 * 基于 OpenManus 的多 Agent 架构设计，实现 Agent 的注册、分发和协作。
 *
 * 核心功能：
 * 1. Agent 注册和管理
 * 2. 任务分发和路由
 * 3. Agent 间通信
 * 4. 并行执行协调
 *
 * @see https://github.com/FoundationAgents/OpenManus

---

## class AgentOrchestrator extends EventEmitter

```javascript
class AgentOrchestrator extends EventEmitter
```

* Agent 协调器

---

## registerAgent(agent)

```javascript
registerAgent(agent)
```

* 注册 Agent
   * @param {SpecializedAgent} agent - Agent 实例

---

## registerAgents(agents)

```javascript
registerAgents(agents)
```

* 批量注册 Agent
   * @param {Array<SpecializedAgent>} agents - Agent 数组

---

## unregisterAgent(agentId)

```javascript
unregisterAgent(agentId)
```

* 注销 Agent
   * @param {string} agentId - Agent ID

---

## getAgent(agentId)

```javascript
getAgent(agentId)
```

* 获取 Agent
   * @param {string} agentId - Agent ID
   * @returns {SpecializedAgent|undefined}

---

## getAllAgents()

```javascript
getAllAgents()
```

* 获取所有 Agent
   * @returns {Array<SpecializedAgent>}

---

## async dispatch(task)

```javascript
async dispatch(task)
```

* 分发任务到最合适的 Agent
   * @param {Object} task - 任务对象
   * @param {string} task.type - 任务类型
   * @param {any} task.input - 任务输入
   * @param {Object} task.context - 任务上下文
   * @returns {Promise<any>} 执行结果

---

## selectAgent(task)

```javascript
selectAgent(task)
```

* 选择最适合的 Agent
   * @param {Object} task - 任务对象
   * @returns {string|null} Agent ID

---

## getCapableAgents(task)

```javascript
getCapableAgents(task)
```

* 获取能处理任务的所有 Agent
   * @param {Object} task - 任务对象
   * @returns {Array<{agentId: string, score: number}>}

---

## async executeParallel(tasks, options =

```javascript
async executeParallel(tasks, options =
```

* 并行执行多个任务
   * @param {Array<Object>} tasks - 任务数组
   * @param {Object} options - 执行选项
   * @returns {Promise<Array>} 结果数组

---

## async executeChain(tasks)

```javascript
async executeChain(tasks)
```

* 链式执行任务（前一个任务的输出作为下一个任务的输入）
   * @param {Array<Object>} tasks - 任务数组
   * @returns {Promise<any>} 最终结果

---

## async sendMessage(fromAgent, toAgent, message)

```javascript
async sendMessage(fromAgent, toAgent, message)
```

* 发送消息给特定 Agent
   * @param {string} fromAgent - 发送者 Agent ID
   * @param {string} toAgent - 接收者 Agent ID
   * @param {Object} message - 消息内容
   * @returns {Promise<any>} 响应

---

## async broadcast(fromAgent, message)

```javascript
async broadcast(fromAgent, message)
```

* 广播消息给所有 Agent
   * @param {string} fromAgent - 发送者 Agent ID
   * @param {Object} message - 消息内容

---

## getMessageHistory(agentId = null, limit = 50)

```javascript
getMessageHistory(agentId = null, limit = 50)
```

* 获取消息历史
   * @param {string} agentId - Agent ID（可选，不传返回所有）
   * @param {number} limit - 限制数量
   * @returns {Array}

---

## _executeWithTimeout(promise, timeout, timeoutMessage)

```javascript
_executeWithTimeout(promise, timeout, timeoutMessage)
```

* 带超时的执行
   * @private

---

## _updateStats(agentId, success, duration)

```javascript
_updateStats(agentId, success, duration)
```

* 更新统计
   * @private

---

## _recordHistory(executionId, task, agentId, result, error, duration)

```javascript
_recordHistory(executionId, task, agentId, result, error, duration)
```

* 记录执行历史
   * @private

---

## _log(message)

```javascript
_log(message)
```

* 日志输出
   * @private

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object}

---

## getExecutionHistory(limit = 20)

```javascript
getExecutionHistory(limit = 20)
```

* 获取执行历史
   * @param {number} limit - 限制数量
   * @returns {Array}

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

