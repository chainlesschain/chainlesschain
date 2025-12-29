/**
 * 音频存储管理
 *
 * 管理音频文件的存储和数据库记录
 */

const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

/**
 * 音频存储管理类
 */
class AudioStorage {
  constructor(databaseManager, storagePath = null) {
    this.db = databaseManager;
    this.storagePath = storagePath || path.join(process.cwd(), 'data', 'audio');
  }

  /**
   * 初始化存储
   */
  async initialize() {
    try {
      // 确保存储目录存在
      await fs.mkdir(this.storagePath, { recursive: true });
      console.log('[AudioStorage] 存储目录已创建:', this.storagePath);

      return true;
    } catch (error) {
      console.error('[AudioStorage] 初始化失败:', error);
      return false;
    }
  }

  /**
   * 保存音频文件
   * @param {string} sourcePath - 源文件路径
   * @param {Object} metadata - 文件元数据
   * @returns {Promise<Object>} 保存结果
   */
  async saveAudioFile(sourcePath, metadata = {}) {
    try {
      const audioId = metadata.id || uuidv4();
      const fileName = metadata.fileName || path.basename(sourcePath);
      const ext = path.extname(fileName);
      const destFileName = `${audioId}${ext}`;
      const destPath = path.join(this.storagePath, destFileName);

      // 复制文件到存储目录
      await fs.copyFile(sourcePath, destPath);
      console.log('[AudioStorage] 文件已保存:', destFileName);

      // 获取文件信息
      const stats = await fs.stat(destPath);

      // 保存到数据库
      await this.createAudioRecord({
        id: audioId,
        file_name: fileName,
        file_path: destPath,
        file_size: stats.size,
        ...metadata,
      });

      return {
        success: true,
        id: audioId,
        fileName: destFileName,
        path: destPath,
        size: stats.size,
      };
    } catch (error) {
      console.error('[AudioStorage] 保存文件失败:', error);
      throw error;
    }
  }

  /**
   * 创建音频记录
   * @param {Object} data - 音频数据
   * @returns {Promise<Object>}
   */
  async createAudioRecord(data) {
    const {
      id = uuidv4(),
      file_name,
      file_path,
      file_size = 0,
      duration = 0,
      format = '',
      sample_rate = 0,
      channels = 0,
      transcription_text = null,
      transcription_engine = null,
      transcription_confidence = null,
      language = 'zh',
      knowledge_id = null,
      user_id = 'local-user',
    } = data;

    const sql = `
      INSERT INTO audio_files (
        id, file_name, file_path, file_size,
        duration, format, sample_rate, channels,
        transcription_text, transcription_engine, transcription_confidence,
        language, knowledge_id, user_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `;

    try {
      await this.db.db.run(sql, [
        id, file_name, file_path, file_size,
        duration, format, sample_rate, channels,
        transcription_text, transcription_engine, transcription_confidence,
        language, knowledge_id, user_id,
      ]);

      console.log('[AudioStorage] 音频记录已创建:', id);

      return {
        id,
        file_name,
        file_path,
        file_size,
        duration,
        format,
        transcription_text,
      };
    } catch (error) {
      console.error('[AudioStorage] 创建音频记录失败:', error);
      throw error;
    }
  }

  /**
   * 更新音频记录
   * @param {string} id - 音频ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>}
   */
  async updateAudioRecord(id, updates) {
    const allowedFields = [
      'file_name', 'file_path', 'file_size', 'duration',
      'format', 'sample_rate', 'channels',
      'transcription_text', 'transcription_engine', 'transcription_confidence',
      'language', 'knowledge_id',
    ];

    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      return { success: false, message: '没有可更新的字段' };
    }

    fields.push('updated_at = datetime(\'now\')');
    values.push(id);

    const sql = `UPDATE audio_files SET ${fields.join(', ')} WHERE id = ?`;

