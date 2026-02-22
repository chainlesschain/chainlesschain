# agent-pool

**Source**: `src/main/ai-engine/cowork/agent-pool.js`

**Generated**: 2026-02-22T01:23:36.774Z

---

## const

```javascript
const
```

* AgentPool - 代理池管理器
 *
 * 复用代理实例，减少创建和销毁开销
 *
 * 核心功能:
 * 1. 代理池预创建和复用
 * 2. 动态扩容和缩容
 * 3. 状态隔离确保安全
 * 4. 等待队列处理
 * 5. 统计和监控
 *
 * @module ai-engine/cowork/agent-pool

---

## const AgentStatus =

```javascript
const AgentStatus =
```

* 代理状态

---

## class AgentPool extends EventEmitter

```javascript
class AgentPool extends EventEmitter
```

* AgentPool 类

---

## async initialize()

```javascript
async initialize()
```

* 初始化代理池（预热）

---

## async acquireAgent(capabilities =

```javascript
async acquireAgent(capabilities =
```

* 获取代理
   * @param {Object} capabilities - 所需能力
   * @param {number} timeout - 等待超时(ms)
   * @returns {Promise<Object>} 代理对象

---

## releaseAgent(agentId)

```javascript
releaseAgent(agentId)
```

* 释放代理
   * @param {string} agentId - 代理ID

---

## _waitForAgent(capabilities, timeout)

```javascript
_waitForAgent(capabilities, timeout)
```

* 等待可用代理
   * @private

---

## async _createAgent(agentId, capabilities =

```javascript
async _createAgent(agentId, capabilities =
```

* 创建新代理
   * @private

---

## _resetAgent(agent, capabilities =

```javascript
_resetAgent(agent, capabilities =
```

* 重置代理状态
   * @private

---

## _destroyAgent(agent)

```javascript
_destroyAgent(agent)
```

* 销毁代理
   * @private

---

## _startIdleTimer(agentId)

```javascript
_startIdleTimer(agentId)
```

* 启动空闲定时器
   * @private

---

## _clearIdleTimer(agentId)

```javascript
_clearIdleTimer(agentId)
```

* 清除空闲定时器
   * @private

---

## getStatus()

```javascript
getStatus()
```

* 获取池状态

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## async clear()

```javascript
async clear()
```

* 清空代理池

---

## async shrink()

```javascript
async shrink()
```

* 自动缩容（移除多余空闲代理）

---

## acquireByCapabilities(capabilities = [])

```javascript
acquireByCapabilities(capabilities = [])
```

* 按能力获取 Agent（v1.1.0 能力池化）
   * @param {string[]} capabilities - 所需能力列表
   * @returns {Object|null} Agent instance

---

## _warmResetAgent(agent)

```javascript
_warmResetAgent(agent)
```

* 温复用 Agent（重置状态但保留连接）
   * @param {Object} agent - Agent instance

---

## _checkMemoryPressure()

```javascript
_checkMemoryPressure()
```

* 内存感知缩池
   * @private

---

## startHealthCheck(intervalMs = 60000)

```javascript
startHealthCheck(intervalMs = 60000)
```

* 启动健康检查定时器
   * @param {number} [intervalMs=60000] - 检查间隔

---

## stopHealthCheck()

```javascript
stopHealthCheck()
```

* 停止健康检查

---

## _pingAgents()

```javascript
_pingAgents()
```

* 探活检查
   * @private

---

## _matchCapabilities(agent, requiredCapabilities)

```javascript
_matchCapabilities(agent, requiredCapabilities)
```

* 检查 agent 是否匹配所需能力
   * @private

---

## returnToPool(agentType, agent)

```javascript
returnToPool(agentType, agent)
```

* 将 agent 放回类型池
   * @param {string} agentType - Agent 类型
   * @param {Object} agent - Agent 实例

---

## getPoolStats()

```javascript
getPoolStats()
```

* 获取池状态（v1.1.0 能力池统计）
   * @returns {Object}

---

## _log(message, level = "info")

```javascript
_log(message, level = "info")
```

* 日志输出
   * @private

---

