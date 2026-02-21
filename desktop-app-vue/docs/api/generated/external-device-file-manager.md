# external-device-file-manager

**Source**: `src/main/file/external-device-file-manager.js`

**Generated**: 2026-02-21T20:04:16.251Z

---

## const

```javascript
const
```

* 外部设备文件管理器
 *
 * 功能：
 * - 文件索引同步管理
 * - 文件拉取协调
 * - 缓存策略控制（LRU淘汰）
 * - 搜索和过滤
 * - RAG集成

---

## ensureCacheDir()

```javascript
ensureCacheDir()
```

* 确保缓存目录存在

---

## registerProtocolHandlers()

```javascript
registerProtocolHandlers()
```

* 注册P2P协议处理器

---

## async syncDeviceFileIndex(deviceId, options =

```javascript
async syncDeviceFileIndex(deviceId, options =
```

* 同步设备文件索引（支持增量同步）
   *
   * 从Android设备拉取文件索引列表，支持增量同步和分批处理。
   * 默认每批处理500个文件，自动处理多批次同步。
   *
   * @param {string} deviceId - 设备ID，用于标识要同步的Android设备
   * @param {Object} [options={}] - 同步选项
   * @param {boolean} [options.incremental=true] - 是否增量同步（仅同步上次同步后的变更）
   * @param {number} [options.limit=500] - 每批次文件数量
   * @param {Object} [options.filters] - 文件过滤条件
   * @param {string[]} [options.filters.category] - 文件分类过滤，如 ['DOCUMENT', 'IMAGE']
   * @param {number} [options.filters.since] - 时间戳，仅同步此时间后的文件
   *
   * @returns {Promise<Object>} 同步结果
   * @returns {boolean} return.success - 是否成功
   * @returns {number} return.totalSynced - 同步的文件总数
   * @returns {number} return.duration - 同步耗时（毫秒）
   * @returns {string} [return.error] - 错误信息（失败时）
   *
   * @throws {Error} 当设备已有同步任务在执行时抛出错误
   *
   * @example
   * // 首次全量同步
   * const result = await fileManager.syncDeviceFileIndex('android-device-1');
   *
   * @example
   * // 增量同步特定分类的文件
   * const result = await fileManager.syncDeviceFileIndex('android-device-1', {
   *   incremental: true,
   *   filters: { category: ['DOCUMENT', 'IMAGE'] }
   * });
   * console.log(`同步了 ${result.totalSynced} 个文件，耗时 ${result.duration}ms`);
   *
   * @fires ExternalDeviceFileManager#sync-progress
   * @fires ExternalDeviceFileManager#sync-completed
   * @fires ExternalDeviceFileManager#sync-error

---

## async sendIndexRequestAndWait(deviceId, request, retryOptions =

```javascript
async sendIndexRequestAndWait(deviceId, request, retryOptions =
```

* 发送索引请求并等待响应（带重试）
   *
   * @param {string} deviceId - 设备ID
   * @param {Object} request - 请求对象
   * @param {Object} [retryOptions] - 重试选项
   * @returns {Promise<Object>} 响应对象

---

## async handleIndexResponse(data)

```javascript
async handleIndexResponse(data)
```

* 处理索引响应
   * @param {Object} data - 响应数据

---

## async handleIndexChanged(data)

```javascript
async handleIndexChanged(data)
```

* 处理索引变更通知
   * @param {Object} data - 通知数据

---

## async updateLocalIndex(deviceId, files)

```javascript
async updateLocalIndex(deviceId, files)
```

* 更新本地索引
   * @param {string} deviceId - 设备ID
   * @param {Array} files - 文件列表

---

## async getDeviceFiles(deviceId, options =

```javascript
async getDeviceFiles(deviceId, options =
```

