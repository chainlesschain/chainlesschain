/**
 * 图片存储管理器
 *
 * 负责图片文件的存储、检索和管理
 */

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { app } = require('electron');

/**
 * 图片存储配置
 */
const DEFAULT_CONFIG = {
  // 存储目录
  storageDir: 'images',
  thumbnailDir: 'images/thumbnails',

  // 文件命名
  useUUID: true,

  // 自动创建目录
  autoCreateDir: true,
};

/**
 * 图片存储类
 */
class ImageStorage {
  constructor(databaseManager, config = {}) {
    this.db = databaseManager;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 获取用户数据目录
    this.userDataPath = app.getPath('userData');
    this.storageBasePath = path.join(this.userDataPath, this.config.storageDir);
    this.thumbnailBasePath = path.join(this.userDataPath, this.config.thumbnailDir);
  }

  /**
   * 初始化存储目录
   */
  async initialize() {
    if (this.config.autoCreateDir) {
      try {
        await fs.mkdir(this.storageBasePath, { recursive: true });
        await fs.mkdir(this.thumbnailBasePath, { recursive: true });
        console.log('[ImageStorage] 存储目录已创建:', this.storageBasePath);
      } catch (error) {
        console.error('[ImageStorage] 创建存储目录失败:', error);
        throw error;
      }
    }

    // 初始化数据库表
    await this.initializeDatabase();
  }

  /**
   * 初始化数据库表
   */
  async initializeDatabase() {
    try {
      // 创建 images 表
      this.db.run(`
        CREATE TABLE IF NOT EXISTS images (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          original_filename TEXT NOT NULL,
          path TEXT NOT NULL,
          thumbnail_path TEXT,
          size INTEGER NOT NULL,
          width INTEGER,
          height INTEGER,
          format TEXT,
          ocr_text TEXT,
          ocr_confidence REAL,
          knowledge_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
        )
      `);

      console.log('[ImageStorage] 数据库表已初始化');
    } catch (error) {
      console.error('[ImageStorage] 初始化数据库失败:', error);
      throw error;
    }
  }

