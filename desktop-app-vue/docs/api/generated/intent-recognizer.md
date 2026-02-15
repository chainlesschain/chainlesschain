# intent-recognizer

**Source**: `src/main/ai-engine/intent-recognizer.js`

**Generated**: 2026-02-15T07:37:13.866Z

---

## async function recognizeProjectIntent(userInput, llmManager)

```javascript
async function recognizeProjectIntent(userInput, llmManager)
```

* 智能意图识别器（增强版）
 * 使用 LLM 进行准确的用户意图识别
 * 支持更细粒度的文件类型识别：Word、Excel、PDF、图片、视频、Web等

---

## async function recognizeProjectIntent(userInput, llmManager)

```javascript
async function recognizeProjectIntent(userInput, llmManager)
```

* 识别用户输入的项目创建意图
 * @param {string} userInput - 用户输入的需求描述
 * @param {Object} llmManager - LLM 管理器实例
 * @returns {Promise<Object>} 意图识别结果

---

## function fallbackRuleBasedRecognition(userInput)

```javascript
function fallbackRuleBasedRecognition(userInput)
```

* 降级方案：基于规则的简单意图识别（增强版）
 * @param {string} userInput - 用户输入
 * @returns {Object} 意图识别结果

---

## function inferOutputFormat(subType)

```javascript
function inferOutputFormat(subType)
```

* 根据子类型推断输出格式
 * @param {string} subType - 子类型
 * @returns {string} 输出格式

---

## function inferToolEngine(subType)

```javascript
function inferToolEngine(subType)
```

* 根据子类型推断工具引擎
 * @param {string} subType - 子类型
 * @returns {string} 工具引擎

---

