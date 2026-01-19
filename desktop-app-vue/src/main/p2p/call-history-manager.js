/**
 * Call History Manager
 *
 * 管理通话历史记录
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');

class CallHistoryManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
  }

  /**
   * 初始化
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // 创建通话历史表
      await this.database.run(`
        CREATE TABLE IF NOT EXISTS call_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          call_id TEXT UNIQUE NOT NULL,
          peer_id TEXT NOT NULL,
          call_type TEXT NOT NULL,
          direction TEXT NOT NULL,
          status TEXT NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER,
          duration INTEGER DEFAULT 0,
          is_answered BOOLEAN DEFAULT 0,
          reject_reason TEXT,
          quality_stats TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // 创建索引
      await this.database.run(`
        CREATE INDEX IF NOT EXISTS idx_call_history_peer_id
        ON call_history(peer_id)
      `);

      await this.database.run(`
        CREATE INDEX IF NOT EXISTS idx_call_history_start_time
        ON call_history(start_time DESC)
      `);

      await this.database.run(`
        CREATE INDEX IF NOT EXISTS idx_call_history_status
        ON call_history(status)
      `);

      this.initialized = true;
      logger.info('[CallHistoryManager] 初始化完成');
    } catch (error) {
      logger.error('[CallHistoryManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 记录通话开始
   */
  async recordCallStart(callData) {
    const {
      callId,
      peerId,
      type,
      isInitiator
    } = callData;

    const now = Date.now();

    try {
      await this.database.run(`
        INSERT INTO call_history (
          call_id, peer_id, call_type, direction, status,
          start_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        callId,
        peerId,
        type,
        isInitiator ? 'outgoing' : 'incoming',
        'calling',
        now,
        now,
        now
      ]);

      logger.info('[CallHistoryManager] 通话记录已创建:', callId);

      this.emit('call-recorded', { callId, peerId, type });

      return callId;
    } catch (error) {
      logger.error('[CallHistoryManager] 记录通话开始失败:', error);
      throw error;
    }
  }

  /**
   * 更新通话状态
   */
  async updateCallStatus(callId, status, additionalData = {}) {
    const now = Date.now();

    try {
      const updates = ['status = ?', 'updated_at = ?'];
      const values = [status, now];

      // 处理额外数据
      if (additionalData.isAnswered !== undefined) {
        updates.push('is_answered = ?');
        values.push(additionalData.isAnswered ? 1 : 0);
      }

      if (additionalData.rejectReason) {
        updates.push('reject_reason = ?');
        values.push(additionalData.rejectReason);
      }

      if (additionalData.endTime) {
        updates.push('end_time = ?');
        values.push(additionalData.endTime);
      }

      if (additionalData.duration !== undefined) {
        updates.push('duration = ?');
        values.push(additionalData.duration);
      }

      if (additionalData.qualityStats) {
        updates.push('quality_stats = ?');
        values.push(JSON.stringify(additionalData.qualityStats));
      }

      values.push(callId);

      await this.database.run(`
        UPDATE call_history
        SET ${updates.join(', ')}
        WHERE call_id = ?
      `, values);

      logger.info('[CallHistoryManager] 通话状态已更新:', callId, status);

      this.emit('call-updated', { callId, status, ...additionalData });
    } catch (error) {
      logger.error('[CallHistoryManager] 更新通话状态失败:', error);
      throw error;
    }
  }

  /**
   * 记录通话结束
   */
  async recordCallEnd(callId, endData = {}) {
    const now = Date.now();

    try {
      // 获取通话记录
      const call = await this.database.get(
        'SELECT * FROM call_history WHERE call_id = ?',
        [callId]
      );

      if (!call) {
        logger.warn('[CallHistoryManager] 通话记录不存在:', callId);
        return;
      }

      // 计算通话时长
      const duration = endData.duration || (call.end_time || now) - call.start_time;

      await this.updateCallStatus(callId, 'ended', {
        endTime: now,
        duration: Math.floor(duration / 1000), // 转换为秒
        qualityStats: endData.qualityStats
      });

      logger.info('[CallHistoryManager] 通话已结束:', callId, `${Math.floor(duration / 1000)}秒`);

      this.emit('call-ended', { callId, duration });
    } catch (error) {
      logger.error('[CallHistoryManager] 记录通话结束失败:', error);
      throw error;
    }
  }

  /**
   * 获取通话历史
   */
  async getCallHistory(options = {}) {
    const {
      peerId,
      type,
      direction,
      status,
      limit = 50,
      offset = 0
    } = options;

    try {
      const conditions = [];
      const values = [];

      if (peerId) {
        conditions.push('peer_id = ?');
        values.push(peerId);
      }

      if (type) {
        conditions.push('call_type = ?');
        values.push(type);
      }

      if (direction) {
        conditions.push('direction = ?');
        values.push(direction);
      }

      if (status) {
        conditions.push('status = ?');
        values.push(status);
      }

      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      values.push(limit, offset);

      const calls = await this.database.all(`
        SELECT * FROM call_history
        ${whereClause}
        ORDER BY start_time DESC
        LIMIT ? OFFSET ?
      `, values);

      // 解析质量统计
      return calls.map(call => ({
        ...call,
        isAnswered: Boolean(call.is_answered),
        qualityStats: call.quality_stats ? JSON.parse(call.quality_stats) : null
      }));
    } catch (error) {
      logger.error('[CallHistoryManager] 获取通话历史失败:', error);
      throw error;
    }
  }

  /**
   * 获取通话详情
   */
  async getCallDetails(callId) {
    try {
      const call = await this.database.get(
        'SELECT * FROM call_history WHERE call_id = ?',
        [callId]
      );

      if (!call) {
        return null;
      }

      return {
        ...call,
        isAnswered: Boolean(call.is_answered),
        qualityStats: call.quality_stats ? JSON.parse(call.quality_stats) : null
      };
    } catch (error) {
      logger.error('[CallHistoryManager] 获取通话详情失败:', error);
      throw error;
    }
  }

  /**
   * 获取通话统计
   */
  async getCallStatistics(peerId = null) {
    try {
      const whereClause = peerId ? 'WHERE peer_id = ?' : '';
      const values = peerId ? [peerId] : [];

      const stats = await this.database.get(`
        SELECT
          COUNT(*) as total_calls,
          SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) as outgoing_calls,
          SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) as incoming_calls,
          SUM(CASE WHEN call_type = 'audio' THEN 1 ELSE 0 END) as audio_calls,
          SUM(CASE WHEN call_type = 'video' THEN 1 ELSE 0 END) as video_calls,
          SUM(CASE WHEN is_answered = 1 THEN 1 ELSE 0 END) as answered_calls,
          SUM(CASE WHEN status = 'ended' AND is_answered = 1 THEN duration ELSE 0 END) as total_duration,
          AVG(CASE WHEN status = 'ended' AND is_answered = 1 THEN duration ELSE NULL END) as avg_duration
        FROM call_history
        ${whereClause}
      `, values);

      return {
        totalCalls: stats.total_calls || 0,
        outgoingCalls: stats.outgoing_calls || 0,
        incomingCalls: stats.incoming_calls || 0,
        audioCalls: stats.audio_calls || 0,
        videoCalls: stats.video_calls || 0,
        answeredCalls: stats.answered_calls || 0,
        missedCalls: (stats.total_calls || 0) - (stats.answered_calls || 0),
        totalDuration: stats.total_duration || 0,
        avgDuration: Math.round(stats.avg_duration || 0)
      };
    } catch (error) {
      logger.error('[CallHistoryManager] 获取通话统计失败:', error);
      throw error;
    }
  }

  /**
   * 删除通话记录
   */
  async deleteCallHistory(callId) {
    try {
      await this.database.run(
        'DELETE FROM call_history WHERE call_id = ?',
        [callId]
      );

      logger.info('[CallHistoryManager] 通话记录已删除:', callId);

      this.emit('call-deleted', { callId });
    } catch (error) {
      logger.error('[CallHistoryManager] 删除通话记录失败:', error);
      throw error;
    }
  }

  /**
   * 清空通话历史
   */
  async clearCallHistory(peerId = null) {
    try {
      if (peerId) {
        await this.database.run(
          'DELETE FROM call_history WHERE peer_id = ?',
          [peerId]
        );
        logger.info('[CallHistoryManager] 已清空指定用户的通话历史:', peerId);
      } else {
        await this.database.run('DELETE FROM call_history');
        logger.info('[CallHistoryManager] 已清空所有通话历史');
      }

      this.emit('history-cleared', { peerId });
    } catch (error) {
      logger.error('[CallHistoryManager] 清空通话历史失败:', error);
      throw error;
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.removeAllListeners();
    logger.info('[CallHistoryManager] 资源已清理');
  }
}

module.exports = CallHistoryManager;
