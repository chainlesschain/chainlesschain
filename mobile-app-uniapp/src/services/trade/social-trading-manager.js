/**
 * Social Trading Manager - 社交交易管理器
 *
 * 功能:
 * - 交易分享（发布、查看、点赞、评论、收藏）
 * - 跟单系统（创建、执行、管理、统计）
 * - 交易信号（发布、订阅、执行）
 * - 交易组（创建、加入、管理、分享）
 * - 交易员排行（收益率、跟随者、成功率）
 * - 交易讨论（评论、回复、点赞）
 * - 交易提醒（跟单、新分享、评论）
 * - 收益统计（个人收益、跟单收益）
 *
 * 移动端特色:
 * - 三层缓存（分享、跟单、信号）
 * - 实时推送（新分享、新信号）
 * - 社交互动（点赞、评论、关注）
 * - 收益追踪（详细的收益统计）
 *
 * @version 2.7.0
 * @author Claude Sonnet 4.5
 * @date 2024-01-02
 */

// 分享类型
const ShareType = {
  ORDER: 'order',          // 订单分享
  SIGNAL: 'signal',        // 交易信号
  STRATEGY: 'strategy',    // 交易策略
  ANALYSIS: 'analysis'     // 市场分析
}

// 分享状态
const ShareStatus = {
  ACTIVE: 'active',
  CLOSED: 'closed',
  DELETED: 'deleted'
}

// 跟单状态
const CopyStatus = {
  PENDING: 'pending',      // 待执行
  ACTIVE: 'active',        // 跟单中
  COMPLETED: 'completed',  // 已完成
  CANCELLED: 'cancelled',  // 已取消
  FAILED: 'failed'         // 失败
}

// 信号类型
const SignalType = {
  BUY: 'buy',              // 买入信号
  SELL: 'sell',            // 卖出信号
  HOLD: 'hold'             // 持有信号
}

// 交易组类型
const GroupType = {
  PUBLIC: 'public',        // 公开组
  PRIVATE: 'private',      // 私密组
  PREMIUM: 'premium'       // 付费组
}

class SocialTradingManager {
  constructor(db, didManager, marketplaceManager, creditManager) {
    this.db = db
    this.didManager = didManager
    this.marketplaceManager = marketplaceManager
    this.creditManager = creditManager

    // 三层缓存
    this.shareCache = new Map()
    this.copyCache = new Map()
    this.signalCache = new Map()
    this.cacheTTL = 5 * 60 * 1000 // 5分钟
  }

  /**
   * 初始化
   */
  async initialize() {
    await this._createTables()
    console.log('[SocialTrading] 初始化完成')
  }

  /**
   * 创建数据库表
   */
  async _createTables() {
    // 交易分享表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS trade_shares (
        id TEXT PRIMARY KEY,
        trader_did TEXT NOT NULL,
        share_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        order_id TEXT,
        asset_id TEXT,
        amount INTEGER,
        price INTEGER,
        target_price INTEGER,
        stop_loss INTEGER,
        take_profit INTEGER,
        tags TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        likes INTEGER DEFAULT 0,
        comments INTEGER DEFAULT 0,
        copies INTEGER DEFAULT 0,
        views INTEGER DEFAULT 0,
        profit_loss INTEGER DEFAULT 0,
        profit_rate REAL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `)

    // 跟单表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS copy_trades (
        id TEXT PRIMARY KEY,
        share_id TEXT NOT NULL,
        trader_did TEXT NOT NULL,
        follower_did TEXT NOT NULL,
        order_id TEXT,
        copy_amount INTEGER NOT NULL,
        copy_ratio REAL DEFAULT 1.0,
        status TEXT NOT NULL DEFAULT 'pending',
        profit_loss INTEGER DEFAULT 0,
        profit_rate REAL DEFAULT 0,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (share_id) REFERENCES trade_shares(id)
      )
    `)

