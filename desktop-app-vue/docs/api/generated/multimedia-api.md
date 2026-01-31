# multimedia-api

**Source**: `src\renderer\utils\multimedia-api.js`

**Generated**: 2026-01-27T06:44:03.896Z

---

## class MultimediaAPI

```javascript
class MultimediaAPI
```

* 多媒体API工具类
 *
 * 封装与主进程的IPC通信，提供简洁的API调用
 * 自动处理进度事件和错误处理

---

## setupProgressListener()

```javascript
setupProgressListener()
```

* 设置进度监听器

---

## async invoke(channel, params =

```javascript
async invoke(channel, params =
```

* 调用IPC方法的通用包装
   * @param {string} channel - IPC通道
   * @param {Object} params - 参数
   * @param {Function} onProgress - 进度回调
   * @returns {Promise}

---

## async uploadImage(imagePath, options =

```javascript
async uploadImage(imagePath, options =
```

* 上传图片
   * @param {string} imagePath - 图片路径
   * @param {Object} options - 上传选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}

---

## async uploadImages(imagePaths, options =

```javascript
async uploadImages(imagePaths, options =
```

* 批量上传图片
   * @param {Array<string>} imagePaths - 图片路径列表
   * @param {Object} options - 上传选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Array>}

---

## async batchOCR(imagePaths, options =

```javascript
async batchOCR(imagePaths, options =
```

* 批量OCR识别
   * @param {Array<string>} imagePaths - 图片路径列表
   * @param {Object} options - OCR选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Array>}

---

## async compressImage(imagePath, options =

```javascript
async compressImage(imagePath, options =
```

* 图片压缩
   * @param {string} imagePath - 图片路径
   * @param {Object} options - 压缩选项
   * @returns {Promise<Object>}

---

## async transcribeAudio(audioPath, options =

```javascript
async transcribeAudio(audioPath, options =
```

* 音频转录
   * @param {string} audioPath - 音频路径
   * @param {Object} options - 转录选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}

---

## async batchTranscribe(audioPaths, options =

```javascript
async batchTranscribe(audioPaths, options =
```

* 批量音频转录
   * @param {Array<string>} audioPaths - 音频路径列表
   * @param {Object} options - 转录选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Array>}

---

## async getVideoInfo(videoPath)

```javascript
async getVideoInfo(videoPath)
```

* 获取视频信息
   * @param {string} videoPath - 视频路径
   * @returns {Promise<Object>}

---

## async applyVideoFilter(inputPath, outputPath, options =

```javascript
async applyVideoFilter(inputPath, outputPath, options =
```

* 应用视频滤镜
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 滤镜选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}

---

## async applyVideoFilterChain(inputPath, outputPath, filters, onProgress = null)

```javascript
async applyVideoFilterChain(inputPath, outputPath, filters, onProgress = null)
```

* 应用视频滤镜链
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Array} filters - 滤镜链
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}

---

## async extractAudio(inputPath, outputPath, onProgress = null)

```javascript
async extractAudio(inputPath, outputPath, onProgress = null)
```

* 提取音频
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}

---

## async separateAudioTracks(inputPath, outputDir)

```javascript
async separateAudioTracks(inputPath, outputDir)
```

* 分离音轨
   * @param {string} inputPath - 输入路径
   * @param {string} outputDir - 输出目录
   * @returns {Promise<Object>}

---

## async replaceAudio(videoPath, audioPath, outputPath, onProgress = null)

```javascript
async replaceAudio(videoPath, audioPath, outputPath, onProgress = null)
```

* 替换音轨
   * @param {string} videoPath - 视频路径
   * @param {string} audioPath - 音频路径
   * @param {string} outputPath - 输出路径
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}

---

## async adjustVolume(inputPath, outputPath, volumeLevel, options =

```javascript
async adjustVolume(inputPath, outputPath, volumeLevel, options =
```

* 调整音量
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {number} volumeLevel - 音量级别
   * @param {Object} options - 其他选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}

---

## async addSubtitles(inputPath, subtitlePath, outputPath, options =

```javascript
async addSubtitles(inputPath, subtitlePath, outputPath, options =
```

* 添加字幕
   * @param {string} inputPath - 输入路径
   * @param {string} subtitlePath - 字幕路径
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 字幕选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}

---

## async addSubtitlesWithPreset(

```javascript
async addSubtitlesWithPreset(
```

* 使用预设添加字幕
   * @param {string} inputPath - 输入路径
   * @param {string} subtitlePath - 字幕路径
   * @param {string} outputPath - 输出路径
   * @param {string} presetName - 预设名称
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}

---

## async convertVideo(inputPath, outputPath, options =

```javascript
async convertVideo(inputPath, outputPath, options =
```

* 视频格式转换
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 转换选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}

---

## async trimVideo(inputPath, outputPath, options =

```javascript
async trimVideo(inputPath, outputPath, options =
```

* 裁剪视频
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 裁剪选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}

---

## async compressVideo(inputPath, outputPath, options =

```javascript
async compressVideo(inputPath, outputPath, options =
```

* 压缩视频
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 压缩选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}

---

## async generateThumbnail(inputPath, outputPath, options =

```javascript
async generateThumbnail(inputPath, outputPath, options =
```

* 生成缩略图
   * @param {string} inputPath - 输入路径
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>}

---

## async mergeVideos(videoPaths, outputPath, options =

```javascript
async mergeVideos(videoPaths, outputPath, options =
```

* 合并视频
   * @param {Array<string>} videoPaths - 视频路径列表
   * @param {string} outputPath - 输出路径
   * @param {Object} options - 合并选项
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Object>}

---

