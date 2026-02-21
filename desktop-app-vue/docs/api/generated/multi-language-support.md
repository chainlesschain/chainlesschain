# multi-language-support

**Source**: `src/main/speech/multi-language-support.js`

**Generated**: 2026-02-21T20:04:16.201Z

---

## const

```javascript
const
```

* 多语言语音识别支持
 *
 * 支持多种语言的语音识别和自动语言检测

---

## const SUPPORTED_LANGUAGES =

```javascript
const SUPPORTED_LANGUAGES =
```

* 支持的语言配置

---

## class MultiLanguageSupport extends EventEmitter

```javascript
class MultiLanguageSupport extends EventEmitter
```

* 多语言支持类

---

## getSupportedLanguages()

```javascript
getSupportedLanguages()
```

* 获取所有支持的语言

---

## getLanguageInfo(languageCode)

```javascript
getLanguageInfo(languageCode)
```

* 获取语言信息

---

## isLanguageSupported(languageCode)

```javascript
isLanguageSupported(languageCode)
```

* 检查语言是否支持

---

## setCurrentLanguage(languageCode)

```javascript
setCurrentLanguage(languageCode)
```

* 设置当前语言

---

## getCurrentLanguage()

```javascript
getCurrentLanguage()
```

* 获取当前语言

---

## getWhisperLanguageCode(languageCode = null)

```javascript
getWhisperLanguageCode(languageCode = null)
```

* 获取当前语言的 Whisper 代码

---

## getWebSpeechLanguageCode(languageCode = null)

```javascript
getWebSpeechLanguageCode(languageCode = null)
```

* 获取当前语言的 Web Speech API 代码

---

## detectLanguage(text)

```javascript
detectLanguage(text)
```

* 自动检测语言
   * @param {string} text - 要检测的文本
   * @returns {Object} 检测结果 { language, confidence, alternatives }

---

## calculateLanguageScore(text, languageInfo)

```javascript
calculateLanguageScore(text, languageInfo)
```

* 计算文本与语言的匹配分数

---

## detectCharset(text, languageInfo)

```javascript
detectCharset(text, languageInfo)
```

* 检测字符集特征

---

## getHistoryScore(languageInfo)

```javascript
getHistoryScore(languageInfo)
```

* 从历史记录获取分数

---

## addToHistory(result)

```javascript
addToHistory(result)
```

* 添加到检测历史

---

## clearHistory()

```javascript
clearHistory()
```

* 清除检测历史

---

## getLanguageStats()

```javascript
getLanguageStats()
```

* 获取语言统计

---

## getRecommendedLanguages(limit = 3)

```javascript
getRecommendedLanguages(limit = 3)
```

* 获取推荐语言
   * 基于历史使用情况

---

## translateSystemMessage(key, languageCode = null)

```javascript
translateSystemMessage(key, languageCode = null)
```

* 翻译系统消息
   * @param {string} key - 消息键
   * @param {string} languageCode - 目标语言

---

