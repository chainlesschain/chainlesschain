# RSS 和邮件集成功能

## 概述

ChainlessChain v0.20.0 新增了 RSS 订阅和邮件集成功能，允许用户：
- 订阅和管理 RSS/Atom 源
- 集成多个邮件账户（IMAP/SMTP）
- 将 RSS 文章和邮件保存到知识库
- 自动同步和通知

## 功能特性

### RSS 订阅功能

#### 核心功能
- ✅ 支持 RSS 2.0 和 Atom 1.0 格式
- ✅ 自动发现网站的 RSS 源
- ✅ 订阅源分类管理
- ✅ 文章阅读状态跟踪（已读/未读/收藏/归档）
- ✅ 自动同步（可配置同步频率）
- ✅ 将文章保存到知识库
- ✅ 全文搜索

#### 数据库表结构
- `rss_feeds` - RSS 订阅源
- `rss_items` - RSS 文章
- `rss_categories` - 订阅分类
- `rss_feed_categories` - 订阅源-分类关联

### 邮件集成功能

#### 核心功能
- ✅ 支持 IMAP/POP3 协议接收邮件
- ✅ 支持 SMTP 协议发送邮件
- ✅ 多账户管理
- ✅ 邮箱同步（INBOX, Sent, Drafts 等）
- ✅ 邮件阅读状态跟踪（已读/未读/收藏/归档）
- ✅ 附件管理和下载
- ✅ 邮件标签系统
- ✅ 自动同步（可配置同步频率）
- ✅ 将邮件保存到知识库

#### 数据库表结构
- `email_accounts` - 邮件账户
- `email_mailboxes` - 邮箱列表
- `emails` - 邮件
- `email_attachments` - 邮件附件
- `email_labels` - 邮件标签
- `email_label_mappings` - 邮件-标签关联

## 安装依赖

```bash
cd desktop-app-vue
npm install
```

新增的依赖包：
- `rss-parser` - RSS/Atom 解析器
- `imap` - IMAP 客户端
- `mailparser` - 邮件解析器
- `nodemailer` - SMTP 邮件发送

## API 使用指南

### RSS API

#### 添加订阅源

```javascript
// 渲染进程
const result = await window.electron.ipcRenderer.invoke('rss:add-feed',
  'https://example.com/feed.xml',
  {
    category: 'Tech',
    updateFrequency: 3600, // 秒
    autoSync: true
  }
);
```

#### 获取订阅源列表

```javascript
const { feeds } = await window.electron.ipcRenderer.invoke('rss:get-feeds', {
  status: 'active', // 可选: 'active', 'paused', 'error'
  category: 'Tech'  // 可选
});
```

#### 获取文章列表

```javascript
const { items } = await window.electron.ipcRenderer.invoke('rss:get-items', {
  feedId: 'feed-uuid',
  isRead: false,      // 可选: 只获取未读
  isStarred: true,    // 可选: 只获取收藏
  limit: 50           // 可选: 限制数量
});
```

#### 标记文章为已读

```javascript
await window.electron.ipcRenderer.invoke('rss:mark-as-read', itemId);
```

#### 保存文章到知识库

```javascript
const { knowledgeId } = await window.electron.ipcRenderer.invoke(
  'rss:save-to-knowledge',
  itemId
);
```

#### 发现网站的 RSS 源

```javascript
const { feeds } = await window.electron.ipcRenderer.invoke(
  'rss:discover-feeds',
  'https://example.com'
);
```

### Email API

#### 添加邮件账户

```javascript
const result = await window.electron.ipcRenderer.invoke('email:add-account', {
  email: 'user@example.com',
  password: 'your-password',
  displayName: 'My Account',
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapTls: true,
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpSecure: false,
  syncFrequency: 300, // 秒
  autoSync: true
});
```

#### 测试连接

```javascript
const { result } = await window.electron.ipcRenderer.invoke('email:test-connection', {
  email: 'user@example.com',
  password: 'your-password',
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapTls: true
});
```

#### 获取邮件列表

```javascript
const { emails } = await window.electron.ipcRenderer.invoke('email:get-emails', {
  accountId: 'account-uuid',
  mailboxId: 'mailbox-uuid',
  isRead: false,      // 可选: 只获取未读
  isStarred: true,    // 可选: 只获取收藏
  limit: 50           // 可选: 限制数量
});
```

#### 同步邮件

