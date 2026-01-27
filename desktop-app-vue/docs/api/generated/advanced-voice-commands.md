# advanced-voice-commands

**Source**: `src\main\speech\advanced-voice-commands.js`

**Generated**: 2026-01-27T06:44:03.808Z

---

## const

```javascript
const
```

* 高级语音命令系统
 *
 * 支持复杂的语音命令、上下文感知、参数提取和智能执行

---

## class AdvancedVoiceCommands extends EventEmitter

```javascript
class AdvancedVoiceCommands extends EventEmitter
```

* 高级语音命令类

---

## registerAdvancedCommands()

```javascript
registerAdvancedCommands()
```

* 注册高级命令

---

## registerCommand(command)

```javascript
registerCommand(command)
```

* 注册命令

---

## recognize(text, context =

```javascript
recognize(text, context =
```

* 识别命令

---

## isCommandChain(text)

```javascript
isCommandChain(text)
```

* 检查是否为命令链

---

## parseCommandChain(text, context)

```javascript
parseCommandChain(text, context)
```

* 解析命令链

---

## findExactMatch(text, context)

```javascript
findExactMatch(text, context)
```

* 精确匹配

---

## findFuzzyMatch(text, context)

```javascript
findFuzzyMatch(text, context)
```

* 模糊匹配

---

## smartParse(text, context)

```javascript
smartParse(text, context)
```

* 智能解析

---

## detectIntent(text)

```javascript
detectIntent(text)
```

* 检测意图

---

## extractEntities(text)

```javascript
extractEntities(text)
```

* 提取实体

---

## calculateSimilarity(text1, text2)

```javascript
calculateSimilarity(text1, text2)
```

* 计算相似度

---

## levenshteinDistance(str1, str2)

```javascript
levenshteinDistance(str1, str2)
```

* Levenshtein 距离

---

## isContextMatch(command, context)

```javascript
isContextMatch(command, context)
```

* 上下文匹配

---

## buildResult(command, originalText, confidence)

```javascript
buildResult(command, originalText, confidence)
```

* 构建结果

---

## registerMacro(name, commands)

```javascript
registerMacro(name, commands)
```

* 注册宏命令

---

## executeMacro(name, context)

```javascript
executeMacro(name, context)
```

* 执行宏命令

---

## addToHistory(result)

```javascript
addToHistory(result)
```

* 添加到历史

---

## getHistory(limit = 10)

```javascript
getHistory(limit = 10)
```

* 获取命令历史

---

## getAllCommands()

```javascript
getAllCommands()
```

* 获取所有命令

---

## getCommandsByCategory(category)

```javascript
getCommandsByCategory(category)
```

* 按类别获取命令

---

## setCommandEnabled(name, enabled)

```javascript
setCommandEnabled(name, enabled)
```

* 启用/禁用命令

---

