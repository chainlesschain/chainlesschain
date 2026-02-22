# resumable-processor

**Source**: `src/main/utils/resumable-processor.js`

**Generated**: 2026-02-22T01:23:36.656Z

---

## const

```javascript
const
```

* 可恢复处理器 - 错误恢复与断点续传
 *
 * 核心功能：
 * - 自动检查点保存（每10%进度）
 * - 指数退避重试（最多3次）
 * - 断点续传支持
 * - 错误日志记录
 *
 * v0.18.0: 新建文件，支持多媒体处理的容错性

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* 默认配置

---

## class ResumableProcessor extends EventEmitter

```javascript
class ResumableProcessor extends EventEmitter
```

* 可恢复处理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化（确保检查点目录存在）

---

## async processWithRetry(taskId, processor, options =

```javascript
async processWithRetry(taskId, processor, options =
```

* 处理任务（带重试和断点续传）
   * @param {string} taskId - 任务唯一标识
   * @param {Function} processor - 处理函数 (progress, options) => Promise<result>
   * @param {Object} options - 处理选项
   * @returns {Promise<Object>} 处理结果

---

## async saveCheckpoint(taskId, checkpointData)

```javascript
async saveCheckpoint(taskId, checkpointData)
```

* 保存检查点
   * @param {string} taskId - 任务ID
   * @param {Object} checkpointData - 检查点数据

---

## async loadCheckpoint(taskId)

```javascript
async loadCheckpoint(taskId)
```

* 加载检查点
   * @param {string} taskId - 任务ID
   * @returns {Promise<Object|null>} 检查点数据

---

## async deleteCheckpoint(taskId)

```javascript
async deleteCheckpoint(taskId)
```

* 删除检查点
   * @param {string} taskId - 任务ID

---

## getCheckpointPath(taskId)

```javascript
getCheckpointPath(taskId)
```

* 获取检查点文件路径
   * @param {string} taskId - 任务ID
   * @returns {string} 文件路径

---

## async getAllCheckpoints()

```javascript
async getAllCheckpoints()
```

* 获取所有检查点
   * @returns {Promise<Array>} 检查点列表

---

## async cleanupOldCheckpoints(maxAge = this.config.cleanupDelay)

```javascript
async cleanupOldCheckpoints(maxAge = this.config.cleanupDelay)
```

* 清理过期检查点
   * @param {number} maxAge - 最大年龄（毫秒）
   * @returns {Promise<number>} 清理的数量

---

## startAutoCleanup()

```javascript
startAutoCleanup()
```

* 启动自动清理定时器

---

## stopAutoCleanup()

```javascript
stopAutoCleanup()
```

* 停止自动清理定时器

---

## getActiveTasks()

```javascript
getActiveTasks()
```

* 获取活动任务列表
   * @returns {Array} 活动任务信息

---

## async terminate()

```javascript
async terminate()
```

* 终止处理器

---

