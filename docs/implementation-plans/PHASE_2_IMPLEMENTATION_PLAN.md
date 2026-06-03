# Phase 2 实施计划 - 去中心化社交 (85% → 100%)

> **当前状态**: 85% 完成 (截至 v0.16.0)
> **目标**: 完成 Phase 2 所有功能，达到 100%
> **预计完成**: 2-3 周

---

## 📋 当前完成状态总结

### ✅ 已完成功能 (85%)

| 功能模块 | 完成度 | 版本 | 说明 |
|---------|--------|------|------|
| DID 身份系统 | 100% | v0.6.1+ | W3C 标准实现，支持创建、导出、验证 |
| DHT 网络发布 | 100% | v0.6.1+ | 自动重新发布，DID 文档解析 |
| 可验证凭证系统 | 100% | v0.8.0+ | VC 模板、签发、验证、撤销 |
| P2P 通信基础 | 100% | v0.10.0+ | libp2p 网络层，节点发现，连接管理 |
| Signal 端到端加密 | 100% | v0.16.0 | 密钥交换，加密会话，消息加解密 |
| 多设备支持 | 100% | v0.16.0 | 设备管理，设备广播，设备切换 |
| 离线消息队列 | 100% | v0.16.0 | 自动入队，状态跟踪，自动同步 |
| P2P 加密私信 | 100% | v0.16.0 | 端到端加密聊天，消息状态显示 |
| 社区论坛 | 80% | v0.8.0+ | Spring Boot 后端 + Vue3 前端 |

### 🚧 待完成功能 (15%)

| 功能模块 | 优先级 | 预计工时 | 说明 |
|---------|--------|---------|------|
| 好友管理系统 | 🔴 高 | 5 天 | 添加好友、好友列表、好友请求 |
| 动态发布系统 | 🔴 高 | 5 天 | 发布动态、动态流、点赞评论 |
| 移动端 UI 完善 | 🟡 中 | 3 天 | React Native UI 组件完善 |

---

## 🎯 Phase 2 剩余任务详解

### 任务 1: 好友管理系统 (5 天)

#### 功能需求
- **好友请求发送与接收**
  - 通过 DID 搜索用户
  - 发送好友请求 (P2P 消息)
  - 接收好友请求通知
  - 接受/拒绝好友请求

- **好友列表管理**
  - 好友列表展示 (头像、昵称、在线状态)
  - 好友分组 (家人、朋友、同事等)
  - 好友备注和标签
  - 删除好友

- **好友状态同步**
  - 在线/离线状态实时更新
  - 最后活跃时间显示
  - 多设备状态同步

#### 技术实现

**数据库设计** (`src/main/database.js`):
```sql
-- 好友关系表
CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_did TEXT NOT NULL,           -- 当前用户 DID
  friend_did TEXT NOT NULL,         -- 好友 DID
  nickname TEXT,                    -- 好友备注
  group_name TEXT,                  -- 分组名称
  status TEXT NOT NULL,             -- 'pending', 'accepted', 'blocked'
  created_at INTEGER NOT NULL,      -- 添加时间
  updated_at INTEGER NOT NULL,      -- 更新时间
  UNIQUE(user_did, friend_did)
);

-- 好友请求表
CREATE TABLE IF NOT EXISTS friend_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_did TEXT NOT NULL,           -- 发送者 DID
  to_did TEXT NOT NULL,             -- 接收者 DID
  message TEXT,                     -- 请求消息
  status TEXT NOT NULL,             -- 'pending', 'accepted', 'rejected'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(from_did, to_did)
);

-- 好友在线状态表 (内存缓存)
CREATE TABLE IF NOT EXISTS friend_status (
  friend_did TEXT PRIMARY KEY,
  online_status TEXT NOT NULL,      -- 'online', 'offline', 'away'
  last_seen INTEGER NOT NULL,
  device_count INTEGER DEFAULT 0
);
```