* 获取指定设备的文件列表
   *
   * 从本地索引中查询指定Android设备的文件列表，支持多种过滤、排序、
   * 搜索和分页功能。返回的文件列表会自动解析metadata和tags字段。
   *
   * @param {string} deviceId - 设备ID，用于标识Android设备
   * @param {Object} [options={}] - 查询选项
   * @param {string|Array<string>} [options.category] - 分类过滤，单个或多个分类
   * @param {string} [options.syncStatus] - 同步状态过滤：'pending'|'syncing'|'synced'|'error'
   * @param {boolean} [options.isCached] - 缓存状态过滤：true仅已缓存|false仅未缓存
   * @param {boolean} [options.isFavorite] - 收藏状态过滤：true仅收藏|false仅非收藏
   * @param {string} [options.search] - 文件名搜索关键词（模糊匹配）
   * @param {string} [options.orderBy='indexed_at'] - 排序字段
   * @param {string} [options.orderDir='DESC'] - 排序方向：'ASC'|'DESC'
   * @param {number} [options.limit] - 返回数量限制
   * @param {number} [options.offset] - 分页偏移量
   *
   * @returns {Promise<Array<Object>>} 文件列表
   * @returns {string} [].id - 文件ID（格式：{deviceId}_{fileId}）
   * @returns {string} [].device_id - 设备ID
   * @returns {string} [].file_id - 文件在源设备上的ID
   * @returns {string} [].display_name - 文件名
   * @returns {string} [].file_path - 文件在源设备上的路径
   * @returns {string} [].mime_type - MIME类型
   * @returns {number} [].file_size - 文件大小（字节）
   * @returns {string} [].category - 文件分类
   * @returns {number} [].last_modified - 文件最后修改时间戳
   * @returns {number} [].indexed_at - 索引到本地的时间戳
   * @returns {boolean} [].is_cached - 是否已缓存到本地
   * @returns {string} [].cache_path - 本地缓存路径（已缓存时）
   * @returns {string} [].checksum - SHA256校验和
   * @returns {Object} [].metadata - 元数据对象（已解析）
   * @returns {string} [].sync_status - 同步状态
   * @returns {number} [].last_access - 最后访问时间（用于LRU）
   * @returns {boolean} [].is_favorite - 是否收藏
   * @returns {Array<string>} [].tags - 标签数组（已解析）
   *
   * @throws {Error} 数据库查询失败时抛出错误
   *
   * @example
   * // 基本用法：获取设备的所有文件
   * const files = await fileManager.getDeviceFiles('android-device-1');
   * console.log(`设备有 ${files.length} 个文件`);
   *
   * @example
   * // 获取文档和图片文件
   * const mediaFiles = await fileManager.getDeviceFiles('android-device-1', {
   *   category: ['DOCUMENT', 'IMAGE']
   * });
   *
   * @example
   * // 获取已缓存的文件
   * const cachedFiles = await fileManager.getDeviceFiles('android-device-1', {
   *   isCached: true
   * });
   *
   * @example
   * // 分页获取文件（按文件大小降序）
   * const largFiles = await fileManager.getDeviceFiles('android-device-1', {
   *   orderBy: 'file_size',
   *   orderDir: 'DESC',
   *   limit: 20,
   *   offset: 0
   * });
   *
   * @example
   * // 搜索包含"report"的文档文件
   * const reports = await fileManager.getDeviceFiles('android-device-1', {
   *   category: 'DOCUMENT',
   *   search: 'report'
   * });
   *
   * @description
   * **查询特性**:
   * - 支持多条件组合过滤
   * - 支持单个或多个分类过滤
   * - 支持文件名模糊搜索
   * - 支持灵活的排序和分页
   * - 自动解析JSON字段（metadata、tags）
   *
   * **常用排序字段**:
   * - indexed_at: 索引时间（默认）
   * - last_modified: 文件修改时间
   * - file_size: 文件大小
   * - display_name: 文件名（字母序）
   * - last_access: 访问时间
   *
   * **应用场景**:
   * - 文件浏览器主列表
   * - 分类筛选
   * - 缓存管理界面
   * - 收藏夹
   *
   * **注意事项**:
   * - 仅返回本地索引中的文件，需先执行syncDeviceFileIndex()
   * - metadata和tags字段自动从JSON字符串解析为对象/数组
   * - 未指定limit时返回所有匹配的文件（可能很多）

