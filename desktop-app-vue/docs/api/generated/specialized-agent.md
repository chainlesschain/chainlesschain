# specialized-agent

**Source**: `src/main/ai-engine/multi-agent/specialized-agent.js`

**Generated**: 2026-02-21T22:04:25.879Z

---

## const

```javascript
const
```

* 专用 Agent 基类
 *
 * 所有专用 Agent 的基类，定义了 Agent 的基本接口和行为。
 *
 * @see https://github.com/FoundationAgents/OpenManus

---

## class SpecializedAgent extends EventEmitter

```javascript
class SpecializedAgent extends EventEmitter
```

* 专用 Agent 基类

---

## constructor(agentId, options =

```javascript
constructor(agentId, options =
```

* @param {string} agentId - Agent 唯一标识
   * @param {Object} options - 配置选项

---

## setLLMManager(llmManager)

```javascript
setLLMManager(llmManager)
```

* 设置 LLM 管理器
   * @param {Object} llmManager - LLM 管理器实例

---

## setFunctionCaller(functionCaller)

```javascript
setFunctionCaller(functionCaller)
```

* 设置工具调用器
   * @param {Object} functionCaller - FunctionCaller 实例

---

## canHandle(task)

```javascript
canHandle(task)
```

* 评估处理任务的能力
   * @param {Object} task - 任务对象
   * @returns {number} 0-1 的得分，0 表示无法处理

---

## async execute(task)

```javascript
async execute(task)
```

* 执行任务（子类必须实现）
   * @param {Object} task - 任务对象
   * @returns {Promise<any>} 执行结果

---

## async executeWithRetry(task)

```javascript
async executeWithRetry(task)
```

* 带重试的执行
   * @param {Object} task - 任务对象
   * @returns {Promise<any>} 执行结果

---

## async receiveMessage(message, metadata =

```javascript
async receiveMessage(message, metadata =
```

* 接收来自其他 Agent 的消息
   * @param {Object} message - 消息内容
   * @param {Object} metadata - 消息元数据
   * @returns {Promise<any>} 响应

---

## async callLLM(options)

```javascript
async callLLM(options)
```

* 调用 LLM
   * @param {Object} options - LLM 调用选项
   * @returns {Promise<string>} LLM 响应

---

## async callTool(toolName, params, context =

```javascript
async callTool(toolName, params, context =
```

* 调用工具
   * @param {string} toolName - 工具名称
   * @param {Object} params - 参数
   * @param {Object} context - 上下文
   * @returns {Promise<any>} 工具执行结果

---

## _delay(ms)

```javascript
_delay(ms)
```

* 延迟
   * @private

---

## getState()

```javascript
getState()
```

* 获取 Agent 状态
   * @returns {Object}

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object}

---

## getInfo()

```javascript
getInfo()
```

* 获取 Agent 描述信息
   * @returns {Object}

---

## destroy()

```javascript
destroy()
```

* 销毁 Agent

---

