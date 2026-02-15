# video-engine

**Source**: `src/main/engines/video-engine.js`

**Generated**: 2026-02-15T10:10:53.424Z

---

## const

```javascript
const
```

* 视频处理引擎
 * 负责视频剪辑、格式转换、字幕生成和视频合并
 * 使用FFmpeg进行视频处理

---

## async handleProjectTask(params, onProgress = null)

```javascript
async handleProjectTask(params, onProgress = null)
```

* 处理项目任务
   * @param {Object} params - 任务参数
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增滤镜、音轨处理任务
   * v0.18.0: 集成统一进度通知和错误恢复

---

## async convertFormat(inputPath, outputPath, options =

```javascript
async convertFormat(inputPath, outputPath, options =
```

* 视频格式转换
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 转换选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 转换结果

---

## async trimVideo(inputPath, outputPath, options =

```javascript
async trimVideo(inputPath, outputPath, options =
```

* 视频剪辑
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 剪辑选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 剪辑结果

---

## async mergeVideos(videoList, outputPath, options =

```javascript
async mergeVideos(videoList, outputPath, options =
```

* 合并多个视频
   * @param {Array<string>} videoList - 视频文件路径列表
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 合并选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 合并结果

---

## async addSubtitles(

```javascript
async addSubtitles(
```

* 添加字幕
   * @param {string} inputPath - 输入视频路径
   * @param {string} subtitlePath - 字幕文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 扩展支持10+自定义样式参数

---

## async extractAudio(inputPath, outputPath, options =

```javascript
async extractAudio(inputPath, outputPath, options =
```

* 提取音频
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出音频路径
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 提取结果

---

## async generateThumbnail(inputPath, outputPath, options =

```javascript
async generateThumbnail(inputPath, outputPath, options =
```

* 生成缩略图
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出图片路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 生成结果

---

## async compressVideo(inputPath, outputPath, options =

```javascript
async compressVideo(inputPath, outputPath, options =
```

* 压缩视频
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出视频路径
   * @param {Object} options - 压缩选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 压缩结果

---

## async generateSubtitlesWithAI(

```javascript
async generateSubtitlesWithAI(
```

* 使用AI生成字幕
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出字幕路径
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 生成结果

---

## async generateSubtitlesContent(audioPath, language)

```javascript
async generateSubtitlesContent(audioPath, language)
```

* 生成字幕内容（示例实现）
   * @param {string} audioPath - 音频文件路径
   * @param {string} language - 语言
   * @returns {Promise<string>} SRT格式字幕

---

## async getVideoInfo(videoPath)

```javascript
async getVideoInfo(videoPath)
```

* 获取视频信息
   * @param {string} videoPath - 视频文件路径
   * @returns {Promise<Object>} 视频信息

---

## async applyFilter(inputPath, outputPath, options =

```javascript
async applyFilter(inputPath, outputPath, options =
```

* 应用单个滤镜
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出视频路径
   * @param {Object} options - 滤镜选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增方法

---

## async applyFilterChain(

```javascript
async applyFilterChain(
```

* 应用滤镜链（多个滤镜组合）
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出视频路径
   * @param {Array} filterChain - 滤镜链配置
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增方法

---

## async separateAudioTracks(inputPath, outputDir, options =

```javascript
async separateAudioTracks(inputPath, outputDir, options =
```

* 分离音轨（支持多音轨视频）
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputDir - 输出目录
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 分离结果
   *
   * v0.18.0: 新增方法

---

## async replaceAudio(

```javascript
async replaceAudio(
```

* 替换音轨
   * @param {string} videoPath - 视频文件路径
   * @param {string} audioPath - 音频文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增方法

---

## async adjustVolume(

```javascript
async adjustVolume(
```

* 调节音量
   * @param {string} inputPath - 输入视频路径
   * @param {string} outputPath - 输出视频路径
   * @param {number} volumeLevel - 音量级别（0.5=50%, 1.0=100%, 2.0=200%）
   * @param {Object} options - 选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增方法

---

## async addSubtitlesWithPreset(

```javascript
async addSubtitlesWithPreset(
```

* 使用预设样式添加字幕
   * @param {string} inputPath - 输入视频路径
   * @param {string} subtitlePath - 字幕文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {string} presetName - 预设名称 (default/cinema/minimal/bold)
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>} 处理结果
   *
   * v0.18.0: 新增方法

---

## _parseFrameRate(frameRateStr)

```javascript
_parseFrameRate(frameRateStr)
```

* 安全解析帧率字符串 (如 "30/1" 或 "24000/1001")
   * @param {string} frameRateStr - 帧率字符串
   * @returns {number} - 帧率数值

---

## function getVideoEngine(llmManager = null)

```javascript
function getVideoEngine(llmManager = null)
```

* 获取视频引擎实例
 * @param {Object} llmManager - LLM管理器
 * @returns {VideoEngine}

---