---

## async pullFile(fileId, options =

```javascript
async pullFile(fileId, options =
```

* 拉取文件到本地缓存（支持安全验证和LRU缓存管理）
   *
   * 从Android设备下载文件到本地缓存目录，包含完整的安全验证、缓存管理、
   * 文件完整性校验等功能。如果文件已缓存则直接返回，否则执行拉取流程。
   *
   * @param {string} fileId - 文件ID，格式为 "{deviceId}_{fileId}"
   * @param {Object} [options={}] - 拉取选项
   * @param {boolean} [options.cache=true] - 是否缓存到本地（false时为临时下载）
   * @param {string} [options.priority='normal'] - 传输优先级：'low' | 'normal' | 'high'
   *
   * @returns {Promise<Object>} 拉取结果
   * @returns {boolean} return.success - 是否成功
   * @returns {boolean} [return.cached] - 是否使用缓存（文件已缓存时为true）
   * @returns {string} return.cachePath - 本地缓存路径
   * @returns {number} [return.duration] - 拉取耗时（毫秒，仅新下载时）
   *
   * @throws {Error} 文件不存在时抛出 "File not found"
   * @throws {Error} 安全验证失败时抛出 "文件安全验证失败: ..."
   * @throws {Error} 拉取被拒绝时抛出 "File pull rejected"
   * @throws {Error} 文件校验失败时抛出 "File verification failed"
   *
   * @example
   * // 基本用法：拉取文件
   * try {
   *   const result = await fileManager.pullFile('android-1_file123');
   *   console.log(`文件已缓存到: ${result.cachePath}`);
   *   if (result.cached) {
   *     console.log('使用已有缓存');
   *   } else {
   *     console.log(`下载耗时: ${result.duration}ms`);
   *   }
   * } catch (error) {
   *   console.error('拉取失败:', error.message);
   * }
   *
   * @example
   * // 高优先级拉取（用于紧急文件）
   * const result = await fileManager.pullFile('android-1_urgent_doc', {
   *   priority: 'high'
   * });
   *
   * @example
   * // 临时下载（不缓存）
   * const result = await fileManager.pullFile('android-1_temp_file', {
   *   cache: false
   * });
   *
   * @fires ExternalDeviceFileManager#file-pulled - 拉取成功时触发
   * @fires ExternalDeviceFileManager#file-pull-error - 拉取失败时触发
   *
   * @description
   * **执行流程**:
   * 1. 查询文件信息
   * 2. 执行安全验证（文件类型、大小、扩展名等）
   * 3. 检查是否已缓存（已缓存则直接返回）
   * 4. 执行LRU缓存淘汰（如需空间）
   * 5. 发送文件拉取请求到Android设备
   * 6. 接收文件分块并组装
   * 7. 验证文件完整性（SHA256校验）
   * 8. 更新数据库和性能指标
   *
   * **安全特性**:
   * - MIME类型白名单验证
   * - 危险扩展名检测（.exe, .bat, .sh等）
   * - 文件大小限制（最大500MB）
   * - 文件名特殊字符检查
   * - SHA256完整性校验
   *
   * **性能优化**:
   * - 自动缓存命中检测
   * - LRU缓存淘汰策略
   * - 分块传输（64KB/块）
   * - 传输性能指标记录

---

## async sendFilePullRequestAndWait(deviceId, request, retryOptions =

```javascript
async sendFilePullRequestAndWait(deviceId, request, retryOptions =
```

* 发送文件拉取请求并等待响应（带重试）
   *
   * @param {string} deviceId - 设备ID
   * @param {Object} request - 请求对象
   * @param {Object} [retryOptions] - 重试选项
   * @returns {Promise<Object>} 响应对象

---

## async handleFilePullResponse(data)

```javascript
async handleFilePullResponse(data)
```

* 处理文件拉取响应
   * @param {Object} data - 响应数据

---

## handleTransferProgress(data)

```javascript
handleTransferProgress(data)
```

* 处理传输进度
   * @param {Object} data - 进度数据

