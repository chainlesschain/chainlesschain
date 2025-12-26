const EventEmitter = require('events');

/**
 * 信用评分管理器
 * 负责计算和管理用户信用评分
 */
class CreditScoreManager extends EventEmitter {
  constructor(db) {
    super();
    this.db = db;

    // 信用等级定义
    this.creditLevels = [
      { name: '新手', min: 0, max: 100, color: 'gray', benefits: [] },
      { name: '青铜', min: 101, max: 300, color: 'bronze', benefits: ['降低 5% 手续费'] },
      { name: '白银', min: 301, max: 600, color: 'silver', benefits: ['降低 10% 手续费', '优先展示'] },
      { name: '黄金', min: 601, max: 900, color: 'gold', benefits: ['降低 15% 手续费', '优先展示', '更高托管比例'] },
      { name: '钻石', min: 901, max: 1000, color: 'diamond', benefits: ['降低 20% 手续费', '优先展示', '免保证金', 'VIP 支持'] }
    ];

    // 评分权重配置
    this.scoreWeights = {
      completionRate: 0.30,      // 交易完成率权重 30%
      tradeVolume: 0.20,         // 交易金额权重 20%
      positiveRate: 0.25,        // 好评率权重 25%
      responseSpeed: 0.10,       // 响应速度权重 10%
      disputeRate: 0.10,         // 纠纷率权重 10%
      refundRate: 0.05           // 退款率权重 5%
    };

    this.initDatabase();
  }

