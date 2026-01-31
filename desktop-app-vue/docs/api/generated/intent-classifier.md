# intent-classifier

**Source**: `src\main\ai-engine\intent-classifier.js`

**Generated**: 2026-01-27T06:44:03.879Z

---

## class IntentClassifier

```javascript
class IntentClassifier
```

* 意图识别器
 * 支持6种意图: CREATE_FILE, EDIT_FILE, QUERY_INFO, ANALYZE_DATA, EXPORT_FILE, DEPLOY_PROJECT
 * 使用Few-shot Learning + 关键词规则

---

## async classify(userInput, context =

```javascript
async classify(userInput, context =
```

* 分类用户意图
   * @param {string} userInput - 用户输入
   * @param {Object} context - 上下文信息
   * @returns {Promise<Object>} 意图分类结果

---

## classifyByKeywords(text)

```javascript
classifyByKeywords(text)
```

* 基于关键词分类
   * @private

---

## adjustByContext(intent, text, context)

```javascript
adjustByContext(intent, text, context)
```

* 基于上下文调整意图
   * @private

---

## extractEntities(text, intent)

```javascript
extractEntities(text, intent)
```

* 提取实体信息
   * @private

---

## extractFileType(text)

```javascript
extractFileType(text)
```

* 提取文件类型
   * @private

---

## extractColors(text)

```javascript
extractColors(text)
```

* 提取颜色
   * @private

---

## extractNumbers(text)

```javascript
extractNumbers(text)
```

* 提取数字
   * @private

---

## extractFileName(text)

```javascript
extractFileName(text)
```

* 提取文件名
   * @private

---

## extractTargets(text)

```javascript
extractTargets(text)
```

* 提取目标对象
   * @private

---

## extractActions(text)

```javascript
extractActions(text)
```

* 提取动作
   * @private

---

## mentionsFileType(text)

```javascript
mentionsFileType(text)
```

* 检查是否提到文件类型
   * @private

---

## calculateConfidence(text, intent)

```javascript
calculateConfidence(text, intent)
```

* 计算置信度
   * @private

---

