/**
 * Email IPC Handlers
 * 处理邮件相关的 IPC 通信
 *
 * v0.20.0: 新增邮件集成功能
 */

const { logger, createLogger } = require("../utils/logger.js");
const { ipcMain } = require("electron");
const { v4: uuidv4 } = require("uuid");
const EmailClient = require("./email-client");
const fs = require("fs").promises;
const path = require("path");

class EmailIPCHandler {
  constructor(database, appDataPath) {
    this.database = database;
    this.appDataPath = appDataPath;
    this.emailClients = new Map(); // 存储邮件客户端实例
    this.syncIntervals = new Map(); // 存储自动同步定时器
    this.registerHandlers();
  }

  registerHandlers() {
    // 邮件账户管理
    ipcMain.handle("email:add-account", async (event, config) => {
      return this.addAccount(config);
    });

    ipcMain.handle("email:remove-account", async (event, accountId) => {
      return this.removeAccount(accountId);
    });

    ipcMain.handle(
      "email:update-account",
      async (event, accountId, updates) => {
        return this.updateAccount(accountId, updates);
      },
    );

    ipcMain.handle("email:get-accounts", async (event) => {
      return this.getAccounts();
    });

    ipcMain.handle("email:get-account", async (event, accountId) => {
      return this.getAccount(accountId);
    });

    ipcMain.handle("email:test-connection", async (event, config) => {
      return this.testConnection(config);
    });

    // 邮箱管理
    ipcMain.handle("email:get-mailboxes", async (event, accountId) => {
      return this.getMailboxes(accountId);
    });

    ipcMain.handle("email:sync-mailboxes", async (event, accountId) => {
      return this.syncMailboxes(accountId);
    });

    // 邮件管理
    ipcMain.handle(
      "email:fetch-emails",
      async (event, accountId, options = {}) => {
        return this.fetchEmails(accountId, options);
      },
    );

    ipcMain.handle("email:get-emails", async (event, options = {}) => {
      return this.getEmails(options);
    });

    ipcMain.handle("email:get-email", async (event, emailId) => {
      return this.getEmail(emailId);
    });

    ipcMain.handle("email:mark-as-read", async (event, emailId) => {
      return this.markAsRead(emailId);
    });

    ipcMain.handle("email:mark-as-unread", async (event, emailId) => {
      return this.markAsUnread(emailId);
    });

    ipcMain.handle(
      "email:mark-as-starred",
      async (event, emailId, starred = true) => {
        return this.markAsStarred(emailId, starred);
      },
    );

    ipcMain.handle("email:save-draft", async (event, accountId, draftData) => {
      return this.saveDraft(accountId, draftData);
    });

    ipcMain.handle("email:get-drafts", async (event, accountId) => {
      return this.getDrafts(accountId);
    });

    ipcMain.handle("email:delete-draft", async (event, draftId) => {
      return this.deleteDraft(draftId);
    });

    ipcMain.handle("email:archive-email", async (event, emailId) => {
      return this.archiveEmail(emailId);
    });

    ipcMain.handle("email:delete-email", async (event, emailId) => {
      return this.deleteEmail(emailId);
    });

    ipcMain.handle(
      "email:send-email",
      async (event, accountId, mailOptions) => {
        return this.sendEmail(accountId, mailOptions);
      },
    );

    ipcMain.handle("email:save-to-knowledge", async (event, emailId) => {
      return this.saveToKnowledge(emailId);
    });

    // 附件管理
    ipcMain.handle("email:get-attachments", async (event, emailId) => {
      return this.getAttachments(emailId);
    });

    ipcMain.handle(
      "email:download-attachment",
      async (event, attachmentId, savePath) => {
        return this.downloadAttachment(attachmentId, savePath);
      },
    );

    // 标签管理
    ipcMain.handle("email:add-label", async (event, name, options = {}) => {
      return this.addLabel(name, options);
    });

    ipcMain.handle("email:get-labels", async (event) => {
      return this.getLabels();
    });

    ipcMain.handle("email:assign-label", async (event, emailId, labelId) => {
      return this.assignLabel(emailId, labelId);
    });

    ipcMain.handle("email:remove-label", async (event, emailId, labelId) => {
      return this.removeLabel(emailId, labelId);
    });

    // 自动同步
    ipcMain.handle("email:start-auto-sync", async (event, accountId) => {
      return this.startAutoSync(accountId);
    });

    ipcMain.handle("email:stop-auto-sync", async (event, accountId) => {
      return this.stopAutoSync(accountId);
    });

    logger.info("[EmailIPCHandler] Email IPC handlers registered");
  }