**P2P 协议** (`src/main/p2p/p2p-manager.js`):
```javascript
// 注册好友请求协议
this.node.handle('/chainlesschain/friend-request/1.0.0', async ({ stream, connection }) => {
  const request = await readStreamData(stream);
  // 处理好友请求
  await this.handleFriendRequest(request);
});

// 注册好友状态同步协议
this.node.handle('/chainlesschain/friend-status/1.0.0', async ({ stream, connection }) => {
  const status = await readStreamData(stream);
  // 更新好友状态
  await this.updateFriendStatus(status);
});
```

**前端组件** (`src/renderer/components/Friends.vue`):
- 好友列表组件
- 好友请求组件
- 添加好友对话框
- 好友详情卡片

#### 验收标准
- [ ] 可以通过 DID 搜索并添加好友
- [ ] 可以接收、接受、拒绝好友请求
- [ ] 好友列表实时显示在线状态
- [ ] 支持好友分组和备注
- [ ] 多设备好友状态同步正常

---

### 任务 2: 动态发布系统 (5 天)

#### 功能需求
- **动态发布**
  - 文字动态 (最多 1000 字)
  - 图片动态 (最多 9 张)
  - 链接分享
  - 隐私设置 (公开/仅好友)

- **动态流展示**
  - 时间线排序
  - 下拉刷新
  - 滚动加载更多
  - 点赞/评论数显示

- **互动功能**
  - 点赞/取消点赞
  - 评论 (支持回复评论)
  - 转发 (可选)
  - 举报不当内容

- **动态管理**
  - 编辑动态
  - 删除动态
  - 查看点赞/评论列表

#### 技术实现

**数据库设计**:
```sql
-- 动态表
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,              -- UUID
  author_did TEXT NOT NULL,         -- 作者 DID
  content TEXT NOT NULL,            -- 动态内容
  images TEXT,                      -- 图片 URL 列表 (JSON)
  visibility TEXT NOT NULL,         -- 'public', 'friends', 'private'
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 点赞表
CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL,
  user_did TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_did)
);

-- 评论表
CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  author_did TEXT NOT NULL,
  content TEXT NOT NULL,
  parent_id TEXT,                   -- 父评论 ID (用于回复)
  created_at INTEGER NOT NULL
);
```

**P2P 协议**:
```javascript
// 动态同步协议 (P2P 传播)
this.node.handle('/chainlesschain/post-sync/1.0.0', async ({ stream, connection }) => {
  const post = await readStreamData(stream);
  // 保存动态到本地
  await this.savePost(post);
  // 触发 UI 更新
  this.emit('post:received', post);
});

// 点赞/评论同步协议
this.node.handle('/chainlesschain/post-interaction/1.0.0', async ({ stream }) => {
  const interaction = await readStreamData(stream);
  await this.handleInteraction(interaction);
});
```

**前端组件**:
- `PostComposer.vue` - 动态编辑器
- `PostFeed.vue` - 动态流
- `PostCard.vue` - 单条动态卡片
- `CommentList.vue` - 评论列表
- `LikeButton.vue` - 点赞按钮

#### 验收标准
- [ ] 可以发布文字和图片动态
- [ ] 动态流正确展示好友动态
- [ ] 点赞和评论功能正常
- [ ] 动态在 P2P 网络中正确传播
- [ ] 隐私设置生效

---

### 任务 3: 移动端 UI 完善 (3 天)

#### 功能需求
- **React Native 组件完善**
  - 登录/注册页面
  - DID 管理页面
  - 好友列表页面
  - 聊天页面
  - 动态流页面
  - 设置页面

- **原生功能集成**
  - 推送通知
  - 相机/相册访问
  - 生物识别认证
  - 后台运行

#### 技术实现
- 参考 `desktop-app-vue` 的实现
- 使用 React Navigation 进行页面导航
- 使用 React Native Paper 或 Native Base UI 库
- 集成 react-native-push-notification
- 集成 react-native-biometrics

#### 验收标准
- [ ] 移动端 UI 与 PC 端功能对等
- [ ] 推送通知正常工作
- [ ] 支持生物识别登录
- [ ] 后台接收消息正常

---

## 🗓️ 实施时间表

### Week 1: 好友管理系统 (第 1-5 天)