  /**
   * 生成文件名
   * @param {string} originalFilename - 原始文件名
   * @returns {string} 新文件名
   */
  generateFilename(originalFilename) {
    const ext = path.extname(originalFilename);

    if (this.config.useUUID) {
      return `${uuidv4()}${ext}`;
    } else {
      // 使用时间戳 + 随机数
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000);
      return `img_${timestamp}_${random}${ext}`;
    }
  }

  /**
   * 保存图片
   * @param {string} sourcePath - 源文件路径
   * @param {Object} metadata - 图片元信息
   * @returns {Promise<Object>} 保存结果
   */
  async saveImage(sourcePath, metadata = {}) {
    try {
      const originalFilename = path.basename(sourcePath);
      const newFilename = this.generateFilename(originalFilename);
      const destPath = path.join(this.storageBasePath, newFilename);

      // 复制文件
      await fs.copyFile(sourcePath, destPath);

      // 获取文件大小
      const stats = await fs.stat(destPath);

      // 生成记录
      const imageRecord = {
        id: metadata.id || uuidv4(),
        filename: newFilename,
        original_filename: originalFilename,
        path: destPath,
        thumbnail_path: metadata.thumbnailPath || null,
        size: stats.size,
        width: metadata.width || null,
        height: metadata.height || null,
        format: metadata.format || path.extname(originalFilename).slice(1),
        ocr_text: metadata.ocrText || null,
        ocr_confidence: metadata.ocrConfidence || null,
        knowledge_id: metadata.knowledgeId || null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      // 保存到数据库
      await this.addImageRecord(imageRecord);

      console.log('[ImageStorage] 图片已保存:', newFilename);

      return {
        success: true,
        id: imageRecord.id,
        path: destPath,
        filename: newFilename,
        size: stats.size,
      };
    } catch (error) {
      console.error('[ImageStorage] 保存图片失败:', error);
      throw error;
    }
  }

  /**
   * 保存缩略图
   * @param {string} imageId - 图片 ID
   * @param {string} thumbnailPath - 缩略图路径
   * @returns {Promise<Object>}
   */
  async saveThumbnail(imageId, thumbnailPath) {
    try {
      const filename = path.basename(thumbnailPath);
      const destPath = path.join(this.thumbnailBasePath, filename);

      // 复制缩略图
      await fs.copyFile(thumbnailPath, destPath);

      // 更新数据库记录
      await this.updateImageRecord(imageId, {
        thumbnail_path: destPath,
        updated_at: Date.now(),
      });

      console.log('[ImageStorage] 缩略图已保存:', filename);

      return {
        success: true,
        path: destPath,
      };
    } catch (error) {
      console.error('[ImageStorage] 保存缩略图失败:', error);
      throw error;
    }
  }

  /**
   * 添加图片记录到数据库
   * @param {Object} record - 图片记录
   */
  async addImageRecord(record) {
    const sql = `
      INSERT INTO images (
        id, filename, original_filename, path, thumbnail_path,
        size, width, height, format, ocr_text, ocr_confidence,
        knowledge_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      record.id,
      record.filename,
      record.original_filename,
      record.path,
      record.thumbnail_path,
      record.size,
      record.width,
      record.height,
      record.format,
      record.ocr_text,
      record.ocr_confidence,
      record.knowledge_id,
      record.created_at,
      record.updated_at,
    ];

    await this.db.run(sql, params);
  }

  /**
   * 更新图片记录
   * @param {string} imageId - 图片 ID
   * @param {Object} updates - 更新字段
   */
  async updateImageRecord(imageId, updates) {
    const fields = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }

    params.push(imageId);

    const sql = `UPDATE images SET ${fields.join(', ')} WHERE id = ?`;
    await this.db.run(sql, params);
  }

  /**
   * 获取图片记录
   * @param {string} imageId - 图片 ID
   * @returns {Promise<Object|null>}
   */
  async getImageRecord(imageId) {
    const sql = 'SELECT * FROM images WHERE id = ?';
    const row = await this.db.get(sql, [imageId]);
    return row || null;
  }

  /**
   * 获取所有图片记录
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}
   */
  async getAllImages(options = {}) {
    const {
      limit = 100,
      offset = 0,
      knowledgeId = null,
      orderBy = 'created_at',
      order = 'DESC',
    } = options;

    let sql = 'SELECT * FROM images';
    const params = [];

    if (knowledgeId) {
      sql += ' WHERE knowledge_id = ?';
      params.push(knowledgeId);
    }

    sql += ` ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await this.db.all(sql, params);
    return rows || [];
  }

  /**
   * 搜索图片 (通过 OCR 文本)
   * @param {string} query - 搜索关键词
   * @returns {Promise<Array>}
   */
  async searchImages(query) {
    const sql = `
      SELECT * FROM images
      WHERE ocr_text LIKE ?
      ORDER BY created_at DESC
    `;

    const rows = await this.db.all(sql, [`%${query}%`]);
    return rows || [];
  }

  /**
   * 删除图片
   * @param {string} imageId - 图片 ID
   * @returns {Promise<Object>}
   */
  async deleteImage(imageId) {
    try {
      // 获取图片记录
      const record = await this.getImageRecord(imageId);

      if (!record) {
        throw new Error('图片不存在');
      }

      // 删除文件
      try {
        await fs.unlink(record.path);
        console.log('[ImageStorage] 已删除图片文件:', record.path);
      } catch (error) {
        console.warn('[ImageStorage] 删除图片文件失败:', error);
      }

      // 删除缩略图
      if (record.thumbnail_path) {
        try {
          await fs.unlink(record.thumbnail_path);
          console.log('[ImageStorage] 已删除缩略图:', record.thumbnail_path);
        } catch (error) {
          console.warn('[ImageStorage] 删除缩略图失败:', error);
        }
      }

      // 从数据库删除
      await this.db.run('DELETE FROM images WHERE id = ?', [imageId]);

      console.log('[ImageStorage] 图片记录已删除:', imageId);

      return {
        success: true,
        id: imageId,
      };
    } catch (error) {
      console.error('[ImageStorage] 删除图片失败:', error);
      throw error;
    }
  }

  /**
   * 获取统计信息
   * @returns {Promise<Object>}
   */
  async getStats() {
    try {
      const countRow = await this.db.get('SELECT COUNT(*) as count FROM images');
      const sizeRow = await this.db.get('SELECT SUM(size) as totalSize FROM images');
      const avgConfidenceRow = await this.db.get('SELECT AVG(ocr_confidence) as avgConfidence FROM images WHERE ocr_confidence IS NOT NULL');

      return {
        totalImages: countRow ? countRow.count : 0,
        totalSize: sizeRow ? sizeRow.totalSize || 0 : 0,
        averageOcrConfidence: avgConfidenceRow ? avgConfidenceRow.avgConfidence || 0 : 0,
      };
    } catch (error) {
      console.error('[ImageStorage] 获取统计信息失败:', error);
      return {
        totalImages: 0,
        totalSize: 0,
        averageOcrConfidence: 0,
      };
    }
  }

  /**
   * 清理孤立文件 (数据库中不存在的文件)
   * @returns {Promise<Object>}
   */
  async cleanOrphanFiles() {
    try {
      let cleaned = 0;

      // 获取所有文件
      const files = await fs.readdir(this.storageBasePath);

      for (const filename of files) {
        // 检查是否在数据库中
        const record = await this.db.get('SELECT id FROM images WHERE filename = ?', [filename]);

        if (!record) {
          // 孤立文件，删除
          const filePath = path.join(this.storageBasePath, filename);
          await fs.unlink(filePath);
          cleaned++;
          console.log('[ImageStorage] 已清理孤立文件:', filename);
        }
      }

      return {
        success: true,
        cleaned: cleaned,
      };
    } catch (error) {
      console.error('[ImageStorage] 清理孤立文件失败:', error);
      throw error;
    }
  }

  /**
   * 获取存储路径
   * @returns {Object}
   */
  getStoragePaths() {
    return {
      basePath: this.storageBasePath,
      thumbnailPath: this.thumbnailBasePath,
    };
  }
}

module.exports = ImageStorage;