  /**
   * 初始化数据库表
   */
  initDatabase() {
    // 用户信用表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_credits (
        user_did TEXT PRIMARY KEY,
        credit_score INTEGER DEFAULT 0,
        credit_level TEXT DEFAULT '新手',
        total_transactions INTEGER DEFAULT 0,
        completed_transactions INTEGER DEFAULT 0,
        total_volume INTEGER DEFAULT 0,
        positive_reviews INTEGER DEFAULT 0,
        negative_reviews INTEGER DEFAULT 0,
        disputes INTEGER DEFAULT 0,
        refunds INTEGER DEFAULT 0,
        avg_response_time INTEGER DEFAULT 0,
        last_updated INTEGER NOT NULL
      )
    `);

    // 信用记录表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS credit_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_did TEXT NOT NULL,
        event_type TEXT NOT NULL,        -- 'trade_completed', 'positive_review', 'dispute', etc.
        event_id TEXT NOT NULL,          -- 关联事件 ID
        score_change INTEGER NOT NULL,   -- 分数变化
        score_after INTEGER NOT NULL,    -- 变化后的分数
        reason TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // 信用快照表（用于历史追踪）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS credit_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_did TEXT NOT NULL,
        credit_score INTEGER NOT NULL,
        credit_level TEXT NOT NULL,
        snapshot_date INTEGER NOT NULL,
        metadata TEXT
      )
    `);

    console.log('[CreditScore] 数据库表初始化完成');
  }

  /**
   * 初始化用户信用记录
   */
  initUserCredit(userDid) {
    const existing = this.db.prepare(`
      SELECT * FROM user_credits WHERE user_did = ?
    `).get(userDid);

    if (existing) {
      return existing;
    }

    const now = Date.now();

    this.db.prepare(`
      INSERT INTO user_credits (user_did, last_updated)
      VALUES (?, ?)
    `).run(userDid, now);

    console.log('[CreditScore] 用户信用记录已初始化:', userDid);
    return this.getUserCredit(userDid);
  }

  /**
   * 获取用户信用信息
   */
  getUserCredit(userDid) {
    let credit = this.db.prepare(`
      SELECT * FROM user_credits WHERE user_did = ?
    `).get(userDid);

    if (!credit) {
      credit = this.initUserCredit(userDid);
    }

    return {
      userDid: credit.user_did,
      creditScore: credit.credit_score,
      creditLevel: credit.credit_level,
      totalTransactions: credit.total_transactions,
      completedTransactions: credit.completed_transactions,
      totalVolume: credit.total_volume,
      positiveReviews: credit.positive_reviews,
      negativeReviews: credit.negative_reviews,
      disputes: credit.disputes,
      refunds: credit.refunds,
      avgResponseTime: credit.avg_response_time,
      lastUpdated: credit.last_updated
    };
  }

  /**
   * 计算信用评分
   */
  async calculateCreditScore(userDid) {
    const credit = this.getUserCredit(userDid);

    let score = 0;

    // 1. 交易完成率 (30%)
    const completionRate = credit.total_transactions > 0
      ? credit.completed_transactions / credit.total_transactions
      : 0;
    score += completionRate * 300 * this.scoreWeights.completionRate / 0.30;

    // 2. 交易金额 (20%) - 对数增长，最高 200 分
    const volumeScore = Math.min(
      200,
      Math.log10(credit.total_volume + 1) * 50
    );
    score += volumeScore * this.scoreWeights.tradeVolume / 0.20;

    // 3. 好评率 (25%)
    const totalReviews = credit.positive_reviews + credit.negative_reviews;
    const positiveRate = totalReviews > 0
      ? credit.positive_reviews / totalReviews
      : 0.5; // 默认中等
    score += positiveRate * 250 * this.scoreWeights.positiveRate / 0.25;

    // 4. 响应速度 (10%) - 响应时间越短越好
    const responseScore = credit.avg_response_time > 0
      ? Math.max(0, 100 - (credit.avg_response_time / 3600000)) // 1小时内满分
      : 50; // 默认中等
    score += responseScore * this.scoreWeights.responseSpeed / 0.10;

    // 5. 纠纷率 (10%) - 扣分项
    const disputeRate = credit.total_transactions > 0
      ? credit.disputes / credit.total_transactions
      : 0;
    score += (1 - disputeRate) * 100 * this.scoreWeights.disputeRate / 0.10;

    // 6. 退款率 (5%) - 扣分项
    const refundRate = credit.total_transactions > 0
      ? credit.refunds / credit.total_transactions
      : 0;
    score += (1 - refundRate) * 50 * this.scoreWeights.refundRate / 0.05;

    // 限制在 0-1000 范围内
    score = Math.max(0, Math.min(1000, Math.round(score)));

    // 确定信用等级
    const level = this.getCreditLevel(score);

    // 更新数据库
    const now = Date.now();
    this.db.prepare(`
      UPDATE user_credits
      SET credit_score = ?, credit_level = ?, last_updated = ?
      WHERE user_did = ?
    `).run(score, level.name, now, userDid);

    // 触发事件
    this.emit('credit:updated', {
      userDid,
      creditScore: score,
      creditLevel: level.name
    });

    console.log('[CreditScore] 信用评分已更新:', userDid, score, level.name);

    return {
      creditScore: score,
      creditLevel: level.name,
      levelColor: level.color,
      benefits: level.benefits
    };
  }

  /**
   * 根据分数获取信用等级
   */
  getCreditLevel(score) {
    for (const level of this.creditLevels) {
      if (score >= level.min && score <= level.max) {
        return level;
      }
    }
    return this.creditLevels[0]; // 默认新手
  }

  /**
   * 更新信用记录（交易完成）
   */
  async onTransactionCompleted(userDid, transactionId, amount) {
    // 初始化或获取信用记录
    const credit = this.getUserCredit(userDid);

    // 更新统计
    this.db.prepare(`
      UPDATE user_credits
      SET total_transactions = total_transactions + 1,
          completed_transactions = completed_transactions + 1,
          total_volume = total_volume + ?
      WHERE user_did = ?
    `).run(amount, userDid);

    // 记录信用变化
    const scoreChange = 10; // 完成交易加 10 分
    await this.addCreditRecord(
      userDid,
      'trade_completed',
      transactionId,
      scoreChange,
      '完成交易'
    );

    // 重新计算评分
    await this.calculateCreditScore(userDid);
  }

  /**
   * 更新信用记录（交易取消）
   */
  async onTransactionCancelled(userDid, transactionId) {
    // 更新统计
    this.db.prepare(`
      UPDATE user_credits
      SET total_transactions = total_transactions + 1
      WHERE user_did = ?
    `).run(userDid);

    // 记录信用变化
    const scoreChange = -5; // 取消交易扣 5 分
    await this.addCreditRecord(
      userDid,
      'trade_cancelled',
      transactionId,
      scoreChange,
      '取消交易'
    );

    // 重新计算评分
    await this.calculateCreditScore(userDid);
  }

  /**
   * 更新信用记录（收到好评）
   */
  async onPositiveReview(userDid, reviewId, rating) {
    // 更新统计
    this.db.prepare(`
      UPDATE user_credits
      SET positive_reviews = positive_reviews + 1
      WHERE user_did = ?
    `).run(userDid);

    // 记录信用变化 - 5星加15分，4星加10分，3星加5分
    let scoreChange = 5;
    if (rating >= 5) scoreChange = 15;
    else if (rating >= 4) scoreChange = 10;

    await this.addCreditRecord(
      userDid,
      'positive_review',
      reviewId,
      scoreChange,
      `收到 ${rating} 星好评`
    );

    // 重新计算评分
    await this.calculateCreditScore(userDid);
  }

  /**
   * 更新信用记录（收到差评）
   */
  async onNegativeReview(userDid, reviewId, rating) {
    // 更新统计
    this.db.prepare(`
      UPDATE user_credits
      SET negative_reviews = negative_reviews + 1
      WHERE user_did = ?
    `).run(userDid);

    // 记录信用变化 - 1星扣30分，2星扣20分
    let scoreChange = -10;
    if (rating <= 1) scoreChange = -30;
    else if (rating <= 2) scoreChange = -20;

    await this.addCreditRecord(
      userDid,
      'negative_review',
      reviewId,
      scoreChange,
      `收到 ${rating} 星差评`
    );

    // 重新计算评分
    await this.calculateCreditScore(userDid);
  }

  /**
   * 更新信用记录（发生纠纷）
   */
  async onDisputeInitiated(userDid, disputeId) {
    // 更新统计
    this.db.prepare(`
      UPDATE user_credits
      SET disputes = disputes + 1
      WHERE user_did = ?
    `).run(userDid);

    // 记录信用变化
    const scoreChange = -20; // 发生纠纷扣 20 分
    await this.addCreditRecord(
      userDid,
      'dispute',
      disputeId,
      scoreChange,
      '发生纠纷'
    );

    // 重新计算评分
    await this.calculateCreditScore(userDid);
  }

  /**
   * 更新信用记录（纠纷解决）
   */
  async onDisputeResolved(userDid, disputeId, resolution) {
    // 根据解决结果调整分数
    let scoreChange = 0;
    let reason = '';

    if (resolution === 'favor_user') {
      // 用户胜诉，恢复部分分数
      scoreChange = 10;
      reason = '纠纷解决（胜诉）';
    } else if (resolution === 'favor_opponent') {
      // 用户败诉，额外扣分
      scoreChange = -10;
      reason = '纠纷解决（败诉）';
    } else {
      // 和解
      scoreChange = 5;
      reason = '纠纷解决（和解）';
    }

    await this.addCreditRecord(
      userDid,
      'dispute_resolved',
      disputeId,
      scoreChange,
      reason
    );

    // 重新计算评分
    await this.calculateCreditScore(userDid);
  }

  /**
   * 更新信用记录（退款）
   */
  async onRefund(userDid, refundId) {
    // 更新统计
    this.db.prepare(`
      UPDATE user_credits
      SET refunds = refunds + 1
      WHERE user_did = ?
    `).run(userDid);

    // 记录信用变化
    const scoreChange = -8; // 退款扣 8 分
    await this.addCreditRecord(
      userDid,
      'refund',
      refundId,
      scoreChange,
      '发生退款'
    );

    // 重新计算评分
    await this.calculateCreditScore(userDid);
  }

  /**
   * 更新响应时间
   */
  async updateResponseTime(userDid, responseTime) {
    const credit = this.getUserCredit(userDid);

    // 计算平均响应时间
    const count = credit.total_transactions || 1;
    const avgTime = Math.round(
      (credit.avg_response_time * (count - 1) + responseTime) / count
    );

    this.db.prepare(`
      UPDATE user_credits
      SET avg_response_time = ?
      WHERE user_did = ?
    `).run(avgTime, userDid);

    // 重新计算评分
    await this.calculateCreditScore(userDid);
  }

  /**
   * 添加信用记录
   */
  async addCreditRecord(userDid, eventType, eventId, scoreChange, reason) {
    const credit = this.getUserCredit(userDid);
    const scoreAfter = credit.creditScore + scoreChange;
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO credit_records (
        user_did, event_type, event_id, score_change, score_after, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userDid, eventType, eventId, scoreChange, scoreAfter, reason, now);

    console.log('[CreditScore] 信用记录已添加:', userDid, eventType, scoreChange);
  }

  /**
   * 获取信用记录
   */
  getCreditRecords(userDid, limit = 50) {
    const rows = this.db.prepare(`
      SELECT * FROM credit_records
      WHERE user_did = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userDid, limit);

    return rows.map(row => ({
      id: row.id,
      eventType: row.event_type,
      eventId: row.event_id,
      scoreChange: row.score_change,
      scoreAfter: row.score_after,
      reason: row.reason,
      createdAt: row.created_at
    }));
  }

  /**
   * 获取信用报告
   */
  getCreditReport(userDid) {
    const credit = this.getUserCredit(userDid);
    const level = this.getCreditLevel(credit.creditScore);

    // 计算各项指标
    const completionRate = credit.totalTransactions > 0
      ? (credit.completedTransactions / credit.totalTransactions * 100).toFixed(1)
      : 0;

    const totalReviews = credit.positiveReviews + credit.negativeReviews;
    const positiveRate = totalReviews > 0
      ? (credit.positiveReviews / totalReviews * 100).toFixed(1)
      : 0;

    const disputeRate = credit.totalTransactions > 0
      ? (credit.disputes / credit.totalTransactions * 100).toFixed(1)
      : 0;

    const refundRate = credit.totalTransactions > 0
      ? (credit.refunds / credit.totalTransactions * 100).toFixed(1)
      : 0;

    // 获取最近记录
    const recentRecords = this.getCreditRecords(userDid, 10);

    return {
      userDid,
      creditScore: credit.creditScore,
      creditLevel: level.name,
      levelColor: level.color,
      benefits: level.benefits,
      statistics: {
        totalTransactions: credit.totalTransactions,
        completedTransactions: credit.completedTransactions,
        completionRate: parseFloat(completionRate),
        totalVolume: credit.totalVolume,
        positiveReviews: credit.positiveReviews,
        negativeReviews: credit.negativeReviews,
        positiveRate: parseFloat(positiveRate),
        disputes: credit.disputes,
        disputeRate: parseFloat(disputeRate),
        refunds: credit.refunds,
        refundRate: parseFloat(refundRate),
        avgResponseTime: credit.avgResponseTime
      },
      recentRecords,
      lastUpdated: credit.lastUpdated
    };
  }

  /**
   * 验证信用等级
   */
  verifyCreditLevel(userDid, requiredLevel) {
    const credit = this.getUserCredit(userDid);
    const currentLevel = this.getCreditLevel(credit.creditScore);
    const required = this.creditLevels.find(l => l.name === requiredLevel);

    if (!required) {
      return false;
    }

    return currentLevel.min >= required.min;
  }

  /**
   * 获取信用排行榜
   */
  getLeaderboard(limit = 50) {
    const rows = this.db.prepare(`
      SELECT * FROM user_credits
      ORDER BY credit_score DESC, total_transactions DESC
      LIMIT ?
    `).all(limit);

    return rows.map((row, index) => ({
      rank: index + 1,
      userDid: row.user_did,
      creditScore: row.credit_score,
      creditLevel: row.credit_level,
      totalTransactions: row.total_transactions,
      totalVolume: row.total_volume
    }));
  }

  /**
   * 创建信用快照
   */
  createSnapshot(userDid) {
    const credit = this.getUserCredit(userDid);
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO credit_snapshots (
        user_did, credit_score, credit_level, snapshot_date, metadata
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      userDid,
      credit.creditScore,
      credit.creditLevel,
      now,
      JSON.stringify({
        totalTransactions: credit.totalTransactions,
        totalVolume: credit.totalVolume
      })
    );

    console.log('[CreditScore] 信用快照已创建:', userDid);
  }

  /**
   * 获取信用历史趋势
   */
  getCreditTrend(userDid, days = 30) {
    const startDate = Date.now() - (days * 24 * 60 * 60 * 1000);

    const rows = this.db.prepare(`
      SELECT * FROM credit_snapshots
      WHERE user_did = ? AND snapshot_date >= ?
      ORDER BY snapshot_date ASC
    `).all(userDid, startDate);

    return rows.map(row => ({
      creditScore: row.credit_score,
      creditLevel: row.credit_level,
      date: row.snapshot_date,
      metadata: JSON.parse(row.metadata || '{}')
    }));
  }

  /**
   * 批量计算信用评分（定时任务）
   */
  async recalculateAllScores() {
    const users = this.db.prepare(`
      SELECT DISTINCT user_did FROM user_credits
    `).all();

    console.log('[CreditScore] 开始批量计算信用评分，共', users.length, '个用户');

    for (const { user_did } of users) {
      try {
        await this.calculateCreditScore(user_did);
        this.createSnapshot(user_did);
      } catch (error) {
        console.error('[CreditScore] 计算用户信用评分失败:', user_did, error);
      }
    }

    console.log('[CreditScore] 批量计算完成');
  }
}

module.exports = CreditScoreManager;