---

## async handleTransferComplete(data)

```javascript
async handleTransferComplete(data)
```

* 处理传输完成
   * @param {Object} data - 完成数据

---

## handleTransferError(data)

```javascript
handleTransferError(data)
```

* 处理传输错误
   * @param {Object} data - 错误数据

---

## async importToRAG(fileId, options =

```javascript
async importToRAG(fileId, options =
```

* 导入文件到RAG知识库系统
   *
   * 将外部设备文件导入到RAG（Retrieval-Augmented Generation）知识库，
   * 用于AI分析和语义检索。如果文件未缓存，会自动先拉取文件。
   *
   * @param {string} fileId - 文件ID，格式为 "{deviceId}_{fileId}"
   * @param {Object} [options={}] - 导入选项
   * @param {string} [options.title] - 自定义文档标题（默认使用文件名）
   * @param {Object} [options.metadata] - 自定义元数据
   * @param {boolean} [options.autoChunk=true] - 是否自动分块（大文件）
   * @param {number} [options.chunkSize=1000] - 分块大小（字符数）
   *
   * @returns {Promise<Object>} 导入结果
   * @returns {boolean} return.success - 是否成功
   * @returns {string} return.fileId - 文件ID
   * @returns {string} return.fileName - 文件名
   * @returns {string} return.ragId - RAG文档ID
   *
   * @throws {Error} 文件不存在时抛出 "File not found"
   * @throws {Error} 文件拉取失败时抛出相应错误
   * @throws {Error} RAG导入失败时抛出相应错误
   *
   * @example
   * // 基本用法：导入文档到RAG
   * const result = await fileManager.importToRAG('android-1_document.pdf');
   * console.log(`文档 ${result.fileName} 已导入RAG系统`);
   *
   * @example
   * // 自定义导入选项
   * const result = await fileManager.importToRAG('android-1_paper.pdf', {
   *   title: '研究论文：AI技术综述',
   *   metadata: {
   *     author: 'John Doe',
   *     category: 'research',
   *     tags: ['AI', 'Machine Learning']
   *   },
   *   chunkSize: 1500  // 较大的分块用于长文档
   * });
   *
   * @fires ExternalDeviceFileManager#file-imported - 导入成功时触发
   *
   * @description
   * **执行流程**:
   * 1. 查询文件信息
   * 2. 检查文件是否已缓存，未缓存则自动拉取
   * 3. 调用RAG系统API导入文件
   * 4. 触发导入完成事件
   *
   * **支持的文件类型**:
   * - 文本文件: .txt, .md, .csv
   * - 文档: .pdf, .doc, .docx
   * - 代码文件: .js, .py, .java, .kt等
   *
   * **RAG系统功能**:
   * - 自动文本提取
   * - 语义分块和向量化
   * - 支持语义搜索和AI问答
   *
   * **注意事项**:
   * - RAG集成已完成，支持文本文件和部分二进制文件
   * - 大文件（>10MB）会自动分块处理
   * - 图片文件可能需要OCR识别（如已集成）
   * - 二进制文件（如PDF）会使用元数据代替内容

---

## async importToProject(fileId, projectId, options =

```javascript
async importToProject(fileId, projectId, options =
```

