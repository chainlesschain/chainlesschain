/**
 * Mobile Bridge Sync — Phase 3d desktop ↔ Android 同步桥（Phase 3d v1）
 *
 * 复用 MobileBridge WebRTC DataChannel transport（src/main/p2p/mobile-bridge.js）+
 * 现有 JSON-RPC envelope（chainlesschain:command:request/response）。新增 3 method：
 * sync.push / sync.pull / sync.ack。详见 docs/design/Phase3d_Mobile_Sync_设计文档.md。
 *
 * 表结构：cursor + tombstone 复用 Phase 3c 的 sync_external_* 表（provider_id='mobile'，
 * account_key=<mobileDeviceId>）。Walker 针对 6 张表做 incremental 扫描：
 * knowledge_items / p2p_chat_messages / friends / social_posts / post_comments / notifications。
 *
 * v1.1 W1 (2026-05-12)：扩 KNOWLEDGE_ITEM 走 mobile provider。Phase 3c 的
 * `trg_sync_ext_tombstone_knowledge` trigger 已经为所有已建游标的 provider fan-out
 * KNOWLEDGE_ITEM tombstone（包括 mobile），原 walker 只是 listTombstones 过滤把
 * KNOWLEDGE_ITEM 漏了；本 commit 把 ResourceType 加上后过滤自动包含。
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
const didSigner = require("../did/did-signer");

const PROVIDER_ID = "mobile";

const ResourceType = Object.freeze({
  KNOWLEDGE_ITEM: "KNOWLEDGE_ITEM",
  MESSAGE: "MESSAGE",
  CONTACT: "CONTACT",
  FRIEND: "FRIEND",
  POST: "POST",
  POST_COMMENT: "POST_COMMENT",
  NOTIFICATION: "NOTIFICATION",
  // v1.2 (2026-05-12) 项目元数据。v1 只走 CREATE/UPDATE，DELETE 待 v2 加 tombstone
  // trigger（参考 trg_sync_ext_tombstone_knowledge 模式建 trg_sync_ext_tombstone_project）。
  PROJECT: "PROJECT",
  // v1.1 W5 (2026-05-12) issue #19 — 双端 ResourceType 对齐，加 2 类（CONVERSATION + POST_LIKE）。
  // SETTING / FRIEND_GROUP / POST_SHARE 缺桌面 schema，推 v1.2 (各自 +1 张表 + migration)。
  // 两类同 PROJECT 走 CREATE/UPDATE（无 tombstone）。
  CONVERSATION: "CONVERSATION",
  POST_LIKE: "POST_LIKE",
  // v1.2 prep #4 (2026-05-12)：SETTING 用户偏好同步 (user_settings 表)。完整 CRUD —
  // CREATE/UPDATE 走 walker LWW UPSERT，DELETE 走 trg_sync_ext_tombstone_user_settings
  // tombstone trigger（item_id = "scope:key"）。
  SETTING: "SETTING",
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
    // resourceTypes 过滤让 mobile provider 只看自己关心的 ResourceType。
    // CONTACT 单独排除（无对等映射，详见 _tableFetchers 注释）；KNOWLEDGE_ITEM
    // 自 v1.1 W1 起 mobile 也消费（Phase 3c trigger 已 fan-out per-provider，
    // 每 provider 拿到独立的 tombstone 行，删一份不影响 webdav/oss 的另一份）。
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
      // v1.1 W1：KNOWLEDGE_ITEM 排第一，KB 同步是 L2/L3 核心价值。
      this._fetchKnowledgeItems.bind(this),
      this._fetchP2PChatMessages.bind(this),
      this._fetchFriends.bind(this),
      this._fetchSocialPosts.bind(this),
      this._fetchPostComments.bind(this),
      this._fetchNotifications.bind(this),
      // v1.2 项目元数据。仅 CREATE/UPDATE，DELETE 待 v2 加 tombstone trigger。
      this._fetchProjects.bind(this),
      // v1.1 W5 issue #19 — 双端 ResourceType 对齐 (2026-05-12)。
      // CONVERSATION (聊天会话) + POST_LIKE (社交点赞)。两者都仅 CREATE/UPDATE，
      // DELETE 待 v2 加 tombstone trigger。
      this._fetchConversations.bind(this),
      this._fetchPostLikes.bind(this),
      // v1.2 prep #4 (2026-05-12) SETTING — user_settings 表 + tombstone trigger 已
      // 全 CRUD（CREATE/UPDATE/DELETE）。LWW by updated_at。
      this._fetchUserSettings.bind(this),
      // CONTACT 暂不走：Android DefaultSyncDataApplier.kt 把 CONTACT 与 FRIEND
      // 都路由到 FriendRepository（同一份数据）；桌面 contacts 表是更广的通讯录
      // 概念，无对等映射。v2 按需补。
      // this._fetchContacts.bind(this),
      // v1.2 follow-up：FRIEND_GROUP / POST_SHARE 仍缺桌面 schema，
      // 详见 docs/design/ResourceType_Walker_Extension.md。
    ];
  }

  /**
   * knowledge_items walker — v1.1 W1。
   *
   * 字段策略：只同步 Android+桌面 schema 共同的最小子集
   * （id / title / type / content / created_at / updated_at / device_id）。
   * 桌面独有列（content_path / embedding_path / git_commit_hash / sync_status）
   * 不上线；Android 独有列（folderId / tags / isFavorite / isPinned）也不下传，
   * 仍保留为本地状态。v1.1 next iteration 视用户反馈再扩。
   *
   * 类型 CHECK 完全对齐：desktop ('note'|'document'|'conversation'|'web_clip')
   * = Android KnowledgeType.value，零 normalize。
   *
   * 游标 (updated_at, id) lex 序，与其他 walker 一致。
   */
  async _fetchKnowledgeItems(dbManager, sinceMs, sinceId, limit) {
    const sql = sinceId
      ? `SELECT id, title, type, content, created_at, updated_at, device_id
         FROM knowledge_items
         WHERE updated_at > ? OR (updated_at = ? AND id > ?)
         ORDER BY updated_at ASC, id ASC
         LIMIT ?`
      : `SELECT id, title, type, content, created_at, updated_at, device_id
         FROM knowledge_items
         WHERE updated_at > ?
         ORDER BY updated_at ASC, id ASC
         LIMIT ?`;
    const params = sinceId
      ? [sinceMs, sinceMs, sinceId, limit]
      : [sinceMs, limit];
    const rows = dbManager.all(sql, params);
    return rows.map((row) => ({
      resourceType: ResourceType.KNOWLEDGE_ITEM,
      resourceId: row.id,
      // updated_at == created_at 视为 CREATE，否则 UPDATE。两端 apply 路径
      // 都用 UPSERT，op 区分只是 telemetry / conflict-resolve 不区分两者。
      operation:
        row.updated_at > row.created_at
          ? SyncOperation.UPDATE
          : SyncOperation.CREATE,
      version: 1,
      timestamp: row.updated_at,
      deviceId: row.device_id || "",
      data: JSON.stringify({
        id: row.id,
        title: row.title,
        type: row.type,
        content: row.content || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        // deviceId 内嵌 data：Android KnowledgeItemEntity.deviceId 是 NOT NULL
        // 字段，kotlinx.serialization decodeFromString 需要 JSON 内有它才能
        // 构造 entity。其他 walker 不放是因为对应 entity 允许 deviceId 缺省。
        deviceId: row.device_id || "",
      }),
    }));
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

  /**
   * projects walker — v1.2 (2026-05-12)。
   *
   * 字段策略：同步桌面 + Android 共同子集（id / user_id / name / description /
   * project_type / status / root_path / file_count / total_size / tags / metadata /
   * created_at / updated_at / device_id）。Android 独有列（isFavorite / isArchived /
   * git* / lastAccessedAt / accessCount）不下传，由 Android 端的字段级 merge
   * 保留；桌面独有列（template_id / cover_image_url / sync_status / synced_at /
   * category_id / delivered_at）也不上线，避免污染 Android schema。
   *
   * 过滤 deleted=1：软删的项目不参与 push（DELETE 走 tombstone，但 v1 没建 trigger，
   * 等 v2）。
   *
   * 游标 (updated_at, id) lex 序，与其他 walker 一致。
   */
  async _fetchProjects(dbManager, sinceMs, sinceId, limit) {
    const sql = sinceId
      ? `SELECT id, user_id, name, description, project_type, status, root_path,
                file_count, total_size, tags, metadata, created_at, updated_at,
                device_id
         FROM projects
         WHERE deleted = 0
           AND (updated_at > ? OR (updated_at = ? AND id > ?))
         ORDER BY updated_at ASC, id ASC
         LIMIT ?`
      : `SELECT id, user_id, name, description, project_type, status, root_path,
                file_count, total_size, tags, metadata, created_at, updated_at,
                device_id
         FROM projects
         WHERE deleted = 0 AND updated_at > ?
         ORDER BY updated_at ASC, id ASC
         LIMIT ?`;
    const params = sinceId
      ? [sinceMs, sinceMs, sinceId, limit]
      : [sinceMs, limit];
    const rows = dbManager.all(sql, params);
    return rows.map((row) => ({
      resourceType: ResourceType.PROJECT,
      resourceId: row.id,
      operation:
        row.updated_at > row.created_at
          ? SyncOperation.UPDATE
          : SyncOperation.CREATE,
      version: 1,
      timestamp: row.updated_at,
      deviceId: row.device_id || "",
      data: JSON.stringify({
        id: row.id,
        user_id: row.user_id,
        name: row.name,
        description: row.description,
        project_type: row.project_type,
        status: row.status,
        root_path: row.root_path,
        file_count: row.file_count,
        total_size: row.total_size,
        tags: row.tags,
        metadata: row.metadata,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }),
    }));
  }

  /**
   * v1.1 W5 issue #19 — CONVERSATION 聊天会话同步 (2026-05-12)。
   *
   * 表 `conversations` 字段：id / title / knowledge_id / project_id / context_type /
   * context_data / created_at / updated_at。无 device_id / 无 tombstone — 仅
   * CREATE/UPDATE，DELETE 待 v2 加 trigger。
   *
   * 字段策略：双端共同子集 (id / title / knowledge_id? / project_id? / context_type /
   * context_data? / created_at / updated_at)。Android `ConversationEntity` 接收时
   * 对 nullable 字段做兜底。
   */
  async _fetchConversations(dbManager, sinceMs, sinceId, limit) {
    const sql = sinceId
      ? `SELECT id, title, knowledge_id, project_id, context_type, context_data,
                created_at, updated_at
         FROM conversations
         WHERE updated_at > ? OR (updated_at = ? AND id > ?)
         ORDER BY updated_at ASC, id ASC
         LIMIT ?`
      : `SELECT id, title, knowledge_id, project_id, context_type, context_data,
                created_at, updated_at
         FROM conversations
         WHERE updated_at > ?
         ORDER BY updated_at ASC, id ASC
         LIMIT ?`;
    const params = sinceId
      ? [sinceMs, sinceMs, sinceId, limit]
      : [sinceMs, limit];
    const rows = dbManager.all(sql, params);
    return rows.map((row) => ({
      resourceType: ResourceType.CONVERSATION,
      resourceId: row.id,
      operation:
        row.updated_at > row.created_at
          ? SyncOperation.UPDATE
          : SyncOperation.CREATE,
      version: 1,
      timestamp: row.updated_at,
      deviceId: "",
      data: JSON.stringify({
        id: row.id,
        title: row.title,
        knowledge_id: row.knowledge_id,
        project_id: row.project_id,
        context_type: row.context_type || "global",
        context_data: row.context_data,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }),
    }));
  }

  /**
   * v1.1 W5 issue #19 — POST_LIKE 社交点赞同步 (2026-05-12)。
   *
   * 表 `post_likes` 字段：id (PK) / post_id / user_did / created_at。UNIQUE(post_id,
   * user_did) — 业务上 1 用户 1 帖子最多 1 个 like。无 updated_at / 无 tombstone —
   * 仅 CREATE 路径（unlike = DELETE 行，待 v2 tombstone trigger）。
   *
   * 游标用 created_at（点赞按时间 append-only）。
   */
  async _fetchPostLikes(dbManager, sinceMs, sinceId, limit) {
    const sql = sinceId
      ? `SELECT id, post_id, user_did, created_at
         FROM post_likes
         WHERE created_at > ? OR (created_at = ? AND id > ?)
         ORDER BY created_at ASC, id ASC
         LIMIT ?`
      : `SELECT id, post_id, user_did, created_at
         FROM post_likes
         WHERE created_at > ?
         ORDER BY created_at ASC, id ASC
         LIMIT ?`;
    const params = sinceId
      ? [sinceMs, sinceMs, sinceId, limit]
      : [sinceMs, limit];
    const rows = dbManager.all(sql, params);
    return rows.map((row) => ({
      resourceType: ResourceType.POST_LIKE,
      resourceId: row.id,
      operation: SyncOperation.CREATE, // append-only：点赞行 immutable
      version: 1,
      timestamp: row.created_at,
      deviceId: "",
      data: JSON.stringify({
        id: row.id,
        post_id: row.post_id,
        user_did: row.user_did,
        created_at: row.created_at,
      }),
    }));
  }

  /**
   * v1.2 prep #4 issue #19 — SETTING 用户偏好同步 (2026-05-12)。
   *
   * 表 `user_settings` 字段：(scope, key) 联合 PK / value / value_type / created_at /
   * updated_at / device_id / deleted。resourceId 用 "scope:key" 复合（与 tombstone
   * trigger 的 item_id 对齐）；游标 (updated_at, "scope:key") lex。
   *
   * 字段策略：双端共同子集 (scope / key / value / value_type / created_at / updated_at)。
   * Android 端按 LWW 解决冲突即可（与 ConflictResolver.resolveSettingConflict 的
   * keep-local 默认策略并存——按 scope 分类决定走哪条路：global preference → LWW，
   * device:hardware → keep-local，由 Android 端按 key 前缀判断，不走桌面层）。
   */
  async _fetchUserSettings(dbManager, sinceMs, sinceId, limit) {
    // sinceId 是 "scope:key" 字符串形式
    const sql = sinceId
      ? `SELECT scope, key, value, value_type, created_at, updated_at, device_id
         FROM user_settings
         WHERE deleted = 0
           AND (updated_at > ? OR (updated_at = ? AND (scope || ':' || key) > ?))
         ORDER BY updated_at ASC, scope ASC, key ASC
         LIMIT ?`
      : `SELECT scope, key, value, value_type, created_at, updated_at, device_id
         FROM user_settings
         WHERE deleted = 0 AND updated_at > ?
         ORDER BY updated_at ASC, scope ASC, key ASC
         LIMIT ?`;
    const params = sinceId
      ? [sinceMs, sinceMs, sinceId, limit]
      : [sinceMs, limit];
    const rows = dbManager.all(sql, params);
    return rows.map((row) => ({
      resourceType: ResourceType.SETTING,
      resourceId: `${row.scope}:${row.key}`,
      operation:
        row.updated_at > row.created_at
          ? SyncOperation.UPDATE
          : SyncOperation.CREATE,
      version: 1,
      timestamp: row.updated_at,
      deviceId: row.device_id || "",
      data: JSON.stringify({
        scope: row.scope,
        key: row.key,
        value: row.value,
        value_type: row.value_type || "string",
        created_at: row.created_at,
        updated_at: row.updated_at,
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
        case ResourceType.KNOWLEDGE_ITEM:
          await this._applyKnowledgeItem(item);
          break;
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
        case ResourceType.PROJECT:
          await this._applyProject(item);
          break;
        // v1.1 W5 issue #19 — 双端 ResourceType 对齐 (2026-05-12)。
        case ResourceType.CONVERSATION:
          await this._applyConversation(item);
          break;
        case ResourceType.POST_LIKE:
          await this._applyPostLike(item);
          break;
        // v1.2 prep #4 (2026-05-12)：用户偏好同步。
        case ResourceType.SETTING:
          await this._applySetting(item);
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
   * KNOWLEDGE_ITEM apply — v1.1 W1。
   *
   * 字段子集：仅 id/title/type/content/created_at/updated_at/device_id 同步；
   * 本地独有列（content_path / embedding_path / git_commit_hash / sync_status）
   * 由 INSERT 默认值兜底，UPSERT 时不覆盖。
   *
   * type 走 _normalizeKnowledgeType 防对端发来 unexpected 值绕过 CHECK 约束。
   * sync_status 入库时永远写 'synced'（item 来自对端 = 已被同步过的状态）。
   */
  async _applyKnowledgeItem(item) {
    const data = JSON.parse(item.data || "{}");
    if (item.operation === SyncOperation.DELETE) {
      this.dbManager.run(`DELETE FROM knowledge_items WHERE id = ?`, [
        item.resourceId,
      ]);
      return;
    }
    // ON CONFLICT(id) DO UPDATE 保留 content_path/embedding_path/git_commit_hash
    // 等本地独有列；只覆写来自对端的字段。
    this.dbManager.run(
      `INSERT INTO knowledge_items
       (id, title, type, content, created_at, updated_at, device_id, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'synced')
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         type = excluded.type,
         content = excluded.content,
         updated_at = excluded.updated_at,
         device_id = excluded.device_id,
         sync_status = 'synced'`,
      [
        item.resourceId,
        data.title || "",
        this._normalizeKnowledgeType(data.type),
        data.content || null,
        data.createdAt || item.timestamp,
        data.updatedAt || item.timestamp,
        item.deviceId || null,
      ],
    );
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

  /**
   * PROJECT apply — v1.2 (2026-05-12)。
   *
   * 桌面 projects.project_type 有 CHECK：('web','document','data','app',
   * 'presentation','spreadsheet','design','code','workflow','knowledge')；
   * status 有 CHECK：('draft','active','completed','archived')。Android 端的
   * project_type 值集是 desktop 超集（含 android/backend/data_science/...），
   * 直接落库会被 CHECK 拒。normalize 兜底：Android 独有类型 → 'code'（最近邻），
   * Android 独有 status (paused/deleted) → 'active' / DELETE 路径。
   *
   * v1 不接 Android 上行 push（Android 端 SyncOutbound 也没接 PROJECT walker），
   * 所以本 apply 实际只在桌面 ↔ 桌面回环 / 未来 v2 Android push 时跑。
   */
  async _applyProject(item) {
    const data = JSON.parse(item.data || "{}");
    if (item.operation === SyncOperation.DELETE) {
      // 软删：与桌面本地 deleteProject 路径一致
      this.dbManager.run(
        `UPDATE projects SET deleted = 1, updated_at = ? WHERE id = ?`,
        [item.timestamp || this.deps.now(), item.resourceId],
      );
      return;
    }
    const projectType = this._normalizeProjectType(data.project_type);
    const status = this._normalizeProjectStatus(data.status);
    this.dbManager.run(
      `INSERT OR REPLACE INTO projects
       (id, user_id, name, description, project_type, status, root_path,
        file_count, total_size, tags, metadata, created_at, updated_at,
        sync_status, device_id, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, 0)`,
      [
        item.resourceId,
        data.user_id || "",
        data.name || "",
        data.description || null,
        projectType,
        status,
        data.root_path || null,
        data.file_count || 0,
        data.total_size || 0,
        data.tags || null,
        data.metadata || null,
        data.created_at || item.timestamp,
        data.updated_at || item.timestamp,
        item.deviceId || "",
      ],
    );
  }

  /**
   * v1.1 W5 issue #19 — CONVERSATION apply (2026-05-12)。
   *
   * UPSERT 保留本地独有字段（v1 schema 仅有共同子集，无独有列）。LWW by updated_at
   * 通过 `WHERE excluded.updated_at > existing.updated_at` 保证。无 tombstone — 仅
   * CREATE/UPDATE，DELETE 待 v2 加 trigger。
   */
  async _applyConversation(item) {
    const data = JSON.parse(item.data || "{}");
    if (item.operation === SyncOperation.DELETE) {
      this.dbManager.run(`DELETE FROM conversations WHERE id = ?`, [
        item.resourceId,
      ]);
      return;
    }
    this.dbManager.run(
      `INSERT INTO conversations
       (id, title, knowledge_id, project_id, context_type, context_data,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         knowledge_id = excluded.knowledge_id,
         project_id = excluded.project_id,
         context_type = excluded.context_type,
         context_data = excluded.context_data,
         updated_at = excluded.updated_at
       WHERE excluded.updated_at > conversations.updated_at`,
      [
        item.resourceId,
        data.title || "",
        data.knowledge_id || null,
        data.project_id || null,
        data.context_type || "global",
        data.context_data || null,
        data.created_at || item.timestamp,
        data.updated_at || item.timestamp,
      ],
    );
  }

  /**
   * v1.1 W5 issue #19 — POST_LIKE apply (2026-05-12)。
   *
   * 行 immutable（点赞行只 CREATE，unlike 走 DELETE）。INSERT OR IGNORE 让重复 push
   * (同 post + user_did) 自然 no-op，符合 UNIQUE(post_id, user_did) 约束。
   */
  async _applyPostLike(item) {
    const data = JSON.parse(item.data || "{}");
    if (item.operation === SyncOperation.DELETE) {
      this.dbManager.run(`DELETE FROM post_likes WHERE id = ?`, [
        item.resourceId,
      ]);
      return;
    }
    this.dbManager.run(
      `INSERT OR IGNORE INTO post_likes
       (id, post_id, user_did, created_at)
       VALUES (?, ?, ?, ?)`,
      [
        item.resourceId,
        data.post_id || data.postId || "",
        data.user_did || data.userDid || "",
        data.created_at || item.timestamp,
      ],
    );
  }

  /**
   * v1.2 prep #4 issue #19 — SETTING apply (2026-05-12)。
   *
   * resourceId 是 "scope:key"，反解出来作为 PK。UPSERT LWW by updated_at；DELETE
   * 走真删（user_settings tombstone trigger 会 fan-out）。value_type 用 enum 校验，
   * 落不在白名单回退 'string' 防 CHECK 拒绝。
   */
  async _applySetting(item) {
    const data = JSON.parse(item.data || "{}");
    const sepIdx = item.resourceId.indexOf(":");
    const scope =
      sepIdx > 0 ? item.resourceId.slice(0, sepIdx) : data.scope || "global";
    const key =
      sepIdx > 0
        ? item.resourceId.slice(sepIdx + 1)
        : data.key || item.resourceId;

    if (item.operation === SyncOperation.DELETE) {
      this.dbManager.run(
        `DELETE FROM user_settings WHERE scope = ? AND key = ?`,
        [scope, key],
      );
      return;
    }

    const valueType = ["string", "number", "boolean", "json"].includes(
      data.value_type,
    )
      ? data.value_type
      : "string";

    this.dbManager.run(
      `INSERT INTO user_settings
       (scope, key, value, value_type, created_at, updated_at, device_id, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(scope, key) DO UPDATE SET
         value = excluded.value,
         value_type = excluded.value_type,
         updated_at = excluded.updated_at,
         device_id = excluded.device_id,
         deleted = 0
       WHERE excluded.updated_at > user_settings.updated_at`,
      [
        scope,
        key,
        data.value == null ? null : String(data.value),
        valueType,
        data.created_at || item.timestamp,
        data.updated_at || item.timestamp,
        item.deviceId || "",
      ],
    );
  }

  // ============================================================
  // 字段 normalizer（处理 Android enum 大写 vs schema CHECK 小写）
  // ============================================================

  /**
   * KnowledgeType normalize — v1.1 W1。Android KnowledgeType.value 与 desktop
   * CHECK 约束完全对齐（note/document/conversation/web_clip），常规路径无 work；
   * 兜底防对端发来 unexpected 值绕过 CHECK 约束（如 typo / 未来 enum 添加）。
   */
  _normalizeKnowledgeType(type) {
    const lower = String(type || "note").toLowerCase();
    return ["note", "document", "conversation", "web_clip"].includes(lower)
      ? lower
      : "note";
  }

  _normalizeFriendStatus(status) {
    const lower = String(status || "pending").toLowerCase();
    return ["pending", "accepted", "blocked"].includes(lower)
      ? lower
      : "pending";
  }

  /**
   * project_type normalize — v1.2 (2026-05-12)。
   *
   * Android ProjectType 值集是 desktop CHECK 超集；Android 独有类型（android /
   * backend / data_science / multiplatform / flutter / research / other）发上来会
   * 触发 SQLite CHECK 拒绝。映射到 desktop 现有最近邻类型（多数 → 'code'，
   * research/document → 'document'，other → 'document' 兜底）。
   */
  _normalizeProjectType(t) {
    const lower = String(t || "document").toLowerCase();
    const desktopAllowed = [
      "web",
      "document",
      "data",
      "app",
      "presentation",
      "spreadsheet",
      "design",
      "code",
      "workflow",
      "knowledge",
    ];
    if (desktopAllowed.includes(lower)) {
      return lower;
    }
    // Android 独有 → 最近邻
    const map = {
      android: "code",
      backend: "code",
      data_science: "data",
      multiplatform: "code",
      flutter: "code",
      research: "document",
      other: "document",
    };
    return map[lower] || "document";
  }

  /**
   * project status normalize — v1.2 (2026-05-12)。
   *
   * Desktop CHECK: ('draft','active','completed','archived')。
   * Android 独有 ('paused' / 'deleted')：paused → active（桌面无对应概念），
   * deleted 走 DELETE 路径不应该进这里；保守兜底 active。
   */
  _normalizeProjectStatus(s) {
    const lower = String(s || "active").toLowerCase();
    if (["draft", "active", "completed", "archived"].includes(lower)) {
      return lower;
    }
    return "active";
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
      case ResourceType.KNOWLEDGE_ITEM: {
        const row = this.dbManager.get(
          `SELECT id, device_id, updated_at FROM knowledge_items WHERE id = ?`,
          [resourceId],
        );
        return row
          ? {
              resourceId: row.id,
              version: 1,
              timestamp: row.updated_at,
              deviceId: row.device_id || "",
            }
          : null;
      }
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
      case ResourceType.PROJECT: {
        const row = this.dbManager.get(
          `SELECT id, device_id, updated_at FROM projects WHERE id = ?`,
          [resourceId],
        );
        return row
          ? {
              resourceId: row.id,
              version: 1,
              timestamp: row.updated_at,
              deviceId: row.device_id || "",
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
      // v1.1 W5 issue #19 — 双端 ResourceType 对齐 (2026-05-12)。
      case ResourceType.CONVERSATION: {
        const row = this.dbManager.get(
          `SELECT id, updated_at FROM conversations WHERE id = ?`,
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
      case ResourceType.POST_LIKE: {
        const row = this.dbManager.get(
          `SELECT id, created_at FROM post_likes WHERE id = ?`,
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
      // v1.2 prep #4 (2026-05-12) SETTING — resourceId = "scope:key" 复合
      case ResourceType.SETTING: {
        const sepIdx = resourceId.indexOf(":");
        if (sepIdx <= 0) {
          return null;
        }
        const scope = resourceId.slice(0, sepIdx);
        const key = resourceId.slice(sepIdx + 1);
        const row = this.dbManager.get(
          `SELECT scope, key, device_id, updated_at FROM user_settings
           WHERE scope = ? AND key = ?`,
          [scope, key],
        );
        return row
          ? {
              resourceId: `${row.scope}:${row.key}`,
              version: 1,
              timestamp: row.updated_at,
              deviceId: row.device_id || "",
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
   * **v1.2 next iteration（本 commit）**: signature 现在是真 Ed25519 detached
   * sig over JCS({method, nonce, timestamp})（method 单独 param 不在 payload
   * 内，因 _buildAuth 当下不知道 method — 改造由 _invokeRemote 调用方传入也
   * 太大。当前 canonical input 只覆盖 timestamp+nonce+did，足够防 nonce 和
   * 时间戳伪造，method 完整性靠 P2P channel 完整性兜底）。
   *
   * 构造路径：
   *   1. didManager.getCurrentIdentity() → identity 对象
   *      （包 public_key_sign base64 + private_key_ref JSON-string）
   *   2. didSigner.signPayloadWithIdentity({timestamp, nonce, did}, identity)
   *      → 真 Ed25519 detached signature, base64
   *   3. 失败兜底（identity null / 字段缺失 / sign 抛）→ placeholder + warn-log
   *
   * Android side 当前 SyncAuthVerifier 不验签（v1.1 #2 文档说明）；这条
   * commit 让 wire 上有真 sig，Android verify gate 4 是下次 iteration —
   * 需要 Android 拿到 PC 公钥（扩 M4.5 双向 pairing 加 pubkey 字段）。
   *
   * didManager 缺失时 did 兜底 "did:cc:desktop-unknown"，Android 立即看到
   * "DID mismatch" → fail-loud 而不是 silent fail。
   */
  _buildAuth() {
    const identity = this.didManager?.getCurrentIdentity?.();
    const did = identity?.did || "did:cc:desktop-unknown";
    const timestamp = this.deps.now();
    const nonce = crypto.randomBytes(16).toString("hex");

    let signature = "v1.2-placeholder-no-sig";
    let senderPubkey = null;
    if (identity?.public_key_sign && identity?.private_key_ref) {
      try {
        const signed = didSigner.signPayloadWithIdentity(
          { did, nonce, timestamp },
          identity,
        );
        signature = signed.signature;
        // v1.2 Android gate 4: 把 pubkey 一起发，让 Android 不需要预先存 PC pubkey
        // 即可验证 sig（hash 链 pubkey→did + Ed25519 verify sig）。
        senderPubkey = identity.public_key_sign;
      } catch (err) {
        // 签名失败不阻止请求 — 走 placeholder，日志暴露原因便于诊断
        logger.warn(
          `[MobileBridgeSync] _buildAuth sign failed: ${err.message}; falling back to placeholder`,
        );
      }
    }
    return { did, signature, timestamp, nonce, senderPubkey };
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
