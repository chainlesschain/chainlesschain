# speech-recognizer

**Source**: `src/main/speech/speech-recognizer.js`

**Generated**: 2026-02-21T20:04:16.200Z

---

## const

```javascript
const
```

* 语音识别引擎
 *
 * 支持多种语音识别引擎的统一接口
 * - Whisper API (OpenAI)
 * - Whisper Local (本地模型)
 * - Web Speech API (浏览器)

---

## class BaseSpeechRecognizer

```javascript
class BaseSpeechRecognizer
```

* 基础识别器接口

---

## async recognize(audio, options =

```javascript
async recognize(audio, options =
```

* 识别音频
   * @param {string|Buffer} audio - 音频数据
   * @param {Object} options - 识别选项
   * @returns {Promise<Object>} 识别结果

---

## getEngineName()

```javascript
getEngineName()
```

* 获取引擎名称

---

## async isAvailable()

```javascript
async isAvailable()
```

* 检查是否可用

---

## class WhisperAPIRecognizer extends BaseSpeechRecognizer

```javascript
class WhisperAPIRecognizer extends BaseSpeechRecognizer
```

* Whisper API 识别器 (OpenAI)

---

## async recognize(audioPath, options =

```javascript
async recognize(audioPath, options =
```

* 识别音频文件
   * @param {string} audioPath - 音频文件路径
   * @param {Object} options - 识别选项
   * @returns {Promise<Object>}

---

## async recognizeBatch(audioPaths, options =

```javascript
async recognizeBatch(audioPaths, options =
```

* 批量识别（自动处理速率限制）
   * @param {Array} audioPaths - 音频文件路径列表
   * @param {Object} options - 识别选项
   * @returns {Promise<Array>}

---

## async detectLanguage(audioPath)

```javascript
async detectLanguage(audioPath)
```

* 自动检测音频语言
   * @param {string} audioPath - 音频文件路径
   * @returns {Promise<Object>} 语言检测结果

---

## getLanguageName(code)

```javascript
getLanguageName(code)
```

* 获取语言名称
   * @param {string} code - 语言代码
   * @returns {string}

---

## async detectLanguages(audioPaths)

```javascript
async detectLanguages(audioPaths)
```

* 批量语言检测
   * @param {Array} audioPaths - 音频文件路径列表
   * @returns {Promise<Array>}

---

## class WhisperLocalRecognizer extends BaseSpeechRecognizer

```javascript
class WhisperLocalRecognizer extends BaseSpeechRecognizer
```

* Whisper Local 识别器（本地模型）
 * Phase 2 实现

---

## async recognize(audioPath, options =

```javascript
async recognize(audioPath, options =
```

* 识别音频文件（使用本地 Whisper 服务）
   * @param {string} audioPath - 音频文件路径
   * @param {Object} options - 识别选项
   * @returns {Promise<Object>}

---

## async isAvailable()

```javascript
async isAvailable()
```

* 检查本地 Whisper 服务是否可用

---

## async getAvailableModels()

```javascript
async getAvailableModels()
```

* 获取可用的模型列表

---

## async recognizeBatch(audioPaths, options =

```javascript
async recognizeBatch(audioPaths, options =
```

* 批量识别（本地服务通常更快，可以并发）

---

## class WebSpeechRecognizer extends BaseSpeechRecognizer

```javascript
class WebSpeechRecognizer extends BaseSpeechRecognizer
```

* Web Speech API 识别器
 * 注意：此引擎在浏览器端使用，这里仅作为占位符

---

## class SpeechRecognizer

```javascript
class SpeechRecognizer
```

* 语音识别器工厂类

---

## createEngine(engineType, config)

```javascript
createEngine(engineType, config)
```

* 创建识别引擎
   * @param {string} engineType - 引擎类型
   * @param {Object} config - 引擎配置
   * @returns {BaseSpeechRecognizer}

---

## async recognize(audioPath, options =

```javascript
async recognize(audioPath, options =
```

* 识别音频
   * @param {string} audioPath - 音频文件路径
   * @param {Object} options - 识别选项
   * @returns {Promise<Object>}

---

## switchEngine(engineType, config =

```javascript
switchEngine(engineType, config =
```

* 切换识别引擎
   * @param {string} engineType - 引擎类型
   * @param {Object} config - 引擎配置

---

## async getAvailableEngines()

```javascript
async getAvailableEngines()
```

* 获取可用的引擎列表
   * @returns {Promise<Array>}

---

## getCurrentEngine()

```javascript
getCurrentEngine()
```

* 获取当前引擎名称

---

## async recognizeBatch(audioPaths, options =

```javascript
async recognizeBatch(audioPaths, options =
```

* 批量识别

---

