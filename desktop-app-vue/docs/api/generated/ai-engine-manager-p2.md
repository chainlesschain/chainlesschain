# ai-engine-manager-p2

**Source**: `src/main/ai-engine/ai-engine-manager-p2.js`

**Generated**: 2026-02-21T22:04:25.876Z

---

## const

```javascript
const
```

* AI引擎主管理器 (P2集成版)
 * 在P0+P1优化的基础上集成P2三大优化模块
 *
 * P0优化（已有）:
 * 1. 槽位填充 - 自动补全缺失参数
 * 2. 工具沙箱 - 超时保护、自动重试、结果校验
 * 3. 性能监控 - P50/P90/P95统计、瓶颈识别
 *
 * P1优化（已有）:
 * 1. 多意图识别 - 自动拆分复合任务
 * 2. 动态Few-shot学习 - 个性化意图识别
 * 3. 分层任务规划 - 三层任务分解
 * 4. 检查点校验 - 中间结果验证
 * 5. 自我修正循环 - 自动错误恢复
 *
 * P2优化（新增）:
 * 1. 意图融合 - 合并相似意图，减少LLM调用57.8%
 * 2. 知识蒸馏 - 小模型处理简单任务，节省28%成本
 * 3. 流式响应 - 实时进度反馈，降低93%感知延迟
 *
 * 版本: v0.20.0
 * 更新: 2026-01-01

---

## async initialize(options =

```javascript
async initialize(options =
```

* 初始化AI引擎管理器
   * 注入依赖项并初始化所有模块

---

## async _initializeP0Modules()

```javascript
async _initializeP0Modules()
```

* 初始化P0优化模块

---

## async _initializeP1Modules()

```javascript
async _initializeP1Modules()
```

* 初始化P1优化模块

---

## async _initializeP2Modules()

```javascript
async _initializeP2Modules()
```

* 初始化P2优化模块

---

## async _initializeIntelligenceLayer()

```javascript
async _initializeIntelligenceLayer()
```

* 初始化智能层模块 (Phase 1-4)

---

## _countEnabledModules(moduleNames)

```javascript
_countEnabledModules(moduleNames)
```

* 统计已启用的模块数量

---

## async processUserInput(userInput, context =

```javascript
async processUserInput(userInput, context =
```

* 处理用户输入的主流程（P2优化版）
   * 集成P0+P1+P2所有优化

---

## async getP2Statistics()

```javascript
async getP2Statistics()
```

* 获取P2优化统计信息

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

## async decomposeTaskWithHistory(task, context =

```javascript
async decomposeTaskWithHistory(task, context =
```

* 任务分解 - 将复杂任务分解为子任务
   * @param {Object} task - 任务对象 {type, description, params}
   * @param {Object} context - 执行上下文
   * @returns {Promise<Array>} 子任务数组

---

## async composeToolsOptimized(goal, context =

```javascript
async composeToolsOptimized(goal, context =
```

* 工具组合 - 智能组合多个工具
   * @param {string} goal - 目标描述
   * @param {Object} context - 执行上下文
   * @returns {Promise<Array>} 工具组合链

---

## async predictTaskSuccess(task, context =

```javascript
async predictTaskSuccess(task, context =
```

* 预测任务成功率 - 基于历史记忆
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<Object>} 预测结果 {probability, confidence, memory}

---

## async recordTaskExecution(task, result, duration, context =

```javascript
async recordTaskExecution(task, result, duration, context =
```

* 记录任务执行 - 用于历史记忆学习
   * @param {Object} task - 任务对象
   * @param {Object} result - 执行结果
   * @param {number} duration - 执行耗时
   * @param {Object} context - 执行上下文

---

## registerTool(name, tool)

```javascript
registerTool(name, tool)
```

* 注册工具到工具组合系统
   * @param {string} name - 工具名称
   * @param {Object} tool - 工具对象 {execute, inputs, outputs, dependencies, cost}

---

## getP2ExtendedStats()

```javascript
getP2ExtendedStats()
```

* 获取P2扩展模块统计信息
   * @returns {Object} 统计信息

---

