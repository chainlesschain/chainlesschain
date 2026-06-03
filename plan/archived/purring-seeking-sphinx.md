# 社交模块UI完善实现计划

## 项目背景

ChainlessChain社交模块当前完成度：90-95%

- 已完成：DID身份、联系人、好友、动态、P2P加密消息、可验证凭证
- 技术栈：Electron 39.2.6 + Vue 3.4 + Ant Design Vue 4.1 + Pinia

## 用户需求

### 完善现有功能

1. ✅ 好友聊天集成
2. ✅ 实时通知系统
3. ✅ 状态管理优化
4. ✅ UI/UX视觉优化

### 添加新功能

1. ✅ 群聊功能
2. ✅ 文件传输
3. ✅ 语音/视频通话

---

## 第一阶段：核心完善（1-2周）⭐ 优先

### 1.1 好友聊天集成

**新建文件：**

```
desktop-app-vue/src/renderer/components/social/ChatWindow.vue
desktop-app-vue/src/renderer/components/social/MessageBubble.vue
desktop-app-vue/src/renderer/components/social/ConversationList.vue
```

**修改文件：**

- `src/renderer/components/Friends.vue` - 实现"打开聊天"按钮功能
- `src/renderer/router/index.js` - 添加聊天路由

**数据库变更（database.js）：**

```sql
-- 聊天会话表
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  participant_did TEXT NOT NULL,
  friend_nickname TEXT,
  last_message TEXT,
  last_message_time INTEGER,
  unread_count INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- P2P消息持久化表
CREATE TABLE IF NOT EXISTS p2p_chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sender_did TEXT NOT NULL,
  receiver_did TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  file_path TEXT,
  encrypted INTEGER DEFAULT 1,
  status TEXT DEFAULT 'sent',
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
);
```

**新增IPC接口（index.js）：**

- `chat:get-sessions` - 获取会话列表
- `chat:get-messages` - 获取聊天记录
- `chat:save-message` - 保存消息
- `chat:update-message-status` - 更新消息状态
- `chat:mark-as-read` - 标记已读

### 1.2 创建 social.js Store ⭐

**新建文件：**

```
desktop-app-vue/src/renderer/stores/social.js
```

**核心状态：**

- 好友列表、好友请求、在线状态
- 聊天会话、当前消息、未读计数
- 动态列表、我的动态
- 通知列表、未读通知

**核心方法：**

- `loadFriends()`, `addFriend()`, `setFriendOnlineStatus()`
- `openChatWithFriend()`, `loadMessages()`, `sendMessage()`
- `loadPosts()`, `createPost()`, `likePost()`
- `addNotification()`, `markNotificationAsRead()`

### 1.3 实时通知系统

**新建文件：**

```
desktop-app-vue/src/main/notification-manager.js
desktop-app-vue/src/renderer/components/social/NotificationCenter.vue
```

**修改文件：**

- `src/renderer/components/MainLayout.vue` - 添加通知中心入口（右上角铃铛图标）
- `src/main/index.js` - 注册通知IPC处理器

**数据库变更：**

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_did TEXT NOT NULL,
  type TEXT NOT NULL, -- friend_request, message, like, comment, system
  title TEXT NOT NULL,
  content TEXT,
  data TEXT,
  is_read INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

**新增IPC接口：**

- `notification:get-all` - 获取所有通知
- `notification:mark-read` - 标记已读
- `notification:mark-all-read` - 全部已读
- `notification:get-unread-count` - 未读数量
- `notification:send-desktop` - 发送桌面通知

### 1.4 消息持久化

**修改文件：**

- `src/renderer/components/P2PMessaging.vue` - 集成数据库存储，替换内存Map

**实现要点：**

- 发送消息时立即保存到数据库
- 收到P2P消息时自动保存
- 从数据库加载历史消息（分页加载）
- 消息状态同步：已发送 → 已送达 → 已读

---

## 第二阶段：UI/UX优化（1周）

### 2.1 加载骨架屏

**新建文件：**

```
desktop-app-vue/src/renderer/components/social/SkeletonFriendList.vue
desktop-app-vue/src/renderer/components/social/SkeletonPostCard.vue
desktop-app-vue/src/renderer/components/social/SkeletonMessage.vue
```

**修改文件：**

- `Friends.vue`, `PostFeed.vue`, `ChatWindow.vue` - 添加骨架屏

### 2.2 交互动画和过渡

