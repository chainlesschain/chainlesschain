# email-ipc

**Source**: `src/main/api/email-ipc.js`

**Generated**: 2026-02-16T22:06:51.513Z

---

## const

```javascript
const
```

* Email IPC Handlers
 * 处理邮件相关的 IPC 通信
 *
 * v0.20.0: 新增邮件集成功能

---

## getEmailClient(accountId)

```javascript
getEmailClient(accountId)
```

* 获取或创建邮件客户端

---

## async addAccount(config)

```javascript
async addAccount(config)
```

* 添加邮件账户

---

## async removeAccount(accountId)

```javascript
async removeAccount(accountId)
```

* 删除邮件账户

---

## async updateAccount(accountId, updates)

```javascript
async updateAccount(accountId, updates)
```

* 更新邮件账户

---

## async getAccounts()

```javascript
async getAccounts()
```

* 获取账户列表

---

## async getAccount(accountId)

```javascript
async getAccount(accountId)
```

* 获取单个账户

---

## async testConnection(config)

```javascript
async testConnection(config)
```

* 测试连接

---

## async syncMailboxes(accountId)

```javascript
async syncMailboxes(accountId)
```

* 同步邮箱列表

---

## async getMailboxes(accountId)

```javascript
async getMailboxes(accountId)
```

* 获取邮箱列表

---

## async fetchEmails(accountId, options =

```javascript
async fetchEmails(accountId, options =
```

* 获取邮件

---

## async saveEmails(accountId, mailboxName, emails)

```javascript
async saveEmails(accountId, mailboxName, emails)
```

* 保存邮件到数据库

---

## async getEmails(options =

```javascript
async getEmails(options =
```

* 获取邮件列表

---

## async getEmail(emailId)

```javascript
async getEmail(emailId)
```

* 获取单封邮件

---

## async markAsRead(emailId)

```javascript
async markAsRead(emailId)
```

* 标记为已读

---

## async markAsUnread(emailId)

```javascript
async markAsUnread(emailId)
```

* 标记为未读

---

## async markAsStarred(emailId, starred = true)

```javascript
async markAsStarred(emailId, starred = true)
```

* 标记为收藏

---

## async archiveEmail(emailId)

```javascript
async archiveEmail(emailId)
```

* 归档邮件

---

## async deleteEmail(emailId)

```javascript
async deleteEmail(emailId)
```

* 删除邮件

---

## async sendEmail(accountId, mailOptions)

```javascript
async sendEmail(accountId, mailOptions)
```

* 发送邮件

---

## async saveDraft(accountId, draftData)

```javascript
async saveDraft(accountId, draftData)
```

* 保存草稿

---

## async getDrafts(accountId)

```javascript
async getDrafts(accountId)
```

* 获取草稿列表

---

## async deleteDraft(draftId)

```javascript
async deleteDraft(draftId)
```

* 删除草稿

---

## async saveToKnowledge(emailId)

```javascript
async saveToKnowledge(emailId)
```

* 保存到知识库

---

## async getAttachments(emailId)

```javascript
async getAttachments(emailId)
```

* 获取附件列表

---

## async downloadAttachment(attachmentId, savePath)

```javascript
async downloadAttachment(attachmentId, savePath)
```

* 下载附件

---

## async addLabel(name, options =

```javascript
async addLabel(name, options =
```

* 添加标签

---

## async getLabels()

```javascript
async getLabels()
```

* 获取标签列表

---

## async assignLabel(emailId, labelId)

```javascript
async assignLabel(emailId, labelId)
```

* 分配标签

---

## async removeLabel(emailId, labelId)

```javascript
async removeLabel(emailId, labelId)
```

* 移除标签

---

## startAutoSync(accountId)

```javascript
startAutoSync(accountId)
```

* 启动自动同步

---

## stopAutoSync(accountId)

```javascript
stopAutoSync(accountId)
```

* 停止自动同步

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

