# RSS 和邮件集成 - 前端 UI 实现指南

## 已完成的组件

### ✅ 1. RSS Feed List (`src/renderer/pages/rss/FeedList.vue`)
**功能：**
- 订阅源列表展示
- 分类管理
- 添加/删除/编辑订阅源
- Feed 发现功能
- 批量刷新
- 自动同步控制

**主要特性：**
- 左侧分类导航
- 右侧订阅源列表
- 实时状态显示（正常/错误/暂停）
- Feed URL 验证
- 预设分类支持

### ✅ 2. RSS Article Reader (`src/renderer/pages/rss/ArticleReader.vue`)
**功能：**
- 文章列表（左侧）
- 文章阅读器（右侧）
- 已读/未读状态
- 收藏功能
- 保存到知识库
- 在浏览器中打开
- 归档功能

**主要特性：**
- 双栏布局
- HTML 内容清理（DOMPurify）
- 自动标记已读
- 筛选（全部/未读/收藏）
- 响应式设计

### ✅ 3. Email Account Manager (`src/renderer/pages/email/AccountManager.vue`)
**功能：**
- 邮件账户列表
- 添加/编辑/删除账户
- 连接测试
- 预设配置（Gmail, Outlook, QQ, 163, 126）
- 同步控制
- 状态管理

**主要特性：**
- IMAP/SMTP 配置
- 自动同步设置
- 连接测试
- 预设服务商配置
- 实时状态显示

## 待实现的组件

### 4. Email Reader (`src/renderer/pages/email/EmailReader.vue`)

```vue
<template>
  <div class="email-reader">
    <a-row :gutter="16">
      <!-- 左侧：邮箱和邮件列表 -->
      <a-col :span="6">
        <a-card title="邮箱" size="small">
          <a-tree
            :tree-data="mailboxes"
            :selected-keys="selectedMailbox"
            @select="onMailboxSelect"
          />
        </a-card>
      </a-col>

      <a-col :span="8">
        <a-card title="邮件列表">
          <a-list
            :data-source="emails"
            :loading="loading"
            @click="selectEmail"
          >
            <!-- 邮件列表项 -->
          </a-list>
        </a-card>
      </a-col>

      <!-- 右侧：邮件内容 -->
      <a-col :span="10">
        <a-card v-if="selectedEmail">
          <!-- 邮件头部 -->
          <div class="email-header">
            <h3>{{ selectedEmail.subject }}</h3>
            <div>发件人: {{ selectedEmail.from_address }}</div>
            <div>收件人: {{ selectedEmail.to_address }}</div>
            <div>日期: {{ selectedEmail.date }}</div>
          </div>

          <!-- 邮件内容 -->
          <div v-html="sanitizedContent"></div>

          <!-- 附件列表 -->
          <a-list
            v-if="attachments.length > 0"
            :data-source="attachments"
            size="small"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a @click="downloadAttachment(item)">
                  {{ item.filename }} ({{ formatSize(item.size) }})
                </a>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup>
// 实现邮件阅读器逻辑
// - 加载邮箱列表
// - 加载邮件列表
// - 显示邮件内容
// - 附件下载
// - 标记已读/收藏
// - 保存到知识库
</script>
```

**关键 API 调用：**
```javascript
// 获取邮箱列表
const mailboxes = await window.electron.ipcRenderer.invoke('email:get-mailboxes', accountId);

// 获取邮件列表
const emails = await window.electron.ipcRenderer.invoke('email:get-emails', {
  accountId,
  mailboxId,
  isRead: false,
  limit: 50
});

// 获取附件
const attachments = await window.electron.ipcRenderer.invoke('email:get-attachments', emailId);

// 下载附件
await window.electron.ipcRenderer.invoke('email:download-attachment', attachmentId, savePath);
```

### 5. Email Composer (`src/renderer/pages/email/EmailComposer.vue`)

```vue
<template>
  <a-modal
    v-model:open="visible"
    title="撰写邮件"
    width="800px"
    @ok="sendEmail"
  >
    <a-form :model="emailForm" layout="vertical">
      <a-form-item label="收件人" required>
        <a-select
          v-model:value="emailForm.to"
          mode="tags"
          placeholder="输入邮箱地址"
        />
      </a-form-item>

      <a-form-item label="抄送">
        <a-select
          v-model:value="emailForm.cc"
          mode="tags"
          placeholder="输入邮箱地址"
        />
      </a-form-item>

      <a-form-item label="主题" required>
        <a-input v-model:value="emailForm.subject" />
      </a-form-item>

      <a-form-item label="内容" required>
        <a-textarea
          v-model:value="emailForm.text"
          :rows="10"
        />
      </a-form-item>

      <a-form-item label="附件">
        <a-upload
          v-model:file-list="emailForm.attachments"
          :before-upload="() => false"
        >
          <a-button>
            <UploadOutlined /> 选择文件
          </a-button>
        </a-upload>
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup>
// 实现邮件撰写逻辑
// - 收件人/抄送/密送
// - 主题和正文
// - 附件上传
// - 发送邮件
// - 草稿保存
</script>
```

