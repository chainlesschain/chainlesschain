/**
 * 视频数据库存储管理器
 * 负责视频相关数据的增删改查操作
 */

const { v4: uuidv4 } = require('uuid');

/**
 * 视频存储管理类
 */
class VideoStorage {
  /**
   * @param {Object} database - 数据库实例
   */
  constructor(database) {
    this.db = database;
  }

  // ========================================
  // 视频文件管理
  // ========================================

  /**
   * 创建视频文件记录
   * @param {Object} videoData - 视频数据
   * @returns {Promise<Object>} 创建的记录
   */
  async createVideoFile(videoData) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const sql = `
      INSERT INTO video_files (
        id, file_name, file_path, file_size, duration, width, height,
        fps, format, video_codec, audio_codec, bitrate, has_audio,
        thumbnail_path, knowledge_id, analysis_status, analysis_progress,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      videoData.fileName || '',
      videoData.filePath || '',
      videoData.fileSize || 0,
      videoData.duration || 0,
      videoData.width || 0,
      videoData.height || 0,
      videoData.fps || 0,
      videoData.format || '',
      videoData.videoCodec || '',
      videoData.audioCodec || '',
      videoData.bitrate || 0,
      videoData.hasAudio !== undefined ? (videoData.hasAudio ? 1 : 0) : 1,
      videoData.thumbnailPath || null,
      videoData.knowledgeId || null,
      videoData.analysisStatus || 'pending',
      videoData.analysisProgress || 0,
      now,
      now
    ];

    await this.db.run(sql, params);

    return this.getVideoFile(id);
  }

  /**
   * 获取视频文件记录
   * @param {string} id - 视频文件ID
   * @returns {Promise<Object|null>}
   */
  async getVideoFile(id) {
    const sql = 'SELECT * FROM video_files WHERE id = ?';
    return await this.db.get(sql, [id]);
  }

  /**
   * 根据文件路径获取视频
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object|null>}
   */
  async getVideoFileByPath(filePath) {
    const sql = 'SELECT * FROM video_files WHERE file_path = ?';
    return await this.db.get(sql, [filePath]);
  }

  /**
   * 根据知识库ID获取视频列表
   * @param {string} knowledgeId - 知识库ID
   * @returns {Promise<Array>}
   */
  async getVideosByKnowledgeId(knowledgeId) {
    const sql = 'SELECT * FROM video_files WHERE knowledge_id = ? ORDER BY created_at DESC';
    return await this.db.all(sql, [knowledgeId]);
  }

  /**
   * 更新视频文件记录
   * @param {string} id - 视频文件ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>}
   */
  async updateVideoFile(id, updates) {
    const allowedFields = [
      'file_name', 'file_path', 'file_size', 'duration', 'width', 'height',
      'fps', 'format', 'video_codec', 'audio_codec', 'bitrate', 'has_audio',
      'thumbnail_path', 'knowledge_id', 'analysis_status', 'analysis_progress'
    ];

    const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const sql = `UPDATE video_files SET ${setClause}, updated_at = ? WHERE id = ?`;
    const params = [...fields.map(field => updates[field]), new Date().toISOString(), id];

    await this.db.run(sql, params);
    return this.getVideoFile(id);
  }

  /**
   * 删除视频文件记录
   * @param {string} id - 视频文件ID
   * @returns {Promise<void>}
   */
  async deleteVideoFile(id) {
    const sql = 'DELETE FROM video_files WHERE id = ?';
    await this.db.run(sql, [id]);
  }

  /**
   * 获取所有视频列表
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}
   */
  async getAllVideos(options = {}) {
    const { limit = 100, offset = 0, orderBy = 'created_at', order = 'DESC' } = options;
    const sql = `SELECT * FROM video_files ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`;
    return await this.db.all(sql, [limit, offset]);
  }

  // ========================================
  // 视频分析结果管理
  // ========================================

  /**
   * 创建视频分析记录
   * @param {Object} analysisData - 分析数据
   * @returns {Promise<Object>}
   */
  async createVideoAnalysis(analysisData) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const sql = `
      INSERT INTO video_analysis (
        id, video_file_id, audio_path, transcription_text, transcription_confidence,
        summary, tags, key_topics, sentiment, ocr_text, ocr_confidence,
        analysis_engine, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      analysisData.videoFileId,
      analysisData.audioPath || null,
      analysisData.transcriptionText || null,
      analysisData.transcriptionConfidence || null,
      analysisData.summary || null,
      analysisData.tags || null,
      analysisData.keyTopics || null,
      analysisData.sentiment || null,
      analysisData.ocrText || null,
      analysisData.ocrConfidence || null,
      analysisData.analysisEngine || 'ffmpeg',
      now
    ];

