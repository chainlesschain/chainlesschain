/**
 * 群聊管理器
 * 负责群聊的创建、管理、消息发送等功能
 * 支持端到端加密的群组消息（基于Signal Protocol Sender Keys）
 *
 * @module group-chat-manager
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");
const crypto = require("crypto");

class GroupChatManager extends EventEmitter {
  constructor(database, p2pManager, signalSessionManager) {
    super();

    this.database = database;
    this.p2pManager = p2pManager;
    this.signalSessionManager = signalSessionManager;

    // 群组加密密钥缓存
    this.groupKeys = new Map(); // groupId -> { chainKey, signatureKey, iteration }

    // 当前用户DID
    this.currentUserDid = null;

    logger.info("[GroupChatManager] 群聊管理器已初始化");
  }

  /**
   * 设置当前用户DID
   */
  setCurrentUserDid(did) {
    this.currentUserDid = did;
    logger.info("[GroupChatManager] 当前用户DID已设置:", did);
  }

  /**
   * 创建群聊
   * @param {Object} options - 群聊选项
   * @param {string} options.name - 群聊名称
   * @param {string} options.description - 群聊描述
   * @param {string} options.avatar - 群聊头像
   * @param {Array<string>} options.memberDids - 初始成员DID列表
   * @param {boolean} options.encrypted - 是否启用端到端加密
   */
  async createGroup(options) {
    const {
      name,
      description = "",
      avatar = "",
      memberDids = [],
      encrypted = true,
    } = options;

    if (!this.currentUserDid) {
      throw new Error("当前用户DID未设置");
    }

    if (!name || name.trim() === "") {
      throw new Error("群聊名称不能为空");
    }

    try {
      const groupId = uuidv4();
      const now = Date.now();

      // 生成群组加密密钥（如果启用加密）
      let encryptionKey = null;
      if (encrypted) {
        const keyData = await this.generateGroupEncryptionKey(groupId);
        encryptionKey = keyData.keyId;
      }

      // 创建群聊记录
      const insertGroupStmt = this.database.prepare(`
        INSERT INTO group_chats (
          id, name, description, avatar, creator_did, group_type,
          max_members, member_count, encryption_key, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertGroupStmt.run(
        groupId,
        name,
        description,
        avatar,
        this.currentUserDid,
        encrypted ? "encrypted" : "normal",
        500,
        memberDids.length + 1, // 包括创建者
        encryptionKey,
        now,
        now,
      );

      // 添加创建者为群主
      await this.addGroupMember(groupId, this.currentUserDid, "owner");

      // 添加初始成员
      for (const memberDid of memberDids) {
        await this.addGroupMember(groupId, memberDid, "member");
      }

      // 发送系统消息
      await this.sendSystemMessage(groupId, `群聊"${name}"已创建`);

      // 通过P2P网络通知所有成员
      await this.notifyGroupMembers(groupId, {
        type: "group:created",
        groupId,
        name,
        creator: this.currentUserDid,
      });

      this.database.saveToFile();

      logger.info("[GroupChatManager] 群聊已创建:", groupId);

      this.emit("group:created", {
        groupId,
        name,
        memberCount: memberDids.length + 1,
      });

      return {
        success: true,
        groupId,
        name,
        memberCount: memberDids.length + 1,
      };
    } catch (error) {
      logger.error("[GroupChatManager] 创建群聊失败:", error);
      throw error;
    }
  }

  /**
   * 获取群聊列表
   */
  async getGroups() {
    try {
      if (!this.currentUserDid) {
        return [];
      }

      const stmt = this.database.prepare(`
        SELECT g.*, gm.role, gm.muted
        FROM group_chats g
        INNER JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.member_did = ?
        ORDER BY g.updated_at DESC
      `);

      const groups = stmt.all(this.currentUserDid);
      return groups || [];
    } catch (error) {
      logger.error("[GroupChatManager] 获取群聊列表失败:", error);
      return [];
    }
  }

  /**
   * 获取群聊详情
   */
  async getGroupDetails(groupId) {
    try {
      const groupStmt = this.database.prepare(
        "SELECT * FROM group_chats WHERE id = ?",
      );
      const group = groupStmt.get(groupId);

      if (!group) {
        throw new Error("群聊不存在");
      }

      // 获取成员列表
      const membersStmt = this.database.prepare(`
        SELECT gm.*, c.nickname as contact_nickname, c.avatar as contact_avatar
        FROM group_members gm
        LEFT JOIN contacts c ON gm.member_did = c.did
        WHERE gm.group_id = ?
        ORDER BY gm.role DESC, gm.joined_at ASC
      `);
      const members = membersStmt.all(groupId);

      return {
        ...group,
        members: members || [],
      };
    } catch (error) {
      logger.error("[GroupChatManager] 获取群聊详情失败:", error);
      throw error;
    }
  }

  /**
   * 添加群成员
   */
  async addGroupMember(groupId, memberDid, role = "member") {
    try {
      const memberId = uuidv4();
      const now = Date.now();

      const stmt = this.database.prepare(`
        INSERT INTO group_members (id, group_id, member_did, role, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(memberId, groupId, memberDid, role, now);

      // 更新群成员数量
      const updateStmt = this.database.prepare(`
        UPDATE group_chats
        SET member_count = member_count + 1, updated_at = ?
        WHERE id = ?
      `);
      updateStmt.run(now, groupId);

      logger.info(
        "[GroupChatManager] 成员已添加:",
        memberDid,
        "到群聊:",
        groupId,
      );

      return { success: true, memberId };
    } catch (error) {
      logger.error("[GroupChatManager] 添加成员失败:", error);
      throw error;
    }
  }

  /**
   * 移除群成员
   */
  async removeGroupMember(groupId, memberDid) {
    try {
      // 检查权限
      const currentMember = await this.getGroupMember(
        groupId,
        this.currentUserDid,
      );
      if (
        !currentMember ||
        (currentMember.role !== "owner" && currentMember.role !== "admin")
      ) {
        throw new Error("没有权限移除成员");
      }

      const stmt = this.database.prepare(`
        DELETE FROM group_members
        WHERE group_id = ? AND member_did = ?
      `);
      stmt.run(groupId, memberDid);

      // 更新群成员数量
      const updateStmt = this.database.prepare(`
        UPDATE group_chats
        SET member_count = member_count - 1, updated_at = ?
        WHERE id = ?
      `);
      updateStmt.run(Date.now(), groupId);

      // 发送系统消息
      await this.sendSystemMessage(groupId, `成员 ${memberDid} 已被移出群聊`);

      this.database.saveToFile();

      logger.info("[GroupChatManager] 成员已移除:", memberDid);

      return { success: true };
    } catch (error) {
      logger.error("[GroupChatManager] 移除成员失败:", error);
      throw error;
    }
  }

  /**
   * 退出群聊
   */
  async leaveGroup(groupId) {
    try {
      if (!this.currentUserDid) {
        throw new Error("当前用户DID未设置");
      }

      const member = await this.getGroupMember(groupId, this.currentUserDid);
      if (!member) {
        throw new Error("您不是该群成员");
      }

      // 如果是群主，需要转让群主或解散群聊
      if (member.role === "owner") {
        throw new Error("群主不能直接退出，请先转让群主或解散群聊");
      }

      await this.removeGroupMember(groupId, this.currentUserDid);

      // 发送系统消息
      await this.sendSystemMessage(
        groupId,
        `成员 ${this.currentUserDid} 已退出群聊`,
      );

      logger.info("[GroupChatManager] 已退出群聊:", groupId);

      return { success: true };
    } catch (error) {
      logger.error("[GroupChatManager] 退出群聊失败:", error);
      throw error;
    }
  }

  /**
   * 解散群聊
   */
  async dismissGroup(groupId) {
    try {
      const member = await this.getGroupMember(groupId, this.currentUserDid);
      if (!member || member.role !== "owner") {
        throw new Error("只有群主可以解散群聊");
      }

      // 删除群聊（级联删除成员和消息）
      const stmt = this.database.prepare(
        "DELETE FROM group_chats WHERE id = ?",
      );
      stmt.run(groupId);

      this.database.saveToFile();

      logger.info("[GroupChatManager] 群聊已解散:", groupId);

      return { success: true };
    } catch (error) {
      logger.error("[GroupChatManager] 解散群聊失败:", error);
      throw error;
    }
  }

  /**
   * 发送群消息
   */
  async sendGroupMessage(groupId, content, options = {}) {
    const {
      messageType = "text",
      filePath = null,
      replyToId = null,
      mentions = [],
    } = options;

    try {
      if (!this.currentUserDid) {
        throw new Error("当前用户DID未设置");
      }

      // 检查是否是群成员
      const member = await this.getGroupMember(groupId, this.currentUserDid);
      if (!member) {
        throw new Error("您不是该群成员");
      }

      // 检查是否被禁言
      if (member.muted) {
        throw new Error("您已被禁言");
      }

      const messageId = uuidv4();
      const now = Date.now();

      // 获取群聊信息
      const groupStmt = this.database.prepare(
        "SELECT * FROM group_chats WHERE id = ?",
      );
      const group = groupStmt.get(groupId);

      if (!group) {
        throw new Error("群聊不存在");
      }

      // 加密消息内容（如果群聊启用了加密）
      let encryptedContent = content;
      let encryptionKeyId = null;

      if (group.group_type === "encrypted") {
        const encrypted = await this.encryptGroupMessage(groupId, content);
        encryptedContent = encrypted.ciphertext;
        encryptionKeyId = encrypted.keyId;
      }

      // 保存消息到数据库
      const insertStmt = this.database.prepare(`
        INSERT INTO group_messages (
          id, group_id, sender_did, content, message_type,
          file_path, encrypted, encryption_key_id, reply_to_id,
          mentions, timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(
        messageId,
        groupId,
        this.currentUserDid,
        encryptedContent,
        messageType,
        filePath,
        group.group_type === "encrypted" ? 1 : 0,
        encryptionKeyId,
        replyToId,
        mentions.length > 0 ? JSON.stringify(mentions) : null,
        now,
      );

      // 更新群聊最后更新时间
      const updateStmt = this.database.prepare(`
        UPDATE group_chats SET updated_at = ? WHERE id = ?
      `);
      updateStmt.run(now, groupId);

      this.database.saveToFile();

      // 通过P2P网络广播消息给所有群成员
      await this.broadcastGroupMessage(groupId, {
        messageId,
        groupId,
        senderDid: this.currentUserDid,
        content: encryptedContent,
        messageType,
        filePath,
        encrypted: group.group_type === "encrypted",
        encryptionKeyId,
        replyToId,
        mentions,
        timestamp: now,
      });

      logger.info("[GroupChatManager] 群消息已发送:", messageId);

      this.emit("message:sent", {
        messageId,
        groupId,
        content,
      });

      return {
        success: true,
        messageId,
        timestamp: now,
      };
    } catch (error) {
      logger.error("[GroupChatManager] 发送群消息失败:", error);
      throw error;
    }
  }

  /**
   * 获取群消息
   */
  async getGroupMessages(groupId, limit = 50, offset = 0) {
    try {
      const stmt = this.database.prepare(`
        SELECT gm.*, c.nickname as sender_nickname, c.avatar as sender_avatar
        FROM group_messages gm
        LEFT JOIN contacts c ON gm.sender_did = c.did
        WHERE gm.group_id = ?
        ORDER BY gm.timestamp DESC
        LIMIT ? OFFSET ?
      `);

      const messages = stmt.all(groupId, limit, offset);

      // 解密消息（如果需要）
      const decryptedMessages = [];
      for (const msg of messages) {
        if (msg.encrypted && msg.encryption_key_id) {
          try {
            const decrypted = await this.decryptGroupMessage(
              groupId,
              msg.content,
              msg.encryption_key_id,
            );
            decryptedMessages.push({
              ...msg,
              content: decrypted,
              decrypted: true,
            });
          } catch (error) {
            logger.error("[GroupChatManager] 解密消息失败:", error);
            decryptedMessages.push({
              ...msg,
              content: "[加密消息]",
              decryptFailed: true,
            });
          }
        } else {
          decryptedMessages.push(msg);
        }
      }

      return decryptedMessages;
    } catch (error) {
      logger.error("[GroupChatManager] 获取群消息失败:", error);
      return [];
    }
  }

  /**
   * 标记消息为已读
   */
  async markMessageAsRead(messageId, groupId) {
    try {
      if (!this.currentUserDid) {
        return { success: false };
      }

      const readId = uuidv4();
      const now = Date.now();

      const stmt = this.database.prepare(`
        INSERT OR IGNORE INTO group_message_reads (
          id, message_id, group_id, member_did, read_at
        )
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(readId, messageId, groupId, this.currentUserDid, now);
      this.database.saveToFile();

      return { success: true };
    } catch (error) {
      logger.error("[GroupChatManager] 标记已读失败:", error);
      return { success: false };
    }
  }

  /**
   * 获取群成员
   */
  async getGroupMember(groupId, memberDid) {
    try {
      const stmt = this.database.prepare(`
        SELECT * FROM group_members
        WHERE group_id = ? AND member_did = ?
      `);
      return stmt.get(groupId, memberDid);
    } catch (error) {
      logger.error("[GroupChatManager] 获取群成员失败:", error);
      return null;
    }
  }

  /**
   * 发送系统消息
   */
  async sendSystemMessage(groupId, content) {
    try {
      const messageId = uuidv4();
      const now = Date.now();

      const stmt = this.database.prepare(`
        INSERT INTO group_messages (
          id, group_id, sender_did, content, message_type,
          encrypted, timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(messageId, groupId, "system", content, "system", 0, now);

      return { success: true, messageId };
    } catch (error) {
      logger.error("[GroupChatManager] 发送系统消息失败:", error);
      return { success: false };
    }
  }

  /**
   * 生成群组加密密钥（Sender Key）
   */
  async generateGroupEncryptionKey(groupId) {
    try {
      const keyId = uuidv4();
      const chainKey = crypto.randomBytes(32).toString("base64");
      const signatureKey = crypto.randomBytes(32).toString("base64");
      const now = Date.now();

      // 保存到数据库
      const stmt = this.database.prepare(`
        INSERT INTO group_encryption_keys (
          id, group_id, key_id, sender_did, chain_key,
          signature_key, iteration, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        uuidv4(),
        groupId,
        keyId,
        this.currentUserDid,
        chainKey,
        signatureKey,
        0,
        now,
      );

      // 缓存密钥
      this.groupKeys.set(groupId, {
        keyId,
        chainKey,
        signatureKey,
        iteration: 0,
      });

      logger.info("[GroupChatManager] 群组加密密钥已生成:", keyId);

      return { keyId, chainKey, signatureKey };
    } catch (error) {
      logger.error("[GroupChatManager] 生成加密密钥失败:", error);
      throw error;
    }
  }

  /**
   * 加密群消息
   */
  async encryptGroupMessage(groupId, plaintext) {
    try {
      // 获取或生成群组密钥
      let keyData = this.groupKeys.get(groupId);

      if (!keyData) {
        // 从数据库加载
        const stmt = this.database.prepare(`
          SELECT * FROM group_encryption_keys
          WHERE group_id = ? AND sender_did = ?
          ORDER BY created_at DESC
          LIMIT 1
        `);
        const keyRecord = stmt.get(groupId, this.currentUserDid);

        if (keyRecord) {
          keyData = {
            keyId: keyRecord.key_id,
            chainKey: keyRecord.chain_key,
            signatureKey: keyRecord.signature_key,
            iteration: keyRecord.iteration,
          };
          this.groupKeys.set(groupId, keyData);
        } else {
          // 生成新密钥
          keyData = await this.generateGroupEncryptionKey(groupId);
        }
      }

      // 使用AES-256-GCM加密
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(
        "aes-256-gcm",
        Buffer.from(keyData.chainKey, "base64"),
        iv,
      );

      let encrypted = cipher.update(plaintext, "utf8", "base64");
      encrypted += cipher.final("base64");
      const authTag = cipher.getAuthTag();

      const ciphertext = JSON.stringify({
        iv: iv.toString("base64"),
        data: encrypted,
        tag: authTag.toString("base64"),
      });

      return {
        ciphertext,
        keyId: keyData.keyId,
      };
    } catch (error) {
      logger.error("[GroupChatManager] 加密消息失败:", error);
      throw error;
    }
  }

  /**
   * 解密群消息
   */
  async decryptGroupMessage(groupId, ciphertext, keyId) {
    try {
      // 获取密钥
      const stmt = this.database.prepare(`
        SELECT * FROM group_encryption_keys
        WHERE group_id = ? AND key_id = ?
      `);
      const keyRecord = stmt.get(groupId, keyId);

      if (!keyRecord) {
        throw new Error("加密密钥不存在");
      }

      const { iv, data, tag } = JSON.parse(ciphertext);

      // 使用AES-256-GCM解密
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        Buffer.from(keyRecord.chain_key, "base64"),
        Buffer.from(iv, "base64"),
      );

      decipher.setAuthTag(Buffer.from(tag, "base64"));

      let decrypted = decipher.update(data, "base64", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      logger.error("[GroupChatManager] 解密消息失败:", error);
      throw error;
    }
  }

  /**
   * 通过P2P网络广播群消息
   */
  async broadcastGroupMessage(groupId, message) {
    try {
      // 获取所有群成员
      const stmt = this.database.prepare(`
        SELECT member_did FROM group_members
        WHERE group_id = ? AND member_did != ?
      `);
      const members = stmt.all(groupId, this.currentUserDid);

      // 通过P2P网络发送给每个成员
      for (const member of members) {
        try {
          if (this.p2pManager) {
            await this.p2pManager.sendMessage(member.member_did, {
              type: "group:message",
              ...message,
            });
          }
        } catch (error) {
          logger.error(
            "[GroupChatManager] 发送消息给成员失败:",
            member.member_did,
            error,
          );
        }
      }

      logger.info(
        "[GroupChatManager] 群消息已广播给",
        members.length,
        "个成员",
      );
    } catch (error) {
      logger.error("[GroupChatManager] 广播群消息失败:", error);
    }
  }

  /**
   * 通知群成员
   */
  async notifyGroupMembers(groupId, notification) {
    try {
      const stmt = this.database.prepare(`
        SELECT member_did FROM group_members
        WHERE group_id = ? AND member_did != ?
      `);
      const members = stmt.all(groupId, this.currentUserDid);

      for (const member of members) {
        try {
          if (this.p2pManager) {
            await this.p2pManager.sendMessage(member.member_did, notification);
          }
        } catch (error) {
          logger.error(
            "[GroupChatManager] 通知成员失败:",
            member.member_did,
            error,
          );
        }
      }
    } catch (error) {
      logger.error("[GroupChatManager] 通知群成员失败:", error);
    }
  }

  /**
   * 更新群信息
   */
  async updateGroupInfo(groupId, updates) {
    try {
      const member = await this.getGroupMember(groupId, this.currentUserDid);
      if (!member || (member.role !== "owner" && member.role !== "admin")) {
        throw new Error("没有权限修改群信息");
      }

      const { name, description, avatar } = updates;
      const fields = [];
      const values = [];

      if (name !== undefined) {
        fields.push("name = ?");
        values.push(name);
      }
      if (description !== undefined) {
        fields.push("description = ?");
        values.push(description);
      }
      if (avatar !== undefined) {
        fields.push("avatar = ?");
        values.push(avatar);
      }

      if (fields.length === 0) {
        return { success: true };
      }

      fields.push("updated_at = ?");
      values.push(Date.now());
      values.push(groupId);

      const stmt = this.database.prepare(`
        UPDATE group_chats
        SET ${fields.join(", ")}
        WHERE id = ?
      `);

      stmt.run(...values);
      this.database.saveToFile();

      // 通知群成员
      await this.notifyGroupMembers(groupId, {
        type: "group:updated",
        groupId,
        updates,
      });

      return { success: true };
    } catch (error) {
      logger.error("[GroupChatManager] 更新群信息失败:", error);
      throw error;
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.groupKeys.clear();
    this.removeAllListeners();
    logger.info("[GroupChatManager] 资源已清理");
  }
}

module.exports = GroupChatManager;