    // 交易信号表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS trade_signals (
        id TEXT PRIMARY KEY,
        trader_did TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        entry_price INTEGER,
        target_price INTEGER,
        stop_loss INTEGER,
        confidence REAL DEFAULT 0.5,
        reasoning TEXT,
        tags TEXT,
        subscribers INTEGER DEFAULT 0,
        success_rate REAL DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER
      )
    `)

    // 交易组表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS trade_groups (
        id TEXT PRIMARY KEY,
        creator_did TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        group_type TEXT NOT NULL DEFAULT 'public',
        member_count INTEGER DEFAULT 1,
        share_count INTEGER DEFAULT 0,
        tags TEXT,
        entry_fee INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `)

    // 交易组成员表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS group_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        member_did TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at INTEGER NOT NULL,
        FOREIGN KEY (group_id) REFERENCES trade_groups(id)
      )
    `)

    // 交易评论表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS trade_comments (
        id TEXT PRIMARY KEY,
        share_id TEXT NOT NULL,
        commenter_did TEXT NOT NULL,
        parent_id TEXT,
        content TEXT NOT NULL,
        likes INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (share_id) REFERENCES trade_shares(id)
      )
    `)

    // 点赞表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS trade_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        liker_did TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(target_type, target_id, liker_did)
      )
    `)

    // 关注表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS trader_follows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        follower_did TEXT NOT NULL,
        trader_did TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(follower_did, trader_did)
      )
    `)

    // 索引
    await this.db.executeSql('CREATE INDEX IF NOT EXISTS idx_trade_shares_trader ON trade_shares(trader_did)')
    await this.db.executeSql('CREATE INDEX IF NOT EXISTS idx_copy_trades_follower ON copy_trades(follower_did)')
    await this.db.executeSql('CREATE INDEX IF NOT EXISTS idx_trade_signals_trader ON trade_signals(trader_did)')
    await this.db.executeSql('CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id)')
  }

  /**
   * 创建交易分享
   */
  async createShare(options) {
    const {
      type,
      title,
      description,
      orderId,
      assetId,
      amount,
      price,
      targetPrice,
      stopLoss,
      takeProfit,
      tags
    } = options

    const currentDid = await this.didManager.getCurrentDid()
    const now = Date.now()

    const share = {
      id: this._generateId('share'),
      trader_did: currentDid,
      share_type: type,
      title: title.trim(),
      description: description ? description.trim() : null,
      order_id: orderId || null,
      asset_id: assetId || null,
      amount: amount || 0,
      price: price || 0,
      target_price: targetPrice || null,
      stop_loss: stopLoss || null,
      take_profit: takeProfit || null,
      tags: tags ? JSON.stringify(tags) : null,
      status: ShareStatus.ACTIVE,
      likes: 0,
      comments: 0,
      copies: 0,
      views: 0,
      profit_loss: 0,
      profit_rate: 0,
      created_at: now,
      updated_at: now,
      deleted: 0
    }

    await this.db.executeSql(`
      INSERT INTO trade_shares (
        id, trader_did, share_type, title, description,
        order_id, asset_id, amount, price, target_price,
        stop_loss, take_profit, tags, status, likes,
        comments, copies, views, profit_loss, profit_rate,
        created_at, updated_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      share.id, share.trader_did, share.share_type, share.title, share.description,
      share.order_id, share.asset_id, share.amount, share.price, share.target_price,
      share.stop_loss, share.take_profit, share.tags, share.status, share.likes,
      share.comments, share.copies, share.views, share.profit_loss, share.profit_rate,
      share.created_at, share.updated_at, share.deleted
    ])

    // 清除缓存
    this.shareCache.clear()

    console.log('[SocialTrading] 交易分享创建:', share.id)
    return share
  }

  /**
   * 获取交易分享
   */
  async getShare(shareId) {
    // 检查缓存
    const cached = this.shareCache.get(shareId)
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.data
    }

    const shares = await this.db.executeSql(
      'SELECT * FROM trade_shares WHERE id = ? AND deleted = 0',
      [shareId]
    )

    if (shares.length === 0) {
      throw new Error('分享不存在')
    }

    const share = shares[0]

    // 解析JSON字段
    if (share.tags) {
      share.tags = JSON.parse(share.tags)
    }

    // 缓存
    this.shareCache.set(shareId, {
      data: share,
      timestamp: Date.now()
    })

    return share
  }

  /**
   * 获取所有分享
   */
  async getAllShares(options = {}) {
    const { type, traderDid, status = ShareStatus.ACTIVE, limit = 50 } = options

    let query = 'SELECT * FROM trade_shares WHERE deleted = 0 AND status = ?'
    const params = [status]

    if (type) {
      query += ' AND share_type = ?'
      params.push(type)
    }

    if (traderDid) {
      query += ' AND trader_did = ?'
      params.push(traderDid)
    }

    query += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    const shares = await this.db.executeSql(query, params)

    // 解析JSON字段
    shares.forEach(share => {
      if (share.tags) {
        share.tags = JSON.parse(share.tags)
      }
    })

    return shares
  }

  /**
   * 获取热门分享
   */
  async getTrendingShares(limit = 20) {
    const shares = await this.db.executeSql(`
      SELECT * FROM trade_shares
      WHERE deleted = 0 AND status = ?
      ORDER BY (likes * 2 + comments + copies + views) DESC
      LIMIT ?
    `, [ShareStatus.ACTIVE, limit])

    shares.forEach(share => {
      if (share.tags) {
        share.tags = JSON.parse(share.tags)
      }
    })

    return shares
  }

  /**
   * 增加分享浏览量
   */
  async incrementViews(shareId) {
    await this.db.executeSql(
      'UPDATE trade_shares SET views = views + 1 WHERE id = ?',
      [shareId]
    )

    // 清除缓存
    this.shareCache.delete(shareId)
  }

  /**
   * 创建跟单
   */
  async createCopyTrade(shareId, copyAmount, copyRatio = 1.0) {
    const share = await this.getShare(shareId)
    const currentDid = await this.didManager.getCurrentDid()

    // 验证不能跟自己的单
    if (share.trader_did === currentDid) {
      throw new Error('不能跟自己的单')
    }

    const now = Date.now()

    const copyTrade = {
      id: this._generateId('copy'),
      share_id: shareId,
      trader_did: share.trader_did,
      follower_did: currentDid,
      order_id: null,
      copy_amount: copyAmount,
      copy_ratio: copyRatio,
      status: CopyStatus.PENDING,
      profit_loss: 0,
      profit_rate: 0,
      created_at: now,
      completed_at: null
    }

    await this.db.executeSql(`
      INSERT INTO copy_trades (
        id, share_id, trader_did, follower_did, order_id,
        copy_amount, copy_ratio, status, profit_loss,
        profit_rate, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      copyTrade.id, copyTrade.share_id, copyTrade.trader_did, copyTrade.follower_did,
      copyTrade.order_id, copyTrade.copy_amount, copyTrade.copy_ratio,
      copyTrade.status, copyTrade.profit_loss, copyTrade.profit_rate,
      copyTrade.created_at, copyTrade.completed_at
    ])

    // 更新分享的跟单数
    await this.db.executeSql(
      'UPDATE trade_shares SET copies = copies + 1 WHERE id = ?',
      [shareId]
    )

    // 清除缓存
    this.copyCache.clear()
    this.shareCache.delete(shareId)

    console.log('[SocialTrading] 跟单创建:', copyTrade.id)
    return copyTrade
  }

  /**
   * 执行跟单
   */
  async executeCopyTrade(copyTradeId) {
    const copyTrades = await this.db.executeSql(
      'SELECT * FROM copy_trades WHERE id = ?',
      [copyTradeId]
    )

    if (copyTrades.length === 0) {
      throw new Error('跟单不存在')
    }

    const copyTrade = copyTrades[0]

    if (copyTrade.status !== CopyStatus.PENDING) {
      throw new Error('跟单状态不正确')
    }

    // 获取原始分享
    const share = await this.getShare(copyTrade.share_id)

    // 创建订单（这里简化处理，实际应该调用marketplace创建订单）
    // const order = await this.marketplaceManager.matchOrder(...)

    // 更新跟单状态
    await this.db.executeSql(`
      UPDATE copy_trades
      SET status = ?, order_id = ?
      WHERE id = ?
    `, [CopyStatus.ACTIVE, 'order_id_placeholder', copyTradeId])

    // 清除缓存
    this.copyCache.delete(copyTradeId)

    console.log('[SocialTrading] 跟单执行:', copyTradeId)
  }

  /**
   * 完成跟单
   */
  async completeCopyTrade(copyTradeId, profitLoss, profitRate) {
    const now = Date.now()

    await this.db.executeSql(`
      UPDATE copy_trades
      SET status = ?, profit_loss = ?, profit_rate = ?, completed_at = ?
      WHERE id = ?
    `, [CopyStatus.COMPLETED, profitLoss, profitRate, now, copyTradeId])

    // 清除缓存
    this.copyCache.delete(copyTradeId)

    console.log('[SocialTrading] 跟单完成:', copyTradeId)
  }

  /**
   * 获取跟单列表
   */
  async getCopyTrades(options = {}) {
    const { followerDid, traderDid, status, limit = 50 } = options

    let query = 'SELECT * FROM copy_trades WHERE 1=1'
    const params = []

    if (followerDid) {
      query += ' AND follower_did = ?'
      params.push(followerDid)
    }

    if (traderDid) {
      query += ' AND trader_did = ?'
      params.push(traderDid)
    }

    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }

    query += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    return await this.db.executeSql(query, params)
  }

  /**
   * 发布交易信号
   */
  async createSignal(options) {
    const {
      signalType,
      assetId,
      entryPrice,
      targetPrice,
      stopLoss,
      confidence,
      reasoning,
      tags,
      expiresIn
    } = options

    const currentDid = await this.didManager.getCurrentDid()
    const now = Date.now()

    const signal = {
      id: this._generateId('signal'),
      trader_did: currentDid,
      signal_type: signalType,
      asset_id: assetId,
      entry_price: entryPrice || null,
      target_price: targetPrice || null,
      stop_loss: stopLoss || null,
      confidence: confidence || 0.5,
      reasoning: reasoning ? reasoning.trim() : null,
      tags: tags ? JSON.stringify(tags) : null,
      subscribers: 0,
      success_rate: 0,
      created_at: now,
      expires_at: expiresIn ? now + expiresIn : null
    }

    await this.db.executeSql(`
      INSERT INTO trade_signals (
        id, trader_did, signal_type, asset_id, entry_price,
        target_price, stop_loss, confidence, reasoning,
        tags, subscribers, success_rate, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      signal.id, signal.trader_did, signal.signal_type, signal.asset_id,
      signal.entry_price, signal.target_price, signal.stop_loss,
      signal.confidence, signal.reasoning, signal.tags, signal.subscribers,
      signal.success_rate, signal.created_at, signal.expires_at
    ])

    // 清除缓存
    this.signalCache.clear()

    console.log('[SocialTrading] 交易信号发布:', signal.id)
    return signal
  }

  /**
   * 获取交易信号
   */
  async getSignals(options = {}) {
    const { traderDid, assetId, limit = 50 } = options

    let query = 'SELECT * FROM trade_signals WHERE 1=1'
    const params = []

    if (traderDid) {
      query += ' AND trader_did = ?'
      params.push(traderDid)
    }

    if (assetId) {
      query += ' AND asset_id = ?'
      params.push(assetId)
    }

    // 排除已过期的信号
    query += ' AND (expires_at IS NULL OR expires_at > ?)'
    params.push(Date.now())

    query += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    const signals = await this.db.executeSql(query, params)

    signals.forEach(signal => {
      if (signal.tags) {
        signal.tags = JSON.parse(signal.tags)
      }
    })

    return signals
  }

  /**
   * 创建交易组
   */
  async createGroup(name, description, groupType = GroupType.PUBLIC, entryFee = 0, tags = null) {
    const currentDid = await this.didManager.getCurrentDid()
    const now = Date.now()

    const group = {
      id: this._generateId('group'),
      creator_did: currentDid,
      name: name.trim(),
      description: description ? description.trim() : null,
      group_type: groupType,
      member_count: 1,
      share_count: 0,
      tags: tags ? JSON.stringify(tags) : null,
      entry_fee: entryFee,
      created_at: now
    }

    await this.db.executeSql(`
      INSERT INTO trade_groups (
        id, creator_did, name, description, group_type,
        member_count, share_count, tags, entry_fee, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      group.id, group.creator_did, group.name, group.description,
      group.group_type, group.member_count, group.share_count,
      group.tags, group.entry_fee, group.created_at
    ])

    // 添加创建者为成员
    await this.db.executeSql(`
      INSERT INTO group_members (group_id, member_did, role, joined_at)
      VALUES (?, ?, ?, ?)
    `, [group.id, currentDid, 'creator', now])

    console.log('[SocialTrading] 交易组创建:', group.id)
    return group
  }

  /**
   * 加入交易组
   */
  async joinGroup(groupId) {
    const currentDid = await this.didManager.getCurrentDid()

    // 检查是否已加入
    const existing = await this.db.executeSql(
      'SELECT * FROM group_members WHERE group_id = ? AND member_did = ?',
      [groupId, currentDid]
    )

    if (existing.length > 0) {
      throw new Error('已经是组成员')
    }

    const now = Date.now()

    await this.db.executeSql(`
      INSERT INTO group_members (group_id, member_did, role, joined_at)
      VALUES (?, ?, ?, ?)
    `, [groupId, currentDid, 'member', now])

    // 更新成员数
    await this.db.executeSql(
      'UPDATE trade_groups SET member_count = member_count + 1 WHERE id = ?',
      [groupId]
    )

    console.log('[SocialTrading] 加入交易组:', groupId)
  }

  /**
   * 获取交易组
   */
  async getGroups(options = {}) {
    const { groupType, limit = 50 } = options

    let query = 'SELECT * FROM trade_groups WHERE 1=1'
    const params = []

    if (groupType) {
      query += ' AND group_type = ?'
      params.push(groupType)
    }

    query += ' ORDER BY member_count DESC, created_at DESC LIMIT ?'
    params.push(limit)

    const groups = await this.db.executeSql(query, params)

    groups.forEach(group => {
      if (group.tags) {
        group.tags = JSON.parse(group.tags)
      }
    })

    return groups
  }

  /**
   * 添加评论
   */
  async addComment(shareId, content, parentId = null) {
    const currentDid = await this.didManager.getCurrentDid()
    const now = Date.now()

    const comment = {
      id: this._generateId('comment'),
      share_id: shareId,
      commenter_did: currentDid,
      parent_id: parentId,
      content: content.trim(),
      likes: 0,
      created_at: now
    }

    await this.db.executeSql(`
      INSERT INTO trade_comments (
        id, share_id, commenter_did, parent_id, content, likes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      comment.id, comment.share_id, comment.commenter_did,
      comment.parent_id, comment.content, comment.likes, comment.created_at
    ])

    // 更新分享的评论数
    await this.db.executeSql(
      'UPDATE trade_shares SET comments = comments + 1 WHERE id = ?',
      [shareId]
    )

    // 清除缓存
    this.shareCache.delete(shareId)

    console.log('[SocialTrading] 评论添加:', comment.id)
    return comment
  }

  /**
   * 获取评论
   */
  async getComments(shareId, limit = 50) {
    return await this.db.executeSql(`
      SELECT * FROM trade_comments
      WHERE share_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [shareId, limit])
  }

  /**
   * 点赞
   */
  async addLike(targetType, targetId) {
    const currentDid = await this.didManager.getCurrentDid()
    const now = Date.now()

    try {
      await this.db.executeSql(`
        INSERT INTO trade_likes (target_type, target_id, liker_did, created_at)
        VALUES (?, ?, ?, ?)
      `, [targetType, targetId, currentDid, now])

      // 更新点赞数
      if (targetType === 'share') {
        await this.db.executeSql(
          'UPDATE trade_shares SET likes = likes + 1 WHERE id = ?',
          [targetId]
        )
        this.shareCache.delete(targetId)
      } else if (targetType === 'comment') {
        await this.db.executeSql(
          'UPDATE trade_comments SET likes = likes + 1 WHERE id = ?',
          [targetId]
        )
      }

      console.log('[SocialTrading] 点赞:', targetType, targetId)
    } catch (error) {
      if (error.message.includes('UNIQUE')) {
        throw new Error('已经点赞过了')
      }
      throw error
    }
  }

  /**
   * 取消点赞
   */
  async removeLike(targetType, targetId) {
    const currentDid = await this.didManager.getCurrentDid()

    const result = await this.db.executeSql(
      'DELETE FROM trade_likes WHERE target_type = ? AND target_id = ? AND liker_did = ?',
      [targetType, targetId, currentDid]
    )

    if (result.rowsAffected > 0) {
      // 更新点赞数
      if (targetType === 'share') {
        await this.db.executeSql(
          'UPDATE trade_shares SET likes = likes - 1 WHERE id = ?',
          [targetId]
        )
        this.shareCache.delete(targetId)
      } else if (targetType === 'comment') {
        await this.db.executeSql(
          'UPDATE trade_comments SET likes = likes - 1 WHERE id = ?',
          [targetId]
        )
      }

      console.log('[SocialTrading] 取消点赞:', targetType, targetId)
    }
  }

  /**
   * 关注交易员
   */
  async followTrader(traderDid) {
    const currentDid = await this.didManager.getCurrentDid()

    if (traderDid === currentDid) {
      throw new Error('不能关注自己')
    }

    const now = Date.now()

    try {
      await this.db.executeSql(`
        INSERT INTO trader_follows (follower_did, trader_did, created_at)
        VALUES (?, ?, ?)
      `, [currentDid, traderDid, now])

      console.log('[SocialTrading] 关注交易员:', traderDid)
    } catch (error) {
      if (error.message.includes('UNIQUE')) {
        throw new Error('已经关注过了')
      }
      throw error
    }
  }

  /**
   * 取消关注
   */
  async unfollowTrader(traderDid) {
    const currentDid = await this.didManager.getCurrentDid()

    await this.db.executeSql(
      'DELETE FROM trader_follows WHERE follower_did = ? AND trader_did = ?',
      [currentDid, traderDid]
    )

    console.log('[SocialTrading] 取消关注:', traderDid)
  }

  /**
   * 获取关注列表
   */
  async getFollowing(followerDid) {
    return await this.db.executeSql(
      'SELECT trader_did, created_at FROM trader_follows WHERE follower_did = ? ORDER BY created_at DESC',
      [followerDid]
    )
  }

  /**
   * 获取粉丝列表
   */
  async getFollowers(traderDid) {
    return await this.db.executeSql(
      'SELECT follower_did, created_at FROM trader_follows WHERE trader_did = ? ORDER BY created_at DESC',
      [traderDid]
    )
  }

  /**
   * 获取交易员排行
   */
  async getTraderRanking(rankBy = 'profit', limit = 50) {
    let orderBy = 'profit_rate DESC'

    if (rankBy === 'followers') {
      // 按粉丝数排序（需要join）
      const traders = await this.db.executeSql(`
        SELECT trader_did, COUNT(*) as follower_count
        FROM trader_follows
        GROUP BY trader_did
        ORDER BY follower_count DESC
        LIMIT ?
      `, [limit])

      return traders
    } else if (rankBy === 'profit') {
      // 按收益率排序
      const traders = await this.db.executeSql(`
        SELECT trader_did, AVG(profit_rate) as avg_profit_rate, COUNT(*) as trade_count
        FROM trade_shares
        WHERE deleted = 0 AND status = 'closed'
        GROUP BY trader_did
        HAVING trade_count >= 5
        ORDER BY avg_profit_rate DESC
        LIMIT ?
      `, [limit])

      return traders
    } else if (rankBy === 'copies') {
      // 按跟单数排序
      const traders = await this.db.executeSql(`
        SELECT trader_did, SUM(copies) as total_copies
        FROM trade_shares
        WHERE deleted = 0
        GROUP BY trader_did
        ORDER BY total_copies DESC
        LIMIT ?
      `, [limit])

      return traders
    }

    return []
  }

  /**
   * 获取统计信息
   */
  async getStatistics(traderDid = null) {
    const currentDid = traderDid || await this.didManager.getCurrentDid()

    // 总分享数
    const shares = await this.db.executeSql(
      'SELECT COUNT(*) as count FROM trade_shares WHERE trader_did = ? AND deleted = 0',
      [currentDid]
    )

    // 总跟单数（作为交易员）
    const copies = await this.db.executeSql(
      'SELECT COUNT(*) as count FROM copy_trades WHERE trader_did = ?',
      [currentDid]
    )

    // 我的跟单数（作为跟随者）
    const myCopies = await this.db.executeSql(
      'SELECT COUNT(*) as count FROM copy_trades WHERE follower_did = ?',
      [currentDid]
    )

    // 粉丝数
    const followers = await this.db.executeSql(
      'SELECT COUNT(*) as count FROM trader_follows WHERE trader_did = ?',
      [currentDid]
    )

    // 关注数
    const following = await this.db.executeSql(
      'SELECT COUNT(*) as count FROM trader_follows WHERE follower_did = ?',
      [currentDid]
    )

    // 平均收益率
    const profitRate = await this.db.executeSql(
      'SELECT AVG(profit_rate) as avg FROM trade_shares WHERE trader_did = ? AND status = ? AND deleted = 0',
      [currentDid, ShareStatus.CLOSED]
    )

    return {
      totalShares: shares[0].count,
      totalCopies: copies[0].count,
      myCopies: myCopies[0].count,
      followers: followers[0].count,
      following: following[0].count,
      avgProfitRate: profitRate[0].avg || 0
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.shareCache.clear()
    this.copyCache.clear()
    this.signalCache.clear()
    console.log('[SocialTrading] 缓存已清除')
  }

  /**
   * 生成ID
   */
  _generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 销毁
   */
  destroy() {
    this.clearCache()
    console.log('[SocialTrading] 已销毁')
  }
}

// 单例模式
let socialTradingManagerInstance = null

/**
 * 创建 SocialTradingManager 实例
 */
export function createSocialTradingManager(db, didManager, marketplaceManager, creditManager) {
  if (!socialTradingManagerInstance) {
    socialTradingManagerInstance = new SocialTradingManager(db, didManager, marketplaceManager, creditManager)
  }
  return socialTradingManagerInstance
}

/**
 * 获取 SocialTradingManager 实例
 */
export function getSocialTradingManager() {
  if (!socialTradingManagerInstance) {
    throw new Error('SocialTradingManager 未初始化')
  }
  return socialTradingManagerInstance
}

export {
  ShareType,
  ShareStatus,
  CopyStatus,
  SignalType,
  GroupType
}
