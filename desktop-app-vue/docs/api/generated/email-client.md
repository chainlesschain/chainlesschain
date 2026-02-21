# email-client

**Source**: `src/main/api/email-client.js`

**Generated**: 2026-02-21T20:04:16.277Z

---

## const

```javascript
const
```

* Email Client
 * 支持 IMAP/POP3 协议接收邮件，SMTP 发送邮件
 *
 * v0.20.0: 新增邮件集成功能

---

## configure(config)

```javascript
configure(config)
```

* 配置邮件账户
   * @param {object} config - 邮件配置

---

## async getConnection(accountId = "default")

```javascript
async getConnection(accountId = "default")
```

* 从连接池获取连接
   * @param {string} accountId - 账户ID（用于区分不同账户的连接）

---

## isConnectionValid(poolEntry)

```javascript
isConnectionValid(poolEntry)
```

* 检查连接是否有效

---

## cleanupOldestConnection()

```javascript
cleanupOldestConnection()
```

* 清理最久未使用的连接

---

## cleanupExpiredConnections()

```javascript
cleanupExpiredConnections()
```

* 清理所有过期连接

---

## getPoolStats()

```javascript
getPoolStats()
```

* 获取连接池统计信息

---

## async connect()

```javascript
async connect()
```

* 连接到 IMAP 服务器

---

## disconnect(accountId = null)

```javascript
disconnect(accountId = null)
```

* 断开连接
   * @param {string} accountId - 可选，指定要断开的账户ID，不指定则断开所有连接

---

## async getMailboxes()

```javascript
async getMailboxes()
```

* 获取邮箱列表

---

## async openMailbox(mailbox = "INBOX")

```javascript
async openMailbox(mailbox = "INBOX")
```

* 打开邮箱
   * @param {string} mailbox - 邮箱名称（如 'INBOX'）

---

## async fetchEmails(options =

```javascript
async fetchEmails(options =
```

* 获取邮件列表
   * @param {object} options - 选项

---

## async fetchEmail(uid, mailbox = "INBOX")

```javascript
async fetchEmail(uid, mailbox = "INBOX")
```

* 获取单封邮件
   * @param {number} uid - 邮件 UID

---

## async markAsRead(uid, mailbox = "INBOX")

```javascript
async markAsRead(uid, mailbox = "INBOX")
```

* 标记邮件为已读
   * @param {number} uid - 邮件 UID

---

## async deleteEmail(uid, mailbox = "INBOX")

```javascript
async deleteEmail(uid, mailbox = "INBOX")
```

* 删除邮件
   * @param {number} uid - 邮件 UID

---

## async sendEmail(mailOptions)

```javascript
async sendEmail(mailOptions)
```

* 发送邮件
   * @param {object} mailOptions - 邮件选项

---

## normalizeEmail(parsed, seqno)

```javascript
normalizeEmail(parsed, seqno)
```

* 标准化邮件数据

---

## parseMailboxes(boxes, prefix = "")

```javascript
parseMailboxes(boxes, prefix = "")
```

* 解析邮箱列表

---

## getDefaultImapHost(email)

```javascript
getDefaultImapHost(email)
```

* 获取默认 IMAP 主机

---

## getDefaultSmtpHost(email)

```javascript
getDefaultSmtpHost(email)
```

* 获取默认 SMTP 主机

---

## async testConnection()

```javascript
async testConnection()
```

* 测试连接

---

