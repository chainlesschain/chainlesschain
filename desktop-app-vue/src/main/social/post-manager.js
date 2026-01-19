/**
 * 动态管理器
 *
 * 负责社交动态的管理，包括：
 * - 动态发布和编辑
 * - 动态流查询
 * - 点赞和取消点赞
 * - 评论和回复
 * - P2P 动态同步
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * 动态可见性
 */
const PostVisibility = {
  PUBLIC: 'public',       // 公开
  FRIENDS: 'friends',     // 仅好友可见
  PRIVATE: 'private',     // 仅自己可见
};

/**
 * 动态管理器类
 */
class PostManager extends EventEmitter {
  constructor(database, didManager, p2pManager, friendManager) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.p2pManager = p2pManager;
    this.friendManager = friendManager;

    this.initialized = false;
  }

  /**
   * 初始化动态管理器
   */
  async initialize() {
    console.log('[PostManager] 初始化动态管理器...');

    try {
      // 初始化数据库表
      await this.initializeTables();

      // 监听 P2P 事件
      this.setupP2PListeners();

      this.initialized = true;
      console.log('[PostManager] 动态管理器初始化成功');
    } catch (error) {
      console.error('[PostManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化数据库表
   */
  async initializeTables() {
    const db = this.database.db;

    // 动态表
    db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        author_did TEXT NOT NULL,
        content TEXT NOT NULL,
        images TEXT,
        link_url TEXT,
        link_title TEXT,
        link_description TEXT,
        visibility TEXT NOT NULL DEFAULT 'public',
        like_count INTEGER DEFAULT 0,
        comment_count INTEGER DEFAULT 0,
        share_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // 创建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_posts_author_did ON posts(author_did);
      CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
    `);

    // 点赞表（添加外键约束）
    db.exec(`
      CREATE TABLE IF NOT EXISTS post_likes (
        post_id TEXT NOT NULL,
        user_did TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (post_id, user_did),
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
      )
    `);

    // 评论表（添加外键约束）
    db.exec(`
      CREATE TABLE IF NOT EXISTS post_comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        author_did TEXT NOT NULL,
        content TEXT NOT NULL,
        parent_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES post_comments(id) ON DELETE CASCADE
      )
    `);

    // 创建评论索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_comments_post_id ON post_comments(post_id);
      CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON post_comments(parent_id);
    `);

    console.log('[PostManager] 数据库表初始化完成');
  }

  /**
   * 设置 P2P 监听器
   */
  setupP2PListeners() {
    if (!this.p2pManager) {
      return;
    }

    // 监听新动态同步
    this.p2pManager.on('post:received', async ({ post }) => {
      await this.handlePostReceived(post);
    });

    // 监听点赞同步
    this.p2pManager.on('post-like:received', async ({ postId, userDid }) => {
      await this.handleLikeReceived(postId, userDid);
    });

    // 监听评论同步
    this.p2pManager.on('post-comment:received', async ({ comment }) => {
      await this.handleCommentReceived(comment);
    });

    console.log('[PostManager] P2P 事件监听器已设置');
  }

  /**
   * 发布动态
   * @param {Object} options - 动态选项
   * @param {string} options.content - 动态内容
   * @param {Array<string>} options.images - 图片 URL 列表
   * @param {string} options.linkUrl - 链接 URL
   * @param {string} options.linkTitle - 链接标题
   * @param {string} options.linkDescription - 链接描述
   * @param {string} options.visibility - 可见性
   */
  async createPost({ content, images = [], linkUrl, linkTitle, linkDescription, visibility = PostVisibility.PUBLIC }) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录，无法发布动态');
      }

      if (!content || content.trim().length === 0) {
        throw new Error('动态内容不能为空');
      }

      if (content.length > 1000) {
        throw new Error('动态内容不能超过 1000 字');
      }

      if (images.length > 9) {
        throw new Error('图片数量不能超过 9 张');
      }

      const postId = uuidv4();
      const now = Date.now();

      const db = this.database.db;
      const stmt = db.prepare(`
        INSERT INTO posts
        (id, author_did, content, images, link_url, link_title, link_description, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        postId,
        currentDid,
        content.trim(),
        images.length > 0 ? JSON.stringify(images) : null,
        linkUrl || null,
        linkTitle || null,
        linkDescription || null,
        visibility,
        now,
        now
      );

      const post = {
        id: postId,
        author_did: currentDid,
        content: content.trim(),
        images,
        link_url: linkUrl,
        link_title: linkTitle,
        link_description: linkDescription,
        visibility,
        like_count: 0,
        comment_count: 0,
        share_count: 0,
        created_at: now,
        updated_at: now,
      };

      console.log('[PostManager] 已发布动态:', postId);

      // 通过 P2P 同步动态（根据可见性）
      await this.syncPost(post);

      this.emit('post:created', { post });

      return post;
    } catch (error) {
      console.error('[PostManager] 发布动态失败:', error);
      throw error;
    }
  }

  /**
   * 同步动态到 P2P 网络
   * @param {Object} post - 动态对象
   */
  async syncPost(post) {
    if (!this.p2pManager) {
      return;
    }

    try {
      // 根据可见性决定同步范围
      if (post.visibility === PostVisibility.PRIVATE) {
        // 私有动态不同步
        return;
      }

      let targetDids = [];

      if (post.visibility === PostVisibility.FRIENDS) {
        // 仅同步给好友
        const friends = await this.friendManager?.getFriends();
        targetDids = friends ? friends.map(f => f.friend_did) : [];
      } else if (post.visibility === PostVisibility.PUBLIC) {
        // 公开动态：同步给所有连接的节点
        const connectedPeers = this.p2pManager.getConnectedPeers();
        targetDids = connectedPeers.map(peer => peer.id);
      }

      // 发送动态到目标节点
      for (const targetDid of targetDids) {
        try {
          await this.p2pManager.sendEncryptedMessage(targetDid, JSON.stringify({
            type: 'post-sync',
            post,
          }));
        } catch (error) {
          console.warn('[PostManager] 同步动态失败:', targetDid, error.message);
        }
      }

      console.log('[PostManager] 动态已同步到', targetDids.length, '个节点');
    } catch (error) {
      console.error('[PostManager] 同步动态失败:', error);
    }
  }

  /**
   * 处理收到的动态
   * @param {Object} post - 动态对象
   */
  async handlePostReceived(post) {
    try {
      // 检查是否已存在
      const db = this.database.db;
      const existing = db.prepare('SELECT id FROM posts WHERE id = ?').get(post.id);

      if (existing) {
        console.log('[PostManager] 动态已存在，忽略:', post.id);
        return;
      }

      // 验证作者是否是好友（如果可见性是 friends）
      if (post.visibility === PostVisibility.FRIENDS) {
        const isFriend = await this.friendManager?.isFriend(post.author_did);
        if (!isFriend) {
          console.log('[PostManager] 非好友动态，忽略:', post.id);
          return;
        }
      }

      // 保存动态
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO posts
        (id, author_did, content, images, link_url, link_title, link_description, visibility, like_count, comment_count, share_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        post.id,
        post.author_did,
        post.content,
        post.images ? JSON.stringify(post.images) : null,
        post.link_url || null,
        post.link_title || null,
        post.link_description || null,
        post.visibility,
        post.like_count || 0,
        post.comment_count || 0,
        post.share_count || 0,
        post.created_at,
        post.updated_at
      );

      console.log('[PostManager] 已接收动态:', post.id);

      this.emit('post:received', { post });
    } catch (error) {
      console.error('[PostManager] 处理收到的动态失败:', error);
    }
  }

  /**
   * 获取动态流
   * @param {Object} options - 查询选项
   * @param {number} options.limit - 限制数量
   * @param {number} options.offset - 偏移量
   * @param {string} options.authorDid - 作者 DID（可选）
   */
  async getFeed({ limit = 20, offset = 0, authorDid = null } = {}) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        return [];
      }

      const db = this.database.db;

      let query = `
        SELECT * FROM posts
        WHERE (
          author_did = ?
          OR visibility = 'public'
          OR (visibility = 'friends' AND author_did IN (
            SELECT friend_did FROM friendships WHERE user_did = ? AND status = 'accepted'
          ))
        )
      `;

      const params = [currentDid, currentDid];

      if (authorDid) {
        query += ' AND author_did = ?';
        params.push(authorDid);
      }

      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const posts = db.prepare(query).all(...params);

      // 解析图片 JSON
      return posts.map(post => ({
        ...post,
        images: post.images ? JSON.parse(post.images) : [],
        // 添加当前用户是否点赞的标记
        liked: this.hasLiked(post.id, currentDid),
      }));
    } catch (error) {
      console.error('[PostManager] 获取动态流失败:', error);
      throw error;
    }
  }

  /**
   * 获取单条动态
   * @param {string} postId - 动态 ID
   */
  async getPost(postId) {
    try {
      const db = this.database.db;
      const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);

      if (!post) {
        return null;
      }

      return {
        ...post,
        images: post.images ? JSON.parse(post.images) : [],
      };
    } catch (error) {
      console.error('[PostManager] 获取动态失败:', error);
      throw error;
    }
  }

  /**
   * 删除动态
   * @param {string} postId - 动态 ID
   */
  async deletePost(postId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      const db = this.database.db;

      // 检查是否是作者
      const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);

      if (!post) {
        throw new Error('动态不存在');
      }

      if (post.author_did !== currentDid) {
        throw new Error('无权删除此动态');
      }

      // 删除动态
      db.prepare('DELETE FROM posts WHERE id = ?').run(postId);

      // 删除相关的点赞和评论
      db.prepare('DELETE FROM post_likes WHERE post_id = ?').run(postId);
      db.prepare('DELETE FROM post_comments WHERE post_id = ?').run(postId);

      console.log('[PostManager] 已删除动态:', postId);

      this.emit('post:deleted', { postId });

      return { success: true };
    } catch (error) {
      console.error('[PostManager] 删除动态失败:', error);
      throw error;
    }
  }

  /**
   * 点赞动态
   * @param {string} postId - 动态 ID
   */
  async likePost(postId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      const db = this.database.db;

      // 检查是否已点赞
      const existing = db.prepare('SELECT * FROM post_likes WHERE post_id = ? AND user_did = ?').get(postId, currentDid);

      if (existing) {
        throw new Error('已经点过赞了');
      }

      const now = Date.now();

      // 添加点赞记录
      db.prepare('INSERT INTO post_likes (post_id, user_did, created_at) VALUES (?, ?, ?)').run(postId, currentDid, now);

      // 更新点赞计数
      db.prepare('UPDATE posts SET like_count = like_count + 1 WHERE id = ?').run(postId);

      console.log('[PostManager] 已点赞:', postId);

      // 通知作者
      const post = await this.getPost(postId);
      if (post && post.author_did !== currentDid && this.p2pManager) {
        try {
          await this.p2pManager.sendEncryptedMessage(post.author_did, JSON.stringify({
            type: 'post-like',
            postId,
            userDid: currentDid,
            timestamp: now,
          }));
        } catch (error) {
          console.warn('[PostManager] 通知点赞失败:', error.message);
        }
      }

      this.emit('post:liked', { postId, userDid: currentDid });

      return { success: true };
    } catch (error) {
      console.error('[PostManager] 点赞失败:', error);
      throw error;
    }
  }

  /**
   * 取消点赞
   * @param {string} postId - 动态 ID
   */
  async unlikePost(postId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      const db = this.database.db;

      // 删除点赞记录
      const result = db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_did = ?').run(postId, currentDid);

      if (result.changes === 0) {
        throw new Error('还未点赞');
      }

      // 更新点赞计数
      db.prepare('UPDATE posts SET like_count = like_count - 1 WHERE id = ?').run(postId);

      console.log('[PostManager] 已取消点赞:', postId);

      this.emit('post:unliked', { postId, userDid: currentDid });

      return { success: true };
    } catch (error) {
      console.error('[PostManager] 取消点赞失败:', error);
      throw error;
    }
  }

  /**
   * 检查是否已点赞
   * @param {string} postId - 动态 ID
   * @param {string} userDid - 用户 DID
   */
  hasLiked(postId, userDid) {
    try {
      const db = this.database.db;
      const like = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_did = ?').get(postId, userDid);
      return !!like;
    } catch (error) {
      console.error('[PostManager] 检查点赞状态失败:', error);
      return false;
    }
  }

  /**
   * 处理收到的点赞
   * @param {string} postId - 动态 ID
   * @param {string} userDid - 用户 DID
   */
  async handleLikeReceived(postId, userDid) {
    try {
      const db = this.database.db;

      // 检查动态是否存在
      const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);

      if (!post) {
        console.log('[PostManager] 动态不存在，忽略点赞:', postId);
        return;
      }

      // 检查是否已点赞
      const existing = db.prepare('SELECT * FROM post_likes WHERE post_id = ? AND user_did = ?').get(postId, userDid);

      if (existing) {
        return;
      }

      const now = Date.now();

      // 添加点赞记录
      db.prepare('INSERT INTO post_likes (post_id, user_did, created_at) VALUES (?, ?, ?)').run(postId, userDid, now);

      // 更新点赞计数
      db.prepare('UPDATE posts SET like_count = like_count + 1 WHERE id = ?').run(postId);

      console.log('[PostManager] 已接收点赞:', postId, userDid);

      this.emit('post:liked', { postId, userDid });
    } catch (error) {
      console.error('[PostManager] 处理点赞失败:', error);
    }
  }

  /**
   * 获取点赞列表
   * @param {string} postId - 动态 ID
   */
  async getLikes(postId) {
    try {
      const db = this.database.db;
      return db.prepare('SELECT * FROM post_likes WHERE post_id = ? ORDER BY created_at DESC').all(postId);
    } catch (error) {
      console.error('[PostManager] 获取点赞列表失败:', error);
      throw error;
    }
  }

  /**
   * 添加评论
   * @param {string} postId - 动态 ID
   * @param {string} content - 评论内容
   * @param {string} parentId - 父评论 ID（可选，用于回复）
   */
  async addComment(postId, content, parentId = null) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      if (!content || content.trim().length === 0) {
        throw new Error('评论内容不能为空');
      }

      if (content.length > 500) {
        throw new Error('评论内容不能超过 500 字');
      }

      const commentId = uuidv4();
      const now = Date.now();

      const db = this.database.db;

      // 添加评论
      db.prepare(`
        INSERT INTO post_comments (id, post_id, author_did, content, parent_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(commentId, postId, currentDid, content.trim(), parentId, now);

      // 更新评论计数
      db.prepare('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?').run(postId);

      const comment = {
        id: commentId,
        post_id: postId,
        author_did: currentDid,
        content: content.trim(),
        parent_id: parentId,
        created_at: now,
      };

      console.log('[PostManager] 已添加评论:', commentId);

      // 通知作者
      const post = await this.getPost(postId);
      if (post && post.author_did !== currentDid && this.p2pManager) {
        try {
          await this.p2pManager.sendEncryptedMessage(post.author_did, JSON.stringify({
            type: 'post-comment',
            comment,
          }));
        } catch (error) {
          console.warn('[PostManager] 通知评论失败:', error.message);
        }
      }

      this.emit('comment:added', { comment });

      return comment;
    } catch (error) {
      console.error('[PostManager] 添加评论失败:', error);
      throw error;
    }
  }

  /**
   * 处理收到的评论
   * @param {Object} comment - 评论对象
   */
  async handleCommentReceived(comment) {
    try {
      const db = this.database.db;

      // 检查是否已存在
      const existing = db.prepare('SELECT id FROM post_comments WHERE id = ?').get(comment.id);

      if (existing) {
        return;
      }

      // 添加评论
      db.prepare(`
        INSERT OR IGNORE INTO post_comments (id, post_id, author_did, content, parent_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        comment.id,
        comment.post_id,
        comment.author_did,
        comment.content,
        comment.parent_id,
        comment.created_at
      );

      // 更新评论计数
      db.prepare('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?').run(comment.post_id);

      console.log('[PostManager] 已接收评论:', comment.id);

      this.emit('comment:received', { comment });
    } catch (error) {
      console.error('[PostManager] 处理评论失败:', error);
    }
  }

  /**
   * 获取评论列表
   * @param {string} postId - 动态 ID
   */
  async getComments(postId) {
    try {
      const db = this.database.db;
      return db.prepare('SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC').all(postId);
    } catch (error) {
      console.error('[PostManager] 获取评论列表失败:', error);
      throw error;
    }
  }

  /**
   * 删除评论
   * @param {string} commentId - 评论 ID
   */
  async deleteComment(commentId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      const db = this.database.db;

      // 检查是否是作者
      const comment = db.prepare('SELECT * FROM post_comments WHERE id = ?').get(commentId);

      if (!comment) {
        throw new Error('评论不存在');
      }

      if (comment.author_did !== currentDid) {
        throw new Error('无权删除此评论');
      }

      // 删除评论及其所有回复
      db.prepare('DELETE FROM post_comments WHERE id = ? OR parent_id = ?').run(commentId, commentId);

      // 更新评论计数（需要重新计算）
      const count = db.prepare('SELECT COUNT(*) as count FROM post_comments WHERE post_id = ?').get(comment.post_id);
      db.prepare('UPDATE posts SET comment_count = ? WHERE id = ?').run(count.count, comment.post_id);

      console.log('[PostManager] 已删除评论:', commentId);

      this.emit('comment:deleted', { commentId, postId: comment.post_id });

      return { success: true };
    } catch (error) {
      console.error('[PostManager] 删除评论失败:', error);
      throw error;
    }
  }

  /**
   * 关闭动态管理器
   */
  async close() {
    console.log('[PostManager] 关闭动态管理器');

    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  PostManager,
  PostVisibility,
};