* 导入文件到指定项目
   *
   * 将外部设备文件复制到项目文件目录，并在数据库中创建project_files记录。
   * 如果文件未缓存，会自动先拉取文件。文件名会添加时间戳后缀以避免冲突。
   *
   * @param {string} fileId - 文件ID，格式为 "{deviceId}_{fileId}"
   * @param {string} projectId - 目标项目ID
   * @param {Object} [options={}] - 导入选项
   * @param {string} [options.targetName] - 自定义目标文件名（不含扩展名）
   * @param {boolean} [options.keepOriginalName=false] - 保持原文件名（可能冲突）
   * @param {Object} [options.metadata] - 附加元数据
   *
   * @returns {Promise<Object>} 导入结果
   * @returns {boolean} return.success - 是否成功
   * @returns {string} return.fileId - 源文件ID
   * @returns {string} return.projectId - 项目ID
   * @returns {string} return.projectFileId - 新创建的项目文件ID
   * @returns {string} return.fileName - 文件名
   * @returns {string} return.filePath - 项目文件路径
   *
   * @throws {Error} 文件不存在时抛出 "File not found"
   * @throws {Error} 项目不存在时抛出 "Project not found"
   * @throws {Error} 文件拉取失败时抛出相应错误
   * @throws {Error} 文件复制失败时抛出相应错误
   *
   * @example
   * // 基本用法：导入文件到项目
   * const result = await fileManager.importToProject(
   *   'android-1_design.png',
   *   'project-123'
   * );
   * console.log(`文件已导入: ${result.filePath}`);
   * console.log(`项目文件ID: ${result.projectFileId}`);
   *
   * @example
   * // 自定义文件名和元数据
   * const result = await fileManager.importToProject(
   *   'android-1_screenshot.jpg',
   *   'project-456',
   *   {
   *     targetName: 'app-ui-mockup',  // 将被重命名为 app-ui-mockup_<timestamp>.jpg
   *     metadata: {
   *       version: '1.0',
   *       contributor: 'Designer Team'
   *     }
   *   }
   * );
   *
   * @fires ExternalDeviceFileManager#file-imported-to-project - 导入成功时触发
   *
   * @description
   * **执行流程**:
   * 1. 查询文件信息
   * 2. 检查文件是否已缓存，未缓存则自动拉取
   * 3. 验证项目是否存在
   * 4. 创建项目文件目录（如不存在）
   * 5. 生成唯一文件名（避免冲突）
   * 6. 复制文件到项目目录
   * 7. 在数据库中创建project_files记录
   * 8. 触发导入完成事件
   *
   * **文件路径结构**:
   * ```
   * data/projects/{projectId}/files/{fileName}_{timestamp}.{ext}
   * ```
   *
   * **project_files记录**:
   * - id: 新生成的UUID
   * - project_id: 目标项目ID
   * - file_name: 原文件名
   * - file_path: 项目中的完整路径
   * - file_type: MIME类型
   * - file_size: 文件大小
   * - source: 'external-device'
   * - metadata: 包含设备ID、原文件ID、分类等信息
   *
   * **应用场景**:
   * - 从手机导入项目资源（图片、文档）
   * - 从平板导入设计稿到开发项目
   * - 从Android设备导入测试数据

---

## async evictLRUCacheFiles(requiredSpace)

```javascript
async evictLRUCacheFiles(requiredSpace)
```

* LRU（Least Recently Used）缓存淘汰策略
   *
   * 根据LRU算法淘汰最近最少使用的缓存文件，释放指定大小的存储空间。
   * 淘汰顺序基于last_access时间戳，优先删除最久未访问的文件。
   *
   * @param {number} requiredSpace - 需要释放的空间大小（字节）
   *
   * @returns {Promise<Object>} 淘汰结果
   * @returns {number} return.evictedCount - 淘汰的文件数量
   * @returns {number} return.freedSpace - 实际释放的空间大小（字节）
   *
   * @throws {Error} 数据库操作失败时抛出错误
   *
   * @example
   * // 释放100MB空间
   * const result = await fileManager.evictLRUCacheFiles(100 * 1024 * 1024);
   * console.log(`淘汰了 ${result.evictedCount} 个文件`);
   * console.log(`释放了 ${(result.freedSpace / 1024 / 1024).toFixed(2)} MB空间`);
   *
   * @example
   * // 在拉取大文件前确保空间充足
   * const fileSize = 500 * 1024 * 1024; // 500MB
   * const currentSize = await fileManager.getCurrentCacheSize();
   * const maxSize = fileManager.options.maxCacheSize;
   *
   * if (currentSize + fileSize > maxSize) {
   *   const spaceNeeded = currentSize + fileSize - maxSize;
   *   await fileManager.evictLRUCacheFiles(spaceNeeded);
   * }
   *
   * @description
   * **执行流程**:
   * 1. 查询所有缓存文件，按last_access升序排序
   * 2. 从最久未访问的文件开始逐个删除
   * 3. 删除物理文件
   * 4. 更新数据库记录（is_cached=0, cache_path=NULL）
   * 5. 累计释放空间，达到requiredSpace时停止
   * 6. 记录性能指标
   *
   * **LRU算法特点**:
   * - 保留最近访问的文件（高频使用文件）
   * - 淘汰长期未使用的文件（低频使用文件）
   * - 自动适应用户使用习惯
   * - 最大化缓存命中率
   *
   * **安全性**:
   * - 删除失败不影响继续淘汰
   * - 数据库记录与物理文件同步更新
   * - 即使物理文件已被手动删除也能正常处理
   *
   * **性能监控**:
   * - 自动记录淘汰次数和释放空间
   * - 可通过getPerformanceStats()查看统计
   *
   * **注意事项**:
   * - 文件被淘汰后需要重新拉取才能使用
   * - 收藏文件也可能被淘汰（根据访问时间）
   * - 建议定期执行cleanupExpiredCache()清理过期缓存

