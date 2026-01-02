/**
 * Credit Score Manager - 信用评分管理器
 *
 * 功能:
 * - 5个信用等级（新手、青铜、白银、黄金、钻石）
 * - 6维度评分系统（完成率、交易额、好评率、响应速度、纠纷率、退款率）
 * - 自动计算信用评分（0-1000分）
 * - 事件监听（交易完成、取消、评价、纠纷、退款）
 * - 信用记录追踪
 * - 信用快照（历史趋势）
 * - 排行榜系统
 * - 信用报告生成
 * - 信用等级验证
 *
 * 移动端增强:
 * - 三层缓存（信用、记录、快照）
 * - 异步优化
 * - 批量计算支持
 * - 趋势分析
 *
 * @version 2.6.0
 * @author Claude Sonnet 4.5
 * @date 2024-01-02
 */

// 信用等级定义
const CreditLevels = [
  {
    name: '新手',
    min: 0,
    max: 100,
    color: 'gray',
    benefits: []
  },
  {
    name: '青铜',
    min: 101,
    max: 300,
    color: 'bronze',
    benefits: ['降低 5% 手续费']
  },
  {
    name: '白银',
    min: 301,
    max: 600,
    color: 'silver',
    benefits: ['降低 10% 手续费', '优先展示']
  },
  {
    name: '黄金',
    min: 601,
    max: 900,
    color: 'gold',
    benefits: ['降低 15% 手续费', '优先展示', '更高托管比例']
  },
  {
    name: '钻石',
    min: 901,
    max: 1000,
    color: 'diamond',
    benefits: ['降低 20% 手续费', '优先展示', '免保证金', 'VIP 支持']
  }
]

// 评分权重配置
const ScoreWeights = {
  completionRate: 0.30,   // 交易完成率权重 30%
  tradeVolume: 0.20,      // 交易金额权重 20%
  positiveRate: 0.25,     // 好评率权重 25%
  responseSpeed: 0.10,    // 响应速度权重 10%
  disputeRate: 0.10,      // 纠纷率权重 10%
  refundRate: 0.05        // 退款率权重 5%
}

// 事件类型
const EventType = {
  TRADE_COMPLETED: 'trade_completed',
  TRADE_CANCELLED: 'trade_cancelled',
  POSITIVE_REVIEW: 'positive_review',
  NEGATIVE_REVIEW: 'negative_review',
  DISPUTE_INITIATED: 'dispute',
  DISPUTE_RESOLVED: 'dispute_resolved',
  REFUND: 'refund',
  RESPONSE_TIME_UPDATED: 'response_time_updated'
}

class CreditScoreManager {
  constructor(db, didManager) {
    this.db = db
    this.didManager = didManager

    // 三层缓存
    this.creditCache = new Map()
    this.recordsCache = new Map()
    this.snapshotsCache = new Map()
    this.cacheTTL = 5 * 60 * 1000 // 5分钟

    // 配置
    this.creditLevels = CreditLevels
    this.scoreWeights = ScoreWeights
  }

  /**
   * 初始化
   */
  async initialize() {
    await this._createTables()
    console.log('[CreditScore] 初始化完成')
  }

