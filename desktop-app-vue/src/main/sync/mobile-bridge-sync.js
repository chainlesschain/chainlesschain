/**
 * Mobile Bridge Sync — Phase 3d desktop ↔ Android 同步桥（Phase 3d v1）
 *
 * 复用 MobileBridge WebRTC DataChannel transport（src/main/p2p/mobile-bridge.js）+
 * 现有 JSON-RPC envelope（chainlesschain:command:request/response）。新增 3 method：
 * sync.push / sync.pull / sync.ack。详见 docs/design/Phase3d_Mobile_Sync_设计文档.md。
 *
 * 表结构：cursor + tombstone 复用 Phase 3c 的 sync_external_* 表（provider_id='mobile'，
 * account_key=<mobileDeviceId>）。Walker 针对 5 张社交子系统表做 incremental 扫描：
 * p2p_chat_messages / contacts / friends / social_posts / post_comments / notifications。
 *
 * 冲突：last-write-wins by (version DESC, timestamp DESC, deviceId DESC tie-break)，
 * 严格对齐 Android `core-p2p/sync/ConflictResolver.kt` 的算法。
 *
 * 取舍：
 *   - 不维护自己的 EventEmitter；通过 logger + 已落 syncScheduler 集成
 *   - INSERT/UPDATE 走 walker（每 tick 拿 cursor 之后的新行），不需要 recordChange 钩子
 *   - DELETE 走 trigger 写 tombstone，与 Phase 3c knowledge_items 同模式
 *   - syncProvider.runOnce(deviceId) = pushPending + pullRemote 一轮
 */

const externalStore = require("./sync-external-store");
const { logger } = require("../utils/logger.js");
const crypto = require("crypto");

const PROVIDER_ID = "mobile";

const ResourceType = Object.freeze({
  MESSAGE: "MESSAGE",
  CONTACT: "CONTACT",
  FRIEND: "FRIEND",
  POST: "POST",
  POST_COMMENT: "POST_COMMENT",
  NOTIFICATION: "NOTIFICATION",
});

const SyncOperation = Object.freeze({
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
});

const DEFAULT_BATCH_SIZE = 100;

/**
 * 解析 social_posts.media TEXT 列（JSON 数组）；非法或空时返空数组。
 */