    try {
      await this.db.db.run(sql, values);
      console.log('[AudioStorage] 音频记录已更新:', id);

      return { success: true, id };
    } catch (error) {
      console.error('[AudioStorage] 更新音频记录失败:', error);
      throw error;
    }
  }

  /**
   * 获取音频记录
   * @param {string} id - 音频ID
   * @returns {Promise<Object|null>}
   */
  async getAudioRecord(id) {
    const sql = `SELECT * FROM audio_files WHERE id = ?`;

    try {
      const record = await this.db.db.get(sql, [id]);
      return record || null;
    } catch (error) {
      console.error('[AudioStorage] 获取音频记录失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有音频文件
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}
   */
  async getAllAudioFiles(options = {}) {
    const {
      user_id = 'local-user',
      limit = 100,
      offset = 0,
      orderBy = 'created_at',
      order = 'DESC',
    } = options;

    const sql = `
      SELECT * FROM audio_files
      WHERE user_id = ?
      ORDER BY ${orderBy} ${order}
      LIMIT ? OFFSET ?
    `;

    try {
      const records = await this.db.db.all(sql, [user_id, limit, offset]);
      return records || [];
    } catch (error) {
      console.error('[AudioStorage] 获取音频列表失败:', error);
      throw error;
    }
  }

  /**
   * 搜索音频（通过转录文本）
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>}
   */
  async searchAudioFiles(query, options = {}) {
    const {
      user_id = 'local-user',
      limit = 50,
    } = options;

    const sql = `
      SELECT * FROM audio_files
      WHERE user_id = ?
        AND (
          transcription_text LIKE ?
          OR file_name LIKE ?
        )
      ORDER BY created_at DESC
      LIMIT ?
    `;

    const searchPattern = `%${query}%`;

    try {
      const records = await this.db.db.all(sql, [user_id, searchPattern, searchPattern, limit]);
      return records || [];
    } catch (error) {
      console.error('[AudioStorage] 搜索音频失败:', error);
      throw error;
    }
  }

  /**
   * 删除音频文件
   * @param {string} id - 音频ID
   * @returns {Promise<Object>}
   */
  async deleteAudioFile(id) {
    try {
      // 获取文件信息
      const record = await this.getAudioRecord(id);

      if (!record) {
        throw new Error('音频记录不存在');
      }

      // 删除物理文件
      try {
        await fs.unlink(record.file_path);
        console.log('[AudioStorage] 文件已删除:', record.file_path);
      } catch (error) {
        console.warn('[AudioStorage] 删除文件失败:', error);
      }

      // 删除数据库记录
      const sql = `DELETE FROM audio_files WHERE id = ?`;
      await this.db.db.run(sql, [id]);

      console.log('[AudioStorage] 音频记录已删除:', id);

      return { success: true, id };
    } catch (error) {
      console.error('[AudioStorage] 删除音频失败:', error);
      throw error;
    }
  }

  /**
   * 添加转录历史
   * @param {Object} data - 转录数据
   * @returns {Promise<Object>}
   */
  async addTranscriptionHistory(data) {
    const {
      id = uuidv4(),
      audio_file_id,
      engine,
      text,
      confidence = null,
      duration = 0,
      status = 'completed',
      error = null,
    } = data;

    const sql = `
      INSERT INTO transcription_history (
        id, audio_file_id, engine, text, confidence,
        duration, status, error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `;

    try {
      await this.db.db.run(sql, [
        id, audio_file_id, engine, text, confidence,
        duration, status, error,
      ]);

      console.log('[AudioStorage] 转录历史已添加:', id);

      return { id, audio_file_id, engine, text, status };
    } catch (error) {
      console.error('[AudioStorage] 添加转录历史失败:', error);
      throw error;
    }
  }

  /**
   * 获取转录历史
   * @param {string} audio_file_id - 音频文件ID
   * @returns {Promise<Array>}
   */
  async getTranscriptionHistory(audio_file_id) {
    const sql = `
      SELECT * FROM transcription_history
      WHERE audio_file_id = ?
      ORDER BY created_at DESC
    `;

    try {
      const records = await this.db.db.all(sql, [audio_file_id]);
      return records || [];
    } catch (error) {
      console.error('[AudioStorage] 获取转录历史失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有转录历史
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}
   */
  async getAllTranscriptionHistory(options = {}) {
    const {
      limit = 100,
      offset = 0,
    } = options;

    const sql = `
      SELECT h.*, a.file_name
      FROM transcription_history h
      LEFT JOIN audio_files a ON h.audio_file_id = a.id
      ORDER BY h.created_at DESC
      LIMIT ? OFFSET ?
    `;

    try {
      const records = await this.db.db.all(sql, [limit, offset]);
      return records || [];
    } catch (error) {
      console.error('[AudioStorage] 获取转录历史失败:', error);
      throw error;
    }
  }

  /**
   * 删除转录历史
   * @param {string} id - 历史记录ID
   * @returns {Promise<Object>}
   */
  async deleteTranscriptionHistory(id) {
    const sql = `DELETE FROM transcription_history WHERE id = ?`;

    try {
      await this.db.db.run(sql, [id]);
      console.log('[AudioStorage] 转录历史已删除:', id);

      return { success: true, id };
    } catch (error) {
      console.error('[AudioStorage] 删除转录历史失败:', error);
      throw error;
    }
  }

  /**
   * 获取统计信息
   * @param {string} user_id - 用户ID
   * @returns {Promise<Object>}
   */
  async getStats(user_id = 'local-user') {
    try {
      // 总文件数
      const countSql = `SELECT COUNT(*) as count FROM audio_files WHERE user_id = ?`;
      const countResult = await this.db.db.get(countSql, [user_id]);

      // 总大小
      const sizeSql = `SELECT SUM(file_size) as total_size FROM audio_files WHERE user_id = ?`;
      const sizeResult = await this.db.db.get(sizeSql, [user_id]);

      // 总时长
      const durationSql = `SELECT SUM(duration) as total_duration FROM audio_files WHERE user_id = ?`;
      const durationResult = await this.db.db.get(durationSql, [user_id]);

      // 已转录数量
      const transcribedSql = `
        SELECT COUNT(*) as count FROM audio_files
        WHERE user_id = ? AND transcription_text IS NOT NULL
      `;
      const transcribedResult = await this.db.db.get(transcribedSql, [user_id]);

      return {
        totalFiles: countResult.count || 0,
        totalSize: sizeResult.total_size || 0,
        totalDuration: durationResult.total_duration || 0,
        transcribedFiles: transcribedResult.count || 0,
      };
    } catch (error) {
      console.error('[AudioStorage] 获取统计信息失败:', error);
      throw error;
    }
  }

  /**
   * 清理旧文件
   * @param {number} days - 保留天数
   * @returns {Promise<Object>}
   */
  async cleanupOldFiles(days = 30) {
    const sql = `
      SELECT * FROM audio_files
      WHERE datetime(created_at) < datetime('now', '-${days} days')
    `;

    try {
      const oldFiles = await this.db.db.all(sql);
      let deletedCount = 0;

      for (const file of oldFiles) {
        try {
          await this.deleteAudioFile(file.id);
          deletedCount++;
        } catch (error) {
          console.warn('[AudioStorage] 清理文件失败:', file.id, error);
        }
      }

      console.log(`[AudioStorage] 已清理 ${deletedCount} 个旧文件`);

      return {
        success: true,
        deletedCount: deletedCount,
        totalFound: oldFiles.length,
      };
    } catch (error) {
      console.error('[AudioStorage] 清理旧文件失败:', error);
      throw error;
    }
  }
}

module.exports = AudioStorage;