**新建文件：**

```
desktop-app-vue/src/renderer/styles/social-animations.css
```

**动画类型：**

- 消息进入动画（slideInRight/Left）
- 通知弹出动画
- 点赞心跳动画
- 模态框淡入淡出

**修改所有社交组件：**

- 使用 `<transition>` 和 `<transition-group>`
- 列表项添加进入/离开动画

### 2.3 响应式布局优化

**修改所有社交组件：**

- 断点设计：移动(<768px)、平板(768-1023px)、桌面(≥1024px)
- 使用CSS Grid/Flexbox实现流式布局
- ChatWindow自适应窗口大小

### 2.4 暗黑模式支持

**新建文件：**

```
desktop-app-vue/src/renderer/styles/social-theme.css
```

**使用CSS变量：**

```css
:root {
  --social-bg-primary, --social-bg-secondary
  --social-text-primary, --social-border
}

[data-theme='dark'] { /* 暗黑主题变量 */ }
```

---

## 第三阶段：群聊功能（1-2周）

### 3.1 群组数据库设计

**数据库变更（database.js）：**

```sql
CREATE TABLE IF NOT EXISTS chat_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  avatar TEXT,
  creator_did TEXT NOT NULL,
  member_count INTEGER DEFAULT 0,
  max_members INTEGER DEFAULT 200,
  is_public INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  member_did TEXT NOT NULL,
  role TEXT DEFAULT 'member', -- owner, admin, member
  joined_at INTEGER NOT NULL,
  UNIQUE(group_id, member_did)
);

CREATE TABLE IF NOT EXISTS group_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  sender_did TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  timestamp INTEGER NOT NULL
);
```

### 3.2 群组管理

**新建文件：**

```
desktop-app-vue/src/main/social/group-manager.js
desktop-app-vue/src/renderer/components/social/GroupCreate.vue
desktop-app-vue/src/renderer/components/social/GroupManagement.vue
desktop-app-vue/src/renderer/components/social/GroupList.vue
```

**新增IPC接口：**

- `group:create`, `group:get-list`, `group:get-info`, `group:update`, `group:delete`
- `group:add-member`, `group:remove-member`, `group:get-members`, `group:update-member-role`

### 3.3 群聊消息

**实现要点：**

- 使用P2P协议向每个成员广播消息（group-manager.js）
- 消息去重机制
- 离线成员通过device-sync-manager同步
- 大群优化：分页加载、虚拟滚动

---

## 第四阶段：文件传输（1周）

### 4.1 文件传输后端

**新建文件：**

```
desktop-app-vue/src/main/p2p/file-transfer-manager.js
```

**核心功能：**

- 分块传输（64KB chunks）
- 进度跟踪（EventEmitter）
- 断点续传
- SHA-256哈希验证

**数据库变更：**

```sql
CREATE TABLE IF NOT EXISTS file_transfers (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  sender_did TEXT,
  receiver_did TEXT,
  direction TEXT, -- upload, download
  status TEXT DEFAULT 'pending', -- pending, transferring, completed, failed
  progress REAL DEFAULT 0,
  save_path TEXT,
  created_at INTEGER NOT NULL
);
```

### 4.2 文件传输UI

**新建文件：**

```
desktop-app-vue/src/renderer/components/social/FileTransferPanel.vue
desktop-app-vue/src/renderer/components/social/FileMessage.vue
desktop-app-vue/src/renderer/components/social/FilePreview.vue
```

**修改文件：**

- `ChatWindow.vue` - 添加文件上传按钮、拖拽上传

**支持预览：**

- 图片：PNG, JPG, GIF, WebP
- 文档：PDF, TXT, MD
- 视频：MP4, WebM
- 音频：MP3, WAV

**新增IPC接口：**

- `file:send`, `file:accept`, `file:reject`, `file:cancel`, `file:get-transfers`

---

## 第五阶段：音视频通话（2-3周）

### 5.1 WebRTC集成

**新建文件：**

```
desktop-app-vue/src/main/webrtc/webrtc-manager.js
```

**依赖安装：**

```bash
npm install simple-peer
```

**核心功能：**

- `initiateCall()` - 发起通话
- `acceptCall()` - 接听通话
- `hangup()` - 挂断通话
- 配置STUN/TURN服务器

### 5.2 通话UI

**新建文件：**