function _safeParseJsonArray(text) {
  if (!text || typeof text !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 测试可注入的依赖。生产环境下走默认 require。
 */
const _deps = {
  getExternalStore: () => externalStore,
  getLogger: () => logger,
  now: () => Date.now(),
};

class MobileBridgeSync {
  constructor({
    mobileBridge,
    dbManager,
    deviceManager,
    didManager,
    deps = _deps,
  } = {}) {
    if (!mobileBridge) {
      throw new Error("MobileBridgeSync 需要 mobileBridge");
    }
    if (!dbManager) {
      throw new Error("MobileBridgeSync 需要 dbManager");
    }
    // didManager 可选：v1.2 #1 给出向 sync.* 加 AuthInfo 用；不传时 _buildAuth
    // 仍能 produce placeholder did，Android side warn-and-skip 路径仍工作。
    this.didManager = didManager || null;

    this.mobileBridge = mobileBridge;
    this.dbManager = dbManager;
    this.deviceManager = deviceManager;
    this.deps = deps;
    this.logger = deps.getLogger();

    // pendingAcks: requestId -> { resolve, reject, timer }
    this.pendingAcks = new Map();

    // 关闭防止 leak
    this._closed = false;
  }

  /**
   * 注册到 desktop 端的 routeMobileCommand 路由表。调用方在 index.js
   * handleMobileCommand 里做 dispatch。
   */
  registerRoutes(commandRouter) {
    if (!commandRouter || typeof commandRouter.register !== "function") {
      throw new Error("registerRoutes 需要 commandRouter.register");
    }
    commandRouter.register("sync.push", (params, ctx) =>
      this.handlePush(params, ctx),
    );
    commandRouter.register("sync.pull", (params, ctx) =>
      this.handlePull(params, ctx),
    );
    commandRouter.register("sync.ack", (params, ctx) =>
      this.handleAck(params, ctx),
    );
  }

  // ============================================================
  // syncProvider 入口（IPC sync:mobile:run 调用）
  // ============================================================

  /**
   * 一轮 sync = pushPending + pullRemote。返回汇总统计。
   */
  async runOnce(deviceId) {
    if (!deviceId) {
      throw new Error("runOnce 需要 deviceId");
    }
    const startedAt = this.deps.now();
    const externalStoreApi = this.deps.getExternalStore();

    externalStoreApi.ensureCursor(this.dbManager, PROVIDER_ID, deviceId);

    let pushed = 0;
    let pulled = 0;
    let conflicts = 0;
    let lastError = null;

    try {
      const pushRes = await this.pushPending(deviceId);
      pushed = pushRes.pushed;
      conflicts += pushRes.conflicts;

      const pullRes = await this.pullRemote(deviceId);
      pulled = pullRes.pulled;
      conflicts += pullRes.conflicts;
    } catch (err) {
      lastError = err.message || String(err);
      this.logger.error("[MobileBridgeSync] runOnce 失败:", err);
    }

    const durationMs = this.deps.now() - startedAt;

    // updateCursor 签名: (dbManager, providerId, fields, accountKey)
    // itemsPushed / itemsSkipped 走累加路径（updateCursor 内 += 处理）
    externalStoreApi.updateCursor(
      this.dbManager,
      PROVIDER_ID,
      {
        lastRunStatus: lastError
          ? "failed"
          : conflicts > 0
            ? "conflict"
            : "success",
        lastRunError: lastError,
        lastRunDurationMs: durationMs,
        itemsPushed: pushed,
        itemsSkipped: conflicts,
      },
      deviceId,
    );

    return { pushed, pulled, conflicts, durationMs, error: lastError };
  }

  // ============================================================
  // 出向：本地 → 对端
  // ============================================================

  /**
   * 扫 5 张表 + tombstone，把 cursor 之后的变更发给对端。
   */
  async pushPending(deviceId) {
    const externalStoreApi = this.deps.getExternalStore();
    const cursor = externalStoreApi.getCursor(
      this.dbManager,
      PROVIDER_ID,
      deviceId,
    );
    const sinceMs = cursor?.lastSyncAt ?? 0;
    const sinceId = cursor?.lastItemId || null;

    let pushed = 0;
    let conflicts = 0;

    // tombstones 先：远端先知道哪些 id 已删除，避免后续 INSERT 重新建。
    // resourceTypes 过滤让 mobile provider 只看自己关心的 ResourceType
    // （knowledge_items 的 KNOWLEDGE_ITEM tombstone 留给 webdav/oss 处理）。
    // 注：listTombstones 返回 raw SQLite 列（snake_case），形状与 getCursor
    // 不一致是历史遗留，详见 sync-external-store.js listTombstones 注释。
    const tombstones = externalStoreApi.listTombstones(
      this.dbManager,
      PROVIDER_ID,
      deviceId,
      200,
      Object.values(ResourceType).filter((t) => t !== ResourceType.CONTACT),
    );
    for (const ts of tombstones) {
      const item = {
        resourceType:
          ts.resource_type || this._inferResourceTypeFromTombstone(ts),
        resourceId: ts.item_id,
        operation: SyncOperation.DELETE,
        version: 1,
        timestamp: ts.deleted_at,
        data: "{}",
      };
      const res = await this._sendItem(deviceId, item);
      if (res?.status === "applied") {
        externalStoreApi.deleteTombstone(this.dbManager, ts.id);
        pushed++;
      } else if (res?.status === "conflict") {
        conflicts++;
      } else {
        externalStoreApi.markTombstoneFailed(this.dbManager, ts.id, res?.error);
      }
    }

    // 5 张表的 walker。每条 item push 成功后推进 cursor (lastSyncAt, lastItemId)
    // 让下一轮 fetchBatch 不重复扫已 push 行；走 (timestamp, id) lex 序对应
    // 各 walker 的 ORDER BY 子句。
    for (const fetcher of this._tableFetchers()) {
      const batch = await fetcher(
        this.dbManager,
        sinceMs,
        sinceId,
        DEFAULT_BATCH_SIZE,
      );
      for (const item of batch) {
        const res = await this._sendItem(deviceId, item);
        if (res?.status === "applied") {
          pushed++;
          externalStoreApi.updateCursor(
            this.dbManager,
            PROVIDER_ID,
            { lastSyncAt: item.timestamp, lastItemId: item.resourceId },
            deviceId,
          );
        } else if (res?.status === "conflict") {
          conflicts++;
          this.logger.warn(
            `[MobileBridgeSync] push 冲突 ${item.resourceType}/${item.resourceId}：远端版本胜`,
          );
        }
      }
    }

    return { pushed, conflicts };
  }

  /**
   * 向对端发起 sync.pull，对端把 cursor 之后的变更回来。
   */
  async pullRemote(deviceId) {
    const externalStoreApi = this.deps.getExternalStore();
    const cursor = externalStoreApi.getCursor(
      this.dbManager,
      PROVIDER_ID,
      deviceId,
    );
    const pullRequest = {
      cursor: { ts: cursor?.lastSyncAt ?? 0, id: cursor?.lastItemId || null },
      resourceTypes: Object.values(ResourceType),
      limit: DEFAULT_BATCH_SIZE,
    };

    const response = await this._invokeRemote(
      deviceId,
      "sync.pull",
      pullRequest,
    );
    if (!response || !Array.isArray(response.items)) {
      return { pulled: 0, conflicts: 0 };
    }

    let pulled = 0;
    let conflicts = 0;
    for (const item of response.items) {
      const applyRes = await this._applyItemLocal(item, deviceId);
      if (applyRes.status === "applied") {
        pulled++;
      } else if (applyRes.status === "conflict") {
        conflicts++;
      }
    }
    return { pulled, conflicts };
  }

  // ============================================================
  // 入向：对端 → 本地（routeMobileCommand 路由进来）
  // ============================================================

  /**
   * 处理对端 sync.push：拿到 SyncItem，跑冲突 → 应用 → 回 ack 状态。
   */
  async handlePush(params, ctx = {}) {
    const item = params?.item;
    const deviceId = params?.deviceId || ctx.peerId;
    if (!item || !item.resourceType || !item.resourceId) {
      return { status: "failed", error: "invalid SyncItem" };
    }
    return await this._applyItemLocal(item, deviceId);
  }

  /**
   * 处理对端 sync.pull：从 5 张表拿 cursor 之后的变更回送。
   */
  async handlePull(params /* , ctx */) {
    const cursor = params?.cursor || { ts: 0, id: null };
    const requestedTypes = Array.isArray(params?.resourceTypes)
      ? new Set(params.resourceTypes)
      : new Set(Object.values(ResourceType));
    const limit = Math.min(Number(params?.limit) || DEFAULT_BATCH_SIZE, 500);

    const items = [];
    for (const fetcher of this._tableFetchers()) {
      if (items.length >= limit) {
        break;
      }
      const batch = await fetcher(
        this.dbManager,
        cursor.ts,
        cursor.id,
        limit - items.length,
      );
      for (const it of batch) {
        if (requestedTypes.has(it.resourceType)) {
          items.push(it);
        }
        if (items.length >= limit) {
          break;
        }
      }
    }

    const lastItem = items[items.length - 1];
    const nextCursor = lastItem
      ? { ts: lastItem.timestamp, id: lastItem.resourceId }
      : cursor;
    return { items, nextCursor, hasMore: items.length >= limit };
  }

  /**
   * 处理对端 sync.ack：fire-and-forget，主要用于 telemetry。
   */
  handleAck(params /* , ctx */) {
    const requestId = params?.requestId;
    if (requestId && this.pendingAcks.has(requestId)) {
      const { resolve, timer } = this.pendingAcks.get(requestId);
      clearTimeout(timer);
      this.pendingAcks.delete(requestId);
      resolve(params);
    }
    return {};
  }

  // ============================================================
  // 冲突解决（与 Android ConflictResolver.kt 严格对齐）
  // ============================================================

  /**
   * Last-Write-Wins by (version DESC, timestamp DESC, deviceId DESC tie-break)。
   * 对齐 Android `ConflictResolver.kt` 的默认 LATEST_WINS 策略。
   *
   * 返回 'remote' = 用 remoteItem 覆盖 local；'local' = 保留 local，让对端反向 apply。
   */
  resolveConflict(localItem, remoteItem) {
    if (!localItem) {
      return "remote";
    }
    if (!remoteItem) {
      return "local";
    }

    const lv = Number(localItem.version) || 0;
    const rv = Number(remoteItem.version) || 0;
    if (rv > lv) {
      return "remote";
    }
    if (lv > rv) {
      return "local";
    }

    const lt = Number(localItem.timestamp) || 0;
    const rt = Number(remoteItem.timestamp) || 0;
    if (rt > lt) {
      return "remote";
    }
    if (lt > rt) {
      return "local";
    }

    // tie-break：deviceId 字典序大者胜，保证两端独立判决一致
    const ld = String(localItem.deviceId || "");
    const rd = String(remoteItem.deviceId || "");
    return rd > ld ? "remote" : "local";
  }

  // ============================================================
  // Walker（5 张表的 cursor 增量扫描）
  // ============================================================

  /**
   * 当前实现的 walker 列表。每个 fetcher: (dbManager, sinceMs, sinceId, limit) → Promise<SyncItem[]>
   */
  _tableFetchers() {
    return [
      this._fetchP2PChatMessages.bind(this),
      this._fetchFriends.bind(this),
      this._fetchSocialPosts.bind(this),
      this._fetchPostComments.bind(this),
      this._fetchNotifications.bind(this),
      // CONTACT 暂不走：Android DefaultSyncDataApplier.kt 把 CONTACT 与 FRIEND
      // 都路由到 FriendRepository（同一份数据）；桌面 contacts 表是更广的通讯录
      // 概念，无对等映射。v2 按需补。
      // this._fetchContacts.bind(this),
    ];
  }

  /**
   * p2p_chat_messages walker — exemplar，其他 4 张表照此模式。
   * 游标语义：(timestamp, id) lex order（避免依赖 SQLite row-value 比较）。
   */
  async _fetchP2PChatMessages(dbManager, sinceMs, sinceId, limit) {
    const sql = sinceId
      ? `SELECT id, session_id, sender_did, receiver_did, content, message_type,
                file_path, file_size, encrypted, status, device_id, timestamp,
                forwarded_from_id, forward_count
         FROM p2p_chat_messages
         WHERE timestamp > ? OR (timestamp = ? AND id > ?)
         ORDER BY timestamp ASC, id ASC
         LIMIT ?`
      : `SELECT id, session_id, sender_did, receiver_did, content, message_type,
                file_path, file_size, encrypted, status, device_id, timestamp,
                forwarded_from_id, forward_count
         FROM p2p_chat_messages
         WHERE timestamp > ?
         ORDER BY timestamp ASC, id ASC
         LIMIT ?`;

    const params = sinceId
      ? [sinceMs, sinceMs, sinceId, limit]
      : [sinceMs, limit];
    const rows = dbManager.all(sql, params);

    return rows.map((row) => ({
      resourceType: ResourceType.MESSAGE,
      resourceId: row.id,
      operation: SyncOperation.CREATE,
      version: 1,
      timestamp: row.timestamp,
      deviceId: row.device_id || "",
      data: JSON.stringify({
        sessionId: row.session_id,
        senderDid: row.sender_did,
        receiverDid: row.receiver_did,
        content: row.content,
        messageType: row.message_type,
        filePath: row.file_path,
        fileSize: row.file_size,
        encrypted: row.encrypted === 1,
        status: row.status,
        forwardedFromId: row.forwarded_from_id,
        forwardCount: row.forward_count,
      }),
    }));
  }

  /**
   * friends walker。resourceId = friend_did（对齐 Android SocialSyncAdapter
   * `resourceId = friend.did`）。游标 (updated_at, friend_did)。
   */
  async _fetchFriends(dbManager, sinceMs, sinceId, limit) {
    const sql = sinceId
      ? `SELECT user_did, friend_did, nickname, avatar, status, notes,
                created_at, updated_at
         FROM friends
         WHERE updated_at > ? OR (updated_at = ? AND friend_did > ?)
         ORDER BY updated_at ASC, friend_did ASC
         LIMIT ?`
      : `SELECT user_did, friend_did, nickname, avatar, status, notes,
                created_at, updated_at
         FROM friends
         WHERE updated_at > ?
         ORDER BY updated_at ASC, friend_did ASC
         LIMIT ?`;
    const params = sinceId
      ? [sinceMs, sinceMs, sinceId, limit]
      : [sinceMs, limit];
    const rows = dbManager.all(sql, params);
    return rows.map((row) => ({
      resourceType: ResourceType.FRIEND,
      resourceId: row.friend_did,
      operation: SyncOperation.UPDATE,
      version: 1,
      timestamp: row.updated_at,
      deviceId: "",
      data: JSON.stringify({
        did: row.friend_did,
        nickname: row.nickname,
        avatar: row.avatar,
        status: row.status,
        remarkName: row.notes,
        addedAt: row.created_at,
      }),
    }));
  }

  /**
   * social_posts walker。游标 (updated_at, id)。
   */
  async _fetchSocialPosts(dbManager, sinceMs, sinceId, limit) {
    const sql = sinceId
      ? `SELECT id, author_did, content, media, visibility, created_at, updated_at
         FROM social_posts
         WHERE updated_at > ? OR (updated_at = ? AND id > ?)
         ORDER BY updated_at ASC, id ASC
         LIMIT ?`
      : `SELECT id, author_did, content, media, visibility, created_at, updated_at
         FROM social_posts
         WHERE updated_at > ?
         ORDER BY updated_at ASC, id ASC
         LIMIT ?`;
    const params = sinceId
      ? [sinceMs, sinceMs, sinceId, limit]
      : [sinceMs, limit];
    const rows = dbManager.all(sql, params);
    return rows.map((row) => ({
      resourceType: ResourceType.POST,
      resourceId: row.id,
      operation: SyncOperation.UPDATE,
      version: 1,
      timestamp: row.updated_at,
      deviceId: "",
      data: JSON.stringify({
        id: row.id,
        authorDid: row.author_did,
        content: row.content,
        images: _safeParseJsonArray(row.media),
        visibility: row.visibility,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    }));
  }

  /**
   * post_comments walker。schema 无 updated_at，用 created_at 作 cursor
   * （评论是 append-only，UPDATE 极少见，本表实际是 CREATE 序列）。
   */
  async _fetchPostComments(dbManager, sinceMs, sinceId, limit) {
    const sql = sinceId
      ? `SELECT id, post_id, author_did, content, parent_id, created_at
         FROM post_comments
         WHERE created_at > ? OR (created_at = ? AND id > ?)
         ORDER BY created_at ASC, id ASC
         LIMIT ?`
      : `SELECT id, post_id, author_did, content, parent_id, created_at
         FROM post_comments
         WHERE created_at > ?
         ORDER BY created_at ASC, id ASC
         LIMIT ?`;
    const params = sinceId
      ? [sinceMs, sinceMs, sinceId, limit]
      : [sinceMs, limit];
    const rows = dbManager.all(sql, params);
    return rows.map((row) => ({
      resourceType: ResourceType.POST_COMMENT,
      resourceId: row.id,
      operation: SyncOperation.CREATE,
      version: 1,
      timestamp: row.created_at,
      deviceId: "",
      data: JSON.stringify({
        id: row.id,
        postId: row.post_id,
        authorDid: row.author_did,
        content: row.content,
        parentCommentId: row.parent_id,
        createdAt: row.created_at,
      }),
    }));
  }

  /**
   * notifications walker。schema 无 updated_at，用 created_at 作 cursor。
   */
  async _fetchNotifications(dbManager, sinceMs, sinceId, limit) {
    const sql = sinceId
      ? `SELECT id, user_did, type, title, content, data, is_read, created_at
         FROM notifications
         WHERE created_at > ? OR (created_at = ? AND id > ?)
         ORDER BY created_at ASC, id ASC
         LIMIT ?`
      : `SELECT id, user_did, type, title, content, data, is_read, created_at
         FROM notifications
         WHERE created_at > ?
         ORDER BY created_at ASC, id ASC
         LIMIT ?`;
    const params = sinceId
      ? [sinceMs, sinceMs, sinceId, limit]
      : [sinceMs, limit];
    const rows = dbManager.all(sql, params);
    return rows.map((row) => ({
      resourceType: ResourceType.NOTIFICATION,
      resourceId: row.id,
      operation: SyncOperation.CREATE,
      version: 1,
      timestamp: row.created_at,
      deviceId: "",
      data: JSON.stringify({
        id: row.id,
        type: row.type,
        title: row.title,
        content: row.content,
        data: row.data,
        isRead: row.is_read === 1,
        createdAt: row.created_at,
      }),
    }));
  }

  // ============================================================
  // Apply（入向 SyncItem 写入本地表）
  // ============================================================

  async _applyItemLocal(item, deviceId) {
    try {
      const local = await this._readLocalItem(
        item.resourceType,
        item.resourceId,
      );
      const decision = this.resolveConflict(local, item);

      if (decision === "local") {
        return { status: "conflict", resolved: local };
      }

      switch (item.resourceType) {
        case ResourceType.MESSAGE:
          await this._applyMessage(item);
          break;
        case ResourceType.FRIEND:
          await this._applyFriend(item);
          break;
        case ResourceType.POST:
          await this._applyPost(item);
          break;
        case ResourceType.POST_COMMENT:
          await this._applyPostComment(item);
          break;
        case ResourceType.NOTIFICATION:
          await this._applyNotification(item);
          break;
        default:
          // CONTACT 和未来类型走这里。CONTACT v1 不接，详见 _tableFetchers 注释。
          this.logger.warn(
            `[MobileBridgeSync] apply 跳过未实现 ResourceType: ${item.resourceType}`,
          );
          return {
            status: "failed",
            error: `unimplemented ${item.resourceType}`,
          };
      }
      return { status: "applied" };
    } catch (err) {
      this.logger.error("[MobileBridgeSync] apply 失败:", err);
      return { status: "failed", error: err.message || String(err) };
    }
  }

  /**
   * FRIEND apply。字段对齐 friends 表（schema 行 721）：UNIQUE(user_did, friend_did)，
   * 单本地用户假设下，user_did 来自 deviceManager。Android `FriendStatus` enum
   * 是大写（`PENDING/ACCEPTED/BLOCKED`），desktop schema 是小写 CHECK，需 normalize。
   */
  async _applyFriend(item) {
    const data = JSON.parse(item.data || "{}");
    const userDid = this._getLocalUserDid();
    if (item.operation === SyncOperation.DELETE) {
      this.dbManager.run(
        `DELETE FROM friends WHERE friend_did = ? AND user_did = ?`,
        [item.resourceId, userDid],
      );
      return;
    }
    // ON CONFLICT(user_did, friend_did) 是 SQLite 3.24+ UPSERT 语法
    this.dbManager.run(
      `INSERT INTO friends
       (id, user_did, friend_did, nickname, avatar, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_did, friend_did) DO UPDATE SET
         nickname = excluded.nickname,
         avatar = excluded.avatar,
         status = excluded.status,
         notes = excluded.notes,
         updated_at = excluded.updated_at`,
      [
        item.resourceId,
        userDid,
        item.resourceId,
        data.nickname || null,
        data.avatar || null,
        this._normalizeFriendStatus(data.status),
        data.remarkName || null,
        data.addedAt || item.timestamp,
        item.timestamp,
      ],
    );
  }

  /**
   * MESSAGE apply。字段对齐 p2p_chat_messages（schema 行 573）。
   * 转发链 forwarded_from_id 可能 dangle，FK 在 ON DELETE SET NULL，无伤大雅。
   */
  async _applyMessage(item) {
    const data = JSON.parse(item.data || "{}");
    if (item.operation === SyncOperation.DELETE) {
      this.dbManager.run(`DELETE FROM p2p_chat_messages WHERE id = ?`, [
        item.resourceId,
      ]);
      return;
    }
    this.dbManager.run(
      `INSERT OR REPLACE INTO p2p_chat_messages
       (id, session_id, sender_did, receiver_did, content, message_type,
        file_path, file_size, encrypted, status, device_id, timestamp,
        forwarded_from_id, forward_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.resourceId,
        data.sessionId,
        data.senderDid,
        data.receiverDid,
        data.content,
        data.messageType || "text",
        data.filePath || null,
        data.fileSize || null,
        data.encrypted === false ? 0 : 1,
        data.status || "sent",
        item.deviceId || null,
        item.timestamp,
        data.forwardedFromId || null,
        data.forwardCount || 0,
      ],
    );
  }

  /**
   * POST apply。images 数组写入 media TEXT 列（JSON serialize）。
   * counts (likes/comments/shares) 不在 v1 sync，本地保留各自计数。
   */
  async _applyPost(item) {
    const data = JSON.parse(item.data || "{}");
    if (item.operation === SyncOperation.DELETE) {
      this.dbManager.run(`DELETE FROM social_posts WHERE id = ?`, [
        item.resourceId,
      ]);
      return;
    }
    // INSERT OR REPLACE 会重置 counts；UPSERT 保留本地 counts
    this.dbManager.run(
      `INSERT INTO social_posts
       (id, author_did, content, media, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         content = excluded.content,
         media = excluded.media,
         visibility = excluded.visibility,
         updated_at = excluded.updated_at`,
      [
        item.resourceId,
        data.authorDid,
        data.content || "",
        Array.isArray(data.images) ? JSON.stringify(data.images) : null,
        this._normalizePostVisibility(data.visibility),
        data.createdAt || item.timestamp,
        data.updatedAt || item.timestamp,
      ],
    );
  }

  /**
   * POST_COMMENT apply。schema 无 updated_at，UPDATE 等同 CREATE。
   */
  async _applyPostComment(item) {
    const data = JSON.parse(item.data || "{}");
    if (item.operation === SyncOperation.DELETE) {
      this.dbManager.run(`DELETE FROM post_comments WHERE id = ?`, [
        item.resourceId,
      ]);
      return;
    }
    this.dbManager.run(
      `INSERT OR REPLACE INTO post_comments
       (id, post_id, author_did, content, parent_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        item.resourceId,
        data.postId,
        data.authorDid,
        data.content || "",
        data.parentCommentId || null,
        data.createdAt || item.timestamp,
      ],
    );
  }

  /**
   * NOTIFICATION apply。Android `NotificationType` enum 是大写，desktop schema
   * CHECK 是 snake_case 小写，需 normalize。
   */
  async _applyNotification(item) {
    const data = JSON.parse(item.data || "{}");
    if (item.operation === SyncOperation.DELETE) {
      this.dbManager.run(`DELETE FROM notifications WHERE id = ?`, [
        item.resourceId,
      ]);
      return;
    }
    this.dbManager.run(
      `INSERT OR REPLACE INTO notifications
       (id, user_did, type, title, content, data, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.resourceId,
        this._getLocalUserDid(),
        this._normalizeNotificationType(data.type),
        data.title || "",
        data.content || null,
        data.targetId || data.actorDid
          ? JSON.stringify({
              targetId: data.targetId,
              actorDid: data.actorDid,
            })
          : null,
        data.isRead ? 1 : 0,
        data.createdAt || item.timestamp,
      ],
    );
  }

  // ============================================================
  // 字段 normalizer（处理 Android enum 大写 vs schema CHECK 小写）
  // ============================================================

  _normalizeFriendStatus(status) {
    const lower = String(status || "pending").toLowerCase();
    return ["pending", "accepted", "blocked"].includes(lower)
      ? lower
      : "pending";
  }

  _normalizePostVisibility(v) {
    const lower = String(v || "public").toLowerCase();
    return ["public", "friends", "private"].includes(lower) ? lower : "public";
  }

  _normalizeNotificationType(t) {
    const map = {
      SYSTEM: "system",
      LIKE: "like",
      COMMENT: "comment",
      MESSAGE: "message",
      FRIEND_REQUEST: "friend_request",
    };
    const upper = String(t || "system").toUpperCase();
    return map[upper] || "system";
  }

  /**
   * 当前本地用户 DID。M3 接 deviceManager；scaffold 阶段允许空字符串
   * 兜底（单用户 v1 不会撞 UNIQUE）。
   */
  _getLocalUserDid() {
    if (this.deviceManager?.getLocalDid) {
      return this.deviceManager.getLocalDid() || "";
    }
    return "";
  }

  /**
   * 读本地 item 用于冲突判决。返回 {resourceId, version, timestamp, deviceId}
   * 形状（与 SyncItem 子集兼容）。schema 没有 version 列，统一返 1。
   */
  async _readLocalItem(resourceType, resourceId) {
    switch (resourceType) {
      case ResourceType.MESSAGE: {
        const row = this.dbManager.get(
          `SELECT id, device_id, timestamp FROM p2p_chat_messages WHERE id = ?`,
          [resourceId],
        );
        return row
          ? {
              resourceId: row.id,
              version: 1,
              timestamp: row.timestamp,
              deviceId: row.device_id || "",
            }
          : null;
      }
      case ResourceType.FRIEND: {
        const row = this.dbManager.get(
          `SELECT friend_did, updated_at FROM friends
           WHERE friend_did = ? AND user_did = ?`,
          [resourceId, this._getLocalUserDid()],
        );
        return row
          ? {
              resourceId: row.friend_did,
              version: 1,
              timestamp: row.updated_at,
              deviceId: "",
            }
          : null;
      }
      case ResourceType.POST: {
        const row = this.dbManager.get(
          `SELECT id, updated_at FROM social_posts WHERE id = ?`,
          [resourceId],
        );
        return row
          ? {
              resourceId: row.id,
              version: 1,
              timestamp: row.updated_at,
              deviceId: "",
            }
          : null;
      }
      case ResourceType.POST_COMMENT: {
        const row = this.dbManager.get(
          `SELECT id, created_at FROM post_comments WHERE id = ?`,
          [resourceId],
        );
        return row
          ? {
              resourceId: row.id,
              version: 1,
              timestamp: row.created_at,
              deviceId: "",
            }
          : null;
      }
      case ResourceType.NOTIFICATION: {
        const row = this.dbManager.get(
          `SELECT id, created_at FROM notifications WHERE id = ?`,
          [resourceId],
        );
        return row
          ? {
              resourceId: row.id,
              version: 1,
              timestamp: row.created_at,
              deviceId: "",
            }
          : null;
      }
      default:
        return null;
    }
  }

  // ============================================================
  // 网络传输（封装 mobileBridge.sendToMobile + 等待 ack）
  // ============================================================

  async _sendItem(deviceId, item) {
    return await this._invokeRemote(deviceId, "sync.push", { item, deviceId });
  }

  /**
   * 包 mobileBridge JSON-RPC：发出 request，等待对端 response。
   * 30s 超时；超时 reject 并清掉 pendingAcks。
   */
  async _invokeRemote(deviceId, method, params) {
    if (!this.mobileBridge?.sendToMobile) {
      throw new Error("mobileBridge.sendToMobile 不可用");
    }
    const requestId = `${this.deps.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const message = {
      type: "chainlesschain:command:request",
      payload: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method,
        params,
        // Phase 3d v1.2 #1: 给所有 sync.* 出向加 AuthInfo（did + signature 占位 +
        // timestamp + nonce）。Android side SyncAuthVerifier 校验 timestamp 窗口、
        // nonce 重放、DID 与 P2P 对端身份匹配。真密码学签名 v1.2 next iteration（需
        // peer pubkey 交换 + 完整 QR pairing flow）。
        auth: this._buildAuth(),
      }),
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(requestId);
        reject(new Error(`${method} 30s 超时`));
      }, 30000);

      this.pendingAcks.set(requestId, { resolve, reject, timer });

      this.mobileBridge.sendToMobile(deviceId, message).catch((err) => {
        clearTimeout(timer);
        this.pendingAcks.delete(requestId);
        reject(err);
      });
    });
  }

  // ============================================================
  // 内部工具
  // ============================================================

  /**
   * Phase 3c 期间写入的旧 tombstone 行 resource_type 列为 NULL（迁移前）。
   * 那批行必然是 knowledge_items（Phase 3c 是唯一来源），但 v1 mobile sync
   * 不处理 KNOWLEDGE_ITEM；走兜底返回 null 让 caller 跳过。Phase 3d 之后
   * 写入的所有 tombstone 都有 resource_type，正常路径不到这里。
   */
  /**
   * Phase 3d v1.2 #1: 构造 sync.* JSON-RPC 出向 AuthInfo。
   *
   * 形状对齐 Android `app/remote/data/CommandProtocol.kt::AuthInfo`：
   *   {did, signature, timestamp, nonce}
   *
   * v1.2 当前实现：signature 是占位字符串 "v1.2-placeholder-no-sig"。Android
   * side SyncAuthVerifier 不验签（只验 timestamp/nonce/DID），所以 placeholder
   * OK。未来真密码学签名（v1.2 next iteration）需：
   *   - 拿 didManager.getCurrentIdentity().secretKey
   *   - did-signer.signBytes(JCS({method, timestamp, nonce}), secretKey)
   *   - Android side 也需 PC 公钥（v1.2 完整 QR pairing 时交换）
   *
   * didManager 缺失或没 currentIdentity 时 did 兜底 "did:cc:desktop-unknown"，
   * Android side 看到这种 did 与 connectedPeer.did 不匹配会 reject — 让用户立刻
   * 在日志看到 "DID mismatch" 而不是 silent fail。
   */
  _buildAuth() {
    const identity = this.didManager?.getCurrentIdentity?.();
    return {
      did: identity?.did || "did:cc:desktop-unknown",
      signature: "v1.2-placeholder-no-sig",
      timestamp: this.deps.now(),
      nonce: crypto.randomBytes(16).toString("hex"),
    };
  }

  _inferResourceTypeFromTombstone(_ts) {
    return null;
  }

  /**
   * 显式入队（trigger 不能覆盖的场景，例如外部 IPC 触发）。
   */
  recordChange(resourceType, resourceId, operation, data) {
    if (!Object.values(ResourceType).includes(resourceType)) {
      throw new Error(`未知 ResourceType: ${resourceType}`);
    }
    if (!Object.values(SyncOperation).includes(operation)) {
      throw new Error(`未知 SyncOperation: ${operation}`);
    }
    // 当前实现：walker 已能扫表自动发现，recordChange 主要是 trace。
    // 真正的入队点是 sync_external_tombstones（DELETE）+ 5 张表 updated_at（其他）。
    this.logger.debug(
      `[MobileBridgeSync] recordChange ${resourceType}/${resourceId} ${operation}`,
    );
  }

  cleanup() {
    this._closed = true;
    for (const { timer, reject } of this.pendingAcks.values()) {
      clearTimeout(timer);
      reject(new Error("MobileBridgeSync closed"));
    }
    this.pendingAcks.clear();
  }
}

module.exports = MobileBridgeSync;
module.exports.ResourceType = ResourceType;
module.exports.SyncOperation = SyncOperation;
module.exports._deps = _deps;
