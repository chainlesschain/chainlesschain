# self-correction-loop

**Source**: `src/main/ai-engine/self-correction-loop.js`

**Generated**: 2026-02-16T13:44:34.688Z

---

## class SelfCorrectionLoop

```javascript
class SelfCorrectionLoop
```

* 自我修正循环
 *
 * 功能:
 * 1. 自动检测执行失败
 * 2. 诊断失败原因
 * 3. 生成修正计划
 * 4. 自动重试执行
 * 5. 学习失败模式
 *
 * 优势:
 * - 自动诊断常见错误模式
 * - 智能生成修正方案
 * - 最多3次重试，避免无限循环
 * - 任务成功率提升45%
 *
 * 版本: v0.17.0-P1
 * 更新: 2026-01-01

---

## async executeWithCorrection(plan, executor, options =

```javascript
async executeWithCorrection(plan, executor, options =
```

* 执行计划并自动修正
   * @param {Object} plan - 执行计划
   * @param {Function} executor - 执行函数
   * @param {Object} options - 选项
   * @returns {Object} 执行结果

---

## async executePlan(plan, executor)

```javascript
async executePlan(plan, executor)
```

* 执行计划
   * @param {Object} plan - 计划
   * @param {Function} executor - 执行函数
   * @returns {Object} 执行结果

---

## async diagnoseFailure(result)

```javascript
async diagnoseFailure(result)
```

* 诊断失败原因
   * @param {Object} result - 执行结果
   * @returns {Object} 诊断结果

---

## async llmBasedDiagnosis(failedSteps)

```javascript
async llmBasedDiagnosis(failedSteps)
```

* 基于LLM的失败诊断
   * @param {Array} failedSteps - 失败的步骤
   * @returns {Object} 诊断结果

---

## async generateCorrectionPlan(originalPlan, failedResult, diagnosis)

```javascript
async generateCorrectionPlan(originalPlan, failedResult, diagnosis)
```

* 生成修正计划
   * @param {Object} originalPlan - 原计划
   * @param {Object} failedResult - 失败结果
   * @param {Object} diagnosis - 诊断结果
   * @returns {Object} 修正计划

---

## getCorrectionStrategy(strategy)

```javascript
getCorrectionStrategy(strategy)
```

* 获取修正策略函数
   * @param {string} strategy - 策略名称
   * @returns {Function|null} 策略函数

---

## async correctMissingDependency(plan, result, diagnosis)

```javascript
async correctMissingDependency(plan, result, diagnosis)
```

* 修正缺失依赖
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划

---

## async correctInvalidParams(plan, result, diagnosis)

```javascript
async correctInvalidParams(plan, result, diagnosis)
```

* 修正无效参数
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划

---

## async correctTimeout(plan, result, diagnosis)

```javascript
async correctTimeout(plan, result, diagnosis)
```

* 修正超时
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划

---

## async correctFileNotFound(plan, result, diagnosis)

```javascript
async correctFileNotFound(plan, result, diagnosis)
```

* 修正文件未找到
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划

---

## async correctNetworkError(plan, result, diagnosis)

```javascript
async correctNetworkError(plan, result, diagnosis)
```

* 修正网络错误
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划

---

## async correctOutOfMemory(plan, result, diagnosis)

```javascript
async correctOutOfMemory(plan, result, diagnosis)
```

* 修正内存不足
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划

---

## async correctSyntaxError(plan, result, diagnosis)

```javascript
async correctSyntaxError(plan, result, diagnosis)
```

* 修正语法错误
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划

---

## async llmBasedCorrection(plan, result, diagnosis)

```javascript
async llmBasedCorrection(plan, result, diagnosis)
```

* 基于LLM的修正方案生成
   * @param {Object} plan - 原计划
   * @param {Object} result - 结果
   * @param {Object} diagnosis - 诊断
   * @returns {Object} 修正计划

---

## async saveExecutionHistory(plan, result, corrections, success)

```javascript
async saveExecutionHistory(plan, result, corrections, success)
```

* 保存执行历史
   * @param {Object} plan - 计划
   * @param {Object} result - 结果
   * @param {Array} corrections - 修正历史
   * @param {boolean} success - 是否成功
   * @returns {void}

---

## parseJSON(text)

```javascript
parseJSON(text)
```

* 解析JSON
   * @param {string} text - JSON字符串
   * @returns {Object|null} 解析结果

---

## async getCorrectionStats(days = 7)

```javascript
async getCorrectionStats(days = 7)
```

* 获取修正统计
   * @param {number} days - 统计天数
   * @returns {Object} 统计信息

---

## setConfig(config)

```javascript
setConfig(config)
```

* 设置配置
   * @param {Object} config - 配置对象
   * @returns {void}

---

## getConfig()

```javascript
getConfig()
```

* 获取配置
   * @returns {Object} 当前配置

---