```
desktop-app-vue/src/renderer/components/social/CallWindow.vue
desktop-app-vue/src/renderer/components/social/IncomingCallModal.vue
desktop-app-vue/src/renderer/components/social/CallControls.vue
desktop-app-vue/src/renderer/components/social/GroupCallWindow.vue (多人通话)
```

**修改文件：**

- `ChatWindow.vue` - 添加语音/视频通话按钮

**数据库变更：**

```sql
CREATE TABLE IF NOT EXISTS call_history (
  id TEXT PRIMARY KEY,
  caller_did TEXT NOT NULL,
  callee_did TEXT NOT NULL,
  call_type TEXT, -- audio, video
  status TEXT, -- missed, answered, rejected, failed
  duration INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL
);
```

**新增IPC接口：**

- `call:initiate`, `call:accept`, `call:reject`, `call:hangup`
- `call:toggle-audio`, `call:toggle-video`, `call:get-devices`

### 5.3 多人通话

**实现方案：**

- Mesh布局（≤4人）：每个参与者P2P连接
- SFU架构（5-20人）：需要中心服务器（可选）

**UI布局：**

- 1-2人：全屏显示
- 3-4人：2×2网格
- 5-9人：3×3网格
- 10+人：画中画+发言人模式

---

## 跨阶段技术考虑

### 性能优化

- **虚拟滚动**：使用@tanstack/virtual-core（已安装）
- **图片懒加载**：IntersectionObserver API
- **状态管理**：Pinia的$patch()批量更新

### 安全性

- **消息加密**：Signal Protocol端到端加密（已有）
- **文件安全**：哈希验证、危险文件拦截
- **XSS防护**：内容转义、CSP策略

### 可访问性

- **键盘导航**：Tab、Enter、Esc
- **屏幕阅读器**：ARIA标签、语义化HTML
- **视觉辅助**：高对比度、可调字体大小

### 测试策略

- **单元测试**：Vitest（stores、工具函数）
- **集成测试**：IPC通信、数据库操作
- **E2E测试**：Playwright（用户流程）

---

## 实施优先级

### 🔴 立即开始（第一阶段）

1. 创建 social.js Store - 基础架构
2. 好友聊天集成 - 核心功能
3. 消息持久化 - 数据安全
4. 通知系统 - 用户体验

### 🟡 其次（第二阶段）

5. UI/UX优化 - 视觉体验

### 🟢 后续（第三、四、五阶段）

6. 群聊功能
7. 文件传输
8. 音视频通话

---

## 关键文件清单

### 必须修改

- `src/main/database.js` - 所有数据库表变更
- `src/main/index.js` - 所有IPC接口注册
- `src/renderer/router/index.js` - 路由配置
- `src/renderer/components/MainLayout.vue` - 通知中心入口
- `src/renderer/components/Friends.vue` - 聊天集成

### 必须创建

- `src/renderer/stores/social.js` ⭐ 核心
- `src/renderer/components/social/ChatWindow.vue` ⭐ 核心
- `src/main/notification-manager.js` ⭐ 核心
- `src/renderer/components/social/NotificationCenter.vue` ⭐ 核心
- 其他组件按阶段创建

---

## 潜在风险

1. **WebRTC穿透**：NAT/防火墙可能导致P2P连接失败
   - 解决：配置TURN中继服务器

2. **大文件传输**：性能和存储问题
   - 解决：限制单文件≤100MB，实现分块传输

3. **音视频带宽**：多人通话带宽需求高
   - 解决：自适应码率，最多支持9人

4. **数据库迁移**：新增表可能影响现有用户
   - 解决：数据库版本管理，平滑迁移

5. **暗黑模式兼容**：Ant Design Vue的主题适配
   - 解决：测试所有组件，必要时自定义样式

---

## 预计时间线

- **第一阶段**：1-2周（核心完善）
- **第二阶段**：1周（UI优化）
- **第三阶段**：1-2周（群聊）
- **第四阶段**：1周（文件传输）
- **第五阶段**：2-3周（音视频）

**总计**：6-9周

---

## 成功标准

✅ 好友列表可直接打开聊天窗口
✅ 聊天记录持久化到数据库
✅ 实时桌面通知和应用内通知中心
✅ 社交模块有统一的状态管理
✅ UI流畅，动画自然，响应式布局
✅ 支持群聊、文件传输、音视频通话
✅ 代码测试覆盖率≥80%
✅ 无安全漏洞，数据端到端加密
