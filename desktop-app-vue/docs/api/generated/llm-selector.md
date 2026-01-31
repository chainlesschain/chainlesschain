# llm-selector

**Source**: `src\main\llm\llm-selector.js`

**Generated**: 2026-01-27T06:44:03.848Z

---

## const LLM_CHARACTERISTICS =

```javascript
const LLM_CHARACTERISTICS =
```

* LLM 智能选择器
 * 根据任务特点、策略和可用性自动选择最优LLM服务

---

## const LLM_CHARACTERISTICS =

```javascript
const LLM_CHARACTERISTICS =
```

* LLM提供商特性配置

---

## const TASK_TYPES =

```javascript
const TASK_TYPES =
```

* 任务类型特征

---

## class LLMSelector

```javascript
class LLMSelector
```

* LLM选择器类

---

## loadConfig()

```javascript
loadConfig()
```

* 从数据库加载配置

---

## getProviderConfig(provider)

```javascript
getProviderConfig(provider)
```

* 获取LLM提供商配置

---

## isProviderConfigured(provider)

```javascript
isProviderConfigured(provider)
```

* 检查LLM是否配置完整

---

## calculateScore(provider, strategy, taskType = 'chat')

```javascript
calculateScore(provider, strategy, taskType = 'chat')
```

* 计算LLM得分
   * @param {string} provider - LLM提供商
   * @param {string} strategy - 选择策略
   * @param {string} taskType - 任务类型
   * @returns {number} 得分（0-100）

---

## selectBestLLM(options =

```javascript
selectBestLLM(options =
```

* 智能选择最优LLM
   * @param {Object} options - 选择选项
   * @returns {string} 选择的LLM提供商

---

## getFallbackList(currentProvider)

```javascript
getFallbackList(currentProvider)
```

* 获取备用LLM列表（按优先级）
   * @param {string} currentProvider - 当前提供商
   * @returns {Array} 备用提供商列表

---

## selectFallback(currentProvider, triedProviders = [])

```javascript
selectFallback(currentProvider, triedProviders = [])
```

* 选择下一个可用的LLM（fallback机制）
   * @param {string} currentProvider - 当前失败的提供商
   * @param {Array} triedProviders - 已尝试的提供商列表
   * @returns {string|null} 下一个提供商，如果没有则返回null

---

## updateHealth(provider, healthy)

```javascript
updateHealth(provider, healthy)
```

* 更新LLM健康状态
   * @param {string} provider - 提供商
   * @param {boolean} healthy - 是否健康

---

## needsHealthCheck(provider)

```javascript
needsHealthCheck(provider)
```

* 检查是否需要健康检查
   * @param {string} provider - 提供商
   * @returns {boolean}

---

## getAllCharacteristics()

```javascript
getAllCharacteristics()
```

* 获取所有LLM的特性信息
   * @returns {Object}

---

## getTaskTypes()

```javascript
getTaskTypes()
```

* 获取任务类型列表
   * @returns {Object}

---

## generateSelectionReport(taskType = 'chat')

```javascript
generateSelectionReport(taskType = 'chat')
```

* 生成选择报告
   * @param {string} taskType - 任务类型
   * @returns {Array} 排序后的LLM列表及得分

---

