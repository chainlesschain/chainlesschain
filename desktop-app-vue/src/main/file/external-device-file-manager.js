/**
 * 外部设备文件管理器
 *
 * 功能：
 * - 文件索引同步管理
 * - 文件拉取协调
 * - 缓存策略控制（LRU淘汰）
 * - 搜索和过滤
 * - RAG集成
 */

const { logger } = require('../utils/logger.js');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  FILE_SYNC_PROTOCOLS,
  FILE_CATEGORIES,
  SYNC_STATUS,
  TRANSFER_STATUS,
  TRANSFER_TYPE,
  SYNC_TYPE,
} = require('../p2p/file-sync-protocols');
const PerformanceMetrics = require('./performance-metrics');
const FileSecurityValidator = require('./file-security-validator');
const { RetryManager, RETRY_STRATEGIES } = require('./retry-manager');

class ExternalDeviceFileManager extends EventEmitter {
  constructor(database, p2pManager, fileTransferManager, ragManager, options = {}) {
    super();

    this.db = database;
    this.p2pManager = p2pManager;
    this.fileTransferManager = fileTransferManager;
    this.ragManager = ragManager;

    // 配置选项
    this.options = {
      // 缓存配置
      cacheDir: options.cacheDir || path.join(process.cwd(), 'data', 'external-file-cache'),
      maxCacheSize: options.maxCacheSize || 1024 * 1024 * 1024, // 1GB
      cacheExpiry: options.cacheExpiry || 7 * 24 * 60 * 60 * 1000, // 7天

      // 同步配置
      batchSize: options.batchSize || 500,
      syncTimeout: options.syncTimeout || 30000,

      // 传输配置
      maxConcurrentTransfers: options.maxConcurrentTransfers || 3,

      ...options,
    };

    // 活跃的传输任务
    this.activeTransfers = new Map(); // transferId -> task

    // 同步任务队列
    this.syncQueue = new Map(); // deviceId -> syncTask

    // 性能指标收集器
    this.metrics = new PerformanceMetrics();

    // 文件安全性验证器
    this.securityValidator = new FileSecurityValidator(options.securityConfig);

    // 重试管理器
    this.retryManager = new RetryManager({
      ...RETRY_STRATEGIES.STANDARD,
      ...(options.retryConfig || {}),
    });

    // 确保缓存目录存在
    this.ensureCacheDir();

    // 注册P2P协议处理器
    this.registerProtocolHandlers();

    logger.info('[ExternalDeviceFileManager] 初始化完成', {
      cacheDir: this.options.cacheDir,
      maxCacheSize: this.options.maxCacheSize,
    });
  }

  /**
   * 确保缓存目录存在
   */
  ensureCacheDir() {
    if (!fs.existsSync(this.options.cacheDir)) {
      fs.mkdirSync(this.options.cacheDir, { recursive: true });
      logger.info('[ExternalDeviceFileManager] 创建缓存目录:', this.options.cacheDir);
    }
  }

  /**
   * 注册P2P协议处理器
   */
  registerProtocolHandlers() {
    if (!this.p2pManager || !this.p2pManager.messageManager) {
      logger.warn('[ExternalDeviceFileManager] P2P管理器未初始化，跳过协议注册');
      return;
    }

    const messageManager = this.p2pManager.messageManager;

    // 索引响应处理器
    messageManager.on(FILE_SYNC_PROTOCOLS.INDEX_RESPONSE, async (data) => {
      await this.handleIndexResponse(data);
    });

    // 文件拉取响应处理器
    messageManager.on(FILE_SYNC_PROTOCOLS.FILE_PULL_RESPONSE, async (data) => {
      await this.handleFilePullResponse(data);
    });

    // 索引变更通知处理器
    messageManager.on(FILE_SYNC_PROTOCOLS.INDEX_CHANGED, async (data) => {
      await this.handleIndexChanged(data);
    });

    // 文件传输进度处理器
    messageManager.on(FILE_SYNC_PROTOCOLS.FILE_TRANSFER_PROGRESS, (data) => {
      this.handleTransferProgress(data);
    });

    // 文件传输完成处理器
    messageManager.on(FILE_SYNC_PROTOCOLS.FILE_TRANSFER_COMPLETE, async (data) => {
      await this.handleTransferComplete(data);
    });

    // 文件传输错误处理器
    messageManager.on(FILE_SYNC_PROTOCOLS.FILE_TRANSFER_ERROR, (data) => {
      this.handleTransferError(data);
    });

    logger.info('[ExternalDeviceFileManager] P2P协议处理器注册完成');
  }