  /**
   * 创建数据库表
   */
  async _createTables() {
    // 用户信用表
    await this.db.executeSql(`
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
    `)

    // 信用记录表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS credit_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_did TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_id TEXT NOT NULL,
        score_change INTEGER NOT NULL,
        score_after INTEGER NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL
      )
    `)

    // 信用快照表（历史趋势）
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS credit_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_did TEXT NOT NULL,
        credit_score INTEGER NOT NULL,
        credit_level TEXT NOT NULL,
        snapshot_date INTEGER NOT NULL,
        metadata TEXT
      )
    `)

    // 索引
    await this.db.executeSql('CREATE INDEX IF NOT EXISTS idx_credit_records_user ON credit_records(user_did)')
    await this.db.executeSql('CREATE INDEX IF NOT EXISTS idx_credit_snapshots_user ON credit_snapshots(user_did)')
  }

  /**
   * 初始化用户信用记录
   */
  async initUserCredit(userDid) {
    // 检查是否已存在
    const existing = await this.db.executeSql(
      'SELECT * FROM user_credits WHERE user_did = ?',
      [userDid]
    )

    if (existing.length > 0) {
      return existing[0]
    }

    const now = Date.now()

    await this.db.executeSql(`
      INSERT INTO user_credits (user_did, last_updated)
      VALUES (?, ?)
    `, [userDid, now])

    console.log('[CreditScore] 用户信用记录已初始化:', userDid)
    return await this.getUserCredit(userDid)
  }

  /**
   * 获取用户信用信息
   */
  async getUserCredit(userDid) {
    // 检查缓存
    const cached = this.creditCache.get(userDid)
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.data
    }

    let credits = await this.db.executeSql(
      'SELECT * FROM user_credits WHERE user_did = ?',
      [userDid]
    )

    if (credits.length === 0) {
      credits = [await this.initUserCredit(userDid)]
    }

    const credit = credits[0]

    const result = {
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
    }

    // 缓存
    this.creditCache.set(userDid, {
      data: result,
      timestamp: Date.now()
    })

    return result
  }

  /**
   * 计算信用评分
   */
  async calculateCreditScore(userDid) {
    const credit = await this.getUserCredit(userDid)

    let score = 0

    // 1. 交易完成率 (30%)
    const completionRate = credit.totalTransactions > 0
      ? credit.completedTransactions / credit.totalTransactions
      : 0
    score += completionRate * 300 * this.scoreWeights.completionRate / 0.30

    // 2. 交易金额 (20%) - 对数增长，最高 200 分
    const volumeScore = Math.min(
      200,
      Math.log10(credit.totalVolume + 1) * 50
    )
    score += volumeScore * this.scoreWeights.tradeVolume / 0.20

    // 3. 好评率 (25%)
    const totalReviews = credit.positiveReviews + credit.negativeReviews
    const positiveRate = totalReviews > 0
      ? credit.positiveReviews / totalReviews
      : 0.5 // 默认中等
    score += positiveRate * 250 * this.scoreWeights.positiveRate / 0.25

    // 4. 响应速度 (10%) - 响应时间越短越好
    const responseScore = credit.avgResponseTime > 0
      ? Math.max(0, 100 - (credit.avgResponseTime / 3600000)) // 1小时内满分
      : 50 // 默认中等
    score += responseScore * this.scoreWeights.responseSpeed / 0.10

    // 5. 纠纷率 (10%) - 扣分项
    const disputeRate = credit.totalTransactions > 0
      ? credit.disputes / credit.totalTransactions
      : 0
    score += (1 - disputeRate) * 100 * this.scoreWeights.disputeRate / 0.10

    // 6. 退款率 (5%) - 扣分项
    const refundRate = credit.totalTransactions > 0
      ? credit.refunds / credit.totalTransactions
      : 0
    score += (1 - refundRate) * 50 * this.scoreWeights.refundRate / 0.05

    // 限制在 0-1000 范围内
    score = Math.max(0, Math.min(1000, Math.round(score)))

    // 确定信用等级
    const level = this.getCreditLevel(score)

    // 更新数据库
    const now = Date.now()
    await this.db.executeSql(`
      UPDATE user_credits
      SET credit_score = ?, credit_level = ?, last_updated = ?
      WHERE user_did = ?
    `, [score, level.name, now, userDid])

    // 清除缓存
    this.creditCache.delete(userDid)

    console.log('[CreditScore] 信用评分已更新:', userDid, score, level.name)

    return {
      creditScore: score,
      creditLevel: level.name,
      levelColor: level.color,
      benefits: level.benefits
    }
  }

  /**
   * 根据分数获取信用等级
   */
  getCreditLevel(score) {
    for (const level of this.creditLevels) {
      if (score >= level.min && score <= level.max) {
        return level
      }
    }
    return this.creditLevels[0] // 默认新手
  }

  /**
   * 交易完成事件处理
   */
  async onTransactionCompleted(userDid, transactionId, amount) {
    // 确保信用记录存在
    await this.initUserCredit(userDid)

    // 更新统计
    await this.db.executeSql(`
      UPDATE user_credits
      SET total_transactions = total_transactions + 1,
          completed_transactions = completed_transactions + 1,
          total_volume = total_volume + ?
      WHERE user_did = ?
    `, [amount, userDid])

    // 记录信用变化
    const scoreChange = 10 // 完成交易加 10 分
    await this.addCreditRecord(
      userDid,
      EventType.TRADE_COMPLETED,
      transactionId,
      scoreChange,
      '完成交易'
    )

    // 重新计算评分
    await this.calculateCreditScore(userDid)
  }

  /**
   * 交易取消事件处理
   */
  async onTransactionCancelled(userDid, transactionId) {
    await this.initUserCredit(userDid)

    // 更新统计
    await this.db.executeSql(`
      UPDATE user_credits
      SET total_transactions = total_transactions + 1
      WHERE user_did = ?
    `, [userDid])

    // 记录信用变化
    const scoreChange = -5 // 取消交易扣 5 分
    await this.addCreditRecord(
      userDid,
      EventType.TRADE_CANCELLED,
      transactionId,
      scoreChange,
      '取消交易'
    )

    // 重新计算评分
    await this.calculateCreditScore(userDid)
  }

  /**
   * 收到好评事件处理
   */
  async onPositiveReview(userDid, reviewId, rating) {
    await this.initUserCredit(userDid)

    // 更新统计
    await this.db.executeSql(`
      UPDATE user_credits
      SET positive_reviews = positive_reviews + 1
      WHERE user_did = ?
    `, [userDid])

    // 记录信用变化 - 5星加15分，4星加10分，3星加5分
    let scoreChange = 5
    if (rating >= 5) scoreChange = 15
    else if (rating >= 4) scoreChange = 10

    await this.addCreditRecord(
      userDid,
      EventType.POSITIVE_REVIEW,
      reviewId,
      scoreChange,
      `收到 ${rating} 星好评`
    )

    // 重新计算评分
    await this.calculateCreditScore(userDid)
  }

  /**
   * 收到差评事件处理
   */
  async onNegativeReview(userDid, reviewId, rating) {
    await this.initUserCredit(userDid)

    // 更新统计
    await this.db.executeSql(`
      UPDATE user_credits
      SET negative_reviews = negative_reviews + 1
      WHERE user_did = ?
    `, [userDid])

    // 记录信用变化 - 1星扣30分，2星扣20分
    let scoreChange = -10
    if (rating <= 1) scoreChange = -30
    else if (rating <= 2) scoreChange = -20

    await this.addCreditRecord(
      userDid,
      EventType.NEGATIVE_REVIEW,
      reviewId,
      scoreChange,
      `收到 ${rating} 星差评`
    )

    // 重新计算评分
    await this.calculateCreditScore(userDid)
  }

  /**
   * 发生纠纷事件处理
   */
  async onDisputeInitiated(userDid, disputeId) {
    await this.initUserCredit(userDid)

    // 更新统计
    await this.db.executeSql(`
      UPDATE user_credits
      SET disputes = disputes + 1
      WHERE user_did = ?
    `, [userDid])

    // 记录信用变化
    const scoreChange = -20 // 发生纠纷扣 20 分
    await this.addCreditRecord(
      userDid,
      EventType.DISPUTE_INITIATED,
      disputeId,
      scoreChange,
      '发生纠纷'
    )

    // 重新计算评分
    await this.calculateCreditScore(userDid)
  }

  /**
   * 纠纷解决事件处理
   */
  async onDisputeResolved(userDid, disputeId, resolution) {
    // 根据解决结果调整分数
    let scoreChange = 0
    let reason = ''

    if (resolution === 'favor_user') {
      // 用户胜诉，恢复部分分数
      scoreChange = 10
      reason = '纠纷解决（胜诉）'
    } else if (resolution === 'favor_opponent') {
      // 用户败诉，额外扣分
      scoreChange = -10
      reason = '纠纷解决（败诉）'
    } else {
      // 和解
      scoreChange = 5
      reason = '纠纷解决（和解）'
    }

    await this.addCreditRecord(
      userDid,
      EventType.DISPUTE_RESOLVED,
      disputeId,
      scoreChange,
      reason
    )

    // 重新计算评分
    await this.calculateCreditScore(userDid)
  }

  /**
   * 退款事件处理
   */
  async onRefund(userDid, refundId) {
    await this.initUserCredit(userDid)

    // 更新统计
    await this.db.executeSql(`
      UPDATE user_credits
      SET refunds = refunds + 1
      WHERE user_did = ?
    `, [userDid])

    // 记录信用变化
    const scoreChange = -8 // 退款扣 8 分
    await this.addCreditRecord(
      userDid,
      EventType.REFUND,
      refundId,
      scoreChange,
      '发生退款'
    )

    // 重新计算评分
    await this.calculateCreditScore(userDid)
  }

  /**
   * 更新响应时间
   */
  async updateResponseTime(userDid, responseTime) {
    const credit = await this.getUserCredit(userDid)

    // 计算平均响应时间
    const count = credit.totalTransactions || 1
    const avgTime = Math.round(
      (credit.avgResponseTime * (count - 1) + responseTime) / count
    )

    await this.db.executeSql(`
      UPDATE user_credits
      SET avg_response_time = ?
      WHERE user_did = ?
    `, [avgTime, userDid])

    // 清除缓存
    this.creditCache.delete(userDid)

    // 重新计算评分
    await this.calculateCreditScore(userDid)
  }

  /**
   * 添加信用记录
   */
  async addCreditRecord(userDid, eventType, eventId, scoreChange, reason) {
    const credit = await this.getUserCredit(userDid)
    const scoreAfter = credit.creditScore + scoreChange
    const now = Date.now()

    await this.db.executeSql(`
      INSERT INTO credit_records (
        user_did, event_type, event_id, score_change, score_after, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [userDid, eventType, eventId, scoreChange, scoreAfter, reason, now])

    // 清除缓存
    this.recordsCache.delete(userDid)

    console.log('[CreditScore] 信用记录已添加:', userDid, eventType, scoreChange)
  }

  /**
   * 获取信用记录
   */
  async getCreditRecords(userDid, limit = 50) {
    // 检查缓存
    const cacheKey = `${userDid}:${limit}`
    const cached = this.recordsCache.get(cacheKey)
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.data
    }

    const rows = await this.db.executeSql(`
      SELECT * FROM credit_records
      WHERE user_did = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [userDid, limit])

    const result = rows.map(row => ({
      id: row.id,
      eventType: row.event_type,
      eventId: row.event_id,
      scoreChange: row.score_change,
      scoreAfter: row.score_after,
      reason: row.reason,
      createdAt: row.created_at
    }))

    // 缓存
    this.recordsCache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    })

    return result
  }

  /**
   * 获取信用报告
   */
  async getCreditReport(userDid) {
    const credit = await this.getUserCredit(userDid)
    const level = this.getCreditLevel(credit.creditScore)

    // 计算各项指标
    const completionRate = credit.totalTransactions > 0
      ? (credit.completedTransactions / credit.totalTransactions * 100).toFixed(1)
      : 0

    const totalReviews = credit.positiveReviews + credit.negativeReviews
    const positiveRate = totalReviews > 0
      ? (credit.positiveReviews / totalReviews * 100).toFixed(1)
      : 0

    const disputeRate = credit.totalTransactions > 0
      ? (credit.disputes / credit.totalTransactions * 100).toFixed(1)
      : 0

    const refundRate = credit.totalTransactions > 0
      ? (credit.refunds / credit.totalTransactions * 100).toFixed(1)
      : 0

    // 获取最近记录
    const recentRecords = await this.getCreditRecords(userDid, 10)

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
    }
  }

  /**
   * 验证信用等级
   */
  async verifyCreditLevel(userDid, requiredLevel) {
    const credit = await this.getUserCredit(userDid)
    const currentLevel = this.getCreditLevel(credit.creditScore)
    const required = this.creditLevels.find(l => l.name === requiredLevel)

    if (!required) {
      return false
    }

    return currentLevel.min >= required.min
  }

  /**
   * 获取信用排行榜
   */
  async getLeaderboard(limit = 50) {
    const rows = await this.db.executeSql(`
      SELECT * FROM user_credits
      ORDER BY credit_score DESC, total_transactions DESC
      LIMIT ?
    `, [limit])

    return rows.map((row, index) => ({
      rank: index + 1,
      userDid: row.user_did,
      creditScore: row.credit_score,
      creditLevel: row.credit_level,
      totalTransactions: row.total_transactions,
      totalVolume: row.total_volume
    }))
  }

  /**
   * 创建信用快照
   */
  async createSnapshot(userDid) {
    const credit = await this.getUserCredit(userDid)
    const now = Date.now()

    await this.db.executeSql(`
      INSERT INTO credit_snapshots (
        user_did, credit_score, credit_level, snapshot_date, metadata
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      userDid,
      credit.creditScore,
      credit.creditLevel,
      now,
      JSON.stringify({
        totalTransactions: credit.totalTransactions,
        totalVolume: credit.totalVolume
      })
    ])

    // 清除缓存
    this.snapshotsCache.delete(userDid)

    console.log('[CreditScore] 信用快照已创建:', userDid)
  }

  /**
   * 获取信用历史趋势
   */
  async getCreditTrend(userDid, days = 30) {
    // 检查缓存
    const cacheKey = `${userDid}:${days}`
    const cached = this.snapshotsCache.get(cacheKey)
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.data
    }

    const startDate = Date.now() - (days * 24 * 60 * 60 * 1000)

    const rows = await this.db.executeSql(`
      SELECT * FROM credit_snapshots
      WHERE user_did = ? AND snapshot_date >= ?
      ORDER BY snapshot_date ASC
    `, [userDid, startDate])

    const result = rows.map(row => ({
      creditScore: row.credit_score,
      creditLevel: row.credit_level,
      date: row.snapshot_date,
      metadata: JSON.parse(row.metadata || '{}')
    }))

    // 缓存
    this.snapshotsCache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    })

    return result
  }

  /**
   * 批量计算信用评分（定时任务）
   */
  async recalculateAllScores() {
    const users = await this.db.executeSql(
      'SELECT DISTINCT user_did FROM user_credits'
    )

    console.log('[CreditScore] 开始批量计算信用评分，共', users.length, '个用户')

    for (const { user_did } of users) {
      try {
        await this.calculateCreditScore(user_did)
        await this.createSnapshot(user_did)
      } catch (error) {
        console.error('[CreditScore] 计算用户信用评分失败:', user_did, error)
      }
    }

    console.log('[CreditScore] 批量计算完成')
  }

  /**
   * 获取统计信息
   */
  async getStatistics() {
    // 总用户数
    const totalUsers = await this.db.executeSql(
      'SELECT COUNT(*) as count FROM user_credits'
    )

    // 按等级统计
    const byLevel = {}
    for (const level of this.creditLevels) {
      const result = await this.db.executeSql(
        'SELECT COUNT(*) as count FROM user_credits WHERE credit_level = ?',
        [level.name]
      )
      byLevel[level.name] = result[0].count
    }

    // 平均信用分
    const avgScore = await this.db.executeSql(
      'SELECT AVG(credit_score) as avg FROM user_credits'
    )

    // 总交易数
    const totalTransactions = await this.db.executeSql(
      'SELECT SUM(total_transactions) as sum FROM user_credits'
    )

    return {
      totalUsers: totalUsers[0].count,
      byLevel,
      avgScore: Math.round(avgScore[0].avg || 0),
      totalTransactions: totalTransactions[0].sum || 0
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.creditCache.clear()
    this.recordsCache.clear()
    this.snapshotsCache.clear()
    console.log('[CreditScore] 缓存已清除')
  }

  /**
   * 销毁
   */
  destroy() {
    this.clearCache()
    console.log('[CreditScore] 已销毁')
  }
}

// 单例模式
let creditScoreManagerInstance = null

/**
 * 创建 CreditScoreManager 实例
 */
export function createCreditScoreManager(db, didManager) {
  if (!creditScoreManagerInstance) {
    creditScoreManagerInstance = new CreditScoreManager(db, didManager)
  }
  return creditScoreManagerInstance
}

/**
 * 获取 CreditScoreManager 实例
 */
export function getCreditScoreManager() {
  if (!creditScoreManagerInstance) {
    throw new Error('CreditScoreManager 未初始化')
  }
  return creditScoreManagerInstance
}

export {
  CreditLevels,
  ScoreWeights,
  EventType
}
