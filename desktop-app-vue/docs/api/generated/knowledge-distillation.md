# knowledge-distillation

**Source**: `src\main\ai-engine\knowledge-distillation.js`

**Generated**: 2026-01-27T06:44:03.878Z

---

## const ComplexityLevel =

```javascript
const ComplexityLevel =
```

* 知识蒸馏模块 (Knowledge Distillation)
 *
 * 功能:
 * 1. 复杂度评估 - 判断任务复杂度
 * 2. 路由决策 - 选择小模型/大模型
 * 3. 质量检查 - 验证结果质量
 * 4. 回退策略 - 低质量结果回退到大模型
 * 5. 数据库日志 - 记录蒸馏决策
 *
 * @module knowledge-distillation

---

## const ComplexityLevel =

```javascript
const ComplexityLevel =
```

* 复杂度级别

---

## const ModelType =

```javascript
const ModelType =
```

* 模型类型

---

## class KnowledgeDistillation

```javascript
class KnowledgeDistillation
```

* 知识蒸馏引擎

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* 设置数据库连接

---

## setLLM(llmManager)

```javascript
setLLM(llmManager)
```

* 设置LLM管理器

---

## evaluateComplexity(task)

```javascript
evaluateComplexity(task)
```

* 评估任务复杂度
   *
   * @param {Object} task - 任务对象
   * @param {Array} task.intents - 意图列表
   * @param {Object} task.context - 上下文
   * @returns {Object} { level, score, features }

---

## _extractComplexityFeatures(task)

```javascript
_extractComplexityFeatures(task)
```

* 提取复杂度特征
   *
   * @private
   * @param {Object} task
   * @returns {Object} 特征对象

---

## _evaluateTaskTypeComplexity(intents)

```javascript
_evaluateTaskTypeComplexity(intents)
```

* 评估任务类型复杂度
   *
   * @private
   * @param {Array} intents
   * @returns {number} 0-1之间的分数

---

## _calculateComplexityScore(features)

```javascript
_calculateComplexityScore(features)
```

* 计算复杂度分数
   *
   * @private
   * @param {Object} features
   * @returns {number} 0-1之间的复杂度分数

---

## routeToModel(complexity)

```javascript
routeToModel(complexity)
```

* 路由决策 - 选择模型
   *
   * @param {Object} complexity - 复杂度评估结果
   * @returns {Object} { modelType, modelName, reason }

---

## checkQuality(result, task)

```javascript
checkQuality(result, task)
```

* 检查结果质量
   *
   * @param {Object} result - LLM返回结果
   * @param {Object} task - 原始任务
   * @returns {Object} { isQualified, score, issues }

---

## async executeWithDistillation(task, context =

```javascript
async executeWithDistillation(task, context =
```

* 执行任务(带知识蒸馏)
   *
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Object} 执行结果

---

## async _executeTask(task, modelName, context)

```javascript
async _executeTask(task, modelName, context)
```

* 执行任务(内部方法)
   *
   * @private
   * @param {Object} task
   * @param {string} modelName
   * @param {Object} context
   * @returns {Object} 执行结果

---

## async _recordDistillation(record)

```javascript
async _recordDistillation(record)
```

* 记录蒸馏决策到数据库
   *
   * @private
   * @param {Object} record

---

## async getDistillationStats(options =

```javascript
async getDistillationStats(options =
```

* 获取蒸馏统计
   *
   * @param {Object} options - 过滤选项
   * @returns {Object} 统计信息

---

## async learnFromHistory()

```javascript
async learnFromHistory()
```

* 学习和优化复杂度权重(基于历史数据)
   *
   * @returns {Object} 优化结果

---

## getPerformanceStats()

```javascript
getPerformanceStats()
```

* 获取性能统计

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

