/**
 * Email IPC Handlers
 * 处理邮件相关的 IPC 通信
 *
 * v0.20.0: 新增邮件集成功能
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EmailClient = require("./email-client");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const {
  EmailIPCBoundaryError,
  assertBoundedString,
  boundedQueryLimit,
  boundedSyncSeconds,
  createEmailIPCLimits,
  normalizeAccountConfig,
  normalizeAccountUpdates,
  normalizeDraftData,
  normalizeEmailListOptions,
  normalizeFetchOptions,
  normalizeMailOptions,
  truncateUtf8,
} = require("./email-ipc-boundaries.js");
const { EmailCredentialStore } = require("./email-credential-store.js");

const EMAIL_IPC_CHANNELS = Object.freeze([
  "email:add-account",
  "email:remove-account",
  "email:update-account",
  "email:get-accounts",
  "email:get-account",
  "email:test-connection",
  "email:get-mailboxes",
  "email:sync-mailboxes",
  "email:fetch-emails",
  "email:get-emails",
  "email:get-email",
  "email:mark-as-read",
  "email:mark-as-unread",
  "email:mark-as-starred",
  "email:save-draft",
  "email:get-drafts",
  "email:get-draft",
  "email:delete-draft",
  "email:archive-email",
  "email:delete-email",
  "email:send-email",
  "email:save-to-knowledge",
  "email:get-attachments",
  "email:download-attachment",
  "email:add-label",
  "email:get-labels",
  "email:assign-label",
  "email:remove-label",
  "email:start-auto-sync",
  "email:stop-auto-sync",
]);

class EmailIPCHandler {
  constructor(database, appDataPathOrOptions, maybeOptions = {}) {
    const options =
      typeof appDataPathOrOptions === "string"
        ? maybeOptions
        : appDataPathOrOptions || {};
    this.database = database;
    this.appDataPath =
      typeof appDataPathOrOptions === "string"
        ? appDataPathOrOptions
        : options.appDataPath;
    if (!this.appDataPath) {
      throw new Error("Email IPC requires an application data path");
    }
    this.limits = createEmailIPCLimits(options.limits || options);
    this.ipcMain = options.ipcMain || require("electron").ipcMain;
    this.clientFactory =
      options.clientFactory || (() => new EmailClient({ limits: this.limits }));
    this.credentialStore =
      options.credentialStore ||
      new EmailCredentialStore({
        limits: this.limits,
        storagePath: path.join(this.appDataPath, "email-credentials.enc"),
      });
    this.showSaveDialog =
      options.showSaveDialog ||
      ((dialogOptions) =>
        require("electron").dialog.showSaveDialog(dialogOptions));
    this.fs = options.fs || fs;
    this.setInterval = options.setInterval || setInterval;
    this.clearInterval = options.clearInterval || clearInterval;
    this.emailClients = new Map();
    this.syncIntervals = new Map();
    this.fetchInFlight = new Set();
    this.handlersRegistered = false;
    this.cleanedUp = false;
    if (options.migrateCredentials !== false) {
      this.credentialStore.migrateDatabase(this.database);
    }
    if (options.registerHandlers !== false) {
      this.registerHandlers();
    }
  }

  registerHandlers() {
    if (this.cleanedUp) {
      throw new EmailIPCBoundaryError(
        "CANCELED",
        "email_ipc_lifecycle",
        "Email IPC handler has been cleaned up",
      );
    }
    if (this.handlersRegistered) return;
    if (!this.ipcMain?.handle) {
      throw new Error("Electron ipcMain.handle is unavailable");
    }
    const { ipcMain } = this;
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

    ipcMain.handle("email:get-draft", async (event, draftId) => {
      return this.getDraft(draftId);
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

    ipcMain.handle("email:download-attachment", async (event, attachmentId) => {
      return this.downloadAttachment(attachmentId);
    });

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

    this.handlersRegistered = true;
    logger.info("[EmailIPCHandler] Email IPC handlers registered");
  }

  /**
   * 获取或创建邮件客户端
   */
  getEmailClient(accountId) {
    this.assertActive();
    this.assertId(accountId, "email_account_id");
    if (this.emailClients.has(accountId)) {
      throw new EmailIPCBoundaryError(
        "OVERLOADED",
        "email_account_operation",
        "Another email operation is already active for this account",
      );
    }
    if (this.emailClients.size >= this.limits.maxClients) {
      throw new EmailIPCBoundaryError(
        "OVERLOADED",
        "email_clients",
        "Email client capacity is exhausted",
        { limit: { maxItems: this.limits.maxClients } },
      );
    }
    const client = this.clientFactory();
    this.emailClients.set(accountId, client);
    return client;
  }

  releaseEmailClient(accountId, client) {
    try {
      client?.disconnect();
    } catch (error) {
      logger.warn("[EmailIPCHandler] email client release failed:", error);
    } finally {
      if (this.emailClients.get(accountId) === client) {
        this.emailClients.delete(accountId);
      }
    }
  }

  assertActive() {
    if (this.cleanedUp) {
      throw new EmailIPCBoundaryError(
        "CANCELED",
        "email_ipc_lifecycle",
        "Email IPC handler has been cleaned up",
      );
    }
  }

  assertId(value, scope = "email_id") {
    this.assertActive();
    return assertBoundedString(value, scope, this.limits.maxIdBytes);
  }

  getAccountRecord(accountId) {
    const id = this.assertId(accountId, "email_account_id");
    const account = this.database.db
      .prepare("SELECT * FROM email_accounts WHERE id = ?")
      .get([id]);
    if (!account) {
      throw new EmailIPCBoundaryError(
        "NOT_FOUND",
        "email_account",
        "Email account does not exist",
      );
    }
    return account;
  }

  configureClient(client, account) {
    client.configure({
      email: account.email,
      password: this.credentialStore.getPassword(account.id, account.password),
      imapHost: account.imap_host,
      imapPort: account.imap_port,
      imapTls: account.imap_tls === 1,
      smtpHost: account.smtp_host,
      smtpPort: account.smtp_port,
      smtpSecure: account.smtp_secure === 1,
    });
  }

  /**
   * 添加邮件账户
   */
  async addAccount(config) {
    try {
      this.assertActive();
      const normalized = normalizeAccountConfig(config, this.limits);
      const row = this.database.db
        .prepare("SELECT COUNT(*) AS count FROM email_accounts")
        .get([]);
      if (Number(row?.count || 0) >= this.limits.maxAccounts) {
        throw new EmailIPCBoundaryError(
          "OVERLOADED",
          "email_accounts",
          "Email account capacity is exhausted",
          { limit: { maxItems: this.limits.maxAccounts } },
        );
      }

      const client = this.clientFactory();
      client.configure(normalized);
      const testResult = await client.testConnection();

      if (!testResult.success) {
        throw new Error(testResult.error);
      }

      const accountId = uuidv4();
      const now = Date.now();
      const credentialRef = this.credentialStore.setPassword(
        accountId,
        normalized.password,
      );

      // 保存账户
      const stmt = this.database.db.prepare(`
        INSERT INTO email_accounts (
          id, email, display_name, imap_host, imap_port, imap_tls,
          smtp_host, smtp_port, smtp_secure, password,
          status, sync_frequency, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      try {
        stmt.run([
          accountId,
          normalized.email,
          normalized.displayName,
          normalized.imapHost,
          normalized.imapPort,
          normalized.imapTls ? 1 : 0,
          normalized.smtpHost,
          normalized.smtpPort,
          normalized.smtpSecure ? 1 : 0,
          credentialRef,
          "active",
          normalized.syncFrequency,
          now,
          now,
        ]);
      } catch (error) {
        try {
          this.credentialStore.deletePassword(accountId);
        } catch (cleanupError) {
          logger.warn(
            "[EmailIPCHandler] failed to roll back email credential:",
            cleanupError.message,
          );
        }
        throw error;
      }

      // 同步邮箱列表
      await this.syncMailboxes(accountId);

      // 启动自动同步
      if (normalized.autoSync) {
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
      const id = this.assertId(accountId, "email_account_id");
      if (this.emailClients.has(id)) {
        throw new EmailIPCBoundaryError(
          "OVERLOADED",
          "email_account_operation",
          "Cannot remove an account while an email operation is active",
        );
      }
      // 停止自动同步
      this.stopAutoSync(id);

      // 删除账户
      const stmt = this.database.db.prepare(
        "DELETE FROM email_accounts WHERE id = ?",
      );
      stmt.run([id]);
      try {
        this.credentialStore.deletePassword(id);
      } catch (credentialError) {
        logger.warn(
          "[EmailIPCHandler] orphaned credential cleanup failed:",
          credentialError.message,
        );
      }

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
      const account = this.getAccountRecord(accountId);
      if (this.emailClients.has(account.id)) {
        throw new EmailIPCBoundaryError(
          "OVERLOADED",
          "email_account_operation",
          "Cannot update an account while an email operation is active",
        );
      }
      const { normalized, password, autoSync } = normalizeAccountUpdates(
        updates,
        this.limits,
      );
      const fields = normalized.map(([column]) => `${column} = ?`);
      const values = normalized.map(([, value]) => value);
      if (password !== undefined) {
        fields.push("password = ?");
        values.push(this.credentialStore.setPassword(account.id, password));
      }
      if (fields.length > 0) {
        fields.push("updated_at = ?");
        values.push(Date.now(), account.id);
        this.database.db
          .prepare(
            `UPDATE email_accounts SET ${fields.join(", ")} WHERE id = ?`,
          )
          .run(values);
      }

      // 如果更新了配置，需要重新配置客户端
      if (autoSync === true) {
        this.startAutoSync(account.id);
      } else if (autoSync === false) {
        this.stopAutoSync(account.id);
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
      this.assertActive();
      const stmt = this.database.db.prepare(
        `SELECT id, email, display_name, imap_host, imap_port, imap_tls,
                smtp_host, smtp_port, smtp_secure, status, error_message,
                last_sync_at, sync_frequency, created_at, updated_at
         FROM email_accounts ORDER BY email LIMIT ?`,
      );
      const accounts = stmt.all([this.limits.maxAccounts]);

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
      const account = this.getAccountRecord(accountId);

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
      this.assertActive();
      const normalized = normalizeAccountConfig(config, this.limits);
      const client = this.clientFactory();
      client.configure(normalized);
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
    let client;
    try {
      const account = this.getAccountRecord(accountId);
      client = this.getEmailClient(account.id);
      this.configureClient(client, account);

      await client.connect();
      const mailboxes = await client.getMailboxes();

      // 保存邮箱
      const stmt = this.database.db.prepare(`
        INSERT INTO email_mailboxes (
          id, account_id, name, display_name, delimiter, flags, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, name) DO UPDATE SET
          display_name = excluded.display_name,
          delimiter = excluded.delimiter,
          flags = excluded.flags
      `);

      const flattenMailboxes = (boxes) => {
        const result = [];
        const pending = Array.isArray(boxes) ? [...boxes] : [];
        while (pending.length > 0 && result.length < this.limits.maxMailboxes) {
          const box = pending.shift();
          result.push(box);
          if (box.children && box.children.length > 0) {
            pending.unshift(...box.children);
          }
        }
        return result;
      };

      const allMailboxes = flattenMailboxes(mailboxes);

      for (const mailbox of allMailboxes) {
        const mailboxId = uuidv4();
        stmt.run([
          mailboxId,
          account.id,
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
    } finally {
      if (client) this.releaseEmailClient(accountId, client);
    }
  }

  /**
   * 获取邮箱列表
   */
  async getMailboxes(accountId) {
    try {
      const id = this.assertId(accountId, "email_account_id");
      const stmt = this.database.db.prepare(
        "SELECT * FROM email_mailboxes WHERE account_id = ? ORDER BY name LIMIT ?",
      );
      const mailboxes = stmt.all([id, this.limits.maxMailboxes]);

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
    let id;
    let client;
    let admitted = false;
    try {
      id = this.assertId(accountId, "email_account_id");
      const normalizedOptions = normalizeFetchOptions(options, this.limits);
      if (
        this.fetchInFlight.has(id) ||
        this.fetchInFlight.size >= this.limits.maxConcurrentFetches
      ) {
        throw new EmailIPCBoundaryError(
          "OVERLOADED",
          "email_fetches",
          "Email fetch capacity is exhausted",
          { limit: { maxConcurrent: this.limits.maxConcurrentFetches } },
        );
      }
      this.fetchInFlight.add(id);
      admitted = true;
      const account = this.getAccountRecord(id);

      client = this.getEmailClient(id);
      this.configureClient(client, account);

      await client.connect();
      const emails = await client.fetchEmails(normalizedOptions);

      // 保存邮件
      await this.saveEmails(id, normalizedOptions.mailbox, emails);

      // 更新同步时间
      const updateStmt = this.database.db.prepare(
        "UPDATE email_accounts SET last_sync_at = ? WHERE id = ?",
      );
      updateStmt.run([Date.now(), id]);

      return { success: true, count: emails.length };
    } catch (error) {
      logger.error("[EmailIPCHandler] 获取邮件失败:", error);

      // 更新错误状态
      if (id) {
        const updateStmt = this.database.db.prepare(
          "UPDATE email_accounts SET status = 'error', error_message = ? WHERE id = ?",
        );
        updateStmt.run([
          truncateUtf8(error.message, this.limits.maxMetadataBytes),
          id,
        ]);
      }

      throw error;
    } finally {
      if (client && id) this.releaseEmailClient(id, client);
      if (admitted) this.fetchInFlight.delete(id);
    }
  }

  /**
   * 保存邮件到数据库
   */
  async saveEmails(accountId, mailboxName, emails) {
    const id = this.assertId(accountId, "email_account_id");
    const boundedMailboxName = assertBoundedString(
      mailboxName,
      "email_mailbox_name",
      this.limits.maxAddressBytes,
    );
    if (!Array.isArray(emails)) {
      throw new EmailIPCBoundaryError(
        "INVALID_ARGUMENT",
        "emails",
        "Emails must be an array",
      );
    }
    // 获取邮箱 ID
    const mailboxStmt = this.database.db.prepare(
      "SELECT id FROM email_mailboxes WHERE account_id = ? AND name = ?",
    );
    const mailbox = mailboxStmt.get([id, boundedMailboxName]);

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

    for (const email of emails.slice(0, this.limits.maxEmails)) {
      const emailId = uuidv4();

      const runResult = emailStmt.run([
        emailId,
        id,
        mailbox.id,
        truncateUtf8(email.messageId, this.limits.maxIdBytes),
        email.uid,
        truncateUtf8(email.subject, this.limits.maxSubjectBytes),
        truncateUtf8(email.from, this.limits.maxAddressBytes),
        truncateUtf8(email.to, this.limits.maxAddressBytes),
        truncateUtf8(email.cc, this.limits.maxAddressBytes),
        email.date,
        truncateUtf8(email.text, this.limits.maxTextBytes),
        truncateUtf8(email.html, this.limits.maxHtmlBytes),
        Array.isArray(email.attachments) && email.attachments.length > 0
          ? 1
          : 0,
        Date.now(),
      ]);
      if (runResult?.changes === 0) continue;

      // 保存附件
      for (const attachment of (email.attachments || []).slice(
        0,
        this.limits.maxOutgoingAttachments,
      )) {
        const content = Buffer.isBuffer(attachment.content)
          ? attachment.content
          : Buffer.from(attachment.content || []);
        if (content.byteLength > this.limits.maxAttachmentBytes) continue;
        const attachmentId = uuidv4();
        const accountDirectory = crypto
          .createHash("sha256")
          .update(id)
          .digest("hex");
        const attachmentPath = path.join(
          this.appDataPath,
          "attachments",
          accountDirectory,
          attachmentId,
        );

        // 创建目录
        await this.fs.mkdir(path.dirname(attachmentPath), { recursive: true });

        // 保存附件文件
        await this.fs.writeFile(attachmentPath, content);

        attachmentStmt.run([
          attachmentId,
          emailId,
          truncateUtf8(attachment.filename, this.limits.maxMetadataBytes),
          truncateUtf8(attachment.contentType, this.limits.maxMetadataBytes),
          content.byteLength,
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
      this.assertActive();
      const normalizedOptions = normalizeEmailListOptions(options, this.limits);
      let query = `SELECT id, account_id, mailbox_id, message_id, uid, subject,
                          from_address, to_address, cc_address, date,
                          has_attachments, is_read, is_starred, is_archived,
                          knowledge_item_id, created_at
                   FROM emails`;
      const conditions = [];
      const params = [];

      if (normalizedOptions.accountId) {
        conditions.push("account_id = ?");
        params.push(normalizedOptions.accountId);
      }

      if (normalizedOptions.mailboxId) {
        conditions.push("mailbox_id = ?");
        params.push(normalizedOptions.mailboxId);
      }

      if (normalizedOptions.isRead !== undefined) {
        conditions.push("is_read = ?");
        params.push(normalizedOptions.isRead ? 1 : 0);
      }

      if (normalizedOptions.isStarred !== undefined) {
        conditions.push("is_starred = ?");
        params.push(normalizedOptions.isStarred ? 1 : 0);
      }

      if (normalizedOptions.isArchived !== undefined) {
        conditions.push("is_archived = ?");
        params.push(normalizedOptions.isArchived ? 1 : 0);
      }

      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }

      query += " ORDER BY date DESC LIMIT ? OFFSET ?";
      params.push(normalizedOptions.limit, normalizedOptions.offset);

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
      const id = this.assertId(emailId);
      const stmt = this.database.db.prepare(
        `SELECT id, account_id, mailbox_id, message_id, uid,
                subject, from_address, to_address, cc_address, date,
                CAST(substr(CAST(text_content AS BLOB), 1, ?) AS TEXT) AS text_content,
                CAST(substr(CAST(html_content AS BLOB), 1, ?) AS TEXT) AS html_content,
                has_attachments, is_read, is_starred, is_archived,
                knowledge_item_id, created_at
         FROM emails WHERE id = ?`,
      );
      const email = stmt.get([
        this.limits.maxTextBytes,
        this.limits.maxHtmlBytes,
        id,
      ]);

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
      const id = this.assertId(emailId);
      const stmt = this.database.db.prepare(
        "UPDATE emails SET is_read = 1 WHERE id = ?",
      );
      stmt.run([id]);

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
      const id = this.assertId(emailId);
      const stmt = this.database.db.prepare(
        "UPDATE emails SET is_read = 0 WHERE id = ?",
      );
      stmt.run([id]);

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
      const id = this.assertId(emailId);
      if (typeof starred !== "boolean") {
        throw new EmailIPCBoundaryError(
          "INVALID_ARGUMENT",
          "email_starred",
          "starred must be a boolean",
        );
      }
      const stmt = this.database.db.prepare(
        "UPDATE emails SET is_starred = ? WHERE id = ?",
      );
      stmt.run([starred ? 1 : 0, id]);

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
      const id = this.assertId(emailId);
      const stmt = this.database.db.prepare(
        "UPDATE emails SET is_archived = 1 WHERE id = ?",
      );
      stmt.run([id]);

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
      const id = this.assertId(emailId);
      const stmt = this.database.db.prepare("DELETE FROM emails WHERE id = ?");
      stmt.run([id]);

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
    let account;
    let client;
    try {
      account = this.getAccountRecord(accountId);
      const normalizedMail = normalizeMailOptions(mailOptions, this.limits);
      client = this.getEmailClient(account.id);
      this.configureClient(client, account);

      const result = await client.sendEmail(normalizedMail);

      return { success: true, result };
    } catch (error) {
      logger.error("[EmailIPCHandler] 发送邮件失败:", error);
      throw error;
    } finally {
      if (client && account) this.releaseEmailClient(account.id, client);
    }
  }

  /**
   * 保存草稿
   */
  async saveDraft(accountId, draftData) {
    try {
      const id = this.assertId(accountId, "email_account_id");
      const normalizedDraft = normalizeDraftData(draftData, this.limits);
      const draftId = normalizedDraft.id || uuidv4();
      const now = Date.now();

      // 检查是否是更新已有草稿
      if (normalizedDraft.id) {
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
          WHERE id = ? AND account_id = ?
        `);

        updateStmt.run([
          JSON.stringify(normalizedDraft.to),
          JSON.stringify(normalizedDraft.cc),
          JSON.stringify(normalizedDraft.bcc),
          normalizedDraft.subject,
          normalizedDraft.text,
          normalizedDraft.html,
          JSON.stringify(normalizedDraft.attachments),
          now,
          normalizedDraft.id,
          id,
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
          id,
          JSON.stringify(normalizedDraft.to),
          JSON.stringify(normalizedDraft.cc),
          JSON.stringify(normalizedDraft.bcc),
          normalizedDraft.subject,
          normalizedDraft.text,
          normalizedDraft.html,
          JSON.stringify(normalizedDraft.attachments),
          normalizedDraft.replyToId,
          normalizedDraft.forwardId,
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
      const id = this.assertId(accountId, "email_account_id");
      const stmt = this.database.db.prepare(
        `SELECT id, account_id, to_address, cc_address, bcc_address,
                subject, created_at, updated_at
         FROM email_drafts
         WHERE account_id = ? ORDER BY updated_at DESC LIMIT ?`,
      );
      const drafts = stmt.all([id, this.limits.maxDrafts]);

      // 解析 JSON 字段（per-field 守卫：一条坏草稿不应让整个草稿列表抛错返失败）
      const safeArr = (raw) => {
        try {
          const parsed = JSON.parse(raw || "[]");
          return Array.isArray(parsed)
            ? parsed.slice(0, this.limits.maxOutgoingAttachments * 10)
            : [];
        } catch {
          return [];
        }
      };
      drafts.forEach((draft) => {
        draft.to_address = safeArr(draft.to_address);
        draft.cc_address = safeArr(draft.cc_address);
        draft.bcc_address = safeArr(draft.bcc_address);
        draft.attachments = safeArr(draft.attachments);
      });

      return { success: true, drafts };
    } catch (error) {
      logger.error("[EmailIPCHandler] 获取草稿列表失败:", error);
      throw error;
    }
  }

  async getDraft(draftId) {
    try {
      const id = this.assertId(draftId, "email_draft_id");
      const draft = this.database.db
        .prepare(
          `SELECT id, account_id, to_address, cc_address, bcc_address,
                  subject,
                  CAST(substr(CAST(text_content AS BLOB), 1, ?) AS TEXT) AS text_content,
                  CAST(substr(CAST(html_content AS BLOB), 1, ?) AS TEXT) AS html_content,
                  attachments, reply_to_id, forward_id, created_at, updated_at
           FROM email_drafts WHERE id = ?`,
        )
        .get([this.limits.maxTextBytes, this.limits.maxHtmlBytes, id]);
      if (!draft) {
        throw new EmailIPCBoundaryError(
          "NOT_FOUND",
          "email_draft",
          "Email draft does not exist",
        );
      }
      const parseArray = (raw, maxItems) => {
        try {
          const parsed = JSON.parse(raw || "[]");
          return Array.isArray(parsed) ? parsed.slice(0, maxItems) : [];
        } catch {
          return [];
        }
      };
      const maxAddresses = this.limits.maxOutgoingAttachments * 10;
      draft.to_address = parseArray(draft.to_address, maxAddresses);
      draft.cc_address = parseArray(draft.cc_address, maxAddresses);
      draft.bcc_address = parseArray(draft.bcc_address, maxAddresses);
      draft.attachments = parseArray(
        draft.attachments,
        this.limits.maxOutgoingAttachments,
      );
      return { success: true, draft };
    } catch (error) {
      logger.error("[EmailIPCHandler] 获取草稿失败:", error);
      throw error;
    }
  }

  /**
   * 删除草稿
   */
  async deleteDraft(draftId) {
    try {
      const id = this.assertId(draftId, "email_draft_id");
      const stmt = this.database.db.prepare(
        "DELETE FROM email_drafts WHERE id = ?",
      );
      stmt.run([id]);

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
      const id = this.assertId(emailId);
      const { email } = await this.getEmail(id);

      // 创建知识库条目
      const knowledgeId = uuidv4();
      const now = Date.now();

      const content = truncateUtf8(
        `# ${email.subject}\n\n**发件人:** ${email.from_address}\n**收件人:** ${email.to_address}\n**日期:** ${email.date}\n\n---\n\n${email.text_content || email.html_content}`,
        this.limits.maxHtmlBytes,
      );

      const knowledgeStmt = this.database.db.prepare(`
        INSERT INTO knowledge_items (
          id, title, type, content, created_at, updated_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      knowledgeStmt.run([
        knowledgeId,
        truncateUtf8(email.subject, this.limits.maxSubjectBytes),
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
      updateStmt.run([knowledgeId, id]);

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
      const id = this.assertId(emailId);
      const stmt = this.database.db.prepare(
        `SELECT id, email_id, filename, content_type, size, created_at
         FROM email_attachments WHERE email_id = ? LIMIT ?`,
      );
      const attachments = stmt.all([id, this.limits.maxAttachments]);

      return { success: true, attachments };
    } catch (error) {
      logger.error("[EmailIPCHandler] 获取附件列表失败:", error);
      throw error;
    }
  }

  /**
   * 下载附件
   */
  async downloadAttachment(attachmentId) {
    try {
      const id = this.assertId(attachmentId, "email_attachment_id");
      const stmt = this.database.db.prepare(
        "SELECT * FROM email_attachments WHERE id = ?",
      );
      const attachment = stmt.get([id]);

      if (!attachment) {
        throw new Error("附件不存在");
      }

      const attachmentRoot = await this.fs.realpath(
        path.join(this.appDataPath, "attachments"),
      );
      const sourcePath = await this.fs.realpath(attachment.file_path);
      const relativeSource = path.relative(attachmentRoot, sourcePath);
      if (relativeSource.startsWith("..") || path.isAbsolute(relativeSource)) {
        throw new EmailIPCBoundaryError(
          "PATH_OUTSIDE_ROOT",
          "email_attachment_source",
          "Email attachment is outside the managed attachment directory",
        );
      }

      const dialogResult = await this.showSaveDialog({
        title: "保存邮件附件",
        defaultPath: path.basename(attachment.filename || "attachment"),
      });
      if (dialogResult?.canceled || !dialogResult?.filePath) {
        return { success: false, canceled: true };
      }

      // The destination comes from Electron's trusted native dialog, never
      // from a renderer-controlled IPC argument.
      await this.fs.copyFile(sourcePath, dialogResult.filePath);

      return { success: true, filePath: dialogResult.filePath };
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
      this.assertActive();
      const labelName = assertBoundedString(
        name,
        "email_label_name",
        this.limits.maxSubjectBytes,
      );
      const color =
        options.color == null
          ? "#1890ff"
          : assertBoundedString(
              options.color,
              "email_label_color",
              this.limits.maxMetadataBytes,
            );
      const icon =
        options.icon == null
          ? null
          : assertBoundedString(
              options.icon,
              "email_label_icon",
              this.limits.maxMetadataBytes,
            );
      const labelId = uuidv4();
      const stmt = this.database.db.prepare(`
        INSERT INTO email_labels (id, name, color, icon, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run([labelId, labelName, color, icon, Date.now()]);

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
      this.assertActive();
      const stmt = this.database.db.prepare(
        "SELECT * FROM email_labels ORDER BY name LIMIT ?",
      );
      const labels = stmt.all([this.limits.maxLabels]);

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
      const boundedEmailId = this.assertId(emailId);
      const boundedLabelId = this.assertId(labelId, "email_label_id");
      const stmt = this.database.db.prepare(`
        INSERT OR IGNORE INTO email_label_mappings (email_id, label_id, created_at)
        VALUES (?, ?, ?)
      `);

      stmt.run([boundedEmailId, boundedLabelId, Date.now()]);

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
      const boundedEmailId = this.assertId(emailId);
      const boundedLabelId = this.assertId(labelId, "email_label_id");
      const stmt = this.database.db.prepare(
        "DELETE FROM email_label_mappings WHERE email_id = ? AND label_id = ?",
      );
      stmt.run([boundedEmailId, boundedLabelId]);

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
      const id = this.assertId(accountId, "email_account_id");
      const existing = this.syncIntervals.get(id);
      if (existing) {
        this.clearInterval(existing);
        this.syncIntervals.delete(id);
      }
      if (this.syncIntervals.size >= this.limits.maxSyncIntervals) {
        throw new EmailIPCBoundaryError(
          "OVERLOADED",
          "email_sync_intervals",
          "Email auto-sync timer capacity is exhausted",
          { limit: { maxItems: this.limits.maxSyncIntervals } },
        );
      }

      const accountStmt = this.database.db.prepare(
        "SELECT sync_frequency FROM email_accounts WHERE id = ?",
      );
      const account = accountStmt.get([id]);

      if (!account) {
        return { success: false, error: "账户不存在" };
      }

      const syncFrequency = boundedSyncSeconds(
        account.sync_frequency,
        this.limits,
      );
      const interval = this.setInterval(async () => {
        if (this.cleanedUp || this.fetchInFlight.has(id)) return;
        try {
          await this.fetchEmails(id, { limit: 50, unseen: true });
          logger.info(`[EmailIPCHandler] 自动同步完成: ${id}`);
        } catch (error) {
          logger.error(`[EmailIPCHandler] 自动同步失败: ${id}`, error);
        }
      }, syncFrequency * 1000);

      this.syncIntervals.set(id, interval);

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
    const id = this.assertId(accountId, "email_account_id");
    const interval = this.syncIntervals.get(id);
    if (interval) {
      this.clearInterval(interval);
      this.syncIntervals.delete(id);
    }
    return { success: true };
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    // 停止所有自动同步
    for (const interval of this.syncIntervals.values()) {
      this.clearInterval(interval);
    }
    this.syncIntervals.clear();

    // 断开所有连接
    for (const client of this.emailClients.values()) {
      try {
        client.disconnect();
      } catch (error) {
        logger.warn("[EmailIPCHandler] email client cleanup failed:", error);
      }
    }
    this.emailClients.clear();
    this.fetchInFlight.clear();

    if (this.handlersRegistered) {
      for (const channel of EMAIL_IPC_CHANNELS) {
        this.ipcMain.removeHandler?.(channel);
      }
      this.handlersRegistered = false;
    }
  }
}

module.exports = EmailIPCHandler;
module.exports.EMAIL_IPC_CHANNELS = EMAIL_IPC_CHANNELS;
