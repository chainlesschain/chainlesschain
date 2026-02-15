# volcengine-models

**Source**: `src/main/llm/volcengine-models.js`

**Generated**: 2026-02-15T10:10:53.409Z

---

## const ModelCapabilities =

```javascript
const ModelCapabilities =
```

* 火山引擎豆包模型列表和智能选择器
 *
 * 基于火山引擎官方文档整理
 * 文档: https://www.volcengine.com/docs/82379/1330310
 * 更新时间: 2026-01-04

---

## const ModelCapabilities =

```javascript
const ModelCapabilities =
```

* 模型能力枚举

---

## const TaskTypes =

```javascript
const TaskTypes =
```

* 任务类型枚举

---

## const VOLCENGINE_MODELS =

```javascript
const VOLCENGINE_MODELS =
```

* 火山引擎豆包完整模型列表

---

## class VolcengineModelSelector

```javascript
class VolcengineModelSelector
```

* 智能模型选择器

---

## selectModel(taskType, options =

```javascript
selectModel(taskType, options =
```

* 根据任务类型智能选择模型
   * @param {string} taskType - 任务类型
   * @param {Object} options - 选项
   * @param {boolean} options.preferCost - 优先考虑成本
   * @param {boolean} options.preferQuality - 优先考虑质量
   * @param {boolean} options.preferSpeed - 优先考虑速度
   * @param {number} options.contextLength - 所需上下文长度
   * @param {Array<string>} options.requiredCapabilities - 必需的能力
   * @returns {Object} 推荐的模型

---

## selectByScenario(scenario)

```javascript
selectByScenario(scenario)
```

* 根据具体场景智能选择
   * @param {Object} scenario - 场景描述
   * @returns {Object} 推荐的模型

---

## getModelDetails(modelId)

```javascript
getModelDetails(modelId)
```

* 获取模型详情
   * @param {string} modelId - 模型ID
   * @returns {Object|null} 模型详情

---

## listModels(filters =

```javascript
listModels(filters =
```

* 列出所有模型
   * @param {Object} filters - 过滤条件
   * @returns {Array} 模型列表

---

## estimateCost(modelId, inputTokens = 0, outputTokens = 0, imageCount = 0)

```javascript
estimateCost(modelId, inputTokens = 0, outputTokens = 0, imageCount = 0)
```

* 估算成本
   * @param {string} modelId - 模型ID
   * @param {number} inputTokens - 输入tokens
   * @param {number} outputTokens - 输出tokens
   * @param {number} imageCount - 图片数量
   * @returns {number} 预估成本（人民币）

---

