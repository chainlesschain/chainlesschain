/**
 * 好友管理器
 *
 * 负责好友关系的管理，包括：
 * - 好友请求发送与接收
 * - 好友列表管理
 * - 好友状态同步
 * - 好友分组和备注
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');

/**
 * 好友关系状态
 */
const FriendshipStatus = {
  PENDING: 'pending',     // 待确认
  ACCEPTED: 'accepted',   // 已接受
  BLOCKED: 'blocked',     // 已屏蔽
};

/**
 * 好友请求状态
 */
const FriendRequestStatus = {
  PENDING: 'pending',     // 待处理
  ACCEPTED: 'accepted',   // 已接受
  REJECTED: 'rejected',   // 已拒绝
  EXPIRED: 'expired',     // 已过期
};

/**
 * 好友在线状态
 */
const FriendOnlineStatus = {
  ONLINE: 'online',       // 在线
  OFFLINE: 'offline',     // 离线
  AWAY: 'away',          // 离开
};

/**
 * 好友管理器类
 */
class FriendManager extends EventEmitter {
  constructor(database, didManager, p2pManager) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.p2pManager = p2pManager;

    // 在线状态缓存 Map<friendDid, status>
    this.onlineStatus = new Map();

    this.initialized = false;
  }

  /**
   * 初始化好友管理器
   */
  async initialize() {
    logger.info('[FriendManager] 初始化好友管理器...');

    try {
      // 初始化数据库表
      await this.initializeTables();

      // 加载好友在线状态
      await this.loadFriendStatus();

      // 监听 P2P 连接事件
      this.setupP2PListeners();

      this.initialized = true;
      logger.info('[FriendManager] 好友管理器初始化成功');
    } catch (error) {
      logger.error('[FriendManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化数据库表
   */
  async initializeTables() {
    const db = this.database.db;

    // 好友关系表
    db.exec(`
      CREATE TABLE IF NOT EXISTS friendships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_did TEXT NOT NULL,
        friend_did TEXT NOT NULL,
        nickname TEXT,
        group_name TEXT DEFAULT '我的好友',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_did, friend_did)
      )
    `);

    // 好友请求表
    db.exec(`
      CREATE TABLE IF NOT EXISTS friend_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_did TEXT NOT NULL,
        to_did TEXT NOT NULL,
        message TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(from_did, to_did)
      )
    `);

    // 好友在线状态表 (用于持久化缓存)
    db.exec(`
      CREATE TABLE IF NOT EXISTS friend_status (
        friend_did TEXT PRIMARY KEY,
        online_status TEXT NOT NULL DEFAULT 'offline',
        last_seen INTEGER NOT NULL,
        device_count INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `);

    logger.info('[FriendManager] 数据库表初始化完成');
  }

  /**
   * 加载好友在线状态
   */
  async loadFriendStatus() {
    const db = this.database.db;
    const stmt = db.prepare('SELECT * FROM friend_status');
    const statuses = stmt.all();

    for (const status of statuses) {
      this.onlineStatus.set(status.friend_did, {
        status: status.online_status,
        lastSeen: status.last_seen,
        deviceCount: status.device_count,
      });
    }

    logger.info('[FriendManager] 已加载', statuses.length, '个好友状态');
  }

  /**
   * 设置 P2P 监听器
   */
  setupP2PListeners() {
    if (!this.p2pManager) {
      return;
    }

    // 监听节点连接事件
    this.p2pManager.on('peer:connected', ({ peerId }) => {
      this.handlePeerConnected(peerId);
    });

    // 监听节点断开事件
    this.p2pManager.on('peer:disconnected', ({ peerId }) => {
      this.handlePeerDisconnected(peerId);
    });

    logger.info('[FriendManager] P2P 事件监听器已设置');
  }

  /**
   * 处理节点连接事件
   */
  async handlePeerConnected(peerId) {
    // 检查是否是好友
    const isFriend = await this.isFriend(peerId);

    if (isFriend) {
      // 更新好友在线状态
      await this.updateFriendStatus(peerId, FriendOnlineStatus.ONLINE);

      logger.info('[FriendManager] 好友上线:', peerId);

      this.emit('friend:online', { friendDid: peerId });
    }
  }

  /**
   * 处理节点断开事件
   */
  async handlePeerDisconnected(peerId) {
    const isFriend = await this.isFriend(peerId);

    if (isFriend) {
      // 更新好友离线状态
      await this.updateFriendStatus(peerId, FriendOnlineStatus.OFFLINE);

      logger.info('[FriendManager] 好友离线:', peerId);

      this.emit('friend:offline', { friendDid: peerId });
    }
  }

  /**
   * 发送好友请求
   * @param {string} targetDid - 目标用户 DID
   * @param {string} message - 请求消息
   */
  async sendFriendRequest(targetDid, message = '') {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录，无法发送好友请求');
      }

      if (currentDid === targetDid) {
        throw new Error('不能添加自己为好友');
      }

      // 检查是否已经是好友
      if (await this.isFriend(targetDid)) {
        throw new Error('已经是好友关系');
      }

      // 检查是否已发送过请求
      const existingRequest = await this.getFriendRequest(currentDid, targetDid);
      if (existingRequest && existingRequest.status === FriendRequestStatus.PENDING) {
        throw new Error('已经发送过好友请求，请等待对方处理');
      }

      const now = Date.now();
      const db = this.database.db;

      // 插入好友请求记录
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO friend_requests
        (from_did, to_did, message, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        currentDid,
        targetDid,
        message,
        FriendRequestStatus.PENDING,
        now,
        now
      );

      // 通过 P2P 发送好友请求
      if (this.p2pManager) {
        await this.p2pManager.sendEncryptedMessage(targetDid, JSON.stringify({
          type: 'friend-request',
          from: currentDid,
          message,
          timestamp: now,
        }));
      }

      logger.info('[FriendManager] 已发送好友请求到:', targetDid);

      this.emit('friend-request:sent', {
        targetDid,
        message,
      });

      return {
        success: true,
        requestId: stmt.lastInsertRowid,
      };
    } catch (error) {
      logger.error('[FriendManager] 发送好友请求失败:', error);
      throw error;
    }
  }

  /**
   * 处理收到的好友请求
   * @param {string} fromDid - 发送者 DID
   * @param {string} message - 请求消息
   * @param {number} timestamp - 时间戳
   */
  async handleFriendRequestReceived(fromDid, message, timestamp) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        logger.warn('[FriendManager] 未登录，忽略好友请求');
        return;
      }

      // 检查是否已经是好友
      if (await this.isFriend(fromDid)) {
        logger.info('[FriendManager] 已经是好友，忽略请求');
        return;
      }

      const now = Date.now();
      const db = this.database.db;

      // 插入好友请求记录
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO friend_requests
        (from_did, to_did, message, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        fromDid,
        currentDid,
        message,
        FriendRequestStatus.PENDING,
        timestamp,
        now
      );

      logger.info('[FriendManager] 收到好友请求:', fromDid);

      this.emit('friend-request:received', {
        fromDid,
        message,
        timestamp,
      });
    } catch (error) {
      logger.error('[FriendManager] 处理好友请求失败:', error);
    }
  }

  /**
   * 接受好友请求
   * @param {number} requestId - 请求 ID
   */
  async acceptFriendRequest(requestId) {
    try {
      const db = this.database.db;

      // 查询请求信息
      const request = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId);

      if (!request) {
        throw new Error('好友请求不存在');
      }

      if (request.status !== FriendRequestStatus.PENDING) {
        throw new Error('好友请求已处理');
      }

      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (request.to_did !== currentDid) {
        throw new Error('无权处理此好友请求');
      }

      const now = Date.now();

      // 更新请求状态为已接受
      db.prepare('UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?')
        .run(FriendRequestStatus.ACCEPTED, now, requestId);

      // 添加好友关系 (双向)
      const addStmt = db.prepare(`
        INSERT OR REPLACE INTO friendships
        (user_did, friend_did, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      addStmt.run(currentDid, request.from_did, FriendshipStatus.ACCEPTED, now, now);
      addStmt.run(request.from_did, currentDid, FriendshipStatus.ACCEPTED, now, now);

      // 通过 P2P 通知对方
      if (this.p2pManager) {
        await this.p2pManager.sendEncryptedMessage(request.from_did, JSON.stringify({
          type: 'friend-request-accepted',
          from: currentDid,
          timestamp: now,
        }));
      }

      logger.info('[FriendManager] 已接受好友请求:', request.from_did);

      this.emit('friend-request:accepted', {
        friendDid: request.from_did,
      });

      return { success: true };
    } catch (error) {
      logger.error('[FriendManager] 接受好友请求失败:', error);
      throw error;
    }
  }

  /**
   * 拒绝好友请求
   * @param {number} requestId - 请求 ID
   */
  async rejectFriendRequest(requestId) {
    try {
      const db = this.database.db;

      // 查询请求信息
      const request = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId);

      if (!request) {
        throw new Error('好友请求不存在');
      }

      if (request.status !== FriendRequestStatus.PENDING) {
        throw new Error('好友请求已处理');
      }

      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (request.to_did !== currentDid) {
        throw new Error('无权处理此好友请求');
      }

      const now = Date.now();

      // 更新请求状态为已拒绝
      db.prepare('UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?')
        .run(FriendRequestStatus.REJECTED, now, requestId);

      logger.info('[FriendManager] 已拒绝好友请求:', request.from_did);

      this.emit('friend-request:rejected', {
        fromDid: request.from_did,
      });

      return { success: true };
    } catch (error) {
      logger.error('[FriendManager] 拒绝好友请求失败:', error);
      throw error;
    }
  }

  /**
   * 获取好友请求
   * @param {string} fromDid - 发送者 DID
   * @param {string} toDid - 接收者 DID
   */
  async getFriendRequest(fromDid, toDid) {
    const db = this.database.db;
    return db.prepare('SELECT * FROM friend_requests WHERE from_did = ? AND to_did = ?').get(fromDid, toDid);
  }

  /**
   * 获取所有待处理的好友请求
   */
  async getPendingFriendRequests() {
    const currentDid = this.didManager?.getCurrentIdentity()?.did;

    if (!currentDid) {
      return [];
    }

    const db = this.database.db;
    return db.prepare(`
      SELECT * FROM friend_requests
      WHERE to_did = ? AND status = ?
      ORDER BY created_at DESC
    `).all(currentDid, FriendRequestStatus.PENDING);
  }

  /**
   * 获取好友列表
   * @param {string} groupName - 分组名称 (可选)
   */
  async getFriends(groupName = null) {
    const currentDid = this.didManager?.getCurrentIdentity()?.did;

    if (!currentDid) {
      return [];
    }

    const db = this.database.db;

    let query = 'SELECT * FROM friendships WHERE user_did = ? AND status = ?';
    const params = [currentDid, FriendshipStatus.ACCEPTED];

    if (groupName) {
      query += ' AND group_name = ?';
      params.push(groupName);
    }

    query += ' ORDER BY updated_at DESC';

    const friends = db.prepare(query).all(...params);

    // 添加在线状态信息
    return friends.map(friend => ({
      ...friend,
      onlineStatus: this.onlineStatus.get(friend.friend_did) || {
        status: FriendOnlineStatus.OFFLINE,
        lastSeen: 0,
        deviceCount: 0,
      },
    }));
  }

  /**
   * 删除好友
   * @param {string} friendDid - 好友 DID
   */
  async removeFriend(friendDid) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      const db = this.database.db;

      // 删除双向好友关系
      db.prepare('DELETE FROM friendships WHERE user_did = ? AND friend_did = ?')
        .run(currentDid, friendDid);
      db.prepare('DELETE FROM friendships WHERE user_did = ? AND friend_did = ?')
        .run(friendDid, currentDid);

      logger.info('[FriendManager] 已删除好友:', friendDid);

      this.emit('friend:removed', { friendDid });

      return { success: true };
    } catch (error) {
      logger.error('[FriendManager] 删除好友失败:', error);
      throw error;
    }
  }

  /**
   * 更新好友备注
   * @param {string} friendDid - 好友 DID
   * @param {string} nickname - 备注名
   */
  async updateFriendNickname(friendDid, nickname) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      const db = this.database.db;
      const now = Date.now();

      db.prepare('UPDATE friendships SET nickname = ?, updated_at = ? WHERE user_did = ? AND friend_did = ?')
        .run(nickname, now, currentDid, friendDid);

      logger.info('[FriendManager] 已更新好友备注:', friendDid);

      this.emit('friend:nickname-updated', { friendDid, nickname });

      return { success: true };
    } catch (error) {
      logger.error('[FriendManager] 更新好友备注失败:', error);
      throw error;
    }
  }

  /**
   * 更新好友分组
   * @param {string} friendDid - 好友 DID
   * @param {string} groupName - 分组名称
   */
  async updateFriendGroup(friendDid, groupName) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      const db = this.database.db;
      const now = Date.now();

      db.prepare('UPDATE friendships SET group_name = ?, updated_at = ? WHERE user_did = ? AND friend_did = ?')
        .run(groupName, now, currentDid, friendDid);

      logger.info('[FriendManager] 已更新好友分组:', friendDid);

      this.emit('friend:group-updated', { friendDid, groupName });

      return { success: true };
    } catch (error) {
      logger.error('[FriendManager] 更新好友分组失败:', error);
      throw error;
    }
  }

  /**
   * 更新好友在线状态
   * @param {string} friendDid - 好友 DID
   * @param {string} status - 在线状态
   * @param {number} deviceCount - 设备数量
   */
  async updateFriendStatus(friendDid, status, deviceCount = 1) {
    const now = Date.now();

    // 更新内存缓存
    this.onlineStatus.set(friendDid, {
      status,
      lastSeen: now,
      deviceCount,
    });

    // 更新数据库
    const db = this.database.db;
    db.prepare(`
      INSERT OR REPLACE INTO friend_status
      (friend_did, online_status, last_seen, device_count, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(friendDid, status, now, deviceCount, now);

    this.emit('friend:status-updated', {
      friendDid,
      status,
      lastSeen: now,
      deviceCount,
    });
  }

  /**
   * 检查是否是好友
   * @param {string} did - DID
   */
  async isFriend(did) {
    const currentDid = this.didManager?.getCurrentIdentity()?.did;

    if (!currentDid) {
      return false;
    }

    const db = this.database.db;
    const friendship = db.prepare(
      'SELECT * FROM friendships WHERE user_did = ? AND friend_did = ? AND status = ?'
    ).get(currentDid, did, FriendshipStatus.ACCEPTED);

    return !!friendship;
  }

  /**
   * 获取好友统计
   */
  async getStatistics() {
    const currentDid = this.didManager?.getCurrentIdentity()?.did;

    if (!currentDid) {
      return {
        total: 0,
        online: 0,
        offline: 0,
        byGroup: {},
      };
    }

    const db = this.database.db;

    const friends = await this.getFriends();

    const stats = {
      total: friends.length,
      online: friends.filter(f => f.onlineStatus.status === FriendOnlineStatus.ONLINE).length,
      offline: friends.filter(f => f.onlineStatus.status === FriendOnlineStatus.OFFLINE).length,
      byGroup: {},
    };

    // 按分组统计
    for (const friend of friends) {
      const group = friend.group_name || '我的好友';
      stats.byGroup[group] = (stats.byGroup[group] || 0) + 1;
    }

    return stats;
  }

  /**
   * 关闭好友管理器
   */
  async close() {
    logger.info('[FriendManager] 关闭好友管理器');

    this.onlineStatus.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  FriendManager,
  FriendshipStatus,
  FriendRequestStatus,
  FriendOnlineStatus,
};
