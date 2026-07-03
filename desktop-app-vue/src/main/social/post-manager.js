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

const { logger } = require("../utils/logger.js");

/**
 * Tolerant JSON column parse — a single post with a corrupt images string must
 * not throw out of the .map and drop the whole post list. The `x ? JSON.parse(x)
 * : d` form it replaces only guarded NULL, not a corrupt non-empty string.
 */
function safeParse(raw, fallback) {
  if (raw == null || raw === "") {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(
      `[PostManager] Bad JSON column, using fallback: ${err.message}`,
    );
    return fallback;
  }
}
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const {
  signPayloadWithIdentity,
  verifyPayloadAgainstDid,
} = require("../did/did-signer.js");

/**
 * Build the canonical, IMMUTABLE subset of a post that is Ed25519-signed by its
 * author and verified on receipt. Only fields fixed at creation are included —
 * NEVER like_count / comment_count / share_count / updated_at, which mutate as
 * the post propagates and would otherwise break every relayed signature.
 *
 * canonicalize() (did-signer) rejects nested objects/arrays, so `images` (an
 * array) is flattened to its JSON string. Both sender and receiver call THIS
 * function, so the canonical bytes match exactly.
 * @param {Object} post
 * @returns {Object} flat subset suitable for did-signer canonicalize()
 */
function buildPostSignedSubset(post) {
  return {
    id: post.id,
    author_did: post.author_did,
    content: post.content,
    images: post.images ? JSON.stringify(post.images) : "",
    link_url: post.link_url || "",
    link_title: post.link_title || "",
    link_description: post.link_description || "",
    visibility: post.visibility,
    created_at: post.created_at,
  };
}

/**
 * Canonical immutable subset of a LIKE, signed by the liker (user_did) so a
 * peer cannot forge "X liked this" on X's behalf. Timestamp is deliberately
 * excluded: a like is idempotent (dedup on post_id+user_did), the receiver
 * stamps its own created_at, and omitting it means only pubkey+signature need
 * to be threaded through the P2P notification.
 * @param {{ postId: string, userDid: string }} like
 * @returns {Object} flat subset for did-signer canonicalize()
 */
function buildLikeSignedSubset({ postId, userDid }) {
  return {
    post_id: postId,
    user_did: userDid,
  };
}

/**
 * Canonical immutable subset of a COMMENT, signed by its author (author_did).
 * parent_id is normalized to null (not undefined) so sender and receiver
 * canonicalize identically — canonicalize() serializes null but SKIPS
 * undefined, so the two must not diverge.
 * @param {Object} comment
 * @returns {Object} flat subset for did-signer canonicalize()
 */
function buildCommentSignedSubset(comment) {
  return {
    id: comment.id,
    post_id: comment.post_id,
    author_did: comment.author_did,
    content: comment.content,
    parent_id: comment.parent_id ?? null,
    created_at: comment.created_at,
  };
}

/**
 * 动态可见性
 */
