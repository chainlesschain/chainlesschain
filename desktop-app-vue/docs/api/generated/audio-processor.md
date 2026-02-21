# audio-processor

**Source**: `src/main/speech/audio-processor.js`

**Generated**: 2026-02-21T20:04:16.202Z

---

## const

```javascript
const
```

* 音频处理器
 *
 * 负责音频格式转换、预处理、元数据提取等
 * 使用 FFmpeg 进行音频处理

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 音频处理配置

---

## class AudioProcessor extends EventEmitter

```javascript
class AudioProcessor extends EventEmitter
```

* 音频处理器类

---

## async checkFFmpeg()

```javascript
async checkFFmpeg()
```

* 检查 FFmpeg 是否可用

---

## async getMetadata(audioPath)

```javascript
async getMetadata(audioPath)
```

* 获取音频元数据
   * @param {string} audioPath - 音频文件路径
   * @returns {Promise<Object>} 元数据

---

## async convertToWhisperFormat(inputPath, outputPath = null)

```javascript
async convertToWhisperFormat(inputPath, outputPath = null)
```

* 转换为 Whisper 最佳格式
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径（可选）
   * @returns {Promise<Object>} 处理结果

---

## async normalizeVolume(inputPath, outputPath)

```javascript
async normalizeVolume(inputPath, outputPath)
```

* 音量归一化
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @returns {Promise<Object>}

---

## async trimSilence(inputPath, outputPath, options =

```javascript
async trimSilence(inputPath, outputPath, options =
```

* 去除静音
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>}

---

## async denoiseAudio(inputPath, outputPath, options =

```javascript
async denoiseAudio(inputPath, outputPath, options =
```

* 音频降噪（使用 FFmpeg afftdn 滤镜）
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 降噪选项
   * @returns {Promise<Object>}

---

## async enhanceAudio(inputPath, outputPath, options =

```javascript
async enhanceAudio(inputPath, outputPath, options =
```

* 高级音频增强（综合处理）
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 增强选项
   * @returns {Promise<Object>}

---

## async enhanceForSpeechRecognition(inputPath, outputPath)

```javascript
async enhanceForSpeechRecognition(inputPath, outputPath)
```

* 语音增强预设（专门针对语音识别优化）
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @returns {Promise<Object>}

---

## async extractAudio(videoPath, outputPath)

```javascript
async extractAudio(videoPath, outputPath)
```

* 提取音频（从视频文件）
   * @param {string} videoPath - 视频文件路径
   * @param {string} outputPath - 输出音频路径
   * @returns {Promise<Object>}

---

## async segmentAudio(inputPath, segmentDuration = 300, outputDir = null)

```javascript
async segmentAudio(inputPath, segmentDuration = 300, outputDir = null)
```

* 音频分段
   * @param {string} inputPath - 输入文件路径
   * @param {number} segmentDuration - 段长度（秒）
   * @param {string} outputDir - 输出目录
   * @returns {Promise<Array>} 分段文件列表

---

## async extractSegment(inputPath, outputPath, startTime, duration)

```javascript
async extractSegment(inputPath, outputPath, startTime, duration)
```

* 提取音频片段
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {number} startTime - 开始时间（秒）
   * @param {number} duration - 持续时间（秒）
   * @returns {Promise<Object>}

---

## async detectSpeech(audioPath)

```javascript
async detectSpeech(audioPath)
```

* 检测是否包含语音
   * @param {string} audioPath - 音频文件路径
   * @returns {Promise<Object>} 检测结果

---

## async batchProcess(audioPaths, operation = "convert", options =

```javascript
async batchProcess(audioPaths, operation = "convert", options =
```

* 批量处理音频
   * @param {Array} audioPaths - 音频文件路径列表
   * @param {string} operation - 操作类型
   * @param {Object} options - 操作选项
   * @returns {Promise<Array>} 处理结果列表

---

## isSupportedFormat(filePath)

```javascript
isSupportedFormat(filePath)
```

* 检查文件是否为支持的音频格式
   * @param {string} filePath - 文件路径
   * @returns {boolean}

---

## getSupportedFormats()

```javascript
getSupportedFormats()
```

* 获取支持的格式列表
   * @returns {Array}

---

## updateConfig(newConfig)

```javascript
updateConfig(newConfig)
```

* 更新配置
   * @param {Object} newConfig

---

## async cleanupTempFiles(filePaths)

```javascript
async cleanupTempFiles(filePaths)
```

* 清理临时文件
   * @param {Array} filePaths - 文件路径列表

---