**关键 API 调用：**
```javascript
// 发送邮件
await window.electron.ipcRenderer.invoke('email:send-email', accountId, {
  to: 'recipient@example.com',
  cc: 'cc@example.com',
  subject: 'Hello',
  text: 'Plain text content',
  html: '<p>HTML content</p>',
  attachments: [
    {
      filename: 'file.pdf',
      path: '/path/to/file.pdf'
    }
  ]
});
```

## 通知系统集成

### 创建通知管理器 (`src/main/api/notification-manager.js`)

```javascript
const { Notification } = require('electron');

class APINotificationManager {
  constructor() {
    this.enabled = true;
  }

  // RSS 新文章通知
  notifyNewArticles(feedTitle, count) {
    if (!this.enabled) return;

    new Notification({
      title: 'RSS 新文章',
      body: `${feedTitle} 有 ${count} 篇新文章`,
      icon: path.join(__dirname, '../../assets/rss-icon.png'),
    }).show();
  }

  // 新邮件通知
  notifyNewEmails(accountEmail, count) {
    if (!this.enabled) return;

    new Notification({
      title: '新邮件',
      body: `${accountEmail} 收到 ${count} 封新邮件`,
      icon: path.join(__dirname, '../../assets/email-icon.png'),
    }).show();
  }

  // 同步错误通知
  notifyError(title, message) {
    if (!this.enabled) return;

    new Notification({
      title: title,
      body: message,
      urgency: 'critical',
    }).show();
  }
}

module.exports = APINotificationManager;
```

### 在 IPC 处理器中集成通知

**RSS IPC Handler 修改：**
```javascript
// 在 rss-ipc.js 的 fetchFeed 方法中
async fetchFeed(feedId) {
  try {
    // ... 现有代码 ...

    // 如果有新文章，发送通知
    if (newItemsCount > 0) {
      this.notificationManager.notifyNewArticles(feed.title, newItemsCount);
    }

    return { success: true, itemCount: feedData.items.length };
  } catch (error) {
    // 发送错误通知
    this.notificationManager.notifyError('RSS 同步失败', error.message);
    throw error;
  }
}
```

**Email IPC Handler 修改：**
```javascript
// 在 email-ipc.js 的 fetchEmails 方法中
async fetchEmails(accountId, options = {}) {
  try {
    // ... 现有代码 ...

    // 如果有新邮件，发送通知
    if (newEmailsCount > 0) {
      this.notificationManager.notifyNewEmails(account.email, newEmailsCount);
    }

    return { success: true, count: emails.length };
  } catch (error) {
    // 发送错误通知
    this.notificationManager.notifyError('邮件同步失败', error.message);
    throw error;
  }
}
```

## 路由配置

在 `src/renderer/router/index.js` 中添加路由：

```javascript
const routes = [
  // ... 现有路由 ...

  // RSS 路由
  {
    path: '/rss',
    name: 'RSS',
    children: [
      {
        path: 'feeds',
        name: 'RSSFeeds',
        component: () => import('@/pages/rss/FeedList.vue'),
      },
      {
        path: 'articles/:feedId',
        name: 'RSSArticles',
        component: () => import('@/pages/rss/ArticleReader.vue'),
      },
    ],
  },

  // Email 路由
  {
    path: '/email',
    name: 'Email',
    children: [
      {
        path: 'accounts',
        name: 'EmailAccounts',
        component: () => import('@/pages/email/AccountManager.vue'),
      },
      {
        path: 'inbox/:accountId',
        name: 'EmailInbox',
        component: () => import('@/pages/email/EmailReader.vue'),
      },
    ],
  },
];
```

## 菜单集成

在主菜单中添加 RSS 和 Email 入口：

```javascript
// src/main/menu-manager.js
const menu = [
  // ... 现有菜单 ...
  {
    label: 'RSS 订阅',
    submenu: [
      {
        label: '订阅管理',
        click: () => {
          mainWindow.webContents.send('navigate', '/rss/feeds');
        },
      },
      {
        label: '刷新所有订阅',
        click: async () => {
          await ipcMain.invoke('rss:fetch-all-feeds');
        },
      },
    ],
  },
  {
    label: '邮件',
    submenu: [
      {
        label: '账户管理',
        click: () => {
          mainWindow.webContents.send('navigate', '/email/accounts');
        },
      },
      {
        label: '撰写邮件',
        click: () => {
          mainWindow.webContents.send('show-email-composer');
        },
      },
    ],
  },
];
```

## 测试用例

### 单元测试示例

