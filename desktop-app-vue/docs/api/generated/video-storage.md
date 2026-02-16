# video-storage

**Source**: `src/main/video/video-storage.js`

**Generated**: 2026-02-16T13:44:34.596Z

---

## const

```javascript
const
```

* 视频数据库存储管理器
 * 负责视频相关数据的增删改查操作

---

## class VideoStorage

```javascript
class VideoStorage
```

* 视频存储管理类

---

## constructor(database)

```javascript
constructor(database)
```

* @param {Object} database - 数据库实例

---

## async createVideoFile(videoData)

```javascript
async createVideoFile(videoData)
```

* 创建视频文件记录
   * @param {Object} videoData - 视频数据
   * @returns {Promise<Object>} 创建的记录

---

## async getVideoFile(id)

```javascript
async getVideoFile(id)
```

* 获取视频文件记录
   * @param {string} id - 视频文件ID
   * @returns {Promise<Object|null>}

---

## async getVideoFileByPath(filePath)

```javascript
async getVideoFileByPath(filePath)
```

* 根据文件路径获取视频
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object|null>}

---

## async getVideosByKnowledgeId(knowledgeId)

```javascript
async getVideosByKnowledgeId(knowledgeId)
```

* 根据知识库ID获取视频列表
   * @param {string} knowledgeId - 知识库ID
   * @returns {Promise<Array>}

---

## async updateVideoFile(id, updates)

```javascript
async updateVideoFile(id, updates)
```

* 更新视频文件记录
   * @param {string} id - 视频文件ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>}

---

## async deleteVideoFile(id)

```javascript
async deleteVideoFile(id)
```

* 删除视频文件记录
   * @param {string} id - 视频文件ID
   * @returns {Promise<void>}

---

## async getAllVideos(options =

```javascript
async getAllVideos(options =
```

* 获取所有视频列表
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}

---

## async createVideoAnalysis(analysisData)

```javascript
async createVideoAnalysis(analysisData)
```

* 创建视频分析记录
   * @param {Object} analysisData - 分析数据
   * @returns {Promise<Object>}

---

## async getVideoAnalysis(id)

```javascript
async getVideoAnalysis(id)
```

* 获取视频分析记录
   * @param {string} id - 分析记录ID
   * @returns {Promise<Object|null>}

---

## async getVideoAnalysisByVideoId(videoFileId)

```javascript
async getVideoAnalysisByVideoId(videoFileId)
```

* 根据视频ID获取分析记录
   * @param {string} videoFileId - 视频文件ID
   * @returns {Promise<Object|null>}

---

## async updateVideoAnalysis(id, updates)

```javascript
async updateVideoAnalysis(id, updates)
```

* 更新视频分析记录
   * @param {string} id - 分析记录ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>}

---

## async createKeyframe(keyframeData)

```javascript
async createKeyframe(keyframeData)
```

* 创建关键帧记录
   * @param {Object} keyframeData - 关键帧数据
   * @returns {Promise<Object>}

---

## async getKeyframe(id)

```javascript
async getKeyframe(id)
```

* 获取关键帧记录
   * @param {string} id - 关键帧ID
   * @returns {Promise<Object|null>}

---

## async getKeyframesByVideoId(videoFileId)

```javascript
async getKeyframesByVideoId(videoFileId)
```

* 根据视频ID获取所有关键帧
   * @param {string} videoFileId - 视频文件ID
   * @returns {Promise<Array>}

---

## async createKeyframesBatch(keyframes)

```javascript
async createKeyframesBatch(keyframes)
```

* 批量创建关键帧
   * @param {Array<Object>} keyframes - 关键帧数组
   * @returns {Promise<Array>}

---

## async createSubtitle(subtitleData)

```javascript
async createSubtitle(subtitleData)
```

* 创建字幕记录
   * @param {Object} subtitleData - 字幕数据
   * @returns {Promise<Object>}

---

## async getSubtitle(id)

```javascript
async getSubtitle(id)
```

* 获取字幕记录
   * @param {string} id - 字幕ID
   * @returns {Promise<Object|null>}

---

## async getSubtitlesByVideoId(videoFileId)

```javascript
async getSubtitlesByVideoId(videoFileId)
```

* 根据视频ID获取所有字幕
   * @param {string} videoFileId - 视频文件ID
   * @returns {Promise<Array>}

---

## async updateSubtitle(id, updates)

```javascript
async updateSubtitle(id, updates)
```

* 更新字幕记录
   * @param {string} id - 字幕ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>}

---

## async createEditHistory(historyData)

```javascript
async createEditHistory(historyData)
```

* 创建编辑历史记录
   * @param {Object} historyData - 编辑历史数据
   * @returns {Promise<Object>}

---

## async getEditHistory(id)

```javascript
async getEditHistory(id)
```

* 获取编辑历史记录
   * @param {string} id - 编辑历史ID
   * @returns {Promise<Object|null>}

---

## async getEditHistoryByVideoId(originalVideoId)

```javascript
async getEditHistoryByVideoId(originalVideoId)
```

* 根据原始视频ID获取编辑历史
   * @param {string} originalVideoId - 原始视频ID
   * @returns {Promise<Array>}

---

## async updateEditHistory(id, updates)

```javascript
async updateEditHistory(id, updates)
```

* 更新编辑历史记录
   * @param {string} id - 编辑历史ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>}

---

## async createScene(sceneData)

```javascript
async createScene(sceneData)
```

* 创建场景记录
   * @param {Object} sceneData - 场景数据
   * @returns {Promise<Object>}

---

## async getScene(id)

```javascript
async getScene(id)
```

* 获取场景记录
   * @param {string} id - 场景ID
   * @returns {Promise<Object|null>}

---

## async getScenesByVideoId(videoFileId)

```javascript
async getScenesByVideoId(videoFileId)
```

* 根据视频ID获取所有场景
   * @param {string} videoFileId - 视频文件ID
   * @returns {Promise<Array>}

---

## async createScenesBatch(scenes)

```javascript
async createScenesBatch(scenes)
```

* 批量创建场景
   * @param {Array<Object>} scenes - 场景数组
   * @returns {Promise<Array>}

---

## async getVideoCount()

```javascript
async getVideoCount()
```

* 获取视频总数
   * @returns {Promise<number>}

---

## async getTotalDuration()

```javascript
async getTotalDuration()
```

* 获取总视频时长（秒）
   * @returns {Promise<number>}

---

## async getTotalStorageSize()

```javascript
async getTotalStorageSize()
```

* 获取总存储大小（字节）
   * @returns {Promise<number>}

---

## async getVideoCountByStatus()

```javascript
async getVideoCountByStatus()
```

* 按状态统计视频数量
   * @returns {Promise<Object>}

---

