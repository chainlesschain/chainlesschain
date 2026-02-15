# checkpoint-validator

**Source**: `src/main/ai-engine/checkpoint-validator.js`

**Generated**: 2026-02-15T08:42:37.276Z

---

## class CheckpointValidator

```javascript
class CheckpointValidator
```

* 检查点校验器
 *
 * 功能:
 * 1. 在关键步骤后进行结果校验
 * 2. 检查结果完整性
 * 3. 验证预期输出
 * 4. 检查依赖数据（为下一步做准备）
 * 5. LLM质量评估（可选）
 *
 * 优势:
 * - 早期发现错误，节省计算资源
 * - 关键步骤人工确认，提升可靠性
 * - LLM质量评估，适用于生成类任务
 *
 * 版本: v0.17.0-P1
 * 更新: 2026-01-01

---

## async validateCheckpoint(stepIndex, result, plan, options =

```javascript
async validateCheckpoint(stepIndex, result, plan, options =
```

* 验证检查点
   * @param {number} stepIndex - 步骤索引
   * @param {Object} result - 步骤执行结果
   * @param {Object} plan - 完整执行计划
   * @param {Object} options - 校验选项
   * @returns {Object} 校验结果

---

## checkCompleteness(result, step)

```javascript
checkCompleteness(result, step)
```

* 检查结果完整性
   * @param {Object} result - 结果
   * @param {Object} step - 步骤配置
   * @returns {Object} 校验结果

---

## checkExpectedOutputs(result, step)

```javascript
checkExpectedOutputs(result, step)
```

* 检查预期输出
   * @param {Object} result - 结果
   * @param {Object} step - 步骤配置
   * @returns {Object} 校验结果

---

## checkNextStepDependencies(stepIndex, result, plan)

```javascript
checkNextStepDependencies(stepIndex, result, plan)
```

* 检查下一步依赖
   * @param {number} stepIndex - 当前步骤索引
   * @param {Object} result - 当前结果
   * @param {Object} plan - 完整计划
   * @returns {Object|null} 校验结果

---

## extractRequiredInputs(step)

```javascript
extractRequiredInputs(step)
```

* 提取步骤需要的输入参数
   * @param {Object} step - 步骤配置
   * @returns {Array} 需要的输入参数列表

---

## checkDataTypes(result, step)

```javascript
checkDataTypes(result, step)
```

* 检查数据类型
   * @param {Object} result - 结果
   * @param {Object} step - 步骤配置
   * @returns {Object} 校验结果

---

## isQualityCheckRequired(step)

```javascript
isQualityCheckRequired(step)
```

* 判断是否需要LLM质量检查
   * @param {Object} step - 步骤配置
   * @returns {boolean}

---

## async llmQualityCheck(result, step)

```javascript
async llmQualityCheck(result, step)
```

* LLM质量检查
   * @param {Object} result - 结果
   * @param {Object} step - 步骤配置
   * @returns {Object} 校验结果

---

## formatResultForDisplay(result)

```javascript
formatResultForDisplay(result)
```

* 格式化结果用于展示
   * @param {Object} result - 结果对象
   * @returns {string} 格式化后的字符串

---

## getRecommendation(validations, allPassed)

```javascript
getRecommendation(validations, allPassed)
```

* 获取推荐动作
   * @param {Array} validations - 所有校验结果
   * @param {boolean} allPassed - 是否全部通过
   * @returns {string} 推荐动作

---

## async saveValidationHistory(summary)

```javascript
async saveValidationHistory(summary)
```

* 保存校验历史
   * @param {Object} summary - 校验摘要
   * @returns {void}

---

## async getValidationStats(days = 7)

```javascript
async getValidationStats(days = 7)
```

* 获取校验统计
   * @param {number} days - 统计天数
   * @returns {Object} 统计信息

---

## parseJSON(text)

```javascript
parseJSON(text)
```

* 解析JSON
   * @param {string} text - JSON字符串
   * @returns {Object|null} 解析结果

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

