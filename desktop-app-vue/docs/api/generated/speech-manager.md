# speech-manager

**Source**: `src/main/speech/speech-manager.js`

**Generated**: 2026-02-21T22:45:05.250Z

---

## const

```javascript
const
```

* 语音识别管理器
 *
 * 统一管理所有语音识别相关功能
 * 协调各子模块：配置、音频处理、识别引擎、存储

---

## class SpeechManager extends EventEmitter

```javascript
class SpeechManager extends EventEmitter
```

* 语音识别管理器类
 *
 * 支持依赖注入以提高可测试性

---

## async initialize()

```javascript
async initialize()
```

* 初始化管理器
   *
   * 使用依赖注入的类来创建实例，提高可测试性

---

## setupProcessorEvents()

```javascript
setupProcessorEvents()
```

* 设置音频处理器事件转发

---

## setupRealtimeEvents()

```javascript
setupRealtimeEvents()
```

* 设置实时语音输入事件转发

---

## async transcribeFile(filePath, options =

```javascript
async transcribeFile(filePath, options =
```

* 转录单个音频文件
   * @param {string} filePath - 音频文件路径
   * @param {Object} options - 转录选项
   * @returns {Promise<Object>}

---

## async transcribeBatch(filePaths, options =

```javascript
async transcribeBatch(filePaths, options =
```

* 批量转录音频文件
   * @param {Array} filePaths - 音频文件路径列表
   * @param {Object} options - 转录选项
   * @returns {Promise<Array>}

---

## async getConfig()

```javascript
async getConfig()
```

* 获取配置

---

## async updateConfig(newConfig)

```javascript
async updateConfig(newConfig)
```

* 更新配置

---

## async setEngine(engineType)

```javascript
async setEngine(engineType)
```

* 设置识别引擎

---

## async getAvailableEngines()

```javascript
async getAvailableEngines()
```

* 获取可用引擎列表

---

## async getHistory(limit = 100, offset = 0)

```javascript
async getHistory(limit = 100, offset = 0)
```

* 获取转录历史

---

## async searchHistory(query, options =

```javascript
async searchHistory(query, options =
```

* 搜索转录历史

---

## async deleteHistory(id)

```javascript
async deleteHistory(id)
```

* 删除转录历史

---

## async getAudioFile(id)

```javascript
async getAudioFile(id)
```

* 获取音频文件

---

## async listAudioFiles(options =

```javascript
async listAudioFiles(options =
```

* 列出所有音频文件

---

## async searchAudioFiles(query, options =

```javascript
async searchAudioFiles(query, options =
```

* 搜索音频文件

---

## async deleteAudioFile(id)

```javascript
async deleteAudioFile(id)
```

* 删除音频文件

---

## async getStats(userId = "local-user")

```javascript
async getStats(userId = "local-user")
```

* 获取统计信息

---

## async denoiseAudio(inputPath, outputPath, options =

```javascript
async denoiseAudio(inputPath, outputPath, options =
```

* 音频降噪
   * @param {string} inputPath - 输入音频路径
   * @param {string} outputPath - 输出音频路径
   * @param {Object} options - 降噪选项
   * @returns {Promise<Object>}

---

## async enhanceAudio(inputPath, outputPath, options =

```javascript
async enhanceAudio(inputPath, outputPath, options =
```

* 音频增强（综合处理：降噪+归一化+均衡）
   * @param {string} inputPath - 输入音频路径
   * @param {string} outputPath - 输出音频路径
   * @param {Object} options - 增强选项
   * @returns {Promise<Object>}

---

## async enhanceForSpeechRecognition(inputPath, outputPath)

```javascript
async enhanceForSpeechRecognition(inputPath, outputPath)
```

* 语音增强（专门针对语音识别优化）
   * @param {string} inputPath - 输入音频路径
   * @param {string} outputPath - 输出音频路径
   * @returns {Promise<Object>}

---

## async detectLanguage(audioPath)

```javascript
async detectLanguage(audioPath)
```

* 自动检测音频语言
   * @param {string} audioPath - 音频文件路径
   * @returns {Promise<Object>}

---

## async detectLanguages(audioPaths)

```javascript
async detectLanguages(audioPaths)
```

* 批量检测语言
   * @param {Array} audioPaths - 音频文件路径列表
   * @returns {Promise<Array>}

---

## async generateSubtitle(audioId, outputPath, format = "srt")

```javascript
async generateSubtitle(audioId, outputPath, format = "srt")
```

* 生成字幕文件
   * @param {string} audioId - 音频文件ID
   * @param {string} outputPath - 输出路径
   * @param {string} format - 格式 (srt|vtt)
   * @returns {Promise<Object>}

---

## async transcribeAndGenerateSubtitle(audioPath, subtitlePath, options =

```javascript
async transcribeAndGenerateSubtitle(audioPath, subtitlePath, options =
```

* 转录并生成字幕（一步完成）
   * @param {string} audioPath - 音频文件路径
   * @param {string} subtitlePath - 字幕输出路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>}

---

## async batchGenerateSubtitles(audioIds, outputDir, format = "srt")

```javascript
async batchGenerateSubtitles(audioIds, outputDir, format = "srt")
```

* 批量生成字幕
   * @param {Array} audioIds - 音频ID列表
   * @param {string} outputDir - 输出目录
   * @param {string} format - 格式
   * @returns {Promise<Array>}

---

## async startRealtimeRecording(options =

```javascript
async startRealtimeRecording(options =
```

* 开始实时录音
   * @param {Object} options - 录音选项
   * @returns {Promise<void>}

---

## addRealtimeAudioData(audioData)

```javascript
addRealtimeAudioData(audioData)
```

* 添加音频数据（来自浏览器端）
   * @param {Buffer} audioData - PCM音频数据

---

## pauseRealtimeRecording()

```javascript
pauseRealtimeRecording()
```

* 暂停实时录音

---

## resumeRealtimeRecording()

```javascript
resumeRealtimeRecording()
```

* 恢复实时录音

---

## async stopRealtimeRecording()

```javascript
async stopRealtimeRecording()
```

* 停止实时录音
   * @returns {Promise<Object>} 转录结果

---

## cancelRealtimeRecording()

```javascript
cancelRealtimeRecording()
```

* 取消实时录音

---

## getRealtimeStatus()

```javascript
getRealtimeStatus()
```

* 获取实时录音状态
   * @returns {Object}

---

## recognizeCommand(text, context =

```javascript
recognizeCommand(text, context =
```

* 识别语音命令
   * @param {string} text - 语音文本
   * @param {Object} context - 上下文信息
   * @returns {Object|null} 识别结果

---

## registerCommand(command)

```javascript
registerCommand(command)
```

* 注册自定义命令
   * @param {Object} command - 命令配置

---

## getAllCommands()

```javascript
getAllCommands()
```

* 获取所有注册的命令
   * @returns {Array}

---

## async getCacheStats()

```javascript
async getCacheStats()
```

* 获取缓存统计信息
   * @returns {Promise<Object>}

---

## async clearCache()

```javascript
async clearCache()
```

* 清空音频缓存
   * @returns {Promise<void>}

---

## ensureInitialized()

```javascript
ensureInitialized()
```

* 确保已初始化

---

## async terminate()

```javascript
async terminate()
```

* 终止服务

---

