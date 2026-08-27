/**
 * Email Client
 * 支持 IMAP/POP3 协议接收邮件，SMTP 发送邮件
 *
 * v0.20.0: 新增邮件集成功能
 */

const { logger } = require("../utils/logger.js");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const nodemailer = require("nodemailer");
const { EventEmitter } = require("events");
const {
  EmailIPCBoundaryError,
  createEmailIPCLimits,
  normalizeAccountConfig,
  normalizeFetchOptions,
  normalizeMailOptions,
  truncateUtf8,
} = require("./email-ipc-boundaries.js");

class EmailClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.limits = createEmailIPCLimits(options.limits || options);
    this.ImapClass = options.ImapClass || Imap;
    this.simpleParser = options.simpleParser || simpleParser;
    this.nodemailer = options.nodemailer || nodemailer;
    this.imapConnection = null;
    this.smtpTransporter = null;
    this.config = null;

    // 连接池管理
    this.connectionPool = new Map();
    this.maxConnections = Math.min(5, this.limits.maxClients);
    this.connectionTimeout = 10 * 60 * 1000; // 10分钟连接超时
  }

  /**
   * 配置邮件账户
   * @param {object} config - 邮件配置
   */
  configure(config) {
    const normalized = normalizeAccountConfig(config, this.limits);
    this.config = {
      imap: {
        user: normalized.email,
        password: normalized.password,
        host: normalized.imapHost,
        port: normalized.imapPort,
        tls: normalized.imapTls,
        tlsOptions: { rejectUnauthorized: true },
        connTimeout: 15_000,
        authTimeout: 15_000,
        socketTimeout: 60_000,
      },
      smtp: {
        host: normalized.smtpHost,
        port: normalized.smtpPort,
        secure: normalized.smtpSecure,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 60_000,
        auth: {
          user: normalized.email,
          pass: normalized.password,
        },
      },
    };
  }

  /**
   * 从连接池获取连接
   * @param {string} accountId - 账户ID（用于区分不同账户的连接）
   */
  async getConnection(accountId = "default") {
    // 检查连接池中是否有可用连接
    if (this.connectionPool.has(accountId)) {
      const poolEntry = this.connectionPool.get(accountId);

      // 检查连接是否仍然有效
      if (poolEntry.connection && this.isConnectionValid(poolEntry)) {
        logger.info(`[EmailClient] 使用连接池中的连接: ${accountId}`);
        poolEntry.lastUsed = Date.now();
        return poolEntry.connection;
      } else {
        // 连接无效，从池中移除
        this.connectionPool.delete(accountId);
      }
    }

    // 检查连接池是否已满
    if (this.connectionPool.size >= this.maxConnections) {
      // 清理最久未使用的连接
      this.cleanupOldestConnection();
    }

    // 创建新连接
    const connection = await this.connect();

    // 添加到连接池
    this.connectionPool.set(accountId, {
      connection,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    });

    logger.info(`[EmailClient] 创建新连接并加入连接池: ${accountId}`);
    return connection;
  }

  /**
   * 检查连接是否有效
   */
  isConnectionValid(poolEntry) {
    if (!poolEntry || !poolEntry.connection) {
      return false;
    }

    // 检查连接是否超时
    const age = Date.now() - poolEntry.createdAt;
    if (age > this.connectionTimeout) {
      return false;
    }

    // 检查连接状态
    try {
      return poolEntry.connection.state === "authenticated";
    } catch (error) {
      return false;
    }
  }

  /**
   * 清理最久未使用的连接
   */
  cleanupOldestConnection() {
    let oldestKey = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.connectionPool.entries()) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.connectionPool.get(oldestKey);
      if (entry && entry.connection) {
        try {
          entry.connection.end();
        } catch (error) {
          logger.error("[EmailClient] 关闭连接失败:", error);
        }
      }
      this.connectionPool.delete(oldestKey);
      logger.info(`[EmailClient] 清理最久未使用的连接: ${oldestKey}`);
    }
  }

  /**
   * 清理所有过期连接
   */
  cleanupExpiredConnections() {
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, entry] of this.connectionPool.entries()) {
      if (!this.isConnectionValid(entry)) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      const entry = this.connectionPool.get(key);
      if (entry && entry.connection) {
        try {
          entry.connection.end();
        } catch (error) {
          logger.error("[EmailClient] 关闭连接失败:", error);
        }
      }
      this.connectionPool.delete(key);
    }

    if (expiredKeys.length > 0) {
      logger.info(`[EmailClient] 清理了 ${expiredKeys.length} 个过期连接`);
    }
  }

  /**
   * 获取连接池统计信息
   */
  getPoolStats() {
    return {
      size: this.connectionPool.size,
      maxConnections: this.maxConnections,
      connections: Array.from(this.connectionPool.entries()).map(
        ([key, entry]) => ({
          accountId: key,
          age: Date.now() - entry.createdAt,
          lastUsed: Date.now() - entry.lastUsed,
          valid: this.isConnectionValid(entry),
        }),
      ),
    };
  }

  /**
   * 连接到 IMAP 服务器
   */
  async connect() {
    return new Promise((resolve, reject) => {
      if (!this.config) {
        reject(new Error("邮件账户未配置"));
        return;
      }

      this.imapConnection = new this.ImapClass(this.config.imap);

      this.imapConnection.once("ready", () => {
        logger.info("[EmailClient] IMAP 连接成功");
        this.emit("connected");
        resolve(this.imapConnection);
      });

      this.imapConnection.once("error", (err) => {
        logger.error("[EmailClient] IMAP 连接错误:", err);
        if (this.listenerCount("error") > 0) {
          this.emit("error", err);
        }
        reject(err);
      });

      this.imapConnection.once("end", () => {
        logger.info("[EmailClient] IMAP 连接关闭");
        this.emit("disconnected");
      });

      this.imapConnection.connect();
    });
  }

  /**
   * 断开连接
   * @param {string} accountId - 可选，指定要断开的账户ID，不指定则断开所有连接
   */
  disconnect(accountId = null) {
    if (accountId) {
      // 断开指定账户的连接
      const entry = this.connectionPool.get(accountId);
      if (entry && entry.connection) {
        try {
          entry.connection.end();
        } catch (error) {
          logger.error("[EmailClient] 断开连接失败:", error);
        }
        this.connectionPool.delete(accountId);
        logger.info(`[EmailClient] 已断开连接: ${accountId}`);
      }
    } else {
      // 断开所有连接
      for (const [key, entry] of this.connectionPool.entries()) {
        if (entry && entry.connection) {
          try {
            entry.connection.end();
          } catch (error) {
            logger.error("[EmailClient] 断开连接失败:", error);
          }
        }
      }
      this.connectionPool.clear();
      logger.info("[EmailClient] 已断开所有连接");
    }

    // 清理主连接
    if (this.imapConnection) {
      try {
        this.imapConnection.end();
      } catch (error) {
        logger.error("[EmailClient] 断开主连接失败:", error);
      }
      this.imapConnection = null;
    }
    if (this.smtpTransporter) {
      try {
        this.smtpTransporter.close?.();
      } catch (error) {
        logger.error("[EmailClient] 关闭 SMTP 连接失败:", error);
      }
      this.smtpTransporter = null;
    }
  }

  /**
   * 获取邮箱列表
   */
  async getMailboxes() {
    return new Promise((resolve, reject) => {
      if (!this.imapConnection) {
        reject(new Error("未连接到 IMAP 服务器"));
        return;
      }

      this.imapConnection.getBoxes((err, boxes) => {
        if (err) {
          reject(err);
          return;
        }

        const mailboxes = this.parseMailboxes(boxes);
        resolve(mailboxes);
      });
    });
  }

  /**
   * 打开邮箱
   * @param {string} mailbox - 邮箱名称（如 'INBOX'）
   */
  async openMailbox(mailbox = "INBOX") {
    return new Promise((resolve, reject) => {
      if (!this.imapConnection) {
        reject(new Error("未连接到 IMAP 服务器"));
        return;
      }

      this.imapConnection.openBox(mailbox, false, (err, box) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(box);
      });
    });
  }

  /**
   * 获取邮件列表
   * @param {object} options - 选项
   */
  async fetchEmails(options = {}) {
    const { mailbox, limit, unseen, since } = normalizeFetchOptions(
      options,
      this.limits,
    );

    try {
      await this.openMailbox(mailbox);

      // 构建搜索条件
      const searchCriteria = [];
      if (unseen) {
        searchCriteria.push("UNSEEN");
      }
      if (since) {
        searchCriteria.push(["SINCE", since]);
      }
      if (searchCriteria.length === 0) {
        searchCriteria.push("ALL");
      }

      return new Promise((resolve, reject) => {
        this.imapConnection.search(searchCriteria, (err, results) => {
          if (err) {
            reject(err);
            return;
          }

          if (!results || results.length === 0) {
            resolve([]);
            return;
          }

          // 限制数量
          const uids = results.slice(-limit);

          const fetch = this.imapConnection.fetch(uids, {
            bodies: "",
            struct: true,
          });

          const emails = [];
          const parsePromises = [];
          const batchBudget = { bytes: 0, error: null };

          fetch.on("message", (msg, seqno) => {
            parsePromises.push(
              this.readAndParseMessage(msg, seqno, batchBudget).then(
                (email) => {
                  emails.push(email);
                },
              ),
            );
          });

          fetch.once("error", (err) => {
            reject(err);
          });

          fetch.once("end", async () => {
            try {
              await Promise.all(parsePromises);
              resolve(emails.slice(0, limit));
            } catch (error) {
              reject(error);
            }
          });
        });
      });
    } catch (error) {
      logger.error("[EmailClient] 获取邮件失败:", error);
      throw error;
    }
  }

  /**
   * 获取单封邮件
   * @param {number} uid - 邮件 UID
   */
  async fetchEmail(uid, mailbox = "INBOX") {
    try {
      await this.openMailbox(mailbox);

      return new Promise((resolve, reject) => {
        const fetch = this.imapConnection.fetch([uid], {
          bodies: "",
          struct: true,
        });

        let parsePromise = null;
        const batchBudget = { bytes: 0, error: null };

        fetch.on("message", (msg, seqno) => {
          parsePromise = this.readAndParseMessage(msg, seqno, batchBudget);
        });

        fetch.once("error", reject);
        fetch.once("end", async () => {
          if (!parsePromise) {
            reject(new Error("Email not found"));
            return;
          }
          try {
            resolve(await parsePromise);
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      logger.error("[EmailClient] 获取邮件失败:", error);
      throw error;
    }
  }

  /**
   * 标记邮件为已读
   * @param {number} uid - 邮件 UID
   */
  async markAsRead(uid, mailbox = "INBOX") {
    try {
      await this.openMailbox(mailbox);

      return new Promise((resolve, reject) => {
        this.imapConnection.addFlags(uid, ["\\Seen"], (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    } catch (error) {
      logger.error("[EmailClient] 标记已读失败:", error);
      throw error;
    }
  }

  /**
   * 删除邮件
   * @param {number} uid - 邮件 UID
   */
  async deleteEmail(uid, mailbox = "INBOX") {
    try {
      await this.openMailbox(mailbox);

      return new Promise((resolve, reject) => {
        this.imapConnection.addFlags(uid, ["\\Deleted"], (err) => {
          if (err) {
            reject(err);
            return;
          }

          this.imapConnection.expunge((err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          });
        });
      });
    } catch (error) {
      logger.error("[EmailClient] 删除邮件失败:", error);
      throw error;
    }
  }

  /**
   * 发送邮件
   * @param {object} mailOptions - 邮件选项
   */
  async sendEmail(mailOptions) {
    try {
      const normalized = normalizeMailOptions(mailOptions, this.limits);
      if (!this.smtpTransporter) {
        this.smtpTransporter = this.nodemailer.createTransport(
          this.config.smtp,
        );
      }

      const info = await this.smtpTransporter.sendMail({
        from: this.config.imap.user,
        ...normalized,
      });

      logger.info("[EmailClient] 邮件发送成功:", info.messageId);
      this.emit("email-sent", info);

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      logger.error("[EmailClient] 发送邮件失败:", error);
      this.emit("email-send-error", error);
      throw error;
    }
  }

  /**
   * 标准化邮件数据
   */
  normalizeEmail(parsed, seqno) {
    let retainedAttachmentBytes = 0;
    let attachmentsTruncated = false;
    const attachments = [];
    for (const attachment of parsed.attachments || []) {
      if (attachments.length >= this.limits.maxOutgoingAttachments) {
        attachmentsTruncated = true;
        break;
      }
      const content = Buffer.isBuffer(attachment.content)
        ? attachment.content
        : Buffer.from(attachment.content || []);
      if (
        content.byteLength > this.limits.maxAttachmentBytes ||
        retainedAttachmentBytes + content.byteLength >
          this.limits.maxOutgoingAttachmentBytes
      ) {
        attachmentsTruncated = true;
        continue;
      }
      retainedAttachmentBytes += content.byteLength;
      attachments.push({
        filename: truncateUtf8(
          attachment.filename || "attachment",
          this.limits.maxMetadataBytes,
        ),
        contentType: truncateUtf8(
          attachment.contentType || "application/octet-stream",
          this.limits.maxMetadataBytes,
        ),
        size: Math.min(
          Number.isFinite(Number(attachment.size))
            ? Math.max(0, Number(attachment.size))
            : content.byteLength,
          this.limits.maxAttachmentBytes,
        ),
        content,
      });
    }
    return {
      uid: seqno,
      messageId: truncateUtf8(
        parsed.messageId || `local-${seqno}`,
        this.limits.maxIdBytes,
      ),
      subject: truncateUtf8(
        parsed.subject || "(无主题)",
        this.limits.maxSubjectBytes,
      ),
      from: truncateUtf8(
        parsed.from ? parsed.from.text : "",
        this.limits.maxAddressBytes,
      ),
      to: truncateUtf8(
        parsed.to ? parsed.to.text : "",
        this.limits.maxAddressBytes,
      ),
      cc: truncateUtf8(
        parsed.cc ? parsed.cc.text : "",
        this.limits.maxAddressBytes,
      ),
      date: parsed.date || new Date(),
      text: truncateUtf8(parsed.text || "", this.limits.maxTextBytes),
      html: truncateUtf8(parsed.html || "", this.limits.maxHtmlBytes),
      attachments,
      attachmentsTruncated,
    };
  }

  readAndParseMessage(message, seqno, batchBudget) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let messageBytes = 0;
      let streamError = null;

      message.on("body", (stream) => {
        stream.on("data", (value) => {
          if (streamError || batchBudget.error) return;
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          messageBytes += chunk.byteLength;
          batchBudget.bytes += chunk.byteLength;
          if (
            messageBytes > this.limits.maxRawMessageBytes ||
            batchBudget.bytes > this.limits.maxRawBatchBytes
          ) {
            streamError = new EmailIPCBoundaryError(
              "OVERLOADED",
              "email_raw_message",
              "Incoming email exceeds the configured byte limit",
              {
                limit: {
                  maxMessageBytes: this.limits.maxRawMessageBytes,
                  maxBatchBytes: this.limits.maxRawBatchBytes,
                },
              },
            );
            batchBudget.error = streamError;
            chunks.length = 0;
            reject(streamError);
            return;
          }
          chunks.push(chunk);
        });
        stream.once?.("error", (error) => {
          streamError = error;
          reject(error);
        });
      });

      message.once("end", async () => {
        if (streamError || batchBudget.error) {
          reject(streamError || batchBudget.error);
          return;
        }
        try {
          const parsed = await this.simpleParser(Buffer.concat(chunks));
          resolve(this.normalizeEmail(parsed, seqno));
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * 解析邮箱列表
   */
  parseMailboxes(boxes, prefix = "", state = { count: 0 }, depth = 0) {
    const result = [];

    if (
      !boxes ||
      depth >= this.limits.maxMailboxDepth ||
      state.count >= this.limits.maxMailboxes
    ) {
      return result;
    }
    for (const name in boxes) {
      if (!Object.prototype.hasOwnProperty.call(boxes, name)) continue;
      if (state.count >= this.limits.maxMailboxes) break;
      const box = boxes[name];
      const fullName = prefix ? `${prefix}/${name}` : name;
      state.count += 1;

      result.push({
        name: truncateUtf8(fullName, this.limits.maxAddressBytes),
        displayName: truncateUtf8(name, this.limits.maxAddressBytes),
        delimiter: truncateUtf8(box.delimiter || "/", 16),
        flags: (Array.isArray(box.attribs) ? box.attribs : [])
          .slice(0, 32)
          .map((flag) => truncateUtf8(flag, 256)),
        children: box.children
          ? this.parseMailboxes(box.children, fullName, state, depth + 1)
          : [],
      });
    }

    return result;
  }

  /**
   * 获取默认 IMAP 主机
   */
  getDefaultImapHost(email) {
    const domain = email.split("@")[1];
    const commonHosts = {
      "gmail.com": "imap.gmail.com",
      "outlook.com": "outlook.office365.com",
      "hotmail.com": "outlook.office365.com",
      "yahoo.com": "imap.mail.yahoo.com",
      "163.com": "imap.163.com",
      "126.com": "imap.126.com",
      "qq.com": "imap.qq.com",
    };

    return commonHosts[domain] || `imap.${domain}`;
  }

  /**
   * 获取默认 SMTP 主机
   */
  getDefaultSmtpHost(email) {
    const domain = email.split("@")[1];
    const commonHosts = {
      "gmail.com": "smtp.gmail.com",
      "outlook.com": "smtp.office365.com",
      "hotmail.com": "smtp.office365.com",
      "yahoo.com": "smtp.mail.yahoo.com",
      "163.com": "smtp.163.com",
      "126.com": "smtp.126.com",
      "qq.com": "smtp.qq.com",
    };

    return commonHosts[domain] || `smtp.${domain}`;
  }

  /**
   * 测试连接
   */
  async testConnection() {
    try {
      await this.connect();
      const mailboxes = await this.getMailboxes();
      return {
        success: true,
        mailboxes: mailboxes.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    } finally {
      this.disconnect();
    }
  }
}

module.exports = EmailClient;