---

## async ensureCacheSpace(requiredSpace)

```javascript
async ensureCacheSpace(requiredSpace)
```

* 确保缓存空间充足
   * @param {number} requiredSpace - 需要的空间（字节）

---

## async getCurrentCacheSize()

```javascript
async getCurrentCacheSize()
```

* 获取当前缓存大小
   * @returns {Promise<number>} 缓存大小（字节）

---

## async verifyFileCached(filePath, expectedChecksum)

```javascript
async verifyFileCached(filePath, expectedChecksum)
```

* 验证缓存文件
   * @param {string} filePath - 文件路径
   * @param {string} expectedChecksum - 期望的校验和
   * @returns {Promise<boolean>} 是否有效

---

## async createTransferTask(task)

```javascript
async createTransferTask(task)
```

* 创建传输任务记录
   * @param {Object} task - 任务信息
   * @returns {Promise<string>} 任务ID

---

## async updateTransferTask(taskId, updates)

```javascript
async updateTransferTask(taskId, updates)
```

* 更新传输任务
   * @param {string} taskId - 任务ID
   * @param {Object} updates - 更新字段

---

## async logSyncActivity(deviceId, log)

```javascript
async logSyncActivity(deviceId, log)
```

* 记录同步活动
   * @param {string} deviceId - 设备ID
   * @param {Object} log - 日志信息

---

## async getLastSyncTime(deviceId)

```javascript
async getLastSyncTime(deviceId)
```

* 获取上次同步时间
   * @param {string} deviceId - 设备ID
   * @returns {Promise<number>} 上次同步时间戳

---

## async updateLastSyncTime(deviceId, timestamp)

```javascript
async updateLastSyncTime(deviceId, timestamp)
```

* 更新上次同步时间
   * @param {string} deviceId - 设备ID
   * @param {number} timestamp - 时间戳

---

## async searchFiles(query, options =

```javascript
async searchFiles(query, options =
```