  /**
   * 获取或创建邮件客户端
   */
  getEmailClient(accountId) {
    if (!this.emailClients.has(accountId)) {
      const client = new EmailClient();
      this.emailClients.set(accountId, client);
    }
    return this.emailClients.get(accountId);
  }

  /**
   * 添加邮件账户
   */
  async addAccount(config) {
    try {
      // 测试连接
      const client = new EmailClient();
      client.configure(config);
      const testResult = await client.testConnection();

      if (!testResult.success) {
        throw new Error(testResult.error);
      }

      const accountId = uuidv4();
      const now = Date.now();

      // 保存账户
      const stmt = this.database.db.prepare(`
        INSERT INTO email_accounts (
          id, email, display_name, imap_host, imap_port, imap_tls,
          smtp_host, smtp_port, smtp_secure, password,
          status, sync_frequency, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
        accountId,
        config.email,
        config.displayName || config.email,
        config.imapHost,
        config.imapPort || 993,
        config.imapTls !== false ? 1 : 0,
        config.smtpHost,
        config.smtpPort || 587,
        config.smtpSecure ? 1 : 0,
        config.password,
        "active",
        config.syncFrequency || 300,
        now,
        now,
      ]);

      // 同步邮箱列表
      await this.syncMailboxes(accountId);

      // 启动自动同步
      if (config.autoSync !== false) {
        this.startAutoSync(accountId);
      }

      return { success: true, accountId };
    } catch (error) {
      logger.error("[EmailIPCHandler] 添加账户失败:", error);
      throw error;
    }
  }

  /**
   * 删除邮件账户
   */
  async removeAccount(accountId) {
    try {
      // 停止自动同步
      this.stopAutoSync(accountId);

      // 断开连接
      const client = this.emailClients.get(accountId);
      if (client) {
        client.disconnect();
        this.emailClients.delete(accountId);
      }

      // 删除账户
      const stmt = this.database.db.prepare(
        "DELETE FROM email_accounts WHERE id = ?",
      );
      stmt.run([accountId]);

      return { success: true };
    } catch (error) {
      logger.error("[EmailIPCHandler] 删除账户失败:", error);
      throw error;
    }
  }

  /**
   * 更新邮件账户
   */
  async updateAccount(accountId, updates) {
    try {
      const fields = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }

      fields.push("updated_at = ?");
      values.push(Date.now());
      values.push(accountId);

      const stmt = this.database.db.prepare(`
        UPDATE email_accounts SET ${fields.join(", ")} WHERE id = ?
      `);
      stmt.run(values);

      // 如果更新了配置，需要重新配置客户端
      if (this.emailClients.has(accountId)) {
        this.emailClients.delete(accountId);
      }

      return { success: true };
    } catch (error) {
      logger.error("[EmailIPCHandler] 更新账户失败:", error);
      throw error;
    }
  }

  /**
   * 获取账户列表
   */
  async getAccounts() {
    try {
      const stmt = this.database.db.prepare(
        "SELECT * FROM email_accounts ORDER BY email",
      );
      const accounts = stmt.all([]);

      // 不返回密码
      accounts.forEach((account) => {
        delete account.password;
      });

      return { success: true, accounts };
    } catch (error) {
      logger.error("[EmailIPCHandler] 获取账户列表失败:", error);
      throw error;
    }
  }

  /**
   * 获取单个账户
   */
  async getAccount(accountId) {
    try {
      const stmt = this.database.db.prepare(
        "SELECT * FROM email_accounts WHERE id = ?",
      );
      const account = stmt.get([accountId]);

      if (!account) {
        throw new Error("账户不存在");
      }

      delete account.password;

      return { success: true, account };
    } catch (error) {
      logger.error("[EmailIPCHandler] 获取账户失败:", error);
      throw error;
    }
  }

  /**
   * 测试连接
   */
  async testConnection(config) {
    try {
      const client = new EmailClient();
      client.configure(config);
      const result = await client.testConnection();

      return { success: true, result };
    } catch (error) {
      logger.error("[EmailIPCHandler] 测试连接失败:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 同步邮箱列表
   */
  async syncMailboxes(accountId) {
    try {
      const accountStmt = this.database.db.prepare(
        "SELECT * FROM email_accounts WHERE id = ?",
      );
      const account = accountStmt.get([accountId]);

      if (!account) {
        throw new Error("账户不存在");
      }

      const client = this.getEmailClient(accountId);
      client.configure({
        email: account.email,
        password: account.password,
        imapHost: account.imap_host,
        imapPort: account.imap_port,
        imapTls: account.imap_tls === 1,
        smtpHost: account.smtp_host,
        smtpPort: account.smtp_port,
        smtpSecure: account.smtp_secure === 1,
      });

      await client.connect();
      const mailboxes = await client.getMailboxes();
      client.disconnect();

      // 保存邮箱
      const stmt = this.database.db.prepare(`
        INSERT OR REPLACE INTO email_mailboxes (
          id, account_id, name, display_name, delimiter, flags, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const flattenMailboxes = (boxes, prefix = "") => {
        const result = [];
        for (const box of boxes) {
          result.push(box);
          if (box.children && box.children.length > 0) {
            result.push(...flattenMailboxes(box.children, box.name));
          }
        }
        return result;
      };

      const allMailboxes = flattenMailboxes(mailboxes);

      for (const mailbox of allMailboxes) {
        const mailboxId = uuidv4();
        stmt.run([
          mailboxId,
          accountId,
          mailbox.name,
          mailbox.displayName,
          mailbox.delimiter,
          JSON.stringify(mailbox.flags),
          Date.now(),
        ]);
      }

      return { success: true, mailboxes: allMailboxes.length };
    } catch (error) {
      logger.error("[EmailIPCHandler] 同步邮箱失败:", error);
      throw error;
    }
  }

  /**
   * 获取邮箱列表
   */
  async getMailboxes(accountId) {
    try {
      const stmt = this.database.db.prepare(
        "SELECT * FROM email_mailboxes WHERE account_id = ? ORDER BY name",
      );
      const mailboxes = stmt.all([accountId]);

      return { success: true, mailboxes };
    } catch (error) {
      logger.error("[EmailIPCHandler] 获取邮箱列表失败:", error);
      throw error;
    }
  }

  /**
   * 获取邮件
   */
  async fetchEmails(accountId, options = {}) {
    try {
      const accountStmt = this.database.db.prepare(
        "SELECT * FROM email_accounts WHERE id = ?",
      );
      const account = accountStmt.get([accountId]);

      if (!account) {
        throw new Error("账户不存在");
      }

      const client = this.getEmailClient(accountId);
      client.configure({
        email: account.email,
        password: account.password,
        imapHost: account.imap_host,
        imapPort: account.imap_port,
        imapTls: account.imap_tls === 1,
        smtpHost: account.smtp_host,
        smtpPort: account.smtp_port,
        smtpSecure: account.smtp_secure === 1,
      });

      await client.connect();
      const emails = await client.fetchEmails(options);
      client.disconnect();

      // 保存邮件
      await this.saveEmails(accountId, options.mailbox || "INBOX", emails);

      // 更新同步时间
      const updateStmt = this.database.db.prepare(
        "UPDATE email_accounts SET last_sync_at = ? WHERE id = ?",
      );
      updateStmt.run([Date.now(), accountId]);

      return { success: true, count: emails.length };
    } catch (error) {
      logger.error("[EmailIPCHandler] 获取邮件失败:", error);

      // 更新错误状态
      const updateStmt = this.database.db.prepare(
        "UPDATE email_accounts SET status = 'error', error_message = ? WHERE id = ?",
      );
      updateStmt.run([error.message, accountId]);

      throw error;
    }
  }

  /**
   * 保存邮件到数据库
   */
  async saveEmails(accountId, mailboxName, emails) {
    // 获取邮箱 ID
    const mailboxStmt = this.database.db.prepare(
      "SELECT id FROM email_mailboxes WHERE account_id = ? AND name = ?",
    );
    const mailbox = mailboxStmt.get([accountId, mailboxName]);

    if (!mailbox) {
      throw new Error("邮箱不存在");
    }

    const emailStmt = this.database.db.prepare(`
      INSERT OR IGNORE INTO emails (
        id, account_id, mailbox_id, message_id, uid, subject,
        from_address, to_address, cc_address, date,
        text_content, html_content, has_attachments, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const attachmentStmt = this.database.db.prepare(`
      INSERT INTO email_attachments (
        id, email_id, filename, content_type, size, file_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const email of emails) {
      const emailId = uuidv4();

      emailStmt.run([
        emailId,
        accountId,
        mailbox.id,
        email.messageId,
        email.uid,
        email.subject,
        email.from,
        email.to,
        email.cc,
        email.date,
        email.text,
        email.html,
        email.attachments.length > 0 ? 1 : 0,
        Date.now(),
      ]);

      // 保存附件
      for (const attachment of email.attachments) {
        const attachmentId = uuidv4();
        const attachmentPath = path.join(
          this.appDataPath,
          "attachments",
          accountId,
          attachmentId,
        );

        // 创建目录
        await fs.mkdir(path.dirname(attachmentPath), { recursive: true });

        // 保存附件文件
        await fs.writeFile(attachmentPath, attachment.content);

        attachmentStmt.run([
          attachmentId,
          emailId,
          attachment.filename,
          attachment.contentType,
          attachment.size,
          attachmentPath,
          Date.now(),
        ]);
      }
    }
  }

  /**
   * 获取邮件列表
   */
  async getEmails(options = {}) {
    try {
      let query = "SELECT * FROM emails";
      const conditions = [];
      const params = [];

      if (options.accountId) {
        conditions.push("account_id = ?");
        params.push(options.accountId);
      }

      if (options.mailboxId) {
        conditions.push("mailbox_id = ?");
        params.push(options.mailboxId);
      }

      if (options.isRead !== undefined) {
        conditions.push("is_read = ?");
        params.push(options.isRead ? 1 : 0);
      }

      if (options.isStarred !== undefined) {
        conditions.push("is_starred = ?");
        params.push(options.isStarred ? 1 : 0);
      }

      if (options.isArchived !== undefined) {
        conditions.push("is_archived = ?");
        params.push(options.isArchived ? 1 : 0);
      }

      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }

      query += " ORDER BY date DESC";

      if (options.limit) {
        query += ` LIMIT ${options.limit}`;
      }

      const stmt = this.database.db.prepare(query);
      const emails = stmt.all(params);

      return { success: true, emails };
    } catch (error) {
      logger.error("[EmailIPCHandler] 获取邮件列表失败:", error);
      throw error;
    }
  }

  /**
   * 获取单封邮件
   */
  async getEmail(emailId) {
    try {
      const stmt = this.database.db.prepare(
        "SELECT * FROM emails WHERE id = ?",
      );
      const email = stmt.get([emailId]);

      if (!email) {
        throw new Error("邮件不存在");
      }

      return { success: true, email };
    } catch (error) {
      logger.error("[EmailIPCHandler] 获取邮件失败:", error);
      throw error;
    }
  }

  /**
   * 标记为已读
   */
  async markAsRead(emailId) {
    try {
      const stmt = this.database.db.prepare(
        "UPDATE emails SET is_read = 1 WHERE id = ?",
      );
      stmt.run([emailId]);

      return { success: true };
    } catch (error) {
      logger.error("[EmailIPCHandler] 标记已读失败:", error);
      throw error;
    }
  }

  /**
   * 标记为未读
   */
  async markAsUnread(emailId) {
    try {
      const stmt = this.database.db.prepare(
        "UPDATE emails SET is_read = 0 WHERE id = ?",
      );
      stmt.run([emailId]);

      return { success: true };
    } catch (error) {
      logger.error("[EmailIPCHandler] 标记未读失败:", error);
      throw error;
    }
  }

  /**
   * 标记为收藏
   */
  async markAsStarred(emailId, starred = true) {
    try {
      const stmt = this.database.db.prepare(
        "UPDATE emails SET is_starred = ? WHERE id = ?",
      );
      stmt.run([starred ? 1 : 0, emailId]);

      return { success: true };
    } catch (error) {
      logger.error("[EmailIPCHandler] 标记收藏失败:", error);
      throw error;
    }
  }

  /**
   * 归档邮件
   */
  async archiveEmail(emailId) {
    try {
      const stmt = this.database.db.prepare(
        "UPDATE emails SET is_archived = 1 WHERE id = ?",
      );
      stmt.run([emailId]);

      return { success: true };
    } catch (error) {
      logger.error("[EmailIPCHandler] 归档邮件失败:", error);
      throw error;
    }
  }

  /**
   * 删除邮件
   */
  async deleteEmail(emailId) {
    try {
      const stmt = this.database.db.prepare("DELETE FROM emails WHERE id = ?");
      stmt.run([emailId]);

      return { success: true };
    } catch (error) {
      logger.error("[EmailIPCHandler] 删除邮件失败:", error);
      throw error;
    }
  }

  /**
   * 发送邮件
   */
  async sendEmail(accountId, mailOptions) {
    try {
      const accountStmt = this.database.db.prepare(
        "SELECT * FROM email_accounts WHERE id = ?",
      );
      const account = accountStmt.get([accountId]);

      if (!account) {
        throw new Error("账户不存在");
      }

      const client = this.getEmailClient(accountId);
      client.configure({
        email: account.email,
        password: account.password,
        imapHost: account.imap_host,
        imapPort: account.imap_port,
        imapTls: account.imap_tls === 1,
        smtpHost: account.smtp_host,
        smtpPort: account.smtp_port,
        smtpSecure: account.smtp_secure === 1,
      });

      const result = await client.sendEmail(mailOptions);

      return { success: true, result };
    } catch (error) {
      logger.error("[EmailIPCHandler] 发送邮件失败:", error);
      throw error;
    }
  }

  /**
   * 保存草稿
   */
  async saveDraft(accountId, draftData) {
    try {
      const draftId = draftData.id || uuidv4();
      const now = Date.now();

      // 检查是否是更新已有草稿
      if (draftData.id) {
        const updateStmt = this.database.db.prepare(`
          UPDATE email_drafts SET
            to_address = ?,
            cc_address = ?,
            bcc_address = ?,
            subject = ?,
            text_content = ?,
            html_content = ?,
            attachments = ?,
            updated_at = ?
          WHERE id = ?
        `);

        updateStmt.run([
          JSON.stringify(draftData.to || []),
          JSON.stringify(draftData.cc || []),
          JSON.stringify(draftData.bcc || []),
          draftData.subject || "",
          draftData.text || "",
          draftData.html || "",
          JSON.stringify(draftData.attachments || []),
          now,
          draftData.id,
        ]);
      } else {
        // 创建新草稿
        const insertStmt = this.database.db.prepare(`
          INSERT INTO email_drafts (
            id, account_id, to_address, cc_address, bcc_address,
            subject, text_content, html_content, attachments,
            reply_to_id, forward_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        insertStmt.run([
          draftId,
          accountId,
          JSON.stringify(draftData.to || []),
          JSON.stringify(draftData.cc || []),
          JSON.stringify(draftData.bcc || []),
          draftData.subject || "",
          draftData.text || "",
          draftData.html || "",
          JSON.stringify(draftData.attachments || []),
          draftData.replyToId || null,
          draftData.forwardId || null,
          now,
          now,
        ]);
      }

      return { success: true, draftId };
    } catch (error) {
      logger.error("[EmailIPCHandler] 保存草稿失败:", error);
      throw error;
    }
  }

  /**
   * 获取草稿列表
   */
  async getDrafts(accountId) {
    try {
      const stmt = this.database.db.prepare(
        "SELECT * FROM email_drafts WHERE account_id = ? ORDER BY updated_at DESC",
      );
      const drafts = stmt.all([accountId]);

      // 解析 JSON 字段
      drafts.forEach((draft) => {
        draft.to_address = JSON.parse(draft.to_address || "[]");
        draft.cc_address = JSON.parse(draft.cc_address || "[]");
        draft.bcc_address = JSON.parse(draft.bcc_address || "[]");
        draft.attachments = JSON.parse(draft.attachments || "[]");
      });

      return { success: true, drafts };
    } catch (error) {
      logger.error("[EmailIPCHandler] 获取草稿列表失败:", error);
      throw error;
    }
  }

  /**
   * 删除草稿
   */
  async deleteDraft(draftId) {
    try {
      const stmt = this.database.db.prepare(
        "DELETE FROM email_drafts WHERE id = ?",
      );
      stmt.run([draftId]);

      return { success: true };
    } catch (error) {
      logger.error("[EmailIPCHandler] 删除草稿失败:", error);
      throw error;
    }
  }

  /**
   * 保存到知识库
   */
  async saveToKnowledge(emailId) {
    try {
      const emailStmt = this.database.db.prepare(
        "SELECT * FROM emails WHERE id = ?",
      );
      const email = emailStmt.get([emailId]);

      if (!email) {
        throw new Error("邮件不存在");
      }

      // 创建知识库条目
      const knowledgeId = uuidv4();
      const now = Date.now();

      const content = `# ${email.subject}\n\n**发件人:** ${email.from_address}\n**收件人:** ${email.to_address}\n**日期:** ${email.date}\n\n---\n\n${email.text_content || email.html_content}`;

      const knowledgeStmt = this.database.db.prepare(`
        INSERT INTO knowledge_items (
          id, title, type, content, created_at, updated_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      knowledgeStmt.run([
        knowledgeId,
        email.subject,
        "document",
        content,
        now,
        now,
        "pending",
      ]);

      // 更新邮件关联
      const updateStmt = this.database.db.prepare(
        "UPDATE emails SET knowledge_item_id = ? WHERE id = ?",
      );
      updateStmt.run([knowledgeId, emailId]);

      return { success: true, knowledgeId };
    } catch (error) {
      logger.error("[EmailIPCHandler] 保存到知识库失败:", error);
      throw error;
    }
  }

  /**
   * 获取附件列表
   */
  async getAttachments(emailId) {
    try {
      const stmt = this.database.db.prepare(
        "SELECT * FROM email_attachments WHERE email_id = ?",
      );
      const attachments = stmt.all([emailId]);

      return { success: true, attachments };
    } catch (error) {
      logger.error("[EmailIPCHandler] 获取附件列表失败:", error);
      throw error;
    }
  }

  /**
   * 下载附件
   */
  async downloadAttachment(attachmentId, savePath) {
    try {
      const stmt = this.database.db.prepare(
        "SELECT * FROM email_attachments WHERE id = ?",
      );
      const attachment = stmt.get([attachmentId]);

      if (!attachment) {
        throw new Error("附件不存在");
      }

      // 复制文件
      await fs.copyFile(attachment.file_path, savePath);

      return { success: true };
    } catch (error) {
      logger.error("[EmailIPCHandler] 下载附件失败:", error);
      throw error;
    }
  }

  /**
   * 添加标签
   */
  async addLabel(name, options = {}) {
    try {
      const labelId = uuidv4();
      const stmt = this.database.db.prepare(`
        INSERT INTO email_labels (id, name, color, icon, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run([
        labelId,
        name,
        options.color || "#1890ff",
        options.icon || null,
        Date.now(),
      ]);

      return { success: true, labelId };
    } catch (error) {
      logger.error("[EmailIPCHandler] 添加标签失败:", error);
      throw error;
    }
  }

  /**
   * 获取标签列表
   */
  async getLabels() {
    try {
      const stmt = this.database.db.prepare(
        "SELECT * FROM email_labels ORDER BY name",
      );
      const labels = stmt.all([]);

      return { success: true, labels };
    } catch (error) {
      logger.error("[EmailIPCHandler] 获取标签列表失败:", error);
      throw error;
    }
  }

  /**
   * 分配标签
   */
  async assignLabel(emailId, labelId) {
    try {
      const stmt = this.database.db.prepare(`
        INSERT OR IGNORE INTO email_label_mappings (email_id, label_id, created_at)
        VALUES (?, ?, ?)
      `);

      stmt.run([emailId, labelId, Date.now()]);

      return { success: true };
    } catch (error) {
      logger.error("[EmailIPCHandler] 分配标签失败:", error);
      throw error;
    }
  }

  /**
   * 移除标签
   */
  async removeLabel(emailId, labelId) {
    try {
      const stmt = this.database.db.prepare(
        "DELETE FROM email_label_mappings WHERE email_id = ? AND label_id = ?",
      );
      stmt.run([emailId, labelId]);

      return { success: true };
    } catch (error) {
      logger.error("[EmailIPCHandler] 移除标签失败:", error);
      throw error;
    }
  }

  /**
   * 启动自动同步
   */
  startAutoSync(accountId) {
    try {
      // 如果已存在，先停止
      this.stopAutoSync(accountId);

      const accountStmt = this.database.db.prepare(
        "SELECT sync_frequency FROM email_accounts WHERE id = ?",
      );
      const account = accountStmt.get([accountId]);

      if (!account) {
        return { success: false, error: "账户不存在" };
      }

      const interval = setInterval(async () => {
        try {
          await this.fetchEmails(accountId, { limit: 50, unseen: true });
          logger.info(`[EmailIPCHandler] 自动同步完成: ${accountId}`);
        } catch (error) {
          logger.error(`[EmailIPCHandler] 自动同步失败: ${accountId}`, error);
        }
      }, account.sync_frequency * 1000);

      this.syncIntervals.set(accountId, interval);

      return { success: true };
    } catch (error) {
      logger.error("[EmailIPCHandler] 启动自动同步失败:", error);
      throw error;
    }
  }

  /**
   * 停止自动同步
   */
  stopAutoSync(accountId) {
    const interval = this.syncIntervals.get(accountId);
    if (interval) {
      clearInterval(interval);
      this.syncIntervals.delete(accountId);
    }
    return { success: true };
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 停止所有自动同步
    for (const [accountId, interval] of this.syncIntervals) {
      clearInterval(interval);
    }
    this.syncIntervals.clear();

    // 断开所有连接
    for (const [accountId, client] of this.emailClients) {
      client.disconnect();
    }
    this.emailClients.clear();
  }
}

module.exports = EmailIPCHandler;
