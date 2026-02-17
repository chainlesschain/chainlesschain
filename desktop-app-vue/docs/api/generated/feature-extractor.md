# feature-extractor

**Source**: `src/main/ai-engine/feature-extractor.js`

**Generated**: 2026-02-17T10:13:18.279Z

---

## class FeatureExtractor

```javascript
class FeatureExtractor
```

* FeatureExtractor - 特征工程模块
 * P2智能层Phase 3 - ML工具匹配器
 *
 * 功能:
 * - 文本特征提取 (TF-IDF, 关键词)
 * - 上下文特征提取 (项目类型, 文件类型, 任务阶段)
 * - 用户特征提取 (技能水平, 偏好, 历史成功率)
 * - 特征向量化
 *
 * Version: v0.23.0
 * Date: 2026-01-02

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* 设置数据库连接

---

## async extractFeatures(task, userId)

```javascript
async extractFeatures(task, userId)
```

* 提取所有特征
   * @param {Object} task - 任务对象
   * @param {string} userId - 用户ID
   * @returns {Object} 特征向量

---

## extractTextFeatures(text)

```javascript
extractTextFeatures(text)
```

* 提取文本特征
   * @param {string} text - 任务描述文本
   * @returns {Object} 文本特征

---

## extractContextFeatures(task)

```javascript
extractContextFeatures(task)
```

* 提取上下文特征
   * @param {Object} task - 任务对象
   * @returns {Object} 上下文特征

---

## async extractUserFeatures(userId)

```javascript
async extractUserFeatures(userId)
```

* 提取用户特征
   * @param {string} userId - 用户ID
   * @returns {Object} 用户特征

---

## preprocessText(text)

```javascript
preprocessText(text)
```

* 文本预处理

---

## tokenize(text)

```javascript
tokenize(text)
```

* 分词 (简单实现)

---

## extractKeywords(tokens)

```javascript
extractKeywords(tokens)
```

* 提取关键词

---

## calculateTFIDF(tokens)

```javascript
calculateTFIDF(tokens)
```

* 计算TF-IDF (简化版本)

---

## detectCategory(tokens)

```javascript
detectCategory(tokens)
```

* 检测任务类别

---

## calculateComplexity(tokens)

```javascript
calculateComplexity(tokens)
```

* 计算文本复杂度

---

## detectFileType(filePath)

```javascript
detectFileType(filePath)
```

* 检测文件类型

---

## detectLanguage(filePath)

```javascript
detectLanguage(filePath)
```

* 检测编程语言

---

## calculateExperience(totalTasks)

```javascript
calculateExperience(totalTasks)
```

* 计算用户经验等级

---

## getDefaultUserFeatures()

```javascript
getDefaultUserFeatures()
```

* 获取默认用户特征

---

## vectorize(features)

```javascript
vectorize(features)
```

* 特征向量化 (用于ML模型)
   * @param {Object} features - 特征对象
   * @returns {Array} 特征向量

---

## complexityToNumber(complexity)

```javascript
complexityToNumber(complexity)
```

* 辅助函数: 复杂度转数值

---

## categoryToNumber(category)

```javascript
categoryToNumber(category)
```

* 辅助函数: 类别转数值

---

## fileTypeToNumber(fileType)

```javascript
fileTypeToNumber(fileType)
```

* 辅助函数: 文件类型转数值

---

## skillLevelToNumber(skillLevel)

```javascript
skillLevelToNumber(skillLevel)
```

* 辅助函数: 技能水平转数值

---

## experienceToNumber(experience)

```javascript
experienceToNumber(experience)
```

* 辅助函数: 经验等级转数值

---

## async extractBatchFeatures(tasks, userId)

```javascript
async extractBatchFeatures(tasks, userId)
```

* 批量提取特征
   * @param {Array} tasks - 任务数组
   * @param {string} userId - 用户ID
   * @returns {Array} 特征数组

---