| 日期 | 任务 | 输出 |
|------|------|------|
| Day 1 | 数据库设计 + P2P 协议设计 | 数据库迁移脚本、协议文档 |
| Day 2 | 后端 API 实现 (好友请求) | IPC 处理器、数据库操作 |
| Day 3 | 后端 API 实现 (好友列表、状态) | 好友管理完整 API |
| Day 4 | 前端 UI 实现 (好友列表、请求) | Friends.vue 组件 |
| Day 5 | 测试、调试、优化 | 功能测试报告 |

### Week 2: 动态发布系统 (第 6-10 天)

| 日期 | 任务 | 输出 |
|------|------|------|
| Day 6 | 数据库设计 + P2P 协议设计 | 动态相关表、协议定义 |
| Day 7 | 后端 API 实现 (发布、查询) | 动态发布和查询 API |
| Day 8 | 后端 API 实现 (点赞、评论) | 互动功能 API |
| Day 9 | 前端 UI 实现 (动态流、编辑器) | PostFeed.vue 等组件 |
| Day 10 | P2P 同步、测试 | 完整功能测试 |

### Week 3: 移动端 + 整体测试 (第 11-13 天)

| 日期 | 任务 | 输出 |
|------|------|------|
| Day 11 | React Native UI 实现 | 移动端页面组件 |
| Day 12 | 原生功能集成 | 推送、生物识别 |
| Day 13 | 整体测试、文档完善 | Phase 2 完成报告 |

---

## 📊 技术架构更新

### 新增模块

```
desktop-app-vue/src/main/
├── social/                     # 社交功能模块
│   ├── friend-manager.js       # 好友管理
│   ├── post-manager.js         # 动态管理
│   └── interaction-manager.js  # 互动管理
└── p2p/
    ├── friend-protocol.js      # 好友协议处理
    └── post-protocol.js        # 动态协议处理

desktop-app-vue/src/renderer/
├── components/
│   ├── Friends.vue             # 好友列表
│   ├── FriendRequests.vue      # 好友请求
│   ├── PostFeed.vue            # 动态流
│   ├── PostComposer.vue        # 发布动态
│   └── PostCard.vue            # 动态卡片
└── pages/
    ├── FriendsPage.vue         # 好友页面
    └── FeedPage.vue            # 动态页面
```

---

## 🧪 测试计划

### 单元测试
- [ ] 好友请求发送/接收测试
- [ ] 好友状态同步测试
- [ ] 动态发布/查询测试
- [ ] 点赞/评论功能测试

### 集成测试
- [ ] 多设备好友状态同步测试
- [ ] P2P 动态传播测试
- [ ] 离线消息队列 + 好友请求测试

### 端到端测试
- [ ] 完整用户流程测试 (注册 → 添加好友 → 聊天 → 发动态)
- [ ] 多用户交互测试
- [ ] 移动端与 PC 端互通测试

---

## 📝 文档更新

需要更新的文档:
- [ ] README.md - Phase 2 完成状态
- [ ] API.md - 新增 API 文档
- [ ] 用户手册 - 社交功能使用说明
- [ ] 系统设计文档 - Phase 2 技术细节

---

## 🎯 完成标准

Phase 2 达到 100% 需满足以下条件:

1. **功能完整性**
   - ✅ 好友管理系统完全可用
   - ✅ 动态发布系统完全可用
   - ✅ 移动端 UI 基本完善

2. **质量标准**
   - ✅ 单元测试覆盖率 ≥ 80%
   - ✅ 无严重 Bug
   - ✅ P2P 通信稳定可靠

3. **用户体验**
   - ✅ UI 流畅，响应快速
   - ✅ 离线功能正常
   - ✅ 多设备同步无感知

4. **文档完善**
   - ✅ API 文档完整
   - ✅ 用户手册清晰
   - ✅ 代码注释充分

---

## 🚀 开始实施

**下一步行动**:
1. 创建 `social` 模块目录结构
2. 实现好友管理数据库表
3. 开发好友请求 P2P 协议
4. 构建好友列表前端组件

**第一个 commit**: `feat: Phase 2 - 好友管理系统框架搭建`

---

**文档版本**: v1.0
**创建日期**: 2025-12-19
**最后更新**: 2025-12-19
**作者**: ChainlessChain Team