const PostVisibility = {
  PUBLIC: "public", // 公开
  FRIENDS: "friends", // 仅好友可见
  PRIVATE: "private", // 仅自己可见
  TRUSTED: "trusted", // 仅高信任好友可见
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
    logger.info("[PostManager] 初始化动态管理器...");

    try {
      // 初始化数据库表
      await this.initializeTables();

      // 监听 P2P 事件
      this.setupP2PListeners();

      this.initialized = true;
      logger.info("[PostManager] 动态管理器初始化成功");
    } catch (error) {
      logger.error("[PostManager] 初始化失败:", error);
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

    logger.info("[PostManager] 数据库表初始化完成");
  }

  /**
   * 设置 P2P 监听器
   */
  setupP2PListeners() {
    if (!this.p2pManager) {
      return;
    }

    // 监听新动态同步
    this.p2pManager.on("post:received", async ({ post }) => {
      await this.handlePostReceived(post);
    });

    // 监听点赞同步
    this.p2pManager.on(
      "post-like:received",
      async ({ postId, userDid, authorPubkey, signature }) => {
        await this.handleLikeReceived(postId, userDid, authorPubkey, signature);
      },
    );

    // 监听评论同步
    this.p2pManager.on("post-comment:received", async ({ comment }) => {
      await this.handleCommentReceived(comment);
    });

    logger.info("[PostManager] P2P 事件监听器已设置");
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
  async createPost({
    content,
    images = [],
    linkUrl,
    linkTitle,
    linkDescription,
    visibility = PostVisibility.PUBLIC,
  }) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("未登录，无法发布动态");
      }

      if (!content || content.trim().length === 0) {
        throw new Error("动态内容不能为空");
      }

      if (content.length > 1000) {
        throw new Error("动态内容不能超过 1000 字");
      }

      if (images.length > 9) {
        throw new Error("图片数量不能超过 9 张");
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
        now,
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

      logger.info("[PostManager] 已发布动态:", postId);

      // 通过 P2P 同步动态（根据可见性）
      await this.syncPost(post);

      this.emit("post:created", { post });

      return post;
    } catch (error) {
      logger.error("[PostManager] 发布动态失败:", error);
      throw error;
    }
  }

  /**
   * 用当前身份的 Ed25519 DID 私钥对动态签名。
   * 无签名密钥的旧身份返回 {null,null}（收端按 legacy 未签名兼容处理）；
   * 签名抛错时降级为未签名（记 error 日志，动态本身已本地保存）。
   * @param {Object} post - 动态对象
   * @returns {{ author_pubkey: string|null, signature: string|null }}
   * @private
   */
  _signPost(post) {
    return this._signSubset(buildPostSignedSubset(post), "syncPost");
  }

  /**
   * 用当前身份的 Ed25519 DID 私钥对给定 canonical 子集签名（动态/点赞/评论共用）。
   * 无签名密钥的旧身份返回 {null,null}（收端按 legacy 未签名兼容处理）；
   * 签名抛错时降级为未签名（记 error 日志，本地记录已保存）。
   * @param {Object} subset - 已构造的可签名扁平子集
   * @param {string} ctx - 日志上下文标签
   * @returns {{ author_pubkey: string|null, signature: string|null }}
   * @private
   */
  _signSubset(subset, ctx) {
    const identity = this.didManager?.getCurrentIdentity?.();
    if (!(identity && identity.public_key_sign && identity.private_key_ref)) {
      logger.warn(
        `[PostManager] ${ctx}: 身份缺少签名密钥，发送未签名 (legacy compat)`,
      );
      return { author_pubkey: null, signature: null };
    }
    try {
      const signed = signPayloadWithIdentity(subset, identity);
      return {
        author_pubkey: signed.sender_pubkey,
        signature: signed.signature,
      };
    } catch (err) {
      logger.error(`[PostManager] ${ctx}: 签名失败，发送未签名:`, err.message);
      return { author_pubkey: null, signature: null };
    }
  }

  /**
   * 接收路径通用真实性门（对齐 handlePostReceived 三模式，B4a）：
   *   pubkey+signature 都在 → 严格验签（pubkey 必 hash 成 signerDid 且验签通过），失败即拒；
   *   两者都缺 → legacy 未签名，接受 + 警告（迁移窗口）；
   *   只有其一 → 信封损坏，拒绝。
   * @param {Object} subset - 收端用同一 builder 重建的 canonical 子集
   * @param {string} signerDid - 声称的签名者 DID（点赞=user_did / 评论=author_did）
   * @param {string|null} pubkey - author_pubkey
   * @param {string|null} signature
   * @param {string} label - 日志用（如 "点赞"/"评论"）
   * @returns {{ ok: boolean, legacy?: boolean, reason?: string }}
   * @private
   */
  _verifyInbound(subset, signerDid, pubkey, signature, label) {
    const hasPubkey = !!pubkey;
    const hasSig = !!signature;
    if (hasPubkey !== hasSig) {
      return {
        ok: false,
        reason: `${label}签名信封不完整 (pubkey/signature 缺一)`,
      };
    }
    if (!hasPubkey && !hasSig) {
      return { ok: true, legacy: true };
    }
    const verdict = verifyPayloadAgainstDid(
      subset,
      signerDid,
      pubkey,
      signature,
    );
    if (!verdict.ok) {
      return { ok: false, reason: verdict.reason };
    }
    return { ok: true };
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
        targetDids = friends ? friends.map((f) => f.friend_did) : [];
      } else if (post.visibility === PostVisibility.PUBLIC) {
        // 公开动态：同步给所有连接的节点
        const connectedPeers = this.p2pManager.getConnectedPeers();
        targetDids = connectedPeers.map((peer) => peer.id);
      }

      // 用作者 DID 私钥对动态签名，收端可验真、防冒名。签一次，广播给所有目标。
      const outgoing = { ...post, ...this._signPost(post) };

      // 发送动态到目标节点
      for (const targetDid of targetDids) {
        try {
          await this.p2pManager.sendEncryptedMessage(
            targetDid,
            JSON.stringify({
              type: "post-sync",
              post: outgoing,
            }),
          );
        } catch (error) {
          logger.warn("[PostManager] 同步动态失败:", targetDid, error.message);
        }
      }

      logger.info("[PostManager] 动态已同步到", targetDids.length, "个节点");
    } catch (error) {
      logger.error("[PostManager] 同步动态失败:", error);
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
      const existing = db
        .prepare("SELECT id FROM posts WHERE id = ?")
        .get(post.id);

      if (existing) {
        logger.info("[PostManager] 动态已存在，忽略:", post.id);
        return;
      }

      // 真实性门：验证动态确由其声称的 author_did 签名，防冒名/伪造。
      // 三种模式（对齐 channel-manager B4a）：
      //   pubkey+signature 都在 → 严格验签，失败即丢弃
      //   两者都缺 → legacy 未签名，接受 + 警告（迁移窗口，收端先于发端升级时）
      //   只有其一 → 信封损坏，拒绝
      const hasPubkey = !!post.author_pubkey;
      const hasSig = !!post.signature;
      if (hasPubkey !== hasSig) {
        logger.warn(
          `[PostManager] 拒绝动态 ${post.id}: 签名信封不完整 (pubkey/signature 缺一)`,
        );
        return;
      }
      if (hasPubkey && hasSig) {
        const subset = buildPostSignedSubset(post);
        const verdict = verifyPayloadAgainstDid(
          subset,
          post.author_did,
          post.author_pubkey,
          post.signature,
        );
        if (!verdict.ok) {
          logger.warn(
            `[PostManager] 拒绝动态 ${post.id} (来自 ${post.author_did}): ${verdict.reason}`,
          );
          this.emit("post:rejected", {
            postId: post.id,
            author_did: post.author_did,
            reason: verdict.reason,
          });
          return;
        }
      } else {
        logger.warn(
          `[PostManager] 接受未签名动态 ${post.id} (来自 ${post.author_did}) (legacy compat)`,
        );
      }

      // 验证作者是否是好友（如果可见性是 friends）
      if (post.visibility === PostVisibility.FRIENDS) {
        const isFriend = await this.friendManager?.isFriend(post.author_did);
        if (!isFriend) {
          logger.info("[PostManager] 非好友动态，忽略:", post.id);
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
        post.updated_at,
      );

      logger.info("[PostManager] 已接收动态:", post.id);

      this.emit("post:received", { post });
    } catch (error) {
      logger.error("[PostManager] 处理收到的动态失败:", error);
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
          OR (visibility = 'trusted' AND author_did IN (
            SELECT friend_did FROM friendships WHERE user_did = ? AND status = 'accepted' AND trust_score >= 0.7
          ))
        )
      `;

      const params = [currentDid, currentDid, currentDid];

      if (authorDid) {
        query += " AND author_did = ?";
        params.push(authorDid);
      }

      query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const posts = db.prepare(query).all(...params);

      // 解析图片 JSON
      return posts.map((post) => ({
        ...post,
        images: safeParse(post.images, []),
        // 添加当前用户是否点赞的标记
        liked: this.hasLiked(post.id, currentDid),
      }));
    } catch (error) {
      logger.error("[PostManager] 获取动态流失败:", error);
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
      const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId);

      if (!post) {
        return null;
      }

      return {
        ...post,
        images: safeParse(post.images, []),
      };
    } catch (error) {
      logger.error("[PostManager] 获取动态失败:", error);
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
        throw new Error("未登录");
      }

      const db = this.database.db;

      // 检查是否是作者
      const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId);

      if (!post) {
        throw new Error("动态不存在");
      }

      if (post.author_did !== currentDid) {
        throw new Error("无权删除此动态");
      }

      // 删除动态
      db.prepare("DELETE FROM posts WHERE id = ?").run(postId);

      // 删除相关的点赞和评论
      db.prepare("DELETE FROM post_likes WHERE post_id = ?").run(postId);
      db.prepare("DELETE FROM post_comments WHERE post_id = ?").run(postId);

      logger.info("[PostManager] 已删除动态:", postId);

      this.emit("post:deleted", { postId });

      return { success: true };
    } catch (error) {
      logger.error("[PostManager] 删除动态失败:", error);
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
        throw new Error("未登录");
      }

      const db = this.database.db;

      // 检查是否已点赞
      const existing = db
        .prepare("SELECT * FROM post_likes WHERE post_id = ? AND user_did = ?")
        .get(postId, currentDid);

      if (existing) {
        throw new Error("已经点过赞了");
      }

      const now = Date.now();

      // 添加点赞记录
      db.prepare(
        "INSERT INTO post_likes (post_id, user_did, created_at) VALUES (?, ?, ?)",
      ).run(postId, currentDid, now);

      // 更新点赞计数
      db.prepare(
        "UPDATE posts SET like_count = like_count + 1 WHERE id = ?",
      ).run(postId);

      logger.info("[PostManager] 已点赞:", postId);

      // 通知作者。用点赞者 DID 私钥签 {post_id,user_did}，收端验真、防冒名点赞。
      const post = await this.getPost(postId);
      if (post && post.author_did !== currentDid && this.p2pManager) {
        try {
          const { author_pubkey, signature } = this._signSubset(
            buildLikeSignedSubset({ postId, userDid: currentDid }),
            "likePost",
          );
          await this.p2pManager.sendEncryptedMessage(
            post.author_did,
            JSON.stringify({
              type: "post-like",
              postId,
              userDid: currentDid,
              timestamp: now,
              authorPubkey: author_pubkey,
              signature,
            }),
          );
        } catch (error) {
          logger.warn("[PostManager] 通知点赞失败:", error.message);
        }
      }

      this.emit("post:liked", { postId, userDid: currentDid });

      return { success: true };
    } catch (error) {
      logger.error("[PostManager] 点赞失败:", error);
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
        throw new Error("未登录");
      }

      const db = this.database.db;

      // 删除点赞记录
      const result = db
        .prepare("DELETE FROM post_likes WHERE post_id = ? AND user_did = ?")
        .run(postId, currentDid);

      if (result.changes === 0) {
        throw new Error("还未点赞");
      }

      // 更新点赞计数
      db.prepare(
        "UPDATE posts SET like_count = like_count - 1 WHERE id = ?",
      ).run(postId);

      logger.info("[PostManager] 已取消点赞:", postId);

      this.emit("post:unliked", { postId, userDid: currentDid });

      return { success: true };
    } catch (error) {
      logger.error("[PostManager] 取消点赞失败:", error);
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
      const like = db
        .prepare("SELECT 1 FROM post_likes WHERE post_id = ? AND user_did = ?")
        .get(postId, userDid);
      return !!like;
    } catch (error) {
      logger.error("[PostManager] 检查点赞状态失败:", error);
      return false;
    }
  }

  /**
   * 处理收到的点赞
   * @param {string} postId - 动态 ID
   * @param {string} userDid - 用户 DID
   */
  async handleLikeReceived(postId, userDid, authorPubkey, signature) {
    try {
      const db = this.database.db;

      // 真实性门：验证点赞确由 userDid 签名，防冒名点赞刷量。
      const verdict = this._verifyInbound(
        buildLikeSignedSubset({ postId, userDid }),
        userDid,
        authorPubkey,
        signature,
        "点赞",
      );
      if (!verdict.ok) {
        logger.warn(
          `[PostManager] 拒绝点赞 ${postId} (来自 ${userDid}): ${verdict.reason}`,
        );
        this.emit("post-like:rejected", {
          postId,
          userDid,
          reason: verdict.reason,
        });
        return;
      }
      if (verdict.legacy) {
        logger.warn(
          `[PostManager] 接受未签名点赞 ${postId} (来自 ${userDid}) (legacy compat)`,
        );
      }

      // 检查动态是否存在
      const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId);

      if (!post) {
        logger.info("[PostManager] 动态不存在，忽略点赞:", postId);
        return;
      }

      // 检查是否已点赞
      const existing = db
        .prepare("SELECT * FROM post_likes WHERE post_id = ? AND user_did = ?")
        .get(postId, userDid);

      if (existing) {
        return;
      }

      const now = Date.now();

      // 添加点赞记录
      db.prepare(
        "INSERT INTO post_likes (post_id, user_did, created_at) VALUES (?, ?, ?)",
      ).run(postId, userDid, now);

      // 更新点赞计数
      db.prepare(
        "UPDATE posts SET like_count = like_count + 1 WHERE id = ?",
      ).run(postId);

      logger.info("[PostManager] 已接收点赞:", postId, userDid);

      this.emit("post:liked", { postId, userDid });
    } catch (error) {
      logger.error("[PostManager] 处理点赞失败:", error);
    }
  }

  /**
   * 获取点赞列表
   * @param {string} postId - 动态 ID
   */
  async getLikes(postId) {
    try {
      const db = this.database.db;
      return db
        .prepare(
          "SELECT * FROM post_likes WHERE post_id = ? ORDER BY created_at DESC",
        )
        .all(postId);
    } catch (error) {
      logger.error("[PostManager] 获取点赞列表失败:", error);
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
        throw new Error("未登录");
      }

      if (!content || content.trim().length === 0) {
        throw new Error("评论内容不能为空");
      }

      if (content.length > 500) {
        throw new Error("评论内容不能超过 500 字");
      }

      const commentId = uuidv4();
      const now = Date.now();

      const db = this.database.db;

      // 添加评论
      db.prepare(
        `
        INSERT INTO post_comments (id, post_id, author_did, content, parent_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(commentId, postId, currentDid, content.trim(), parentId, now);

      // 更新评论计数
      db.prepare(
        "UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?",
      ).run(postId);

      const comment = {
        id: commentId,
        post_id: postId,
        author_did: currentDid,
        content: content.trim(),
        parent_id: parentId,
        created_at: now,
      };

      logger.info("[PostManager] 已添加评论:", commentId);

      // 通知作者。用评论者 DID 私钥签评论不可变子集，签名随 comment 对象透传给收端。
      const post = await this.getPost(postId);
      if (post && post.author_did !== currentDid && this.p2pManager) {
        try {
          const { author_pubkey, signature } = this._signSubset(
            buildCommentSignedSubset(comment),
            "addComment",
          );
          await this.p2pManager.sendEncryptedMessage(
            post.author_did,
            JSON.stringify({
              type: "post-comment",
              comment: { ...comment, author_pubkey, signature },
            }),
          );
        } catch (error) {
          logger.warn("[PostManager] 通知评论失败:", error.message);
        }
      }

      this.emit("comment:added", { comment });

      return comment;
    } catch (error) {
      logger.error("[PostManager] 添加评论失败:", error);
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

      // 真实性门：验证评论确由 comment.author_did 签名，防冒名评论/注入。
      const verdict = this._verifyInbound(
        buildCommentSignedSubset(comment),
        comment.author_did,
        comment.author_pubkey,
        comment.signature,
        "评论",
      );
      if (!verdict.ok) {
        logger.warn(
          `[PostManager] 拒绝评论 ${comment.id} (来自 ${comment.author_did}): ${verdict.reason}`,
        );
        this.emit("comment:rejected", {
          commentId: comment.id,
          author_did: comment.author_did,
          reason: verdict.reason,
        });
        return;
      }
      if (verdict.legacy) {
        logger.warn(
          `[PostManager] 接受未签名评论 ${comment.id} (来自 ${comment.author_did}) (legacy compat)`,
        );
      }

      // 检查是否已存在
      const existing = db
        .prepare("SELECT id FROM post_comments WHERE id = ?")
        .get(comment.id);

      if (existing) {
        return;
      }

      // 添加评论
      db.prepare(
        `
        INSERT OR IGNORE INTO post_comments (id, post_id, author_did, content, parent_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(
        comment.id,
        comment.post_id,
        comment.author_did,
        comment.content,
        comment.parent_id,
        comment.created_at,
      );

      // 更新评论计数
      db.prepare(
        "UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?",
      ).run(comment.post_id);

      logger.info("[PostManager] 已接收评论:", comment.id);

      this.emit("comment:received", { comment });
    } catch (error) {
      logger.error("[PostManager] 处理评论失败:", error);
    }
  }

  /**
   * 获取评论列表
   * @param {string} postId - 动态 ID
   */
  async getComments(postId) {
    try {
      const db = this.database.db;
      return db
        .prepare(
          "SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC",
        )
        .all(postId);
    } catch (error) {
      logger.error("[PostManager] 获取评论列表失败:", error);
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
        throw new Error("未登录");
      }

      const db = this.database.db;

      // 检查是否是作者
      const comment = db
        .prepare("SELECT * FROM post_comments WHERE id = ?")
        .get(commentId);

      if (!comment) {
        throw new Error("评论不存在");
      }

      if (comment.author_did !== currentDid) {
        throw new Error("无权删除此评论");
      }

      // 删除评论及其所有回复
      db.prepare("DELETE FROM post_comments WHERE id = ? OR parent_id = ?").run(
        commentId,
        commentId,
      );

      // 更新评论计数（需要重新计算）
      const count = db
        .prepare(
          "SELECT COUNT(*) as count FROM post_comments WHERE post_id = ?",
        )
        .get(comment.post_id);
      db.prepare("UPDATE posts SET comment_count = ? WHERE id = ?").run(
        count.count,
        comment.post_id,
      );

      logger.info("[PostManager] 已删除评论:", commentId);

      this.emit("comment:deleted", { commentId, postId: comment.post_id });

      return { success: true };
    } catch (error) {
      logger.error("[PostManager] 删除评论失败:", error);
      throw error;
    }
  }

  /**
   * 关闭动态管理器
   */
  async close() {
    logger.info("[PostManager] 关闭动态管理器");

    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  PostManager,
  PostVisibility,
};