    await this.db.run(sql, params);
    return this.getVideoAnalysis(id);
  }

  /**
   * 获取视频分析记录
   * @param {string} id - 分析记录ID
   * @returns {Promise<Object|null>}
   */
  async getVideoAnalysis(id) {
    const sql = 'SELECT * FROM video_analysis WHERE id = ?';
    return await this.db.get(sql, [id]);
  }

  /**
   * 根据视频ID获取分析记录
   * @param {string} videoFileId - 视频文件ID
   * @returns {Promise<Object|null>}
   */
  async getVideoAnalysisByVideoId(videoFileId) {
    const sql = 'SELECT * FROM video_analysis WHERE video_file_id = ?';
    return await this.db.get(sql, [videoFileId]);
  }

  /**
   * 更新视频分析记录
   * @param {string} id - 分析记录ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>}
   */
  async updateVideoAnalysis(id, updates) {
    const allowedFields = [
      'audio_path', 'transcription_text', 'transcription_confidence',
      'summary', 'tags', 'key_topics', 'sentiment', 'ocr_text',
      'ocr_confidence', 'analysis_engine'
    ];

    const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const sql = `UPDATE video_analysis SET ${setClause} WHERE id = ?`;
    const params = [...fields.map(field => updates[field]), id];

    await this.db.run(sql, params);
    return this.getVideoAnalysis(id);
  }

  // ========================================
  // 关键帧管理
  // ========================================

  /**
   * 创建关键帧记录
   * @param {Object} keyframeData - 关键帧数据
   * @returns {Promise<Object>}
   */
  async createKeyframe(keyframeData) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const sql = `
      INSERT INTO video_keyframes (
        id, video_file_id, frame_path, timestamp, scene_change_score,
        ocr_text, ocr_confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      keyframeData.videoFileId,
      keyframeData.framePath,
      keyframeData.timestamp,
      keyframeData.sceneChangeScore || null,
      keyframeData.ocrText || null,
      keyframeData.ocrConfidence || null,
      now
    ];

    await this.db.run(sql, params);
    return this.getKeyframe(id);
  }

  /**
   * 获取关键帧记录
   * @param {string} id - 关键帧ID
   * @returns {Promise<Object|null>}
   */
  async getKeyframe(id) {
    const sql = 'SELECT * FROM video_keyframes WHERE id = ?';
    return await this.db.get(sql, [id]);
  }

  /**
   * 根据视频ID获取所有关键帧
   * @param {string} videoFileId - 视频文件ID
   * @returns {Promise<Array>}
   */
  async getKeyframesByVideoId(videoFileId) {
    const sql = 'SELECT * FROM video_keyframes WHERE video_file_id = ? ORDER BY timestamp ASC';
    return await this.db.all(sql, [videoFileId]);
  }

  /**
   * 批量创建关键帧
   * @param {Array<Object>} keyframes - 关键帧数组
   * @returns {Promise<Array>}
   */
  async createKeyframesBatch(keyframes) {
    const results = [];
    for (const keyframe of keyframes) {
      const result = await this.createKeyframe(keyframe);
      results.push(result);
    }
    return results;
  }

  // ========================================
  // 字幕管理
  // ========================================

  /**
   * 创建字幕记录
   * @param {Object} subtitleData - 字幕数据
   * @returns {Promise<Object>}
   */
  async createSubtitle(subtitleData) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const sql = `
      INSERT INTO video_subtitles (
        id, video_file_id, subtitle_type, language, format, file_path,
        content, source, is_default, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      subtitleData.videoFileId,
      subtitleData.subtitleType || 'external',
      subtitleData.language || 'zh-CN',
      subtitleData.format || 'srt',
      subtitleData.filePath,
      subtitleData.content || null,
      subtitleData.source || 'manual',
      subtitleData.isDefault !== undefined ? (subtitleData.isDefault ? 1 : 0) : 0,
      now,
      now
    ];

    await this.db.run(sql, params);
    return this.getSubtitle(id);
  }

  /**
   * 获取字幕记录
   * @param {string} id - 字幕ID
   * @returns {Promise<Object|null>}
   */
  async getSubtitle(id) {
    const sql = 'SELECT * FROM video_subtitles WHERE id = ?';
    return await this.db.get(sql, [id]);
  }

  /**
   * 根据视频ID获取所有字幕
   * @param {string} videoFileId - 视频文件ID
   * @returns {Promise<Array>}
   */
  async getSubtitlesByVideoId(videoFileId) {
    const sql = 'SELECT * FROM video_subtitles WHERE video_file_id = ? ORDER BY created_at ASC';
    return await this.db.all(sql, [videoFileId]);
  }

  /**
   * 更新字幕记录
   * @param {string} id - 字幕ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>}
   */
  async updateSubtitle(id, updates) {
    const allowedFields = [
      'subtitle_type', 'language', 'format', 'file_path',
      'content', 'source', 'is_default'
    ];

    const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const sql = `UPDATE video_subtitles SET ${setClause}, updated_at = ? WHERE id = ?`;
    const params = [...fields.map(field => updates[field]), new Date().toISOString(), id];

    await this.db.run(sql, params);
    return this.getSubtitle(id);
  }

  // ========================================
  // 编辑历史管理
  // ========================================

  /**
   * 创建编辑历史记录
   * @param {Object} historyData - 编辑历史数据
   * @returns {Promise<Object>}
   */
  async createEditHistory(historyData) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const sql = `
      INSERT INTO video_edit_history (
        id, original_video_id, output_video_id, output_path, operation_type,
        operation_params, status, progress, duration, error_message,
        created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      historyData.originalVideoId,
      historyData.outputVideoId || null,
      historyData.outputPath || null,
      historyData.operationType,
      historyData.operationParams || null,
      historyData.status || 'pending',
      historyData.progress || 0,
      historyData.duration || null,
      historyData.errorMessage || null,
      now,
      historyData.completedAt || null
    ];

    await this.db.run(sql, params);
    return this.getEditHistory(id);
  }

  /**
   * 获取编辑历史记录
   * @param {string} id - 编辑历史ID
   * @returns {Promise<Object|null>}
   */
  async getEditHistory(id) {
    const sql = 'SELECT * FROM video_edit_history WHERE id = ?';
    return await this.db.get(sql, [id]);
  }

  /**
   * 根据原始视频ID获取编辑历史
   * @param {string} originalVideoId - 原始视频ID
   * @returns {Promise<Array>}
   */
  async getEditHistoryByVideoId(originalVideoId) {
    const sql = 'SELECT * FROM video_edit_history WHERE original_video_id = ? ORDER BY created_at DESC';
    return await this.db.all(sql, [originalVideoId]);
  }

  /**
   * 更新编辑历史记录
   * @param {string} id - 编辑历史ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>}
   */
  async updateEditHistory(id, updates) {
    const allowedFields = [
      'output_video_id', 'output_path', 'status', 'progress',
      'duration', 'error_message', 'completed_at'
    ];

    const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const sql = `UPDATE video_edit_history SET ${setClause} WHERE id = ?`;
    const params = [...fields.map(field => updates[field]), id];

    await this.db.run(sql, params);
    return this.getEditHistory(id);
  }

  // ========================================
  // 场景管理
  // ========================================

  /**
   * 创建场景记录
   * @param {Object} sceneData - 场景数据
   * @returns {Promise<Object>}
   */
  async createScene(sceneData) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const sql = `
      INSERT INTO video_scenes (
        id, video_file_id, scene_index, start_time, end_time, duration,
        keyframe_path, description, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      sceneData.videoFileId,
      sceneData.sceneIndex,
      sceneData.startTime,
      sceneData.endTime,
      sceneData.duration || (sceneData.endTime - sceneData.startTime),
      sceneData.keyframePath || null,
      sceneData.description || null,
      now
    ];

    await this.db.run(sql, params);
    return this.getScene(id);
  }

  /**
   * 获取场景记录
   * @param {string} id - 场景ID
   * @returns {Promise<Object|null>}
   */
  async getScene(id) {
    const sql = 'SELECT * FROM video_scenes WHERE id = ?';
    return await this.db.get(sql, [id]);
  }

  /**
   * 根据视频ID获取所有场景
   * @param {string} videoFileId - 视频文件ID
   * @returns {Promise<Array>}
   */
  async getScenesByVideoId(videoFileId) {
    const sql = 'SELECT * FROM video_scenes WHERE video_file_id = ? ORDER BY scene_index ASC';
    return await this.db.all(sql, [videoFileId]);
  }

  /**
   * 批量创建场景
   * @param {Array<Object>} scenes - 场景数组
   * @returns {Promise<Array>}
   */
  async createScenesBatch(scenes) {
    const results = [];
    for (const scene of scenes) {
      const result = await this.createScene(scene);
      results.push(result);
    }
    return results;
  }

  // ========================================
  // 统计查询
  // ========================================

  /**
   * 获取视频总数
   * @returns {Promise<number>}
   */
  async getVideoCount() {
    const sql = 'SELECT COUNT(*) as count FROM video_files';
    const result = await this.db.get(sql);
    return result.count;
  }

  /**
   * 获取总视频时长（秒）
   * @returns {Promise<number>}
   */
  async getTotalDuration() {
    const sql = 'SELECT SUM(duration) as total FROM video_files';
    const result = await this.db.get(sql);
    return result.total || 0;
  }

  /**
   * 获取总存储大小（字节）
   * @returns {Promise<number>}
   */
  async getTotalStorageSize() {
    const sql = 'SELECT SUM(file_size) as total FROM video_files';
    const result = await this.db.get(sql);
    return result.total || 0;
  }

  /**
   * 按状态统计视频数量
   * @returns {Promise<Object>}
   */
  async getVideoCountByStatus() {
    const sql = `
      SELECT analysis_status, COUNT(*) as count
      FROM video_files
      GROUP BY analysis_status
    `;
    const results = await this.db.all(sql);
    const stats = {};
    results.forEach(row => {
      stats[row.analysis_status] = row.count;
    });
    return stats;
  }
}

module.exports = VideoStorage;
