/**
 * Email Client
 * 支持 IMAP/POP3 协议接收邮件，SMTP 发送邮件
 *
 * v0.20.0: 新增邮件集成功能
 */

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { EventEmitter } = require('events');

class EmailClient extends EventEmitter {
  constructor() {
    super();
    this.imapConnection = null;
    this.smtpTransporter = null;
    this.config = null;
  }

  /**
   * 配置邮件账户
   * @param {object} config - 邮件配置
   */
  configure(config) {
    this.config = {
      imap: {
        user: config.email,
        password: config.password,
        host: config.imapHost || this.getDefaultImapHost(config.email),
        port: config.imapPort || 993,
        tls: config.imapTls !== false,
        tlsOptions: { rejectUnauthorized: false },
      },
      smtp: {
        host: config.smtpHost || this.getDefaultSmtpHost(config.email),
        port: config.smtpPort || 587,
        secure: config.smtpSecure || false,
        auth: {
          user: config.email,
          pass: config.password,
        },
      },
    };
  }

  /**
   * 连接到 IMAP 服务器
   */
  async connect() {
    return new Promise((resolve, reject) => {
      if (!this.config) {
        reject(new Error('邮件账户未配置'));
        return;
      }

      this.imapConnection = new Imap(this.config.imap);

      this.imapConnection.once('ready', () => {
        console.log('[EmailClient] IMAP 连接成功');
        this.emit('connected');
        resolve();
      });

      this.imapConnection.once('error', (err) => {
        console.error('[EmailClient] IMAP 连接错误:', err);
        this.emit('error', err);
        reject(err);
      });

      this.imapConnection.once('end', () => {
        console.log('[EmailClient] IMAP 连接关闭');
        this.emit('disconnected');
      });

      this.imapConnection.connect();
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.imapConnection) {
      this.imapConnection.end();
      this.imapConnection = null;
    }
  }

  /**
   * 获取邮箱列表
   */
  async getMailboxes() {
    return new Promise((resolve, reject) => {
      if (!this.imapConnection) {
        reject(new Error('未连接到 IMAP 服务器'));
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
  async openMailbox(mailbox = 'INBOX') {
    return new Promise((resolve, reject) => {
      if (!this.imapConnection) {
        reject(new Error('未连接到 IMAP 服务器'));
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
    const {
      mailbox = 'INBOX',
      limit = 50,
      unseen = false,
      since = null,
    } = options;

    try {
      await this.openMailbox(mailbox);

      // 构建搜索条件
      const searchCriteria = [];
      if (unseen) {
        searchCriteria.push('UNSEEN');
      }
      if (since) {
        searchCriteria.push(['SINCE', since]);
      }
      if (searchCriteria.length === 0) {
        searchCriteria.push('ALL');
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
            bodies: '',
            struct: true,
          });

          const emails = [];

          fetch.on('message', (msg, seqno) => {
            let buffer = '';

            msg.on('body', (stream, info) => {
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
            });

            msg.once('end', async () => {
              try {
                const parsed = await simpleParser(buffer);
                emails.push(this.normalizeEmail(parsed, seqno));
              } catch (error) {
                console.error('[EmailClient] 解析邮件失败:', error);
              }
            });
          });

          fetch.once('error', (err) => {
            reject(err);
          });

          fetch.once('end', () => {
            resolve(emails);
          });
        });
      });
    } catch (error) {
      console.error('[EmailClient] 获取邮件失败:', error);
      throw error;
    }
  }

  /**
   * 获取单封邮件
   * @param {number} uid - 邮件 UID
   */
  async fetchEmail(uid, mailbox = 'INBOX') {
    try {
      await this.openMailbox(mailbox);

      return new Promise((resolve, reject) => {
        const fetch = this.imapConnection.fetch([uid], {
          bodies: '',
          struct: true,
        });

        let buffer = '';

        fetch.on('message', (msg, seqno) => {
          msg.on('body', (stream, info) => {
            stream.on('data', (chunk) => {
              buffer += chunk.toString('utf8');
            });
          });

          msg.once('end', async () => {
            try {
              const parsed = await simpleParser(buffer);
              resolve(this.normalizeEmail(parsed, seqno));
            } catch (error) {
              reject(error);
            }
          });
        });

        fetch.once('error', reject);
      });
    } catch (error) {
      console.error('[EmailClient] 获取邮件失败:', error);
      throw error;
    }
  }

  /**
   * 标记邮件为已读
   * @param {number} uid - 邮件 UID
   */
  async markAsRead(uid, mailbox = 'INBOX') {
    try {
      await this.openMailbox(mailbox);

      return new Promise((resolve, reject) => {
        this.imapConnection.addFlags(uid, ['\\Seen'], (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    } catch (error) {
      console.error('[EmailClient] 标记已读失败:', error);
      throw error;
    }
  }

  /**
   * 删除邮件
   * @param {number} uid - 邮件 UID
   */
  async deleteEmail(uid, mailbox = 'INBOX') {
    try {
      await this.openMailbox(mailbox);

      return new Promise((resolve, reject) => {
        this.imapConnection.addFlags(uid, ['\\Deleted'], (err) => {
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
      console.error('[EmailClient] 删除邮件失败:', error);
      throw error;
    }
  }

  /**
   * 发送邮件
   * @param {object} mailOptions - 邮件选项
   */
  async sendEmail(mailOptions) {
    try {
      if (!this.smtpTransporter) {
        this.smtpTransporter = nodemailer.createTransport(this.config.smtp);
      }

      const info = await this.smtpTransporter.sendMail({
        from: this.config.imap.user,
        to: mailOptions.to,
        subject: mailOptions.subject,
        text: mailOptions.text,
        html: mailOptions.html,
        attachments: mailOptions.attachments,
      });

      console.log('[EmailClient] 邮件发送成功:', info.messageId);
      this.emit('email-sent', info);

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      console.error('[EmailClient] 发送邮件失败:', error);
      this.emit('email-send-error', error);
      throw error;
    }
  }

  /**
   * 标准化邮件数据
   */
  normalizeEmail(parsed, seqno) {
    return {
      uid: seqno,
      messageId: parsed.messageId,
      subject: parsed.subject || '(无主题)',
      from: parsed.from ? parsed.from.text : '',
      to: parsed.to ? parsed.to.text : '',
      cc: parsed.cc ? parsed.cc.text : '',
      date: parsed.date || new Date(),
      text: parsed.text || '',
      html: parsed.html || '',
      attachments: (parsed.attachments || []).map(att => ({
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
        content: att.content,
      })),
    };
  }

  /**
   * 解析邮箱列表
   */
  parseMailboxes(boxes, prefix = '') {
    const result = [];

    for (const [name, box] of Object.entries(boxes)) {
      const fullName = prefix ? `${prefix}/${name}` : name;

      result.push({
        name: fullName,
        displayName: name,
        delimiter: box.delimiter,
        flags: box.attribs || [],
        children: box.children ? this.parseMailboxes(box.children, fullName) : [],
      });
    }

    return result;
  }

  /**
   * 获取默认 IMAP 主机
   */
  getDefaultImapHost(email) {
    const domain = email.split('@')[1];
    const commonHosts = {
      'gmail.com': 'imap.gmail.com',
      'outlook.com': 'outlook.office365.com',
      'hotmail.com': 'outlook.office365.com',
      'yahoo.com': 'imap.mail.yahoo.com',
      '163.com': 'imap.163.com',
      '126.com': 'imap.126.com',
      'qq.com': 'imap.qq.com',
    };

    return commonHosts[domain] || `imap.${domain}`;
  }

  /**
   * 获取默认 SMTP 主机
   */
  getDefaultSmtpHost(email) {
    const domain = email.split('@')[1];
    const commonHosts = {
      'gmail.com': 'smtp.gmail.com',
      'outlook.com': 'smtp.office365.com',
      'hotmail.com': 'smtp.office365.com',
      'yahoo.com': 'smtp.mail.yahoo.com',
      '163.com': 'smtp.163.com',
      '126.com': 'smtp.126.com',
      'qq.com': 'smtp.qq.com',
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
      this.disconnect();

      return {
        success: true,
        mailboxes: mailboxes.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = EmailClient;
