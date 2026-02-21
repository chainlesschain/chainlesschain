# video-importer

**Source**: `src/main/video/video-importer.js`

**Generated**: 2026-02-21T22:04:25.761Z

---

## const

```javascript
const
```

* 视频导入器
 * 负责视频文件的导入、元数据提取、缩略图生成和数据库存储
 * 使用 EventEmitter 模式发送进度和状态更新

---

## class VideoImporter extends EventEmitter

```javascript
class VideoImporter extends EventEmitter
```

* 视频导入器类

---

## constructor(database, userDataPath)

```javascript
constructor(database, userDataPath)
```

* @param {Object} database - 数据库实例
   * @param {string} userDataPath - 用户数据路径

---

## async initializeStorageDirectories()

```javascript
async initializeStorageDirectories()
```

* 初始化存储目录
   * @returns {Promise<void>}

---

## async importVideo(filePath, options =

```javascript
async importVideo(filePath, options =
```

* 导入单个视频文件
   * @param {string} filePath - 视频文件路径
   * @param {Object} options - 导入选项
   * @returns {Promise<Object>} 导入结果

---

## async importVideoBatch(filePaths, options =

```javascript
async importVideoBatch(filePaths, options =
```

* 批量导入视频文件
   * @param {Array<string>} filePaths - 文件路径数组
   * @param {Object} options - 导入选项
   * @returns {Promise<Array>} 导入结果数组

---

## async validateFile(filePath)

```javascript
async validateFile(filePath)
```

* 验证视频文件
   * @param {string} filePath - 文件路径
   * @returns {Promise<void>}

---

## async extractMetadata(filePath)

```javascript
async extractMetadata(filePath)
```

* 提取视频元数据
   * @param {string} filePath - 视频文件路径
   * @returns {Promise<Object>} 元数据

---

## parseFps(fpsString)

```javascript
parseFps(fpsString)
```

* 解析帧率字符串
   * @param {string} fpsString - 帧率字符串 (如 "30/1")
   * @returns {number}

---

## async copyFileToStorage(sourceFilePath)

```javascript
async copyFileToStorage(sourceFilePath)
```

* 复制文件到存储目录
   * @param {string} sourceFilePath - 源文件路径
   * @returns {Promise<string>} 目标文件路径

---

## async generateThumbnail(filePath, taskId)

```javascript
async generateThumbnail(filePath, taskId)
```

* 生成缩略图
   * @param {string} filePath - 视频文件路径
   * @param {string} taskId - 任务ID
   * @returns {Promise<string>} 缩略图路径

---

## async analyzeVideo(videoId)

```javascript
async analyzeVideo(videoId)
```

* 分析视频
   * @param {string} videoId - 视频ID
   * @returns {Promise<Object>} 分析结果

---

## async extractAudio(video)

```javascript
async extractAudio(video)
```

* 提取音频
   * @param {Object} video - 视频记录
   * @returns {Promise<string>} 音频文件路径

---

## async extractKeyframes(video)

```javascript
async extractKeyframes(video)
```

* 提取关键帧
   * @param {Object} video - 视频记录
   * @returns {Promise<Array>} 关键帧列表

---

## async detectScenes(video)

```javascript
async detectScenes(video)
```

* 检测场景
   * @param {Object} video - 视频记录
   * @returns {Promise<Array>} 场景列表

---

## async performOCR(video)

```javascript
async performOCR(video)
```

* 执行 OCR 识别
   * @param {Object} video - 视频记录
   * @returns {Promise<string>} OCR 文本

---

## formatTime(seconds)

```javascript
formatTime(seconds)
```

* 格式化时间为 HH:MM:SS
   * @param {number} seconds - 秒数
   * @returns {string}

---

## async cancelImport(taskId)

```javascript
async cancelImport(taskId)
```

* 取消导入任务
   * @param {string} taskId - 任务ID
   * @returns {Promise<void>}

---

## getImportProgress(taskId)

```javascript
getImportProgress(taskId)
```

* 获取导入进度
   * @param {string} taskId - 任务ID
   * @returns {Object|null}

---