* 搜索外部设备文件
   *
   * 根据文件名关键词搜索外部设备文件索引，支持设备过滤、分类过滤、
   * 排序和分页等高级搜索功能。
   *
   * @param {string} query - 搜索关键词（文件名模糊匹配）
   * @param {Object} [options={}] - 搜索选项
   * @param {string} [options.deviceId] - 设备ID过滤（仅搜索特定设备）
   * @param {string} [options.category] - 分类过滤：'DOCUMENT'|'IMAGE'|'VIDEO'|'AUDIO'|'CODE'|'OTHER'
   * @param {number} [options.limit=50] - 返回结果数量限制
   * @param {number} [options.offset=0] - 分页偏移量
   *
   * @returns {Promise<Array<Object>>} 搜索结果列表
   * @returns {string} [].id - 文件ID
   * @returns {string} [].display_name - 文件名
   * @returns {string} [].device_id - 设备ID
   * @returns {string} [].mime_type - MIME类型
   * @returns {number} [].file_size - 文件大小（字节）
   * @returns {string} [].category - 文件分类
   * @returns {number} [].last_modified - 最后修改时间戳
   * @returns {boolean} [].is_cached - 是否已缓存
   * @returns {Object} [].metadata - 元数据对象（已解析）
   * @returns {Array<string>} [].tags - 标签数组（已解析）
   *
   * @throws {Error} 数据库查询失败时抛出错误
   *
   * @example
   * // 基本搜索：查找包含"report"的文件
   * const files = await fileManager.searchFiles('report');
   * console.log(`找到 ${files.length} 个文件`);
   * files.forEach(f => console.log(f.display_name));
   *
   * @example
   * // 高级搜索：在特定设备中搜索图片文件
   * const photos = await fileManager.searchFiles('vacation', {
   *   deviceId: 'android-device-1',
   *   category: 'IMAGE',
   *   limit: 20
   * });
   *
   * @example
   * // 分页搜索：获取第2页结果（每页10个）
   * const page2 = await fileManager.searchFiles('document', {
   *   limit: 10,
   *   offset: 10  // 跳过前10个
   * });
   *
   * @description
   * **搜索特点**:
   * - 文件名模糊匹配（使用SQL LIKE %query%）
   * - 支持中文、英文文件名搜索
   * - 自动解析metadata和tags字段
   * - 按索引时间倒序排序（最新的在前）
   *
   * **性能优化**:
   * - 使用数据库索引加速搜索
   * - 默认限制50个结果避免过载
   * - 支持分页查询大量结果
   *
   * **应用场景**:
   * - UI搜索框实时搜索
   * - 文件浏览器过滤功能
   * - 批量文件操作选择
   *
   * **注意事项**:
   * - 搜索仅限已同步到本地索引的文件
   * - 需先执行syncDeviceFileIndex()同步索引
   * - 大小写不敏感（SQL LIKE默认行为）

---

## async cancelTransfer(transferId)

```javascript
async cancelTransfer(transferId)
```

* 取消传输任务
   * @param {string} transferId - 传输ID

---

## async getTransferProgress(transferId)

```javascript
async getTransferProgress(transferId)
```

* 获取传输进度
   * @param {string} transferId - 传输ID
   * @returns {Promise<Object>} 传输进度

---

## async cleanupExpiredCache(expiry)

```javascript
async cleanupExpiredCache(expiry)
```

* 清理过期缓存
   * @param {number} expiry - 过期时间（毫秒）

---

## getPerformanceStats()

```javascript
getPerformanceStats()
```

* 获取性能统计信息
   * @returns {Object} 性能统计数据

---

## getRecentTransfers(limit = 10)

```javascript
getRecentTransfers(limit = 10)
```

* 获取最近的传输记录
   * @param {number} limit - 返回数量限制
   * @returns {Array} 传输记录

---

## getRecentSyncs(limit = 10)

```javascript
getRecentSyncs(limit = 10)
```

* 获取最近的同步记录
   * @param {number} limit - 返回数量限制
   * @returns {Array} 同步记录

---

## generatePerformanceReport()

```javascript
generatePerformanceReport()
```

* 生成性能报告
   * @returns {string} 性能报告文本

---

## resetPerformanceMetrics()

```javascript
resetPerformanceMetrics()
```

* 重置性能统计

---

## getRetryStats()

```javascript
getRetryStats()
```

* 获取重试统计信息
   *
   * @returns {Object} 重试统计数据
   * @returns {number} return.totalRetries - 总重试次数
   * @returns {number} return.successAfterRetry - 重试成功次数
   * @returns {number} return.failedAfterRetry - 重试失败次数
   * @returns {number} return.successRate - 重试成功率（百分比）
   * @returns {Object} return.retriesByType - 按操作类型分类的重试次数
   *
   * @example
   * const stats = fileManager.getRetryStats();
   * console.log(`总重试次数: ${stats.totalRetries}`);
   * console.log(`重试成功率: ${stats.successRate.toFixed(2)}%`);

---

## resetRetryStats()

```javascript
resetRetryStats()
```

* 重置重试统计

---

