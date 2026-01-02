/**
 * 移动端统一媒体管理系统
 * Mobile Unified Media Management System
 *
 * 支持文件类型:
 * - 文档: PDF, DOC/DOCX, TXT, MD
 * - 图片: JPG, PNG, GIF, WebP
 * - 视频: MP4, MOV, AVI (元数据提取，不含重量级处理)
 * - 音频: MP3, WAV, M4A
 *
 * 核心功能:
 * - 媒体导入与存储
 * - 元数据提取
 * - 缩略图生成
 * - 文本提取 (OCR/文档解析)
 * - 搜索与过滤
 * - 统计信息
 * - 文件管理
 *
 * @module media-manager
 * @version 2.2.0
 * @since 2024-01-02
 */

/**
 * 媒体文件类型枚举
 */
const MediaType = {
  DOCUMENT: 'document',
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio'
}

/**
 * 支持的文件扩展名映射
 */
const SUPPORTED_FORMATS = {
  document: ['pdf', 'doc', 'docx', 'txt', 'md', 'markdown'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg']
}

/**
 * MIME类型映射
 */
const MIME_TYPES = {
  // Documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',

  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',

  // Videos
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',

  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg'
}

/**
 * 文件大小限制 (移动端优化)
 */
const FILE_SIZE_LIMITS = {
  document: 50 * 1024 * 1024,  // 50MB
  image: 20 * 1024 * 1024,     // 20MB
  video: 200 * 1024 * 1024,    // 200MB
  audio: 50 * 1024 * 1024      // 50MB
}

/**
 * 媒体管理器类
 */
class MediaManager {
  /**
   * 构造函数
   * @param {Object} db - 数据库实例
   */
  constructor(db) {
    if (!db) {
      throw new Error('数据库实例不能为空')
    }

    this.db = db
    this.initialized = false

    // 缓存系统
    this.cache = new Map()  // 媒体文件缓存
    this.statsCache = null   // 统计信息缓存
    this.cacheTTL = 5 * 60 * 1000  // 5分钟缓存过期

    console.log('[MediaManager] 实例已创建')
  }

  /**
   * 初始化媒体管理器
   * 创建数据库表
   */
  async initialize() {
    if (this.initialized) {
      console.log('[MediaManager] 已经初始化过，跳过')
      return
    }

    try {
      console.log('[MediaManager] 开始初始化...')

      // 创建媒体文件表
      await this._createMediaFilesTable()

      this.initialized = true
      console.log('[MediaManager] ✓ 初始化完成')
    } catch (error) {
      console.error('[MediaManager] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建媒体文件表
   * @private
   */
  async _createMediaFilesTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS media_files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        thumbnail_path TEXT,
        size INTEGER NOT NULL,
        duration INTEGER,
        page_count INTEGER,
        width INTEGER,
        height INTEGER,
        extracted_text TEXT,
        tags TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `

    await this.db.executeSql(sql)

    // 创建索引
    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_media_type
      ON media_files(type) WHERE deleted = 0
    `)

    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_media_created
      ON media_files(created_at DESC) WHERE deleted = 0
    `)

    console.log('[MediaManager] ✓ 媒体文件表创建完成')
  }

  // ============================================================
  // 文件导入与存储
  // ============================================================

  /**
   * 导入媒体文件
   * @param {Object} fileData - 文件数据
   * @param {string} fileData.name - 文件名
   * @param {string} fileData.path - 文件路径
   * @param {number} fileData.size - 文件大小
   * @param {string[]} [fileData.tags] - 标签
   * @param {Object} [options] - 选项
   * @param {boolean} [options.extractText=true] - 是否提取文本
   * @param {boolean} [options.generateThumbnail=true] - 是否生成缩略图
   * @param {Function} [options.onProgress] - 进度回调
   * @returns {Promise<Object>} 导入的媒体文件信息
   */
  async importFile(fileData, options = {}) {
    const {
      extractText = true,
      generateThumbnail = true,
      onProgress = null
    } = options

    try {
      // 1. 验证文件
      this._validateFile(fileData)

      if (onProgress) onProgress({ stage: 'validating', progress: 10 })

      // 2. 获取文件类型和MIME
      const fileType = this._getFileType(fileData.name)
      const mimeType = this._getMimeType(fileData.name)

      // 3. 检查文件大小
      this._checkFileSize(fileType, fileData.size)

      if (onProgress) onProgress({ stage: 'processing', progress: 30 })

      // 4. 提取元数据
      const metadata = await this._extractMetadata(fileData, fileType)

      if (onProgress) onProgress({ stage: 'metadata', progress: 50 })

      // 5. 生成缩略图
      let thumbnailPath = null
      if (generateThumbnail && (fileType === 'image' || fileType === 'document')) {
        thumbnailPath = await this._generateThumbnail(fileData, fileType)
      }

      if (onProgress) onProgress({ stage: 'thumbnail', progress: 70 })

      // 6. 提取文本
      let extractedText = null
      if (extractText && (fileType === 'document' || fileType === 'image')) {
        extractedText = await this._extractText(fileData, fileType)
      }

      if (onProgress) onProgress({ stage: 'text', progress: 90 })

      // 7. 保存到数据库
      const mediaFile = {
        id: this._generateId(),
        name: fileData.name,
        type: fileType,
        mime_type: mimeType,
        file_path: fileData.path,
        thumbnail_path: thumbnailPath,
        size: fileData.size,
        duration: metadata.duration || null,
        page_count: metadata.pageCount || null,
        width: metadata.width || null,
        height: metadata.height || null,
        extracted_text: extractedText,
        tags: JSON.stringify(fileData.tags || []),
        metadata: JSON.stringify(metadata),
        created_at: Date.now(),
        updated_at: Date.now(),
        deleted: 0
      }

      await this._insertMediaFile(mediaFile)

      // 清除缓存
      this._clearCache()

      if (onProgress) onProgress({ stage: 'complete', progress: 100 })

      console.log(`[MediaManager] ✓ 文件导入成功: ${fileData.name}`)

      return mediaFile
    } catch (error) {
      console.error('[MediaManager] 文件导入失败:', error)
      throw error
    }
  }

  /**
   * 批量导入文件
   * @param {Array<Object>} files - 文件数据数组
   * @param {Object} [options] - 选项
   * @param {Function} [options.onProgress] - 进度回调
   * @returns {Promise<Object>} 导入结果 { success: [], failed: [] }
   */
  async importFiles(files, options = {}) {
    const { onProgress = null } = options

    const results = {
      success: [],
      failed: []
    }

    for (let i = 0; i < files.length; i++) {
      try {
        const fileData = files[i]

        if (onProgress) {
          onProgress({
            current: i + 1,
            total: files.length,
            file: fileData.name,
            progress: Math.floor(((i + 1) / files.length) * 100)
          })
        }

        const mediaFile = await this.importFile(fileData, {
          extractText: options.extractText,
          generateThumbnail: options.generateThumbnail
        })

        results.success.push({
          file: fileData.name,
          id: mediaFile.id
        })
      } catch (error) {
        results.failed.push({
          file: files[i].name,
          error: error.message
        })
      }
    }

    console.log(`[MediaManager] 批量导入完成: 成功 ${results.success.length}, 失败 ${results.failed.length}`)

    return results
  }

  /**
   * 验证文件数据
   * @private
   */
  _validateFile(fileData) {
    if (!fileData.name) {
      throw new Error('文件名不能为空')
    }

    if (!fileData.path) {
      throw new Error('文件路径不能为空')
    }

    if (typeof fileData.size !== 'number' || fileData.size <= 0) {
      throw new Error('文件大小无效')
    }

    // 检查是否支持该文件格式
    const ext = this._getFileExtension(fileData.name)
    if (!this._isSupportedFormat(ext)) {
      throw new Error(`不支持的文件格式: ${ext}`)
    }
  }

  /**
   * 获取文件扩展名
   * @private
   */
  _getFileExtension(filename) {
    const parts = filename.split('.')
    return parts[parts.length - 1].toLowerCase()
  }

  /**
   * 检查是否支持该格式
   * @private
   */
  _isSupportedFormat(ext) {
    for (const type in SUPPORTED_FORMATS) {
      if (SUPPORTED_FORMATS[type].includes(ext)) {
        return true
      }
    }
    return false
  }

  /**
   * 获取文件类型
   * @private
   */
  _getFileType(filename) {
    const ext = this._getFileExtension(filename)

    for (const type in SUPPORTED_FORMATS) {
      if (SUPPORTED_FORMATS[type].includes(ext)) {
        return type
      }
    }

    return 'document'  // 默认为文档类型
  }

  /**
   * 获取MIME类型
   * @private
   */
  _getMimeType(filename) {
    const ext = this._getFileExtension(filename)
    return MIME_TYPES[ext] || 'application/octet-stream'
  }

  /**
   * 检查文件大小
   * @private
   */
  _checkFileSize(fileType, size) {
    const limit = FILE_SIZE_LIMITS[fileType]
    if (size > limit) {
      throw new Error(`文件太大，最大允许 ${(limit / 1024 / 1024).toFixed(0)}MB`)
    }
  }

  /**
   * 提取元数据
   * @private
   */
  async _extractMetadata(fileData, fileType) {
    const metadata = {
      originalName: fileData.name,
      extension: this._getFileExtension(fileData.name)
    }

    // 根据文件类型提取不同的元数据
    switch (fileType) {
      case 'image':
        // 图片: 宽度、高度
        // 注意: 移动端需要使用平台API获取图片尺寸
        metadata.width = fileData.width || null
        metadata.height = fileData.height || null
        break

      case 'video':
      case 'audio':
        // 视频/音频: 时长
        // 注意: 移动端需要使用平台API获取时长
        metadata.duration = fileData.duration || null
        if (fileType === 'video') {
          metadata.width = fileData.width || null
          metadata.height = fileData.height || null
        }
        break

      case 'document':
        // 文档: 页数 (仅PDF)
        if (this._getFileExtension(fileData.name) === 'pdf') {
          metadata.pageCount = fileData.pageCount || null
        }
        break
    }

    return metadata
  }

  /**
   * 生成缩略图
   * @private
   */
  async _generateThumbnail(fileData, fileType) {
    // 注意: 移动端缩略图生成需要使用平台API
    // 这里返回null，实际实现应调用uni.compressImage等API

    // 示例实现:
    // if (fileType === 'image') {
    //   return await this._generateImageThumbnail(fileData.path)
    // } else if (fileType === 'document') {
    //   return await this._generatePDFThumbnail(fileData.path)
    // }

    return null
  }

  /**
   * 提取文本内容
   * @private
   */
  async _extractText(fileData, fileType) {
    // 注意: 移动端文本提取需要使用平台API或第三方库
    // - 图片: 使用OCR (如Tesseract.js)
    // - PDF: 使用PDF.js
    // - Word: 使用mammoth或docx库
    // - TXT/MD: 直接读取

    const ext = this._getFileExtension(fileData.name)

    if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
      // 纯文本文件可以直接读取
      // return await this._readTextFile(fileData.path)
    }

    return null
  }

  /**
   * 生成唯一ID
   * @private
   */
  _generateId() {
    return `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 插入媒体文件到数据库
   * @private
   */
  async _insertMediaFile(mediaFile) {
    const sql = `
      INSERT INTO media_files (
        id, name, type, mime_type, file_path, thumbnail_path,
        size, duration, page_count, width, height,
        extracted_text, tags, metadata,
        created_at, updated_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    const params = [
      mediaFile.id,
      mediaFile.name,
      mediaFile.type,
      mediaFile.mime_type,
      mediaFile.file_path,
      mediaFile.thumbnail_path,
      mediaFile.size,
      mediaFile.duration,
      mediaFile.page_count,
      mediaFile.width,
      mediaFile.height,
      mediaFile.extracted_text,
      mediaFile.tags,
      mediaFile.metadata,
      mediaFile.created_at,
      mediaFile.updated_at,
      mediaFile.deleted
    ]

    await this.db.executeSql(sql, params)
  }

  // ============================================================
  // 查询与过滤
  // ============================================================

  /**
   * 获取所有媒体文件
   * @param {Object} [filters] - 过滤条件
   * @param {string} [filters.type] - 文件类型
   * @param {string[]} [filters.tags] - 标签
   * @param {number} [filters.minSize] - 最小大小
   * @param {number} [filters.maxSize] - 最大大小
   * @param {number} [filters.startDate] - 开始日期
   * @param {number} [filters.endDate] - 结束日期
   * @returns {Promise<Array>} 媒体文件列表
   */
  async getAllFiles(filters = {}) {
    try {
      let sql = 'SELECT * FROM media_files WHERE deleted = 0'
      const params = []

      // 类型过滤
      if (filters.type) {
        sql += ' AND type = ?'
        params.push(filters.type)
      }

      // 大小过滤
      if (filters.minSize) {
        sql += ' AND size >= ?'
        params.push(filters.minSize)
      }

      if (filters.maxSize) {
        sql += ' AND size <= ?'
        params.push(filters.maxSize)
      }

      // 日期过滤
      if (filters.startDate) {
        sql += ' AND created_at >= ?'
        params.push(filters.startDate)
      }

      if (filters.endDate) {
        sql += ' AND created_at <= ?'
        params.push(filters.endDate)
      }

      sql += ' ORDER BY created_at DESC'

      const rows = await this.db.executeSql(sql, params)
      const files = rows.map(row => this._parseMediaFile(row))

      // 标签过滤 (在内存中进行)
      if (filters.tags && filters.tags.length > 0) {
        return files.filter(file => {
          const fileTags = JSON.parse(file.tags || '[]')
          return filters.tags.some(tag => fileTags.includes(tag))
        })
      }

      return files
    } catch (error) {
      console.error('[MediaManager] 获取文件列表失败:', error)
      throw error
    }
  }

  /**
   * 根据ID获取文件
   * @param {string} id - 文件ID
   * @returns {Promise<Object|null>} 媒体文件
   */
  async getFileById(id) {
    // 检查缓存
    const cached = this.cache.get(id)
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.data
    }

    try {
      const sql = 'SELECT * FROM media_files WHERE id = ? AND deleted = 0'
      const rows = await this.db.executeSql(sql, [id])

      if (rows.length === 0) {
        return null
      }

      const file = this._parseMediaFile(rows[0])

      // 缓存
      this.cache.set(id, {
        data: file,
        timestamp: Date.now()
      })

      return file
    } catch (error) {
      console.error('[MediaManager] 获取文件失败:', error)
      throw error
    }
  }

  /**
   * 搜索文件
   * @param {string} query - 搜索关键词
   * @returns {Promise<Array>} 匹配的文件列表
   */
  async searchFiles(query) {
    if (!query || query.trim() === '') {
      return []
    }

    try {
      const sql = `
        SELECT * FROM media_files
        WHERE deleted = 0
        AND (
          name LIKE ?
          OR extracted_text LIKE ?
          OR tags LIKE ?
        )
        ORDER BY created_at DESC
      `

      const searchPattern = `%${query}%`
      const rows = await this.db.executeSql(sql, [searchPattern, searchPattern, searchPattern])

      return rows.map(row => this._parseMediaFile(row))
    } catch (error) {
      console.error('[MediaManager] 搜索文件失败:', error)
      throw error
    }
  }

  /**
   * 解析数据库行为媒体文件对象
   * @private
   */
  _parseMediaFile(row) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      mimeType: row.mime_type,
      filePath: row.file_path,
      thumbnailPath: row.thumbnail_path,
      size: row.size,
      duration: row.duration,
      pageCount: row.page_count,
      width: row.width,
      height: row.height,
      extractedText: row.extracted_text,
      tags: JSON.parse(row.tags || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  // ============================================================
  // 文件管理
  // ============================================================

  /**
   * 更新文件信息
   * @param {string} id - 文件ID
   * @param {Object} updates - 更新的字段
   * @returns {Promise<Object>} 更新后的文件
   */
  async updateFile(id, updates) {
    try {
      const allowedFields = ['name', 'tags']
      const fields = []
      const params = []

      for (const key of allowedFields) {
        if (updates[key] !== undefined) {
          if (key === 'tags') {
            fields.push('tags = ?')
            params.push(JSON.stringify(updates.tags))
          } else {
            fields.push(`${key} = ?`)
            params.push(updates[key])
          }
        }
      }

      if (fields.length === 0) {
        throw new Error('没有可更新的字段')
      }

      fields.push('updated_at = ?')
      params.push(Date.now())
      params.push(id)

      const sql = `UPDATE media_files SET ${fields.join(', ')} WHERE id = ? AND deleted = 0`

      await this.db.executeSql(sql, params)

      // 清除缓存
      this.cache.delete(id)
      this._clearStatsCache()

      // 返回更新后的文件
      return await this.getFileById(id)
    } catch (error) {
      console.error('[MediaManager] 更新文件失败:', error)
      throw error
    }
  }

  /**
   * 删除文件 (软删除)
   * @param {string} id - 文件ID
   * @returns {Promise<void>}
   */
  async deleteFile(id) {
    try {
      const sql = `
        UPDATE media_files
        SET deleted = 1, updated_at = ?
        WHERE id = ? AND deleted = 0
      `

      await this.db.executeSql(sql, [Date.now(), id])

      // 清除缓存
      this.cache.delete(id)
      this._clearStatsCache()

      console.log(`[MediaManager] ✓ 文件已删除: ${id}`)
    } catch (error) {
      console.error('[MediaManager] 删除文件失败:', error)
      throw error
    }
  }

  /**
   * 批量删除文件
   * @param {string[]} ids - 文件ID数组
   * @returns {Promise<number>} 删除的文件数量
   */
  async deleteFiles(ids) {
    if (!ids || ids.length === 0) {
      return 0
    }

    try {
      const placeholders = ids.map(() => '?').join(',')
      const sql = `
        UPDATE media_files
        SET deleted = 1, updated_at = ?
        WHERE id IN (${placeholders}) AND deleted = 0
      `

      const params = [Date.now(), ...ids]
      await this.db.executeSql(sql, params)

      // 清除缓存
      ids.forEach(id => this.cache.delete(id))
      this._clearStatsCache()

      console.log(`[MediaManager] ✓ 批量删除 ${ids.length} 个文件`)

      return ids.length
    } catch (error) {
      console.error('[MediaManager] 批量删除失败:', error)
      throw error
    }
  }

  // ============================================================
  // 统计信息
  // ============================================================

  /**
   * 获取统计信息
   * @returns {Promise<Object>} 统计信息
   */
  async getStatistics() {
    // 检查缓存
    if (this.statsCache && (Date.now() - this.statsCache.timestamp < this.cacheTTL)) {
      return this.statsCache.data
    }

    try {
      // 总数统计
      const totalSql = 'SELECT COUNT(*) as count FROM media_files WHERE deleted = 0'
      const totalRows = await this.db.executeSql(totalSql)
      const total = totalRows[0].count

      // 按类型统计
      const typeSql = `
        SELECT type, COUNT(*) as count, SUM(size) as total_size
        FROM media_files
        WHERE deleted = 0
        GROUP BY type
      `
      const typeRows = await this.db.executeSql(typeSql)

      const byType = {}
      let totalSize = 0

      typeRows.forEach(row => {
        byType[row.type] = {
          count: row.count,
          totalSize: row.total_size || 0
        }
        totalSize += row.total_size || 0
      })

      const stats = {
        total,
        totalSize,
        byType,
        document: byType.document?.count || 0,
        image: byType.image?.count || 0,
        video: byType.video?.count || 0,
        audio: byType.audio?.count || 0
      }

      // 缓存
      this.statsCache = {
        data: stats,
        timestamp: Date.now()
      }

      return stats
    } catch (error) {
      console.error('[MediaManager] 获取统计信息失败:', error)
      throw error
    }
  }

  /**
   * 获取最近的文件
   * @param {number} [limit=10] - 数量限制
   * @returns {Promise<Array>} 最近的文件列表
   */
  async getRecentFiles(limit = 10) {
    try {
      const sql = `
        SELECT * FROM media_files
        WHERE deleted = 0
        ORDER BY created_at DESC
        LIMIT ?
      `

      const rows = await this.db.executeSql(sql, [limit])
      return rows.map(row => this._parseMediaFile(row))
    } catch (error) {
      console.error('[MediaManager] 获取最近文件失败:', error)
      throw error
    }
  }

  /**
   * 获取大文件列表
   * @param {number} [limit=10] - 数量限制
   * @returns {Promise<Array>} 大文件列表
   */
  async getLargestFiles(limit = 10) {
    try {
      const sql = `
        SELECT * FROM media_files
        WHERE deleted = 0
        ORDER BY size DESC
        LIMIT ?
      `

      const rows = await this.db.executeSql(sql, [limit])
      return rows.map(row => this._parseMediaFile(row))
    } catch (error) {
      console.error('[MediaManager] 获取大文件列表失败:', error)
      throw error
    }
  }

  // ============================================================
  // 缓存管理
  // ============================================================

  /**
   * 清除所有缓存
   * @private
   */
  _clearCache() {
    this.cache.clear()
    this._clearStatsCache()
  }

  /**
   * 清除统计缓存
   * @private
   */
  _clearStatsCache() {
    this.statsCache = null
  }

  // ============================================================
  // 工具方法
  // ============================================================

  /**
   * 获取支持的文件格式
   * @returns {Object} 支持的格式
   */
  getSupportedFormats() {
    return { ...SUPPORTED_FORMATS }
  }

  /**
   * 获取文件大小限制
   * @returns {Object} 文件大小限制
   */
  getFileSizeLimits() {
    return { ...FILE_SIZE_LIMITS }
  }

  /**
   * 格式化文件大小
   * @param {number} bytes - 字节数
   * @returns {string} 格式化后的大小
   */
  static formatFileSize(bytes) {
    if (bytes === 0) return '0 B'

    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  /**
   * 格式化时长
   * @param {number} seconds - 秒数
   * @returns {string} 格式化后的时长
   */
  static formatDuration(seconds) {
    if (!seconds) return '00:00'

    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)

    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }

    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
}

// ============================================================
// 导出
// ============================================================

let mediaManagerInstance = null

/**
 * 创建或获取媒体管理器实例 (单例模式)
 * @param {Object} db - 数据库实例
 * @returns {MediaManager} 媒体管理器实例
 */
export function createMediaManager(db) {
  if (!mediaManagerInstance) {
    mediaManagerInstance = new MediaManager(db)
  }
  return mediaManagerInstance
}

/**
 * 获取当前媒体管理器实例
 * @returns {MediaManager|null} 媒体管理器实例
 */
export function getMediaManager() {
  return mediaManagerInstance
}

export { MediaManager, MediaType, SUPPORTED_FORMATS, MIME_TYPES, FILE_SIZE_LIMITS }
export default { createMediaManager, getMediaManager, MediaManager, MediaType }