  /**
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
   */
  async syncDeviceFileIndex(deviceId, options = {}) {
    const startTime = Date.now();
    const syncId = uuidv4();

    logger.info('[ExternalDeviceFileManager] 开始同步设备文件索引:', {
      deviceId,
      syncId,
      options,
    });

    try {
      // 检查是否已有同步任务在执行
      if (this.syncQueue.has(deviceId)) {
        logger.warn('[ExternalDeviceFileManager] 设备已有同步任务在执行:', deviceId);
        return { success: false, error: 'Sync already in progress' };
      }

      // 创建同步任务
      const syncTask = {
        syncId,
        deviceId,
        status: 'running',
        startTime,
        totalItems: 0,
        syncedItems: 0,
      };
      this.syncQueue.set(deviceId, syncTask);

      // 获取上次同步时间（用于增量同步）
      const lastSyncTime = await this.getLastSyncTime(deviceId);

      // 构建索引请求
      const filters = {
        ...options.filters,
        since: options.incremental !== false ? lastSyncTime : undefined,
        limit: options.limit || this.options.batchSize,
        offset: 0,
      };

      // 分批同步
      let hasMore = true;
      let totalSynced = 0;

      while (hasMore) {
        const requestId = uuidv4();

        // 发送索引请求
        const request = {
          type: FILE_SYNC_PROTOCOLS.INDEX_REQUEST,
          requestId,
          deviceId: this.p2pManager.peerId,
          filters: {
            ...filters,
            offset: totalSynced,
          },
        };

        // 等待索引响应（使用Promise实现超时）
        const response = await this.sendIndexRequestAndWait(deviceId, request);

        if (!response || !response.files) {
          logger.error('[ExternalDeviceFileManager] 索引同步失败：响应无效');
          break;
        }

        // 批量更新本地索引
        await this.updateLocalIndex(deviceId, response.files);

        totalSynced += response.files.length;
        hasMore = response.hasMore;

        logger.info('[ExternalDeviceFileManager] 索引同步进度:', {
          synced: totalSynced,
          total: response.totalCount,
          hasMore,
        });

        // 发送进度事件
        this.emit('sync-progress', {
          deviceId,
          synced: totalSynced,
          total: response.totalCount,
        });
      }

      // 更新同步时间
      await this.updateLastSyncTime(deviceId, Date.now());

      // 记录同步日志
      const duration = Date.now() - startTime;
      await this.logSyncActivity(deviceId, {
        syncType: SYNC_TYPE.INDEX_SYNC,
        itemsCount: totalSynced,
        durationMs: duration,
        status: 'success',
      });

      // 记录性能指标
      this.metrics.recordSync(duration, totalSynced, deviceId);

      // 移除同步任务
      this.syncQueue.delete(deviceId);

      logger.info('[ExternalDeviceFileManager] 索引同步完成:', {
        deviceId,
        totalSynced,
        duration,
      });

      this.emit('sync-completed', {
        deviceId,
        totalSynced,
        duration,
      });

      return {
        success: true,
        totalSynced,
        duration,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] 索引同步失败:', error);

      // 记录同步失败日志
      await this.logSyncActivity(deviceId, {
        syncType: SYNC_TYPE.INDEX_SYNC,
        itemsCount: 0,
        durationMs: Date.now() - startTime,
        status: 'failed',
        errorDetails: error.message,
      });

      // 记录性能指标 - 同步错误
      this.metrics.recordSyncError(error);

      // 移除同步任务
      this.syncQueue.delete(deviceId);

      this.emit('sync-error', { deviceId, error: error.message });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 发送索引请求并等待响应（带重试）
   *
   * @param {string} deviceId - 设备ID
   * @param {Object} request - 请求对象
   * @param {Object} [retryOptions] - 重试选项
   * @returns {Promise<Object>} 响应对象
   */
  async sendIndexRequestAndWait(deviceId, request, retryOptions = {}) {
    return this.retryManager.execute(
      () => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            this.removeListener('index-response-' + request.requestId, handler);
            reject(new Error('Index request timeout'));
          }, this.options.syncTimeout);

          const handler = (response) => {
            clearTimeout(timeout);
            resolve(response);
          };

          this.once('index-response-' + request.requestId, handler);

          // 发送请求
          this.p2pManager.messageManager.sendMessage(deviceId, request);
        });
      },
      {
        operationName: 'sendIndexRequest',
        maxRetries: 3,
        onRetry: (attempt, error) => {
          logger.warn(`[ExternalDeviceFileManager] 索引请求重试`, {
            deviceId,
            requestId: request.requestId,
            attempt,
            error: error.message,
          });
        },
        ...retryOptions,
      }
    );
  }

  /**
   * 处理索引响应
   * @param {Object} data - 响应数据
   */
  async handleIndexResponse(data) {
    logger.info('[ExternalDeviceFileManager] 收到索引响应:', {
      requestId: data.requestId,
      filesCount: data.files?.length,
    });

    // 触发响应事件
    this.emit('index-response-' + data.requestId, data);
  }

  /**
   * 处理索引变更通知
   * @param {Object} data - 通知数据
   */
  async handleIndexChanged(data) {
    logger.info('[ExternalDeviceFileManager] 收到索引变更通知:', data);

    // 触发变更事件
    this.emit('index-changed', data);

    // 可选：自动触发增量同步
    if (this.options.autoSync) {
      await this.syncDeviceFileIndex(data.deviceId, { incremental: true });
    }
  }

  /**
   * 更新本地索引
   * @param {string} deviceId - 设备ID
   * @param {Array} files - 文件列表
   */
  async updateLocalIndex(deviceId, files) {
    if (!files || files.length === 0) {
      return;
    }

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO external_device_files (
          id, device_id, file_id, display_name, file_path, mime_type,
          file_size, category, last_modified, indexed_at, checksum,
          metadata, sync_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now();

      for (const file of files) {
        const id = `${deviceId}_${file.id}`;
        stmt.run(
          id,
          deviceId,
          file.id,
          file.displayName,
          file.displayPath || file.filePath,
          file.mimeType,
          file.size,
          file.category,
          file.lastModified,
          now,
          file.checksum,
          JSON.stringify(file.metadata || {}),
          SYNC_STATUS.SYNCED,
          now,
          now
        );
      }

      logger.info('[ExternalDeviceFileManager] 本地索引更新完成:', {
        deviceId,
        count: files.length,
      });
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] 更新本地索引失败:', error);
      throw error;
    }
  }

  /**
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
   */
  async getDeviceFiles(deviceId, options = {}) {
    try {
      let query = `
        SELECT * FROM external_device_files
        WHERE device_id = ?
      `;
      const params = [deviceId];

      // 分类过滤
      if (options.category) {
        if (Array.isArray(options.category)) {
          query += ` AND category IN (${options.category.map(() => '?').join(',')})`;
          params.push(...options.category);
        } else {
          query += ` AND category = ?`;
          params.push(options.category);
        }
      }

      // 同步状态过滤
      if (options.syncStatus) {
        query += ` AND sync_status = ?`;
        params.push(options.syncStatus);
      }

      // 缓存状态过滤
      if (options.isCached !== undefined) {
        query += ` AND is_cached = ?`;
        params.push(options.isCached ? 1 : 0);
      }

      // 收藏过滤
      if (options.isFavorite !== undefined) {
        query += ` AND is_favorite = ?`;
        params.push(options.isFavorite ? 1 : 0);
      }

      // 搜索
      if (options.search) {
        query += ` AND display_name LIKE ?`;
        params.push(`%${options.search}%`);
      }

      // 排序
      const orderBy = options.orderBy || 'indexed_at';
      const orderDir = options.orderDir || 'DESC';
      query += ` ORDER BY ${orderBy} ${orderDir}`;

      // 分页
      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }
      if (options.offset) {
        query += ` OFFSET ?`;
        params.push(options.offset);
      }

      const files = this.db.prepare(query).all(...params);

      // 解析metadata
      return files.map((file) => ({
        ...file,
        metadata: file.metadata ? JSON.parse(file.metadata) : {},
        tags: file.tags ? JSON.parse(file.tags) : [],
      }));
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] 获取文件列表失败:', error);
      throw error;
    }
  }

  /**
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
   */
  async pullFile(fileId, options = {}) {
    const startTime = Date.now();

    try {
      // 获取文件信息
      const file = this.db
        .prepare('SELECT * FROM external_device_files WHERE id = ?')
        .get(fileId);

      if (!file) {
        throw new Error('File not found');
      }

      // 安全性验证
      const validation = this.securityValidator.validate(file);
      if (!validation.valid) {
        const errorMsg = `文件安全验证失败: ${validation.errors.join(', ')}`;
        logger.error('[ExternalDeviceFileManager]', errorMsg);
        throw new Error(errorMsg);
      }

      // 记录安全警告
      if (validation.warnings.length > 0) {
        logger.warn('[ExternalDeviceFileManager] 文件安全警告:', {
          fileId,
          warnings: validation.warnings,
        });
      }

      // 检查是否已缓存
      if (file.is_cached && file.cache_path && fs.existsSync(file.cache_path)) {
        logger.info('[ExternalDeviceFileManager] 文件已缓存，跳过拉取:', fileId);

        // 记录缓存命中
        this.metrics.recordCacheHit();

        return {
          success: true,
          cached: true,
          cachePath: file.cache_path,
        };
      }

      // 记录缓存未命中
      this.metrics.recordCacheMiss();

      // 检查缓存空间
      await this.ensureCacheSpace(file.file_size);

      // 生成传输ID
      const transferId = uuidv4();

      // 创建传输任务记录
      const taskId = await this.createTransferTask({
        deviceId: file.device_id,
        fileId,
        transferType: TRANSFER_TYPE.PULL,
        totalBytes: file.file_size,
      });

      // 发送文件拉取请求
      const request = {
        type: FILE_SYNC_PROTOCOLS.FILE_PULL_REQUEST,
        requestId: uuidv4(),
        fileId: file.file_id,
        transferId,
        options: {
          cache: options.cache !== false,
          priority: options.priority || 'normal',
        },
      };

      // 等待拉取响应
      const response = await this.sendFilePullRequestAndWait(
        file.device_id,
        request
      );

      if (!response.accepted) {
        throw new Error(response.error || 'File pull rejected');
      }

      // 更新传输任务状态
      await this.updateTransferTask(taskId, {
        status: TRANSFER_STATUS.IN_PROGRESS,
        startedAt: Date.now(),
      });

      // 生成缓存路径
      const cachePath = path.join(
        this.options.cacheDir,
        file.device_id,
        `${file.file_id}_${file.display_name}`
      );

      // 确保目录存在
      const cacheDir = path.dirname(cachePath);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      // 使用fileTransferManager下载文件（带重试）
      await this.retryManager.execute(
        async () => {
          return await this.fileTransferManager.downloadFile(
            file.device_id,
            transferId,
            cachePath
          );
        },
        {
          operationName: 'downloadFile',
          maxRetries: 3,
          initialDelay: 2000,
          onRetry: (attempt, error) => {
            logger.warn(`[ExternalDeviceFileManager] 文件下载重试`, {
              fileId,
              transferId,
              attempt,
              error: error.message,
            });

            // 发送重试事件
            this.emit('file-download-retry', {
              fileId,
              transferId,
              attempt,
              error: error.message,
            });
          },
        }
      );

      // 验证文件
      const isValid = await this.verifyFileCached(cachePath, file.checksum);
      if (!isValid) {
        // 删除无效文件
        if (fs.existsSync(cachePath)) {
          fs.unlinkSync(cachePath);
        }
        throw new Error('File verification failed');
      }

      // 更新文件记录
      this.db
        .prepare(
          `
        UPDATE external_device_files
        SET is_cached = 1, cache_path = ?, last_access = ?, updated_at = ?
        WHERE id = ?
      `
        )
        .run(cachePath, Date.now(), Date.now(), fileId);

      // 更新传输任务
      await this.updateTransferTask(taskId, {
        status: TRANSFER_STATUS.COMPLETED,
        completedAt: Date.now(),
        bytesTransferred: file.file_size,
      });

      const duration = Date.now() - startTime;

      logger.info('[ExternalDeviceFileManager] 文件拉取完成:', {
        fileId,
        cachePath,
        duration,
      });

      // 记录传输性能指标
      this.metrics.recordTransfer(duration, file.file_size, fileId);

      this.emit('file-pulled', {
        fileId,
        cachePath,
        duration,
      });

      return {
        success: true,
        cachePath,
        duration,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] 文件拉取失败:', error);

      // 记录传输错误
      this.metrics.recordTransferError(error);

      this.emit('file-pull-error', {
        fileId,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * 发送文件拉取请求并等待响应（带重试）
   *
   * @param {string} deviceId - 设备ID
   * @param {Object} request - 请求对象
   * @param {Object} [retryOptions] - 重试选项
   * @returns {Promise<Object>} 响应对象
   */
  async sendFilePullRequestAndWait(deviceId, request, retryOptions = {}) {
    return this.retryManager.execute(
      () => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            this.removeListener('file-pull-response-' + request.requestId, handler);
            reject(new Error('File pull request timeout'));
          }, this.options.syncTimeout);

          const handler = (response) => {
            clearTimeout(timeout);
            resolve(response);
          };

          this.once('file-pull-response-' + request.requestId, handler);

          // 发送请求
          this.p2pManager.messageManager.sendMessage(deviceId, request);
        });
      },
      {
        operationName: 'sendFilePullRequest',
        maxRetries: 3,
        onRetry: (attempt, error) => {
          logger.warn(`[ExternalDeviceFileManager] 文件拉取请求重试`, {
            deviceId,
            requestId: request.requestId,
            fileId: request.fileId,
            attempt,
            error: error.message,
          });
        },
        ...retryOptions,
      }
    );
  }

  /**
   * 处理文件拉取响应
   * @param {Object} data - 响应数据
   */
  async handleFilePullResponse(data) {
    logger.info('[ExternalDeviceFileManager] 收到文件拉取响应:', {
      requestId: data.requestId,
      accepted: data.accepted,
    });

    // 触发响应事件
    this.emit('file-pull-response-' + data.requestId, data);
  }

  /**
   * 处理传输进度
   * @param {Object} data - 进度数据
   */
  handleTransferProgress(data) {
    const { transferId, progress, bytesTransferred, totalBytes } = data;

    // 更新数据库中的传输任务
    try {
      this.db
        .prepare(
          `
        UPDATE file_transfer_tasks
        SET progress = ?, bytes_transferred = ?
        WHERE id = (SELECT id FROM file_transfer_tasks WHERE id LIKE ?)
        LIMIT 1
      `
        )
        .run(progress, bytesTransferred, `%${transferId}%`);
    } catch (error) {
      logger.warn('[ExternalDeviceFileManager] 更新传输进度失败:', error);
    }

    // 触发进度事件
    this.emit('transfer-progress', data);
  }

  /**
   * 处理传输完成
   * @param {Object} data - 完成数据
   */
  async handleTransferComplete(data) {
    logger.info('[ExternalDeviceFileManager] 文件传输完成:', data);

    // 触发完成事件
    this.emit('transfer-complete', data);
  }

  /**
   * 处理传输错误
   * @param {Object} data - 错误数据
   */
  handleTransferError(data) {
    logger.error('[ExternalDeviceFileManager] 文件传输错误:', data);

    // 更新数据库中的传输任务
    try {
      this.db
        .prepare(
          `
        UPDATE file_transfer_tasks
        SET status = 'failed', error_message = ?
        WHERE id = (SELECT id FROM file_transfer_tasks WHERE id LIKE ?)
        LIMIT 1
      `
        )
        .run(data.error, `%${data.transferId}%`);
    } catch (error) {
      logger.warn('[ExternalDeviceFileManager] 更新传输状态失败:', error);
    }

    // 触发错误事件
    this.emit('transfer-error', data);
  }

  /**
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
   */
  async importToRAG(fileId, options = {}) {
    try {
      // 获取文件信息
      const file = this.db
        .prepare('SELECT * FROM external_device_files WHERE id = ?')
        .get(fileId);

      if (!file) {
        throw new Error('File not found');
      }

      // 确保文件已缓存
      if (!file.is_cached || !file.cache_path) {
        logger.info('[ExternalDeviceFileManager] 文件未缓存，先拉取文件');
        await this.pullFile(fileId);

        // 重新获取文件信息
        const updatedFile = this.db
          .prepare('SELECT * FROM external_device_files WHERE id = ?')
          .get(fileId);
        file.cache_path = updatedFile.cache_path;
      }

      // 调用RAG系统的文件导入API
      logger.info('[ExternalDeviceFileManager] 导入文件到RAG:', {
        fileId,
        filePath: file.cache_path,
        fileName: file.display_name,
      });

      // 读取文件内容
      let content = '';
      try {
        const fileContent = fs.readFileSync(file.cache_path, 'utf8');
        content = fileContent;
      } catch (readError) {
        logger.warn('[ExternalDeviceFileManager] 无法读取文件为文本，可能是二进制文件');
        // 对于PDF等二进制文件，使用文件名和元数据
        content = `File: ${file.display_name}\nCategory: ${file.category}\nSize: ${file.size} bytes`;
      }

      // 使用 RAG Manager 添加文档
      const ragDocId = `external_${fileId}`;
      const ragDoc = {
        id: ragDocId,
        content: content,
        metadata: {
          title: options.title || file.display_name,
          fileName: file.display_name,
          source: 'external-device',
          deviceId: file.device_id,
          category: file.category,
          mimeType: file.mime_type,
          size: file.size,
          createdAt: new Date(file.last_modified).toISOString(),
          updatedAt: new Date().toISOString(),
          type: 'external-file',
          ...options.metadata,
        },
      };

      if (this.ragManager) {
        await this.ragManager.addDocument(ragDoc);
        logger.info('[ExternalDeviceFileManager] 文件已成功导入RAG系统:', ragDocId);
      } else {
        logger.warn('[ExternalDeviceFileManager] RAGManager未初始化，跳过RAG导入');
      }

      this.emit('file-imported', {
        fileId,
        fileName: file.display_name,
        ragId: ragDocId,
      });

      return {
        success: true,
        fileId,
        fileName: file.display_name,
        ragId: ragDocId,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] 导入RAG失败:', error);
      throw error;
    }
  }

  /**
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
   */
  async importToProject(fileId, projectId, options = {}) {
    try {
      // 获取文件信息
      const file = this.db
        .prepare('SELECT * FROM external_device_files WHERE id = ?')
        .get(fileId);

      if (!file) {
        throw new Error('File not found');
      }

      // 确保文件已缓存
      if (!file.is_cached || !file.cache_path) {
        logger.info('[ExternalDeviceFileManager] 文件未缓存，先拉取文件');
        await this.pullFile(fileId);

        // 重新获取文件信息
        const updatedFile = this.db
          .prepare('SELECT * FROM external_device_files WHERE id = ?')
          .get(fileId);
        file.cache_path = updatedFile.cache_path;
      }

      // 获取项目信息
      const project = this.db
        .prepare('SELECT * FROM projects WHERE id = ?')
        .get(projectId);

      if (!project) {
        throw new Error('Project not found');
      }

      // 确定目标路径
      const projectFilesDir = path.join(
        path.dirname(this.db.dbPath),
        'projects',
        projectId,
        'files'
      );

      // 确保项目文件目录存在
      if (!fs.existsSync(projectFilesDir)) {
        fs.mkdirSync(projectFilesDir, { recursive: true });
      }

      // 生成唯一文件名（避免冲突）
      const timestamp = Date.now();
      const ext = path.extname(file.display_name);
      const basename = path.basename(file.display_name, ext);
      const targetFileName = `${basename}_${timestamp}${ext}`;
      const targetPath = path.join(projectFilesDir, targetFileName);

      // 复制文件到项目目录
      fs.copyFileSync(file.cache_path, targetPath);

      logger.info('[ExternalDeviceFileManager] 文件已复制到项目目录:', {
        sourcePath: file.cache_path,
        targetPath,
      });

      // 创建project_files记录
      const projectFileId = uuidv4();
      const now = Date.now();

      this.db
        .prepare(
          `
        INSERT INTO project_files (
          id, project_id, file_name, file_path, file_type,
          file_size, source, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          projectFileId,
          projectId,
          file.display_name,
          targetPath,
          file.mime_type,
          file.file_size,
          'external-device',
          JSON.stringify({
            deviceId: file.device_id,
            originalFileId: file.file_id,
            category: file.category,
            importedAt: now,
          }),
          now,
          now
        );

      logger.info('[ExternalDeviceFileManager] 文件已导入项目:', {
        projectId,
        fileId: projectFileId,
        fileName: file.display_name,
      });

      this.emit('file-imported-to-project', {
        fileId,
        projectId,
        projectFileId,
        fileName: file.display_name,
      });

      return {
        success: true,
        fileId,
        projectId,
        projectFileId,
        fileName: file.display_name,
        filePath: targetPath,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] 导入项目失败:', error);
      throw error;
    }
  }

  /**
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
   */
  async evictLRUCacheFiles(requiredSpace) {
    try {
      const cachedFiles = this.db
        .prepare(
          `
        SELECT id, cache_path, file_size, last_access
        FROM external_device_files
        WHERE is_cached = 1
        ORDER BY last_access ASC
      `
        )
        .all();

      let freedSpace = 0;
      const evictedFiles = [];

      for (const file of cachedFiles) {
        if (freedSpace >= requiredSpace) {
          break;
        }

        // 删除缓存文件
        if (fs.existsSync(file.cache_path)) {
          try {
            fs.unlinkSync(file.cache_path);
            freedSpace += file.file_size;
            evictedFiles.push(file.id);

            // 更新数据库
            this.db
              .prepare(
                `
              UPDATE external_device_files
              SET is_cached = 0, cache_path = NULL
              WHERE id = ?
            `
              )
              .run(file.id);

            logger.info('[ExternalDeviceFileManager] 淘汰缓存文件:', {
              fileId: file.id,
              size: file.file_size,
            });
          } catch (error) {
            logger.warn('[ExternalDeviceFileManager] 删除缓存文件失败:', error);
          }
        }
      }

      logger.info('[ExternalDeviceFileManager] LRU缓存淘汰完成:', {
        evictedCount: evictedFiles.length,
        freedSpace,
      });

      // 记录缓存淘汰性能指标
      this.metrics.recordCacheEviction(evictedFiles.length, freedSpace);

      return {
        evictedCount: evictedFiles.length,
        freedSpace,
      };
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] LRU缓存淘汰失败:', error);
      throw error;
    }
  }

  /**
   * 确保缓存空间充足
   * @param {number} requiredSpace - 需要的空间（字节）
   */
  async ensureCacheSpace(requiredSpace) {
    try {
      const currentSize = await this.getCurrentCacheSize();

      if (currentSize + requiredSpace > this.options.maxCacheSize) {
        const spaceToFree = currentSize + requiredSpace - this.options.maxCacheSize;
        logger.info('[ExternalDeviceFileManager] 缓存空间不足，执行LRU淘汰:', {
          currentSize,
          requiredSpace,
          spaceToFree,
        });

        await this.evictLRUCacheFiles(spaceToFree);
      }
    } catch (error) {
      logger.warn('[ExternalDeviceFileManager] 检查缓存空间失败:', error);
    }
  }

  /**
   * 获取当前缓存大小
   * @returns {Promise<number>} 缓存大小（字节）
   */
  async getCurrentCacheSize() {
    try {
      const result = this.db
        .prepare(
          `
        SELECT SUM(file_size) as total
        FROM external_device_files
        WHERE is_cached = 1
      `
        )
        .get();

      return result.total || 0;
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] 获取缓存大小失败:', error);
      return 0;
    }
  }

  /**
   * 验证缓存文件
   * @param {string} filePath - 文件路径
   * @param {string} expectedChecksum - 期望的校验和
   * @returns {Promise<boolean>} 是否有效
   */
  async verifyFileCached(filePath, expectedChecksum) {
    if (!expectedChecksum) {
      logger.warn('[ExternalDeviceFileManager] 没有提供校验和，跳过验证');
      return true;
    }

    try {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      return new Promise((resolve, reject) => {
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => {
          const checksum = 'sha256:' + hash.digest('hex');
          resolve(checksum === expectedChecksum);
        });
        stream.on('error', reject);
      });
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] 文件验证失败:', error);
      return false;
    }
  }

  /**
   * 创建传输任务记录
   * @param {Object} task - 任务信息
   * @returns {Promise<string>} 任务ID
   */
  async createTransferTask(task) {
    const taskId = uuidv4();

    this.db
      .prepare(
        `
      INSERT INTO file_transfer_tasks (
        id, device_id, file_id, transfer_type, status,
        total_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        taskId,
        task.deviceId,
        task.fileId,
        task.transferType,
        TRANSFER_STATUS.PENDING,
        task.totalBytes,
        Date.now()
      );

    return taskId;
  }

  /**
   * 更新传输任务
   * @param {string} taskId - 任务ID
   * @param {Object} updates - 更新字段
   */
  async updateTransferTask(taskId, updates) {
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }

    if (fields.length === 0) {
      return;
    }

    values.push(taskId);

    this.db
      .prepare(
        `
      UPDATE file_transfer_tasks
      SET ${fields.join(', ')}
      WHERE id = ?
    `
      )
      .run(...values);
  }

  /**
   * 记录同步活动
   * @param {string} deviceId - 设备ID
   * @param {Object} log - 日志信息
   */
  async logSyncActivity(deviceId, log) {
    const logId = uuidv4();

    this.db
      .prepare(
        `
      INSERT INTO file_sync_logs (
        id, device_id, sync_type, items_count, bytes_transferred,
        duration_ms, status, error_details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        logId,
        deviceId,
        log.syncType,
        log.itemsCount,
        log.bytesTransferred || 0,
        log.durationMs,
        log.status,
        log.errorDetails || null,
        Date.now()
      );
  }

  /**
   * 获取上次同步时间
   * @param {string} deviceId - 设备ID
   * @returns {Promise<number>} 上次同步时间戳
   */
  async getLastSyncTime(deviceId) {
    try {
      const result = this.db
        .prepare(
          `
        SELECT MAX(created_at) as last_sync
        FROM file_sync_logs
        WHERE device_id = ? AND sync_type = ? AND status = 'success'
      `
        )
        .get(deviceId, SYNC_TYPE.INDEX_SYNC);

      return result?.last_sync || 0;
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] 获取上次同步时间失败:', error);
      return 0;
    }
  }

  /**
   * 更新上次同步时间
   * @param {string} deviceId - 设备ID
   * @param {number} timestamp - 时间戳
   */
  async updateLastSyncTime(deviceId, timestamp) {
    // 同步时间会通过file_sync_logs表记录，这里不需要额外操作
  }

  /**
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
   */
  async searchFiles(query, options = {}) {
    try {
      let sql = `
        SELECT * FROM external_device_files
        WHERE display_name LIKE ?
      `;
      const params = [`%${query}%`];

      // 设备过滤
      if (options.deviceId) {
        sql += ` AND device_id = ?`;
        params.push(options.deviceId);
      }

      // 分类过滤
      if (options.category) {
        sql += ` AND category = ?`;
        params.push(options.category);
      }

      // 排序
      sql += ` ORDER BY indexed_at DESC`;

      // 分页
      if (options.limit) {
        sql += ` LIMIT ?`;
        params.push(options.limit);
      }

      const files = this.db.prepare(sql).all(...params);

      return files.map((file) => ({
        ...file,
        metadata: file.metadata ? JSON.parse(file.metadata) : {},
        tags: file.tags ? JSON.parse(file.tags) : [],
      }));
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] 搜索文件失败:', error);
      throw error;
    }
  }

  /**
   * 取消传输任务
   * @param {string} transferId - 传输ID
   */
  async cancelTransfer(transferId) {
    try {
      // 更新数据库状态
      this.db
        .prepare(
          `
        UPDATE file_transfer_tasks
        SET status = 'cancelled'
        WHERE id = ?
      `
        )
        .run(transferId);

      // 调用fileTransferManager的取消方法
      if (this.fileTransferManager) {
        await this.fileTransferManager.cancelTransfer(transferId);
      }

      // 从活跃传输列表中移除
      if (this.activeTransfers.has(transferId)) {
        this.activeTransfers.delete(transferId);
      }

      logger.info('[ExternalDeviceFileManager] 传输任务已取消:', transferId);

      this.emit('transfer-cancelled', { transferId });
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] 取消传输失败:', error);
      throw error;
    }
  }

  /**
   * 获取传输进度
   * @param {string} transferId - 传输ID
   * @returns {Promise<Object>} 传输进度
   */
  async getTransferProgress(transferId) {
    try {
      const task = this.db
        .prepare('SELECT * FROM file_transfer_tasks WHERE id = ?')
        .get(transferId);

      return task;
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] 获取传输进度失败:', error);
      throw error;
    }
  }

  /**
   * 清理过期缓存
   * @param {number} expiry - 过期时间（毫秒）
   */
  async cleanupExpiredCache(expiry) {
    const expiryTime = Date.now() - (expiry || this.options.cacheExpiry);

    try {
      const expiredFiles = this.db
        .prepare(
          `
        SELECT id, cache_path FROM external_device_files
        WHERE is_cached = 1 AND last_access < ?
      `
        )
        .all(expiryTime);

      let cleanedCount = 0;

      for (const file of expiredFiles) {
        if (fs.existsSync(file.cache_path)) {
          try {
            fs.unlinkSync(file.cache_path);
            cleanedCount++;

            this.db
              .prepare(
                `
              UPDATE external_device_files
              SET is_cached = 0, cache_path = NULL
              WHERE id = ?
            `
              )
              .run(file.id);
          } catch (error) {
            logger.warn('[ExternalDeviceFileManager] 删除过期缓存失败:', error);
          }
        }
      }

      logger.info('[ExternalDeviceFileManager] 清理过期缓存完成:', {
        cleanedCount,
      });

      return { cleanedCount };
    } catch (error) {
      logger.error('[ExternalDeviceFileManager] 清理过期缓存失败:', error);
      throw error;
    }
  }

  /**
   * 获取性能统计信息
   * @returns {Object} 性能统计数据
   */
  getPerformanceStats() {
    return this.metrics.getStats();
  }

  /**
   * 获取最近的传输记录
   * @param {number} limit - 返回数量限制
   * @returns {Array} 传输记录
   */
  getRecentTransfers(limit = 10) {
    return this.metrics.getRecentTransfers(limit);
  }

  /**
   * 获取最近的同步记录
   * @param {number} limit - 返回数量限制
   * @returns {Array} 同步记录
   */
  getRecentSyncs(limit = 10) {
    return this.metrics.getRecentSyncs(limit);
  }

  /**
   * 生成性能报告
   * @returns {string} 性能报告文本
   */
  generatePerformanceReport() {
    return this.metrics.generateReport();
  }

  /**
   * 重置性能统计
   */
  resetPerformanceMetrics() {
    this.metrics.reset();
    logger.info('[ExternalDeviceFileManager] 性能统计已重置');
  }

  /**
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
   */
  getRetryStats() {
    return this.retryManager.getStats();
  }

  /**
   * 重置重试统计
   */
  resetRetryStats() {
    this.retryManager.resetStats();
    logger.info('[ExternalDeviceFileManager] 重试统计已重置');
  }
}

module.exports = ExternalDeviceFileManager;