**RSS Fetcher 测试 (`tests/unit/rss-fetcher.test.js`):**
```javascript
const RSSFetcher = require('../../src/main/api/rss-fetcher');

describe('RSSFetcher', () => {
  let fetcher;

  beforeEach(() => {
    fetcher = new RSSFetcher();
  });

  test('should fetch RSS feed', async () => {
    const feed = await fetcher.fetchFeed('https://example.com/feed.xml');
    expect(feed).toHaveProperty('title');
    expect(feed).toHaveProperty('items');
    expect(Array.isArray(feed.items)).toBe(true);
  });

  test('should validate feed URL', () => {
    expect(fetcher.isValidUrl('https://example.com')).toBe(true);
    expect(fetcher.isValidUrl('invalid-url')).toBe(false);
  });

  test('should discover feeds', async () => {
    const feeds = await fetcher.discoverFeeds('https://example.com');
    expect(Array.isArray(feeds)).toBe(true);
  });
});
```

**Email Client 测试 (`tests/unit/email-client.test.js`):**
```javascript
const EmailClient = require('../../src/main/api/email-client');

describe('EmailClient', () => {
  let client;

  beforeEach(() => {
    client = new EmailClient();
  });

  test('should configure email account', () => {
    client.configure({
      email: 'test@example.com',
      password: 'password',
      imapHost: 'imap.example.com',
      smtpHost: 'smtp.example.com',
    });

    expect(client.config).toBeDefined();
    expect(client.config.imap.user).toBe('test@example.com');
  });

  test('should get default IMAP host', () => {
    expect(client.getDefaultImapHost('user@gmail.com')).toBe('imap.gmail.com');
    expect(client.getDefaultImapHost('user@qq.com')).toBe('imap.qq.com');
  });
});
```

### 集成测试示例

**RSS Integration 测试 (`tests/integration/rss-integration.test.js`):**
```javascript
describe('RSS Integration', () => {
  test('should add and fetch feed', async () => {
    // 添加订阅源
    const addResult = await window.electron.ipcRenderer.invoke(
      'rss:add-feed',
      'https://example.com/feed.xml'
    );
    expect(addResult.success).toBe(true);

    const feedId = addResult.feedId;

    // 获取文章
    const itemsResult = await window.electron.ipcRenderer.invoke(
      'rss:get-items',
      { feedId }
    );
    expect(itemsResult.success).toBe(true);
    expect(Array.isArray(itemsResult.items)).toBe(true);

    // 清理
    await window.electron.ipcRenderer.invoke('rss:remove-feed', feedId);
  });
});
```

## 性能优化建议

### 1. 虚拟滚动
对于大量文章/邮件列表，使用虚拟滚动：

```vue
<template>
  <a-virtual-list
    :data="articles"
    :height="600"
    :item-height="80"
  >
    <template #item="{ item }">
      <ArticleItem :article="item" />
    </template>
  </a-virtual-list>
</template>
```

### 2. 懒加载
文章内容和图片懒加载：

```javascript
// 只加载可见区域的文章内容
const loadArticleContent = async (articleId) => {
  if (loadedArticles.has(articleId)) return;

  const result = await window.electron.ipcRenderer.invoke('rss:get-item', articleId);
  loadedArticles.set(articleId, result.item);
};
```

### 3. 缓存策略
使用 Pinia 缓存数据：

```javascript
// stores/rss.js
export const useRSSStore = defineStore('rss', {
  state: () => ({
    feeds: [],
    articles: new Map(),
    lastUpdate: null,
  }),

  actions: {
    async loadFeeds() {
      // 如果缓存未过期，直接返回
      if (this.lastUpdate && Date.now() - this.lastUpdate < 60000) {
        return this.feeds;
      }

      const result = await window.electron.ipcRenderer.invoke('rss:get-feeds');
      this.feeds = result.feeds;
      this.lastUpdate = Date.now();
      return this.feeds;
    },
  },
});
```

## 下一步行动

1. **完成剩余 UI 组件**
   - Email Reader
   - Email Composer

2. **集成通知系统**
   - 创建 APINotificationManager
   - 在 IPC 处理器中集成

3. **添加路由和菜单**
   - 配置 Vue Router
   - 更新主菜单

4. **编写测试用例**
   - 单元测试
   - 集成测试
   - E2E 测试

5. **性能优化**
   - 虚拟滚动
   - 懒加载
   - 缓存策略

6. **用户体验优化**
   - 加载状态
   - 错误处理
   - 离线支持

## 运行和测试

```bash
# 安装依赖（如果还没有）
cd desktop-app-vue
npm install

# 构建主进程
npm run build:main

# 启动开发服务器
npm run dev

# 运行测试
npm run test

# 运行 E2E 测试
npm run test:e2e
```

## 总结

已完成的工作：
- ✅ RSS Feed List 组件
- ✅ RSS Article Reader 组件
- ✅ Email Account Manager 组件
- ✅ 完整的后端 API 和 IPC 处理器
- ✅ 数据库架构
- ✅ 详细文档

待完成的工作：
- ⏳ Email Reader 组件
- ⏳ Email Composer 组件
- ⏳ 通知系统集成
- ⏳ 测试用例
- ⏳ 性能优化

所有核心功能已经实现，剩余的主要是 UI 组件的完善和测试！
