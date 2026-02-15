# cowork-orchestrator

**Source**: `src/main/ai-engine/multi-agent/cowork-orchestrator.js`

**Generated**: 2026-02-15T07:37:13.874Z

---

## const

```javascript
const
```

* CoworkOrchestrator - 集成 Cowork 的增强型代理协调器
 *
 * 扩展 AgentOrchestrator，集成 TeammateTool、FileSandbox 和 Skills 系统。
 * 基于 Anthropic 的三种多代理适用场景进行智能决策。
 *
 * @module ai-engine/multi-agent/cowork-orchestrator

---

## class CoworkOrchestrator extends AgentOrchestrator

```javascript
class CoworkOrchestrator extends AgentOrchestrator
```

* Cowork 集成的代理协调器

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* 设置数据库实例
   * @param {Object} db - 数据库实例

---

## shouldUseMultiAgent(task, context =

```javascript
shouldUseMultiAgent(task, context =
```

* 判断是否应该使用多代理模式
   * @param {Object} task - 任务对象
   * @param {Object} context - 上下文信息
   * @returns {Object} { useMultiAgent: boolean, reason: string, strategy: string }

---

## hasContextPollution(task, context)

```javascript
hasContextPollution(task, context)
```

* 场景 1: 检测上下文污染
   * @private

---

## canParallelize(task, context)

```javascript
canParallelize(task, context)
```

* 场景 2: 检测可并行化
   * @private

---

## needsSpecialization(task, context)

```javascript
needsSpecialization(task, context)
```

* 场景 3: 检测需要专业化
   * @private

---

## async executeWithCowork(task, context =

```javascript
async executeWithCowork(task, context =
```

* 使用 Cowork 执行任务
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果

---

## async executeDivideContext(task, context)

```javascript
async executeDivideContext(task, context)
```

* 策略 1: 分散上下文执行
   * @private

---

## async executeParallel(task, context)

```javascript
async executeParallel(task, context)
```

* 策略 2: 并行执行
   * @private

---

## async executeSpecialized(task, context)

```javascript
async executeSpecialized(task, context)
```

* 策略 3: 专业化代理执行
   * @private

---

## _divideContext(context)

```javascript
_divideContext(context)
```

* 分散上下文
   * @private

---

## _splitTask(task)

```javascript
_splitTask(task)
```

* 拆分任务
   * @private

---

## _log(message, level = "info")

```javascript
_log(message, level = "info")
```

* 日志输出
   * @private

---

## getCoworkStats()

```javascript
getCoworkStats()
```

* 获取 Cowork 统计信息
   * @returns {Object}

---

## async shouldUseSingleAgent(task, context =

```javascript
async shouldUseSingleAgent(task, context =
```

* 判断是否应使用单代理（与 shouldUseMultiAgent 相反）
   * @param {object} task - 任务对象
   * @param {object} context - 上下文
   * @returns {Promise<object>} 决策结果

---

