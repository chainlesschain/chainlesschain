const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

/**
 * 评价管理器
 * 负责交易评价、举报和统计
 */
class ReviewManager extends EventEmitter {
  constructor(db, creditScoreManager, p2pManager) {
    super();
    this.db = db;
    this.creditScoreManager = creditScoreManager;
    this.p2pManager = p2pManager;
    this.currentUserDid = null;

    // 评价标签库
    this.reviewTags = {
      positive: [
        '响应迅速', '态度友好', '商品如描述', '包装完好',
        '物流快', '性价比高', '值得推荐', '专业可靠'
      ],
      negative: [
        '响应慢', '态度差', '商品不符', '包装破损',
        '物流慢', '性价比低', '不推荐', '不够专业'
      ]
    };

    this.initDatabase();
  }

  /**
   * 初始化数据库表
   */
  initDatabase() {
    // 评价表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL,
        reviewer_did TEXT NOT NULL,      -- 评价人
        reviewee_did TEXT NOT NULL,      -- 被评价人
        rating INTEGER NOT NULL,         -- 评分 1-5
        content TEXT,                    -- 评价内容
        tags TEXT,                       -- 标签 (JSON array)
        images TEXT,                     -- 图片证明 (JSON array)
        is_anonymous INTEGER DEFAULT 0,  -- 是否匿名
        helpful_count INTEGER DEFAULT 0, -- 有帮助计数
        status TEXT DEFAULT 'active',    -- 'active', 'hidden', 'deleted'
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        UNIQUE(transaction_id, reviewer_did)
      )
    `);

    // 评价回复表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS review_replies (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL,
        replier_did TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // 评价举报表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS review_reports (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL,
        reporter_did TEXT NOT NULL,
        reason TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',   -- 'pending', 'reviewed', 'resolved', 'rejected'
        resolution TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      )
    `);

    // 评价有帮助记录表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS review_helpful_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_id TEXT NOT NULL,
        voter_did TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(review_id, voter_did)
      )
    `);

    console.log('[ReviewManager] 数据库表初始化完成');
  }

  /**
   * 设置当前用户
   */
  setCurrentUser(did) {
    this.currentUserDid = did;
  }

  /**
   * 创建评价
   */
  async createReview(options) {
    const {
      transactionId,
      revieweeDid,
      rating,
      content,
      tags = [],
      images = [],
      isAnonymous = false
    } = options;

    if (!this.currentUserDid) {
      throw new Error('用户未登录');
    }

    // 验证评分范围
    if (rating < 1 || rating > 5) {
      throw new Error('评分必须在 1-5 之间');
    }

    // 检查是否已评价
    const existing = this.db.prepare(`
      SELECT * FROM reviews
      WHERE transaction_id = ? AND reviewer_did = ?
    `).get(transactionId, this.currentUserDid);

    if (existing) {
      throw new Error('您已经评价过此交易');
    }

    // 验证交易是否存在并已完成
    const transaction = this.db.prepare(`
      SELECT * FROM transactions
      WHERE id = ? AND status = 'completed'
      AND (buyer_did = ? OR seller_did = ?)
    `).get(transactionId, this.currentUserDid, this.currentUserDid);

    if (!transaction) {
      throw new Error('交易不存在或尚未完成');
    }

    // 验证被评价人
    if (revieweeDid !== transaction.buyer_did && revieweeDid !== transaction.seller_did) {
      throw new Error('被评价人必须是交易参与方');
    }

    const reviewId = uuidv4();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO reviews (
        id, transaction_id, reviewer_did, reviewee_did,
        rating, content, tags, images, is_anonymous, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      reviewId,
      transactionId,
      this.currentUserDid,
      revieweeDid,
      rating,
      content || null,
      JSON.stringify(tags),
      JSON.stringify(images),
      isAnonymous ? 1 : 0,
      now
    );

    // 更新信用评分
    if (rating >= 3) {
      await this.creditScoreManager.onPositiveReview(revieweeDid, reviewId, rating);
    } else {
      await this.creditScoreManager.onNegativeReview(revieweeDid, reviewId, rating);
    }

    const reviewData = {
      id: reviewId,
      transactionId,
      reviewerDid: isAnonymous ? 'anonymous' : this.currentUserDid,
      revieweeDid,
      rating,
      content,
      tags,
      images,
      isAnonymous,
      createdAt: now
    };

    // 触发事件
    this.emit('review:created', reviewData);

    // 通知被评价人
    this.p2pManager.sendMessage(revieweeDid, {
      type: 'review:notification',
      reviewId,
      rating,
      transactionId
    });

    console.log('[ReviewManager] 评价已创建:', reviewId);
    return reviewData;
  }

  /**
   * 修改评价（限时）
   */
  async updateReview(reviewId, updates) {
    const review = this.db.prepare(`
      SELECT * FROM reviews WHERE id = ?
    `).get(reviewId);

    if (!review) {
      throw new Error('评价不存在');
    }

    if (review.reviewer_did !== this.currentUserDid) {
      throw new Error('无权限修改此评价');
    }

    // 检查是否在修改期限内（7天）
    const editWindow = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - review.created_at > editWindow) {
      throw new Error('评价修改期限已过');
    }

    const { rating, content, tags, images } = updates;
    const now = Date.now();

    const fields = [];
    const params = [];

    if (rating !== undefined) {
      if (rating < 1 || rating > 5) {
        throw new Error('评分必须在 1-5 之间');
      }
      fields.push('rating = ?');
      params.push(rating);
    }

    if (content !== undefined) {
      fields.push('content = ?');
      params.push(content);
    }

    if (tags !== undefined) {
      fields.push('tags = ?');
      params.push(JSON.stringify(tags));
    }

    if (images !== undefined) {
      fields.push('images = ?');
      params.push(JSON.stringify(images));
    }

    fields.push('updated_at = ?');
    params.push(now);

    params.push(reviewId);

    this.db.prepare(`
      UPDATE reviews SET ${fields.join(', ')} WHERE id = ?
    `).run(...params);

    // 如果评分变化，更新信用评分
    if (rating !== undefined && rating !== review.rating) {
      if (rating >= 3) {
        await this.creditScoreManager.onPositiveReview(review.reviewee_did, reviewId, rating);
      } else {
        await this.creditScoreManager.onNegativeReview(review.reviewee_did, reviewId, rating);
      }
    }

    this.emit('review:updated', { reviewId });
    console.log('[ReviewManager] 评价已修改:', reviewId);
  }

  /**
   * 回复评价
   */
  async replyToReview(reviewId, content) {
    if (!this.currentUserDid) {
      throw new Error('用户未登录');
    }

    const review = this.db.prepare(`
      SELECT * FROM reviews WHERE id = ?
    `).get(reviewId);

    if (!review) {
      throw new Error('评价不存在');
    }

    // 只有被评价人可以回复
    if (review.reviewee_did !== this.currentUserDid) {
      throw new Error('只有被评价人可以回复');
    }

    const replyId = uuidv4();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO review_replies (
        id, review_id, replier_did, content, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(replyId, reviewId, this.currentUserDid, content, now);

    // 通知评价人
    if (!review.is_anonymous) {
      this.p2pManager.sendMessage(review.reviewer_did, {
        type: 'review:reply-notification',
        reviewId,
        replyId
      });
    }

    this.emit('review:replied', { reviewId, replyId });
    console.log('[ReviewManager] 评价已回复:', replyId);
    return { replyId };
  }

  /**
   * 标记评价有帮助
   */
  async markHelpful(reviewId) {
    if (!this.currentUserDid) {
      throw new Error('用户未登录');
    }

    const review = this.db.prepare(`
      SELECT * FROM reviews WHERE id = ?
    `).get(reviewId);

    if (!review) {
      throw new Error('评价不存在');
    }

    // 检查是否已标记
    const existing = this.db.prepare(`
      SELECT * FROM review_helpful_votes
      WHERE review_id = ? AND voter_did = ?
    `).get(reviewId, this.currentUserDid);

    if (existing) {
      // 取消标记
      this.db.prepare(`
        DELETE FROM review_helpful_votes
        WHERE review_id = ? AND voter_did = ?
      `).run(reviewId, this.currentUserDid);

      this.db.prepare(`
        UPDATE reviews SET helpful_count = helpful_count - 1 WHERE id = ?
      `).run(reviewId);

      console.log('[ReviewManager] 取消有帮助标记:', reviewId);
      return { helpful: false };
    } else {
      // 添加标记
      const now = Date.now();
      this.db.prepare(`
        INSERT INTO review_helpful_votes (review_id, voter_did, created_at)
        VALUES (?, ?, ?)
      `).run(reviewId, this.currentUserDid, now);

      this.db.prepare(`
        UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = ?
      `).run(reviewId);

      console.log('[ReviewManager] 标记为有帮助:', reviewId);
      return { helpful: true };
    }
  }

  /**
   * 举报评价
   */
  async reportReview(reviewId, reason, description = '') {
    if (!this.currentUserDid) {
      throw new Error('用户未登录');
    }

    const review = this.db.prepare(`
      SELECT * FROM reviews WHERE id = ?
    `).get(reviewId);

    if (!review) {
      throw new Error('评价不存在');
    }

    // 检查是否已举报
    const existing = this.db.prepare(`
      SELECT * FROM review_reports
      WHERE review_id = ? AND reporter_did = ? AND status = 'pending'
    `).get(reviewId, this.currentUserDid);

    if (existing) {
      throw new Error('您已举报过此评价');
    }

    const reportId = uuidv4();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO review_reports (
        id, review_id, reporter_did, reason, description, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(reportId, reviewId, this.currentUserDid, reason, description, now);

    this.emit('review:reported', { reviewId, reportId, reason });
    console.log('[ReviewManager] 评价已被举报:', reviewId);
    return { reportId };
  }

  /**
   * 处理举报（管理员功能）
   */
  async resolveReport(reportId, resolution, action = 'none') {
    const report = this.db.prepare(`
      SELECT * FROM review_reports WHERE id = ?
    `).get(reportId);

    if (!report) {
      throw new Error('举报记录不存在');
    }

    const now = Date.now();

    // 更新举报状态
    this.db.prepare(`
      UPDATE review_reports
      SET status = 'resolved', resolution = ?, resolved_at = ?
      WHERE id = ?
    `).run(resolution, now, reportId);

    // 根据处理结果执行操作
    if (action === 'hide') {
      // 隐藏评价
      this.db.prepare(`
        UPDATE reviews SET status = 'hidden' WHERE id = ?
      `).run(report.review_id);
    } else if (action === 'delete') {
      // 删除评价
      this.db.prepare(`
        UPDATE reviews SET status = 'deleted' WHERE id = ?
      `).run(report.review_id);
    }

    this.emit('review:report-resolved', { reportId, action });
    console.log('[ReviewManager] 举报已处理:', reportId);
  }

  /**
   * 获取评价列表
   */
  getReviews(filters = {}) {
    const { revieweeDid, rating, sortBy = 'created_at', limit = 50 } = filters;

    let query = `
      SELECT * FROM reviews
      WHERE status = 'active'
    `;
    const params = [];

    if (revieweeDid) {
      query += ` AND reviewee_did = ?`;
      params.push(revieweeDid);
    }

    if (rating) {
      query += ` AND rating = ?`;
      params.push(rating);
    }

    query += ` ORDER BY ${sortBy} DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(query).all(...params);

    return rows.map(row => this.formatReview(row));
  }

  /**
   * 获取评价详情
   */
  getReview(reviewId) {
    const review = this.db.prepare(`
      SELECT * FROM reviews WHERE id = ?
    `).get(reviewId);

    if (!review) {
      return null;
    }

    const formatted = this.formatReview(review);

    // 获取回复
    const replies = this.db.prepare(`
      SELECT * FROM review_replies WHERE review_id = ? ORDER BY created_at ASC
    `).all(reviewId);

    formatted.replies = replies.map(r => ({
      id: r.id,
      replierDid: r.replier_did,
      content: r.content,
      createdAt: r.created_at
    }));

    return formatted;
  }

  /**
   * 格式化评价数据
   */
  formatReview(row) {
    return {
      id: row.id,
      transactionId: row.transaction_id,
      reviewerDid: row.is_anonymous ? 'anonymous' : row.reviewer_did,
      revieweeDid: row.reviewee_did,
      rating: row.rating,
      content: row.content,
      tags: JSON.parse(row.tags || '[]'),
      images: JSON.parse(row.images || '[]'),
      isAnonymous: row.is_anonymous === 1,
      helpfulCount: row.helpful_count,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * 获取评价统计
   */
  getReviewStatistics(userDid) {
    // 基本统计
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total_reviews,
        AVG(rating) as avg_rating,
        SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five_star,
        SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as four_star,
        SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as three_star,
        SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as two_star,
        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as one_star
      FROM reviews
      WHERE reviewee_did = ? AND status = 'active'
    `).get(userDid);

    // 常用标签统计
    const tagRows = this.db.prepare(`
      SELECT tags FROM reviews
      WHERE reviewee_did = ? AND status = 'active'
    `).all(userDid);

    const tagCounts = {};
    for (const row of tagRows) {
      const tags = JSON.parse(row.tags || '[]');
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    return {
      totalReviews: stats.total_reviews || 0,
      avgRating: stats.avg_rating ? parseFloat(stats.avg_rating.toFixed(2)) : 0,
      ratingDistribution: {
        5: stats.five_star || 0,
        4: stats.four_star || 0,
        3: stats.three_star || 0,
        2: stats.two_star || 0,
        1: stats.one_star || 0
      },
      topTags
    };
  }

  /**
   * 获取我创建的评价
   */
  getMyReviews() {
    const rows = this.db.prepare(`
      SELECT r.*, t.id as transaction_id
      FROM reviews r
      LEFT JOIN transactions t ON r.transaction_id = t.id
      WHERE r.reviewer_did = ?
      ORDER BY r.created_at DESC
    `).all(this.currentUserDid);

    return rows.map(row => this.formatReview(row));
  }

  /**
   * 获取待评价的交易
   */
  getPendingReviews() {
    const rows = this.db.prepare(`
      SELECT t.* FROM transactions t
      WHERE (t.buyer_did = ? OR t.seller_did = ?)
      AND t.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM reviews r
        WHERE r.transaction_id = t.id AND r.reviewer_did = ?
      )
      ORDER BY t.completed_at DESC
      LIMIT 50
    `).all(this.currentUserDid, this.currentUserDid, this.currentUserDid);

    return rows.map(row => ({
      id: row.id,
      orderId: row.order_id,
      buyerDid: row.buyer_did,
      sellerDid: row.seller_did,
      paymentAmount: row.payment_amount,
      completedAt: row.completed_at,
      // 确定待评价的对象
      revieweeDid: row.buyer_did === this.currentUserDid ? row.seller_did : row.buyer_did
    }));
  }

  /**
   * 获取推荐评价（高质量评价）
   */
  getFeaturedReviews(userDid, limit = 10) {
    const rows = this.db.prepare(`
      SELECT * FROM reviews
      WHERE reviewee_did = ? AND status = 'active'
      AND content IS NOT NULL AND content != ''
      ORDER BY helpful_count DESC, rating DESC, created_at DESC
      LIMIT ?
    `).all(userDid, limit);

    return rows.map(row => this.formatReview(row));
  }

  /**
   * 获取评价标签库
   */
  getAvailableTags(type = 'positive') {
    return this.reviewTags[type] || [];
  }

  /**
   * 批量删除垃圾评价（管理员功能）
   */
  async bulkDeleteSpamReviews(reviewIds) {
    const stmt = this.db.prepare(`
      UPDATE reviews SET status = 'deleted' WHERE id = ?
    `);

    const transaction = this.db.transaction((ids) => {
      for (const id of ids) {
        stmt.run(id);
      }
    });

    transaction(reviewIds);
    console.log('[ReviewManager] 批量删除评价:', reviewIds.length);
  }
}

module.exports = ReviewManager;