```javascript
const { count } = await window.electron.ipcRenderer.invoke('email:fetch-emails',
  accountId,
  {
    mailbox: 'INBOX',
    limit: 50,
    unseen: true  // 只获取未读邮件
  }
);
```

#### 发送邮件

```javascript
const result = await window.electron.ipcRenderer.invoke('email:send-email',
  accountId,
  {
    to: 'recipient@example.com',
    subject: 'Hello',
    text: 'Plain text content',
    html: '<p>HTML content</p>',
    attachments: [
      {
        filename: 'file.pdf',
        path: '/path/to/file.pdf'
      }
    ]
  }
);
```

#### 保存邮件到知识库

```javascript
const { knowledgeId } = await window.electron.ipcRenderer.invoke(
  'email:save-to-knowledge',
  emailId
);
```

## 自动同步

### RSS 自动同步

```javascript
// 启动自动同步
await window.electron.ipcRenderer.invoke('rss:start-auto-sync', feedId);

// 停止自动同步
await window.electron.ipcRenderer.invoke('rss:stop-auto-sync', feedId);

// 手动同步所有订阅源
const { results } = await window.electron.ipcRenderer.invoke('rss:fetch-all-feeds');
```

### Email 自动同步

```javascript
// 启动自动同步
await window.electron.ipcRenderer.invoke('email:start-auto-sync', accountId);

// 停止自动同步
await window.electron.ipcRenderer.invoke('email:stop-auto-sync', accountId);
```

## 常见邮件服务器配置

### Gmail
```javascript
{
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  imapTls: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  smtpSecure: false
}
```

### Outlook/Hotmail
```javascript
{
  imapHost: 'outlook.office365.com',
  imapPort: 993,
  imapTls: true,
  smtpHost: 'smtp.office365.com',
  smtpPort: 587,
  smtpSecure: false
}
```

### QQ 邮箱
```javascript
{
  imapHost: 'imap.qq.com',
  imapPort: 993,
  imapTls: true,
  smtpHost: 'smtp.qq.com',
  smtpPort: 587,
  smtpSecure: false
}
```

### 163 邮箱
```javascript
{
  imapHost: 'imap.163.com',
  imapPort: 993,
  imapTls: true,
  smtpHost: 'smtp.163.com',
  smtpPort: 465,
  smtpSecure: true
}
```

## 事件监听

### RSS 事件

```javascript
// 监听 RSS 获取进度
window.electron.ipcRenderer.on('rss:fetch-progress', (event, data) => {
  console.log(`进度: ${data.current}/${data.total}`);
});

// 监听 RSS 获取完成
window.electron.ipcRenderer.on('rss:fetch-complete', (event, results) => {
  console.log(`成功: ${results.success}, 失败: ${results.failed}`);
});
```

### Email 事件

```javascript
// 监听邮件发送成功
window.electron.ipcRenderer.on('email:sent', (event, info) => {
  console.log('邮件已发送:', info.messageId);
});

// 监听邮件发送错误
window.electron.ipcRenderer.on('email:send-error', (event, error) => {
  console.error('发送失败:', error);
});
```

## 安全注意事项

1. **密码存储**: 邮件密码存储在加密的 SQLite 数据库中（使用 SQLCipher）
2. **HTTPS/TLS**: 建议使用 TLS 连接邮件服务器
3. **应用专用密码**: 对于 Gmail 等服务，建议使用应用专用密码而非主密码
4. **权限控制**: RSS 和邮件功能需要网络访问权限

## 性能优化

1. **批量操作**: 使用批量 API 减少数据库操作
2. **增量同步**: 只同步新邮件和文章
3. **后台同步**: 自动同步在后台线程执行
4. **缓存策略**: 文章和邮件内容缓存在本地数据库

## 故障排除

### RSS 订阅失败
- 检查 Feed URL 是否正确
- 验证网站是否提供 RSS/Atom 源
- 检查网络连接

### 邮件连接失败
- 验证服务器地址和端口
- 检查用户名和密码
- 确认是否启用了 IMAP/SMTP 服务
- 对于 Gmail，需要启用"不够安全的应用访问权限"或使用应用专用密码

### 同步速度慢
- 减少同步频率
- 限制每次同步的邮件数量
- 检查网络带宽

## 未来计划

- [ ] RSS 全文抓取
- [ ] 邮件智能分类
- [ ] 邮件模板系统
- [ ] RSS 过滤规则
- [ ] 邮件搜索优化
- [ ] 移动端推送通知
- [ ] RSS 导出为 OPML
- [ ] 邮件批量操作

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License
