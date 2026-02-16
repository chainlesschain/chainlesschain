# audio-storage

**Source**: `src/main/speech/audio-storage.js`

**Generated**: 2026-02-16T13:44:34.610Z

---

## const

```javascript
const
```

* 音频存储管理
 *
 * 管理音频文件的存储和数据库记录

---

## class AudioStorage

```javascript
class AudioStorage
```

* 音频存储管理类

---

## async initialize()

```javascript
async initialize()
```

* 初始化存储

---

## async saveAudioFile(sourcePath, metadata =

```javascript
async saveAudioFile(sourcePath, metadata =
```

* 保存音频文件
   * @param {string} sourcePath - 源文件路径
   * @param {Object} metadata - 文件元数据
   * @returns {Promise<Object>} 保存结果

---

## async createAudioRecord(data)

```javascript
async createAudioRecord(data)
```

* 创建音频记录
   * @param {Object} data - 音频数据
   * @returns {Promise<Object>}

---

## async updateAudioRecord(id, updates)

```javascript
async updateAudioRecord(id, updates)
```

* 更新音频记录
   * @param {string} id - 音频ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>}

---

## async getAudioRecord(id)

```javascript
async getAudioRecord(id)
```

* 获取音频记录
   * @param {string} id - 音频ID
   * @returns {Promise<Object|null>}

---

## async getAllAudioFiles(options =

```javascript
async getAllAudioFiles(options =
```

* 获取所有音频文件
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}

---

## async searchAudioFiles(query, options =

```javascript
async searchAudioFiles(query, options =
```

* 搜索音频（通过转录文本）
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>}

---

## async deleteAudioFile(id)

```javascript
async deleteAudioFile(id)
```

* 删除音频文件
   * @param {string} id - 音频ID
   * @returns {Promise<Object>}

---

## async addTranscriptionHistory(data)

```javascript
async addTranscriptionHistory(data)
```

* 添加转录历史
   * @param {Object} data - 转录数据
   * @returns {Promise<Object>}

---

## async getTranscriptionHistory(audio_file_id)

```javascript
async getTranscriptionHistory(audio_file_id)
```

* 获取转录历史
   * @param {string} audio_file_id - 音频文件ID
   * @returns {Promise<Array>}

---

## async getAllTranscriptionHistory(options =

```javascript
async getAllTranscriptionHistory(options =
```

* 获取所有转录历史
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}

---

## async searchTranscriptionHistory(query, options =

```javascript
async searchTranscriptionHistory(query, options =
```

* 搜索转录历史
   * @param {string} query - 搜索关键词
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}

---

## async deleteTranscriptionHistory(id)

```javascript
async deleteTranscriptionHistory(id)
```

* 删除转录历史
   * @param {string} id - 历史记录ID
   * @returns {Promise<Object>}

---

## async getStats(user_id = "local-user")

```javascript
async getStats(user_id = "local-user")
```

* 获取统计信息
   * @param {string} user_id - 用户ID
   * @returns {Promise<Object>}

---

## async cleanupOldFiles(days = 30)

```javascript
async cleanupOldFiles(days = 30)
```

* 清理旧文件
   * @param {number} days - 保留天数
   * @returns {Promise<Object>}

---

