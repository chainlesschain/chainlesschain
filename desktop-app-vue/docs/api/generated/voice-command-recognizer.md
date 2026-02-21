# voice-command-recognizer

**Source**: `src/main/speech/voice-command-recognizer.js`

**Generated**: 2026-02-21T20:04:16.200Z

---

## const

```javascript
const
```

* 语音命令识别器
 *
 * 智能识别和执行语音命令
 * 支持系统命令、导航命令、AI命令等

---

## class VoiceCommandRecognizer extends EventEmitter

```javascript
class VoiceCommandRecognizer extends EventEmitter
```

* 语音命令识别类

---

## registerDefaultCommands()

```javascript
registerDefaultCommands()
```

* 注册默认命令

---

## registerCommand(command)

```javascript
registerCommand(command)
```

* 注册命令
   * @param {Object} command - 命令配置

---

## recognize(text, context =

```javascript
recognize(text, context =
```

* 识别命令
   * @param {string} text - 语音转文字结果
   * @param {Object} context - 当前上下文
   * @returns {Object|null} 识别结果

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

* Levenshtein距离

---

## isContextMatch(command, context)

```javascript
isContextMatch(command, context)
```

* 上下文匹配检查

---

## buildResult(command, originalText, confidence)

```javascript
buildResult(command, originalText, confidence)
```

* 构建结果

---

## parseWithNLU(text, context)

```javascript
parseWithNLU(text, context)
```

* NLU解析（简单版本）

---

## extractEntities(text)

```javascript
extractEntities(text)
```

* 提取实体

---

## pushContext(context)

```javascript
pushContext(context)
```

* 设置上下文

---

## popContext()

```javascript
popContext()
```

* 弹出上下文

---

## getCurrentContext()

```javascript
getCurrentContext()
```

* 获取当前上下文

---

## getAllCommands()

```javascript
getAllCommands()
```

* 获取所有命令

---

## unregisterCommand(name)

```javascript
unregisterCommand(name)
```

* 移除命令

---

