# voice-training

**Source**: `src/main/speech/voice-training.js`

**Generated**: 2026-02-21T22:04:25.775Z

---

## const

```javascript
const
```

* 语音训练与个性化系统
 *
 * 提供用户语音配置文件、口音适应、自定义词汇学习和个性化命令建议

---

## class VoiceTraining extends EventEmitter

```javascript
class VoiceTraining extends EventEmitter
```

* 语音训练类

---

## async initialize(userId)

```javascript
async initialize(userId)
```

* 初始化用户配置文件

---

## async loadUserProfile(userId)

```javascript
async loadUserProfile(userId)
```

* 加载用户配置文件

---

## createDefaultProfile(userId)

```javascript
createDefaultProfile(userId)
```

* 创建默认配置文件

---

## async saveUserProfile()

```javascript
async saveUserProfile()
```

* 保存用户配置文件

---

## async recordTranscription(result)

```javascript
async recordTranscription(result)
```

* 记录转录结果

---

## async learnVocabulary(text, language)

```javascript
async learnVocabulary(text, language)
```

* 学习词汇

---

## tokenize(text, language)

```javascript
tokenize(text, language)
```

* 分词

---

## pruneVocabulary()

```javascript
pruneVocabulary()
```

* 修剪词汇表

---

## async detectAccentPatterns(result)

```javascript
async detectAccentPatterns(result)
```

* 检测口音模式

---

## updateAccentInfo()

```javascript
updateAccentInfo()
```

* 更新口音信息

---

## async recordCommandUsage(commandName, success = true)

```javascript
async recordCommandUsage(commandName, success = true)
```

* 记录命令使用

---

## async recordCorrection(original, corrected, context =

```javascript
async recordCorrection(original, corrected, context =
```

* 记录纠正

---

## async learnCorrectionPattern(original, corrected)

```javascript
async learnCorrectionPattern(original, corrected)
```

* 学习纠正模式

---

## extractCorrectionPattern(original, corrected)

```javascript
extractCorrectionPattern(original, corrected)
```

* 提取纠正模式

---

## getCommandSuggestions(limit = 5)

```javascript
getCommandSuggestions(limit = 5)
```

* 获取命令建议

---

## calculateCommandScore(stats)

```javascript
calculateCommandScore(stats)
```

* 计算命令分数

---

## getCustomVocabulary(minFrequency = 2)

```javascript
getCustomVocabulary(minFrequency = 2)
```

* 获取自定义词汇

---

## async addCustomWord(word, frequency = 1)

```javascript
async addCustomWord(word, frequency = 1)
```

* 添加自定义词汇

---

## async removeCustomWord(word)

```javascript
async removeCustomWord(word)
```

* 删除自定义词汇

---

## getLearningStats()

```javascript
getLearningStats()
```

* 获取学习统计

---

## getImprovementSuggestions()

```javascript
getImprovementSuggestions()
```

* 获取改进建议

---

## async exportUserData()

```javascript
async exportUserData()
```

* 导出用户数据

---

## async importUserData(data)

```javascript
async importUserData(data)
```

* 导入用户数据

---

## async resetUserData()

```javascript
async resetUserData()
```

* 重置用户数据

---

## async getStats()

```javascript
async getStats()
```

* 获取统计信息

---

## async exportProfile()

```javascript
async exportProfile()
```

* 导出配置文件

---

## async importProfile(filePath)

```javascript
async importProfile(filePath)
```

* 导入配置文件

---

## async resetProfile()

```javascript
async resetProfile()
```

* 重置配置文件

---

