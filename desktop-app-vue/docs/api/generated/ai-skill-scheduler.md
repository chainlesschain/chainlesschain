# ai-skill-scheduler

**Source**: `src/main/skill-tool-system/ai-skill-scheduler.js`

**Generated**: 2026-02-21T20:04:16.208Z

---

## const

```javascript
const
```

* AI智能调度器
 * 根据用户意图自动选择和调度技能

---

## async smartSchedule(userInput, context =

```javascript
async smartSchedule(userInput, context =
```

* 根据用户输入智能调度技能
   * @param {string} userInput - 用户输入的自然语言
   * @param {object} context - 上下文信息

---

## async analyzeIntent(userInput, context)

```javascript
async analyzeIntent(userInput, context)
```

* 分析用户意图

---

## analyzeByKeywords(userInput)

```javascript
analyzeByKeywords(userInput)
```

* 基于关键词的意图分析

---

## async analyzeByLLM(userInput, context)

```javascript
async analyzeByLLM(userInput, context)
```

* 基于LLM的意图分析

---

## extractEntities(userInput)

```javascript
extractEntities(userInput)
```

* 提取实体

---

## mergeIntents(keywordIntent, llmIntent)

```javascript
mergeIntents(keywordIntent, llmIntent)
```

* 合并意图（关键词 + LLM）

---

## async recommendSkills(intent, context)

```javascript
async recommendSkills(intent, context)
```

* 推荐技能

---

## calculateSkillScore(skill, intent, context)

```javascript
calculateSkillScore(skill, intent, context)
```

* 计算技能评分

---

## selectBestSkill(recommendations, intent, context)

```javascript
selectBestSkill(recommendations, intent, context)
```

* 选择最佳技能

---

## async generateParams(skill, intent, context)

```javascript
async generateParams(skill, intent, context)
```

* 生成执行参数

---

## async generateParamsByLLM(skill, intent, context)

```javascript
async generateParamsByLLM(skill, intent, context)
```

* 使用LLM生成参数

---

## learnFromExecution(userInput, skill, result)

```javascript
learnFromExecution(userInput, skill, result)
```

* 从执行结果学习

---

## getUserPreference(skillId)

```javascript
getUserPreference(skillId)
```

* 获取用户偏好

---

## buildIntentMapping()

```javascript
buildIntentMapping()
```

* 构建意图-技能映射

---

## getSkillByIntentMapping(intent)

```javascript
getSkillByIntentMapping(intent)
```

* 获取意图映射的技能

---

## async processBatch(userInputs, context =

```javascript
async processBatch(userInputs, context =
```

* 批量处理用户请求

---

## getRecommendationStats()

```javascript
getRecommendationStats()
```

* 获取推荐统计

---

